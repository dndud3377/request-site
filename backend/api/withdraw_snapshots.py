"""철회 이력(WithdrawSnapshot) 적재.

claude 수정 (2026-11-22): 철회·삭제로 지워진 의뢰서를 이력 조회 '철회' 탭(MASTER 전용)에서 다시 볼 수 있도록 신설.

철회가 확정되면 의뢰서와 결재 단계·철회 요청이 CASCADE 로 함께 지워진다. 그래서 삭제 **직전**에
이 모듈이 문서의 폼 내용·결재 단계와 철회 경위(사유·요청자·확인자·삭제 처리자)를 별도 테이블에
복사해 둔다(반려 이력 `rejection_snapshots` 와 같은 방식).
"""

import json

from django.db.models import Max
from django.utils import timezone

from .models import WithdrawSnapshot
from .serializers import ApprovalStepSerializer


def _user_ident(user):
    """(loginid, 이름). 비로그인·시스템 호출이면 빈 값."""
    if not getattr(user, 'is_authenticated', False):
        return '', ''
    return getattr(user, 'loginid', '') or '', getattr(user, 'username', '') or ''


def create_before_delete(document, delete_path, acting_user=None, reason='', withdraw_request=None):
    """삭제 직전의 의뢰서를 철회 이력 1행으로 적재하고 그 객체를 반환한다.

    ⚠️ 반드시 `document.delete()` **앞에서** 호출해야 한다 — 결재 단계·철회 요청이 CASCADE 로
    함께 지워지기 때문이다.

    - delete_path: `WithdrawSnapshot.PATH_*`
    - acting_user: 삭제를 확정시킨 사람(즉시 삭제면 철회한 사람, 팀 확인 경로면 마지막 확인자)
    - withdraw_request: 팀 확인을 거친 경로의 철회 요청 — 요청자·요청일시·확인 기록을 복사한다.
      즉시 삭제 경로에서는 None 이고, 그때는 철회한 사람(acting_user)을 요청자로 기록한다.
    """
    steps = document.approval_steps.all()
    steps_json = json.dumps(
        ApprovalStepSerializer(steps, many=True).data,
        ensure_ascii=False,
        default=str,
    )
    deleted_loginid, deleted_name = _user_ident(acting_user)

    if withdraw_request is not None:
        requester = withdraw_request.requester
        requested_loginid = getattr(requester, 'loginid', '') or ''
        requested_name = withdraw_request.requester_name or getattr(requester, 'username', '') or ''
        requested_at = withdraw_request.created_at
        confirmations = list(withdraw_request.confirmed_by or [])
    else:
        requested_loginid, requested_name = deleted_loginid, deleted_name
        requested_at = timezone.now()
        confirmations = []

    return WithdrawSnapshot.objects.create(
        source_document_id=document.id,
        title=document.title,
        product_name=document.product_name or '',
        requester_name=document.requester_name or '',
        requester_department=document.requester_department or '',
        requester_loginid=getattr(document.requester, 'loginid', '') or '',
        submitted_at=document.submitted_at,
        status_at_delete=document.status or '',
        additional_notes=document.additional_notes or '',
        approval_steps=steps_json,
        round=steps.aggregate(Max('round'))['round__max'] or 1,
        delete_path=delete_path,
        reason=reason or '',
        requested_by_name=requested_name,
        requested_by_loginid=requested_loginid,
        requested_at=requested_at,
        confirmations=confirmations,
        deleted_by_name=deleted_name,
        deleted_by_loginid=deleted_loginid,
        deleted_at=timezone.now(),
    )
