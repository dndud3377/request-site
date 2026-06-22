// 전체 가이드(투어) — 결재 현황 페이지 샘플 시드
// /approval?embed=tour 진입 시, 실제 API 호출 없이 결재 목록·상세를 보여주기 위한 샘플 데이터.
import { RequestDocument, ApprovalStepFrontend } from '../types';
import {
  makeTourDetail,
  makeTourJayerRows,
  makeTourOayerRows,
  makeTourBbRows,
  TOUR_JAYER_PRODUCT,
  TOUR_JAYER_STEPS,
  TOUR_JAYER_ITEMS,
} from './RequestPage/constants';

// 상세 모달(PagedDetailView)이 표(J/O/BB)와 export를 보여줄 수 있도록 채워진 additional_notes
const buildNotes = (): string => {
  const jayerRows = makeTourJayerRows().map((r, i) => ({
    ...r,
    product_name: TOUR_JAYER_PRODUCT,
    step: TOUR_JAYER_STEPS[i],
    item_id: TOUR_JAYER_ITEMS[i],
  }));
  return JSON.stringify({
    detail: makeTourDetail(),
    jayerRows,
    oayerRows: makeTourOayerRows(),
    bbRows: makeTourBbRows(),
    history: [],
  });
};

const NOTES = buildNotes();

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

const baseDoc = (id: number, title: string): Omit<RequestDocument, 'approval_steps'> => ({
  id,
  title,
  requester_name: '홍길동',
  requester_email: 'hong@example.com',
  requester_department: '설계1팀',
  product_name: TOUR_JAYER_PRODUCT,
  reference_materials: '',
  additional_notes: NOTES,
  status: 'under_review',
  production_date: '2026-07-15',
  created_at: '2026-06-17T08:00:00Z',
  updated_at: '2026-06-18T09:00:00Z',
  submitted_at: '2026-06-17T08:00:00Z',
});

// A: R 합의 완료 → 병렬 진행(경로1 PHPSI·JOB / 경로2 OVL) — 목록에서 2행으로 분기 표시
const docA: RequestDocument = {
  ...baseDoc(9001, '샘플 의뢰서 A (병렬 진행)'),
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
  ...baseDoc(9002, '샘플 의뢰서 B (PL 검토 중)'),
  requester_name: '최상신',
  approval_steps: [
    step(1, 'PL', 'pending', { assignee_name: '김검토', assignee_loginid: 'tour-pl' }),
  ],
};

// C: R 단계 담당자 지정 대기 — 목록에서 단일 행("지정 대기") 표시
const docC: RequestDocument = {
  ...baseDoc(9003, '샘플 의뢰서 C (담당자 지정 대기)'),
  approval_steps: [
    step(1, 'PL', 'approved', { assignee_name: '김검토', acted_at: '2026-06-17T10:00:00Z' }),
    step(2, 'R', 'pending', { due_date: '2026-06-23' }),
  ],
};

export const TOUR_APPROVAL_DOCS: RequestDocument[] = [docA, docB, docC];

// "MY"(내 결재) 필터에서 보여줄 문서 id — 데모 일관성을 위해 사용자 역할과 무관하게 고정한다.
export const TOUR_APPROVAL_MY_IDS = new Set<number>([docA.id, docC.id]);

// 상세 모달을 열어 시연할 대표 문서(병렬 진행 문서 A)
export const TOUR_APPROVAL_DETAIL_DOC = docA;
