"""스케줄러를 단일 프로세스로 상시 실행하는 커맨드.

gunicorn 다중 워커 환경에서는 각 워커가 스케줄러를 중복 기동하여
같은 DjangoJobStore 의 job 을 서로 탈취(`... no longer exists`)하고
메일 큐가 이중 발송될 수 있다. 이를 막기 위해 스케줄러는 이 커맨드로 띄우는
**전용 단일 프로세스(docker-compose 의 `scheduler` 서비스)** 에서만 실행한다.
(`apps.py` 는 더 이상 스케줄러를 자동 기동하지 않는다.)

SKIP_SCHEDULER=true 이면 무거운 DCQ/RTDB 동기화는 건너뛰고 메일 큐 발송만 실행한다.

Usage:
    python manage.py run_scheduler
"""
import os
import signal
import threading

from django.core.management.base import BaseCommand

from api import scheduler


class Command(BaseCommand):
    help = '스케줄러를 단일 프로세스로 상시 실행합니다.'

    def handle(self, *args, **options):
        stop_event = threading.Event()

        def _graceful(signum, frame):
            self.stdout.write(f'종료 신호({signum}) 수신 - 스케줄러 프로세스를 종료합니다.')
            stop_event.set()

        signal.signal(signal.SIGTERM, _graceful)
        signal.signal(signal.SIGINT, _graceful)

        if os.environ.get('SKIP_SCHEDULER') == 'true':
            self.stdout.write('SKIP_SCHEDULER=true - 메일 큐 발송 스케줄러만 실행합니다.')
            scheduler.start_mail_only()
        else:
            self.stdout.write('전체 동기화 + 메일 스케줄러를 실행합니다.')
            scheduler.start()

        # BackgroundScheduler 는 별도 스레드에서 동작하므로,
        # 종료 신호가 올 때까지 메인 스레드를 살려 프로세스를 유지한다.
        stop_event.wait()
