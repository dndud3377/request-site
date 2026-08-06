import type { TFunction } from 'i18next';
import { getDocTableRows, getFinalCompletionDate } from './approvalTable';
import { ApprovalStepFrontend, RequestDocument } from '../types';

// stageText 등 번역 결과의 정확한 문구는 검증 대상이 아니므로 키를 그대로 돌려주는 스텁을 쓴다.
const t = ((key: string) => key) as unknown as TFunction;

const makeStep = (overrides: Partial<ApprovalStepFrontend>): ApprovalStepFrontend => ({
  id: Math.random(),
  agent: 'R',
  action: 'pending',
  acted_at: null,
  round: 1,
  ...overrides,
});

const makeDoc = (steps: ApprovalStepFrontend[]): RequestDocument => ({
  id: 1,
  title: 'doc',
  requester_name: '요청자',
  requester_email: 'req@c.com',
  requester_department: 'dept',
  product_name: 'PROD-1',
  reference_materials: '',
  additional_notes: '{}',
  status: 'under_review',
  production_date: null,
  created_at: '2026-08-06T00:00:00Z',
  updated_at: '2026-08-06T00:00:00Z',
  submitted_at: '2026-08-06T00:00:00Z',
  approval_steps: steps,
});

describe('getDocTableRows — 기존 경로 회귀 확인', () => {
  it('일반 경로: R 이 이미 approved 면 path0 행을 만들지 않는다(기존 화면 그대로)', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-10' }),
      makeStep({ agent: 'P', action: 'pending', due_date: '2026-08-14' }),
      makeStep({ agent: 'O', action: 'pending', due_date: '2026-08-16' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows.some((r) => r.pathKey === 'path0')).toBe(false);
    expect(rows.map((r) => r.pathKey)).toEqual(['path1', 'path2']);
  });

  it('Only MAP 경로: R 이 approved 후 RA 만 있으면 path0 없이 path3 만 있다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-10' }),
      makeStep({ agent: 'RA', action: 'pending', due_date: '2026-08-18', assignee_name: '후결자1' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows.map((r) => r.pathKey)).toEqual(['path3']);
  });
});

describe('getDocTableRows — MAP 삭제/수정 (R 이 병렬 구성원)', () => {
  it('R 이 아직 pending 이면 P/O 가 이미 끝났어도 path0 행으로 보인다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'pending', due_date: '2026-08-12', assignee_loginid: 'r1', assignee_name: 'r1' }),
      makeStep({ agent: 'P', action: 'approved', due_date: '2026-08-12' }),
      makeStep({ agent: 'J', action: 'approved', due_date: '2026-08-12' }),
      makeStep({ agent: 'O', action: 'approved', due_date: '2026-08-12' }),
    ]);
    const rows = getDocTableRows(doc, t);
    const path0 = rows.find((r) => r.pathKey === 'path0');
    expect(path0).toBeDefined();
    expect(path0!.isDone).toBe(false);
    expect(path0!.pathStatus).toBe('under_review');
    expect(path0!.dueDate).toBe('2026-08-12');
  });

  it('R 담당자 미지정이면 path0 이 unassigned 로 뜬다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'pending', due_date: '2026-08-12' }),
      makeStep({ agent: 'P', action: 'pending', due_date: '2026-08-12' }),
      makeStep({ agent: 'O', action: 'pending', due_date: '2026-08-12' }),
    ]);
    const rows = getDocTableRows(doc, t);
    const path0 = rows.find((r) => r.pathKey === 'path0');
    expect(path0!.pathStatus).toBe('unassigned');
  });

  it('R 이 approved 로 끝나면 path0 행이 사라진다(P/O 만 남는다)', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-12', assignee_name: 'r1' }),
      makeStep({ agent: 'P', action: 'pending', due_date: '2026-08-12' }),
      makeStep({ agent: 'O', action: 'pending', due_date: '2026-08-12' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows.some((r) => r.pathKey === 'path0')).toBe(false);
  });
});

describe('getFinalCompletionDate — R 의 기한도 후보에 포함', () => {
  it('R 이 가장 늦은 기한이면 그 날짜가 최종 완료예정일이 된다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'pending', due_date: '2026-09-01' }),
      makeStep({ agent: 'P', action: 'approved', due_date: '2026-08-12' }),
      makeStep({ agent: 'J', action: 'approved', due_date: '2026-08-12' }),
      makeStep({ agent: 'O', action: 'approved', due_date: '2026-08-14' }),
    ]);
    expect(getFinalCompletionDate(doc)).toBe('2026. 9. 1.');
  });

  it('기존 경로(R 이미 완료, 기한이 가장 이름)는 R 의 기한이 최댓값을 밀어올리지 않는다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-10' }),
      makeStep({ agent: 'P', action: 'pending', due_date: '2026-08-12' }),
      makeStep({ agent: 'J', action: 'pending', due_date: '2026-08-15' }),
      makeStep({ agent: 'O', action: 'pending', due_date: '2026-08-14' }),
    ]);
    // path1 = J.due(08-15), path2 = O.due(08-14) → 기존과 동일하게 max는 08-15.
    // R(08-10)이 더 늦은 날짜였다면 이 테스트가 그 값을 반영해 실패했을 것이다.
    expect(getFinalCompletionDate(doc)).toBe('2026. 8. 15.');
  });
});
