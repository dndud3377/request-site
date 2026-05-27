import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { RequestDocument, UserRole, DetailFormState, FlowChartRow, JayerRow, OayerRow, BbTableRow, HistorySnapshot } from '../types';
import Modal from './Modal';

const ST_CELL_COLOR: Record<string, string> = {
  'O (D)':   '#D4F5E2',
  'O (혼용)': '#FFE0EC',
  'X':        '#f3f4f6',
};

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
        <RowDiffModal title="J-ayer 행 변경 이력" fields={fields} curRow={diffCur as any} prevRow={diffPrev as any} onClose={() => setDiffId(null)} />
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
                        <button style={histBtnStyle} onClick={() => setDiffId(r.id)}>이력 확인</button>
                      )}
                    </td>
                  )}
                  <td>{r.updated || '-'}</td><td>{r.process_id}</td><td>{r.sp}</td><td>{r.sd}</td><td style={{ backgroundColor: r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }}>{r.pp}</td><td style={{ backgroundColor: ST_CELL_COLOR[r.st] }}>{r.st}</td><td style={{ backgroundColor: r.new_or_copy === '차용' ? '#eff6ff' : undefined }}>{r.new_or_copy}</td><td>{r.product_name}</td><td>{r.step}</td><td>{r.item_id}</td>
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
    { key: 'pp',           label: t('request.col_pp') },
    { key: 'st',           label: t('request.col_st') },
    { key: 'new_or_copy',  label: t('request.col_new_or_copy') },
    { key: 'product_name', label: t('request.col_product_name') },
    { key: 'step',         label: t('request.col_step') },
    { key: 'tt',           label: t('request.col_tt') },
  ];
  const hasPrev = (prevRowMap?.size ?? 0) > 0;
  return (
    <>
      {diffCur && diffPrev && (
        <RowDiffModal title="O-ayer 행 변경 이력" fields={fields} curRow={diffCur as any} prevRow={diffPrev as any} onClose={() => setDiffId(null)} />
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table table-compact" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              {hasPrev && <th style={{ width: 64 }}></th>}
              <th>Update 날짜</th><th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_pp')}</th><th>{t('request.col_st')}</th><th>{t('request.col_new_or_copy')}</th><th>{t('request.col_product_name')}</th><th>{t('request.col_step')}</th><th>{t('request.col_tt')}</th>
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
                  <td>{r.updated || '-'}</td><td>{r.process_id}</td><td>{r.sp}</td><td>{r.sd}</td><td style={{ backgroundColor: r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }}>{r.pp}</td><td style={{ backgroundColor: ST_CELL_COLOR[r.st] }}>{r.st}</td><td style={{ backgroundColor: r.new_or_copy === '차용' ? '#eff6ff' : undefined }}>{r.new_or_copy}</td><td>{r.product_name}</td><td>{r.step}</td><td>{r.tt}</td>
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
}: {
  rows: BbTableRow[];
  changedRowIds?: Set<string>;
  prevRowMap?: Map<string, BbTableRow>;
}) {
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
    { key: 'bb_step',       label: t('request.col_bb_layer') },
    { key: 'bb_ss',         label: t('request.col_bb_stepseq') },
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
              <th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_bb_process_id')}</th><th>{t('request.col_bb_partid')}</th><th>{t('request.col_bb_layer')}</th><th>{t('request.col_bb_stepseq')}</th><th>{t('request.col_remark')}</th>
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
                  <td>{r.process_id}</td><td>{r.ss}</td><td>{r.sd}</td><td>{r.bb_process_id}</td><td>{r.bb_name}</td><td>{r.bb_step}</td><td>{r.bb_ss}</td><td>{r.remark}</td>
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

  const exportJayer = () => {
    const activeRows = jayer.filter(r => !r.disabled);
    const data = activeRows.map(r => ({
      'Update 날짜':           r.updated ?? '',
      [t('request.process_id')]:    r.process_id,
      [t('request.col_sp')]:        r.sp,
      [t('request.col_sd')]:        r.sd,
      [t('request.col_layer')]:     r.layerid ?? '',
      [t('request.col_pp')]:        r.pp,
      [t('request.col_st')]:        r.st,
      [t('request.col_new_or_copy')]: r.new_or_copy,
      [t('request.col_product_name')]: r.product_name,
      [t('request.col_step')]:      r.step,
      [t('request.col_item_id')]:   r.item_id,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'JOB');
    XLSX.writeFile(wb, `${doc.title}_JOB_${getNowString()}.xlsx`);
  };

  const exportOayer = () => {
    const activeRows = oayer.filter(r => !r.disabled);
    const data = activeRows.map(r => ({
      'Update 날짜':           r.updated ?? '',
      [t('request.process_id')]:    r.process_id,
      [t('request.col_sp')]:        r.sp,
      [t('request.col_sd')]:        r.sd,
      [t('request.col_pp')]:        r.pp,
      [t('request.col_st')]:        r.st,
      [t('request.col_new_or_copy')]: r.new_or_copy,
      [t('request.col_product_name')]: r.product_name,
      [t('request.col_step')]:      r.step,
      [t('request.col_tt')]:        r.tt,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'OVL');
    XLSX.writeFile(wb, `${doc.title}_OVL_${getNowString()}.xlsx`);
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
  const isR = role === 'TE_R' || role === 'MASTER' || isPL;
  const isJ = role === 'TE_J' || role === 'MASTER' || isPL;
  const isO = role === 'TE_O' || role === 'MASTER' || isPL;

  const showJayer = isJ || isO;
  const showOayer = isO;
  const showBb = isJ || isO;
  const showFlowChart = isJ || isO;

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

  const purposeValue = detail.request_purpose
    ? (detail.other_purpose ? `${detail.request_purpose}(${detail.other_purpose})` : detail.request_purpose)
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
                  <Chip label={t('request.customer_name')} value={detail.customer_name} changed={changedFields.has('customer_name')} fieldKey="customer_name" />
                )}
                {detail.customer_requirement && (
                  <Chip label={t('request.customer_requirement')} value={detail.customer_requirement} style={chipWide} changed={changedFields.has('customer_requirement')} fieldKey="customer_requirement" />
                )}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={sectionTitle}>{t('approval.section_detail')}</div>

            {(isR || isJ) && (detail.source_line || detail.source_partid) && (
              <div style={rowStyle}>
                <Chip label={t('request.source_line')} value={detail.source_line} changed={changedFields.has('source_line')} fieldKey="source_line" />
                <Chip label={t('request.source_partid_selection')} value={detail.source_partid} changed={changedFields.has('source_partid')} fieldKey="source_partid" />
              </div>
            )}

            {(isJ || isO) && detail.bb_zone && (() => {
              const bbValue = Array.isArray(detail.bb_entries) && detail.bb_entries.length > 0
                ? detail.bb_entries.map((e: { location: string; product: string; process_id: string }, i: number) =>
                    `[${i + 1}] 위치: ${e.location || '-'} / 제품: ${e.product || '-'} / 조리법: ${e.process_id || '-'}`
                  ).join(' / ')
                : '-';
              const bbChanged = changedFields.has('bb_zone') || changedFields.has('bb_entries');
              return (
                <div style={rowStyle}>
                  <Chip label={t('request.bb_status')} value={bbValue} style={chipWide} changed={bbChanged} fieldKey="bb_zone" />
                </div>
              );
            })()}

            {((isO && !isR && !isJ) || role === 'MASTER' || isPL) && detail.change_purpose_note && (
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

  const showMap = isR || isO;
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

          {(isR || isO || isJ) && (detail.map_change || detail.ea_change) && (
            <div style={rowStyle}>
              {(isR || isO) && detail.map_change && (() => {
                const mapValue = `변경: ${detail.map_change}${detail.map_value_x ? ` / X: ${detail.map_value_x}` : ''}${detail.map_value_y ? ` / Y: ${detail.map_value_y}` : ''}${detail.map_reason ? ` / 사유: ${detail.map_reason}` : ''}`;
                const mapChanged = changedFields.has('map_change') || changedFields.has('map_value_x') || changedFields.has('map_value_y') || changedFields.has('map_reason');
                return (
                  <Chip label={t('request.map')} value={mapValue} style={chipWide} changed={mapChanged} fieldKey="map_change" />
                );
              })()}
              {isR && detail.ea_change && (() => {
                const eaValue = `변경: ${detail.ea_change}${detail.ea_value ? ` / 값: ${detail.ea_value}` : ''}`;
                const eaChanged = changedFields.has('ea_change') || changedFields.has('ea_value');
                return (
                  <Chip label={t('request.ea_change')} value={eaValue} style={chipWide} changed={eaChanged} fieldKey="ea_change" />
                );
              })()}
            </div>
          )}

          {isR && detail.mshot_change && (() => {
            const mshotChanged = changedFields.has('mshot_change') || changedFields.has('mshot_image_copy');
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
                  {mshotHasDetail && detail.mshot_image_copy && (
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>{t('request.mshot_change_image_attach_area')}</div>
                      <img
                        src={`/media/${detail.mshot_image_copy}`}
                        alt="attached"
                        style={{
                          maxWidth: '300px',
                          maxHeight: '200px',
                          borderRadius: '4px',
                          border: '1px solid #ddd',
                          marginTop: '8px'
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {isR && detail.only_prodc && (() => {
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
                          <div style={fieldLabel}>REV 여부</div>
                          <div style={fieldValue}>{revYn}</div>
                        </div>
                        {revYn === 'YES' && Array.isArray(revEntries) && revEntries.length > 0 && (
                          <div style={{ flex: 1 }}>
                            <div style={fieldLabel}>Layer / GDS version</div>
                            <table style={{ borderCollapse: 'collapse', marginTop: 4, fontSize: '12px' }}>
                              <thead>
                                <tr>
                                  <th style={{ border: '1px solid #ddd', padding: '3px 8px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>Layer</th>
                                  <th style={{ border: '1px solid #ddd', padding: '3px 8px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>GDS version</th>
                                </tr>
                              </thead>
                              <tbody>
                                {revEntries.map((entry, idx) => (
                                  <tr key={idx}>
                                    <td style={{ border: '1px solid #ddd', padding: '3px 8px', whiteSpace: 'nowrap' }}>{entry.layers?.join(', ')}</td>
                                    <td style={{ border: '1px solid #ddd', padding: '3px 8px', whiteSpace: 'nowrap' }}>{entry.gds}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {isR && (() => {
            const mapOptionDefs = [
              { label: t('request.backside_adjust'),         fieldKey: 'backside_status', activeValue: 'Yes'      },
              { label: t('request.split_progress_status'),   fieldKey: 'split_progress',  activeValue: '예'       },
              { label: t('request.tmap_application_status'), fieldKey: 'tmap_apply',      activeValue: '적용'     },
              { label: t('request.hplhc_status'),            fieldKey: 'hplhc_change',    activeValue: '변경 있음'},
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
              <div style={{ position: 'relative', ...(mapOptionChanged ? { border: '2px solid #dc3545', borderRadius: 6, padding: '10px 12px' } : {}) }}>
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
                <div style={{ ...fieldLabel, marginBottom: 6 }}>{t('request.map_option_title')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {activeOptions.map(o => (
                    <div key={o.fieldKey} style={tagStyle(true)}>{o.label}</div>
                  ))}
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
              <button onClick={exportJayer} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 export</button>
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
      content: (
        <div style={cardStyle}>
          <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('request.ovl_li')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>전체 {oayer.length}건</span>
              <button onClick={exportOayer} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 export</button>
            </div>
          </div>
          <OayerTable rows={oayer} changedRowIds={changedOayerIds} prevRowMap={prevOayerMap} />
        </div>
      ),
    });
  }
  if (showBb) {
    pages.push({
      label: t('request.bb_li'),
      content: (
        <div style={cardStyle}>
          <div style={sectionTitle}>{t('request.bb_li')}</div>
          <BbTable rows={bb} changedRowIds={changedBbIds} prevRowMap={prevBbMap} />
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
    assignee?: string;
    date?: string;
    comment?: string;
  };

  const getStepDisplay = (agent: string, round: number): StepDisplayInfo => {
    if (agent === 'E' && !hasPlel) {
      return { status: 'na', label: t('approval.step_na') };
    }
    const s = getStep(agent, round);
    if (!s) return { status: 'waiting', label: t('approval.step_pending') };
    if (s.action === 'approved') return {
      status: 'approved', label: t('approval.agree'),
      assignee: s.assignee_name || undefined,
      date: formatDateTime(s.acted_at),
      comment: s.comment || undefined,
    };
    if (s.action === 'rejected') return {
      status: 'rejected', label: t('approval.reject'),
      assignee: s.assignee_name || undefined,
      date: formatDateTime(s.acted_at),
      comment: s.comment || undefined,
    };
    // pending
    if (!s.assignee_name) return { status: 'unassigned', label: t('approval.step_unassigned') };
    return { status: 'reviewing', label: t('common.status_under_review'), assignee: s.assignee_name };
  };

  const statusBadgeStyle = (status: StepDisplayInfo['status']): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
    };
    const colors: Record<StepDisplayInfo['status'], React.CSSProperties> = {
      approved:   { background: '#d4edda', color: '#155724' },
      rejected:   { background: '#f8d7da', color: '#721c24' },
      reviewing:  { background: '#cce5ff', color: '#004085' },
      unassigned: { background: '#e2e3e5', color: '#383d41' },
      waiting:    { background: '#f0f0f0', color: '#adb5bd' },
      na:         { background: '#f0f0f0', color: '#adb5bd' },
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

  const historyListStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4, flex: 1,
  };

  const historyItemStyle = (isCurrent: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
    padding: '4px 8px', borderRadius: 6,
    background: isCurrent ? 'rgba(37,99,235,0.05)' : 'transparent',
    fontSize: '0.82rem',
  });

  const AGENTS: Array<{ key: string; label: string }> = [
    { key: 'R', label: t('approval.agent_R') },
    { key: 'J', label: t('approval.agent_J') },
    { key: 'O', label: t('approval.agent_O') },
    { key: 'E', label: t('approval.agent_E') },
  ];

  pages.push({
    label: t('approval.title'),
    content: (
      <div style={cardStyle}>
        <div style={sectionTitle}>{t('approval.title')}</div>

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
                  {date && date !== '-' && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{date}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 팀별 행 */}
        {AGENTS.map(({ key, label }) => (
          <div key={key} style={teamRowStyle}>
            <div style={teamLabelStyle}>{label}</div>
            <div style={historyListStyle}>
              {key === 'E' && !hasPlel ? (
                <div style={historyItemStyle(false)}>
                  <span style={{ ...statusBadgeStyle('na') }}>{t('approval.step_na')}</span>
                </div>
              ) : (
                rounds.map((r) => {
                  const isCurrent = r === maxRound;
                  const info = getStepDisplay(key, r);
                  return (
                    <div key={r} style={historyItemStyle(isCurrent)}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', minWidth: 40 }}>{r}회차</span>
                      <span style={statusBadgeStyle(info.status)}>{info.label}</span>
                      {info.assignee && (
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{info.assignee}</span>
                      )}
                      {info.date && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{info.date}</span>
                      )}
                      {info.comment && (
                        <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.78rem' }}>
                          "{info.comment}"
                        </span>
                      )}
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
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 20, gap: 0 }}>
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
