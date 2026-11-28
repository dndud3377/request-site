"""의뢰서 생성 payload 빌더 — 화면(RequestPage)이 만드는 것과 같은 모양으로 만든다.

- 제목: `{line}({목적})_MAP({map_type})_{조합법}_{제품}_{process_id}_{Step 또는 요청서}_{YYMMDD}`
  (`RequestPage/index.tsx` `buildEnrichedForm` 과 동일 규칙 — 사용자가 화면에서 만든 제목과
  같은 형태로 목록에 보여야 하므로 테스트 접두사 같은 걸 붙이지 않는다.
  `{Step 또는 요청서}` 는 흐름도 중 문서의 라인/제품/조리법과 같은 행의 Step(`[10~20][90~100]`),
  없으면 '요청서'. 러너는 기본으로 흐름도를 채우지 않으므로 보통 '요청서' 다.)
- `additional_notes`: `{jayerRows, oayerRows, bbRows, detail}` JSON 문자열.
  결재 라우팅이 실제로 읽는 키만 정확히 채우고, 나머지는 화면 기본값과 같은 형태로 둔다.
"""

import datetime
import json

from .masterdata import DEV_MAIL_DOMAIN, matches_np_keyword

# 프론트 constants.ts 와 같은 값 (백엔드 RequestDocument 상수와도 일치해야 한다)
PURPOSE_NEW = '신규'
ONLY_MAP_PURPOSE = 'Only MAP'
MAP_DELETE_EDIT_PURPOSE = 'MAP 삭제'
# claude 수정 (2026-10-15): 상세 목적 'Overlay 변경' → 'Overlay만 변경' 저장값 변경 (구 값은 백엔드가 계속 인정)
OTHER_PURPOSE_OVERLAY = 'Overlay만 변경'
OTHER_PURPOSE_LAB = '연구소 제품'
EA_NO_CHANGE = '변경 없음'
EA_HAS_CHANGE = '변경 있음'
EA_DEFAULT_NORMAL = '300'
EA_DEFAULT_PRODC = '500'

NOC_NEW = '신규'          # bb 매핑 검증 대상이 되는 일반 행
NOC_REGISTERED = '기등록'  # 매핑 검증에서 제외되는 특수 행
# claude 수정 (2026-11-16): '자동 미진행' 키워드 행에 화면이 넣는 값(프론트 constants.ts ST_X / NOC_NOT_PROCEEDING)
ST_X = 'X'
NOC_NOT_PROCEEDING = '미진행'

MAP_TYPE_NEW = 'NEW'

# 프론트 constants.ts 의 TITLE_DEFAULT_LABEL 과 같은 값 — 제목의 `_{라벨}_YYMMDD` 구간 기본값
TITLE_DEFAULT_LABEL = '요청서'


def _flow_step_part(detail):
    """흐름도 행 중 문서의 라인/제품/조리법과 같은 행의 Step 을 `[10~20][90~100]` 로 잇는다(없으면 '').

    프론트 `helpers.ts` 의 `buildFlowStepTitlePart` 와 같은 규칙이다.
    """
    ref = (detail['line'], detail['partid_selection'], detail['process_id'])
    parts = []
    for row in detail.get('flow_chart') or []:
        if (row.get('location'), row.get('product_name'), row.get('process_id')) != ref:
            continue
        step_from, step_to = row.get('step_from') or '', row.get('step_to') or ''
        step = f'{step_from}~{step_to}' if step_from and step_to else (step_from or step_to)
        if step:
            parts.append(f'[{step}]')
    return ''.join(parts)


def _title(detail, when=None):
    d = when or datetime.date.today()
    purpose_part = detail['request_purpose']
    if detail.get('other_purpose'):
        joined = ''.join(f'[{o}]' for o in detail['other_purpose'])
        purpose_part = f"{detail['request_purpose']}-{joined}"
    date_str = f'{str(d.year)[2:]}{d.month:02d}{d.day:02d}'
    return (f"{detail['line']}({purpose_part})_MAP({detail['map_type']})_"
            f"{detail['process_selection']}_{detail['partid_selection']}_"
            f"{detail['process_id']}_{_flow_step_part(detail) or TITLE_DEFAULT_LABEL}_{date_str}")


