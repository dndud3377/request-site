/**
 * (1) ADI CD 변경 — 행 단위 '미등록' 선택
 * (2) Validation System — 자동 선택 폐지 + O-layer 단계 이동 전 필수 선택
 *
 * 두 기능 모두 "사용자가 직접 고른 값만 저장된다"는 같은 원칙을 구현한 것이라 한 파일에 묶는다.
 * 게이트 판정(validateAdiCdRows)은 순수 함수라 단위 테스트로, 화면 동작·저장 payload 는
 * 실제 작성 흐름을 구동해 확인한다.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { validateAdiCdRows } from './helpers';
import { AdiCdStep } from '../../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const LINE = '라인1';
const PROCESS = '조합법A';
const PRODUCT = '제품A';
const PROCESS_ID = 'PROC_X1';

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));

type LayerItem = { updated: string; processid: string; stepseq: string; descript: string; recipeid: string; layerid: string };
const mockState: { captured: unknown | null; doc: unknown; jobFile: LayerItem[] } =
  { captured: null, doc: null, jobFile: [] };

jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: mockState.doc }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: LINE }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve([PROCESS]),
    getProducts: () => Promise.resolve([PRODUCT]),
    getProcessId: () => Promise.resolve([PROCESS_ID]),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: () => Promise.resolve([]),
    getJobFileLayer: () => Promise.resolve(mockState.jobFile),
    getOvlLayer: () => Promise.resolve([]),
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

/** 요청 목적 버튼이 열리도록 라인·조합법·제품·조리법을 채운다. */
async function fillStep1Basics(container: HTMLElement) {
  const lineSelect = container.querySelector('select[name="line"]') as HTMLSelectElement;
  await act(async () => { fireEvent.change(lineSelect, { target: { value: LINE } }); });
  await flushEffects();
  for (const [label, value] of [['조합법', PROCESS], ['제품 이름', PRODUCT], ['조리법', PROCESS_ID]] as const) {
    const input = getFieldInput(container, label);
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { fireEvent.change(input, { target: { value } }); });
    // eslint-disable-next-line no-await-in-loop
    await flushEffects();
  }
}

async function saveDraftAndCaptureDetail(): Promise<Record<string, unknown>> {
  mockState.captured = null;
  const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('💾'));
  if (!saveBtn) throw new Error('임시저장 버튼을 찾지 못했다');
  await act(async () => { (saveBtn as HTMLButtonElement).click(); });
  await flushEffects();
  const payload = mockState.captured as { additional_notes: string } | null;
  if (!payload) throw new Error('임시저장 payload 를 캡처하지 못했다');
  return JSON.parse(payload.additional_notes).detail;
}

// ===================== (1) ADI CD 미등록 =====================

describe('validateAdiCdRows — 미등록 행 판정 규칙', () => {
  const row = (over: Partial<AdiCdStep>): AdiCdStep => ({ id: 'r', step_id: '', step_desc: '', ...over });

  it('미등록 행은 값이 비어 있어도 유효 1건으로 센다', () => {
    const r = validateAdiCdRows([row({ id: 'a', unregistered: true })]);
    expect(r.validCount).toBe(1);
    expect(r.incompleteIds).toEqual([]);
  });

  it('미등록 행은 불완전(한 칸만 채움) 판정 대상이 아니다', () => {
    // 값이 남아 있어도 미등록이면 그 값은 무시된다.
    const r = validateAdiCdRows([row({ id: 'a', step_id: '1000', unregistered: true })]);
    expect(r.incompleteIds).toEqual([]);
    expect(r.validCount).toBe(1);
  });

  it('미등록 행은 STEP_ID 중복 판정에 참여하지 않는다', () => {
    const r = validateAdiCdRows([
      row({ id: 'a', step_id: '1000', step_desc: 'ADI' }),
      row({ id: 'b', step_id: '1000', unregistered: true }),
    ]);
    expect(r.duplicateIds).toEqual([]);
    expect(r.validCount).toBe(2);
  });

  it('미등록이 아닌 행의 기존 규칙은 그대로다', () => {
    const r = validateAdiCdRows([
      row({ id: 'a', step_id: '1000', step_desc: 'ADI' }),   // 유효
      row({ id: 'b', step_id: '1000', step_desc: 'DUP' }),   // 중복
      row({ id: 'c', step_id: '2000' }),                      // 불완전
      row({ id: 'd' }),                                       // 빈 행 → 무시
    ]);
    expect(r.validCount).toBe(2);
    expect(r.duplicateIds.sort()).toEqual(['a', 'b']);
    expect(r.incompleteIds).toEqual(['c']);
  });
});

