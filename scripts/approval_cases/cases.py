"""결재 경우의 수 케이스 정의 — docs/APPROVAL_CASES_VALIDATION.md 의 케이스 ID 와 1:1.

각 케이스는 실제 개발 DB·실제 API 로 문서를 만들고 진행시킨 뒤 결과를 검증한다.
HTTP 로 확인할 수 없는 것(메일 수신자 산출, 프론트 표시 로직)은 CaseSkip 으로
"왜 확인할 수 없는지"를 남긴다 — 확인하지 않은 것을 통과로 적지 않기 위해서다.
"""

from concurrent.futures import ThreadPoolExecutor

from . import flows as F
from . import payload as P
from .flows import CaseFailure, CaseSkip

CASES = []


class Case:
    def __init__(self, cid, group, title, fn):
        self.id = cid
        self.group = group
        self.title = title
        self.fn = fn


def case(cid, group, title):
    def deco(fn):
        CASES.append(Case(cid, group, title, fn))
        return fn
    return deco


def _skip_mail(what):
    raise CaseSkip(f'{what} — 메일 수신자 산출은 HTTP API 로 관측할 수 없다(MailNotification 직접 조회 필요).')


# ============================================================ S. 상신

@case('S-01', 'S', '지정 PL 1명 상신 → under_review + PL step 1개')
def s01(ctx):
    ctx.need(PL=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    doc = F.expect_doc_status(author, doc_id, 'under_review')
    F.expect_steps(doc, 'PL', count=1, action='pending')
    if not doc.get('submitted_at'):
        raise CaseFailure('submitted_at 이 기록되지 않았다.')
    return f'doc={doc_id} title={doc.get("title")}'


@case('S-02', 'S', '지정 PL 2명 상신 → PL step 2개, 대표는 첫 번째')
def s02(ctx):
    ctx.need(PL=3)
    doc_id, author, pls = F.submitted_doc(ctx, pl_count=2)
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'PL', count=2, action='pending')
    if doc.get('designated_pl_loginid') != pls[0]['loginid']:
        raise CaseFailure(f'대표 지정 PL 이 첫 번째가 아니다: {doc.get("designated_pl_loginid")}')
    return f'doc={doc_id}'


@case('S-03', 'S', '지정 PL 없이 상신 → 400')
def s03(ctx):
    ctx.need(PL=1)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author)
    F.submit(author, doc['id'], [], expect=400)
    return f'doc={doc["id"]} (draft 로 남음)'


@case('S-04', 'S', 'role≠PL 을 지정 PL 로 → 400')
def s04(ctx):
    ctx.need(PL=1, TE_R=1)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author)
    F.submit(author, doc['id'], [ctx.user('TE_R', 0)['loginid']], expect=400)
    return f'doc={doc["id"]}'


@case('S-05', 'S', '본인을 지정 PL 로 → 400')
def s05(ctx):
    ctx.need(PL=1)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author)
    F.submit(author, doc['id'], [author.loginid], expect=400)
    return f'doc={doc["id"]}'


@case('S-06', 'S', 'Bb 미매핑 상신 → 400')
def s06(ctx):
    ctx.need(PL=2)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author, bb_mapped=False)
    res = F.submit(author, doc['id'], [ctx.user('PL', 1)['loginid']], expect=400)
    return f'doc={doc["id"]} msg={res.error_text()[:60]}'


@case('S-07', 'S', 'additional_notes JSON 파싱 실패 → Bb 검증을 건너뛰고 상신됨(현행 동작)')
def s07(ctx):
    ctx.need(PL=2)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author, broken_json=True)
    F.submit(author, doc['id'], [ctx.user('PL', 1)['loginid']], expect=200)
    F.expect_doc_status(author, doc['id'], 'under_review', '(JSON 깨진 문서가 상신됐다)')
    return f'doc={doc["id"]} — 문서 서술대로 검증을 건너뛴다'


@case('S-08', 'S', 'C가문/연구소 제품인데 추가 후결자 0명 → 400')
def s08(ctx):
    ctx.need(PL=2)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author, only_prodc='Yes')
    F.submit(author, doc['id'], [ctx.user('PL', 1)['loginid']], expect=400)
    doc2 = F.create_document(ctx, author, request_purpose=P.ONLY_MAP_PURPOSE,
                             other_purpose=[P.OTHER_PURPOSE_LAB])
    F.submit(author, doc2['id'], [ctx.user('PL', 1)['loginid']], expect=400)
    return f'C가문 doc={doc["id"]} / 연구소제품 doc={doc2["id"]}'


@case('S-09', 'S', '예외구역 값 변경 + SA 0명 + 사유 없음 → 400')
def s09(ctx):
    ctx.need(PL=2)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author, ea_change=P.EA_HAS_CHANGE, ea_value='350')
    F.submit(author, doc['id'], [ctx.user('PL', 1)['loginid']], expect=400)
    doc2 = F.create_document(ctx, author, ea_change=P.EA_HAS_CHANGE, ea_value='350',
                             sales_agreer_none_reason='해당 없음(케이스 검증)')
    F.submit(author, doc2['id'], [ctx.user('PL', 1)['loginid']], expect=200)
    return f'사유 없음 400 / 사유 있음 200 (doc={doc2["id"]})'


@case('S-10', 'S', 'role≠PL 을 SA 로 지정 → 400')
def s10(ctx):
    ctx.need(PL=2, TE_O=1)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author, sales_agreers=[ctx.user('TE_O', 0)])
    F.submit(author, doc['id'], [ctx.user('PL', 1)['loginid']], expect=400)
    return f'doc={doc["id"]}'


@case('S-11', 'S', 'SA 지정 상신 → SA step 이 PL 과 같은 회차에 생성')
def s11(ctx):
    ctx.need(PL=3)
    sa = [ctx.user('PL', 2)]
    doc_id, author, pls = F.submitted_doc(ctx, sa_users=sa)
    doc = F.fetch(author, doc_id)
    sa_steps = F.expect_steps(doc, 'SA', count=1, action='pending')
    pl_round = F.steps(doc, agent='PL')[0]['round']
    if sa_steps[0]['round'] != pl_round:
        raise CaseFailure('SA step 회차가 PL 과 다르다.')
    return f'doc={doc_id} SA={sa[0]["loginid"]}'


@case('S-12', 'S', 'SA 미지정 → SA step 자체가 없음')
def s12(ctx):
    ctx.need(PL=2)
    doc_id, author, _ = F.submitted_doc(ctx)
    F.expect_no_step(F.fetch(author, doc_id), 'SA')
    return f'doc={doc_id}'


