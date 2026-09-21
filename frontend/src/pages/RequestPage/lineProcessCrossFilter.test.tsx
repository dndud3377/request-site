/**
 * Step1 제품이름 ↔ 조리법 상호 좁힘(양방향 캐스케이드) 재현 테스트.
 *
 * 배경: 기존에는 라인→조합법→제품이름→조리법 순서로만 진행됐다(제품이름을 골라야 조리법이
 * 나옴). 이제 (1) 조합법만으로도 조리법 전체 목록을 바로 불러오고, (2) 조리법을 먼저 골라도
 * 그에 맞는 제품이름으로 좁혀지며, (3) 기존처럼 제품이름을 먼저 골라도 조리법이 좁혀지는
 * 동작은 그대로 유지되는지 실제 컴포넌트를 구동해 확인한다.
 */
import React from 'react';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE = '라인1';
const PROCESS = '조합법A';
// P1 은 조리법 X/Y 를 갖고, P2 는 조리법 X만 갖는다(운영 데이터의 전형적인 1:N 관계를 재현).
// (jest.mock 팩토리가 import 시점에 즉시 실행되므로, 팩토리 안에서 참조하는 값은 다른 모듈
//  스코프 상수를 거치지 않고 문자열 리터럴로 직접 둔다 — 그렇지 않으면 TDZ 참조 오류가 난다.)
const P1 = 'P1';
const P2 = 'P2';
const PID_X = 'X';
const PID_Y = 'Y';

const productsByProcessId: Record<string, string[]> = {
  '': ['P1', 'P2'],
  X: ['P1', 'P2'],
  Y: ['P1'],
};
const processIdsByProduct: Record<string, string[]> = {
  P1: ['X', 'Y'],
  P2: ['X'],
};

const mockState: { captured: unknown | null; getProductsCalls: unknown[][]; getProcessIdCalls: unknown[][] } = {
  captured: null,
  getProductsCalls: [],
  getProcessIdCalls: [],
};

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
    get: () => Promise.resolve({ data: null }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: LINE }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve([PROCESS]),
    getProducts: (line: string, process?: string, processId?: string) => {
      mockState.getProductsCalls.push([line, process, processId]);
      return Promise.resolve(productsByProcessId[processId ?? ''] ?? []);
    },
    getProcessId: (line: string, product?: string, process?: string) => {
      mockState.getProcessIdCalls.push([line, product, process]);
      if (product) return Promise.resolve(processIdsByProduct[product] ?? []);
      if (process) return Promise.resolve([PID_X, PID_Y]); // 조합법 범위 전체(제품 무관)
      return Promise.resolve([]);
    },
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
    await act(async () => { await Promise.resolve(); });
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

async function renderNewDoc() {
  mockState.captured = null;
  mockState.getProductsCalls = [];
  mockState.getProcessIdCalls = [];
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

async function setLineAndProcess(container: HTMLElement) {
  const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
  await act(async () => { fireEvent.change(lineSelect, { target: { value: LINE } }); });
  await flushEffects();

  const processInput = getFieldInput(container, '조합법');
  await act(async () => { fireEvent.change(processInput, { target: { value: PROCESS } }); });
  await flushEffects();
}

async function setField(container: HTMLElement, labelText: string, value: string) {
  const input = getFieldInput(container, labelText);
  await act(async () => { fireEvent.change(input, { target: { value } }); });
  await flushEffects();
}

/** '임시저장'을 눌러 서버로 나간 payload 의 detail 을 읽는다. */
async function captureDetail(): Promise<{ partid_selection: string; process_id: string }> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { (saveBtn as HTMLButtonElement).click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  const payload = mockState.captured as { additional_notes: string };
  const notes = JSON.parse(payload.additional_notes);
  return { partid_selection: notes.detail.partid_selection, process_id: notes.detail.process_id };
}

describe('Step1 제품이름 ↔ 조리법 상호 좁힘', () => {
  it('조합법만 고르면 조리법 목록도 (제품이름 없이) 바로 조회된다', async () => {
    const { container } = await renderNewDoc();
    await setLineAndProcess(container);

    // product 없이 process(조합법)만으로 조리법을 조회하는 broad 호출이 있어야 한다.
    expect(mockState.getProcessIdCalls.some(([, product, process]) => !product && process === PROCESS)).toBe(true);

    // 제품이름을 아직 고르지 않았는데도 조리법을 바로 선택할 수 있다(broad 목록에서).
    await setField(container, '조리법', PID_Y);
    const { partid_selection, process_id } = await captureDetail();
    expect(process_id).toBe(PID_Y);
    expect(partid_selection).toBe('');
  });

  it('조리법을 먼저 고르면 제품이름이 그에 맞게 좁혀지고, 그 목록에서 고른 제품이름이 반영된다', async () => {
    const { container } = await renderNewDoc();
    await setLineAndProcess(container);
    await setField(container, '조리법', PID_Y); // P2 는 Y 가 없으므로 P1만 남아야 함

    expect(mockState.getProductsCalls.some(([, process, processId]) => process === PROCESS && processId === PID_Y)).toBe(true);

    await setField(container, '제품 이름', P1);
    const { partid_selection, process_id } = await captureDetail();
    // 조리법(Y)에서 좁혀진 제품이름(P1)을 골랐으므로 둘 다 유지돼야 한다(서로 모순 없음).
    expect(partid_selection).toBe(P1);
    expect(process_id).toBe(PID_Y);
  });

  it('[회귀 방지] 제품이름을 먼저 고르면 기존처럼 조리법이 좁혀진다', async () => {
    const { container } = await renderNewDoc();
    await setLineAndProcess(container);
    await setField(container, '제품 이름', P2);

    expect(mockState.getProcessIdCalls.some(([, product]) => product === P2)).toBe(true);

    await setField(container, '조리법', PID_X); // P2 가 가진 유일한 조리법
    const { partid_selection, process_id } = await captureDetail();
    expect(partid_selection).toBe(P2);
    expect(process_id).toBe(PID_X);
  });

  it('[회귀 방지] 제품이름 선택 후 그 조리법 목록에서 고르면 제품이름이 지워지지 않는다', async () => {
    const { container } = await renderNewDoc();
    await setLineAndProcess(container);
    await setField(container, '제품 이름', P1);
    await setField(container, '조리법', PID_Y); // P1 의 조리법 목록(X, Y) 중 하나

    const { partid_selection, process_id } = await captureDetail();
    expect(partid_selection).toBe(P1); // 조리법 선택으로 인해 제품이름이 사라지면 안 된다
    expect(process_id).toBe(PID_Y);
  });
});
