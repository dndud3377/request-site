"""
⚠️ MASKING 처리된 파일

이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다.
원래 용어를 확인하려면 다음 파일을 참조하세요:
- frontend/src/locales/ko.json

"""
import os
import time
import logging
import pandas as pd
from sqlalchemy import text
from dotenv import load_dotenv
from django.utils.translation import gettext_lazy as _

from .utils import (
    ensure_dcq_session,
    get_django_engine,
    get_data_from_dcq,
    get_rtdb_token,
    get_data_from_rtdb,
    external_sync_lock,
    LINE_SUFFIX_MAP,
    LINE_TO_LINEID_MAP,
)

logger = logging.getLogger(__name__)
load_dotenv()

# nv 는 RTDB(MAIN)+DCQ(fallback) 구조를 그대로 쓰지만 스텝 테이블이 없다.
# (Line 마스터·프론트엔드 표기와 일치하도록 공백 없는 'nv' 로 저장한다.)
LINE_NV = 'nv'

LINES = ['라인1', '라인3', '라인4', '라인5', LINE_NV]

# 라인2 는 소스 테이블 구조가 달라 RTDB 를 쓰지 않고 DCQ 단독으로 동기화한다.
# (Line 마스터·프론트엔드 표기와 일치하도록 공백 없는 '라인2' 로 저장한다.)
LINE2 = '라인2'
# 숫자(정수·소수)로만 이루어진 값 판정용 정규식.
# 백슬래시가 Python·Impala 문자열 리터럴에서 이스케이프로 해석되지 않도록 `\.` 대신 `[.]` 를 쓴다.
LINE2_NUMERIC_ONLY_RE = "'^[0-9]+([.][0-9]*)?$|^[.][0-9]+$'"
# product_design_rule 을 공정명으로 쓸 수 없는 조건. 해당하면 product_desc 로 대체한다.
# CASE(그대로) 와 WHERE(NOT 부정형) 양쪽에서 재사용하여 두 곳의 판정 기준이 어긋나지 않게 한다.
LINE2_DR_UNUSABLE = (
    "product_design_rule IS NULL"
    " OR TRIM(product_design_rule) = ''"
    " OR TRIM(product_design_rule) = '-'"
    f" OR TRIM(product_design_rule) REGEXP {LINE2_NUMERIC_ONLY_RE}"
)
LINE2_PP_QUERY = f"""
    SELECT DISTINCT
        product_id,
        CASE
            WHEN {LINE2_DR_UNUSABLE}
            THEN product_desc
            ELSE product_design_rule
        END AS product_design_rule
    FROM M.L
    WHERE product_id IS NOT NULL AND product_id != ''
      AND (
            NOT ({LINE2_DR_UNUSABLE})
         OR (product_desc IS NOT NULL AND TRIM(product_desc) != '')
      )
"""
LINE2_PC_QUERY = """
    SELECT DISTINCT product_id, process_id
    FROM M.L
    WHERE product_id IS NOT NULL AND product_id != ''
      AND process_id IS NOT NULL AND process_id != ''
"""

# sync_form_options() 가 다루는 데이터 종류. DCQ 로그인 자체가 실패하면 이 4개 전부를
# 실패로 기록한다(mailer.enqueue_dcq_sync_failed 대상). context 는 라인 개념이 없으면 '-'.
FORM_OPTIONS_TARGETS = [
    {'context': '-', 'target': '바코드-품목'},
    {'context': '-', 'target': 'MAP 이름'},
    {'context': LINE2, 'target': '공정-품목'},
    {'context': LINE2, 'target': '품목-공정ID'},
]

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
    '라인1': 'api_teps1',
    '라인3': 'api_steps3',
    '라인4': 'api_steps4',
    '라인5': 'api_steps5',
}
STEP_COLUMNS = ['processid', 'stepseq', 'descript', 'recipeid', 'areaname', 'eqptype', 'updated', 'layerid']

