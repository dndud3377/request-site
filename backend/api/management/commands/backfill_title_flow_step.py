"""
기존 의뢰서 제목의 '요청서' 구간을 흐름도 Step(`[10~20][90~100]`)으로 바꾸는 일회성 변환 커맨드.

새 문서는 프론트(`RequestPage/index.tsx` buildEnrichedForm)가 제목을 만들 때 이 규칙을 적용한다.
이 커맨드는 그 이전에 만들어진 문서를 같은 규칙으로 맞춘다.

규칙(프론트 `buildFlowStepTitlePart` 와 동일):
- `additional_notes.detail.flow_chart` 중 위치/제품 이름/조리법이 문서의
  `detail.line` / `partid_selection` / `process_id` 와 모두 같은 행의 Step 을 행 순서대로 `[시작~끝]` 으로 잇는다.
- 제목은 다시 만들지 않고 끝의 `_요청서_YYMMDD[_N]` 에서 '요청서'만 치환한다 — 원래 상신 날짜와 중복 접미사(_N)가 보존된다.
- 일치 행이 없거나 Step 이 모두 비어 있거나, 제목이 `_요청서_YYMMDD[_N]` 로 끝나지 않으면 건드리지 않는다(재실행해도 결과가 같다).
- 변환 결과가 title 컬럼 한도를 넘거나 다른 문서의 제목과 겹치면 그 문서만 건너뛰고 사유를 출력한다.

기본은 **미리보기(dry-run)** 이며 DB 를 바꾸지 않는다. 실제 반영은 `--apply` 를 줄 때만 한다.
`updated_at` 은 바꾸지 않는다(.update() 사용).

Usage:
    python manage.py backfill_title_flow_step            # 미리보기
    python manage.py backfill_title_flow_step --apply    # 실제 반영
"""
import json
import re

from django.core.management.base import BaseCommand

from api.models import RequestDocument

# 프론트 `RequestPage/constants.ts` 의 TITLE_DEFAULT_LABEL 과 같은 값이어야 한다.
TITLE_DEFAULT_LABEL = '요청서'

# 제목 끝: `_요청서_YYMMDD` + (중복 제목이면) `_N`
_TITLE_TAIL = re.compile(r'_' + re.escape(TITLE_DEFAULT_LABEL) + r'_(\d{6})((?:_\d+)?)$')


def _as_text(value):
    """행 값을 문자열로 정규화한다(None → '')."""
    return '' if value is None else str(value)


def flow_step_label(detail):
    """문서의 기준 키(line/partid_selection/process_id)와 일치하는 흐름도 행의 Step 을 `[10~20][90~100]` 로 만든다.

    일치 행이 없거나 Step 이 모두 비어 있으면 빈 문자열.
    """
    if not isinstance(detail, dict):
        return ''
    rows = detail.get('flow_chart')
    if not isinstance(rows, list):
        return ''
    ref = (
        _as_text(detail.get('line')),
        _as_text(detail.get('partid_selection')),
        _as_text(detail.get('process_id')),
    )
    parts = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = (_as_text(row.get('location')), _as_text(row.get('product_name')), _as_text(row.get('process_id')))
        if key != ref:
            continue
        step_from, step_to = _as_text(row.get('step_from')), _as_text(row.get('step_to'))
        step = f'{step_from}~{step_to}' if step_from and step_to else (step_from or step_to)
        if step:
            parts.append(f'[{step}]')
    return ''.join(parts)


def convert_title(title, additional_notes):
    """제목의 '요청서' 를 Step 구간으로 치환한 새 제목을 돌려준다. 바꿀 것이 없으면 None."""
    match = _TITLE_TAIL.search(title or '')
    if not match:
        return None
    try:
        notes = json.loads(additional_notes or '')
    except (TypeError, ValueError):
        return None
    if not isinstance(notes, dict):
        return None
    label = flow_step_label(notes.get('detail'))
    if not label:
        return None
    return f'{title[:match.start()]}_{label}_{match.group(1)}{match.group(2)}'


class Command(BaseCommand):
    help = "기존 의뢰서 제목의 '요청서' 구간을 흐름도 Step([10~20][90~100])으로 변환합니다. 기본은 미리보기."

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='실제로 DB 에 반영한다(미지정 시 미리보기만 한다).',
        )

    def handle(self, *args, **options):
        apply = options['apply']
        title_max = RequestDocument._meta.get_field('title').max_length
        existing_titles = set(RequestDocument.objects.values_list('title', flat=True))

        to_change = []
        skipped = []
        for doc in RequestDocument.objects.only('id', 'title', 'additional_notes').order_by('id').iterator(chunk_size=200):
            new_title = convert_title(doc.title, doc.additional_notes)
            if new_title is None:
                continue
            if len(new_title) > title_max:
                skipped.append((doc.id, doc.title, f'변환 결과가 {title_max}자를 넘음'))
            elif new_title in existing_titles:
                skipped.append((doc.id, doc.title, '같은 제목의 다른 문서가 이미 있음'))
            else:
                existing_titles.add(new_title)
                to_change.append((doc.id, doc.title, new_title))

        for doc_id, old, new in to_change:
            self.stdout.write(f'  #{doc_id}\n    전: {old}\n    후: {new}')
        for doc_id, old, reason in skipped:
            self.stdout.write(self.style.WARNING(f'  #{doc_id} 건너뜀({reason}): {old}'))

        if apply:
            for doc_id, _old, new in to_change:
                RequestDocument.objects.filter(pk=doc_id).update(title=new)
            self.stdout.write(self.style.SUCCESS(f'\n반영 완료: {len(to_change)}건 변환, {len(skipped)}건 건너뜀'))
        else:
            self.stdout.write(self.style.NOTICE(
                f'\n미리보기: {len(to_change)}건 변환 예정, {len(skipped)}건 건너뜀 — 반영하려면 --apply'
            ))
