"""
사용자 시드 데이터 생성 커맨드
프론트엔드 AuthContext.tsx 의 MOCK_USERS 와 동일한 19 명 생성

Usage:
    python manage.py create_users
"""
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

USERS = [
  {'loginid': 'pl_user',   'name': 'RM',    'role': 'PL',     'deptname': 'PA1',      'mail': 'pl.user@company.com'},
  {'loginid': 'pl_user2',  'name': '진',    'role': 'PL',     'deptname': 'PA2',      'mail': 'pl.user@company.com'},
  {'loginid': 'pl_user3',  'name': '슈가',  'role': 'PL',     'deptname': 'PA3',      'mail': 'pl.user@company.com'},
  {'loginid': 'pl_user4',  'name': '제이홉','role': 'PL',     'deptname': 'PA4',      'mail': 'pl.user@company.com'},
  {'loginid': 'pl_user5',  'name': '지민',  'role': 'PL',     'deptname': 'YE',       'mail': 'pl.user@company.com'},
  {'loginid': 'pl_user6',  'name': '뷔',    'role': 'PL',     'deptname': 'sensorPA', 'mail': 'pl.user@company.com'},
  {'loginid': 'agent_r1',  'name': '정국',  'role': 'TE_R',   'deptname': 'RFG',      'mail': 'agent.r1@company.com'},
  {'loginid': 'agent_r2',  'name': '손흥민','role': 'TE_R',   'deptname': 'RFG',      'mail': 'agent.r2@company.com'},
  {'loginid': 'agent_r3',  'name': '박지성','role': 'TE_R',   'deptname': 'RFG',      'mail': 'agent.r3@company.com'},
  {'loginid': 'agent_j1',  'name': '차범근','role': 'TE_J',   'deptname': 'JOB',      'mail': 'agent.j1@company.com'},
  {'loginid': 'agent_j2',  'name': '제니',  'role': 'TE_J',   'deptname': 'JOB',      'mail': 'agent.j2@company.com'},
  {'loginid': 'agent_j3',  'name': '지수',  'role': 'TE_J',   'deptname': 'JOB',      'mail': 'agent.j3@company.com'},
  {'loginid': 'agent_o1',  'name': '로제',  'role': 'TE_O',   'deptname': 'OVL',      'mail': 'agent.o1@company.com'},
  {'loginid': 'agent_o2',  'name': '리사',  'role': 'TE_O',   'deptname': 'OVL',      'mail': 'agent.o2@company.com'},
  {'loginid': 'agent_o3',  'name': '민지',  'role': 'TE_O',   'deptname': 'OVL',      'mail': 'agent.o3@company.com'},
  {'loginid': 'agent_e1',  'name': '하니',  'role': 'TE_E',   'deptname': 'EUV',      'mail': 'agent.e1@company.com'},
  {'loginid': 'agent_e2',  'name': '해린',  'role': 'TE_E',   'deptname': 'EUV',      'mail': 'agent.e2@company.com'},
  {'loginid': 'agent_e3',  'name': '혜인',  'role': 'TE_E',   'deptname': 'EUV',      'mail': 'agent.e3@company.com'},
  {'loginid': 'master',    'name': '다니엘','role': 'MASTER',  'deptname': '관리팀',   'mail': 'master@company.com'},
]

PASSWORD = 'pass1234'


class Command(BaseCommand):
    help = '프론트엔드 MOCK_USERS와 동일한 사용자 19명을 생성합니다.'

    def handle(self, *args, **options):
        User = get_user_model()
        created = 0
        updated = 0

        for u in USERS:
            user, is_new = User.objects.get_or_create(loginid=u['loginid'])
            user.mail = u['mail']
            user.set_password(PASSWORD)
            user.role = u['role']
            user.deptname = u['deptname']
            user.username = u['name']
            user.save()

            if is_new:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"  생성: {u['loginid']} ({u['name']}, {u['role']})"))
            else:
                updated += 1
                self.stdout.write(f"  업데이트: {u['loginid']} ({u['name']}, {u['role']})")

        self.stdout.write(
            self.style.SUCCESS(f'\n완료: {created}명 생성, {updated}명 업데이트 (비밀번호: {PASSWORD})')
        )
