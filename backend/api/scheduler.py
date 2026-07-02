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
    rtdb_login_with_retry,
    get_data_from_rtdb,
    LINE_SUFFIX_MAP,
    LINE_TO_LINEID_MAP,
)

logger = logging.getLogger(__name__)
load_dotenv()

LINES = ['라인 1', '라인 3', '라인 4', '라인 5']

# RTDB(MAIN) process-product 조회 파라미터
RTDB_PP_SELECT = ["partnumber, descript, pkgtype_2"]
RTDB_PP_FILTER = {"X": {"$eq": "Y"}}
RTDB_PP_TARGET = "realtimedb"


def sync_process_product():
    """
    RTDB(REST API) 를 MAIN 소스로 {{request.process_selection}}-{{request.partid_selection}}
    데이터를 10 분 주기로 동기화한다.
    - MAIN 이 예외(None) 또는 빈 결과면 DCQ 로 fallback (DCQ 는 필요 시에만 지연 로그인)
    - 조회 결과가 기존 테이블과 동일하면 쓰기를 건너뛴다(변경 감지)
    """
    engine = None
    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e))
        return

    # MAIN 소스(RTDB) 토큰은 주기당 1회만 발급하여 라인 반복에서 재사용한다.
    rtdb_token = rtdb_login_with_retry()
    if not rtdb_token:
        logger.warning(_("[scheduler] RTDB 로그인 실패 - DCQ fallback 으로 진행합니다"))

    # DCQ 는 fallback 이 실제로 필요할 때만 지연 로그인한다.
    dcq_ready = False
    dcq_id = None

    try:
        for line in LINES:
            try:
                suffix = LINE_SUFFIX_MAP[line]

                # MAIN: RTDB(REST API) 우선 조회
                df_cp = None
                if rtdb_token:
                    rtdb_payload = {
                        "query": {
                            "select": RTDB_PP_SELECT,
                            "table_name": f"A_{suffix}.B",
                            "filter": RTDB_PP_FILTER,
                        },
                        "target": RTDB_PP_TARGET,
                    }
                    df_cp = get_data_from_rtdb(rtdb_payload, rtdb_token)

                # FALLBACK: MAIN 이 예외(None) 또는 빈 결과면 DCQ 로 조회
                if df_cp is None or len(df_cp) == 0:
                    logger.warning(_("[scheduler] {line} RTDB 조회 실패/빈 결과 - DCQ fallback 실행").format(line=line))
                    if not dcq_ready:
                        if dcq_login_with_retry():
                            dcq_id, _pw = get_dcq_credentials()
                            if dcq_id:
                                get_dcq_token_info(dcq_id)
                                dcq_ready = True
                            else:
                                logger.error(_("[scheduler] DCQ 계정 정보를 찾을 수 없습니다"))
                        else:
                            logger.error(_("[scheduler] DCQ 로그인 실패 - fallback 불가"))
                    if dcq_ready:
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

                # 변경 감지: 현재 테이블의 해당 라인 데이터와 동일하면 쓰기를 건너뛴다.
                with engine.connect() as conn:
                    rows = conn.execute(
                        text("SELECT process, product_name FROM api_processproduct WHERE line = :line"),
                        {"line": line}
                    ).fetchall()
                old_pairs = set((r[0], r[1]) for r in rows)
                new_pairs = set(df_cp[['process', 'product_name']].itertuples(index=False, name=None))
                if new_pairs == old_pairs:
                    logger.info(_("[scheduler] {line} {{request.process_selection}}-{{request.partid_selection}} 변경 없음 - skip").format(line=line))
                    continue

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
    finally:
        if engine:
            engine.dispose()


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

        try:
            query_pb = """
                SELECT DISTINCT n7mto_date, n7cancel_date, n7cancel_ok, n7c_layer_num, n7prod_code, n7barcode, n7material_spec
                FROM A.B
                WHERE n7barcode IS NOT NULL AND n7barcode != ''
                  AND n7c_layer_num IS NOT NULL AND n7c_layer_num != ''
            """
            df_pb = get_data_from_dcq(query_pb, dcq_id)

            if df_pb is None or len(df_pb) == 0:
                logger.warning(_("[scheduler] 바코드-품목 데이터가 없습니다"))
            else:
                df_pb['last_synced'] = pd.Timestamp.now()
                # 값이 없을 수 있는 컬럼은 None으로 통일
                for col in ['n7mto_date', 'n7cancel_date', 'n7cancel_ok', 'n7material_spec']:
                    df_pb[col] = df_pb[col].where(df_pb[col].notna() & (df_pb[col] != ''), other=None)
                df_pb = df_pb[['n7mto_date', 'n7cancel_date', 'n7cancel_ok', 'n7c_layer_num', 'n7prod_code', 'n7barcode', 'n7material_spec', 'last_synced']]

                with engine.begin() as db_conn:
                    db_conn.execute(text("DELETE FROM api_productbarcode"))
                    df_pb.to_sql('api_productbarcode', db_conn, if_exists='append', index=False)

                logger.info(_("[scheduler] 바코드-품목 {count}건 동기화 완료").format(count=len(df_pb)))
        except Exception as e:
            logger.error(_("[scheduler] 바코드-품목 동기화 실패: {e}").format(e=e))

        try:
            lineid_list = list(LINE_TO_LINEID_MAP.values())
            placeholders = ' OR '.join([f"lineid = '{lid}'" for lid in lineid_list])
            query_mn = f"""
                SELECT DISTINCT lineid, partid
                FROM X.Y
                WHERE ({placeholders})
                  AND partid IS NOT NULL AND partid != ''
            """
            df_mn = get_data_from_dcq(query_mn, dcq_id)

            if df_mn is None or len(df_mn) == 0:
                logger.warning(_("[scheduler] MAP 이름 데이터가 없습니다"))
            else:
                df_mn['last_synced'] = pd.Timestamp.now()
                df_mn = df_mn[['lineid', 'partid', 'last_synced']]

                with engine.begin() as db_conn:
                    db_conn.execute(text("DELETE FROM api_mapname"))
                    df_mn.to_sql('api_mapname', db_conn, if_exists='append', index=False)

                logger.info(_("[scheduler] MAP 이름 {count}건 동기화 완료").format(count=len(df_mn)))
        except Exception as e:
            logger.error(_("[scheduler] MAP 이름 동기화 실패: {e}").format(e=e))

    finally:
        if engine:
            engine.dispose()


