import ExcelJS from 'exceljs';
import type { TFunction } from 'i18next';
import { RequestDocument, DetailFormState, JayerRow, OayerRow, BbTableRow } from '../types';
import { ST_CELL_COLOR } from './stCellColor';
import { bbTabColor } from './bbTabColors';
import { VALIDATION_CELL_COLOR } from '../pages/RequestPage/constants';
import { isValidationKeywordRow } from '../pages/RequestPage/helpers';

/**
 * 의뢰 상세보기(PagedDetailView)의 엑셀 export 로직 모음.
 * 시트 하나씩 만드는 add*Sheet 함수는 export* 단일 버튼과 exportAll(전체 export) 양쪽에서 함께 쓴다.
 *
 * 상세 정보/MAP 정보 시트는 데이터를 다시 조합하지 않고, 화면(전체화면 모드)을 그대로 이미지로
 * 캡처해 시트에 박아 넣는다 — 캡처 자체는 DOM 접근이 필요해 PagedDetailView 쪽에서 하고,
 * 이 파일은 캡처된 이미지(ScreenshotCapture)를 받아 시트에 넣는 부분만 담당한다.
 */

interface ParsedDoc {
  detail: Partial<DetailFormState>;
  jayer: JayerRow[];
  oayer: OayerRow[];
  bb: BbTableRow[];
}

function parseDoc(doc: RequestDocument): ParsedDoc {
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    return {
      detail: parsed?.detail ?? {},
      jayer: parsed?.jayerRows ?? [],
      oayer: parsed?.oayerRows ?? [],
      bb: parsed?.bbRows ?? [],
    };
  } catch {
    return { detail: {}, jayer: [], oayer: [], bb: [] };
  }
}

