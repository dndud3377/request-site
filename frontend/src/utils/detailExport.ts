import ExcelJS from 'exceljs';
import type { TFunction } from 'i18next';
import { RequestDocument, DetailFormState, JayerRow, OayerRow, BbTableRow, MergeRowInfo } from '../types';
import { ST_CELL_COLOR } from './stCellColor';
import { bbTabColor } from './bbTabColors';
import { VALIDATION_CELL_COLOR, isMapDeleteEditType, ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL } from '../pages/RequestPage/constants';
import { isValidationKeywordRow, deriveMergeKind, balanceAdiCdRows } from '../pages/RequestPage/helpers';

/**
 * 의뢰 상세보기(PagedDetailView)의 엑셀 export 로직 모음.
 * 시트 하나씩 만드는 add*Sheet 함수는 export* 단일 버튼과 exportAll(전체 export) 양쪽에서 함께 쓴다.
 *
 * 상세 정보/MAP 정보는 시트 2장을 함께 담는다 — 화면(전체화면 모드)을 그대로 캡처한 이미지 시트
 * (캡처 자체는 DOM 접근이 필요해 PagedDetailView 쪽에서 하고, 이 파일은 캡처된 이미지를 받아
 * 시트에 넣는 부분만 담당한다) + 항목/값으로 정리한 텍스트 시트.
 */

// 지도 편차/C가문 판정에 쓰는 저장값 — PagedDetailView 와 동일한 원본 문자열.
const MAP_NO_CHANGE = '변경 없음';
const PRODC_YES = 'Yes';

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

/** RichTextEditor 가 만든 HTML(map_change_reason 등)을 엑셀 셀에 넣을 수 있는 일반 텍스트로 바꾼다. */
function htmlToPlainText(html: string | undefined | null): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
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

// ===== 정보(key-value) 시트 공용 빌더 — 상세 정보 / MAP 정보 / O-ayer 정보 =====

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

/** 의뢰 목적 — other_purpose 는 배열(신규)이며, 구버전 문서는 문자열일 수 있어 양쪽 모두 처리한다. */
function buildPurposeValue(d: Partial<DetailFormState>): string {
  const opRaw = d.other_purpose as unknown as string[] | string | undefined;
  const otherPurposeText = Array.isArray(opRaw) ? opRaw.map((o) => `[${o}]`).join('') : (opRaw || '');
  if (!d.request_purpose) return '-';
  return otherPurposeText ? `${d.request_purpose}(${otherPurposeText})` : d.request_purpose;
}

/** 지도 편차 — C가문(상/하판 리전별)인지 여부를 스냅샷 자체의 only_prodc 로 판별한다. */
function buildMapValue(d: Partial<DetailFormState>, t: TFunction): string {
  if (d.only_prodc === PRODC_YES) {
    const regionLine = (region: 'top' | 'bottom'): string => {
      const label = t(region === 'top' ? 'request.prodc_top' : 'request.prodc_bottom');
      if (d[`map_change_${region}`] === MAP_NO_CHANGE) return `[${label}] ${t('request.map_no_change')}`;
      const x = d[`map_value_x_${region}`];
      const y = d[`map_value_y_${region}`];
      return `[${label}] X: ${x ? `${x}um` : '-'} / Y: ${y ? `${y}um` : '-'}`;
    };
    const reasonPart = d.map_reason ? t('request.reason_suffix', { reason: d.map_reason }) : '';
    return `${regionLine('top')}\n${regionLine('bottom')}${reasonPart}`;
  }
  if (!d.map_change) return '';
  return t('request.change_prefix', { value: d.map_change })
    + (d.map_value_x ? ` / X: ${d.map_value_x}um` : '')
    + (d.map_value_y ? ` / Y: ${d.map_value_y}um` : '')
    + (d.map_reason ? t('request.reason_suffix', { reason: d.map_reason }) : '');
}

function buildEaValue(d: Partial<DetailFormState>, t: TFunction): string {
  if (!d.ea_change) return '';
  return t('request.change_prefix', { value: d.ea_change }) + (d.ea_value ? t('request.value_suffix_mm', { value: d.ea_value }) : '');
}

