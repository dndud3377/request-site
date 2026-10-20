/**
 * J/O-ayer 표 ST ↔ 요청 기준(new_or_copy) 짝 규칙 테스트.
 *
 * claude 수정 (2026-10-20):
 * - ST 가 O 계열('O'·'O (D)')이면 요청 기준 목록은 신규·차용, X 면 기등록·layer삭제·미진행, 미선택이면 5개 모두.
 * - 기등록·layer삭제·미진행을 고르면 ST 가 X 가 된다(기존 동작).
 * - 타이핑·붙여넣기·예전 문서로 들어온 불일치 조합은 STEP3/4 '다음'과 상신에서 막는다.
 * - '전체 X' 는 한 행씩 X 로 바꿀 때와 같이 요청 기준·제품 이름·STEP·ITEM_ID 를 비우고 bb 매핑을 푼다.
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
/** 수동 빈 행(SP 없음)은 마지막 행이다 */
const lastRowOf = (c: HTMLElement, tableSelector: string) =>
  Array.from(c.querySelector(tableSelector)!.querySelectorAll('tbody tr')).pop() as HTMLTableRowElement;
/** 열 순서: No·갱신일·process_id·SP·SD·layer·PP·ST·요청 기준 … */
const stInputOf = (tr: HTMLTableRowElement) => tr.querySelectorAll('td')[7].querySelector('input') as HTMLInputElement;
const nocInputOf = (tr: HTMLTableRowElement) => tr.querySelectorAll('td')[8].querySelector('input') as HTMLInputElement;
const NOC_VALUES = ['신규', '차용', '기등록', 'layer삭제', '미진행'];
/** 요청 기준 칸을 포커스해 열린 드롭다운의 항목(위로 여는 드롭다운은 body 에 포털로 그린다) */
const nocOptionsOf = async (tr: HTMLTableRowElement): Promise<string[]> => {
  await act(async () => { fireEvent.focus(nocInputOf(tr)); });
  const items = Array.from(document.body.querySelectorAll('li'))
    .map((li) => (li.textContent ?? '').trim())
    .filter((text) => NOC_VALUES.includes(text));
  await act(async () => { fireEvent.blur(nocInputOf(tr)); fireEvent.mouseDown(document.body); });
  return items;
};
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

const docWithRows = (jayerRows: unknown[], oayerRows: unknown[] = fixtureOayerRows) => ({
  ...fixtureDoc,
  additional_notes: JSON.stringify({ ...fixtureNotes, jayerRows, oayerRows }),
});

// O 표까지 가려면 J 표 '다음'을 통과해야 하므로 ST·요청 기준이 빈 J 수동 행(j3)을 뺀다.
const J_ROWS_FILLED = fixtureJayerRows.filter((r) => r.id !== 'j3');

