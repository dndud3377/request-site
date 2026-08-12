import type { TFunction } from 'i18next';
import {
  getDocTableRows, getFinalCompletionDate, isMyDocument, StageCell, StageCellSlot,
} from './approvalTable';
import { ApprovalStepFrontend, RequestDocument } from '../types';

// 번역 결과의 정확한 문구는 검증 대상이 아니므로 키를 그대로 돌려주는 스텁을 쓴다.
const t = ((key: string) => key) as unknown as TFunction;

let nextId = 1;
const makeStep = (overrides: Partial<ApprovalStepFrontend>): ApprovalStepFrontend => ({
  id: nextId++,
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

// MAP 삭제 문서 — request_purpose 를 additional_notes 에 심어야 isMapDeleteEditDoc 이 인식한다.
const makeMdeDoc = (steps: ApprovalStepFrontend[]): RequestDocument => ({
  ...makeDoc(steps),
  additional_notes: JSON.stringify({ detail: { request_purpose: 'MAP 삭제' } }),
});

/** 그리드 한 행을 꺼낸다(병렬 단계 문서는 항상 1행). */
const gridOf = (doc: RequestDocument): StageCell[] => {
  const rows = getDocTableRows(doc, t);
  expect(rows).toHaveLength(1);
  expect(rows[0].pathKey).toBe('grid');
  return rows[0].cells!;
};

const cellAt = (doc: RequestDocument, slot: StageCellSlot): StageCell =>
  gridOf(doc).find((c) => c.slot === slot)!;

describe('getDocTableRows — 병렬 이전 구간은 기존 단일 행 그대로', () => {
  // (2026-08) PL 검토 단계는 지정 검토자와 영업/기술지원 합의자(SA)가 병렬이라
  // 단일 행이 아니라 1열 2줄 그리드로 그린다.
  it('PL 검토중: 미합의 PL 이름을 이어 붙인 PL 칸 + 합의자 미지정이면 해당없음', () => {
    const doc = makeDoc([
      makeStep({ agent: 'PL', action: 'pending', assignee_name: '박피엘', assignee_loginid: 'pl1' }),
      makeStep({ agent: 'PL', action: 'pending', assignee_name: '김피엘', assignee_loginid: 'pl2' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows).toHaveLength(1);
    expect(rows[0].pathKey).toBe('grid');
    expect(rows[0].gridColumns).toBe(1);
    expect(rows[0].cells!.map((c) => c.slot)).toEqual(['PL', 'SA']);

    const pl = rows[0].cells!.find((c) => c.slot === 'PL')!;
    expect(pl.state).toBe('review');
    expect(pl.name).toBe('박피엘 / 김피엘');

    const sa = rows[0].cells!.find((c) => c.slot === 'SA')!;
    expect(sa.state).toBe('na');
  });

  it('PL 검토중 + 합의자 지정: 합의자 칸이 검토중으로 함께 표시된다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'PL', action: 'pending', assignee_name: '박피엘', assignee_loginid: 'pl1' }),
      makeStep({ agent: 'SA', action: 'pending', assignee_name: '이영업', assignee_loginid: 'sa1' }),
    ]);
    const sa = getDocTableRows(doc, t)[0].cells!.find((c) => c.slot === 'SA')!;
    expect(sa.state).toBe('review');
    expect(sa.name).toBe('이영업');
  });

  it('PL 전원 합의 후에도 합의자가 남아 있으면 PL 검토 단계가 이어진다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'PL', action: 'approved', assignee_name: '박피엘' }),
      makeStep({ agent: 'SA', action: 'pending', assignee_name: '이영업', assignee_loginid: 'sa1' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].pathKey).toBe('grid');
    expect(rows[0].cells!.find((c) => c.slot === 'PL')!.state).toBe('done');
    expect(rows[0].cells!.find((c) => c.slot === 'SA')!.state).toBe('review');
  });

  it('RFG 담당자 미지정: 단일 행 + 대기중', () => {
    const doc = makeDoc([makeStep({ agent: 'R', action: 'pending' })]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].pathKey).toBe('single');
    expect(rows[0].pathStatus).toBe('unassigned');
  });

  it('RFG 합의 후 검토자(RV) 단계도 단일 행으로 남는다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', assignee_name: '김철수' }),
      makeStep({ agent: 'RV', action: 'pending', assignee_loginid: 'rv1', assignee_name: '이검토' }),
    ]);
    const rows = getDocTableRows(doc, t);
    expect(rows[0].pathKey).toBe('single');
    // 라벨은 '검토자' 가 아니라 단계명 RFG 다(2026-08) — 아래 stageLabel describe 참고
    expect(rows[0].stageText).toBe('approval.agent_R(이검토)');
  });
});

