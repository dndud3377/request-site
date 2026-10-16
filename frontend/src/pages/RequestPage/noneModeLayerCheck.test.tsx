/**
 * 참조 요청서 '없음' 모드 — 변경전/변경후 표 ↔ 현재 J/O-layer 표 대조 테스트.
 *
 * claude 수정 (2026-10-16): '없음' 모드에서 직접 입력한 값을 J/O 표 기준으로 검증한다(표 → J/O 단방향, 검증만).
 * - 행의 구분(J/O)은 PP 접두사로 자동 판정한다(드롭다운 없음). 판정 불가·구분 불일치는 '다음'을 막는다.
 * - 변경전 값은 그 구분의 표에 없어야, 변경후 값은 있어야 한다. 어기면 '다음'을 막는다.
 * - '있음' 모드는 검사하지 않고 구분 드롭다운도 그대로다.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { MERGE_PP_PREFIXES } from './constants';

// jsdom 에는 scrollIntoView 구현이 없다 — 검증 실패 시 앱이 오류 셀로 스크롤하는 동작을 no-op 처리.
window.HTMLElement.prototype.scrollIntoView = () => {};

const mockState: { doc: unknown; captured: unknown } = { doc: null, captured: null };

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
const J_PREFIX = MERGE_PP_PREFIXES.J[0];
const O_PREFIX = MERGE_PP_PREFIXES.O[0];

type Side = { process_id: string; sp: string; sd: string; pp: string; layerid: string } | null;

const side = (pp: string, sp = 'SP01'): Side => ({ process_id: 'PROC_X1', sp, sd: 'SD01', pp, layerid: '' });

const manualPair = (before: Side, after: Side, table: 'J' | 'O' = 'J') => ({
  id: 'pair_manual_1', table, beforeId: null, before, afterId: null, after, kind: 'changed',
});

const layerRow = (id: string, pp: string, sp = 'SP01') => ({
  id, updated: '', sortOrder: 1, process_id: 'PROC_X1', sp, sd: 'SD01', pp,
  layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '', step: '', item_id: '', loaded: true,
});

// J 표에는 J_IN, O 표에는 O_IN 이 있다.
const J_IN = `${J_PREFIX}_IN`;
const J_OUT = `${J_PREFIX}_OUT`;
const O_IN = `${O_PREFIX}_IN`;
const O_OUT = `${O_PREFIX}_OUT`;
const JAYER = [layerRow('j1', J_IN)];
const OAYER = [layerRow('o1', O_IN)];

const baseDetail = {
  request_purpose: '신규',
  other_purpose: [LAYER_ADD_DELETE],
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

const noneDetail = (pair: unknown) => ({
  merge_ref_doc_id: null, merge_ref_mode: 'none', merge_applied: true,
  merge_pairs: [pair], merge_unmatched_before: [], merge_unmatched_after: [],
});

function makeDoc(detailOverride: Record<string, unknown>) {
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
      jayerRows: JAYER,
      oayerRows: OAYER,
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

const onStep1 = () =>
  (document.querySelector('.form-section-title')?.textContent ?? '').includes(i18n.t('request.section_detail'));

const errorToasts = () =>
  Array.from(document.querySelectorAll('.toast-error')).map((el) => el.textContent ?? '').join('\n');

/** 확정 표 첫 행의 '구분' 칸 */
const divisionCell = () => document.querySelector('.ba-result-table tbody tr td') as HTMLTableCellElement;

/**
 * 확정 표 첫 행의 한쪽 입력칸 4개(process_id·SP·SD·PP).
 * 미등록인 쪽은 입력칸 없이 한 칸으로 합쳐지므로, 변경전은 앞 4개·변경후는 뒤 4개로 고른다.
 */
const sideInputs = (s: 'before' | 'after') => {
  const inputs = Array.from(document.querySelectorAll('.ba-result-table tbody tr:first-child input.ba-cell-input')) as HTMLInputElement[];
  return s === 'before' ? inputs.slice(0, 4) : inputs.slice(-4);
};

