"""System R(RS) — 2구역에서 R 과 병렬로 MAP 정보를 시스템이 검증하는 결재 단계 (2026-11-13 신설).

claude 수정 (2026-11-13): '숫자 확인 값 ↔ AAA4 자동 반려'(구 num_check_reject.py, 구역 무관 즉시 반려)를
System R 단계 판정으로 대체했다. 판정 결과는 RS 단계의 합의/반려로만 남는다.

규칙 (docs/APPROVAL.md "System R" 절과 같아야 한다):
- 생성: 일반·Only MAP 경로에서 PL(+SA) 전원 합의로 R 을 만들 때 함께 만든다(`views._open_stage_after_pl`).
  담당자 없음·도착 메일 없음. 2구역(R)이 없는 회차(Case T 재상신 R 생략·'Overlay만 변경' 단독)와
  MAP 삭제·ADI CD 변경에는 만들지 않는다.
- 판정 시점: `scheduler.sync_form_options()`(MAP 이름 동기화, 1시간 주기)가 끝난 직후, 현재 회차의 RS 가
  pending 인 진행 중 문서만 판정한다. 합의·반려로 결론이 난 RS 는 다시 판정하지 않는다.
- 판정 동결: 결재 액션과 같이 under_review 가 아니거나 철회·중단 요청 확인 대기 중이면 건너뛴다.
- 판정 순서:
  1) 공통 전제 — 문서 STEP1 의 라인(`detail.line` → `utils.LINE_TO_LINEID_MAP`) + 제품(`detail.partid_selection`)으로
     MAP 이름 캐시(api_mapname) 행을 찾는다. 행이 없으면 판정하지 않고 다음 주기를 기다린다.
  2) 검증 항목(`CHECKS`)마다 판정에 필요한 값이 아직 없으면(None) 다음 주기를 기다린다.
  3) 모든 항목이 합의/반려 중 하나로 판정되면, 반려가 하나라도 있으면 RS 반려, 모두 합의면 RS 합의.
- 검증 항목 추가: `CHECKS` 에 `check(detail, entry) -> None | (True, '') | (False, '반려 사유')` 함수를 더한다.
- RS 합의 후 R(+RV)도 끝나 있으면 3구역(Only MAP 은 후결자)을 연다(`views._advance_if_r_zone_complete`).
- RS 반려: 문서 rejected → 반려 이력(반려자 System R) → 반려 메일.
  단계 의견은 `[System R 반려] <불일치 항목 / ...>`, 합의는 `[System R 합의]`.
- MASTER 는 결재 화면에서 RS 를 수동으로 합의·반려할 수 있다(일반 approve-step / reject-step).
"""
import logging
import math
import re

from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from . import mailer, rejection_snapshots
from .models import ApprovalStep, MapName, PauseRequest, RequestDocument, WithdrawRequest
from .utils import LINE_TO_LINEID_MAP

logger = logging.getLogger(__name__)

SYSTEM_R_AGENT = 'RS'
# 시스템 판정의 처리자 표시 이름 · 반려 이력의 반려자 (loginid, 이름)
SYSTEM_R_ACTOR_NAME = 'System R'
SYSTEM_R_ACTOR = ('system', SYSTEM_R_ACTOR_NAME)

REJECT_COMMENT_PREFIX = mailer.SYSTEM_R_REJECT_COMMENT_PREFIX
APPROVE_COMMENT = mailer.SYSTEM_R_APPROVE_COMMENT
# 반려 항목이 여럿이면 이 구분자로 잇는다
REJECT_REASON_SEPARATOR = ' / '

# 판정 결과
RESULT_APPROVE = 'approved'
RESULT_REJECT = 'rejected'

# 판정은 결재 진행 중인 문서만 — 결재 액션(_blocked_progress_response)과 같은 동결 규칙
JUDGE_STATUS = 'under_review'

# 프론트 `RequestPage/constants.ts` NUM_CHECK_APPLIES / NUM_CHECK_OVER / NUM_CHECK_UNDER 와 같아야 한다.
NUM_CHECK_APPLIES = '해당 있음'
NUM_CHECK_OVER = '이상'
NUM_CHECK_UNDER = '이하'

# 저장값 '<기준값> 이상|이하' (프론트 numCheckOptionValue 형식).
NUM_CHECK_VALUE_RE = re.compile(rf'^\s*(-?\d+(?:\.\d+)?)\s*({NUM_CHECK_OVER}|{NUM_CHECK_UNDER})\s*$')


def parse_num_check_value(value):
    """저장값 '<기준값> 이상|이하' → (기준값 float, '이상'|'이하'). 형식이 다르면 None."""
    match = NUM_CHECK_VALUE_RE.match(str(value or ''))
    if not match:
        return None
    return float(match.group(1)), match.group(2)


def _parse_number(raw):
    """문자열 → 유한한 float. 비어 있거나 숫자가 아니면 None."""
    text = str(raw).strip() if raw is not None else ''
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def find_map_name_entry(line, product):
    """라인명 + 제품으로 MapName 행 하나(id 순 첫 행)를 찾는다 — views.form_options_map_info 와 같은 매칭."""
    lineid = LINE_TO_LINEID_MAP.get(line)
    if not lineid or not product:
        return None
    return (
        MapName.objects.filter(lineid=lineid)
        .filter(Q(partid=product) | Q(partid__startswith=f'{product}_'))
        .order_by('id')
        .first()
    )


# ===== 검증 항목 =====
# 각 항목: check(detail, entry) → None(판정에 필요한 값이 아직 없음 — 다음 주기에 다시)
#                                | (True, '')        합의
#                                | (False, '사유')    반려

