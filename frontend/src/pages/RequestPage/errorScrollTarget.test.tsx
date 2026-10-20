/**
 * 검증 오류 시 "오류난 칸으로 이동 + 빨간 표시 + 에러 토스트" 통일 테스트.
 *
 * claude 수정 (2026-10-20):
 * - O-ayer 'OVL 정보' 탭을 보던 중 O 표에 오류가 있으면 '표' 탭으로 돌아가 오류 칸으로 이동한다(전에는 맨 위로만 올라갔다).
 * - 참조 요청서 변경전/변경후 표·ADI CD 표·Validation System 오류도 해당 위치에 빨간 문구를 표시하고 그 블록으로 이동한다.
 * - 현재 단계에 고칠 오류가 없으면 오류가 있는 가장 앞 단계로 보낸다(errorRedirectStep).
 * (픽스처·목은 stNocRule.test.tsx 와 같다.)
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { MERGE_PP_PREFIXES, ADI_CD_CHANGE_PURPOSE } from './constants';
import { errorKeyStep, errorRedirectStep, findRefDocNocConflictPairIds } from './helpers';

// jest.mock 팩토리는 호이스팅되어 `mock` 접두사 변수만 참조할 수 있다.
const mockState: {
  captured: unknown | null;
  doc: unknown;
  optionsFor: (line: string) => string[];
  role: string;
} = { captured: null, doc: null, optionsFor: () => [], role: 'PL' };

// RichTextEditor 는 tiptap(ESM) 을 끌어와 jest 가 파싱하지 못한다. 값 전달만 되면 충분하므로 대체한다.
jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    // '이력 바로 등록' 버튼은 MASTER 에게만 보인다 — 테스트마다 역할을 바꾼다.
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


// scrollIntoView 가 불린 요소를 기록한다(jsdom 에는 없는 API). resetMocks 때문에 jest.fn 대신 평범한 함수로 둔다.
const scrolled: Element[] = [];
beforeAll(async () => {
  await i18n.changeLanguage('ko');
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this); };
  window.scrollTo = () => {};
});

const optionsFor = (): string[] => [PROCESS, PRODUCT, PROCESS_ID, BB_PRODUCT, BB_PROCESS_ID, FLOW_PRODUCT, FLOW_PROCESS_ID];

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}
// scrollToFirstError 는 탭 전환·문구 렌더 뒤(setTimeout 60ms)에 스크롤한다.
const waitScroll = () => act(async () => { await new Promise((r) => setTimeout(r, 120)); });

const buttonWith = (c: HTMLElement | Document, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

const J_TABLE = '[data-tour="jayer-table"]';
const O_TABLE = '[data-tour="oayer-table"]';

const toastsOf = (kind: string) =>
  Array.from(document.querySelectorAll(`.toast-${kind}`)).map((el) => el.textContent ?? '').join('\n');

async function renderPage() {
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

/** 편집 모드로 띄운 뒤 '다음'을 눌러 table 셀렉터가 나타나는 단계까지 이동한다. */
async function renderAtStep(tableSelector: string) {
  const view = await renderPage();
  for (let i = 0; i < 4 && !view.container.querySelector(tableSelector); i += 1) {
    const next = buttonWith(view.container, '다음');
    if (!next) throw new Error('다음 버튼을 찾지 못했다');
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { next.click(); });
    // eslint-disable-next-line no-await-in-loop
    await flush(5);
  }
  if (!view.container.querySelector(tableSelector)) {
    throw new Error(`${tableSelector} 단계로 이동하지 못했다 — ${toastsOf('error')}`);
  }
  return view;
}

async function clickNext(container: HTMLElement, label = '다음') {
  scrolled.length = 0;
  await act(async () => { buttonWith(container, label)!.click(); });
  await flush(5);
  await waitScroll();
}

const docWith = (detailOverride: Record<string, unknown>, jayerRows: unknown[] = fixtureJayerRows, oayerRows: unknown[] = fixtureOayerRows) => ({
  ...fixtureDoc,
  additional_notes: JSON.stringify({ ...fixtureNotes, detail: { ...fixtureDetail, ...detailOverride }, jayerRows, oayerRows }),
});

// O 표까지 가려면 J 표 '다음'을 통과해야 하므로 ST·요청 기준이 빈 J 수동 행(j3)을 뺀다.
const J_ROWS_FILLED = fixtureJayerRows.filter((r) => r.id !== 'j3');

