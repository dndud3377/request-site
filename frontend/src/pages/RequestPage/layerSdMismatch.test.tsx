/**
 * J/O-layer 'SD 첫 숫자 ↔ Layer 일치' 상신 검증 + 예외 관리 UI 테스트.
 *
 * 규칙: SD 맨 앞 숫자(예: "1000.123 월평동 지점" → 1000.123)가 Layer 와 다른 행이 있으면 J-layer(STEP3)·
 * O-layer(STEP4)에서 '다음'으로 못 넘어간다. (process_id, sp, SD 첫 숫자, layerid) 가 모두 같은 예외가
 * 등록돼 있으면 통과한다. 숫자는 값으로 비교한다(100.930 = 100.93).
 * 예외 관리 화면은 홈으로 옮겼다(HomePage.sdException.test.tsx / LayerSdExceptionModal.test.tsx) —
 * 작성 화면에는 어떤 역할에게도 관리 버튼이 없다.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

// jest.mock 팩토리는 호이스팅되어 `mock` 접두사 변수만 참조할 수 있다.
const mockState: {
  captured: unknown | null;
  doc: unknown;
  optionsFor: (line: string) => string[];
  role: string;
  exceptions: { J: unknown[]; O: unknown[] };
  created: unknown[];
} = { captured: null, doc: null, optionsFor: () => [], role: 'PL', exceptions: { J: [], O: [] }, created: [] };

// RichTextEditor 는 tiptap(ESM) 을 끌어와 jest 가 파싱하지 못한다. 값 전달만 되면 충분하므로 대체한다.
jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: mockState.role },
  }),
}));

// ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 → 평범한 함수로 둔다.
jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: mockState.doc }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }, { name: '라인2' }, { name: '라인3' }, { name: '라인4' }]) },
  formOptionsAPI: {
    getProcesses: (line: string) => Promise.resolve(mockState.optionsFor(line)),
    getProducts: (line: string) => Promise.resolve(mockState.optionsFor(line)),
    getProcessId: (line: string) => Promise.resolve(mockState.optionsFor(line)),
    getLayerIds: () => Promise.resolve(['10', '20', 'L01', 'L02']),
    getMapNames: (line: string) => Promise.resolve(mockState.optionsFor(line)),
    getMapInfo: () => Promise.resolve({ AAA1: null, AAA2: null, AAA3: null }),
    getJobFileLayer: () => Promise.resolve([]),
    getOvlLayer: () => Promise.resolve([]),
    getBbExternalData: () => Promise.resolve([]),
    getBarcodeCandidates: () => Promise.resolve([]),
  },
  uploadImageAPI: { upload: () => Promise.resolve({}) },
  guidesAPI: { list: () => Promise.resolve({ data: { results: [], count: 0 } }) },
  usersAPI: { list: () => Promise.resolve({ data: [] }) },
  addressBooksAPI: { list: () => Promise.resolve([]) },
  userGroupsAPI: { list: () => Promise.resolve([]) },
  layerSdExceptionsAPI: {
    list: (table: 'J' | 'O') => Promise.resolve(mockState.exceptions[table]),
    create: (input: { table: 'J' | 'O' }) => {
      mockState.created.push(input);
      const created = { id: 900 + mockState.created.length, created_by: 'x', created_by_name: '등록자', created_at: '', ...input };
      mockState.exceptions[input.table] = [created, ...mockState.exceptions[input.table]];
      return Promise.resolve(created);
    },
    delete: (id: number) => {
      (['J', 'O'] as const).forEach((t) => { mockState.exceptions[t] = (mockState.exceptions[t] as { id: number }[]).filter((e) => e.id !== id); });
      return Promise.resolve();
    },
  },
}));

// ---- 픽스처: 모든 detail 항목을 기본값과 다른 값으로 채운 문서 ----
const LINE = '라인1';
const PROCESS = 'RECIPE_A';
const PRODUCT = 'PART_1000';
const PROCESS_ID = 'PROC_X1';
const SRC_LINE = '라인2';
const SRC_PARTID = 'SRC_PART_9';
const BB_LOCATION = '라인3';
const BB_PRODUCT = 'BB제품1';
const BB_PROCESS_ID = 'BB_R1';
const FLOW_LOCATION = '라인4';
const FLOW_PRODUCT = 'FLOW제품1';
const FLOW_PROCESS_ID = 'FLOW_R1';

const fixtureDetail = {
  request_purpose: '차용',
  line: LINE,
  process_selection: PROCESS,
  partid_selection: PRODUCT,
  process_id: PROCESS_ID,
  customer_name: '고객사A',
  customer_requirement: '요구사항 텍스트',
  other_purpose: ['Layer 추가/삭제'],
  source_line: SRC_LINE,
  source_partid: SRC_PARTID,
  change_purpose_note: '<p>특이사항 메모</p>',
  flow_chart: [{ id: 'flow1', location: FLOW_LOCATION, product_name: FLOW_PRODUCT, process_id: FLOW_PROCESS_ID, step_from: '10', step_to: '20' }],
  map_type: 'CLONE',
  map_change: '변경 있음',
  map_value_x: '1.5',
  map_value_y: '-2.5',
  map_reason: '지도편차 사유',
  map_change_reason: '<p>MAP 변경 이유</p>',
  map_change_top: '변경 있음',
  map_value_x_top: '3.1',
  map_value_y_top: '3.2',
  map_change_bottom: '변경 있음',
  map_value_x_bottom: '4.1',
  map_value_y_bottom: '4.2',
  ea_change: '변경 있음',
  ea_value: 'EA-42',
  bb_zone: '존재',
  bb_entries: [{ id: 'bbe1', location: BB_LOCATION, product: BB_PRODUCT, process_id: BB_PROCESS_ID }],
  only_prodc: 'Yes',
  py_apply: '적용',
  mshot_change_cc: '적용',
  prodc_scope: 'top',
  prodc_top_line: LINE,
  prodc_top_process: PROCESS,
  prodc_top_product: PRODUCT,
  prodc_middle_use: 'Yes',
  prodc_middle_line: LINE,
  prodc_middle_process: PROCESS,
  prodc_middle_product: PRODUCT,
  prodc_bottom_line: LINE,
  prodc_bottom_process: PROCESS,
  prodc_bottom_product: PRODUCT,
  mshot_change: '추가',
  mshot_image_copy: 'https://example.com/img.png',
  mshot_image_copy_top: 'https://example.com/top.png',
  mshot_image_copy_bottom: 'https://example.com/bottom.png',
  photo_backside: '적용',
  eds_backside: '적용',
  inter: 'YES',
  inter_xs: '적용',
  inter_ys: '적용',
  in_apply: '적용값',
  inter_select: '선택값',
  tsv: '적용',
  rf: '적용',
  fullchip: '적용',
  split: '적용',
  st: '적용',
  ecc: '적용',
  labelsideshot: '적용',
  hpkglabelheight: '적용',
  final_yn: 'YES',
  final_entries: ['v1.2'],
  partial_shot: '계측 필요',
  tbvtlv_thickness: '12.5',
  tbvtlv_entries: [{ sds: ['TBV_SD'], noteRows: [{ id: 'n1', x: '1', y: '2', used: 'O' }] }],
  notifiers: [{ loginid: 'noti1', name: '통보자1' }],
  post_approvers: [{ loginid: 'pa1', name: '후결자1' }],
  // 판정 키워드(PLEL)가 있는 문서에서 상신자가 직접 '비대상'을 고른 상태.
  // (키워드가 없으면 규칙상 'NA' 가 되는 것이 정상이므로 픽스처를 규칙에 맞춘다)
  validation_system: 'NO',
  merge_ref_doc_id: 77,
  merge_ref_doc_label: '참조 요청서 제목',
  merge_ref_mode: 'ref',
  merge_applied: true,
  // 행 id·판정은 표를 직접 편집하기 위해 필요한 값이라 왕복에서 유지돼야 한다
  // (id 가 없는 구버전 문서는 로드 시 백필되므로 여기서는 신규 형태를 그대로 쓴다).
  merge_pairs: [{
    id: 'pair_J_b1__J_a1',
    table: 'J',
    beforeId: 'J_b1',
    before: { id: 'J_b1', table: 'jayer', process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01' },
    afterId: 'J_a1',
    after: { id: 'J_a1', table: 'jayer', process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02' },
    kind: 'changed',
  }],
  merge_unmatched_before: [],
  merge_unmatched_after: [],
  adi_cd_before: [{ id: 'adi1', step_id: 'S1', step_desc: 'D1' }],
  adi_cd_after: [{ id: 'adi2', step_id: 'S2', step_desc: 'D2' }],
};

const fixtureNotes = {
  detail: fixtureDetail,
  jayerRows: [],
  oayerRows: [],
  bbRows: [],
  history: [],
};

const fixtureDoc = {
  id: 1,
  status: 'draft',
  title: '기존 제목',
  requester_name: '원작성자',
  requester_email: 'orig@example.com',
  requester_department: '원부서',
  product_name: PRODUCT,
  production_date: '2026-09-01',
  reference_materials: '',
  additional_notes: JSON.stringify(fixtureNotes),
  approval_steps: [],
};

beforeAll(async () => {
  await i18n.changeLanguage('ko');
  // 검증 실패 시 첫 오류 필드로 스크롤하는 코드가 jsdom 에는 없는 API 를 쓴다.
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
});

const optionsFor = (): string[] => [PROCESS, PRODUCT, PROCESS_ID, BB_PRODUCT, BB_PROCESS_ID];

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const buttonWith = (c: HTMLElement | Document, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

/** 편집 모드로 띄운 뒤 '다음'을 눌러 table 셀렉터가 나타나는 단계까지 이동한다. */
async function renderAtStep(tableSelector: string) {
  mockState.captured = null;
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flush();
  for (let i = 0; i < 4 && !view.container.querySelector(tableSelector); i += 1) {
    const next = buttonWith(view.container, '다음');
    if (!next) throw new Error('다음 버튼을 찾지 못했다');
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { next.click(); });
    // eslint-disable-next-line no-await-in-loop
    await flush(5);
  }
  if (!view.container.querySelector(tableSelector)) {
    const errs = Array.from(view.container.querySelectorAll('.form-error')).map((e) => `${e.closest('.form-group')?.querySelector('label')?.textContent}: ${e.textContent}`).join(' | ');
    throw new Error(`${tableSelector} 단계로 이동하지 못했다 — ${errs}`);
  }
  return view;
}


