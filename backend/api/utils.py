"""
DCQ(DataCenter Query) 공통 유틸리티 모듈
"""
import os
import io
import sys
import json
import time
import socket
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

# 외부 동기화(DCQ/RTDB) 직렬화 락 - 원래는 DCQ SDK(v2.5.0, C 확장)가 전역 토큰 상태를 쓰기
# 때문에 스레드 비안전이라 DCQ 세션(로그인~getTokenTime()/getData())만 감싸던 락이었다. 이후
# RTDB 동기화와 DCQ 동기화가 서로 겹쳐 돌지 않도록 범위를 넓혀, 외부 데이터 동기화(DCQ 세션
# 전체 + RTDB 동기화 전체)를 한 번에 하나씩만 실행하도록 공용으로 쓴다.
# cq_login() 내부에서 external_sync_lock() 안에 다시 들어오는 중첩 호출이 있으므로 RLock 을 쓴다.
_EXTERNAL_SYNC_LOCK = threading.RLock()

# DCQ 세션 재사용 캐시 - 같은 프로세스 안에서 매 사이클 재로그인하지 않고 기존 세션을 재사용하기
# 위한 캐시. 재사용 전 항상 get_dcq_token_info() 로 세션이 아직 살아있는지 확인하고, 확인이
# 실패하면 즉시 재로그인한다(ensure_dcq_session() 참고). RTDB 캐시와 달리 만료 시각을 알 수
# 없어(SDK 가 비공개라 getTokenTime() 반환값의 만료 필드 여부를 확정하지 못함) TTL 기반 선제
# 갱신 대신 "확인 실패 시에만 재로그인"하는 반응형 방식을 쓴다. 프로세스 메모리에만 있어
# run_scheduler 재시작 시 비워진다.
_dcq_session_cache = {'dcq_id': None}

# 진단용 프로세스 식별자(모듈 로드 시 1회 계산, 이 프로세스가 사는 동안 고정) - hostname 은
# docker-compose 에 별도 hostname 오버라이드가 없어 컨테이너 인스턴스마다 자동으로 고유하게
# 부여되므로(재배포로 컨테이너가 바뀌어도 다름), hostname+PID 조합으로 "컨테이너가 2개 떠서
# 동시에 로그인했는지" vs "같은 컨테이너 안에서 프로세스가 중복 실행됐는지"까지 구별할 수 있다.
# DCQ 토큰 불일치 실패(위 DCQ_LOGIN_SETTLE_DELAY_SEC 주석 참고) 재발 시, 이 태그가 실패
# 전후로 2개 이상 다르게 찍히는지 확인하면 프로세스 중복 여부를 로그만으로 확정할 수 있다.
_DCQ_PROC_TAG = f"{socket.gethostname()}:{os.getpid()}"

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
def external_sync_lock():
    """
    외부 데이터 동기화(DCQ 세션 전체 또는 RTDB 동기화 전체)를 감싸는 컨텍스트 매니저. 여러
    스케줄러 잡(sync_form_options/sync_holidays/sync_design_rule/sync_rtdb_options)이 동시에
    실행되더라도 이 구간이 서로 겹치지 않도록(DCQ 끼리는 물론 DCQ 와 RTDB 사이에도) 호출부
    (scheduler.py)에서 사용한다.
    """
    with _EXTERNAL_SYNC_LOCK:
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
    with _EXTERNAL_SYNC_LOCK:
        sys.stdin = account_info
        try:
            login()
            logger.info(f"[DCQ][{_DCQ_PROC_TAG}] 로그인 성공: {dcq_id}")
            return True
        except Exception as e:
            logger.error(f"[DCQ][{_DCQ_PROC_TAG}] 로그인 실패: {e}", exc_info=True)
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
                logger.info(
                    f"[DCQ][{_DCQ_PROC_TAG}] 로그인 후 토큰 캐시 안정화 대기 {DCQ_LOGIN_SETTLE_DELAY_SEC}초"
                )
                time.sleep(DCQ_LOGIN_SETTLE_DELAY_SEC)
                return True
        except Exception as e:
            logger.warning(f"[DCQ][{_DCQ_PROC_TAG}] 비밀번호 시도 실패: {e}", exc_info=True)

    logger.error(f"[DCQ][{_DCQ_PROC_TAG}] 모든 비밀번호 시도가 실패했습니다")
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
            logger.info(f"[DCQ][{_DCQ_PROC_TAG}] 토큰 정보: {token_info}")
            return token_info
        except Exception as e:
            if attempt < DCQ_TOKEN_INFO_MAX_RETRIES:
                logger.warning(
                    f"[DCQ][{_DCQ_PROC_TAG}] 토큰 정보 조회 실패 - {DCQ_TOKEN_INFO_RETRY_DELAY_SEC}초 후 재시도 "
                    f"({attempt + 1}/{DCQ_TOKEN_INFO_MAX_RETRIES}회): {e}"
                )
                time.sleep(DCQ_TOKEN_INFO_RETRY_DELAY_SEC)
            else:
                logger.error(f"[DCQ][{_DCQ_PROC_TAG}] 토큰 정보 조회 실패: {e}", exc_info=True)
                return None


