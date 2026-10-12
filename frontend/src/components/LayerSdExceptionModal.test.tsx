/**
 * 홈 화면 SD-Layer 예외 신청·합의 모달 — 누구나 사유를 적어 신청(엑셀 붙여넣기·일괄 신청),
 * 합의 칸(J 탭: TE_J 팀 칸 + TE_P P 칸, O 탭: TE_O + TE_P, MASTER 는 두 칸)별 합의, 사유 반려,
 * 합의자 삭제·신청자 본인 신청 취소, 상태 필터.
 *
 * ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 →
 * jest.mock 은 평범한 함수 + mockState 로 쓴다(RouteChangeModal.test.tsx 와 같은 방식).
 */
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import LayerSdExceptionModal from './LayerSdExceptionModal';
import { ToastProvider } from './Toast';
import i18n from '../i18n';
import { LayerSdException } from '../types';

const mockState: {
  exceptions: { J: LayerSdException[]; O: LayerSdException[] };
  created: unknown[];
  agreed: unknown[];
  rejected: unknown[];
  failSd: string;
} = { exceptions: { J: [], O: [] }, created: [], agreed: [], rejected: [], failSd: '' };

const mockFind = (id: number): LayerSdException =>
  [...mockState.exceptions.J, ...mockState.exceptions.O].find((e) => e.id === id)!;
// 서버처럼 처리 결과를 저장해 다음 호출이 바뀐 값을 보게 한다.
const mockSave = (updated: LayerSdException): Promise<LayerSdException> => {
  mockState.exceptions[updated.table] = mockState.exceptions[updated.table].map((e) => (e.id === updated.id ? updated : e));
  return Promise.resolve(updated);
};

jest.mock('../api/client', () => ({
  layerSdExceptionsAPI: {
    list: (table: 'J' | 'O') => Promise.resolve(mockState.exceptions[table]),
    create: (input: { table: 'J' | 'O'; sd: string }) => {
      if (mockState.failSd && input.sd === mockState.failSd) return Promise.reject(new Error('dup'));
      mockState.created.push(input);
      return Promise.resolve({
        id: 900 + mockState.created.length, sd_number: input.sd.split(' ')[0], status: 'PENDING',
        created_by: 'me', created_by_name: '신청자본인', created_at: '',
        team_agreed_by: '', team_agreed_by_name: '', team_agreed_at: null,
        p_agreed_by: '', p_agreed_by_name: '', p_agreed_at: null,
        rejected_by: '', rejected_by_name: '', rejected_at: null, reject_reason: '', ...input,
      });
    },
    agree: (id: number, slot: 'team' | 'p') => {
      mockState.agreed.push({ id, slot });
      const exc = mockFind(id);
      const updated = slot === 'team'
        ? { ...exc, team_agreed_by: 'agreer', team_agreed_by_name: '팀합의자' }
        : { ...exc, p_agreed_by: 'agreer', p_agreed_by_name: 'P합의자' };
      return mockSave(updated.team_agreed_by && updated.p_agreed_by ? { ...updated, status: 'APPROVED' } : updated);
    },
    reject: (id: number, reason: string) => {
      mockState.rejected.push({ id, reason });
      return mockSave({ ...mockFind(id), status: 'REJECTED', rejected_by: 'rj', rejected_by_name: '반려자', reject_reason: reason });
    },
    delete: (id: number) => {
      (['J', 'O'] as const).forEach((t) => { mockState.exceptions[t] = mockState.exceptions[t].filter((e) => e.id !== id); });
      return Promise.resolve();
    },
  },
}));

const exc = (overrides: Partial<LayerSdException>): LayerSdException => ({
  id: 1, table: 'J', process_id: 'P1', sp: 'SP01', sd: '1000.123 월평동', sd_number: '1000.123', layerid: '2000',
  status: 'PENDING', reason: '공정 특성', created_by: 'other', created_by_name: '김신청', created_at: '',
  team_agreed_by: '', team_agreed_by_name: '', team_agreed_at: null,
  p_agreed_by: '', p_agreed_by_name: '', p_agreed_at: null,
  rejected_by: '', rejected_by_name: '', rejected_at: null, reject_reason: '',
  ...overrides,
});
// 신청 방식 도입 전에 팀이 직접 등록한 예외 — 마이그레이션으로 APPROVED, sd·사유·합의자 없음.
const LEGACY_J = exc({ id: 2, sd: '', status: 'APPROVED', reason: '', created_by: 'tej', created_by_name: 'TE_J 담당' });

