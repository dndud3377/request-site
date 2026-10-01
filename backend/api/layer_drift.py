"""J-layer/O-layer/XXXXXX 자동 채움 값의 '변경 감지' — 마스터 DB(PhotoStepS*) 드리프트 계산.

배경: 요청서 작성 화면은 라인+조리법(process_id)을 고르면 `PhotoStepS{1,3,4,5}`(eqptype='PMAINF')/
`PhotoStepS{1,3,4,5}Ov`(eqptype='POVLAY')를 조회해 J-layer/O-layer 표의 sp(STEPSEQ)/sd(설명)/
pp(레시피ID)/layerid(Layer)를 자동으로 채운다(`views.py` form_options_job_file_layer/ovl_layer와
프론트 `RequestPage/index.tsx` fetchJobFileLayerAndPopulateJayer/fetchOvlLayerAndPopulateOayer).

상신 이후 마스터 DB 값이 바뀌면 문서에 저장된 값과 어긋날 수 있다. 이 모듈은 결재 진행중
문서의 저장값과 현재 마스터 DB 값을 stepseq(sp) 기준으로 비교해 값 변경/행 삭제/신규 행 추가를
감지하고, 결과를 RequestDocument.layer_drift_* 필드에 캐시한다(스케줄러 10분 주기 갱신 —
`scheduler.py` sync_rtdb_options() 끝에서 호출, docs/CHANGE_STATUS.md 와 같은 "지연 허용" 철학).

XXXXXX(`PhotoStepS{1,3,4,5}Cd`, eqptype 임시값)는 Jayer/Oayer와 달리 요청서에 사용자가 편집하는
표가 없어 "저장값"이 없다. 대신 상신 계열 액션(submit/resubmit/requester-resubmit/peer-submit)
시점에 마스터 DB 값을 `RequestDocument.extra_layer_snapshot`에 스냅샷으로 캡처해두고, 그 값을
저장값 대용으로 삼아 동일하게 비교한다(`capture_extra_layer_snapshot`/`reset_document_drift` 참고).
"""
import json
import logging

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from . import mailer, rejection_snapshots
from .models import (
    PhotoStepS1, PhotoStepS3, PhotoStepS4, PhotoStepS5,
    PhotoStepS1Ov, PhotoStepS3Ov, PhotoStepS4Ov, PhotoStepS5Ov,
    PhotoStepS1Cd, PhotoStepS3Cd, PhotoStepS4Cd, PhotoStepS5Cd,
    ApprovalStep, PauseRequest, RequestDocument, WithdrawRequest,
)

logger = logging.getLogger(__name__)

# views.py form_options_job_file_layer/ovl_layer 의 라인별 모델 매핑과 동일해야 한다.
JOB_FILE_MODEL_MAP = {
    'line1': PhotoStepS1, 'line3': PhotoStepS3, 'line4': PhotoStepS4, 'line5': PhotoStepS5,
}
OVL_MODEL_MAP = {
    'line1': PhotoStepS1Ov, 'line3': PhotoStepS3Ov, 'line4': PhotoStepS4Ov, 'line5': PhotoStepS5Ov,
}
# XXXXXX(임시값, STEP_EXTRA_EQPTYPE) 전용 — Jayer/Oayer와 달리 요청서에 사용자가 편집하는 표가
# 없어 "저장값"이 없다. 대신 상신 시점에 이 맵으로 조회한 결과를 RequestDocument.extra_layer_snapshot
# 에 캡처해두고, 그 스냅샷을 저장값 대용으로 삼아 드리프트를 비교한다(capture_extra_layer_snapshot 참고).
EXTRA_MODEL_MAP = {
    'line1': PhotoStepS1Cd, 'line3': PhotoStepS3Cd, 'line4': PhotoStepS4Cd, 'line5': PhotoStepS5Cd,
}

# 결재 진행중으로 보는 상태 — 완료(approved)·반려(rejected)·임시저장(draft)은 대상에서 뺀다.
IN_PROGRESS_STATUSES = ('submitted', 'under_review', 'pause')

