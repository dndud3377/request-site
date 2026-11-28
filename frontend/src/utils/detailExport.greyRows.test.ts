/**
 * claude 수정 (2026-11-28): J/O-ayer export 회색(기등록·비활성) 행 칠하기 회귀 테스트.
 * 예전에는 row.eachCell 이 값이 없는 칸(2026-09-30 이전 행의 Layer·ID 등)을 건너뛰어, 화면은 행 전체가 회색인데
 * 엑셀은 그 칸만 흰색이었다. 열 수만큼 직접 칠하도록 바꾼 뒤, 가운데·끝 빈 칸까지 회색인지와
 * 활성 행은 예전과 같이 회색이 아닌지를 실제 xlsx 로 다시 읽어 확인한다.
 */
import ExcelJS from 'exceljs';
import i18n from '../i18n';
import { exportJayer, exportOayer } from './detailExport';
import type { RequestDocument } from '../types';

const GREY_ARGB = 'FFe5e7eb';

/** Layer·ID 키가 아예 없는 예전 X·미진행 행 + 정상 활성 행 + 기등록 행 */
const J_ROWS = [
  { id: 'a', updated: '20260801', process_id: 'PR', sp: 'SP1', sd: 'SD1', layerid: 'L1', pp: 'PP1', st: 'O', new_or_copy: '신규', product_name: 'P', step: '1', item_id: 'I1' },
  { id: 'b', updated: '20260801', process_id: 'PR', sp: 'SP2', sd: 'SD2', pp: 'PP2', st: 'X', new_or_copy: '미진행', product_name: '', step: '' },
  { id: 'c', updated: '20260801', process_id: 'PR', sp: 'SP3', sd: 'SD3', layerid: 'L3', pp: 'PP3', st: 'O', new_or_copy: '기등록', product_name: 'P', step: '3', item_id: 'I3' },
];
const O_ROWS = [
  { id: 'oa', updated: '20260801', process_id: 'PR', sp: 'SP1', sd: 'SD1', layerid: 'L1', pp: 'OV1', st: 'O', new_or_copy: '신규', product_name: 'P', step: '1' },
  { id: 'ob', updated: '20260801', process_id: 'PR', sp: 'SP2', sd: 'SD2', pp: 'OV2', st: 'X', new_or_copy: '미진행', product_name: '' },
];

const makeDoc = (): RequestDocument => ({
  id: 1, title: 'grey-rows', requester_name: '이의뢰', requester_email: 'r@company.com',
  requester_department: 'dept', product_name: 'PROD-1', reference_materials: '',
  additional_notes: JSON.stringify({ detail: { request_purpose: '신규', map_type: 'NEW' }, jayerRows: J_ROWS, oayerRows: O_ROWS, bbRows: [], history: [] }),
  status: 'under_review', production_date: null, created_at: '', updated_at: '', submitted_at: '', approval_steps: [],
} as unknown as RequestDocument);

/** export 가 내려받으려던 xlsx 의 첫 시트를 다시 읽는다. */
async function captureSheet(run: () => Promise<void>): Promise<ExcelJS.Worksheet> {
  let captured: Blob | null = null;
  URL.createObjectURL = (b: Blob | MediaSource) => { captured = b as Blob; return 'blob:test'; };
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
  await run();
  if (!captured) throw new Error('export 가 xlsx 를 만들지 않았다');
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(captured as Blob);
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0];
}

/** 시트 n번째 데이터 행(머리글 다음 1부터)의 칸별 배경색(argb, 없으면 '') */
const fillsOf = (ws: ExcelJS.Worksheet, dataRow: number, cols: number): string[] =>
  Array.from({ length: cols }, (_, i) => {
    const fill = ws.getRow(dataRow + 1).getCell(i + 1).fill as ExcelJS.FillPattern | undefined;
    return fill && fill.type === 'pattern' ? String(fill.fgColor?.argb ?? '') : '';
  });

beforeEach(async () => { await i18n.changeLanguage('ko'); });

describe('J/O-ayer export — 회색 행은 값이 없는 칸까지 회색', () => {
  it('JOB 시트: Layer·ID 가 없는 X 행도 11칸 모두 회색, 기등록 행도 모두 회색', async () => {
    const ws = await captureSheet(() => exportJayer(makeDoc(), i18n.t.bind(i18n)));
    const cols = ws.columns.length;
    expect(cols).toBe(11);
    expect(fillsOf(ws, 2, cols)).toEqual(Array(cols).fill(GREY_ARGB));
    expect(fillsOf(ws, 3, cols)).toEqual(Array(cols).fill(GREY_ARGB));
  });

  it('JOB 시트: 활성 행은 회색이 아니다(빈 칸에 색이 새로 생기지 않는다)', async () => {
    const ws = await captureSheet(() => exportJayer(makeDoc(), i18n.t.bind(i18n)));
    expect(fillsOf(ws, 1, ws.columns.length)).not.toContain(GREY_ARGB);
  });

  it('OVL 시트: Layer·STEP 이 없는 X 행도 모든 칸 회색', async () => {
    const ws = await captureSheet(() => exportOayer(makeDoc(), i18n.t.bind(i18n)));
    const cols = ws.columns.length;
    expect(fillsOf(ws, 2, cols)).toEqual(Array(cols).fill(GREY_ARGB));
    expect(fillsOf(ws, 1, cols)).not.toContain(GREY_ARGB);
  });
});