const renderModal = async (role: string, loginid = 'me') => {
  const view = render(
    <ToastProvider>
      <LayerSdExceptionModal isOpen onClose={() => undefined} role={role} loginid={loginid} />
    </ToastProvider>
  );
  await act(async () => { await Promise.resolve(); });
  return view;
};

const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const paste = (testId: string, text: string) => {
  fireEvent.paste(screen.getByTestId(testId), { clipboardData: { getData: () => text } });
};
const draftValues = () =>
  screen.getAllByTestId('sd-exc-draft-row').map((tr) =>
    within(tr).getAllByRole('textbox').map((i) => (i as HTMLInputElement).value));
const typeReason = (text: string) => fireEvent.change(screen.getByTestId('sd-exc-reason'), { target: { value: text } });
const clickApply = async () => {
  fireEvent.click(screen.getByTestId('sd-exc-add-btn'));
  await flush();
};

beforeAll(async () => { await i18n.changeLanguage('ko'); });
beforeEach(() => {
  mockState.exceptions = { J: [], O: [] };
  mockState.created = [];
  mockState.agreed = [];
  mockState.rejected = [];
  mockState.failSd = '';
});

describe('탭·상태 필터', () => {
  it('역할과 관계없이 J/O 탭과 신청 입력 표가 보이고, 탭 이름에 합의 대기 건수가 붙는다', async () => {
    mockState.exceptions.J = [exc({ id: 1 }), LEGACY_J];
    await renderModal('PL');
    expect(screen.getByTestId('sd-exc-tab-J').textContent).toBe('J-layer (1)');
    expect(screen.getByTestId('sd-exc-tab-O').textContent).toBe('O-layer');
    expect(screen.getByTestId('sd-exc-draft-table')).toBeDefined();
    expect(screen.getByTestId('sd-exc-reason')).toBeDefined();
  });

  it('TE_O 는 O 탭부터 열린다', async () => {
    await renderModal('TE_O');
    expect(screen.getByTestId('sd-exc-tab-O').className).toContain('active');
    expect(screen.getByText('O-layer 예외 신청')).toBeDefined();
  });

  it('처음에는 합의 대기 목록을 보여주고, 필터로 승인·전체를 볼 수 있다', async () => {
    mockState.exceptions.J = [exc({ id: 1, process_id: 'PEND' }), LEGACY_J];
    await renderModal('PL');
    expect(screen.getByTestId('sd-exc-filter-PENDING').textContent).toBe('합의 대기 (1)');
    expect(screen.getByTestId('sd-exc-saved-table').textContent).toContain('PEND');
    expect(screen.queryByTestId('sd-exc-row-2')).toBeNull();
    fireEvent.click(screen.getByTestId('sd-exc-filter-APPROVED'));
    expect(screen.getByTestId('sd-exc-row-2')).toBeDefined();
    expect(screen.queryByTestId('sd-exc-row-1')).toBeNull();
    fireEvent.click(screen.getByTestId('sd-exc-filter-ALL'));
    expect(screen.getByTestId('sd-exc-filter-ALL').textContent).toBe('전체 (2)');
    expect(screen.getAllByTestId(/^sd-exc-row-/)).toHaveLength(2);
  });

  it('신청자 이름·사유를 보여주고, sd 가 없던 예전 예외는 SD 칸에 SD 첫 숫자를 보여준다', async () => {
    mockState.exceptions.J = [exc({ id: 1, reason: '노광 공정 예외' }), LEGACY_J];
    await renderModal('PL');
    const row1 = screen.getByTestId('sd-exc-row-1');
    expect(row1.textContent).toContain('김신청');
    expect(row1.textContent).toContain('노광 공정 예외');
    fireEvent.click(screen.getByTestId('sd-exc-filter-APPROVED'));
    const legacy = screen.getByTestId('sd-exc-row-2');
    expect(legacy.textContent).toContain('1000.123');
    expect(legacy.textContent).toContain('TE_J 담당');
  });
});

describe('엑셀 붙여넣기', () => {
  it('4칸·2행을 첫 칸에 붙여넣으면 4칸이 채워지고 행이 자동으로 늘어난다', async () => {
    await renderModal('PL');
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\t1000.123 월평동 지점\t2000\r\nP2\tSP02\t300.5 x\t400\r\n');
    expect(draftValues()).toEqual([
      ['P1', 'SP01', '1000.123 월평동 지점', '2000'],
      ['P2', 'SP02', '300.5 x', '400'],
    ]);
  });

  it('가운데 칸에 붙여넣으면 그 칸부터 오른쪽으로 채운다', async () => {
    await renderModal('PL');
    paste('sd-exc-draft-sp-0', 'SP01\t1000.123 월평동\t2000');
    expect(draftValues()).toEqual([['', 'SP01', '1000.123 월평동', '2000']]);
  });
});