# RTDB(MAIN) 조회 실패/빈 결과 시 실패 목록에 남길 데이터 종류 라벨.
# (2026-08부터 DCQ fallback 대신 실패 목록을 모아 알림 메일로 보낸다 - mailer.enqueue_rtdb_sync_failed)
TARGET_LABEL_PP = "{{request.process_selection}}-{{request.partid_selection}}"
TARGET_LABEL_PC = "{{request.partid_selection}}-{{request.process_id}}"
TARGET_LABEL_STEP = "{{request.col_step}}"

# RTDB 조회가 0건/실패일 때 재시도 횟수와 재시도 간격(초). (2026-08 추가 - 불규칙한 RTDB 조회
# 실패 대응) get_data_from_rtdb() 는 예외도 내부에서 잡아 None 으로 통일해 반환하므로, 여기서는
# "결과가 None 이거나 0건"이라는 단일 조건으로 예외·빈 결과를 함께 재시도 대상으로 다룬다.
RTDB_FETCH_MAX_RETRIES = 3
RTDB_FETCH_RETRY_DELAY_SEC = 5

# 스텝(col_step) 조회 직전 대기 시간(초). RTDB 쪽 데이터 갱신이 늦게 반영되는 경우를 대비해
# 조회 전 잠깐 대기한다. (2026-08 추가)
RTDB_STEP_PRE_FETCH_DELAY_SEC = 3


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


def _send_sync_failure_alert(mailer_func_name, failures):
    """동기화 실패 알림 메일 적재 (RTDB/DCQ 공통 진입점).

    failures 가 비어 있으면 아무 것도 하지 않는다. 메일 적재 자체가 실패해도
    그 때문에 동기화 잡이 죽지 않도록 예외를 여기서 잡아 로그만 남긴다.
    """
    if not failures:
        return
    try:
        from . import mailer
        getattr(mailer, mailer_func_name)(failures)
    except Exception as e:
        logger.error(_("[scheduler] 동기화 실패 알림 메일 적재 실패: {e}").format(e=e), exc_info=True)