describe('getDocTableRows — 병렬 그리드: 6칸 고정 배치', () => {
  const fullDoc = () => ({
    ...makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'pending' }),
      makeStep({ agent: 'J', action: 'pending' }),
      makeStep({ agent: 'O', action: 'pending' }),
      makeStep({ agent: 'E', action: 'pending' }),
      makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'fixed', assignee_name: '정고정' }),
      makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'extra', assignee_name: '이순신' }),
    ]),
    post_approver_fixed_loginid: 'fixed',
  });

  it('칸 순서는 항상 P → 고정후결자 → J → MASK → OVL → 추가후결자 (3행 2열)', () => {
    expect(gridOf(fullDoc()).map((c) => c.slot))
      .toEqual(['P', 'RA_FIXED', 'J', 'E', 'O', 'RA_EXTRA']);
  });

  it('고정 후결자와 추가 후결자를 post_approver_fixed_loginid 로 분리한다', () => {
    const doc = fullDoc();
    expect(cellAt(doc, 'RA_FIXED').name).toBe('정고정');
    expect(cellAt(doc, 'RA_EXTRA').name).toBe('이순신');
  });

  it('경로에 없는 단계는 사라지지 않고 해당없음으로 남는다(비 plel + 추가 후결자 미지정)', () => {
    const doc = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved' }),
        makeStep({ agent: 'P', action: 'pending' }),
        makeStep({ agent: 'J', action: 'pending' }),
        makeStep({ agent: 'O', action: 'pending' }),
        makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'fixed', assignee_name: '정고정' }),
      ]),
      post_approver_fixed_loginid: 'fixed',
    };
    expect(cellAt(doc, 'E').state).toBe('na');
    expect(cellAt(doc, 'RA_EXTRA').state).toBe('na');
    expect(cellAt(doc, 'P').state).toBe('wait');
  });

  it('Only MAP: P·J·O·MASK 가 전부 해당없음이고 후결자만 진행한다', () => {
    const doc = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved' }),
        makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'fixed', assignee_name: '정고정' }),
      ]),
      post_approver_fixed_loginid: 'fixed',
    };
    expect(gridOf(doc).map((c) => c.state))
      .toEqual(['na', 'review', 'na', 'na', 'na', 'na']);
  });
});

