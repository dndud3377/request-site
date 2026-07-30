"""연간 디자인룰별 의뢰 통계 집계.

홈 화면 그래프(`AnnualDesignRuleChart`)가 쓰는 순수 집계 로직을 views.py 에서
분리한다. DRF 액션은 이 모듈의 `annual_stats()` 를 호출만 하므로 테스트에서
HTTP 없이 집계 규칙만 직접 검증할 수 있다.

집계 규칙 (docs/HOME_STATS.md 와 동기화 필수):

1. 대상 — `status='approved'` 이고 `submitted_at` 이 있는 의뢰서.
   연도는 `submitted_at` 의 **로컬(Asia/Seoul) 기준 연도**.
2. 조합법 — `additional_notes` JSON 의 `detail.process_selection`.
3. 디자인룰 판정 우선순위
   ① 의뢰서 단위 수동 매핑(`DocumentDesignRuleOverride`)
   ② 조합법 단위 수동 매핑(`ProcessDesignRuleOverride`)
   ③ `DesignRule` 마스터에서 **단일** 매칭
   ④ 그 외 전부 미분류
   ③ 에서 한 조합법이 서로 다른 디자인룰 2개 이상에 걸리면 판정이 모호하므로
   미분류로 보내고 MASTER 가 직접 고르게 한다.
   ①②③ 으로 매칭된 값이라도 숫자로 해석되지 않아 나노 표시(`_to_nano_label`)를
   만들 수 없으면 미분류로 보낸다 — X축 막대명이 항상 "N나노" 형태이길 보장한다.
4. 상위 N — **기준 연도** 건수 내림차순. N 밖은 `기타` 하나로 합산하고,
   `미분류` 는 기타와 합치지 않고 항상 별도 버킷으로 유지한다.
5. 요청 목적 — `detail.request_purpose`. 정해진 5종 밖이거나 비면 `기타`.
6. 표시 — X축/표/드릴다운의 디자인룰명은 `값(마이크론) × 1000` 을 "N나노" 로 표시한다
   (예: `0.13` → `130나노`). 서버 저장·매칭에 쓰이는 실제 값(`key`)은 원본 문자열
   그대로 유지되고, `label` 만 표시용으로 변환된다.
"""
import json
from collections import defaultdict
from datetime import datetime

from django.db.models import Max, Min
from django.utils import timezone

from .models import (
    RequestDocument, DesignRule, ProcessDesignRuleOverride, DocumentDesignRuleOverride,
)

# 버킷 종류 — 프론트가 i18n 라벨을 붙일 수 있도록 key 와 kind 를 함께 내려준다.
KIND_RULE = 'rule'
KIND_ETC = 'etc'
KIND_UNCLASSIFIED = 'unclassified'

ETC_KEY = '__etc__'
UNCLASSIFIED_KEY = '__unclassified__'

# 요청 목적 — frontend `RequestPage/constants.ts` 의 OPTION_REQUEST_PURPOSE 와 동일 순서.
# ⚠️ 프론트 목록을 수정하면 이 목록도 함께 갱신해야 한다.
REQUEST_PURPOSES = ('신규', '차용', '신규+차용', 'Only MAP', '기타')
FALLBACK_PURPOSE = '기타'

DEFAULT_TOP_N = 10
# 그래프가 감당 가능한 상한. 프론트 드롭다운(10/20/30) 최대값과 맞춘다.
MAX_TOP_N = 30

# 증감 상태 — 비교 연도 대비 기준 연도의 변화
DELTA_UP = 'up'
DELTA_DOWN = 'down'
DELTA_FLAT = 'flat'
DELTA_NEW = 'new'      # 비교 연도 0건 → 기준 연도 발생 (0 나누기 방지)


def _local_year_range(year):
    """해당 연도의 로컬(Asia/Seoul) 시작·끝 경계를 aware datetime 으로 반환.

    `[start, end)` 반열린 구간이라 12/31 23:59:59.999 도 누락되지 않는다.
    """
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime(year, 1, 1), tz)
    end = timezone.make_aware(datetime(year + 1, 1, 1), tz)
    return start, end