const PROCESS_ID_FX = PROCESS_ID;
const J_MISMATCH = { id: 'j1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID_FX, sp: 'SP01', sd: '1000.123 월평동 지점', pp: 'PLEL01', layerid: '2000', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10', item_id: 'ITEM_1' };
const J_MATCH = { ...J_MISMATCH, layerid: '1000.123' };
const O_MISMATCH = { id: 'o1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID_FX, sp: 'SP01', sd: '1000.123 월평동 지점', pp: 'PP01', layerid: '2000', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10' };
const O_MATCH = { ...O_MISMATCH, layerid: '1000.123' };

const J_EXCEPTION = { id: 1, table: 'J', process_id: PROCESS_ID_FX, sp: 'SP01', sd: '1000.123 월평동 지점', sd_number: '1000.123', layerid: '2000', created_by: 'tej', created_by_name: 'TE_J 담당', created_at: '' };

const setDoc = (jayerRows: unknown[], oayerRows: unknown[]) => {
  mockState.doc = { ...fixtureDoc, additional_notes: JSON.stringify({ ...fixtureNotes, jayerRows, oayerRows, bbRows: [] }) };
};

const J_TABLE = '[data-tour="jayer-table"]';
const O_TABLE = '[data-tour="oayer-table"]';
const MISMATCH_TOAST_J = 'J-layer 1개 행의 SD 첫 숫자가 Layer 와 일치하지 않습니다';
const MISMATCH_TOAST_O = 'O-layer 1개 행의 SD 첫 숫자가 Layer 와 일치하지 않습니다';

