/**
 * 홈 화면 SD-Layer 예외 버튼 — 모든 사용자에게 보이고, 합의 대기 건수(J+O)가 있으면 버튼에 (N) 을 붙인다.
 * 모달을 닫으면 건수를 다시 불러온다.
 *
 * ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 → 평범한 함수 + mockState.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';
import { ToastProvider } from '../components/Toast';
import i18n from '../i18n';

const mockState: { role: string; pendingTotal: number; pendingFail: boolean; pendingCalls: number } = {
  role: 'PL', pendingTotal: 0, pendingFail: false, pendingCalls: 0,
};
// 렌더마다 새 객체를 주면 HomePage 의 [currentUser] effect 가 끝없이 다시 돈다 — 역할별로 같은 객체를 돌려준다.
const mockUsers: Record<string, { currentUser: Record<string, string> }> = {};

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => {
    mockUsers[mockState.role] = mockUsers[mockState.role] ?? {
      currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: mockState.role },
    };
    return mockUsers[mockState.role];
  },
}));

// 홈의 무거운 하위 컴포넌트는 이 테스트와 무관하므로 대체한다(tiptap ESM 등).
jest.mock('../components/RichTextEditor', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('../components/AnnualDesignRuleChart', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('../components/GuideTourModal', () => ({ __esModule: true, default: () => null }));

jest.mock('../api/client', () => ({
  documentsAPI: { list: () => Promise.resolve({ data: [] }), get: () => Promise.resolve({ data: null }) },
  noticesAPI: { list: () => Promise.resolve({ data: [] }) },
  layerSdExceptionsAPI: {
    list: () => Promise.resolve([]),
    create: () => Promise.resolve({}),
    delete: () => Promise.resolve(),
    pendingCount: () => {
      mockState.pendingCalls += 1;
      return mockState.pendingFail
        ? Promise.reject(new Error('fail'))
        : Promise.resolve({ J: mockState.pendingTotal, O: 0, total: mockState.pendingTotal });
    },
  },
}));

const renderHome = async () => {
  const view = render(
    <MemoryRouter>
      <ToastProvider>
        <HomePage />
      </ToastProvider>
    </MemoryRouter>
  );
  await act(async () => { await Promise.resolve(); });
  return view;
};

beforeAll(async () => { await i18n.changeLanguage('ko'); });
beforeEach(() => {
  mockState.pendingTotal = 0;
  mockState.pendingFail = false;
  mockState.pendingCalls = 0;
});

describe('홈 SD-Layer 예외 버튼', () => {
  it.each(['PL', 'PL_GL', 'TE_R', 'TE_J', 'TE_O', 'TE_P', 'MASTER', 'NONE'])('%s → 버튼이 보이고 모달에 신청 입력 표가 있다', async (role) => {
    mockState.role = role;
    await renderHome();
    fireEvent.click(screen.getByTestId('sd-exc-open-btn'));
    expect(await screen.findByTestId('sd-exc-tab-J')).toBeDefined();
    expect(screen.getByTestId('sd-exc-tab-O')).toBeDefined();
    expect(screen.getByTestId('sd-exc-add-btn')).toBeDefined();
  });

  it('합의 대기 건수가 있으면 버튼에 (N) 을 붙인다', async () => {
    mockState.role = 'PL';
    mockState.pendingTotal = 2;
    await renderHome();
    expect(screen.getByTestId('sd-exc-open-btn').textContent).toBe('🧩 SD-Layer 예외 (2)');
  });

  it('합의 대기 건수가 0 이거나 불러오지 못하면 숫자 없이 보인다', async () => {
    mockState.role = 'PL';
    await renderHome();
    expect(screen.getByTestId('sd-exc-open-btn').textContent).toBe('🧩 SD-Layer 예외');
  });

  it('건수를 불러오지 못해도 버튼은 숫자 없이 보인다', async () => {
    mockState.role = 'PL';
    mockState.pendingFail = true;
    await renderHome();
    expect(screen.getByTestId('sd-exc-open-btn').textContent).toBe('🧩 SD-Layer 예외');
  });

  it('모달을 닫으면 건수를 다시 불러온다', async () => {
    mockState.role = 'TE_J';
    mockState.pendingTotal = 2;
    await renderHome();
    const callsBefore = mockState.pendingCalls;
    fireEvent.click(screen.getByTestId('sd-exc-open-btn'));
    await screen.findByTestId('sd-exc-modal');
    mockState.pendingTotal = 1;
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await act(async () => { await Promise.resolve(); });
    expect(mockState.pendingCalls).toBe(callsBefore + 1);
    expect(screen.getByTestId('sd-exc-open-btn').textContent).toBe('🧩 SD-Layer 예외 (1)');
  });

  it('버튼은 의뢰서 작성·결재 현황·가이드 버튼 줄의 아랫줄에 따로 있다', async () => {
    mockState.role = 'PL';
    await renderHome();
    const sdRow = screen.getByTestId('sd-exc-open-btn').parentElement as HTMLElement;
    const mainRow = screen.getByText(/의뢰서 작성하기/).closest('.hero-actions') as HTMLElement;
    expect(sdRow).not.toBe(mainRow);
    expect(mainRow.nextElementSibling).toBe(sdRow);
  });
});
