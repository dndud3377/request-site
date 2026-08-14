"""결재 경우의 수 케이스 러너 (개발환경 전용).

사용 예:
    python3 -m scripts.approval_cases.run_cases --list
    python3 -m scripts.approval_cases.run_cases                       # 전체 실행
    python3 -m scripts.approval_cases.run_cases --group F             # 그룹만
    python3 -m scripts.approval_cases.run_cases --case F-05 --case S-01
    python3 -m scripts.approval_cases.run_cases --report /tmp/result.md

동작 방식:
- 개발용 사이트의 **Django REST API 를 직접 호출**해 케이스별 의뢰서를 **실제로 상신**하고
  결재를 끝까지 진행한다(화면 조작·모의 객체 없음, `POST /api/documents/` → `submit/` →
  `peer-approve/` → `approve-step/` …).
- 로그인은 **`@company.com` 개발용 계정**(`python manage.py create_users` 시드)만 쓴다.
  `--mail-domain` 으로 도메인을 바꿀 수 있고, `--allow-any-account` 로 필터를 끌 수 있다.

주의:
- **개발환경(AUTH_MODE=dev)에서만** 동작한다. dev-login 이 막힌 환경에서는 즉시 중단한다.
- 생성한 의뢰서는 **지우지 않는다** — 화면에서 제목·목록 표시까지 그대로 확인하기 위해서다
  (제목은 화면과 같은 규칙으로 자동 생성된다).
- 메일은 서버 설정(MAIL_REDIRECT_TO)을 그대로 따른다. 러너는 메일 발송을 막지 않는다.
"""

import argparse
import sys
import traceback

from .cases import CASES
from .client import Api, ApiError
from .flows import CaseFailure, CaseSkip, Ctx
from .masterdata import DEV_MAIL_DOMAIN, MasterData

PASS, FAIL, SKIP, ERROR = 'PASS', 'FAIL', 'SKIP', 'ERROR'
STATUS_MARK = {PASS: '✅', FAIL: '❌', SKIP: '⏭', ERROR: '💥'}


def parse_args(argv=None):
    p = argparse.ArgumentParser(description='결재 경우의 수 개발환경 러너')
    p.add_argument('--base-url', default='http://localhost:10011',
                   help='개발 서버 주소 (기본: http://localhost:10011)')
    p.add_argument('--case', action='append', default=[], help='실행할 케이스 ID (여러 번 지정 가능)')
    p.add_argument('--group', action='append', default=[], help='실행할 그룹 (S/L/R/C/PE/F/X/M/W/A/N)')
    p.add_argument('--list', action='store_true', help='케이스 목록만 출력')
    p.add_argument('--scan-limit', type=int, default=8, help='마스터 데이터 탐색 폭 (기본 8)')
    p.add_argument('--bootstrap', default='', help='마스터 데이터 조회에 쓸 로그인 ID(운영형 인증 환경용)')
    p.add_argument('--mail-domain', default=DEV_MAIL_DOMAIN,
                   help=f'상신·결재에 쓸 개발용 계정의 메일 도메인 (기본: {DEV_MAIL_DOMAIN})')
    p.add_argument('--allow-any-account', action='store_true',
                   help='도메인 필터를 끄고 모든 계정을 쓴다(권장하지 않음 — 실사용자 이름으로 문서가 남는다)')
    p.add_argument('--stop-on-fail', action='store_true', help='첫 실패에서 중단')
    p.add_argument('--report', default='', help='결과를 마크다운 표로 저장할 경로')
    p.add_argument('--timeout', type=int, default=30, help='HTTP 타임아웃(초)')
    return p.parse_args(argv)


def select_cases(args):
    picked = CASES
    if args.case:
        wanted = {c.upper() for c in args.case}
        picked = [c for c in picked if c.id.upper() in wanted]
    if args.group:
        groups = {g.upper() for g in args.group}
        picked = [c for c in picked if c.group.upper() in groups]
    return picked


def main(argv=None):
    args = parse_args(argv)
    selected = select_cases(args)

    if args.list:
        for c in selected:
            print(f'{c.id:<6} [{c.group}] {c.title}')
        print(f'\n총 {len(selected)}건')
        return 0

    api = Api(args.base_url, timeout=args.timeout)

    token = None
    if args.bootstrap:
        from .client import Actor
        token = Actor(api, args.bootstrap).login().token

    print(f'[준비] {args.base_url} 마스터 데이터 탐색 중...')
    master = MasterData(api, token=token, scan_limit=args.scan_limit,
                        mail_domain=args.mail_domain,
                        allow_any_account=args.allow_any_account)
    try:
        master.load_users()
        master.load_combos()
    except ApiError as e:
        print(f'❌ 개발 서버에 접속할 수 없다: {e}')
        return 2

    if not master.combos:
        print('❌ 상신에 쓸 마스터 데이터를 찾지 못했다 '
              '(라인/조합법/제품/process_id/JOB FILE layer 중 비어 있는 단계가 있다).')
        return 2
    print(master.summary())
    print()

    ctx = Ctx(api, master)
    results = []
    for c in selected:
        try:
            detail = c.fn(ctx) or ''
            status = PASS
        except CaseSkip as e:
            status, detail = SKIP, str(e)
        except CaseFailure as e:
            status, detail = FAIL, str(e)
        except ApiError as e:
            status, detail = ERROR, str(e)
        except Exception as e:  # 러너 자체 버그도 케이스 실패로 기록하고 계속 진행
            status, detail = ERROR, f'{e.__class__.__name__}: {e}\n{traceback.format_exc(limit=3)}'
        results.append((c, status, detail))
        print(f'{STATUS_MARK[status]} {c.id:<6} {c.title}')
        if detail:
            for line in str(detail).splitlines():
                print(f'        {line}')
        if status in (FAIL, ERROR) and args.stop_on_fail:
            print('\n--stop-on-fail: 중단한다.')
            break

    counts = {s: sum(1 for _, st, _ in results if st == s) for s in (PASS, FAIL, SKIP, ERROR)}
    print(f'\n=== 결과: PASS {counts[PASS]} / FAIL {counts[FAIL]} / '
          f'SKIP {counts[SKIP]} / ERROR {counts[ERROR]} (총 {len(results)}건) ===')

    if args.report:
        _write_report(args.report, results, counts, args.base_url, master)
        print(f'보고서 저장: {args.report}')

    return 1 if (counts[FAIL] or counts[ERROR]) else 0


def _write_report(path, results, counts, base_url, master=None):
    lines = [
        '# 결재 경우의 수 실행 결과',
        '',
        f'- 대상: {base_url} (Django REST API 직접 호출로 실제 상신)',
        (f'- 사용 계정: {"전체 계정" if master.allow_any_account else master.mail_domain + " 개발용 계정"}'
         if master else '- 사용 계정: -'),
        f'- PASS {counts[PASS]} / FAIL {counts[FAIL]} / SKIP {counts[SKIP]} / ERROR {counts[ERROR]}',
        '',
        '| ID | 그룹 | 케이스 | 판정 | 상세 |',
        '|---|---|---|---|---|',
    ]
    for c, status, detail in results:
        safe = str(detail).replace('|', '\\|').replace('\n', '<br>')
        lines.append(f'| {c.id} | {c.group} | {c.title} | {status} | {safe} |')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    sys.exit(main())