const clickNext = async (c: HTMLElement) => {
  await act(async () => { buttonWith(c, '다음')!.click(); });
  await flush(5);
};
const cellInputs = (c: HTMLElement, tableSelector: string) =>
  Array.from(c.querySelector(tableSelector)!.querySelectorAll('input.field-error-target')) as HTMLInputElement[];

beforeEach(() => {
  mockState.role = 'PL';
  mockState.exceptions = { J: [], O: [] };
  mockState.created = [];
  mockState.optionsFor = optionsFor;
  mockState.captured = null;
  localStorage.clear();
});

describe('J-layer SD 첫 숫자 ↔ Layer 검증', () => {
  it('SD 첫 숫자와 Layer 가 다르면 다음으로 못 넘어가고 SD·Layer 셀이 오류로 표시된다', async () => {
    setDoc([J_MISMATCH], [O_MATCH]);
    const { container } = await renderAtStep(J_TABLE);
    await clickNext(container);
    expect(container.querySelector(J_TABLE)).not.toBeNull();
    expect(container.querySelector(O_TABLE)).toBeNull();
    expect(screen.getByText(new RegExp(MISMATCH_TOAST_J))).toBeDefined();
    const flagged = cellInputs(container, J_TABLE);
    expect(flagged.map((i) => i.value)).toEqual(['1000.123 월평동 지점', '2000']);
    expect(flagged[0].title).toBe('SD 첫 숫자 1000.123 ≠ Layer 2000');
  });

  it('SD 첫 숫자와 Layer 가 같으면 통과한다', async () => {
    setDoc([J_MATCH], [O_MATCH]);
    const { container } = await renderAtStep(J_TABLE);
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).not.toBeNull();
  });

  it('SD 가 숫자로 시작하지 않으면(기존 값 SD01 등) 비교 대상이 아니라 통과한다', async () => {
    setDoc([{ ...J_MISMATCH, sd: 'SD01', layerid: 'L01' }], [O_MATCH]);
    const { container } = await renderAtStep(J_TABLE);
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).not.toBeNull();
  });

  it('등록된 J 예외(process_id·sp·SD 첫 숫자·layerid 일치)가 있으면 통과한다', async () => {
    mockState.exceptions.J = [J_EXCEPTION];
    setDoc([J_MISMATCH], [O_MATCH]);
    const { container } = await renderAtStep(J_TABLE);
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).not.toBeNull();
  });

  it('예외의 sp 가 다르면 통과하지 못한다', async () => {
    mockState.exceptions.J = [{ ...J_EXCEPTION, sp: 'SP99' }];
    setDoc([J_MISMATCH], [O_MATCH]);
    const { container } = await renderAtStep(J_TABLE);
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).toBeNull();
  });

  it('숫자는 값으로 비교한다 — SD 100.930 과 Layer 100.93 은 같은 값이라 통과한다', async () => {
    setDoc([{ ...J_MISMATCH, sd: '100.930 월평동', layerid: '100.93' }], [O_MATCH]);
    const { container } = await renderAtStep(J_TABLE);
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).not.toBeNull();
  });

  it('비활성(st=X) 행은 검사하지 않는다', async () => {
    setDoc([J_MATCH, { ...J_MISMATCH, id: 'j2', loaded: false, st: 'X', new_or_copy: '신규' }], [O_MATCH]);
    const { container } = await renderAtStep(J_TABLE);
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).not.toBeNull();
  });
});

describe('O-layer SD 첫 숫자 ↔ Layer 검증', () => {
  it('O-layer 불일치도 STEP4 에서 막고, J 예외는 O 에 적용되지 않는다', async () => {
    mockState.exceptions.J = [J_EXCEPTION];
    setDoc([J_MATCH], [O_MISMATCH]);
    const { container } = await renderAtStep(O_TABLE);
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).not.toBeNull();
    expect(screen.getByText(new RegExp(MISMATCH_TOAST_O))).toBeDefined();
    expect(cellInputs(container, O_TABLE).map((i) => i.value)).toEqual(['1000.123 월평동 지점', '2000']);
  });
});

describe('작성 화면에는 예외 관리 버튼이 없다(홈으로 이동)', () => {
  it.each(['TE_J', 'TE_O', 'TE_P', 'MASTER'])('%s: STEP3·STEP4 모두 버튼 없음', async (role) => {
    mockState.role = role;
    setDoc([J_MATCH], [O_MATCH]);
    const { container } = await renderAtStep(J_TABLE);
    expect(container.querySelector('[data-testid="sd-exc-open-btn"]')).toBeNull();
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).not.toBeNull();
    expect(container.querySelector('[data-testid="sd-exc-open-btn"]')).toBeNull();
  });
});
