/**
 * Step1 라인/제품 → EXISTING 자동 매칭 회귀 테스트.
 *
 * 사용자 결정(2026-10-05): Step1 의 라인 또는 제품 이름이 바뀔 때마다 현재 map_type 과 무관하게
 * 새로 매칭해 EXISTING 인지 판별한다.
 *  - 매칭됨   → EXISTING 자동 선택 + 원본 위치/제품 채움 + 잠금(버튼 3개·원본 칸 disabled)
 *  - 매칭 없음 → MAP 목적 미선택 + StepMap 값 초기화, 사용자가 자유롭게 선택
 *  - 요청 목적만 바뀐 경우는 사용자의 MAP 선택을 지우지 않는다
 *  - 저장 문서(편집 모드) 로드 시에는 저장된 map_type 을 덮어쓰지 않는다
 *
 * 매칭 데이터(getMapNames 목): 라인A→AAAAAAAA, 라인B→BBBBBBBB, 라인C→없음.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import { INITIAL_DETAIL } from './constants';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const PROCESS = '조합법A';
const PROCESS_ID = 'PROC_X1';

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));

const mockState: { captured: unknown | null; doc: unknown | null } = { captured: null, doc: null };

jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: mockState.doc }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인A' }, { name: '라인B' }, { name: '라인C' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['조합법A']),
    getProducts: () => Promise.resolve(['AAAAAAAA-0001', 'AAAAAAAA-0002', 'BBBBBBBB-0001', 'CCCCCCCC-0001']),
    getProcessId: () => Promise.resolve(['PROC_X1']),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: (line: string) => Promise.resolve((({ 라인A: ['AAAAAAAA'], 라인B: ['BBBBBBBB'], 라인C: [] }) as Record<string, string[]>)[line] ?? []),
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
  layerSdExceptionsAPI: { list: () => Promise.resolve([]) },
}));

async function flushEffects(times = 15) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    // 마이크로태스크만 흘리면 waitFor(act 밖) 동안 React 스케줄러(매크로태스크)에 쌓인 렌더·effect 가
    // 남아 옵션 로드가 끝나기 전에 다음 단계로 넘어가는 간헐 실패가 난다 — setTimeout 0 으로 매크로태스크까지 양보한다.
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

function buttonWith(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`"${text}" 버튼을 찾지 못했다`);
  return btn as HTMLButtonElement;
}

function buttonExact(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`"${text}" 버튼을 찾지 못했다`);
  return btn as HTMLButtonElement;
}

async function renderNewDoc() {
  mockState.captured = null;
  const view = render(
    <MemoryRouter initialEntries={['/request']}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await flushEffects();
  return view;
}

/** Step1 의 라인·조합법·제품·조리법을 채우고 요청 목적을 '차용'으로 둔다. */
async function fillStep1(container: HTMLElement, line: string, product: string) {
  const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
  await act(async () => { fireEvent.change(lineSelect, { target: { value: line } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조합법'), { target: { value: PROCESS } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '제품 이름'), { target: { value: product } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조리법'), { target: { value: PROCESS_ID } }); });
  await flushEffects();
  await act(async () => { buttonWith(container, '차용').click(); });
  await flushEffects();
}

async function toStep2(container: HTMLElement) {
  const req = container.querySelector('input[name="customer_requirement"]') as HTMLInputElement | null;
  if (req && !req.value) {
    await act(async () => { fireEvent.change(req, { target: { value: '요구사항' } }); });
    await flushEffects();
  }
  await act(async () => { buttonWith(container, '다음').click(); });
  await flushEffects();
}

async function toStep1(container: HTMLElement) {
  await act(async () => { buttonWith(container, '이전').click(); });
  await flushEffects();
}

interface MapTypeState {
  active: string | null;
  allDisabled: boolean;
  allEnabled: boolean;
  sourceLine: string | null;
  sourcePartid: string | null;
}

/** MAP 정보 화면의 MAP 목적 버튼 3개(NEW/CLONE/EXISTING)와 원본 입력칸 상태를 읽는다. */
function readMapTypeState(container: HTMLElement): MapTypeState {
  const buttons = ['NEW', 'CLONE', 'EXISTING'].map((n) => buttonExact(container, n));
  const active = buttons.find((b) => b.classList.contains('active'));
  const sourceSelect = container.querySelector('select[name="source_line"]') as HTMLSelectElement | null;
  const sourceLabel = Array.from(container.querySelectorAll('label.form-label'))
    .find((l) => l.textContent?.trim().startsWith('원본 제품'));
  const sourceInput = sourceLabel?.parentElement?.querySelector('input') as HTMLInputElement | null | undefined;
  return {
    active: active ? active.textContent!.trim() : null,
    allDisabled: buttons.every((b) => b.disabled),
    allEnabled: buttons.every((b) => !b.disabled),
    sourceLine: sourceSelect ? sourceSelect.value : null,
    sourcePartid: sourceInput ? sourceInput.value : null,
  };
}

async function saveDraftAndCaptureDetail(): Promise<Record<string, unknown>> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { (saveBtn as HTMLButtonElement).click(); });
  await flushEffects();
  const payload = mockState.captured as { additional_notes: string } | null;
  if (!payload) throw new Error('임시저장 payload 를 캡처하지 못했다');
  return JSON.parse(payload.additional_notes).detail;
}

const EXPECT_LOCKED_A: Partial<MapTypeState> = {
  active: 'EXISTING', allDisabled: true, sourceLine: '라인A', sourcePartid: 'AAAAAAAA',
};

