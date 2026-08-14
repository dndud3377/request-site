"""케이스가 공통으로 쓰는 결재 조작·검증 헬퍼.

케이스 본문이 "무엇을 검증하는가"만 남도록, 문서 생성 → 상신 → 단계 진행의
반복 절차를 여기에 모았다. 모든 호출은 실제 API 를 그대로 탄다(권한·분기 우회 없음).
"""

from .client import Actor, as_list
from . import payload as P


class CaseFailure(AssertionError):
    """기대와 다른 결과 — FAIL 로 보고된다."""


class CaseSkip(Exception):
    """전제 조건(역할 인원·마스터 데이터)이 없어 실행 불가 — SKIP 으로 보고된다."""


class Ctx:
    """케이스 실행 컨텍스트 — 마스터 데이터 + 역할별 로그인 세션."""

    def __init__(self, api, master, log=print):
        self.api = api
        self.master = master
        self.log = log
        self._actors = {}

    # ----- 배우(역할별 로그인) -----
    def actor(self, role, index=0):
        users = self.master.users_by_role.get(role, [])
        if len(users) <= index:
            raise CaseSkip(f'{role} 계정이 {index + 1}명 이상 필요하다(현재 {len(users)}명).')
        key = (role, index)
        if key not in self._actors:
            u = users[index]
            self._actors[key] = Actor(self.api, u['loginid'], role=role, name=u.get('name', ''),
                                      mail=u.get('mail', ''), deptname=u.get('deptname', '')).login()
        return self._actors[key]

    def user(self, role, index=0):
        users = self.master.users_by_role.get(role, [])
        if len(users) <= index:
            raise CaseSkip(f'{role} 계정이 {index + 1}명 이상 필요하다(현재 {len(users)}명).')
        return users[index]

    def combo(self, plel=False):
        c = self.master.pick(plel=plel)
        if c is None:
            raise CaseSkip("pp 에 'plel' 이 든 마스터 데이터가 없어 E(MASK) 경로를 만들 수 없다.")
        return c

    def need(self, **roles):
        """케이스 앞머리에서 필요한 역할 인원을 선언한다. 부족하면 SKIP."""
        short = self.master.missing_roles(roles)
        if short:
            raise CaseSkip(' / '.join(short))


# ===== 문서 조작 =====

def create_document(ctx, actor, combo=None, **kw):
    """draft 문서 생성 → 문서 dict 반환.

    의뢰자 정보는 **로그인한 개발용 계정의 실제 값**(@company.com 메일·부서)을 그대로 쓴다.
    """
    combo = combo or ctx.combo(plel=kw.get('plel', False))
    requester = {'loginid': actor.loginid, 'name': actor.name,
                 'mail': actor.mail, 'deptname': actor.deptname}
    body = P.build_document(combo, requester, **kw)
    res = actor.post('/api/documents/', body)
    if not res.ok:
        raise CaseFailure(f'문서 생성 실패: {res.status} {res.error_text()}')
    return res.body


def submit(actor, doc_id, pl_loginids, expect=200):
    res = actor.post(f'/api/documents/{doc_id}/submit/',
                     {'designated_pl_loginids': list(pl_loginids)})
    return _expect(res, expect, '상신')


def resubmit(actor, doc_id, pl_loginids, expect=200):
    res = actor.post(f'/api/documents/{doc_id}/resubmit/',
                     {'designated_pl_loginids': list(pl_loginids)})
    return _expect(res, expect, '재상신')


def fetch(actor, doc_id):
    res = actor.get(f'/api/documents/{doc_id}/')
    if not res.ok:
        raise CaseFailure(f'문서 조회 실패: {res.status} {res.error_text()}')
    return res.body


def steps(doc, agent=None, action=None, round_no=None):
    rows = doc.get('approval_steps') or []
    if round_no is None:
        round_no = max([s.get('round', 1) for s in rows], default=1)
    out = [s for s in rows if s.get('round') == round_no]
    if agent:
        out = [s for s in out if s.get('agent') == agent]
    if action:
        out = [s for s in out if s.get('action') == action]
    return out


def agents_in_round(doc, round_no=None):
    return sorted({s['agent'] for s in steps(doc, round_no=round_no)})


# ===== 단계 조작 =====

def peer_approve(actor, doc_id, expect=200, comment=''):
    return _expect(actor.post(f'/api/documents/{doc_id}/peer-approve/', {'comment': comment}),
                   expect, 'PL 합의')


def peer_reject(actor, doc_id, expect=200, comment='케이스 검증 반려'):
    return _expect(actor.post(f'/api/documents/{doc_id}/peer-reject/', {'comment': comment}),
                   expect, 'PL 반려')


