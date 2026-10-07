/**
 * 엑셀 export(MAP 정보 시트) — 예외 구역 행에 합의자 미지정 사유가 화면 칩과 같은 문구로 들어가는지 검증한다.
 * exportMapInfoImage 가 만든 통합 문서를 실제 xlsx 로 다시 읽어 셀 값을 확인한다.
 */
import ExcelJS from 'exceljs';
import i18n from '../i18n';
import { exportMapInfoImage } from './detailExport';
import type { RequestDocument } from '../types';

const reasonPart = (reason: string) => i18n.t('request.sales_agreer_none_reason_suffix', { reason });
const eaText = (reason?: string) =>
  i18n.t('request.change_prefix', { value: '변경 있음' })
  + i18n.t('request.value_suffix_mm', { value: '350' })
  + (reason ? reasonPart(reason) : '');

const makeDoc = (detail: Record<string, unknown>): RequestDocument => ({
  id: 1, title: 'ea-export', requester_name: '이의뢰', requester_email: 'r@company.com',
  requester_department: 'dept', product_name: 'PROD-1', reference_materials: '',
  additional_notes: JSON.stringify({
    detail: { request_purpose: '신규', map_type: 'NEW', map_change: '변경 없음', ea_change: '변경 있음', ea_value: '350', only_prodc: 'No', ...detail },
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
  await exportMapInfoImage(doc, i18n.t.bind(i18n), null);
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

describe('엑셀 export — 예외 구역에 합의자 미지정 사유 포함', () => {
  it('사유가 있으면 예외 구역 값 뒤에 같은 문구로 들어간다', async () => {
    const cells = await exportedCells(makeDoc({ sales_agreer_none_reason: 'XXX' }));
    expect(cells).toContain(eaText('XXX'));
  });

  it('사유가 없으면 종전 문구 그대로다', async () => {
    const cells = await exportedCells(makeDoc({ sales_agreer_none_reason: '' }));
    expect(cells).toContain(eaText());
    expect(cells.some((c) => c.includes(reasonPart('')))).toBe(false);
  });
});