def check_num_check_aaa4(detail, entry):
    """'숫자 확인 값' ↔ AAA4.

    - 숫자 확인이 '해당 있음'이 아니면 검증할 것이 없으므로 합의.
    - '<N> 이상' 이면 AAA4 ≥ N, '<N> 이하' 이면 AAA4 ≤ N 일 때 합의, 아니면 반려. N 은 문서에 저장된 값.
    - 값을 고르지 않았거나 저장값 형식이 다르거나, AAA4 가 비어 있거나 숫자가 아니면 판정하지 않고 기다린다.
    """
    if detail.get('num_check') != NUM_CHECK_APPLIES:
        return True, ''
    selected = str(detail.get('num_check_value') or '').strip()
    parsed = parse_num_check_value(selected)
    if parsed is None:
        return None
    aaa4 = _parse_number(entry.AAA4)
    if aaa4 is None:
        return None
    threshold, word = parsed
    satisfied = aaa4 >= threshold if word == NUM_CHECK_OVER else aaa4 <= threshold
    if satisfied:
        return True, ''
    return False, f"숫자 확인 값 '{selected}' ↔ AAA4 {str(entry.AAA4).strip()}"


# 검증 항목 목록 — MAP 정보 검증을 추가할 때 여기에 함수를 더한다.
CHECKS = (check_num_check_aaa4,)


def evaluate_document(document):
    """문서의 MAP 정보를 검증한다(문서 상태는 보지 않는다).

    반환: None(아직 판정할 수 없음) 또는 {'result': 'approved'|'rejected', 'comment': 단계 의견}.
    """
    detail = (document.get_detail().get('detail') or {})
    line = str(detail.get('line') or '').strip()
    product = str(detail.get('partid_selection') or '').strip()
    entry = find_map_name_entry(line, product)
    if entry is None:
        return None

    reasons = []
    for check in CHECKS:
        outcome = check(detail, entry)
        if outcome is None:
            return None
        ok, reason = outcome
        if not ok:
            reasons.append(reason)

    if reasons:
        return {
            'result': RESULT_REJECT,
            'comment': f'{REJECT_COMMENT_PREFIX} {REJECT_REASON_SEPARATOR.join(reasons)}',
        }
    return {'result': RESULT_APPROVE, 'comment': APPROVE_COMMENT}


def _pending_rs_step(document, lock=False):
    """현재 회차의 대기 중인 RS 단계(없으면 None)."""
    max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max']
    qs = ApprovalStep.objects.filter(
        document=document, agent=SYSTEM_R_AGENT, action='pending', round=max_round,
    )
    if lock:
        qs = qs.select_for_update()
    return qs.first()


def _is_frozen(document):
    """철회·중단 요청 확인 대기 중이면 결재를 진행하지 않는다(views._blocked_progress_response 와 같은 규칙)."""
    if WithdrawRequest.objects.filter(document=document, state='requested').exists():
        return True
    return PauseRequest.objects.filter(document=document, state='requested').exists()


def judge_document(document_id):
    """문서를 잠그고 RS 를 판정한다. 합의·반려했으면 그 결과('approved'|'rejected'), 아니면 None.

    건너뛰는 경우: 진행 중(under_review)이 아님 · 철회/중단 요청 확인 대기 중 · 현재 회차에 대기 RS 없음 ·
    아직 판정할 수 없음(제품 이름 행 없음 / 항목 값 없음).
    """
    # 순환 import 방지 — 3구역 생성은 결재 액션과 같은 코드(views)를 쓴다.
    from .views import RequestDocumentViewSet

    with transaction.atomic():
        document = RequestDocument.objects.select_for_update().get(pk=document_id)
        if document.status != JUDGE_STATUS or _is_frozen(document):
            return None
        step = _pending_rs_step(document, lock=True)
        if step is None:
            return None
        verdict = evaluate_document(document)
        if verdict is None:
            return None

        step.action = verdict['result']
        step.acted_at = timezone.now()
        step.comment = verdict['comment']
        step.acted_by = None
        step.acted_by_name = SYSTEM_R_ACTOR_NAME
        step.save()

        if verdict['result'] == RESULT_APPROVE:
            viewset = RequestDocumentViewSet()
            document.status = viewset._advance_if_r_zone_complete(document, step, step.round)
            document.save()
        else:
            # 중단 요청이 걸린 문서(요청 대기·중단 확정)는 위에서 건너뛰므로 닫을 중단 요청이 없다.
            document.status = 'rejected'
            document.save()
            rejection_snapshots.create_from_reject(document, step, actor=SYSTEM_R_ACTOR)
            mailer.enqueue_rejected(document)
    logger.info(f"[system_r] 문서 {document_id} System R {verdict['result']} — {verdict['comment']}")
    return verdict['result']


def judge_pending():
    """현재 회차 RS 가 대기 중인 진행 중 문서를 모두 판정한다 — 스케줄러(sync_form_options) 끝에서 호출.

    문서마다 별도 트랜잭션이라 한 문서가 실패해도 나머지는 계속된다. {문서 id: 결과} 를 돌려준다.
    """
    results = {}
    doc_ids = (
        ApprovalStep.objects.filter(
            agent=SYSTEM_R_AGENT, action='pending', document__status=JUDGE_STATUS,
        )
        .values_list('document_id', flat=True)
        .distinct()
        .order_by('document_id')
    )
    for doc_id in list(doc_ids):
        try:
            result = judge_document(doc_id)
            if result:
                results[doc_id] = result
        except Exception as e:
            logger.error(f"[system_r] 문서 {doc_id} System R 판정 실패: {e}", exc_info=True)
    return results
