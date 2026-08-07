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

// MAP 삭제/수정 문서 — request_purpose 를 additional_notes 에 심어야 isMapDeleteEditDoc 이 인식한다.
const makeMdeDoc = (steps: ApprovalStepFrontend[]): RequestDocument => ({
  ...makeDoc(steps),
  additional_notes: JSON.stringify({ detail: { request_purpose: 'MAP 삭제/수정' } }),
});

describe('getDocTableRows — 기존 경로 회귀 확인', () => {
  it('일반 경로: R 이 이미 approved 면 R 을 위한 별도 행이 없다(기존 화면 그대로)', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-10' }),
      makeStep({ agent: 'P', action: 'pending', due_date: '2026-08-14' }),
      makeStep({ agent: 'O', action: 'pending', due_date: '2026-08-16' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows.map((r) => r.pathKey)).toEqual(['path1', 'path2']);
  });

  it('Only MAP 경로: R 이 approved 후 RA 만 있으면 path3 만 있다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-10' }),
      makeStep({ agent: 'RA', action: 'pending', due_date: '2026-08-18', assignee_name: '후결자1' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows.map((r) => r.pathKey)).toEqual(['path3']);
  });
});

describe('getDocTableRows — 경로2(O+E) 상태점(subStages)', () => {
  it('O·E 둘 다 대기중이면 subStages도 둘 다 wait, 대표 뱃지는 unassigned', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'O', action: 'pending' }),
      makeStep({ agent: 'E', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    const path2 = rows.find((r) => r.pathKey === 'path2')!;
    expect(path2.pathStatus).toBe('unassigned');
    expect(path2.subStages?.map((s) => s.state)).toEqual(['wait', 'wait']);
  });

  it('O는 아직 미배정, E만 선점됐으면 대표 뱃지가 under_review로 바뀐다(예전엔 O 우선이라 unassigned로 보이던 버그)', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'O', action: 'pending' }),
      makeStep({ agent: 'E', action: 'pending', assignee_loginid: 'e1', assignee_name: '홍길동' }),
    ]);
    const rows = getDocTableRows(doc, t);
    const path2 = rows.find((r) => r.pathKey === 'path2')!;
    expect(path2.pathStatus).toBe('under_review');
    expect(path2.subStages).toEqual([
      { label: 'approval.agent_O', state: 'wait' },
      { label: 'approval.agent_E', state: 'review', name: '홍길동' },
    ]);
  });

  it('O가 완료되고 E가 아직 미배정이면 O는 done, E는 wait, 대표 뱃지는 unassigned', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'O', action: 'approved', assignee_name: '김철수' }),
      makeStep({ agent: 'E', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    const path2 = rows.find((r) => r.pathKey === 'path2')!;
    expect(path2.pathStatus).toBe('unassigned');
    expect(path2.subStages?.map((s) => s.state)).toEqual(['done', 'wait']);
  });

  it('O·E 모두 완료되면(검토자 없음) subStages는 비고 대표 뱃지는 approved', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'O', action: 'approved', assignee_name: '김철수' }),
      makeStep({ agent: 'E', action: 'approved', assignee_name: '홍길동' }),
    ]);
    const rows = getDocTableRows(doc, t);
    const path2 = rows.find((r) => r.pathKey === 'path2')!;
    expect(path2.pathStatus).toBe('approved');
    expect(path2.subStages).toBeUndefined();
  });

  it('E만 있고 O가 없으면(이론상 발생 안 하지만) subStages를 채우지 않는다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'E', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    const path2 = rows.find((r) => r.pathKey === 'path2')!;
    expect(path2.subStages).toBeUndefined();
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

describe('getDocTableRows — MAP 삭제/수정: (R/J/P/O) 단일 행', () => {
  it('네 단계 모두 pending 이면 (R/J/P/O) 순서 그대로 보인다', () => {
    const doc = makeMdeDoc([
      makeStep({ agent: 'R', action: 'pending' }),
      makeStep({ agent: 'P', action: 'pending' }),
      makeStep({ agent: 'J', action: 'pending' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows).toHaveLength(1);
    expect(rows[0].pathKey).toBe('parallel4');
    expect(rows[0].stageText).toBe('(R/J/P/O)');
    expect(rows[0].isDone).toBe(false);
  });

  it('P 가 합의되면 P 만 목록에서 빠진다(J 는 P 완료를 기다리지 않고 이미 병렬로 대기 중)', () => {
    const doc = makeMdeDoc([
      makeStep({ agent: 'R', action: 'pending' }),
      makeStep({ agent: 'P', action: 'approved' }),
      makeStep({ agent: 'J', action: 'pending' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].stageText).toBe('(R/J/O)');
  });

  it('P 담당자는 합의했지만 지정된 검토자(PV)가 남아 있으면 P 는 아직 빠지지 않는다', () => {
    const doc = makeMdeDoc([
      makeStep({ agent: 'R', action: 'pending' }),
      makeStep({ agent: 'P', action: 'approved' }),
      makeStep({ agent: 'PV', action: 'pending' }),
      makeStep({ agent: 'J', action: 'pending' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].stageText).toBe('(R/J/P/O)');
  });

  it('R 담당자는 합의했지만 검토자(RV)가 남아 있으면 R 은 아직 빠지지 않는다', () => {
    const doc = makeMdeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'RV', action: 'pending' }),
      makeStep({ agent: 'P', action: 'pending' }),
      makeStep({ agent: 'J', action: 'pending' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].stageText).toBe('(R/J/P/O)');
  });

  it('세 단계가 끝나고 O 하나만 남으면 (O) 만 보인다', () => {
    const doc = makeMdeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'approved' }),
      makeStep({ agent: 'J', action: 'approved' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].stageText).toBe('(O)');
  });

  it('네 단계 모두 담당자 지정 없이 pending 이어도 글자 구분 없이 그대로 나열한다(대기 표시만)', () => {
    const doc = makeMdeDoc([
      makeStep({ agent: 'R', action: 'pending' }),
      makeStep({ agent: 'P', action: 'pending' }),
      makeStep({ agent: 'J', action: 'pending' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].stageText).toBe('(R/J/P/O)');
    expect(rows[0].pathStatus).toBe('unassigned');
  });

  it('네 단계 모두 끝나면 이름 목록으로 표시된다', () => {
    const doc = makeMdeDoc([
      makeStep({ agent: 'R', action: 'approved', assignee_name: 'r1' }),
      makeStep({ agent: 'P', action: 'approved', assignee_name: 'p1' }),
      makeStep({ agent: 'J', action: 'approved', assignee_name: 'j1' }),
      makeStep({ agent: 'O', action: 'approved', assignee_name: 'o1' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].isDone).toBe(true);
    expect(rows[0].stageText).toContain('r1');
    expect(rows[0].stageText).toContain('o1');
  });

  it('일반 문서는 이 분기를 타지 않는다(회귀 방지)', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'pending' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows.some(r => r.pathKey === 'parallel4')).toBe(false);
  });
});