# 자동 반려 대상 상태 — 중단(pause)도 포함한다. 철회 확인 대기 중인 문서는 상태와 무관하게
# auto_reject_document 에서 제외한다(배지만 띄우고, 철회가 취소되면 바로 재판정).
AUTO_REJECT_STATUSES = ('under_review', 'pause')

# 자동 반려 단계 의견 머리말은 mailer 가 '자동 반려 문서' 판별(메일 제목·수신자)에도 쓴다.
AUTO_REJECT_COMMENT_PREFIX = mailer.AUTO_REJECT_COMMENT_PREFIX
# 반려 이력(RejectionSnapshot)에 남기는 반려자 — (loginid, 이름). 사람이 누른 반려가 아니다.
SYSTEM_REJECTER = ('system', '시스템(자동반려)')

LAYER_KEYS = ('jayer', 'oayer', 'extra')
LAYER_LABELS = {'jayer': 'J-layer', 'oayer': 'O-layer', 'extra': 'XXXXXX'}
# 반려 사유(단계 의견)에 나열하는 변경 건수 상한 — 초과분은 '외 N건' 으로 줄인다.
AUTO_REJECT_COMMENT_MAX_ITEMS = 5


def _row_dict(item, line, process):
    return {
        'line': line,
        'process': process,
        'processid': item.processid,
        'stepseq': item.stepseq,
        'descript': item.descript,
        'recipeid': item.recipeid,
        'areaname': item.areaname or '',
        'layerid': item.layerid or '',
        'updated': item.updated or '',
    }


def get_job_file_layer_rows(line, process):
    """views.py form_options_job_file_layer 와 동일한 조회(eqptype='PMAINF', stepseq 오름차순)."""
    model = JOB_FILE_MODEL_MAP.get(line)
    if not model:
        return []
    queryset = model.objects.filter(eqptype='PMAINF', processid=process).order_by('stepseq')
    return [_row_dict(item, line, process) for item in queryset]


def get_ovl_layer_rows(line, process):
    """views.py form_options_ovl_layer 와 동일한 조회(eqptype='POVLAY', stepseq 오름차순)."""
    model = OVL_MODEL_MAP.get(line)
    if not model:
        return []
    queryset = model.objects.filter(eqptype='POVLAY', processid=process).order_by('stepseq')
    return [_row_dict(item, line, process) for item in queryset]


def get_extra_layer_rows(line, process):
    """views.py form_options_extra_layer 와 동일한 조회(eqptype=XXXXXX 임시값, stepseq 오름차순).

    eqptype 값은 scheduler.STEP_EXTRA_EQPTYPE(TODO: 실제 값 확정 전 임시값)을 그대로 재사용한다.
    scheduler.py 가 모듈 최상단에서 `from . import layer_drift` 를 하므로, 여기서 scheduler를
    모듈 최상단에서 import하면 순환 import가 된다 — 호출 시점에만 필요한 상수라 함수 내부에서
    지연 import한다.
    """
    from .scheduler import STEP_EXTRA_EQPTYPE
    model = EXTRA_MODEL_MAP.get(line)
    if not model:
        return []
    queryset = model.objects.filter(eqptype=STEP_EXTRA_EQPTYPE, processid=process).order_by('stepseq')
    return [_row_dict(item, line, process) for item in queryset]


def _saved_entry(stepseq, saved):
    """저장된 J/O-layer 행(sp/sd/pp/layerid)을 변경 현황(PhotoStepChangeRow)과 같은 모양으로 변환.

    저장된 행에는 areaname 이 없어(J/O-layer 표에 그 컬럼이 없다) 빈 값으로 채운다.
    """
    return {'stepseq': stepseq, 'descript': saved.get('sd', ''), 'recipeid': saved.get('pp', ''),
            'areaname': '', 'layerid': saved.get('layerid', '')}


def _live_entry(live):
    return {'stepseq': live['stepseq'], 'descript': live['descript'], 'recipeid': live['recipeid'],
            'areaname': live.get('areaname', ''), 'layerid': live['layerid']}


