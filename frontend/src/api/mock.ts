import {
  RequestDocument,
  VOC,
  Stats,
  CreateDocumentInput,
  UpdateDocumentInput,
  CreateVocInput,
  AgentType,
  ApprovalStepFrontend,
  AdminNotice,
  CreateNoticeInput,
  UpdateNoticeInput,
} from '../types';

// MOCK_USERS는 AuthContext에서 관리 (여기서는 import 불필요)

// ===== Helpers =====

const delay = (ms = 300): Promise<void> =>
  new Promise((res) => setTimeout(res, ms));

const now = () => new Date().toISOString();
const dateStr = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

// ===== Sample Data =====

const SAMPLE_DOCUMENTS: RequestDocument[] = [
  {
    id: 1,
    title: '스마트 온도조절기 V2 소개 지도 제작 의뢰',
    requester_name: '김민준',
    requester_email: 'minjun.kim@company.com',
    requester_department: '마케팅팀',
    product_name: '스마트 온도조절기',
    reference_materials: '경쟁사 Nest Thermostat Gen4 브로셔 참고',
    additional_notes: '영문 버전도 함께 제작 부탁드립니다.',
    status: 'approved',
    created_at: dateStr(14),
    updated_at: dateStr(10),
    submitted_at: dateStr(12),
    approval_steps: [
      { id: 101, agent: 'R', action: 'approved', acted_at: dateStr(11) },
      { id: 102, agent: 'J', action: 'approved', acted_at: dateStr(10), is_parallel: true },
      { id: 103, agent: 'O', action: 'approved', acted_at: dateStr(10), is_parallel: true },
    ],
  },
  {
    id: 2,
    title: '공기청정기 Pro 신제품 소개 지도 의뢰',
    requester_name: '이서연',
    requester_email: 'seoyeon.lee@company.com',
    requester_department: '제품기획팀',
    product_name: '공기청정기 Pro',
    reference_materials: '',
    additional_notes: '',
    status: 'under_review',
    created_at: dateStr(7),
    updated_at: dateStr(5),
    submitted_at: dateStr(5),
    approval_steps: [
      { id: 104, agent: 'R', action: 'pending', acted_at: null },
    ],
  },
  {
    id: 3,
    title: '로봇청소기 R3 기능 추가 소개 지도 의뢰',
    requester_name: '박지훈',
    requester_email: 'jihoon.park@company.com',
    requester_department: '마케팅팀',
    product_name: '로봇청소기 R3',
    reference_materials: 'R3 기존 소개 지도 파일 첨부',
    additional_notes: '이전 버전과의 비교표를 포함해 주세요.',
    status: 'under_review',
    created_at: dateStr(10),
    updated_at: dateStr(8),
    submitted_at: dateStr(9),
    approval_steps: [
      { id: 105, agent: 'R', action: 'approved', acted_at: dateStr(9) },
      { id: 106, agent: 'J', action: 'pending', acted_at: null, is_parallel: true },
      { id: 107, agent: 'O', action: 'pending', acted_at: null, is_parallel: true },
    ],
  },
  {
    id: 4,
    title: '스마트 도어락 SE 제품 변경 의뢰',
    requester_name: '최수아',
    requester_email: 'sua.choi@company.com',
    requester_department: '기술지원팀',
    product_name: '스마트 도어락 SE',
    reference_materials: '',
    additional_notes: '',
    status: 'rejected',
    created_at: dateStr(20),
    updated_at: dateStr(15),
    submitted_at: dateStr(18),
    approval_steps: [
      { id: 108, agent: 'R', action: 'approved', acted_at: dateStr(17) },
      { id: 109, agent: 'J', action: 'rejected', acted_at: dateStr(15), is_parallel: true },
      { id: 110, agent: 'O', action: 'pending', acted_at: null, is_parallel: true },
    ],
  },
  {
    id: 5,
    title: '식기세척기 DW-500 소개 지도 의뢰 (임시저장)',
    requester_name: '정다은',
    requester_email: 'daeun.jung@company.com',
    requester_department: '영업팀',
    product_name: '식기세척기 DW-500',
    reference_materials: '',
    additional_notes: '',
    status: 'draft',
    created_at: dateStr(2),
    updated_at: dateStr(1),
    submitted_at: null,
    approval_steps: [],
  },
  {
    id: 6,
    title: '무선청소기 X7 소개 지도 제작 의뢰',
    requester_name: '한승호',
    requester_email: 'seungho.han@company.com',
    requester_department: '마케팅팀',
    product_name: '무선청소기 X7',
    reference_materials: 'X6 기존 자료 참고',
    additional_notes: '경쟁사 다이슨 V15와 비교 분석 포함 요청',
    status: 'approved',
    created_at: dateStr(30),
    updated_at: dateStr(25),
    submitted_at: dateStr(28),
    approval_steps: [
      { id: 111, agent: 'R', action: 'approved', acted_at: dateStr(27) },
      { id: 112, agent: 'J', action: 'approved', acted_at: dateStr(26), is_parallel: true },
      { id: 113, agent: 'O', action: 'approved', acted_at: dateStr(26), is_parallel: true },
    ],
  },
];