def _approved_queryset():
    """집계 대상 기본 쿼리셋 — 승인 완료 + 상신일 보유."""
    return RequestDocument.objects.filter(
        status='approved', submitted_at__isnull=False
    )


def build_process_design_rule_map():
    """조합법 → 디자인룰 확정 매핑과, 판정이 모호한 조합법 집합을 반환.

    반환: `(resolved, ambiguous)`
    - `resolved`: {조합법: 디자인룰} — 단일 매칭이거나 수동 매핑으로 확정된 것
    - `ambiguous`: {조합법, ...} — 마스터에서 2개 이상 디자인룰에 걸려 미확정

    수동 매핑(`ProcessDesignRuleOverride`)은 마스터를 덮어쓰므로, 모호했던
    조합법도 수동 매핑이 있으면 확정으로 승격된다.
    """
    by_process = defaultdict(set)
    for process, design_rule in DesignRule.objects.values_list('process', 'design_rule'):
        key = (process or '').strip()
        value = (design_rule or '').strip()
        if key and value:
            by_process[key].add(value)

    resolved = {p: next(iter(rules)) for p, rules in by_process.items() if len(rules) == 1}
    ambiguous = {p for p, rules in by_process.items() if len(rules) > 1}

    for process, design_rule in ProcessDesignRuleOverride.objects.values_list('process', 'design_rule'):
        key = (process or '').strip()
        value = (design_rule or '').strip()
        if key and value:
            resolved[key] = value
            ambiguous.discard(key)

    return resolved, ambiguous


def _document_overrides():
    """{의뢰서 id: 디자인룰} 의뢰서 단위 수동 매핑."""
    return {
        doc_id: (rule or '').strip()
        for doc_id, rule in DocumentDesignRuleOverride.objects.values_list('document_id', 'design_rule')
        if (rule or '').strip()
    }


def _parse_detail(additional_notes):
    """`additional_notes` JSON 의 `detail` 딕셔너리. 손상 시 빈 dict."""
    try:
        data = json.loads(additional_notes or '{}')
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    detail = data.get('detail')
    return detail if isinstance(detail, dict) else {}


def _normalize_purpose(raw):
    """요청 목적을 정해진 5종으로 정규화. 밖이거나 비면 `기타`."""
    value = (raw or '').strip()
    return value if value in REQUEST_PURPOSES else FALLBACK_PURPOSE


def _empty_purposes():
    return {purpose: 0 for purpose in REQUEST_PURPOSES}


def _to_nano_label(value):
    """디자인룰 값(마이크론 단위 문자열)을 나노 표시 라벨로 변환한다.

    `값 × 1000` 을 불필요한 0을 제거한 형태로 "…나노" 로 반환한다
    (예: "0.001" → "1나노", "0.13" → "130나노"). 숫자로 파싱할 수 없으면
    `None` — 호출부가 이를 미분류로 보낼지 판단한다.
    """
    try:
        nm = float(value.strip()) * 1000
    except (TypeError, ValueError, AttributeError):
        return None
    text = f'{nm:.6f}'.rstrip('0').rstrip('.')
    return f'{text}나노'


def _collect_year(year, resolved, doc_overrides):
    """한 연도의 {디자인룰 키: {목적: 건수}} 를 집계한다.

    미분류는 `UNCLASSIFIED_KEY` 로 모인다. 조합법/의뢰서 매핑으로 디자인룰이
    확정됐더라도 그 값이 숫자로 해석되지 않아 나노 표시를 만들 수 없으면
    미분류로 보낸다(`docs/HOME_STATS.md` 판정 우선순위 3번 참조).
    """
    start, end = _local_year_range(year)
    rows = _approved_queryset().filter(
        submitted_at__gte=start, submitted_at__lt=end
    ).only('id', 'additional_notes').values_list('id', 'additional_notes')

    counts = defaultdict(_empty_purposes)
    for doc_id, notes in rows:
        detail = _parse_detail(notes)
        purpose = _normalize_purpose(detail.get('request_purpose'))

        rule = doc_overrides.get(doc_id)
        if not rule:
            process = (detail.get('process_selection') or '').strip()
            rule = resolved.get(process) if process else None

        if rule and _to_nano_label(rule) is None:
            rule = None

        counts[rule or UNCLASSIFIED_KEY][purpose] += 1
    return counts


