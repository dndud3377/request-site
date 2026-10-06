/**
 * J-layer / O-layer 수동 추가 행 삭제 테스트.
 *
 * 규칙: '+ 행 추가'로 만든 행(loaded 아님)에만 ✕ 삭제 버튼이 있다. 불러온(loaded) 행에는 없다.
 * 값이 입력된 행은 확인 모달을 거치고, 빈 행은 즉시 삭제된다. 매핑된 J 행을 지우면 bb 매핑도 풀린다.
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
} = { captured: null, doc: null, optionsFor: () => [] };

// RichTextEditor 는 tiptap(ESM) 을 끌어와 jest 가 파싱하지 못한다. 값 전달만 되면 충분하므로 대체한다.
jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
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
  layerSdExceptionsAPI: { list: () => Promise.resolve([]) },
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

const LOADED_J = { id: 'j1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PLEL01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10', item_id: 'ITEM_1' };
const MANUAL_J_FILLED = { id: 'j2', updated: '', sortOrder: 2, process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'O', new_or_copy: '신규', product_name: '제품B', step: '20', item_id: '' };
const MANUAL_J_EMPTY = { id: 'j3', updated: '', sortOrder: 3, process_id: '', sp: '', sd: '', pp: '', layerid: '', st: '', new_or_copy: '', product_name: '', step: '', item_id: '' };
const fixtureJayerRows = [LOADED_J, MANUAL_J_FILLED, MANUAL_J_EMPTY];

const LOADED_O = { id: 'o1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'TBV_SD', pp: 'PP01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10' };
const MANUAL_O_FILLED = { id: 'o2', updated: '', sortOrder: 2, process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'O', new_or_copy: '신규', product_name: '제품B', step: '20' };
const MANUAL_O_EMPTY = { id: 'o3', updated: '', sortOrder: 3, process_id: '', sp: '', sd: '', pp: '', layerid: '', st: '', new_or_copy: '', product_name: '', step: '' };
const fixtureOayerRows = [LOADED_O, MANUAL_O_FILLED, MANUAL_O_EMPTY];
// 수동 행 j2 가 bb 에 매핑돼 있다(삭제 시 매핑이 함께 풀려야 한다).
const fixtureBbRows = [
  { id: 'b1', sortOrder: 1, disabled: false, entryId: 'bbe1', sourceJayerRowId: 'j1', process_id: PROCESS_ID, ss: 'SP01', sd: 'SD01', bb_process_id: BB_PROCESS_ID, bb_name: `[${BB_LOCATION}] ${BB_PRODUCT}`, bb_layer: 'L01', bb_ss: '110', bb_step: 'STEP', remark: '' },
  { id: 'b2', sortOrder: 2, disabled: false, entryId: 'bbe1', sourceJayerRowId: 'j2', process_id: PROCESS_ID, ss: 'SP02', sd: 'SD02', bb_process_id: BB_PROCESS_ID, bb_name: `[${BB_LOCATION}] ${BB_PRODUCT}`, bb_layer: 'L02', bb_ss: '120', bb_step: 'STEP', remark: '' },
];

const fixtureNotes = {
  detail: fixtureDetail,
  jayerRows: fixtureJayerRows,
  oayerRows: fixtureOayerRows,
  bbRows: fixtureBbRows,
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

const removeButtons = (c: HTMLElement, tableSelector: string) =>
  Array.from(c.querySelector(tableSelector)!.querySelectorAll('button.adi-cd-row-remove')) as HTMLButtonElement[];

async function saveDraftAndCapture(): Promise<{ jayerRows: { id: string }[]; oayerRows: { id: string }[]; bbRows: { id: string; sourceJayerRowId?: string }[] }> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { saveBtn.click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  return JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
}

const J_TABLE = '[data-tour="jayer-table"]';
const O_TABLE = '[data-tour="oayer-table"]';

describe('J-layer 수동 추가 행 삭제', () => {
  beforeEach(() => {
    mockState.doc = fixtureDoc;
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    localStorage.clear();
  });

  it('수동 행에만 ✕ 버튼이 있고 불러온 행에는 없다', async () => {
    const { container } = await renderAtStep(J_TABLE);
    const rows = Array.from(container.querySelector(J_TABLE)!.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('button.adi-cd-row-remove')).toBeNull();
    expect(rows[1].querySelector('button.adi-cd-row-remove')).not.toBeNull();
    expect(rows[2].querySelector('button.adi-cd-row-remove')).not.toBeNull();
  });

  it('값이 없는 수동 행은 확인 없이 즉시 삭제된다', async () => {
    const { container } = await renderAtStep(J_TABLE);
    await act(async () => { removeButtons(container, J_TABLE)[1].click(); });
    expect(screen.queryByText('입력한 값이 있는 행입니다. 삭제하시겠습니까?')).toBeNull();
    const saved = await saveDraftAndCapture();
    expect(saved.jayerRows.map((r) => r.id)).toEqual(['j1', 'j2']);
  });

  it('값이 있는 수동 행은 확인 모달을 거친다 — 취소하면 유지, 확인하면 삭제', async () => {
    const { container } = await renderAtStep(J_TABLE);
    await act(async () => { removeButtons(container, J_TABLE)[0].click(); });
    expect(screen.getByText('입력한 값이 있는 행입니다. 삭제하시겠습니까?')).toBeDefined();

    await act(async () => { buttonWith(document, '취소')!.click(); });
    expect(screen.queryByText('입력한 값이 있는 행입니다. 삭제하시겠습니까?')).toBeNull();
    expect(container.querySelector(J_TABLE)!.querySelectorAll('tbody tr')).toHaveLength(3);

    await act(async () => { removeButtons(container, J_TABLE)[0].click(); });
    await act(async () => { buttonWith(document, '확인')!.click(); });
    const saved = await saveDraftAndCapture();
    expect(saved.jayerRows.map((r) => r.id)).toEqual(['j1', 'j3']);
  });

  it('bb 에 매핑된 수동 행을 삭제하면 그 매핑(bb 행)도 함께 제거된다', async () => {
    const { container } = await renderAtStep(J_TABLE);
    await act(async () => { removeButtons(container, J_TABLE)[0].click(); });
    await act(async () => { buttonWith(document, '확인')!.click(); });
    const saved = await saveDraftAndCapture();
    expect(saved.bbRows.map((r) => r.id)).toEqual(['b1']);
    expect(saved.bbRows.some((r) => r.sourceJayerRowId === 'j2')).toBe(false);
  });
});

describe('O-layer 수동 추가 행 삭제', () => {
  beforeEach(() => {
    // J-layer 의 빈 수동 행(j3)은 'ST/신규·차용 미입력' 검증에 걸려 O-layer 단계로 넘어갈 수 없다 → J 는 완성된 행만 둔다.
    mockState.doc = {
      ...fixtureDoc,
      additional_notes: JSON.stringify({ ...fixtureNotes, jayerRows: [LOADED_J, MANUAL_J_FILLED], bbRows: [] }),
    };
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    localStorage.clear();
  });

  it('수동 행에만 ✕ 버튼이 있고 불러온 행에는 없다', async () => {
    const { container } = await renderAtStep(O_TABLE);
    const rows = Array.from(container.querySelector(O_TABLE)!.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('button.adi-cd-row-remove')).toBeNull();
    expect(rows[1].querySelector('button.adi-cd-row-remove')).not.toBeNull();
    expect(rows[2].querySelector('button.adi-cd-row-remove')).not.toBeNull();
  });

  it('빈 행은 즉시, 값이 있는 행은 확인 후 삭제된다', async () => {
    const { container } = await renderAtStep(O_TABLE);
    await act(async () => { removeButtons(container, O_TABLE)[1].click(); });
    expect(screen.queryByText('입력한 값이 있는 행입니다. 삭제하시겠습니까?')).toBeNull();
    await act(async () => { removeButtons(container, O_TABLE)[0].click(); });
    expect(screen.getByText('입력한 값이 있는 행입니다. 삭제하시겠습니까?')).toBeDefined();
    await act(async () => { buttonWith(document, '확인')!.click(); });
    const saved = await saveDraftAndCapture();
    expect(saved.oayerRows.map((r) => r.id)).toEqual(['o1']);
  });
});
