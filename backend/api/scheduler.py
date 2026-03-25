import os
import logging
import pymysql
import pandas as pd
from sqlalchemy import create_engine, text

logger = logging.getLogger(__name__)

LINES = ['라인1', '라인2', '라인3', '라인4', '라인5']


def _get_external_connection():
    return pymysql.connect(
        host=os.environ.get('EXTERNAL_DB_HOST', ''),
        port=int(os.environ.get('EXTERNAL_DB_PORT', '3306')),
        user=os.environ.get('EXTERNAL_DB_USER', ''),
        password=os.environ.get('EXTERNAL_DB_PASSWORD', ''),
        charset='utf8mb4',
    )


def _get_django_engine():
    user = os.environ.get('MYSQL_USER', 'requestuser')
    password = os.environ.get('MYSQL_PASSWORD', 'requestpass')
    host = os.environ.get('MYSQL_HOST', 'db')
    port = os.environ.get('MYSQL_PORT', '3306')
    db = os.environ.get('MYSQL_DB', 'requestdb')
    return create_engine(f"mysql+pymysql://{user}:{password}@{host}:{port}/{db}")


def sync_form_options():
    """외부 DB에서 조합법-제품이름 / 제품이름-조리법 데이터를 DataFrame으로 가져와 캐시에 저장"""
    try:
        ext_conn = _get_external_connection()
    except Exception as e:
        logger.error(f"[scheduler] 외부 DB 연결 실패: {e}")
        return

    try:
        engine = _get_django_engine()
    except Exception as e:
        logger.error(f"[scheduler] Django DB 엔진 생성 실패: {e}")
        ext_conn.close()
        return

    try:
        for line in LINES:
            # --- 조합법-제품이름 ---
            try:
                df_cp = pd.read_sql(
                    f"SELECT * FROM `{line}`.`조합법_제품이름`",
                    ext_conn
                )
                df_cp = df_cp.rename(columns={'조합법': 'combination', '제품이름': 'product_name'})
                df_cp['line'] = line
                df_cp['last_synced'] = pd.Timestamp.now()
                df_cp = df_cp[['line', 'combination', 'product_name', 'last_synced']]

                with engine.begin() as db_conn:
                    db_conn.execute(
                        text("DELETE FROM api_combinationproduct WHERE line = :line"),
                        {"line": line}
                    )
                    df_cp.to_sql('api_combinationproduct', db_conn, if_exists='append', index=False)

                logger.info(f"[scheduler] {line} 조합법-제품이름 {len(df_cp)}건 동기화 완료")
            except Exception as e:
                logger.error(f"[scheduler] {line} 조합법-제품이름 동기화 실패: {e}")

            # --- 제품이름-조리법 ---
            try:
                df_pc = pd.read_sql(
                    f"SELECT * FROM `{line}`.`제품이름_조리법`",
                    ext_conn
                )
                df_pc = df_pc.rename(columns={'제품이름': 'product_name', '조리법': 'cooking_method'})
                df_pc['line'] = line
                df_pc['last_synced'] = pd.Timestamp.now()
                df_pc = df_pc[['line', 'product_name', 'cooking_method', 'last_synced']]

                with engine.begin() as db_conn:
                    db_conn.execute(
                        text("DELETE FROM api_productcooking WHERE line = :line"),
                        {"line": line}
                    )
                    df_pc.to_sql('api_productcooking', db_conn, if_exists='append', index=False)

                logger.info(f"[scheduler] {line} 제품이름-조리법 {len(df_pc)}건 동기화 완료")
            except Exception as e:
                logger.error(f"[scheduler] {line} 제품이름-조리법 동기화 실패: {e}")

    finally:
        ext_conn.close()
        engine.dispose()


def start():
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    from django_apscheduler.jobstores import DjangoJobStore

    scheduler = BackgroundScheduler(timezone='Asia/Seoul')
    scheduler.add_jobstore(DjangoJobStore(), 'default')

    scheduler.add_job(
        sync_form_options,
        trigger=IntervalTrigger(hours=1),
        id='sync_form_options',
        name='외부 DB 폼 옵션 동기화',
        replace_existing=True,
    )

    scheduler.start()
    logger.info("[scheduler] APScheduler 시작 - 1시간 주기 동기화 등록")

    # 시작 시 즉시 1회 실행
    sync_form_options()