describe('검증 오류 → 오류 위치로 이동 + 빨간 표시', () => {
  beforeEach(() => {
    mockState.doc = fixtureDoc;
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    mockState.role = 'PL';
    scrolled.length = 0;
    localStorage.clear();
  });

  it("O-ayer 'OVL 정보' 탭에서 '다음'을 눌러도 O 표 오류가 있으면 표 탭으로 돌아가 오류 칸으로 이동한다", async () => {
    // O 표 수동 빈 행(o3)은 ST·요청 기준이 비어 있어 막힌다.
    mockState.doc = docWith({}, J_ROWS_FILLED);
    const { container } = await renderAtStep(O_TABLE);
    await act(async () => { buttonWith(container, i18n.t('request.ovl_tab_info'))!.click(); });
    await flush(3);
    expect(container.querySelector(O_TABLE)).toBeNull();
    await clickNext(container);
    expect(toastsOf('error')).toContain(i18n.t('request.oayer_stnoc_required', { count: 1 }));
    expect(container.querySelector(O_TABLE)).not.toBeNull();
    const target = container.querySelector(`${O_TABLE} .field-error-target`);
    expect(target).not.toBeNull();
    expect(scrolled.some((el) => el.contains(target))).toBe(true);
  });

  it("O 표 오류 없이 Partial Shot 만 비었으면 'OVL 정보' 탭으로 전환한다(기존 동작)", async () => {
    const oRows = fixtureOayerRows.filter((r) => r.id !== 'o3');
    mockState.doc = docWith({ partial_shot: '' }, J_ROWS_FILLED, oRows);
    const { container } = await renderAtStep(O_TABLE);
    await clickNext(container);
    expect(container.querySelector(O_TABLE)).toBeNull();
    expect(container.querySelector('.form-error')).not.toBeNull();
  });

  it('참조 요청서 변경전/변경후 표 오류는 표 아래에 빨간 문구를 표시하고 그 블록으로 이동한다', async () => {
    mockState.doc = docWith({ other_purpose: ['Layer 추가/삭제'], merge_pairs: [] });
    const { container } = await renderPage();
    await clickNext(container);
    const msg = i18n.t('request.ba_gate_manual_empty');
    expect(toastsOf('error')).toContain(msg);
    const block = container.querySelector('[data-tour="ref-doc-merge"]')!;
    const err = Array.from(block.querySelectorAll('.form-error')).find((e) => e.textContent === msg);
    expect(err).toBeDefined();
    expect(scrolled).toContain(block);
  });

  it('Validation System 미선택은 토글 옆에 빨간 문구를 표시하고 그 위치로 이동한다', async () => {
    // J 표 수동 빈 행(j3)을 빼 Validation System 오류만 남긴다.
    mockState.doc = docWith({ validation_system: '' }, J_ROWS_FILLED);
    const { container } = await renderAtStep(J_TABLE);
    await clickNext(container);
    const msg = i18n.t('request.validation_system_required');
    expect(toastsOf('error')).toContain(msg);
    const box = container.querySelector('[data-tour="validation-system"]')!;
    expect(box.querySelector('.form-error')?.textContent).toBe(msg);
    expect(scrolled).toContain(box);
  });

  it('ADI CD 변경전 표가 비었으면 표 아래에 빨간 문구를 표시하고 그 표로 이동한다', async () => {
    mockState.doc = docWith({ request_purpose: ADI_CD_CHANGE_PURPOSE, other_purpose: [], adi_cd_before: [] });
    const { container } = await renderPage();
    // ADI CD 변경은 STEP1 이 마지막 단계라 바로 상신한다.
    await clickNext(container, '📤');
    const msg = i18n.t('request.adi_cd_gate_before_empty');
    expect(toastsOf('error')).toContain(msg);
    const box = container.querySelector('[data-tour="adi-cd"]')!;
    expect(Array.from(box.querySelectorAll('.form-error')).some((e) => e.textContent === msg)).toBe(true);
    expect(scrolled).toContain(box);
  });

  // claude 수정 (2026-10-20): 참조 요청서 '확정'에서 요청 기준 충돌이 나면 충돌 행 변경후 칸을 빨간 표시하고 그 칸으로 이동한다.
  it("참조 요청서 '확정' 시 요청 기준 충돌이 나면 표 아래 문구 + 충돌 행 변경후 칸 빨간 표시 후 그 칸으로 이동한다", async () => {
    const J_PP = `${MERGE_PP_PREFIXES.J[0]}_NEW`;
    const conflictRow = { ...MANUAL_J_FILLED, pp: J_PP, st: 'X', new_or_copy: '기등록', product_name: '', step: '' };
    const pairs = [{
      id: 'pair_conflict', table: 'J', beforeId: null, before: null, afterId: null,
      after: { process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: J_PP, layerid: '' }, kind: 'added',
    }];
    mockState.doc = docWith({ other_purpose: ['Layer 추가/삭제'], merge_pairs: pairs }, [LOADED_J, conflictRow]);
    const { container } = await renderPage();
    const block = container.querySelector('[data-tour="ref-doc-merge"]')!;
    expect(block.querySelectorAll('.field-error-target')).toHaveLength(0);
    await clickNext(container, i18n.t('request.ba_confirm'));
    const msg = i18n.t('request.ba_noc_special_conflict');
    expect(toastsOf('error')).toContain(msg);
    expect(Array.from(block.querySelectorAll('.form-error')).some((e) => e.textContent === msg)).toBe(true);
    const cells = Array.from(block.querySelectorAll('input.field-error-target')) as HTMLInputElement[];
    expect(cells.map((c) => c.value)).toEqual([PROCESS_ID, 'SP02', 'SD02', J_PP]);
    expect(cells.every((c) => c.title === msg)).toBe(true);
    expect(scrolled.some((el) => el.contains(cells[0]))).toBe(true);
  });

  // claude 수정 (2026-10-20): '이력 바로 등록'도 상신처럼 마지막 단계 기준으로 검증한다 — ADI CD 변경은 STEP1 이 마지막이라
  // 쓰지 않는 Backbone 매핑(STEP5) 검사로 막히면 안 된다.
  it("ADI CD 변경 문서의 '이력 바로 등록'은 STEP5 Backbone 매핑 검사로 막히지 않는다", async () => {
    mockState.role = 'MASTER';
    mockState.doc = {
      ...fixtureDoc,
      additional_notes: JSON.stringify({
        ...fixtureNotes,
        detail: { ...fixtureDetail, request_purpose: ADI_CD_CHANGE_PURPOSE, other_purpose: [] },
        bbRows: [],
      }),
    };
    const { container } = await renderPage();
    await clickNext(container, i18n.t('request.direct_history'));
    expect(toastsOf('error')).toBe('');
    expect(document.body.textContent).toContain(i18n.t('request.direct_history_submitted_at'));
  });
});