describe('ADI CD 변경 — 행 단위 미등록 선택', () => {
  beforeEach(() => { mockState.captured = null; mockState.doc = null; mockState.jobFile = []; localStorage.clear(); });

  /** ADI CD 패널의 미등록 체크박스들 */
  const unregCheckboxes = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.adi-cd-table input[type="checkbox"]')) as HTMLInputElement[];

  async function openAdiCdPanel(container: HTMLElement) {
    await fillStep1Basics(container);
    await act(async () => { buttonWith(container, '기타').click(); });
    await flushEffects();
    await act(async () => { buttonWith(container, 'ADI CD 변경').click(); });
    await flushEffects();
  }

  it('미등록 체크 시 STEP_ID/STEP_DESC 입력칸이 사라지고 "미등록"이 표시된다', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanel(container);

    const before = unregCheckboxes(container);
    expect(before.length).toBeGreaterThan(0);
    const inputCountBefore = container.querySelectorAll('.adi-cd-cell').length;

    await act(async () => { fireEvent.click(before[0]); });
    await flushEffects();

    // 그 행의 입력칸 2개가 '미등록' 셀 하나로 바뀐다.
    expect(container.querySelectorAll('.adi-cd-cell').length).toBe(inputCountBefore - 2);
    const unregCell = container.querySelector('.adi-cd-unreg-cell');
    expect(unregCell).not.toBeNull();
    expect(unregCell?.textContent).toBe('미등록');
  });

  it('미등록 행은 unregistered:true 와 빈 값으로 저장된다', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanel(container);

    // 첫 행에 값을 넣은 뒤 미등록으로 전환 → 값이 비워져야 한다.
    const cells = Array.from(container.querySelectorAll('.adi-cd-cell')) as HTMLInputElement[];
    await act(async () => { fireEvent.change(cells[0], { target: { value: '1000' } }); });
    await act(async () => { fireEvent.change(cells[1], { target: { value: 'ADI' } }); });
    await flushEffects();

    await act(async () => { fireEvent.click(unregCheckboxes(container)[0]); });
    await flushEffects();

    const detail = await saveDraftAndCaptureDetail();
    const rows = detail.adi_cd_before as AdiCdStep[];
    expect(rows[0].unregistered).toBe(true);
    expect(rows[0].step_id).toBe('');
    expect(rows[0].step_desc).toBe('');
  });

  it('미등록 체크를 풀면 다시 빈 입력칸으로 돌아온다(이전 값 복원 없음)', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanel(container);

    const cells = Array.from(container.querySelectorAll('.adi-cd-cell')) as HTMLInputElement[];
    await act(async () => { fireEvent.change(cells[0], { target: { value: '1000' } }); });
    await flushEffects();

    await act(async () => { fireEvent.click(unregCheckboxes(container)[0]); });
    await flushEffects();
    await act(async () => { fireEvent.click(unregCheckboxes(container)[0]); });
    await flushEffects();

    expect(container.querySelector('.adi-cd-unreg-cell')).toBeNull();
    const after = Array.from(container.querySelectorAll('.adi-cd-cell')) as HTMLInputElement[];
    expect(after[0].value).toBe('');
  });

  it('2열 붙여넣기는 모달 없이 즉시 적용되고, 포커스된 행부터 그 뒤 값만 덮어쓴다', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanel(container);

    // 0행(변경전 표)에 값을 채워 "건드리면 안 되는 행"으로 만든다.
    const cells = Array.from(container.querySelectorAll('.adi-cd-cell')) as HTMLInputElement[];
    await act(async () => { fireEvent.change(cells[0], { target: { value: '9999' } }); });
    await flushEffects();

    // 1행(cells[2])에 포커스가 있는 상태로 2행짜리 표를 붙여넣는다 — 헤더 없는 2열 그대로.
    const rowsBefore = Array.from(container.querySelectorAll('.adi-cd-cell')) as HTMLInputElement[];
    await act(async () => {
      fireEvent.paste(rowsBefore[2], { clipboardData: { getData: () => '2000\tX\n3000\tY' } } as never);
    });
    await flushEffects();

    // 컬럼 매핑 모달이 뜨지 않고 바로 반영됐어야 한다.
    expect(container.querySelector('.adi-cd-map-table')).toBeNull();

    const rowsAfter = Array.from(container.querySelectorAll('.adi-cd-cell')) as HTMLInputElement[];
    expect(rowsAfter[0].value).toBe('9999'); // 0행은 그대로
    expect(rowsAfter[2].value).toBe('2000'); // 1행부터 덮어써짐
    expect(rowsAfter[3].value).toBe('X');
    expect(rowsAfter[4].value).toBe('3000'); // 2행
    expect(rowsAfter[5].value).toBe('Y');
  });

  it('두 칸 다 빈 행을 붙여넣으면 그 행이 자동으로 미등록 처리된다(드롭되지 않는다)', async () => {
    const { container } = await renderNewDoc();
    await openAdiCdPanel(container);

    const cells = Array.from(container.querySelectorAll('.adi-cd-cell')) as HTMLInputElement[];
    await act(async () => {
      fireEvent.paste(cells[0], { clipboardData: { getData: () => 'A\tX\n\t\nC\tZ' } } as never);
    });
    await flushEffects();

    const detail = await saveDraftAndCaptureDetail();
    const rows = (detail.adi_cd_before as AdiCdStep[]).slice(0, 3);
    expect(rows[0]).toMatchObject({ step_id: 'A', step_desc: 'X', unregistered: false });
    expect(rows[1]).toMatchObject({ step_id: '', step_desc: '', unregistered: true });
    expect(rows[2]).toMatchObject({ step_id: 'C', step_desc: 'Z', unregistered: false });
  });
});

