"""의뢰서 생성 payload 빌더 — 화면(RequestPage)이 만드는 것과 같은 모양으로 만든다.

- 제목: `{line}({목적})_MAP({map_type})_{조합법}_{제품}_{process_id}_요청서_{YYMMDD}`
  (`RequestPage/index.tsx` `buildEnrichedForm` 과 동일 규칙 — 사용자가 화면에서 만든 제목과
  같은 형태로 목록에 보여야 하므로 테스트 접두사 같은 걸 붙이지 않는다.)
- `additional_notes`: `{jayerRows, oayerRows, bbRows, detail}` JSON 문자열.
  결재 라우팅이 실제로 읽는 키만 정확히 채우고, 나머지는 화면 기본값과 같은 형태로 둔다.
"""

import datetime
import json

# 프론트 constants.ts 와 같은 값 (백엔드 RequestDocument 상수와도 일치해야 한다)
PURPOSE_NEW = '신규'
ONLY_MAP_PURPOSE = 'Only MAP'
MAP_DELETE_EDIT_PURPOSE = 'MAP 삭제'
OTHER_PURPOSE_OVERLAY = 'Overlay 변경'
OTHER_PURPOSE_LAB = '연구소 제품'
EA_NO_CHANGE = '변경 없음'
EA_HAS_CHANGE = '변경 있음'
EA_DEFAULT_NORMAL = '300'
EA_DEFAULT_PRODC = '500'

NOC_NEW = '신규'          # bb 매핑 검증 대상이 되는 일반 행
NOC_REGISTERED = '기등록'  # 매핑 검증에서 제외되는 특수 행

MAP_TYPE_NEW = 'NEW'


def _title(detail, when=None):
    d = when or datetime.date.today()
    purpose_part = detail['request_purpose']
    if detail.get('other_purpose'):
        joined = ''.join(f'[{o}]' for o in detail['other_purpose'])
        purpose_part = f"{detail['request_purpose']}-{joined}"
    date_str = f'{str(d.year)[2:]}{d.month:02d}{d.day:02d}'
    return (f"{detail['line']}({purpose_part})_MAP({detail['map_type']})_"
            f"{detail['process_selection']}_{detail['partid_selection']}_"
            f"{detail['process_id']}_요청서_{date_str}")


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
            'disabled': False,
            'manuallyDisabled': False,
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
            'disabled': False,
            'manuallyDisabled': False,
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


def _bb_rows(jayer_rows, mapped=True):
    """J-layer 행마다 대응하는 Bb 행. mapped=False 면 매핑을 비워 상신 차단(S-06)을 유도한다."""
    if not mapped:
        return []
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
                   extra_detail=None):
    """POST /api/documents/ 에 보낼 payload 를 만든다.

    combo: masterdata.Combo (실제 DB 값), requester: {'loginid','name','mail'}
    반환: dict payload
    """
    jayer = _jayer_rows(combo, plel_required=plel)
    if not plel:
        # plel 키워드가 든 행을 빼서 E(MASK) 단계가 생기지 않게 한다.
        jayer = [r for r in jayer if 'plel' not in (r.get('pp') or '').lower()] or jayer

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
        'oayerRows': _oayer_rows(combo),
        'bbRows': _bb_rows(jayer, mapped=bb_mapped),
        'detail': detail,
    }
    additional_notes = '{"detail": broken' if broken_json else json.dumps(notes, ensure_ascii=False)

    return {
        'title': _title(detail),
        'requester_name': requester.get('name') or requester['loginid'],
        'requester_email': requester.get('mail') or f"{requester['loginid']}@example.com",
        'requester_department': requester.get('deptname') or 'DEV',
        'product_name': combo.product,
        'reference_materials': '',
        'additional_notes': additional_notes,
    }