describe('신청', () => {
  it('사유를 비우면 신청하지 않고 안내한다', async () => {
    await renderModal('PL');
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\t1000.123 월평동 지점\t2000');
    await clickApply();
    expect(mockState.created).toEqual([]);
    expect(screen.getByTestId('sd-exc-reason-error').textContent).toBe('신청 사유를 입력하세요.');
  });

  it('붙여넣은 모든 행을 같은 사유로 신청하고, 합의 대기 목록에 신청자와 함께 나타난다', async () => {
    await renderModal('PL');
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\t1000.123 월평동 지점\t2000\nP2\tSP02\t300.5 x\t400');
    typeReason('  공정 특성  ');
    await clickApply();
    expect(mockState.created).toEqual([
      { table: 'J', process_id: 'P1', sp: 'SP01', sd: '1000.123 월평동 지점', layerid: '2000', reason: '공정 특성' },
      { table: 'J', process_id: 'P2', sp: 'SP02', sd: '300.5 x', layerid: '400', reason: '공정 특성' },
    ]);
    expect(draftValues()).toEqual([['', '', '', '']]);
    expect((screen.getByTestId('sd-exc-reason') as HTMLTextAreaElement).value).toBe('');
    const saved = screen.getByTestId('sd-exc-saved-table');
    expect(saved.textContent).toContain('1000.123 월평동 지점');
    expect(saved.textContent).toContain('신청자본인');
    expect(screen.getByText('예외 2건을 신청했습니다. 합의가 끝나면 적용됩니다.')).toBeDefined();
  });

  it('SD 가 숫자로 시작하지 않거나 Layer 가 빈 행이 있으면 하나도 신청하지 않고 안내한다', async () => {
    await renderModal('PL');
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\tABLD\t2000\nP2\tSP02\t300.5 x\t400');
    typeReason('사유');
    await clickApply();
    expect(mockState.created).toEqual([]);
    expect(screen.getByText(/빨간 행을 확인하세요/)).toBeDefined();
  });

  it('신청에 실패한 행만 입력 표에 남기고 사유도 남긴다', async () => {
    mockState.failSd = '300.5 x';
    await renderModal('PL');
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\t1000.123 월평동 지점\t2000\nP2\tSP02\t300.5 x\t400');
    typeReason('사유');
    await clickApply();
    expect(mockState.created).toHaveLength(1);
    expect(draftValues()).toEqual([['P2', 'SP02', '300.5 x', '400']]);
    expect((screen.getByTestId('sd-exc-reason') as HTMLTextAreaElement).value).toBe('사유');
    expect(screen.getByText(/1건을 신청하지 못했습니다/)).toBeDefined();
  });
});

describe('합의', () => {
  it('TE_J 는 J 탭 팀 칸에만 합의 버튼이 있고, 누르면 team 칸으로 합의된다', async () => {
    mockState.exceptions.J = [exc({ id: 1 })];
    await renderModal('TE_J');
    expect(screen.getByTestId('sd-exc-agree-team-1')).toBeDefined();
    expect(screen.queryByTestId('sd-exc-agree-p-1')).toBeNull();
    fireEvent.click(screen.getByTestId('sd-exc-agree-team-1'));
    await flush();
    expect(mockState.agreed).toEqual([{ id: 1, slot: 'team' }]);
    expect(screen.getByTestId('sd-exc-row-1').textContent).toContain('✓ 팀합의자');
    expect(screen.getByText('합의했습니다.')).toBeDefined();
  });

  it('TE_J 는 O 탭에서 합의·반려·삭제 버튼이 없다', async () => {
    mockState.exceptions.O = [exc({ id: 5, table: 'O' })];
    await renderModal('TE_J');
    fireEvent.click(screen.getByTestId('sd-exc-tab-O'));
    expect(screen.queryByTestId('sd-exc-agree-team-5')).toBeNull();
    expect(screen.queryByTestId('sd-exc-reject-5')).toBeNull();
    expect(screen.queryByTestId('sd-exc-delete-5')).toBeNull();
  });

  it('TE_P 는 J·O 탭 모두 P 칸에만 합의 버튼이 있다', async () => {
    mockState.exceptions.J = [exc({ id: 1 })];
    mockState.exceptions.O = [exc({ id: 5, table: 'O' })];
    await renderModal('TE_P');
    expect(screen.getByTestId('sd-exc-agree-p-1')).toBeDefined();
    expect(screen.queryByTestId('sd-exc-agree-team-1')).toBeNull();
    fireEvent.click(screen.getByTestId('sd-exc-tab-O'));
    expect(screen.getByTestId('sd-exc-agree-p-5')).toBeDefined();
    expect(screen.queryByTestId('sd-exc-agree-team-5')).toBeNull();
  });

  it('MASTER 는 두 칸 모두 합의할 수 있고, 두 칸이 차면 승인 목록으로 옮겨진다', async () => {
    mockState.exceptions.J = [exc({ id: 1 })];
    await renderModal('MASTER');
    fireEvent.click(screen.getByTestId('sd-exc-agree-team-1'));
    await flush();
    fireEvent.click(screen.getByTestId('sd-exc-agree-p-1'));
    await flush();
    expect(mockState.agreed).toEqual([{ id: 1, slot: 'team' }, { id: 1, slot: 'p' }]);
    expect(screen.queryByTestId('sd-exc-row-1')).toBeNull();
    fireEvent.click(screen.getByTestId('sd-exc-filter-APPROVED'));
    expect(screen.getByTestId('sd-exc-row-1').textContent).toContain('승인');
  });

  it('합의자 역할이 아니면 합의·반려 버튼 없이 "대기"만 보인다', async () => {
    mockState.exceptions.J = [exc({ id: 1 })];
    await renderModal('PL');
    expect(screen.queryByTestId('sd-exc-agree-team-1')).toBeNull();
    expect(screen.queryByTestId('sd-exc-reject-1')).toBeNull();
    expect(within(screen.getByTestId('sd-exc-row-1')).getAllByText('대기')).toHaveLength(2);
  });
});

