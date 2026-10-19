/**
 * 참조 요청서 '없음' — 변경전/변경후 표의 구분·판정으로 상세 목적 자동 선택.
 *
 * claude 수정 (2026-10-19): 구분이 O 뿐이면 'Overlay만 변경' 단독(다른 상세 목적도 해제 — J 단계가 빠지는 축소 경로),
 * J 가 있으면 추가·삭제 → Layer 추가/삭제, 변경 → STEPSEQ 변경. 자동 선택 중에는 해당 버튼을 잠근다.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { MERGE_PP_PREFIXES, OPTION_OTHER_PURPOSE, OTHER_PURPOSE_LAYER, OTHER_PURPOSE_STEPSEQ, OTHER_PURPOSE_OVERLAY } from './constants';

// 토스트·툴팁 문구를 한국어 기준으로 비교한다.
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

const FIRST_A = 'FirstA 변경';
const J_PREFIX = MERGE_PP_PREFIXES.J[0];
const O_PREFIX = MERGE_PP_PREFIXES.O[0];

type Side = { process_id: string; sp: string; sd: string; pp: string; layerid: string } | null;

const side = (pp: string, sp = 'SP01'): Side => ({ process_id: 'PROC_X1', sp, sd: 'SD01', pp, layerid: '' });

const manualPair = (before: Side, after: Side, id = 'pair_manual_1') => ({
  id, table: 'J', beforeId: null, before, afterId: null, after, kind: 'changed',
});

const layerRow = (id: string, pp: string, sp = 'SP01') => ({
  id, updated: '', sortOrder: 1, process_id: 'PROC_X1', sp, sd: 'SD01', pp,
  layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '', step: '', item_id: '', loaded: true,
});

// J 표에는 J_IN, O 표에는 O_IN 이 있다(변경후 값은 표에 있어야 하므로 변경후에 *_IN 을 쓴다).
const J_IN = `${J_PREFIX}_IN`;
const J_OUT = `${J_PREFIX}_OUT`;
const O_IN = `${O_PREFIX}_IN`;
const O_OUT = `${O_PREFIX}_OUT`;
const JAYER = [layerRow('j1', J_IN)];
const OAYER = [layerRow('o1', O_IN)];

const baseDetail = {
  request_purpose: '신규',
  other_purpose: [OTHER_PURPOSE_LAYER],
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

const noneDetail = (pairs: unknown[], otherPurpose: string[] = [OTHER_PURPOSE_LAYER]) => ({
  other_purpose: otherPurpose,
  merge_ref_doc_id: null, merge_ref_mode: 'none', merge_applied: true,
  merge_pairs: pairs, merge_unmatched_before: [], merge_unmatched_after: [],
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

/** 상세 목적 버튼(값 문자열로 찾는다) */
const purposeBtn = (val: string) =>
  Array.from(document.querySelectorAll('button.map-type-btn')).find((b) => b.textContent === val) as HTMLButtonElement;

/** 지금 선택된 상세 목적(같은 class 를 쓰는 요청 목적 버튼은 뺀다) */
const activePurposes = () =>
  Array.from(document.querySelectorAll('button.map-type-btn.active'))
    .map((b) => b.textContent ?? '')
    .filter((v) => (OPTION_OTHER_PURPOSE as readonly string[]).includes(v))
    .sort();

const infoToasts = () =>
  Array.from(document.querySelectorAll('.toast-info')).map((el) => el.textContent ?? '').join('\n');

