"""
⚠️ MASKING 처리된 파일

이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다.
원래 용어를 확인하려면 다음 파일을 참조하세요:
- frontend/src/locales/ko.json

"""
import os
import logging
import pandas as pd
from sqlalchemy import text
from dotenv import load_dotenv
from django.utils.translation import gettext_lazy as _

from .utils import (
    bq_login,
    get_dcq_credentials,
    dcq_login_with_retry,
    get_dcq_token_info,
    get_django_engine,
    get_data_from_dcq,
    LINE_SUFFIX_MAP,
)

logger = logging.getLogger(__name__)
load_dotenv()

LINES = ['라인 1', '라인 3', '라인 4', '라인 5']


def sync_form_options():
    """
    DCQ 를 사용하여 외부 DB 에서 {{request.process_selection}}-{{request.partid_selection}} / 
    {{request.partid_selection}}-{{request.process_id}} 데이터를
    DataFrame 으로 가져와 Django DB 에 저장
    """
    engine = None
    
    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e))
        return

    if not dcq_login_with_retry():
        logger.error(_("[scheduler] DCQ 로그인 실패로 인해 작업을 중단합니다"))
        return
    
    dcq_id, _ = get_dcq_credentials()
    if dcq_id:
        get_dcq_token_info(dcq_id)
    else:
        logger.error(_("[scheduler] DCQ 계정 정보를 찾을 수 없습니다"))
        return
  
    try:
        for line in LINES:
            try:
                suffix = LINE_SUFFIX_MAP[line]
                query_cp = f"""
                    SELECT DISTINCT partnumber, descript, pkgtype_2
                    FROM A.B_{suffix}
                    WHERE X IS NOT NULL AND X != ''
                """
                df_cp = get_data_from_dcq(query_cp, dcq_id)
                
                if df_cp is None or len(df_cp) == 0:
                    logger.warning(_("[scheduler] {line} {{request.process_selection}}-{{request.partid_selection}} 데이터가 없습니다").format(line=line))
                    continue
                    
                df_cp = df_cp.rename(columns={'descript': 'process', 'partnumber': 'product_name'})
                df_cp['line'] = line
                df_cp['last_synced'] = pd.Timestamp.now()
                df_cp = df_cp[['line', 'process', 'product_name', 'last_synced']]
  
                with engine.begin() as db_conn:
                    db_conn.execute(
                        text("DELETE FROM api_processproduct WHERE line = :line"),
                        {"line": line}
                    )
                    df_cp.to_sql('api_processproduct', db_conn, if_exists='append', index=False)
  
                logger.info(_("[scheduler] {line} {{request.process_selection}}-{{request.partid_selection}} {count}건 동기화 완료").format(line=line, count=len(df_cp)))
            except Exception as e:
                logger.error(_("[scheduler] {line} {{request.process_selection}}-{{request.partid_selection}} 동기화 실패: {e}").format(line=line, e=e))
  
            try:
                suffix = LINE_SUFFIX_MAP[line]
                query_pc = f"""
                    SELECT DISTINCT partnumber, processid
                    FROM A.B_{suffix}_processproduct
                """
                df_pc = get_data_from_dcq(query_pc, dcq_id)
                
                if df_pc is None or len(df_pc) == 0:
                    logger.warning(_("[scheduler] {line} {{request.partid_selection}}-{{request.process_id}} 데이터가 없습니다").format(line=line))
                    continue
                    
                df_pc = df_pc.rename(columns={'partnumber': 'product_name', 'processid': 'process_id'})
                df_pc['line'] = line
                df_pc['last_synced'] = pd.Timestamp.now()
                df_pc = df_pc[['line', 'product_name', 'process_id', 'last_synced']]
  
                with engine.begin() as db_conn:
                    db_conn.execute(
                        text("DELETE FROM api_productprocessid WHERE line = :line"),
                        {"line": line}
                    )
                    df_pc.to_sql('api_productprocessid', db_conn, if_exists='append', index=False)
  
                logger.info(_("[scheduler] {line} {{request.partid_selection}}-{{request.process_id}} {count}건 동기화 완료").format(line=line, count=len(df_pc)))
            except Exception as e:
                logger.error(_("[scheduler] {line} {{request.partid_selection}}-{{request.process_id}} 동기화 실패: {e}").format(line=line, e=e))

            try:
                suffix = LINE_SUFFIX_MAP[line]
                query_ps = f"""
                    SELECT processid, stepseq, descript, recipeid, areaname, eqptype, updated, layerid
                    FROM A.B_{suffix}_step
                    WHERE X = 'Y'
                """
                df_ps = get_data_from_dcq(query_ps, dcq_id)
                
                if df_ps is None or len(df_ps) == 0:
                    logger.warning(_("[scheduler] {line} {{request.col_step}} 데이터가 없습니다").format(line=line))
                    continue
                
                table_map = {
                    '라인 1': 'api_teps1',
                    '라인 3': 'api_steps3',
                    '라인 4': 'api_steps4',
                    '라인 5': 'api_steps5',
                }
                table_name = table_map.get(line)
                if not table_name:
                    logger.warning(_("[scheduler] 알 수 없는 {{request.line}}: {line}").format(line=line))
                    continue
                
                df_ps['last_synced'] = pd.Timestamp.now()
                df_ps = df_ps[['processid', 'stepseq', 'descript', 'recipeid', 'areaname', 'eqptype', 'updated', 'layerid', 'last_synced']]
  
                with engine.begin() as db_conn:
                    db_conn.execute(text(f"DELETE FROM {table_name}"))
                    df_ps.to_sql(table_name, db_conn, if_exists='append', index=False)
  
                logger.info(_("[scheduler] {line} {{request.col_step}} {count}건 동기화 완료").format(line=line, count=len(df_ps)))
            except Exception as e:
                logger.error(_("[scheduler] {line} {{request.col_step}} 동기화 실패: {e}").format(line=line, e=e))

    finally:
        if engine:
            engine.dispose()


def start():
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    from django_apscheduler.jobstores import DjangoJobStore
    from django.db.utils import ProgrammingError
    import threading

    scheduler = BackgroundScheduler(timezone='Asia/Seoul')
    scheduler.add_jobstore(DjangoJobStore(), 'default')

    try:
        scheduler.add_job(
            sync_form_options,
            trigger=IntervalTrigger(hours=1),
            id='sync_form_options',
            name='DCQ 폼 옵션 동기화',
            replace_existing=True,
        )

        scheduler.start()
        logger.info(_("[scheduler] APScheduler 시작 - 1 시간 주기 DCQ 동기화 등록"))

        threading.Thread(target=sync_form_options, daemon=True).start()
    except ProgrammingError as e:
        logger.warning(_("[scheduler] 테이블이 아직 생성되지 않았습니다. 마이그레이션 후 재시작됩니다: {e}").format(e=e))
