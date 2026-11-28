/**
 * claude 수정 (2026-11-28): 홈 '나의 의뢰 현황' — 제품 담당자가 홈에서 바로 수정·재상신/수정 후 재상신/수정 후 재개.
 *
 * 예전에는 홈 표·상세 모달이 읽기 전용이라 결재현황까지 가야 수정·재상신할 수 있었다.
 * 지금은 결재현황과 같은 조건(can_edit·withdraw_request·status / can_requester_resubmit / can_resume)으로
 * 표 행과 상세 모달에 버튼이 뜨고, 누르면 /request 편집 화면으로 editDocId 를 들고 이동한다.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import HomePage, { getHomeEditActions } from './HomePage';
import i18n from '../i18n';
import { documentsAPI } from '../api/client';
import { RequestDocument } from '../types';

// documentsAPI 외 나머지 API(공지·통계 등)는 모두 빈 목록으로 응답한다(ApprovalPage.searchKeep.test.tsx 와 같은 방식).
jest.mock('../api/client', () => {
  const emptyResponse = () => Promise.resolve(Object.assign([], { data: [] }));
  const genericApi = new Proxy({}, { get: () => emptyResponse });
  const docsApi = { list: jest.fn(), get: jest.fn() };
  return new Proxy({}, {
    get: (_target, name) => {
      if (name === '__esModule') return true;
      if (name === 'documentsAPI') return docsApi;
      return genericApi;
    },
  });
});

// currentUser 는 렌더마다 같은 객체여야 한다 — 새 객체면 목록 로드 effect 가 반복된다.
jest.mock('../contexts/AuthContext', () => {
  const auth = {
    currentUser: { id: 1, username: 'pl@company.com', name: '피엘', role: 'PL', department: 'PL팀', email: 'pl@company.com' },
  };
  return { useAuth: () => auth };
});

// 연간 차트는 이 테스트와 무관하다.
jest.mock('../components/AnnualDesignRuleChart', () => () => null);

const mockedDocs = documentsAPI as unknown as { list: jest.Mock; get: jest.Mock };

const makeDoc = (id: number, combo: string, patch: Partial<RequestDocument>): RequestDocument => ({
  id,
  title: `${combo}-title`,
  requester_name: '피엘',
  requester_loginid: 'pl@company.com',
  requester_email: 'pl@company.com',
  requester_department: 'PL팀',
  product_name: combo,
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { request_purpose: '신규', process_selection: combo } }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-11-27T00:00:00Z',
  updated_at: '2026-11-27T00:00:00Z',
  submitted_at: `2026-11-27T00:00:0${id}Z`,
  approval_steps: [],
  ...patch,
});

const rejectedDoc = makeDoc(1, 'REJ-PROC', { status: 'rejected', can_edit: true });
const rejectedWithdrawDoc = makeDoc(2, 'WDR-PROC', {
  status: 'rejected',
  can_edit: true,
  withdraw_request: { id: 9 } as RequestDocument['withdraw_request'],
});
const plStageDoc = makeDoc(3, 'PLS-PROC', { status: 'under_review', can_edit: true, can_requester_resubmit: true });
const pausedDoc = makeDoc(4, 'PAU-PROC', { status: 'pause', can_edit: true, can_resume: true });
const otherDoc = makeDoc(5, 'OTH-PROC', { status: 'under_review', can_edit: false });

/** /request 로 이동했을 때 넘어온 editDocId 를 보여주는 자리 */
function RequestProbe(): React.ReactElement {
  const location = useLocation();
  const state = location.state as { editDocId?: number } | null;
  return <div data-testid="request-probe">{String(state?.editDocId)}</div>;
}

const renderHome = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/request" element={<RequestProbe />} />
    </Routes>
  </MemoryRouter>,
);

/** 제품 칸 버튼(조합법 텍스트)이 있는 표 행 */
const rowOf = (combo: string): HTMLElement => {
  const row = screen.getByText(combo).closest('tr');
  if (!row) throw new Error(`row not found: ${combo}`);
  return row;
};

