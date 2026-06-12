"""결재 알림 메일 큐를 1회 발송 처리하는 커맨드

스케줄러가 비활성(SKIP_SCHEDULER=true)인 개발 환경에서 수동으로
큐를 비우거나 발송을 검증할 때 사용한다.

Usage:
    python manage.py process_mail_queue
"""
from django.core.management.base import BaseCommand

from api.mailer import process_mail_queue
from api.models import MailNotification


class Command(BaseCommand):
    help = '결재 알림 메일 큐(pending)를 발송 처리합니다.'

    def handle(self, *args, **options):
        before = MailNotification.objects.filter(status='pending').count()
        self.stdout.write(f'pending 메일 {before}건 발송을 시도합니다...')
        process_mail_queue()
        sent = MailNotification.objects.filter(status='sent').count()
        failed = MailNotification.objects.filter(status='failed').count()
        remaining = MailNotification.objects.filter(status='pending').count()
        self.stdout.write(
            self.style.SUCCESS(
                f'완료: 발송 {sent}건 / 실패 {failed}건 / 대기 {remaining}건'
            )
        )
