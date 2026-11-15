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
  3) 종합(2026-11-13 보류 추가): 반려가 하나라도 있으면 RS 반려 > 보류가 있으면 RS 보류 >
     값이 없는 항목이 있으면 대기 > 모두 합의면 RS 합의.
- 검증 항목 추가: `CHECKS` 에 `check(detail, entry) -> None | (True, '') | (False, '반려 사유') | (CHECK_HOLD, '보류 사유')`
  함수를 더한다.
- RS 보류: RS 는 pending 그대로 두고 단계 의견에 `[System R 보류] <불일치 항목 / ...>` 를 남긴다. R 담당자·검토자에게
  확인 요청 메일을 RS 단계당 1번만 보낸다. 다음 주기에 다시 판정해 일치하면 합의한다. 보류가 풀렸는데 다른 항목이
  아직 대기면 보류 의견을 지운다.
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
from .models import ApprovalStep, MailNotification, MapName, PauseRequest, RequestDocument, WithdrawRequest
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
# claude 수정 (2026-11-13): 보류 판정 신설 — AAA5(Map Option)·AAA6(CLONE) 불일치는 반려하지 않고 RS 를 대기로 둔 채 R 에게 알린다
RESULT_HOLD = 'hold'
# 검증 항목이 '보류'를 돌려줄 때 첫 값 — (CHECK_HOLD, '보류 사유')
CHECK_HOLD = 'hold'
HOLD_COMMENT_PREFIX = mailer.SYSTEM_R_HOLD_COMMENT_PREFIX

# 판정은 결재 진행 중인 문서만 — 결재 액션(_blocked_progress_response)과 같은 동결 규칙
JUDGE_STATUS = 'under_review'

# 프론트 `RequestPage/constants.ts` NUM_CHECK_APPLIES / NUM_CHECK_OVER / NUM_CHECK_UNDER 와 같아야 한다.
NUM_CHECK_APPLIES = '해당 있음'
NUM_CHECK_OVER = '이상'
NUM_CHECK_UNDER = '이하'

# 저장값 '<기준값> 이상|이하' (프론트 numCheckOptionValue 형식).
NUM_CHECK_VALUE_RE = re.compile(rf'^\s*(-?\d+(?:\.\d+)?)\s*({NUM_CHECK_OVER}|{NUM_CHECK_UNDER})\s*$')

# claude 수정 (2026-11-13): AAA5(Map Option)·AAA6(CLONE) 검증용 상수
# 프론트 `RequestPage/constants.ts` MAP_TYPE_CLONE / MAP_TYPE_EXISTING 과 같아야 한다.
MAP_TYPE_CLONE = 'CLONE'
MAP_TYPE_EXISTING = 'EXISTING'
MAP_TYPES_REGISTERED = (MAP_TYPE_CLONE, MAP_TYPE_EXISTING)
MAP_OPTION_APPLIED = '적용'
INTER_APPLIED = 'YES'
# Map Option 번호 → (detail 필드, '적용'으로 볼 값). 번호는 화면 라벨(i18n request.map_opt_*)과 같다 —
# 3번은 토글이 아니라 Inter 드롭다운이라 YES 이면 적용으로 본다.
MAP_OPTION_FIELDS = {
    '1': ('photo_backside', MAP_OPTION_APPLIED),
    '2': ('eds_backside', MAP_OPTION_APPLIED),
    '3': ('inter', INTER_APPLIED),
    '4': ('tsv', MAP_OPTION_APPLIED),
    '5': ('rf', MAP_OPTION_APPLIED),
    '6': ('fullchip', MAP_OPTION_APPLIED),
    '7': ('split', MAP_OPTION_APPLIED),
    '8': ('st', MAP_OPTION_APPLIED),
    '9': ('ecc', MAP_OPTION_APPLIED),
    '10': ('labelsideshot', MAP_OPTION_APPLIED),
    '11': ('hpkglabelheight', MAP_OPTION_APPLIED),
}
# CLONE/EXISTING 에서 사용자가 고를 수 있는 Map Option 번호 — 프론트 MAP_OPTIONS_EDITABLE_WHEN_REGISTERED(['tsv'])와
# 같아야 한다. 나머지는 화면에서 잠겨 바꿀 수 없으므로 이 번호만 비교한다.
MAP_OPTIONS_EDITABLE_WHEN_REGISTERED = ('4',)
# AAA5 저장 형식 '1|2|3|4' 의 구분자
AAA5_SEPARATOR = '|'
# 비교 결과에서 옵션이 하나도 없을 때 보여줄 문구
MAP_OPTION_NONE_LABEL = '없음'


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