async function savedOtherPurpose(): Promise<string[]> {
  const saveBtn = buttonWith(i18n.t('request.save_draft'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { saveBtn.click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  return JSON.parse((mockState.captured as { additional_notes: string }).additional_notes).detail.other_purpose;
}

describe("참조 요청서 '없음' — 표의 구분·판정으로 상세 목적 자동 선택", () => {
  beforeEach(() => { localStorage.clear(); });

  it('구분이 O 뿐이면(변경) Overlay만 변경 단독으로 바꾸고 다른 목적도 해제한 뒤 저장한다', async () => {
    await renderStep1(noneDetail([manualPair(side(O_OUT), side(O_IN))], [FIRST_A, OTHER_PURPOSE_LAYER]));
    expect(activePurposes()).toEqual([OTHER_PURPOSE_OVERLAY]);
    expect(infoToasts()).toContain(i18n.t('request.toast_other_purpose_auto', { list: OTHER_PURPOSE_OVERLAY }));
    expect(await savedOtherPurpose()).toEqual([OTHER_PURPOSE_OVERLAY]);
  });

  it('구분이 O 뿐이면 판정이 삭제여도 Overlay만 변경이다', async () => {
    await renderStep1(noneDetail([manualPair(side(O_OUT), null)]));
    expect(activePurposes()).toEqual([OTHER_PURPOSE_OVERLAY]);
  });

  it('Overlay만 변경 단독이 정해지면 모든 상세 목적 버튼을 잠그고 툴팁을 단다', async () => {
    await renderStep1(noneDetail([manualPair(null, side(O_IN))]));
    [FIRST_A, OTHER_PURPOSE_LAYER, OTHER_PURPOSE_STEPSEQ, OTHER_PURPOSE_OVERLAY].forEach((val) => {
      expect(purposeBtn(val).disabled).toBe(true);
      expect(purposeBtn(val).parentElement?.getAttribute('title')).toBe(i18n.t('request.other_purpose_auto_locked'));
    });
  });

  it('J 와 O 가 함께 있으면 Overlay만 변경을 해제하고 판정대로 Layer 추가/삭제·STEPSEQ 변경을 고른다', async () => {
    await renderStep1(noneDetail([
      manualPair(side(J_OUT), side(J_IN), 'pair_1'),
      manualPair(null, side(O_IN), 'pair_2'),
    ], [OTHER_PURPOSE_OVERLAY]));
    expect(activePurposes()).toEqual([OTHER_PURPOSE_LAYER, OTHER_PURPOSE_STEPSEQ].sort());
  });

  it('J 만 있고 판정이 변경뿐이면 STEPSEQ 변경만 고르고 Merge 와 무관한 목적은 그대로 둔다', async () => {
    await renderStep1(noneDetail([manualPair(side(J_OUT), side(J_IN))], [FIRST_A, OTHER_PURPOSE_LAYER]));
    expect(activePurposes()).toEqual([FIRST_A, OTHER_PURPOSE_STEPSEQ].sort());
    // Merge 사용 목적 버튼만 잠그고 FirstA 변경은 그대로 누를 수 있다.
    expect(purposeBtn(OTHER_PURPOSE_STEPSEQ).disabled).toBe(true);
    expect(purposeBtn(OTHER_PURPOSE_LAYER).disabled).toBe(true);
    expect(purposeBtn(OTHER_PURPOSE_OVERLAY).disabled).toBe(true);
    expect(purposeBtn(FIRST_A).disabled).toBe(false);
  });

  it('판정이 모두 미작성이면 상세 목적을 바꾸지 않고 버튼도 잠그지 않는다', async () => {
    await renderStep1(noneDetail([manualPair(null, null)], [OTHER_PURPOSE_STEPSEQ]));
    expect(activePurposes()).toEqual([OTHER_PURPOSE_STEPSEQ]);
    expect(purposeBtn(OTHER_PURPOSE_LAYER).disabled).toBe(false);
    const autoToastLead = i18n.t('request.toast_other_purpose_auto', { list: '@' }).split('@')[0];
    expect(infoToasts()).not.toContain(autoToastLead);
  });

  it('PP 를 바꿔 구분이 J → O 가 되면 곧바로 Overlay만 변경으로 바뀐다', async () => {
    await renderStep1(noneDetail([manualPair(null, side(J_IN))]));
    expect(activePurposes()).toEqual([OTHER_PURPOSE_LAYER]);
    const ppInput = sideInputs('after')[3];
    await act(async () => { fireEvent.change(ppInput, { target: { value: O_IN } }); });
    await flush(3);
    expect(activePurposes()).toEqual([OTHER_PURPOSE_OVERLAY]);
  });
});