const SAMPLE_VOCS: VOC[] = [
  {
    id: 1,
    title: '스마트 온도조절기 앱 연동 오류 문의',
    category: 'inquiry',
    submitter_name: '홍길동',
    submitter_email: 'gildong@test.com',
    content: '스마트 온도조절기 V2를 구매했는데 앱과 연동이 안 됩니다. 블루투스 연결은 되는데 Wi-Fi 등록에서 계속 실패합니다.',
    response: '',
    status: 'in_progress',
    created_at: dateStr(3),
    responded_at: null,
  },
  {
    id: 2,
    title: '공기청정기 필터 교체 주기가 너무 짧습니다',
    category: 'complaint',
    submitter_name: '이영희',
    submitter_email: 'younghee@test.com',
    content: '공기청정기 Pro를 구매한 지 2개월이 됐는데 벌써 필터 교체 알람이 뜹니다. 필터 교체 주기 개선을 요청합니다.',
    response: '고객님의 소중한 의견 감사합니다. 필터 교체 주기 조정 관련 개발팀에 전달하겠습니다.',
    status: 'resolved',
    created_at: dateStr(10),
    responded_at: dateStr(7),
  },
  {
    id: 3,
    title: '로봇청소기에 물걸레 강도 조절 기능 추가 제안',
    category: 'suggestion',
    submitter_name: '박철수',
    submitter_email: 'chulsoo@test.com',
    content: '로봇청소기 R3를 잘 사용하고 있습니다. 물걸레 세척 시 물 분사량을 사용자가 조절할 수 있는 기능이 있으면 좋겠습니다.',
    response: '',
    status: 'open',
    created_at: dateStr(1),
    responded_at: null,
  },
];

// ===== In-memory Stores =====

let documents: RequestDocument[] = [...SAMPLE_DOCUMENTS];
let vocs: VOC[] = [...SAMPLE_VOCS];
let nextDocId = 100;
let nextVocId = 100;
let nextStepId = 200;

// ===== Mock Documents API =====

const mockListDocuments = async (params?: Record<string, string>) => {
  await delay();
  let result = [...documents];

  if (params?.status) {
    result = result.filter((d) => d.status === params.status);
  }
  if (params?.search) {
    const q = params.search.toLowerCase();
    result = result.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.product_name.toLowerCase().includes(q) ||
        d.requester_name.toLowerCase().includes(q) ||
        d.requester_department.toLowerCase().includes(q)
    );
  }

  return { data: { results: result, count: result.length } };
};

const mockGetDocument = async (id: number) => {
  await delay();
  const doc = documents.find((d) => d.id === id);
  if (!doc) throw new Error(`Document ${id} not found`);
  return { data: doc };
};

const mockCreateDocument = async (data: CreateDocumentInput) => {
  await delay();
  const newDoc: RequestDocument = {
    ...data,
    id: nextDocId++,
    status: 'draft',
    created_at: now(),
    updated_at: now(),
    submitted_at: null,
  };
  documents = [newDoc, ...documents];
  return { data: newDoc };
};

const mockUpdateDocument = async (id: number, data: UpdateDocumentInput) => {
  await delay();
  documents = documents.map((d) =>
    d.id === id ? { ...d, ...data, updated_at: now() } : d
  );
  const updated = documents.find((d) => d.id === id);
  if (!updated) throw new Error(`Document ${id} not found`);
  return { data: updated };
};

const mockSubmitDocument = async (id: number) => {
  await delay(500);
  const initialStep: ApprovalStepFrontend = {
    id: nextStepId++,
    agent: 'R',
    action: 'pending',
    acted_at: null,
  };
  documents = documents.map((d) =>
    d.id === id
      ? {
          ...d,
          status: 'under_review' as const,
          submitted_at: d.submitted_at ?? now(),
          updated_at: now(),
          approval_steps: [initialStep],
        }
      : d
  );
  const doc = documents.find((d) => d.id === id);
  if (!doc) throw new Error(`Document ${id} not found`);
  return {
    data: {
      message: '의뢰서가 성공적으로 상신되었습니다.',
      email_sent: true,
      document: doc,
    },
  };
};

