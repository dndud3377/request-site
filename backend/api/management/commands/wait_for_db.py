"""
DB 가 연결 가능할 때까지 대기하는 management command

Docker Compose 로 컨테이너 시작 시, DB 가 완전히 시작될 때까지 대기한 후
migration 이 실행되도록 합니다.

Usage:
    python manage.py wait_for_db
"""
import time
from django.db import connections
from django.db.utils import OperationalError
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'DB 가 연결 가능할 때까지 대기합니다.'

    def handle(self, *args, **options):
        self.stdout.write('DB 연결을 대기 중입니다...', ending='')
        
        max_retries = 30
        retry_delay = 2  # seconds
        
        for i in range(max_retries):
            try:
                conn = connections['default']
                conn.cursor()
                self.stdout.write(self.style.SUCCESS('연결됨!'))
                return
            except OperationalError as e:
                self.stdout.write('.', ending='')
                self.stdout.flush()
                time.sleep(retry_delay)
        
        self.stdout.write()
        self.stdout.write(
            self.style.ERROR(f'{max_retries * retry_delay}초 내에 DB 에 연결할 수 없습니다.')
        )
        raise OperationalError('DB 연결 실패')
