/**
 * Step1 상단 제품이름 필드 — productOptions(조리법 좁히기로 흔들릴 수 있는 표시용 목록)와
 * productOptionsBroad(라인+조합법 전체, 존재 검증·입력칸 활성화 여부 전용) 분리 재현 테스트.
 *
 * 배경: "제품이름 ↔ 조리법 상호 좁힘" 도입 후 발견된 3가지 회귀.
 *  C. 조리법을 타이핑하는 도중(완성 전) productOptions가 일시적으로 비어, 제품 이름 입력칸이
 *     `disabled={productOptions.length === 0}` 때문에 통째로 비활성화됐다.
 *  D. 편집 로드 시 matchedOrLoading이 매치 검사를 우회해, 저장된 조리법 기준으로 productOptions가
 *     곧바로 좁혀져 다른 조리법을 가진 제품으로 바꾸려면 조리법을 먼저 바꿔야 했다.
 *  E. handlePartidSelectionBlur·validate()가 이 흔들리는 productOptions로 존재를 검사해, 이미
 *     유효한 제품이 선택돼 있어도 C·D 상태에서 거짓 오류가 났다.
 * 세 가지 모두 productOptionsBroad(조합법 변경 시에만 설정되는 안정된 전체 목록) 도입 + 조리법→
 * 제품이름 좁히기 effect의 편집 로드 가드로 고쳤다 — 이 파일은 그 동작을 실제로 구동해 확인한다.
 */
import React from 'react';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE = '라인1';
const PROCESS = '조합법A';

const mockState: { doc: unknown } = { doc: null };

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));
jest.mock('../../api/client', () => {
  // P1: PROC_X1 / P2: PROC_OTHER — 조합법A 아래 서로 다른 조리법을 가진 두 제품.
  const productsByProcessId: Record<string, string[]> = { '': ['P1', 'P2'], PROC_X1: ['P1'], PROC_OTHER: ['P2'] };
  const processIdsByProduct: Record<string, string[]> = { P1: ['PROC_X1'], P2: ['PROC_OTHER'] };
  return {
    documentsAPI: {
      get: () => Promise.resolve({ data: mockState.doc }),
      update: (_id: number, payload: unknown) => Promise.resolve({ data: { id: 1 } }),
      create: (payload: unknown) => Promise.resolve({ data: { id: 1 } }),
      getApproved: () => Promise.resolve({ data: [] }),
    },
    linesAPI: { list: () => Promise.resolve([{ name: LINE }]) },
    formOptionsAPI: {
      getProcesses: () => Promise.resolve([PROCESS]),
      getProducts: (_line: string, _process?: string, processId?: string) =>
        Promise.resolve(productsByProcessId[processId ?? ''] ?? []),
      getProcessId: (_line: string, product?: string, process?: string) => {
        if (product) return Promise.resolve(processIdsByProduct[product] ?? []);
        if (process) return Promise.resolve(['PROC_X1', 'PROC_OTHER']);
        return Promise.resolve([]);
      },
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
  };
});

async function flushEffects(times = 15) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

function getFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label.form-label')) as HTMLElement[];
  const label = labels.find((l) => l.textContent?.trim().startsWith(labelText));
  if (!label) throw new Error(`label "${labelText}" 을 찾지 못했다`);
  const input = label.parentElement?.querySelector('input');
  if (!input) throw new Error(`label "${labelText}" 옆 input 을 찾지 못했다`);
  return input as HTMLInputElement;
}