// 반려 후 재상신: 전체 초기화, AGENT R부터 재시작
const mockResubmitDocument = async (id: number) => {
  await delay(500);
  const doc = documents.find((d) => d.id === id);
  if (!doc) throw new Error(`Document ${id} not found`);
  if (doc.status !== 'rejected') throw new Error('반려된 의뢰서만 재상신할 수 있습니다.');

  const initialStep: ApprovalStepFrontend = {
    id: nextStepId++,
    agent: 'R',
    action: 'pending',
    acted_at: null,
  };

  documents = documents.map((d) =>
    d.id === id
      ? { ...d, status: 'under_review' as const, updated_at: now(), approval_steps: [initialStep] }
      : d
  );
  const updated = documents.find((d) => d.id === id)!;
  return { data: { message: '재상신되었습니다.', document: updated } };
};

// 철회: under_review/rejected → draft, approval_steps 초기화
const mockWithdrawDocument = async (id: number) => {
  await delay(300);
  const doc = documents.find((d) => d.id === id);
  if (!doc) throw new Error(`Document ${id} not found`);
  documents = documents.map((d) =>
    d.id === id
      ? { ...d, status: 'draft' as const, submitted_at: null, updated_at: now(), approval_steps: [] }
      : d
  );
  return { data: { message: '철회되었습니다.' } };
};

// 삭제: 문서 완전 삭제
const mockDeleteDocument = async (id: number) => {
  await delay(300);
  const docIndex = documents.findIndex((d) => d.id === id);
  if (docIndex === -1) throw new Error(`Document ${id} not found`);
  documents.splice(docIndex, 1);
  return { data: { message: '삭제되었습니다.' } };
};

const mockApproveStep = async (docId: number, agent: AgentType, comment?: string) => {
  await delay();
  const doc = documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`Document ${docId} not found`);

  const steps: ApprovalStepFrontend[] = [...(doc.approval_steps ?? [])];
  const stepIdx = steps.findIndex((s) => s.agent === agent && s.action === 'pending');
  if (stepIdx === -1) throw new Error(`No pending step for agent ${agent}`);

  steps[stepIdx] = { ...steps[stepIdx], action: 'approved', acted_at: now(), comment };

  let newStatus = doc.status;

  if (agent === 'R') {
    steps.push({ id: nextStepId++, agent: 'J', action: 'pending', acted_at: null, is_parallel: true });
    steps.push({ id: nextStepId++, agent: 'O', action: 'pending', acted_at: null, is_parallel: true });
    newStatus = 'under_review';
  } else if (agent === 'J' || agent === 'O') {
    const jStep = steps.find((s) => s.agent === 'J');
    const oStep = steps.find((s) => s.agent === 'O');
    const bothApproved =
      jStep?.action === 'approved' && oStep?.action === 'approved';
    if (bothApproved) {
      let sugarAdd = false;
      try {
        const parsed = JSON.parse(doc.additional_notes ?? '{}');
        sugarAdd = parsed?.detail?.e_lps === '예';
      } catch {
        sugarAdd = false;
      }
      if (sugarAdd) {
        steps.push({ id: nextStepId++, agent: 'E', action: 'pending', acted_at: null });
        newStatus = 'under_review';
      } else {
        newStatus = 'approved';
      }
    }
  } else if (agent === 'E') {
    newStatus = 'approved';
  }

  documents = documents.map((d) =>
    d.id === docId
      ? { ...d, status: newStatus, approval_steps: steps, updated_at: now() }
      : d
  );
  return { data: { message: '처리되었습니다.', status: newStatus } };
};

// agent 단계 담당자 지정
const mockAssignStep = async (docId: number, agent: AgentType, assigneeId: number, assigneeName: string) => {
  await delay(200);
  const doc = documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`Document ${docId} not found`);

  const steps = [...(doc.approval_steps ?? [])];
  const stepIdx = steps.findIndex((s) => s.agent === agent && s.action === 'pending');
  if (stepIdx !== -1) {
    steps[stepIdx] = { ...steps[stepIdx], assignee_id: assigneeId, assignee_name: assigneeName };
  }

  documents = documents.map((d) =>
    d.id === docId ? { ...d, approval_steps: steps, updated_at: now() } : d
  );
  return { data: { message: '담당자가 지정되었습니다.' } };
};

