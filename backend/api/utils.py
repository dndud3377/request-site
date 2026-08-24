"""
DCQ(DataCenter Query) 공통 유틸리티 모듈
"""
import os
import io
import sys
import json
import time
import logging
import threading
import requests
import pandas as pd
import urllib3
from contextlib import contextmanager
from sqlalchemy import create_engine
from urllib.parse import quote_plus
from typing import Optional

# DCQ import
import datacenterquery as dcq
from datacenterquery import login, getData

logger = logging.getLogger(__name__)

# RTDB(REST API) 요청 타임아웃(초)
RTDB_REQUEST_TIMEOUT = 30

# RTDB refresh_token 자체의 유효기간(초) = 90일. RTDB 쪽 정책(access_token 은 별도로 1시간).
RTDB_REFRESH_TOKEN_TTL = 7_776_000
# refresh_token 유효기간이 끝나기 전에 미리 재로그인하기 위한 여유(초) = 7일.
# 즉 refresh_token 발급 후 83일(=90-7)이 지나면 만료를 기다리지 않고 먼저 재로그인한다.
# (2026-08 축소: 45일 → 7일. 풀 로그인 대신 refresh 를 최대한 오래 쓰도록 해 풀 로그인
# 빈도 자체를 더 줄인다 - 90일 중 83일을 refresh 로 버틴다.)
RTDB_REFRESH_TOKEN_RENEW_MARGIN = 7 * 86400

# RTDB access_token/refresh_token 인메모리 캐시. run_scheduler 프로세스가 살아있는 동안 유지되며,
# 프로세스가 재시작되면 비워져 다음 호출은 처음부터 풀 로그인(rtdb_login_with_retry)부터 시작한다.
_rtdb_token_cache = {'refresh_token': None, 'refresh_token_issued_at': None}

# DCQ 세션 직렬화 락 - DCQ SDK(v2.5.0, C 확장)가 전역 토큰 상태를 쓰기 때문에 스레드 비안전이다.
# cq_login() 이 전역 sys.stdin 을 교체하는 로그인 구간뿐 아니라, 로그인 이후 getTokenTime()/getData()
# 까지 포함한 "DCQ 세션 전체"를 한 번에 하나씩만 실행해야 토큰 상태가 스레드 간에 섞이지 않는다.
# cq_login() 내부에서 dcq_session_lock() 안에 다시 들어오는 중첩 호출이 있으므로 RLock 을 쓴다.
_DCQ_LOCK = threading.RLock()

# login() 성공 직후 곧바로 getTokenTime()/getData() 를 호출하면 "이전 토큰을 쓰고 있다"는
# 오류(Token user has is A, but latest token server has is B)로 실패하는 사례가 있었다
# (2026-08, 스케줄러 DCQ 동기화 실패 - 정확한 원인은 SDK 내부 토큰 캐시 반영 지연 또는 동시
# 로그인 충돌로 추정되나 SDK 가 사내 전용 비공개 모듈이라 확정하지 못했다). 완화책으로 로그인
# 성공 직후 이 시간만큼 대기한 뒤 다음 호출로 넘어간다.
DCQ_LOGIN_SETTLE_DELAY_SEC = 2

# getTokenTime() 호출이 위와 같은 원인으로 실패했을 때 재시도하는 횟수/간격(초).
DCQ_TOKEN_INFO_MAX_RETRIES = 3
DCQ_TOKEN_INFO_RETRY_DELAY_SEC = 1


@contextmanager
def dcq_session_lock():
    """
    DCQ 로그인부터 데이터 조회까지, 하나의 스케줄러 잡이 DCQ SDK 를 사용하는 전체 구간을 감싸는
    컨텍스트 매니저. 여러 스케줄러 잡(sync_form_options/sync_holidays/sync_design_rule)이
    동시에 실행되더라도 이 구간이 서로 겹치지 않도록 호출부(scheduler.py)에서 사용한다.
    """
    with _DCQ_LOCK:
        yield


# verify=False 사용에 따른 InsecureRequestWarning 억제 (사내 인증서 정책)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 라인명(Line 마스터·프론트엔드 OPTION_LINE 과 동일 표기, 공백 없음) → DB 테이블 접미사 매핑
LINE_SUFFIX_MAP = {
    '라인1': 'line1',
    '라인2': 'line2',
    '라인3': 'line3',
    '라인4': 'line4',
    '라인5': 'line5',
    'nv': 'lineN',
}

# 라인명 → 외부 DB lineid 매핑 (api_mapname 동기화용)
LINE_TO_LINEID_MAP = {
    '라인1': 'aaaaa',
    '라인2': 'bbbbb',
    '라인3': 'ccccc',
    '라인4': 'ddddd',
    '라인5': 'eeeee',
    'nv': 'fffff',
}