def _diff_rows(saved_rows, live_rows):
    """저장된 행 전체(자동채움 + 수동입력)와 현재 마스터 DB 행을 stepseq(sp) 기준으로 비교해
    `docs/CHANGE_STATUS.md`(변경 현황) 화면과 같은 {removed, added} 모양으로 반환한다.

    행 삭제(저장에는 있는데 DB에 없음)·신규 행 추가(DB에는 있는데 저장에 없음)는 각각 그대로
    removed/added 한 건씩이고, 값 변경(sd/pp/layerid)은 변경 현황과 동일하게 옛 값 removed +
    새 값 added 한 쌍으로 표현한다 — PhotoStepChangeLog 도 값이 바뀐 행을 이렇게 남긴다.
    """
    saved_by_seq = {row.get('sp'): row for row in saved_rows if row.get('sp')}
    live_by_seq = {row['stepseq']: row for row in live_rows if row.get('stepseq')}

    removed = []
    added = []
    for stepseq, saved in saved_by_seq.items():
        live = live_by_seq.get(stepseq)
        saved_entry = _saved_entry(stepseq, saved)
        if live is None:
            removed.append(saved_entry)
            continue
        live_entry = _live_entry(live)
        if (saved_entry['descript'], saved_entry['recipeid'], saved_entry['layerid']) \
                != (live_entry['descript'], live_entry['recipeid'], live_entry['layerid']):
            removed.append(saved_entry)
            added.append(live_entry)

    for stepseq, live in live_by_seq.items():
        if stepseq not in saved_by_seq:
            added.append(_live_entry(live))

    return {'removed': removed, 'added': added}


def _diff_snapshot_rows(saved_rows, live_rows):
    """상신 시점 스냅샷(saved_rows)과 현재 마스터 DB 값(live_rows)을 stepseq 기준으로 비교한다.

    XXXXXX(CD) 전용 — Jayer/Oayer의 `_diff_rows()`와 달리 saved_rows도 이미 `_row_dict()`와 같은
    포맷(stepseq/descript/recipeid/areaname/layerid)이라 `_saved_entry()` 같은 포맷 변환이 필요
    없다. 비교 값은 Jayer/Oayer와 동일하게 descript/recipeid/layerid 세 컬럼만 쓴다.
    """
    saved_by_seq = {row['stepseq']: row for row in saved_rows if row.get('stepseq')}
    live_by_seq = {row['stepseq']: row for row in live_rows if row.get('stepseq')}

    removed = []
    added = []
    for stepseq, saved in saved_by_seq.items():
        live = live_by_seq.get(stepseq)
        saved_entry = _live_entry(saved)
        if live is None:
            removed.append(saved_entry)
            continue
        live_entry = _live_entry(live)
        if (saved_entry['descript'], saved_entry['recipeid'], saved_entry['layerid']) \
                != (live_entry['descript'], live_entry['recipeid'], live_entry['layerid']):
            removed.append(saved_entry)
            added.append(live_entry)

    for stepseq, live in live_by_seq.items():
        if stepseq not in saved_by_seq:
            added.append(_live_entry(live))

    return {'removed': removed, 'added': added}


