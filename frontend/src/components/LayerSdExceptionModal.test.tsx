/**
 * 홈 화면 SD-Layer 예외 관리 모달 — J/O 탭(관리 권한 없는 탭은 조회 전용), 엑셀 붙여넣기(여러 칸·여러 행), 일괄 등록, 삭제 확인.
 *
 * ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 →
 * jest.mock 은 평범한 함수 + mockState 로 쓴다(RouteChangeModal.test.tsx 와 같은 방식).
 */
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import LayerSdExceptionModal from './LayerSdExceptionModal';
import { ToastProvider } from './Toast';
import i18n from '../i18n';

type MockException = { id: number; table: 'J' | 'O'; process_id: string; sp: string; sd: string; sd_number: string; layerid: string; created_by: string; created_by_name: string; created_at: string };

const mockState: {
  exceptions: { J: MockException[]; O: MockException[] };
  created: unknown[];
  rejectSd: string;
} = { exceptions: { J: [], O: [] }, created: [], rejectSd: '' };

jest.mock('../api/client', () => ({
  layerSdExceptionsAPI: {
    list: (table: 'J' | 'O') => Promise.resolve(mockState.exceptions[table]),
    create: (input: { table: 'J' | 'O'; sd: string }) => {
      if (mockState.rejectSd && input.sd === mockState.rejectSd) return Promise.reject(new Error('dup'));
      mockState.created.push(input);
      return Promise.resolve({
        id: 900 + mockState.created.length, sd_number: input.sd.split(' ')[0], created_by: 'x', created_by_name: '등록자', created_at: '', ...input,
      });
    },
    delete: (id: number) => {
      (['J', 'O'] as const).forEach((t) => { mockState.exceptions[t] = mockState.exceptions[t].filter((e) => e.id !== id); });
      return Promise.resolve();
    },
  },
}));

const LEGACY_J: MockException = {
  id: 1, table: 'J', process_id: 'P1', sp: 'SP01', sd: '', sd_number: '1000.123', layerid: '2000',
  created_by: 'tej', created_by_name: 'TE_J 담당', created_at: '',
};

const renderModal = async (manageableTables: Array<'J' | 'O'>) => {
  const view = render(
    <ToastProvider>
      <LayerSdExceptionModal isOpen onClose={() => undefined} manageableTables={manageableTables} />
    </ToastProvider>
  );
  await act(async () => { await Promise.resolve(); });
  return view;
};

const paste = (testId: string, text: string) => {
  fireEvent.paste(screen.getByTestId(testId), { clipboardData: { getData: () => text } });
};
const draftValues = () =>
  screen.getAllByTestId('sd-exc-draft-row').map((tr) =>
    within(tr).getAllByRole('textbox').map((i) => (i as HTMLInputElement).value));
const clickAdd = async () => {
  fireEvent.click(screen.getByTestId('sd-exc-add-btn'));
  await act(async () => { await Promise.resolve(); });
};

beforeAll(async () => { await i18n.changeLanguage('ko'); });
beforeEach(() => {
  mockState.exceptions = { J: [], O: [] };
  mockState.created = [];
  mockState.rejectSd = '';
});

describe('탭', () => {
  it('관리 가능한 표가 둘이면 J/O 탭을 보여주고, 탭마다 다른 목록을 보여준다', async () => {
    mockState.exceptions.J = [LEGACY_J];
    await renderModal(['J', 'O']);
    expect(screen.getByTestId('sd-exc-tab-J')).toBeDefined();
    expect(screen.getByTestId('sd-exc-saved-table').textContent).toContain('2000');
    fireEvent.click(screen.getByTestId('sd-exc-tab-O'));
    expect(screen.getByText('등록된 예외가 없습니다.')).toBeDefined();
  });

  it('관리 가능한 표가 하나여도 J/O 탭이 둘 다 있고, 관리 가능한 탭이 먼저 열린다', async () => {
    await renderModal(['O']);
    expect(screen.getByTestId('sd-exc-tab-J')).toBeDefined();
    expect(screen.getByTestId('sd-exc-tab-O').className).toContain('active');
    expect(screen.getByText('O-layer 예외 추가')).toBeDefined();
    expect(screen.queryByTestId('sd-exc-readonly-hint')).toBeNull();
  });

  it('관리 권한이 없는 탭은 목록만 보이고 입력 표·삭제 버튼이 없다', async () => {
    mockState.exceptions.J = [LEGACY_J];
    await renderModal(['O']);
    fireEvent.click(screen.getByTestId('sd-exc-tab-J'));
    expect(screen.getByTestId('sd-exc-readonly-hint')).toBeDefined();
    expect(screen.queryByTestId('sd-exc-draft-table')).toBeNull();
    expect(screen.queryByTestId('sd-exc-add-btn')).toBeNull();
    const saved = screen.getByTestId('sd-exc-saved-table');
    expect(saved.textContent).toContain('2000');
    expect(within(saved).queryByRole('button', { name: '삭제' })).toBeNull();
  });

  it('sd 필드가 없던 예전 예외는 SD 칸에 SD 첫 숫자를 보여준다', async () => {
    mockState.exceptions.J = [LEGACY_J];
    await renderModal(['J']);
    expect(screen.getByTestId('sd-exc-saved-table').textContent).toContain('1000.123');
  });
});