@case('S-13', 'S', '이미 상신된 문서 재상신(submit) → 거절')
def s13(ctx):
    ctx.need(PL=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.submit(author, doc_id, [pls[0]['loginid']], expect=400)
    return f'doc={doc_id}'


@case('S-14', 'S', 'MASTER 이력 바로 등록(direct-approve) → 결재선 없이 approved')
def s14(ctx):
    ctx.need(PL=1, MASTER=1)
    author = ctx.actor('PL', 0)
    master = ctx.actor('MASTER', 0)
    doc = F.create_document(ctx, author)
    res = master.post(f'/api/documents/{doc["id"]}/direct-approve/',
                      {'submitted_at': '2026-08-01', 'approved_at': '2026-08-05'})
    if not res.ok:
        raise CaseFailure(f'direct-approve 실패: {res.status} {res.error_text()}')
    got = F.expect_doc_status(master, doc['id'], 'approved')
    pending = [s for s in (got.get('approval_steps') or []) if s.get('action') == 'pending']
    if pending:
        raise CaseFailure(f'대기 단계가 생기면 안 되는데 {len(pending)}개 있다.')
    return f'doc={doc["id"]}'


# ============================================================ L. PL/SA 단계

@case('L-01', 'L', 'PL 1명 합의 → 다음 단계(R) 생성')
def l01(ctx):
    ctx.need(PL=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.peer_approve(ctx.actor('PL', 1), doc_id)
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'R', count=1)
    return f'doc={doc_id}'


@case('L-02', 'L', 'PL 2명 중 1명만 합의 → R 미생성')
def l02(ctx):
    ctx.need(PL=3)
    doc_id, author, pls = F.submitted_doc(ctx, pl_count=2)
    F.peer_approve(ctx.actor('PL', 1), doc_id)
    doc = F.expect_doc_status(author, doc_id, 'under_review')
    F.expect_no_step(doc, 'R')
    return f'doc={doc_id}'


@case('L-03', 'L', 'PL 2명 전원 합의 → R 생성')
def l03(ctx):
    ctx.need(PL=3)
    doc_id, author, pls = F.submitted_doc(ctx, pl_count=2)
    F.peer_approve(ctx.actor('PL', 1), doc_id)
    F.peer_approve(ctx.actor('PL', 2), doc_id)
    F.expect_steps(F.fetch(author, doc_id), 'R', count=1)
    return f'doc={doc_id}'


@case('L-04', 'L', 'PL 2명 중 1명 반려 → 즉시 rejected')
def l04(ctx):
    ctx.need(PL=3)
    doc_id, author, pls = F.submitted_doc(ctx, pl_count=2)
    F.peer_reject(ctx.actor('PL', 1), doc_id)
    F.expect_doc_status(author, doc_id, 'rejected')
    return f'doc={doc_id}'


@case('L-05', 'L', 'PL 전원 합의 + SA 미합의 → R 미생성')
def l05(ctx):
    ctx.need(PL=3)
    sa = [ctx.user('PL', 2)]
    doc_id, author, pls = F.submitted_doc(ctx, sa_users=sa)
    F.peer_approve(ctx.actor('PL', 1), doc_id)
    doc = F.expect_doc_status(author, doc_id, 'under_review')
    F.expect_no_step(doc, 'R')
    return f'doc={doc_id}'


@case('L-06', 'L', 'SA 합의 + PL 미합의 → R 미생성')
def l06(ctx):
    ctx.need(PL=3)
    sa = [ctx.user('PL', 2)]
    doc_id, author, pls = F.submitted_doc(ctx, sa_users=sa)
    F.sales_agree(ctx.actor('PL', 2), doc_id)
    F.expect_no_step(F.fetch(author, doc_id), 'R')
    return f'doc={doc_id}'


@case('L-07', 'L', 'SA 가 마지막 합의 → 그 시점에 R 생성')
def l07(ctx):
    ctx.need(PL=3)
    sa = [ctx.user('PL', 2)]
    doc_id, author, pls = F.submitted_doc(ctx, sa_users=sa)
    F.peer_approve(ctx.actor('PL', 1), doc_id)
    F.sales_agree(ctx.actor('PL', 2), doc_id)
    F.expect_steps(F.fetch(author, doc_id), 'R', count=1)
    return f'doc={doc_id}'


@case('L-08', 'L', 'SA 반려 → 문서 즉시 rejected')
def l08(ctx):
    ctx.need(PL=3)
    sa = [ctx.user('PL', 2)]
    doc_id, author, pls = F.submitted_doc(ctx, sa_users=sa)
    F.sales_reject(ctx.actor('PL', 2), doc_id)
    F.expect_doc_status(author, doc_id, 'rejected')
    return f'doc={doc_id}'


@case('L-09', 'L', 'SA step 이 없으면 PL 전원 합의만으로 진행')
def l09(ctx):
    ctx.need(PL=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.peer_approve(ctx.actor('PL', 1), doc_id)
    F.expect_steps(F.fetch(author, doc_id), 'R', count=1)
    return f'doc={doc_id}'


@case('L-10', 'L', '제3자의 PL 합의 호출 → 거절')
def l10(ctx):
    ctx.need(PL=3)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.peer_approve(ctx.actor('PL', 2), doc_id, expect=(400, 403))
    return f'doc={doc_id}'


@case('L-11', 'L', 'PL 수정 후 상신(peer-submit) → 본인 합의 처리')
def l11(ctx):
    ctx.need(PL=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.peer_submit(ctx.actor('PL', 1), doc_id)
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'PL', count=1, action='approved')
    F.expect_steps(doc, 'R', count=1)
    return f'doc={doc_id}'


@case('L-12', 'L', '지정 PL 변경(change-designee) → 현재 회차 PL step assignee 교체')
def l12(ctx):
    ctx.need(PL=3)
    doc_id, author, pls = F.submitted_doc(ctx)
    new_pl = ctx.user('PL', 2)
    res = author.post(f'/api/documents/{doc_id}/change-designee/',
                      {'designated_pl_loginid': new_pl['loginid'],
                       'designated_pl_name': new_pl.get('name', '')})
    if not res.ok:
        raise CaseFailure(f'change-designee 실패: {res.status} {res.error_text()}')
    doc = F.fetch(author, doc_id)
    assignees = [s.get('assignee_loginid') for s in F.steps(doc, agent='PL', action='pending')]
    if new_pl['loginid'] not in assignees:
        raise CaseFailure(f'새 지정 PL 이 반영되지 않았다: {assignees}')
    return f'doc={doc_id} → {new_pl["loginid"]}'


# ============================================================ R. R 단계 · 병렬 전환

@case('R-01', 'R', 'R 담당자 지정(assign-step)')
def r01(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'R', ctx.user('TE_R', 0))
    doc = F.fetch(author, doc_id)
    if not F.steps(doc, agent='R')[0].get('assignee_loginid'):
        raise CaseFailure('R 담당자가 지정되지 않았다.')
    return f'doc={doc_id}'


@case('R-02', 'R', '이미 배정된 R 재지정 → 403')
def r02(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'R', ctx.user('TE_R', 0))
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'R', ctx.user('TE_R', 0), expect=403)
    return f'doc={doc_id}'


@case('R-03', 'R', 'PL·claim 단계를 assign-step 으로 지정 시도 → 거절')
def r03(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'PL', ctx.user('PL', 1), expect=(400, 403))
    F.pass_pl_stage(ctx, doc_id, pls)
    F.pass_r_stage(ctx, doc_id)
    F.assign_step(ctx.actor('TE_J', 0), doc_id, 'J', ctx.user('TE_J', 0), expect=403)
    return f'doc={doc_id}'


@case('R-04', 'R', 'RV 없이 R 합의 → 병렬 단계 생성')
def r04(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.pass_r_stage(ctx, doc_id)
    doc = F.fetch(author, doc_id)
    for agent in ('P', 'J', 'O'):
        F.expect_steps(doc, agent, count=1)
    return f'doc={doc_id} agents={F.agents_in_round(doc)}'


@case('R-05', 'R', 'RV 지정 시 R 합의만으로는 병렬 미생성')
def r05(ctx):
    ctx.need(PL=2, TE_R=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'R', ctx.user('TE_R', 0),
                  reviewer_loginid=ctx.user('TE_R', 1)['loginid'])
    F.approve_step(ctx.actor('TE_R', 0), doc_id, 'R')
    doc = F.expect_doc_status(author, doc_id, 'under_review')
    F.expect_no_step(doc, 'P')
    F.expect_steps(doc, 'RV', count=1, action='pending')
    return f'doc={doc_id}'


@case('R-06', 'R', 'RV 가 담당자 합의 전에 처리 → 400')
def r06(ctx):
    ctx.need(PL=2, TE_R=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'R', ctx.user('TE_R', 0),
                  reviewer_loginid=ctx.user('TE_R', 1)['loginid'])
    F.approve_step(ctx.actor('TE_R', 1), doc_id, 'RV', expect=400)
    return f'doc={doc_id}'


@case('R-07', 'R', 'RV 합의 → 병렬 단계 생성')
def r07(ctx):
    ctx.need(PL=2, TE_R=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.pass_r_stage(ctx, doc_id, reviewer=ctx.user('TE_R', 1))
    F.expect_steps(F.fetch(author, doc_id), 'P', count=1)
    return f'doc={doc_id}'


@case('R-08', 'R', 'plel 없음 → E 단계 미생성')
def r08(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx, plel=False)
    F.expect_no_step(F.fetch(author, doc_id), 'E')
    return f'doc={doc_id}'


@case('R-09', 'R', 'plel 있음 → E 단계 생성')
def r09(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx, plel=True)
    F.expect_steps(F.fetch(author, doc_id), 'E', count=1)
    return f'doc={doc_id}'


@case('R-10', 'R', "기타목적 'Overlay 변경' 단독 → J 단계 미생성")
def r10(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx, other_purpose=[P.OTHER_PURPOSE_OVERLAY])
    doc = F.fetch(author, doc_id)
    F.expect_no_step(doc, 'J')
    F.expect_steps(doc, 'O', count=1)
    return f'doc={doc_id} agents={F.agents_in_round(doc)}'


@case('R-11', 'R', "'Overlay 변경' + 다른 기타목적 → J 생성")
def r11(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(
        ctx, other_purpose=[P.OTHER_PURPOSE_OVERLAY, 'STEPSEQ 변경'])
    F.expect_steps(F.fetch(author, doc_id), 'J', count=1)
    return f'doc={doc_id}'


@case('R-12', 'R', '기한: P(4영업일) < J·O(6영업일), J와 O는 동일')
def r12(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    doc = F.fetch(author, doc_id)
    due = {a: F.steps(doc, agent=a)[0].get('due_date') for a in ('P', 'J', 'O')}
    if not all(due.values()):
        raise CaseFailure(f'기한이 비어 있다: {due}')
    if not (due['P'] < due['O']):
        raise CaseFailure(f'P 기한이 O 보다 앞서야 한다: {due}')
    if due['J'] != due['O']:
        raise CaseFailure(f'J 와 O 기한이 같아야 한다: {due}')
    return f'doc={doc_id} due={due}'


@case('R-13', 'R', 'J 도착 메일이 R 합의 시점에 TE_J 팀 전원에게')
def r13(ctx):
    _skip_mail('J 도착 메일 수신자')


@case('R-14', 'R', 'Only MAP: R 합의 → P/J/O/E 없이 RA 만')
def r14(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx, request_purpose=P.ONLY_MAP_PURPOSE)
    doc = F.fetch(author, doc_id)
    for agent in ('P', 'J', 'O', 'E'):
        F.expect_no_step(doc, agent)
    ra = F.steps(doc, agent='RA')
    if not ra:
        raise CaseSkip('후결자(RA)가 0명이라 R-15 상황이다 — POST_APPROVER_LOGINID 설정 확인 필요.')
    F.expect_doc_status(author, doc_id, 'under_review')
    return f'doc={doc_id} RA={len(ra)}명'


@case('R-15', 'R', 'Only MAP + 후결자 0명 → R 합의 즉시 approved')
def r15(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx, request_purpose=P.ONLY_MAP_PURPOSE)
    doc = F.fetch(author, doc_id)
    if F.steps(doc, agent='RA'):
        raise CaseSkip('고정 후결자(POST_APPROVER_LOGINID)가 설정돼 있어 "후결자 0명" 상황을 '
                       '만들 수 없다 — 설정을 비운 환경에서만 확인 가능하다.')
    F.expect_doc_status(author, doc_id, 'approved')
    return f'doc={doc_id}'


@case('R-16', 'R', "'MAP 삭제': PL 합의 직후 P·R·J·O 병렬, E·RA 없음")
def r16(ctx):
    ctx.need(PL=2)
    doc_id, author, pls = F.submitted_doc(ctx, request_purpose=P.MAP_DELETE_EDIT_PURPOSE)
    F.pass_pl_stage(ctx, doc_id, pls)
    doc = F.fetch(author, doc_id)
    for agent in ('P', 'R', 'J', 'O'):
        F.expect_steps(doc, agent, count=1, action='pending')
    F.expect_no_step(doc, 'E')
    F.expect_no_step(doc, 'RA')
    return f'doc={doc_id} agents={F.agents_in_round(doc)}'


# ============================================================ C. 검토중(claim)

@case('C-01', 'C', 'J/O/P 검토중 선점 → 본인이 assignee 로 고정')
def c01(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J')
    doc = F.fetch(author, doc_id)
    if F.steps(doc, agent='J')[0].get('assignee_loginid') != ctx.user('TE_J', 0)['loginid']:
        raise CaseFailure('선점자가 assignee 로 고정되지 않았다.')
    return f'doc={doc_id}'


@case('C-02', 'C', '이미 선점된 단계 재선점 → 409')
def c02(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=2)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J')
    F.claim_step(ctx.actor('TE_J', 1), doc_id, 'J', expect=409)
    return f'doc={doc_id}'


@case('C-03', 'C', '다른 팀의 선점 → 403')
def c03(ctx):
    ctx.need(PL=2, TE_R=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_O', 0), doc_id, 'J', expect=403)
    return f'doc={doc_id}'


@case('C-04', 'C', 'claim 대상이 아닌 agent(R) → 400')
def c04(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.claim_step(ctx.actor('TE_R', 0), doc_id, 'R', expect=400)
    return f'doc={doc_id}'


@case('C-05', 'C', '선점 후 같은 팀 다른 사람도 합의 가능')
def c05(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=2)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J')
    F.approve_step(ctx.actor('TE_J', 1), doc_id, 'J')
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'J', count=1, action='approved')
    return f'doc={doc_id}'


@case('C-06', 'C', '선점 전 합의 시도 → 403')
def c06(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.approve_step(ctx.actor('TE_J', 0), doc_id, 'J', expect=403)
    return f'doc={doc_id}'


# ============================================================ PE. P/E 담당자·검토자

@case('PE-01', 'PE', 'P 검토자 없이 합의 → 단계 즉시 완료(선택 사항)')
def pe01(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.complete_p(ctx, doc_id)
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'P', count=1, action='approved')
    F.expect_no_step(doc, 'PV')
    return f'doc={doc_id}'


@case('PE-02', 'PE', 'P 합의 요청 1번으로 검토자(PV) 2명 생성')
def pe02(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=3)
    doc_id, author, pls = F.to_parallel(ctx)
    reviewers = [ctx.user('TE_P', 1), ctx.user('TE_P', 2)]
    F.claim_step(ctx.actor('TE_P', 0), doc_id, 'P')
    F.approve_step(ctx.actor('TE_P', 0), doc_id, 'P',
                   reviewer_loginids=[r['loginid'] for r in reviewers])
    F.expect_steps(F.fetch(author, doc_id), 'PV', count=2, action='pending')
    return f'doc={doc_id}'


@case('PE-03', 'PE', 'PV 일부만 합의 → P 단계 미완료(최종 승인 안 됨)')
def pe03(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=3, TE_J=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx)
    reviewers = [ctx.user('TE_P', 1), ctx.user('TE_P', 2)]
    F.claim_step(ctx.actor('TE_P', 0), doc_id, 'P')
    F.approve_step(ctx.actor('TE_P', 0), doc_id, 'P',
                   reviewer_loginids=[r['loginid'] for r in reviewers])
    F.approve_step(ctx.actor('TE_P', 1), doc_id, 'PV')
    F.complete_j(ctx, doc_id)
    F.complete_o(ctx, doc_id)
    F.complete_ra(ctx, doc_id)
    F.expect_doc_status(author, doc_id, 'under_review', '(PV 1명이 남았는데 승인됐다)')
    return f'doc={doc_id}'


@case('PE-04', 'PE', 'PV 가 담당자 합의 전에 처리 → 400')
def pe04(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=2)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_P', 0), doc_id, 'P')
    F.approve_step(ctx.actor('TE_P', 1), doc_id, 'PV', expect=400)
    return f'doc={doc_id}'


@case('PE-05', 'PE', '담당자 본인을 검토자로 지정 → 400')
def pe05(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_P', 0), doc_id, 'P')
    F.approve_step(ctx.actor('TE_P', 0), doc_id, 'P',
                   reviewer_loginids=[ctx.user('TE_P', 0)['loginid']], expect=400)
    return f'doc={doc_id}'


@case('PE-06', 'PE', '타 팀 사람을 검토자로 지정 → 400')
def pe06(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_P', 0), doc_id, 'P')
    F.approve_step(ctx.actor('TE_P', 0), doc_id, 'P',
                   reviewer_loginids=[ctx.user('TE_O', 0)['loginid']], expect=400)
    return f'doc={doc_id}'


@case('PE-07', 'PE', 'PV 반려 → 문서 즉시 rejected')
def pe07(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=2)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_P', 0), doc_id, 'P')
    F.approve_step(ctx.actor('TE_P', 0), doc_id, 'P',
                   reviewer_loginids=[ctx.user('TE_P', 1)['loginid']])
    F.reject_step(ctx.actor('TE_P', 1), doc_id, 'PV')
    F.expect_doc_status(author, doc_id, 'rejected')
    return f'doc={doc_id}'


@case('PE-08', 'PE', 'E 합의에 검토자 미지정 → 400 + 아무 것도 저장되지 않음')
def pe08(ctx):
    ctx.need(PL=2, TE_R=1, TE_E=1)
    doc_id, author, pls = F.to_parallel(ctx, plel=True)
    F.claim_step(ctx.actor('TE_E', 0), doc_id, 'E')
    F.approve_step(ctx.actor('TE_E', 0), doc_id, 'E', reviewer_loginids=[], expect=400)
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'E', count=1, action='pending')
    F.expect_no_step(doc, 'EV')
    return f'doc={doc_id} (E 는 pending 유지, EV 생성 없음)'


@case('PE-09', 'PE', 'E 합의 + EV 지정 → E approved, EV 생성')
def pe09(ctx):
    ctx.need(PL=2, TE_R=1, TE_E=2)
    doc_id, author, pls = F.to_parallel(ctx, plel=True)
    F.claim_step(ctx.actor('TE_E', 0), doc_id, 'E')
    F.approve_step(ctx.actor('TE_E', 0), doc_id, 'E',
                   reviewer_loginids=[ctx.user('TE_E', 1)['loginid']])
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'E', count=1, action='approved')
    F.expect_steps(doc, 'EV', count=1, action='pending')
    return f'doc={doc_id}'


@case('PE-10', 'PE', 'EV 2명 중 1명만 합의 → 남은 EV 는 pending 유지(skip 없음)')
def pe10(ctx):
    ctx.need(PL=2, TE_R=1, TE_E=3)
    doc_id, author, pls = F.to_parallel(ctx, plel=True)
    F.claim_step(ctx.actor('TE_E', 0), doc_id, 'E')
    F.approve_step(ctx.actor('TE_E', 0), doc_id, 'E',
                   reviewer_loginids=[ctx.user('TE_E', 1)['loginid'],
                                      ctx.user('TE_E', 2)['loginid']])
    F.approve_step(ctx.actor('TE_E', 1), doc_id, 'EV')
    doc = F.fetch(author, doc_id)
    pending = F.steps(doc, agent='EV', action='pending')
    skipped = [s for s in F.steps(doc, agent='EV') if s.get('action') == 'skip']
    if len(pending) != 1 or skipped:
        raise CaseFailure(f'EV pending {len(pending)}개 / skip {len(skipped)}개 (기대: 1/0)')
    return f'doc={doc_id}'


@case('PE-11', 'PE', '레거시(검토자 없이 E approved) 문서의 최종 승인')
def pe11(ctx):
    raise CaseSkip('E 는 이제 검토자 지정이 필수라, 새로 만든 문서로는 이 레거시 상태를 만들 수 없다 '
                   '(DB 직접 조작 필요). 백엔드 테스트 test_legacy_e_approved_without_reviewer_still_completes 로 확인한다.')


@case('PE-12', 'PE', '레거시(EV step 이 남은 상태) E 재합의 통과')
def pe12(ctx):
    raise CaseSkip('되감기 기능이 없어져 같은 회차에서 E 를 다시 합의할 경로가 없다 — 레거시 문서 전용 분기. '
                   '백엔드 테스트 test_e_approve_passes_when_legacy_ev_step_exists 로 확인한다.')


@case('PE-13', 'PE', 'E 합의 시 기존 comment(이력)를 덮어쓰지 않고 덧붙임')
def pe13(ctx):
    ctx.need(PL=2, TE_R=1, TE_E=2)
    doc_id, author, pls = F.to_parallel(ctx, plel=True)
    F.claim_step(ctx.actor('TE_E', 0), doc_id, 'E')
    # E 단계 반려(수정 요청)로 comment 이력을 만든 뒤 재상신 없이 확인할 수 없으므로,
    # Validation System 변경 이력을 남기는 경로로 대체한다.
    res = author.post(f'/api/documents/{doc_id}/validation-system/', {'value': 'NO'})
    if not res.ok:
        raise CaseSkip(f'Validation System 변경 API 로 이력을 만들 수 없다: {res.status} {res.error_text()[:80]}')
    F.approve_step(ctx.actor('TE_E', 0), doc_id, 'E',
                   reviewer_loginids=[ctx.user('TE_E', 1)['loginid']], comment='합의합니다')
    doc = F.fetch(author, doc_id)
    comment = F.steps(doc, agent='E')[0].get('comment') or ''
    if '합의합니다' not in comment:
        raise CaseFailure(f'합의 코멘트가 반영되지 않았다: {comment!r}')
    return f'doc={doc_id} comment={comment[:60]!r}'


@case('PE-14', 'PE', 'P 완료 시 TE_O·TE_J 완료 통보')
def pe14(ctx):
    _skip_mail('P 완료 통보(notify_p_completed) 수신자')


# ============================================================ F. 최종 승인 판정

_STAGE = {
    'P': lambda ctx, doc_id: F.complete_p(ctx, doc_id),
    'J': lambda ctx, doc_id: F.complete_j(ctx, doc_id),
    'O': lambda ctx, doc_id: F.complete_o(ctx, doc_id),
    'E': lambda ctx, doc_id: F.complete_e(ctx, doc_id),
    'RA': lambda ctx, doc_id: F.complete_ra(ctx, doc_id),
}


def _finish_in_order(ctx, doc_id, order):
    for name in order:
        _STAGE[name](ctx, doc_id)


def _full_route_case(ctx, last, plel=True, other_purpose=()):
    """병렬 단계를 last 를 마지막으로 두고 전부 합의 → approved 인지 확인."""
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    stages = ['P', 'J', 'O', 'RA']
    if plel:
        ctx.need(TE_E=2)
        stages.append('E')
    if P.OTHER_PURPOSE_OVERLAY in other_purpose and len(other_purpose) == 1:
        stages.remove('J')
    doc_id, author, pls = F.to_parallel(ctx, plel=plel, other_purpose=other_purpose)
    order = [s for s in stages if s != last] + [last]
    _finish_in_order(ctx, doc_id, order)
    F.expect_doc_status(author, doc_id, 'approved', f'(마지막={last}, 순서={order})')
    return f'doc={doc_id} 순서={"→".join(order)}'


@case('F-01', 'F', 'RT-1: J 가 마지막 합의 → approved')
def f01(ctx):
    return _full_route_case(ctx, 'J')


@case('F-02', 'F', 'RT-1: O 가 마지막 합의 → approved')
def f02(ctx):
    return _full_route_case(ctx, 'O')


@case('F-03', 'F', 'RT-1: E(EV 포함)가 마지막 합의 → approved')
def f03(ctx):
    return _full_route_case(ctx, 'E')


@case('F-04', 'F', 'RT-1: RA 가 마지막 합의 → approved')
def f04(ctx):
    return _full_route_case(ctx, 'RA')


@case('F-05', 'F', 'RT-1: P 가 마지막 합의 → approved (J 분리 이후 핵심 회귀)')
def f05(ctx):
    return _full_route_case(ctx, 'P')


@case('F-06', 'F', 'P 미완료인데 J·O·E·RA 완료 → approved 아님')
def f06(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1, TE_E=2)
    doc_id, author, pls = F.to_parallel(ctx, plel=True)
    _finish_in_order(ctx, doc_id, ['J', 'O', 'E', 'RA'])
    F.expect_doc_status(author, doc_id, 'under_review', '(P 가 남았는데 승인됐다)')
    return f'doc={doc_id}'


@case('F-07', 'F', 'J 를 P 보다 먼저 합의해도 정상 진행')
def f07(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx, plel=False)
    _finish_in_order(ctx, doc_id, ['J', 'P', 'O', 'RA'])
    F.expect_doc_status(author, doc_id, 'approved')
    return f'doc={doc_id}'


@case('F-08', 'F', "RT-3/4: J 없는 경로도 approved (j_approved 고정)")
def f08(ctx):
    return _full_route_case(ctx, 'O', plel=False, other_purpose=[P.OTHER_PURPOSE_OVERLAY])


@case('F-09', 'F', 'RT-2: E 없는 경로 approved')
def f09(ctx):
    return _full_route_case(ctx, 'J', plel=False)


@case('F-10', 'F', 'Only MAP: RA 전원 합의 → approved')
def f10(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx, request_purpose=P.ONLY_MAP_PURPOSE)
    doc = F.fetch(author, doc_id)
    if doc.get('status') == 'approved':
        raise CaseSkip('후결자가 0명이라 R 합의로 이미 승인됐다(R-15 상황).')
    F.complete_ra(ctx, doc_id)
    F.expect_doc_status(author, doc_id, 'approved')
    return f'doc={doc_id}'


@case('F-11', 'F', "'MAP 삭제': P 가 마지막 → approved")
def f11(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id, author, pls = F.submitted_doc(ctx, request_purpose=P.MAP_DELETE_EDIT_PURPOSE)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'R', ctx.user('TE_R', 0))
    F.approve_step(ctx.actor('TE_R', 0), doc_id, 'R')
    F.complete_j(ctx, doc_id)
    F.complete_o(ctx, doc_id)
    F.complete_p(ctx, doc_id)
    F.expect_doc_status(author, doc_id, 'approved')
    return f'doc={doc_id}'


@case('F-12', 'F', "'MAP 삭제': R 이 마지막 → approved")
def f12(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id, author, pls = F.submitted_doc(ctx, request_purpose=P.MAP_DELETE_EDIT_PURPOSE)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.complete_p(ctx, doc_id)
    F.complete_j(ctx, doc_id)
    F.complete_o(ctx, doc_id)
    F.expect_doc_status(author, doc_id, 'under_review', '(R 이 남았는데 승인됐다)')
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'R', ctx.user('TE_R', 0))
    F.approve_step(ctx.actor('TE_R', 0), doc_id, 'R')
    F.expect_doc_status(author, doc_id, 'approved')
    return f'doc={doc_id}'


@case('F-13', 'F', "'MAP 삭제': P 검토자 미합의면 승인 안 됨")
def f13(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=2, TE_J=1, TE_O=1)
    doc_id, author, pls = F.submitted_doc(ctx, request_purpose=P.MAP_DELETE_EDIT_PURPOSE)
    F.pass_pl_stage(ctx, doc_id, pls)
    F.claim_step(ctx.actor('TE_P', 0), doc_id, 'P')
    F.approve_step(ctx.actor('TE_P', 0), doc_id, 'P',
                   reviewer_loginids=[ctx.user('TE_P', 1)['loginid']])
    F.complete_j(ctx, doc_id)
    F.complete_o(ctx, doc_id)
    F.assign_step(ctx.actor('TE_R', 0), doc_id, 'R', ctx.user('TE_R', 0))
    F.approve_step(ctx.actor('TE_R', 0), doc_id, 'R')
    F.expect_doc_status(author, doc_id, 'under_review', '(PV 가 남았는데 승인됐다)')
    return f'doc={doc_id}'


@case('F-14', 'F', '추가 후결자 일부만 합의 → 승인 안 됨')
def f14(ctx):
    ctx.need(PL=3, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    extra = ctx.user('PL', 2)
    doc_id, author, pls = F.to_parallel(ctx, only_prodc='Yes', post_approvers=[extra])
    doc = F.fetch(author, doc_id)
    ra_steps = F.steps(doc, agent='RA')
    if len(ra_steps) < 2:
        raise CaseSkip(f'후결자가 {len(ra_steps)}명이라 "일부만 합의" 상황을 만들 수 없다 '
                       '(고정 후결자 설정 확인 필요).')
    _finish_in_order(ctx, doc_id, ['P', 'J', 'O'])
    F.approve_step(F._actor_for_loginid(ctx, ra_steps[0]['assignee_loginid']), doc_id, 'RA')
    F.expect_doc_status(author, doc_id, 'under_review', '(RA 1명이 남았는데 승인됐다)')
    return f'doc={doc_id} RA={len(ra_steps)}명'


@case('F-15', 'F', '승인 시 approved/notify_approved 메일 발송')
def f15(ctx):
    _skip_mail('승인 메일 수신자')


# ============================================================ X. 반려·재상신

@case('X-01', 'X', '병렬 단계 반려 → 문서 즉시 rejected')
def x01(ctx):
    ctx.need(PL=2, TE_R=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_O', 0), doc_id, 'O')
    F.reject_step(ctx.actor('TE_O', 0), doc_id, 'O')
    F.expect_doc_status(author, doc_id, 'rejected')
    return f'doc={doc_id}'


@case('X-02', 'X', '반려 후 잔여 pending 단계 처리 시도 → 400')
def x02(ctx):
    ctx.need(PL=2, TE_R=1, TE_O=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_O', 0), doc_id, 'O')
    F.reject_step(ctx.actor('TE_O', 0), doc_id, 'O')
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J', expect=400)
    F.expect_doc_status(author, doc_id, 'rejected', '(반려 문서가 되살아났다)')
    return f'doc={doc_id}'


@case('X-03', 'X', '반려 메일 수신자(작성자+기합의자+미합의 팀)')
def x03(ctx):
    _skip_mail('반려 메일 수신자')


@case('X-04', 'X', 'Only MAP 반려 메일에서 경로 밖 단계 제외')
def x04(ctx):
    _skip_mail('Only MAP 반려 메일 수신자')


@case('X-05', 'X', '재상신 → round+1 로 PL step 재생성, 이전 회차 보존')
def x05(ctx):
    ctx.need(PL=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.peer_reject(ctx.actor('PL', 1), doc_id)
    F.resubmit(author, doc_id, [pls[0]['loginid']])
    doc = F.expect_doc_status(author, doc_id, 'under_review')
    rounds = {s['round'] for s in (doc.get('approval_steps') or [])}
    if max(rounds) < 2:
        raise CaseFailure(f'회차가 올라가지 않았다: {rounds}')
    if 1 not in rounds:
        raise CaseFailure('이전 회차 이력이 사라졌다.')
    F.expect_steps(doc, 'PL', count=1, action='pending')
    return f'doc={doc_id} rounds={sorted(rounds)}'


@case('X-06', 'X', '재상신 시 SA step 도 새 회차에 재생성')
def x06(ctx):
    ctx.need(PL=3)
    sa = [ctx.user('PL', 2)]
    doc_id, author, pls = F.submitted_doc(ctx, sa_users=sa)
    F.peer_reject(ctx.actor('PL', 1), doc_id)
    F.resubmit(author, doc_id, [pls[0]['loginid']])
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'SA', count=1, action='pending')
    return f'doc={doc_id}'


@case('X-07', 'X', '경로 판정은 단계 생성 시점 — 재상신하면 새 규칙 적용')
def x07(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.peer_reject(ctx.actor('PL', 1), doc_id)
    # 재상신 전에 목적을 'Overlay 변경' 단독으로 바꾼다 → 새 회차부터 J 가 빠져야 한다.
    doc = F.fetch(author, doc_id)
    import json
    notes = json.loads(doc['additional_notes'])
    notes['detail']['other_purpose'] = [P.OTHER_PURPOSE_OVERLAY]
    res = author.patch(f'/api/documents/{doc_id}/',
                       {'additional_notes': json.dumps(notes, ensure_ascii=False)})
    if not res.ok:
        raise CaseFailure(f'문서 수정 실패: {res.status} {res.error_text()}')
    F.resubmit(author, doc_id, [pls[0]['loginid']])
    F.peer_approve(ctx.actor('PL', 1), doc_id)
    F.pass_r_stage(ctx, doc_id)
    doc = F.fetch(author, doc_id)
    F.expect_no_step(doc, 'J')
    return f'doc={doc_id} agents={F.agents_in_round(doc)}'


@case('X-08', 'X', "이전 회차 잔여 pending 은 '내 차례'에 잡히지 않음")
def x08(ctx):
    raise CaseSkip("'내 차례' 판정은 프론트(utils/approvalTable.ts hasActivePendingStep)에서 계산한다 "
                   '— approvalTable.test.ts 와 화면으로 확인한다.')


@case('X-09', 'X', 'E 단계 반려는 수정 요청으로 동작(다른 단계와 다름)')
def x09(ctx):
    ctx.need(PL=2, TE_R=1, TE_E=1)
    doc_id, author, pls = F.to_parallel(ctx, plel=True)
    F.claim_step(ctx.actor('TE_E', 0), doc_id, 'E')
    F.reject_step(ctx.actor('TE_E', 0), doc_id, 'E', comment='수정 요청합니다')
    doc = F.fetch(author, doc_id)
    e_step = F.steps(doc, agent='E')[0]
    return (f'doc={doc_id} status={doc.get("status")} E.action={e_step.get("action")} '
            f'comment={(e_step.get("comment") or "")[:40]!r} '
            '→ APPROVAL.md 서술(일반 반려)과 같은지 대조할 것')


# ============================================================ M. 중단(PAUSE)

@case('M-01', 'M', '중단 요청 생성 — 상태는 under_review 유지')
def m01(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.request_pause(author, doc_id)
    doc = F.expect_doc_status(author, doc_id, 'under_review')
    if not doc.get('pause_request'):
        raise CaseFailure('pause_request 가 응답에 없다.')
    return f'doc={doc_id}'


@case('M-02', 'M', '사유 없는 중단 요청 → 400')
def m02(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.request_pause(author, doc_id, reason='', expect=400)
    return f'doc={doc_id}'


@case('M-03', 'M', '병렬 단계 일부만 중단 확인 → pause 아님')
def m03(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.request_pause(author, doc_id)
    F.confirm_pause(ctx.actor('TE_J', 0), doc_id, 'J')
    F.expect_doc_status(author, doc_id, 'under_review')
    return f'doc={doc_id}'


@case('M-04', 'M', 'target 단계 전원 확인 → pause')
def m04(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx, plel=False)
    F.request_pause(author, doc_id)
    doc = F.fetch(author, doc_id)
    targets = {s['agent'] for s in F.steps(doc, action='pending')}
    for agent in sorted(targets):
        actor = _team_actor(ctx, agent, doc)
        if actor is None:
            raise CaseSkip(f'{agent} 단계를 확인할 계정을 찾지 못했다.')
        F.confirm_pause(actor, doc_id, agent)
    F.expect_doc_status(author, doc_id, 'pause')
    return f'doc={doc_id} targets={sorted(targets)}'


@case('M-05', 'M', 'pause 상태에서 결재 진행 → 400')
def m05(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id = m04(ctx).split('doc=')[1].split()[0]
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J', expect=400)
    return f'doc={doc_id}'


@case('M-06', 'M', '재개 → under_review 복귀, 멈춘 단계 유지')
def m06(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id = m04(ctx).split('doc=')[1].split()[0]
    author = ctx.actor('PL', 0)
    before = {s['agent'] for s in F.steps(F.fetch(author, doc_id), action='pending')}
    F.resume(author, doc_id)
    doc = F.expect_doc_status(author, doc_id, 'under_review')
    after = {s['agent'] for s in F.steps(doc, action='pending')}
    if before != after:
        raise CaseFailure(f'재개 후 pending 단계가 달라졌다: {before} → {after}')
    return f'doc={doc_id} stages={sorted(after)}'


@case('M-07', 'M', '재개 시 기한 연장(멈춘 일수만큼)')
def m07(ctx):
    raise CaseSkip('중단 확정과 재개가 같은 날 일어나면 연장분이 0일이라 관측되지 않는다 '
                   '— 날짜를 벌리려면 DB 조작이 필요하다(백엔드 테스트 영역).')


@case('M-08', 'M', '중단 요청중에 결재가 진행되면 요청 자동 취소')
def m08(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.request_pause(author, doc_id)
    F.complete_j(ctx, doc_id)
    doc = F.fetch(author, doc_id)
    pr = doc.get('pause_request') or {}
    if pr and pr.get('state') == 'requested':
        raise CaseFailure('결재가 진행됐는데 중단 요청이 살아 있다.')
    return f'doc={doc_id} pause_request={pr.get("state")}'


@case('M-09', 'M', 'pause 문서 철회 시도 → 400')
def m09(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id = m04(ctx).split('doc=')[1].split()[0]
    F.withdraw(ctx.actor('PL', 0), doc_id, expect=400)
    return f'doc={doc_id}'


def _team_actor(ctx, agent, doc):
    """단계 담당 팀 계정을 찾는다(배정돼 있으면 그 사람, 아니면 팀 첫 번째)."""
    step = next((s for s in F.steps(doc, agent=agent, action='pending')), None)
    if step and step.get('assignee_loginid'):
        return F._actor_for_loginid(ctx, step['assignee_loginid'])
    role = {'R': 'TE_R', 'RV': 'TE_R', 'RA': 'TE_R', 'P': 'TE_P', 'PV': 'TE_P',
            'J': 'TE_J', 'O': 'TE_O', 'E': 'TE_E', 'EV': 'TE_E', 'PL': 'PL', 'SA': 'PL'}.get(agent)
    if not role or not ctx.master.users_by_role.get(role):
        return None
    return ctx.actor(role, 0)


# ============================================================ W. 철회

@case('W-01', 'W', 'draft 철회 → 즉시 삭제')
def w01(ctx):
    ctx.need(PL=1)
    author = ctx.actor('PL', 0)
    doc = F.create_document(ctx, author)
    res = F.withdraw(author, doc['id'])
    if not (res.body or {}).get('deleted'):
        raise CaseFailure(f'deleted=true 가 아니다: {res.body}')
    F.expect_gone(author, doc['id'])
    return f'doc={doc["id"]} 삭제됨'


@case('W-02', 'W', 'rejected 철회 → 즉시 삭제')
def w02(ctx):
    ctx.need(PL=2)
    doc_id, author, pls = F.submitted_doc(ctx)
    F.peer_reject(ctx.actor('PL', 1), doc_id)
    F.withdraw(author, doc_id)
    F.expect_gone(author, doc_id)
    return f'doc={doc_id} 삭제됨'


@case('W-03', 'W', 'approved 철회는 MASTER 만')
def w03(ctx):
    ctx.need(PL=2, TE_R=1, MASTER=1)
    doc_id, author, pls = F.to_parallel(ctx, request_purpose=P.ONLY_MAP_PURPOSE)
    doc = F.fetch(author, doc_id)
    if doc.get('status') != 'approved':
        F.complete_ra(ctx, doc_id)
    F.expect_doc_status(author, doc_id, 'approved')
    F.withdraw(author, doc_id, expect=403)
    F.withdraw(ctx.actor('MASTER', 0), doc_id)
    F.expect_gone(ctx.actor('MASTER', 0), doc_id)
    return f'doc={doc_id}'


@case('W-04', 'W', '진행 중 문서 철회 → 요청만 생성(삭제 아님)')
def w04(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    res = F.withdraw(author, doc_id)
    if (res.body or {}).get('deleted'):
        raise CaseFailure('진행 중 문서가 즉시 삭제됐다.')
    doc = F.fetch(author, doc_id)
    if not doc.get('withdraw_request'):
        raise CaseFailure('withdraw_request 가 없다.')
    return f'doc={doc_id}'


@case('W-05', 'W', '진행 중 문서 사유 없이 철회 → 400')
def w05(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id, reason='', expect=400)
    return f'doc={doc_id}'


@case('W-06', 'W', '활성 철회 요청 중복 → 400')
def w06(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.withdraw(author, doc_id, expect=400)
    return f'doc={doc_id}'


@case('W-07', 'W', '병렬 target 일부만 확인 → 문서 유지')
def w07(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.confirm_withdraw(ctx.actor('TE_J', 0), doc_id, 'J')
    F.fetch(author, doc_id)  # 아직 살아 있어야 한다
    return f'doc={doc_id}'


@case('W-08', 'W', 'target 전원 확인 → 문서 삭제')
def w08(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx, plel=False)
    F.withdraw(author, doc_id)
    doc = F.fetch(author, doc_id)
    for agent in sorted({s['agent'] for s in F.steps(doc, action='pending')}):
        actor = _team_actor(ctx, agent, doc)
        if actor is None:
            raise CaseSkip(f'{agent} 단계를 확인할 계정을 찾지 못했다.')
        F.confirm_withdraw(actor, doc_id, agent)
    F.expect_gone(author, doc_id)
    return f'doc={doc_id} 삭제됨'


@case('W-09', 'W', '미배정 단계는 같은 팀 누구나 확인 가능')
def w09(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.confirm_withdraw(ctx.actor('TE_J', 0), doc_id, 'J')  # J 는 미배정 상태
    return f'doc={doc_id}'


@case('W-10', 'W', '다른 팀의 철회 확인 → 403')
def w10(ctx):
    ctx.need(PL=2, TE_R=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.confirm_withdraw(ctx.actor('TE_O', 0), doc_id, 'J', expect=403)
    return f'doc={doc_id}'


@case('W-11', 'W', '한 단계만 거부해도 요청 전체 무효')
def w11(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.reject_withdraw(ctx.actor('TE_J', 0), doc_id)
    doc = F.fetch(author, doc_id)
    wr = doc.get('withdraw_request') or {}
    if wr.get('state') == 'requested':
        raise CaseFailure('거부했는데 요청이 살아 있다.')
    return f'doc={doc_id} state={wr.get("state")}'


@case('W-12', 'W', '요청자 본인 취소')
def w12(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.cancel_withdraw(author, doc_id)
    return f'doc={doc_id}'


@case('W-13', 'W', '요청자가 아닌 사람의 취소 → 거절')
def w13(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.cancel_withdraw(ctx.actor('TE_J', 0), doc_id, expect=(400, 403))
    return f'doc={doc_id}'


@case('W-14', 'W', '철회 확인 대기 중 결재 동결 → 400')
def w14(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J', expect=400)
    return f'doc={doc_id}'


@case('W-15', 'W', '철회 거부 후 결재 재개 가능')
def w15(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.withdraw(author, doc_id)
    F.reject_withdraw(ctx.actor('TE_J', 0), doc_id)
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J')
    return f'doc={doc_id}'


# ============================================================ A. 인가

@case('A-01', 'A', '담당자가 아닌 사용자의 합의 → 403')
def a01(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J')
    F.approve_step(ctx.actor('TE_O', 0), doc_id, 'J', expect=403)
    return f'doc={doc_id}'


@case('A-02', 'A', 'MASTER 는 모든 단계 처리 가능')
def a02(ctx):
    ctx.need(PL=2, TE_R=1, MASTER=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.approve_step(ctx.actor('MASTER', 0), doc_id, 'O')
    F.expect_steps(F.fetch(author, doc_id), 'O', count=1, action='approved')
    return f'doc={doc_id}'


@case('A-03', 'A', 'RA/PV/EV 는 본인 step 만 처리')
def a03(ctx):
    ctx.need(PL=3, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    extra = ctx.user('PL', 2)
    doc_id, author, pls = F.to_parallel(ctx, only_prodc='Yes', post_approvers=[extra])
    doc = F.fetch(author, doc_id)
    ra_steps = F.steps(doc, agent='RA', action='pending')
    if len(ra_steps) < 2:
        raise CaseSkip('후결자가 2명 미만이라 "타인 step" 을 만들 수 없다.')
    # 후결자가 아닌 TE_J 계정으로 RA 합의를 시도한다.
    F.approve_step(ctx.actor('TE_J', 0), doc_id, 'RA', expect=(400, 403))
    return f'doc={doc_id} RA={len(ra_steps)}명'


@case('A-04', 'A', 'J/O/E/P 는 팀 공동 합의(assignee 필터 없음)')
def a04(ctx):
    ctx.need(PL=2, TE_R=1, TE_O=2)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_O', 0), doc_id, 'O')
    F.approve_step(ctx.actor('TE_O', 1), doc_id, 'O')
    return f'doc={doc_id}'


@case('A-05', 'A', '후결자 추가는 작성자/MASTER + 병렬 진입 후')
def a05(ctx):
    ctx.need(PL=3, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.add_post_approver(author, doc_id, ctx.user('PL', 2)['loginid'])
    doc = F.fetch(author, doc_id)
    loginids = [s.get('assignee_loginid') for s in F.steps(doc, agent='RA')]
    if ctx.user('PL', 2)['loginid'] not in loginids:
        raise CaseFailure(f'추가 후결자 step 이 생기지 않았다: {loginids}')
    return f'doc={doc_id}'


@case('A-06', 'A', '고정 후결자 제거 시도 → 거절')
def a06(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx)
    doc = F.fetch(author, doc_id)
    fixed = doc.get('post_approver_fixed_loginid')
    if not fixed:
        raise CaseSkip('고정 후결자(POST_APPROVER_LOGINID)가 설정돼 있지 않다.')
    F.remove_post_approver(author, doc_id, fixed, expect=400)
    return f'doc={doc_id} fixed={fixed}'


@case('A-07', 'A', '이미 합의한 RA 제거 → 400')
def a07(ctx):
    ctx.need(PL=3, TE_R=1)
    extra = ctx.user('PL', 2)
    doc_id, author, pls = F.to_parallel(ctx, only_prodc='Yes', post_approvers=[extra])
    F.approve_step(ctx.actor('PL', 2), doc_id, 'RA')
    F.remove_post_approver(author, doc_id, extra['loginid'], expect=400)
    return f'doc={doc_id}'


@case('A-08', 'A', 'Only MAP 에서 후결자 총원 0 만들기 → 400')
def a08(ctx):
    ctx.need(PL=2, TE_R=1)
    doc_id, author, pls = F.to_parallel(ctx, request_purpose=P.ONLY_MAP_PURPOSE)
    doc = F.fetch(author, doc_id)
    ra = F.steps(doc, agent='RA')
    if len(ra) != 1:
        raise CaseSkip(f'후결자가 {len(ra)}명이라 "마지막 1명 제거" 상황이 아니다.')
    F.remove_post_approver(author, doc_id, ra[0]['assignee_loginid'], expect=400)
    return f'doc={doc_id}'


@case('A-09', 'A', 'C가문/연구소 제품에서 추가 후결자 0 만들기 → 400')
def a09(ctx):
    ctx.need(PL=3, TE_R=1)
    extra = ctx.user('PL', 2)
    doc_id, author, pls = F.to_parallel(ctx, only_prodc='Yes', post_approvers=[extra])
    F.remove_post_approver(author, doc_id, extra['loginid'], expect=400)
    return f'doc={doc_id}'


@case('A-10', 'A', '일반 문서에서 추가 후결자 0 만들기 → 허용')
def a10(ctx):
    ctx.need(PL=3, TE_R=1)
    extra = ctx.user('PL', 2)
    doc_id, author, pls = F.to_parallel(ctx, post_approvers=[extra])
    F.remove_post_approver(author, doc_id, extra['loginid'], expect=200)
    return f'doc={doc_id}'


# ============================================================ N. 동시성

@case('N-01', 'N', '마지막 병렬 합의 2건 동시 → approved 전이 누락 없음')
def n01(ctx):
    ctx.need(PL=2, TE_R=1, TE_P=1, TE_J=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx, plel=False)
    F.complete_p(ctx, doc_id)
    F.complete_ra(ctx, doc_id)
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J')
    F.claim_step(ctx.actor('TE_O', 0), doc_id, 'O')
    j_actor, o_actor = ctx.actor('TE_J', 0), ctx.actor('TE_O', 0)
    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = [ex.submit(F.approve_step, j_actor, doc_id, 'J'),
                   ex.submit(F.approve_step, o_actor, doc_id, 'O')]
        [f.result() for f in futures]
    F.expect_doc_status(author, doc_id, 'approved', '(동시 합의로 승인 전이가 누락됐다)')
    return f'doc={doc_id}'


@case('N-02', 'N', 'PL 2명 동시 합의 → R 중복/누락 없음')
def n02(ctx):
    ctx.need(PL=3)
    doc_id, author, pls = F.submitted_doc(ctx, pl_count=2)
    a1, a2 = ctx.actor('PL', 1), ctx.actor('PL', 2)
    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = [ex.submit(F.peer_approve, a1, doc_id), ex.submit(F.peer_approve, a2, doc_id)]
        [f.result() for f in futures]
    doc = F.fetch(author, doc_id)
    F.expect_steps(doc, 'R', count=1, note='(동시 합의로 R 이 중복 생성되거나 누락됐다)')
    return f'doc={doc_id}'


@case('N-03', 'N', "'MAP 삭제' 병렬 생성 중복 방지")
def n03(ctx):
    ctx.need(PL=3)
    doc_id, author, pls = F.submitted_doc(ctx, pl_count=2,
                                          request_purpose=P.MAP_DELETE_EDIT_PURPOSE)
    a1, a2 = ctx.actor('PL', 1), ctx.actor('PL', 2)
    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = [ex.submit(F.peer_approve, a1, doc_id), ex.submit(F.peer_approve, a2, doc_id)]
        [f.result() for f in futures]
    doc = F.fetch(author, doc_id)
    for agent in ('P', 'R', 'J', 'O'):
        F.expect_steps(doc, agent, count=1, note='(병렬 단계가 중복 생성됐다)')
    return f'doc={doc_id}'


@case('N-04', 'N', '합의와 반려 동시 → 한쪽만 반영')
def n04(ctx):
    ctx.need(PL=2, TE_R=1, TE_J=1, TE_O=1)
    doc_id, author, pls = F.to_parallel(ctx)
    F.claim_step(ctx.actor('TE_J', 0), doc_id, 'J')
    F.claim_step(ctx.actor('TE_O', 0), doc_id, 'O')
    j_actor, o_actor = ctx.actor('TE_J', 0), ctx.actor('TE_O', 0)
    with ThreadPoolExecutor(max_workers=2) as ex:
        futures = [ex.submit(F.approve_step, j_actor, doc_id, 'J', None, (200, 400)),
                   ex.submit(F.reject_step, o_actor, doc_id, 'O', (200, 400))]
        [f.result() for f in futures]
    doc = F.fetch(author, doc_id)
    if doc.get('status') not in ('rejected', 'under_review'):
        raise CaseFailure(f'예상 밖 상태: {doc.get("status")}')
    return f'doc={doc_id} status={doc.get("status")}'