def sync_rtdb_options():
    """
    RTDB(REST API) 로 {{request.process_selection}}-{{request.partid_selection}} /
    {{request.partid_selection}}-{{request.process_id}} 데이터를 10 분 주기로 동기화한다.
    - RTDB 조회가 0건이거나 실패(예외)이면 `RTDB_FETCH_RETRY_DELAY_SEC`(5초) 대기 후 재조회하며,
      `RTDB_FETCH_MAX_RETRIES`(3회)까지 반복한다. 그래도 실패하면 그 데이터는 이번 주기에
      동기화하지 않고 실패로 기록한다(2026-08 추가 - 불규칙한 RTDB 조회 실패 대응).
      (DCQ fallback 은 쓰지 않는다 - 실패 목록을 모아 사이클 종료 시
      `mailer.enqueue_rtdb_sync_failed()` 로 알림 메일 1통을 큐에 적재한다. 수신자는
      `.env` 의 `RTDB_SYNC_ALERT_MAIL`. RTDB 장애가 이어지는 동안은 10 분 주기마다 매번 발송된다.)
    - 스텝(col_step) 조회 직전에는 `RTDB_STEP_PRE_FETCH_DELAY_SEC`(3초) 대기한다 - RTDB 쪽 데이터
      갱신이 늦게 반영되는 경우를 대비한다(2026-08 추가).
    - 조회 결과가 기존 테이블과 동일하면 쓰기를 건너뛴다(변경 감지). 다르면 DELETE(line) → INSERT로
      전체 재적재한다 - 항상 RTDB 응답을 현재 상태의 원본으로 취급해, 원본에서 실제로 빠진(단종 등)
      데이터가 남아있지 않도록 한다(2026-08: "없는 것만 추가"하는 diff 병합 방식을 시도했다가,
      실제로 없어진 데이터까지 계속 남아있게 되는 문제가 있어 다시 이 방식으로 되돌렸다).
    - RTDB 토큰은 주기당 1회만 `utils.get_rtdb_token()`으로 받아 소스·라인 반복에서 재사용한다.
      (2026-08부터 매 주기 풀 로그인 대신, 캐시된 refresh_token 이 유효하면 가벼운 refresh API로
      갱신한다. refresh_token 유효기간이 얼마 안 남았거나 refresh 자체가 실패하면 풀 로그인으로
      폴백해 access_token·refresh_token 을 모두 새로 받는다. 상세는 `utils.get_rtdb_token()` 참고.)
    - DCQ 동기화(sync_form_options/sync_holidays/sync_design_rule)와 겹쳐 돌지 않도록
      `utils.external_sync_lock()` 으로 감싼다(2026-08 추가).
    """
    engine = None
    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e), exc_info=True)
        return

    with external_sync_lock():
        rtdb_token = get_rtdb_token()
        if not rtdb_token:
            logger.warning(_("[scheduler] RTDB 로그인/토큰 갱신 실패 - 이번 주기 동기화를 건너뜁니다"))

        # 이번 사이클에서 RTDB 조회가 (재시도 후에도) 실패/빈 결과였던 (context=line, target) 목록.
        # 사이클 종료 시 하나라도 있으면 알림 메일 1통으로 모아 보낸다.
        failures = []

        def fetch(rtdb_select, rtdb_filter, rtdb_table, suffix, line, target_label):
            """RTDB 조회. 0건/실패면 최대 RTDB_FETCH_MAX_RETRIES 회까지 RTDB_FETCH_RETRY_DELAY_SEC
            초 간격으로 재시도한다. 그래도 실패하면 None 을 반환하고 실패 목록에 기록한다
            (DCQ fallback 없음). get_data_from_rtdb() 는 예외도 내부에서 잡아 None 으로 통일해
            반환하므로, 여기서는 "None 이거나 0건"이라는 단일 조건으로 재시도를 판단한다.
            """
            for attempt in range(1, RTDB_FETCH_MAX_RETRIES + 1):
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
                if df is not None and len(df) > 0:
                    return df
                if attempt < RTDB_FETCH_MAX_RETRIES:
                    logger.warning(
                        _("[scheduler] RTDB 조회 실패/빈 결과 - {delay}초 후 재시도 "
                          "({attempt}/{max_retries}회, line={line}, target={target})")
                        .format(delay=RTDB_FETCH_RETRY_DELAY_SEC, attempt=attempt,
                                max_retries=RTDB_FETCH_MAX_RETRIES, line=line, target=target_label)
                    )
                    time.sleep(RTDB_FETCH_RETRY_DELAY_SEC)
            logger.warning(
                _("[scheduler] RTDB 조회 실패/빈 결과 - {max_retries}회 재시도 후에도 실패 "
                  "(line={line}, target={target})")
                .format(max_retries=RTDB_FETCH_MAX_RETRIES, line=line, target=target_label)
            )
            failures.append({'context': line, 'target': target_label})
            return None

        try:
            for line in LINES:
                suffix = LINE_SUFFIX_MAP[line]

                # --- 공정-품목 (api_processproduct) ---
                try:
                    df_cp = fetch(RTDB_PP_SELECT, RTDB_PP_FILTER, RTDB_PP_TABLE, suffix, line, TARGET_LABEL_PP)
                    if df_cp is not None:
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
                    df_pc = fetch(RTDB_PC_SELECT, RTDB_PC_FILTER, RTDB_PC_TABLE, suffix, line, TARGET_LABEL_PC)
                    if df_pc is not None:
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
                # 스텝 테이블이 없는 라인(nv)은 조회 자체를 건너뛴다(실패로 기록하지 않는다).
                table_name = STEP_TABLE_MAP.get(line)
                if not table_name:
                    logger.info(_("[scheduler] {line} {{request.col_step}} 테이블 없음 - skip").format(line=line))
                else:
                    try:
                        # RTDB 쪽 스텝 데이터 갱신이 늦게 반영되는 경우를 대비해 조회 전 잠깐 대기한다.
                        time.sleep(RTDB_STEP_PRE_FETCH_DELAY_SEC)
                        df_ps = fetch(RTDB_STEP_SELECT, RTDB_STEP_FILTER, RTDB_STEP_TABLE, suffix, line, TARGET_LABEL_STEP)
                        if df_ps is not None:
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

        _send_sync_failure_alert('enqueue_rtdb_sync_failed', failures)