def compute_document_layer_drift(document, job_file_rows=None, ovl_rows=None, extra_rows=None):
    """문서 하나의 J-layer/O-layer/XXXXXX diff 를 계산한다. line/process_id 가 없으면 빈 결과.

    job_file_rows/ovl_rows/extra_rows 를 넘기면(배치 조회 결과) DB 를 다시 조회하지 않고 그대로
    쓴다 — recompute_all_in_progress 의 라인당 배치 조회 결과를 문서별로 재사용하기 위함.
    None 이면(단일 문서 호출부는 그대로) 기존처럼 문서 하나 기준으로 직접 조회한다.

    Only MAP·MAP 삭제 요청서는 검토 대상에서 제외한다 — 프론트가 이 두 목적에서는 J-layer/
    O-layer 표를 강제로 비우지만(작성 화면에 그 표 자체가 없다) line/process_id 는 그대로
    남아 있어, XXXXXX(CD) 구분만으로도 이 문서들에 '변경 감지' 배지가 뜰 수 있었다(2026-09).

    ADI CD 변경 요청서도 J-layer/O-layer 표가 없어(작성 화면에 렌더되지 않는다) 그 두 구분은
    비교하지 않고 XXXXXX(CD)만 비교한다(2026-09) — Only MAP·MAP 삭제(검토 자체를 제외)와 달리
    이 목적은 P·J 결재 단계가 실제로 존재하므로 XXXXXX 변경 감지는 계속 의미가 있다.
    """
    empty_group = {'removed': [], 'added': []}
    if document.is_only_map() or document.is_map_delete_edit():
        return {'jayer': dict(empty_group), 'oayer': dict(empty_group), 'extra': dict(empty_group)}

    data = document.get_detail()
    detail = data.get('detail', {}) or {}
    line = detail.get('line') or ''
    process = detail.get('process_id') or ''
    if not line or not process:
        return {'jayer': dict(empty_group), 'oayer': dict(empty_group), 'extra': dict(empty_group)}

    skip_jayer_oayer = document.is_adi_cd_change()

    if skip_jayer_oayer:
        jayer_diff = dict(empty_group)
        oayer_diff = dict(empty_group)
    else:
        # 자동채움(loaded=true) 행뿐 아니라 수동 입력 행(loaded=false)도 비교 대상에 포함한다(2026-09).
        jayer_saved = data.get('jayerRows') or []
        oayer_saved = data.get('oayerRows') or []
        if job_file_rows is None:
            job_file_rows = get_job_file_layer_rows(line, process)
        if ovl_rows is None:
            ovl_rows = get_ovl_layer_rows(line, process)
        jayer_diff = _diff_rows(jayer_saved, job_file_rows)
        oayer_diff = _diff_rows(oayer_saved, ovl_rows)

    if extra_rows is None:
        extra_rows = get_extra_layer_rows(line, process)

    if document.extra_layer_snapshot:
        try:
            extra_saved = json.loads(document.extra_layer_snapshot)
        except (json.JSONDecodeError, TypeError):
            extra_saved = []
        extra_diff = _diff_snapshot_rows(extra_saved, extra_rows)
    else:
        # 스냅샷을 한 번도 캡처한 적 없는 문서(이 기능이 생기기 전에 이미 상신된 문서) — 빈
        # 문자열은 "캡처했는데 0건이었다"(그 경우엔 capture_extra_layer_snapshot이 `'[]'`를
        # 저장하므로 non-empty 문자열이 된다)와 구분되는, "비교 기준 자체가 없다"는 뜻이다.
        # 비교 기준이 없는 상태에서 그냥 빈 리스트로 취급해 비교하면 현재 마스터 DB에 있는
        # XXXXXX 행이 전부 '신규 추가'로 오탐된다 — 대신 비교 자체를 하지 않는다. 다음
        # 상신 계열 액션(reset_document_drift)이 스냅샷을 캡처하면 그때부터 정상 비교된다.
        extra_diff = dict(empty_group)

    return {'jayer': jayer_diff, 'oayer': oayer_diff, 'extra': extra_diff}


def recompute_document(document, job_file_rows=None, ovl_rows=None, extra_rows=None):
    """문서 하나의 drift 를 다시 계산해 캐시 필드를 채운다(저장은 호출부 책임). 감지 여부(bool) 반환.

    job_file_rows/ovl_rows/extra_rows 는 compute_document_layer_drift 와 동일 — 배치 조회 결과
    재사용용. 단일 문서 호출부(예: 온디맨드 API)는 그대로 인자 없이 호출하면 되고, 이 함수가
    바로 save 까지 한다(하위 호환). recompute_all_in_progress 는 저장을 bulk_update 로 묶으므로
    이 함수를 직접 쓰지 않고 compute_document_layer_drift 를 쓴다.
    """
    diff = compute_document_layer_drift(document, job_file_rows=job_file_rows, ovl_rows=ovl_rows, extra_rows=extra_rows)
    detected = any(diff[layer][kind] for layer in ('jayer', 'oayer', 'extra') for kind in ('removed', 'added'))
    document.layer_drift_detected = detected
    document.layer_drift_detail = json.dumps(diff, ensure_ascii=False) if detected else ''
    document.layer_drift_checked_at = timezone.now()
    document.save(update_fields=['layer_drift_detected', 'layer_drift_detail', 'layer_drift_checked_at'])
    return detected