describe('getDocTableRows — 칸 상태 판정', () => {
  const withParallel = (extra: ApprovalStepFrontend[]) =>
    makeDoc([makeStep({ agent: 'R', action: 'approved' }), ...extra]);

  it('미선점 pending = 대기중, 선점 pending = 검토중', () => {
    const waiting = withParallel([makeStep({ agent: 'P', action: 'pending' })]);
    expect(cellAt(waiting, 'P').state).toBe('wait');

    const claimed = withParallel([
      makeStep({ agent: 'P', action: 'pending', assignee_loginid: 'p1', assignee_name: '박영희' }),
    ]);
    expect(cellAt(claimed, 'P').state).toBe('review');
  });

  it('대기중 칸에는 이름을 표시하지 않는다', () => {
    const doc = withParallel([makeStep({ agent: 'P', action: 'pending', assignee_name: '박영희' })]);
    expect(cellAt(doc, 'P')).toEqual({ slot: 'P', label: 'approval.agent_P', state: 'wait' });
  });

  it('완료 칸에는 이름을 표시하지 않는다', () => {
    const doc = withParallel([
      makeStep({ agent: 'P', action: 'approved', assignee_name: '박영희' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    expect(cellAt(doc, 'P')).toEqual({ slot: 'P', label: 'approval.agent_P', state: 'done' });
  });

  it('JOB·OVL 은 선점돼도 이름을 노출하지 않는다(기존 비대칭 규칙 유지)', () => {
    const doc = withParallel([
      makeStep({ agent: 'J', action: 'pending', assignee_loginid: 'j1', assignee_name: '최잡' }),
      makeStep({ agent: 'O', action: 'pending', assignee_loginid: 'o1', assignee_name: '한오브' }),
    ]);
    expect(cellAt(doc, 'J')).toEqual({ slot: 'J', label: 'approval.agent_J', state: 'review' });
    expect(cellAt(doc, 'O')).toEqual({ slot: 'O', label: 'approval.agent_O', state: 'review' });
  });

  it('MASK 는 선점 시 담당자 이름을 표시한다', () => {
    const doc = withParallel([
      makeStep({ agent: 'E', action: 'pending', assignee_loginid: 'e1', assignee_name: '강동원' }),
    ]);
    expect(cellAt(doc, 'E').name).toBe('강동원');
  });
});

describe('getDocTableRows — 검토자 단계에서도 단계명이 유지된다', () => {
  it('P 담당자 합의 후 PV 가 남으면 라벨은 PHPSI 그대로, 이름만 미합의 검토자로 바뀐다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'approved', assignee_name: '박영희' }),
      makeStep({ agent: 'PV', action: 'pending', assignee_loginid: 'pv1', assignee_name: '최민수' }),
      makeStep({ agent: 'PV', action: 'pending', assignee_loginid: 'pv2', assignee_name: '정검토' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    expect(cellAt(doc, 'P')).toEqual({
      slot: 'P', label: 'approval.agent_P', state: 'review', name: '최민수 / 정검토',
    });
  });

  it('검토자 일부만 합의하면 미합의자 이름만 남는다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'E', action: 'approved', assignee_name: '강동원' }),
      makeStep({ agent: 'EV', action: 'approved', assignee_name: '김검토' }),
      makeStep({ agent: 'EV', action: 'pending', assignee_loginid: 'ev2', assignee_name: '이검토' }),
      makeStep({ agent: 'O', action: 'pending' }),
    ]);
    expect(cellAt(doc, 'E').name).toBe('이검토');
  });

  it('담당자+검토자 전원 합의해야 완료다', () => {
    const notDone = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'approved', assignee_name: '박영희' }),
      makeStep({ agent: 'PV', action: 'pending', assignee_name: '최민수' }),
    ]);
    expect(cellAt(notDone, 'P').state).toBe('review');

    const done = makeDoc([
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'approved', assignee_name: '박영희' }),
      makeStep({ agent: 'PV', action: 'approved', assignee_name: '최민수' }),
    ]);
    expect(cellAt(done, 'P').state).toBe('done');
  });

  it('후결자 여러 명 중 일부만 합의하면 미합의자만 남는다', () => {
    const doc = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved' }),
        makeStep({ agent: 'RA', action: 'approved', assignee_loginid: 'x', assignee_name: '유관순' }),
        makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'y', assignee_name: '이순신' }),
      ]),
      post_approver_fixed_loginid: 'fixed',
    };
    expect(cellAt(doc, 'RA_EXTRA')).toEqual({
      slot: 'RA_EXTRA', label: 'approval.stage_post_extra', state: 'review', name: '이순신',
    });
  });
});

