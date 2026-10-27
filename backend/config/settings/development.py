from django.core.exceptions import ImproperlyConfigured

from .base import *

DEBUG = True

# claude 수정 (2026-10-27): 개발 DB 는 운영 복사본(db-sync)이라 실사용자 메일 주소가 들어 있다 —
# MAIL_REDIRECT_TO 없이 결재를 진행하면 실제 사용자에게 메일이 가므로 비어 있으면 기동하지 않는다.
# 고정 후결자도 모든 의뢰서(MAP 삭제·ADI CD 변경 제외)에 반드시 들어가야 하므로 함께 필수로 막는다.
if not MAIL_REDIRECT_TO.strip():
    raise ImproperlyConfigured(
        'MAIL_REDIRECT_TO 가 비어 있습니다. 개발환경은 실사용자에게 메일이 가지 않도록 '
        '.env.dev 에 MAIL_REDIRECT_TO 를 반드시 설정해야 합니다.'
    )
if not POST_APPROVER_LOGINID.strip():
    raise ImproperlyConfigured(
        'POST_APPROVER_LOGINID(고정 후결자 loginid)가 비어 있습니다. .env.dev 에 반드시 설정해야 합니다.'
    )
