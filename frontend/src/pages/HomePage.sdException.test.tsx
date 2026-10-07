/**
 * 홈 화면 SD-Layer 예외 관리 버튼 — 관리 권한 역할(J: TE_J·TE_P·MASTER, O: TE_O·TE_P·MASTER)에게만 보이고,
 * 모달은 그 역할이 관리할 수 있는 표(J/O)만 탭으로 보여준다.
 *
 * ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 → 평범한 함수 + mockState.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';
import { ToastProvider } from '../components/Toast';
import i18n from '../i18n';

const mockState: { role: string } = { role: 'PL' };
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
  layerSdExceptionsAPI: { list: () => Promise.resolve([]), create: () => Promise.resolve({}), delete: () => Promise.resolve() },
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

describe('홈 SD-Layer 예외 관리 버튼', () => {
  it.each([['TE_J', 'J'], ['TE_O', 'O']])('%s → 버튼이 보이고 모달은 %s 표만(탭 없음)', async (role, table) => {
    mockState.role = role;
    await renderHome();
    fireEvent.click(screen.getByTestId('sd-exc-open-btn'));
    expect(await screen.findByText(`${table}-layer 예외 추가`)).toBeDefined();
    expect(screen.queryByTestId('sd-exc-tab-J')).toBeNull();
  });

  it.each(['TE_P', 'MASTER'])('%s → 버튼이 보이고 모달에 J/O 탭이 둘 다 있다', async (role) => {
    mockState.role = role;
    await renderHome();
    fireEvent.click(screen.getByTestId('sd-exc-open-btn'));
    expect(await screen.findByTestId('sd-exc-tab-J')).toBeDefined();
    expect(screen.getByTestId('sd-exc-tab-O')).toBeDefined();
  });

  it.each(['PL', 'TE_R', 'NONE'])('%s → 버튼이 보이지 않는다', async (role) => {
    mockState.role = role;
    await renderHome();
    expect(screen.queryByTestId('sd-exc-open-btn')).toBeNull();
  });
});
