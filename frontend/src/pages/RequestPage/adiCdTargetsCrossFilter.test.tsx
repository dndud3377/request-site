/**
 * ADI CD 변경 '동일 변경 적용 대상' 패널 — 제품 이름 ↔ 조리법 상호 좁힘 재현 테스트.
 *
 * 배경: Step1 상단 필드에 "조리법을 먼저 골라도 제품이름이 좁혀지는" 양방향 캐스케이드를
 * 추가하면서, 이 패널이 상단 필드의 productOptions 를 그대로 재사용하던 것이 부작용으로
 * 라인+조합법 전체가 아니라 상단에서 마지막으로 좁혀진 목록만 보이는 회귀가 있었다(예: 상단에서
 * 조리법 Y를 고르면 Y를 안 가진 제품 P2가 이 패널의 제품이름 후보에서 사라짐).
 * 이를 고쳐 이 패널은 독립된 상태로 라인+조합법 범위 전체를 다루고, 그 안에서 제품이름↔조리법을
 * 서로 좁히도록 했다 — 이 파일은 그 동작을 실제로 구동해 확인한다.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

// jest.mock 팩토리는 호이스팅되어 import 시점에 즉시 실행되므로, 팩토리 밖 상수를 참조하지
// 않고 리터럴로 직접 둔다(TDZ 참조 오류 회피 — lineProcessCrossFilter.test.tsx 와 동일 이유).
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
  // 조합법A: P1(조리법 X/Y), P2(조리법 X만). 조합법B: P3(조리법 Z만) — 조합법이 바뀌었을 때
  // draft 옵션이 새 조합법 기준으로 갱신되는지 확인하는 데 쓴다.
  const productsByProcess: Record<string, string[]> = { '조합법A': ['P1', 'P2'], '조합법B': ['P3'] };
  const processIdsByProduct: Record<string, string[]> = { P1: ['X', 'Y'], P2: ['X'], P3: ['Z'] };
  return {
    documentsAPI: {
      get: () => Promise.resolve({ data: null }),
      update: (_id: number, payload: unknown) => Promise.resolve({ data: { id: 1 } }),
      create: (payload: unknown) => Promise.resolve({ data: { id: 1 } }),
      getApproved: () => Promise.resolve({ data: [] }),
    },
    linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
    formOptionsAPI: {
      getProcesses: () => Promise.resolve(['조합법A', '조합법B']),
      getProducts: (_line: string, process?: string, processId?: string) => {
        const products = productsByProcess[process ?? ''] ?? [];
        if (!processId) return Promise.resolve(products);
        return Promise.resolve(products.filter((p) => (processIdsByProduct[p] || []).includes(processId)));
      },
      getProcessId: (_line: string, product?: string, process?: string) => {
        if (product) return Promise.resolve(processIdsByProduct[product] ?? []);
        if (process) {
          const ids = new Set<string>();
          (productsByProcess[process] ?? []).forEach((p) => (processIdsByProduct[p] || []).forEach((id) => ids.add(id)));
          return Promise.resolve(Array.from(ids));
        }
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

function buttonWith(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`"${text}" 버튼을 찾지 못했다`);
  return btn as HTMLButtonElement;
}

async function renderNewDoc() {
  const view = render(
    <MemoryRouter initialEntries={['/request']}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await flushEffects();
  return view;
}

/** 라인→조합법→제품이름(P1)→조리법(Y) 까지 채우고 'ADI CD 변경' 을 선택해 패널을 연다. */
async function openAdiCdPanelViaProductFirst(container: HTMLElement) {
  const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
  await act(async () => { fireEvent.change(lineSelect, { target: { value: '라인1' } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조합법'), { target: { value: '조합법A' } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '제품 이름'), { target: { value: 'P1' } }); });
  await flushEffects();
  await act(async () => { fireEvent.change(getFieldInput(container, '조리법'), { target: { value: 'Y' } }); });
  await flushEffects();
  await act(async () => { buttonWith(container, '기타').click(); });
  await flushEffects();
  await act(async () => { buttonWith(container, 'ADI CD 변경').click(); });
  await flushEffects();
}

function draftInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('.adi-cd-targets-draft input')) as HTMLInputElement[];
}

/** AutocompleteInput 하나의 드롭다운 <li> 텍스트만 — input 은 자기 드롭다운과 같은 div 안에 있다. */
function dropdownOptionsOf(input: HTMLInputElement): (string | null)[] {
  const scope = input.parentElement ?? document.body;
  return Array.from(scope.querySelectorAll('li')).map((li) => li.textContent);
}

describe('ADI CD 변경 — 동일 변경 적용 대상 패널 제품이름 ↔ 조리법 상호 좁힘', () => {
  it('[회귀 방지] 상단 필드에서 조리법(Y)을 골라도, 패널의 제품이름 후보는 라인+조합법 전체(P1, P2)로 보인다', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanelViaProductFirst(container); // 상단 조리법=Y 로 확정된 상태

    const inputs = draftInputs(container);
    await act(async () => { fireEvent.focus(inputs[0]); });
    await flushEffects();

    const options = dropdownOptionsOf(inputs[0]);
    expect((options as string[]).sort()).toEqual(['P1', 'P2']); // 좁혀지지 않고 라인+조합법 전체가 보여야 한다
  });

  it('패널 안에서 제품이름을 먼저 고르면 그에 맞는 조리법이 좁혀진다', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanelViaProductFirst(container);

    await act(async () => { fireEvent.change(draftInputs(container)[0], { target: { value: 'P2' } }); });
    await flushEffects();

    const pidInput = draftInputs(container)[1];
    await act(async () => { fireEvent.focus(pidInput); });
    await flushEffects();
    const pidOptions = dropdownOptionsOf(pidInput);
    expect(pidOptions).toEqual(['X']); // P2 는 X만 가짐
  });

  it('패널 안에서 조리법을 먼저 고르면 그에 맞는 제품이름으로 좁혀지고, 추가도 정상 반영된다', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanelViaProductFirst(container);

    // draft 조리법을 먼저 X로 선택(제품이름은 아직 비움) → 제품이름 후보가 X를 가진 P1, P2 그대로
    await act(async () => { fireEvent.change(draftInputs(container)[1], { target: { value: 'X' } }); });
    await flushEffects();
    const productInput = draftInputs(container)[0];
    await act(async () => { fireEvent.focus(productInput); });
    await flushEffects();
    const productOptionsShown = dropdownOptionsOf(productInput);
    expect((productOptionsShown as string[]).sort()).toEqual(['P1', 'P2']);

    await act(async () => { fireEvent.change(draftInputs(container)[0], { target: { value: 'P2' } }); });
    await flushEffects();

    const addBtn = container.querySelector('.adi-cd-targets-add') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
    await act(async () => { addBtn.click(); });
    await flushEffects();

    const rows = Array.from(container.querySelectorAll('.adi-cd-targets-table tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain('P2');
    expect(rows[1].textContent).toContain('X');
  });

  it('[회귀 방지] 패널이 열린 채(draft 비어있음) 위쪽 조합법을 바꾸면 후보가 새 조합법 기준으로 갱신된다', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanelViaProductFirst(container); // 조합법A, 패널 열림, draft는 비어있음

    // 위쪽 조합법을 B로 바꾼다(제품이름·조리법도 함께 리셋된다 — 그 리셋 시점에 draft도 비워짐).
    await act(async () => { fireEvent.change(getFieldInput(container, '조합법'), { target: { value: '조합법B' } }); });
    await flushEffects();
    await act(async () => { fireEvent.change(getFieldInput(container, '제품 이름'), { target: { value: 'P3' } }); });
    await flushEffects();
    await act(async () => { fireEvent.change(getFieldInput(container, '조리법'), { target: { value: 'Z' } }); });
    await flushEffects();

    const productInput = draftInputs(container)[0];
    await act(async () => { fireEvent.focus(productInput); });
    await flushEffects();
    // 새 조합법(B)의 제품(P3)만 보여야 한다 — 이전 조합법(A)의 P1/P2가 남아있으면 stale 회귀.
    expect(dropdownOptionsOf(productInput)).toEqual(['P3']);
  });
});
