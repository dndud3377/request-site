/**
 * 임시저장 왕복(round-trip) 재현 테스트.
 *
 * 「모든 항목을 채운 문서」를 편집 모드(editDocId)로 불러온 뒤 곧바로 '임시저장'을 눌러,
 * 서버로 다시 나가는 payload 가 불러온 값과 동일한지 필드 단위로 비교한다.
 * 사용자가 아무것도 건드리지 않았으므로 값이 달라지면 그것이 곧 유실이다.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import '../../i18n';

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
  rev_yn: 'YES',
  rev_entries: [{ layers: ['L01'], gds: 'v1.2' }],
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
  merge_pairs: [{
    before: { id: 'J_b1', table: 'jayer', process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01' },
    after: { id: 'J_a1', table: 'jayer', process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02' },
  }],
  merge_unmatched_before: [{ id: 'J_b2', table: 'jayer', process_id: PROCESS_ID, sp: 'SP03', sd: 'SD03', pp: 'PP03', layerid: 'L03' }],
  merge_unmatched_after: [{ id: 'J_a2', table: 'jayer', process_id: PROCESS_ID, sp: 'SP04', sd: 'SD04', pp: 'PP04', layerid: 'L04' }],
  adi_cd_before: [{ id: 'adi1', step_id: 'S1', step_desc: 'D1' }],
  adi_cd_after: [{ id: 'adi2', step_id: 'S2', step_desc: 'D2' }],
  adi_cd_delete_all: false,
};

const fixtureJayerRows = [
  { id: 'j1', updated: '20260801', sortOrder: 1, disabled: false, manuallyDisabled: false, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PLEL01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10', item_id: 'ITEM_1' },
];
const fixtureOayerRows = [
  { id: 'o1', updated: '20260801', sortOrder: 1, disabled: false, manuallyDisabled: false, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'TBV_SD', pp: 'PP01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10' },
];
const fixtureBbRows = [
  { id: 'b1', sortOrder: 1, disabled: false, entryId: 'bbe1', sourceJayerRowId: 'j1', process_id: PROCESS_ID, ss: 'SP01', sd: 'SD01', bb_process_id: BB_PROCESS_ID, bb_name: `[${BB_LOCATION}] ${BB_PRODUCT}`, bb_layer: 'L01', bb_ss: '110', bb_step: 'STEP', remark: '비고' },
];

const fixtureNotes = {
  detail: fixtureDetail,
  jayerRows: fixtureJayerRows,
  oayerRows: fixtureOayerRows,
  bbRows: fixtureBbRows,
  history: [],
  jayerActiveFilterIds: [],
  oayerActiveFilterIds: [],
  mergeSnapshot: { jayerRows: fixtureJayerRows, oayerRows: fixtureOayerRows },
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

// 옵션 API 는 픽스처 값이 "옵션에 존재하는" 상태로 응답해 값이 무효 처리되지 않게 한다.
const optionsFor = (line: string): string[] => {
  if (line === SRC_LINE) return [SRC_PARTID];
  if (line === BB_LOCATION) return [BB_PRODUCT, BB_PROCESS_ID];
  if (line === FLOW_LOCATION) return [FLOW_PRODUCT, FLOW_PROCESS_ID];
  return [PROCESS, PRODUCT, PROCESS_ID];
};

/** 편집 모드로 페이지를 띄우고 로드가 끝날 때까지 기다린다. */
async function renderLoadedPage() {
  mockState.captured = null;
  // 반환값(container)은 이 렌더에만 질의를 한정하고 싶을 때 쓴다 — 전역 document 로 찾으면
  // 같은 파일의 다른 테스트가 남긴 DOM 을 함께 잡을 수 있다. 기존 호출부는 무시해도 된다.
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  // 로드된 값이 화면에 반영될 때까지 대기(고객사명은 step 1 에 바로 보인다)
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  // 옵션 연쇄 fetch(effect 체인)가 모두 끝나도록 마이크로태스크를 충분히 흘린다.
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
  return view;
}

