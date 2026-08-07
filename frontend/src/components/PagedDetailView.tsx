import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ExcelJS from 'exceljs';
import { RequestDocument, UserRole, DetailFormState, ValidationSystemValue, FlowChartRow, JayerRow, OayerRow, BbTableRow, HistorySnapshot, MergePair, MergeRowInfo, AdiCdStep } from '../types';
import Modal from './Modal';
import { ST_CELL_COLOR } from '../utils/stCellColor';
import { bbTabColor } from '../utils/bbTabColors';
import { VALIDATION_CELL_COLOR, VS_TARGET, VS_NONTARGET, VS_NA, isMapDeleteEditType } from '../pages/RequestPage/constants';
import { isValidationKeywordRow, isValidationTarget } from '../pages/RequestPage/helpers';
import { ValidationSystemBadge, ValidationSystemToggle, useValidationSystemLabel } from './ValidationSystem';

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

/**
 * 참조 요청서 Merge 의 변경전/변경후 표 (읽기 전용).
 * 작성 화면(BeforeAfterPanel)의 확정 표와 같은 형식 — 미등록은 5칸을 합쳐 한 줄로 보여준다.
 */
function MergePairsTable({ pairs }: { pairs: MergePair[] }) {
  const { t } = useTranslation();
  const fields: (keyof MergeRowInfo)[] = ['process_id', 'sp', 'sd', 'pp', 'layerid'];

  const cells = (info: MergeRowInfo | null, other: MergeRowInfo | null) => {
    if (!info) {
      return <td colSpan={5} className="ba-cell-unreg">{t('request.ba_unregistered')}</td>;
    }
    return (
      <>
        {fields.map((f) => (
          <td key={f} className={other && other[f] !== info[f] ? 'ba-cell-changed' : undefined}>
            {info[f] || '—'}
          </td>
        ))}
      </>
    );
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ba-table ba-result-table">
        <thead>
          <tr>
            <th rowSpan={2}>{t('request.ba_table_division')}</th>
            <th colSpan={5} className="ba-group-before">{t('request.ba_before_col')}</th>
            <th colSpan={5} className="ba-group-after">{t('request.ba_after_col')}</th>
            <th rowSpan={2}>{t('request.ba_kind')}</th>
          </tr>
          <tr>
            {(['before', 'after'] as const).map((side) => fields.map((f) => (
              <th key={`${side}_${f}`} className={side === 'before' ? 'ba-group-before' : 'ba-group-after'}>
                {t(f === 'process_id' ? 'request.process_id'
                  : f === 'layerid' ? 'request.col_layer'
                  : `request.col_${f}`)}
              </th>
            )))}
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair, i) => (
            <tr key={`${pair.beforeId ?? 'none'}_${pair.afterId ?? 'none'}_${i}`}>
              <td>
                <span className={`ba-badge ba-badge-${pair.table === 'J' ? 'j' : 'o'}`}>
                  {t(pair.table === 'J' ? 'request.jayer' : 'request.oayer')}
                </span>
              </td>
              {cells(pair.before, pair.after)}
              {cells(pair.after, pair.before)}
              <td><span className={`ba-badge ba-badge-${pair.kind}`}>{t(`request.ba_kind_${pair.kind}`)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ADI CD 변경 — 변경전/변경후 스텝 표 (읽기 전용). 작성 화면(AdiCdPanel)과 같은 좌/우 구성. */
function AdiCdStepsTable({ before, after, deleteAll }: { before: AdiCdStep[]; after: AdiCdStep[]; deleteAll: boolean }) {
  const { t } = useTranslation();
  const filled = (rows: AdiCdStep[]) => rows.filter((r) => r.step_id.trim() || r.step_desc.trim());
  const beforeRows = filled(before);
  const afterRows = filled(after);

  const renderTable = (rows: AdiCdStep[]) => (
    <table className="table" style={{ fontSize: '0.8rem' }}>
      <thead><tr><th>STEP_ID</th><th>STEP_DESC</th></tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.step_id}</td><td>{r.step_desc}</td></tr>)}
        {rows.length === 0 && (
          <tr><td colSpan={2} style={{ color: 'var(--text-muted)' }}>{t('common.no_data')}</td></tr>
        )}
      </tbody>
    </table>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: 4 }}>{t('request.adi_cd_before')}</div>
        {renderTable(beforeRows)}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: 4 }}>{t('request.adi_cd_after')}</div>
        {deleteAll
          ? <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('request.adi_cd_delete_all_note')}</div>
          : renderTable(afterRows)}
      </div>
    </div>
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

// ===== Row Diff Modal (가로형: 원본 표 형식 유지) =====

