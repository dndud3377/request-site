/**
 * claude 수정 (2026-10-28): J-ayer/O-ayer 표가 빈 채로 상신되던 문제 회귀 테스트.
 *
 * 1) Only MAP·MAP 삭제·ADI CD 변경 진입 시 비운 J/O 표가, 일반 목적으로 돌아와도 다시 조회되지 않아
 *    0행인 채로 상신됐다(조회는 조리법 변경 effect 에서만 일어남). → 일반 목적으로 돌아오면 재조회한다.
 * 2) 조회 결과가 실제로 0건인 조리법도 상신할 수 있어야 하므로 막지는 않고, 일반 목적인데 J/O 중
 *    하나라도 0행이면 상신 전에 확인 모달을 띄운다.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

// jsdom 에는 scrollIntoView/scrollTo 구현이 없다 — 검증 실패 시 앱이 호출하는 스크롤 동작을 no-op 처리.
// eslint-disable-next-line @typescript-eslint/no-empty-function
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};

const LINE = '라인1';
const PROCESS = '조합법A';
const PRODUCT = '제품A';
const PROC_WITH_DATA = 'PROC_DATA';

type LayerItem = { updated: string; processid: string; stepseq: string; descript: string; recipeid: string; layerid: string };

const makeLayerItems = (n: number, tag: string): LayerItem[] =>
  Array.from({ length: n }, (_, i) => ({
    updated: '2026-08-01',
    processid: `${tag}_${i}`,
    stepseq: `SP${i}`,
    descript: `SD${i}`,
    recipeid: `PP${i}`,
    layerid: `L${i}`,
  }));

const MOCK_JOB_ITEMS = makeLayerItems(2, 'J');
const MOCK_OVL_ITEMS = makeLayerItems(3, 'O');

const mockState: {
  captured: unknown | null;
  doc: unknown;
  jobFileCalls: string[];
  ovlCalls: string[];
  resumeCalled: boolean;
} = { captured: null, doc: null, jobFileCalls: [], ovlCalls: [], resumeCalled: false };

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
    resume: () => { mockState.resumeCalled = true; return Promise.resolve({ data: { message: 'ok' } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['조합법A']),
    getProducts: () => Promise.resolve(['제품A']),
    getProcessId: () => Promise.resolve(['PROC_DATA']),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: () => Promise.resolve([]),
    getMapInfo: () => Promise.resolve({ AAA1: null, AAA2: null, AAA3: null }),
    getJobFileLayer: (_line: string, process: string) => {
      mockState.jobFileCalls.push(process);
      return Promise.resolve(process === 'PROC_DATA' ? MOCK_JOB_ITEMS : []);
    },
    getOvlLayer: (_line: string, process: string) => {
      mockState.ovlCalls.push(process);
      return Promise.resolve(process === 'PROC_DATA' ? MOCK_OVL_ITEMS : []);
    },
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
    // 마이크로태스크만 흘리면 React 스케줄러(매크로태스크)에 쌓인 렌더·effect 가 남는다 — setTimeout 0 으로 양보한다.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function getFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label.form-label')) as HTMLElement[];
  const label = labels.find((l) => l.textContent?.trim().startsWith(labelText));
  if (!label) throw new Error(`label "${labelText}" 을 찾지 못했다`);
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error(`label "${labelText}" 옆 input 을 찾지 못했다`);
  return input as HTMLInputElement;
}

/** 텍스트가 정확히 일치하는 버튼 — '신규'가 '신규+차용'에 잘못 걸리지 않게 한다. */
function buttonExact(text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`"${text}" 버튼을 찾지 못했다`);
  return btn as HTMLButtonElement;
}

