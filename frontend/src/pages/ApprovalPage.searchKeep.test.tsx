/**
 * claude 수정 (2026-11-27): 결재 현황 — 상세 모달 안 동작(검토중 등) 뒤 목록 재조회가 검색어를 유지하는지.
 *
 * 예전에는 refreshAndSelect 가 documentsAPI.list({}) 로 검색어 없이 다시 받아, 검색창에 'AAA' 가 그대로인데
 * 목록은 전체가 보였다. 지금은 현재 검색어로 다시 받고, 더 최신 요청이 나간 뒤 도착한 응답은 버린다.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ApprovalPage from './ApprovalPage';
import i18n from '../i18n';
import { documentsAPI } from '../api/client';
import { RequestDocument, ApprovalStepFrontend } from '../types';

// documentsAPI 외 나머지 API(사용자·그룹·필터 세트 등)는 모두 빈 목록으로 응답한다.
// API 마다 배열을 바로 주는 것(filterPresetsAPI 등)과 { data } 로 주는 것(usersAPI 등)이 섞여 있어,
// 빈 배열에 data 도 붙여 두 모양 모두로 읽히게 한다.
// CRA 의 resetMocks 가 테스트마다 jest.fn 구현을 지우므로 여기는 일반 함수로 둔다.
jest.mock('../api/client', () => {
  const emptyResponse = () => Promise.resolve(Object.assign([], { data: [] }));
  const genericApi = new Proxy({}, { get: () => emptyResponse });
  const docsApi = { list: jest.fn(), get: jest.fn(), claimStep: jest.fn() };
  return new Proxy({}, {
    get: (_target, name) => {
      if (name === '__esModule') return true;
      if (name === 'documentsAPI') return docsApi;
      return genericApi;
    },
  });
});

// currentUser 는 렌더마다 같은 객체여야 한다 — 새 객체면 applyClientFilter·fetchDocs 가 매번 바뀌어 목록 조회가 끝없이 반복된다.
jest.mock('../contexts/AuthContext', () => {
  const auth = {
    currentUser: { id: 1, username: 'tej@company.com', name: '제이', role: 'TE_J', department: 'J팀', email: 'tej@company.com' },
  };
  return { useAuth: () => auth };
});

jest.mock('../components/Toast', () => ({ useToast: () => jest.fn() }));

const mockedDocs = documentsAPI as unknown as {
  list: jest.Mock;
  get: jest.Mock;
  claimStep: jest.Mock;
};

const SEARCH_WORD = 'AAA';
const AAA_COMBO = 'AAA-PROC';
const BBB_COMBO = 'BBB-PROC';

const jStep: ApprovalStepFrontend = { id: 11, agent: 'J', action: 'pending', acted_at: null, round: 1 };

const makeDoc = (id: number, combo: string): RequestDocument => ({
  id,
  title: `${combo}-title`,
  requester_name: '이의뢰',
  requester_email: 'req@company.com',
  requester_department: 'dept',
  product_name: combo,
  reference_materials: '',
  additional_notes: JSON.stringify({ detail: { request_purpose: '신규', process_selection: combo } }),
  status: 'under_review',
  production_date: null,
  created_at: '2026-11-27T00:00:00Z',
  updated_at: '2026-11-27T00:00:00Z',
  submitted_at: '2026-11-27T00:00:00Z',
  approval_steps: [jStep],
});

const docAAA = makeDoc(1, AAA_COMBO);
const docBBB = makeDoc(2, BBB_COMBO);

/** 서버 검색 흉내 — search 가 있으면 제목에 포함된 문서만, 없으면 전체. */
const serverList = (params?: Record<string, string>) => {
  const all = [docAAA, docBBB];
  const q = params?.search;
  return Promise.resolve({ data: q ? all.filter((d) => d.title.includes(q)) : all });
};

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

const renderPage = () => render(
  <MemoryRouter initialEntries={['/approval']}>
    <ApprovalPage />
  </MemoryRouter>,
);

/** 검색어 'AAA' 를 넣고 AAA 문서 상세 모달을 연다. */
const searchAndOpenAAA = async () => {
  renderPage();
  await screen.findByText(BBB_COMBO);
  fireEvent.change(screen.getByPlaceholderText(i18n.t('approval.search_placeholder')), { target: { value: SEARCH_WORD } });
  const aaaLink = await screen.findByRole('button', { name: AAA_COMBO });
  expect(screen.queryByText(BBB_COMBO)).toBeNull();
  fireEvent.click(aaaLink);
  return screen.findByRole('button', { name: i18n.t('approval.claim') });
};

beforeEach(() => {
  mockedDocs.list.mockReset().mockImplementation(serverList);
  mockedDocs.get.mockReset().mockImplementation((id: number) => Promise.resolve({ data: id === 1 ? docAAA : docBBB }));
  mockedDocs.claimStep.mockReset().mockResolvedValue({ data: {} });
});

