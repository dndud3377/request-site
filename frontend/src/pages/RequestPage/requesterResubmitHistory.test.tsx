/**
 * 의뢰자 재상신(requester-resubmit) 관련 회귀 재현 테스트 2건.
 *
 * 1) 버그: 제출 핸들러가 `isUnderReview` 를 판별해놓고도 `buildEnrichedForm`의
 *    shouldAddHistory 인자에 반영하지 않아, PL 검토 단계에서 의뢰자가 "수정 후
 *    재상신"을 해도 additional_notes.history[] 에 수정 전 스냅샷이 쌓이지 않았다.
 * 2) 버그: handleSubmitClick 이 모달을 열기 직전 designees 를 무조건 비워
 *    편집 진입 시 프리필된 지정 PL(검토자 프리필, Case I)이 상신 확인 모달에서
 *    사라지는 문제. 편집 모드에서는 비우지 않도록 고쳤다(index.tsx).
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import '../../i18n';

const mockState: {
  captured: unknown | null;
  doc: unknown;
  optionsFor: (line: string) => string[];
  resubmitCalled: boolean;
  resubmitLoginids: string[] | null;
} = { captured: null, doc: null, optionsFor: () => [], resubmitCalled: false, resubmitLoginids: null };

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'NONE' },
  }),
}));

// ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 → 평범한 함수로 둔다.
jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: mockState.doc }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    requesterResubmit: (_id: number, loginids: string[]) => {
      mockState.resubmitCalled = true;
      mockState.resubmitLoginids = loginids;
      return Promise.resolve({ data: { message: 'ok', document: mockState.doc } });
    },
    resubmit: (_id: number, loginids: string[]) => {
      mockState.resubmitCalled = true;
      mockState.resubmitLoginids = loginids;
      return Promise.resolve({ data: { message: 'ok', document: mockState.doc } });
    },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
  formOptionsAPI: {
    getProcesses: (line: string) => Promise.resolve(mockState.optionsFor(line)),
    getProducts: (line: string) => Promise.resolve(mockState.optionsFor(line)),
    getProcessId: (line: string) => Promise.resolve(mockState.optionsFor(line)),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: (line: string) => Promise.resolve(mockState.optionsFor(line)),
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
}));

const LINE = '라인1';
const PROCESS = 'RECIPE_A';
const PRODUCT = 'PART_1000';
const PROCESS_ID = 'PROC_X1';

// 'MAP 삭제'는 STEP1 → STEP2(MAP 정보)에서 바로 상신 버튼이 나와, 5단계 전체를
// 채우지 않고도 제출 흐름까지 도달할 수 있다(draftRoundTrip.test.tsx 와 동일 전략).
const fixtureDetail = {
  request_purpose: 'MAP 삭제',
  other_purpose: [],
  line: LINE,
  process_selection: PROCESS,
  partid_selection: PRODUCT,
  process_id: PROCESS_ID,
  customer_name: '고객사A',
  customer_requirement: '요구사항 텍스트',
  flow_chart: [],
  map_type: 'NEW',
  map_change_reason: '<p>MAP 삭제 이유</p>',
  notifiers: [],
  post_approvers: [],
  sales_agreers: [],
};

const fixtureNotes = {
  detail: fixtureDetail,
  jayerRows: [],
  oayerRows: [],
  bbRows: [],
  history: [],
  mergeSnapshot: null,
};

const fixtureDoc = {
  id: 1,
  status: 'under_review',
  title: '기존 제목',
  requester_name: '원작성자',
  requester_email: 'orig@example.com',
  requester_department: '원부서',
  product_name: PRODUCT,
  production_date: '2026-09-01',
  reference_materials: '',
  additional_notes: JSON.stringify(fixtureNotes),
  approval_steps: [
    { agent: 'PL', round: 1, action: 'pending', assignee_loginid: 'pl1', assignee_name: 'PL담당자' },
  ],
};

const optionsFor = (): string[] => [PROCESS, PRODUCT, PROCESS_ID];

describe('의뢰자 재상신 — 수정 전 스냅샷이 history 에 기록되는가', () => {
  beforeEach(() => {
    mockState.doc = fixtureDoc;
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    mockState.resubmitCalled = false;
    mockState.resubmitLoginids = null;
    localStorage.clear();
  });

  it('under_review 문서를 수정 후 재상신하면 update payload 의 history 에 수정 전 스냅샷이 쌓인다', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
        <ToastProvider>
          <RequestPage />
        </ToastProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }

    // 실제로 값을 하나 고친다 — "이력확인"에 before/after가 뜨려면 현재값(cur)과
    // history[0](prev)이 실제로 달라야 한다. 아무것도 안 고치면 cur===prev라
    // computeDetailDiff(PagedDetailView.tsx)가 '변경 없음'으로 판정하는 게 정상이다.
    const customerReqInput = document.querySelector('input[name="customer_requirement"]') as HTMLInputElement;
    if (!customerReqInput) throw new Error('customer_requirement 입력창을 찾지 못했다');
    const EDITED_REQUIREMENT = '요구사항 텍스트(수정됨)';
    await act(async () => { fireEvent.change(customerReqInput, { target: { value: EDITED_REQUIREMENT } }); });

    // MAP 삭제: STEP1 → STEP2(MAP 정보)가 마지막 단계이므로 '다음' 한 번으로 상신 버튼이 나온다.
    const nextBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('다음'));
    if (!nextBtn) throw new Error('다음 버튼을 찾지 못했다');
    await act(async () => { nextBtn.click(); });

    const submitBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('📤'));
    if (!submitBtn) throw new Error('상신 버튼을 찾지 못했다');
    await act(async () => { submitBtn.click(); });

    // 편집 진입 시 프리필된 지정 PL이 모달에도 그대로 남아 있어야 한다(재선택 불필요) —
    // handleSubmitClick 이 편집 모드에서는 designees 를 비우지 않도록 고친 부분의 검증.
    await waitFor(() => expect(screen.getByText('PL담당자')).toBeDefined());
    const confirmBtn = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.includes('📤')).pop();
    if (!confirmBtn) throw new Error('상신 확인 버튼을 찾지 못했다');
    expect(confirmBtn.disabled).toBe(false);
    await act(async () => { confirmBtn.click(); });

    await waitFor(() => expect(mockState.resubmitCalled).toBe(true));
    expect(mockState.resubmitLoginids).toEqual(['pl1']);
    expect(mockState.captured).not.toBeNull();
    const payload = mockState.captured as { additional_notes: string };
    const saved = JSON.parse(payload.additional_notes);

    // "이력확인"이 참조하는 두 값: 현재(cur) = 방금 수정한 새 값, history[0](prev) = 수정 전 값.
    // PagedDetailView.computeDetailDiff 는 cur.customer_requirement !== prev.customer_requirement
    // 이면 이 필드를 changedFields 에 넣어 before/after 를 표시한다 — 그 입력이 되는 두 값이
    // 실제로 다르게 저장됐는지 여기서 직접 확인한다(고친 필드가 실제로 이력확인에 나타남).
    expect(saved.detail.customer_requirement).toBe(EDITED_REQUIREMENT);
    expect(saved.history).toHaveLength(1);
    expect(saved.history[0].detail.customer_requirement).toBe('요구사항 텍스트');
    expect(saved.history[0].detail.customer_requirement).not.toBe(saved.detail.customer_requirement);
    // 손대지 않은 필드는 반대로 history와 동일해 '변경 없음'으로 판정돼야 한다(오탐 없음).
    expect(saved.history[0].detail.customer_name).toBe(saved.detail.customer_name);
  });

  it('반려 문서(rejected) 재상신 화면도 프리필된 지정 PL이 모달에서 사라지지 않는다(Case I 검토자 프리필)', async () => {
    mockState.doc = { ...fixtureDoc, status: 'rejected' };
    render(
      <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
        <ToastProvider>
          <RequestPage />
        </ToastProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }

    const nextBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('다음'));
    if (!nextBtn) throw new Error('다음 버튼을 찾지 못했다');
    await act(async () => { nextBtn.click(); });

    const submitBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('📤'));
    if (!submitBtn) throw new Error('상신 버튼을 찾지 못했다');
    await act(async () => { submitBtn.click(); });

    await waitFor(() => expect(screen.getByText('PL담당자')).toBeDefined());
    const confirmBtn = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.includes('📤')).pop();
    if (!confirmBtn) throw new Error('상신 확인 버튼을 찾지 못했다');
    expect(confirmBtn.disabled).toBe(false);
    await act(async () => { confirmBtn.click(); });

    await waitFor(() => expect(mockState.resubmitCalled).toBe(true));
    expect(mockState.resubmitLoginids).toEqual(['pl1']);
  });
});