function getNowString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function applyFill(cell: ExcelJS.Cell, hex: string | undefined): void {
  if (!hex) return;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex.replace('#', '')}` } };
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== 표 데이터 시트(JOB/OVL/BB) =====

function addJobSheet(wb: ExcelJS.Workbook, t: TFunction, jayer: JayerRow[]): void {
  const ws = wb.addWorksheet('JOB');
  ws.columns = [
    { header: t('request.col_updated_date'), key: 'updated', width: 16 },
    { header: t('request.process_id'), key: 'process_id', width: 14 },
    { header: t('request.col_sp'), key: 'sp', width: 10 },
    { header: t('request.col_sd'), key: 'sd', width: 10 },
    { header: t('request.col_pp'), key: 'pp', width: 14 },
    { header: t('request.col_st'), key: 'st', width: 8 },
    { header: t('request.col_new_or_copy'), key: 'new_or_copy', width: 10 },
    { header: t('request.col_product_name'), key: 'product_name', width: 16 },
    { header: t('request.col_step'), key: 'step', width: 10 },
    { header: t('request.col_item_id'), key: 'item_id', width: 12 },
  ];
  jayer.filter((r) => !r.disabled).forEach((r) => {
    const row = ws.addRow({
      updated: r.updated ?? '', process_id: r.process_id, sp: r.sp, sd: r.sd,
      pp: r.pp, st: r.st, new_or_copy: r.new_or_copy, product_name: r.product_name,
      step: r.step, item_id: r.item_id,
    });
    const reg = r.new_or_copy === '기등록';
    row.eachCell((cell, col) => {
      if (reg) { applyFill(cell, '#e5e7eb'); return; }
      if (col === 5) applyFill(cell, isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined);
      else if (col === 6) applyFill(cell, ST_CELL_COLOR[r.st]);
      else if (col === 7) applyFill(cell, r.new_or_copy === '차용' ? '#eff6ff' : undefined);
    });
  });
}

function addOvlSheet(wb: ExcelJS.Workbook, t: TFunction, oayer: OayerRow[]): void {
  const ws = wb.addWorksheet('OVL');
  ws.columns = [
    { header: t('request.col_updated_date'), key: 'updated', width: 16 },
    { header: t('request.process_id'), key: 'process_id', width: 14 },
    { header: t('request.col_sp'), key: 'sp', width: 10 },
    { header: t('request.col_sd'), key: 'sd', width: 10 },
    { header: t('request.col_layer'), key: 'layerid', width: 10 },
    { header: t('request.col_pp'), key: 'pp', width: 14 },
    { header: t('request.col_st'), key: 'st', width: 8 },
    { header: t('request.col_new_or_copy'), key: 'new_or_copy', width: 10 },
    { header: t('request.col_product_name'), key: 'product_name', width: 16 },
    { header: t('request.col_step'), key: 'step', width: 10 },
  ];
  oayer.filter((r) => !r.disabled).forEach((r) => {
    const row = ws.addRow({
      updated: r.updated ?? '', process_id: r.process_id, sp: r.sp, sd: r.sd,
      layerid: r.layerid, pp: r.pp, st: r.st, new_or_copy: r.new_or_copy,
      product_name: r.product_name, step: r.step,
    });
    const reg = r.new_or_copy === '기등록';
    row.eachCell((cell, col) => {
      if (reg) { applyFill(cell, '#e5e7eb'); return; }
      if (col === 6) applyFill(cell, isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined);
      else if (col === 7) applyFill(cell, ST_CELL_COLOR[r.st]);
      else if (col === 8) applyFill(cell, r.new_or_copy === '차용' ? '#eff6ff' : undefined);
    });
  });
}

function addBbSheet(wb: ExcelJS.Workbook, t: TFunction, detail: Partial<DetailFormState>, bb: BbTableRow[]): void {
  const bbEntryIds: string[] = Array.isArray(detail?.bb_entries)
    ? (detail.bb_entries as { id?: string }[]).map((e) => e.id ?? '')
    : [];
  const multiTab = bbEntryIds.length >= 2;
  const colorIndexOf = (r: BbTableRow): number =>
    r.entryId != null ? bbEntryIds.indexOf(r.entryId) : (r.entryIdx ?? -1);
  const ws = wb.addWorksheet('BB');
  ws.columns = [
    { header: t('request.process_id'), key: 'process_id', width: 14 },
    { header: t('request.col_sp'), key: 'ss', width: 10 },
    { header: t('request.col_sd'), key: 'sd', width: 10 },
    { header: t('request.col_bb_process_id'), key: 'bb_process_id', width: 14 },
    { header: t('request.col_bb_partid'), key: 'bb_name', width: 16 },
    { header: t('request.col_bb_layer'), key: 'bb_layer', width: 10 },
    { header: t('request.col_bb_stepseq'), key: 'bb_ss', width: 10 },
    { header: t('request.col_bb_step'), key: 'bb_step', width: 10 },
    { header: t('request.col_remark'), key: 'remark', width: 16 },
  ];
  bb.forEach((r) => {
    const row = ws.addRow({
      process_id: r.process_id, ss: r.ss, sd: r.sd, bb_process_id: r.bb_process_id,
      bb_name: r.bb_name, bb_layer: r.bb_layer, bb_ss: r.bb_ss, bb_step: r.bb_step, remark: r.remark,
    });
    if (multiTab && colorIndexOf(r) >= 0) {
      applyFill(row.getCell(5), bbTabColor(colorIndexOf(r)));
    }
  });
}

// ===== 정보(key-value) 시트 공용 빌더 — O-ayer 정보 =====

type InfoBlock =
  | { kind: 'kv'; label: string; value: string }
  | { kind: 'table'; label: string; headers: string[]; rows: string[][] };

function addInfoSheet(wb: ExcelJS.Workbook, t: TFunction, sheetName: string, blocks: InfoBlock[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(sheetName);
  ws.getColumn(1).width = 26;
  for (let c = 2; c <= 8; c += 1) ws.getColumn(c).width = 20;

  const itemLabel = t('request.export_col_item');
  const valueLabel = t('request.export_col_value');
  const head = ws.addRow([itemLabel, valueLabel]);
  head.eachCell((cell) => { cell.font = { bold: true }; applyFill(cell, '#e5e7eb'); });

  blocks.forEach((b) => {
    if (b.kind === 'kv') {
      const row = ws.addRow([b.label, b.value]);
      row.getCell(1).font = { bold: true };
      row.getCell(1).alignment = { vertical: 'top', wrapText: true };
      row.getCell(2).alignment = { vertical: 'top', wrapText: true };
      return;
    }
    // 라벨을 표 헤더와 같은 행(칼럼 A)에 두어, 다른 항목처럼 라벨 바로 옆(같은 행)에
    // 내용이 바로 보이도록 한다 — 라벨만 있는 행을 따로 두면 값이 한 줄 아래로 밀려 보인다.
    const headRow = ws.addRow([b.label, ...b.headers]);
    headRow.getCell(1).font = { bold: true };
    headRow.getCell(1).alignment = { vertical: 'top', wrapText: true };
    headRow.eachCell((cell, col) => { if (col > 1) { cell.font = { bold: true }; applyFill(cell, '#f3f4f6'); } });
    b.rows.forEach((r) => ws.addRow(['', ...r]));
  });
  return ws;
}

function addOvlInfoSheet(wb: ExcelJS.Workbook, t: TFunction, detail: Partial<DetailFormState>): void {
  const blocks: InfoBlock[] = [];
  blocks.push({ kind: 'kv', label: t('request.partial_shot'), value: detail.partial_shot || '-' });
  if ((detail.tbvtlv_thickness ?? '') !== '') {
    blocks.push({ kind: 'kv', label: t('request.tbvtlv_thickness'), value: detail.tbvtlv_thickness as string });
  }
  const entries = detail.tbvtlv_entries ?? [];
  if (entries.length > 0) {
    entries.forEach((entry) => {
      const label = `${t('request.tbvtlv')} — ${t('request.tbvtlv_sd_select')}: ${entry.sds.join(', ')}`;
      if (entry.noteRows && entry.noteRows.length > 0) {
        const rows = entry.noteRows.map((r, i) => [String(i + 1), r.x || '-', r.y || '-', r.used]);
        blocks.push({ kind: 'table', label, headers: [t('request.tbvtlv_no'), t('request.tbvtlv_x'), t('request.tbvtlv_y'), t('request.tbvtlv_used')], rows });
      } else {
        blocks.push({ kind: 'kv', label, value: entry.note || '-' });
      }
    });
  } else {
    blocks.push({ kind: 'kv', label: t('request.tbvtlv'), value: '-' });
  }
  addInfoSheet(wb, t, t('request.ovl_tab_info'), blocks);
}

// ===== 화면 캡처 이미지 시트 — 상세 정보 / MAP 정보 =====
// 캡처(html2canvas) 자체는 DOM 이 필요해 PagedDetailView 에서 하고, 여기서는 캡처된
// PNG 바이트를 받아 시트 하나에 그대로 박아 넣기만 한다.

export interface ScreenshotCapture {
  /** PNG 바이트(캔버스 toBlob 결과) */
  buffer: ArrayBuffer;
  /** 캡처 시점의 원본 픽셀 크기 — 엑셀에 넣을 때 비율 유지 스케일 계산에 쓴다. */
  width: number;
  height: number;
}

// 시트 안에서 보기 편하도록 캡처 이미지의 최대 폭을 제한한다(원본 비율 유지, 확대는 하지 않음).
const SCREENSHOT_MAX_WIDTH_PX = 1600;

function addScreenshotSheet(wb: ExcelJS.Workbook, sheetName: string, screenshot: ScreenshotCapture | null, failedMessage: string): void {
  const ws = wb.addWorksheet(sheetName);
  if (!screenshot) {
    ws.addRow([failedMessage]);
    return;
  }
  const scale = screenshot.width > SCREENSHOT_MAX_WIDTH_PX ? SCREENSHOT_MAX_WIDTH_PX / screenshot.width : 1;
  const width = Math.round(screenshot.width * scale);
  const height = Math.round(screenshot.height * scale);
  const imageId = wb.addImage({ buffer: screenshot.buffer as never, extension: 'png' });
  ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width, height } });
}

// ===== 단일 버튼 export =====

export async function exportJayer(doc: RequestDocument, t: TFunction): Promise<void> {
  const { jayer } = parseDoc(doc);
  const wb = new ExcelJS.Workbook();
  addJobSheet(wb, t, jayer);
  await downloadWorkbook(wb, `${doc.title}_JOB_${getNowString()}.xlsx`);
}

export async function exportOayer(doc: RequestDocument, t: TFunction): Promise<void> {
  const { detail, oayer } = parseDoc(doc);
  const wb = new ExcelJS.Workbook();
  addOvlSheet(wb, t, oayer);
  addOvlInfoSheet(wb, t, detail);
  await downloadWorkbook(wb, `${doc.title}_OVL_${getNowString()}.xlsx`);
}

export async function exportBb(doc: RequestDocument, t: TFunction): Promise<void> {
  const { detail, bb } = parseDoc(doc);
  const wb = new ExcelJS.Workbook();
  addBbSheet(wb, t, detail, bb);
  await downloadWorkbook(wb, `${doc.title}_BB_${getNowString()}.xlsx`);
}

export async function exportDetailInfoImage(doc: RequestDocument, t: TFunction, screenshot: ScreenshotCapture | null): Promise<void> {
  const wb = new ExcelJS.Workbook();
  addScreenshotSheet(wb, t('request.section_detail'), screenshot, t('request.export_capture_failed'));
  await downloadWorkbook(wb, `${doc.title}_${t('request.section_detail')}_${getNowString()}.xlsx`);
}

export async function exportMapInfoImage(doc: RequestDocument, t: TFunction, screenshot: ScreenshotCapture | null): Promise<void> {
  const wb = new ExcelJS.Workbook();
  addScreenshotSheet(wb, t('request.section_map'), screenshot, t('request.export_capture_failed'));
  await downloadWorkbook(wb, `${doc.title}_${t('request.section_map')}_${getNowString()}.xlsx`);
}

export interface ExportAllScreenshots {
  detail: ScreenshotCapture | null;
  map: ScreenshotCapture | null;
}

/**
 * 결재 경로를 제외한 모든 sector(상세 정보/MAP 정보/JOB/OVL/정보/BB)를 시트별로 나눠 한 파일에 담는다.
 * 상세 정보/MAP 정보는 호출부(PagedDetailView)가 미리 캡처해 넘긴 화면 이미지를 그대로 시트에 넣는다.
 */
export async function exportAll(doc: RequestDocument, t: TFunction, screenshots: ExportAllScreenshots): Promise<void> {
  const { detail, jayer, oayer, bb } = parseDoc(doc);
  const isAdiCdChange = detail.request_purpose === 'ADI CD 변경';
  const wb = new ExcelJS.Workbook();
  addScreenshotSheet(wb, t('request.section_detail'), screenshots.detail, t('request.export_capture_failed'));
  if (!isAdiCdChange) addScreenshotSheet(wb, t('request.section_map'), screenshots.map, t('request.export_capture_failed'));
  addJobSheet(wb, t, jayer);
  addOvlSheet(wb, t, oayer);
  addOvlInfoSheet(wb, t, detail);
  addBbSheet(wb, t, detail, bb);
  await downloadWorkbook(wb, `${doc.title}_전체_${getNowString()}.xlsx`);
}
