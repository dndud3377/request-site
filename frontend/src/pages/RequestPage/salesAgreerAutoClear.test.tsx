/**
 * 영업/기술지원 합의자(SA) 자동 초기화 재현 테스트.
 *
 * 배경: 예외 구역을 '변경 있음' + 기본값과 다른 값으로 두고 SA 를 지정한 뒤 '변경 없음'으로 돌리면
 * 합의자 블록이 사라지는데도 `salesAgreers` 상태가 남아 SA 단계가 상신됐다(사용자가 볼 수도 지울 수도 없다).
 * 이제 합의자가 필수였다가 필수가 아니게 되는 순간 지정·검색어·미지정 사유·'합의자 없음' 체크가 모두 초기화된다.
 *
 * Only MAP 은 MAP 정보(2단계)가 마지막 단계이고 예외 구역 입력칸이 열려 있어 한 화면에서 전 과정을 재현한다.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

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
  usersAPI: { list: () => Promise.resolve({ data: [{ loginid: 'pl1', name: 'PL담당자', role: 'PL' }] }) },
  addressBooksAPI: { list: () => Promise.resolve([]) },
  userGroupsAPI: { list: () => Promise.resolve([]) },
  layerSdExceptionsAPI: { list: () => Promise.resolve([]) },
}));

const LINE = '라인1';
const PROCESS = 'RECIPE_A';
const PRODUCT = 'PART_1000';
const PROCESS_ID = 'PROC_X1';
const SA_NAME = 'PL담당자';
const EA_CUSTOM_VALUE = '350';
const SA_NONE_REASON = '해당 없음 사유';

const baseDetail = {
  request_purpose: 'Only MAP',
  other_purpose: [],
  line: LINE,
  process_selection: PROCESS,
  partid_selection: PRODUCT,
  process_id: PROCESS_ID,
  customer_name: '고객사A',
  customer_requirement: '요구사항 텍스트',
  flow_chart: [],
  map_type: 'NEW',
  map_change: '변경 없음',
  map_change_reason: '<p>MAP 변경 이유</p>',
  ea_change: '변경 있음',
  ea_value: EA_CUSTOM_VALUE,
  only_prodc: 'No',
  notifiers: [],
  post_approvers: [],
};

function makeDoc(extra: Record<string, unknown>) {
  return {
    id: 1,
    status: 'draft',
    title: '기존 제목',
    requester_name: '원작성자',
    requester_email: 'orig@example.com',
    requester_department: '원부서',
    product_name: PRODUCT,
    production_date: '2026-09-01',
    reference_materials: '',
    additional_notes: JSON.stringify({
      detail: { ...baseDetail, ...extra },
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
    // 매크로태스크까지 양보해야 옵션 로드 effect 체인이 끝난다(다른 RequestPage 테스트와 동일).
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

const buttonWith = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

/** 편집 모드로 띄워 MAP 정보(2단계)까지 이동한다. */
async function renderAtMapStep() {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flush();
  const next = buttonWith('다음');
  if (!next) throw new Error('다음 버튼을 찾지 못했다');
  await act(async () => { next.click(); });
  await waitFor(() => expect(buttonWith('📤')).toBeDefined());
}

const eaChangeSelect = () => document.querySelector('select[name="ea_change"]') as HTMLSelectElement;
const eaValueInput = () => document.querySelector('input[name="ea_value"]') as HTMLInputElement;

/** 예외 구역: 변경 없음 → 변경 있음 + 기본값과 다른 값(SA 필수 → 필수 아님 → 다시 필수). */
async function toggleEaOffAndBackOn() {
  await act(async () => { fireEvent.change(eaChangeSelect(), { target: { value: '변경 없음' } }); });
  await flush(3);
  await act(async () => { fireEvent.change(eaChangeSelect(), { target: { value: '변경 있음' } }); });
  await flush(3);
  await act(async () => { fireEvent.change(eaValueInput(), { target: { value: EA_CUSTOM_VALUE } }); });
  await flush(3);
}

