/**
 * claude 수정 (2026-10-15): STEP2 지도 편차 X/Y·예외 구역 값 숫자 검증 테스트 신설
 *
 * 재현된 문제: C가문 No · 신규 · NEW · 지도 편차 '변경 있음' 에서 X/Y 에 '.' 만 들어가도 '다음'/상신이 통과했다
 * (검증이 빈 값만 봤고, 입력 필터 sanitizeSignedDecimal 은 '.'·'-' 를 남긴다).
 * 이제 숫자로 읽히지 않는 값은 STEP2 검증(validate(2))에서 막힌다.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE = '라인1';
const PROCESS_PLAIN = '조합법A';
const PRODUCT = '제품A';
const PROCESS_ID = 'PROC_X1';
const MAP_TITLE = '🗺️';
const INVALID_NUMBER = '숫자를 입력해 주세요.';

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
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['TEST_조합법', '조합법A']),
    getProducts: () => Promise.resolve(['제품A']),
    getProcessId: () => Promise.resolve(['PROC_X1']),
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

async function renderNewDoc() {
  mockState.captured = null;
  mockState.doc = null;
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

/** Step1 필수값을 채우고(조합법은 인자) 2단계(MAP 정보)로 이동한다. */
async function advanceToMapStep(container: HTMLElement, process: string) {
  const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
  await act(async () => { fireEvent.change(lineSelect, { target: { value: LINE } }); });
  await flushEffects();

  await act(async () => { fireEvent.change(getFieldInput(container, '조합법'), { target: { value: process } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '제품 이름'), { target: { value: PRODUCT } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조리법'), { target: { value: PROCESS_ID } }); });
  await flushEffects();

  await act(async () => { buttonWith(container, '차용').click(); });
  await flushEffects();

  const customerReqInput = container.querySelector('input[name="customer_requirement"]') as HTMLInputElement;
  await act(async () => { fireEvent.change(customerReqInput, { target: { value: '요구사항' } }); });
  await flushEffects();

  await act(async () => { buttonWith(container, '다음').click(); });
  await flushEffects();
}


const onMapStep = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.form-section-title')).some((e) => e.textContent?.includes(MAP_TITLE));

async function setField(c: HTMLElement, selector: string, value: string) {
  const el = c.querySelector(selector) as HTMLInputElement | HTMLSelectElement | null;
  if (!el) throw new Error(`${selector} 를 찾지 못했다`);
  await act(async () => { fireEvent.change(el, { target: { value } }); });
  await flushEffects();
}

/** STEP2 까지 와서 NEW + 지도 편차 '변경 있음' + 사유 입력까지 해 둔다. */
async function prepareMapChange(container: HTMLElement) {
  await advanceToMapStep(container, PROCESS_PLAIN);
  await act(async () => { buttonWith(container, 'NEW').click(); });
  await flushEffects();
  await setField(container, 'select[name="map_change"]', '변경 있음');
  await setField(container, 'input[name="map_reason"]', '사유');
}

async function clickNext(container: HTMLElement) {
  await act(async () => { buttonWith(container, '다음').click(); });
  await flushEffects();
}

describe('STEP2 숫자 검증 — 지도 편차 X/Y·예외 구역 값', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.doc = null;
    localStorage.clear();
  });

  it("X/Y 에 '.' 만 있으면 STEP2 에서 막히고 두 칸에 숫자 오류가 표시된다(재현 케이스)", async () => {
    const { container } = await renderNewDoc();
    await prepareMapChange(container);
    await setField(container, 'input[name="map_value_x"]', '.');
    await setField(container, 'input[name="map_value_y"]', '.');

    await clickNext(container);

    expect(onMapStep(container)).toBe(true);
    expect(container.querySelector('input[name="map_value_x"]')?.classList.contains('error')).toBe(true);
    expect(container.querySelector('input[name="map_value_y"]')?.classList.contains('error')).toBe(true);
    expect(container.textContent).toContain(INVALID_NUMBER);
  });

  it("X 에 '-' 만 있어도 막힌다", async () => {
    const { container } = await renderNewDoc();
    await prepareMapChange(container);
    await setField(container, 'input[name="map_value_x"]', '-');
    await setField(container, 'input[name="map_value_y"]', '0.8');

    await clickNext(container);

    expect(onMapStep(container)).toBe(true);
    expect(container.querySelector('input[name="map_value_x"]')?.classList.contains('error')).toBe(true);
    expect(container.querySelector('input[name="map_value_y"]')?.classList.contains('error')).toBe(false);
  });

  it('음수·소수 숫자는 통과해 STEP3 으로 넘어간다', async () => {
    const { container } = await renderNewDoc();
    await prepareMapChange(container);
    await setField(container, 'input[name="map_value_x"]', '-1.5');
    await setField(container, 'input[name="map_value_y"]', '.5');

    await clickNext(container);

    expect(onMapStep(container)).toBe(false);
  });

  it("예외 구역 '변경 있음' 에 '-' 만 있으면 막힌다", async () => {
    const { container } = await renderNewDoc();
    await advanceToMapStep(container, PROCESS_PLAIN);
    await act(async () => { buttonWith(container, 'NEW').click(); });
    await flushEffects();
    await setField(container, 'select[name="ea_change"]', '변경 있음');
    await setField(container, 'input[name="ea_value"]', '-');

    await clickNext(container);

    expect(onMapStep(container)).toBe(true);
    expect(container.querySelector('input[name="ea_value"]')?.classList.contains('error')).toBe(true);
    expect(container.textContent).toContain(INVALID_NUMBER);
  });
});
