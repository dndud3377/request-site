/**
 * CLONE/EXISTING(맵 등록됨) — 리전별 지도편차·예외구역 잠긴 기본값 재현 테스트.
 *
 * 배경: MAP 목적이 CLONE/EXISTING이면 StepMap에서 지도편차(map_change_top/bottom)·예외구역
 * (ea_value) 입력칸이 전부 잠기는데도, INITIAL_DETAIL 기본값('변경 있음'/300)이 그대로 상신되던
 * 문제를 고쳤다. 신규 문서에서 CLONE을 처음 고르고 C가문을 Yes로 켜는 실제 흐름을 그대로
 * 구동해, 상신(임시저장) payload 에 '변경 없음'/빈 값이 저장되는지 확인한다.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE = '라인1';
const PROCESS = '조합법A';
const PRODUCT = '제품A';
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

const mockState: { captured: unknown | null } = { captured: null };

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
    getProducts: () => Promise.resolve([PRODUCT]),
    getProcessId: () => Promise.resolve([PROCESS_ID]),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: () => Promise.resolve([]),
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

function buttonWith(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
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

/** Step1 필수값(요청 목적·라인·조합법·제품·조리법·특이사항)을 채우고 2단계(MAP 정보)로 이동한다. */
async function advanceToMapStep(container: HTMLElement) {
  // 요청 목적 버튼은 라인·조합법·제품 이름·조리법을 모두 채우기 전까지 disabled 이므로 먼저 채운다.
  const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
  await act(async () => { fireEvent.change(lineSelect, { target: { value: LINE } }); });
  await flushEffects();

  const processInput = getFieldInput(container, '조합법');
  await act(async () => { fireEvent.change(processInput, { target: { value: PROCESS } }); });
  await flushEffects();

  const productInput = getFieldInput(container, '제품 이름');
  await act(async () => { fireEvent.change(productInput, { target: { value: PRODUCT } }); });
  await flushEffects();

  const processIdInput = getFieldInput(container, '조리법');
  await act(async () => { fireEvent.change(processIdInput, { target: { value: PROCESS_ID } }); });
  await flushEffects();

  await act(async () => { buttonWith(container, '차용').click(); });
  await flushEffects();

  // 특이사항(customer_requirement)을 채워 '고객 요구사항 없음' 확인 관문을 건너뛴다.
  const customerReqInput = container.querySelector('input[name="customer_requirement"]') as HTMLInputElement;
  await act(async () => { fireEvent.change(customerReqInput, { target: { value: '요구사항' } }); });
  await flushEffects();

  const nextBtn = buttonWith(container, '다음');
  await act(async () => { nextBtn.click(); });
  await flushEffects();
}

/** '임시저장'을 눌러 서버로 나간 payload 의 detail 을 읽는다. */
async function saveDraftAndCaptureDetail(): Promise<Record<string, unknown>> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { (saveBtn as HTMLButtonElement).click(); });
  await flushEffects();
  const payload = mockState.captured as { additional_notes: string } | null;
  if (!payload) throw new Error('임시저장 payload 를 캡처하지 못했다');
  const notes = JSON.parse(payload.additional_notes);
  return notes.detail;
}

describe('CLONE 신규 작성 — 리전별 지도편차·예외구역은 잠긴 채 항상 변경없음/빈 값이어야 한다', () => {
  beforeEach(() => {
    mockState.captured = null;
    localStorage.clear();
  });

  it('CLONE 선택 후 C가문(Only C가문 제품)을 Yes로 켜도 map_change_top/bottom은 변경 없음, ea_value는 빈 값이다', async () => {
    const { container } = await renderNewDoc();
    await advanceToMapStep(container);

    // MAP 목적 최초 선택(handleMapTypeSelect 첫 선택 경로)
    await act(async () => { buttonWith(container, 'CLONE').click(); });
    await flushEffects();

    // C가문 Yes 전환(handleOnlyProdcChange) — 리전별 지도편차 입력칸이 열린다.
    const prodcSelect = container.querySelector('select[name="only_prodc"]') as HTMLSelectElement;
    await act(async () => { fireEvent.change(prodcSelect, { target: { value: 'Yes' } }); });
    await flushEffects();

    // 화면에도 '변경 없음'으로 잠겨 있어야 한다(사용자가 바꿀 수 없으므로 disabled 상태여야 함).
    const topSelect = container.querySelector('select[name="map_change_top"]') as HTMLSelectElement;
    const bottomSelect = container.querySelector('select[name="map_change_bottom"]') as HTMLSelectElement;
    expect(topSelect.value).toBe('변경 없음');
    expect(topSelect.disabled).toBe(true);
    expect(bottomSelect.value).toBe('변경 없음');
    expect(bottomSelect.disabled).toBe(true);

    const detail = await saveDraftAndCaptureDetail();
    expect(detail.map_change_top).toBe('변경 없음');
    expect(detail.map_change_bottom).toBe('변경 없음');
    expect(detail.map_value_x_top).toBe('');
    expect(detail.map_value_y_top).toBe('');
    expect(detail.map_value_x_bottom).toBe('');
    expect(detail.map_value_y_bottom).toBe('');
    expect(detail.ea_value).toBe('');
    expect(detail.ea_change).toBe('변경 없음');
  });

  it('C가문을 Yes → No → Yes로 다시 전환해도 여전히 변경 없음/빈 값이다', async () => {
    const { container } = await renderNewDoc();
    await advanceToMapStep(container);

    await act(async () => { buttonWith(container, 'CLONE').click(); });
    await flushEffects();

    const prodcSelect = container.querySelector('select[name="only_prodc"]') as HTMLSelectElement;
    await act(async () => { fireEvent.change(prodcSelect, { target: { value: 'Yes' } }); });
    await flushEffects();
    await act(async () => { fireEvent.change(prodcSelect, { target: { value: 'No' } }); });
    await flushEffects();
    await act(async () => { fireEvent.change(prodcSelect, { target: { value: 'Yes' } }); });
    await flushEffects();

    const detail = await saveDraftAndCaptureDetail();
    expect(detail.map_change_top).toBe('변경 없음');
    expect(detail.map_change_bottom).toBe('변경 없음');
    expect(detail.ea_value).toBe('');
  });
});
