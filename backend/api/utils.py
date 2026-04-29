"""
DCQ(DataCenter Query) 공통 유틸리티 모듈
"""
import os
import io
import sys
import json
import logging
from sqlalchemy import create_engine
from urllib.parse import quote_plus

# DCQ import
import datacenterquery as dcq
from datacenterquery import login, getData

logger = logging.getLogger(__name__)

# 라인명 → DB 테이블 접미사 매핑
LINE_SUFFIX_MAP = {
    'LINE1': 'line1',
    'LINE2': 'line2',
    'LINE3': 'line3',
    'LINE4': 'line4',
    'LINE5': 'line5',
}


def cq_login(dcq_id, dcq_password):
    """
    DCQ(DataCenter Query) 로그인 수행
    sample.py 와 동일한 방식 - stdin 우회 로그인
    """
    account_info = io.StringIO(f'{dcq_id}\n{dcq_password}')
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
