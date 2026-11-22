/**
 * 임시저장 시 변경 이력(history) 보존 테스트.
 *
 * claude 수정 (2026-11-22): 반려·중단 문서를 수정 화면에서 임시저장하면 additional_notes.history 가
 * 빈 배열로 저장돼 이전 회차 변경 이력이 영구 삭제됐다(buildEnrichedForm 이 재상신이 아닐 때 history=[]).
 * - 임시저장 PATCH 에 불러온 history 가 그대로(건수·내용) 실려야 한다.
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

const baseDetail = (requirement: string) => ({
  request_purpose: '신규', other_purpose: [], line: '라인1', process_selection: 'RECIPE_A',
  partid_selection: 'PART_1000', process_id: 'PROC_X1', customer_name: '고객사A',
  customer_requirement: requirement, flow_chart: [], map_type: 'NEW', only_prodc: 'No',
  notifiers: [], post_approvers: [],
});

const snapshot = (timestamp: string, requirement: string) => ({
  timestamp, detail: baseDetail(requirement), jayerRows: [], oayerRows: [], bbRows: [], extraRows: [],
});

const SAVED_HISTORY = [
  snapshot('2026-11-01T01:00:00.000Z', '요구사항 1차'),
  snapshot('2026-11-10T01:00:00.000Z', '요구사항 2차'),
];

const docWithHistory = (status: string) => ({
  id: 1,
  status,
  map_info_locked: false,
  title: '기존 제목',
  requester_name: '원작성자',
  requester_email: 'orig@example.com',
  requester_department: '원부서',
  product_name: 'PART_1000',
  production_date: '2026-09-01',
  reference_materials: '',
  additional_notes: JSON.stringify({
    detail: baseDetail('요구사항 3차'),
    jayerRows: [], oayerRows: [], bbRows: [], history: SAVED_HISTORY,
  }),
  approval_steps: [],
});

const flush = async (times = 20) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

async function openAndSaveDraft(status: string) {
  mockState.doc = docWithHistory(status);
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
  const saveBtn = Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent?.includes(i18n.t('request.save_draft'))) as HTMLButtonElement | undefined;
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { saveBtn.click(); });
  await flush(5);
}

describe('임시저장 시 변경 이력(history) 보존', () => {
  it.each(['rejected', 'pause'])('%s 문서를 임시저장해도 불러온 history 가 그대로 저장된다', async (status) => {
    await openAndSaveDraft(status);
    expect(mockState.payloads).toHaveLength(1);
    const saved = JSON.parse(mockState.payloads[0]);
    expect(saved.history).toEqual(SAVED_HISTORY);
  });
});
