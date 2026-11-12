"""'숫자 확인 값' ↔ MAP 이름 캐시(api_mapname) AAA4 비교 자동 반려 (2026-11-12 신설).

배경: 요청서 STEP2 '숫자 확인 필수'가 '해당 있음'이면 작성자가 '숫자 확인 값'을
`'<기준값> 이상'` / `'<기준값> 이하'` 중에서 고른다(`detail.num_check_value`, 선택 시점의 기준값이 저장된다).
외부 DB 에서 1시간마다 동기화되는 `MapName.AAA4` 가 그 선택과 맞지 않으면 의뢰서를 자동 반려한다.

규칙 (docs/APPROVAL.md "숫자 확인 값 자동 반려" 절과 같아야 한다):
- 판정 시점: `scheduler.sync_form_options()`(MAP 이름 동기화, 1시간 주기)가 끝난 직후. 불일치가 1번
  확인되면 바로 반려한다(변경 감지 자동 반려와 달리 2주기 연속 확인을 기다리지 않는다).
- 대상: 결재 진행 중(submitted·under_review·pause) 문서 중 `num_check='해당 있음'` 이고
  `num_check_value` 가 있는 문서. 구역(1·2·3구역)과 무관하다. 철회 확인 대기 중인 문서만 뺀다(결재 동결).
- AAA4 조회 키: 문서 STEP1 의 라인(`detail.line` → `utils.LINE_TO_LINEID_MAP`) + 제품(`detail.partid_selection`).
  partid 가 제품과 정확히 같거나 `{제품}_` 로 시작하는 첫 행(id 순) — `views.form_options_map_info` 와 같은 매칭.
- 비교: '<N> 이상' 인데 AAA4 < N 이면 반려 / '<N> 이하' 인데 AAA4 > N 이면 반려. N 은 문서에 저장된 값.
- 판정 불가(행 없음 · AAA4 비어 있음 · AAA4 숫자 아님 · 저장값 형식 다름)는 반려하지 않는다.
- 반려 경로: 변경 감지 자동 반려(`layer_drift.auto_reject_document`)와 같은 순서 — 현재 회차의 가장 앞선
  대기 단계 반려 → 중단 요청 닫기 → 문서 rejected → 반려 이력(시스템 반려자) → 반려 메일.
  단계 의견은 `[자동반려] 숫자 확인 불일치: ...` 로 시작하며, mailer 가 이 머리말로 메일 안내 문구를 고른다.
"""
import logging
import math
import re

from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from . import mailer, rejection_snapshots
from .layer_drift import IN_PROGRESS_STATUSES, SYSTEM_REJECTER
from .models import ApprovalStep, MapName, PauseRequest, RequestDocument, WithdrawRequest
from .utils import LINE_TO_LINEID_MAP

logger = logging.getLogger(__name__)

# 프론트 `RequestPage/constants.ts` NUM_CHECK_APPLIES / NUM_CHECK_OVER / NUM_CHECK_UNDER 와 같아야 한다.
NUM_CHECK_APPLIES = '해당 있음'
NUM_CHECK_OVER = '이상'
NUM_CHECK_UNDER = '이하'

# 저장값 '<기준값> 이상|이하' (프론트 numCheckOptionValue 형식). 형식이 다르면 판정하지 않는다.
NUM_CHECK_VALUE_RE = re.compile(rf'^\s*(-?\d+(?:\.\d+)?)\s*({NUM_CHECK_OVER}|{NUM_CHECK_UNDER})\s*$')

# 판정 결과
RESULT_MATCH = 'match'            # 조건 만족 — 그대로 진행
RESULT_MISMATCH = 'mismatch'      # 조건 불만족 — 자동 반려
RESULT_SKIP = 'skip'              # 판정 불가 — 반려하지 않음

# 판정 불가 사유(로그·테스트용)
SKIP_NOT_APPLICABLE = 'not_applicable'   # 숫자 확인 대상 아님 / 값 미선택
SKIP_BAD_VALUE = 'bad_value'             # 저장값 형식이 '<N> 이상|이하' 가 아님
SKIP_NO_KEY = 'no_key'                   # 라인(lineid 변환 불가)·제품이 없음
SKIP_NO_ROW = 'no_row'                   # api_mapname 에 매칭 행 없음
SKIP_EMPTY_AAA4 = 'empty_aaa4'           # AAA4 비어 있음
SKIP_NON_NUMERIC_AAA4 = 'non_numeric_aaa4'  # AAA4 가 숫자가 아님

# 반려 단계 의견 머리말 — mailer.NUM_CHECK_AUTO_REJECT_COMMENT_PREFIX 로 메일 안내 문구를 고른다.
AUTO_REJECT_COMMENT_PREFIX = mailer.NUM_CHECK_AUTO_REJECT_COMMENT_PREFIX


def parse_num_check_value(value):
    """저장값 '<기준값> 이상|이하' → (기준값 float, '이상'|'이하'). 형식이 다르면 None."""
    match = NUM_CHECK_VALUE_RE.match(str(value or ''))
    if not match:
        return None
    return float(match.group(1)), match.group(2)


