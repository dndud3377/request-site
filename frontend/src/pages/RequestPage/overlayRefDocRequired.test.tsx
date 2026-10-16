/**
 * 상세 목적 'Overlay만 변경' — 참조 요청서 필수 테스트.
 *
 * claude 수정 (2026-10-15): 'Overlay만 변경'은 변경 내용 누락 방지를 위해 참조 요청서가 필수다.
 * - '있음'(기본 선택)이면 참조 요청서를 골라 Merge 해야 STEP1 을 넘어간다.
 * - '있음'·'없음' 모두 변경전/변경후 유효 행이 1건 이상이어야 한다.
 * - '없음'으로 확정한 뒤에도 '있음' 라디오를 누를 수 있고, 모드 변경 확인 모달을 거쳐 바뀐다.
 * - Layer 추가/삭제·STEPSEQ 변경은 지금처럼 선택사항이다.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { OTHER_PURPOSE_OVERLAY, OTHER_PURPOSE_OVERLAY_LEGACY, MERGE_PP_PREFIXES } from './constants';

const mockState: { doc: unknown } = { doc: null };

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
    update: () => Promise.resolve({ data: { id: 1 } }),
    create: () => Promise.resolve({ data: { id: 1 } }),
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['RECIPE_A', 'PART_1000', 'PROC_X1']),
    getProducts: () => Promise.resolve(['RECIPE_A', 'PART_1000', 'PROC_X1']),
    getProcessId: () => Promise.resolve(['RECIPE_A', 'PART_1000', 'PROC_X1']),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: () => Promise.resolve(['RECIPE_A', 'PART_1000', 'PROC_X1']),
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

const LAYER_ADD_DELETE = 'Layer 추가/삭제';

const VALID_PAIR = {
  id: 'pair_J_b1__J_a1',
  table: 'J',
  beforeId: 'J_b1',
  before: { process_id: 'PROC_X1', sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01' },
  afterId: 'J_a1',
  after: { process_id: 'PROC_X1', sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02' },
  kind: 'changed',
};

// claude 수정 (2026-10-16): '없음' 모드는 PP 접두사로 구분을 정하고 현재 J/O 표와 대조한다 —
// 변경전은 J 표에 없는 값, 변경후는 J 표에 있는 값이어야 통과한다.
const NONE_VALID_PAIR = {
  id: 'pair_manual_1',
  table: 'J',
  beforeId: null,
  before: { process_id: 'PROC_X1', sp: 'SP01', sd: 'SD01', pp: `${MERGE_PP_PREFIXES.J[0]}_OLD`, layerid: '' },
  afterId: null,
  after: { process_id: 'PROC_X1', sp: 'SP02', sd: 'SD02', pp: `${MERGE_PP_PREFIXES.J[0]}_NEW`, layerid: '' },
  kind: 'changed',
};

const NONE_JAYER_ROWS = [{
  id: 'j1', updated: '', sortOrder: 1, process_id: 'PROC_X1', sp: 'SP02', sd: 'SD02', pp: `${MERGE_PP_PREFIXES.J[0]}_NEW`,
  layerid: 'L02', st: 'O', new_or_copy: '신규', product_name: '', step: '', item_id: '', loaded: true,
}];

const baseDetail = {
  request_purpose: '신규',
  other_purpose: [] as string[],
  line: '라인1',
  process_selection: 'RECIPE_A',
  partid_selection: 'PART_1000',
  process_id: 'PROC_X1',
  customer_name: '고객사A',
  customer_requirement: '요구사항 텍스트',
  flow_chart: [],
  map_type: 'NEW',
  only_prodc: 'No',
  notifiers: [],
  post_approvers: [],
};

function makeDoc(detailOverride: Record<string, unknown>, jayerRows: unknown[] = []) {
  return {
    id: 1,
    status: 'draft',
    title: '기존 제목',
    requester_name: '원작성자',
    requester_email: 'orig@example.com',
    requester_department: '원부서',
    product_name: 'PART_1000',
    production_date: '2026-09-01',
    reference_materials: '',
    additional_notes: JSON.stringify({
      detail: { ...baseDetail, ...detailOverride },
      jayerRows,
      oayerRows: [],
      bbRows: [],
      history: [],
      mergeSnapshot: null,
    }),
    approval_steps: [],
  };
}

const flush = async (times = 20) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

const modeRadio = (value: 'ref' | 'none') =>
  document.querySelector(`input[name="merge_ref_mode"][value="${value}"]`) as HTMLInputElement;

/** 지금 STEP1(의뢰 상세)에 머물러 있는가 */
const onStep1 = () =>
  (document.querySelector('.form-section-title')?.textContent ?? '').includes(i18n.t('request.section_detail'));

const errorToasts = () =>
  Array.from(document.querySelectorAll('.toast-error')).map((el) => el.textContent ?? '').join('\n');

async function renderStep1(detailOverride: Record<string, unknown>, jayerRows: unknown[] = []) {
  mockState.doc = makeDoc(detailOverride, jayerRows);
  render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flush();
}

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('요소를 찾지 못했다');
  await act(async () => { el.click(); });
  await flush(3);
}

const clickNext = () => click(buttonWith('다음 →'));

const REQUIRED_MSG = () => i18n.t('request.ba_gate_overlay_merge_required');
const EMPTY_MSG = () => i18n.t('request.ba_gate_manual_empty');

