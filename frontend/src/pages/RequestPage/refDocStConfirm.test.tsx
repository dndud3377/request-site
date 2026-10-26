/**
 * 참조 요청서 '없음' 변경전/변경후 표 확정 → J/O 표 st 결정·잠금 테스트.
 *
 * claude 수정 (2026-10-20):
 * - '확정'(표 아래 버튼 또는 STEP1 '다음' 시 확정 모달)을 누르는 순간 변경후 값과 4값이 같은 J/O 행은 st='O',
 *   나머지 J/O 행은 st='X'(요청 기준·제품 이름·STEP·ITEM_ID 초기화, bb 매핑 해제)가 된다.
 * - 확정하면 표는 '변경'을 누르기 전까지 읽기 전용이다. 미확정이면 STEP1 '다음'에서 확정 모달이 뜬다.
 * - 표가 켜져 있는 동안 J/O 표의 st 는 바꿀 수 없고, st 가 'O' 인 행의 요청 기준을 기등록/layer삭제/미진행으로 바꿀 수 없다.
 * - 확정 뒤 J/O 표가 바뀌어 st 가 확정 결과와 어긋나면 확정이 풀린다. 미확정이면 상신이 막히고 STEP1 로 돌아간다.
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
const J_PP = `${MERGE_PP_PREFIXES.J[0]}_02`;
const O_PP = `${MERGE_PP_PREFIXES.O[0]}_02`;

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
  // 변경후(추가) 행 2건 — J 는 수동 행 j2, O 는 수동 행 o2 와 4값이 같다. 확정하면 j2·o2 만 O, 나머지는 X 가 된다.
  merge_ref_doc_id: null,
  merge_ref_doc_label: '',
  merge_ref_mode: 'none',
  merge_applied: true,
  merge_pairs: [
    { id: 'pair_j', table: 'J', beforeId: null, before: null, afterId: null, after: { process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: J_PP, layerid: '' }, kind: 'added' },
    { id: 'pair_o', table: 'O', beforeId: null, before: null, afterId: null, after: { process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: O_PP, layerid: '' }, kind: 'added' },
  ],
  merge_unmatched_before: [],
  merge_unmatched_after: [],
  adi_cd_before: [{ id: 'adi1', step_id: 'S1', step_desc: 'D1' }],
  adi_cd_after: [{ id: 'adi2', step_id: 'S2', step_desc: 'D2' }],
};

const LOADED_J = { id: 'j1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PLEL01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10', item_id: 'ITEM_1' };
const MANUAL_J_FILLED = { id: 'j2', updated: '', sortOrder: 2, process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: J_PP, layerid: 'L02', st: 'O', new_or_copy: '신규', product_name: '제품B', step: '20', item_id: '' };
const fixtureJayerRows = [LOADED_J, MANUAL_J_FILLED];

const LOADED_O = { id: 'o1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'TBV_SD', pp: 'PP01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10' };
const MANUAL_O_FILLED = { id: 'o2', updated: '', sortOrder: 2, process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: O_PP, layerid: 'L02', st: 'O', new_or_copy: '신규', product_name: '제품B', step: '20' };
const fixtureOayerRows = [LOADED_O, MANUAL_O_FILLED];
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

async function renderLoaded(doc: unknown = fixtureDoc) {
  mockState.doc = doc;
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
  return view;
}

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('요소를 찾지 못했다');
  await act(async () => { el.click(); });
  await flush(5);
}

const onStep1 = () =>
  (document.querySelector('.form-section-title')?.textContent ?? '').includes(i18n.t('request.section_detail'));
const toastsOf = (kind: string) =>
  Array.from(document.querySelectorAll(`.toast-${kind}`)).map((el) => el.textContent ?? '').join('\n');
const modalButton = (text: string) =>
  Array.from(document.querySelectorAll('.modal-footer button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const panelButton = (text: string) =>
  Array.from(document.querySelectorAll('.ba-panel button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const resultInputs = () => Array.from(document.querySelectorAll('.ba-result-table input.ba-cell-input')) as HTMLInputElement[];

/** 확정 모달을 거쳐(필요하면) table 셀렉터가 나타나는 단계까지 '다음'으로 이동한다. */
async function goToTable(c: HTMLElement, tableSelector: string) {
  for (let i = 0; i < 4 && !c.querySelector(tableSelector); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await click(buttonWith(c, '다음'));
    const confirmBtn = modalButton(i18n.t('request.ba_confirm'));
    // eslint-disable-next-line no-await-in-loop
    if (confirmBtn) await click(confirmBtn);
  }
  if (!c.querySelector(tableSelector)) throw new Error(`${tableSelector} 단계로 이동하지 못했다 — ${toastsOf('error')}`);
}

