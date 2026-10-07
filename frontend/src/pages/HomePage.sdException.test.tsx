/**
 * 홈 화면 SD-Layer 예외 관리 버튼 — 관리 권한 역할(J: TE_J·TE_P·MASTER, O: TE_O·TE_P·MASTER)에게만 보이고,
 * 모달은 J/O 두 탭을 늘 보여주되 관리 권한이 없는 탭은 조회만 된다.
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
  it.each([['TE_J', 'J', 'O'], ['TE_O', 'O', 'J']])('%s → 버튼이 보이고 %s 탭은 관리, %s 탭은 조회 전용', async (role, own, other) => {
    mockState.role = role;
    await renderHome();
    fireEvent.click(screen.getByTestId('sd-exc-open-btn'));
    expect(await screen.findByText(`${own}-layer 예외 추가`)).toBeDefined();
    fireEvent.click(screen.getByTestId(`sd-exc-tab-${other}`));
    expect(screen.getByTestId('sd-exc-readonly-hint')).toBeDefined();
    expect(screen.queryByTestId('sd-exc-add-btn')).toBeNull();
  });

  it.each(['TE_P', 'MASTER'])('%s → 버튼이 보이고 모달에 J/O 탭이 둘 다 있다', async (role) => {
    mockState.role = role;
    await renderHome();
    fireEvent.click(screen.getByTestId('sd-exc-open-btn'));
    expect(await screen.findByTestId('sd-exc-tab-J')).toBeDefined();
    expect(screen.getByTestId('sd-exc-tab-O')).toBeDefined();
    fireEvent.click(screen.getByTestId('sd-exc-tab-O'));
    expect(screen.getByText('O-layer 예외 추가')).toBeDefined();
    expect(screen.queryByTestId('sd-exc-readonly-hint')).toBeNull();
  });

  it('버튼은 의뢰서 작성·결재 현황·가이드 버튼 줄의 아랫줄에 따로 있다', async () => {
    mockState.role = 'TE_P';
    await renderHome();
    const sdRow = screen.getByTestId('sd-exc-open-btn').parentElement as HTMLElement;
    const mainRow = screen.getByText(/의뢰서 작성하기/).closest('.hero-actions') as HTMLElement;
    expect(sdRow).not.toBe(mainRow);
    expect(mainRow.nextElementSibling).toBe(sdRow);
  });

  it.each(['PL', 'TE_R', 'NONE'])('%s → 버튼이 보이지 않는다', async (role) => {
    mockState.role = role;
    await renderHome();
    expect(screen.queryByTestId('sd-exc-open-btn')).toBeNull();
  });
});