# claude 수정 (2026-11-13): AAA5·AAA6 은 값이 없을 수 있어 빈 값 판정을 한 곳에 둔다
def _is_blank(raw):
    """None·빈 문자열·공백·'nan'(pandas 결측이 문자열로 들어온 경우)이면 True."""
    text = str(raw).strip() if raw is not None else ''
    return not text or text.lower() == 'nan'


def _option_sort_key(number):
    """Map Option 번호 정렬 키 — 숫자는 숫자 순, 숫자가 아닌 값은 뒤로."""
    return (0, int(number), '') if number.isdigit() else (1, 0, number)


def _format_options(numbers):
    """번호 집합 → '1|2|4' (비어 있으면 '없음')."""
    if not numbers:
        return MAP_OPTION_NONE_LABEL
    return AAA5_SEPARATOR.join(sorted(numbers, key=_option_sort_key))


def parse_aaa5(raw):
    """AAA5 '1|2|3|4' → {'1','2','3','4'}. 비어 있으면 옵션 없음(빈 집합). 앞자리 0 은 무시한다('04' → '4')."""
    if _is_blank(raw):
        return set()
    numbers = set()
    for token in str(raw).split(AAA5_SEPARATOR):
        token = token.strip()
        if not token:
            continue
        numbers.add(str(int(token)) if token.isdigit() else token)
    return numbers


def selected_map_options(detail):
    """문서 detail 에서 적용된 Map Option 번호 집합. 필드가 없는(구 문서) 옵션은 미적용으로 본다."""
    return {
        number for number, (field, applied) in MAP_OPTION_FIELDS.items()
        if str(detail.get(field) or '').strip() == applied
    }


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


# claude 수정 (2026-11-13): Map Option ↔ AAA5 검증 항목 추가(불일치는 보류)
def check_map_options_aaa5(detail, entry):
    """Map Option ↔ AAA5.

    - AAA5('1|2|3|4')의 번호 집합과 문서에서 적용된 Map Option 번호 집합이 정확히 같으면 합의, 다르면 보류.
      AAA5 가 비어 있으면 옵션 없음(빈 집합)이다 — 문서에 옵션이 하나라도 있으면 불일치.
    - CLONE/EXISTING 은 화면에서 4번(TSV)만 고를 수 있으므로 4번만 비교한다.
    - 반려하지 않는다. 보류는 RS 를 대기로 두고 R 에게 알린 뒤 다음 주기에 다시 판정한다.
    """
    expected = parse_aaa5(entry.AAA5)
    selected = selected_map_options(detail)
    map_type = str(detail.get('map_type') or '').strip()
    scope_note = ''
    if map_type in MAP_TYPES_REGISTERED:
        editable = set(MAP_OPTIONS_EDITABLE_WHEN_REGISTERED)
        expected &= editable
        selected &= editable
        scope_note = f" ({map_type}: {_format_options(editable)}번만 비교)"
    if expected == selected:
        return True, ''
    return CHECK_HOLD, (
        f"Map Option 요청서 {_format_options(selected)} ↔ AAA5 {_format_options(expected)}{scope_note}"
    )


# claude 수정 (2026-11-13): MAP 목적 CLONE ↔ AAA6 검증 항목 추가(불일치는 보류)
def check_clone_aaa6(detail, entry):
    """MAP 목적 CLONE ↔ AAA6.

    - MAP 목적이 CLONE 이 아니면 검증할 것이 없으므로 합의.
    - CLONE 이면 AAA6 에 값이 있으면 합의, 비어 있으면 보류(CLONE 이 맞지 않음).
    """
    if str(detail.get('map_type') or '').strip() != MAP_TYPE_CLONE:
        return True, ''
    if not _is_blank(entry.AAA6):
        return True, ''
    return CHECK_HOLD, f"MAP 목적 '{MAP_TYPE_CLONE}' ↔ AAA6 없음"


