/**
 * 중단(PAUSE) 후 재개(resume) 시 J/O-layer 비활성 행이 재상신 payload 에 그대로 남는지 검증.
 *
 * 회귀 배경: 예전에는 상신 시점에 `jayerRows.filter(r => !r.disabled)` 로 비활성 행을
 * 저장에서 아예 제외했다. 그래서 중단·반려 후 편집 화면을 다시 열면 비활성으로 눌러뒀던
 * 행이 통째로 사라져 복원할 수 없었다. 이제는 임시저장과 동일하게 비활성 행도 포함해서
 * 저장해야 한다(수동 비활성화·필터 비활성화 모두).
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import '../../i18n';

// jsdom 에는 scrollIntoView/scrollTo 구현이 없다 — 검증 실패 시 앱이 호출하는 스크롤 동작을 no-op 처리.
// eslint-disable-next-line @typescript-eslint/no-empty-function
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};

const mockState: {
  captured: unknown | null;
  resumeCalled: boolean;
  doc: unknown;
  optionsFor: (line: string) => string[];
} = { captured: null, resumeCalled: false, doc: null, optionsFor: () => [] };

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));

jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: mockState.doc }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    resume: () => { mockState.resumeCalled = true; return Promise.resolve({ data: { id: 1, status: 'under_review' } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
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

const LINE = '라인1';
const PROCESS = 'RECIPE_A';
const PRODUCT = 'PART_1000';
const PROCESS_ID = 'PROC_X1';
const BB_PROCESS_ID = 'BB_R1';

// 관문 모달(특이사항 미기재·TBV/TLV 미입력)을 피하도록 필요한 값만 채운 최소 픽스처.
const fixtureDetail = {
  request_purpose: '신규',
  line: LINE,
  process_selection: PROCESS,
  partid_selection: PRODUCT,
  process_id: PROCESS_ID,
  customer_name: '고객사A',
  customer_requirement: '요구사항 텍스트', // specialCareConfirm 관문 회피
  other_purpose: [],
  flow_chart: [{ id: 'flow1', location: '', product_name: '', process_id: '', step_from: '', step_to: '' }],
  map_type: 'NEW',
  bb_zone: '없음',
  only_prodc: 'No',
  partial_shot: '계측 필요',
  tbvtlv_thickness: '',
  tbvtlv_entries: [],
  post_approvers: [],
  notifiers: [],
};

// 활성 1행 + 비활성(수동/필터) 2행 — 비활성 행이 재개 상신 payload 에 남아야 한다.
const fixtureJayerRows = [
  { id: 'j1', updated: '20260801', sortOrder: 1, disabled: false, manuallyDisabled: false, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10', item_id: 'ITEM_1' },
  { id: 'j2', updated: '20260801', sortOrder: 2, disabled: true, manuallyDisabled: true, loaded: true, process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'X', new_or_copy: '신규', product_name: '', step: '', item_id: '' },
  { id: 'j3', updated: '20260801', sortOrder: 3, disabled: true, manuallyDisabled: false, loaded: true, process_id: PROCESS_ID, sp: 'SP03', sd: 'SD03', pp: 'PP03', layerid: 'L03', st: 'X', new_or_copy: '신규', product_name: '', step: '', item_id: '' },
];
const fixtureOayerRows = [
  { id: 'o1', updated: '20260801', sortOrder: 1, disabled: false, manuallyDisabled: false, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10' },
  { id: 'o2', updated: '20260801', sortOrder: 2, disabled: true, manuallyDisabled: true, loaded: true, process_id: PROCESS_ID, sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'X', new_or_copy: '신규', product_name: '', step: '' },
];
const fixtureBbRows = [
  { id: 'b1', sortOrder: 1, disabled: false, entryId: 'bbe1', sourceJayerRowId: 'j1', process_id: PROCESS_ID, ss: 'SP01', sd: 'SD01', bb_process_id: BB_PROCESS_ID, bb_name: '[라인1] BB제품1', bb_layer: 'L01', bb_ss: '110', bb_step: 'STEP', remark: '' },
];

const fixtureNotes = {
  detail: fixtureDetail,
  jayerRows: fixtureJayerRows,
  oayerRows: fixtureOayerRows,
  bbRows: fixtureBbRows,
  history: [],
  // j3 는 필터로 비활성화된 행 — 필터 id 는 문서에 저장되지만 필터 '정의'는 localStorage 에 있다(B-58).
  // 편집 로드 시 이 정의 + activeIds 로 disabled 를 다시 계산하므로, 아래 beforeEach 에서
  // 같은 필터 정의를 localStorage 에 채워 넣어야 j3 가 필터-비활성 상태로 복원된다.
  jayerActiveFilterIds: ['f1'],
  oayerActiveFilterIds: [],
};

const fixtureDoc = {
  id: 1,
  status: 'pause', // 중단 후 재개 모드 — 지정 PL 재선택 불필요(isResumeMode)
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

const optionsFor = (): string[] => [PROCESS, PRODUCT, PROCESS_ID];

async function renderLoadedPage() {
  mockState.captured = null;
  mockState.resumeCalled = false;
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
}

/** '다음' 버튼을 마지막 단계까지 반복 클릭한다. */
async function clickThroughToLastStep() {
  for (let i = 0; i < 10; i += 1) {
    const buttons = Array.from(document.querySelectorAll('button'));
    const submitBtn = buttons.find((b) => b.textContent?.includes('📤'));
    if (submitBtn) return;
    const nextBtn = buttons.find((b) => b.textContent?.includes('다음'));
    if (!nextBtn) throw new Error(`'다음'/'📤' 버튼을 찾지 못했다 (step ${i})`);
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { nextBtn.click(); });
    // eslint-disable-next-line no-await-in-loop
    for (let j = 0; j < 10; j += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }
  }
  throw new Error('마지막 단계(📤 버튼)에 도달하지 못했다');
}