describe('반려', () => {
  it('사유 없이 확인하면 반려하지 않고, 사유를 적으면 반려되어 반려 목록에 사유와 함께 보인다', async () => {
    mockState.exceptions.J = [exc({ id: 1 })];
    await renderModal('TE_J');
    fireEvent.click(screen.getByTestId('sd-exc-reject-1'));
    fireEvent.click(screen.getByTestId('sd-exc-reject-confirm-1'));
    await flush();
    expect(mockState.rejected).toEqual([]);
    expect(screen.getByText('반려 사유를 입력하세요.')).toBeDefined();
    fireEvent.change(screen.getByTestId('sd-exc-reject-reason-1'), { target: { value: 'Layer 오기입' } });
    fireEvent.click(screen.getByTestId('sd-exc-reject-confirm-1'));
    await flush();
    expect(mockState.rejected).toEqual([{ id: 1, reason: 'Layer 오기입' }]);
    fireEvent.click(screen.getByTestId('sd-exc-filter-REJECTED'));
    expect(screen.getByTestId('sd-exc-row-1').textContent).toContain('반려: 반려자 — Layer 오기입');
  });
});

describe('삭제·신청 취소', () => {
  it('합의자는 확인(두 번 클릭)을 거쳐 승인된 예외를 삭제한다', async () => {
    mockState.exceptions.J = [LEGACY_J];
    await renderModal('TE_P');
    fireEvent.click(screen.getByTestId('sd-exc-filter-APPROVED'));
    fireEvent.click(screen.getByTestId('sd-exc-delete-2'));
    expect(screen.getByText('삭제할까요?')).toBeDefined();
    fireEvent.click(screen.getByTestId('sd-exc-delete-confirm-2'));
    await flush();
    expect(screen.getByTestId('sd-exc-saved-empty')).toBeDefined();
    expect(mockState.exceptions.J).toHaveLength(0);
  });

  it('일반 사용자는 본인의 승인 전 신청만 "신청 취소" 할 수 있다', async () => {
    mockState.exceptions.J = [exc({ id: 1, created_by: 'me' }), exc({ id: 3, process_id: 'P3', created_by: 'other' })];
    await renderModal('PL', 'me');
    expect(screen.getByTestId('sd-exc-delete-1').textContent).toBe('신청 취소');
    expect(screen.queryByTestId('sd-exc-delete-3')).toBeNull();
    fireEvent.click(screen.getByTestId('sd-exc-delete-1'));
    expect(screen.getByText('신청을 취소할까요?')).toBeDefined();
    fireEvent.click(screen.getByTestId('sd-exc-delete-confirm-1'));
    await flush();
    expect(screen.queryByTestId('sd-exc-row-1')).toBeNull();
  });

  it('본인 신청이라도 승인된 뒤에는 일반 사용자가 지울 수 없다', async () => {
    mockState.exceptions.J = [exc({ id: 1, created_by: 'me', status: 'APPROVED' })];
    await renderModal('PL', 'me');
    fireEvent.click(screen.getByTestId('sd-exc-filter-APPROVED'));
    expect(screen.queryByTestId('sd-exc-delete-1')).toBeNull();
  });
});