def _critical_changes(diff):
    """diff 에서 자동 반려 대상인 변경만 뽑아 정렬된 튜플 리스트로 돌려준다.

    대상: stepseq 행 삭제·신규 추가, 같은 stepseq 의 recipeid·layerid 변경. descript(설명)만 바뀐
    경우는 배지만 띄우고 자동 반려하지 않으므로 여기서 제외된다. 값 변경은 diff 에서 옛 값
    removed + 새 값 added 한 쌍으로 표현되므로 stepseq 로 묶어서 판정한다.

    튜플: (layer, stepseq, kind, 옛 recipeid, 옛 layerid, 새 recipeid, 새 layerid) — kind 는
    'removed'/'added'/'changed'. '같은 변경이 연속 감지됐는지' 비교에도 그대로 쓴다.
    """
    changes = []
    for layer in LAYER_KEYS:
        group = (diff or {}).get(layer) or {}
        removed = {e.get('stepseq'): e for e in group.get('removed') or []}
        added = {e.get('stepseq'): e for e in group.get('added') or []}
        for stepseq in set(removed) | set(added):
            old = removed.get(stepseq)
            new = added.get(stepseq)
            if old is not None and new is not None:
                if (old.get('recipeid', ''), old.get('layerid', '')) != (new.get('recipeid', ''), new.get('layerid', '')):
                    changes.append((layer, stepseq, 'changed', old.get('recipeid', ''), old.get('layerid', ''),
                                    new.get('recipeid', ''), new.get('layerid', '')))
            elif old is not None:
                changes.append((layer, stepseq, 'removed', old.get('recipeid', ''), old.get('layerid', ''), '', ''))
            else:
                changes.append((layer, stepseq, 'added', '', '', new.get('recipeid', ''), new.get('layerid', '')))
    return sorted(changes)


def _cached_critical_changes(document):
    """직전 주기에 캐시된 layer_drift_detail 의 자동 반려 대상 변경. 캐시가 없거나 깨졌으면 빈 리스트."""
    try:
        cached = json.loads(document.layer_drift_detail) if document.layer_drift_detail else {}
    except (json.JSONDecodeError, TypeError):
        cached = {}
    return _critical_changes(cached)


def _auto_reject_comment(changes):
    """반려 사유(단계 의견). 머리말 + 변경 요약(최대 AUTO_REJECT_COMMENT_MAX_ITEMS건)."""
    parts = []
    for layer, stepseq, kind, old_recipe, old_layer, new_recipe, new_layer in changes[:AUTO_REJECT_COMMENT_MAX_ITEMS]:
        label = f'{LAYER_LABELS[layer]} STEP {stepseq}'
        if kind == 'removed':
            parts.append(f'{label} 삭제')
        elif kind == 'added':
            parts.append(f'{label} 추가')
        else:
            parts.append(f'{label} recipeid {old_recipe}→{new_recipe}, layerid {old_layer}→{new_layer}')
    extra = len(changes) - AUTO_REJECT_COMMENT_MAX_ITEMS
    suffix = f' 외 {extra}건' if extra > 0 else ''
    return f'{AUTO_REJECT_COMMENT_PREFIX} 마스터 DB 변경 감지: ' + '; '.join(parts) + suffix