def cq_login(dcq_id, dcq_password):
    """
    DCQ(DataCenter Query) 로그인 수행
    sample.py 와 동일한 방식 - stdin 우회 로그인
    """
    account_info = io.StringIO(f'{dcq_id}\n{dcq_password}')
    with _DCQ_LOCK:
        sys.stdin = account_info
        try:
            login()
            logger.info(f"[DCQ] 로그인 성공: {dcq_id}")
            return True
        except Exception as e:
            logger.error(f"[DCQ] 로그인 실패: {e}", exc_info=True)
            return False
        finally:
            account_info.close()
            sys.stdin = sys.__stdin__


def get_dcq_credentials():
    """
    .env 파일에서 DCQ 계정 정보 읽기
    sample.py 와 동일하게 JSON pack 형태로 저장
    """
    dcq_id = os.environ.get('DCQ_ID', '')
    pwd_pack_str = os.environ.get('DCQ_PASSWORD', '')
    
    if not dcq_id or not pwd_pack_str:
        logger.warning("[DCQ] 계정 정보가 .env 에 설정되지 않았습니다")
        return None, None
    
    try:
        pwd_pack = json.loads(pwd_pack_str)
        return dcq_id, pwd_pack
    except json.JSONDecodeError:
        # JSON pack 이 아닌 단일 비밀번호인 경우
        return dcq_id, [pwd_pack_str]


def dcq_login_with_retry():
    """
    DCQ 로그인 시도 (여러 비밀번호로 시도)
    sample.py 와 동일한 로직
    """
    dcq_id, pwd_pack = get_dcq_credentials()
    
    if not dcq_id or not pwd_pack:
        return False
    
    for pw in pwd_pack:
        try:
            if cq_login(dcq_id, pw):
                logger.info(f"[DCQ] 로그인 후 토큰 캐시 안정화 대기 {DCQ_LOGIN_SETTLE_DELAY_SEC}초")
                time.sleep(DCQ_LOGIN_SETTLE_DELAY_SEC)
                return True
        except Exception as e:
            logger.warning(f"[DCQ] 비밀번호 시도 실패: {e}", exc_info=True)
    
    logger.error("[DCQ] 모든 비밀번호 시도가 실패했습니다")
    return False


def get_dcq_token_info(dcq_id):
    """
    DCQ 토큰 정보 확인.
    로그인 직후에도 "이전 토큰을 쓰고 있다"는 오류로 실패하는 사례가 있어(모듈 상단 주석 참고),
    실패 시 DCQ_TOKEN_INFO_RETRY_DELAY_SEC 초 대기 후 DCQ_TOKEN_INFO_MAX_RETRIES 회까지 재시도한다.
    """
    for attempt in range(DCQ_TOKEN_INFO_MAX_RETRIES + 1):
        try:
            token_info = dcq.getTokenTime(dcq_id)
            logger.info(f"[DCQ] 토큰 정보: {token_info}")
            return token_info
        except Exception as e:
            if attempt < DCQ_TOKEN_INFO_MAX_RETRIES:
                logger.warning(
                    f"[DCQ] 토큰 정보 조회 실패 - {DCQ_TOKEN_INFO_RETRY_DELAY_SEC}초 후 재시도 "
                    f"({attempt + 1}/{DCQ_TOKEN_INFO_MAX_RETRIES}회): {e}"
                )
                time.sleep(DCQ_TOKEN_INFO_RETRY_DELAY_SEC)
            else:
                logger.error(f"[DCQ] 토큰 정보 조회 실패: {e}", exc_info=True)
                return None


def get_django_engine():
    """Django DB 엔진 생성"""
    user = os.environ.get('MYSQL_USER', 'requestuser')
    password = os.environ.get('MYSQL_PASSWORD', 'requestpass')
    host = os.environ.get('MYSQL_HOST', 'db')
    port = os.environ.get('MYSQL_PORT', '3306')
    db = os.environ.get('MYSQL_DB', 'requestdb')
    # 비밀번호의 special characters URL 인코딩
    return create_engine(f"mysql+pymysql://{user}:{quote_plus(password)}@{host}:{port}/{db}")


def get_data_from_dcq(query, dcq_id):
    """
    DCQ 를 사용하여 데이터 조회
    sample.py 의 getData 방식 사용
    """
    try:
        df = dcq.getData(param=query, convert_type=True, user_name=dcq_id)
        logger.info(f"[DCQ] 데이터 조회 성공: {len(df)} 건")
        return df
    except Exception as e:
        logger.error(f"[DCQ] 데이터 조회 실패: {e}", exc_info=True)
        return None


