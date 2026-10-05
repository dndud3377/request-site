/**
 * 결재 경로 변경 모달 — 합의 완료자 잠금, 변경된 항목만 전송, 검증 실패 표시.
 *
 * ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 →
 * jest.mock 은 평범한 함수 + mockState 로 쓴다(requesterResubmitHistory.test.tsx 와 같은 방식).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RouteChangeModal from './RouteChangeModal';
import { ApprovalStepFrontend, RequestDocument } from '../types';
import i18n from '../i18n';

const mockState: {
  captured: { docId: number; payload: unknown } | null;
  error: string;
} = { captured: null, error: '' };

jest.mock('../api/client', () => ({
  documentsAPI: {
    changeRoute: (docId: number, payload: unknown) => {
      mockState.captured = { docId, payload };
      return mockState.error ? Promise.reject(new Error(mockState.error)) : Promise.resolve({ data: { message: 'ok' } });
    },
  },
  usersAPI: {
    list: () => Promise.resolve({
      data: [
        { id: 1, loginid: 'plc', name: '최제품', deptname: '개발', role: 'PL', mail: 'plc@c.com' },
        { id: 2, loginid: 'pld', name: '정제품', deptname: '영업', role: 'PL', mail: 'pld@c.com' },
      ],
    }),
  },
}));

const step = (id: number, agent: ApprovalStepFrontend['agent'], loginid: string, name: string, action: ApprovalStepFrontend['action']): ApprovalStepFrontend => ({
  id, agent, action, acted_at: null, assignee_loginid: loginid, assignee_name: name, round: 1,
});

const makeDoc = (steps: ApprovalStepFrontend[], detail: Record<string, unknown> = {}): RequestDocument => ({
  id: 7, title: '샘플', requester_name: '요청자', requester_email: 'r@c.com', requester_department: 'd',
  product_name: 'P', reference_materials: '', status: 'under_review', production_date: null,
  created_at: '', updated_at: '', submitted_at: '',
  approval_steps: steps,
  additional_notes: JSON.stringify({ detail: { request_purpose: '', ...detail }, jayerRows: [] }),
  post_approver_fixed_loginid: 'fixed',
  post_approver_fixed_name: '홍RFG',
  is_overseas: false,
} as unknown as RequestDocument);

beforeAll(async () => { await i18n.changeLanguage('ko'); });

beforeEach(() => {
  mockState.captured = null;
  mockState.error = '';
});

const renderModal = (doc: RequestDocument, onChanged: () => void = () => {}) =>
  render(<RouteChangeModal isOpen onClose={() => {}} doc={doc} onChanged={onChanged} />);

test('합의를 마친 PL 은 잠금 칩이라 제거 버튼이 없고, 대기 중인 PL 만 제거 버튼이 있다', async () => {
  renderModal(makeDoc([step(1, 'PL', 'pla', '김제품', 'approved'), step(2, 'PL', 'plb', '이제품', 'pending')]));
  await waitFor(() => expect(screen.getAllByPlaceholderText(/검색해서 추가/).length).toBeGreaterThan(0));
  expect(screen.getByText(/김제품/).textContent).toContain('🔒');
  // 제거 버튼은 대기 중인 이제품 1개뿐이다(PL 섹션). 통보처·합의자·후결자는 비어 있다.
  expect(screen.getAllByRole('button', { name: '제거' })).toHaveLength(1);
});

test('변경한 항목만 전송하고, 합의 완료자는 최종 목록에 그대로 포함한다', async () => {
  const onChanged = jest.fn();
  renderModal(makeDoc([step(1, 'PL', 'pla', '김제품', 'approved'), step(2, 'PL', 'plb', '이제품', 'pending')]), onChanged);
  await waitFor(() => expect((screen.getAllByPlaceholderText(/검색해서 추가/)[0] as HTMLInputElement).disabled).toBe(false));

  fireEvent.click(screen.getByRole('button', { name: '제거' }));
  const plInput = screen.getAllByPlaceholderText(/검색해서 추가/)[0];
  fireEvent.focus(plInput);
  fireEvent.mouseDown(await screen.findByText('최제품'));
  fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));

  await waitFor(() => expect(mockState.captured).not.toBeNull());
  expect(mockState.captured).toEqual({ docId: 7, payload: { designated_pl_loginids: ['pla', 'plc'] } });
});

test('검토자(PL)를 전부 비우면 저장할 수 없고 안내가 나온다', async () => {
  renderModal(makeDoc([step(2, 'PL', 'plb', '이제품', 'pending')]));
  await waitFor(() => expect((screen.getAllByPlaceholderText(/검색해서 추가/)[0] as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '제거' }));
  expect(screen.getByText('검토자(PL)는 최소 1명을 유지해야 합니다.')).toBeTruthy();
  expect((screen.getByRole('button', { name: '변경 저장' }) as HTMLButtonElement).disabled).toBe(true);
});

test('PL 검토 단계가 끝났으면 PL·합의자는 잠기고 통보처만 바꿀 수 있다', async () => {
  renderModal(makeDoc([step(1, 'PL', 'pla', '김제품', 'approved'), step(3, 'R', 'r1', 'R담당', 'pending')]));
  expect(screen.getAllByText('PL 검토 단계가 끝나 변경할 수 없습니다.')).toHaveLength(2);
  // PL·합의자 입력창은 없고(잠금) 후결자·통보처 입력창만 남는다 — 마지막이 통보처.
  await waitFor(() => expect(screen.getAllByPlaceholderText(/검색해서 추가/)).toHaveLength(2));
  await waitFor(() => expect((screen.getAllByPlaceholderText(/검색해서 추가/)[1] as HTMLInputElement).disabled).toBe(false));
  fireEvent.focus(screen.getAllByPlaceholderText(/검색해서 추가/)[1]);
  fireEvent.mouseDown(await screen.findByText('정제품'));
  fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  expect(mockState.captured).toEqual({ docId: 7, payload: { notifiers: [{ loginid: 'pld', name: '정제품' }] } });
});

test('MAP 삭제 문서에는 후결자 항목이 없다', async () => {
  renderModal(makeDoc([step(2, 'PL', 'plb', '이제품', 'pending')], { request_purpose: 'MAP 삭제' }));
  await waitFor(() => expect(screen.getAllByPlaceholderText(/검색해서 추가/).length).toBeGreaterThan(0));
  expect(screen.queryByText('추가 후결자')).toBeNull();
});

test('서버가 거부하면 사유를 보여주고 모달 갱신(onChanged)은 호출하지 않는다', async () => {
  mockState.error = '이미 합의를 마친 검토자(PL)은(는) 제외할 수 없습니다: 김제품';
  const onChanged = jest.fn();
  renderModal(makeDoc([step(2, 'PL', 'plb', '이제품', 'pending')]), onChanged);
  await waitFor(() => expect((screen.getAllByPlaceholderText(/검색해서 추가/)[0] as HTMLInputElement).disabled).toBe(false));
  const plInput = screen.getAllByPlaceholderText(/검색해서 추가/)[0];
  fireEvent.focus(plInput);
  fireEvent.mouseDown(await screen.findByText('최제품'));
  fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
  expect((await screen.findByRole('alert')).textContent).toContain('이미 합의를 마친');
  expect(onChanged).not.toHaveBeenCalled();
});

test('상세(additional_notes)가 없는 목록 항목이면 통보처를 잠가 기존 값을 덮어쓰지 않는다', async () => {
  const doc = makeDoc([step(2, 'PL', 'plb', '이제품', 'pending')]);
  delete (doc as { additional_notes?: string }).additional_notes;
  renderModal(doc);
  await waitFor(() => expect(screen.getAllByText('의뢰서 상세 정보를 불러오지 못해 변경할 수 없습니다. 상세를 다시 열어 주세요.').length).toBeGreaterThan(0));
  // 잠긴 항목(통보처·예정 후결자)에는 입력창이 없고, PL·합의자 입력창만 남는다.
  await waitFor(() => expect(screen.getAllByPlaceholderText(/검색해서 추가/)).toHaveLength(2));
});

const saDoc = (requires: boolean): RequestDocument => ({
  ...makeDoc([step(1, 'PL', 'pla', '김제품', 'pending'), step(2, 'SA', 'plb', '이제품', 'pending')]),
  requires_sales_agreer: requires,
});

test('합의자가 필수인 문서에서 합의자를 모두 빼면 사유 입력이 필요하고, 입력하면 함께 전송한다', async () => {
  renderModal(saDoc(true));
  await waitFor(() => expect((screen.getAllByPlaceholderText(/검색해서 추가/)[0] as HTMLInputElement).disabled).toBe(false));
  expect(screen.queryByPlaceholderText('합의자를 지정하지 않는 사유')).toBeNull();

  fireEvent.click(screen.getAllByRole('button', { name: '제거' })[1]);
  const reason = screen.getByPlaceholderText('합의자를 지정하지 않는 사유');
  expect(screen.getByText('지정하지 않는 사유를 입력해주세요.')).toBeTruthy();
  expect((screen.getByRole('button', { name: '변경 저장' }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(reason, { target: { value: ' 영업 협의 완료 ' } });
  expect((screen.getByRole('button', { name: '변경 저장' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  expect(mockState.captured).toEqual({
    docId: 7, payload: { sales_agreer_loginids: [], sales_agreer_none_reason: '영업 협의 완료' },
  });
});

test('합의자가 필수가 아닌 문서는 합의자를 모두 빼도 사유 입력 없이 저장된다', async () => {
  renderModal(saDoc(false));
  await waitFor(() => expect((screen.getAllByPlaceholderText(/검색해서 추가/)[0] as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(screen.getAllByRole('button', { name: '제거' })[1]);
  expect(screen.queryByPlaceholderText('합의자를 지정하지 않는 사유')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  expect(mockState.captured).toEqual({ docId: 7, payload: { sales_agreer_loginids: [] } });
});

test('합의자가 필수인 문서라도 합의자가 남아 있으면 사유를 묻지 않는다', async () => {
  renderModal(saDoc(true));
  await waitFor(() => expect((screen.getAllByPlaceholderText(/검색해서 추가/)[0] as HTMLInputElement).disabled).toBe(false));
  fireEvent.focus(screen.getAllByPlaceholderText(/검색해서 추가/)[1]);
  fireEvent.mouseDown(await screen.findByText('최제품'));
  expect(screen.queryByPlaceholderText('합의자를 지정하지 않는 사유')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  expect(mockState.captured).toEqual({ docId: 7, payload: { sales_agreer_loginids: ['plb', 'plc'] } });
});