describe('엑셀 붙여넣기', () => {
  it('4칸·2행을 첫 칸에 붙여넣으면 4칸이 채워지고 행이 자동으로 늘어난다', async () => {
    await renderModal(['J']);
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\t1000.123 월평동 지점\t2000\r\nP2\tSP02\t300.5 x\t400\r\n');
    expect(draftValues()).toEqual([
      ['P1', 'SP01', '1000.123 월평동 지점', '2000'],
      ['P2', 'SP02', '300.5 x', '400'],
    ]);
  });

  it('가운데 칸에 붙여넣으면 그 칸부터 오른쪽으로 채운다', async () => {
    await renderModal(['J']);
    paste('sd-exc-draft-sp-0', 'SP01\t1000.123 월평동\t2000');
    expect(draftValues()).toEqual([['', 'SP01', '1000.123 월평동', '2000']]);
  });
});

describe('일괄 등록', () => {
  it('붙여넣은 모든 행을 SD 전체 값 그대로 등록하고 입력 표를 비운다', async () => {
    await renderModal(['J']);
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\t1000.123 월평동 지점\t2000\nP2\tSP02\t300.5 x\t400');
    await clickAdd();
    expect(mockState.created).toEqual([
      { table: 'J', process_id: 'P1', sp: 'SP01', sd: '1000.123 월평동 지점', layerid: '2000' },
      { table: 'J', process_id: 'P2', sp: 'SP02', sd: '300.5 x', layerid: '400' },
    ]);
    expect(draftValues()).toEqual([['', '', '', '']]);
    expect(screen.getByTestId('sd-exc-saved-table').textContent).toContain('1000.123 월평동 지점');
    expect(screen.getByText('예외 2건을 등록했습니다.')).toBeDefined();
  });

  it('SD 가 숫자로 시작하지 않거나 Layer 가 빈 행이 있으면 하나도 등록하지 않고 안내한다', async () => {
    await renderModal(['J']);
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\tABLD\t2000\nP2\tSP02\t300.5 x\t400');
    await clickAdd();
    expect(mockState.created).toEqual([]);
    expect(screen.getByText(/빨간 행을 확인하세요/)).toBeDefined();
  });

  it('등록에 실패한 행만 입력 표에 남긴다', async () => {
    mockState.rejectSd = '300.5 x';
    await renderModal(['J']);
    paste('sd-exc-draft-process_id-0', 'P1\tSP01\t1000.123 월평동 지점\t2000\nP2\tSP02\t300.5 x\t400');
    await clickAdd();
    expect(mockState.created).toHaveLength(1);
    expect(draftValues()).toEqual([['P2', 'SP02', '300.5 x', '400']]);
    expect(screen.getByText(/1건을 등록하지 못했습니다/)).toBeDefined();
  });
});

describe('삭제', () => {
  it('삭제 확인(두 번 클릭)을 거쳐 삭제된다', async () => {
    mockState.exceptions.J = [LEGACY_J];
    await renderModal(['J']);
    const table = () => screen.getByTestId('sd-exc-saved-table');
    fireEvent.click(within(table()).getByRole('button', { name: '삭제' }));
    expect(screen.getByText('삭제할까요?')).toBeDefined();
    fireEvent.click(within(table()).getByRole('button', { name: '확인' }));
    expect(await screen.findByText('등록된 예외가 없습니다.')).toBeDefined();
    expect(mockState.exceptions.J).toHaveLength(0);
  });
});
