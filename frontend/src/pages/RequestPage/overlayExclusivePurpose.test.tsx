/**
 * 상세 목적 'Overlay만 변경' 단독 선택 테스트.
 *
 * claude 수정 (2026-10-15): 'Overlay 변경' → 'Overlay만 변경' 으로 이름·저장값을 바꾸고, 다른 상세 목적과
 * 함께 고를 수 없게 했다. 충돌하는 클릭은 확인 모달을 띄우고, 확인하면 반대쪽 선택을 해제한다(취소하면 그대로).
 * 2026-10-15 이전 값('Overlay 변경')으로 저장된 문서는 불러올 때 건드리지 않고, 같은 버튼으로 표시·해제한다.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { OTHER_PURPOSE_OVERLAY, OTHER_PURPOSE_OVERLAY_LEGACY } from './constants';

const mockState: { captured: unknown | null; doc: unknown } = { captured: null, doc: null };

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

const FIRSTA = 'FirstA 변경';
const STEPSEQ = 'STEPSEQ 변경';
const B_CHANGE = 'B 변경';

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

function makeDoc(otherPurpose: string[]) {
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
      detail: { ...baseDetail, other_purpose: otherPurpose },
      jayerRows: [],
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

/** 상세 목적 버튼(.map-type-btn) 중 문구가 정확히 일치하는 것 */
const purposeBtn = (text: string) =>
  Array.from(document.querySelectorAll('button.map-type-btn')).find((b) => b.textContent === text) as HTMLButtonElement;

const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

async function renderStep1(otherPurpose: string[]) {
  mockState.doc = makeDoc(otherPurpose);
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

async function click(btn: HTMLButtonElement | undefined) {
  if (!btn) throw new Error('버튼을 찾지 못했다');
  await act(async () => { btn.click(); });
  await flush(3);
}

const modalTitle = () => screen.queryByText(i18n.t('request.overlay_exclusive_confirm_title'));

async function savedOtherPurpose(): Promise<string[]> {
  mockState.captured = null;
  await click(buttonWith('💾'));
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  const payload = mockState.captured as { additional_notes: string };
  return JSON.parse(payload.additional_notes).detail.other_purpose;
}

describe("상세 목적 'Overlay만 변경'은 단독으로만 선택된다", () => {
  beforeEach(() => {
    mockState.captured = null;
    localStorage.clear();
  });

  it("버튼 이름이 'Overlay만 변경'이고 'Overlay 변경' 버튼은 없다", async () => {
    await renderStep1([]);
    expect(purposeBtn(OTHER_PURPOSE_OVERLAY)).toBeDefined();
    expect(purposeBtn(OTHER_PURPOSE_OVERLAY_LEGACY)).toBeUndefined();
  });

  it('다른 목적이 선택된 상태에서 Overlay만 변경 → 확인하면 Overlay만 남는다', async () => {
    await renderStep1([FIRSTA, STEPSEQ]);
    await click(purposeBtn(OTHER_PURPOSE_OVERLAY));

    expect(modalTitle()).not.toBeNull();
    expect(screen.getByText(i18n.t('request.overlay_exclusive_to_overlay_msg', { list: `${FIRSTA}, ${STEPSEQ}` }))).toBeDefined();

    await click(buttonWith(i18n.t('common.confirm')));
    expect(modalTitle()).toBeNull();
    expect(await savedOtherPurpose()).toEqual([OTHER_PURPOSE_OVERLAY]);
  });

  it('다른 목적이 선택된 상태에서 Overlay만 변경 → 취소하면 그대로다', async () => {
    await renderStep1([FIRSTA]);
    await click(purposeBtn(OTHER_PURPOSE_OVERLAY));
    await click(buttonWith(i18n.t('common.cancel')));

    expect(modalTitle()).toBeNull();
    expect(await savedOtherPurpose()).toEqual([FIRSTA]);
  });

  it('Overlay만 변경이 선택된 상태에서 다른 목적 → 확인하면 Overlay가 빠지고 누른 항목이 선택된다', async () => {
    await renderStep1([OTHER_PURPOSE_OVERLAY]);
    await click(purposeBtn(B_CHANGE));

    expect(screen.getByText(i18n.t('request.overlay_exclusive_from_overlay_msg', { target: B_CHANGE }))).toBeDefined();
    await click(buttonWith(i18n.t('common.confirm')));
    expect(await savedOtherPurpose()).toEqual([B_CHANGE]);
  });

  it('Overlay만 변경이 선택된 상태에서 다른 목적 → 취소하면 그대로다', async () => {
    await renderStep1([OTHER_PURPOSE_OVERLAY]);
    await click(purposeBtn(B_CHANGE));
    await click(buttonWith(i18n.t('common.cancel')));
    expect(await savedOtherPurpose()).toEqual([OTHER_PURPOSE_OVERLAY]);
  });

  it('충돌이 없는 선택·해제는 모달 없이 바로 반영된다', async () => {
    await renderStep1([]);
    await click(purposeBtn(FIRSTA));
    await click(purposeBtn(STEPSEQ));
    expect(modalTitle()).toBeNull();
    await click(purposeBtn(FIRSTA));
    expect(modalTitle()).toBeNull();
    await click(purposeBtn(OTHER_PURPOSE_OVERLAY));
    // STEPSEQ 가 남아 있으므로 충돌 → 모달. 빈 상태에서 Overlay 만 누르는 경우는 아래에서 확인한다.
    expect(modalTitle()).not.toBeNull();
  });

  it('빈 상태에서 Overlay만 변경을 누르고 다시 누르면 모달 없이 선택·해제된다', async () => {
    await renderStep1([]);
    await click(purposeBtn(OTHER_PURPOSE_OVERLAY));
    expect(modalTitle()).toBeNull();
    expect(await savedOtherPurpose()).toEqual([OTHER_PURPOSE_OVERLAY]);
    await click(purposeBtn(OTHER_PURPOSE_OVERLAY));
    expect(await savedOtherPurpose()).toEqual([]);
  });

  it("구 값 'Overlay 변경' + 다른 목적 문서: 불러올 때 값을 건드리지 않고 Overlay만 변경 버튼이 선택 상태로 보인다", async () => {
    await renderStep1([OTHER_PURPOSE_OVERLAY_LEGACY, STEPSEQ]);
    expect(purposeBtn(OTHER_PURPOSE_OVERLAY).className).toContain('active');
    expect(await savedOtherPurpose()).toEqual([OTHER_PURPOSE_OVERLAY_LEGACY, STEPSEQ]);
  });

  it("구 값 'Overlay 변경' 문서: Overlay만 변경 버튼을 누르면 구 값이 해제된다", async () => {
    await renderStep1([OTHER_PURPOSE_OVERLAY_LEGACY]);
    await click(purposeBtn(OTHER_PURPOSE_OVERLAY));
    expect(modalTitle()).toBeNull();
    expect(await savedOtherPurpose()).toEqual([]);
  });

  it("구 값 'Overlay 변경' 문서: 다른 목적을 누르면 확인 후 구 값이 빠진다", async () => {
    await renderStep1([OTHER_PURPOSE_OVERLAY_LEGACY]);
    await click(purposeBtn(FIRSTA));
    expect(modalTitle()).not.toBeNull();
    await click(buttonWith(i18n.t('common.confirm')));
    expect(await savedOtherPurpose()).toEqual([FIRSTA]);
  });
});
