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

# RTDB(MAIN) 조회 파라미터 - table_name 은 소스별로 다르며 {suffix} 는 라인 접미사로 치환된다.
RTDB_TARGET = "realtimedb"
RTDB_PP_SELECT = ["partnumber, descript, pkgtype_2"]   # 공정-품목
RTDB_PP_FILTER = {"X": {"$eq": "Y"}}
RTDB_PP_TABLE = "A_{suffix}.B"
RTDB_PC_SELECT = ["partnumber, processid"]             # 품목-공정ID
RTDB_PC_FILTER = {"X": {"$neq": " "}}
RTDB_PC_TABLE = "X_{suffix}.Y"
RTDB_STEP_SELECT = ["processid, stepseq, descript, recipeid, areaname, eqptype, updated, layerid"]  # 스텝
RTDB_STEP_FILTER = {
    "a": {"$eq": "aaaaaa"},
    "e": {"$neq": " "},
    "l": {"$neq": " "},
    "p": {"$neq": " "},
    "r": {"$neq": " "},
    "s": {"$neq": " "},
}
RTDB_STEP_TABLE = "O_{suffix}.W"

# 스텝(라인별 단독 테이블) 매핑 - 라인별로 서로 다른 테이블에 저장한다.
STEP_TABLE_MAP = {
    '라인 1': 'api_teps1',
    '라인 3': 'api_steps3',
    '라인 4': 'api_steps4',
    '라인 5': 'api_steps5',
}
STEP_COLUMNS = ['processid', 'stepseq', 'descript', 'recipeid', 'areaname', 'eqptype', 'updated', 'layerid']


