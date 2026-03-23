"""
라인 마스터 데이터 시드 커맨드
프론트엔드 OPTION_LINE 상수와 동일한 초기 데이터 생성

Usage:
    python manage.py seed_lines
"""
from django.core.management.base import BaseCommand
from api.models import Line

LINES = [
    {'name': 'A라인', 'order': 1},
    {'name': 'B라인', 'order': 2},
    {'name': 'C라인', 'order': 3},
]


class Command(BaseCommand):
    help = '라인 마스터 초기 데이터를 생성합니다.'

    def handle(self, *args, **options):
        created = 0
        updated = 0
        for item in LINES:
            line, is_new = Line.objects.get_or_create(name=item['name'])
            line.order = item['order']
            line.is_active = True
            line.save()
            if is_new:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"  생성: {item['name']}"))
            else:
                updated += 1
                self.stdout.write(f"  업데이트: {item['name']}")
        self.stdout.write(
            self.style.SUCCESS(f'\n완료: {created}개 생성, {updated}개 업데이트')
        )