interface DiffField { key: string; label: string; format?: (v: any) => string; }

// 표 행 변경 전/후를 원본 표와 동일한 가로 형식(헤더=필드, 변경 전/후 2행)으로 비교
function RowDiffModal({
  title, fields, curRow, prevRow, onClose,
}: {
  title: string;
  fields: DiffField[];
  curRow: Record<string, any>;
  prevRow: Record<string, any>;
  onClose: () => void;
}) {
  const cell = (f: DiffField, row: Record<string, any>) =>
    (f.format ? f.format(row[f.key]) : String(row[f.key] ?? '')) || '';
  const thS: React.CSSProperties = {
    padding: '5px 10px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)',
    whiteSpace: 'nowrap', textAlign: 'center',
  };
  const rowHeadS: React.CSSProperties = {
    padding: '5px 12px', fontSize: '0.78rem', fontWeight: 800, whiteSpace: 'nowrap',
    background: 'var(--bg-secondary)', textAlign: 'left',
  };
  const tdS: React.CSSProperties = { padding: '5px 10px', fontSize: '0.82rem', textAlign: 'center', whiteSpace: 'nowrap' };
  const changed = fields.map((f) => cell(f, prevRow) !== cell(f, curRow));
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={thS}></th>
              {fields.map((f, i) => (
                <th key={f.key} style={{ ...thS, color: changed[i] ? '#dc3545' : 'var(--text-muted)' }}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...rowHeadS, color: '#dc3545' }}>변경 전</td>
              {fields.map((f, i) => (
                <td key={f.key} style={{ ...tdS, color: changed[i] ? '#dc3545' : 'var(--text-primary)', background: changed[i] ? 'rgba(220,53,69,0.06)' : undefined }}>{cell(f, prevRow) || '-'}</td>
              ))}
            </tr>
            <tr>
              <td style={{ ...rowHeadS, color: '#155724' }}>변경 후</td>
              {fields.map((f, i) => (
                <td key={f.key} style={{ ...tdS, color: changed[i] ? '#155724' : 'var(--text-primary)', fontWeight: changed[i] ? 700 : 400, background: changed[i] ? 'rgba(21,87,36,0.06)' : undefined }}>{cell(f, curRow) || '-'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// 지도 편차/C가문 판정에 쓰는 저장값(백엔드 저장 문자열과 동일)
const MAP_NO_CHANGE = '변경 없음';
const PRODC_YES = 'Yes';

// ===== Field-group(블록) 변경 전/후 비교 모달 (세로형) =====
interface DiffRow { label: string; before: string; after: string; }

function FieldGroupHistoryModal({ title, rows, onClose }: {
  title: string;
  rows: DiffRow[];
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
            {rows.map(({ label, before, after }) => {
              const isChanged = before !== after;
              return (
                <tr key={label} style={{ background: isChanged ? 'rgba(220,53,69,0.05)' : undefined }}>
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

// ===== 블록/정보탭 변경 전·후 값 포맷 헬퍼 (any: snapshot detail 은 파일 전역 규약대로 any 처리) =====
const fmtDiffVal = (v: any): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
};

const fmtPlate = (d: any, prefix: string): string => {
  const line = d?.[`${prefix}_line`] || '-';
  const process = d?.[`${prefix}_process`] || '-';
  const product = d?.[`${prefix}_product`] || '-';
  return `${line} / ${process} / ${product}`;
};

const fmtRevEntries = (entries: any): string => {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  return entries.map((e: any) => `${e?.gds || '-'}: ${(e?.layers ?? []).join(',')}`).join(' | ');
};

const fmtTbvtlvEntries = (v: any): string => {
  if (!Array.isArray(v) || v.length === 0) return '';
  return v.map((e: any) => {
    const sds = (e?.sds ?? []).join(', ');
    const body = e?.noteRows?.length
      ? e.noteRows.map((r: any) => `(${r.x || '-'},${r.y || '-'}:${r.used || '-'})`).join(' ')
      : (e?.note || '');
    return `[${sds}] ${body}`.trim();
  }).join(' / ');
};

function buildMshotRows(prev: any, cur: any): DiffRow[] {
  const rows: DiffRow[] = [
    { label: '엠샷 변경 여부', before: fmtDiffVal(prev?.mshot_change), after: fmtDiffVal(cur?.mshot_change) },
  ];
  const imgKeys: [string, string][] = [
    ['mshot_image_copy', '첨부 이미지'],
    ['mshot_image_copy_top', '첨부 이미지(상판)'],
    ['mshot_image_copy_bottom', '첨부 이미지(하판)'],
  ];
  for (const [k, label] of imgKeys) {
    const before = fmtDiffVal(prev?.[k]);
    const after = fmtDiffVal(cur?.[k]);
    if (before || after) rows.push({ label, before, after });
  }
  return rows;
}

function buildProdcRows(prev: any, cur: any): DiffRow[] {
  const midVal = (d: any) => d?.prodc_middle_use === '미사용' ? '미사용' : fmtPlate(d, 'prodc_middle');
  return [
    { label: '생산 정보', before: fmtDiffVal(prev?.only_prodc), after: fmtDiffVal(cur?.only_prodc) },
    { label: '제품 해당 위치', before: fmtDiffVal(prev?.prodc_scope), after: fmtDiffVal(cur?.prodc_scope) },
    { label: '상판', before: fmtPlate(prev, 'prodc_top'), after: fmtPlate(cur, 'prodc_top') },
    { label: '중판', before: midVal(prev), after: midVal(cur) },
    { label: '하판', before: fmtPlate(prev, 'prodc_bottom'), after: fmtPlate(cur, 'prodc_bottom') },
  ];
}

function buildRevRows(prev: any, cur: any): DiffRow[] {
  return [
    { label: 'REV 여부', before: fmtDiffVal(prev?.rev_yn), after: fmtDiffVal(cur?.rev_yn) },
    { label: 'Layer / GDS', before: fmtRevEntries(prev?.rev_entries), after: fmtRevEntries(cur?.rev_entries) },
  ];
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
                  {(() => { const reg = r.new_or_copy === '기등록'; const rb = reg ? '#e5e7eb' : undefined; return (<><td style={{ backgroundColor: rb }}>{r.updated || '-'}</td><td style={{ backgroundColor: rb }}>{r.process_id}</td><td style={{ backgroundColor: rb }}>{r.sp}</td><td style={{ backgroundColor: rb }}>{r.sd}</td><td style={{ backgroundColor: reg ? rb : isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined }}>{r.pp}</td><td style={{ backgroundColor: reg ? rb : ST_CELL_COLOR[r.st] }}>{r.st}</td><td style={{ backgroundColor: reg ? rb : r.new_or_copy === '차용' ? '#eff6ff' : undefined }}>{r.new_or_copy}</td><td style={{ backgroundColor: rb }}>{r.product_name}</td><td style={{ backgroundColor: rb }}>{r.step}</td><td style={{ backgroundColor: rb }}>{r.item_id}</td></>); })()}
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
                  {(() => { const reg = r.new_or_copy === '기등록'; const rb = reg ? '#e5e7eb' : undefined; return (<><td style={{ backgroundColor: rb }}>{r.updated || '-'}</td><td style={{ backgroundColor: rb }}>{r.process_id}</td><td style={{ backgroundColor: rb }}>{r.sp}</td><td style={{ backgroundColor: rb }}>{r.sd}</td><td style={{ backgroundColor: rb }}>{r.layerid}</td><td style={{ backgroundColor: reg ? rb : isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined }}>{r.pp}</td><td style={{ backgroundColor: reg ? rb : ST_CELL_COLOR[r.st] }}>{r.st}</td><td style={{ backgroundColor: reg ? rb : r.new_or_copy === '차용' ? '#eff6ff' : undefined }}>{r.new_or_copy}</td><td style={{ backgroundColor: rb }}>{r.product_name}</td><td style={{ backgroundColor: rb }}>{r.step}</td></>); })()}
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
  /** 상신자 본인이 Validation System 값을 바꿀 수 있는 상태인지(호출부가 판정) */
  canEditValidationSystem?: boolean;
  onValidationSystemChange?: (value: ValidationSystemValue) => void;
}

export default function PagedDetailView({
  doc, role, pageIdx, setPageIdx, canEditValidationSystem = false, onValidationSystemChange,
}: PagedDetailViewProps): React.ReactElement {
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
        if (col === 5) applyFill(cell, isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined);
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
        if (col === 6) applyFill(cell, isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined);
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

  // 판정 키워드(plel) 유무 — E(MASK) 단계가 결재 경로에 포함되는지의 기준(백엔드 has_ppid_plel 과 동일).
  const hasPlel = isValidationTarget(jayer);
  // Validation System 표시값. detail 키가 없는 레거시 문서는 저장된 J-layer 로 폴백 판정한다.
  // 키워드가 아예 없으면 판정이 성립하지 않으므로 저장값과 무관하게 '해당없음'이다.
  const vsCurrent: ValidationSystemValue = !hasPlel
    ? VS_NA
    : ((detail.validation_system === VS_TARGET || detail.validation_system === VS_NONTARGET)
      ? detail.validation_system
      : VS_TARGET);
  const vsSubmitted = detail.validation_system_submitted;
  const vsLabel = useValidationSystemLabel();
  // 판정 키워드가 없는 문서(해당없음)는 고를 값 자체가 없으므로 토글을 열지 않는다.
  const vsEditable = canEditValidationSystem && !!onValidationSystemChange && hasPlel;
  const vsChangedBy = detail.validation_system_changed_by;
  const vsChangedAt = (detail.validation_system_changed_at ?? '').slice(0, 16).replace('T', ' ');

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
  // 1차~직전 회차 스냅샷 + 현재값을 회차 순서대로 모두 표시하고, 각 회차의 변경 유무를 함께 보여준다.
  const FieldHistoryModal = ({
    label, fieldKey, currentValue, onClose, format, buildValue,
  }: {
    label: string;
    /** 단일 필드 항목의 키. 합성 값 항목은 fieldKey 대신 buildValue 를 넘긴다. */
    fieldKey?: string;
    currentValue: string;
    onClose: () => void;
    format?: (v: any) => string;
    /**
     * 여러 필드를 합쳐 한 줄로 보여주는 항목(지도 편차·EA 등)의 값 생성기.
     * 회차 스냅샷과 현재 값을 같은 함수로 만들어야 값 비교가 성립한다.
     */
    buildValue?: (d: Partial<DetailFormState>) => string;
  }) => {
    const fmt = (v: any) => (format ? format(v) : String(v ?? '-')) || '-';
    const rows = [
      ...history.map((snap, i) => ({
        label: `${i + 1}차 제출`,
        timestamp: snap.timestamp,
        value: buildValue
          ? (buildValue(snap.detail ?? {}) || '-')
          : fmt(fieldKey ? (snap.detail as any)?.[fieldKey] : undefined),
      })),
      {
        label: '현재 (최신)',
        timestamp: null as string | null,
        value: (buildValue ? buildValue(detail) : currentValue) || '-',
      },
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
              <th style={{ ...thStyle, textAlign: 'center' }}>변경</th>
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
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {i === 0
                      ? <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>최초</span>
                      : isChangedRow
                        ? <span style={{ color: '#dc3545', fontWeight: 700, fontSize: '0.78rem' }}>변경됨</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>변경 없음</span>}
                  </td>
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
    label, value, style, changed, fieldKey, buildValue,
  }: {
    label: string;
    value: string | undefined | null;
    style?: React.CSSProperties;
    changed?: boolean;
    fieldKey?: string;
    /** 합성 값 칩(지도 편차·EA·뼈찜 등)의 회차별 값 생성기 — 칩 표시와 동일한 함수를 넘긴다. */
    buildValue?: (d: Partial<DetailFormState>) => string;
  }) => {
    const [histOpen, setHistOpen] = useState(false);
    if (!value) return null;
    const canShowHistory = !!fieldKey || !!buildValue;
    const merged = { ...chipBase, ...style };
    const changedBorder: React.CSSProperties = changed
      ? { border: '2px solid #dc3545', position: 'relative' }
      : {};
    return (
      <div style={{ ...merged, ...changedBorder }}>
        {changed && canShowHistory && (
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
                buildValue={buildValue}
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

  // ===== 합성 값(여러 필드를 한 줄로 합쳐 보여주는 항목) 표시값 생성기 =====
  // 칩 표시와 '이력 확인' 모달이 반드시 같은 함수를 써야 회차별 값 비교가 성립한다.
  // (단일 필드만 넘기면 과거 회차는 대표 필드 값만, 현재 행만 합성 값으로 나와 비교가 깨진다.)

  /** 의뢰 목적 — other_purpose 는 배열(신규)이며, 구버전 문서는 문자열일 수 있어 양쪽 모두 처리한다. */
  const buildPurposeValue = (d: Partial<DetailFormState>): string => {
    const opRaw = d.other_purpose as unknown as string[] | string | undefined;
    const otherPurposeText = Array.isArray(opRaw)
      ? opRaw.map((o) => `[${o}]`).join('')
      : (opRaw || '');
    if (!d.request_purpose) return '-';
    return otherPurposeText ? `${d.request_purpose}(${otherPurposeText})` : d.request_purpose;
  };

  /** 지도 편차 — C가문(상/하판 리전별)인지 여부를 스냅샷 자체의 only_prodc 로 판별한다. */
  const buildMapValue = (d: Partial<DetailFormState>): string => {
    if (d.only_prodc === PRODC_YES) {
      const regionLine = (region: 'top' | 'bottom'): string => {
        const label = t(region === 'top' ? 'request.prodc_top' : 'request.prodc_bottom');
        if (d[`map_change_${region}`] === MAP_NO_CHANGE) return `[${label}] ${t('request.map_no_change')}`;
        const x = d[`map_value_x_${region}`];
        const y = d[`map_value_y_${region}`];
        return `[${label}] X: ${x ? `${x}um` : '-'} / Y: ${y ? `${y}um` : '-'}`;
      };
      const reasonPart = d.map_reason ? ` / 사유: ${d.map_reason}` : '';
      return `${regionLine('top')}\n${regionLine('bottom')}${reasonPart}`;
    }
    if (!d.map_change) return '';
    return `변경: ${d.map_change}`
      + (d.map_value_x ? ` / X: ${d.map_value_x}um` : '')
      + (d.map_value_y ? ` / Y: ${d.map_value_y}um` : '')
      + (d.map_reason ? ` / 사유: ${d.map_reason}` : '');
  };

  /** Exclusive Area — 변경 여부 + 값(mm) */
  const buildEaValue = (d: Partial<DetailFormState>): string => {
    if (!d.ea_change) return '';
    return `변경: ${d.ea_change}${d.ea_value ? ` / 값: ${d.ea_value}mm` : ''}`;
  };

  /** 뼈찜(Backbone) — 등록된 항목 목록 */
  const buildBbValue = (d: Partial<DetailFormState>): string => {
    const entries = d.bb_entries;
    if (!Array.isArray(entries) || entries.length === 0) return '-';
    return entries
      .map((e, i) => `[${i + 1}] 위치: ${e.location || '-'} / 제품: ${e.product || '-'} / 조리법: ${e.process_id || '-'}`)
      .join('\n');
  };

  const purposeValue = buildPurposeValue(detail);
  const basicRow: {
    label: string;
    value: string;
    fieldKey?: string;
    buildValue?: (d: Partial<DetailFormState>) => string;
    changed: boolean;
  }[] = [
    { label: t('request.request_purpose'), value: purposeValue, buildValue: buildPurposeValue, changed: changedFields.has('request_purpose') || changedFields.has('other_purpose') },
    { label: t('request.line'), value: detail.line || '-', fieldKey: 'line', changed: changedFields.has('line') },
    { label: t('request.process_selection'), value: detail.process_selection || '-', fieldKey: 'process_selection', changed: changedFields.has('process_selection') },
    { label: t('request.partid_selection'), value: detail.partid_selection || '-', fieldKey: 'partid_selection', changed: changedFields.has('partid_selection') },
    { label: t('request.process_id'), value: detail.process_id || '-', fieldKey: 'process_id', changed: changedFields.has('process_id') },
  ];

  /** 제품 해당 위치(prodc_scope) 표시 라벨. 값이 없는 옛 문서는 표시하지 않는다. */
  const prodcScopeLabel = (): string => {
    switch (detail.prodc_scope) {
      case 'top': return t('request.prodc_top');
      case 'middle': return t('request.prodc_middle');
      case 'bottom': return t('request.prodc_bottom');
      case 'only_top': return t('request.prodc_only_top');
      case 'only_bottom': return t('request.prodc_only_bottom');
      default: return '';
    }
  };

  const buildProdcInfo = (): string => {
    const lines: string[] = [];
    const scope = prodcScopeLabel();
    if (scope) lines.push(`[${t('request.prodc_apply_region')}] ${scope}`);
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

  const isProdc = detail.only_prodc === PRODC_YES;
  const mshotChange = detail.mshot_change || '없음';
  const mshotHasDetail = mshotChange === '추가' || mshotChange === '수정';
  const mshotIsDelete = mshotChange === '삭제';

  const PLBasicSection = null;
  const [mapHistOpen, setMapHistOpen] = useState(false);
  const [mshotHistOpen, setMshotHistOpen] = useState(false);
  const [prodcHistOpen, setProdcHistOpen] = useState(false);
  const [revHistOpen, setRevHistOpen] = useState(false);

  // 블록(엠샷/생산정보/REV) 변경 전·후 비교 행 (직전 재상신 스냅샷 대비)
  const mshotHistRows = prevSnap ? buildMshotRows(prevSnap.detail, detail) : [];
  const prodcHistRows = prevSnap ? buildProdcRows(prevSnap.detail, detail) : [];
  const revHistRows = prevSnap ? buildRevRows(prevSnap.detail, detail) : [];

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
                <Chip key={item.label} label={item.label} value={item.value} changed={item.changed} fieldKey={item.fieldKey} buildValue={item.buildValue} />
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
              const bbValue = buildBbValue(detail);
              const bbChanged = changedFields.has('bb_zone') || changedFields.has('bb_entries');
              return (
                <div style={rowStyle}>
                  <Chip label={t('request.bb_status')} value={bbValue} style={chipWide} changed={bbChanged} buildValue={buildBbValue} />
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

          {(detail.merge_pairs?.length ?? 0) > 0 && (
            <div style={cardStyle}>
              <div style={sectionTitle}>
                {t('request.ba_result_title')}
                <span style={{ marginLeft: 8, fontSize: '0.76rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                  ({t('request.ba_detail_note')})
                </span>
              </div>
              <MergePairsTable pairs={detail.merge_pairs ?? []} />
            </div>
          )}

          {((detail.adi_cd_before ?? []).some((r) => r.step_id.trim() || r.step_desc.trim())
            || (detail.adi_cd_after ?? []).some((r) => r.step_id.trim() || r.step_desc.trim())
            || detail.adi_cd_delete_all) && (
            <div style={cardStyle}>
              <div style={sectionTitle}>{t('request.adi_cd_section_title')}</div>
              <AdiCdStepsTable
                before={detail.adi_cd_before ?? []}
                after={detail.adi_cd_after ?? []}
                deleteAll={!!detail.adi_cd_delete_all}
              />
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

          {/* MAP 삭제/수정 이유 — 작성 화면과 동일하게 이 모드에서는 이것만 있으면 된다.
              수정/삭제 어느 쪽이든 상세에서는 라벨을 'MAP 수정 이유' 하나로 통일한다(요청 반영).
              본문은 RichTextEditor 가 만든 HTML 이라 공지·가이드·VOC 와 같은 방식으로 렌더한다. */}
          {isMapDeleteEditType(detail.map_type) && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6 }}>
                {t('request.map_change_reason_edit')}
              </div>
              {detail.map_change_reason ? (
                <div
                  style={{
                    border: changedFields.has('map_change_reason') ? '2px solid var(--danger)' : '1px solid var(--border)',
                    borderRadius: 6, padding: '10px 12px', maxHeight: 840, overflowY: 'auto',
                    background: 'var(--bg-secondary)', fontSize: '0.86rem', lineHeight: 1.6,
                  }}
                  dangerouslySetInnerHTML={{ __html: detail.map_change_reason }}
                />
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>-</span>
              )}
            </div>
          )}

          {(isR || isO || isJ || isP) && (detail.map_change || (detail as any).map_change_top || detail.ea_change) && (
            <div style={rowStyle}>
              {(isR || isO || isP) && (() => {
                // 리전별로 '변경 없음/있음'을 함께 표기한다(둘 다 '변경 없음'이어도 칩을 띄운다).
                const isProdcMap = isProdc && !!(detail.map_change_top || detail.map_change_bottom
                  || detail.map_value_x_top || detail.map_value_x_bottom);
                const isPlainMap = !isProdc && !!detail.map_change;
                if (!isProdcMap && !isPlainMap) return null;
                const mapChanged = (isProdcMap
                  ? ['map_change_top','map_value_x_top','map_value_y_top','map_change_bottom','map_value_x_bottom','map_value_y_bottom','map_reason']
                  : ['map_change','map_value_x','map_value_y','map_reason']
                ).some(k => changedFields.has(k));
                return <Chip label={t('request.map')} value={buildMapValue(detail)} style={chipWide} changed={mapChanged} buildValue={buildMapValue} />;
              })()}
              {(isR || isO || isP) && detail.ea_change && (() => {
                const eaChanged = changedFields.has('ea_change') || changedFields.has('ea_value');
                return (
                  <Chip label={t('request.ea_change')} value={buildEaValue(detail)} style={chipWide} changed={eaChanged} buildValue={buildEaValue} />
                );
              })()}
            </div>
          )}

          {(isR || isO || isP) && detail.mshot_change && (() => {
            const mshotChanged = changedFields.has('mshot_change') || changedFields.has('mshot_image_copy') || changedFields.has('mshot_image_copy_top') || changedFields.has('mshot_image_copy_bottom');
            const imgStyle: React.CSSProperties = { maxWidth: '300px', maxHeight: '200px', borderRadius: '4px', border: '1px solid #ddd', marginTop: '8px' };
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200, position: 'relative', ...(mshotChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  {mshotChanged && (
                    <button
                      onClick={() => setMshotHistOpen(true)}
                      style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 }}
                    >
                      이력 확인
                    </button>
                  )}
                  {mshotHistOpen && (
                    <FieldGroupHistoryModal title="엠샷 변경 이력" rows={mshotHistRows} onClose={() => setMshotHistOpen(false)} />
                  )}
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
            const prodcChanged = ['only_prodc','prodc_scope','prodc_top_line','prodc_top_process','prodc_top_product','prodc_middle_use','prodc_middle_line','prodc_middle_process','prodc_middle_product','prodc_bottom_line','prodc_bottom_process','prodc_bottom_product'].some((k) => changedFields.has(k));
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200, position: 'relative', ...(prodcChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  {prodcChanged && (
                    <button
                      onClick={() => setProdcHistOpen(true)}
                      style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 }}
                    >
                      이력 확인
                    </button>
                  )}
                  {prodcHistOpen && (
                    <FieldGroupHistoryModal title="생산 정보 변경 이력" rows={prodcHistRows} onClose={() => setProdcHistOpen(false)} />
                  )}
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
            );
          })()}

          {/* REV — C가문(only_prodc)과 독립된 항목이므로 C가문 Yes/No 와 무관하게 표시한다. */}
          {(isR || isO || isP) && (() => {
            const revChanged = changedFields.has('rev_yn') || changedFields.has('rev_entries');
            const revYn = detail.rev_yn;
            const revEntries = detail.rev_entries;
            if (!revYn) return null;
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, textAlign: 'left', flex: '1 1 auto', minWidth: 200, position: 'relative', ...(revChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  {revChanged && (
                    <button
                      onClick={() => setRevHistOpen(true)}
                      style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 }}
                    >
                      이력 확인
                    </button>
                  )}
                  {revHistOpen && (
                    <FieldGroupHistoryModal title="REV 변경 이력" rows={revHistRows} onClose={() => setRevHistOpen(false)} />
                  )}
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
                {/* Inter — 항상 표시. YES 면 버튼이 아닌 글자(코멘트)로 표시, NO 면 Map Option 과 동일하게 "없음" 표시 */}
                <div style={rowStyle}>
                  <div style={{ ...chipBase, textAlign: 'left', flex: '1 1 auto', minWidth: 200 }}>
                    <div style={fieldLabel}>{t('request.map_opt_inter')}</div>
                    <div style={fieldValue}>
                      {detail.inter === 'YES' ? (
                        (detail as any).in_apply ? (
                          [
                            t('approval.inter_applied'),
                            (detail as any).in_apply === 'O' ? t('request.in_apply_o') : t('request.in_apply_x'),
                            (detail as any).inter_select ? t(`request.map_opt_inter_${(detail as any).inter_select}` as never) : null,
                          ].filter(Boolean).join(' / ')
                        ) : (
                          [
                            t('approval.inter_applied'),
                            detail.inter_xs === '적용' ? t('approval.inter_xs_applied') : null,
                            detail.inter_ys === '적용' ? t('approval.inter_ys_applied') : null,
                          ].filter(Boolean).join(' / ')
                        )
                      ) : (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>없음</span>
                      )}
                    </div>
                  </div>
                </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('request.validation_system')}
            </span>
            {vsEditable ? (
              <ValidationSystemToggle value={vsCurrent} onChange={(v) => onValidationSystemChange?.(v)} />
            ) : (
              <ValidationSystemBadge value={vsCurrent} />
            )}
            {hasPlel && vsSubmitted && vsSubmitted !== vsCurrent && (
              <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
                {t('request.validation_system_changed', { from: vsLabel(vsSubmitted), to: vsLabel(vsCurrent) })}
              </span>
            )}
            {vsChangedBy && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {t('request.validation_system_changed_by', { name: vsChangedBy, at: vsChangedAt })}
              </span>
            )}
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
          // 정보탭 변경 이력: partial_shot / tbvtlv_thickness / tbvtlv_entries 각각의 변경 여부
          const psChanged = changedFields.has('partial_shot');
          const thkChanged = changedFields.has('tbvtlv_thickness');
          const entChanged = changedFields.has('tbvtlv_entries');
          const infoChanged = psChanged || thkChanged || entChanged;
          const [infoHist, setInfoHist] = React.useState<{ label: string; fieldKey: string; value: string; format?: (v: any) => string } | null>(null);
          const infoHistBtnStyle: React.CSSProperties = { position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 };
          const infoChangedBox: React.CSSProperties = { border: '2px solid #dc3545', borderRadius: 6, padding: '8px 10px', position: 'relative' };
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
                    {tab.key === 'info' && (infoChanged
                      ? <span title="변경됨" style={{ width: 7, height: 7, borderRadius: '50%', background: '#dc3545', display: 'inline-block' }} />
                      : infoHasData
                        ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4CAF50', display: 'inline-block' }} />
                        : null)}
                  </button>
                ))}
              </div>
              {activeTab === 'table' && (
                <OayerTable rows={oayer} changedRowIds={changedOayerIds} prevRowMap={prevOayerMap} />
              )}
              {activeTab === 'info' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13 }}>
                  {infoHist && (
                    <FieldHistoryModal
                      label={infoHist.label}
                      fieldKey={infoHist.fieldKey}
                      currentValue={infoHist.value}
                      format={infoHist.format}
                      onClose={() => setInfoHist(null)}
                    />
                  )}
                  {/* Partial Shot */}
                  <div style={psChanged ? infoChangedBox : undefined}>
                    {psChanged && (
                      <button style={infoHistBtnStyle} onClick={() => setInfoHist({ label: t('request.partial_shot'), fieldKey: 'partial_shot', value: detail.partial_shot || '-' })}>이력 확인</button>
                    )}
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
                      <div style={{ marginBottom: 10, ...(thkChanged ? infoChangedBox : {}) }}>
                        {thkChanged && (
                          <button style={infoHistBtnStyle} onClick={() => setInfoHist({ label: t('request.tbvtlv_thickness'), fieldKey: 'tbvtlv_thickness', value: detail.tbvtlv_thickness || '-' })}>이력 확인</button>
                        )}
                        <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{t('request.tbvtlv_thickness')}:</span>
                        <span style={{ fontWeight: 600 }}>{detail.tbvtlv_thickness}</span>
                      </div>
                    )}
                    <div style={entChanged ? infoChangedBox : undefined}>
                    {entChanged && (
                      <button style={infoHistBtnStyle} onClick={() => setInfoHist({ label: t('request.tbvtlv'), fieldKey: 'tbvtlv_entries', value: fmtTbvtlvEntries(detail.tbvtlv_entries), format: fmtTbvtlvEntries })}>이력 확인</button>
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

  const isOnlyMap = (() => {
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      return parsed?.detail?.request_purpose === 'Only MAP';
    } catch { return false; }
  })();

  // MAP 삭제/수정: P·R·J·O 병렬 경로라 E·RA 는 아예 만들지 않는다(고정 후결자도 없다).
  const isMapDeleteEdit = (() => {
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      return parsed?.detail?.request_purpose === 'MAP 삭제/수정';
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
    status: 'approved' | 'rejected' | 'skipped' | 'reviewing' | 'unassigned' | 'waiting' | 'na';
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
    // (2026-08 이전 OR 시절 문서에만 남는 이력) 그때는 EV 1명 합의로 단계가 끝나면 남은
    // 검토자가 skip 으로 닫혔다. 지금은 EV도 전원 합의(AND)라 새로 생기지 않는다.
    // comment 를 반드시 싣는다 — 그 검토자가 남긴 수정 요청 이력이 화면에서 사라지면 안 된다.
    if (s.action === 'skip') return {
      status: 'skipped', label: t('approval.step_skip'),
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
    // MAP 삭제/수정은 RA(후결자)를 아예 만들지 않는다 — 없이도 fallback 을 타면
    // '대기'로 보여 영원히 끝나지 않는 단계처럼 오해를 준다(E 처럼 명시적 na 분기 필요).
    if (isMapDeleteEdit && agent === 'RA') {
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
    // P/E단계: 담당자(P/E, 검토중) + 검토자(PV/EV, 다중 지정 시)를 한 행에 함께 표시
    if (agent === 'P' || agent === 'E') {
      const reviewAgent = agent === 'P' ? 'PV' : 'EV';
      const out: StepDisplayInfo[] = [];
      const mainSteps = allSteps.filter((s) => s.agent === agent && (s.round ?? 1) === round);
      if (mainSteps.length === 0) {
        out.push({ status: 'waiting', label: t('approval.step_pending'), roleLabel: t('approval.role_agreer' as any) });
      } else {
        mainSteps.forEach((s) => out.push({ ...stepToInfo(s), roleLabel: t('approval.role_agreer' as any) }));
      }
      const reviewSteps = allSteps.filter((s) => s.agent === reviewAgent && (s.round ?? 1) === round);
      reviewSteps.forEach((s) => out.push({ ...stepToInfo(s), roleLabel: t('approval.stage_reviewer' as any) }));
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
      skipped:    { background: 'rgba(107,138,176,0.12)', color: '#8794a6' },
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
              {(key === 'E' && !hasPlel) || (isOnlyMap && ['P', 'J', 'O', 'E'].includes(key)) || (isMapDeleteEdit && key === 'RA') ? (
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
