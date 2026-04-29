"""
사용자 시드 데이터 생성 커맨드
프론트엔드 AuthContext.tsx 의 MOCK_USERS 와 동일한 14 명 생성

Usage:
    python manage.py create_users
"""
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User

USERS = [
  { id: 1, 'username': 'pl_user',  'name': 'RM', 'role': 'PL',     'department': 'PA1',  'email': 'pl.user@company.com' },
  { id: 2, 'username': 'pl_user2',  'name': '진', 'role': 'PL',     'department': 'PA2',  'email': 'pl.user@company.com' },
  { id: 3, 'username': 'pl_user3',  'name': '슈가', 'role': 'PL',     'department': 'PA3',  'email': 'pl.user@company.com' },
  { id: 4, 'username': 'pl_user4',  'name': '제이홉', 'role': 'PL',     'department': 'PA4',  'email': 'pl.user@company.com' },
  { id: 5, 'username': 'pl_user5',  'name': '지민', 'role': 'PL',     'department': 'YE',  'email': 'pl.user@company.com' },
  { id: 6, 'username': 'pl_user6',  'name': '뷔', 'role': 'PL',     'department': 'sensorPA',  'email': 'pl.user@company.com' },
  { id: 7, 'username': 'agent_r1', 'name': '정국', 'role': 'TE_R',   'department': 'RFG', 'email': 'agent.r1@company.com' },
  { id: 8, 'username': 'agent_r2', 'name': '손흥민',   'role': 'TE_R',   'department': 'RFG', 'email': 'agent.r2@company.com' },
  { id: 9, 'username': 'agent_r3', 'name': '박지성',   'role': 'TE_R',   'department': 'RFG', 'email': 'agent.r3@company.com' },
  { id: 10, 'username': 'agent_j1', 'name': '차범근', 'role': 'TE_J',   'department': 'JOB', 'email': 'agent.j1@company.com' },
  { id: 11, 'username': 'agent_j2', 'name': '제니',   'role': 'TE_J',   'department': 'JOB', 'email': 'agent.j2@company.com' },
  { id: 12,'username': 'agent_j3', 'name': '지수',   'role': 'TE_J',   'department': 'JOB', 'email': 'agent.j3@company.com' },
  { id: 13, 'username': 'agent_o1', 'name': '로제', 'role': 'TE_O',   'department': 'OVL', 'email': 'agent.o1@company.com' },
  { id: 14,'username': 'agent_o2', 'name': '리사',   'role': 'TE_O',   'department': 'OVL', 'email': 'agent.o2@company.com' },
  { id: 15,'username': 'agent_o3', 'name': '민지',   'role': 'TE_O',   'department': 'OVL', 'email': 'agent.o3@company.com' },
  { id: 16, 'username': 'agent_e1', 'name': '하니', 'role': 'TE_E',   'department': 'EUV', 'email': 'agent.e1@company.com' },
  { id: 17,'username': 'agent_e2', 'name': '해린',   'role': 'TE_E',   'department': 'EUV', 'email': 'agent.e2@company.com' },
  { id: 18,'username': 'agent_e3', 'name': '혜인',   'role': 'TE_E',   'department': 'EUV', 'email': 'agent.e3@company.com' },
  { id: 19, 'username': 'master',   'name': '다니엘', 'role': 'MASTER', 'department': '관리팀',    'email': 'master@company.com' },
]

PASSWORD = 'pass1234'


class Command(BaseCommand):
    help = '프론트엔드 MOCK_USERS와 동일한 사용자 14명을 생성합니다.'

    def handle(self, *args, **options):
        created = 0
        updated = 0

        for u in USERS:
            user, is_new = User.objects.get_or_create(username=u['username'])
            user.email = u['email']
            user.set_password(PASSWORD)
            user.role = u['role']
            user.department = u['department']
            user.display_name = u['name']
            user.save()

            if is_new:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"  생성: {u['username']} ({u['name']}, {u['role']})"))
            else:
                updated += 1
                self.stdout.write(f"  업데이트: {u['username']} ({u['name']}, {u['role']})")

        self.stdout.write(
            self.style.SUCCESS(f'\n완료: {created}명 생성, {updated}명 업데이트 (비밀번호: {PASSWORD})')
        )