def _parse_aaa4(raw):
    """AAA4 문자열 → 유한한 float. 비어 있으면 SKIP_EMPTY_AAA4, 숫자가 아니면 SKIP_NON_NUMERIC_AAA4."""
    text = str(raw).strip() if raw is not None else ''
    if not text:
        return None, SKIP_EMPTY_AAA4
    try:
        number = float(text)
    except ValueError:
        return None, SKIP_NON_NUMERIC_AAA4
    if not math.isfinite(number):
        return None, SKIP_NON_NUMERIC_AAA4
    return number, None


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


def evaluate_document(document):
    """문서 하나를 판정한다. 반환: {'result', 'reason', 'selected', 'aaa4'} (문서 상태는 보지 않는다)."""
    detail = (document.get_detail().get('detail') or {})
    selected = str(detail.get('num_check_value') or '').strip()
    outcome = {'result': RESULT_SKIP, 'reason': SKIP_NOT_APPLICABLE, 'selected': selected, 'aaa4': None}
    if detail.get('num_check') != NUM_CHECK_APPLIES or not selected:
        return outcome

    parsed = parse_num_check_value(selected)
    if parsed is None:
        outcome['reason'] = SKIP_BAD_VALUE
        return outcome
    threshold, word = parsed

    line = str(detail.get('line') or '').strip()
    product = str(detail.get('partid_selection') or '').strip()
    if not LINE_TO_LINEID_MAP.get(line) or not product:
        outcome['reason'] = SKIP_NO_KEY
        return outcome

    entry = find_map_name_entry(line, product)
    if entry is None:
        outcome['reason'] = SKIP_NO_ROW
        return outcome
    outcome['aaa4'] = entry.AAA4

    aaa4, skip_reason = _parse_aaa4(entry.AAA4)
    if skip_reason:
        outcome['reason'] = skip_reason
        return outcome

    satisfied = aaa4 >= threshold if word == NUM_CHECK_OVER else aaa4 <= threshold
    outcome['result'] = RESULT_MATCH if satisfied else RESULT_MISMATCH
    outcome['reason'] = ''
    return outcome


def _auto_reject_comment(selected, aaa4):
    """반려 사유(단계 의견) — 머리말 + 선택값 + AAA4 원본값."""
    return f"{AUTO_REJECT_COMMENT_PREFIX}: 선택값 '{selected}', AAA4 {str(aaa4).strip()}"


def auto_reject_document(document_id):
    """문서를 잠그고 다시 판정해, 여전히 불일치면 자동 반려한다. 반려했으면 True.

    건너뛰는 경우: 상태가 결재 진행 중이 아님 · 철회 확인 대기 중 · 다시 판정한 결과가 불일치가 아님
    (그 사이 수정·재상신됨) · 현재 회차에 대기 단계가 없음.
    """
    with transaction.atomic():
        document = RequestDocument.objects.select_for_update().get(pk=document_id)
        if document.status not in IN_PROGRESS_STATUSES:
            return False
        if WithdrawRequest.objects.filter(document=document, state='requested').exists():
            return False
        outcome = evaluate_document(document)
        if outcome['result'] != RESULT_MISMATCH:
            return False

        max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max']
        step = ApprovalStep.objects.select_for_update().filter(
            document=document, round=max_round, action='pending',
        ).order_by('id').first()
        if step is None:
            logger.warning(f"[num_check_reject] 문서 {document_id} 자동 반려 불가 — 현재 회차에 대기 단계가 없다")
            return False

        step.action = 'rejected'
        step.acted_at = timezone.now()
        step.comment = _auto_reject_comment(outcome['selected'], outcome['aaa4'])
        step.save()

        # 반려로 회차가 종료되면 진행 중이던 중단 요청도 닫는다(layer_drift.auto_reject_document 와 같다).
        PauseRequest.objects.filter(
            document=document, state__in=('requested', 'confirmed'),
        ).update(state='cancelled')

        document.status = 'rejected'
        document.save()

        rejection_snapshots.create_from_reject(document, step, actor=SYSTEM_REJECTER)
        mailer.enqueue_rejected(document)
    logger.info(
        f"[num_check_reject] 문서 {document_id} 자동 반려 완료 — 선택값 '{outcome['selected']}', AAA4 {outcome['aaa4']}"
    )
    return True


def reject_mismatched_in_progress():
    """결재 진행 중 문서 전체를 판정해 불일치 문서를 자동 반려한다 — 스케줄러(sync_form_options) 끝에서 호출.

    문서마다 별도 트랜잭션이라 한 문서가 실패해도 나머지는 계속된다. 반려한 문서 id 목록을 돌려준다.
    """
    rejected_ids = []
    documents = RequestDocument.objects.filter(status__in=IN_PROGRESS_STATUSES).order_by('pk')
    for document in documents:
        try:
            if evaluate_document(document)['result'] != RESULT_MISMATCH:
                continue
            if auto_reject_document(document.pk):
                rejected_ids.append(document.pk)
        except Exception as e:
            logger.error(f"[num_check_reject] 문서 {document.pk} 숫자 확인 자동 반려 실패: {e}", exc_info=True)
    return rejected_ids