def peer_submit(actor, doc_id, expect=200, comment=''):
    return _expect(actor.post(f'/api/documents/{doc_id}/peer-submit/', {'comment': comment}),
                   expect, 'PL 수정 후 상신')


def sales_agree(actor, doc_id, expect=200, comment=''):
    return _expect(actor.post(f'/api/documents/{doc_id}/sales-agree/', {'comment': comment}),
                   expect, 'SA 합의')


def sales_reject(actor, doc_id, expect=200, comment='케이스 검증 반려'):
    return _expect(actor.post(f'/api/documents/{doc_id}/sales-reject/', {'comment': comment}),
                   expect, 'SA 반려')


def assign_step(actor, doc_id, agent, assignee, reviewer_loginid=None, expect=200):
    data = {'agent': agent, 'assignee_loginid': assignee['loginid'],
            'assignee_name': assignee.get('name', '')}
    if reviewer_loginid:
        data['reviewer_loginid'] = reviewer_loginid
    return _expect(actor.post(f'/api/documents/{doc_id}/assign-step/', data), expect, f'{agent} 담당자 지정')


def claim_step(actor, doc_id, agent, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/claim-step/', {'agent': agent}),
                   expect, f'{agent} 검토중 선점')


def approve_step(actor, doc_id, agent, reviewer_loginids=None, expect=200, comment=''):
    data = {'agent': agent, 'comment': comment, 'approver_name': actor.name}
    if reviewer_loginids is not None:
        data['reviewer_loginids'] = list(reviewer_loginids)
    return _expect(actor.post(f'/api/documents/{doc_id}/approve-step/', data), expect, f'{agent} 합의')


def reject_step(actor, doc_id, agent, expect=200, comment='케이스 검증 반려'):
    return _expect(actor.post(f'/api/documents/{doc_id}/reject-step/', {'agent': agent, 'comment': comment}),
                   expect, f'{agent} 반려')


def request_pause(actor, doc_id, reason='케이스 검증 중단', expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/request-pause/', {'reason': reason}),
                   expect, '중단 요청')


def confirm_pause(actor, doc_id, agent, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/confirm-pause/', {'agent': agent}),
                   expect, '중단 확인')


