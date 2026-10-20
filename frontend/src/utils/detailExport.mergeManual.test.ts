/**
 * claude 수정 (2026-10-19): 엑셀 export(의뢰 상세 시트) — 변경전/변경후 표 머리글.
 * - 참조 요청서 '없음' 문서는 작성 화면·상세보기와 같이 layer 컬럼을 빼고 머리글을 '변경전'/'변경후'로 쓴다.
 * - '있음' 문서는 종전대로 layer 컬럼과 '변경전 (참조 요청서)' 머리글을 쓴다.
 * - ADI CD 변경 표 머리글은 참조 요청서 개념이 없어 '변경전'/'변경후'를 쓴다.
 * exportDetailInfoImage 가 만든 통합 문서를 실제 xlsx 로 다시 읽어 셀 값을 확인한다.
 */
import ExcelJS from 'exceljs';
import i18n from '../i18n';
import { exportDetailInfoImage } from './detailExport';
import { ADI_CD_CHANGE_PURPOSE, ADI_CD_STEP_ID_LABEL } from '../pages/RequestPage/constants';
import type { RequestDocument } from '../types';

beforeAll(async () => { await i18n.changeLanguage('ko'); });

const side = (pp: string) => ({ process_id: 'PROC_X1', sp: 'SP01', sd: 'SD01', pp, layerid: 'L01' });
const PAIR = { id: 'p1', table: 'J', beforeId: null, before: side('TEST1_OUT'), afterId: null, after: side('TEST1_IN'), kind: 'changed' };

const makeDoc = (detail: Record<string, unknown>): RequestDocument => ({
  id: 1, title: 'merge-export', requester_name: '이의뢰', requester_email: 'r@company.com',
  requester_department: 'dept', product_name: 'PROD-1', reference_materials: '',
  additional_notes: JSON.stringify({
    detail: { request_purpose: '신규', map_type: 'NEW', only_prodc: 'No', ...detail },
    history: [],
  }),
  status: 'under_review', production_date: null, created_at: '', updated_at: '', submitted_at: '', approval_steps: [],
} as RequestDocument);

/** export 가 내려받으려던 xlsx 의 모든 셀 문자열을 모은다. */
async function exportedCells(doc: RequestDocument): Promise<string[]> {
  let captured: Blob | null = null;
  URL.createObjectURL = (b: Blob | MediaSource) => { captured = b as Blob; return 'blob:test'; };
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
  await exportDetailInfoImage(doc, i18n.t.bind(i18n), null);
  if (!captured) throw new Error('export 가 xlsx 를 만들지 않았다');
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(captured as Blob);
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const cells: string[] = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? '')))));
  return cells;
}

type BaColKey = 'request.ba_before_col' | 'request.ba_after_col' | 'request.ba_before_col_manual' | 'request.ba_after_col_manual';
const layerHeader = (col: BaColKey) => `${i18n.t('request.col_layer')}(${i18n.t(col)})`;
const ppHeader = (col: BaColKey) => `${i18n.t('request.col_pp')}(${i18n.t(col)})`;

describe('엑셀 export — 변경전/변경후 표 머리글', () => {
  it("'없음' 문서는 layer 컬럼 없이 '변경전'/'변경후' 머리글을 쓴다", async () => {
    const cells = await exportedCells(makeDoc({ merge_ref_mode: 'none', merge_pairs: [PAIR] }));
    expect(cells).toContain(ppHeader('request.ba_before_col_manual'));
    expect(cells).toContain(ppHeader('request.ba_after_col_manual'));
    expect(cells).not.toContain(layerHeader('request.ba_before_col_manual'));
    expect(cells.some((c) => c.includes(i18n.t('request.ba_before_col')))).toBe(false);
    expect(cells).not.toContain('L01');
  });

  it("'있음' 문서는 종전대로 layer 컬럼과 '(참조 요청서)' 머리글을 쓴다", async () => {
    const cells = await exportedCells(makeDoc({ merge_ref_mode: 'ref', merge_pairs: [PAIR] }));
    expect(cells).toContain(ppHeader('request.ba_before_col'));
    expect(cells).toContain(layerHeader('request.ba_before_col'));
    expect(cells).toContain(layerHeader('request.ba_after_col'));
    expect(cells).toContain('L01');
  });

  it("ADI CD 변경 표 머리글은 '변경전'/'변경후'를 쓴다", async () => {
    const cells = await exportedCells(makeDoc({
      request_purpose: ADI_CD_CHANGE_PURPOSE,
      adi_cd_before: [{ id: 'b1', step_id: 'S1', step_desc: 'D1' }],
      adi_cd_after: [{ id: 'a1', step_id: 'S2', step_desc: 'D2' }],
    }));
    expect(cells).toContain(`${ADI_CD_STEP_ID_LABEL}(${i18n.t('request.ba_before_col_manual')})`);
    expect(cells).toContain(`${ADI_CD_STEP_ID_LABEL}(${i18n.t('request.ba_after_col_manual')})`);
    expect(cells.some((c) => c.includes(i18n.t('request.ba_before_col')))).toBe(false);
  });
});
