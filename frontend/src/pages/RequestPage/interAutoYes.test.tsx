/**
 * claude 수정 (2026-10-15): 조합법 기준 단어 → StepMap 3번(inter) 자동 YES 고정 동작 테스트 신설
 *
 * 규칙(INTER_AUTO_YES_PROCESS_PREFIXES, 기본값 ['test']):
 * - Step1 조합법이 기준 단어로 시작(대소문자 무시)하고 MAP 목적이 NEW 면 3번을 YES 로 고정(드롭다운 잠금 + 안내 문구).
 * - 기준에 해당하다가 해당하지 않는 조합법으로 바꾸면 NO 로 되돌린다.
 * - CLONE/EXISTING 은 손대지 않는다.
 * - 저장 문서를 다시 열 때는 저장값을 그대로 둔다(사용자가 조합법/MAP 목적을 바꾼 뒤부터 적용).
 */
import React from 'react';
import { render, act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { INITIAL_DETAIL } from './constants';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE = '라인1';
const PROCESS_AUTO = 'TEST_조합법';
const PROCESS_PLAIN = '조합법A';
const PRODUCT = '제품A';
const PROCESS_ID = 'PROC_X1';
const HINT = '조합법에 따라 YES로 고정됩니다';

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

/** StepMap 3번(inter) 드롭다운 — 라벨 '3번' 옆 select */
function interSelect(container: HTMLElement): HTMLSelectElement {
  const labels = Array.from(container.querySelectorAll('label.form-label')) as HTMLElement[];
  const label = labels.find((l) => l.textContent?.trim().startsWith('3번'));
  if (!label) throw new Error('3번 라벨을 찾지 못했다');
  const select = label.parentElement?.querySelector('select');
  if (!select) throw new Error('3번 select 를 찾지 못했다');
  return select as HTMLSelectElement;
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

describe('조합법 기준 단어 → 3번(inter) 자동 YES 고정', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.doc = null;
    localStorage.clear();
  });

  it('기준 단어로 시작하는 조합법(대소문자 무시) + NEW → 3번 YES·잠금·안내 문구, 2번은 미적용', async () => {
    const { container } = await renderNewDoc();
    await advanceToMapStep(container, PROCESS_AUTO);

    // MAP 목적 선택 전에는 판정하지 않는다.
    expect(interSelect(container).value).toBe('NO');

    await act(async () => { buttonWith(container, 'NEW').click(); });
    await flushEffects();

    const select = interSelect(container);
    expect(select.value).toBe('YES');
    expect(select.disabled).toBe(true);
    expect(container.textContent).toContain(HINT);
    // IN 적용 O/X · Xs/Ys/XYs/없음 버튼이 열리고, 사용자가 직접 고른다(값은 비어 있음).
    expect(buttonWith(container, 'IN 적용 O').disabled).toBe(false);

    const detail = await saveDraftAndCaptureDetail();
    expect(detail.inter).toBe('YES');
    expect(detail.eds_backside).toBe('미적용');
    expect(detail.in_apply).toBe('');
    expect(detail.inter_select).toBe('');
  });

  it('기준 단어가 아닌 조합법 + NEW → 3번은 NO 그대로, 잠기지 않는다', async () => {
    const { container } = await renderNewDoc();
    await advanceToMapStep(container, PROCESS_PLAIN);

    await act(async () => { buttonWith(container, 'NEW').click(); });
    await flushEffects();

    const select = interSelect(container);
    expect(select.value).toBe('NO');
    expect(select.disabled).toBe(false);
    expect(container.textContent).not.toContain(HINT);
  });

  it('CLONE 은 기준 단어 조합법이어도 3번을 건드리지 않는다', async () => {
    const { container } = await renderNewDoc();
    await advanceToMapStep(container, PROCESS_AUTO);

    await act(async () => { buttonWith(container, 'CLONE').click(); });
    await flushEffects();

    expect(interSelect(container).value).toBe('NO');
    expect(container.textContent).not.toContain(HINT);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.inter).toBe('NO');
  });

  it('YES 고정 후 기준에 해당하지 않는 조합법으로 바꾸면 NO 로 되돌리고 하위 값도 비운다', async () => {
    const { container } = await renderNewDoc();
    await advanceToMapStep(container, PROCESS_AUTO);

    await act(async () => { buttonWith(container, 'NEW').click(); });
    await flushEffects();
    await act(async () => { buttonWith(container, 'IN 적용 O').click(); });
    await flushEffects();
    await act(async () => { buttonWith(container, 'XYs').click(); });
    await flushEffects();
    expect(interSelect(container).value).toBe('YES');

    // STEP1 로 돌아가 조합법만 바꾼다(제품 이름·조리법은 그대로 유효).
    await act(async () => { buttonWith(container, '이전').click(); });
    await flushEffects();
    await act(async () => { fireEvent.change(getFieldInput(container, '조합법'), { target: { value: PROCESS_PLAIN } }); });
    await flushEffects();

    const detail = await saveDraftAndCaptureDetail();
    // 조합법을 바꾸면 기존 동작대로 제품 이름이 비워지고 MAP 정보(MAP 목적 포함)가 초기화된다.
    // 3번 NO 되돌리기(이 기능의 effect)는 그 초기화가 일어나지 않는 경우를 위한 안전망이다.
    expect(detail.map_type).toBe('');
    expect(detail.inter).toBe('NO');
    expect(detail.in_apply).toBe('');
    expect(detail.inter_select).toBe('');
  });

  it('저장 문서를 다시 열면 기준 단어 조합법 + NEW 여도 저장된 3번(NO)을 그대로 두고 잠그지 않는다', async () => {
    const detailFixture = {
      ...INITIAL_DETAIL,
      request_purpose: '신규',
      line: LINE,
      process_selection: PROCESS_AUTO,
      partid_selection: PRODUCT,
      process_id: PROCESS_ID,
      customer_name: '고객사A',
      customer_requirement: '요구사항',
      map_type: 'NEW',
      inter: 'NO',
    };
    mockState.doc = {
      id: 1,
      status: 'draft',
      title: '기존 제목',
      requester_name: '원작성자',
      requester_email: 'orig@example.com',
      requester_department: '원부서',
      product_name: PRODUCT,
      production_date: '',
      reference_materials: '',
      additional_notes: JSON.stringify({ detail: detailFixture, jayerRows: [], oayerRows: [], bbRows: [], history: [] }),
      approval_steps: [],
    };
    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
        <ToastProvider>
          <RequestPage />
        </ToastProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
    await flushEffects(20);

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();

    const select = interSelect(container);
    expect(select.value).toBe('NO');
    expect(select.disabled).toBe(false);
    expect(container.textContent).not.toContain(HINT);
  });
});
