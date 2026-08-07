"""의뢰서(RequestDocument) 권한 판정 헬퍼.

views.py 와 serializers.py 가 동일 규칙을 공유하기 위해 별도 모듈로 분리한다
(views ↔ serializers 순환 import 방지).

`my_group_ids` 인자: 목록 직렬화처럼 한 호출자가 여러 문서를 검사할 때,
"호출자가 멤버인 그룹 id 집합"을 미리 계산해 넘기면 문서마다 그룹 쿼리를
다시 날리지 않는다(성능). 단건 호출(액션)에서는 None 으로 두면 그때그때
쿼리로 판정한다.

공유 기준은 **문서에 지정된 그룹 1개**(RequestDocument.shared_group)다.
작성자가 지정하지 않으면(null) 작성자 본인과 MASTER 외에는 아무도 볼 수 없다.
"의뢰자와 아무 그룹이나 공유하면 접근 가능"하던 종전 규칙은, 그룹을 여러 개
가진 사용자의 임시저장이 모든 그룹에 노출되는 문제 때문에 폐기했다.
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


def my_group_ids_for(user):
    """user 가 멤버인 '나만의 그룹' id 집합."""
    if not getattr(user, 'loginid', ''):
        return set()
    return set(user.member_groups.values_list('id', flat=True))


def is_shared_group_member(user, document, my_group_ids=None):
    """호출자가 문서에 지정된 공유 그룹(shared_group)의 멤버인지.

    공유 그룹이 지정되지 않은 문서는 누구와도 공유되지 않는다.
    """
    if not document.shared_group_id:
        return False
    if my_group_ids is not None:
        return document.shared_group_id in my_group_ids
    return user.member_groups.filter(pk=document.shared_group_id).exists()


def can_withdraw(user, document, my_group_ids=None):
    """철회 인가: MASTER / 의뢰자 / 지정 PL / 문서 공유 그룹(shared_group)의 멤버."""
    if getattr(user, 'role', '') == 'MASTER':
        return True
    loginid = getattr(user, 'loginid', '')
    if not loginid:
        return False
    if is_requester(user, document):
        return True
    if document.designated_pl and document.designated_pl.loginid == loginid:
        return True
    return is_shared_group_member(user, document, my_group_ids)


def can_delete(user, document, my_group_ids=None):
    """삭제 인가 — 문서 상태별 허용 대상.

    - approved : MASTER 만 (결재 완료본은 이력이므로 임의 삭제 금지)
    - 그 외(draft/under_review/rejected/pause) : MASTER / 의뢰자 / 지정 PL

    ⚠️ 공유 그룹 멤버는 **삭제할 수 없다**. 남의 임시저장을 함께 수정·상신하는 것과
    통째로 지우는 것은 위험도가 다르므로, 삭제는 문서 주인(의뢰자)과 지정 PL,
    MASTER 로 제한한다(2026-08 정책). 이 점이 can_withdraw 와의 두 번째 차이다.

    프론트의 삭제 버튼 노출 조건과 맞춘 규칙이다
    (`ApprovalPage` 는 can_withdraw, `HistoryPage` 는 MASTER 로 버튼을 낸다).
    """
    if document.status == 'approved':
        return getattr(user, 'role', '') == 'MASTER'
    if getattr(user, 'role', '') == 'MASTER':
        return True
    loginid = getattr(user, 'loginid', '')
    if not loginid:
        return False
    if is_requester(user, document):
        return True
    return bool(document.designated_pl and document.designated_pl.loginid == loginid)


def can_edit(user, document, my_group_ids=None):
    """수정(update) 인가 — 문서 상태별 허용 대상.

    - draft     : 작성자(의뢰자) / 문서 공유 그룹의 멤버 / MASTER
    - rejected  : 철회 가능 범위와 동일(의뢰자/지정PL/공유 그룹 멤버/MASTER)
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
        # 공유 그룹 멤버는 남의 임시저장을 이어서 수정·상신할 수 있다(삭제는 불가 — can_delete).
        return is_requester(user, document) or is_shared_group_member(user, document, my_group_ids)
    if st == 'rejected':
        return can_withdraw(user, document, my_group_ids)
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
    if st == 'pause':
        # 중단(PAUSE) 문서는 작성자 본인만 수정 가능(수정 후 재개)
        return is_requester(user, document)
    return False


def can_request_pause(user, document):
    """중단 요청 인가: 진행 중(under_review) 문서의 작성자 본인 또는 MASTER.

    이미 활성(요청/확정) 중단 요청이 있으면 불가.
    """
    if document.status != 'under_review':
        return False
    if any(pr.is_active() for pr in document.pause_requests.all()):
        return False
    if getattr(user, 'role', '') == 'MASTER':
        return True
    return is_requester(user, document)


def can_resume(user, document):
    """재개 인가: 중단(pause) 문서의 작성자 본인 또는 MASTER."""
    if document.status != 'pause':
        return False
    if getattr(user, 'role', '') == 'MASTER':
        return True
    return is_requester(user, document)