def auto_reject_document(document_id, changes):
    """마스터 DB 변경이 확정된 문서를 자동 반려한다. 반려했으면 True, 건너뛰면 False.

    기존 반려(`reject_step`)와 같은 경로를 그대로 쓴다 — 단계 rejected 표시 → 문서 rejected →
    반려 이력(RejectionSnapshot) 적재 → 반려 메일. 반려를 누른 사람이 없으므로 현재 회차의 가장
    앞선 대기 단계 하나를 반려 단계로 삼고(변경된 레이어와 맞추지 않는다), 단계 의견에
    `[자동반려]` 머리말과 변경 요약을 남긴다.

    건너뛰는 경우: 이미 상태가 바뀜(under_review/pause 아님) · 철회 확인 대기 중(결재 동결 —
    철회가 취소되면 cancel_withdraw 가 다시 판정한다) · 대기 단계가 없음.
    """
    with transaction.atomic():
        document = RequestDocument.objects.select_for_update().get(pk=document_id)
        if document.status not in AUTO_REJECT_STATUSES:
            return False
        if WithdrawRequest.objects.filter(document=document, state='requested').exists():
            return False

        max_round = ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max']
        step = ApprovalStep.objects.select_for_update().filter(
            document=document, round=max_round, action='pending',
        ).order_by('id').first()
        if step is None:
            logger.warning(f"[layer_drift] 문서 {document_id} 자동 반려 불가 — 현재 회차에 대기 단계가 없다")
            return False

        step.action = 'rejected'
        step.acted_at = timezone.now()
        step.comment = _auto_reject_comment(changes)
        step.save()

        # 반려로 회차가 종료되면 진행 중이던 중단 요청은 무효 처리한다. 중단(pause) 문서는 확정된
        # 요청(confirmed)까지 닫아야 재상신 후 새 중단 요청이 막히지 않는다.
        PauseRequest.objects.filter(
            document=document, state__in=('requested', 'confirmed'),
        ).update(state='cancelled')

        document.status = 'rejected'
        document.save()

        rejection_snapshots.create_from_reject(document, step, actor=SYSTEM_REJECTER)
        mailer.enqueue_rejected(document)
    logger.info(f"[layer_drift] 문서 {document_id} 자동 반려 완료 — {len(changes)}건")
    return True


def auto_reject_if_confirmed(document):
    """문서 하나를 지금 다시 판정해, 직전 주기 캐시와 같은 변경이 계속되면 자동 반려한다.

    철회 요청이 취소된 직후처럼 '다음 스케줄러 주기를 기다리지 않고 바로' 판정해야 할 때 쓴다.
    스케줄러와 같은 규칙(같은 변경이 2번 연속 감지돼야 반려)을 따르므로, 직전 주기에 아직
    감지되지 않았던 변경은 반려하지 않고 다음 주기 판정에 맡긴다. 반려했으면 True.
    """
    changes = _critical_changes(compute_document_layer_drift(document))
    if not changes or changes != _cached_critical_changes(document):
        return False
    return auto_reject_document(document.pk, changes)


def _batch_fetch_layer_rows(lines_and_processes):
    """(line, process) 조합 집합을 받아 라인당 1쿼리(processid__in)로 job_file/ovl/extra 행을
    미리 조회한다.

    반환: (job_file_cache, ovl_cache, extra_cache) — 각각 {(line, process): [row, ...]} 딕셔너리.
    문서 수(N)에 비례하지 않고 실제 등장하는 라인 수(최대 4개)에만 비례한 쿼리를 낸다.
    """
    from .scheduler import STEP_EXTRA_EQPTYPE

    lines = {line for line, _process in lines_and_processes}

    def _build_cache(model_map, eqptype):
        cache = {}
        for line in lines:
            model = model_map.get(line)
            if not model:
                continue
            processes = {process for l, process in lines_and_processes if l == line}
            if not processes:
                continue
            queryset = model.objects.filter(
                eqptype=eqptype, processid__in=processes,
            ).order_by('processid', 'stepseq')
            for item in queryset:
                cache.setdefault((line, item.processid), []).append(_row_dict(item, line, item.processid))
        return cache

    job_file_cache = _build_cache(JOB_FILE_MODEL_MAP, 'PMAINF')
    ovl_cache = _build_cache(OVL_MODEL_MAP, 'POVLAY')
    extra_cache = _build_cache(EXTRA_MODEL_MAP, STEP_EXTRA_EQPTYPE)
    return job_file_cache, ovl_cache, extra_cache