# 검증 항목 목록 — MAP 정보 검증을 추가할 때 여기에 함수를 더한다.
CHECKS = (check_num_check_aaa4, check_map_options_aaa5, check_clone_aaa6)


# claude 수정 (2026-11-13): 보류 판정 추가 — 종합 순서 반려 > 보류 > 대기 > 합의
def evaluate_document(document):
    """문서의 MAP 정보를 검증한다(문서 상태는 보지 않는다).

    반환: None(아직 판정할 수 없음) 또는 {'result': 'approved'|'rejected'|'hold', 'comment': 단계 의견}.
    종합: 반려 항목이 있으면 반려(값이 없는 항목이 있어도 결론은 반려) > 보류 항목이 있으면 보류 >
    값이 없는 항목이 있으면 None(대기) > 모두 합의면 합의.
    """
    detail = (document.get_detail().get('detail') or {})
    line = str(detail.get('line') or '').strip()
    product = str(detail.get('partid_selection') or '').strip()
    entry = find_map_name_entry(line, product)
    if entry is None:
        return None

    reasons = []
    hold_reasons = []
    waiting = False
    for check in CHECKS:
        outcome = check(detail, entry)
        if outcome is None:
            waiting = True
            continue
        ok, reason = outcome
        if ok == CHECK_HOLD:
            hold_reasons.append(reason)
        elif not ok:
            reasons.append(reason)

    if reasons:
        return {
            'result': RESULT_REJECT,
            'comment': f'{REJECT_COMMENT_PREFIX} {REJECT_REASON_SEPARATOR.join(reasons)}',
        }
    if hold_reasons:
        return {
            'result': RESULT_HOLD,
            'comment': f'{HOLD_COMMENT_PREFIX} {REJECT_REASON_SEPARATOR.join(hold_reasons)}',
        }
    if waiting:
        return None
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


def _hold_mail_already_sent(document, step):
    """이 RS 단계에 대해 보류 확인 요청 메일을 이미 적재했는가(RS 단계당 1번만 보낸다)."""
    qs = MailNotification.objects.filter(document=document, event_type=mailer.SYSTEM_R_HOLD_EVENT)
    if step.created_at is not None:
        qs = qs.filter(created_at__gte=step.created_at)
    return qs.exists()


def _apply_hold(document, step, comment):
    """보류: RS 는 pending 그대로, 단계 의견만 보류 사유로 바꾸고 첫 보류일 때만 R 에게 메일을 보낸다."""
    if step.comment != comment:
        step.comment = comment
        step.save(update_fields=['comment'])
    if not _hold_mail_already_sent(document, step):
        mailer.enqueue_system_r_hold(document, comment)


def _clear_stale_hold(step):
    """보류가 풀렸는데 다른 항목이 아직 대기면, 지난 보류 사유가 남아 있지 않게 지운다."""
    if (step.comment or '').startswith(HOLD_COMMENT_PREFIX):
        step.comment = ''
        step.save(update_fields=['comment'])


# claude 수정 (2026-11-13): 보류 판정 처리 추가 — RS 대기 유지 + 보류 의견 + R 확인 요청 메일(단계당 1번)
def judge_document(document_id):
    """문서를 잠그고 RS 를 판정한다. 합의·반려·보류했으면 그 결과('approved'|'rejected'|'hold'), 아니면 None.

    건너뛰는 경우: 진행 중(under_review)이 아님 · 철회/중단 요청 확인 대기 중 · 현재 회차에 대기 RS 없음 ·
    아직 판정할 수 없음(제품 이름 행 없음 / 항목 값 없음).
    보류(hold)는 RS 를 대기로 두므로 다음 주기에 다시 판정되고, 그동안 매 주기 'hold' 를 돌려준다.
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
            _clear_stale_hold(step)
            return None
        if verdict['result'] == RESULT_HOLD:
            _apply_hold(document, step, verdict['comment'])
            logger.info(f"[system_r] 문서 {document_id} System R 보류 — {verdict['comment']}")
            return RESULT_HOLD

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
