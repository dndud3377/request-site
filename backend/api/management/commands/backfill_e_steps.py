"""병렬 단계 진행 중인 의뢰서에 누락된 E 결재 단계를 소급 생성하는 커맨드.

E 단계는 이전에 조건부로만 생성됐다가 '항상 생성'으로 바뀌었다. 그 변경은
`_advance_to_parallel` 이 실행되는 시점에만 적용되므로, 변경 배포 이전에 이미
병렬 단계로 넘어간 의뢰서에는 E 단계가 영영 생기지 않는다. 그 문서들은
1) E 검증 없이 최종 승인되고, 2) 메일 결재 경로 카드에 끝내 '대기'로 남는
E 행이 표시된다. 이 커맨드로 배포 직후 1회 소급 생성해 상태를 맞춘다.

기본은 dry-run(조회만) 이고, `--apply` 를 붙여야 실제로 생성한다.
이미 E 단계가 있는 문서는 건너뛰므로 여러 번 실행해도 안전하다.

Usage:
    python manage.py backfill_e_steps              # 대상 조회만(dry-run)
    python manage.py backfill_e_steps --apply      # 실제 생성(메일 미발송)
    python manage.py backfill_e_steps --apply --notify   # 생성 + 도착 메일 적재
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Max

from api import mailer
from api.models import ApprovalStep, RequestDocument

# 소급 대상으로 삼는 문서 상태 — 아직 결재가 끝나지 않아 E 단계가 남아 있어야 하는 상태.
# (draft/submitted 는 아직 병렬 단계 이전, approved/rejected 는 이미 종결)
TARGET_STATUSES = ('under_review', 'pause')

# 병렬 단계 진입 여부를 판정하는 기준 단계. `_advance_to_parallel` 에서 E 와 함께
# 생성되므로, 현재 회차에 이 단계가 있으면 병렬 단계를 이미 통과한 문서다.
PARALLEL_MARKER_AGENT = 'O'

# 소급 생성할 단계
BACKFILL_AGENT = 'E'


class Command(BaseCommand):
    help = '병렬 단계 진행 중인 의뢰서에 누락된 E 결재 단계를 소급 생성합니다.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='실제로 단계를 생성한다. 지정하지 않으면 대상만 출력한다(dry-run).',
        )
        parser.add_argument(
            '--notify', action='store_true',
            help='생성된 단계의 도착 메일을 적재한다. --apply 와 함께일 때만 동작한다.',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']
        notify = options['notify']
        if notify and not apply_changes:
            self.stdout.write(self.style.WARNING(
                '--notify 는 --apply 와 함께일 때만 동작합니다. 메일은 적재하지 않습니다.'
            ))
            notify = False

        targets = self._collect_targets()
        if not targets:
            self.stdout.write(self.style.SUCCESS('소급 생성 대상이 없습니다.'))
            return

        self.stdout.write(f'소급 생성 대상 {len(targets)}건:')
        for document, round_no, due_date in targets:
            self.stdout.write(
                f'  #{document.id} {document.title} '
                f'(상태 {document.status} / {round_no}회차 / 기한 {due_date or "미설정"})'
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING(
                'dry-run 입니다. 실제로 생성하려면 --apply 를 붙여 다시 실행하세요.'
            ))
            return

        created = []
        with transaction.atomic():
            for document, round_no, due_date in targets:
                step = ApprovalStep.objects.create(
                    document=document, agent=BACKFILL_AGENT, action='pending',
                    is_parallel=True, round=round_no, due_date=due_date,
                )
                created.append((document, step))

        # 메일 적재는 트랜잭션 밖에서 — 메일 적재 실패가 단계 생성을 되돌리지 않게 한다.
        if notify:
            for document, step in created:
                mailer.enqueue_stage_arrival(document, BACKFILL_AGENT, step)

        self.stdout.write(self.style.SUCCESS(
            f'완료: E 단계 {len(created)}건 생성'
            + (' / 도착 메일 적재함' if notify else ' / 메일 미발송')
        ))

    def _collect_targets(self):
        """소급 생성이 필요한 (문서, 회차, 기한) 목록.

        기한은 같은 회차 O 단계의 기한을 그대로 물려받는다 —
        `_advance_to_parallel` 이 두 단계에 같은 기한을 주기 때문이다.
        """
        targets = []
        documents = RequestDocument.objects.filter(status__in=TARGET_STATUSES).order_by('id')
        for document in documents:
            if document.is_only_map():
                continue  # Only MAP 은 P/O/E 없이 후결자로 종단하는 경로
            round_no = ApprovalStep.objects.filter(document=document).aggregate(
                Max('round')
            )['round__max']
            if round_no is None:
                continue
            steps = ApprovalStep.objects.filter(document=document, round=round_no)
            marker = steps.filter(agent=PARALLEL_MARKER_AGENT).order_by('-id').first()
            if marker is None:
                continue  # 아직 병렬 단계 이전 — 앞으로 정상 경로로 E 가 생성된다
            if steps.filter(agent=BACKFILL_AGENT).exists():
                continue  # 이미 있음
            targets.append((document, round_no, marker.due_date))
        return targets