def available_years():
    """승인 의뢰서가 실제로 존재하는 연도 목록(오름차순).

    MySQL 에서 tz 변환 date 조회(CONVERT_TZ)는 타임존 테이블이 적재돼 있어야
    동작하므로, 여기서는 min/max 만 구한 뒤 연도별 존재 여부를 범위 조회로
    확인한다 — 서버 타임존 설정에 의존하지 않는다.
    """
    bounds = _approved_queryset().aggregate(first=Min('submitted_at'), last=Max('submitted_at'))
    if not bounds['first'] or not bounds['last']:
        return []

    first_year = timezone.localtime(bounds['first']).year
    last_year = timezone.localtime(bounds['last']).year

    years = []
    for year in range(first_year, last_year + 1):
        start, end = _local_year_range(year)
        if _approved_queryset().filter(submitted_at__gte=start, submitted_at__lt=end).exists():
            years.append(year)
    return years


def _delta(base, compare):
    """증감률(%)과 상태. 비교 대상이 없으면 `(None, None)`."""
    if compare is None:
        return None, None
    if compare == 0:
        return (None, DELTA_NEW) if base > 0 else (None, DELTA_FLAT)
    pct = (base - compare) / compare * 100
    if abs(pct) < 0.05:
        return 0.0, DELTA_FLAT
    return round(pct, 1), (DELTA_UP if pct > 0 else DELTA_DOWN)


def _sum_purposes(purpose_maps):
    total = _empty_purposes()
    for purposes in purpose_maps:
        for key, value in purposes.items():
            total[key] += value
    return total


