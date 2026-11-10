/**
 * 임시저장 실패 토스트 테스트.
 *
 * claude 수정 (2026-11-10): 임시저장이 서버에서 거부되면(예: MAP 정보 잠금 400) 서버 거부 사유를 토스트에 보여준다.
 * 예전에는 사유와 무관하게 common.error("오류가 발생했습니다.")만 보여 사용자가 원인을 알 수 없었다.
 * - 저장 API 가 Error 로 거부 → err.message(`HTTP 400: <서버 error>`)가 그대로 보인다.
 * - Error 가 아닌 값으로 거부 → common.error 기본 문구가 보인다.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

window.HTMLElement.prototype.scrollIntoView = () => {};

const LOCK_ERROR = 'HTTP 400: MAP 정보 검토(RFG)가 완료된 뒤에는 MAP 정보와 요청 목적·라인·조합법·제품 이름·조리법을 수정할 수 없습니다.';

const mockState: { doc: unknown; updateError: unknown } = { doc: null, updateError: null };

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));

// ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 → 평범한 함수로 둔다.
jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: mockState.doc }),
    update: () => Promise.reject(mockState.updateError),
    create: () => Promise.resolve({ data: { id: 1 } }),
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['RECIPE_A']),
    getProducts: () => Promise.resolve(['PART_1000']),
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

const lockedRejectedDoc = {
  id: 1,
  status: 'rejected',
  map_info_locked: true,
  title: '기존 제목',
  requester_name: '원작성자',
  requester_email: 'orig@example.com',
  requester_department: '원부서',
  product_name: 'PART_1000',
  production_date: '2026-09-01',
  reference_materials: '',
  additional_notes: JSON.stringify({
    detail: {
      request_purpose: '신규', other_purpose: [], line: '라인1', process_selection: 'RECIPE_A',
      partid_selection: 'PART_1000', process_id: 'PROC_X1', customer_name: '고객사A',
      customer_requirement: '요구사항', flow_chart: [], map_type: 'NEW', only_prodc: 'No',
      notifiers: [], post_approvers: [],
    },
    jayerRows: [], oayerRows: [], bbRows: [], history: [],
  }),
  approval_steps: [],
};

const flush = async (times = 20) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

const errorToasts = () =>
  Array.from(document.querySelectorAll('.toast-error')).map((el) => el.textContent ?? '').join('\n');

async function renderAndSaveDraft(updateError: unknown) {
  mockState.doc = lockedRejectedDoc;
  mockState.updateError = updateError;
  render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flush();
  const saveBtn = Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent?.includes(i18n.t('request.save_draft'))) as HTMLButtonElement | undefined;
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { saveBtn.click(); });
  await flush(5);
}

describe('임시저장 실패 토스트', () => {
  it('서버가 거부하면 거부 사유(err.message)가 토스트에 보인다', async () => {
    await renderAndSaveDraft(new Error(LOCK_ERROR));
    expect(errorToasts()).toContain(LOCK_ERROR);
    expect(errorToasts()).not.toContain(i18n.t('common.error'));
  });

  it('Error 가 아닌 값으로 거부되면 common.error 기본 문구가 보인다', async () => {
    await renderAndSaveDraft('network down');
    expect(errorToasts()).toContain(i18n.t('common.error'));
  });
});