def resolve_employee_by_loginid(loginid: str) -> Optional[dict]:
    """
    loginid 로 실제 존재하는 사내 인원인지 조회해 이름을 반환한다.

    TODO(사용자 구현 예정): 지금은 항상 None(사용자 없음)을 반환하는 자리표시자다.
    실제 조회 로직으로 교체할 것 — 아래는 구현 시 참고할 구조 제안.

    - 반환값
      · 존재하면: {'loginid': loginid, 'name': '<실제 이름>'}
      · 존재하지 않으면: None
    - 구현 예시(사내 인사 API/DCQ 등 사용 시)
      1) 사내 인사 DB/API 를 loginid 로 단건 조회한다.
         (참고: 이 파일의 get_data_from_dcq() 처럼 DCQ 세션을 통해 조회하거나,
          별도 REST API 가 있다면 requests 로 호출)
      2) 조회 결과가 없으면 None 리턴.
      3) 조회 결과가 있으면 {'loginid': loginid, 'name': 조회된 이름} 리턴.
    - 호출 시점: AddressBookViewSet.add_members()(views.py)에서, 주소록에 "새로"
      추가되는 loginid 마다 1회씩만 호출된다. 이미 저장돼 있던 기존 구성원은
      재검증하지 않으므로, 이 함수가 아직 미구현(항상 None)이어도 기존 구성원이
      사라지지는 않는다.
    - 여러 loginid 를 한 번에 조회해야 하면(N+1 방지), 시그니처를
      resolve_employees_by_loginids(loginids: list) -> dict 형태로 바꿔
      {loginid: name} 배치 조회로 확장해도 된다 — 그 경우 호출부(add_members)도
      함께 수정해야 한다.
    """
    return None


def get_rtdb_credentials():
    """
    .env 파일에서 RTDB(REST API) 계정 정보 읽기
    DCQ 와 동일하게 JSON pack 형태(비밀번호 목록)로 저장
    """
    rtdb_id = os.environ.get('RTDB_ID', '')
    pwd_pack_str = os.environ.get('RTDB_PASSWORD', '')

    if not rtdb_id or not pwd_pack_str:
        logger.warning("[RTDB] 계정 정보가 .env 에 설정되지 않았습니다")
        return None, None

    try:
        pwd_pack = json.loads(pwd_pack_str)
        return rtdb_id, pwd_pack
    except json.JSONDecodeError:
        # JSON pack 이 아닌 단일 비밀번호인 경우
        return rtdb_id, [pwd_pack_str]


def rtdb_login_with_retry():
    """
    RTDB(REST API) 풀 로그인 시도 (여러 비밀번호로 번갈아 재시도)
    성공 시 access_token 을 반환하고, 모두 실패하면 None 을 반환한다.
    응답에 함께 내려오는 refresh_token 은 _rtdb_token_cache 에 저장해 이후
    get_rtdb_token() 이 풀 로그인 대신 가벼운 rtdb_refresh_token() 을 쓸 수 있게 한다.
    """
    rtdb_id, pwd_pack = get_rtdb_credentials()
    base_url = os.environ.get('RTDB_BASE_URL', '')

    if not rtdb_id or not pwd_pack or not base_url:
        logger.error("[RTDB] 계정 정보 또는 RTDB_BASE_URL 이 설정되지 않았습니다")
        return None

    headers = {"Content-Type": "application/json"}
    for pw in pwd_pack:
        try:
            payload = {"name": rtdb_id, "password": pw}
            response = requests.post(
                f"{base_url}/api/tokens/login",
                data=json.dumps(payload, default=str),
                headers=headers,
                verify=False,
                timeout=RTDB_REQUEST_TIMEOUT,
            )
            if response.status_code == 200:
                body = response.json()
                access_token = body.get('access_token')
                refresh_token = body.get('refresh_token')
                logger.info(f"[RTDB] 로그인 성공: {rtdb_id}")
                if refresh_token:
                    _rtdb_token_cache['refresh_token'] = refresh_token
                    _rtdb_token_cache['refresh_token_issued_at'] = time.time()
                else:
                    logger.warning("[RTDB] 로그인 응답에 refresh_token 이 없습니다 - 다음 주기도 풀 로그인으로 진행됩니다")
                return access_token
            logger.warning(f"[RTDB] 로그인 실패 (HTTP {response.status_code})")
        except Exception as e:
            logger.warning(f"[RTDB] 비밀번호 시도 실패: {e}", exc_info=True)

    logger.error("[RTDB] 모든 비밀번호 시도가 실패했습니다")
    return None