describe("'Overlay만 변경' — 참조 요청서 필수", () => {
  beforeEach(() => { localStorage.clear(); });

  it("기본값은 '참조 요청서 있음'이다", async () => {
    await renderStep1({ other_purpose: [OTHER_PURPOSE_OVERLAY] });
    expect(modeRadio('ref').checked).toBe(true);
    expect(modeRadio('none').checked).toBe(false);
  });

  it("'있음'에서 Merge 하지 않으면 STEP1 을 넘어가지 못하고 오류를 표시한다", async () => {
    await renderStep1({ other_purpose: [OTHER_PURPOSE_OVERLAY] });
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(REQUIRED_MSG());
    expect(document.querySelector('.form-error')?.textContent).toBe(REQUIRED_MSG());
  });

  it("구 값 'Overlay 변경' 문서도 같은 규칙으로 막는다", async () => {
    await renderStep1({ other_purpose: [OTHER_PURPOSE_OVERLAY_LEGACY] });
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(REQUIRED_MSG());
  });

  it("'있음'으로 Merge 했어도 변경전/변경후 유효 행이 0건이면 막는다", async () => {
    await renderStep1({
      other_purpose: [OTHER_PURPOSE_OVERLAY],
      merge_ref_doc_id: 77, merge_ref_doc_label: '참조 요청서 제목', merge_ref_mode: 'ref', merge_applied: true,
      merge_pairs: [], merge_unmatched_before: [], merge_unmatched_after: [],
    });
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(EMPTY_MSG());
  });

  it("'있음'으로 Merge 하고 유효 행이 있으면 넘어간다", async () => {
    await renderStep1({
      other_purpose: [OTHER_PURPOSE_OVERLAY],
      merge_ref_doc_id: 77, merge_ref_doc_label: '참조 요청서 제목', merge_ref_mode: 'ref', merge_applied: true,
      merge_pairs: [VALID_PAIR], merge_unmatched_before: [], merge_unmatched_after: [],
    });
    await clickNext();
    expect(onStep1()).toBe(false);
  });

  it("'없음'으로 확정하면 빈 행만으로는 막고, 유효 행이 있으면 넘어간다", async () => {
    await renderStep1({ other_purpose: [OTHER_PURPOSE_OVERLAY] });
    await click(modeRadio('none'));
    await click(buttonWith(i18n.t('common.confirm')));
    expect(modeRadio('none').checked).toBe(true);
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(EMPTY_MSG());
    expect(errorToasts()).not.toContain(REQUIRED_MSG());
  });

  it("'없음' 확정 문서에서 유효 행이 있으면 넘어간다", async () => {
    await renderStep1({
      other_purpose: [OTHER_PURPOSE_OVERLAY],
      merge_ref_doc_id: null, merge_ref_mode: 'none', merge_applied: true,
      merge_pairs: [NONE_VALID_PAIR], merge_unmatched_before: [], merge_unmatched_after: [],
    }, NONE_JAYER_ROWS);
    await clickNext();
    expect(onStep1()).toBe(false);
  });

  it("'없음' 확정 후 '있음' 라디오는 열려 있고, 확인 모달을 거쳐 '있음'으로 바뀐다", async () => {
    await renderStep1({
      other_purpose: [OTHER_PURPOSE_OVERLAY],
      merge_ref_doc_id: null, merge_ref_mode: 'none', merge_applied: true,
      merge_pairs: [VALID_PAIR], merge_unmatched_before: [], merge_unmatched_after: [],
    });
    expect(modeRadio('ref').disabled).toBe(false);

    await click(modeRadio('ref'));
    expect(screen.getByText(i18n.t('request.merge_mode_change_confirm'))).toBeDefined();
    // 확인 전에는 아무것도 바뀌지 않는다.
    expect(modeRadio('none').checked).toBe(true);

    await click(buttonWith(i18n.t('common.confirm')));
    expect(modeRadio('ref').checked).toBe(true);
    // 변경전/변경후 내용이 비워지고 '있음' 미Merge 상태가 되므로 다시 막힌다.
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(REQUIRED_MSG());
  });

  it("'없음'→'있음' 모달에서 취소하면 '없음'이 그대로 유지된다", async () => {
    await renderStep1({
      other_purpose: [OTHER_PURPOSE_OVERLAY],
      merge_ref_doc_id: null, merge_ref_mode: 'none', merge_applied: true,
      merge_pairs: [NONE_VALID_PAIR], merge_unmatched_before: [], merge_unmatched_after: [],
    }, NONE_JAYER_ROWS);
    await click(modeRadio('ref'));
    await click(buttonWith(i18n.t('common.cancel')));
    expect(modeRadio('none').checked).toBe(true);
    await clickNext();
    expect(onStep1()).toBe(false);
  });

  it("'있음'으로 Merge 확정한 뒤에는 라디오가 잠긴다(기존대로 '재선택' 사용)", async () => {
    await renderStep1({
      other_purpose: [OTHER_PURPOSE_OVERLAY],
      merge_ref_doc_id: 77, merge_ref_doc_label: '참조 요청서 제목', merge_ref_mode: 'ref', merge_applied: true,
      merge_pairs: [VALID_PAIR], merge_unmatched_before: [], merge_unmatched_after: [],
    });
    expect(modeRadio('ref').disabled).toBe(true);
    expect(modeRadio('none').disabled).toBe(true);
  });

  it("'Layer 추가/삭제'는 참조 요청서 없이도 넘어간다(선택사항 유지)", async () => {
    await renderStep1({ other_purpose: [LAYER_ADD_DELETE] });
    await clickNext();
    expect(onStep1()).toBe(false);
    expect(errorToasts()).not.toContain(REQUIRED_MSG());
  });
});
