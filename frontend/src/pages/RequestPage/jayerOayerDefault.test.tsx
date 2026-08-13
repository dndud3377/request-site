/**
 * J-ayer/O-ayer 기본값(빈 배열) 및 라인/조리법 선택에 따른 재조회 동작 재현 테스트.
 *
 * 배경: 컴포넌트 마운트 기본값을 [makeJayerRow()]/[makeOayerRow()](빈 행 1개)에서 []로 바꾸고,
 * (1) process_id 변경 감지 effect의 Only MAP 분기, (2) 잡파일/OVL 레이어 조회 결과가 0건일 때
 * 표를 비우지 않던 부분을 함께 고쳤다. 이 세 지점이 라인·조리법 선택 조합별로 실제로
 * 의도대로 동작하는지 신규 문서 작성 흐름을 그대로 구동해 확인한다.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';

// 테스트 환경(jsdom)의 언어 감지 결과가 'en'이 되면 라벨 텍스트가 영문으로 렌더되어
// 아래 한글 라벨 검색이 전부 실패한다 — 이 파일 전용으로 한국어로 고정한다.
beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE = '라인1';
const PROCESS = '조합법A';
const PRODUCT = '제품A';
const PROC_WITH_DATA = 'PROC_DATA';
const PROC_MORE_DATA = 'PROC_DATA2';
const PROC_EMPTY = 'PROC_EMPTY';
const PROC_ERROR = 'PROC_ERROR';

type LayerItem = { updated: string; processid: string; stepseq: string; descript: string; recipeid: string; layerid: string };

const makeLayerItems = (n: number, tag: string): LayerItem[] =>
  Array.from({ length: n }, (_, i) => ({
    updated: '2026-08-01',
    processid: `${tag}_${i}`,
    stepseq: `SP${i}`,
    descript: `SD${i}`,
    recipeid: `PP${i}`,
    layerid: `L${i}`,
  }));

// process_id 별 job-file/ovl 응답을 여기서 조정한다.
const mockJobFileByProcessId: Record<string, LayerItem[]> = {
  [PROC_WITH_DATA]: makeLayerItems(2, 'J'),
  [PROC_MORE_DATA]: makeLayerItems(1, 'J2'),
  [PROC_EMPTY]: [],
};
const mockOvlByProcessId: Record<string, LayerItem[]> = {
  [PROC_WITH_DATA]: makeLayerItems(3, 'O'),
  [PROC_MORE_DATA]: makeLayerItems(1, 'O2'),
  [PROC_EMPTY]: [],
};

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));

const mockState: { captured: unknown | null; jobFileCalls: string[] } = { captured: null, jobFileCalls: [] };

// ⚠️ CRA jest 설정은 resetMocks: true 라 jest.fn 의 구현이 매 테스트마다 지워진다 → 평범한 함수로 둔다.
jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: null }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: LINE }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve([PROCESS]),
    getProducts: () => Promise.resolve([PRODUCT]),
    getProcessId: () => Promise.resolve([PROC_WITH_DATA, PROC_MORE_DATA, PROC_EMPTY, PROC_ERROR]),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: () => Promise.resolve([]),
    getJobFileLayer: (_line: string, process: string) => {
      mockState.jobFileCalls.push(process);
      if (process === PROC_ERROR) return Promise.reject(new Error('network down'));
      return Promise.resolve(mockJobFileByProcessId[process] ?? []);
    },
    getOvlLayer: (_line: string, process: string) => {
      if (process === PROC_ERROR) return Promise.reject(new Error('network down'));
      return Promise.resolve(mockOvlByProcessId[process] ?? []);
    },
    getBbExternalData: () => Promise.resolve([]),
    getBarcodeCandidates: () => Promise.resolve([]),
  },
  uploadImageAPI: { upload: () => Promise.resolve({}) },
  guidesAPI: { list: () => Promise.resolve({ data: { results: [], count: 0 } }) },
  usersAPI: { list: () => Promise.resolve({ data: [] }) },
  addressBooksAPI: { list: () => Promise.resolve([]) },
  userGroupsAPI: { list: () => Promise.resolve([]) },
}));

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

/** 신규 문서 작성 화면을 띄우고 라인 옵션 로드까지 기다린다. */
async function renderNewDoc() {
  mockState.captured = null;
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

async function setLineProcessProduct(container: HTMLElement) {
  const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
  await act(async () => { fireEvent.change(lineSelect, { target: { value: LINE } }); });
  await flushEffects();

  const processInput = getFieldInput(container, '조합법');
  await act(async () => { fireEvent.change(processInput, { target: { value: PROCESS } }); });
  await flushEffects();

  const productInput = getFieldInput(container, '제품 이름');
  await act(async () => { fireEvent.change(productInput, { target: { value: PRODUCT } }); });
  await flushEffects();
}

async function setProcessId(container: HTMLElement, value: string) {
  const processIdInput = getFieldInput(container, '조리법');
  await act(async () => { fireEvent.change(processIdInput, { target: { value } }); });
  await flushEffects();
}

/** '임시저장'을 눌러 서버로 나간 payload 의 jayerRows/oayerRows 를 읽는다. */
async function captureRows(): Promise<{ jayerRows: unknown[]; oayerRows: unknown[] }> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { (saveBtn as HTMLButtonElement).click(); });
  await waitFor(() => expect(mockState.captured).not.toBeNull());
  const payload = mockState.captured as { additional_notes: string };
  const notes = JSON.parse(payload.additional_notes);
  return { jayerRows: notes.jayerRows ?? [], oayerRows: notes.oayerRows ?? [] };
}

