/**
 * claude 수정 (2026-11-10): STEP2 MAP 정보 '숫자 확인 필수' 사진 증빙 테스트 신설
 *
 * 규칙:
 * - MAP 목적이 NEW 이고, J-ayer·O-ayer 의 모든 행(활성·비활성 무관) 중 pp 에 'PPPP' 가 포함(대소문자 무시)되면 활성.
 * - 활성이면 사진 최소 1장 필수, 비활성이면 회색 잠금(붙여넣기·사진 추가·삭제 불가).
 * - '사진 추가'로 붙여넣기 칸을 늘리고, 칸마다 삭제 버튼이 있다. 빈 칸은 저장하지 않는다.
 * - MAP 목적 변경 등으로 비활성이 되면 사진을 비운다. 저장 문서를 다시 열 때는 저장된 사진을 그대로 둔다.
 */
import React from 'react';
import { render, act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestPage from './index';
import { ToastProvider } from '../../components/Toast';
import i18n from '../../i18n';
import { INITIAL_DETAIL, makeJayerRow, makeOayerRow } from './constants';
import { isNumCheckRequired } from './helpers';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const TITLE = '숫자 확인 필수';
const REQUIRED_MSG = '사진을 1장 이상 첨부해야 합니다.';
const ADD_BTN = '사진 추가';

jest.mock('../../components/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div data-testid="rte">{value}</div>,
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { name: '홍길동', email: 'hong@example.com', department: '개발팀', username: 'hong', role: 'PL' },
  }),
}));

const mockState: { captured: unknown | null; doc: unknown | null; uploadSeq: number } = { captured: null, doc: null, uploadSeq: 0 };

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

/** '숫자 확인 필수' 블록(라벨이 들어 있는 form-group) */
function numCheckBlock(container: HTMLElement): HTMLElement {
  const label = Array.from(container.querySelectorAll('label.form-label'))
    .find((l) => l.textContent?.trim().startsWith(TITLE));
  if (!label) throw new Error('숫자 확인 필수 라벨을 찾지 못했다');
  return label.closest('.form-group') as HTMLElement;
}

function pasteAreas(container: HTMLElement): HTMLElement[] {
  return Array.from(numCheckBlock(container).querySelectorAll('.image-upload-area')) as HTMLElement[];
}

function deleteButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(numCheckBlock(container).querySelectorAll('button'))
    .filter((b) => b.textContent === '삭제') as HTMLButtonElement[];
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

describe('isNumCheckRequired — 활성 판정', () => {
  it('NEW + J 또는 O 의 pp 에 PPPP 포함(대소문자 무시, 비활성 행 포함)이면 참', () => {
    expect(isNumCheckRequired('NEW', [{ pp: 'AB_PPPP_01' }], [])).toBe(true);
    expect(isNumCheckRequired('NEW', [], [{ pp: 'x-pppp' }])).toBe(true);
    expect(isNumCheckRequired('NEW', [{ pp: 'PpPp' }], [])).toBe(true);
    expect(isNumCheckRequired('NEW', [{ pp: 'PPP_P' }], [{ pp: '' }])).toBe(false);
    expect(isNumCheckRequired('NEW', [], [])).toBe(false);
  });

  it('NEW 가 아니면 PPPP 가 있어도 거짓', () => {
    ['CLONE', 'EXISTING', '삭제', ''].forEach((mt) => {
      expect(isNumCheckRequired(mt, [{ pp: 'PPPP' }], [{ pp: 'PPPP' }])).toBe(false);
    });
  });
});

