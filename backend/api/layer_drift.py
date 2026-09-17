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


def _is_loaded(row):
    """이 행이 DB 자동채움 출처인지 — `loaded` 필드만으로는 부족하다.

    프론트(`RequestPage/index.tsx` 문서 로드부, `const loaded = r.loaded ?? !!r.updated?.trim()`)와
    동일한 보정을 백엔드에서도 적용한다: `loaded` 필드 자체가 없던 옛 문서도 `updated`(자동채움
    함수 2곳에서만 채워지고 수동 행은 항상 빈 문자열)가 있으면 자동채움 행으로 본다. 이 보정이
    없으면 `loaded`가 누락된 옛 문서의 정상 행이 전부 '신규 행 추가'로 오탐된다(2026-09 발견).
    """
    return bool(row.get('loaded')) or bool((row.get('updated') or '').strip())


def compute_document_layer_drift(document, job_file_rows=None, ovl_rows=None):
    """문서 하나의 J-layer/O-layer diff 를 계산한다. line/process_id 가 없으면 빈 결과.

    job_file_rows/ovl_rows 를 넘기면(배치 조회 결과) DB 를 다시 조회하지 않고 그대로 쓴다
    — recompute_all_in_progress 의 라인당 배치 조회 결과를 문서별로 재사용하기 위함.
    None 이면(단일 문서 호출부는 그대로) 기존처럼 문서 하나 기준으로 직접 조회한다.
    """
    data = document.get_detail()
    detail = data.get('detail', {}) or {}
    line = detail.get('line') or ''
    process = detail.get('process_id') or ''
    empty_group = {'removed': [], 'added': []}
    if not line or not process:
        return {'jayer': dict(empty_group), 'oayer': dict(empty_group)}

    jayer_saved = [row for row in (data.get('jayerRows') or []) if _is_loaded(row)]
    oayer_saved = [row for row in (data.get('oayerRows') or []) if _is_loaded(row)]

    if job_file_rows is None:
        job_file_rows = get_job_file_layer_rows(line, process)
    if ovl_rows is None:
        ovl_rows = get_ovl_layer_rows(line, process)

    return {
        'jayer': _diff_rows(jayer_saved, job_file_rows),
        'oayer': _diff_rows(oayer_saved, ovl_rows),
    }


def recompute_document(document, job_file_rows=None, ovl_rows=None):
    """문서 하나의 drift 를 다시 계산해 캐시 필드를 채운다(저장은 호출부 책임). 감지 여부(bool) 반환.

    job_file_rows/ovl_rows 는 compute_document_layer_drift 와 동일 — 배치 조회 결과 재사용용.
    단일 문서 호출부(예: 온디맨드 API)는 그대로 두 인자 없이 호출하면 되고, 이 함수가 바로
    save 까지 한다(하위 호환). recompute_all_in_progress 는 저장을 bulk_update 로 묶으므로
    이 함수를 직접 쓰지 않고 compute_document_layer_drift 를 쓴다.
    """
    diff = compute_document_layer_drift(document, job_file_rows=job_file_rows, ovl_rows=ovl_rows)
    detected = any(diff[layer][kind] for layer in ('jayer', 'oayer') for kind in ('removed', 'added'))
    document.layer_drift_detected = detected
    document.layer_drift_detail = json.dumps(diff, ensure_ascii=False) if detected else ''
    document.layer_drift_checked_at = timezone.now()
    document.save(update_fields=['layer_drift_detected', 'layer_drift_detail', 'layer_drift_checked_at'])
    return detected


def _batch_fetch_layer_rows(lines_and_processes):
    """(line, process) 조합 집합을 받아 라인당 1쿼리(processid__in)로 job_file/ovl 행을 미리 조회한다.

    반환: (job_file_cache, ovl_cache) — 각각 {(line, process): [row, ...]} 딕셔너리.
    문서 수(N)에 비례하지 않고 실제 등장하는 라인 수(최대 4개)에만 비례한 쿼리를 낸다.
    """
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
    return job_file_cache, ovl_cache


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

    job_file_cache, ovl_cache = _batch_fetch_layer_rows(doc_lines_processes)

    to_update = []
    for document in documents:
        try:
            detail = (document.get_detail().get('detail') or {})
            line = detail.get('line') or ''
            process = detail.get('process_id') or ''
            job_rows = job_file_cache.get((line, process), [])
            ovl_rows = ovl_cache.get((line, process), [])
            diff = compute_document_layer_drift(document, job_file_rows=job_rows, ovl_rows=ovl_rows)
            detected = any(diff[layer][kind] for layer in ('jayer', 'oayer') for kind in ('removed', 'added'))
            document.layer_drift_detected = detected
            document.layer_drift_detail = json.dumps(diff, ensure_ascii=False) if detected else ''
            document.layer_drift_checked_at = timezone.now()
            to_update.append(document)
        except Exception as e:
            logger.error(f"[layer_drift] 문서 {document.id} 변경 감지 계산 실패: {e}", exc_info=True)

    if to_update:
        RequestDocument.objects.bulk_update(
            to_update, ['layer_drift_detected', 'layer_drift_detail', 'layer_drift_checked_at'],
        )


def reset_document_drift(document):
    """재상신 시점에 배지를 무조건 초기화한다(재계산이 아니라 리셋 — 다음 스케줄러 주기부터 다시 감지 대상)."""
    document.layer_drift_detected = False
    document.layer_drift_detail = ''
    document.layer_drift_checked_at = timezone.now()
    document.save(update_fields=['layer_drift_detected', 'layer_drift_detail', 'layer_drift_checked_at'])