describe('getHomeEditActions — 결재현황과 같은 노출 조건', () => {
  test('반려 + can_edit → 수정·재상신', () => {
    expect(getHomeEditActions(rejectedDoc)).toEqual(['edit_resubmit']);
  });
  test('철회 요청 확인 대기 중이면 수정·재상신 숨김', () => {
    expect(getHomeEditActions(rejectedWithdrawDoc)).toEqual([]);
  });
  test('PL 검토 단계 작성자 재상신 가능 → 수정 후 재상신(진행 중이라 수정·재상신은 없음)', () => {
    expect(getHomeEditActions(plStageDoc)).toEqual(['requester_resubmit']);
  });
  test('중단 문서 재개 가능 → 수정 후 재개', () => {
    expect(getHomeEditActions(pausedDoc)).toEqual(['resume']);
  });
  test('권한 없는 진행 중 문서 → 버튼 없음', () => {
    expect(getHomeEditActions(otherDoc)).toEqual([]);
  });
});

describe('HomePage 나의 의뢰 현황 — 수정 계열 버튼', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  beforeEach(() => {
    mockedDocs.list.mockImplementation(() => Promise.resolve({
      data: [rejectedDoc, rejectedWithdrawDoc, plStageDoc, pausedDoc, otherDoc],
    }));
    mockedDocs.get.mockImplementation((id: number) => Promise.resolve({
      data: [rejectedDoc, rejectedWithdrawDoc, plStageDoc, pausedDoc, otherDoc].find((d) => d.id === id),
    }));
  });

  test('표 행마다 조건에 맞는 버튼만 보인다', async () => {
    renderHome();
    await screen.findByText('REJ-PROC');

    expect(within(rowOf('REJ-PROC')).getByRole('button', { name: i18n.t('approval.edit_resubmit') })).toBeTruthy();
    expect(within(rowOf('PLS-PROC')).getByRole('button', { name: i18n.t('approval.requester_resubmit') })).toBeTruthy();
    expect(within(rowOf('PAU-PROC')).getByRole('button', { name: i18n.t('approval.resume') })).toBeTruthy();
    // 철회 요청 중인 반려 문서는 제품 칸 버튼 외에 버튼이 없다
    expect(within(rowOf('WDR-PROC')).getAllByRole('button')).toHaveLength(1);
    // 결재현황에 없던 [수정·재상신] 이 진행 중 문서에 잘못 뜨지 않는다
    expect(within(rowOf('PLS-PROC')).queryByRole('button', { name: i18n.t('approval.edit_resubmit') })).toBeNull();
  });

  test('표 행 [수정·재상신] → /request 로 editDocId 를 들고 이동', async () => {
    renderHome();
    await screen.findByText('REJ-PROC');
    fireEvent.click(within(rowOf('REJ-PROC')).getByRole('button', { name: i18n.t('approval.edit_resubmit') }));
    expect((await screen.findByTestId('request-probe')).textContent).toBe(String(rejectedDoc.id));
  });

  test('상세 모달 footer [수정 후 재개] → 모달 닫고 /request 로 이동', async () => {
    renderHome();
    fireEvent.click(await screen.findByText('PAU-PROC'));
    const modalTitle = await screen.findByText(pausedDoc.title);
    const modal = modalTitle.closest('.modal');
    if (!(modal instanceof HTMLElement)) throw new Error('modal not found');
    fireEvent.click(within(modal).getByRole('button', { name: i18n.t('approval.resume') }));
    await waitFor(() => expect(screen.getByTestId('request-probe').textContent).toBe(String(pausedDoc.id)));
  });

  test('상세 모달 — 권한 없는 문서는 닫기 버튼만', async () => {
    renderHome();
    fireEvent.click(await screen.findByText('OTH-PROC'));
    const modalTitle = await screen.findByText(otherDoc.title);
    const modal = modalTitle.closest('.modal');
    if (!(modal instanceof HTMLElement)) throw new Error('modal not found');
    expect(within(modal).queryByRole('button', { name: i18n.t('approval.edit_resubmit') })).toBeNull();
    expect(within(modal).queryByRole('button', { name: i18n.t('approval.requester_resubmit') })).toBeNull();
    expect(within(modal).queryByRole('button', { name: i18n.t('approval.resume') })).toBeNull();
  });
});