def _jayer_rows(combo, plel_required, row_limit=5):
    """JOB FILE layer 조회 결과를 화면과 같은 매핑으로 J-layer 행으로 만든다."""
    rows = []
    source = combo.layer_rows[:row_limit]
    if plel_required:
        # plel 이 든 행이 반드시 포함되도록 앞으로 당긴다(E 단계 생성 조건).
        plel_rows = [r for r in combo.layer_rows if 'plel' in (r.get('recipeid') or '').lower()]
        source = (plel_rows[:1] + [r for r in combo.layer_rows if r not in plel_rows])[:row_limit]
    for idx, item in enumerate(source, start=1):
        rows.append({
            'id': f'J_{idx}',
            'updated': item.get('updated', ''),
            'sortOrder': idx,
            'process_id': item.get('processid', ''),
            'sp': item.get('stepseq', ''),
            'sd': item.get('descript', ''),
            'pp': item.get('recipeid', ''),      # ← E(MASK) 판정에 쓰이는 값
            'layerid': item.get('layerid', ''),
            'st': 'O',
            'new_or_copy': NOC_NEW,
            'product_name': combo.product,
            'step': item.get('stepseq', ''),
            'item_id': item.get('layerid', ''),
            'loaded': True,
        })
    return rows


def _oayer_rows(combo, row_limit=3):
    rows = []
    for idx, item in enumerate(combo.ovl_rows[:row_limit], start=1):
        rows.append({
            'id': f'O_{idx}',
            'updated': item.get('updated', ''),
            'sortOrder': idx,
            'process_id': item.get('processid', ''),
            'sp': item.get('stepseq', ''),
            'sd': item.get('descript', ''),
            'pp': item.get('recipeid', ''),
            'layerid': item.get('layerid', ''),
            'st': 'O',
            'new_or_copy': NOC_NEW,
            'product_name': combo.product,
            'step': item.get('stepseq', ''),
            'loaded': True,
        })
    return rows


# claude 수정 (2026-11-28): 화면 '다음'·'상신'과 같이 키워드 행을 ST X + 미진행으로 바꾼다(제품 이름·STEP·ID 비움) — 프론트 함수 참조를 applyNpRules 로 갱신
def _apply_np_keywords(rows, words, has_item_id):
    """SD·PP 가 키워드를 포함한 행을 ST 'X' + 요청 기준 '미진행'으로 바꾼다 — 프론트 index.tsx applyNpRules 와 같다."""
    for row in rows:
        if matches_np_keyword(words, row.get('sd'), row.get('pp')):
            row.update({'st': ST_X, 'new_or_copy': NOC_NOT_PROCEEDING, 'product_name': '', 'step': ''})
            if has_item_id:
                row['item_id'] = ''
    return rows


# claude 수정 (2026-11-16): ST X 행은 화면처럼 bb 매핑 대상에서 뺀다(키워드 행 포함)
def _bb_rows(jayer_rows, mapped=True):
    """J-layer 행마다 대응하는 Bb 행. mapped=False 면 매핑을 비워 상신 차단(S-06)을 유도한다."""
    if not mapped:
        return []
    jayer_rows = [r for r in jayer_rows if r.get('st') != ST_X]
    return [{
        'id': f'B_{i}',
        'sourceJayerRowId': row['id'],
        'sortOrder': i,
        'disabled': False,
        'process_id': row['process_id'],
        'ss': row['sp'],
        'bb_step': row['sd'],
        'layerid': row['layerid'],
        'product_name': row['product_name'],
    } for i, row in enumerate(jayer_rows, start=1)]