/** 열린 확인 모달(.modal-footer)에서 텍스트가 일치하는 버튼을 찾는다. */
function modalFooterButton(text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll('.modal-footer button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`모달의 "${text}" 버튼을 찾지 못했다`);
  return btn as HTMLButtonElement;
}

async function clickAndFlush(btn: HTMLButtonElement) {
  await act(async () => { btn.click(); });
  await flushEffects();
}

// ===== 1) 일반 목적 복귀 시 재조회 =====

async function renderNewDocWithProcessId() {
  const view = render(
    <MemoryRouter initialEntries={['/request']}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await flushEffects();
  const { container } = view;
  const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
  await act(async () => { fireEvent.change(lineSelect, { target: { value: LINE } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조합법'), { target: { value: PROCESS } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '제품 이름'), { target: { value: PRODUCT } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조리법'), { target: { value: PROC_WITH_DATA } }); });
  await flushEffects();
  return view;
}

/** '임시저장'을 눌러 서버로 나간 payload 의 request_purpose·jayerRows·oayerRows 를 읽는다. */
async function captureSaved(): Promise<{ purpose: string; jayerRows: unknown[]; oayerRows: unknown[] }> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { (saveBtn as HTMLButtonElement).click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  const notes = JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
  return { purpose: notes.detail.request_purpose, jayerRows: notes.jayerRows ?? [], oayerRows: notes.oayerRows ?? [] };
}

describe('Only MAP·MAP 삭제·ADI CD 변경 → 일반 목적 복귀 시 J/O 재조회', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.doc = null;
    mockState.jobFileCalls = [];
    mockState.ovlCalls = [];
    localStorage.clear();
  });

  it('Only MAP → 신규: 확인 모달 없이 바로 바뀌고 J/O 가 다시 채워진다', async () => {
    await renderNewDocWithProcessId();
    await clickAndFlush(buttonExact('Only MAP'));
    expect((await captureSaved()).jayerRows).toHaveLength(0);

    mockState.jobFileCalls = [];
    mockState.ovlCalls = [];
    await clickAndFlush(buttonExact('신규'));

    expect(mockState.jobFileCalls).toEqual([PROC_WITH_DATA]);
    expect(mockState.ovlCalls).toEqual([PROC_WITH_DATA]);
    const saved = await captureSaved();
    expect(saved.purpose).toBe('신규');
    expect(saved.jayerRows).toHaveLength(MOCK_JOB_ITEMS.length);
    expect(saved.oayerRows).toHaveLength(MOCK_OVL_ITEMS.length);
  });

  it('MAP 삭제 → 신규: 이탈 확인 모달에서 확인하면 J/O 가 다시 채워진다', async () => {
    await renderNewDocWithProcessId();
    await clickAndFlush(buttonExact('MAP 삭제'));
    expect((await captureSaved()).jayerRows).toHaveLength(0);

    mockState.jobFileCalls = [];
    await clickAndFlush(buttonExact('신규'));
    // MAP 삭제 이탈은 확인 모달을 거친다 — 확인 전에는 아직 조회하지 않는다.
    expect(mockState.jobFileCalls).toEqual([]);
    await clickAndFlush(modalFooterButton('확인'));

    expect(mockState.jobFileCalls).toEqual([PROC_WITH_DATA]);
    const saved = await captureSaved();
    expect(saved.purpose).toBe('신규');
    expect(saved.jayerRows).toHaveLength(MOCK_JOB_ITEMS.length);
    expect(saved.oayerRows).toHaveLength(MOCK_OVL_ITEMS.length);
  });

  it('ADI CD 변경 → 신규: J/O 가 다시 채워진다', async () => {
    await renderNewDocWithProcessId();
    await clickAndFlush(buttonExact('ADI CD 변경'));
    expect((await captureSaved()).jayerRows).toHaveLength(0);

    mockState.jobFileCalls = [];
    await clickAndFlush(buttonExact('신규'));

    expect(mockState.jobFileCalls).toEqual([PROC_WITH_DATA]);
    const saved = await captureSaved();
    expect(saved.purpose).toBe('신규');
    expect(saved.jayerRows).toHaveLength(MOCK_JOB_ITEMS.length);
    expect(saved.oayerRows).toHaveLength(MOCK_OVL_ITEMS.length);
  });

  it('MAP 삭제 이탈 확인 모달에서 취소하면 재조회하지 않는다', async () => {
    await renderNewDocWithProcessId();
    await clickAndFlush(buttonExact('MAP 삭제'));
    await clickAndFlush(buttonExact('신규'));
    mockState.jobFileCalls = [];
    await clickAndFlush(modalFooterButton('취소'));

    expect(mockState.jobFileCalls).toEqual([]);
    const saved = await captureSaved();
    expect(saved.purpose).toBe('MAP 삭제');
    expect(saved.jayerRows).toHaveLength(0);
  });

  it('일반 목적끼리 바꾸면(신규 → 차용) 재조회하지 않는다 — 편집한 표를 지우지 않는다', async () => {
    await renderNewDocWithProcessId();
    await clickAndFlush(buttonExact('신규'));
    mockState.jobFileCalls = [];
    await clickAndFlush(buttonExact('차용'));

    expect(mockState.jobFileCalls).toEqual([]);
    expect((await captureSaved()).jayerRows).toHaveLength(MOCK_JOB_ITEMS.length);
  });
});

// ===== 2) 일반 목적 상신 시 J/O 0행 확인 모달 =====

const PROCESS_ID = 'PROC_DATA';

// pauseResumeDisabledRows.test.tsx 와 같은 최소 픽스처 — 중단(pause) 문서 재개는 지정 PL 이 필요 없어
// '📤' 클릭 → 확인 모달 → 상신까지 바로 이어진다.
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