function buildBbValue(d: Partial<DetailFormState>, t: TFunction): string {
  const entries = d.bb_entries;
  if (!Array.isArray(entries) || entries.length === 0) return '-';
  return entries
    .map((e, i) => (
      `[${i + 1}] ${t('request.bb_ref_line')}: ${e.location || '-'}`
      + ` / ${t('request.bb_ref_part_id')}: ${e.product || '-'}`
      + ` / ${t('request.bb_ref_process_id')}: ${e.process_id || '-'}`
    ))
    .join('\n');
}

function prodcScopeLabel(d: Partial<DetailFormState>, t: TFunction): string {
  switch (d.prodc_scope) {
    case 'top': return t('request.prodc_top');
    case 'middle': return t('request.prodc_middle');
    case 'bottom': return t('request.prodc_bottom');
    case 'only_top': return t('request.prodc_only_top');
    case 'only_bottom': return t('request.prodc_only_bottom');
    default: return '';
  }
}

function buildProdcInfo(d: Partial<DetailFormState>, t: TFunction): string {
  const lines: string[] = [];
  const scope = prodcScopeLabel(d, t);
  if (scope) lines.push(`[${t('request.prodc_apply_region')}] ${scope}`);
  if (d.prodc_top_line || d.prodc_top_process || d.prodc_top_product) {
    lines.push(`[${t('request.plate_top')}] ${d.prodc_top_line || '-'} / ${d.prodc_top_process || '-'} / ${d.prodc_top_product || '-'}`);
  }
  const middleUse = d.prodc_middle_use;
  if (middleUse) {
    if (middleUse === '미사용') {
      lines.push(`[${t('request.plate_middle')}] 미사용`);
    } else {
      lines.push(`[${t('request.plate_middle')}] ${d.prodc_middle_line || '-'} / ${d.prodc_middle_process || '-'} / ${d.prodc_middle_product || '-'}`);
    }
  }
  if (d.prodc_bottom_line || d.prodc_bottom_process || d.prodc_bottom_product) {
    lines.push(`[${t('request.plate_bottom')}] ${d.prodc_bottom_line || '-'} / ${d.prodc_bottom_process || '-'} / ${d.prodc_bottom_product || '-'}`);
  }
  return lines.join('\n');
}

// ===== 상세 정보 텍스트 시트 =====