// ===================== (2) Validation System =====================

const PLEL_JAYER_ROW = {
  id: 'j1', updated: '20260801', sortOrder: 1, disabled: false, manuallyDisabled: false, loaded: true,
  process_id: PROCESS_ID, sp: 'SP01', sd: 'SD01', pp: 'PLEL_001', layerid: 'L01',
  st: 'X', new_or_copy: '신규', product_name: PRODUCT, step: '10', item_id: 'ITEM_1',
};

/** 판정 키워드(plel)가 있는 J-layer 를 가진 편집 문서. validation_system 은 저장돼 있지 않다(레거시). */
const vsFixtureDoc = (detailOver: Record<string, unknown> = {}) => ({
  id: 1,
  status: 'draft',
  title: '기존 제목',
  requester_name: '홍길동',
  requester_email: 'hong@example.com',
  requester_department: '개발팀',
  product_name: PRODUCT,
  production_date: '2026-09-01',
  reference_materials: '',
  approval_steps: [],
  additional_notes: JSON.stringify({
    detail: {
      request_purpose: '차용',
      line: LINE, process_selection: PROCESS, partid_selection: PRODUCT, process_id: PROCESS_ID,
      customer_name: '고객사A', customer_requirement: '요구사항',
      other_purpose: [], map_type: 'NEW',
      bb_zone: '존재', bb_entries: [],
      flow_chart: [], notifiers: [],
      adi_cd_before: [], adi_cd_after: [], adi_cd_delete_all: false,
      merge_unmatched_before: [], merge_unmatched_after: [],
      ...detailOver,
    },
    jayerRows: [PLEL_JAYER_ROW],
    oayerRows: [],
    bbRows: [],
    history: [],
  }),
});

