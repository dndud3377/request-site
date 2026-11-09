/**
 * claude 수정 (2026-11-09): 중복 상신 차단을 STEP1 '다음'에서도 한다 — 상신 시점에야 막혀 STEP2~5 작성 시간이 낭비되던 문제.
 *
 * - 신규·임시저장 문서: STEP1 '다음'에서 duplicate-check 를 호출하고, 중복이면 STEP1 에 머물며 안내 모달을 띄운다(완전 차단).
 * - 중복이 없거나 확인 API 가 실패하면(경고 토스트) STEP2 로 넘어간다 — 서버 submit 이 최종 안전망.
 * - 이미 결재 현황에 있는 문서(반려 재상신 등)는 확인하지 않는다.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

// jsdom 에는 scrollIntoView/scrollTo 구현이 없다 — 앱이 호출하는 스크롤 동작을 no-op 처리.
// eslint-disable-next-line @typescript-eslint/no-empty-function
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};

const LINE = '라인1';
const PROCESS = '조합법A';
const PRODUCT = '제품A';
const PROCESS_ID = 'PROC_DATA';
const DOC_ID = 1;

type DupResult = { id: number; title: string; status: string; requester_name: string; can_open: boolean } | null | 'error';

const mockState: {
  doc: unknown;
  dupResult: DupResult;
  dupCalls: Array<Record<string, unknown>>;
} = { doc: null, dupResult: null, dupCalls: [] };

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
    duplicateCheck: (params: Record<string, unknown>) => {
      mockState.dupCalls.push(params);
      if (mockState.dupResult === 'error') return Promise.reject(new Error('network'));
      return Promise.resolve({ data: { duplicate: mockState.dupResult } });
    },
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['조합법A']),
    getProducts: () => Promise.resolve(['제품A']),
    getProcessId: () => Promise.resolve(['PROC_DATA']),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: () => Promise.resolve([]),
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

async function flushEffects(times = 15) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const fixtureDetail = {
  request_purpose: '신규',
  line: LINE,
  process_selection: PROCESS,
  partid_selection: PRODUCT,
  process_id: PROCESS_ID,
  customer_name: '고객사A',
  customer_requirement: '요구사항 텍스트',
  other_purpose: [],
  flow_chart: [{ id: 'flow1', location: '', product_name: '', process_id: '', step_from: '', step_to: '' }],
  map_type: 'NEW',
  mshot_change_cc: 'not_exists',
  bb_zone: '없음',
  only_prodc: 'No',
  partial_shot: '계측 필요',
  tbvtlv_thickness: '',
  tbvtlv_entries: [],
  post_approvers: [],
  notifiers: [],
};

const makeDoc = (status: string, detail: Record<string, unknown> = fixtureDetail) => ({
  id: DOC_ID,
  status,
  title: '기존 제목',
  requester_name: '홍길동',
  requester_email: 'hong@example.com',
  requester_department: '개발팀',
  product_name: PRODUCT,
  production_date: '2026-09-01',
  reference_materials: '',
  additional_notes: JSON.stringify({ detail, jayerRows: [], oayerRows: [], bbRows: [], history: [] }),
  approval_steps: [],
});

const REJECTED_DUP = { id: 99, title: '반려된 기존 요청서', status: 'rejected', requester_name: '김철수', can_open: true };

async function renderDocAtStep1() {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: DOC_ID } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flushEffects(20);
}

/** 위저드에서 활성(active) 단계 번호(1부터). */
function activeStep(): number {
  const circles = Array.from(document.querySelectorAll('.wizard-step-circle'));
  const idx = circles.findIndex((c) => c.classList.contains('active'));
  if (idx < 0) throw new Error('활성 단계를 찾지 못했다');
  return idx + 1;
}

async function clickNext() {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('다음'));
  if (!btn) throw new Error("'다음' 버튼을 찾지 못했다");
  await act(async () => { (btn as HTMLButtonElement).click(); });
  await flushEffects();
}

const dupModal = () => screen.queryByTestId('duplicate-doc-modal');

describe("STEP1 '다음' 중복 요청서 확인", () => {
  beforeEach(() => {
    mockState.doc = null;
    mockState.dupResult = null;
    mockState.dupCalls = [];
    localStorage.clear();
  });

  it('임시저장 문서가 반려 문서와 중복이면 STEP1 에 머물고 안내 모달을 띄운다', async () => {
    mockState.doc = makeDoc('draft');
    mockState.dupResult = REJECTED_DUP;
    await renderDocAtStep1();
    expect(activeStep()).toBe(1);

    await clickNext();

    expect(mockState.dupCalls).toEqual([{
      line: LINE, partid_selection: PRODUCT, process_id: PROCESS_ID, request_purpose: '신규', exclude_id: DOC_ID,
    }]);
    expect(activeStep()).toBe(1);
    expect(dupModal()).not.toBeNull();
    expect(screen.getByText(i18n.t('request.duplicate_rejected_msg'))).toBeDefined();
    expect(screen.getByText(/반려된 기존 요청서/)).toBeDefined();
  });

  it('모달을 닫고 다시 다음을 누르면 다시 확인하고 여전히 막는다', async () => {
    mockState.doc = makeDoc('draft');
    mockState.dupResult = REJECTED_DUP;
    await renderDocAtStep1();
    await clickNext();
    const closeBtn = Array.from(document.querySelectorAll('.modal-footer button'))
      .find((b) => b.textContent?.trim() === i18n.t('common.close')) as HTMLButtonElement | undefined;
    if (!closeBtn) throw new Error('모달 닫기 버튼을 찾지 못했다');
    await act(async () => { closeBtn.click(); });
    await flushEffects();
    expect(dupModal()).toBeNull();

    await clickNext();
    expect(mockState.dupCalls).toHaveLength(2);
    expect(activeStep()).toBe(1);
    expect(dupModal()).not.toBeNull();
  });

  it('중복이 없으면 STEP2 로 넘어간다', async () => {
    mockState.doc = makeDoc('draft');
    await renderDocAtStep1();
    await clickNext();

    expect(mockState.dupCalls).toHaveLength(1);
    expect(dupModal()).toBeNull();
    expect(activeStep()).toBe(2);
  });

  it('확인 API 가 실패하면 경고 토스트를 띄우고 STEP2 로 넘어간다', async () => {
    mockState.doc = makeDoc('draft');
    mockState.dupResult = 'error';
    await renderDocAtStep1();
    await clickNext();

    expect(screen.getByText(i18n.t('request.duplicate_check_failed'))).toBeDefined();
    expect(activeStep()).toBe(2);
  });

  it('특별 관리 사항이 비어 있어도 중복 확인이 먼저 막는다(특별 관리 확인 모달을 띄우지 않는다)', async () => {
    mockState.doc = makeDoc('draft', { ...fixtureDetail, customer_requirement: '' });
    mockState.dupResult = REJECTED_DUP;
    await renderDocAtStep1();
    await clickNext();

    expect(dupModal()).not.toBeNull();
    expect(document.querySelectorAll('.modal-footer')).toHaveLength(1);
    expect(activeStep()).toBe(1);
  });

  it('반려 문서(재상신 편집)는 확인하지 않고 STEP2 로 넘어간다', async () => {
    mockState.doc = makeDoc('rejected');
    mockState.dupResult = REJECTED_DUP;
    await renderDocAtStep1();
    await clickNext();

    expect(mockState.dupCalls).toHaveLength(0);
    expect(activeStep()).toBe(2);
  });
});