describe('결재 현황 — 모달 안 동작 뒤에도 검색 결과 유지', () => {
  it('검토중을 누른 뒤 목록을 현재 검색어로 다시 받고, 검색 결과만 보인다', async () => {
    const claimBtn = await searchAndOpenAAA();
    const callsBefore = mockedDocs.list.mock.calls.length;

    fireEvent.click(claimBtn);
    await waitFor(() => expect(mockedDocs.claimStep).toHaveBeenCalledWith(1, 'J'));
    await waitFor(() => expect(mockedDocs.list.mock.calls.length).toBeGreaterThan(callsBefore));

    const refreshParams = mockedDocs.list.mock.calls[mockedDocs.list.mock.calls.length - 1][0];
    expect(refreshParams).toEqual({ search: SEARCH_WORD });
    await waitFor(() => expect(mockedDocs.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(BBB_COMBO)).toBeNull();
  });

  it('검토중 처리 API 가 도는 사이 검색어가 바뀌면 재조회는 바뀐 검색어로 받는다', async () => {
    const claimBtn = await searchAndOpenAAA();
    const slowClaim = deferred<{ data: object }>();
    mockedDocs.claimStep.mockImplementationOnce(() => slowClaim.promise);

    fireEvent.click(claimBtn);
    await waitFor(() => expect(mockedDocs.claimStep).toHaveBeenCalled());
    // 처리 중에 검색어를 지운다 → 전체 목록이 보인다.
    fireEvent.change(screen.getByPlaceholderText(i18n.t('approval.search_placeholder')), { target: { value: '' } });
    await screen.findByText(BBB_COMBO);
    const callsBefore = mockedDocs.list.mock.calls.length;

    // 처리가 끝난 뒤 재조회는 누른 시점의 'AAA' 가 아니라 지금 검색어(없음)로 받아야 한다.
    await act(async () => { slowClaim.resolve({ data: {} }); });
    await waitFor(() => expect(mockedDocs.list.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(mockedDocs.list.mock.calls[mockedDocs.list.mock.calls.length - 1][0]).toEqual({});
    await waitFor(() => expect(mockedDocs.get).toHaveBeenCalledTimes(2));
    expect(screen.getByText(BBB_COMBO)).toBeTruthy();
  });

  it('재조회 응답이 도착하기 전에 검색어가 바뀌면 늦게 온 재조회 응답은 버린다', async () => {
    const claimBtn = await searchAndOpenAAA();
    const slowRefresh = deferred<{ data: RequestDocument[] }>();
    const callsBefore = mockedDocs.list.mock.calls.length;
    mockedDocs.list.mockImplementationOnce(() => slowRefresh.promise);

    fireEvent.click(claimBtn);
    // 재조회(느린 응답) 요청이 실제로 나갈 때까지 기다린다.
    await waitFor(() => expect(mockedDocs.list.mock.calls.length).toBe(callsBefore + 1));
    expect(mockedDocs.list.mock.calls[callsBefore][0]).toEqual({ search: SEARCH_WORD });
    // 재조회가 아직 오지 않은 사이 검색어를 지운다 → 전체 목록 요청(fetchDocs)이 더 최신이 된다.
    fireEvent.change(screen.getByPlaceholderText(i18n.t('approval.search_placeholder')), { target: { value: '' } });
    await screen.findByText(BBB_COMBO);

    // 이전 검색어('AAA') 기준의 재조회 응답이 늦게 도착해도 전체 목록을 덮지 않아야 한다.
    await act(async () => { slowRefresh.resolve({ data: [docAAA] }); });
    expect(screen.getByText(BBB_COMBO)).toBeTruthy();
  });

  it('진행 중이던 목록 조회 응답이 재조회 때문에 버려져도 로딩 표시가 남지 않는다', async () => {
    const claimBtn = await searchAndOpenAAA();
    const slowSearch = deferred<{ data: RequestDocument[] }>();
    mockedDocs.list.mockImplementationOnce(() => slowSearch.promise);

    // 검색어를 'AA' 로 바꿔 느린 목록 조회(fetchDocs)를 걸어 둔 채 검토중을 누른다.
    fireEvent.change(screen.getByPlaceholderText(i18n.t('approval.search_placeholder')), { target: { value: 'AA' } });
    await screen.findByText(i18n.t('common.loading'));
    fireEvent.click(claimBtn);
    await waitFor(() => expect(mockedDocs.get).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(screen.queryByText(i18n.t('common.loading'))).toBeNull());
    await act(async () => { slowSearch.resolve({ data: [docAAA, docBBB] }); });
    expect(screen.queryByText(i18n.t('common.loading'))).toBeNull();
    expect(screen.queryByText(BBB_COMBO)).toBeNull();
  });
});