def _write_if_changed(engine, table, line, df, key_cols, order_cols):
    """
    df 의 key_cols 집합이 table(해당 line)과 동일하면 쓰기를 건너뛰고 None 을 반환한다.
    다르면 트랜잭션 내에서 DELETE(line) → INSERT 후 저장 건수를 반환한다.
    (table/컬럼명은 코드 내부 상수만 전달되므로 SQL 인젝션 대상이 아니다.)
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT {', '.join(key_cols)} FROM {table} WHERE line = :line"),
            {"line": line}
        ).fetchall()
    old_keys = set(tuple(r) for r in rows)
    new_keys = set(df[key_cols].itertuples(index=False, name=None))
    if new_keys == old_keys:
        return None

    df = df.copy()
    df['line'] = line
    df['last_synced'] = pd.Timestamp.now()
    df = df[order_cols]
    with engine.begin() as db_conn:
        db_conn.execute(text(f"DELETE FROM {table} WHERE line = :line"), {"line": line})
        df.to_sql(table, db_conn, if_exists='append', index=False)
    return len(df)


def sync_rtdb_options():
    """
    RTDB(REST API) 를 MAIN 소스로 {{request.process_selection}}-{{request.partid_selection}} /
    {{request.partid_selection}}-{{request.process_id}} 데이터를 10 분 주기로 동기화한다.
    - 각 소스는 MAIN 이 예외(None)·빈 결과면 DCQ 로 fallback (DCQ 는 필요 시에만 지연 로그인)
    - 조회 결과가 기존 테이블과 동일하면 쓰기를 건너뛴다(변경 감지)
    - RTDB 토큰은 주기당 1회만 발급하여 두 소스·라인 반복에서 재사용한다.
    """
    engine = None
    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e), exc_info=True)
        return

    rtdb_token = rtdb_login_with_retry()
    if not rtdb_token:
        logger.warning(_("[scheduler] RTDB 로그인 실패 - DCQ fallback 으로 진행합니다"))

    # DCQ 는 fallback 이 실제로 필요할 때만 지연 로그인한다. (두 소스가 상태 공유)
    dcq_state = {'ready': False, 'id': None}

    def ensure_dcq():
        if dcq_state['ready']:
            return True
        if dcq_login_with_retry():
            dcq_id, _pw = get_dcq_credentials()
            if dcq_id:
                get_dcq_token_info(dcq_id)
                dcq_state['ready'] = True
                dcq_state['id'] = dcq_id
                return True
            logger.error(_("[scheduler] DCQ 계정 정보를 찾을 수 없습니다"))
        else:
            logger.error(_("[scheduler] DCQ 로그인 실패 - fallback 불가"))
        return False

    def fetch(rtdb_select, rtdb_filter, rtdb_table, suffix, dcq_query):
        """MAIN(RTDB) 우선 조회 → 예외/빈 결과 시 DCQ fallback. DataFrame 또는 None 반환."""
        df = None
        if rtdb_token:
            payload = {
                "query": {
                    "select": rtdb_select,
                    "table_name": rtdb_table.format(suffix=suffix),
                    "filter": rtdb_filter,
                },
                "target": RTDB_TARGET,
            }
            df = get_data_from_rtdb(payload, rtdb_token)
        if df is None or len(df) == 0:
            logger.warning(_("[scheduler] RTDB 조회 실패/빈 결과 - DCQ fallback 실행 (suffix={suffix})").format(suffix=suffix))
            if ensure_dcq():
                df = get_data_from_dcq(dcq_query, dcq_state['id'])
        return df

    try:
        for line in LINES:
            suffix = LINE_SUFFIX_MAP[line]

            # --- 공정-품목 (api_processproduct) ---
            try:
                dcq_cp = f"""
                    SELECT DISTINCT partnumber, descript, pkgtype_2
                    FROM A.B_{suffix}
                    WHERE X IS NOT NULL AND X != ''
                """
                df_cp = fetch(RTDB_PP_SELECT, RTDB_PP_FILTER, RTDB_PP_TABLE, suffix, dcq_cp)
                if df_cp is None or len(df_cp) == 0:
                    logger.warning(_("[scheduler] {line} {{request.process_selection}}-{{request.partid_selection}} 데이터가 없습니다").format(line=line))
                else:
                    df_cp = df_cp.rename(columns={'descript': 'process', 'partnumber': 'product_name'})
                    count = _write_if_changed(
                        engine, 'api_processproduct', line, df_cp,
                        ['process', 'product_name'],
                        ['line', 'process', 'product_name', 'last_synced'],
                    )
                    if count is None:
                        logger.info(_("[scheduler] {line} {{request.process_selection}}-{{request.partid_selection}} 변경 없음 - skip").format(line=line))
                    else:
                        logger.info(_("[scheduler] {line} {{request.process_selection}}-{{request.partid_selection}} {count}건 동기화 완료").format(line=line, count=count))
            except Exception as e:
                logger.error(_("[scheduler] {line} {{request.process_selection}}-{{request.partid_selection}} 동기화 실패: {e}").format(line=line, e=e), exc_info=True)

            # --- 품목-공정ID (api_productprocessid) ---
            try:
                dcq_pc = f"""
                    SELECT DISTINCT partnumber, processid
                    FROM A.B_{suffix}_processproduct
                """
                df_pc = fetch(RTDB_PC_SELECT, RTDB_PC_FILTER, RTDB_PC_TABLE, suffix, dcq_pc)
                if df_pc is None or len(df_pc) == 0:
                    logger.warning(_("[scheduler] {line} {{request.partid_selection}}-{{request.process_id}} 데이터가 없습니다").format(line=line))
                else:
                    df_pc = df_pc.rename(columns={'partnumber': 'product_name', 'processid': 'process_id'})
                    count = _write_if_changed(
                        engine, 'api_productprocessid', line, df_pc,
                        ['product_name', 'process_id'],
                        ['line', 'product_name', 'process_id', 'last_synced'],
                    )
                    if count is None:
                        logger.info(_("[scheduler] {line} {{request.partid_selection}}-{{request.process_id}} 변경 없음 - skip").format(line=line))
                    else:
                        logger.info(_("[scheduler] {line} {{request.partid_selection}}-{{request.process_id}} {count}건 동기화 완료").format(line=line, count=count))
            except Exception as e:
                logger.error(_("[scheduler] {line} {{request.partid_selection}}-{{request.process_id}} 동기화 실패: {e}").format(line=line, e=e), exc_info=True)

            # --- 스텝 (api_steps: 라인별 단독 테이블) ---
            try:
                dcq_ps = f"""
                    SELECT processid, stepseq, descript, recipeid, areaname, eqptype, updated, layerid
                    FROM A.B_{suffix}_step
                    WHERE X = 'Y'
                """
                df_ps = fetch(RTDB_STEP_SELECT, RTDB_STEP_FILTER, RTDB_STEP_TABLE, suffix, dcq_ps)
                if df_ps is None or len(df_ps) == 0:
                    logger.warning(_("[scheduler] {line} {{request.col_step}} 데이터가 없습니다").format(line=line))
                else:
                    table_name = STEP_TABLE_MAP.get(line)
                    if not table_name:
                        logger.warning(_("[scheduler] 알 수 없는 {{request.line}}: {line}").format(line=line))
                    else:
                        df_ps['last_synced'] = pd.Timestamp.now()
                        df_ps = df_ps[STEP_COLUMNS + ['last_synced']]
                        with engine.begin() as db_conn:
                            db_conn.execute(text(f"DELETE FROM {table_name}"))
                            df_ps.to_sql(table_name, db_conn, if_exists='append', index=False)
                        logger.info(_("[scheduler] {line} {{request.col_step}} {count}건 동기화 완료").format(line=line, count=len(df_ps)))
            except Exception as e:
                logger.error(_("[scheduler] {line} {{request.col_step}} 동기화 실패: {e}").format(line=line, e=e), exc_info=True)
    finally:
        if engine:
            engine.dispose()


def sync_form_options():
    """
    DCQ 를 사용하여 외부 DB 에서 바코드-품목 / MAP 이름 데이터를
    DataFrame 으로 가져와 Django DB 에 저장한다.
    (공정-품목·품목-공정ID·스텝은 RTDB MAIN + DCQ fallback 구조로 sync_rtdb_options 로 분리)
    """
    engine = None
    
    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e), exc_info=True)
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
            logger.error(_("[scheduler] 바코드-품목 동기화 실패: {e}").format(e=e), exc_info=True)

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
            logger.error(_("[scheduler] MAP 이름 동기화 실패: {e}").format(e=e), exc_info=True)

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
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e), exc_info=True)
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
        logger.error(_("[scheduler] 공휴일 동기화 실패: {e}").format(e=e), exc_info=True)
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
            sync_rtdb_options,
            trigger=IntervalTrigger(minutes=10),
            id='sync_rtdb_options',
            name='RTDB 폼 옵션 동기화(공정-품목/품목-공정ID)',
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

        # 구(舊) 단독 잡(process_product 전용)이 통합 잡으로 대체되어 남아있으면 제거한다.
        try:
            scheduler.remove_job('sync_process_product')
        except Exception:
            pass

        scheduler.start()
        logger.info(_("[scheduler] APScheduler 시작 - 1 시간 주기 DCQ 동기화 / 10 분 주기 RTDB 폼 옵션 / 매일 02:00 공휴일 동기화 등록"))

        threading.Thread(target=sync_form_options, daemon=True).start()
        threading.Thread(target=sync_rtdb_options, daemon=True).start()
        threading.Thread(target=sync_holidays, daemon=True).start()
    except ProgrammingError as e:
        logger.warning(_("[scheduler] 테이블이 아직 생성되지 않았습니다. 마이그레이션 후 재시작됩니다: {e}").format(e=e), exc_info=True)


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
        logger.warning(_("[scheduler] 테이블이 아직 생성되지 않았습니다. 마이그레이션 후 재시작됩니다: {e}").format(e=e), exc_info=True)