describe('STEP2 숫자 확인 필수 사진 증빙', () => {
  beforeEach(() => {
    mockState.captured = null;
    mockState.doc = null;
    mockState.uploadSeq = 0;
    localStorage.clear();
  });

  it('NEW + 비활성(ST=X) J 행의 pp 에 pppp → 활성(필수 표시) · 사진 없이 다음 누르면 필수 오류', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'ab_pppp_1', st: 'X' }], []);
    const block = numCheckBlock(container);
    expect(block.querySelector('.required')).not.toBeNull();
    expect(buttonWith(block, ADD_BTN).disabled).toBe(false);
    expect(pasteAreas(container)).toHaveLength(1);
    // 사진이 없을 때 남는 마지막 빈 칸은 지울 수 없다.
    expect(deleteButtons(container)).toHaveLength(0);

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(numCheckBlock(container).textContent).toContain(REQUIRED_MSG);
  });

  it('O 행의 pp 에만 PPPP 가 있어도 활성', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PP01' }], [{ pp: 'PPPP' }]);
    expect(numCheckBlock(container).querySelector('.required')).not.toBeNull();
  });

  it('붙여넣기·사진 추가·개별 삭제 → 저장값은 첨부된 사진만(빈 칸 제외)', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], []);

    await pasteImage(pasteAreas(container)[0]);
    expect(pasteAreas(container)).toHaveLength(1);
    expect(numCheckBlock(container).querySelectorAll('img')).toHaveLength(1);

    // 사진 추가 → 빈 칸 2개 늘리고 하나에만 붙여넣는다.
    await act(async () => { buttonWith(container, ADD_BTN).click(); });
    await act(async () => { buttonWith(container, ADD_BTN).click(); });
    await flushEffects();
    expect(pasteAreas(container)).toHaveLength(3);
    await pasteImage(pasteAreas(container)[1]);
    expect(numCheckBlock(container).querySelectorAll('img')).toHaveLength(2);
    expect(pasteAreas(container)).toHaveLength(3);

    let detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_images).toEqual(['mshot_images/n1.png', 'mshot_images/n2.png']);

    // 첫 사진 삭제 → 두 번째 사진만 남는다. 빈 칸 삭제 → 칸 수 감소.
    await act(async () => { deleteButtons(container)[0].click(); });
    await flushEffects();
    await act(async () => { deleteButtons(container)[1].click(); });
    await flushEffects();
    expect(pasteAreas(container)).toHaveLength(1);
    detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_images).toEqual(['mshot_images/n2.png']);

    // 첨부된 사진 칸에 다시 붙여넣으면 그 사진을 교체한다.
    await pasteImage(pasteAreas(container)[0]);
    detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_images).toEqual(['mshot_images/n3.png']);

    // 사진이 있으면 필수 오류가 나지 않는다.
    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(container.textContent).not.toContain(REQUIRED_MSG);
  });

  it('PPPP 가 없으면 회색 잠금 — 사진 추가 비활성, 붙여넣어도 반영되지 않고 필수 오류 없음', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PP01' }], [{ pp: 'PP02' }]);
    const block = numCheckBlock(container);
    expect(block.querySelector('.required')).toBeNull();
    expect(buttonWith(block, ADD_BTN).disabled).toBe(true);

    await pasteImage(pasteAreas(container)[0]);
    expect(numCheckBlock(container).querySelectorAll('img')).toHaveLength(0);

    await act(async () => { buttonWith(container, '다음').click(); });
    await flushEffects();
    expect(container.textContent).not.toContain(REQUIRED_MSG);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_images).toEqual([]);
  });

  it('CLONE 은 PPPP 가 있어도 회색 잠금', async () => {
    const { container } = await openDocAtMapStep('CLONE', [{ pp: 'PPPP' }], []);
    expect(numCheckBlock(container).querySelector('.required')).toBeNull();
    expect(buttonWith(numCheckBlock(container), ADD_BTN).disabled).toBe(true);
  });

  it('저장 문서를 다시 열면 저장된 사진을 그대로 보여주고 다시 저장해도 유지된다', async () => {
    const saved = ['mshot_images/a.png', 'mshot_images/b.png'];
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], { num_check_images: saved });
    expect(numCheckBlock(container).querySelectorAll('img')).toHaveLength(2);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.num_check_images).toEqual(saved);
  });

  it('MAP 목적을 NEW → CLONE 으로 바꾸면(확인) 사진이 비워진다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], { num_check_images: ['mshot_images/a.png'] });
    await act(async () => { buttonWith(container, 'CLONE').click(); });
    await flushEffects();
    const confirmBtn = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === '확인').pop();
    if (!confirmBtn) throw new Error('확인 버튼을 찾지 못했다');
    await act(async () => { (confirmBtn as HTMLButtonElement).click(); });
    await flushEffects();

    expect(numCheckBlock(container).querySelectorAll('img')).toHaveLength(0);
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.map_type).toBe('CLONE');
    expect(detail.num_check_images).toEqual([]);
  });

  it('요청 목적을 Only MAP 으로 바꿔 J/O 가 비면(MAP 목적 NEW 유지) 조건이 풀려 사진이 비워진다', async () => {
    const { container } = await openDocAtMapStep('NEW', [{ pp: 'PPPP' }], [], { num_check_images: ['mshot_images/a.png'] });
    await act(async () => { buttonWith(container, '이전').click(); });
    await flushEffects();
    await act(async () => { buttonWith(container, 'Only MAP').click(); });
    await flushEffects();
    const confirmBtn = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === '확인').pop();
    if (confirmBtn) {
      await act(async () => { (confirmBtn as HTMLButtonElement).click(); });
      await flushEffects();
    }
    const detail = await saveDraftAndCaptureDetail();
    expect(detail.request_purpose).toBe('Only MAP');
    expect(detail.map_type).toBe('NEW');
    expect(detail.num_check_images).toEqual([]);
  });
});