def _dcq_token_alive(token_info) -> bool:
    """
    get_dcq_token_info() 반환값으로 DCQ 세션이 아직 살아있는지 판정한다.

    DCQ SDK 의 getTokenTime() 은 토큰이 만료돼도 예외를 던지지 않고
    {'expiration_date': ..., 'remaining_days': 0, 'remaining_hours': 0, 'remaining_minutes': 0}
    형태의 dict 를 그대로 반환한다(2026-09 관측 - DCQ 동기화 26건 연속 실패의 근본 원인).
    단순히 None 여부만 보면 만료된 토큰도 "살아있음"으로 오판하므로, remaining_* 필드가
    모두 존재하면 그 합이 0보다 큰지까지 확인한다. SDK 반환 스키마가 비공개라 remaining_*
    필드가 없는 예상 밖 형식이 오면 보수적으로 "살아있음"으로 취급하고 경고 로그를 남긴다.
    """
    if token_info is None:
        return False

    remaining_keys = ('remaining_days', 'remaining_hours', 'remaining_minutes')
    if not all(key in token_info for key in remaining_keys):
        logger.warning(
            f"[DCQ][{_DCQ_PROC_TAG}] 토큰 정보에 remaining_* 필드가 없어 만료 여부를 "
            f"판정할 수 없습니다 - 살아있는 것으로 간주합니다: {token_info}"
        )
        return True

    remaining_total = sum(token_info[key] for key in remaining_keys)
    if remaining_total <= 0:
        logger.warning(f"[DCQ][{_DCQ_PROC_TAG}] 토큰이 만료되었습니다: {token_info}")
        return False
    return True


def ensure_dcq_session() -> Optional[str]:
    """
    DCQ 세션을 확보하고, 이후 조회에 쓸 dcq_id 를 반환한다(계정 정보가 없거나 로그인에
    최종 실패하면 None).

    같은 프로세스 안에서 이전에 확보해둔 세션이 남아있으면(_dcq_session_cache) 재로그인을
    생략하고 get_dcq_token_info() + _dcq_token_alive() 로 세션이 아직 살아있는지(호출 자체가
    성공했고, remaining_* 가 0보다 큰지)를 확인해서 재사용한다. 이 확인이 실패하면(호출
    자체가 실패했거나 토큰이 만료됐으면) 세션이 끊어진 것으로 보고 그 자리에서 재로그인한다.
    새로 로그인한 경우에도 반환 전 같은 방식으로 토큰 정보를 확인하고, 그마저 실패하면
    재로그인을 한 번 더 시도한다(최대 2회 로그인 시도).
    """
    dcq_id, pwd_pack = get_dcq_credentials()
    if not dcq_id or not pwd_pack:
        return None

    if _dcq_session_cache.get('dcq_id') == dcq_id and _dcq_token_alive(get_dcq_token_info(dcq_id)):
        logger.info(f"[DCQ][{_DCQ_PROC_TAG}] 기존 세션 재사용 (재로그인 생략)")
        return dcq_id

    _dcq_session_cache['dcq_id'] = None
    for attempt in (1, 2):
        if not dcq_login_with_retry():
            return None
        if _dcq_token_alive(get_dcq_token_info(dcq_id)):
            _dcq_session_cache['dcq_id'] = dcq_id
            return dcq_id
        logger.warning(
            f"[DCQ][{_DCQ_PROC_TAG}] 로그인 직후 토큰 확인 실패 ({attempt}/2) - 재로그인 재시도"
        )

    logger.error(f"[DCQ][{_DCQ_PROC_TAG}] 재로그인 후에도 토큰 확인 실패")
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
        logger.info(f"[DCQ][{_DCQ_PROC_TAG}] 데이터 조회 성공: {len(df)} 건")
        return df
    except Exception as e:
        logger.error(f"[DCQ][{_DCQ_PROC_TAG}] 데이터 조회 실패: {e}", exc_info=True)
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