def sync_form_options():
    """
    DCQ 를 사용하여 외부 DB 에서 바코드-품목 / MAP 이름 데이터와
    라인2 의 공정-품목 / 품목-공정ID 데이터를 DataFrame 으로 가져와 Django DB 에 저장한다.
    (라인1·3~5 의 공정-품목·품목-공정ID·스텝은 RTDB MAIN + DCQ fallback 구조로 sync_rtdb_options 로 분리.
     라인2 는 소스 테이블이 달라 RTDB 를 지원하지 않으므로 DCQ 단독으로 여기서 처리한다.)
    - 4개 데이터(바코드-품목/MAP 이름/라인2 공정-품목/라인2 품목-공정ID) 중 예외이거나 빈 결과인
      항목은 실패로 기록하고, 함수 종료 시 하나라도 있으면 `mailer.enqueue_dcq_sync_failed()`
      로 알림 메일 1통을 큐에 적재한다(수신자는 RTDB 와 동일하게 `.env` 의 `RTDB_SYNC_ALERT_MAIL`).
      DCQ 로그인 자체가 실패하면 `FORM_OPTIONS_TARGETS` 4개 전부를 실패로 기록한다.
    """
    engine = None

    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e), exc_info=True)
        return

    with external_sync_lock():
        dcq_id = ensure_dcq_session()
        if not dcq_id:
            _send_sync_failure_alert('enqueue_dcq_sync_failed', FORM_OPTIONS_TARGETS)
            logger.error(_("[scheduler] DCQ 세션 확보 실패로 인해 작업을 중단합니다"))
            return

        failures = []

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
                    failures.append({'context': '-', 'target': '바코드-품목'})
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
                failures.append({'context': '-', 'target': '바코드-품목'})

            try:
                lineid_list = list(LINE_TO_LINEID_MAP.values())
                placeholders = ' OR '.join([f"lineid = '{lid}'" for lid in lineid_list])
                query_mn = f"""
                    SELECT DISTINCT lineid, partid, AAA1, AAA2, AAA3
                    FROM X.Y
                    WHERE ({placeholders})
                      AND partid IS NOT NULL AND partid != ''
                """
                df_mn = get_data_from_dcq(query_mn, dcq_id)

                if df_mn is None or len(df_mn) == 0:
                    logger.warning(_("[scheduler] MAP 이름 데이터가 없습니다"))
                    failures.append({'context': '-', 'target': 'MAP 이름'})
                else:
                    df_mn['last_synced'] = pd.Timestamp.now()
                    df_mn = df_mn[['lineid', 'partid', 'AAA1', 'AAA2', 'AAA3', 'last_synced']]

                    with engine.begin() as db_conn:
                        db_conn.execute(text("DELETE FROM api_mapname"))
                        df_mn.to_sql('api_mapname', db_conn, if_exists='append', index=False)

                    logger.info(_("[scheduler] MAP 이름 {count}건 동기화 완료").format(count=len(df_mn)))
            except Exception as e:
                logger.error(_("[scheduler] MAP 이름 동기화 실패: {e}").format(e=e), exc_info=True)
                failures.append({'context': '-', 'target': 'MAP 이름'})

            # --- 라인2 공정-품목 (api_processproduct) ---
            try:
                df_l2_cp = get_data_from_dcq(LINE2_PP_QUERY, dcq_id)

                if df_l2_cp is None or len(df_l2_cp) == 0:
                    logger.warning(_("[scheduler] {line} 공정-품목 데이터가 없습니다").format(line=LINE2))
                    failures.append({'context': LINE2, 'target': '공정-품목'})
                else:
                    df_l2_cp = df_l2_cp.rename(
                        columns={'product_design_rule': 'process', 'product_id': 'product_name'}
                    )
                    count = _write_if_changed(
                        engine, 'api_processproduct', LINE2, df_l2_cp,
                        ['process', 'product_name'],
                        ['line', 'process', 'product_name', 'last_synced'],
                    )
                    if count is None:
                        logger.info(_("[scheduler] {line} 공정-품목 변경 없음 - skip").format(line=LINE2))
                    else:
                        logger.info(_("[scheduler] {line} 공정-품목 {count}건 동기화 완료").format(line=LINE2, count=count))
            except Exception as e:
                logger.error(_("[scheduler] {line} 공정-품목 동기화 실패: {e}").format(line=LINE2, e=e), exc_info=True)
                failures.append({'context': LINE2, 'target': '공정-품목'})

            # --- 라인2 품목-공정ID (api_productprocessid) ---
            try:
                df_l2_pc = get_data_from_dcq(LINE2_PC_QUERY, dcq_id)

                if df_l2_pc is None or len(df_l2_pc) == 0:
                    logger.warning(_("[scheduler] {line} 품목-공정ID 데이터가 없습니다").format(line=LINE2))
                    failures.append({'context': LINE2, 'target': '품목-공정ID'})
                else:
                    df_l2_pc = df_l2_pc.rename(columns={'product_id': 'product_name'})
                    count = _write_if_changed(
                        engine, 'api_productprocessid', LINE2, df_l2_pc,
                        ['product_name', 'process_id'],
                        ['line', 'product_name', 'process_id', 'last_synced'],
                    )
                    if count is None:
                        logger.info(_("[scheduler] {line} 품목-공정ID 변경 없음 - skip").format(line=LINE2))
                    else:
                        logger.info(_("[scheduler] {line} 품목-공정ID {count}건 동기화 완료").format(line=LINE2, count=count))
            except Exception as e:
                logger.error(_("[scheduler] {line} 품목-공정ID 동기화 실패: {e}").format(line=LINE2, e=e), exc_info=True)
                failures.append({'context': LINE2, 'target': '품목-공정ID'})

        finally:
            if engine:
                engine.dispose()

        _send_sync_failure_alert('enqueue_dcq_sync_failed', failures)