describe('productOptions ↔ productOptionsBroad 분리', () => {
  it('[문제 C 회귀 방지] 조리법을 부분 입력하는 동안에도 제품 이름 입력칸이 비활성화되지 않는다', async () => {
    mockState.doc = null;
    const { container } = render(
      <MemoryRouter initialEntries={['/request']}>
        <ToastProvider><RequestPage /></ToastProvider>
      </MemoryRouter>
    );
    await flushEffects();

    const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
    await act(async () => { fireEvent.change(lineSelect, { target: { value: LINE } }); });
    await flushEffects();
    await act(async () => { fireEvent.change(getFieldInput(container, '조합법'), { target: { value: PROCESS } }); });
    await flushEffects();

    // 조리법을 부분 입력("PROC_X"까지만, 아직 완성 아님) — 이 순간 productOptions는 비어도
    // productOptionsBroad 기준인 disabled는 풀려 있어야 한다.
    await act(async () => { fireEvent.change(getFieldInput(container, '조리법'), { target: { value: 'PROC_X' } }); });
    await flushEffects();

    const productInput = getFieldInput(container, '제품 이름');
    expect(productInput.disabled).toBe(false);
  });

  it('[문제 D 회귀 방지] 편집 로드 시 제품 이름 후보가 저장된 조리법 하나로 좁혀지지 않고 라인+조합법 전체로 보인다', async () => {
    mockState.doc = {
      id: 1,
      status: 'draft',
      title: '기존 제목',
      requester_name: '작성자',
      requester_email: 'r@example.com',
      requester_department: '개발팀',
      product_name: 'P1',
      production_date: '',
      reference_materials: '',
      additional_notes: JSON.stringify({
        detail: {
          request_purpose: '신규',
          other_purpose: [],
          line: LINE,
          process_selection: PROCESS,
          partid_selection: 'P1',
          process_id: 'PROC_X1',
          customer_name: '',
          customer_requirement: '',
          flow_chart: [],
          notifiers: [], post_approvers: [], sales_agreers: [],
        },
        jayerRows: [], oayerRows: [], bbRows: [], history: [], mergeSnapshot: null,
      }),
      approval_steps: [],
    };

    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
        <ToastProvider><RequestPage /></ToastProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(getFieldInput(container, '제품 이름').value).toBe('P1'));
    await flushEffects();

    // AutocompleteInput은 현재 입력값으로 드롭다운을 자체 필터링하므로(값이 'P1'이면 'P1' 포함
    // 항목만 보임) 텍스트를 지운 상태에서 후보를 보면 방금 지운 값과 일치해 항상 하나만 보이는
    // 착시가 생긴다. 대신 실제 사용자가 겪는 증상 그대로 — 로드 직후 다른 제품(P2, 조리법이
    // 다름)을 타이핑했을 때 후보로 뜨는지 — 로 확인한다. 밑바탕 productOptions가 여전히
    // ['P1']로 좁아져 있다면(D 회귀) 'P2'는 후보에 아예 안 뜬다.
    const productInput = getFieldInput(container, '제품 이름');
    await act(async () => { fireEvent.change(productInput, { target: { value: 'P2' } }); });
    await flushEffects();
    const scope = productInput.parentElement ?? document.body;
    const options = Array.from(scope.querySelectorAll('li')).map((li) => li.textContent);
    expect(options).toEqual(['P2']);
  });

  it('[문제 E 회귀 방지] 편집 로드 직후 이미 저장된 제품 이름으로 blur해도 거짓 오류가 뜨지 않는다', async () => {
    mockState.doc = {
      id: 1,
      status: 'draft',
      title: '기존 제목',
      requester_name: '작성자',
      requester_email: 'r@example.com',
      requester_department: '개발팀',
      product_name: 'P1',
      production_date: '',
      reference_materials: '',
      additional_notes: JSON.stringify({
        detail: {
          request_purpose: '신규',
          other_purpose: [],
          line: LINE,
          process_selection: PROCESS,
          partid_selection: 'P1',
          process_id: 'PROC_X1',
          customer_name: '',
          customer_requirement: '',
          flow_chart: [],
          notifiers: [], post_approvers: [], sales_agreers: [],
        },
        jayerRows: [], oayerRows: [], bbRows: [], history: [], mergeSnapshot: null,
      }),
      approval_steps: [],
    };

    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
        <ToastProvider><RequestPage /></ToastProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(getFieldInput(container, '제품 이름').value).toBe('P1'));
    await flushEffects();

    const productInput = getFieldInput(container, '제품 이름');
    await act(async () => { fireEvent.focus(productInput); });
    await act(async () => { fireEvent.blur(productInput); });
    await flushEffects();

    expect(container.querySelector('.form-error')?.textContent ?? '').not.toMatch(/목록에 있는 값만/);
    expect(document.querySelectorAll('.toast-error').length).toBe(0);
  });
});