/** '임시저장' 버튼을 눌러 서버로 나간 payload 의 additional_notes 를 파싱해 돌려준다. */
async function saveDraftAndCapture(): Promise<{ detail: Record<string, unknown>; [k: string]: unknown }> {
  const buttons = Array.from(document.querySelectorAll('button'));
  // 버튼 라벨은 i18n(ko/en)에 따라 달라지므로 언어 무관한 💾 아이콘으로 찾는다.
  const saveBtn = buttons.find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { saveBtn.click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  const payload = mockState.captured as { additional_notes: string };
  return JSON.parse(payload.additional_notes);
}

describe('임시저장 왕복 — 불러온 값이 그대로 다시 저장되는가', () => {
  beforeEach(() => {
    mockState.doc = fixtureDoc;
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    localStorage.clear();
  });

  it('detail 의 모든 항목이 유실 없이 다시 저장된다', async () => {
    await renderLoadedPage();
    const saved = await saveDraftAndCapture();

    const lost: string[] = [];
    Object.keys(fixtureDetail).forEach((key) => {
      const before = JSON.stringify((fixtureDetail as Record<string, unknown>)[key]);
      const after = JSON.stringify(saved.detail[key]);
      if (before !== after) lost.push(`${key}\n      저장 전: ${before}\n      저장 후: ${after}`);
    });
    if (lost.length > 0) {
      throw new Error(`임시저장 왕복에서 값이 달라진 detail 항목 ${lost.length}개:\n  - ${lost.join('\n  - ')}`);
    }
  });

  it('사용자가 원본 위치를 직접 바꾸면 원본 제품은 종전대로 초기화된다', async () => {
    // BEFORE/AFTER 미매핑이 남아 있으면 step 이동이 막히므로, 그 관문이 없는 문서로 바꿔 끼운다.
    mockState.doc = {
      ...fixtureDoc,
      additional_notes: JSON.stringify({
        ...fixtureNotes,
        detail: { ...fixtureDetail, merge_unmatched_before: [], merge_unmatched_after: [] },
      }),
    };
    await renderLoadedPage();

    // step 2(StepMap)로 이동해야 원본 위치/원본 제품 입력이 보인다.
    const nextBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('다음'));
    if (!nextBtn) throw new Error('다음 버튼을 찾지 못했다');
    await act(async () => { nextBtn.click(); });

    const select = document.querySelector('select[name="source_line"]') as HTMLSelectElement | null;
    if (!select) throw new Error('원본 위치 select 를 찾지 못했다');
    expect(select.value).toBe(SRC_LINE);            // 로드된 값이 살아 있고
    expect(screen.getByDisplayValue(SRC_PARTID)).toBeDefined();  // 원본 제품도 복원돼 있다

    // 사용자가 원본 위치를 바꾸면(로드 가드 해제) 하위 값은 종전대로 비워져야 한다.
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!
        .set!.call(select, '라인4');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const saved = await saveDraftAndCapture();
    expect(saved.detail.source_line).toBe('라인4');
    expect(saved.detail.source_partid).toBe('');
  });

  it('J/O/bb 표와 mergeSnapshot 이 유실 없이 다시 저장된다', async () => {
    await renderLoadedPage();
    const saved = await saveDraftAndCapture();

    expect(saved.jayerRows).toHaveLength(fixtureJayerRows.length);
    expect(saved.oayerRows).toHaveLength(fixtureOayerRows.length);
    expect(saved.bbRows).toHaveLength(fixtureBbRows.length);
    expect(saved.mergeSnapshot).not.toBeNull();
  });

  it('임시저장을 연달아 두 번 눌러도 값이 그대로 유지된다', async () => {
    await renderLoadedPage();
    const first = await saveDraftAndCapture();
    mockState.captured = null;
    const second = await saveDraftAndCapture();
    expect(JSON.stringify(second.detail)).toBe(JSON.stringify(first.detail));
  });

  it('저장된 필터가 켜져 있어 TBV/TLV 행이 비활성화되면 TBV/TLV 항목이 사라진다(현재 동작 기록)', async () => {
    // 사용자의 브라우저(localStorage)에 'TBV' 키워드 필터가 저장·활성화된 상태를 재현한다.
    localStorage.setItem('oayerFilterSets', JSON.stringify([
      { id: 'f1', label: 'TBV 숨김', words: { sp: [], sd: ['TBV'], pp: [] } },
    ]));
    mockState.doc = {
      ...fixtureDoc,
      additional_notes: JSON.stringify({ ...fixtureNotes, oayerActiveFilterIds: ['f1'] }),
    };
    await renderLoadedPage();
    const saved = await saveDraftAndCapture();

    // 문서에는 TBV/TLV 항목이 1건 있었지만 로드 직후 정리 effect 가 지운다.
    expect((fixtureDetail.tbvtlv_entries as unknown[]).length).toBe(1);
    expect(saved.detail.tbvtlv_entries).toEqual([]);

    // 원인: 저장 당시 활성이던 O-ayer 행이 '다시 열기만 해도' 비활성으로 재계산된다.
    // (임시저장은 비활성 행도 저장하지만, 상신 payload 는 비활성 행을 제외한다)
    const savedO = saved.oayerRows as { id: string; disabled: boolean }[];
    expect(fixtureOayerRows[0].disabled).toBe(false);
    expect(savedO[0].disabled).toBe(true);
  });
});