def sync_holidays():
    """
    DCQ 에서 대한민국 공휴일 데이터를 가져와 api_holiday 테이블에 저장
    - 로그인 실패/계정 조회 실패/조회 예외/빈 결과 모두 실패로 기록하고
      `mailer.enqueue_dcq_sync_failed()` 로 알림 메일을 큐에 적재한다.
      (알림 적재는 항상 그 아래의 `_(...)` 로그 호출보다 먼저 실행한다.)
    """
    engine = None
    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e), exc_info=True)
        return

    with external_sync_lock():
        dcq_id = ensure_dcq_session()
        if not dcq_id:
            _send_sync_failure_alert('enqueue_dcq_sync_failed', [{'context': '-', 'target': '공휴일'}])
            logger.error(_("[scheduler] DCQ 세션 확보 실패로 인해 공휴일 동기화를 중단합니다"))
            return

        try:
            query = """
                SELECT DISTINCT date_name, isholiday, act_date
                FROM A.B
            """
            df = get_data_from_dcq(query, dcq_id)

            if df is None or len(df) == 0:
                _send_sync_failure_alert('enqueue_dcq_sync_failed', [{'context': '-', 'target': '공휴일'}])
                logger.warning(_("[scheduler] 공휴일 데이터가 없습니다"))
                return

            df = df[df['isholiday'] == 'Y'].copy()
            df['act_date'] = pd.to_datetime(df['act_date'], errors='coerce').dt.date
            # act_date 는 UNIQUE 제약이므로 같은 날짜 중복 행(예: 성탄절/기독탄신일)은 한 건만 남긴다.
            # 변환 실패(NaT)로 생긴 결측 날짜 행도 제거한다.
            df = df[df['act_date'].notna()]
            df = df.drop_duplicates(subset=['act_date'], keep='first')

            with engine.begin() as db_conn:
                db_conn.execute(text("DELETE FROM api_holiday"))
                df[['date_name', 'isholiday', 'act_date']].to_sql(
                    'api_holiday', db_conn, if_exists='append', index=False
                )

            logger.info(_("[scheduler] 공휴일 {count}건 동기화 완료").format(count=len(df)))
        except Exception as e:
            _send_sync_failure_alert('enqueue_dcq_sync_failed', [{'context': '-', 'target': '공휴일'}])
            logger.error(_("[scheduler] 공휴일 동기화 실패: {e}").format(e=e), exc_info=True)
        finally:
            if engine:
                engine.dispose()