// agent 단계 반려: 해당 step을 rejected로 표시, 문서 status → rejected
const mockRejectStep = async (docId: number, agent: AgentType, comment?: string) => {
  await delay();
  const doc = documents.find((d) => d.id === docId);
  if (!doc) throw new Error(`Document ${docId} not found`);

  const steps = [...(doc.approval_steps ?? [])];
  const stepIdx = steps.findIndex((s) => s.agent === agent && s.action === 'pending');
  if (stepIdx !== -1) {
    steps[stepIdx] = { ...steps[stepIdx], action: 'rejected', acted_at: now(), comment };
  }

  documents = documents.map((d) =>
    d.id === docId
      ? { ...d, status: 'rejected' as const, approval_steps: steps, updated_at: now() }
      : d
  );
  return { data: { message: '반려되었습니다.', status: 'rejected' } };
};

const mockDocumentStats = async () => {
  await delay(200);
  const byStatus: Record<string, number> = {};
  documents.forEach((d) => {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  });
  const stats: Stats = { total: documents.length, by_status: byStatus };
  return { data: stats };
};

// ===== Mock VOC API =====

const mockListVocs = async (params?: Record<string, string>) => {
  await delay();
  let result = [...vocs];
  if (params?.category) {
    result = result.filter((v) => v.category === params.category);
  }
  if (params?.status) {
    result = result.filter((v) => v.status === params.status);
  }
  return { data: { results: result, count: result.length } };
};

const mockCreateVoc = async (data: CreateVocInput) => {
  await delay();
  const newVoc: VOC = {
    ...data,
    id: nextVocId++,
    response: '',
    status: 'open',
    created_at: now(),
    responded_at: null,
  };
  vocs = [newVoc, ...vocs];
  return { data: newVoc };
};

const mockGetVoc = async (id: number) => {
  await delay();
  const voc = vocs.find((v) => v.id === id);
  if (!voc) throw new Error(`VOC ${id} not found`);
  return { data: voc };
};

// ===== Sample Notices =====

const SAMPLE_NOTICES: AdminNotice[] = [
  {
    id: 1,
    template: 'release_note',
    date: '2026-04-07',
    title: 'v2.0 업데이트',
    content: '',
    items: [
      { category: 'new', content: '관리자 공지사항 기능 추가' },
      { category: 'updated', content: '결재 현황 UI 개선' },
      { category: 'bugfix', content: '합의 처리 후 모달 닫힘 오류 수정' },
    ],
    created_at: '2026-04-07T09:00:00',
    updated_at: '2026-04-07T09:00:00',
  },
];

// ===== In-memory Notice Store =====

let notices: AdminNotice[] = [...SAMPLE_NOTICES];
let nextNoticeId = 2;

// ===== Mock Notices API =====

const mockListNotices = async () => {
  await delay();
  return { data: [...notices] };
};

const mockLatestNotice = async () => {
  await delay(200);
  return { data: notices[0] ?? null };
};

const mockGetNotice = async (id: number) => {
  await delay();
  const notice = notices.find((n) => n.id === id);
  if (!notice) throw new Error(`Notice ${id} not found`);
  return { data: notice };
};

const mockCreateNotice = async (data: CreateNoticeInput) => {
  await delay();
  const newNotice: AdminNotice = {
    ...data,
    id: nextNoticeId++,
    created_at: now(),
    updated_at: now(),
  };
  notices = [newNotice, ...notices];
  return { data: newNotice };
};

const mockUpdateNotice = async (id: number, data: UpdateNoticeInput) => {
  await delay();
  notices = notices.map((n) =>
    n.id === id ? { ...n, ...data, updated_at: now() } : n
  );
  const updated = notices.find((n) => n.id === id);
  if (!updated) throw new Error(`Notice ${id} not found`);
  return { data: updated };
};

const mockDeleteNotice = async (id: number) => {
  await delay();
  notices = notices.filter((n) => n.id !== id);
  return { data: null };
};

// ===== Exports =====

export const mockNoticesAPI = {
  list: mockListNotices,
  latest: mockLatestNotice,
  get: mockGetNotice,
  create: mockCreateNotice,
  update: mockUpdateNotice,
  delete: mockDeleteNotice,
};

export const mockDocumentsAPI = {
  list: mockListDocuments,
  get: mockGetDocument,
  create: mockCreateDocument,
  update: mockUpdateDocument,
  submit: mockSubmitDocument,
  resubmit: mockResubmitDocument,
  withdraw: mockWithdrawDocument,
  delete: mockDeleteDocument,
  rejectStep: mockRejectStep,
  stats: mockDocumentStats,
  approveStep: mockApproveStep,
  assignStep: mockAssignStep,
};

export const mockVocAPI = {
  list: mockListVocs,
  create: mockCreateVoc,
  get: mockGetVoc,
};