const rowOf = (c: HTMLElement, tableSelector: string, sp: string) =>
  Array.from(c.querySelector(tableSelector)!.querySelectorAll('tbody tr'))
    .find((tr) => Array.from(tr.querySelectorAll('input')).some((i) => (i as HTMLInputElement).value === sp)) as HTMLTableRowElement;
/** J/O 표 한 행의 ST 칸 입력(열 순서: No·갱신일·process_id·SP·SD·layer·PP·ST …) */
const stInputOf = (tr: HTMLTableRowElement) => tr.querySelectorAll('td')[7].querySelector('input') as HTMLInputElement;
const nocInputOf = (tr: HTMLTableRowElement) => tr.querySelectorAll('td')[8].querySelector('input') as HTMLInputElement;

type SavedRow = { id: string; st: string; new_or_copy: string; product_name: string; step: string; item_id?: string };
async function saveDraftAndCapture(): Promise<{ detail: Record<string, unknown>; jayerRows: SavedRow[]; oayerRows: SavedRow[]; bbRows: { id: string; sourceJayerRowId?: string }[] }> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { saveBtn.click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  return JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
}

const J_TABLE = '[data-tour="jayer-table"]';
const O_TABLE = '[data-tour="oayer-table"]';

/**
 * 확정으로 X 가 된 행은 요청 기준이 비워지는데, 요청 기준은 X 행에도 필수라(findEmptyStNocViolations)
 * 다음 단계로 가려면 사용자가 다시 채워야 한다(현재 동작).
 */
async function fillNoc(c: HTMLElement, tableSelector: string, sp: string, value: string) {
  await act(async () => { fireEvent.change(nocInputOf(rowOf(c, tableSelector, sp)), { target: { value } }); });
  await flush(3);
}