describe('중단 후 재개(resume) — 비활성 J/O-layer 행이 재상신 payload 에 남는가', () => {
  beforeEach(() => {
    mockState.doc = fixtureDoc;
    mockState.optionsFor = optionsFor;
    mockState.captured = null;
    mockState.resumeCalled = false;
    localStorage.clear();
    // j3(pp='PP03')를 걸러 비활성화하는 필터 정의 — jayerActiveFilterIds:['f1'] 와 짝을 맞춘다.
    localStorage.setItem('jayerFilterSets', JSON.stringify([
      { id: 'f1', label: 'PP03 숨김', words: { sp: [], sd: [], pp: ['PP03'] } },
    ]));
  });

  it('재개(resume) 상신 시 비활성(수동/필터) 행이 저장 payload 에 그대로 남는다', async () => {
    await renderLoadedPage();
    await clickThroughToLastStep();

    // 마지막 단계: '📤 재개' 버튼 클릭 → 확인 모달 오픈(재개 모드는 지정 PL 불필요)
    const submitBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('📤'));
    if (!submitBtn) throw new Error('상신 버튼을 찾지 못했다');
    await act(async () => { submitBtn.click(); });
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await Promise.resolve(); });
    }

    // 확인 모달은 포털 없이 인라인으로 렌더되므로, 바깥 위저드의 '📤' 버튼(submitBtn)이 여전히
    // DOM 에 남아 먼저 잡힌다. 모달 안의 진짜 확인 버튼(= handleSubmit 트리거)은 그것과 다른 노드다.
    const modalSubmitBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('📤') && !b.disabled && b !== submitBtn
    );
    if (!modalSubmitBtn) {
      const dump = Array.from(document.querySelectorAll('button')).map((b) => ({ text: b.textContent, disabled: b.disabled }));
      // eslint-disable-next-line no-console
      console.log('buttons:', JSON.stringify(dump, null, 2));
      throw new Error('확인 모달의 상신 버튼을 찾지 못했다(비활성 상태)');
    }
    await act(async () => { modalSubmitBtn.click(); });
    await waitFor(() => expect(mockState.captured).not.toBeNull());
    await waitFor(() => expect(mockState.resumeCalled).toBe(true));

    const saved = JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
    const savedJayerIds = (saved.jayerRows as { id: string; disabled: boolean }[]).map((r) => r.id);
    const savedOayerIds = (saved.oayerRows as { id: string; disabled: boolean }[]).map((r) => r.id);

    // 활성 행뿐 아니라 비활성(수동 j2/필터성 j3, 수동 o2) 행도 전부 저장돼야 한다.
    expect(savedJayerIds.sort()).toEqual(['j1', 'j2', 'j3']);
    expect(savedOayerIds.sort()).toEqual(['o1', 'o2']);

    const j2 = (saved.jayerRows as { id: string; disabled: boolean; manuallyDisabled: boolean }[]).find((r) => r.id === 'j2');
    const j3 = (saved.jayerRows as { id: string; disabled: boolean; manuallyDisabled: boolean }[]).find((r) => r.id === 'j3');
    const o2 = (saved.oayerRows as { id: string; disabled: boolean }[]).find((r) => r.id === 'o2');
    expect(j2?.disabled).toBe(true);
    expect(j3?.disabled).toBe(true);
    expect(o2?.disabled).toBe(true);
  });
});