describe('getDocTableRows — MAP 삭제: 고정 후결자 자리에 RFG', () => {
  const mde = (steps: ApprovalStepFrontend[]) => makeMdeDoc([
    makeStep({ agent: 'P', action: 'pending' }),
    makeStep({ agent: 'J', action: 'pending' }),
    makeStep({ agent: 'O', action: 'pending' }),
    ...steps,
  ]);

  it('2열 1행이 후결자가 아니라 RFG 다', () => {
    const doc = mde([makeStep({ agent: 'R', action: 'pending', assignee_loginid: 'r1', assignee_name: '김철수' })]);
    expect(cellAt(doc, 'RA_FIXED')).toEqual({
      slot: 'RA_FIXED', label: 'approval.agent_R', state: 'review', name: '김철수',
    });
  });

  it('MASK·추가후결자는 해당없음', () => {
    const doc = mde([makeStep({ agent: 'R', action: 'pending' })]);
    expect(cellAt(doc, 'E').state).toBe('na');
    expect(cellAt(doc, 'RA_EXTRA').state).toBe('na');
  });

  it('RV 를 지정해도 RFG 칸 이름은 담당자 그대로 유지된다(다른 칸과 다른 예외 규칙)', () => {
    const doc = mde([
      makeStep({ agent: 'R', action: 'approved', assignee_name: '김철수' }),
      makeStep({ agent: 'RV', action: 'pending', assignee_loginid: 'rv1', assignee_name: '이검토' }),
    ]);
    const cell = cellAt(doc, 'RA_FIXED');
    expect(cell.state).toBe('review');
    expect(cell.name).toBe('김철수');
  });

  it('일반 문서의 2열 1행은 계속 고정 후결자를 가리킨다(회귀 방지)', () => {
    // 고정 후결자도 라벨이 RFG 라 라벨만으로는 MDE 의 R 담당자와 구분되지 않는다.
    // 이 칸이 실제로 어느 step 을 집는지(담당자 이름)로 확인한다.
    const doc = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved', assignee_name: '김철수' }),
        makeStep({ agent: 'P', action: 'pending' }),
        makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'fixed', assignee_name: '정고정' }),
      ]),
      post_approver_fixed_loginid: 'fixed',
    };
    const cell = cellAt(doc, 'RA_FIXED');
    expect(cell.name).toBe('정고정');
    expect(cell.name).not.toBe('김철수');
  });
});

describe('getDocTableRows — 반려 / 중단', () => {
  it('반려 문서는 그리드가 아니라 기존 단일 행이다', () => {
    const doc: RequestDocument = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved' }),
        makeStep({ agent: 'E', action: 'rejected', assignee_name: '강동원' }),
        makeStep({ agent: 'P', action: 'pending' }),
      ]),
      status: 'rejected',
    };
    const rows = getDocTableRows(doc, t);
    expect(rows[0].pathKey).toBe('single');
    expect(rows[0].pathStatus).toBe('rejected');
    expect(rows[0].stageText).toBe('approval.agent_E(강동원)');
  });

  it('병렬 단계에서 중단(pause)되면 6칸을 전부 PAUSE 로 덮고 이름을 지운다', () => {
    const doc: RequestDocument = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved' }),
        makeStep({ agent: 'P', action: 'pending', assignee_loginid: 'p1', assignee_name: '박영희' }),
        makeStep({ agent: 'J', action: 'pending' }),
        makeStep({ agent: 'O', action: 'pending' }),
      ]),
      status: 'pause',
    };
    const cells = gridOf(doc);
    expect(cells.map((c) => c.state)).toEqual(Array(6).fill('pause'));
    expect(cells.every((c) => c.name === undefined)).toBe(true);
  });

  it('병렬 진입 이전에 중단되면 기존 단일 행 그대로다', () => {
    const doc: RequestDocument = {
      ...makeDoc([makeStep({ agent: 'R', action: 'pending' })]),
      status: 'pause',
    };
    const rows = getDocTableRows(doc, t);
    expect(rows[0].pathKey).toBe('single');
    expect(rows[0].pathStatus).toBe('pause');
  });

  it("중단 '요청중' 칩은 대상 단계 칸에만 붙는다", () => {
    const pStep = makeStep({ agent: 'P', action: 'pending', assignee_loginid: 'p1', assignee_name: '박영희' });
    const oStep = makeStep({ agent: 'O', action: 'pending' });
    const doc: RequestDocument = {
      ...makeDoc([makeStep({ agent: 'R', action: 'approved' }), pStep, oStep]),
      pause_request: {
        id: 1, state: 'requested', reason: '수정 필요', requester_name: '요청자',
        round: 1, target_step_ids: [pStep.id], confirmed_step_ids: [],
        created_at: '2026-08-10T00:00:00Z',
      },
    };
    expect(cellAt(doc, 'P').pauseRequested).toBe(true);
    expect(cellAt(doc, 'O').pauseRequested).toBeUndefined();
  });
});