describe("참조 요청서 '없음' 확정 → J/O 표 st 결정", () => {
  beforeEach(() => {
    mockState.doc = fixtureDoc;
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    localStorage.clear();
  });

  it("미확정이면 '다음'에서 확정 모달이 뜨고, 취소하면 STEP1 에 머물며 J/O st 는 그대로다", async () => {
    const { container } = await renderLoaded();
    await click(buttonWith(container, '다음'));
    expect(screen.getByText(i18n.t('request.ba_confirm_modal_msg'))).toBeDefined();
    await click(modalButton(i18n.t('common.cancel')));
    expect(onStep1()).toBe(true);
    const saved = await saveDraftAndCapture();
    expect(saved.detail.merge_confirmed).toBe(false);
    expect(saved.jayerRows.map((r) => r.st)).toEqual(['O', 'O']);
    expect(saved.oayerRows.map((r) => r.st)).toEqual(['O', 'O']);
  });

  it("모달에서 확정하면 변경후 값과 같은 행만 O, 나머지는 X(값 초기화·bb 매핑 해제)가 되고 다음 단계로 간다", async () => {
    const { container } = await renderLoaded();
    await click(buttonWith(container, '다음'));
    await click(modalButton(i18n.t('request.ba_confirm')));
    expect(onStep1()).toBe(false);
    expect(toastsOf('success')).toContain(i18n.t('request.toast_ba_confirmed'));

    const saved = await saveDraftAndCapture();
    expect(saved.detail.merge_confirmed).toBe(true);
    const j1 = saved.jayerRows.find((r) => r.id === 'j1')!;
    const j2 = saved.jayerRows.find((r) => r.id === 'j2')!;
    expect(j2.st).toBe('O');
    expect(j2.new_or_copy).toBe('신규');
    expect(j1).toMatchObject({ st: 'X', new_or_copy: '', product_name: '', step: '', item_id: '' });
    expect(saved.oayerRows.find((r) => r.id === 'o2')!.st).toBe('O');
    expect(saved.oayerRows.find((r) => r.id === 'o1')).toMatchObject({ st: 'X', new_or_copy: '', product_name: '', step: '' });
    // X 가 된 j1 의 bb 매핑은 풀리고, O 로 남은 j2 의 매핑은 유지된다.
    expect(saved.bbRows.map((b) => b.sourceJayerRowId)).toEqual(['j2']);
  });

  it("표의 '확정'을 누르면 표가 잠기고, '변경'을 누르면 다시 편집할 수 있으며 '다음'에서 다시 확정을 묻는다", async () => {
    const { container } = await renderLoaded();
    await click(panelButton(i18n.t('request.ba_confirm')));
    expect(screen.getByText(`ⓘ ${i18n.t('request.ba_confirmed_notice')}`)).toBeDefined();
    expect(resultInputs().every((i) => i.readOnly)).toBe(true);
    expect(panelButton(i18n.t('request.ba_add_row'))!.disabled).toBe(true);
    expect(panelButton(i18n.t('request.ba_confirm'))).toBeUndefined();

    await click(panelButton(i18n.t('request.ba_edit')));
    expect(resultInputs().some((i) => i.readOnly)).toBe(false);
    expect(panelButton(i18n.t('request.ba_add_row'))!.disabled).toBe(false);
    expect(panelButton(i18n.t('request.ba_confirm'))).toBeDefined();

    await click(buttonWith(container, '다음'));
    expect(screen.getByText(i18n.t('request.ba_confirm_modal_msg'))).toBeDefined();
  });

  it('표에 오류(변경후 값이 J 표에 없음)가 있으면 확정하지 않는다', async () => {
    const pairs = fixtureDetail.merge_pairs.map((p) => (p.id === 'pair_j' ? { ...p, after: { ...p.after!, pp: `${MERGE_PP_PREFIXES.J[0]}_NONE` } } : p));
    await renderLoaded({ ...fixtureDoc, additional_notes: JSON.stringify({ ...fixtureNotes, detail: { ...fixtureDetail, merge_pairs: pairs } }) });
    await click(panelButton(i18n.t('request.ba_confirm')));
    expect(toastsOf('error')).toContain(i18n.t('request.ba_gate_none_after_missing', { count: 1 }));
    expect(panelButton(i18n.t('request.ba_confirm'))).toBeDefined();
    const saved = await saveDraftAndCapture();
    expect(saved.detail.merge_confirmed).toBe(false);
    expect(saved.jayerRows.map((r) => r.st)).toEqual(['O', 'O']);
  });

  // claude 수정 (2026-10-20): 'O' 가 될 행의 기등록/layer삭제/미진행 요청 기준은 확정을 막지 않고 비운다(사용자 결정 — ST 무관).
  it.each([
    ['st 가 X 인 행(이전 확정으로 X)', 'X', '미진행'],
    ['st 가 O 인 행(예전 문서의 불일치 데이터)', 'O', '기등록'],
  ])('O 가 될 %s 의 요청 기준이 특수값이면 비우고 확정한다', async (_label, st, noc) => {
    const rows = fixtureJayerRows.map((r) => (r.id === 'j2' ? { ...r, new_or_copy: noc, st } : r));
    await renderLoaded({ ...fixtureDoc, additional_notes: JSON.stringify({ ...fixtureNotes, jayerRows: rows }) });
    await click(panelButton(i18n.t('request.ba_confirm')));
    expect(toastsOf('error')).not.toContain(i18n.t('request.ba_noc_special_conflict'));
    expect(toastsOf('success')).toContain(i18n.t('request.toast_ba_confirmed'));
    const saved = await saveDraftAndCapture();
    expect(saved.detail.merge_confirmed).toBe(true);
    expect(saved.jayerRows.find((r) => r.id === 'j2')).toMatchObject({ st: 'O', new_or_copy: '' });
  });

  it('확정 → X 행 요청 기준을 미진행으로 → STEP1 변경 → 그 행을 판정 추가로 넣고 재확정하면 O 가 되고 요청 기준이 비워진다', async () => {
    const j3 = { ...MANUAL_J_FILLED, id: 'j3', sortOrder: 3, sp: 'SP03', sd: 'SD03', pp: `${MERGE_PP_PREFIXES.J[0]}_03`, layerid: 'L03' };
    const { container } = await renderLoaded({
      ...fixtureDoc,
      additional_notes: JSON.stringify({ ...fixtureNotes, jayerRows: [...fixtureJayerRows, j3] }),
    });
    await goToTable(container, J_TABLE);
    expect(stInputOf(rowOf(container, J_TABLE, 'SP03')).value).toBe('X');
    await fillNoc(container, J_TABLE, 'SP03', '미진행');
    expect(nocInputOf(rowOf(container, J_TABLE, 'SP03')).value).toBe('미진행');

    for (let i = 0; i < 4 && !onStep1(); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await click(buttonWith(container, i18n.t('common.prev')));
    }
    expect(onStep1()).toBe(true);
    await click(panelButton(i18n.t('request.ba_edit')));
    await click(panelButton(i18n.t('request.ba_add_row')));
    const lastRow = Array.from(document.querySelectorAll('.ba-result-table tbody tr')).pop() as HTMLTableRowElement;
    await click(lastRow.querySelectorAll('.ba-cell-unreg')[1] as HTMLElement);
    const afterInputs = Array.from(lastRow.querySelectorAll('input.ba-cell-input')) as HTMLInputElement[];
    const values = [PROCESS_ID, 'SP03', 'SD03', j3.pp];
    for (let i = 0; i < values.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { fireEvent.change(afterInputs[i], { target: { value: values[i] } }); });
    }
    await act(async () => { fireEvent.blur(afterInputs[values.length - 1]); });
    await flush(5);

    await click(panelButton(i18n.t('request.ba_confirm')));
    expect(toastsOf('error')).not.toContain(i18n.t('request.ba_noc_special_conflict'));
    const saved = await saveDraftAndCapture();
    expect(saved.detail.merge_confirmed).toBe(true);
    expect(saved.jayerRows.find((r) => r.id === 'j3')).toMatchObject({ st: 'O', new_or_copy: '' });
    expect(saved.jayerRows.find((r) => r.id === 'j2')).toMatchObject({ st: 'O', new_or_copy: '신규' });
  });

  it('표가 켜져 있으면 J 표의 ST 칸·ST 일괄 버튼이 잠기고 툴팁이 달린다', async () => {
    const { container } = await renderLoaded();
    await goToTable(container, J_TABLE);
    const tr = rowOf(container, J_TABLE, 'SP02');
    expect(stInputOf(tr).disabled).toBe(true);
    expect(tr.querySelectorAll('td')[7].getAttribute('title')).toBe(i18n.t('request.st_locked_by_ref_doc'));
    const allX = buttonWith(container, i18n.t('request.btn_all_x'))!;
    expect(allX.disabled).toBe(true);
    expect(allX.closest('.wizard-table-toolbar-group')!.getAttribute('title')).toBe(i18n.t('request.st_locked_by_ref_doc'));
  });

  it('st 가 O 인 행의 요청 기준을 기등록으로 바꾸면 막고 오류 토스트를 띄운다(st 가 X 인 행은 허용)', async () => {
    const { container } = await renderLoaded();
    await goToTable(container, J_TABLE);
    await act(async () => { fireEvent.change(nocInputOf(rowOf(container, J_TABLE, 'SP02')), { target: { value: '기등록' } }); });
    await flush(3);
    expect(toastsOf('error')).toContain(i18n.t('request.ba_noc_special_conflict'));
    expect(nocInputOf(rowOf(container, J_TABLE, 'SP02')).value).toBe('신규');

    await act(async () => { fireEvent.change(nocInputOf(rowOf(container, J_TABLE, 'SP01')), { target: { value: '미진행' } }); });
    await flush(3);
    expect(nocInputOf(rowOf(container, J_TABLE, 'SP01')).value).toBe('미진행');
  });

  it('붙여넣기로도 ST 는 바뀌지 않고, st 가 O 인 행에 붙여넣은 기등록/layer삭제/미진행 요청 기준은 되돌린다', async () => {
    const { container } = await renderLoaded();
    await goToTable(container, J_TABLE);
    const table = container.querySelector(`${J_TABLE} table`) as HTMLTableElement;
    const pasteInto = async (tdIndex: number, text: string) => {
      const td = rowOf(container, J_TABLE, 'SP02').querySelectorAll('td')[tdIndex];
      await act(async () => { fireEvent.mouseDown(td); fireEvent.mouseUp(td); });
      await act(async () => { fireEvent.paste(table, { clipboardData: { getData: () => text } }); });
      await flush(3);
    };
    await pasteInto(7, 'X');
    expect(stInputOf(rowOf(container, J_TABLE, 'SP02')).value).toBe('O');

    await pasteInto(8, '기등록');
    expect(toastsOf('error')).toContain(i18n.t('request.ba_noc_special_conflict'));
    expect(nocInputOf(rowOf(container, J_TABLE, 'SP02')).value).toBe('신규');
    expect(stInputOf(rowOf(container, J_TABLE, 'SP02')).value).toBe('O');
  });

  it('O 표도 같은 규칙으로 잠긴다', async () => {
    const { container } = await renderLoaded();
    await goToTable(container, J_TABLE);
    await fillNoc(container, J_TABLE, 'SP01', '미진행');
    await goToTable(container, O_TABLE);
    expect(stInputOf(rowOf(container, O_TABLE, 'SP02')).disabled).toBe(true);
    expect(buttonWith(container.querySelector('.wizard-table-toolbar') as HTMLElement, i18n.t('request.btn_all_o'))!.disabled).toBe(true);
  });

  it('미확정 상태로 상신하면 막히고 STEP1 로 돌아간다', async () => {
    const { container } = await renderLoaded();
    await goToTable(container, J_TABLE);
    await fillNoc(container, J_TABLE, 'SP01', '미진행');
    await goToTable(container, O_TABLE);
    await fillNoc(container, O_TABLE, 'SP01', '미진행');
    await click(buttonWith(container, '이전'));
    // 확정 대상이던 수동 행 j2 의 PP 를 바꾸면 그 행은 더 이상 변경후 값과 같지 않아 확정이 풀린다.
    const ppInput = rowOf(container, J_TABLE, 'SP02').querySelectorAll('td')[6].querySelector('input') as HTMLInputElement;
    await act(async () => { fireEvent.change(ppInput, { target: { value: `${MERGE_PP_PREFIXES.J[0]}_CHANGED` } }); });
    await flush(3);
    expect(toastsOf('warning')).toContain(i18n.t('request.toast_ba_confirm_released'));
    const stepTabs = Array.from(container.querySelectorAll('.wizard-step')) as HTMLElement[];
    await click(stepTabs[stepTabs.length - 1]);
    // 요청 기준으로 계산한 요청 목적이 픽스처와 달라 확인 모달이 뜨면 값을 그대로 두고 진행한다.
    const keep = modalButton(i18n.t('common.cancel'));
    if (keep) await click(keep);
    await click(buttonWith(container, '📤'));
    expect(toastsOf('error')).toContain(i18n.t('request.ba_gate_unconfirmed'));
    expect(onStep1()).toBe(true);
  });
});

describe('상세 목적을 해제하면 ST 잠금이 풀린다', () => {
  beforeEach(() => {
    mockState.optionsFor = optionsFor;
    localStorage.clear();
  });

  it("빈 표 상태에서 Layer 추가/삭제를 해제하면 J 표 ST 칸을 다시 고칠 수 있다", async () => {
    const detail = { ...fixtureDetail, merge_pairs: [{ id: 'pair_empty', table: 'J', beforeId: null, before: null, afterId: null, after: null, kind: 'empty' }] };
    const { container } = await renderLoaded({ ...fixtureDoc, additional_notes: JSON.stringify({ ...fixtureNotes, detail }) });
    const purposeBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Layer 추가/삭제') as HTMLButtonElement;
    await click(purposeBtn);
    await goToTable(container, J_TABLE);
    expect(stInputOf(rowOf(container, J_TABLE, 'SP02')).disabled).toBe(false);
    expect(buttonWith(container, i18n.t('request.btn_all_x'))!.disabled).toBe(false);
  });
});