describe('J/O 표 ST ↔ 요청 기준 짝 규칙', () => {
  beforeEach(() => {
    mockState.doc = fixtureDoc;
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    localStorage.clear();
  });

  it('ST 가 O 면 신규·차용, ST 미선택이면 전체, ST 를 X 로 바꾸면 기등록·layer삭제·미진행만 보인다', async () => {
    const { container } = await renderAtStep(J_TABLE);
    expect(await nocOptionsOf(rowOf(container, J_TABLE, 'SP01'))).toEqual(['신규', '차용']);
    expect(await nocOptionsOf(lastRowOf(container, J_TABLE))).toEqual(['신규', '차용', '기등록', 'layer삭제', '미진행']);

    await setValue(stInputOf(rowOf(container, J_TABLE, 'SP02')), 'X');
    expect(nocInputOf(rowOf(container, J_TABLE, 'SP02')).value).toBe('');
    expect(await nocOptionsOf(rowOf(container, J_TABLE, 'SP02'))).toEqual(['기등록', 'layer삭제', '미진행']);
  });

  it('ST 를 고르지 않고 미진행을 고르면 ST 가 X 가 된다(기존 동작)', async () => {
    const { container } = await renderAtStep(J_TABLE);
    await setValue(nocInputOf(lastRowOf(container, J_TABLE)), '미진행');
    expect(stInputOf(lastRowOf(container, J_TABLE)).value).toBe('X');
  });

  it('O 표도 같은 목록 규칙을 따른다', async () => {
    mockState.doc = docWithRows(J_ROWS_FILLED);
    const { container } = await renderAtStep(O_TABLE);
    expect(await nocOptionsOf(rowOf(container, O_TABLE, 'SP01'))).toEqual(['신규', '차용']);
    expect(await nocOptionsOf(lastRowOf(container, O_TABLE))).toHaveLength(5);
  });

  it('ST X 행에 신규를 직접 입력하면 다음 단계로 넘어가지 못하고 칸이 오류로 표시된다', async () => {
    const { container } = await renderAtStep(J_TABLE);
    await setValue(stInputOf(rowOf(container, J_TABLE, 'SP02')), 'X');
    await setValue(nocInputOf(rowOf(container, J_TABLE, 'SP02')), '신규');
    await setValue(nocInputOf(lastRowOf(container, J_TABLE)), '미진행');
    await act(async () => { buttonWith(container, '다음')!.click(); });
    await flush(5);
    expect(container.querySelector(J_TABLE)).not.toBeNull();
    expect(toastsOf('error')).toContain(i18n.t('request.jayer_stnoc_mismatch', { count: 1 }));
    expect(rowOf(container, J_TABLE, 'SP02').querySelectorAll('td')[8].className).toContain('field-error-target');
  });

  it('예전에 저장된 불일치 조합(ST X + 차용)도 J 표에서 다음 단계로 넘어가지 못한다', async () => {
    const rows = [
      { ...fixtureJayerRows[0] },
      { ...fixtureJayerRows[1], st: 'X', new_or_copy: '차용', product_name: '', step: '', item_id: '' },
    ];
    mockState.doc = docWithRows(rows);
    const { container } = await renderAtStep(J_TABLE);
    await act(async () => { buttonWith(container, '다음')!.click(); });
    await flush(5);
    expect(container.querySelector(J_TABLE)).not.toBeNull();
    expect(toastsOf('error')).toContain(i18n.t('request.jayer_stnoc_mismatch', { count: 1 }));
  });

  it('붙여넣기로 ST X 행에 신규를 넣으면 다음 단계에서 막힌다', async () => {
    const { container } = await renderAtStep(J_TABLE);
    await setValue(stInputOf(rowOf(container, J_TABLE, 'SP02')), 'X');
    await setValue(nocInputOf(lastRowOf(container, J_TABLE)), '미진행');
    const table = container.querySelector(`${J_TABLE} table`) as HTMLTableElement;
    const td = rowOf(container, J_TABLE, 'SP02').querySelectorAll('td')[8];
    await act(async () => { fireEvent.mouseDown(td); fireEvent.mouseUp(td); });
    await act(async () => { fireEvent.paste(table, { clipboardData: { getData: () => '신규' } }); });
    await flush(3);
    expect(nocInputOf(rowOf(container, J_TABLE, 'SP02')).value).toBe('신규');
    await act(async () => { buttonWith(container, '다음')!.click(); });
    await flush(5);
    expect(toastsOf('error')).toContain(i18n.t('request.jayer_stnoc_mismatch', { count: 1 }));
  });

  it("J '전체 X' 는 활성 행의 요청 기준·제품 이름·STEP·ITEM_ID 를 비우고 bb 매핑을 푼다", async () => {
    const { container } = await renderAtStep(J_TABLE);
    await act(async () => { buttonWith(container, i18n.t('request.btn_all_x'))!.click(); });
    await flush(3);
    const saved = await saveDraftAndCapture();
    saved.jayerRows.filter((r) => r.id !== 'j3').forEach((r) => {
      expect(r).toMatchObject({ st: 'X', new_or_copy: '', product_name: '', step: '', item_id: '' });
    });
    expect(saved.bbRows).toEqual([]);
  });

  it("O '전체 X' 는 활성 행의 요청 기준·제품 이름·STEP 를 비운다", async () => {
    mockState.doc = docWithRows(J_ROWS_FILLED);
    const { container } = await renderAtStep(O_TABLE);
    const toolbar = container.querySelector(`${O_TABLE}`)!.previousElementSibling as HTMLElement;
    await act(async () => { buttonWith(toolbar, i18n.t('request.btn_all_x'))!.click(); });
    await flush(3);
    const saved = await saveDraftAndCapture();
    saved.oayerRows.filter((r) => r.id !== 'o3').forEach((r) => {
      expect(r).toMatchObject({ st: 'X', new_or_copy: '', product_name: '', step: '' });
    });
  });
});
