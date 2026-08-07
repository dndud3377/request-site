"""J 단계 검토 항목 — 마스터 목록 ↔ 문서 사본 동기화 규칙 (단일 소스).

정책 (2026-08 확정):

1. **채우기 시점** — 문서에 J 단계가 *생성되는 순간* 마스터의 활성 항목을 그 문서로
   복사한다(제목만, 검토자는 빈 상태). J 단계를 거치지 않는 경로(Only MAP 등)는
   채우지 않는다. 반려 후 재상신으로 새 회차 J 단계가 열리면 그 시점 마스터로 다시
   맞추므로, 반려돼 있는 동안 다른 문서에서 추가된 항목이 그때 따라 들어온다.
2. **전파** — 어느 문서에서든 항목을 추가·제목수정·삭제하면 마스터에 반영하고, 같은
   변경을 전파 대상 문서(결재 진행 중 + 현재 회차 J 단계가 pending)에도 적용한다.
3. **삭제 전파 예외** — 다른 문서에서 이미 확인(confirmed)한 검토자가 있는 항목은 그
   문서에 남긴다(검토 기록 보존). 사용자가 삭제를 지시한 원본 문서는 그대로 지운다.
4. **박제** — 결재가 끝난 문서는 전파 대상에서 빠지고, 사본이 자기 시점 제목을
   그대로 보존한다(DocumentReviewItem.title).

검토자는 마스터에 없다. 상속되는 것은 제목뿐이며 검토자는 문서마다 새로 지정한다.
"""
from django.db.models import Exists, Max, OuterRef
from django.utils import timezone

from .models import (
    ApprovalStep, DocumentReviewItem, DocumentReviewItemReviewer,
    RequestDocument, ReviewItemMaster,
)

# 전파 대상이 되는 문서 상태 — 결재가 진행 중인 것만.
# 완료(approved)·반려(rejected)·임시저장(draft)은 제외한다. 반려 문서는 재상신으로
# J 단계가 다시 열릴 때 fill_from_master() 로 한 번에 따라잡는다.
SYNC_STATUSES = ('under_review', 'pause')

# 검토 항목을 편집할 수 있는 역할
EDIT_ROLES = ('TE_J', 'MASTER')


def sync_target_documents(exclude_document_id=None):
    """전파 대상 문서 queryset — 결재 진행 중이고 현재 회차 J 단계가 pending 인 문서.

    '현재 회차'는 그 문서의 최대 round 다. 이전 회차의 잔여 pending 단계가 대상에
    끼지 않도록 반드시 최대 round 로 좁힌다.
    """
    # '현재 회차' 를 MAX(round) 서브쿼리로 잡으면 안 된다 — 중첩 서브쿼리 안의 OuterRef 는
    # 가장 가까운 바깥 쿼리(= ApprovalStep)로 묶여 `U0.document_id = V0.id` 라는 엉뚱한
    # 상관식이 만들어지고, 대상이 항상 0건이 된다. 대신 "더 큰 round 의 단계가 없다"로 본다.
    later_round = ApprovalStep.objects.filter(
        document=OuterRef('document'), round__gt=OuterRef('round'),
    )
    j_pending = ApprovalStep.objects.filter(
        document=OuterRef('pk'), agent='J', action='pending',
    ).annotate(has_later_round=Exists(later_round)).filter(has_later_round=False)
    qs = RequestDocument.objects.filter(status__in=SYNC_STATUSES).filter(Exists(j_pending))
    if exclude_document_id is not None:
        qs = qs.exclude(pk=exclude_document_id)
    return qs


def fill_from_master(document):
    """J 단계가 열릴 때 문서 사본을 마스터 최신본에 맞춘다.

    - 마스터에만 있는 활성 항목 → 사본 생성 (제목만, 검토자 없음)
    - 사본 제목이 마스터와 다르면 → 마스터 제목으로 갱신
    - 마스터에서 삭제(is_active=False)된 항목의 사본 → 제거. 단 확인 기록이 있으면 남긴다.
    """
    existing = {item.master_id: item for item in document.review_items.all()}

    for master in ReviewItemMaster.objects.filter(is_active=True):
        item = existing.pop(master.id, None)
        if item is None:
            DocumentReviewItem.objects.create(
                document=document, master=master, title=master.title,
            )
        elif item.title != master.title:
            item.title = master.title
            item.save(update_fields=['title'])

    for stale in existing.values():
        if not stale.reviewers.filter(confirmed=True).exists():
            stale.delete()