describe('Step1 라인/제품 → EXISTING 자동 매칭', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.doc = null;
    localStorage.clear();
  });

  it('매칭되는 라인+제품이면 EXISTING 이 자동 선택되고 MAP 목적·원본이 잠긴다', async () => {
    const { container } = await renderNewDoc();
    await fillStep1(container, '라인A', 'AAAAAAAA-0001');
    await toStep2(container);
    expect(readMapTypeState(container)).toMatchObject(EXPECT_LOCKED_A);
  });

  it('매칭이 없으면 MAP 목적이 미선택이고 자유롭게 바꿀 수 있다', async () => {
    const { container } = await renderNewDoc();
    await fillStep1(container, '라인C', 'CCCCCCCC-0001');
    await toStep2(container);
    expect(readMapTypeState(container)).toMatchObject({ active: null, allEnabled: true });

    await act(async () => { buttonExact(container, 'NEW').click(); });
    await flushEffects();
    expect(readMapTypeState(container)).toMatchObject({ active: 'NEW', allEnabled: true });

    await act(async () => { buttonExact(container, 'CLONE').click(); });
    await flushEffects();
    await act(async () => { buttonExact(container, '확인').click(); });
    await flushEffects();
    expect(readMapTypeState(container)).toMatchObject({ active: 'CLONE', allEnabled: true });
  });

  it('A/AAA(매칭) → B/BBB(매칭)로 바꾸면 새 제품 기준으로 다시 EXISTING 이 채워진다', async () => {
    const { container } = await renderNewDoc();
    await fillStep1(container, '라인A', 'AAAAAAAA-0001');
    await toStep2(container);
    expect(readMapTypeState(container)).toMatchObject(EXPECT_LOCKED_A);

    await toStep1(container);
    await fillStep1(container, '라인B', 'BBBBBBBB-0001');
    await toStep2(container);
    expect(readMapTypeState(container)).toMatchObject({
      active: 'EXISTING', allDisabled: true, sourceLine: '라인B', sourcePartid: 'BBBBBBBB',
    });
  });

  it('같은 라인에서 제품만 바꿔도(코드 동일) EXISTING 이 다시 채워지고 잠긴다', async () => {
    const { container } = await renderNewDoc();
    await fillStep1(container, '라인A', 'AAAAAAAA-0001');
    await toStep2(container);
    await toStep1(container);
    await fillStep1(container, '라인A', 'AAAAAAAA-0002');
    await toStep2(container);
    expect(readMapTypeState(container)).toMatchObject(EXPECT_LOCKED_A);
  });

  it('A/AAA(매칭) → C/CCC(매칭 없음)로 바꾸면 EXISTING 과 옛 원본이 사라지고 자유 선택이 된다', async () => {
    const { container } = await renderNewDoc();
    await fillStep1(container, '라인A', 'AAAAAAAA-0001');
    await toStep2(container);
    await toStep1(container);
    await fillStep1(container, '라인C', 'CCCCCCCC-0001');
    await toStep2(container);
    expect(readMapTypeState(container)).toMatchObject({
      active: null, allEnabled: true, sourceLine: null, sourcePartid: null,
    });
  });

  it('C/CCC 에서 사용자가 NEW 를 골라 값을 채웠어도 A/AAA(매칭)로 바꾸면 EXISTING 으로 다시 매칭되고 StepMap 값이 초기화된다', async () => {
    const { container } = await renderNewDoc();
    await fillStep1(container, '라인C', 'CCCCCCCC-0001');
    await toStep2(container);
    await act(async () => { buttonExact(container, 'NEW').click(); });
    await flushEffects();
    const prodcSelect = container.querySelector('select[name="only_prodc"]') as HTMLSelectElement;
    await act(async () => { fireEvent.change(prodcSelect, { target: { value: 'Yes' } }); });
    await flushEffects();
    expect((container.querySelector('select[name="only_prodc"]') as HTMLSelectElement).value).toBe('Yes');

    await toStep1(container);
    await fillStep1(container, '라인A', 'AAAAAAAA-0001');
    await toStep2(container);
    expect(readMapTypeState(container)).toMatchObject(EXPECT_LOCKED_A);
    expect((container.querySelector('select[name="only_prodc"]') as HTMLSelectElement).value).toBe('No');
  });

  it('요청 목적만 바꾸면 사용자가 고른 MAP 목적은 지워지지 않는다', async () => {
    const { container } = await renderNewDoc();
    await fillStep1(container, '라인C', 'CCCCCCCC-0001');
    await toStep2(container);
    await act(async () => { buttonExact(container, 'NEW').click(); });
    await flushEffects();

    await toStep1(container);
    await act(async () => { buttonExact(container, '신규').click(); });
    await flushEffects();
    await toStep2(container);
    expect(readMapTypeState(container)).toMatchObject({ active: 'NEW', allEnabled: true });
  });

  it('저장 문서(편집 모드)를 불러올 때 저장된 map_type 을 매칭 결과로 덮어쓰지 않는다', async () => {
    mockState.doc = {
      id: 7,
      status: 'REJECTED',
      additional_notes: JSON.stringify({
        detail: {
          ...INITIAL_DETAIL,
          line: '라인A',
          process_selection: PROCESS,
          partid_selection: 'AAAAAAAA-0001',
          process_id: PROCESS_ID,
          request_purpose: '신규',
          customer_requirement: '요구사항',
          map_type: 'NEW',
        },
      }),
    };
    mockState.captured = null;
    render(
      <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 7 } }]}>
        <ToastProvider>
          <RequestPage />
        </ToastProvider>
      </MemoryRouter>
    );
    await flushEffects(30);

    const detail = await saveDraftAndCaptureDetail();
    expect(detail.map_type).toBe('NEW');
    expect(detail.source_line).toBe('');
    expect(detail.source_partid).toBe('');
  });
});