function addDetailInfoSheet(wb: ExcelJS.Workbook, t: TFunction, sheetName: string, doc: RequestDocument, detail: Partial<DetailFormState>): void {
  const blocks: InfoBlock[] = [];
  const isAdiCdChange = detail.request_purpose === 'ADI CD 변경';

  blocks.push({ kind: 'kv', label: t('request.request_purpose'), value: buildPurposeValue(detail) });
  blocks.push({ kind: 'kv', label: t('request.line'), value: detail.line || '-' });
  blocks.push({ kind: 'kv', label: t('request.process_selection'), value: detail.process_selection || '-' });
  blocks.push({ kind: 'kv', label: t('request.partid_selection'), value: detail.partid_selection || '-' });
  blocks.push({ kind: 'kv', label: t('request.process_id'), value: detail.process_id || '-' });
  if (detail.customer_name) blocks.push({ kind: 'kv', label: t('request.customer_name'), value: detail.customer_name });
  if (detail.customer_requirement) blocks.push({ kind: 'kv', label: t('request.customer_requirement'), value: detail.customer_requirement });

  if (isAdiCdChange && (detail.adi_cd_extra_targets?.length ?? 0) > 0) {
    const rows = [
      [detail.partid_selection || '-', detail.process_id || '-'],
      ...(detail.adi_cd_extra_targets ?? []).map((r) => [r.partid_selection || '-', r.process_id || '-']),
    ];
    blocks.push({ kind: 'table', label: t('request.adi_cd_targets_title'), headers: [t('request.partid_selection'), t('request.process_id')], rows });
  }

  if (isAdiCdChange) {
    const before = detail.adi_cd_before ?? [];
    const after = detail.adi_cd_after ?? [];
    const hasSteps = before.some((r) => r.unregistered || r.step_id.trim() || r.step_desc.trim())
      || after.some((r) => r.unregistered || r.step_id.trim() || r.step_desc.trim());
    if (hasSteps) {
      const balanced = balanceAdiCdRows(before, after);
      const isRowUsed = (b: typeof balanced.before[number], a: typeof balanced.after[number]) =>
        b.unregistered || a.unregistered || !!b.step_id.trim() || !!b.step_desc.trim() || !!a.step_id.trim() || !!a.step_desc.trim();
      const rows = balanced.before
        .map((b, i) => [b, balanced.after[i]] as const)
        .filter(([b, a]) => isRowUsed(b, a))
        .map(([b, a]) => [
          b.unregistered ? t('request.adi_cd_unregistered') : b.step_id,
          b.unregistered ? '' : b.step_desc,
          a.unregistered ? t('request.adi_cd_unregistered') : a.step_id,
          a.unregistered ? '' : a.step_desc,
        ]);
      blocks.push({
        kind: 'table',
        label: t('request.adi_cd_section_title'),
        headers: [`${ADI_CD_STEP_ID_LABEL}(${t('request.ba_before_col')})`, `${ADI_CD_STEP_DESC_LABEL}(${t('request.ba_before_col')})`, `${ADI_CD_STEP_ID_LABEL}(${t('request.ba_after_col')})`, `${ADI_CD_STEP_DESC_LABEL}(${t('request.ba_after_col')})`],
        rows,
      });
    }
  }

  if (detail.bb_zone) {
    blocks.push({ kind: 'kv', label: t('request.bb_status'), value: buildBbValue(detail, t) });
  }

  if (detail.change_purpose_note) {
    blocks.push({ kind: 'kv', label: t('request.change_purpose_note'), value: detail.change_purpose_note });
  }

  if ((detail.flow_chart?.length ?? 0) > 0) {
    const rows = (detail.flow_chart ?? []).map((r) => [
      r.location, r.product_name, r.process_id,
      r.step_from && r.step_to ? `${r.step_from} ~ ${r.step_to}` : (r.step_from || r.step_to || ''),
    ]);
    blocks.push({ kind: 'table', label: t('request.flow_chart'), headers: [t('request.flow_line'), t('request.flow_partid'), t('request.flow_process_id'), 'Step'], rows });
  }

  if ((detail.merge_pairs?.length ?? 0) > 0) {
    const fields: (keyof MergeRowInfo)[] = ['process_id', 'sp', 'sd', 'pp', 'layerid'];
    const fieldLabel = (f: keyof MergeRowInfo) => t(f === 'process_id' ? 'request.process_id' : f === 'layerid' ? 'request.col_layer' : `request.col_${f}`);
    const cells = (info: MergeRowInfo | null) => info ? fields.map((f) => info[f] || '-') : fields.map(() => t('request.ba_unregistered'));
    const rows = (detail.merge_pairs ?? []).map((pair) => [
      t(pair.table === 'J' ? 'request.jayer' : 'request.oayer'),
      ...cells(pair.before),
      ...cells(pair.after),
      t(`request.ba_kind_${deriveMergeKind(pair.before, pair.after)}`),
    ]);
    blocks.push({
      kind: 'table',
      label: t('request.ba_result_title'),
      headers: [
        t('request.ba_table_division'),
        ...fields.map((f) => `${fieldLabel(f)}(${t('request.ba_before_col')})`),
        ...fields.map((f) => `${fieldLabel(f)}(${t('request.ba_after_col')})`),
        t('request.ba_kind'),
      ],
      rows,
    });
  }

  if (doc.reference_materials) {
    blocks.push({ kind: 'kv', label: t('request.submit_note_label'), value: doc.reference_materials });
  }

  addInfoSheet(wb, t, sheetName, blocks);
}

// ===== MAP 정보 텍스트 시트 =====

