/**
 * claude 수정 (2026-11-11): STEP2 MAP 정보 '숫자 확인 필수' 테스트 — 숫자 입력칸을 '<기준값> 이상/이하' 드롭다운으로 바꾼 구조
 *
 * 규칙:
 * - MAP 목적이 NEW 이고, J-ayer·O-ayer 의 모든 행(활성·비활성 무관) 중 pp 에 'PPPP' 가 포함(대소문자 무시)되면
 *   해당 여부 드롭다운이 '해당 있음'으로 고정, 아니면 '해당 없음'으로 고정(항상 잠김).
 * - '해당 있음'이면 숫자 확인 값 드롭다운 [선택 / 13 이상 / 9 이하]이 열리고 필수다.
 *   숫자는 .env NUM_CHECK_IMAGE_THRESHOLD(기본 13) / NUM_CHECK_LOWER_THRESHOLD(기본 9). 저장값은 '13 이상'처럼 숫자 포함.
 * - '이상'을 고르면 사진 칸이 2개부터 열리고 사진 최소 2장 필수. 사진 + 빈 칸이 2칸 이하이면 빈 칸 삭제 버튼이 없다.
 * - '사진 추가' 버튼은 숫자 확인 값 오른쪽에 항상 있고, '이상'일 때만 활성화된다.
 * - 사진 칸은 M-shot 칸과 같은 50% 가 최대 폭이다.
 * - 판정이 풀리면 '해당 없음' + 값·사진 비움, '이하'로 바꾸면 사진 비움. 저장 문서를 다시 열 때는 저장값을 그대로 둔다.
 * - 저장값이 현재 보기에 없으면(기준값이 바뀐 옛 문서) 그 값을 보기로 하나 더 보여 값이 바뀌지 않는다.
 */
import React from 'react';
import { render, act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { INITIAL_DETAIL, makeJayerRow, makeOayerRow } from './constants';
import {
  isNumCheckRequired, isNumCheckImageRequired, numCheckOptionValue, parseNumCheckValue, formatNumCheckValue,
} from './helpers';

// jsdom 에는 scrollIntoView 가 없다 — 검증 오류 시 해당 칸으로 스크롤하는 동작(다른 RequestPage 테스트와 같은 처리)
window.HTMLElement.prototype.scrollIntoView = () => {};

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const REQUIRED_MSG = '사진을 2장 이상 첨부해야 합니다.';
const OVER = '13 이상';
const UNDER = '9 이하';
const ADD_BTN = '사진 추가';
const APPLIES = '해당 있음';
const NONE = '해당 없음';

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));

const mockState: {
  captured: unknown | null; doc: unknown | null; uploadSeq: number; imageThreshold: number; lowerThreshold: number;
} = {
  captured: null, doc: null, uploadSeq: 0, imageThreshold: 13, lowerThreshold: 9,
};

jest.mock('../../api/client', () => ({
  documentsAPI: {
    get: () => Promise.resolve({ data: mockState.doc }),
    update: (_id: number, payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    create: (payload: unknown) => { mockState.captured = payload; return Promise.resolve({ data: { id: 1 } }); },
    getApproved: () => Promise.resolve({ data: [] }),
  },
  linesAPI: { list: () => Promise.resolve([{ name: '라인1' }]) },
  formOptionsAPI: {
    getProcesses: () => Promise.resolve(['조합법A']),
    getProducts: () => Promise.resolve(['제품A']),
    getProcessId: () => Promise.resolve(['PROC_X1']),
    getLayerIds: () => Promise.resolve([]),
    getMapNames: () => Promise.resolve([]),
    getMapInfo: () => Promise.resolve({ AAA1: null, AAA2: null, AAA3: null }),
    getJobFileLayer: () => Promise.resolve([]),
    getOvlLayer: () => Promise.resolve([]),
    getBbExternalData: () => Promise.resolve([]),
    getBarcodeCandidates: () => Promise.resolve([]),
    getNumCheckConfig: () => Promise.resolve({ image_threshold: mockState.imageThreshold, lower_threshold: mockState.lowerThreshold }),
  },
  uploadImageAPI: {
    upload: () => {
      mockState.uploadSeq += 1;
      return Promise.resolve({ path: `mshot_images/n${mockState.uploadSeq}.png` });
    },
  },
  guidesAPI: { list: () => Promise.resolve({ data: { results: [], count: 0 } }) },
  usersAPI: { list: () => Promise.resolve({ data: [] }) },
  addressBooksAPI: { list: () => Promise.resolve([]) },
  userGroupsAPI: { list: () => Promise.resolve([]) },
}));

async function flushEffects(times = 15) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

function buttonWith(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`"${text}" 버튼을 찾지 못했다`);
  return btn as HTMLButtonElement;
}

