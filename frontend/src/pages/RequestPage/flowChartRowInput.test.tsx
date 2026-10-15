/**
 * claude 수정 (2026-10-15): STEP1 흐름도 행 입력 회귀 테스트.
 *  ① 빠진 칸을 채우면 그 칸의 빨간 테두리(flow_row_incomplete)가 "다음"을 다시 누르지 않아도 바로 지워진다.
 *  ② 행의 위치(라인)를 바꾸면 같은 행의 제품 이름·조리법·Step 이 모두 비워진다.
 *  ③ 제품 이름·조리법도 목록에 없는 값이면 blur 시 에러 + 토스트, "다음" 진행 차단.
 *     목록 자체가 비어 있으면(마스터 DB 에 정보 없음) 직접 입력값을 그대로 인정한다(Step 과 같은 규칙).
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

// jsdom 에는 scrollIntoView 구현이 없다 — 검증 실패 시 앱이 호출하는 스크롤 동작을 no-op 처리.
window.HTMLElement.prototype.scrollIntoView = () => {};

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE_WITH_DATA = '라인1';
const LINE_WITHOUT_DATA = '라인3';
const PRODUCT = 'FP1';
const PROCESS_ID = 'FPID1';

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
    update: () => Promise.resolve({ data: { id: 1 } }),
    create: () => Promise.resolve({ data: { id: 1 } }),
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }, { name: '라인3' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['조합법A']),
    getProducts: (line: string) => Promise.resolve(line === '라인1' ? ['FP1', 'FP2'] : []),
    getProcessId: (line: string, product?: string) =>
      Promise.resolve(line === '라인1' && (!product || product === 'FP1') ? ['FPID1'] : []),
    getLayerIds: () => Promise.resolve(['10', '20']),
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

/** AutocompleteInput 의 onBlur 는 120ms 지연 호출된다 */
async function blurAndWait(input: HTMLElement) {
  await act(async () => { fireEvent.focus(input); });
  await act(async () => { fireEvent.blur(input); });
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
  await flushEffects(3);
}

function flowRow(container: HTMLElement) {
  const scope = container.querySelector('[data-tour="flow-chart"]') as HTMLElement;
  if (!scope) throw new Error('흐름도 영역을 찾지 못했다');
  const inputs = Array.from(scope.querySelectorAll('input')) as HTMLInputElement[];
  return {
    location: scope.querySelector('select') as HTMLSelectElement,
    product: inputs[0],
    processId: inputs[1],
    stepFrom: inputs[2],
    stepTo: inputs[3],
  };
}

async function type(el: HTMLElement, value: string) {
  await act(async () => { fireEvent.change(el, { target: { value } }); });
  await flushEffects();
}

async function clickNext(container: HTMLElement) {
  const btn = Array.from(container.querySelectorAll('button.btn-primary'))
    .find((b) => b.textContent?.trim().startsWith('다음')) as HTMLButtonElement;
  if (!btn) throw new Error('"다음" 버튼을 찾지 못했다');
  await act(async () => { fireEvent.click(btn); });
  await flushEffects();
}

function getFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label.form-label')) as HTMLElement[];
  const label = labels.find((l) => l.textContent?.trim().startsWith(labelText));
  const input = label?.parentElement?.querySelector('input');
  if (!input) throw new Error(`label "${labelText}" 옆 input 을 찾지 못했다`);
  return input as HTMLInputElement;
}

/** 흐름도는 상단 라인·조합법·제품 이름·조리법을 모두 고른 뒤에야 입력할 수 있다(disableOptional) */
async function renderPage() {
  const utils = render(
    <MemoryRouter initialEntries={['/request']}>
      <ToastProvider><RequestPage /></ToastProvider>
    </MemoryRouter>
  );
  await flushEffects();
  const { container } = utils;
  await type(container.querySelector('select[name="line"]') as HTMLSelectElement, LINE_WITH_DATA);
  await type(getFieldInput(container, '조합법'), '조합법A');
  await type(getFieldInput(container, '제품 이름'), PRODUCT);
  await type(getFieldInput(container, '조리법'), PROCESS_ID);
  expect(flowRow(container).product.disabled).toBe(false);
  return utils;
}

