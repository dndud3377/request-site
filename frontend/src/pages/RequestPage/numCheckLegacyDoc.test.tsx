/**
 * claude 수정 (2026-11-10): '숫자 확인 필수' 도입 전 문서(저장본에 num_check 키 없음) 예외 테스트.
 *
 * 사용자 결정(방안 A): 기존 문서는 '숫자 확인 필수'를 판정·검증하지 않고 넘어간다.
 * - 판별: 저장된 detail 에 num_check 키가 없으면 도입 전 문서다(새 문서는 INITIAL_DETAIL 로 항상 저장).
 * - 도입 전 문서는 NEW + PPPP 여도 '해당 있음'으로 자동 전환하지 않고, 숫자·사진 필수 검증도 하지 않는다.
 * - 저장 시 num_check·num_check_value·num_check_images 키를 보내지 않는다 — 다시 열어도 도입 전 문서로 판별된다.
 *   (MAP 정보가 잠긴 문서도 서버 보정 `_with_edit_load_backfill` 이 키 없음을 같은 값으로 보므로 400 이 나지 않는다)
 */
import React from 'react';
import { render, act, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { INITIAL_DETAIL, NUM_CHECK_DETAIL_KEYS, NUM_CHECK_APPLIES, NUM_CHECK_NONE, makeJayerRow } from './constants';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const PPPP_PP = 'AB_PPPP_01';

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
    getProcesses: () => Promise.resolve(['조합법A']),
    getProducts: () => Promise.resolve(['제품A']),
    getProcessId: () => Promise.resolve(['PROC_X1']),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: () => Promise.resolve([]),
    getMapInfo: () => Promise.resolve({ AAA1: null, AAA2: null, AAA3: null }),
    getJobFileLayer: () => Promise.resolve([]),
    getOvlLayer: () => Promise.resolve([]),
    getBbExternalData: () => Promise.resolve([]),
    getBarcodeCandidates: () => Promise.resolve([]),
    getNumCheckConfig: () => Promise.resolve({ image_threshold: 10 }),
  },
  uploadImageAPI: { upload: () => Promise.resolve({ path: 'mshot_images/n1.png' }) },
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

function buttonWith(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`"${text}" 버튼을 찾지 못했다`);
  return btn as HTMLButtonElement;
}

const numCheckSelect = (c: HTMLElement) => c.querySelector('select[name="num_check"]') as HTMLSelectElement;
const numCheckInput = (c: HTMLElement) => c.querySelector('input[name="num_check_value"]') as HTMLInputElement;
const errorToasts = () =>
  Array.from(document.querySelectorAll('.toast-error')).map((el) => el.textContent ?? '').join('\n');

/** INITIAL_DETAIL 에서 num_check 키들을 뺀 detail — '숫자 확인 필수' 도입 전에 저장된 문서 형식 */
const legacyBaseDetail = Object.fromEntries(
  Object.entries(INITIAL_DETAIL).filter(([key]) => !NUM_CHECK_DETAIL_KEYS.includes(key)),
);

/** 저장 문서를 열어(편집 로드) STEP2 로 이동한다. J 행 하나의 pp 를 지정한다. */
async function openDocAtMapStep(baseDetail: object, pp: string, mapInfoLocked = false) {
  mockState.captured = null;
  mockState.doc = {
    id: 1,
    status: mapInfoLocked ? 'rejected' : 'draft',
    map_info_locked: mapInfoLocked,
    title: '기존 제목',
    requester_name: '원작성자',
    requester_email: 'orig@example.com',
    requester_department: '원부서',
    product_name: '제품A',
    production_date: '',
    reference_materials: '',
    additional_notes: JSON.stringify({
      detail: {
        ...baseDetail,
        request_purpose: '신규',
        line: '라인1',
        process_selection: '조합법A',
        partid_selection: '제품A',
        process_id: 'PROC_X1',
        customer_name: '고객사A',
        customer_requirement: '요구사항',
        map_type: 'NEW',
      },
      // J 행은 ST=X — ST=O 행이 있으면 STEP1 이 뼈찜 조합 영역을 필수로 요구한다(PPPP 판정은 ST 무관).
      jayerRows: [{ ...makeJayerRow(), pp, st: 'X' }],
      oayerRows: [],
      bbRows: [],
      history: [],
    }),
    approval_steps: [],
  };
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flushEffects(20);
  await act(async () => { buttonWith(view.container, '다음').click(); });
  await flushEffects();
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

describe("'숫자 확인 필수' 도입 전 문서(num_check 키 없음)", () => {
  it('NEW + PPPP 여도 해당 없음 그대로 — 숫자칸 잠김, STEP2 다음에서 필수 오류 없음', async () => {
    const { container } = await openDocAtMapStep(legacyBaseDetail, PPPP_PP);
    expect(numCheckSelect(container).value).toBe(NUM_CHECK_NONE);
    expect(numCheckInput(container).disabled).toBe(true);
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(errorToasts()).not.toContain(i18n.t('request.num_check_value'));
    expect(numCheckSelect(container)).toBeNull(); // STEP3 으로 넘어갔다
  });

  it('저장 시 num_check 키 3개를 보내지 않는다(다시 열어도 도입 전 문서로 판별)', async () => {
    await openDocAtMapStep(legacyBaseDetail, PPPP_PP);
    const detail = await saveDraftAndCaptureDetail();
    NUM_CHECK_DETAIL_KEYS.forEach((key) => expect(detail).not.toHaveProperty(key));
    expect(detail.customer_requirement).toBe('요구사항');
  });

  it('MAP 정보가 잠긴 도입 전 문서도 해당 없음 그대로이고 키를 보내지 않는다(재현 사례)', async () => {
    const { container } = await openDocAtMapStep(legacyBaseDetail, PPPP_PP, true);
    expect(numCheckSelect(container).value).toBe(NUM_CHECK_NONE);
    const detail = await saveDraftAndCaptureDetail();
    NUM_CHECK_DETAIL_KEYS.forEach((key) => expect(detail).not.toHaveProperty(key));
  });

  it('대조군 — num_check 키가 있는 문서는 NEW + PPPP 면 해당 있음으로 바뀌고 키를 저장한다', async () => {
    const { container } = await openDocAtMapStep(INITIAL_DETAIL, PPPP_PP);
    expect(numCheckSelect(container).value).toBe(NUM_CHECK_APPLIES);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check).toBe(NUM_CHECK_APPLIES);
    expect(detail).toHaveProperty('num_check_value');
    expect(detail).toHaveProperty('num_check_images');
  });
});
