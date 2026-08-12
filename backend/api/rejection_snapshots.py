# ⚠️ MASKING 처리된 파일. 이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다. 원래 용어를 확인하려면 다음 파일을 참조하세요: frontend/src/locales/ko.json

"""반려 이력(RejectionSnapshot) 적재.

반려는 문서의 status 만 rejected 로 바꾸고 재상신하면 원래대로 돌아가므로, 문서만으로는
"언제 무슨 내용으로 반려됐는지"가 남지 않는다. 반려가 확정되는 순간 이 모듈이 문서의
폼 내용과 결재 단계를 복사해 별도 테이블에 적재한다(이력 조회 '반려' 탭의 데이터 원본).
"""

import json

from django.utils import timezone

from .models import RejectionSnapshot
from .serializers import ApprovalStepSerializer


def _actor_of(step, acting_user):
    """반려자(loginid, name). 버튼을 누른 사람을 우선하고, 없으면 단계 담당자로 채운다.

    MASTER 는 본인이 담당자가 아닌 단계도 반려할 수 있어 둘이 다를 수 있다.
    """
    if getattr(acting_user, 'is_authenticated', False):
        return (
            getattr(acting_user, 'loginid', '') or '',
            getattr(acting_user, 'username', '') or '',
        )
    assignee = getattr(step, 'assignee', None)
    return (
        getattr(assignee, 'loginid', '') or '',
        getattr(step, 'assignee_name', '') or '',
    )


def create_from_reject(document, step, acting_user=None):
    """반려 시점의 의뢰서를 스냅샷 1행으로 적재하고 그 객체를 반환한다.

    호출 시점에는 step.action 이 이미 'rejected' 로 저장돼 있어야 한다
    (결재 단계 JSON 에 반려 표시가 그대로 담기도록).

    회차마다 1행씩 쌓이며 중복 방지는 하지 않는다 — 첫 반려로 문서가 rejected 가 되면
    이후 결재 액션은 `_blocked_progress_response` 에서 막히므로 같은 회차가 두 번
    적재될 일이 사실상 없다.
    """
    steps_json = json.dumps(
        ApprovalStepSerializer(document.approval_steps.all(), many=True).data,
        ensure_ascii=False,
        default=str,
    )
    loginid, name = _actor_of(step, acting_user)

    return RejectionSnapshot.objects.create(
        document=document,
        source_document_id=document.id,
        title=document.title,
        product_name=document.product_name,
        requester_name=document.requester_name,
        requester_department=document.requester_department,
        requester_loginid=getattr(document.requester, 'loginid', '') or '',
        submitted_at=document.submitted_at,
        additional_notes=document.additional_notes or '',
        approval_steps=steps_json,
        round=getattr(step, 'round', 1) or 1,
        rejected_at=getattr(step, 'acted_at', None) or timezone.now(),
        rejected_agent=getattr(step, 'agent', '') or '',
        rejected_by_name=name,
        rejected_by_loginid=loginid,
        reject_comment=getattr(step, 'comment', '') or '',
    )
