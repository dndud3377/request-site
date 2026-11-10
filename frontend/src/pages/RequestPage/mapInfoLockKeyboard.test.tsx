/**
 * claude 수정 (2026-11-10): MAP 정보 잠금 시 키보드 입력 차단 테스트.
 *
 * 잠금 영역은 pointerEvents: 'none' 으로 마우스만 막고 있어 Tab 으로 잠긴 칸(예: 숫자 확인 값)에 입력할 수 있었다
 * (로컬 앱 재현: Shift+Tab 으로 num_check_value 포커스·입력 성공). 사용자 결정으로 막는다.
 * - 잠금 시 영역 전체를 <fieldset disabled> 로 감싼다 → 안의 input·select·button 이 모두 :disabled.
 * - contenteditable 인 RichTextEditor(MAP 삭제 이유)는 fieldset 으로 막히지 않아 readOnly 로 막는다.
 */
import React from 'react';
import { render, act, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { INITIAL_DETAIL, NUM_CHECK_APPLIES, MAP_DELETE_EDIT_PURPOSE, MAP_TYPE_DELETE_REQ, makeJayerRow } from './constants';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const PPPP_PP = 'AB_PPPP_01';

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value, readOnly }: { value: string; readOnly?: boolean }) => (
    <div data-testid="rte" data-readonly={String(!!readOnly)}>{value}</div>
  ),
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

const numCheckInput = (c: HTMLElement) => c.querySelector('input[name="num_check_value"]') as HTMLInputElement;

/** 저장 문서를 열어(편집 로드) STEP2 로 이동한다. */
async function openDocAtMapStep(detailOverride: Record<string, unknown>, mapInfoLocked: boolean) {
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
        ...INITIAL_DETAIL,
        request_purpose: '신규',
        line: '라인1',
        process_selection: '조합법A',
        partid_selection: '제품A',
        process_id: 'PROC_X1',
        customer_name: '고객사A',
        customer_requirement: '요구사항',
        map_type: 'NEW',
        ...detailOverride,
      },
      jayerRows: [{ ...makeJayerRow(), pp: 'AB_PPPP_01', st: 'X' }],
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

/** MAP 정보 잠금 영역(.form-grid) 안의 입력 요소 */
const mapControls = (c: HTMLElement) => {
  const grid = c.querySelector('.form-grid') as HTMLElement;
  return Array.from(grid.querySelectorAll('input, select, textarea, button')) as HTMLElement[];
};

// '해당 있음' + 숫자 저장 문서 — 숫자 칸 자체는 disabled 속성이 없어 잠금 전에는 키보드로 입력할 수 있었다.
const APPLIES_DETAIL = { num_check: NUM_CHECK_APPLIES, num_check_value: '5', num_check_images: [] };

describe('MAP 정보 잠금 — 키보드 입력 차단', () => {
  it('잠긴 문서는 영역 안 모든 입력 요소가 :disabled (숫자 확인 값 포함)', async () => {
    const { container } = await openDocAtMapStep(APPLIES_DETAIL, true);
    expect(container.querySelector('fieldset > .form-grid')).not.toBeNull();
    expect(numCheckInput(container).matches(':disabled')).toBe(true);
    const controls = mapControls(container);
    expect(controls.length).toBeGreaterThan(0);
    controls.forEach((el) => expect(el.matches(':disabled')).toBe(true));
  });

  it('대조군 — 잠기지 않은 문서는 숫자 확인 값과 MAP 목적 버튼을 쓸 수 있다', async () => {
    const { container } = await openDocAtMapStep(APPLIES_DETAIL, false);
    expect(numCheckInput(container).matches(':disabled')).toBe(false);
    expect(buttonWith(container, 'CLONE').matches(':disabled')).toBe(false);
  });

  it('MAP 삭제 이유 에디터는 잠기면 readOnly, 아니면 편집 가능', async () => {
    const deleteDetail = { request_purpose: MAP_DELETE_EDIT_PURPOSE, map_type: MAP_TYPE_DELETE_REQ, map_change_reason: '<p>이유</p>' };
    const locked = await openDocAtMapStep(deleteDetail, true);
    expect(locked.getByTestId('rte').getAttribute('data-readonly')).toBe('true');
    locked.unmount();
    const unlocked = await openDocAtMapStep(deleteDetail, false);
    expect(unlocked.getByTestId('rte').getAttribute('data-readonly')).toBe('false');
  });
});