def rtdb_refresh_token(refresh_token):
    """
    RTDB refresh API 로 access_token 만 가볍게 갱신한다.
    GET {RTDB_BASE_URL}/api/auth/refresh, Authorization: Bearer {refresh_token}.
    성공 시 새 access_token, 실패(예외/4xx/5xx/토큰 없음)면 None 을 반환한다.
    """
    base_url = os.environ.get('RTDB_BASE_URL', '')
    if not base_url or not refresh_token:
        return None

    headers = {"Authorization": f"Bearer {refresh_token}"}
    try:
        response = requests.get(
            f"{base_url}/api/auth/refresh",
            headers=headers,
            verify=False,
            timeout=RTDB_REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            logger.warning(f"[RTDB] 토큰 refresh 실패 (HTTP {response.status_code})")
            return None
        access_token = response.json().get('access_token')
        if not access_token:
            logger.warning("[RTDB] 토큰 refresh 응답에 access_token 이 없습니다")
            return None
        logger.info("[RTDB] 토큰 refresh 성공")
        return access_token
    except Exception as e:
        logger.warning(f"[RTDB] 토큰 refresh 요청 실패: {e}", exc_info=True)
        return None


def get_rtdb_token():
    """
    유효한 RTDB access_token 을 반환한다 (스케줄러가 호출하는 진입점).

    캐시된 refresh_token 이 있고 발급 후 경과 시간이
    (RTDB_REFRESH_TOKEN_TTL - RTDB_REFRESH_TOKEN_RENEW_MARGIN) 이내이면
    rtdb_refresh_token() 으로 access_token 만 가볍게 갱신해서 반환한다.
    refresh_token 이 없거나(최초 호출/프로세스 재시작 직후), 유효기간 여유가 얼마 안 남았거나,
    refresh 요청 자체가 실패하면 rtdb_login_with_retry() 로 풀 로그인해
    access_token·refresh_token 을 모두 새로 받는다.
    """
    refresh_token = _rtdb_token_cache.get('refresh_token')
    issued_at = _rtdb_token_cache.get('refresh_token_issued_at')
    if refresh_token and issued_at is not None:
        age = time.time() - issued_at
        if age < RTDB_REFRESH_TOKEN_TTL - RTDB_REFRESH_TOKEN_RENEW_MARGIN:
            access_token = rtdb_refresh_token(refresh_token)
            if access_token:
                return access_token
            logger.warning("[RTDB] 토큰 refresh 실패 - 풀 로그인으로 진행합니다")
        else:
            logger.info("[RTDB] refresh_token 유효기간 여유 소진 - 풀 로그인으로 갱신합니다")
    return rtdb_login_with_retry()


def get_data_from_rtdb(query_payload, access_token):
    """
    RTDB(REST API) 의 /api/queries 엔드포인트로 데이터 조회
    성공 시 DataFrame, 예외·에러 응답 시 None 을 반환한다.
    """
    base_url = os.environ.get('RTDB_BASE_URL', '')
    if not base_url or not access_token:
        logger.error("[RTDB] RTDB_BASE_URL 또는 access_token 이 없습니다")
        return None

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    params = {"show_sql": True}
    try:
        response = requests.post(
            f"{base_url}/api/queries",
            headers=headers,
            params=params,
            data=json.dumps(query_payload, default=str),
            verify=False,
            timeout=RTDB_REQUEST_TIMEOUT,
        )
        data = response.json()

        # API 에러 응답 체크
        if 'detail' in data:
            logger.error(f"[RTDB] API 에러: {data['detail']}")
            return None

        df = pd.DataFrame(
            data=data.get('data'),
            columns=data.get('schema', {}).get('columns', {}).get('names'),
        )
        logger.info(f"[RTDB] 데이터 조회 성공: {len(df)} 건")
        return df
    except Exception as e:
        logger.error(f"[RTDB] 데이터 조회 실패: {e}", exc_info=True)
        return None


def calculate_business_due_date(start_date, n_days):
    """
    start_date(포함) 기준으로 n_days 영업일째 날짜를 반환한다.
    주말(토/일) 및 api_holiday 테이블의 isholiday='Y' 날짜를 제외한다.

    Args:
        start_date: datetime.date — 시작일 (당일 포함 카운트)
        n_days: int — 영업일 수 (1이면 start_date 당일)

    Returns:
        datetime.date
    """
    import datetime
    from .models import Holiday

    # 향후 충분한 범위의 공휴일 집합을 한 번에 조회
    lookahead = start_date + datetime.timedelta(days=n_days * 3 + 30)
    holiday_set = set(
        Holiday.objects.filter(
            act_date__gte=start_date,
            act_date__lte=lookahead,
            isholiday='Y',
        ).values_list('act_date', flat=True)
    )

    count = 0
    current = start_date
    while True:
        if current.weekday() < 5 and current not in holiday_set:
            count += 1
            if count == n_days:
                return current
        current += datetime.timedelta(days=1)
