import type { TFunction } from 'i18next';
import { filterDocsForExport, splitStageColumns, EXPORT_TEAMS } from './approvalListExport';
import { OPTION_LINE } from '../pages/RequestPage/constants';
import { ApprovalStepFrontend, RequestDocument } from '../types';

const makeDoc = (id: number, line: string, status: string, pendingAgent?: ApprovalStepFrontend['agent']): RequestDocument => ({
  id,
  title: `doc${id}`,
  requester_name: '요청자',
  requester_email: 'req@c.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { line } }),
  status,
  production_date: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  submitted_at: '2026-09-01T00:00:00Z',
  approval_steps: pendingAgent
    ? [{ id: id * 10, agent: pendingAgent, action: 'pending', acted_at: null, round: 1 }]
    : [],
} as RequestDocument);

const docs = [
  makeDoc(1, '라인1', 'under_review', 'R'),
  makeDoc(2, '라인2', 'under_review', 'P'),
  makeDoc(3, '라인1', 'draft'),
  makeDoc(4, '', 'under_review', 'PL'),
  makeDoc(5, '라인3', 'rejected'),
];
const ids = (list: RequestDocument[]) => list.map((d) => d.id);

describe('filterDocsForExport', () => {
  it('전체 선택이면 임시저장만 빼고 라인 없음·팀 단계 밖 문서까지 모두 포함한다', () => {
    expect(ids(filterDocsForExport(docs, [...OPTION_LINE], OPTION_LINE, [...EXPORT_TEAMS]))).toEqual([1, 2, 4, 5]);
  });

  it('라인을 일부만 고르면 그 라인 문서만 남는다', () => {
    expect(ids(filterDocsForExport(docs, ['라인1', '라인3'], OPTION_LINE, [...EXPORT_TEAMS]))).toEqual([1, 5]);
  });

  it('팀을 일부만 고르면 그 팀 단계가 진행 중인 문서만 남는다', () => {
    expect(ids(filterDocsForExport(docs, [...OPTION_LINE], OPTION_LINE, ['P']))).toEqual([2]);
  });

  it('라인·팀 조합이 모두 맞아야 남는다', () => {
    expect(ids(filterDocsForExport(docs, ['라인1'], OPTION_LINE, ['P']))).toEqual([]);
    expect(ids(filterDocsForExport(docs, ['라인1'], OPTION_LINE, ['R', 'P']))).toEqual([1]);
  });
});

// 번역 결과의 정확한 문구는 검증 대상이 아니므로 키를 그대로 돌려주는 스텁을 쓴다.
const t = ((key: string) => key) as unknown as TFunction;
const withSteps = (status: string, steps: Partial<ApprovalStepFrontend>[]): RequestDocument => ({
  ...makeDoc(99, '라인1', status),
  approval_steps: steps.map((s, i) => ({ id: 100 + i, agent: 'R', action: 'pending', acted_at: null, round: 1, ...s })),
} as RequestDocument);

describe('splitStageColumns', () => {
  it('3구역 병렬: 대기중/검토중/완료로 나누고 완료에는 합의 끝난 R 을 함께 넣는다', () => {
    const doc = withSteps('under_review', [
      { agent: 'PL', action: 'approved' },
      { agent: 'R', action: 'approved', assignee_name: '김R', assignee_loginid: 'r' },
      { agent: 'P', action: 'pending' },
      { agent: 'J', action: 'pending', assignee_name: '박J', assignee_loginid: 'j' },
      { agent: 'O', action: 'approved', assignee_loginid: 'o' },
    ]);
    const cols = splitStageColumns(doc, t);
    expect(cols.done[0]).toBe('approval.agent_R');
    expect(cols.done).not.toContain('approval.agent_PL');
    expect(cols.waiting.join()).toContain('approval.agent_P');
    expect(cols.reviewing.join()).toContain('approval.agent_J');
    expect(cols.done.join()).toContain('approval.agent_O');
  });

  it('R 단계: 미지정이면 대기중, 지정되면 검토중 — 아직 완료 칸은 비어 있다', () => {
    const waiting = splitStageColumns(withSteps('under_review', [{ agent: 'PL', action: 'approved' }, { agent: 'R' }]), t);
    expect(waiting).toEqual({ waiting: ['approval.agent_R'], reviewing: [], done: [] });
    const reviewing = splitStageColumns(withSteps('under_review', [
      { agent: 'PL', action: 'approved' }, { agent: 'R', assignee_name: '김R', assignee_loginid: 'r' },
    ]), t);
    expect(reviewing).toEqual({ waiting: [], reviewing: ['approval.agent_R(김R)'], done: [] });
  });

  it('반려: 반려된 단계를 검토중 칸에 둔다', () => {
    const cols = splitStageColumns(withSteps('rejected', [
      { agent: 'PL', action: 'approved' }, { agent: 'R', action: 'rejected', assignee_name: '김R', assignee_loginid: 'r' },
    ]), t);
    expect(cols).toEqual({ waiting: [], reviewing: ['approval.agent_R(김R)'], done: [] });
  });

  it('중단: PAUSE 로 덮지 않고 원래 단계 상태로 나눈다', () => {
    const cols = splitStageColumns(withSteps('pause', [
      { agent: 'PL', action: 'approved' }, { agent: 'R', action: 'approved' }, { agent: 'P' }, { agent: 'O', action: 'approved' },
    ]), t);
    expect(cols.waiting.join()).toContain('approval.agent_P');
    expect(cols.done).toEqual(expect.arrayContaining(['approval.agent_R']));
    expect(cols.done.join()).toContain('approval.agent_O');
  });
});
