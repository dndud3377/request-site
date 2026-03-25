import os
import logging
import pymysql
from django.apps import apps

logger = logging.getLogger(__name__)

LINES = ['라인1', '라인2', '라인3', '라인4', '라인5']


def _get_external_connection():
    return pymysql.connect(
        host=os.environ.get('EXTERNAL_DB_HOST', ''),
        port=int(os.environ.get('EXTERNAL_DB_PORT', '3306')),
        user=os.environ.get('EXTERNAL_DB_USER', ''),
        password=os.environ.get('EXTERNAL_DB_PASSWORD', ''),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
    )


def sync_form_options():
    """외부 DB에서 조합법-제품이름 / 제품이름-조리법 데이터를 가져와 캐시에 저장"""
    CombinationProduct = apps.get_model('api', 'CombinationProduct')
    ProductCooking = apps.get_model('api', 'ProductCooking')

    try:
        conn = _get_external_connection()
    except Exception as e:
        logger.error(f"[scheduler] 외부 DB 연결 실패: {e}")
        return

    try:
        with conn.cursor() as cursor:
            for line in LINES:
                # --- 조합법-제품이름 ---
                try:
                    cursor.execute(f"SELECT * FROM `{line}`.`조합법_제품이름`")
                    rows_cp = cursor.fetchall()
                    CombinationProduct.objects.filter(line=line).delete()
                    CombinationProduct.objects.bulk_create([
                        CombinationProduct(
                            line=line,
                            combination=row['조합법'],
                            product_name=row['제품이름'],
                        )
                        for row in rows_cp
                    ], batch_size=500)
                    logger.info(f"[scheduler] {line} 조합법-제품이름 {len(rows_cp)}건 동기화 완료")
                except Exception as e:
                    logger.error(f"[scheduler] {line} 조합법-제품이름 동기화 실패: {e}")

                # --- 제품이름-조리법 ---
                try:
                    cursor.execute(f"SELECT * FROM `{line}`.`제품이름_조리법`")
                    rows_pc = cursor.fetchall()
                    ProductCooking.objects.filter(line=line).delete()
                    ProductCooking.objects.bulk_create([
                        ProductCooking(
                            line=line,
                            product_name=row['제품이름'],
                            cooking_method=row['조리법'],
                        )
                        for row in rows_pc
                    ], batch_size=500)
                    logger.info(f"[scheduler] {line} 제품이름-조리법 {len(rows_pc)}건 동기화 완료")
                except Exception as e:
                    logger.error(f"[scheduler] {line} 제품이름-조리법 동기화 실패: {e}")

    finally:
        conn.close()


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
