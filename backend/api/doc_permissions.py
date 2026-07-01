"""의뢰서(RequestDocument) 권한 판정 헬퍼.

views.py 와 serializers.py 가 동일 규칙을 공유하기 위해 별도 모듈로 분리한다
(views ↔ serializers 순환 import 방지).

`co_member_ids` 인자: 목록 직렬화처럼 한 호출자가 여러 문서를 검사할 때,
"호출자와 그룹을 공유하는 사용자 id 집합"을 미리 계산해 넘기면 문서마다
그룹 쿼리를 다시 날리지 않는다(성능). 단건 호출(액션)에서는 None 으로 두면
그때그때 쿼리로 판정한다.
"""
from django.contrib.auth import get_user_model
from django.db.models import Max

User = get_user_model()


def is_requester(user, document):
    """문서 작성자(의뢰자) 본인 여부.

    신규 문서는 requester FK(perform_create 에서 설정)로 판별하고,
    FK 가 비어 있는 레거시 문서는 의뢰자 이메일로 보조 판별한다.
    """
    loginid = getattr(user, 'loginid', '')
    if not loginid:
        return False
    if document.requester_id:
        return document.requester.loginid == loginid
    mail = getattr(user, 'mail', '')
    return bool(mail and document.requester_email and document.requester_email == mail)


def pending_pl_step(document):
    """현재 회차의 pending PL 단계. 없으면 None."""
    from .models import ApprovalStep
    max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max'] or 1
    return ApprovalStep.objects.filter(
        document=document, agent='PL', action='pending', round=max_round
    ).first()


def co_member_ids_for(user):
    """user 와 '나만의 그룹'을 공유하는 사용자 id 집합(자기 자신 포함 가능)."""
    if not getattr(user, 'loginid', ''):
        return set()
    group_ids = user.member_groups.values_list('id', flat=True)
    return set(
        User.objects.filter(member_groups__in=group_ids).values_list('id', flat=True)
    )


def _shares_group_with_requester(user, document, co_member_ids):
    """호출자가 '의뢰자가 멤버인 그룹'의 멤버인지."""
    if not document.requester_id:
        return False
    if co_member_ids is not None:
        return document.requester_id in co_member_ids
    return User.objects.filter(
        loginid=user.loginid,
        member_groups__in=document.requester.member_groups.all(),
    ).exists()


def can_withdraw(user, document, co_member_ids=None):
    """철회 인가: MASTER / 의뢰자 / 지정 PL / 의뢰자가 멤버인 그룹의 멤버."""
    if getattr(user, 'role', '') == 'MASTER':
        return True
    loginid = getattr(user, 'loginid', '')
    if not loginid:
        return False
    if is_requester(user, document):
        return True
    if document.designated_pl and document.designated_pl.loginid == loginid:
        return True
    return _shares_group_with_requester(user, document, co_member_ids)


def can_edit(user, document, co_member_ids=None):
    """수정(update) 인가 — 문서 상태별 허용 대상.

    - draft     : 작성자(의뢰자) 또는 MASTER
    - rejected  : 철회 가능 범위와 동일(의뢰자/지정PL/의뢰자 그룹멤버/MASTER)
    - under_review/submitted : PL 검토 단계 pending 시 그 지정 PL 또는 MASTER
    - approved  : MASTER 만
    """
    if getattr(user, 'role', '') == 'MASTER':
        return True
    loginid = getattr(user, 'loginid', '')
    if not loginid:
        return False
    st = document.status
    if st == 'draft':
        return is_requester(user, document)
    if st == 'rejected':
        return can_withdraw(user, document, co_member_ids)
    if st in ('under_review', 'submitted'):
        from .models import ApprovalStep
        max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max'] or 1
        # 다중 PL: 현재 회차의 pending PL 단계 담당자 누구나 수정(수정 후 상신) 가능
        is_pending_pl = ApprovalStep.objects.filter(
            document=document, agent='PL', action='pending', round=max_round,
            assignee__loginid=loginid,
        ).exists()
        if is_pending_pl:
            return True
        if document.designated_pl and document.designated_pl.loginid == loginid:
            return True
        return False
    return False
