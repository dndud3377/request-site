/**
 * claude 수정 (2026-11-10): STEP2 MAP 정보 '숫자 확인 필수' 테스트 — 드롭다운(해당 없음/해당 있음) + 숫자 + 사진 구조
 *
 * 규칙:
 * - MAP 목적이 NEW 이고, J-ayer·O-ayer 의 모든 행(활성·비활성 무관) 중 pp 에 'PPPP' 가 포함(대소문자 무시)되면
 *   드롭다운이 '해당 있음'으로 고정, 아니면 '해당 없음'으로 고정(드롭다운은 항상 잠김).
 * - '해당 있음'이면 숫자 입력칸이 열리고 필수다. 숫자·소수점 하나만 입력된다(음수 부호·문자 불가).
 * - 숫자가 기준값(.env NUM_CHECK_IMAGE_THRESHOLD, 기본 10) 이상이면 사진 첨부 영역이 열리고 사진 최소 1장 필수.
 * - 사진 칸은 M-shot 칸과 같은 50% 가 최대 폭이다.
 * - 판정이 풀리면 '해당 없음' + 숫자·사진 비움, 숫자가 기준값 미만이 되면 사진 비움. 저장 문서를 다시 열 때는 저장값을 그대로 둔다.
 */
import React from 'react';
import { render, act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { INITIAL_DETAIL, makeJayerRow, makeOayerRow } from './constants';
import { isNumCheckRequired, isNumCheckImageRequired, sanitizeUnsignedDecimal } from './helpers';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const IMAGE_AREA = '사진 첨부';
const REQUIRED_MSG = '사진을 1장 이상 첨부해야 합니다.';
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

const mockState: { captured: unknown | null; doc: unknown | null; uploadSeq: number; threshold: number } = {
  captured: null, doc: null, uploadSeq: 0, threshold: 10,
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
    getNumCheckConfig: () => Promise.resolve({ image_threshold: mockState.threshold }),
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
const numCheckInput = (c: HTMLElement) => c.querySelector('input[name="num_check_value"]') as HTMLInputElement;

/** 사진 첨부 영역(라벨 '사진 첨부'가 들어 있는 form-group) — 없으면 null */
function imageBlock(container: HTMLElement): HTMLElement | null {
  const label = Array.from(container.querySelectorAll('label.form-label'))
    .find((l) => l.textContent?.trim().startsWith(IMAGE_AREA));
  return label ? (label.closest('.form-group') as HTMLElement) : null;
}

function requireImageBlock(container: HTMLElement): HTMLElement {
  const block = imageBlock(container);
  if (!block) throw new Error('사진 첨부 영역이 없다');
  return block;
}

const pasteAreas = (c: HTMLElement) => Array.from(requireImageBlock(c).querySelectorAll('.image-upload-area')) as HTMLElement[];
const deleteButtons = (c: HTMLElement) => Array.from(requireImageBlock(c).querySelectorAll('button'))
  .filter((b) => b.textContent === '삭제') as HTMLButtonElement[];

async function typeValue(container: HTMLElement, value: string) {
  await act(async () => { fireEvent.change(numCheckInput(container), { target: { value } }); });
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

  it('isNumCheckImageRequired: 기준값 이상(같으면 참), 숫자가 아니면 거짓', () => {
    expect(isNumCheckImageRequired('9.99', 10)).toBe(false);
    expect(isNumCheckImageRequired('10', 10)).toBe(true);
    expect(isNumCheckImageRequired('10.5', 10)).toBe(true);
    expect(isNumCheckImageRequired('', 10)).toBe(false);
    expect(isNumCheckImageRequired('.', 10)).toBe(false);
  });

  it('sanitizeUnsignedDecimal: 음수 부호·문자를 지우고 숫자와 소수점 하나만 남긴다', () => {
    expect(sanitizeUnsignedDecimal('-12a.3.4')).toBe('12.34');
    expect(sanitizeUnsignedDecimal('abc')).toBe('');
    expect(sanitizeUnsignedDecimal('007')).toBe('007');
  });
});

describe('STEP2 숫자 확인 필수', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.doc = null;
    mockState.uploadSeq = 0;
    mockState.threshold = 10;
    localStorage.clear();
  });

  it('PPPP(비활성 J 행) → 해당 있음 고정·숫자칸 필수, 사진 영역은 아직 없음, 숫자 없이 다음 누르면 필수 오류', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'ab_pppp_1', st: 'X' }], []);
    expect(numCheckSelect(container).value).toBe(APPLIES);
    expect(numCheckSelect(container).disabled).toBe(true);
    expect(numCheckInput(container).disabled).toBe(false);
    expect(imageBlock(container)).toBeNull();

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    const valueGroup = numCheckInput(container).closest('.form-group') as HTMLElement;
    expect(valueGroup.querySelector('.form-error')?.textContent).toBe('필수 입력 항목입니다.');
  });

  it('O 행의 pp 에만 PPPP 가 있어도 해당 있음', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PP01' }], [{ pp: 'PPPP' }]);
    expect(numCheckSelect(container).value).toBe(APPLIES);
  });

  it('숫자칸은 음수 부호·문자를 받지 않는다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await typeValue(container, '-1a2.3.4');
    expect(numCheckInput(container).value).toBe('12.34');
  });

  it('기본 기준값 10: 9.9 는 사진 영역 없음, 10 이면 사진 영역이 열리고 사진 없이 다음 누르면 필수 오류', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await typeValue(container, '9.9');
    expect(imageBlock(container)).toBeNull();

    await typeValue(container, '10');
    expect(imageBlock(container)).not.toBeNull();
    expect(pasteAreas(container)).toHaveLength(1);
    expect(deleteButtons(container)).toHaveLength(0);
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(requireImageBlock(container).textContent).toContain(REQUIRED_MSG);
  });

  it('기준값은 .env(API) 값을 따른다 — 20 이면 15 는 사진 영역 없음, 20 은 열림', async () => {
    mockState.threshold = 20;
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await typeValue(container, '15');
    expect(imageBlock(container)).toBeNull();
    await typeValue(container, '20');
    expect(imageBlock(container)).not.toBeNull();
    expect(requireImageBlock(container).textContent).toContain('값이 20 이상이라');
  });

  it('사진 칸 폭은 M-shot 칸과 같은 50% 가 최대다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await typeValue(container, '30');
    const slot = pasteAreas(container)[0].parentElement as HTMLElement;
    expect(slot.style.maxWidth).toBe('calc(50% - 8px)');
  });

  it('붙여넣기·사진 추가·개별 삭제·교체 → 저장값은 해당 여부·숫자·첨부된 사진만', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await typeValue(container, '12');

    await pasteImage(pasteAreas(container)[0]);
    await act(async () => { buttonWith(requireImageBlock(container), ADD_BTN).click(); });
    await act(async () => { buttonWith(requireImageBlock(container), ADD_BTN).click(); });
    await flushEffects();
    expect(pasteAreas(container)).toHaveLength(3);
    await pasteImage(pasteAreas(container)[1]);

    let detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check).toBe(APPLIES);
    expect(detail.num_check_value).toBe('12');
    expect(detail.num_check_images).toEqual(['mshot_images/n1.png', 'mshot_images/n2.png']);

    await act(async () => { deleteButtons(container)[0].click(); });
    await flushEffects();
    await act(async () => { deleteButtons(container)[1].click(); });
    await flushEffects();
    expect(pasteAreas(container)).toHaveLength(1);
    await pasteImage(pasteAreas(container)[0]);
    detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_images).toEqual(['mshot_images/n3.png']);

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(container.textContent).not.toContain(REQUIRED_MSG);
  });

  it('숫자를 기준값 미만으로 내리면 사진 영역이 사라지고 사진도 비워진다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);
    await typeValue(container, '12');
    await pasteImage(pasteAreas(container)[0]);
    await typeValue(container, '5');
    expect(imageBlock(container)).toBeNull();
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_value).toBe('5');
    expect(detail.num_check_images).toEqual([]);
  });

  it('PPPP 가 없으면 해당 없음 고정 — 숫자칸 잠김, 필수 오류 없음', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PP01' }], [{ pp: 'PP02' }]);
    expect(numCheckSelect(container).value).toBe(NONE);
    expect(numCheckSelect(container).disabled).toBe(true);
    expect(numCheckInput(container).disabled).toBe(true);
    expect(imageBlock(container)).toBeNull();
    // 숫자 확인 항목 때문에 막히지 않고 다음 단계(J-ayer)로 넘어간다.
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(numCheckInput(container)).toBeNull();
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check).toBe(NONE);
    expect(detail.num_check_value).toBe('');
  });

  it('CLONE 은 PPPP 가 있어도 해당 없음', async () => {
    const { container } = await openDocAtMapStep('CLONE', [{ pp: 'PPPP' }], []);
    expect(numCheckSelect(container).value).toBe(NONE);
    expect(numCheckInput(container).disabled).toBe(true);
  });

  it('저장 문서를 다시 열면 해당 여부·숫자·사진을 그대로 보여주고 다시 저장해도 유지된다', async () => {
    const saved = ['mshot_images/a.png', 'mshot_images/b.png'];
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], {
      num_check: APPLIES, num_check_value: '12', num_check_images: saved,
    });
    expect(numCheckInput(container).value).toBe('12');
    expect(requireImageBlock(container).querySelectorAll('img')).toHaveLength(2);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check).toBe(APPLIES);
    expect(detail.num_check_value).toBe('12');
    expect(detail.num_check_images).toEqual(saved);
  });

  it('MAP 목적을 NEW → CLONE 으로 바꾸면(확인) 해당 없음 + 숫자·사진이 비워진다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], {
      num_check: APPLIES, num_check_value: '12', num_check_images: ['mshot_images/a.png'],
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

  it('요청 목적을 Only MAP 으로 바꿔 J/O 가 비면(MAP 목적 NEW 유지) 해당 없음 + 숫자·사진이 비워진다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], {
      num_check: APPLIES, num_check_value: '12', num_check_images: ['mshot_images/a.png'],
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
