/**
 * STEP2(MAP 정보) — MAP 목적(map_type) 게이트 회귀 테스트 (2026-10-22).
 *
 * 배경: MAP 목적을 고르기 전에도 아래 항목(지도 편차·예외 구역·X표시·Map Option 등)을 입력할 수 있어,
 * 그 상태에서 CLONE/EXISTING 을 처음 고르면 입력값이 초기화되지 않고 잠긴 채 저장됐다
 * (상세 보기에서는 지도 편차·예외 구역이 "없음"으로 덮여 보이는데 결재 판정은 저장값을 쓴다).
 * → Step1 게이트와 같은 방식으로 map_type 이 비어 있으면 MAP 목적 아래 영역 전체를 잠근다.
 *
 * 판정은 값(detail.map_type)만 본다 — 자동 매칭으로 EXISTING 이 채워지면 즉시 풀려야 하고,
 * 자동 매칭이 실패하거나 미등록 제품이면 MAP 목적 버튼은 계속 고를 수 있어야 한다.
 *
 * 매칭 데이터(getMapNames 목): 라인A→AAAAAAAA, 라인C→없음. mockState.mapNamesFail 이면 조회 실패.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const PROCESS = '조합법A';
const PROCESS_ID = 'PROC_X1';
const GATE_HINT = 'MAP 목적을 먼저 선택하면 나머지 항목을 입력할 수 있습니다.';
const MAP_OPTION_4 = '4번';
const FINAL_GDS_PLACEHOLDER = 'GDS version 입력';
const FINAL_ADD_BTN = '+ 추가';

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));

const mockState: { captured: unknown | null; mapNamesFail: boolean } = { captured: null, mapNamesFail: false };

jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: null }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인A' }, { name: '라인C' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['조합법A']),
    getProducts: () => Promise.resolve(['AAAAAAAA-0001', 'CCCCCCCC-0001']),
    getProcessId: () => Promise.resolve(['PROC_X1']),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: (line: string) => (mockState.mapNamesFail
      ? Promise.reject(new Error('조회 실패'))
      : Promise.resolve((({ 라인A: ['AAAAAAAA'], 라인C: [] }) as Record<string, string[]>)[line] ?? [])),
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

function buttonExact(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`"${text}" 버튼을 찾지 못했다`);
  return btn as HTMLButtonElement;
}

/** 브라우저와 같은 판정 — 자기 disabled 이거나 disabled fieldset 안에 있으면 조작할 수 없다. */
function isLocked(el: Element): boolean {
  return el.matches(':disabled');
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

/** Step1 을 채우고(요청 목적 '차용') 2단계(MAP 정보)로 이동한다. */
async function toMapStep(container: HTMLElement, line: string, product: string) {
  await act(async () => { fireEvent.change(container.querySelector('select[name="line"]') as HTMLSelectElement, { target: { value: line } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조합법'), { target: { value: PROCESS } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '제품 이름'), { target: { value: product } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조리법'), { target: { value: PROCESS_ID } }); });
  await flushEffects();
  await act(async () => { buttonWith(container, '차용').click(); });
  await flushEffects();
  const req = container.querySelector('input[name="customer_requirement"]') as HTMLInputElement;
  await act(async () => { fireEvent.change(req, { target: { value: '요구사항' } }); });
  await flushEffects();
  await act(async () => { buttonWith(container, '다음').click(); });
  await flushEffects();
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

/** MAP 목적 아래 영역의 대표 입력칸 — 게이트가 닫히면 전부 잠겨야 한다. */
function gatedControls(container: HTMLElement): Element[] {
  const selectors = [
    'select[name="only_prodc"]', 'select[name="map_change"]', 'select[name="ea_change"]',
    'select[name="mshot_change"]', 'input[name="map_value_x"]', 'input[name="ea_value"]',
  ];
  const controls = selectors.map((s) => {
    const el = container.querySelector(s);
    if (!el) throw new Error(`${s} 를 찾지 못했다`);
    return el;
  });
  return [...controls, buttonExact(container, 'YES'), buttonExact(container, MAP_OPTION_4)];
}

const hasHint = (container: HTMLElement) => (container.textContent ?? '').includes(GATE_HINT);

describe('STEP2 MAP 목적 게이트', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.mapNamesFail = false;
    localStorage.clear();
  });

  it('MAP 목적 미선택이면 아래 항목이 전부 잠기고 안내 문구가 보인다 — MAP 목적 버튼은 고를 수 있다', async () => {
    const { container } = await renderNewDoc();
    await toMapStep(container, '라인C', 'CCCCCCCC-0001');

    expect(hasHint(container)).toBe(true);
    gatedControls(container).forEach((el) => expect(isLocked(el)).toBe(true));
    ['NEW', 'CLONE', 'EXISTING'].forEach((mt) => expect(isLocked(buttonExact(container, mt))).toBe(false));
  });

  it('잠긴 상태에서 누른 Map Option 은 반영되지 않고, CLONE 을 고른 뒤 저장해도 기본값 그대로다', async () => {
    const { container } = await renderNewDoc();
    await toMapStep(container, '라인C', 'CCCCCCCC-0001');

    await act(async () => { buttonExact(container, MAP_OPTION_4).click(); });
    await act(async () => { buttonExact(container, 'YES').click(); });
    await flushEffects();
    await act(async () => { buttonExact(container, 'CLONE').click(); });
    await flushEffects();

    const detail = await saveDraftAndCaptureDetail();
    expect(detail.map_type).toBe('CLONE');
    expect(detail.tsv).toBe('미적용');
    expect(detail.final_yn).toBe('');
    expect(detail.map_change).toBe('변경 없음');
    expect(detail.mshot_change).toBe('없음');
  });

  it.each(['NEW', 'CLONE', 'EXISTING'])('%s 를 직접 고르면 잠금이 풀리고 안내 문구가 사라진다', async (mt) => {
    const { container } = await renderNewDoc();
    await toMapStep(container, '라인C', 'CCCCCCCC-0001');

    await act(async () => { buttonExact(container, mt).click(); });
    await flushEffects();

    expect(hasHint(container)).toBe(false);
    // CLONE/EXISTING 은 기존 규칙(isMapRegistered)대로 잠기는 칸이 따로 있으므로 항상 열리는 칸만 본다.
    expect(isLocked(container.querySelector('select[name="only_prodc"]') as Element)).toBe(false);
    expect(isLocked(buttonExact(container, 'YES'))).toBe(false);
    if (mt === 'NEW') {
      gatedControls(container).forEach((el) => {
        // 예외 구역 값 칸은 '변경 없음'이면 원래 잠긴다(게이트와 무관).
        if (el.matches('input[name="ea_value"]')) return;
        expect(isLocked(el)).toBe(false);
      });
    }
  });

  it('자동 매칭 EXISTING — MAP 목적·원본은 잠기지만 Final·C가문·PY·CC 는 입력해 저장할 수 있다', async () => {
    const { container } = await renderNewDoc();
    await toMapStep(container, '라인A', 'AAAAAAAA-0001');

    expect(buttonExact(container, 'EXISTING').className).toContain('active');
    expect(isLocked(buttonExact(container, 'NEW'))).toBe(true);
    expect(hasHint(container)).toBe(false);

    await act(async () => { fireEvent.change(container.querySelector('select[name="only_prodc"]') as HTMLSelectElement, { target: { value: 'Yes' } }); });
    await flushEffects();
    const py = container.querySelector('select[name="py_apply"]') as HTMLSelectElement;
    const cc = container.querySelector('select[name="mshot_change_cc"]') as HTMLSelectElement;
    expect(isLocked(py)).toBe(false);
    expect(isLocked(cc)).toBe(false);
    await act(async () => { fireEvent.change(py, { target: { value: 'O' } }); });
    await act(async () => { fireEvent.change(cc, { target: { value: 'exists' } }); });
    await act(async () => { buttonExact(container, 'YES').click(); });
    await flushEffects();
    const gdsInput = container.querySelector(`input[placeholder="${FINAL_GDS_PLACEHOLDER}"]`) as HTMLInputElement;
    expect(isLocked(gdsInput)).toBe(false);
    await act(async () => { fireEvent.change(gdsInput, { target: { value: 'GDS_1' } }); });
    await flushEffects();
    await act(async () => { buttonExact(container, FINAL_ADD_BTN).click(); });
    await flushEffects();

    const detail = await saveDraftAndCaptureDetail();
    expect(detail.map_type).toBe('EXISTING');
    expect(detail.only_prodc).toBe('Yes');
    expect(detail.py_apply).toBe('O');
    expect(detail.mshot_change_cc).toBe('exists');
    expect(detail.final_yn).toBe('YES');
    expect(detail.final_entries).toEqual(['GDS_1']);
  });

  it('자동 매칭 조회 실패 — MAP 목적은 비어 있고 버튼을 골라 잠금을 풀 수 있다', async () => {
    mockState.mapNamesFail = true;
    const { container } = await renderNewDoc();
    await toMapStep(container, '라인A', 'AAAAAAAA-0001');

    expect(hasHint(container)).toBe(true);
    ['NEW', 'CLONE', 'EXISTING'].forEach((mt) => expect(isLocked(buttonExact(container, mt))).toBe(false));

    await act(async () => { buttonExact(container, 'EXISTING').click(); });
    await flushEffects();
    expect(hasHint(container)).toBe(false);
    expect(isLocked(container.querySelector('select[name="only_prodc"]') as Element)).toBe(false);
  });
});