async function renderStep1(detailOverride: Record<string, unknown>) {
  mockState.doc = makeDoc(detailOverride);
  mockState.captured = null;
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

async function clickNext() {
  const btn = buttonWith('다음 →');
  if (!btn) throw new Error('다음 버튼을 찾지 못했다');
  await act(async () => { btn.click(); });
  await flush(3);
}

describe("참조 요청서 '없음' — 변경전/변경후 ↔ J/O 표 대조", () => {
  beforeEach(() => { localStorage.clear(); });

  it('변경전은 표에 없고 변경후는 표에 있으면 넘어간다(J)', async () => {
    await renderStep1(noneDetail(manualPair(side(J_OUT), side(J_IN))));
    await clickNext();
    expect(onStep1()).toBe(false);
  });

  it('O 접두사 행은 O 표와 대조한다', async () => {
    await renderStep1(noneDetail(manualPair(side(O_OUT), side(O_IN), 'J')));
    await clickNext();
    expect(onStep1()).toBe(false);
  });

  it('구분은 드롭다운 없이 PP 접두사로 판정한 값을 보여준다', async () => {
    // 저장된 구분이 J 여도 PP 가 O 접두사면 O 로 판정한다.
    await renderStep1(noneDetail(manualPair(null, side(O_IN), 'J')));
    expect(divisionCell().querySelector('select')).toBeNull();
    expect(divisionCell().textContent).toBe(i18n.t('request.oayer'));
  });

  it('저장된 구분이 PP 접두사와 다르면 불러올 때 맞춰서 저장한다(상세보기·내보내기용)', async () => {
    await renderStep1(noneDetail(manualPair(null, side(O_IN), 'J')));
    const saveBtn = buttonWith(i18n.t('request.save_draft'));
    if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
    await act(async () => { saveBtn.click(); });
    await waitFor(() => expect(mockState.captured).not.toBeNull());
    const notes = JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
    expect(notes.detail.merge_pairs[0].table).toBe('O');
  });

  it('PP 를 바꾸면 구분도 다시 판정된다', async () => {
    await renderStep1(noneDetail(manualPair(null, side(J_IN))));
    expect(divisionCell().textContent).toBe(i18n.t('request.jayer'));
    const ppInput = sideInputs('after')[3];
    await act(async () => { fireEvent.change(ppInput, { target: { value: O_IN } }); });
    await flush(3);
    expect(divisionCell().textContent).toBe(i18n.t('request.oayer'));
  });

  it('PP 접두사로 구분을 판정할 수 없으면 막는다', async () => {
    await renderStep1(noneDetail(manualPair(null, side('PP01'))));
    expect(divisionCell().textContent).toBe(i18n.t('request.ba_table_unknown'));
    expect(sideInputs('after')[3].classList.contains('ba-cell-input-error')).toBe(true);
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(i18n.t('request.ba_gate_none_pp_unknown', { count: 1 }));
  });

  it('변경전·변경후 PP 의 구분이 다르면 막는다', async () => {
    await renderStep1(noneDetail(manualPair(side(J_OUT), side(O_IN))));
    expect(divisionCell().textContent).toBe(i18n.t('request.ba_table_mismatch'));
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(i18n.t('request.ba_gate_none_pp_mismatch', { count: 1 }));
  });

  it('변경전 값이 지금 J 표에 있으면 막고 변경전 칸을 오류로 표시한다', async () => {
    await renderStep1(noneDetail(manualPair(side(J_IN), null)));
    expect(sideInputs('before').every((el) => el.classList.contains('ba-cell-input-error'))).toBe(true);
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(i18n.t('request.ba_gate_none_before_exists', { count: 1 }));
  });

  it('변경후 값이 지금 J 표에 없으면 막고 변경후 칸을 오류로 표시한다', async () => {
    await renderStep1(noneDetail(manualPair(null, side(J_OUT))));
    expect(sideInputs('after').every((el) => el.classList.contains('ba-cell-input-error'))).toBe(true);
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(i18n.t('request.ba_gate_none_after_missing', { count: 1 }));
  });

  it("'있음' 모드는 J/O 표와 대조하지 않고 구분 드롭다운도 그대로다", async () => {
    // 같은 값이라도 '있음'(Merge 확정)이면 검사 대상이 아니다.
    await renderStep1({
      merge_ref_doc_id: 77, merge_ref_doc_label: '참조 요청서 제목', merge_ref_mode: 'ref', merge_applied: true,
      merge_pairs: [manualPair(side('PP01'), side(J_OUT))], merge_unmatched_before: [], merge_unmatched_after: [],
    });
    expect(divisionCell().querySelector('select')).not.toBeNull();
    await clickNext();
    expect(onStep1()).toBe(false);
  });
});
