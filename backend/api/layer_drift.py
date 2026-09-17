"""J-layer/O-layer 자동 채움 값의 '변경 감지' — 마스터 DB(PhotoStepS*) 드리프트 계산.

배경: 요청서 작성 화면은 라인+조리법(process_id)을 고르면 `PhotoStepS{1,3,4,5}`(eqptype='PMAINF')/
`PhotoStepS{1,3,4,5}Ov`(eqptype='POVLAY')를 조회해 J-layer/O-layer 표의 sp(STEPSEQ)/sd(설명)/
pp(레시피ID)/layerid(Layer)를 자동으로 채운다(`views.py` form_options_job_file_layer/ovl_layer와
프론트 `RequestPage/index.tsx` fetchJobFileLayerAndPopulateJayer/fetchOvlLayerAndPopulateOayer).

상신 이후 마스터 DB 값이 바뀌면 문서에 저장된 값과 어긋날 수 있다. 이 모듈은 결재 진행중
문서의 저장값과 현재 마스터 DB 값을 stepseq(sp) 기준으로 비교해 값 변경/행 삭제/신규 행 추가를
감지하고, 결과를 RequestDocument.layer_drift_* 필드에 캐시한다(스케줄러 10분 주기 갱신 —
`scheduler.py` sync_rtdb_options() 끝에서 호출, docs/CHANGE_STATUS.md 와 같은 "지연 허용" 철학).
"""
import json
import logging

from django.utils import timezone

from .models import (
    PhotoStepS1, PhotoStepS3, PhotoStepS4, PhotoStepS5,
    PhotoStepS1Ov, PhotoStepS3Ov, PhotoStepS4Ov, PhotoStepS5Ov,
    RequestDocument,
)

logger = logging.getLogger(__name__)

# views.py form_options_job_file_layer/ovl_layer 의 라인별 모델 매핑과 동일해야 한다.
JOB_FILE_MODEL_MAP = {
    'line1': PhotoStepS1, 'line3': PhotoStepS3, 'line4': PhotoStepS4, 'line5': PhotoStepS5,
}
OVL_MODEL_MAP = {
    'line1': PhotoStepS1Ov, 'line3': PhotoStepS3Ov, 'line4': PhotoStepS4Ov, 'line5': PhotoStepS5Ov,
}

# 결재 진행중으로 보는 상태 — 완료(approved)·반려(rejected)·임시저장(draft)은 대상에서 뺀다.
IN_PROGRESS_STATUSES = ('submitted', 'under_review', 'pause')


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
    """저장된 행(loaded=true 만)과 현재 마스터 DB 행을 stepseq(sp) 기준으로 비교해
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


def compute_document_layer_drift(document):
    """문서 하나의 J-layer/O-layer diff 를 계산한다. line/process_id 가 없으면 빈 결과."""
    data = document.get_detail()
    detail = data.get('detail', {}) or {}
    line = detail.get('line') or ''
    process = detail.get('process_id') or ''
    empty_group = {'removed': [], 'added': []}
    if not line or not process:
        return {'jayer': dict(empty_group), 'oayer': dict(empty_group)}

    jayer_saved = [row for row in (data.get('jayerRows') or []) if row.get('loaded')]
    oayer_saved = [row for row in (data.get('oayerRows') or []) if row.get('loaded')]

    return {
        'jayer': _diff_rows(jayer_saved, get_job_file_layer_rows(line, process)),
        'oayer': _diff_rows(oayer_saved, get_ovl_layer_rows(line, process)),
    }


def recompute_document(document):
    """문서 하나의 drift 를 다시 계산해 캐시 필드에 저장한다. 감지 여부(bool)를 반환."""
    diff = compute_document_layer_drift(document)
    detected = any(diff[layer][kind] for layer in ('jayer', 'oayer') for kind in ('removed', 'added'))
    document.layer_drift_detected = detected
    document.layer_drift_detail = json.dumps(diff, ensure_ascii=False) if detected else ''
    document.layer_drift_checked_at = timezone.now()
    document.save(update_fields=['layer_drift_detected', 'layer_drift_detail', 'layer_drift_checked_at'])
    return detected


def recompute_all_in_progress():
    """결재 진행중 문서 전체를 다시 계산한다 — 스케줄러(sync_rtdb_options) 주기마다 호출.

    이미 감지된 문서도 스킵하지 않고 매번 다시 계산해, 배지가 떠 있는 동안에도 최신 diff 로
    갱신되도록 한다. 문서 하나가 실패해도 나머지 문서 계산에 영향 주지 않는다.
    """
    documents = RequestDocument.objects.filter(status__in=IN_PROGRESS_STATUSES)
    for document in documents:
        try:
            recompute_document(document)
        except Exception as e:
            logger.error(f"[layer_drift] 문서 {document.id} 변경 감지 계산 실패: {e}", exc_info=True)


def reset_document_drift(document):
    """재상신 시점에 배지를 무조건 초기화한다(재계산이 아니라 리셋 — 다음 스케줄러 주기부터 다시 감지 대상)."""
    document.layer_drift_detected = False
    document.layer_drift_detail = ''
    document.layer_drift_checked_at = timezone.now()
    document.save(update_fields=['layer_drift_detected', 'layer_drift_detail', 'layer_drift_checked_at'])