function addMapInfoSheet(wb: ExcelJS.Workbook, t: TFunction, sheetName: string, detail: Partial<DetailFormState>): void {
  const blocks: InfoBlock[] = [];
  const isMapRegisteredDetail = detail.map_type === 'EXISTING' || detail.map_type === 'CLONE';
  const isDeleteType = isMapDeleteEditType(detail.map_type);
  const isProdc = detail.only_prodc === PRODC_YES;

  blocks.push({ kind: 'kv', label: t('request.map_type'), value: detail.map_type || '-' });
  if (isMapRegisteredDetail && detail.source_line) blocks.push({ kind: 'kv', label: t('request.source_line'), value: detail.source_line });
  if (isMapRegisteredDetail && detail.source_partid) blocks.push({ kind: 'kv', label: t('request.source_partid_selection'), value: detail.source_partid });

  if (isDeleteType) {
    blocks.push({ kind: 'kv', label: t('request.map_change_reason_delete'), value: htmlToPlainText(detail.map_change_reason) || '-' });
  }

  if (isMapRegisteredDetail) {
    blocks.push({ kind: 'kv', label: t('request.map'), value: t('request.value_none') });
    blocks.push({ kind: 'kv', label: t('request.ea_change'), value: t('request.value_none') });
  } else if (!isDeleteType) {
    const isProdcMap = isProdc && !!(detail.map_change_top || detail.map_change_bottom || detail.map_value_x_top || detail.map_value_x_bottom);
    const isPlainMap = !isProdc && !!detail.map_change;
    if (isProdcMap || isPlainMap) blocks.push({ kind: 'kv', label: t('request.map'), value: buildMapValue(detail, t) });
    if (detail.ea_change) blocks.push({ kind: 'kv', label: t('request.ea_change'), value: buildEaValue(detail, t) });
  }

  if (isMapRegisteredDetail) {
    blocks.push({ kind: 'kv', label: t('request.mshot_change_status'), value: t('request.value_none') });
  } else if (!isDeleteType && detail.mshot_change) {
    blocks.push({ kind: 'kv', label: t('request.mshot_change_status'), value: detail.mshot_change });
  }

  if (!isDeleteType && detail.only_prodc) {
    blocks.push({ kind: 'kv', label: t('request.prodc_status'), value: detail.only_prodc });
    if (isProdc) {
      if (isMapRegisteredDetail) {
        blocks.push({ kind: 'kv', label: t('approval.prodc_detail'), value: t('request.value_none') });
      } else {
        const info = buildProdcInfo(detail, t);
        if (info) blocks.push({ kind: 'kv', label: t('approval.prodc_detail'), value: info });
      }
    }
  }

  if (detail.final_yn) {
    const gds = detail.final_yn === 'YES' && Array.isArray(detail.final_entries) && detail.final_entries.length > 0
      ? ` — ${t('request.final_gds')}: ${detail.final_entries.join(', ')}`
      : '';
    blocks.push({ kind: 'kv', label: t('request.final_yn_label'), value: `${detail.final_yn}${gds}` });
  }

  if (!isDeleteType) {
    let interVal: string;
    if (detail.inter === 'YES') {
      interVal = detail.in_apply
        ? [
            t('approval.inter_applied'),
            detail.in_apply === 'O' ? t('request.in_apply_o') : t('request.in_apply_x'),
            detail.inter_select ? t(`request.map_opt_inter_${detail.inter_select}` as never) : null,
          ].filter(Boolean).join(' / ')
        : [
            t('approval.inter_applied'),
            detail.inter_xs === '적용' ? t('approval.inter_xs_applied') : null,
            detail.inter_ys === '적용' ? t('approval.inter_ys_applied') : null,
          ].filter(Boolean).join(' / ');
    } else {
      interVal = t('request.value_none');
    }
    blocks.push({ kind: 'kv', label: t('request.map_opt_inter'), value: interVal });

    const mapOptionDefs: { label: string; fieldKey: keyof DetailFormState }[] = [
      { label: t('request.map_opt_photo_backside'), fieldKey: 'photo_backside' },
      { label: t('request.map_opt_eds_backside'), fieldKey: 'eds_backside' },
      { label: t('request.map_opt_tsv'), fieldKey: 'tsv' },
      { label: t('request.map_opt_rf'), fieldKey: 'rf' },
      { label: t('request.map_opt_fullchip'), fieldKey: 'fullchip' },
      { label: t('request.map_opt_split'), fieldKey: 'split' },
      { label: t('request.map_opt_st'), fieldKey: 'st' },
      { label: t('request.map_opt_ecc'), fieldKey: 'ecc' },
      { label: t('request.map_opt_labelsideshot'), fieldKey: 'labelsideshot' },
      { label: t('request.map_opt_hpkglabelheight'), fieldKey: 'hpkglabelheight' },
    ];
    const active = mapOptionDefs.filter((o) => detail[o.fieldKey] === '적용');
    blocks.push({ kind: 'kv', label: t('request.map_option_title'), value: active.length > 0 ? active.map((o) => o.label).join(', ') : t('request.value_none') });
  }

  addInfoSheet(wb, t, sheetName, blocks);
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

/** 캡처 이미지 시트와 구분되는 텍스트 시트 이름("상세 정보 (텍스트)" 형태). */
function textSheetName(baseName: string, t: TFunction): string {
  return `${baseName}${t('request.export_text_suffix')}`;
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
  const { detail } = parseDoc(doc);
  const wb = new ExcelJS.Workbook();
  const sheetName = t('request.section_detail');
  addScreenshotSheet(wb, sheetName, screenshot, t('request.export_capture_failed'));
  addDetailInfoSheet(wb, t, textSheetName(sheetName, t), doc, detail);
  await downloadWorkbook(wb, `${doc.title}_${sheetName}_${getNowString()}.xlsx`);
}

export async function exportMapInfoImage(doc: RequestDocument, t: TFunction, screenshot: ScreenshotCapture | null): Promise<void> {
  const { detail } = parseDoc(doc);
  const wb = new ExcelJS.Workbook();
  const sheetName = t('request.section_map');
  addScreenshotSheet(wb, sheetName, screenshot, t('request.export_capture_failed'));
  addMapInfoSheet(wb, t, textSheetName(sheetName, t), detail);
  await downloadWorkbook(wb, `${doc.title}_${sheetName}_${getNowString()}.xlsx`);
}

export interface ExportAllScreenshots {
  detail: ScreenshotCapture | null;
  map: ScreenshotCapture | null;
}

/**
 * 결재 경로를 제외한 모든 sector(상세 정보/MAP 정보/JOB/OVL/정보/BB)를 시트별로 나눠 한 파일에 담는다.
 * 상세 정보/MAP 정보는 호출부(PagedDetailView)가 미리 캡처해 넘긴 화면 이미지 시트 + 텍스트 시트
 * 두 장씩을 담는다.
 */
export async function exportAll(doc: RequestDocument, t: TFunction, screenshots: ExportAllScreenshots): Promise<void> {
  const { detail, jayer, oayer, bb } = parseDoc(doc);
  const isAdiCdChange = detail.request_purpose === 'ADI CD 변경';
  const wb = new ExcelJS.Workbook();
  const detailSheetName = t('request.section_detail');
  addScreenshotSheet(wb, detailSheetName, screenshots.detail, t('request.export_capture_failed'));
  addDetailInfoSheet(wb, t, textSheetName(detailSheetName, t), doc, detail);
  if (!isAdiCdChange) {
    const mapSheetName = t('request.section_map');
    addScreenshotSheet(wb, mapSheetName, screenshots.map, t('request.export_capture_failed'));
    addMapInfoSheet(wb, t, textSheetName(mapSheetName, t), detail);
  }
  addJobSheet(wb, t, jayer);
  addOvlSheet(wb, t, oayer);
  addOvlInfoSheet(wb, t, detail);
  addBbSheet(wb, t, detail, bb);
  await downloadWorkbook(wb, `${doc.title}_전체_${getNowString()}.xlsx`);
}
