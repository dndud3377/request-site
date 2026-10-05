"""J/O-layer 'SD 첫 숫자 ↔ Layer 일치' 상신 검증.

J-layer/O-layer 행의 `sd`(화면 헤더 "SD")는 보통 "1000.123 월평동 지점" 처럼 맨 앞에 숫자가 오고
뒤에 글이 이어진다. 그 맨 앞 숫자(`1000.123`)가 같은 행의 `layerid`(헤더 "Layer")와 다르면
상신할 수 없다. 단, 무조건 막을 수는 없으므로 `LayerSdException` 에 등록된 예외
(process_id, sp, SD 첫 숫자, layerid 가 모두 같은 행)는 통과시킨다.

프론트 `RequestPage/helpers.ts` 의 `extractSdNumber`/`findLayerSdMismatches` 와 같은 규칙이어야 한다 —
화면에서 막히지 않는데 서버에서 막히거나 그 반대가 되면 안 된다.

검사 대상 행: 비활성(st=='X')이 아니고, new_or_copy 가 기등록/layer삭제/미진행이 아니며,
SD 가 숫자로 시작하고, layerid 가 비어 있지 않은 행. SD 가 숫자로 시작하지 않는 행은 비교할
값이 없으므로 통과한다.
"""
import re

from .models import LayerSdException

# SD 맨 앞 숫자 — "1000.123 월평동" → "1000.123". 앞 공백은 무시하고, 숫자로 시작하지 않으면 매치되지 않는다.
SD_NUMBER_PATTERN = re.compile(r'^\s*(\d+(?:\.\d+)*)')

INACTIVE_ST = 'X'
NOC_SPECIAL = ('기등록', 'layer삭제', '미진행')

TABLE_ROW_KEYS = {'J': 'jayerRows', 'O': 'oayerRows'}
TABLE_LABELS = {'J': 'J-layer', 'O': 'O-layer'}
# 오류 메시지에 예시로 나열하는 불일치 행 수 상한 — 초과분은 '외 N건' 으로 줄인다.
MAX_LISTED_ROWS = 3


def _text(value):
    return str(value or '').strip()


def extract_sd_number(sd):
    """SD 값의 맨 앞 숫자 문자열을 돌려준다. 숫자로 시작하지 않으면 ''."""
    match = SD_NUMBER_PATTERN.match(str(sd or ''))
    return match.group(1) if match else ''


def exception_keys(table):
    """해당 표(J/O)의 예외 (process_id, sp, sd_number, layerid) 집합."""
    return set(
        LayerSdException.objects.filter(table=table)
        .values_list('process_id', 'sp', 'sd_number', 'layerid')
    )


def find_mismatches(rows, exceptions):
    """행 목록에서 SD 첫 숫자와 layerid 가 다르고 예외도 아닌 행을 골라 돌려준다.

    exceptions 는 `exception_keys()` 결과. 반환: [{'id', 'process_id', 'sp', 'sd', 'sd_number', 'layerid'}].
    """
    mismatches = []
    for row in rows or []:
        if _text(row.get('st')) == INACTIVE_ST or row.get('new_or_copy') in NOC_SPECIAL:
            continue
        sd_number = extract_sd_number(row.get('sd'))
        layerid = _text(row.get('layerid'))
        if not sd_number or not layerid or sd_number == layerid:
            continue
        key = (_text(row.get('process_id')), _text(row.get('sp')), sd_number, layerid)
        if key in exceptions:
            continue
        mismatches.append({
            'id': row.get('id'),
            'process_id': key[0],
            'sp': key[1],
            'sd': _text(row.get('sd')),
            'sd_number': sd_number,
            'layerid': layerid,
        })
    return mismatches


def validate_document(document):
    """문서의 J/O-layer 표를 검사한다. 문제 있으면 error 문자열, 없으면 None.

    Only MAP·MAP 삭제·ADI CD 변경은 작성 화면에 J/O-layer 표가 없으므로 검사하지 않는다
    (`layer_drift.compute_document_layer_drift` 와 같은 제외 기준).
    """
    if document.is_only_map() or document.is_map_delete_edit() or document.is_adi_cd_change():
        return None
    data = document.get_detail()
    errors = []
    for table, rows_key in TABLE_ROW_KEYS.items():
        mismatches = find_mismatches(data.get(rows_key) or [], exception_keys(table))
        if not mismatches:
            continue
        listed = '; '.join(
            f"Process {m['process_id'] or '-'} / SP {m['sp'] or '-'}: SD {m['sd_number']} ≠ Layer {m['layerid']}"
            for m in mismatches[:MAX_LISTED_ROWS]
        )
        extra = len(mismatches) - MAX_LISTED_ROWS
        suffix = f' 외 {extra}건' if extra > 0 else ''
        owner = 'J(TE_J)/P(TE_P)' if table == 'J' else 'O(TE_O)/P(TE_P)'
        errors.append(
            f'{TABLE_LABELS[table]} {len(mismatches)}행의 SD 첫 숫자가 Layer 와 일치하지 않습니다 '
            f'({listed}{suffix}). 예외가 필요하면 {owner} 팀에 예외 등록을 요청하세요.'
        )
    if errors:
        return ' '.join(errors) + ' 일치하지 않는 행이 있어 상신할 수 없습니다.'
    return None