describe('J-ayer/O-ayer 기본값 — 신규 문서에서 라인/조리법 선택 케이스별 동작', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.jobFileCalls = [];
    localStorage.clear();
  });

  it('Case A: 신규 문서, 아무것도 선택하지 않으면 빈 배열이다', async () => {
    await renderNewDoc();
    const { jayerRows, oayerRows } = await captureRows();
    expect(jayerRows).toHaveLength(0);
    expect(oayerRows).toHaveLength(0);
  });

  it('Case B: 라인/조합법/제품까지만 채우고 조리법 미선택이면 여전히 빈 배열이다', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);
    const { jayerRows, oayerRows } = await captureRows();
    expect(jayerRows).toHaveLength(0);
    expect(oayerRows).toHaveLength(0);
  });

  it('Case C: 데이터가 있는 조리법을 선택하면 조회된 행으로 채워진다', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);
    await setProcessId(container, PROC_WITH_DATA);
    const { jayerRows, oayerRows } = await captureRows();
    expect(jayerRows).toHaveLength(mockJobFileByProcessId[PROC_WITH_DATA].length);
    expect(oayerRows).toHaveLength(mockOvlByProcessId[PROC_WITH_DATA].length);
  });

  it('Case D: 데이터가 없는 조리법을 선택하면 빈 배열로 채워진다(기본 상태와 동일)', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);
    await setProcessId(container, PROC_EMPTY);
    const { jayerRows, oayerRows } = await captureRows();
    expect(jayerRows).toHaveLength(0);
    expect(oayerRows).toHaveLength(0);
  });

  it('Case E [핵심]: 데이터가 있던 조리법에서 데이터가 없는 조리법으로 바꾸면 이전 행이 사라진다', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);
    await setProcessId(container, PROC_WITH_DATA);
    const populated = await captureRows();
    expect(populated.jayerRows.length).toBeGreaterThan(0);
    expect(populated.oayerRows.length).toBeGreaterThan(0);

    await setProcessId(container, PROC_EMPTY);
    const { jayerRows, oayerRows } = await captureRows();
    expect(jayerRows).toHaveLength(0);
    expect(oayerRows).toHaveLength(0);
  });

  it('Case F: 데이터 없는 조리법에서 데이터 있는 조리법으로 바꾸면 정상적으로 채워진다', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);
    await setProcessId(container, PROC_EMPTY);
    await captureRows();

    await setProcessId(container, PROC_MORE_DATA);
    const { jayerRows, oayerRows } = await captureRows();
    expect(jayerRows).toHaveLength(mockJobFileByProcessId[PROC_MORE_DATA].length);
    expect(oayerRows).toHaveLength(mockOvlByProcessId[PROC_MORE_DATA].length);
  });

  it('Case G: 서로 다른 데이터가 있는 조리법 사이를 오가면 매번 해당 조리법 데이터로 교체된다', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);

    await setProcessId(container, PROC_WITH_DATA);
    const first = await captureRows();
    expect(first.jayerRows).toHaveLength(mockJobFileByProcessId[PROC_WITH_DATA].length);

    await setProcessId(container, PROC_MORE_DATA);
    const second = await captureRows();
    expect(second.jayerRows).toHaveLength(mockJobFileByProcessId[PROC_MORE_DATA].length);
    expect(second.jayerRows).not.toEqual(first.jayerRows);
  });

  it('Case H: API 오류가 나면 표는 비워지지 않고 직전 상태가 유지된다', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);
    await setProcessId(container, PROC_WITH_DATA);
    const before = await captureRows();
    expect(before.jayerRows.length).toBeGreaterThan(0);

    await setProcessId(container, PROC_ERROR);
    const after = await captureRows();
    // 조회 실패 시 기존 행을 그대로 둔다(현재 동작 기록 — 사용자의 기존 입력을 지우지 않기 위함).
    expect(after.jayerRows).toEqual(before.jayerRows);
    expect(after.oayerRows).toEqual(before.oayerRows);
  });

  it('Case I: Only MAP 선택 후 조리법을 바꿔도 빈 배열을 유지하고 재조회하지 않는다', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);
    await setProcessId(container, PROC_WITH_DATA);
    const populated = await captureRows();
    expect(populated.jayerRows.length).toBeGreaterThan(0);

    await act(async () => { buttonWith(container, 'Only MAP').click(); });
    await flushEffects();
    const afterOnlyMap = await captureRows();
    expect(afterOnlyMap.jayerRows).toHaveLength(0);
    expect(afterOnlyMap.oayerRows).toHaveLength(0);

    // Only MAP 인 채로 조리법을 다른 데이터 있는 값으로 바꿔도 여전히 빈 배열이어야 한다
    // (수정 전에는 [makeJayerRow()]/[makeOayerRow()] 로 되돌아가는 버그가 있었다).
    await setProcessId(container, PROC_MORE_DATA);
    const afterChange = await captureRows();
    expect(afterChange.jayerRows).toHaveLength(0);
    expect(afterChange.oayerRows).toHaveLength(0);
  });

  it('Case J [참고 — 현재 동작 기록]: MAP 삭제 상태에서 조리법을 바꾸면 불필요한 조회가 실제로 발생한다(저장 결과는 안전)', async () => {
    const { container } = await renderNewDoc();
    await setLineProcessProduct(container);
    await setProcessId(container, PROC_WITH_DATA);

    await act(async () => { buttonWith(container, 'MAP 삭제').click(); });
    await flushEffects();
    mockState.jobFileCalls = []; // MAP 삭제 전환 시점의 호출은 제외하고 이후만 관찰

    // process_id 변경 감지 effect 의 Only MAP 분기는 'Only MAP' 문자열만 검사하므로
    // MAP 삭제는 이 우회를 타지 않고 fetchJobFileLayerAndPopulateJayer 가 그대로 실행된다
    // (불필요한 API 호출 + jayerRows 가 잠시 실제 데이터로 채워지는 화면 밖 상태 변화).
    await setProcessId(container, PROC_MORE_DATA);
    expect(mockState.jobFileCalls).toContain(PROC_MORE_DATA);

    // 다만 저장 시점에는 buildEnrichedForm 이 isMapOnlyScope(Only MAP·MAP 삭제 공통) 면
    // jayerRows/oayerRows 를 무조건 [] 로 덮어쓰므로, 실제 저장되는 값은 안전하게 비어 있다.
    const { jayerRows, oayerRows } = await captureRows();
    expect(jayerRows).toHaveLength(0);
    expect(oayerRows).toHaveLength(0);
  });
});
