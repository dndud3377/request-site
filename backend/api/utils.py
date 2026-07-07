"""
DCQ(DataCenter Query) 공통 유틸리티 모듈
"""
import os
import io
import sys
import json
import logging
import threading
import requests
import pandas as pd
import urllib3
from sqlalchemy import create_engine
from urllib.parse import quote_plus

# DCQ import
import datacenterquery as dcq
from datacenterquery import login, getData

logger = logging.getLogger(__name__)

# RTDB(REST API) 요청 타임아웃(초)
RTDB_REQUEST_TIMEOUT = 30

# DCQ 로그인 직렬화 락 - cq_login 이 전역 sys.stdin 을 교체하므로
# 여러 스케줄러 스레드가 동시에 로그인하면 stdin 이 엉킨다. 로그인 구간을 한 번에 하나씩만 실행한다.
_DCQ_LOGIN_LOCK = threading.Lock()

# verify=False 사용에 따른 InsecureRequestWarning 억제 (사내 인증서 정책)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 라인명 → DB 테이블 접미사 매핑
LINE_SUFFIX_MAP = {
    'LINE1': 'line1',
    'LINE2': 'line2',
    'LINE3': 'line3',
    'LINE4': 'line4',
    'LINE5': 'line5',
}

# 라인명 → 외부 DB lineid 매핑 (api_mapname 동기화용)
LINE_TO_LINEID_MAP = {
    '라인1': 'aaaaa',
    '라인2': 'bbbbb',
    '라인3': 'ccccc',
    '라인4': 'ddddd',
    '라인5': 'eeeee',
}


def cq_login(dcq_id, dcq_password):
    """
    DCQ(DataCenter Query) 로그인 수행
    sample.py 와 동일한 방식 - stdin 우회 로그인
    """
    account_info = io.StringIO(f'{dcq_id}\n{dcq_password}')
    with _DCQ_LOGIN_LOCK:
        sys.stdin = account_info
        try:
            login()
            logger.info(f"[DCQ] 로그인 성공: {dcq_id}")
            return True
        except Exception as e:
            logger.error(f"[DCQ] 로그인 실패: {e}")
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
                return True
        except Exception as e:
            logger.warning(f"[DCQ] 비밀번호 시도 실패: {e}")
    
    logger.error("[DCQ] 모든 비밀번호 시도가 실패했습니다")
    return False


def get_dcq_token_info(dcq_id):
    """DCQ 토큰 정보 확인"""
    try:
        token_info = dcq.getTokenTime(dcq_id)
        logger.info(f"[DCQ] 토큰 정보: {token_info}")
        return token_info
    except Exception as e:
        logger.error(f"[DCQ] 토큰 정보 조회 실패: {e}")
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
        logger.error(f"[DCQ] 데이터 조회 실패: {e}")
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
    RTDB(REST API) 로그인 시도 (여러 비밀번호로 번갈아 재시도)
    성공 시 access_token 을 반환하고, 모두 실패하면 None 을 반환한다.
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
                access_token = response.json().get('access_token')
                logger.info(f"[RTDB] 로그인 성공: {rtdb_id}")
                return access_token
            logger.warning(f"[RTDB] 로그인 실패 (HTTP {response.status_code})")
        except Exception as e:
            logger.warning(f"[RTDB] 비밀번호 시도 실패: {e}")

    logger.error("[RTDB] 모든 비밀번호 시도가 실패했습니다")
    return None


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
        logger.error(f"[RTDB] 데이터 조회 실패: {e}")
        return None


def get_line_suffix(line):
    """
    라인명을 DB 테이블 접미사로 변환
    
    Args:
        line: 라인명 (예: 'LINE1', '라인 1')
    
    Returns:
        접미사 (예: 'line1') 또는 None
    """
    # 영문 라인명 직접 매핑
    if line in LINE_SUFFIX_MAP:
        return LINE_SUFFIX_MAP[line]
    
    # 한글 라인명 변환 (예: '라인 1' → 'line1')
    korean_map = {
        '라인 1': 'line1',
        '라인 2': 'line2',
        '라인 3': 'line3',
        '라인 4': 'line4',
        '라인 5': 'line5',
    }
    return korean_map.get(line)


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