const numCheckSelect = (c: HTMLElement) => c.querySelector('select[name="num_check"]') as HTMLSelectElement;
const numCheckValueSelect = (c: HTMLElement) => c.querySelector('select[name="num_check_value"]') as HTMLSelectElement;
const optionTexts = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.textContent);
const optionValues = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.value);

/** 사진 칸 영역 — 없으면 null */
function imageBlock(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-num-check-images]') as HTMLElement | null;
}

const addButton = (c: HTMLElement) => buttonWith(c, ADD_BTN);

function requireImageBlock(container: HTMLElement): HTMLElement {
  const block = imageBlock(container);
  if (!block) throw new Error('사진 첨부 영역이 없다');
  return block;
}

const pasteAreas = (c: HTMLElement) => Array.from(requireImageBlock(c).querySelectorAll('.image-upload-area')) as HTMLElement[];
const deleteButtons = (c: HTMLElement) => Array.from(requireImageBlock(c).querySelectorAll('button'))
  .filter((b) => b.textContent === '삭제') as HTMLButtonElement[];

async function selectValue(container: HTMLElement, value: string) {
  await act(async () => { fireEvent.change(numCheckValueSelect(container), { target: { value } }); });
  await flushEffects();
}

async function pasteImage(area: HTMLElement) {
  const file = new File(['x'], 'shot.png', { type: 'image/png' });
  await act(async () => {
    fireEvent.paste(area, { clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] } });
  });
  await flushEffects();
}

type RowPp = { pp: string; st?: string };

/** 저장 문서를 열어(편집 로드) STEP2 로 이동한다. J/O 행은 pp 만 지정한다. */
async function openDocAtMapStep(
  mapType: string,
  jayer: RowPp[],
  oayer: RowPp[],
  extraDetail: Record<string, unknown> = {},
) {
  mockState.captured = null;
  const detailFixture = {
    ...INITIAL_DETAIL,
    request_purpose: '신규',
    line: '라인1',
    process_selection: '조합법A',
    partid_selection: '제품A',
    process_id: 'PROC_X1',
    customer_name: '고객사A',
    customer_requirement: '요구사항',
    map_type: mapType,
    ...extraDetail,
  };
  mockState.doc = {
    id: 1,
    status: 'draft',
    title: '기존 제목',
    requester_name: '원작성자',
    requester_email: 'orig@example.com',
    requester_department: '원부서',
    product_name: '제품A',
    production_date: '',
    reference_materials: '',
    additional_notes: JSON.stringify({
      detail: detailFixture,
      // J 행 기본값은 ST=X — ST=O 행이 있으면 STEP1 이 뼈찜 조합 영역을 필수로 요구한다(판정은 ST 무관).
      jayerRows: jayer.map((r) => ({ ...makeJayerRow(), pp: r.pp, st: r.st ?? 'X' })),
      oayerRows: oayer.map((r) => ({ ...makeOayerRow(), pp: r.pp, st: r.st ?? 'O' })),
      bbRows: [],
      history: [],
    }),
    approval_steps: [],
  };
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: '/request', state: { editDocId: 1 } }]}>
      <ToastProvider>
        <RequestPage />
      </ToastProvider>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByDisplayValue('고객사A')).toBeDefined());
  await flushEffects(20);
  await act(async () => { buttonWith(view.container, '다음').click(); });
  await flushEffects();
  return view;
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

async function clickConfirm() {
  const confirmBtn = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === '확인').pop();
  if (confirmBtn) {
    await act(async () => { (confirmBtn as HTMLButtonElement).click(); });
    await flushEffects();
  }
}