def reset_confirmations(document):
    """재상신 시 — 항목과 검토자 지정은 남기고 확인 상태만 초기화한다."""
    DocumentReviewItemReviewer.objects.filter(
        item__document=document, confirmed=True,
    ).update(confirmed=False, confirmed_at=None)


def add_item(document, title, user=None):
    """항목 추가 — 마스터에 등록하고 원본 + 전파 대상 문서 전체에 사본을 만든다."""
    master = ReviewItemMaster.objects.create(title=title, created_by=user)
    documents = [document] + list(sync_target_documents(exclude_document_id=document.pk))
    for doc in documents:
        DocumentReviewItem.objects.get_or_create(
            document=doc, master=master, defaults={'title': title},
        )
    return DocumentReviewItem.objects.get(document=document, master=master)


def rename_item(item, title):
    """제목 수정 — 마스터와 전파 대상 문서의 사본 제목을 함께 바꾼다."""
    master = item.master
    master.title = title
    master.save(update_fields=['title', 'updated_at'])

    target_ids = [item.document_id] + list(
        sync_target_documents(exclude_document_id=item.document_id).values_list('id', flat=True)
    )
    DocumentReviewItem.objects.filter(
        master=master, document_id__in=target_ids,
    ).update(title=title)


def delete_item(item):
    """항목 삭제 — 마스터를 비활성화하고 전파 대상 문서의 사본도 지운다.

    다른 문서에서 이미 확인한 검토자가 있는 사본은 남긴다(기록 보존). 삭제를 지시한
    원본 문서의 사본은 확인 기록과 무관하게 지운다 — 사용자의 명시적 지시이기 때문이다.
    """
    master = item.master
    origin_document_id = item.document_id

    master.is_active = False
    master.save(update_fields=['is_active', 'updated_at'])
    item.delete()

    others = DocumentReviewItem.objects.filter(
        master=master,
        document__in=sync_target_documents(exclude_document_id=origin_document_id),
    )
    for copy in others:
        if copy.reviewers.filter(confirmed=True).exists():
            continue
        copy.delete()


def confirm(reviewer, confirmed):
    """검토자 본인의 확인 / 확인 취소."""
    reviewer.confirmed = confirmed
    reviewer.confirmed_at = timezone.now() if confirmed else None
    reviewer.save(update_fields=['confirmed', 'confirmed_at'])


# ===== 인가 =====

def current_j_step(document):
    """현재 회차(최대 round)의 J 단계. 없으면 None."""
    max_round = ApprovalStep.objects.filter(document=document).aggregate(
        Max('round')
    )['round__max'] or 1
    return ApprovalStep.objects.filter(
        document=document, agent='J', round=max_round,
    ).first()


def is_stage_open(document):
    """검토 항목을 다룰 수 있는 단계 상태인가.

    문서가 진행 중(under_review/pause)이고, 현재 회차 J 단계가 '검토중'으로 선점되어
    (assignee 존재) 아직 합의/반려 전인 경우에만 열린다. 선점 전에는 읽기 전용이고,
    합의 완료 후에는 기록이 잠긴다.
    """
    if document.status not in SYNC_STATUSES:
        return False
    step = current_j_step(document)
    return bool(step and step.action == 'pending' and step.assignee_id)


def can_view_items(user):
    """검토 항목 서브탭 노출 대상 — J 권한자만."""
    return getattr(user, 'role', None) in EDIT_ROLES


def can_edit_items(user, document):
    """항목 추가·제목수정·삭제, 검토자 지정·해제 인가."""
    return can_view_items(user) and is_stage_open(document)


def can_confirm_items(document):
    """확인·확인취소 가능 단계인가. 검토자 본인 여부는 호출부가 함께 확인한다."""
    return is_stage_open(document)
