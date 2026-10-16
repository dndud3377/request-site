/**
 * claude 수정 (2026-10-15): STEP1 흐름도 Step — stepseq 표시·저장·순서 검증 회귀 테스트(실제 RequestPage 렌더).
 *  - Step 목록에 layerid 와 함께 stepseq 가 작게 보인다.
 *  - 같은 layerid 가 여러 stepseq 에 있으면 고른 항목의 stepseq 가 저장된다.
 *  - 같은 stepseq 접두어는 아래 행이 위 행 구간 이후에서 시작해야 하고, 다른 접두어는 상관없다.
 *  - 같은 layerid 가 여러 stepseq 인데 직접 타이핑만 하면(어느 것인지 모름) 막는다.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE = '라인1';
const PRODUCT = 'FP1';
const PROCESS_ID = 'FPID1';

const mockState: { captured: unknown } = { captured: null };

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
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['조합법A']),
    getProducts: () => Promise.resolve(['FP1']),
    getProcessId: () => Promise.resolve(['FPID1']),
    getLayerIds: () => Promise.resolve([
      { layerid: 'L01', stepseq: 'AAAA1234' },
      { layerid: 'L02', stepseq: 'AAAA1236' },
      { layerid: 'L09', stepseq: 'BBBB1237' },
      { layerid: 'L03', stepseq: 'AAAA1238' },
      { layerid: 'L10', stepseq: 'BBBB1239' },
      { layerid: 'L01', stepseq: 'AAAA1240' },
    ]),
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

async function type(el: HTMLElement, value: string) {
  await act(async () => { fireEvent.change(el, { target: { value } }); });
  await flushEffects();
}

function getFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label.form-label')) as HTMLElement[];
  const label = labels.find((l) => l.textContent?.trim().startsWith(labelText));
  const input = label?.parentElement?.querySelector('input');
  if (!input) throw new Error(`label "${labelText}" 옆 input 을 찾지 못했다`);
  return input as HTMLInputElement;
}

/** 흐름도 행들 — 각 행의 [위치 select, 제품, 조리법, Step 시작, Step 끝] */
function flowRows(container: HTMLElement) {
  const scope = container.querySelector('[data-tour="flow-chart"]') as HTMLElement;
  const rowEls = Array.from(scope.querySelectorAll('select')).map((sel) => sel.closest('div[style*="flex-wrap"]') as HTMLElement);
  return rowEls.map((rowEl) => {
    const inputs = Array.from(rowEl.querySelectorAll('input')) as HTMLInputElement[];
    return { location: rowEl.querySelector('select') as HTMLSelectElement, product: inputs[0], processId: inputs[1], stepFrom: inputs[2], stepTo: inputs[3] };
  });
}

/** Step 칸을 열고 "layerid + stepseq" 항목을 골라 클릭한다 */
async function pickStep(input: HTMLInputElement, layerid: string, stepseq: string) {
  await act(async () => { fireEvent.focus(input); });
  await act(async () => { fireEvent.change(input, { target: { value: '' } }); });
  await flushEffects(3);
  const items = Array.from((input.closest('div[style*="flex"]') as HTMLElement).querySelectorAll('li'));
  const li = items.find((x) => x.textContent === `${layerid}${stepseq}`);
  if (!li) throw new Error(`항목 ${layerid}/${stepseq} 이 없다 — ${items.map((x) => x.textContent).join(', ')}`);
  await act(async () => { fireEvent.mouseDown(li); });
  await flushEffects(3);
}

async function fillRowKeys(row: ReturnType<typeof flowRows>[number]) {
  await type(row.location, LINE);
  await type(row.product, PRODUCT);
  await type(row.processId, PROCESS_ID);
}

async function clickButton(container: HTMLElement, startsWith: string) {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(startsWith)) as HTMLButtonElement;
  if (!btn) throw new Error(`"${startsWith}" 버튼을 찾지 못했다`);
  await act(async () => { fireEvent.click(btn); });
  await flushEffects();
}

async function renderPage() {
  mockState.captured = null;
  const utils = render(
    <MemoryRouter initialEntries={['/request']}>
      <ToastProvider><RequestPage /></ToastProvider>
    </MemoryRouter>
  );
  await flushEffects();
  const { container } = utils;
  await type(container.querySelector('select[name="line"]') as HTMLSelectElement, LINE);
  await type(getFieldInput(container, '조합법'), '조합법A');
  await type(getFieldInput(container, '제품 이름'), PRODUCT);
  await type(getFieldInput(container, '조리법'), PROCESS_ID);
  return utils;
}

const hasError = (el: HTMLElement) => el.classList.contains('error');
const toastTexts = () => Array.from(document.querySelectorAll('.toast-error')).map((e) => e.textContent ?? '');

