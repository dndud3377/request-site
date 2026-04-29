"""
Development Authentication Backend (Mock Users).
개발 환경에서는 로그인 없이 Mock 사용자로 전환하며 테스트 가능
"""
from django.contrib.auth.backends import BaseBackend
from django.contrib.auth import get_user_model
from django.conf import settings
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

# Mock 사용자 목록 (총 22 명)
MOCK_USERS = [
    # NONE 역할 (3 명)
    {'username': '게스트 1', 'name': '게스트 1', 'role': 'NONE', 'department': '게스트', 'email': 'guest1@dev.local'},
    {'username': '게스트 2', 'name': '게스트 2', 'role': 'NONE', 'department': '게스트', 'email': 'guest2@dev.local'},
    {'username': '게스트 3', 'name': '게스트 3', 'role': 'NONE', 'department': '게스트', 'email': 'guest3@dev.local'},
    
    # PL 역할 (6 명)
    {'username': 'RM', 'name': 'RM', 'role': 'PL', 'department': 'PA1', 'email': 'rm@dev.local'},
    {'username': '진', 'name': '진', 'role': 'PL', 'department': 'PA2', 'email': 'jin@dev.local'},
    {'username': '슈가', 'name': '슈가', 'role': 'PL', 'department': 'PA3', 'email': 'suga@dev.local'},
    {'username': '제이홉', 'name': '제이홉', 'role': 'PL', 'department': 'PA4', 'email': 'jhope@dev.local'},
    {'username': '지민', 'name': '지민', 'role': 'PL', 'department': 'YE', 'email': 'jimin@dev.local'},
    {'username': '뷔', 'name': '뷔', 'role': 'PL', 'department': 'sensorPA', 'email': 'v@dev.local'},
    
    # TE_R 역할 (3 명)
    {'username': '정국', 'name': '정국', 'role': 'TE_R', 'department': 'RFG', 'email': 'jk@dev.local'},
    {'username': '손흥민', 'name': '손흥민', 'role': 'TE_R', 'department': 'RFG', 'email': 'son@dev.local'},
    {'username': '박지성', 'name': '박지성', 'role': 'TE_R', 'department': 'RFG', 'email': 'park@dev.local'},
    
    # TE_J 역할 (3 명)
    {'username': '차범근', 'name': '차범근', 'role': 'TE_J', 'department': 'JOB', 'email': 'cha@dev.local'},
    {'username': '제니', 'name': '제니', 'role': 'TE_J', 'department': 'JOB', 'email': 'jennie@dev.local'},
    {'username': '지수', 'name': '지수', 'role': 'TE_J', 'department': 'JOB', 'email': 'jisoo@dev.local'},
    
    # TE_O 역할 (3 명)
    {'username': '로제', 'name': '로제', 'role': 'TE_O', 'department': 'OVL', 'email': 'rose@dev.local'},
    {'username': '리사', 'name': '리사', 'role': 'TE_O', 'department': 'OVL', 'email': 'lisa@dev.local'},
    {'username': '민지', 'name': '민지', 'role': 'TE_O', 'department': 'OVL', 'email': 'minji@dev.local'},
    
    # TE_E 역할 (3 명)
    {'username': '하니', 'name': '하니', 'role': 'TE_E', 'department': 'EUV', 'email': 'hanni@dev.local'},
    {'username': '해린', 'name': '해린', 'role': 'TE_E', 'department': 'EUV', 'email': 'haerin@dev.local'},
    {'username': '혜인', 'name': '혜인', 'role': 'TE_E', 'department': 'EUV', 'email': 'hyein@dev.local'},
    
    # MASTER 역할 (1 명)
    {'username': '다니엘', 'name': '다니엘', 'role': 'MASTER', 'department': '관리팀', 'email': 'daniel@dev.local'},
]


class DevBackend(BaseBackend):
    """
    개발용 인증 백엔드
    
    특징:
    - password 검사 없음 (username 만으로 인증)
    - Mock 사용자 목록 기반
    - Django 세션 + JWT 토큰 모두 지원
    - 개발 환경에서만 사용 (settings.DEBUG=True)
    """
    
    def authenticate(self, request, username=None, password=None, **kwargs):
        """
        Mock 사용자로 인증
        
        Args:
            request: Django request 객체
            username: Mock 사용자 이름
            password: 무시됨 (검안 안 함)
        
        Returns:
            User 객체 (성공 시) 또는 None (실패 시)
        """
        # 개발 환경인지 확인
        if not getattr(settings, 'DEBUG', False):
            logger.warning("[DevAuth] authenticate() called in non-debug mode")
            return None
        
        if not username:
            return None
        
        # Mock 사용자 목록에서 찾기
        mock_user_data = None
        for user_data in MOCK_USERS:
            if user_data['username'] == username:
                mock_user_data = user_data
                break
        
        if not mock_user_data:
            logger.warning(f"[DevAuth] User not found: {username}")
            return None
        
        # Django User 조회 또는 생성
        try:
            user = User.objects.get(username=username)
            # 기존 사용자 정보 업데이트
            user.display_name = mock_user_data['name']
            user.department = mock_user_data['department']
            user.role = mock_user_data['role']
            user.email = mock_user_data['email']
            user.save()
            logger.info(f"[DevAuth] Updated existing user: {username}")
        except User.DoesNotExist:
            # 새 사용자 생성
            user = User.objects.create_user(
                username=username,
                email=mock_user_data['email'],
                password='',  # password 는 비어있음 (사용 안 함)
                display_name=mock_user_data['name'],
                department=mock_user_data['department'],
                role=mock_user_data['role'],
            )
            logger.info(f"[DevAuth] Created new user: {username}")
        
        return user
    
    def get_user(self, user_id):
        """Django 표준 메서드"""
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None
    
    @staticmethod
    def get_all_users():
        """
        모든 Mock 사용자 목록 반환
        
        Returns:
            list: Mock 사용자 목록 (딕셔너리 리스트)
        """
        return MOCK_USERS
    
    @staticmethod
    def get_users_by_role(role):
        """
        역할별 Mock 사용자 목록 반환
        
        Args:
            role: 역할명 (NONE, PL, TE_R, TE_J, TE_O, TE_E, MASTER)
        
        Returns:
            list: 해당 역할의 Mock 사용자 목록
        """
        return [user for user in MOCK_USERS if user['role'] == role]
