/**
 * 참조 요청서 '있음'(Merge) 잠금 테스트 — MERGE_REF_MODE_ENABLED = false.
 *
 * claude 수정 (2026-10-19): 참조할 승인 요청서가 아직 적고 '있음/없음' 선택·Merge 단계가 번거로워 '있음'을 잠갔다.
 * - Merge 사용 목적을 누르면 곧바로 '없음'으로 확정되고 변경전/변경후 표(빈 행 1개)가 열린다.
 * - '있음' 라디오·참조 요청서 검색칸·Merge·재선택은 회색으로 잠기고 마우스를 올리면 '기능 수정 중'이 보인다.
 * - 예전에 '있음'으로 Merge 해 저장한 문서는 '없음'으로 바뀌며 변경전/변경후 행은 남고 매핑 대기 목록만 비워진다.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { MERGE_PP_PREFIXES } from './constants';

// claude 수정 (2026-10-16): main 병합으로 '다음'/'이전' 버튼 문구가 i18n 이 되어, jsdom 기본 언어(en)가 아닌 한국어로 고정한다.
beforeAll(async () => { await i18n.changeLanguage('ko'); });

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

const lockedTitle = () => i18n.t('request.merge_ref_locked');

const modeRadio = (value: 'ref' | 'none') =>
  document.querySelector(`input[name="merge_ref_mode"][value="${value}"]`) as HTMLInputElement;

const purposeButton = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement | undefined;

const resultRows = () => document.querySelectorAll('.ba-result-table tbody tr');

describe("참조 요청서 '있음' 잠금", () => {
  beforeEach(() => { localStorage.clear(); });

  it("Merge 사용 목적을 누르면 '없음'으로 확정되고 변경전/변경후 표가 바로 열린다", async () => {
    await renderStep1({ other_purpose: [], merge_ref_mode: 'ref', merge_applied: false, merge_pairs: [] });
    expect(document.querySelector('.ba-result-table')).toBeNull();
    const btn = purposeButton(LAYER_ADD_DELETE);
    if (!btn) throw new Error('상세 목적 버튼을 찾지 못했다');
    await act(async () => { btn.click(); });
    await flush(3);
    expect(modeRadio('none').checked).toBe(true);
    expect(modeRadio('ref').checked).toBe(false);
    expect(resultRows().length).toBe(1);
    expect(document.querySelector('.ba-note')?.textContent).toBe(i18n.t('request.ba_none_check_hint'));
  });

  it("'있음' 라디오·검색칸·Merge·재선택은 잠기고 '기능 수정 중' 툴팁이 달린다", async () => {
    await renderStep1(noneDetail(manualPair(null, side(J_IN))));
    expect(modeRadio('ref').disabled).toBe(true);
    expect(modeRadio('ref').closest('label')?.getAttribute('title')).toBe(lockedTitle());
    expect(modeRadio('none').closest('label')?.getAttribute('title')).toBeNull();

    const mergeBtn = buttonWith(i18n.t('request.merge_button'));
    const reselectBtn = buttonWith(i18n.t('request.merge_reselect'));
    [mergeBtn, reselectBtn].forEach((b) => {
      expect(b?.disabled).toBe(true);
      expect(b?.parentElement?.getAttribute('title')).toBe(lockedTitle());
    });
    const refInput = screen.getByDisplayValue(i18n.t('request.merge_ref_none')) as HTMLInputElement;
    expect(refInput.disabled).toBe(true);
    expect(refInput.closest(`[title="${lockedTitle()}"]`)).not.toBeNull();
    // '재선택을 누르세요' 안내는 잠금 중에는 맞지 않아 숨긴다.
    expect(document.body.textContent).not.toContain(i18n.t('request.merge_none_done'));
  });

  // claude 수정 (2026-10-19): '없음' 표는 layer 컬럼·Merge 요약 줄 없이 '변경전'/'변경후' 머리글로 그린다
  it("'없음' 표는 layer 컬럼과 Merge 요약 줄이 없고 머리글은 '변경전'/'변경후'다", async () => {
    await renderStep1(noneDetail(manualPair(side(J_OUT), side(J_IN))));
    const headers = Array.from(document.querySelectorAll('.ba-result-table thead th')).map((th) => th.textContent);
    expect(headers).not.toContain(i18n.t('request.col_layer'));
    expect(headers).toContain(i18n.t('request.ba_before_col_manual'));
    expect(headers).toContain(i18n.t('request.ba_after_col_manual'));
    expect(headers).not.toContain(i18n.t('request.ba_before_col'));
    expect(document.querySelector('.ba-summary')).toBeNull();
    expect(document.querySelectorAll('.ba-result-table tbody tr:first-child td')).toHaveLength(11);
  });

  it("'있음' 라디오를 눌러도 모드 변경 모달이 뜨지 않고 '없음'이 유지된다", async () => {
    await renderStep1(noneDetail(manualPair(null, side(J_IN))));
    await act(async () => { modeRadio('ref').click(); });
    await flush(3);
    expect(screen.queryByText(i18n.t('request.merge_mode_change_confirm'))).toBeNull();
    expect(modeRadio('none').checked).toBe(true);
  });

  it("예전 '있음' 문서는 '없음'으로 바뀌고 변경전/변경후 행은 남으며 매핑 대기 목록은 비워진다", async () => {
    await renderStep1({
      merge_ref_doc_id: 77, merge_ref_doc_label: '참조 요청서 제목', merge_ref_mode: 'ref', merge_applied: true,
      merge_pairs: [manualPair(side(J_OUT), side(J_IN))],
      merge_unmatched_before: [{ id: 'J_b2', table: 'J', ...side(`${J_PREFIX}_B2`) }],
      merge_unmatched_after: [{ id: 'J_a2', table: 'J', ...side(`${J_PREFIX}_A2`) }],
    });
    expect(modeRadio('none').checked).toBe(true);
    expect(resultRows().length).toBe(1);
    expect(sideInputs('before')[3].value).toBe(J_OUT);
    expect(sideInputs('after')[3].value).toBe(J_IN);

    const saveBtn = buttonWith(i18n.t('request.save_draft'));
    if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
    await act(async () => { saveBtn.click(); });
    await waitFor(() => expect(mockState.captured).not.toBeNull());
    const notes = JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
    expect(notes.detail.merge_ref_mode).toBe('none');
    expect(notes.detail.merge_applied).toBe(true);
    expect(notes.detail.merge_ref_doc_id).toBeNull();
    expect(notes.detail.merge_pairs).toHaveLength(1);
    expect(notes.detail.merge_unmatched_before).toEqual([]);
    expect(notes.detail.merge_unmatched_after).toEqual([]);

    // 매핑 대기 목록이 비워졌으므로 '없음' 규칙만 통과하면 넘어간다.
    await clickNext();
    expect(onStep1()).toBe(false);
  });

  it("예전 '있음' 문서의 행도 '없음' 규칙(J/O 표 대조)을 받는다", async () => {
    await renderStep1({
      merge_ref_doc_id: 77, merge_ref_doc_label: '참조 요청서 제목', merge_ref_mode: 'ref', merge_applied: true,
      merge_pairs: [manualPair(null, side(J_OUT))], merge_unmatched_before: [], merge_unmatched_after: [],
    });
    await clickNext();
    expect(onStep1()).toBe(true);
    expect(errorToasts()).toContain(i18n.t('request.ba_gate_none_after_missing', { count: 1 }));
  });
});