describe('STEP1 흐름도 Step — stepseq', () => {
  it('Step 목록에 layerid 와 stepseq 가 함께(작게) 보인다', async () => {
    const { container } = await renderPage();
    const row = flowRows(container)[0];
    await fillRowKeys(row);
    await act(async () => { fireEvent.focus(row.stepFrom); });
    await flushEffects(3);
    const items = Array.from((row.stepFrom.closest('div[style*="flex"]') as HTMLElement).querySelectorAll('li'));
    expect(items.map((li) => [li.childNodes[0].textContent, li.querySelector('span')?.textContent])).toEqual([
      ['L01', 'AAAA1234'], ['L02', 'AAAA1236'], ['L09', 'BBBB1237'], ['L03', 'AAAA1238'], ['L10', 'BBBB1239'], ['L01', 'AAAA1240'],
    ]);
  });

  it('같은 layerid(L01)가 두 stepseq 에 있으면 고른 항목의 stepseq 가 저장된다', async () => {
    const { container } = await renderPage();
    const row = flowRows(container)[0];
    await fillRowKeys(row);
    await pickStep(flowRows(container)[0].stepFrom, 'L01', 'AAAA1240');
    await clickButton(container, '💾');
    const notes = JSON.parse((mockState.captured as { additional_notes: string }).additional_notes);
    expect(notes.detail.flow_chart[0]).toMatchObject({ step_from: 'L01', step_from_seq: 'AAAA1240' });
  });

  // claude 수정 (2026-10-16): 선택한 뒤에도 입력칸 안 오른쪽에 stepseq 가 보이고, 직접 타이핑하면 사라진다.
  it('선택한 뒤 Step 입력칸 안에 stepseq 가 보이고, 직접 타이핑하면 사라진다', async () => {
    const { container } = await renderPage();
    await fillRowKeys(flowRows(container)[0]);
    await pickStep(flowRows(container)[0].stepFrom, 'L01', 'AAAA1240');
    const hintOf = (input: HTMLInputElement) =>
      (input.parentElement as HTMLElement).querySelector('[data-testid="autocomplete-value-hint"]')?.textContent ?? null;
    expect(flowRows(container)[0].stepFrom.value).toBe('L01');
    expect(hintOf(flowRows(container)[0].stepFrom)).toBe('AAAA1240');
    expect(hintOf(flowRows(container)[0].stepTo)).toBeNull();
    await type(flowRows(container)[0].stepFrom, 'L0');
    expect(hintOf(flowRows(container)[0].stepFrom)).toBeNull();
  });

  it('같은 접두어: 2행이 1행 구간(AAAA1234~AAAA1238) 안에서 시작하면 막고, 다른 접두어(BBBB1237)는 허용한다', async () => {
    const { container } = await renderPage();
    await fillRowKeys(flowRows(container)[0]);
    await pickStep(flowRows(container)[0].stepFrom, 'L01', 'AAAA1234');
    await pickStep(flowRows(container)[0].stepTo, 'L03', 'AAAA1238');
    await clickButton(container.querySelector('[data-tour="flow-chart"]') as HTMLElement, '+');
    await fillRowKeys(flowRows(container)[1]);
    await pickStep(flowRows(container)[1].stepFrom, 'L02', 'AAAA1236');
    await pickStep(flowRows(container)[1].stepTo, 'L01', 'AAAA1240');

    await clickButton(container, '다음');
    expect(hasError(flowRows(container)[1].stepFrom)).toBe(true);
    expect(toastTexts().some((s) => s.includes('1행 Step 구간(AAAA1234~AAAA1238)'))).toBe(true);

    await pickStep(flowRows(container)[1].stepFrom, 'L09', 'BBBB1237');
    await pickStep(flowRows(container)[1].stepTo, 'L10', 'BBBB1239');
    await clickButton(container, '다음');
    const row2 = flowRows(container)[1];
    expect(hasError(row2.stepFrom) || hasError(row2.stepTo)).toBe(false);
  });

  it('같은 layerid 가 여러 stepseq 인데 직접 타이핑만 하면 blur 시 막는다', async () => {
    const { container } = await renderPage();
    await fillRowKeys(flowRows(container)[0]);
    const stepFrom = flowRows(container)[0].stepFrom;
    await type(stepFrom, 'L01');
    await act(async () => { fireEvent.focus(stepFrom); });
    await act(async () => { fireEvent.blur(stepFrom); });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    await flushEffects(3);
    expect(hasError(flowRows(container)[0].stepFrom)).toBe(true);
    expect(toastTexts().some((s) => s.includes('같은 Layer가 여러 stepseq에 있습니다'))).toBe(true);
  });
});