describe('getFinalCompletionDate — 단계별 기한 표시는 없어졌지만 최종 완료예정은 유지된다', () => {
  it('J 의 기한이 가장 늦으면 그 날짜가 최종 완료예정일이 된다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-10' }),
      makeStep({ agent: 'P', action: 'pending', due_date: '2026-08-13' }),
      makeStep({ agent: 'J', action: 'pending', due_date: '2026-08-17' }),
      makeStep({ agent: 'O', action: 'pending', due_date: '2026-08-17' }),
    ]);
    expect(getFinalCompletionDate(doc)).toBe('2026. 8. 17.');
  });

  it('P 만 남고 J·O 가 끝나도 P 의 기한이 최종 완료예정일로 남는다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-10' }),
      makeStep({ agent: 'P', action: 'pending', due_date: '2026-08-20' }),
      makeStep({ agent: 'J', action: 'approved', due_date: '2026-08-17' }),
      makeStep({ agent: 'O', action: 'approved', due_date: '2026-08-17' }),
    ]);
    expect(getFinalCompletionDate(doc)).toBe('2026. 8. 20.');
  });

  it('MAP 삭제: R 이 가장 늦은 기한이면 그 날짜가 최종 완료예정일이 된다', () => {
    const doc = makeMdeDoc([
      makeStep({ agent: 'R', action: 'pending', due_date: '2026-09-01' }),
      makeStep({ agent: 'P', action: 'approved', due_date: '2026-08-12' }),
      makeStep({ agent: 'J', action: 'approved', due_date: '2026-08-12' }),
      makeStep({ agent: 'O', action: 'approved', due_date: '2026-08-14' }),
    ]);
    expect(getFinalCompletionDate(doc)).toBe('2026. 9. 1.');
  });

  it('반려 문서는 잔여 pending 의 기한이 남아 있어도 -', () => {
    const doc: RequestDocument = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved', due_date: '2026-08-10' }),
        makeStep({ agent: 'P', action: 'pending', due_date: '2026-08-20' }),
      ]),
      status: 'rejected',
    };
    expect(getFinalCompletionDate(doc)).toBe('-');
  });

  it('병렬 진입 전에는 -', () => {
    const doc = makeDoc([makeStep({ agent: 'R', action: 'pending', due_date: '2026-08-12' })]);
    expect(getFinalCompletionDate(doc)).toBe('-');
  });
});

describe('stageLabel — 검토자·고정 후결자도 단계명으로 표기(2026-08)', () => {
  it('R단계 검토자(RV)는 "검토자" 가 아니라 RFG 로 표기된다', () => {
    const doc = makeDoc([
      makeStep({ agent: 'R', action: 'approved', assignee_name: '김철수' }),
      makeStep({ agent: 'RV', action: 'pending', assignee_loginid: 'rv1', assignee_name: '이검토' }),
    ]);
    expect(getDocTableRows(doc, t)[0].stageText).toBe('approval.agent_R(이검토)');
  });

  it('RV 단계에서 반려된 문서도 RFG(이름) 로 표기된다', () => {
    const doc: RequestDocument = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved', assignee_name: '김철수' }),
        makeStep({ agent: 'RV', action: 'rejected', assignee_name: '이검토' }),
      ]),
      status: 'rejected',
    };
    expect(getDocTableRows(doc, t)[0].stageText).toBe('approval.agent_R(이검토)');
  });

  it('그리드의 고정 후결자 칸 라벨은 RFG 다', () => {
    const doc = {
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved' }),
        makeStep({ agent: 'P', action: 'pending' }),
        makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'fixed', assignee_name: '정고정' }),
        makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'extra', assignee_name: '이순신' }),
      ]),
      post_approver_fixed_loginid: 'fixed',
    };
    expect(cellAt(doc, 'RA_FIXED').label).toBe('approval.agent_R');
    expect(cellAt(doc, 'RA_EXTRA').label).toBe('approval.stage_post_extra');
  });

  it('고정 후결자가 반려한 문서도 RFG(이름), 추가 후결자는 추가후결자(이름)', () => {
    const base = (rejectedLoginid: string) => ({
      ...makeDoc([
        makeStep({ agent: 'R', action: 'approved' }),
        makeStep({ agent: 'RA', action: 'rejected', assignee_loginid: rejectedLoginid, assignee_name: '반려자' }),
      ]),
      status: 'rejected' as const,
      post_approver_fixed_loginid: 'fixed',
    });
    expect(getDocTableRows(base('fixed'), t)[0].stageText).toBe('approval.agent_R(반려자)');
    expect(getDocTableRows(base('extra'), t)[0].stageText).toBe('approval.stage_post_extra(반려자)');
  });
});

