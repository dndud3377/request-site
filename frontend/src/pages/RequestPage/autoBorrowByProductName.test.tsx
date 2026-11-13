/**
 * claude 수정 (2026-11-12): J/O-ayer 제품 이름이 STEP1 제품 이름과 다르면 요청 기준 '차용' 자동 변경.
 *
 * - STEP3/STEP4 에서 '다음'을 누르면 ST O 계열·제품 이름이 STEP1 과 다른(공백·대소문자 무시) 행의 요청 기준이 '차용'으로
 *   바뀌고, 그 칸이 강조(data-auto-borrow)되며 경고 토스트가 뜨고 그 단계에 머문다.
 * - 다시 '다음'을 누르면 진행한다(STEP4→5 는 기존 요청 목적 확인 모달로 이어진다).
 * - 사용자가 '신규'로 되돌려도 다음 '다음'에서 다시 '차용'으로 바뀐다(잠금 없음).
 * 하네스(mock·픽스처·이동/저장 헬퍼)는 spAutoSort.test.tsx 와 같다.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { MERGE_PP_PREFIXES } from './constants';

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
    // claude 수정 (2026-10-15): Step 목록 API 응답이 {layerid, stepseq} 목록으로 바뀌었다.
    getLayerIds: () => Promise.resolve(['10', '20', 'L01', 'L02'].map((layerid, i) => ({ layerid, stepseq: `S${i + 1}` }))),
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
  other_purpose: ['FirstA 변경'],
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
  // claude 수정 (2026-10-19): 참조 요청서 '있음' 잠금 — STEP1 을 통과하도록 '없음' 규칙에 맞는 변경전/변경후 1건을 둔다
  // (변경전만 있는 layer 삭제 행: PP 는 J 접두사, 값은 현재 J 표에 없음).
  merge_ref_doc_id: null,
  merge_ref_doc_label: '',
  merge_ref_mode: 'none',
  merge_applied: true,
  merge_pairs: [{
    id: 'pair_manual_1',
    table: 'J',
    beforeId: null,
    before: { process_id: PROCESS_ID, sp: 'SP09', sd: 'SD09', pp: `${MERGE_PP_PREFIXES.J[0]}_09`, layerid: '' },
    afterId: null,
    after: null,
    kind: 'deleted',
  }],
  merge_unmatched_before: [],
  merge_unmatched_after: [],
  adi_cd_before: [{ id: 'adi1', step_id: 'S1', step_desc: 'D1' }],
  adi_cd_after: [{ id: 'adi2', step_id: 'S2', step_desc: 'D2' }],
};

beforeAll(async () => {
  await i18n.changeLanguage('ko');
  // 검증 실패 시 첫 오류 필드로 스크롤하는 코드가 jsdom 에는 없는 API 를 쓴다.
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
});

// claude 수정 (2026-10-15): 흐름도 제품 이름·조리법도 목록 검증 대상이 되어 픽스처 흐름도 값을 옵션 목록에 포함한다.
const optionsFor = (): string[] => [PROCESS, PRODUCT, PROCESS_ID, BB_PRODUCT, BB_PROCESS_ID, FLOW_PRODUCT, FLOW_PROCESS_ID];

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const buttonWith = (c: HTMLElement | Document, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

const J_TABLE = '[data-tour="jayer-table"]';
const O_TABLE = '[data-tour="oayer-table"]';

const toastsOf = (kind: string) =>
  Array.from(document.querySelectorAll(`.toast-${kind}`)).map((el) => el.textContent ?? '').join('\n');
const rowOf = (c: HTMLElement, tableSelector: string, sp: string) =>
  Array.from(c.querySelector(tableSelector)!.querySelectorAll('tbody tr'))
    .find((tr) => Array.from(tr.querySelectorAll('input')).some((i) => (i as HTMLInputElement).value === sp)) as HTMLTableRowElement;
/** 열 순서: No·갱신일·process_id·SP·SD·layer·PP·ST·요청 기준 … */
const nocInputOf = (tr: HTMLTableRowElement) => tr.querySelectorAll('td')[8].querySelector('input') as HTMLInputElement;
const setValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => { fireEvent.change(input, { target: { value } }); });
  await flush(3);
};

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
    throw new Error(`${tableSelector} 단계로 이동하지 못했다 — ${errs} / ${toastsOf('error')}`);
  }
  return view;
}