def recompute_all_in_progress():
    """결재 진행중 문서 전체를 다시 계산한다 — 스케줄러(sync_rtdb_options) 주기마다 호출.

    이미 감지된 문서도 스킵하지 않고 매번 다시 계산해, 배지가 떠 있는 동안에도 최신 diff 로
    갱신되도록 한다. 문서 하나가 실패해도 나머지 문서 계산·저장에 영향 주지 않는다(실패한
    문서만 bulk_update 대상에서 빠진다).

    N개 문서 개별 조회(2N 쿼리) + 개별 save(N 쿼리) 대신, 라인당 배치 조회(최대 8쿼리) +
    bulk_update(청크당 1쿼리)로 묶어 문서 수에 비례하던 쿼리 수를 줄인다.
    """
    documents = list(RequestDocument.objects.filter(status__in=IN_PROGRESS_STATUSES))

    doc_lines_processes = []
    for document in documents:
        detail = (document.get_detail().get('detail') or {})
        line = detail.get('line') or ''
        process = detail.get('process_id') or ''
        if line and process:
            doc_lines_processes.append((line, process))

    job_file_cache, ovl_cache, extra_cache = _batch_fetch_layer_rows(doc_lines_processes)

    to_update = []
    to_reject = []
    for document in documents:
        try:
            detail = (document.get_detail().get('detail') or {})
            line = detail.get('line') or ''
            process = detail.get('process_id') or ''
            job_rows = job_file_cache.get((line, process), [])
            ovl_rows = ovl_cache.get((line, process), [])
            extra_rows = extra_cache.get((line, process), [])
            # 직전 주기 캐시는 아래에서 덮어쓰기 전에 읽는다 — 같은 변경이 2번 연속 감지돼야 반려한다.
            previous_changes = _cached_critical_changes(document)
            diff = compute_document_layer_drift(
                document, job_file_rows=job_rows, ovl_rows=ovl_rows, extra_rows=extra_rows,
            )
            detected = any(diff[layer][kind] for layer in LAYER_KEYS for kind in ('removed', 'added'))
            document.layer_drift_detected = detected
            document.layer_drift_detail = json.dumps(diff, ensure_ascii=False) if detected else ''
            document.layer_drift_checked_at = timezone.now()
            to_update.append(document)

            changes = _critical_changes(diff)
            if changes and changes == previous_changes:
                to_reject.append((document.id, changes))
        except Exception as e:
            logger.error(f"[layer_drift] 문서 {document.id} 변경 감지 계산 실패: {e}", exc_info=True)

    if to_update:
        RequestDocument.objects.bulk_update(
            to_update, ['layer_drift_detected', 'layer_drift_detail', 'layer_drift_checked_at'],
        )

    # 캐시(배지)를 먼저 저장한 뒤 반려한다. 문서마다 별도 트랜잭션이라 한 문서가 실패해도 나머지는 계속된다.
    for document_id, changes in to_reject:
        try:
            auto_reject_document(document_id, changes)
        except Exception as e:
            logger.error(f"[layer_drift] 문서 {document_id} 자동 반려 실패: {e}", exc_info=True)


def capture_extra_layer_snapshot(document):
    """상신 시점 XXXXXX(CD) 마스터 DB 값을 스냅샷으로 캡처해 인스턴스 필드에 채운다(저장은
    호출부 책임 — reset_document_drift 가 다른 필드와 함께 한 번에 save 한다).

    Jayer/Oayer는 요청서 작성 화면에 사용자가 편집하는 표가 있어 그 저장값을 드리프트 비교의
    기준으로 쓰지만, XXXXXX는 그런 입력 화면이 없다. 대신 이 시점(상신 계열 액션)의 마스터 DB
    값을 그대로 스냅샷으로 캡처해 다음 비교의 기준점(저장값 대용)으로 삼는다.
    """
    detail = (document.get_detail().get('detail') or {})
    line = detail.get('line') or ''
    process = detail.get('process_id') or ''
    rows = get_extra_layer_rows(line, process) if line and process else []
    document.extra_layer_snapshot = json.dumps(rows, ensure_ascii=False)


def reset_document_drift(document):
    """재상신 시점에 배지를 무조건 초기화하고(재계산이 아니라 리셋 — 다음 스케줄러 주기부터 다시
    감지 대상) XXXXXX 스냅샷도 이 시점 값으로 새로 캡처한다.
    """
    capture_extra_layer_snapshot(document)
    document.layer_drift_detected = False
    document.layer_drift_detail = ''
    document.layer_drift_checked_at = timezone.now()
    document.save(update_fields=[
        'extra_layer_snapshot', 'layer_drift_detected', 'layer_drift_detail', 'layer_drift_checked_at',
    ])