def sync_design_rule():
    """
    DCQ 에서 공정-디자인룰 매핑 데이터를 매일 1회 가져와 api_designrule 테이블에 저장
    - 로그인 실패/계정 조회 실패/조회 예외/빈 결과 모두 실패로 기록하고
      `mailer.enqueue_dcq_sync_failed()` 로 알림 메일을 큐에 적재한다.
    """
    engine = None
    try:
        engine = get_django_engine()
    except Exception as e:
        logger.error(_("[scheduler] Django DB 엔진 생성 실패: {e}").format(e=e), exc_info=True)
        return

    with external_sync_lock():
        dcq_id = ensure_dcq_session()
        if not dcq_id:
            _send_sync_failure_alert('enqueue_dcq_sync_failed', [{'context': '-', 'target': '공정-디자인룰'}])
            logger.error(_("[scheduler] DCQ 세션 확보 실패로 인해 공정-디자인룰 동기화를 중단합니다"))
            return

        try:
            query = """
                SELECT DISTINCT n7process, n7design_rule
                FROM S.M
                WHERE n7use_yn = 'Y'
                  AND n7process IS NOT NULL AND n7process != ''
                  AND n7design_rule IS NOT NULL AND n7design_rule != ''
            """
            df = get_data_from_dcq(query, dcq_id)

            if df is None or len(df) == 0:
                _send_sync_failure_alert('enqueue_dcq_sync_failed', [{'context': '-', 'target': '공정-디자인룰'}])
                logger.warning(_("[scheduler] 공정-디자인룰 데이터가 없습니다"))
                return

            df = df.rename(columns={'n7process': 'process', 'n7design_rule': 'design_rule'})
            df['last_synced'] = pd.Timestamp.now()
            df = df[['process', 'design_rule', 'last_synced']]

            with engine.begin() as db_conn:
                db_conn.execute(text("DELETE FROM api_designrule"))
                df.to_sql('api_designrule', db_conn, if_exists='append', index=False)

            logger.info(_("[scheduler] 공정-디자인룰 {count}건 동기화 완료").format(count=len(df)))
        except Exception as e:
            _send_sync_failure_alert('enqueue_dcq_sync_failed', [{'context': '-', 'target': '공정-디자인룰'}])
            logger.error(_("[scheduler] 공정-디자인룰 동기화 실패: {e}").format(e=e), exc_info=True)
        finally:
            if engine:
                engine.dispose()