describe('isMyDocument — 결재현황 MY 탭 / 홈 나의 의뢰 현황 공용 판정', () => {
  const me = { role: 'PL', username: 'me', name: '나' };

  const docBy = (requesterName: string, steps: ApprovalStepFrontend[] = []): RequestDocument => ({
    ...makeDoc(steps),
    requester_name: requesterName,
  });

  it('MASTER 는 전체, 역할 없음(NONE)은 없음', () => {
    const doc = docBy('남');
    expect(isMyDocument(doc, { role: 'MASTER', username: 'm', name: 'M' })).toBe(true);
    expect(isMyDocument(doc, { role: 'NONE', username: 'n', name: 'N' })).toBe(false);
    expect(isMyDocument(doc, { role: null, username: 'n', name: 'N' })).toBe(false);
  });

  it('PL: 내가 작성한 문서는 상태와 무관하게 잡힌다', () => {
    const draft: RequestDocument = { ...docBy('나'), status: 'draft' };
    expect(isMyDocument(draft, me)).toBe(true);
  });

  it('PL: 내가 담당인 PL 단계가 pending 이면 잡힌다', () => {
    const doc = docBy('남', [makeStep({ agent: 'PL', action: 'pending', assignee_loginid: 'me' })]);
    expect(isMyDocument(doc, me)).toBe(true);
  });

  it('PL: 내가 이미 합의한 문서는 빠진다', () => {
    const doc = docBy('남', [
      makeStep({ agent: 'PL', action: 'approved', assignee_loginid: 'me' }),
      makeStep({ agent: 'R', action: 'pending', assignee_loginid: 'other' }),
    ]);
    expect(isMyDocument(doc, me)).toBe(false);
  });

  it('PL: 추가 후결자(RA)로 지정된 문서도 잡힌다', () => {
    const doc = docBy('남', [
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'pending' }),
      makeStep({ agent: 'RA', action: 'pending', assignee_loginid: 'me', assignee_name: '나' }),
    ]);
    expect(isMyDocument(doc, me)).toBe(true);
  });

  it('TE_*: 내가 담당인 pending 단계가 있으면 잡히고, 합의를 마치면 빠진다', () => {
    const teP = { role: 'TE_P', username: 'p1', name: '박영희' };
    const pending = docBy('남', [
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'pending', assignee_loginid: 'p1' }),
    ]);
    const approved = docBy('남', [
      makeStep({ agent: 'R', action: 'approved' }),
      makeStep({ agent: 'P', action: 'approved', assignee_loginid: 'p1' }),
    ]);
    expect(isMyDocument(pending, teP)).toBe(true);
    expect(isMyDocument(approved, teP)).toBe(false);
  });

  it('반려 문서의 잔여 pending 단계로는 잡히지 않는다', () => {
    const doc: RequestDocument = {
      ...docBy('남', [makeStep({ agent: 'P', action: 'pending', assignee_loginid: 'p1' })]),
      status: 'rejected',
    };
    expect(isMyDocument(doc, { role: 'TE_P', username: 'p1', name: '박' })).toBe(false);
  });

  it('이전 회차의 pending 단계로는 잡히지 않는다', () => {
    const doc = docBy('남', [
      makeStep({ agent: 'PL', action: 'pending', assignee_loginid: 'me', round: 1 }),
      makeStep({ agent: 'PL', action: 'pending', assignee_loginid: 'other', round: 2 }),
    ]);
    expect(isMyDocument(doc, me)).toBe(false);
  });
});
