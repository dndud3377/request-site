// 전체 가이드(투어) — 결재 현황 페이지 샘플 시드
// /approval?embed=tour 진입 시, 실제 API 호출 없이 결재 목록·상세를 보여주기 위한 샘플 데이터.
import { RequestDocument, ApprovalStepFrontend, JayerRow, UserWithRole, HistorySnapshot, ReviewItem } from '../types';
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

// J 단계 검토 항목 시연용 — 확인 완료 1건 / 미확인 1건으로 진행 상태 차이를 보여준다.
export const TOUR_REVIEW_ITEMS: ReviewItem[] = [
  {
    id: 1,
    title: '신규 Layer STEPSEQ 확인',
    is_done: true,
    created_at: '2026-06-18T09:10:00Z',
    reviewers: [
      { id: 1, loginid: 'tour-j1', name: '정JOB', confirmed: true, confirmed_at: '2026-06-18T11:00:00Z' },
    ],
  },
  {
    id: 2,
    title: 'Backbone 매핑 결과 확인',
    is_done: false,
    created_at: '2026-06-18T09:12:00Z',
    reviewers: [
      { id: 2, loginid: 'tour-j2', name: '오검토', confirmed: false, confirmed_at: null },
    ],
  },
];

// 검토 항목 검토자 지정 후보 (시연 전용 — 실제 지정은 하지 않는다)
export const TOUR_REVIEW_ITEM_CANDIDATES: UserWithRole[] = [
  { id: 11, loginid: 'tour-j1', name: '정JOB', deptname: 'JOB팀', role: 'TE_J', mail: 'j1@example.com' },
  { id: 12, loginid: 'tour-j2', name: '오검토', deptname: 'JOB팀', role: 'TE_J', mail: 'j2@example.com' },
];

// A: R 합의 완료 → 병렬 진행(경로1 PHPSI / 경로2 JOB·OVL) — 목록에서 2행으로 분기 표시
// 재상신 이력이 있어 상세에서 변경 필드/행이 강조된다.
// `can_withdraw`: 철회 정책(진행 중 문서는 현재 단계 확인 후 삭제) 시연을 위해 버튼을 노출한다.
const docA: RequestDocument = {
  ...baseDoc(9001, '샘플 의뢰서 A (병렬 진행)', NOTES_WITH_HISTORY),
  can_withdraw: true,
  review_items: TOUR_REVIEW_ITEMS,
  approval_steps: [
    step(1, 'PL', 'approved', { assignee_name: '김검토', acted_at: '2026-06-17T10:00:00Z' }),
    step(2, 'R', 'approved', { assignee_name: '이RFG', acted_at: '2026-06-18T09:00:00Z' }),
    // 경로1(PHPSI) — 검토중(담당자 선점).
    step(3, 'P', 'pending', { assignee_name: '박PHPSI', assignee_loginid: 'tour-p', due_date: '2026-06-24' }),
    // 경로2(JOB·OVL) — (2026-08) J 는 P 뒤 순차가 아니라 R 합의 시점부터 O 와 같은 병렬 단계다.
    // JOB 은 아직 아무도 선점하지 않은 '대기중', OVL 은 선점된 '검토중' 으로 상태점 차이를 보여준다.
    step(4, 'J', 'pending', { due_date: '2026-06-25' }),
    step(5, 'O', 'pending', { assignee_name: '한OVL', assignee_loginid: 'tour-o', due_date: '2026-06-25' }),
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