def annual_stats(year, compare_year=None, top_n=DEFAULT_TOP_N):
    """연간 디자인룰별 통계.

    인자
    - `year`: 기준 연도
    - `compare_year`: 비교 연도. None 이면 비교 필드가 모두 None 으로 내려간다.
    - `top_n`: 상위 N개. None 이면 전체를 개별 버킷으로 반환(기타 묶음 없음).

    반환 dict 는 그대로 API 응답 `data` 가 된다.
    """
    resolved, _ambiguous = build_process_design_rule_map()
    doc_overrides = _document_overrides()

    base_counts = _collect_year(year, resolved, doc_overrides)
    compare_counts = _collect_year(compare_year, resolved, doc_overrides) if compare_year else {}

    def total_of(counts, key):
        return sum(counts.get(key, {}).values()) if key in counts else 0

    # 미분류는 별도 버킷이므로 상위 N 경쟁에서 제외한다.
    rule_keys = {k for k in base_counts if k != UNCLASSIFIED_KEY}
    rule_keys |= {k for k in compare_counts if k != UNCLASSIFIED_KEY}

    # 기준 연도 건수 내림차순, 동률은 이름순(연도를 바꿔도 순서가 안정적이도록)
    ordered = sorted(rule_keys, key=lambda k: (-total_of(base_counts, k), k))

    if top_n is None:
        top_keys, rest_keys = ordered, []
    else:
        top_keys, rest_keys = ordered[:top_n], ordered[top_n:]

    buckets = []
    for key in top_keys:
        base_purposes = base_counts.get(key) or _empty_purposes()
        comp_purposes = compare_counts.get(key) or _empty_purposes()
        base_total = sum(base_purposes.values())
        comp_total = sum(comp_purposes.values()) if compare_year else None
        pct, state = _delta(base_total, comp_total)
        buckets.append({
            'key': key,
            'label': _to_nano_label(key),
            'kind': KIND_RULE,
            'member_count': 1,
            'count': base_total,
            'compare_count': comp_total,
            'delta_pct': pct,
            'delta_state': state,
            'purposes': base_purposes,
            'compare_purposes': comp_purposes if compare_year else None,
        })

    if rest_keys:
        base_purposes = _sum_purposes(base_counts.get(k) or _empty_purposes() for k in rest_keys)
        comp_purposes = _sum_purposes(compare_counts.get(k) or _empty_purposes() for k in rest_keys)
        base_total = sum(base_purposes.values())
        comp_total = sum(comp_purposes.values()) if compare_year else None
        pct, state = _delta(base_total, comp_total)
        buckets.append({
            'key': ETC_KEY,
            'label': '',           # 프론트에서 i18n 라벨을 붙인다
            'kind': KIND_ETC,
            'member_count': len(rest_keys),
            'count': base_total,
            'compare_count': comp_total,
            'delta_pct': pct,
            'delta_state': state,
            'purposes': base_purposes,
            'compare_purposes': comp_purposes if compare_year else None,
        })

    # 미분류는 0건이어도 버킷을 유지한다 — "정리할 게 없다"는 사실 자체가 정보다.
    uncl_base = base_counts.get(UNCLASSIFIED_KEY) or _empty_purposes()
    uncl_comp = compare_counts.get(UNCLASSIFIED_KEY) or _empty_purposes()
    uncl_base_total = sum(uncl_base.values())
    uncl_comp_total = sum(uncl_comp.values()) if compare_year else None
    pct, state = _delta(uncl_base_total, uncl_comp_total)
    buckets.append({
        'key': UNCLASSIFIED_KEY,
        'label': '',
        'kind': KIND_UNCLASSIFIED,
        'member_count': 0,
        'count': uncl_base_total,
        'compare_count': uncl_comp_total,
        'delta_pct': pct,
        'delta_state': state,
        'purposes': uncl_base,
        'compare_purposes': uncl_comp if compare_year else None,
    })

    return {
        'year': year,
        'compare_year': compare_year,
        'top': top_n,
        'available_years': available_years(),
        'purposes': list(REQUEST_PURPOSES),
        'buckets': buckets,
        'total': sum(b['count'] for b in buckets),
        'compare_total': (
            sum(b['compare_count'] or 0 for b in buckets) if compare_year else None
        ),
    }


# 미분류 사유 — 프론트가 i18n 문구를 고르는 데 쓴다.
REASON_MISSING = 'missing'          # 마스터에 조합법이 아예 없음
REASON_AMBIGUOUS = 'ambiguous'      # 디자인룰 2개 이상에 걸려 판정 모호
REASON_EMPTY = 'empty'              # 의뢰서에 조합법 값이 비어 있음
REASON_NON_NUMERIC = 'non_numeric'  # 매칭은 됐지만 값이 숫자가 아니라 나노 표시 불가


def design_rule_options():
    """수동 매핑 select 에 채울 디자인룰 후보 — 나노값 오름차순 `{value, label}` 목록.

    숫자로 변환되지 않는(나노 표시 불가) 마스터 값은 후보에서 제외한다 —
    골라도 다시 미분류로 돌아갈 뿐이라 혼란만 준다.
    """
    values = {
        (r or '').strip()
        for r in DesignRule.objects.values_list('design_rule', flat=True)
    }
    values |= {
        (r or '').strip()
        for r in ProcessDesignRuleOverride.objects.values_list('design_rule', flat=True)
    }

    options = []
    for value in values:
        if not value:
            continue
        label = _to_nano_label(value)
        if label is None:
            continue
        options.append((float(value.strip()) * 1000, value, label))
    options.sort(key=lambda item: item[0])
    return [{'value': value, 'label': label} for _nm, value, label in options]


