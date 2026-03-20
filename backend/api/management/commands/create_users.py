"""
사용자 시드 데이터 생성 커맨드
프론트엔드 AuthContext.tsx의 MOCK_USERS와 동일한 14명 생성

Usage:
    python manage.py create_users
"""
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from api.models import UserProfile

USERS = [
    {'id': 1,  'username': 'pl_user',  'name': '김의뢰', 'role': 'PL',     'department': '마케팅팀',  'email': 'pl.user@company.com'},
    {'id': 2,  'username': 'agent_r1', 'name': '이검토', 'role': 'TE_R',   'department': 'AGENT R팀', 'email': 'agent.r1@company.com'},
    {'id': 7,  'username': 'agent_r2', 'name': '김R',   'role': 'TE_R',   'department': 'AGENT R팀', 'email': 'agent.r2@company.com'},
    {'id': 8,  'username': 'agent_r3', 'name': '박R',   'role': 'TE_R',   'department': 'AGENT R팀', 'email': 'agent.r3@company.com'},
    {'id': 3,  'username': 'agent_j1', 'name': '박제이', 'role': 'TE_J',   'department': 'AGENT J팀', 'email': 'agent.j1@company.com'},
    {'id': 9,  'username': 'agent_j2', 'name': '김J',   'role': 'TE_J',   'department': 'AGENT J팀', 'email': 'agent.j2@company.com'},
    {'id': 10, 'username': 'agent_j3', 'name': '이J',   'role': 'TE_J',   'department': 'AGENT J팀', 'email': 'agent.j3@company.com'},
    {'id': 4,  'username': 'agent_o1', 'name': '최오이', 'role': 'TE_O',   'department': 'AGENT O팀', 'email': 'agent.o1@company.com'},
    {'id': 11, 'username': 'agent_o2', 'name': '김O',   'role': 'TE_O',   'department': 'AGENT O팀', 'email': 'agent.o2@company.com'},
    {'id': 12, 'username': 'agent_o3', 'name': '이O',   'role': 'TE_O',   'department': 'AGENT O팀', 'email': 'agent.o3@company.com'},
    {'id': 5,  'username': 'agent_e1', 'name': '정이이', 'role': 'TE_E',   'department': 'AGENT E팀', 'email': 'agent.e1@company.com'},
    {'id': 13, 'username': 'agent_e2', 'name': '김E',   'role': 'TE_E',   'department': 'AGENT E팀', 'email': 'agent.e2@company.com'},
    {'id': 14, 'username': 'agent_e3', 'name': '이E',   'role': 'TE_E',   'department': 'AGENT E팀', 'email': 'agent.e3@company.com'},
    {'id': 6,  'username': 'master',   'name': '관리자', 'role': 'MASTER', 'department': '관리팀',    'email': 'master@company.com'},
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
            user.save()

            profile, _ = UserProfile.objects.get_or_create(user=user)
            profile.role = u['role']
            profile.department = u['department']
            profile.display_name = u['name']
            profile.save()

            if is_new:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"  생성: {u['username']} ({u['name']}, {u['role']})"))
            else:
                updated += 1
                self.stdout.write(f"  업데이트: {u['username']} ({u['name']}, {u['role']})")

        self.stdout.write(
            self.style.SUCCESS(f'\n완료: {created}명 생성, {updated}명 업데이트 (비밀번호: {PASSWORD})')
        )
