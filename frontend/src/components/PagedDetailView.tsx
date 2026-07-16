import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ExcelJS from 'exceljs';
import { RequestDocument, UserRole, DetailFormState, FlowChartRow, JayerRow, OayerRow, BbTableRow, HistorySnapshot } from '../types';
import Modal from './Modal';
import { ST_CELL_COLOR } from '../utils/stCellColor';
import { bbTabColor } from '../utils/bbTabColors';

// ===== Table Components =====

function FlowChartTable({ rows }: { rows: FlowChartRow[] }) {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  return (
    <table className="table" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
      <thead><tr><th>{t('request.flow_line')}</th><th>{t('request.flow_partid')}</th><th>{t('request.flow_process_id')}</th><th>Step</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.location}</td>
            <td>{r.product_name}</td>
            <td>{r.process_id}</td>
            <td>{r.step_from && r.step_to ? `${r.step_from} ~ ${r.step_to}` : (r.step_from || r.step_to || '')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const changedRowStyle: React.CSSProperties = {
  outline: '2px solid #dc3545',
  outlineOffset: '-2px',
  background: 'rgba(220,53,69,0.04)',
};

const histBtnStyle: React.CSSProperties = {
  fontSize: '0.68rem', padding: '2px 7px', borderRadius: 4,
  background: 'none', border: '1px solid #dc3545',
  color: '#dc3545', cursor: 'pointer', fontWeight: 700,
  whiteSpace: 'nowrap',
};

// ===== Row Diff Modal =====

interface DiffField { key: string; label: string; }

function RowDiffModal({
  title, fields, curRow, prevRow, onClose,
}: {
  title: string;
  fields: DiffField[];
  curRow: Record<string, any>;
  prevRow: Record<string, any>;
  onClose: () => void;
}) {
  const thS: React.CSSProperties = {
    textAlign: 'left', padding: '5px 10px', fontSize: '0.78rem',
    fontWeight: 700, color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)',
  };
  const tdS: React.CSSProperties = { padding: '5px 10px', fontSize: '0.82rem', verticalAlign: 'top' };
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={thS}>항목</th>
              <th style={{ ...thS, color: '#dc3545' }}>변경 전</th>
              <th style={{ ...thS, color: '#155724' }}>변경 후</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(({ key, label }) => {
              const before = String(prevRow[key] ?? '');
              const after  = String(curRow[key]  ?? '');
              const isChanged = before !== after;
              return (
                <tr key={key} style={{ background: isChanged ? 'rgba(220,53,69,0.05)' : undefined }}>
                  <td style={{ ...tdS, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</td>
                  <td style={{ ...tdS, color: isChanged ? '#dc3545' : 'var(--text-primary)' }}>{before || '-'}</td>
                  <td style={{ ...tdS, color: isChanged ? '#155724' : 'var(--text-primary)', fontWeight: isChanged ? 700 : 400 }}>{after || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ===== Table Components =====

function JayerTable({
  rows,
  changedRowIds = new Set<string>(),
  prevRowMap,
}: {
  rows: JayerRow[];
  changedRowIds?: Set<string>;
  prevRowMap?: Map<string, JayerRow>;
}) {
  const { t } = useTranslation();
  const [diffId, setDiffId] = useState<string | null>(null);
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  const diffCur = diffId ? rows.find((r) => r.id === diffId) : null;
  const diffPrev = diffId ? prevRowMap?.get(diffId) : null;
  const fields: DiffField[] = [
    { key: 'updated',      label: 'Update 날짜' },
    { key: 'process_id',   label: t('request.process_id') },
    { key: 'sp',           label: t('request.col_sp') },
    { key: 'sd',           label: t('request.col_sd') },
    { key: 'pp',           label: t('request.col_pp') },
    { key: 'layerid',      label: 'Layer' },
    { key: 'st',           label: t('request.col_st') },
    { key: 'new_or_copy',  label: t('request.col_new_or_copy') },
    { key: 'product_name', label: t('request.col_product_name') },
    { key: 'step',         label: t('request.col_step') },
    { key: 'item_id',      label: t('request.col_item_id') },
  ];
  const hasPrev = (prevRowMap?.size ?? 0) > 0;
  return (
    <>
      {diffCur && diffPrev && (
        <RowDiffModal title={t('request.jayer_row_history')} fields={fields} curRow={diffCur as any} prevRow={diffPrev as any} onClose={() => setDiffId(null)} />
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table table-compact" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              {hasPrev && <th style={{ width: 64 }}></th>}
              <th>Update 날짜</th><th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_pp')}</th><th>{t('request.col_st')}</th><th>{t('request.col_new_or_copy')}</th><th>{t('request.col_product_name')}</th><th>{t('request.col_step')}</th><th>{t('request.col_item_id')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isChanged = changedRowIds.has(r.id);
              return (
                <tr key={r.id} style={isChanged ? changedRowStyle : undefined}>
                  {hasPrev && (
                    <td style={{ textAlign: 'center' }}>
                      {isChanged && prevRowMap?.has(r.id) && (
                        <button data-tour="jayer-hist-btn" style={histBtnStyle} onClick={() => setDiffId(r.id)}>이력 확인</button>
                      )}
                    </td>
                  )}
                  {(() => { const reg = r.new_or_copy === '기등록'; const rb = reg ? '#e5e7eb' : undefined; return (<><td style={{ backgroundColor: rb }}>{r.updated || '-'}</td><td style={{ backgroundColor: rb }}>{r.process_id}</td><td style={{ backgroundColor: rb }}>{r.sp}</td><td style={{ backgroundColor: rb }}>{r.sd}</td><td style={{ backgroundColor: reg ? rb : r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }}>{r.pp}</td><td style={{ backgroundColor: reg ? rb : ST_CELL_COLOR[r.st] }}>{r.st}</td><td style={{ backgroundColor: reg ? rb : r.new_or_copy === '차용' ? '#eff6ff' : undefined }}>{r.new_or_copy}</td><td style={{ backgroundColor: rb }}>{r.product_name}</td><td style={{ backgroundColor: rb }}>{r.step}</td><td style={{ backgroundColor: rb }}>{r.item_id}</td></>); })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OayerTable({
  rows,
  changedRowIds = new Set<string>(),
  prevRowMap,
}: {
  rows: OayerRow[];
  changedRowIds?: Set<string>;
  prevRowMap?: Map<string, OayerRow>;
}) {
  const { t } = useTranslation();
  const [diffId, setDiffId] = useState<string | null>(null);
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  const diffCur = diffId ? rows.find((r) => r.id === diffId) : null;
  const diffPrev = diffId ? prevRowMap?.get(diffId) : null;
  const fields: DiffField[] = [
    { key: 'updated',      label: 'Update 날짜' },
    { key: 'process_id',   label: t('request.process_id') },
    { key: 'sp',           label: t('request.col_sp') },
    { key: 'sd',           label: t('request.col_sd') },
    { key: 'layerid',      label: t('request.col_layer') },
    { key: 'pp',           label: t('request.col_pp') },
    { key: 'st',           label: t('request.col_st') },
    { key: 'new_or_copy',  label: t('request.col_new_or_copy') },
    { key: 'product_name', label: t('request.col_product_name') },
    { key: 'step',         label: t('request.col_step') },
  ];
  const hasPrev = (prevRowMap?.size ?? 0) > 0;
  return (
    <>
      {diffCur && diffPrev && (
        <RowDiffModal title={t('request.oayer_row_history')} fields={fields} curRow={diffCur as any} prevRow={diffPrev as any} onClose={() => setDiffId(null)} />
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table table-compact" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              {hasPrev && <th style={{ width: 64 }}></th>}
              <th>Update 날짜</th><th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_layer')}</th><th>{t('request.col_pp')}</th><th>{t('request.col_st')}</th><th>{t('request.col_new_or_copy')}</th><th>{t('request.col_product_name')}</th><th>{t('request.col_step')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isChanged = changedRowIds.has(r.id);
              return (
                <tr key={r.id} style={isChanged ? changedRowStyle : undefined}>
                  {hasPrev && (
                    <td style={{ textAlign: 'center' }}>
                      {isChanged && prevRowMap?.has(r.id) && (
                        <button style={histBtnStyle} onClick={() => setDiffId(r.id)}>이력 확인</button>
                      )}
                    </td>
                  )}
                  {(() => { const reg = r.new_or_copy === '기등록'; const rb = reg ? '#e5e7eb' : undefined; return (<><td style={{ backgroundColor: rb }}>{r.updated || '-'}</td><td style={{ backgroundColor: rb }}>{r.process_id}</td><td style={{ backgroundColor: rb }}>{r.sp}</td><td style={{ backgroundColor: rb }}>{r.sd}</td><td style={{ backgroundColor: rb }}>{r.layerid}</td><td style={{ backgroundColor: reg ? rb : r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }}>{r.pp}</td><td style={{ backgroundColor: reg ? rb : ST_CELL_COLOR[r.st] }}>{r.st}</td><td style={{ backgroundColor: reg ? rb : r.new_or_copy === '차용' ? '#eff6ff' : undefined }}>{r.new_or_copy}</td><td style={{ backgroundColor: rb }}>{r.product_name}</td><td style={{ backgroundColor: rb }}>{r.step}</td></>); })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BbTable({
  rows,
  changedRowIds = new Set<string>(),
  prevRowMap,
  tabCount = 0,
  entryIds = [],
}: {
  rows: BbTableRow[];
  changedRowIds?: Set<string>;
  prevRowMap?: Map<string, BbTableRow>;
  tabCount?: number;
  entryIds?: string[];
}) {
  // 탭이 2개 이상일 때만 Ref.PART ID 셀에 출처 탭 색을 적용한다.
  const multiTab = tabCount >= 2;
  // 색 인덱스: 안정 id(entryId)의 현재 위치 우선, 레거시 행(entryId 없음)은 entryIdx로 폴백.
  const colorIndexOf = (r: BbTableRow): number =>
    r.entryId != null ? entryIds.indexOf(r.entryId) : (r.entryIdx ?? -1);
  const { t } = useTranslation();
  const [diffId, setDiffId] = useState<string | null>(null);
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  const diffCur = diffId ? rows.find((r) => r.id === diffId) : null;
  const diffPrev = diffId ? prevRowMap?.get(diffId) : null;
  const fields: DiffField[] = [
    { key: 'process_id',    label: t('request.process_id') },
    { key: 'ss',            label: t('request.col_sp') },
    { key: 'sd',            label: t('request.col_sd') },
    { key: 'bb_process_id', label: t('request.col_bb_process_id') },
    { key: 'bb_name',       label: t('request.col_bb_partid') },
    { key: 'bb_layer',      label: t('request.col_bb_layer') },
    { key: 'bb_ss',         label: t('request.col_bb_stepseq') },
    { key: 'bb_step',       label: t('request.col_bb_step') },
    { key: 'remark',        label: t('request.col_remark') },
  ];
  const hasPrev = (prevRowMap?.size ?? 0) > 0;
  return (
    <>
      {diffCur && diffPrev && (
        <RowDiffModal title="뼈찜 행 변경 이력" fields={fields} curRow={diffCur as any} prevRow={diffPrev as any} onClose={() => setDiffId(null)} />
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table table-compact" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              {hasPrev && <th style={{ width: 64 }}></th>}
              <th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_bb_process_id')}</th><th>{t('request.col_bb_partid')}</th><th>{t('request.col_bb_layer')}</th><th>{t('request.col_bb_stepseq')}</th><th>{t('request.col_bb_step')}</th><th>{t('request.col_remark')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isChanged = changedRowIds.has(r.id);
              return (
                <tr key={r.id} style={isChanged ? changedRowStyle : undefined}>
                  {hasPrev && (
                    <td style={{ textAlign: 'center' }}>
                      {isChanged && prevRowMap?.has(r.id) && (
                        <button style={histBtnStyle} onClick={() => setDiffId(r.id)}>이력 확인</button>
                      )}
                    </td>
                  )}
                  <td>{r.process_id}</td><td>{r.ss}</td><td>{r.sd}</td><td>{r.bb_process_id}</td><td style={multiTab && colorIndexOf(r) >= 0 ? { backgroundColor: bbTabColor(colorIndexOf(r)) } : undefined}>{r.bb_name}</td><td>{r.bb_layer}</td><td>{r.bb_ss}</td><td>{r.bb_step}</td><td>{r.remark}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ===== Diff Helpers =====

function computeDetailDiff(cur: any, prev: any): Set<string> {
  const changed = new Set<string>();
  const keys = new Set([...Object.keys(cur ?? {}), ...Object.keys(prev ?? {})]);
  for (const k of keys) {
    if (JSON.stringify(cur?.[k]) !== JSON.stringify(prev?.[k])) changed.add(k);
  }
  return changed;
}

// Excludes unstable/non-semantic fields from comparison
function rowContentSig(row: any): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sortOrder, disabled, id, sourceJayerRowId, ...rest } = row;
  const sorted = Object.fromEntries(Object.keys(rest).sort().map((k) => [k, rest[k]]));
  return JSON.stringify(sorted);
}

function computeTableDiff<T extends { id: string }>(
  cur: T[],
  prev: T[]
): { changedIds: Set<string>; prevRowMap: Map<string, T> } {
  const changedIds = new Set<string>();
  const prevRowMap = new Map<string, T>();

  if (!prev || prev.length === 0) {
    return { changedIds, prevRowMap };
  }

  const prevById = new Map(prev.map((r) => [r.id, r]));
  const anyIdMatch = (cur ?? []).some((r) => prevById.has(r.id));

  if (!anyIdMatch) {
    // Positional fallback: rows were regenerated with new IDs
    for (let i = 0; i < (cur ?? []).length; i++) {
      const row = cur[i];
      const p = prev[i];
      if (!p) {
        changedIds.add(row.id);
      } else {
        prevRowMap.set(row.id, p);
        if (rowContentSig(row) !== rowContentSig(p)) changedIds.add(row.id);
      }
    }
  } else {
    for (const row of cur ?? []) {
      const p = prevById.get(row.id);
      if (!p) {
        changedIds.add(row.id);
      } else {
        prevRowMap.set(row.id, p);
        if (rowContentSig(row) !== rowContentSig(p)) changedIds.add(row.id);
      }
    }
  }

  return { changedIds, prevRowMap };
}

// ===== PagedDetailView =====

export interface PagedDetailViewProps {
  doc: RequestDocument;
  role: UserRole;
  pageIdx: number;
  setPageIdx: (idx: number) => void;
}

export default function PagedDetailView({ doc, role, pageIdx, setPageIdx }: PagedDetailViewProps): React.ReactElement {
  const { t } = useTranslation();
  let detail: Partial<DetailFormState> = {};
  let jayer: JayerRow[] = [];
  let oayer: OayerRow[] = [];
  let bb: BbTableRow[] = [];
  let history: HistorySnapshot[] = [];

  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    detail = parsed?.detail ?? {};
    jayer = parsed?.jayerRows ?? [];
    oayer = parsed?.oayerRows ?? [];
    bb = parsed?.bbRows ?? [];
    history = parsed?.history ?? [];
  } catch { /* noop */ }

  const getNowString = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  };

  const applyFill = (cell: ExcelJS.Cell, hex: string | undefined) => {
    if (!hex) return;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex.replace('#', '')}` } };
  };

  const downloadBuffer = async (wb: ExcelJS.Workbook, filename: string) => {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJayer = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('JOB');
    ws.columns = [
      { header: 'Update 날짜',                       key: 'updated',       width: 16 },
      { header: t('request.process_id'),              key: 'process_id',    width: 14 },
      { header: t('request.col_sp'),                  key: 'sp',            width: 10 },
      { header: t('request.col_sd'),                  key: 'sd',            width: 10 },
      { header: t('request.col_pp'),                  key: 'pp',            width: 14 },
      { header: t('request.col_st'),                  key: 'st',            width: 8  },
      { header: t('request.col_new_or_copy'),         key: 'new_or_copy',   width: 10 },
      { header: t('request.col_product_name'),        key: 'product_name',  width: 16 },
      { header: t('request.col_step'),                key: 'step',          width: 10 },
      { header: t('request.col_item_id'),             key: 'item_id',       width: 12 },
    ];
    jayer.filter(r => !r.disabled).forEach(r => {
      const row = ws.addRow({
        updated: r.updated ?? '', process_id: r.process_id, sp: r.sp, sd: r.sd,
        pp: r.pp, st: r.st, new_or_copy: r.new_or_copy, product_name: r.product_name,
        step: r.step, item_id: r.item_id,
      });
      const reg = r.new_or_copy === '기등록';
      row.eachCell((cell, col) => {
        if (reg) { applyFill(cell, '#e5e7eb'); return; }
        if (col === 5) applyFill(cell, r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined);
        else if (col === 6) applyFill(cell, ST_CELL_COLOR[r.st]);
        else if (col === 7) applyFill(cell, r.new_or_copy === '차용' ? '#eff6ff' : undefined);
      });
    });
    await downloadBuffer(wb, `${doc.title}_JOB_${getNowString()}.xlsx`);
  };

  const exportOayer = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('OVL');
    ws.columns = [
      { header: 'Update 날짜',                       key: 'updated',       width: 16 },
      { header: t('request.process_id'),              key: 'process_id',    width: 14 },
      { header: t('request.col_sp'),                  key: 'sp',            width: 10 },
      { header: t('request.col_sd'),                  key: 'sd',            width: 10 },
      { header: t('request.col_layer'),               key: 'layerid',       width: 10 },
      { header: t('request.col_pp'),                  key: 'pp',            width: 14 },
      { header: t('request.col_st'),                  key: 'st',            width: 8  },
      { header: t('request.col_new_or_copy'),         key: 'new_or_copy',   width: 10 },
      { header: t('request.col_product_name'),        key: 'product_name',  width: 16 },
      { header: t('request.col_step'),                key: 'step',          width: 10 },
    ];
    oayer.filter(r => !r.disabled).forEach(r => {
      const row = ws.addRow({
        updated: r.updated ?? '', process_id: r.process_id, sp: r.sp, sd: r.sd,
        layerid: r.layerid, pp: r.pp, st: r.st, new_or_copy: r.new_or_copy,
        product_name: r.product_name, step: r.step,
      });
      const reg = r.new_or_copy === '기등록';
      row.eachCell((cell, col) => {
        if (reg) { applyFill(cell, '#e5e7eb'); return; }
        if (col === 6) applyFill(cell, r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined);
        else if (col === 7) applyFill(cell, ST_CELL_COLOR[r.st]);
        else if (col === 8) applyFill(cell, r.new_or_copy === '차용' ? '#eff6ff' : undefined);
      });
    });
    await downloadBuffer(wb, `${doc.title}_OVL_${getNowString()}.xlsx`);
  };

  const exportBb = async () => {
    const bbEntryIds: string[] = Array.isArray(detail?.bb_entries)
      ? (detail.bb_entries as { id?: string }[]).map((e) => e.id ?? '')
      : [];
    const bbTabCount = bbEntryIds.length;
    const multiTab = bbTabCount >= 2;
    // 색 인덱스: 안정 id(entryId) 현재 위치 우선, 레거시 행은 entryIdx 폴백.
    const colorIndexOf = (r: BbTableRow): number =>
      r.entryId != null ? bbEntryIds.indexOf(r.entryId) : (r.entryIdx ?? -1);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('BB');
    ws.columns = [
      { header: t('request.process_id'),              key: 'process_id',    width: 14 },
      { header: t('request.col_sp'),                  key: 'ss',            width: 10 },
      { header: t('request.col_sd'),                  key: 'sd',            width: 10 },
      { header: t('request.col_bb_process_id'),       key: 'bb_process_id', width: 14 },
      { header: t('request.col_bb_partid'),           key: 'bb_name',       width: 16 },
      { header: t('request.col_bb_layer'),            key: 'bb_layer',      width: 10 },
      { header: t('request.col_bb_stepseq'),          key: 'bb_ss',         width: 10 },
      { header: t('request.col_bb_step'),             key: 'bb_step',       width: 10 },
      { header: t('request.col_remark'),              key: 'remark',        width: 16 },
    ];
    bb.forEach(r => {
      const row = ws.addRow({
        process_id: r.process_id, ss: r.ss, sd: r.sd, bb_process_id: r.bb_process_id,
        bb_name: r.bb_name, bb_layer: r.bb_layer, bb_ss: r.bb_ss, bb_step: r.bb_step, remark: r.remark,
      });
      if (multiTab && colorIndexOf(r) >= 0) {
        applyFill(row.getCell(5), bbTabColor(colorIndexOf(r)));
      }
    });
    await downloadBuffer(wb, `${doc.title}_BB_${getNowString()}.xlsx`);
  };

  const prevSnap = history.length > 0 ? history[history.length - 1] : null;
  const changedFields = prevSnap ? computeDetailDiff(detail, prevSnap.detail) : new Set<string>();
  const { changedIds: changedJayerIds, prevRowMap: prevJayerMap } = prevSnap
    ? computeTableDiff(jayer, prevSnap.jayerRows ?? [])
    : { changedIds: new Set<string>(), prevRowMap: new Map<string, JayerRow>() };
  const { changedIds: changedOayerIds, prevRowMap: prevOayerMap } = prevSnap
    ? computeTableDiff(oayer, prevSnap.oayerRows ?? [])
    : { changedIds: new Set<string>(), prevRowMap: new Map<string, OayerRow>() };
  const { changedIds: changedBbIds, prevRowMap: prevBbMap } = prevSnap
    ? computeTableDiff(bb, prevSnap.bbRows ?? [])
    : { changedIds: new Set<string>(), prevRowMap: new Map<string, BbTableRow>() };

  const isPL = role === 'PL';
  // 모든 팀이 상세 보기의 전체 탭·섹션을 동일하게 볼 수 있도록 역할 게이팅을 개방한다.
  const isP = true;
  const isR = true;
  const isJ = true;
  const isO = true;
  const isE = true;

  const showJayer = isJ || isE || isO || isP;
  const showOayer = isO || isP;
  const showBb = isJ || isE || isO || isP;
  const showFlowChart = isJ || isE || isO || isP;

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px 20px',
    marginBottom: 16,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)',
    marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border)', paddingBottom: 8,
  };

  const fieldLabel: React.CSSProperties = {
    fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500,
  };

  const fieldValue: React.CSSProperties = {
    color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600,
    whiteSpace: 'pre-wrap', lineHeight: 1.5,
  };

  const chipBase: React.CSSProperties = {
    flex: '1 1 0',
    minWidth: 100,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    textAlign: 'center' as const,
  };

  const chipWide: React.CSSProperties = {
    ...chipBase,
    flex: '2 1 0',
    minWidth: 180,
    textAlign: 'left' as const,
  };

  const chipFull: React.CSSProperties = {
    ...chipBase,
    flex: '1 1 100%',
    minWidth: 200,
    textAlign: 'left' as const,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8,
  };

  // TBV/TLV 좌표 표 셀 스타일 (작성 화면 Step3와 동일한 톤)
  const tbvDetailThStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    padding: '6px 10px', fontSize: '0.7rem', color: 'var(--text-secondary)',
    fontWeight: 700, textAlign: 'center',
  };
  const tbvDetailTdStyle: React.CSSProperties = {
    border: '1px solid var(--border-light)', padding: '5px 8px', textAlign: 'center',
  };

  // ===== FieldHistoryModal =====
  const FieldHistoryModal = ({
    label, fieldKey, currentValue, onClose,
  }: { label: string; fieldKey: string; currentValue: string; onClose: () => void }) => {
    const rows = [
      ...history.map((snap, i) => ({
        label: `${i + 1}차 제출`,
        timestamp: snap.timestamp,
        value: String((snap.detail as any)?.[fieldKey] ?? '-'),
      })),
      { label: '현재 (최신)', timestamp: null as string | null, value: currentValue },
    ];
    const thStyle: React.CSSProperties = {
      textAlign: 'left', padding: '6px 10px',
      borderBottom: '1px solid var(--border)', fontSize: '0.8rem',
      color: 'var(--text-muted)', fontWeight: 600,
    };
    const tdStyle: React.CSSProperties = { padding: '6px 10px', fontSize: '0.85rem' };
    return (
      <Modal isOpen onClose={onClose} title={`${label} 변경 이력`}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>제출 차수</th>
              <th style={thStyle}>시각</th>
              <th style={thStyle}>값</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isChangedRow = i > 0 && row.value !== rows[i - 1].value;
              const isCurrent = i === rows.length - 1;
              return (
                <tr
                  key={i}
                  style={{
                    background: isCurrent
                      ? 'rgba(37,99,235,0.07)'
                      : isChangedRow ? 'rgba(220,53,69,0.06)' : undefined,
                  }}
                >
                  <td style={tdStyle}>{row.label}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    {row.timestamp ? new Date(row.timestamp).toLocaleString('ko-KR') : '-'}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: isCurrent ? 700 : 400 }}>{row.value}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Modal>
    );
  };

  // ===== Chip =====
  const Chip = ({
    label, value, style, changed, fieldKey,
  }: {
    label: string;
    value: string | undefined | null;
    style?: React.CSSProperties;
    changed?: boolean;
    fieldKey?: string;
  }) => {
    const [histOpen, setHistOpen] = useState(false);
    if (!value) return null;
    const merged = { ...chipBase, ...style };
    const changedBorder: React.CSSProperties = changed
      ? { border: '2px solid #dc3545', position: 'relative' }
      : {};
    return (
      <div style={{ ...merged, ...changedBorder }}>
        {changed && fieldKey && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setHistOpen(true); }}
              style={{
                position: 'absolute', top: 4, right: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#dc3545', fontSize: '0.68rem', fontWeight: 700,
                padding: 0, lineHeight: 1,
              }}
            >
              이력 확인
            </button>
            {histOpen && (
              <FieldHistoryModal
                label={label}
                fieldKey={fieldKey}
                currentValue={value}
                onClose={() => setHistOpen(false)}
              />
            )}
          </>
        )}
        <div style={{ ...fieldLabel, textAlign: merged.textAlign as any }}>{label}</div>
        <div style={{ ...fieldValue, textAlign: merged.textAlign as any }}>{value}</div>
      </div>
    );
  };

  // other_purpose 는 배열(신규)이며, 구버전 문서는 문자열일 수 있어 양쪽 모두 처리한다.
  const opRaw = detail.other_purpose as unknown as string[] | string | undefined;
  const otherPurposeText = Array.isArray(opRaw)
    ? opRaw.map((o) => `[${o}]`).join('')
    : (opRaw || '');
  const purposeValue = detail.request_purpose
    ? (otherPurposeText ? `${detail.request_purpose}(${otherPurposeText})` : detail.request_purpose)
    : '-';
  const basicRow = [
    { label: t('request.request_purpose'), value: purposeValue, fieldKey: 'request_purpose', changed: changedFields.has('request_purpose') || changedFields.has('other_purpose') },
    { label: t('request.line'), value: detail.line || '-', fieldKey: 'line', changed: changedFields.has('line') },
    { label: t('request.process_selection'), value: detail.process_selection || '-', fieldKey: 'process_selection', changed: changedFields.has('process_selection') },
    { label: t('request.partid_selection'), value: detail.partid_selection || '-', fieldKey: 'partid_selection', changed: changedFields.has('partid_selection') },
    { label: t('request.process_id'), value: detail.process_id || '-', fieldKey: 'process_id', changed: changedFields.has('process_id') },
  ];

  const buildProdcInfo = (): string => {
    const lines: string[] = [];
    if (detail.prodc_top_line || detail.prodc_top_process || detail.prodc_top_product) {
      lines.push(`[상판] ${detail.prodc_top_line || '-'} / ${detail.prodc_top_process || '-'} / ${detail.prodc_top_product || '-'}`);
    }
    const middleUse = detail.prodc_middle_use;
    if (middleUse) {
      if (middleUse === '미사용') {
        lines.push('[중판] 미사용');
      } else {
        lines.push(`[중판] ${detail.prodc_middle_line || '-'} / ${detail.prodc_middle_process || '-'} / ${detail.prodc_middle_product || '-'}`);
      }
    }
    if (detail.prodc_bottom_line || detail.prodc_bottom_process || detail.prodc_bottom_product) {
      lines.push(`[하판] ${detail.prodc_bottom_line || '-'} / ${detail.prodc_bottom_process || '-'} / ${detail.prodc_bottom_product || '-'}`);
    }
    return lines.join('\n');
  };

  const isProdc = detail.only_prodc === 'Yes';
  const mshotChange = detail.mshot_change || '없음';
  const mshotHasDetail = mshotChange === '추가' || mshotChange === '수정';
  const mshotIsDelete = mshotChange === '삭제';

  const PLBasicSection = null;
  const [mapHistOpen, setMapHistOpen] = useState(false);

type Page = { label: string; content: React.ReactNode };
  const pages: Page[] = [
    {
      label: t('request.section_detail'),
      content: (
        <div>
          {PLBasicSection}

          <div style={cardStyle}>
            <div style={sectionTitle}>{t('approval.section_basic')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {basicRow.map((item) => (
                <Chip key={item.label} label={item.label} value={item.value} changed={item.changed} fieldKey={item.fieldKey} />
              ))}
            </div>
            {(detail.customer_name || detail.customer_requirement) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {detail.customer_name && (
                  <Chip
                    label={t('request.customer_name')}
                    value={detail.customer_name}
                    // 요구사항이 없으면 고객/업체명을 전체 폭 + 텍스트 가운데로 표시
                    style={detail.customer_requirement ? undefined : { ...chipFull, textAlign: 'center' }}
                    changed={changedFields.has('customer_name')}
                    fieldKey="customer_name"
                  />
                )}
                {detail.customer_requirement && (
                  <Chip label={t('request.customer_requirement')} value={detail.customer_requirement} style={chipWide} changed={changedFields.has('customer_requirement')} fieldKey="customer_requirement" />
                )}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={sectionTitle}>{t('approval.section_detail')}</div>

            {/* 원본 라인/Part ID는 MAP 정보 섹션(CLONE)에서만 표시한다. */}

            {(isJ || isE || isO || isP) && detail.bb_zone && (() => {
              const bbValue = Array.isArray(detail.bb_entries) && detail.bb_entries.length > 0
                ? detail.bb_entries.map((e: { location: string; product: string; process_id: string }, i: number) =>
                    `[${i + 1}] 위치: ${e.location || '-'} / 제품: ${e.product || '-'} / 조리법: ${e.process_id || '-'}`
                  ).join('\n')
                : '-';
              const bbChanged = changedFields.has('bb_zone') || changedFields.has('bb_entries');
              return (
                <div style={rowStyle}>
                  <Chip label={t('request.bb_status')} value={bbValue} style={chipWide} changed={bbChanged} fieldKey="bb_zone" />
                </div>
              );
            })()}

            {((isO && !isR && !isJ) || role === 'MASTER' || isPL || isP) && detail.change_purpose_note && (
              <div style={rowStyle}>
                <Chip label={t('request.change_purpose_note')} value={detail.change_purpose_note} style={chipFull} changed={changedFields.has('change_purpose_note')} fieldKey="change_purpose_note" />
              </div>
            )}


          </div>

          {showFlowChart && (detail.flow_chart?.length ?? 0) > 0 && (
            <div style={cardStyle}>
              <div style={sectionTitle}>{t('request.flow_chart')}</div>
              <FlowChartTable rows={detail.flow_chart ?? []} />
            </div>
          )}

          {doc.reference_materials && (
            <div style={cardStyle}>
              <div style={sectionTitle}>특이사항</div>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {doc.reference_materials}
              </div>
            </div>
          )}
        </div>
      ),
    },
  ];

  const showMap = isR || isO || isP;
  if (showMap) {
    pages.push({
      label: t('request.section_map'),
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>🗺️ {t('request.section_map')}</div>

          {detail.map_type && (
            <div style={rowStyle}>
              <Chip label={t('request.map_type')} value={detail.map_type} changed={changedFields.has('map_type')} fieldKey="map_type" />
              {detail.map_type === 'CLONE' && detail.source_line && (
                <Chip label={t('request.source_line')} value={detail.source_line} changed={changedFields.has('source_line')} fieldKey="source_line" />
              )}
              {detail.map_type === 'CLONE' && detail.source_partid && (
                <Chip label={t('request.source_partid_selection')} value={detail.source_partid} changed={changedFields.has('source_partid')} fieldKey="source_partid" />
              )}
            </div>
          )}

          {(isR || isO || isJ || isP) && (detail.map_change || (detail as any).map_change_top || detail.ea_change) && (
            <div style={rowStyle}>
              {(isR || isO || isP) && (() => {
                if (isProdc && ((detail as any).map_value_x_top || (detail as any).map_value_x_bottom)) {
                  const topVal = `X: ${(detail as any).map_value_x_top ? `${(detail as any).map_value_x_top}um` : '-'} / Y: ${(detail as any).map_value_y_top ? `${(detail as any).map_value_y_top}um` : '-'}`;
                  const botVal = `X: ${(detail as any).map_value_x_bottom ? `${(detail as any).map_value_x_bottom}um` : '-'} / Y: ${(detail as any).map_value_y_bottom ? `${(detail as any).map_value_y_bottom}um` : '-'}`;
                  const reasonPart = detail.map_reason ? ` / 사유: ${detail.map_reason}` : '';
                  const mapValue = `[${t('request.prodc_top')}] ${topVal}\n[${t('request.prodc_bottom')}] ${botVal}${reasonPart}`;
                  const mapChanged = ['map_value_x_top','map_value_y_top','map_value_x_bottom','map_value_y_bottom','map_reason'].some(k => changedFields.has(k));
                  return <Chip label={t('request.map')} value={mapValue} style={chipWide} changed={mapChanged} fieldKey="map_change_top" />;
                }
                if (!isProdc && detail.map_change) {
                  const mapValue = `변경: ${detail.map_change}${detail.map_value_x ? ` / X: ${detail.map_value_x}um` : ''}${detail.map_value_y ? ` / Y: ${detail.map_value_y}um` : ''}${detail.map_reason ? ` / 사유: ${detail.map_reason}` : ''}`;
                  const mapChanged = changedFields.has('map_change') || changedFields.has('map_value_x') || changedFields.has('map_value_y') || changedFields.has('map_reason');
                  return <Chip label={t('request.map')} value={mapValue} style={chipWide} changed={mapChanged} fieldKey="map_change" />;
                }
                return null;
              })()}
              {(isR || isO || isP) && detail.ea_change && (() => {
                const eaValue = `변경: ${detail.ea_change}${detail.ea_value ? ` / 값: ${detail.ea_value}mm` : ''}`;
                const eaChanged = changedFields.has('ea_change') || changedFields.has('ea_value');
                return (
                  <Chip label={t('request.ea_change')} value={eaValue} style={chipWide} changed={eaChanged} fieldKey="ea_change" />
                );
              })()}
            </div>
          )}

          {(isR || isO || isP) && detail.mshot_change && (() => {
            const mshotChanged = changedFields.has('mshot_change') || changedFields.has('mshot_image_copy') || changedFields.has('mshot_image_copy_top') || changedFields.has('mshot_image_copy_bottom');
            const imgStyle: React.CSSProperties = { maxWidth: '300px', maxHeight: '200px', borderRadius: '4px', border: '1px solid #ddd', marginTop: '8px' };
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200, ...(mshotChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                    <div style={fieldLabel}>{t('request.mshot_change_status')}</div>
                    <div style={fieldValue}>{detail.mshot_change}</div>
                  </div>
                  {mshotIsDelete && (
                    <div style={{ flex: 1 }}>
                      <div style={{ ...fieldLabel, color: '#dc3545' }}>{t('approval.mshot_delete_notice')}</div>
                      <div style={{ ...fieldValue, color: '#dc3545' }}>{t('approval.mshot_delete_desc')}</div>
                    </div>
                  )}
                  {mshotHasDetail && !isProdc && detail.mshot_image_copy && (
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>{t('request.mshot_change_image_attach_area')}</div>
                      <img src={`/media/${detail.mshot_image_copy}`} alt="attached" style={imgStyle} />
                    </div>
                  )}
                  {mshotHasDetail && isProdc && (detail.mshot_image_copy_top || detail.mshot_image_copy_bottom) && (
                    <div style={{ flex: 1, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                      {detail.mshot_image_copy_top && (
                        <div>
                          <div style={fieldLabel}>{t('request.mshot_change_image_attach_area')} — {t('request.prodc_top')}</div>
                          <img src={`/media/${detail.mshot_image_copy_top}`} alt="top" style={imgStyle} />
                        </div>
                      )}
                      {detail.mshot_image_copy_bottom && (
                        <div>
                          <div style={fieldLabel}>{t('request.mshot_change_image_attach_area')} — {t('request.prodc_bottom')}</div>
                          <img src={`/media/${detail.mshot_image_copy_bottom}`} alt="bottom" style={imgStyle} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {(isR || isO || isP) && detail.only_prodc && (() => {
            const prodcChanged = ['only_prodc','prodc_top_line','prodc_top_process','prodc_top_product','prodc_middle_use','prodc_middle_line','prodc_middle_process','prodc_middle_product','prodc_bottom_line','prodc_bottom_process','prodc_bottom_product'].some((k) => changedFields.has(k));
            const revChanged = changedFields.has('rev_yn') || changedFields.has('rev_entries');
            const revYn = (detail as any).rev_yn as string | undefined;
            const revEntries = (detail as any).rev_entries as Array<{ layers: string[]; gds: string }> | undefined;
            return (
              <>
                <div style={rowStyle}>
                  <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200, ...(prodcChanged ? { border: '2px solid #dc3545' } : {}) }}>
                    <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                      <div style={fieldLabel}>{t('request.prodc_status')}</div>
                      <div style={fieldValue}>{detail.only_prodc}</div>
                    </div>
                    {isProdc && buildProdcInfo() && (
                      <div style={{ flex: 1 }}>
                        <div style={fieldLabel}>{t('approval.prodc_detail')}</div>
                        <div style={{ ...fieldValue, whiteSpace: 'pre-line' }}>{buildProdcInfo()}</div>
                      </div>
                    )}
                  </div>
                </div>
                {isProdc && revYn && (
                  <div style={rowStyle}>
                    <div style={{ ...chipBase, textAlign: 'left', flex: '1 1 auto', minWidth: 200, ...(revChanged ? { border: '2px solid #dc3545' } : {}) }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                        <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                          <div style={fieldLabel}>{t('request.rev_yn_label')}</div>
                          <div style={fieldValue}>{revYn}</div>
                        </div>
                        {revYn === 'YES' && Array.isArray(revEntries) && revEntries.length > 0 && (
                          <div style={{ flex: 1 }}>
                            <div style={{ ...fieldLabel, marginBottom: 6 }}>{t('request.rev_layer_gds')}</div>
                            {/* 카드형 + Layer pill (디자인 B) */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {revEntries.map((entry, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: '4px solid var(--accent)', borderRadius: 8, padding: '8px 12px' }}>
                                  <div style={{ flex: '0 0 auto', minWidth: 110 }}>
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('request.rev_gds')}</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--accent)' }}>{entry.gds}</div>
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {(entry.layers ?? []).map((layer, li) => (
                                      <span key={li} style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 999, padding: '2px 10px', fontSize: '0.78rem', fontWeight: 700 }}>{layer}</span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {(isR || isO || isP) && (() => {
            const mapOptionDefs = [
              { label: t('request.map_opt_photo_backside'), fieldKey: 'photo_backside', activeValue: '적용' },
              { label: t('request.map_opt_eds_backside'),   fieldKey: 'eds_backside',   activeValue: '적용' },
              { label: t('request.map_opt_tsv'),            fieldKey: 'tsv',            activeValue: '적용' },
              { label: t('request.map_opt_rf'),             fieldKey: 'rf',             activeValue: '적용' },
              { label: t('request.map_opt_fullchip'),       fieldKey: 'fullchip',       activeValue: '적용' },
              { label: t('request.map_opt_split'),          fieldKey: 'split',          activeValue: '적용' },
              { label: t('request.map_opt_st'),             fieldKey: 'st',             activeValue: '적용' },
              { label: t('request.map_opt_ecc'),            fieldKey: 'ecc',            activeValue: '적용' },
              { label: t('request.map_opt_labelsideshot'),  fieldKey: 'labelsideshot',  activeValue: '적용' },
              { label: t('request.map_opt_hpkglabelheight'), fieldKey: 'hpkglabelheight', activeValue: '적용' },
            ];
            const activeOptions = mapOptionDefs.filter(o => (detail as any)[o.fieldKey] === o.activeValue);
            const prevActiveOptions = mapOptionDefs.filter(o => (prevSnap?.detail as any)?.[o.fieldKey] === o.activeValue);
            const mapOptionChanged = mapOptionDefs.some(o => changedFields.has(o.fieldKey));

            const tagStyle = (active: boolean): React.CSSProperties => ({
              padding: '4px 14px',
              borderRadius: 6,
              background: active ? 'var(--accent)' : 'var(--bg-secondary)',
              color: active ? 'white' : 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 500,
            });

            return (
              <>
                {/* Inter — YES 일 때만, 버튼이 아닌 글자(코멘트)로 표시 (Xs/Ys 는 선택 시에만) */}
                {detail.inter === 'YES' && (
                  <div style={rowStyle}>
                    <div style={{ ...chipBase, textAlign: 'left', flex: '1 1 auto', minWidth: 200 }}>
                      <div style={fieldLabel}>{t('request.map_opt_inter')}</div>
                      <div style={fieldValue}>
                        {[
                          t('approval.inter_applied'),
                          detail.inter_xs === '적용' ? t('approval.inter_xs_applied') : null,
                          detail.inter_ys === '적용' ? t('approval.inter_ys_applied') : null,
                        ].filter(Boolean).join(' / ')}
                      </div>
                    </div>
                  </div>
                )}
                {/* Map Option — 별도 섹션 박스 */}
                <div style={rowStyle}>
                  <div style={{ ...chipBase, textAlign: 'left', flex: '1 1 auto', minWidth: 200, position: 'relative', ...(mapOptionChanged ? { border: '2px solid #dc3545' } : {}) }}>
                    {mapOptionChanged && (
                      <button
                        onClick={() => setMapHistOpen(true)}
                        style={{
                          position: 'absolute', top: 6, right: 8,
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0,
                        }}
                      >
                        이력 확인
                      </button>
                    )}
                    <div style={fieldLabel}>{t('request.map_option_title')}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      {activeOptions.length > 0
                        ? activeOptions.map(o => <div key={o.fieldKey} style={tagStyle(true)}>{o.label}</div>)
                        : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>없음</span>
                      }
                    </div>
                    {mapHistOpen && prevSnap && (
                      <Modal isOpen onClose={() => setMapHistOpen(false)} title={`${t('request.map_option_title')} 변경 이력`}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          <div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>이전 (재상신 전)</div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {prevActiveOptions.length > 0
                                ? prevActiveOptions.map(o => <div key={o.fieldKey} style={tagStyle(true)}>{o.label}</div>)
                                : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>없음</span>
                              }
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>현재 (최신)</div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {activeOptions.length > 0
                                ? activeOptions.map(o => <div key={o.fieldKey} style={tagStyle(true)}>{o.label}</div>)
                                : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>없음</span>
                              }
                            </div>
                          </div>
                        </div>
                      </Modal>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      ),
    });
  }

  if (showJayer) {
    pages.push({
      label: t('request.job_li'),
      content: (
        <div style={cardStyle}>
          <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('request.job_li')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>전체 {jayer.length}건</span>
              <button data-tour="export-jayer" onClick={exportJayer} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 export</button>
            </div>
          </div>
          <JayerTable rows={jayer} changedRowIds={changedJayerIds} prevRowMap={prevJayerMap} />
        </div>
      ),
    });
  }
  if (showOayer) {
    pages.push({
      label: t('request.ovl_li'),
      content: (() => {
        const OayerTabs = () => {
          const [activeTab, setActiveTab] = React.useState<'table' | 'info'>('table');
          const tbvtlvEntries = detail.tbvtlv_entries ?? [];
          const infoHasData = detail.partial_shot !== '' || tbvtlvEntries.length > 0 || (detail.tbvtlv_thickness ?? '') !== '';
          return (
            <div style={cardStyle}>
              <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('request.ovl_li')}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>전체 {oayer.length}건</span>
                  <button onClick={exportOayer} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 export</button>
                </div>
              </div>
              {/* 탭 버튼 */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '2px solid var(--border)' }}>
                {([
                  { key: 'table', label: t('request.ovl_tab_table') },
                  { key: 'info',  label: t('request.ovl_tab_info') },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    style={{
                      padding: '7px 18px',
                      fontSize: '0.85rem',
                      fontWeight: activeTab === tab.key ? 700 : 400,
                      color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                      marginBottom: -2,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    {tab.label}
                    {tab.key === 'info' && infoHasData && (
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4CAF50', display: 'inline-block' }} />
                    )}
                  </button>
                ))}
              </div>
              {activeTab === 'table' && (
                <OayerTable rows={oayer} changedRowIds={changedOayerIds} prevRowMap={prevOayerMap} />
              )}
              {activeTab === 'info' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13 }}>
                  {/* Partial Shot */}
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('request.partial_shot')}</div>
                    <div>
                      {detail.partial_shot
                        ? <span style={{ padding: '4px 14px', borderRadius: 4, background: 'var(--accent)', color: '#fff', fontWeight: 700 }}>{detail.partial_shot}</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>
                      }
                    </div>
                  </div>
                  {/* TBV/TLV */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('request.tbvtlv')}</div>
                    {(detail.tbvtlv_thickness ?? '') !== '' && (
                      <div style={{ marginBottom: 10 }}>
                        <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{t('request.tbvtlv_thickness')}:</span>
                        <span style={{ fontWeight: 600 }}>{detail.tbvtlv_thickness}</span>
                      </div>
                    )}
                    {tbvtlvEntries.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                        {tbvtlvEntries.map((entry, idx) => (
                          <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', width: 'fit-content' }}>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                              {t('request.tbvtlv_sd_select')}: <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{entry.sds.join(', ')}</b>
                            </div>
                            {entry.noteRows && entry.noteRows.length > 0 ? (
                              <table style={{ borderCollapse: 'collapse', width: 'fit-content', fontSize: '0.8rem' }}>
                                <thead>
                                  <tr>
                                    <th style={tbvDetailThStyle}>{t('request.tbvtlv_no')}</th>
                                    <th style={tbvDetailThStyle}>{t('request.tbvtlv_x')}</th>
                                    <th style={tbvDetailThStyle}>{t('request.tbvtlv_y')}</th>
                                    <th style={tbvDetailThStyle}>{t('request.tbvtlv_used')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.noteRows.map((row, i) => (
                                    <tr key={row.id}>
                                      <td style={{ ...tbvDetailTdStyle, color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</td>
                                      <td style={tbvDetailTdStyle}>{row.x || '—'}</td>
                                      <td style={tbvDetailTdStyle}>{row.y || '—'}</td>
                                      <td style={tbvDetailTdStyle}>{row.used}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              // 과거(문자열 자유 입력) 저장분 하위 호환
                              <span style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{entry.note || '—'}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        };
        return <OayerTabs />;
      })(),
    });
  }
  if (showBb) {
    pages.push({
      label: t('request.bb_li'),
      content: (
        <div style={cardStyle}>
          <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('request.bb_li')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>전체 {bb.length}건</span>
              <button onClick={exportBb} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 export</button>
            </div>
          </div>
          <BbTable rows={bb} changedRowIds={changedBbIds} prevRowMap={prevBbMap} tabCount={Array.isArray(detail?.bb_entries) ? detail.bb_entries.length : 0} entryIds={Array.isArray(detail?.bb_entries) ? detail.bb_entries.map((e: { id?: string }) => e.id ?? '') : []} />
        </div>
      ),
    });
  }

  // ===== 결재 현황 페이지 =====
  const allSteps = doc.approval_steps ?? [];
  const maxRound = allSteps.reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;
  const rounds = Array.from({ length: maxRound }, (_, i) => i + 1);

  const getStep = (agent: string, round: number) =>
    allSteps.find((s) => s.agent === agent && (s.round ?? 1) === round);

  const hasPlel = (() => {
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      return (parsed?.jayerRows ?? []).some((r: any) => r.pp?.toLowerCase().includes('plel'));
    } catch { return false; }
  })();

  const isOnlyMap = (() => {
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      return parsed?.detail?.request_purpose === 'Only MAP';
    } catch { return false; }
  })();

  // 통보처: 결재 경로와 별개로 표시(결재 권한 없음). detail.notifiers 에서 이름만 읽는다.
  const notifiers: { loginid: string; name: string }[] = (() => {
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      const arr = parsed?.detail?.notifiers;
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  })();

  // 각 회차 상신 날짜: round=1은 doc.submitted_at, 이후 회차는 해당 R 단계의 created_at
  const getRoundSubmittedAt = (round: number): string | null => {
    if (round === 1) return doc.submitted_at ?? null;
    const rStep = allSteps.find((s) => s.agent === 'R' && (s.round ?? 1) === round);
    return rStep?.created_at ?? null;
  };

  // 완료 날짜: 승인된 마지막 단계의 acted_at
  const getApprovedAt = (): string | null => {
    const approved = allSteps.filter((s) => s.action === 'approved' && s.acted_at);
    if (!approved.length) return null;
    return approved.reduce((a, b) =>
      new Date(a.acted_at!) > new Date(b.acted_at!) ? a : b
    ).acted_at;
  };

  const formatDateTime = (d: string | null | undefined): string =>
    d ? new Date(d).toLocaleDateString('ko-KR') : '-';

  const formatDateTimeShort = (d: string | null | undefined): string => {
    if (!d) return '-';
    const dt = new Date(d);
    const date = dt.toLocaleDateString('ko-KR');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    const ss = String(dt.getSeconds()).padStart(2, '0');
    return `${date} ${hh}:${mm}:${ss}`;
  };

  type StepDisplayInfo = {
    status: 'approved' | 'rejected' | 'reviewing' | 'unassigned' | 'waiting' | 'na';
    label: string;
    roleLabel?: string; // R단계 내 역할 구분(합의자/검토자)
    assignee?: string;
    email?: string;
    date?: string;
    comment?: string;
    dueDate?: string;
  };

  // 단일 ApprovalStep → 표시 정보
  const stepToInfo = (s: NonNullable<ReturnType<typeof getStep>>): StepDisplayInfo => {
    const dueDate = s.due_date ? s.due_date.slice(5).replace('-', '/') : undefined; // MM/DD
    const email = s.assignee_mail || undefined;
    if (s.action === 'approved') return {
      status: 'approved', label: t('approval.agree'),
      assignee: s.assignee_name || undefined, email,
      date: formatDateTime(s.acted_at),
      comment: s.comment || undefined,
    };
    if (s.action === 'rejected') return {
      status: 'rejected', label: t('approval.reject'),
      assignee: s.assignee_name || undefined, email,
      date: formatDateTime(s.acted_at),
      comment: s.comment || undefined,
    };
    // pending
    if (!s.assignee_name) return { status: 'unassigned', label: t('approval.step_unassigned'), dueDate };
    return { status: 'reviewing', label: t('common.status_under_review'), assignee: s.assignee_name || undefined, email, dueDate };
  };

  // 한 단계(agent·round)의 표시 정보 목록. PL/J 등 다중 담당자는 담당자별로 여러 항목을 반환한다.
  const getStepDisplays = (agent: string, round: number): StepDisplayInfo[] => {
    if (agent === 'E' && !hasPlel) {
      return [{ status: 'na', label: t('approval.step_na') }];
    }
    if (isOnlyMap && ['P', 'J', 'O', 'E'].includes(agent)) {
      return [{ status: 'na', label: t('approval.step_na') }];
    }
    // R단계: 합의자(R) + 검토자(RV, 지정 시)를 한 행에 함께 표시
    if (agent === 'R') {
      const out: StepDisplayInfo[] = [];
      const rSteps = allSteps.filter((s) => s.agent === 'R' && (s.round ?? 1) === round);
      if (rSteps.length === 0) {
        out.push({ status: 'waiting', label: t('approval.step_pending'), roleLabel: t('approval.role_agreer' as any) });
      } else {
        rSteps.forEach((s) => out.push({ ...stepToInfo(s), roleLabel: t('approval.role_agreer' as any) }));
      }
      const rvSteps = allSteps.filter((s) => s.agent === 'RV' && (s.round ?? 1) === round);
      rvSteps.forEach((s) => out.push({ ...stepToInfo(s), roleLabel: t('approval.stage_reviewer' as any) }));
      return out;
    }
    const steps = allSteps.filter((s) => s.agent === agent && (s.round ?? 1) === round);
    if (steps.length === 0) return [{ status: 'waiting', label: t('approval.step_pending') }];
    return steps.map(stepToInfo);
  };

  const statusBadgeStyle = (status: StepDisplayInfo['status']): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
    };
    const colors: Record<StepDisplayInfo['status'], React.CSSProperties> = {
      approved:   { background: 'rgba(5,150,105,0.1)',   color: '#059669' },
      rejected:   { background: 'rgba(220,38,38,0.1)',   color: '#dc2626' },
      reviewing:  { background: 'rgba(217,119,6,0.1)',   color: '#d97706' },
      unassigned: { background: 'rgba(107,138,176,0.15)', color: '#6b8ab0' },
      waiting:    { background: 'rgba(107,138,176,0.1)', color: '#adb5bd' },
      na:         { background: 'rgba(107,138,176,0.1)', color: '#adb5bd' },
    };
    return { ...base, ...colors[status] };
  };

  const teamRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    padding: '8px 0', borderBottom: '1px solid var(--border)',
  };

  const teamLabelStyle: React.CSSProperties = {
    minWidth: 64, fontWeight: 700, fontSize: '0.82rem',
    color: 'var(--text-primary)', paddingTop: 2,
  };

  // 이름 옆 이메일 표시 스타일 (결재 경로 탭)
  const emailStyle: React.CSSProperties = {
    color: 'var(--text-muted)', fontSize: '0.75rem',
  };

  const historyListStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4, flex: 1,
  };

  const historyItemStyle = (isCurrent: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
    padding: '4px 8px', borderRadius: 6,
    background: isCurrent ? 'rgba(37,99,235,0.05)' : 'transparent',
    fontSize: '0.82rem',
  });

  // 검토자(RV)는 R단계 행에 합의자와 함께 표시(getStepDisplays). 후결자(RA)는 R단계 다음 위치에 표시.
  const AGENTS: Array<{ key: string; label: string }> = [
    { key: 'PL', label: t('approval.agent_PL' as any) },
    { key: 'R', label: t('approval.agent_R') },
    { key: 'RA', label: t('approval.agent_RA' as any) },
    { key: 'P', label: t('approval.agent_P') },
    { key: 'J', label: t('approval.agent_J') },
    { key: 'O', label: t('approval.agent_O') },
    { key: 'E', label: t('approval.agent_E') },
  ];

  pages.push({
    label: t('approval.tab_route'),
    content: (
      <div style={cardStyle} data-tour="approval-route-tab">
        <div style={sectionTitle}>{t('approval.tab_route')}</div>

        {/* 상신자 행 */}
        <div style={teamRowStyle}>
          <div style={teamLabelStyle}>{t('approval.label_requester')}</div>
          <div style={historyListStyle}>
            {rounds.map((r) => {
              const isCurrent = r === maxRound;
              const date = formatDateTimeShort(getRoundSubmittedAt(r));
              return (
                <div key={r} style={historyItemStyle(isCurrent)}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', minWidth: 40 }}>{r}회차</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{doc.requester_name}</span>
                  {doc.requester_email && <span style={emailStyle}>{doc.requester_email}</span>}
                  {date && date !== '-' && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{date}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 통보처: 의뢰자 바로 다음에 표시. 결재 개념 없이 이름·이메일만 나열, 없으면 숨김. */}
        {notifiers.length > 0 && (
          <div style={teamRowStyle}>
            <div style={teamLabelStyle}>{t('approval.label_notifier')}</div>
            <div style={historyListStyle}>
              <div style={historyItemStyle(false)}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                  {notifiers.map((n) => (
                    <span key={n.loginid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{n.name}</span>
                      {doc.notifier_mails?.[n.loginid] && (
                        <span style={emailStyle}>{doc.notifier_mails[n.loginid]}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 팀별 행 */}
        {AGENTS.map(({ key, label }) => (
          <div key={key} style={teamRowStyle}>
            <div style={teamLabelStyle}>{label}</div>
            <div style={historyListStyle}>
              {(key === 'E' && !hasPlel) || (isOnlyMap && ['P', 'J', 'O', 'E'].includes(key)) ? (
                <div style={historyItemStyle(false)}>
                  <span style={{ ...statusBadgeStyle('na') }}>{t('approval.step_na')}</span>
                </div>
              ) : (
                rounds.map((r) => {
                  const isCurrent = r === maxRound;
                  const infos = getStepDisplays(key, r);
                  return (
                    <div key={r} style={historyItemStyle(isCurrent)}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', minWidth: 40 }}>{r}회차</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                        {infos.map((info, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                            {info.roleLabel && (
                              <span style={{ minWidth: 48, fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{info.roleLabel}</span>
                            )}
                            <span style={statusBadgeStyle(info.status)}>{info.label}</span>
                            {info.assignee && (
                              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{info.assignee}</span>
                            )}
                            {info.email && (
                              <span style={emailStyle}>{info.email}</span>
                            )}
                            {info.date && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{info.date}</span>
                            )}
                            {info.dueDate && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                {t('approval.col_due_date')}: {info.dueDate}
                              </span>
                            )}
                            {info.comment && (
                              <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.78rem', whiteSpace: 'pre-wrap' }}>
                                "{info.comment}"
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}

        {/* 완료 행 */}
        <div style={{ ...teamRowStyle, borderBottom: 'none' }}>
          <div style={teamLabelStyle}>{t('approval.step_done')}</div>
          <div style={historyListStyle}>
            <div style={historyItemStyle(true)}>
              {doc.status === 'approved' ? (
                <>
                  <span style={statusBadgeStyle('approved')}>{t('approval.step_done')}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{formatDateTime(getApprovedAt())}</span>
                </>
              ) : doc.status === 'under_review' ? (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('common.status_under_review')}</span>
              ) : null}
            </div>
          </div>
        </div>

      </div>
    ),
  });

  const safeIdx = Math.min(pageIdx, pages.length - 1);
  const currentPage = pages[safeIdx];

  return (
    <div>
      {pages.length > 1 && (
        <div data-tour="detail-tabs" style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 20, gap: 0 }}>
          {pages.map((page, idx) => {
            const isActive = idx === safeIdx;
            return (
              <button
                key={idx}
                onClick={() => setPageIdx(idx)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -2,
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontWeight: isActive ? 700 : 400,
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '0.9rem',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s',
                }}
              >
                {page.label}
              </button>
            );
          })}
        </div>
      )}
      {currentPage.content}
    </div>
  );
}