/**
 * Only MAP · MAP 삭제: J-ayer·O-ayer·Backbone 단계를 아예 열지 않고 MAP 정보에서 바로 상신한다.
 * (2026-08) 예전에는 그 단계들에 들어가 입력까지 할 수 있었지만 저장 시 전부 버려졌다.
 */
describe('Only MAP · MAP 삭제 — MAP 정보(2단계)가 마지막 단계', () => {
  const LOCKED_STEPS = [3, 4, 5];

  /** 요청 목적만 바꾼 문서로 편집 모드 진입 → step 2(MAP 정보)까지 이동한다. */
  async function renderAtMapStep(purpose: string) {
    mockState.doc = {
      ...fixtureDoc,
      additional_notes: JSON.stringify({
        ...fixtureNotes,
        // BEFORE/AFTER 미매핑이 남아 있으면 step 이동 자체가 막힌다.
        detail: {
          ...fixtureDetail,
          request_purpose: purpose,
          merge_unmatched_before: [],
          merge_unmatched_after: [],
        },
      }),
    };
    const { container } = await renderLoadedPage();
    const nextBtn = buttonWith(container, '다음');
    if (!nextBtn) throw new Error('다음 버튼을 찾지 못했다');
    await act(async () => { nextBtn.click(); });
    return container;
  }

  const stepEls = (c: HTMLElement) => Array.from(c.querySelectorAll('.wizard-step')) as HTMLElement[];
  const buttonWith = (c: HTMLElement, text: string) =>
    Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes(text));

  beforeEach(() => {
    mockState.doc = fixtureDoc;
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    localStorage.clear();
  });

  it.each([['Only MAP'], ['MAP 삭제']])('%s: MAP 정보 단계에서 다음 대신 상신 버튼이 나온다', async (purpose) => {
    const c = await renderAtMapStep(purpose);
    expect(buttonWith(c, '다음')).toBeUndefined();
    expect(buttonWith(c, '📤')).toBeDefined();
  });

  it.each([['Only MAP'], ['MAP 삭제']])('%s: J-ayer·O-ayer·Backbone 단계가 잠긴다', async (purpose) => {
    const c = await renderAtMapStep(purpose);
    const all = stepEls(c);
    expect(all).toHaveLength(5);
    LOCKED_STEPS.forEach((n) => {
      expect(all[n - 1].className).toContain('disabled');
      expect(all[n - 1].className).not.toContain('clickable');
    });
  });

  it.each([['Only MAP'], ['MAP 삭제']])('%s: 잠긴 단계를 클릭해도 이동하지 않는다', async (purpose) => {
    const c = await renderAtMapStep(purpose);
    await act(async () => { stepEls(c)[2].click(); });
    // 여전히 MAP 정보(2단계)다 — 상신 버튼이 그대로 있고 '다음'은 없다.
    expect(buttonWith(c, '📤')).toBeDefined();
    expect(buttonWith(c, '다음')).toBeUndefined();
    // 클릭한 J-ayer 단계는 여전히 잠긴 상태이고, 현재 단계(MAP 정보)는 잠기지 않는다.
    expect(stepEls(c)[2].className).toContain('disabled');
    expect(stepEls(c)[1].className).not.toContain('disabled');
  });

  it('일반 목적(차용)은 종전대로 5단계까지 열려 있다', async () => {
    const c = await renderAtMapStep('차용');
    expect(buttonWith(c, '다음')).toBeDefined();
    stepEls(c).forEach((el) => expect(el.className).not.toContain('disabled'));
  });
});