# start_mail_only()(SKIP_SCHEDULER=true, 예: 개발)에서는 add_job 하지 않는 무거운 외부 동기화
# 잡 ID. DjangoJobStore 는 DB(django_apscheduler_djangojob 테이블)에 저장된 잡을 연결 시 그대로
# 복원하므로, 이 잡들이 (예: db-sync 로 운영 잡 상태가 dev DB 에 유입되는 등) DB 에 남아있으면
# add_job 을 호출하지 않아도 그대로 실행될 수 있다. start_mail_only() 는 스케줄러를 시작하기 전에
# 이 ID 들을 `DjangoJob` ORM 으로 직접 지워 이를 막는다(이유는 start_mail_only() 자체 docstring 참고).
HEAVY_SYNC_JOB_IDS = [
    'sync_form_options', 'sync_rtdb_options', 'sync_holidays', 'sync_design_rule',
    'check_map_completion_mail',
]


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
            max_instances=1,
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
            max_instances=1,
        )

        scheduler.add_job(
            sync_design_rule,
            trigger=CronTrigger(hour=2, minute=0),
            id='sync_design_rule',
            name='공정-디자인룰 동기화',
            replace_existing=True,
            max_instances=1,
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

        from .pop3_mail import check_map_completion_mail
        scheduler.add_job(
            check_map_completion_mail,
            trigger=IntervalTrigger(minutes=10),
            id='check_map_completion_mail',
            name='POP3 완료 알림 메일 → MAP 목적 NEW 매칭',
            replace_existing=True,
            max_instances=1,
        )

        # 구(舊) 단독 잡(process_product 전용)이 통합 잡으로 대체되어 남아있으면 제거한다.
        try:
            scheduler.remove_job('sync_process_product')
        except Exception:
            pass

        scheduler.start()
        logger.info(_("[scheduler] APScheduler 시작 - 1 시간 주기 DCQ 동기화 / 10 분 주기 RTDB 폼 옵션 / 10 분 주기 POP3 완료 메일 매칭 / 매일 02:00 공휴일·공정-디자인룰 동기화 등록"))

        def _run_dcq_jobs_sequentially():
            # sync_form_options/sync_holidays/sync_design_rule 는 모두 DCQ 를 사용한다.
            # external_sync_lock() 이 DCQ-DCQ, DCQ-RTDB 세션 겹침을 막아주지만, 4 개 daemon
            # 스레드가 기동 시 동시에 시작되는 것 자체를 없애기 위해 하나의 스레드에서 순차 실행한다.
            sync_form_options()
            sync_holidays()
            sync_design_rule()

        threading.Thread(target=_run_dcq_jobs_sequentially, daemon=True).start()
        threading.Thread(target=sync_rtdb_options, daemon=True).start()
    except ProgrammingError as e:
        logger.warning(_("[scheduler] 테이블이 아직 생성되지 않았습니다. 마이그레이션 후 재시작됩니다: {e}").format(e=e), exc_info=True)


def start_mail_only():
    """무거운 DCQ 동기화를 건너뛰는 환경(SKIP_SCHEDULER=true, 예: 개발)에서도
    외부 DB 가 필요 없는 결재 알림 메일 큐 발송 잡만 단독으로 실행한다.

    DjangoJobStore 는 DB 에 저장된 잡을 연결 시 그대로 복원한다 - add_job 을 호출하지 않은
    HEAVY_SYNC_JOB_IDS 잡도 DB 에 남아있으면(예: db-sync 로 운영 잡 상태가 dev DB 로 유입된
    경우) 그대로 실행될 수 있다. 이를 막기 위해 스케줄러를 만들기 전에 해당 잡 행을
    `DjangoJob` ORM 으로 직접 지운다.

    ⚠️ `scheduler.remove_job()`(APScheduler API)이 아니라 ORM 삭제를 쓰는 이유: `remove_job()`
    은 스케줄러 `state`가 STOPPED(= `scheduler.start()` 호출 전)이면 이 잡스토어의 잡을 실제로
    지우지 않고 이 스케줄러 인스턴스의 `_pending_jobs`(이번 호출에서 `add_job`한 잡)만 뒤진다
    (`apscheduler/schedulers/base.py`의 `remove_job()`). DB 에서 상속된 잡은 `_pending_jobs`에
    없으므로 `JobLookupError`만 나고 조용히 무시되어 **아무 것도 지워지지 않는다** - 실제로
    이 방식으로 먼저 구현했다가 재현 테스트로 잡히지 않는 것을 확인하고 ORM 삭제로 바꿨다.
    """
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    from django_apscheduler.jobstores import DjangoJobStore
    from django_apscheduler.models import DjangoJob
    from django.db.utils import ProgrammingError

    scheduler = BackgroundScheduler(timezone='Asia/Seoul')

    try:
        stale_jobs = DjangoJob.objects.filter(id__in=HEAVY_SYNC_JOB_IDS)
        stale_ids = list(stale_jobs.values_list('id', flat=True))
        if stale_ids:
            stale_jobs.delete()
            logger.warning(
                _("[scheduler] SKIP_SCHEDULER=true 인데 잡스토어에 남아있던 무거운 동기화 잡을 "
                  "제거했습니다: {job_ids} (db-sync 등으로 외부 잡 상태가 유입되었을 수 있습니다)")
                .format(job_ids=', '.join(stale_ids))
            )

        scheduler.add_jobstore(DjangoJobStore(), 'default')

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