async function saveDraftAndCaptureDetail(): Promise<Record<string, unknown>> {
  mockState.captured = null;
  const saveBtn = buttonWith('💾');
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { saveBtn.click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  const payload = mockState.captured as { additional_notes: string };
  return JSON.parse(payload.additional_notes).detail;
}

async function openSubmitModal() {
  await act(async () => { buttonWith('📤')!.click(); });
  await waitFor(() => expect(document.querySelector('[data-tour="submit-agreer"]')).not.toBeNull());
}

const noneCheckbox = () =>
  document.querySelector('[data-tour="submit-agreer"] input[type="checkbox"]') as HTMLInputElement;

describe('합의자가 필수에서 필수 아님으로 바뀌면 SA 지정·사유·체크가 모두 초기화된다', () => {
  beforeEach(() => {
    mockState.captured = null;
    localStorage.clear();
  });

  it('SA 를 지정해 둔 문서: 변경 없음으로 돌리면 저장 payload 의 sales_agreers 가 비워진다(되돌려도 복구되지 않는다)', async () => {
    mockState.doc = makeDoc({ sales_agreers: [{ loginid: 'pl1', name: SA_NAME }] });
    await renderAtMapStep();

    // 불러온 지정이 상태에 들어 있다(전제 확인).
    expect((await saveDraftAndCaptureDetail()).sales_agreers).toEqual([{ loginid: 'pl1', name: SA_NAME }]);

    await act(async () => { fireEvent.change(eaChangeSelect(), { target: { value: '변경 없음' } }); });
    await flush(3);
    expect((await saveDraftAndCaptureDetail()).sales_agreers).toEqual([]);

    // 다시 SA 필수 상태가 돼도 이전 지정이 되살아나지 않는다.
    await act(async () => { fireEvent.change(eaChangeSelect(), { target: { value: '변경 있음' } }); });
    await flush(3);
    await act(async () => { fireEvent.change(eaValueInput(), { target: { value: EA_CUSTOM_VALUE } }); });
    await flush(3);
    await openSubmitModal();
    expect(screen.queryByText(SA_NAME)).toBeNull();
  });

  it('값을 기본값으로 되돌려도(변경 있음 유지) SA 지정이 초기화된다', async () => {
    mockState.doc = makeDoc({ sales_agreers: [{ loginid: 'pl1', name: SA_NAME }] });
    await renderAtMapStep();

    await act(async () => { fireEvent.change(eaValueInput(), { target: { value: '300' } }); });
    await flush(3);
    expect((await saveDraftAndCaptureDetail()).sales_agreers).toEqual([]);
  });

  it("'합의자 없음'+사유를 입력해 둔 문서: 필수가 아니게 됐다가 다시 필수가 되면 체크·사유가 비어 있다", async () => {
    mockState.doc = makeDoc({ sales_agreers: [], sales_agreer_none_reason: SA_NONE_REASON });
    await renderAtMapStep();

    // 전제: 불러온 사유가 복원돼 체크돼 있고 사유 입력칸에 값이 있다.
    await openSubmitModal();
    expect(noneCheckbox().checked).toBe(true);
    expect(screen.getByDisplayValue(SA_NONE_REASON)).toBeDefined();
    // 모달을 닫고 예외 구역을 돌린다.
    const cancel = buttonWith(i18n.t('common.cancel'));
    if (!cancel) throw new Error('모달 취소 버튼을 찾지 못했다');
    await act(async () => { cancel.click(); });
    await flush(3);

    await toggleEaOffAndBackOn();
    await openSubmitModal();

    expect(noneCheckbox().checked).toBe(false);
    expect(screen.queryByDisplayValue(SA_NONE_REASON)).toBeNull();
    // 체크해도 사유 입력칸은 빈 값에서 시작한다.
    await act(async () => { noneCheckbox().click(); });
    const reasonInput = screen.getByPlaceholderText(i18n.t('request.sales_agreer_none_reason_placeholder')) as HTMLInputElement;
    expect(reasonInput.value).toBe('');
  });

  it('문서를 불러올 때는 저장된 SA 지정을 건드리지 않는다(필수 조건이 계속 true)', async () => {
    mockState.doc = makeDoc({ sales_agreers: [{ loginid: 'pl1', name: SA_NAME }] });
    await renderAtMapStep();
    await openSubmitModal();
    expect(screen.getByText(SA_NAME)).toBeDefined();
  });
});