describe('숫자 확인 필수 — 판정 함수', () => {
  it('isNumCheckRequired: NEW + J 또는 O 의 pp 에 PPPP 포함(대소문자 무시)이면 참', () => {
    expect(isNumCheckRequired('NEW', [{ pp: 'AB_PPPP_01' }], [])).toBe(true);
    expect(isNumCheckRequired('NEW', [], [{ pp: 'x-pppp' }])).toBe(true);
    expect(isNumCheckRequired('NEW', [{ pp: 'PpPp' }], [])).toBe(true);
    expect(isNumCheckRequired('NEW', [{ pp: 'PPP_P' }], [{ pp: '' }])).toBe(false);
    ['CLONE', 'EXISTING', '삭제', ''].forEach((mt) => {
      expect(isNumCheckRequired(mt, [{ pp: 'PPPP' }], [{ pp: 'PPPP' }])).toBe(false);
    });
  });

  it('numCheckOptionValue / parseNumCheckValue: 저장값은 "<기준값> 이상|이하"', () => {
    expect(numCheckOptionValue(13, '이상')).toBe('13 이상');
    expect(numCheckOptionValue(9.5, '이하')).toBe('9.5 이하');
    expect(parseNumCheckValue('13 이상')).toEqual({ threshold: '13', word: '이상' });
    expect(parseNumCheckValue(' 9 이하 ')).toEqual({ threshold: '9', word: '이하' });
    ['', '13', '이상', 'abc 이상', '13 초과', '13 이상 x'].forEach((v) => {
      expect(parseNumCheckValue(v)).toBeNull();
    });
  });

  it('isNumCheckImageRequired: "이상" 보기일 때만 참(숫자 크기와 무관)', () => {
    expect(isNumCheckImageRequired('13 이상')).toBe(true);
    expect(isNumCheckImageRequired('5 이상')).toBe(true);
    expect(isNumCheckImageRequired('9 이하')).toBe(false);
    expect(isNumCheckImageRequired('20 이하')).toBe(false);
    expect(isNumCheckImageRequired('')).toBe(false);
    expect(isNumCheckImageRequired(undefined)).toBe(false);
    expect(isNumCheckImageRequired('15')).toBe(false);
  });

  it('formatNumCheckValue: ko "13 이상" / en "13 or more", 형식이 다르면 저장값 그대로', async () => {
    expect(formatNumCheckValue(i18n.t, '13 이상')).toBe('13 이상');
    expect(formatNumCheckValue(i18n.t, '9 이하')).toBe('9 이하');
    expect(formatNumCheckValue(i18n.t, '12')).toBe('12');
    expect(formatNumCheckValue(i18n.t, '')).toBe('');
    await i18n.changeLanguage('en');
    try {
      expect(formatNumCheckValue(i18n.t, '13 이상')).toBe('13 or more');
      expect(formatNumCheckValue(i18n.t, '9 이하')).toBe('9 or less');
    } finally {
      await i18n.changeLanguage('ko');
    }
  });
});