const hasError = (el: HTMLElement) => el.classList.contains('error');
const toastTexts = () => Array.from(document.querySelectorAll('.toast-error')).map((e) => e.textContent ?? '');

describe('STEP1 흐름도 행 입력', () => {
  it('① 빠진 칸을 채우면 그 칸의 에러 테두리가 즉시 지워진다', async () => {
    const { container } = await renderPage();
    await type(flowRow(container).location, LINE_WITH_DATA);
    await clickNext(container);

    expect(hasError(flowRow(container).product)).toBe(true);
    expect(hasError(flowRow(container).processId)).toBe(true);

    await type(flowRow(container).product, PRODUCT);
    expect(hasError(flowRow(container).product)).toBe(false);
    // 아직 비어 있는 칸은 그대로 표시된다
    expect(hasError(flowRow(container).processId)).toBe(true);
  });

  it('② 위치(라인)를 바꾸면 같은 행의 제품 이름·조리법·Step 이 모두 비워진다', async () => {
    const { container } = await renderPage();
    await type(flowRow(container).location, LINE_WITH_DATA);
    await type(flowRow(container).product, PRODUCT);
    await type(flowRow(container).processId, PROCESS_ID);
    await type(flowRow(container).stepFrom, '10');
    await type(flowRow(container).stepTo, '20');
    expect(flowRow(container).stepTo.value).toBe('20');

    await type(flowRow(container).location, LINE_WITHOUT_DATA);
    const row = flowRow(container);
    expect(row.location.value).toBe(LINE_WITHOUT_DATA);
    expect([row.product.value, row.processId.value, row.stepFrom.value, row.stepTo.value]).toEqual(['', '', '', '']);
  });

  it('③ 목록에 없는 제품 이름·조리법은 blur 시 에러 + 토스트, "다음" 으로 넘어가지 못한다', async () => {
    const { container } = await renderPage();
    await type(flowRow(container).location, LINE_WITH_DATA);

    await type(flowRow(container).product, 'NOPE');
    await blurAndWait(flowRow(container).product);
    expect(hasError(flowRow(container).product)).toBe(true);
    expect(toastTexts().some((s) => s.includes('제품 이름은 목록에 있는 값만'))).toBe(true);

    // 제품을 유효값으로 고친 뒤 조리법에 목록 밖 값 → 같은 방식으로 막힌다
    await type(flowRow(container).product, PRODUCT);
    await type(flowRow(container).processId, 'NOPE_PID');
    await type(flowRow(container).stepFrom, '10');
    await type(flowRow(container).stepTo, '20');
    await blurAndWait(flowRow(container).processId);
    expect(hasError(flowRow(container).processId)).toBe(true);
    expect(toastTexts().some((s) => s.includes('조리법은 목록에 있는 값만'))).toBe(true);

    // 에러를 지운 상태(값 재입력)에서도 "다음" 을 누르면 validate 가 다시 막는다
    await type(flowRow(container).processId, 'NOPE_PID2');
    expect(hasError(flowRow(container).processId)).toBe(false);
    await clickNext(container);
    expect(hasError(flowRow(container).processId)).toBe(true);
    expect(hasError(flowRow(container).product)).toBe(false);
  });

  it('③ 목록 자체가 비어 있으면(마스터 DB 에 정보 없음) 직접 입력값을 인정한다', async () => {
    const { container } = await renderPage();
    await type(flowRow(container).location, LINE_WITHOUT_DATA);
    await type(flowRow(container).product, 'ANY_PRODUCT');
    await blurAndWait(flowRow(container).product);
    await type(flowRow(container).processId, 'ANY_PID');
    await blurAndWait(flowRow(container).processId);

    expect(hasError(flowRow(container).product)).toBe(false);
    expect(hasError(flowRow(container).processId)).toBe(false);
    expect(toastTexts().some((s) => s.includes('목록에 있는 값만'))).toBe(false);

    await clickNext(container);
    expect(hasError(flowRow(container).product)).toBe(false);
    expect(hasError(flowRow(container).processId)).toBe(false);
  });
});