describe('errorRedirectStep — 입력칸이 있는 단계로 보내기', () => {
  it('오류 키마다 입력칸이 있는 단계를 돌려준다', () => {
    expect(errorKeyStep('bb_entries')).toBe(1);
    expect(errorKeyStep('merge_confirm')).toBe(1);
    expect(errorKeyStep('adi_cd_before')).toBe(1);
    expect(errorKeyStep('flow_step_r1_step_from')).toBe(1);
    expect(errorKeyStep('line')).toBe(1);
    expect(errorKeyStep('map_value_x')).toBe(2);
    expect(errorKeyStep('jayer_noc_j1_step')).toBe(3);
    expect(errorKeyStep('validation_system')).toBe(3);
    expect(errorKeyStep('oayer_stnoc_o1_st')).toBe(4);
    expect(errorKeyStep('partial_shot')).toBe(4);
    expect(errorKeyStep('jayer_mapping')).toBe(5);
  });

  it('현재 단계 오류가 있으면 머물고, 없으면 오류가 있는 가장 앞 단계로 보낸다', () => {
    expect(errorRedirectStep([], 5)).toBeUndefined();
    expect(errorRedirectStep(['jayer_mapping', 'bb_entries'], 5)).toBeUndefined();
    expect(errorRedirectStep(['bb_entries'], 3)).toBe(1);
    expect(errorRedirectStep(['merge_confirm', 'bb_entries'], 5)).toBe(1);
    expect(errorRedirectStep(['oayer_noc_required', 'validation_system'], 5)).toBe(3);
    expect(errorRedirectStep(['oayer_stnoc_required'], 5)).toBe(4);
    expect(errorRedirectStep(['bb_entries', 'jayer_noc_required'], 3)).toBeUndefined();
  });
});

describe('findRefDocNocConflictPairIds — 요청 기준 충돌 행', () => {
  const J_PP = `${MERGE_PP_PREFIXES.J[0]}_NEW`;
  const after = { process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: J_PP, layerid: '' };
  const pair = { id: 'p1', table: 'J' as const, beforeId: null, before: null, afterId: null, after, kind: 'added' as const };
  const row = (new_or_copy: string) => ({ id: 'j9', process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: J_PP, st: 'X', new_or_copy });

  it('변경후 값과 같은 J 행의 요청 기준이 기등록/layer삭제/미진행이면 그 행 id 를, 신규면 빈 목록을 돌려준다', () => {
    expect(findRefDocNocConflictPairIds([pair], [row('기등록')], [])).toEqual(['p1']);
    expect(findRefDocNocConflictPairIds([pair], [row('미진행')], [])).toEqual(['p1']);
    expect(findRefDocNocConflictPairIds([pair], [row('신규')], [])).toEqual([]);
    expect(findRefDocNocConflictPairIds([pair], [], [row('기등록')])).toEqual([]);
  });
});