def cancel_pause(actor, doc_id, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/cancel-pause/', {}), expect, '중단 요청 취소')


def resume(actor, doc_id, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/resume/', {}), expect, '재개')


def withdraw(actor, doc_id, reason='케이스 검증 철회', expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/withdraw/', {'reason': reason}), expect, '철회')


def confirm_withdraw(actor, doc_id, agent, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/confirm-withdraw/', {'agent': agent}),
                   expect, '철회 확인')


def reject_withdraw(actor, doc_id, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/reject-withdraw/', {}), expect, '철회 거부')


def cancel_withdraw(actor, doc_id, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/cancel-withdraw/', {}), expect, '철회 요청 취소')


def add_post_approver(actor, doc_id, loginid, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/add-post-approver/', {'loginid': loginid}),
                   expect, '후결자 추가')


def remove_post_approver(actor, doc_id, loginid, expect=200):
    return _expect(actor.post(f'/api/documents/{doc_id}/remove-post-approver/', {'loginid': loginid}),
                   expect, '후결자 제거')


# ===== 복합 시나리오 =====

def submitted_doc(ctx, *, pl_count=1, sa_users=(), plel=False, **kw):
    """작성자(PL) 가 문서를 만들고 상신한 상태까지 진행 → (doc_id, author, pls)."""
    author = ctx.actor('PL', 0)
    pls = [ctx.user('PL', i + 1) for i in range(pl_count)]
    combo = ctx.combo(plel=plel)
    doc = create_document(ctx, author, combo=combo, plel=plel, sales_agreers=sa_users, **kw)
    submit(author, doc['id'], [p['loginid'] for p in pls])
    return doc['id'], author, pls


def pass_pl_stage(ctx, doc_id, pls, sa_users=()):
    """지정 PL 전원 + SA 전원 합의로 PL 단계를 통과시킨다."""
    for i, _ in enumerate(pls):
        peer_approve(ctx.actor('PL', i + 1), doc_id)
    for i, _ in enumerate(sa_users):
        sales_agree(ctx.actor('PL', _sa_index(ctx, sa_users, i)), doc_id)


def _sa_index(ctx, sa_users, i):
    """SA 로 지정한 사용자의 PL 목록 내 인덱스를 되찾는다."""
    target = sa_users[i]['loginid']
    for idx, u in enumerate(ctx.master.users_by_role.get('PL', [])):
        if u['loginid'] == target:
            return idx
    raise CaseSkip('SA 로 지정한 사용자를 PL 목록에서 찾지 못했다.')


def pass_r_stage(ctx, doc_id, reviewer=None):
    """R 담당자 지정 → (검토자 있으면 RV 까지) 합의 → 병렬 단계 진입."""
    te_r = ctx.actor('TE_R', 0)
    assign_step(te_r, doc_id, 'R', ctx.user('TE_R', 0),
                reviewer_loginid=reviewer['loginid'] if reviewer else None)
    approve_step(te_r, doc_id, 'R')
    if reviewer:
        approve_step(ctx.actor('TE_R', 1), doc_id, 'RV')


def to_parallel(ctx, *, plel=False, pl_count=1, **kw):
    """상신 → PL 합의 → R 합의까지 끝내 병렬 단계에 진입한 문서를 만든다."""
    doc_id, author, pls = submitted_doc(ctx, pl_count=pl_count, plel=plel, **kw)
    pass_pl_stage(ctx, doc_id, pls)
    pass_r_stage(ctx, doc_id)
    return doc_id, author, pls


def complete_p(ctx, doc_id, reviewers=()):
    claim_step(ctx.actor('TE_P', 0), doc_id, 'P')
    approve_step(ctx.actor('TE_P', 0), doc_id, 'P',
                 reviewer_loginids=[r['loginid'] for r in reviewers])
    for i, _ in enumerate(reviewers):
        approve_step(ctx.actor('TE_P', i + 1), doc_id, 'PV')


def complete_j(ctx, doc_id):
    claim_step(ctx.actor('TE_J', 0), doc_id, 'J')
    approve_step(ctx.actor('TE_J', 0), doc_id, 'J')


def complete_o(ctx, doc_id):
    claim_step(ctx.actor('TE_O', 0), doc_id, 'O')
    approve_step(ctx.actor('TE_O', 0), doc_id, 'O')


def complete_e(ctx, doc_id):
    """E 는 2차 검토자 지정이 필수라 TE_E 가 2명 필요하다."""
    ctx.need(TE_E=2)
    claim_step(ctx.actor('TE_E', 0), doc_id, 'E')
    approve_step(ctx.actor('TE_E', 0), doc_id, 'E',
                 reviewer_loginids=[ctx.user('TE_E', 1)['loginid']])
    approve_step(ctx.actor('TE_E', 1), doc_id, 'EV')


def complete_ra(ctx, doc_id, actor=None):
    """후결자(RA) 전원 합의. 고정 후결자는 TE_R 계정이라 그 사람으로 처리한다."""
    doc = fetch(ctx.actor('PL', 0), doc_id)
    for step in steps(doc, agent='RA', action='pending'):
        approve_step(_actor_for_loginid(ctx, step.get('assignee_loginid')), doc_id, 'RA')


def _actor_for_loginid(ctx, loginid):
    """loginid 로 로그인한 Actor 를 만든다(역할은 dev-login 응답에서 채워진다)."""
    if not loginid:
        raise CaseFailure('담당자가 지정되지 않은 단계라 합의할 사람을 찾을 수 없다.')
    key = ('__loginid__', loginid)
    if key not in ctx._actors:
        ctx._actors[key] = Actor(ctx.api, loginid).login()
    return ctx._actors[key]


# ===== 검증 헬퍼 =====

def _expect(res, expect, what):
    if expect is None:
        return res
    codes = expect if isinstance(expect, (list, tuple, set)) else (expect,)
    if res.status not in codes:
        raise CaseFailure(f'{what}: 기대 {codes} / 실제 {res.status} — {res.error_text()}')
    return res


def expect_doc_status(actor, doc_id, expected, note=''):
    doc = fetch(actor, doc_id)
    if doc.get('status') != expected:
        raise CaseFailure(f'문서 상태 기대 {expected!r} / 실제 {doc.get("status")!r} {note}')
    return doc


def expect_steps(doc, agent, count=None, action=None, note=''):
    found = steps(doc, agent=agent, action=action)
    if count is not None and len(found) != count:
        raise CaseFailure(f'{agent} 단계 {count}개 기대 / 실제 {len(found)}개 {note}')
    return found


def expect_no_step(doc, agent, note=''):
    found = steps(doc, agent=agent)
    if found:
        raise CaseFailure(f'{agent} 단계가 생기면 안 되는데 {len(found)}개 있다 {note}')


def expect_gone(actor, doc_id):
    res = actor.get(f'/api/documents/{doc_id}/')
    if res.status != 404:
        raise CaseFailure(f'문서가 삭제됐어야 하는데 조회된다: {res.status}')
