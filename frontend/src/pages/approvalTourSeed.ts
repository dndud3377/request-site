// 전체 가이드(투어) — 결재 현황 페이지 샘플 시드
// /approval?embed=tour 진입 시, 실제 API 호출 없이 결재 목록·상세를 보여주기 위한 샘플 데이터.
import { RequestDocument, ApprovalStepFrontend, JayerRow, UserWithRole, HistorySnapshot } from '../types';
import {
  makeTourDetail,
  makeTourJayerRows,
  makeTourOayerRows,
  makeTourBbRows,
  TOUR_JAYER_PRODUCT,
  TOUR_JAYER_STEPS,
  TOUR_JAYER_ITEMS,
} from './RequestPage/constants';

// 현재(최신) J-ayer 행 — id를 고정해 이전 스냅샷과 행 단위로 매칭(이력 diff)되게 한다.
const buildCurJayer = (): JayerRow[] =>
  makeTourJayerRows().map((r, i) => ({
    ...r,
    product_name: TOUR_JAYER_PRODUCT,
    step: TOUR_JAYER_STEPS[i],
    item_id: TOUR_JAYER_ITEMS[i],
  }));

const CUR_JAYER = buildCurJayer();
const CUR_DETAIL = makeTourDetail();

// 이전(재상신 직전) 스냅샷 — 같은 id를 유지하되 일부 값을 바꿔, 변경 필드/행이 강조되도록 한다.
const buildPrevSnapshot = (): HistorySnapshot => {
  const prevJayer = CUR_JAYER.map((r) => ({ ...r }));
  // 2번째 행의 STEP/ITEM을 이전 값으로 둔다 → 해당 행이 "변경됨"으로 강조되고 '이력 확인' 노출.
  prevJayer[1] = { ...prevJayer[1], step: '15', item_id: 'ITEM_OLD' };
  return {
    timestamp: '2026-06-16T08:00:00Z',
    detail: { ...CUR_DETAIL, customer_requirement: '기존 라인 제품 소개 지도 제작 요청' },
    jayerRows: prevJayer,
    oayerRows: makeTourOayerRows(),
    bbRows: makeTourBbRows(),
  };
};

// 상세 모달(PagedDetailView)이 표(J/O/BB)와 export를 보여줄 수 있도록 채워진 additional_notes
const buildNotes = (history: HistorySnapshot[]): string =>
  JSON.stringify({
    detail: CUR_DETAIL,
    jayerRows: CUR_JAYER,
    oayerRows: makeTourOayerRows(),
    bbRows: makeTourBbRows(),
    history,
  });

// A는 재상신 이력(diff)이 있는 버전, B/C는 이력 없는 버전을 사용한다.
const NOTES_WITH_HISTORY = buildNotes([buildPrevSnapshot()]);
const NOTES_PLAIN = buildNotes([]);

const step = (
  id: number,
  agent: ApprovalStepFrontend['agent'],
  action: ApprovalStepFrontend['action'],
  extra: Partial<ApprovalStepFrontend> = {},
): ApprovalStepFrontend => ({
  id,
  agent,
  action,
  acted_at: action === 'approved' ? '2026-06-18T09:00:00Z' : null,
  round: 1,
  ...extra,
});

const baseDoc = (id: number, title: string, notes: string): Omit<RequestDocument, 'approval_steps'> => ({
  id,
  title,
  requester_name: '홍길동',
  requester_email: 'hong@example.com',
  requester_department: '설계1팀',
  product_name: TOUR_JAYER_PRODUCT,
  reference_materials: '',
  additional_notes: notes,
  status: 'under_review',
  production_date: '2026-07-15',
  created_at: '2026-06-17T08:00:00Z',
  updated_at: '2026-06-18T09:00:00Z',
  submitted_at: '2026-06-17T08:00:00Z',
});

// A: R 합의 완료 → 병렬 진행(경로1 PHPSI·JOB / 경로2 OVL) — 목록에서 2행으로 분기 표시
// 재상신 이력이 있어 상세에서 변경 필드/행이 강조된다.
const docA: RequestDocument = {
  ...baseDoc(9001, '샘플 의뢰서 A (병렬 진행)', NOTES_WITH_HISTORY),
  approval_steps: [
    step(1, 'PL', 'approved', { assignee_name: '김검토', acted_at: '2026-06-17T10:00:00Z' }),
    step(2, 'R', 'approved', { assignee_name: '이RFG', acted_at: '2026-06-18T09:00:00Z' }),
    step(3, 'P', 'pending', { assignee_name: '박PHPSI', assignee_loginid: 'tour-p', due_date: '2026-06-24' }),
    step(4, 'J', 'pending', { assignee_name: '정JOB', assignee_loginid: 'tour-j', due_date: '2026-06-26' }),
    step(5, 'O', 'pending', { due_date: '2026-06-25' }),
  ],
};

// B: PL 검토 단계 진행 중 — 목록에서 단일 행("검토") 표시
const docB: RequestDocument = {
  ...baseDoc(9002, '샘플 의뢰서 B (PL 검토 중)', NOTES_PLAIN),
  requester_name: '최상신',
  approval_steps: [
    step(1, 'PL', 'pending', { assignee_name: '김검토', assignee_loginid: 'tour-pl' }),
  ],
};

// C: R 단계 담당자 지정 대기 — 목록에서 단일 행("지정 대기") 표시
const docC: RequestDocument = {
  ...baseDoc(9003, '샘플 의뢰서 C (담당자 지정 대기)', NOTES_PLAIN),
  approval_steps: [
    step(1, 'PL', 'approved', { assignee_name: '김검토', acted_at: '2026-06-17T10:00:00Z' }),
    step(2, 'R', 'pending', { due_date: '2026-06-23' }),
  ],
};

export const TOUR_APPROVAL_DOCS: RequestDocument[] = [docA, docB, docC];

// "MY"(내 결재) 필터에서 보여줄 문서 id — 데모 일관성을 위해 사용자 역할과 무관하게 고정한다.
export const TOUR_APPROVAL_MY_IDS = new Set<number>([docA.id, docC.id]);

// 상세 모달을 열어 시연할 대표 문서(병렬 진행 + 재상신 이력 문서 A)
export const TOUR_APPROVAL_DETAIL_DOC = docA;

// 담당자 '지정하기' 시연 대상 문서(R 단계 지정 대기 문서 C)
export const TOUR_APPROVAL_ASSIGN_DOC = docC;

// '지정하기' 드롭다운에 펼쳐 보여줄 샘플 팀 인원 — 실제 지정은 하지 않는다(시연 전용).
export const TOUR_ASSIGN_MEMBERS: UserWithRole[] = [
  { id: 1, loginid: 'tour-r1', name: '이RFG', deptname: 'RFG팀', role: 'TE_R', mail: 'r1@example.com' },
  { id: 2, loginid: 'tour-r2', name: '강검토', deptname: 'RFG팀', role: 'TE_R', mail: 'r2@example.com' },
  { id: 3, loginid: 'tour-r3', name: '윤담당', deptname: 'RFG팀', role: 'TE_R', mail: 'r3@example.com' },
];