describe('STEP2 숫자 확인 필수', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.doc = null;
    mockState.uploadSeq = 0;
    mockState.imageThreshold = 13;
    mockState.lowerThreshold = 9;
    localStorage.clear();
  });

  it('PPPP(비활성 J 행) → 해당 있음 고정, 값 드롭다운 [선택/13 이상/9 이하], 사진 영역 없음, 선택 없이 다음 누르면 필수 오류', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'ab_pppp_1', st: 'X' }], []);
    expect(numCheckSelect(container).value).toBe(APPLIES);
    expect(numCheckSelect(container).disabled).toBe(true);
    const valueSel = numCheckValueSelect(container);
    expect(valueSel.disabled).toBe(false);
    expect(valueSel.value).toBe('');
    expect(optionValues(valueSel)).toEqual(['', OVER, UNDER]);
    expect(optionTexts(valueSel)).toEqual(['선택하세요', OVER, UNDER]);
    expect(container.querySelector('input[name="num_check_value"]')).toBeNull();
    expect(imageBlock(container)).toBeNull();
    // '사진 추가' 버튼은 항상 있지만 '이상'을 고르기 전에는 잠겨 있다. '사진 첨부' 라벨은 없다.
    expect(addButton(container).disabled).toBe(true);
    expect(container.textContent).not.toContain('사진 첨부');
    expect(container.textContent).toContain("'13 이상'을(를) 선택하면 사진을 2장 이상 첨부해야 합니다.");

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    const valueGroup = numCheckValueSelect(container).closest('.form-group') as HTMLElement;
    expect(valueGroup.querySelector('.form-error')?.textContent).toBe('필수 입력 항목입니다.');
  });

  it('O 행의 pp 에만 PPPP 가 있어도 해당 있음', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PP01' }], [{ pp: 'PPPP' }]);
    expect(numCheckSelect(container).value).toBe(APPLIES);
  });

  it('"9 이하" 는 사진 영역 없음, "13 이상" 이면 빈 칸 2개가 열리고 사진 2장 미만이면 필수 오류', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await selectValue(container, UNDER);
    expect(imageBlock(container)).toBeNull();
    expect(addButton(container).disabled).toBe(true);

    await selectValue(container, OVER);
    expect(imageBlock(container)).not.toBeNull();
    expect(addButton(container).disabled).toBe(false);
    expect(pasteAreas(container)).toHaveLength(2);
    expect(deleteButtons(container)).toHaveLength(0);
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(requireImageBlock(container).textContent).toContain(REQUIRED_MSG);

    // 1장만 붙여넣으면 사진 1 + 빈 칸 1 — 여전히 2장 미만이라 막힌다.
    await pasteImage(pasteAreas(container)[0]);
    expect(pasteAreas(container)).toHaveLength(2);
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(requireImageBlock(container).textContent).toContain(REQUIRED_MSG);
  });

  it('기준값은 .env(API) 값을 따른다 — 20/5 면 보기는 "20 이상"/"5 이하", 저장값도 숫자 포함', async () => {
    mockState.imageThreshold = 20;
    mockState.lowerThreshold = 5;
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    expect(optionValues(numCheckValueSelect(container))).toEqual(['', '20 이상', '5 이하']);
    await selectValue(container, '20 이상');
    expect(imageBlock(container)).not.toBeNull();
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_value).toBe('20 이상');
  });

  it('사진 칸 폭은 M-shot 칸과 같은 50% 가 최대다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await selectValue(container, OVER);
    const slot = pasteAreas(container)[0].parentElement as HTMLElement;
    expect(slot.style.maxWidth).toBe('calc(50% - 8px)');
  });

  it('붙여넣기·사진 추가·개별 삭제·교체 → 저장값은 해당 여부·"13 이상"·첨부된 사진만', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await selectValue(container, OVER);

    await pasteImage(pasteAreas(container)[0]);
    await pasteImage(pasteAreas(container)[1]);
    expect(pasteAreas(container)).toHaveLength(2);
    await act(async () => { addButton(container).click(); });
    await flushEffects();
    expect(pasteAreas(container)).toHaveLength(3);
    // 사진 2장 + 빈 칸 1개 → 3칸이 최소 2칸보다 많아 빈 칸도 지울 수 있다.
    expect(deleteButtons(container)).toHaveLength(3);

    // 사진 크기가 달라도 같은 높이의 상자에 비율을 유지한 채 맞춘다
    const img = requireImageBlock(container).querySelector('img') as HTMLImageElement;
    expect(img.style.height).toBe('220px');
    expect(img.style.width).toBe('100%');
    expect(img.style.objectFit).toBe('contain');

    let detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check).toBe(APPLIES);
    expect(detail.num_check_value).toBe(OVER);
    expect(detail.num_check_images).toEqual(['mshot_images/n1.png', 'mshot_images/n2.png']);

    // 빈 칸 삭제 → 2칸(사진 2장)만 남고, 빈 칸 삭제 버튼은 사라진다(사진 삭제 버튼만 2개).
    await act(async () => { deleteButtons(container)[2].click(); });
    await flushEffects();
    expect(pasteAreas(container)).toHaveLength(2);
    expect(deleteButtons(container)).toHaveLength(2);

    // 사진 1장 삭제 → 사진 1 + 빈 칸 1(최소 2칸 유지), 빈 칸은 지울 수 없다.
    await act(async () => { deleteButtons(container)[0].click(); });
    await flushEffects();
    expect(pasteAreas(container)).toHaveLength(2);
    expect(deleteButtons(container)).toHaveLength(1);
    await pasteImage(pasteAreas(container)[1]);
    detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_images).toEqual(['mshot_images/n2.png', 'mshot_images/n3.png']);

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(container.textContent).not.toContain(REQUIRED_MSG);
  });

  it('"이상" → "이하" 로 바꾸면 사진 영역이 사라지고 사진도 비워진다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await selectValue(container, OVER);
    await pasteImage(pasteAreas(container)[0]);
    await selectValue(container, UNDER);
    expect(imageBlock(container)).toBeNull();
    expect(addButton(container).disabled).toBe(true);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_value).toBe(UNDER);
    expect(detail.num_check_images).toEqual([]);
  });

  it('PPPP 가 없으면 해당 없음 고정 — 값 드롭다운 잠김, 필수 오류 없음', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PP01' }], [{ pp: 'PP02' }]);
    expect(numCheckSelect(container).value).toBe(NONE);
    expect(numCheckSelect(container).disabled).toBe(true);
    expect(numCheckValueSelect(container).disabled).toBe(true);
    expect(imageBlock(container)).toBeNull();
    expect(addButton(container).disabled).toBe(true);
    // 숫자 확인 항목 때문에 막히지 않고 다음 단계(J-ayer)로 넘어간다.
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(numCheckValueSelect(container)).toBeNull();
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check).toBe(NONE);
    expect(detail.num_check_value).toBe('');
  });

  it('CLONE 은 PPPP 가 있어도 해당 없음', async () => {
    const { container } = await openDocAtMapStep('CLONE', [{ pp: 'PPPP' }], []);
    expect(numCheckSelect(container).value).toBe(NONE);
    expect(numCheckValueSelect(container).disabled).toBe(true);
  });

  it('저장 문서를 다시 열면 해당 여부·값·사진을 그대로 보여주고 다시 저장해도 유지된다', async () => {
    const saved = ['mshot_images/a.png', 'mshot_images/b.png'];
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], {
      num_check: APPLIES, num_check_value: OVER, num_check_images: saved,
    });
    expect(numCheckValueSelect(container).value).toBe(OVER);
    expect(requireImageBlock(container).querySelectorAll('img')).toHaveLength(2);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check).toBe(APPLIES);
    expect(detail.num_check_value).toBe(OVER);
    expect(detail.num_check_images).toEqual(saved);
  });

  it('저장값이 현재 보기에 없으면(기준값이 바뀐 옛 문서) 그 값을 보기로 더 두고 값·사진을 유지한다', async () => {
    const saved = ['mshot_images/a.png', 'mshot_images/b.png'];
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], {
      num_check: APPLIES, num_check_value: '15 이상', num_check_images: saved,
    });
    const valueSel = numCheckValueSelect(container);
    expect(optionValues(valueSel)).toEqual(['', OVER, UNDER, '15 이상']);
    expect(valueSel.value).toBe('15 이상');
    expect(requireImageBlock(container).querySelectorAll('img')).toHaveLength(2);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_value).toBe('15 이상');
    expect(detail.num_check_images).toEqual(saved);
  });

  it('MAP 목적을 NEW → CLONE 으로 바꾸면(확인) 해당 없음 + 값·사진이 비워진다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], {
      num_check: APPLIES, num_check_value: OVER, num_check_images: ['mshot_images/a.png', 'mshot_images/b.png'],
    });
    await act(async () => { buttonWith(container, 'CLONE').click(); });
    await flushEffects();
    await clickConfirm();

    expect(imageBlock(container)).toBeNull();
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.map_type).toBe('CLONE');
    expect(detail.num_check).toBe(NONE);
    expect(detail.num_check_value).toBe('');
    expect(detail.num_check_images).toEqual([]);
  });

  it('요청 목적을 Only MAP 으로 바꿔 J/O 가 비면(MAP 목적 NEW 유지) 해당 없음 + 값·사진이 비워진다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], {
      num_check: APPLIES, num_check_value: OVER, num_check_images: ['mshot_images/a.png', 'mshot_images/b.png'],
    });
    await act(async () => { buttonWith(container, '이전').click(); });
    await flushEffects();
    await act(async () => { buttonWith(container, 'Only MAP').click(); });
    await flushEffects();
    await clickConfirm();
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.request_purpose).toBe('Only MAP');
    expect(detail.map_type).toBe('NEW');
    expect(detail.num_check).toBe(NONE);
    expect(detail.num_check_value).toBe('');
    expect(detail.num_check_images).toEqual([]);
  });
});
