/**
 * claude 수정 (2026-10-19): MAP 정보 잠금(map_info_locked) 문서의 Step1 잠금 회귀 테스트.
 *
 * 사용자 보고: 3회차에 R 합의 후 반려된 문서를 재상신하며 제품 이름을 지웠다 다시 입력했더니
 * MAP 목적이 NEW → EXISTING 으로 바뀌어 상신됐다(Step1 라인/제품 변경 시 EXISTING 자동 재매칭).
 * 사용자 결정: R/고정 후결자 합의 이력이 있는 문서는 MAP 정보와 함께 요청 목적·라인·조합법·
 * 제품 이름·조리법도 수정할 수 없다 — 바뀌어야 하면 새 요청서를 작성한다.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
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

function purposeButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('[data-tour="request-purpose"] button')) as HTMLButtonElement[];
}

async function renderEditDoc(mapInfoLocked: boolean) {
  mockState.doc = {
    id: 7,
    status: 'rejected',
    map_info_locked: mapInfoLocked,
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
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 7 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await flushEffects(30);
  return view;
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

describe('MAP 정보 잠금 문서 — Step1 요청 목적·라인~조리법 잠금', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.doc = null;
    localStorage.clear();
  });

  it('map_info_locked 문서는 라인·조합법·제품 이름·조리법·요청 목적을 바꿀 수 없고 안내 문구가 보인다', async () => {
    const { container } = await renderEditDoc(true);
    expect((container.querySelector('select[name="line"]') as HTMLSelectElement).disabled).toBe(true);
    expect(getFieldInput(container, '조합법').disabled).toBe(true);
    expect(getFieldInput(container, '제품 이름').disabled).toBe(true);
    expect(getFieldInput(container, '조리법').disabled).toBe(true);
    const buttons = purposeButtons(container);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(container.textContent).toContain(i18n.t('request.step1_locked_notice'));
  });

  it('잠긴 문서를 임시저장해도 MAP 목적(NEW)과 라인~조리법이 그대로 저장된다', async () => {
    await renderEditDoc(true);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail).toMatchObject({
      map_type: 'NEW', line: '라인A', process_selection: PROCESS,
      partid_selection: 'AAAAAAAA-0001', process_id: PROCESS_ID, request_purpose: '신규',
    });
  });

  it('대조군 — 잠기지 않은 문서는 라인~조리법·요청 목적을 그대로 수정할 수 있다', async () => {
    const { container } = await renderEditDoc(false);
    expect((container.querySelector('select[name="line"]') as HTMLSelectElement).disabled).toBe(false);
    expect(getFieldInput(container, '조합법').disabled).toBe(false);
    expect(getFieldInput(container, '제품 이름').disabled).toBe(false);
    expect(getFieldInput(container, '조리법').disabled).toBe(false);
    expect(purposeButtons(container).every((b) => !b.disabled)).toBe(true);
    expect(container.textContent).not.toContain(i18n.t('request.step1_locked_notice'));
  });
});
