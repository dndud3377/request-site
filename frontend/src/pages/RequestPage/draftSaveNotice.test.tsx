/**
 * 임시저장 안내 테스트.
 *
 * claude 수정 (2026-11-22): 임시저장 문서는 마지막 임시저장 후 60일이 지나면 자동 삭제된다(scheduler.delete_stale_drafts).
 * - 수동 임시저장 완료 토스트에 자동 삭제 규칙을 함께 보여준다.
 * - 20분 무조작 자동저장은 토스트 대신 화면 가운데 안내 모달로 보여주고, '확인'으로 닫는다.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

window.HTMLElement.prototype.scrollIntoView = () => {};

const mockState: { doc: unknown; payloads: string[] } = { doc: null, payloads: [] };

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
    update: (_id: number, body: { additional_notes: string }) => {
      mockState.payloads.push(body.additional_notes);
      return Promise.resolve({ data: { id: 1 } });
    },
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

const doc = {
  id: 1,
  status: 'draft',
  map_info_locked: false,
  title: '기존 제목',
  requester_name: '홍길동',
  requester_email: 'hong@example.com',
  requester_department: '개발팀',
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

const IDLE_MS = 20 * 60 * 1000;

const flush = async (times = 20) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

async function renderEditPage() {
  mockState.doc = doc;
  mockState.payloads = [];
  render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flush();
}

const findButton = (label: string) => Array.from(document.querySelectorAll('button'))
  .find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

afterEach(() => { jest.useRealTimers(); });

describe('임시저장 안내', () => {
  it('수동 임시저장 완료 토스트에 자동 삭제 규칙을 함께 보여준다', async () => {
    await renderEditPage();
    const saveBtn = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.includes(i18n.t('request.save_draft'))) as HTMLButtonElement;
    await act(async () => { saveBtn.click(); });
    await flush(5);
    const toast = document.querySelector('.toast-success')?.textContent ?? '';
    expect(toast).toContain(i18n.t('request.save_success'));
    expect(toast).toContain(i18n.t('request.draft_retention_notice'));
  });

  it('20분 무조작 자동저장은 토스트 대신 가운데 안내 모달로 보여주고 확인으로 닫는다', async () => {
    await renderEditPage();
    jest.useFakeTimers();
    // 활동 이벤트로 유휴 타이머를 가짜 타이머 위에서 다시 건다.
    act(() => { window.dispatchEvent(new Event('mousemove')); });
    act(() => { jest.advanceTimersByTime(IDLE_MS + 1000); });
    jest.useRealTimers();
    await flush(10);

    expect(mockState.payloads).toHaveLength(1);
    expect(screen.getByText(i18n.t('request.auto_save_notice_title') as string)).toBeDefined();
    expect(screen.getByText(i18n.t('request.auto_save_success') as string)).toBeDefined();
    expect(screen.getByText(i18n.t('request.draft_retention_notice') as string)).toBeDefined();
    expect(document.querySelector('.toast-info')).toBeNull();

    const confirmBtn = findButton(i18n.t('common.confirm') as string);
    if (!confirmBtn) throw new Error('확인 버튼을 찾지 못했다');
    await act(async () => { confirmBtn.click(); });
    expect(screen.queryByText(i18n.t('request.auto_save_notice_title') as string)).toBeNull();
  });
});