def build_document(combo, requester, *,
                   request_purpose=PURPOSE_NEW,
                   other_purpose=(),
                   plel=False,
                   only_prodc='No',
                   ea_change=EA_NO_CHANGE,
                   ea_value=None,
                   sales_agreers=(),
                   sales_agreer_none_reason='',
                   post_approvers=(),
                   notifiers=(),
                   bb_mapped=True,
                   broken_json=False,
                   map_type=MAP_TYPE_NEW,
                   extra_detail=None,
                   all_rows=False,
                   np_apply=True,
                   empty_jayer=False,
                   empty_oayer=False):
    """POST /api/documents/ 에 보낼 payload 를 만든다.

    combo: masterdata.Combo (실제 DB 값), requester: {'loginid','name','mail'}
    (2026-11-16 Case V) all_rows: 마스터 행 전부를 그대로 싣는다(표 전체가 키워드 행이면 J/O 생략 조건이 된다) /
    np_apply: 키워드 행을 화면처럼 X·미진행으로 바꾼다(False 면 서버 검증 400 을 유도) /
    empty_jayer·empty_oayer: 그 표를 빈 채로 상신한다.
    반환: dict payload
    """
    # claude 수정 (2026-11-16): Case V 옵션(all_rows·np_apply·empty_jayer·empty_oayer) 추가
    j_limit = len(combo.layer_rows) if all_rows else 5
    o_limit = len(combo.ovl_rows) if all_rows else 3
    jayer = [] if empty_jayer else _jayer_rows(combo, plel_required=plel, row_limit=j_limit)
    if not plel and not all_rows:
        # plel 키워드가 든 행을 빼서 E(MASK) 단계가 생기지 않게 한다(전체 행 모드는 마스터와 같아야 하므로 빼지 않는다).
        jayer = [r for r in jayer if 'plel' not in (r.get('pp') or '').lower()] or jayer
    oayer = [] if empty_oayer else _oayer_rows(combo, row_limit=o_limit)
    if np_apply:
        _apply_np_keywords(jayer, combo.np_keywords['J'], has_item_id=True)
        _apply_np_keywords(oayer, combo.np_keywords['O'], has_item_id=False)

    detail = {
        'request_purpose': request_purpose,
        'other_purpose': list(other_purpose),
        'line': combo.line,
        'process_selection': combo.process,
        'partid_selection': combo.product,
        'process_id': combo.process_id,
        'map_type': map_type,
        'only_prodc': only_prodc,
        'ea_change': ea_change,
        'ea_value': ea_value if ea_value is not None else (
            EA_DEFAULT_PRODC if only_prodc == 'Yes' else EA_DEFAULT_NORMAL),
        'sales_agreers': [{'loginid': u['loginid'], 'name': u.get('name', '')} for u in sales_agreers],
        'post_approvers': [{'loginid': u['loginid'], 'name': u.get('name', '')} for u in post_approvers],
        'notifiers': [{'loginid': u['loginid'], 'name': u.get('name', '')} for u in notifiers],
        'customer_name': '결재 경우의 수 검증',
        'customer_requirement': '개발환경 케이스 러너가 생성한 의뢰서',
    }
    if sales_agreer_none_reason:
        detail['sales_agreer_none_reason'] = sales_agreer_none_reason
    if extra_detail:
        detail.update(extra_detail)

    notes = {
        'jayerRows': jayer,
        'oayerRows': oayer,
        'bbRows': _bb_rows(jayer, mapped=bb_mapped),
        'detail': detail,
    }
    additional_notes = '{"detail": broken' if broken_json else json.dumps(notes, ensure_ascii=False)

    # 의뢰자 정보는 로그인한 개발용 계정의 실제 값(@company.com)을 그대로 쓴다.
    # 계정에 메일이 비어 있을 때만 같은 도메인으로 채운다(다른 도메인을 만들어 내지 않는다).
    return {
        'title': _title(detail),
        'requester_name': requester.get('name') or requester['loginid'],
        'requester_email': (requester.get('mail')
                            or f"{requester['loginid']}{DEV_MAIL_DOMAIN}"),
        'requester_department': requester.get('deptname') or 'DEV',
        'product_name': combo.product,
        'reference_materials': '',
        'additional_notes': additional_notes,
    }
