import {
  RequestDocument,
  VOC,
  Stats,
  CreateDocumentInput,
  UpdateDocumentInput,
  CreateVocInput,
  AgentType,
  ApprovalStepFrontend,
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
    requester_position: '팀장',
    product_name: '스마트 온도조절기',
    product_name_en: 'Smart Thermostat',
    product_type: 'update',
    product_version: 'v2.0',
    product_description:
      '기존 온도조절기 대비 AI 기반 학습 알고리즘을 탑재하여 에너지 효율을 30% 향상시킨 차세대 제품입니다.',
    product_description_en:
      'A next-generation product with AI-based learning algorithm for 30% energy efficiency improvement.',
    map_type: 'intro',
    target_audience: '가정용 IoT 기기 구매 고객, 에너지 절약에 관심 있는 소비자',
    key_features:
      '- AI 자동 학습 스케줄링\n- 앱 연동 원격 제어\n- 에너지 사용량 리포트\n- 음성 인식 지원 (Bixby, Alexa)',
    key_features_en:
      '- AI auto-learning scheduling\n- App-linked remote control\n- Energy usage report\n- Voice recognition (Bixby, Alexa)',
    changes_from_previous: 'AI 학습 기능 신규 추가, 디스플레이 해상도 개선, 배터리 수명 2배 연장',
    reference_materials: '경쟁사 Nest Thermostat Gen4 브로셔 참고',
    deadline: '2024-04-30',
    priority: 'high',
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
    requester_position: '선임',
    product_name: '공기청정기 Pro',
    product_name_en: 'Air Purifier Pro',
    product_type: 'new',
    product_version: 'v1.0',
    product_description:
      '헤파 H14 필터 탑재 및 실시간 공기질 센서로 정밀한 공기 정화 성능을 제공하는 프리미엄 제품입니다.',
    product_description_en:
      'A premium product with HEPA H14 filter and real-time air quality sensor.',
    map_type: 'feature',
    target_audience: '알레르기·호흡기 질환 보유 고객, 프리미엄 가전 소비자',
    key_features:
      '- HEPA H14 필터 (0.1μm 입자 99.97% 제거)\n- 실시간 PM2.5/PM10 측정\n- 자동 청정 모드\n- 저소음 설계 (22dB)',
    key_features_en:
      '- HEPA H14 filter (99.97% removal of 0.1μm particles)\n- Real-time PM2.5/PM10 measurement\n- Auto clean mode\n- Low-noise design (22dB)',
    changes_from_previous: '',
    reference_materials: '',
    deadline: '2024-05-15',
    priority: 'urgent',
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
    requester_position: '대리',
    product_name: '로봇청소기 R3',
    product_name_en: 'Robot Vacuum R3',
    product_type: 'add_feature',
    product_version: 'v3.2',
    product_description: '기존 R3 모델에 물걸레 자동 세척 기능을 추가한 업그레이드 버전입니다.',
    product_description_en: 'Upgraded version of R3 model with automatic mop washing feature.',
    map_type: 'comparison',
    target_audience: '기존 R3 사용자, 물걸레 청소 기능에 관심 있는 소비자',
    key_features:
      '- 물걸레 자동 세척 및 건조\n- 세척액 자동 분사\n- 맵핑 정확도 20% 향상\n- 장애물 인식 강화',
    key_features_en:
      '- Auto mop washing and drying\n- Auto cleaning solution spray\n- 20% improved mapping accuracy\n- Enhanced obstacle detection',
    changes_from_previous: '물걸레 자동 세척 기능 신규 추가, 흡입력 15% 향상',
    reference_materials: 'R3 기존 소개 지도 파일 첨부',
    deadline: '2024-04-20',
    priority: 'medium',
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
    requester_position: '주임',
    product_name: '스마트 도어락 SE',
    product_name_en: 'Smart Door Lock SE',
    product_type: 'change',
    product_version: 'v2.1',
    product_description: '배터리 타입 변경 및 보안 알고리즘 강화에 따른 소개 지도 업데이트 요청입니다.',
    product_description_en: 'Update request due to battery type change and enhanced security algorithm.',
    map_type: 'intro',
    target_audience: '아파트·주택 거주 보안 관심 고객',
    key_features:
      '- AA배터리 → USB-C 충전식 변경\n- AES-256 암호화 적용\n- 얼굴인식 정확도 99.5%\n- 앱 출입 이력 관리',
    key_features_en:
      '- AA battery → USB-C rechargeable\n- AES-256 encryption\n- Face recognition accuracy 99.5%\n- App-based access history',
    changes_from_previous: '배터리 방식 변경, 보안 알고리즘 업그레이드, UI 개선',
    reference_materials: '',
    deadline: '2024-06-01',
    priority: 'low',
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
    requester_position: '사원',
    product_name: '식기세척기 DW-500',
    product_name_en: 'Dishwasher DW-500',
    product_type: 'new',
    product_version: 'v1.0',
    product_description: '6인 가족용 대용량 식기세척기로 강력한 스팀 세척 기능을 탑재했습니다.',
    product_description_en: 'Large-capacity dishwasher for families of 6 with powerful steam washing.',
    map_type: 'intro',
    target_audience: '4인 이상 가족 고객',
    key_features: '- 스팀 고온 세척\n- 60분 급속 모드\n- 에너지 효율 1등급',
    key_features_en: '- Steam high-temperature washing\n- 60-min quick mode\n- Energy efficiency Grade 1',
    changes_from_previous: '',
    reference_materials: '',
    deadline: '2024-07-01',
    priority: 'medium',
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
    requester_position: '팀장',
    product_name: '무선청소기 X7',
    product_name_en: 'Cordless Vacuum X7',
    product_type: 'update',
    product_version: 'v7.0',
    product_description: '배터리 용량 50% 증가 및 흡입력 개선으로 청소 시간을 대폭 단축한 제품입니다.',
    product_description_en: 'Significantly reduced cleaning time with 50% battery increase and improved suction.',
    map_type: 'roadmap',
    target_audience: '프리미엄 청소기 구매 고객, 넓은 공간 사용자',
    key_features:
      '- 배터리 60분 지속\n- 흡입력 150AW\n- 멀티 브러시 헤드\n- LCD 배터리 잔량 표시',
    key_features_en:
      '- 60-min battery life\n- 150AW suction power\n- Multi brush head\n- LCD battery indicator',
    changes_from_previous: '배터리 용량 40→60분, 흡입력 120→150AW, 무게 경량화',
    reference_materials: 'X6 기존 자료 참고',
    deadline: '2024-05-31',
    priority: 'high',
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

// 반려 후 재상신: 반려한 agent의 step만 reset, 나머지 approved는 유지
const mockResubmitDocument = async (id: number) => {
  await delay(500);
  const doc = documents.find((d) => d.id === id);
  if (!doc) throw new Error(`Document ${id} not found`);
  if (doc.status !== 'rejected') throw new Error('반려된 의뢰서만 재상신할 수 있습니다.');

  const steps = [...(doc.approval_steps ?? [])];
  // 반려된 step 찾기
  const rejectedIdx = steps.findIndex((s) => s.action === 'rejected');
  if (rejectedIdx !== -1) {
    // 반려된 step만 pending으로 리셋
    steps[rejectedIdx] = { ...steps[rejectedIdx], action: 'pending', acted_at: null };
  }

  documents = documents.map((d) =>
    d.id === id
      ? { ...d, status: 'under_review' as const, updated_at: now(), approval_steps: steps }
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
        sugarAdd = parsed?.detail?.sugar_add === '예';
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

const mockApproveDocument = async (id: number, data?: { comment?: string }) => {
  await delay();
  documents = documents.map((d) =>
    d.id === id ? { ...d, status: 'approved' as const, updated_at: now() } : d
  );
  return { data: { message: '승인되었습니다.', status: 'approved' } };
};

const mockRejectDocument = async (id: number, data?: { comment?: string }) => {
  await delay();
  documents = documents.map((d) =>
    d.id === id ? { ...d, status: 'rejected' as const, updated_at: now() } : d
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

// ===== Exports =====

export const mockDocumentsAPI = {
  list: mockListDocuments,
  get: mockGetDocument,
  create: mockCreateDocument,
  update: mockUpdateDocument,
  submit: mockSubmitDocument,
  resubmit: mockResubmitDocument,
  withdraw: mockWithdrawDocument,
  approve: mockApproveDocument,
  reject: mockRejectDocument,
  rejectStep: mockRejectStep,
  stats: mockDocumentStats,
  approveStep: mockApproveStep,
};

export const mockVocAPI = {
  list: mockListVocs,
  create: mockCreateVoc,
  get: mockGetVoc,
};