def unclassified_targets(year=None):
    """미분류로 빠진 대상을 분류 모달용으로 정리해 반환한다.

    `year` 가 주어지면 해당 연도 승인 건만, 없으면 전체 승인 건을 대상으로 한다.
    조합법/의뢰서 매핑으로 디자인룰이 확정됐더라도 값이 숫자가 아니어서 나노
    표시를 만들 수 없으면(`REASON_NON_NUMERIC`) 여기 미분류 목록에도 함께 잡힌다.

    반환 dict
    - `processes`: 조합법 단위 정리 대상. 사유(`reason`)와, 모호한 경우
      마스터에 실제로 걸려 있는 후보(`candidates`)를 함께 준다.
    - `documents`: 의뢰서 단위 정리 대상(조합법이 비어 조합법 매핑으로는
      해결할 수 없는 건을 앞에 둔다). 모호한 경우 `candidates`도 함께 준다.
    - `design_rules`: select 후보 목록.
    """
    resolved, ambiguous = build_process_design_rule_map()
    doc_overrides = _document_overrides()

    qs = _approved_queryset()
    if year:
        start, end = _local_year_range(year)
        qs = qs.filter(submitted_at__gte=start, submitted_at__lt=end)

    # 모호한 조합법의 실제 후보 디자인룰 (MASTER 가 그중에서 고를 수 있도록)
    candidates = defaultdict(set)
    if ambiguous:
        for process, rule in DesignRule.objects.filter(
            process__in=list(ambiguous)
        ).values_list('process', 'design_rule'):
            key = (process or '').strip()
            value = (rule or '').strip()
            if key and value:
                candidates[key].add(value)

    process_counts = defaultdict(int)
    documents = []
    for doc_id, title, notes, submitted_at in qs.only(
        'id', 'title', 'additional_notes', 'submitted_at'
    ).values_list('id', 'title', 'additional_notes', 'submitted_at'):
        process = (_parse_detail(notes).get('process_selection') or '').strip()

        doc_rule = doc_overrides.get(doc_id)
        if doc_rule:
            if _to_nano_label(doc_rule) is not None:
                continue  # 의뢰서 단위로 숫자 값이 확정됨 — 분류 완료
            documents.append({
                'id': doc_id,
                'title': title,
                'process_selection': process,
                'submitted_at': submitted_at,
                'reason': REASON_NON_NUMERIC,
                'candidates': [],
            })
            continue

        rule = resolved.get(process) if process else None
        if process and rule:
            if _to_nano_label(rule) is not None:
                continue  # 조합법 매핑으로 숫자 값이 확정됨 — 분류 완료
            process_counts[process] += 1
            documents.append({
                'id': doc_id,
                'title': title,
                'process_selection': process,
                'submitted_at': submitted_at,
                'reason': REASON_NON_NUMERIC,
                'candidates': [],
            })
            continue

        if process:
            process_counts[process] += 1
        documents.append({
            'id': doc_id,
            'title': title,
            'process_selection': process,
            'submitted_at': submitted_at,
            'reason': REASON_AMBIGUOUS if process in ambiguous else (
                REASON_MISSING if process else REASON_EMPTY
            ),
            'candidates': sorted(candidates.get(process, ())) if process in ambiguous else [],
        })

    processes = [
        {
            'process': process,
            'count': count,
            'reason': REASON_AMBIGUOUS if process in ambiguous else (
                REASON_NON_NUMERIC if resolved.get(process) else REASON_MISSING
            ),
            'candidates': sorted(candidates.get(process, ())),
        }
        for process, count in process_counts.items()
    ]
    processes.sort(key=lambda p: (-p['count'], p['process']))

    # 조합법이 빈 건(조합법 매핑으로 해결 불가)을 먼저, 그다음 최신 상신순
    documents.sort(key=lambda d: (d['process_selection'] != '', -(d['submitted_at'].timestamp())))

    return {
        'processes': processes,
        'documents': documents,
        'design_rules': design_rule_options(),
    }