describe('Validation System — 자동 선택 없이 사용자가 반드시 고른다', () => {
  beforeEach(() => { mockState.captured = null; mockState.jobFile = []; localStorage.clear(); });

  async function renderLoadedAtJayer() {
    mockState.captured = null;
    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
        <ToastProvider>
          <RequestPage />
        </ToastProvider>
      </MemoryRouter>
    );
    await flushEffects(25);
    // step1 → step2(MAP) → step3(J-layer)
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    return container;
  }

  const vsButtons = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.vs-toggle-btn')) as HTMLButtonElement[];

  /** 현재 화면이 J-layer(step3)인가 — O-layer 로 넘어갔는지 판별용 */
  const currentStepLabel = (container: HTMLElement) =>
    (container.querySelector('.form-section-title')?.textContent ?? '').trim();

  it('판정 키워드가 있어도 대상/비대상이 자동 선택되지 않는다', async () => {
    mockState.doc = vsFixtureDoc();
    const container = await renderLoadedAtJayer();

    expect(currentStepLabel(container)).toContain('J-ayer');
    const btns = vsButtons(container);
    expect(btns).toHaveLength(2);
    // 어느 쪽도 활성(vs-toggle-active-*) 이 아니어야 한다.
    btns.forEach((b) => expect(b.className).not.toMatch(/vs-toggle-active/));
  });

  it('자동 판정 문구를 화면에 보여주지 않는다', async () => {
    mockState.doc = vsFixtureDoc();
    const container = await renderLoadedAtJayer();
    expect(container.textContent).not.toContain('자동 판정');
  });

  it('미선택 상태에서는 O-layer 단계로 넘어가지 못한다', async () => {
    mockState.doc = vsFixtureDoc();
    const container = await renderLoadedAtJayer();

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();

    // 여전히 J-layer 단계다.
    expect(currentStepLabel(container)).toContain('J-ayer');
  });

  it('대상/비대상을 고르면 O-layer 단계로 넘어간다', async () => {
    mockState.doc = vsFixtureDoc();
    const container = await renderLoadedAtJayer();

    await act(async () => { vsButtons(container)[1].click(); }); // '비대상'
    await flushEffects();
    expect(vsButtons(container)[1].className).toMatch(/vs-toggle-active/);

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();

    expect(currentStepLabel(container)).not.toContain('J-ayer');
  });

  it('이미 저장된 선택값(비대상)은 유지되고 바로 넘어갈 수 있다', async () => {
    mockState.doc = vsFixtureDoc({ validation_system: 'NO' });
    const container = await renderLoadedAtJayer();

    expect(vsButtons(container)[1].className).toMatch(/vs-toggle-active/);
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(currentStepLabel(container)).not.toContain('J-ayer');
  });
});

/**
 * 위 describe 는 편집 로드(백필) 경로를 본다. 로드 시 setVsManuallySet(true) 가 걸려
 * 자동 갱신 effect 가 early-return 하므로, **신규 문서에서 J-layer 를 새로 불러오는 effect 경로**는
 * 별도로 확인해야 한다 — 실제 사용자가 가장 많이 지나는 길이다.
 */
describe('Validation System — 신규 문서에서 J-layer 를 불러온 직후(effect 경로)', () => {
  beforeEach(() => { mockState.captured = null; mockState.doc = null; localStorage.clear(); });

  const vsButtons = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.vs-toggle-btn')) as HTMLButtonElement[];

  it('판정 키워드가 있는 J-layer 를 불러와도 자동 선택되지 않는다', async () => {
    mockState.jobFile = [{
      updated: '20260801', processid: PROCESS_ID, stepseq: 'SP01',
      descript: 'SD01', recipeid: 'PLEL_001', layerid: 'L01',
    }];
    const { container } = await renderNewDoc();
    await fillStep1Basics(container);

    const detail = await saveDraftAndCaptureDetail();
    // 자동 선택이 살아 있으면 'YES' 가 저장된다.
    expect(detail.validation_system).toBe('');
  });

  it('판정 키워드가 없으면 종전대로 해당없음(NA)이다', async () => {
    mockState.jobFile = [{
      updated: '20260801', processid: PROCESS_ID, stepseq: 'SP01',
      descript: 'SD01', recipeid: 'PP_ORDINARY', layerid: 'L01',
    }];
    const { container } = await renderNewDoc();
    await fillStep1Basics(container);

    const detail = await saveDraftAndCaptureDetail();
    expect(detail.validation_system).toBe('NA');
    // '해당없음' 이므로 토글은 잠긴다.
    vsButtons(container).forEach((b) => expect(b.disabled).toBe(true));
  });
});