type SavedRow = { id: string; st: string; new_or_copy: string; product_name: string; step: string; item_id?: string };
async function saveDraftAndCapture(): Promise<{ jayerRows: SavedRow[]; oayerRows: SavedRow[]; bbRows: { id: string; sourceJayerRowId?: string }[] }> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { saveBtn.click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  return JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
}


// j1·o1: STEP1 과 같은 제품 이름(대소문자·공백만 다름) → 그대로 '신규'.
// j2·o2: 다른 제품 이름 → '차용'으로 자동 변경 대상. (J 차용 행은 ID 필수라 item_id 를 채워 둔다)
// j3·o3: ST X 행 → 대상 아님.
const J_ROWS = [
  { id: 'j1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PLEL01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: ' part_1000 ', step: '10', item_id: 'ITEM_1' },
  { id: 'j2', updated: '', sortOrder: 2, process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'O', new_or_copy: '신규', product_name: '제품B', step: '20', item_id: 'ITEM_2' },
  { id: 'j3', updated: '', sortOrder: 3, process_id: PROCESS_ID, sp: 'SP03', sd: 'SD03', pp: 'PP03', layerid: 'L03', st: 'X', new_or_copy: '미진행', product_name: '', step: '', item_id: '' },
];
const O_ROWS = [
  { id: 'o1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'TBV_SD', pp: 'PP01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: 'PART_1000', step: '10' },
  { id: 'o2', updated: '', sortOrder: 2, process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'O', new_or_copy: '신규', product_name: '제품C', step: '20' },
  { id: 'o3', updated: '', sortOrder: 3, process_id: PROCESS_ID, sp: 'SP03', sd: 'SD03', pp: 'PP03', layerid: 'L03', st: 'X', new_or_copy: '미진행', product_name: '', step: '' },
];
const BB_ROWS = [
  { id: 'b1', sortOrder: 1, disabled: false, entryId: 'bbe1', sourceJayerRowId: 'j1', process_id: PROCESS_ID, ss: 'SP01', sd: 'SD01', bb_process_id: BB_PROCESS_ID, bb_name: `[${BB_LOCATION}] ${BB_PRODUCT}`, bb_layer: 'L01', bb_ss: '110', bb_step: 'STEP', remark: '' },
  { id: 'b2', sortOrder: 2, disabled: false, entryId: 'bbe1', sourceJayerRowId: 'j2', process_id: PROCESS_ID, ss: 'SP02', sd: 'SD02', bb_process_id: BB_PROCESS_ID, bb_name: `[${BB_LOCATION}] ${BB_PRODUCT}`, bb_layer: 'L02', bb_ss: '120', bb_step: 'STEP', remark: '' },
];

const makeDoc = () => ({
  id: 1,
  status: 'draft',
  title: '기존 제목',
  requester_name: '원작성자',
  requester_email: 'orig@example.com',
  requester_department: '원부서',
  product_name: PRODUCT,
  production_date: '2026-09-01',
  reference_materials: '',
  // 행이 모두 '신규'라 요청 목적도 '신규'로 둔다 — 자동 변경 뒤 STEP4→5 에서 '신규+차용' 확인 모달이 떠야 한다.
  additional_notes: JSON.stringify({ detail: { ...fixtureDetail, request_purpose: '신규' }, jayerRows: J_ROWS, oayerRows: O_ROWS, bbRows: BB_ROWS, history: [] }),
  approval_steps: [],
});

const clickButton = async (text: string) => {
  const btn = buttonWith(document, text);
  if (!btn) throw new Error(`"${text}" 버튼을 찾지 못했다`);
  await act(async () => { btn.click(); });
  await flush(5);
};
const nocTdOf = (tr: HTMLTableRowElement) => tr.querySelectorAll('td')[8] as HTMLTableCellElement;

describe("J/O 제품 이름 ≠ STEP1 제품 이름 → 요청 기준 '차용' 자동 변경", () => {
  beforeEach(() => {
    mockState.doc = makeDoc();
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    localStorage.clear();
  });

  it("STEP3 첫 '다음'에서 다른 제품 이름 행만 '차용'으로 바꾸고 강조한 뒤 머물고, 다시 '다음'을 누르면 STEP4 로 간다", async () => {
    const { container } = await renderAtStep(J_TABLE);
    await clickButton('다음');

    expect(container.querySelector(J_TABLE)).not.toBeNull();
    expect(container.querySelector(O_TABLE)).toBeNull();
    const j1 = rowOf(container, J_TABLE, 'SP01');
    const j2 = rowOf(container, J_TABLE, 'SP02');
    const j3 = rowOf(container, J_TABLE, 'SP03');
    expect(nocInputOf(j1).value).toBe('신규');
    expect(nocInputOf(j2).value).toBe('차용');
    expect(nocInputOf(j3).value).toBe('미진행');
    expect(nocTdOf(j2).getAttribute('data-auto-borrow')).toBe('true');
    expect(nocTdOf(j1).getAttribute('data-auto-borrow')).toBeNull();
    expect(toastsOf('warning')).toContain("요청 기준을 '차용'으로 변경했습니다");

    await clickButton('다음');
    expect(container.querySelector(O_TABLE)).not.toBeNull();
    const saved = await saveDraftAndCapture();
    expect(saved.jayerRows.map((r) => [r.id, r.new_or_copy])).toEqual([['j1', '신규'], ['j2', '차용'], ['j3', '미진행']]);
  });

  it("'신규'로 되돌리면 강조가 사라지고, 다음 '다음'에서 다시 '차용'으로 바뀐다", async () => {
    const { container } = await renderAtStep(J_TABLE);
    await clickButton('다음');
    const j2 = rowOf(container, J_TABLE, 'SP02');
    await setValue(nocInputOf(j2), '신규');
    expect(nocInputOf(rowOf(container, J_TABLE, 'SP02')).value).toBe('신규');
    expect(nocTdOf(rowOf(container, J_TABLE, 'SP02')).getAttribute('data-auto-borrow')).toBeNull();

    await clickButton('다음');
    expect(container.querySelector(O_TABLE)).toBeNull();
    expect(nocInputOf(rowOf(container, J_TABLE, 'SP02')).value).toBe('차용');
    expect(nocTdOf(rowOf(container, J_TABLE, 'SP02')).getAttribute('data-auto-borrow')).toBe('true');
  });

  it("STEP4 도 같다 — 첫 '다음'에서 O 행을 '차용'으로 바꾸고 머물고, 다시 '다음'을 누르면 요청 목적 '신규+차용' 확인 모달이 뜬다", async () => {
    const { container } = await renderAtStep(O_TABLE);
    await clickButton('다음');
    expect(container.querySelector(O_TABLE)).not.toBeNull();
    const o1 = rowOf(container, O_TABLE, 'SP01');
    const o2 = rowOf(container, O_TABLE, 'SP02');
    expect(nocInputOf(o1).value).toBe('신규');
    expect(nocInputOf(o2).value).toBe('차용');
    expect(nocTdOf(o2).getAttribute('data-auto-borrow')).toBe('true');
    expect(screen.queryByText(/요청 목적을 '신규\+차용'/)).toBeNull();

    await clickButton('다음');
    expect(screen.getByText(/요청 목적을 '신규\+차용'/)).toBeDefined();
  });

  it('제품 이름이 STEP1 과 다른 행이 없으면 STEP3 에서 바로 넘어간다', async () => {
    mockState.doc = {
      ...makeDoc(),
      additional_notes: JSON.stringify({
        detail: { ...fixtureDetail, request_purpose: '신규' },
        jayerRows: J_ROWS.map((r) => (r.id === 'j2' ? { ...r, product_name: 'PART_1000' } : r)),
        oayerRows: O_ROWS,
        bbRows: BB_ROWS,
        history: [],
      }),
    };
    const { container } = await renderAtStep(J_TABLE);
    await clickButton('다음');
    expect(container.querySelector(O_TABLE)).not.toBeNull();
    expect(toastsOf('warning')).not.toContain("'차용'으로 변경했습니다");
  });
});