def sync_holidays():
    """
    DCQ 에서 대한민국 공휴일 데이터를 가져와 api_holiday 테이블에 저장
    """
    engine = None
    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e))
        return

    if not dcq_login_with_retry():
        logger.error(_("[scheduler] DCQ 로그인 실패로 인해 공휴일 동기화를 중단합니다"))
        return

    dcq_id, _ = get_dcq_credentials()
    if not dcq_id:
        logger.error(_("[scheduler] DCQ 계정 정보를 찾을 수 없습니다"))
        return

    try:
        query = """
            SELECT DISTINCT date_name, isholiday, act_date
            FROM A.B
        """
        df = get_data_from_dcq(query, dcq_id)

        if df is None or len(df) == 0:
            logger.warning(_("[scheduler] 공휴일 데이터가 없습니다"))
            return

        df = df[df['isholiday'] == 'Y'].copy()
        df['act_date'] = pd.to_datetime(df['act_date']).dt.date

        with engine.begin() as db_conn:
            db_conn.execute(text("DELETE FROM api_holiday"))
            df[['date_name', 'isholiday', 'act_date']].to_sql(
                'api_holiday', db_conn, if_exists='append', index=False
            )

        logger.info(_("[scheduler] 공휴일 {count}건 동기화 완료").format(count=len(df)))
    except Exception as e:
        logger.error(_("[scheduler] 공휴일 동기화 실패: {e}").format(e=e))
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

        scheduler.add_job(
            sync_process_product,
            trigger=IntervalTrigger(minutes=10),
            id='sync_process_product',
            name='RTDB process-product 동기화',
            replace_existing=True,
            max_instances=1,
        )

        from apscheduler.triggers.cron import CronTrigger
        scheduler.add_job(
            sync_holidays,
            trigger=CronTrigger(hour=2, minute=0),
            id='sync_holidays',
            name='공휴일 동기화',
            replace_existing=True,
        )

        from .mailer import process_mail_queue
        scheduler.add_job(
            process_mail_queue,
            trigger=IntervalTrigger(minutes=1),
            id='process_mail_queue',
            name='결재 알림 메일 큐 발송',
            replace_existing=True,
            max_instances=1,
        )

        scheduler.start()
        logger.info(_("[scheduler] APScheduler 시작 - 1 시간 주기 DCQ 동기화 / 10 분 주기 RTDB process-product / 매일 02:00 공휴일 동기화 등록"))

        threading.Thread(target=sync_form_options, daemon=True).start()
        threading.Thread(target=sync_process_product, daemon=True).start()
        threading.Thread(target=sync_holidays, daemon=True).start()
    except ProgrammingError as e:
        logger.warning(_("[scheduler] 테이블이 아직 생성되지 않았습니다. 마이그레이션 후 재시작됩니다: {e}").format(e=e))


def start_mail_only():
    """무거운 DCQ 동기화를 건너뛰는 환경(SKIP_SCHEDULER=true, 예: 개발)에서도
    외부 DB 가 필요 없는 결재 알림 메일 큐 발송 잡만 단독으로 실행한다."""
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    from django_apscheduler.jobstores import DjangoJobStore
    from django.db.utils import ProgrammingError

    scheduler = BackgroundScheduler(timezone='Asia/Seoul')
    scheduler.add_jobstore(DjangoJobStore(), 'default')

    try:
        from .mailer import process_mail_queue
        scheduler.add_job(
            process_mail_queue,
            trigger=IntervalTrigger(minutes=1),
            id='process_mail_queue',
            name='결재 알림 메일 큐 발송',
            replace_existing=True,
            max_instances=1,
        )
        scheduler.start()
        logger.info(_("[scheduler] 메일 전용 스케줄러 시작 - 1 분 주기 결재 알림 발송"))
    except ProgrammingError as e:
        logger.warning(_("[scheduler] 테이블이 아직 생성되지 않았습니다. 마이그레이션 후 재시작됩니다: {e}").format(e=e))