// pauseResumeDisabledRows.test.tsx 와 같은 활성 행 + Backbone 매핑 — 마지막 단계 검증을 통과하는 조합이다.
const fixtureJayerRows = [
  { id: 'j1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10', item_id: 'ITEM_1' },
];
const fixtureOayerRows = [
  { id: 'o1', updated: '20260801', sortOrder: 1, loaded: true, process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01', st: 'O', new_or_copy: '신규', product_name: '제품A', step: '10' },
];
const fixtureBbRows = [
  { id: 'b1', sortOrder: 1, disabled: false, entryId: 'bbe1', sourceJayerRowId: 'j1', process_id: PROCESS_ID, ss: 'SP01', sd: 'SD01', bb_process_id: 'BB_R1', bb_name: '[라인1] BB제품1', bb_layer: 'L01', bb_ss: '110', bb_step: 'STEP', remark: '' },
];

const makePauseDoc = (jayerRows: unknown[], oayerRows: unknown[]) => ({
  id: 1,
  status: 'pause',
  title: '기존 제목',
  requester_name: '원작성자',
  requester_email: 'orig@example.com',
  requester_department: '원부서',
  product_name: PRODUCT,
  production_date: '2026-09-01',
  reference_materials: '',
  additional_notes: JSON.stringify({
    detail: fixtureDetail, jayerRows, oayerRows, bbRows: jayerRows.length > 0 ? fixtureBbRows : [], history: [],
  }),
  approval_steps: [],
});

async function renderPausedDocAtLastStep() {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flushEffects(20);
  for (let i = 0; i < 10; i += 1) {
    const buttons = Array.from(document.querySelectorAll('button'));
    if (buttons.some((b) => b.textContent?.includes('📤'))) return;
    const nextBtn = buttons.find((b) => b.textContent?.includes('다음'));
    if (!nextBtn) throw new Error(`'다음'/'📤' 버튼을 찾지 못했다 (step ${i})`);
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { nextBtn.click(); });
    // eslint-disable-next-line no-await-in-loop
    await flushEffects(10);
  }
  throw new Error('마지막 단계(📤 버튼)에 도달하지 못했다');
}

const EMPTY_TITLE = 'J-ayer/O-ayer 표 확인';
const isEmptyModalOpen = () => screen.queryByText(EMPTY_TITLE) !== null;
const wizardSubmitButton = () =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('📤')) as HTMLButtonElement;
/** 상신 확인 모달(지정 PL·통보처)의 '📤' 버튼 — 바깥 위저드의 '📤' 버튼과 다른 노드다. */
const submitModalButton = (wizardBtn: HTMLButtonElement) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('📤') && b !== wizardBtn) as
    HTMLButtonElement | undefined;

describe('일반 목적 상신 시 J/O 0행 확인 모달', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.resumeCalled = false;
    mockState.jobFileCalls = [];
    mockState.ovlCalls = [];
    localStorage.clear();
  });

  it('J/O 모두 행이 있으면 확인 모달 없이 바로 상신 모달이 열린다', async () => {
    mockState.doc = makePauseDoc(fixtureJayerRows, fixtureOayerRows);
    await renderPausedDocAtLastStep();
    const wizardBtn = wizardSubmitButton();
    await clickAndFlush(wizardBtn);

    expect(isEmptyModalOpen()).toBe(false);
    expect(submitModalButton(wizardBtn)).toBeDefined();
  });

  it('O-ayer 만 0행이면 확인 모달에 O-ayer 가 표시되고, 취소하면 상신 모달이 열리지 않는다', async () => {
    mockState.doc = makePauseDoc(fixtureJayerRows, []);
    await renderPausedDocAtLastStep();
    const wizardBtn = wizardSubmitButton();
    await clickAndFlush(wizardBtn);

    expect(isEmptyModalOpen()).toBe(true);
    expect(screen.getByText(/O-ayer 표가 비어 있습니다/)).toBeDefined();
    expect(screen.queryByText(/J-ayer, O-ayer 표가/)).toBeNull();

    await clickAndFlush(modalFooterButton('취소'));
    expect(isEmptyModalOpen()).toBe(false);
    expect(submitModalButton(wizardBtn)).toBeUndefined();
    expect(mockState.resumeCalled).toBe(false);
  });

  it('J/O 모두 0행이면 둘 다 표시되고, 상신 계속을 누르면 상신 모달로 이어져 상신된다', async () => {
    mockState.doc = makePauseDoc([], []);
    await renderPausedDocAtLastStep();
    const wizardBtn = wizardSubmitButton();
    await clickAndFlush(wizardBtn);

    expect(screen.getByText(/J-ayer, O-ayer 표가 비어 있습니다/)).toBeDefined();
    await clickAndFlush(modalFooterButton('상신 계속'));
    expect(isEmptyModalOpen()).toBe(false);

    const modalBtn = submitModalButton(wizardBtn);
    if (!modalBtn) throw new Error('상신 모달의 📤 버튼을 찾지 못했다');
    await clickAndFlush(modalBtn);
    await waitFor(() => expect(mockState.resumeCalled).toBe(true));
    const saved = JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
    expect(saved.jayerRows).toHaveLength(0);
    expect(saved.oayerRows).toHaveLength(0);
  });

  it('Only MAP 문서는 J/O 가 0행이어도 확인 모달을 띄우지 않는다', async () => {
    mockState.doc = {
      ...makePauseDoc([], []),
      additional_notes: JSON.stringify({
        detail: { ...fixtureDetail, request_purpose: 'Only MAP', partial_shot: '' },
        jayerRows: [], oayerRows: [], bbRows: [], history: [],
      }),
    };
    await renderPausedDocAtLastStep();
    const wizardBtn = wizardSubmitButton();
    await clickAndFlush(wizardBtn);

    expect(isEmptyModalOpen()).toBe(false);
    expect(submitModalButton(wizardBtn)).toBeDefined();
  });
});
