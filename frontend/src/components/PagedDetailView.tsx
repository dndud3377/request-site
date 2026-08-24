import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { RequestDocument, UserRole, DetailFormState, ValidationSystemValue, FlowChartRow, JayerRow, OayerRow, BbTableRow, HistorySnapshot, MergePair, MergeRowInfo, AdiCdStep, AdiCdTarget } from '../types';
import Modal from './Modal';
import { ST_CELL_COLOR } from '../utils/stCellColor';
import { bbTabColor } from '../utils/bbTabColors';
import { VALIDATION_CELL_COLOR, VS_TARGET, VS_NONTARGET, VS_NA, isMapDeleteEditType, OTHER_PURPOSE_OVERLAY, ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL } from '../pages/RequestPage/constants';
import { isValidationKeywordRow, isValidationTarget, deriveMergeKind, balanceAdiCdRows } from '../pages/RequestPage/helpers';
import { ValidationSystemBadge, ValidationSystemToggle, useValidationSystemLabel } from './ValidationSystem';
import ReviewItems, { ReviewItemsProps } from './ReviewItems';
import {
  exportJayer as exportJayerXlsx,
  exportOayer as exportOayerXlsx,
  exportBb as exportBbXlsx,
  exportDetailInfo as exportDetailInfoXlsx,
  exportMapInfo as exportMapInfoXlsx,
} from '../utils/detailExport';

/** J-ayer 검토 항목 패널에 그대로 넘겨주는 props (호출부가 상태·핸들러를 소유한다) */
export type ReviewItemsPanelProps = ReviewItemsProps;

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
            <tr key={pair.id ?? `${pair.beforeId ?? 'none'}_${pair.afterId ?? 'none'}_${i}`}>
              <td>
                <span className={`ba-badge ba-badge-${pair.table === 'J' ? 'j' : 'o'}`}>
                  {t(pair.table === 'J' ? 'request.jayer' : 'request.oayer')}
                </span>
              </td>
              {cells(pair.before, pair.after)}
              {cells(pair.after, pair.before)}
              <td>
                <span className={`ba-badge ba-badge-${deriveMergeKind(pair.before, pair.after)}`}>
                  {t(`request.ba_kind_${deriveMergeKind(pair.before, pair.after)}`)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ADI CD 변경 — '동일 변경 적용 대상' 표(읽기 전용). 1행은 위쪽 partid_selection/process_id 필드
 * 값(작성 화면의 읽기 전용 1행과 동일한 값), 2행부터는 detail.adi_cd_extra_targets 저장값이다.
 */
function AdiCdTargetsTable({ first, extras }: { first: { partid_selection: string; process_id: string }; extras: AdiCdTarget[] }) {
  const { t } = useTranslation();
  return (
    <div style={{ maxWidth: '33%' }}>
      <table className="table adi-cd-targets-detail-table">
        <thead><tr><th>{t('request.partid_selection')}</th><th>{t('request.process_id')}</th></tr></thead>
        <tbody>
          <tr><td>{first.partid_selection}</td><td>{first.process_id}</td></tr>
          {extras.map((r) => (
            <tr key={r.id}><td>{r.partid_selection}</td><td>{r.process_id}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ADI CD 변경 — 변경전/변경후 스텝 표 (읽기 전용). 작성 화면(AdiCdPanel)과 같은 좌/우 구성.
 * 두 표는 같은 인덱스끼리 짝을 이루므로(§행 수 동일 규칙) 어느 한쪽만 걸러내면 짝이 어긋난다 —
 * 양쪽 다 비어 있는(미등록도 아닌, 완전히 안 쓴) 행만 함께 제거한다. 이 규칙 도입 전 문서는
 * 개수가 다를 수 있어 짧은 쪽을 화면 표시용으로만 채워 맞춘다(balanceAdiCdRows, 저장값은 안 건드림).
 */
function AdiCdStepsTable({ before, after }: { before: AdiCdStep[]; after: AdiCdStep[] }) {
  const { t } = useTranslation();
  const balanced = balanceAdiCdRows(before, after);
  const isRowUsed = (b: AdiCdStep, a: AdiCdStep) =>
    b.unregistered || a.unregistered
    || !!b.step_id.trim() || !!b.step_desc.trim() || !!a.step_id.trim() || !!a.step_desc.trim();
  const usedIndices = balanced.before
    .map((_, i) => i)
    .filter((i) => isRowUsed(balanced.before[i], balanced.after[i]));
  const beforeRows = usedIndices.map((i) => balanced.before[i]);
  const afterRows = usedIndices.map((i) => balanced.after[i]);

  const renderTable = (rows: AdiCdStep[]) => (
    <table className="table" style={{ fontSize: '0.8rem' }}>
      <thead><tr><th>{ADI_CD_STEP_ID_LABEL}</th><th>{ADI_CD_STEP_DESC_LABEL}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {r.unregistered ? (
              <td colSpan={2} style={{ color: 'var(--text-muted)' }}>{t('request.adi_cd_unregistered')}</td>
            ) : (
              <><td>{r.step_id}</td><td>{r.step_desc}</td></>
            )}
          </tr>
        ))}
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
        {renderTable(afterRows)}
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

/**
 * 표 3종의 이력 컬럼 정의(모듈 상수).
 * **이 목록이 곧 변경 판정 기준이다** — 이력 모달에 보이는 값이 같으면 변경이 아니다.
 * 내부 필드(loaded·manuallyDisabled·entryId 등)를 비교에서 자동으로 제외하므로,
 * 나중에 행 타입에 필드가 추가돼도 이력 오탐이 생기지 않는다.
 */
interface DiffFieldDef { key: string; label?: string; labelKey?: string; }

const JAYER_DIFF_FIELDS: DiffFieldDef[] = [
  { key: 'updated',      labelKey: 'request.col_updated_date' },
  { key: 'process_id',   labelKey: 'request.process_id' },
  { key: 'sp',           labelKey: 'request.col_sp' },
  { key: 'sd',           labelKey: 'request.col_sd' },
  { key: 'pp',           labelKey: 'request.col_pp' },
  { key: 'layerid',      label: 'Layer' },
  { key: 'st',           labelKey: 'request.col_st' },
  { key: 'new_or_copy',  labelKey: 'request.col_new_or_copy' },
  { key: 'product_name', labelKey: 'request.col_product_name' },
  { key: 'step',         labelKey: 'request.col_step' },
  { key: 'item_id',      labelKey: 'request.col_item_id' },
];

const OAYER_DIFF_FIELDS: DiffFieldDef[] = [
  { key: 'updated',      labelKey: 'request.col_updated_date' },
  { key: 'process_id',   labelKey: 'request.process_id' },
  { key: 'sp',           labelKey: 'request.col_sp' },
  { key: 'sd',           labelKey: 'request.col_sd' },
  { key: 'layerid',      labelKey: 'request.col_layer' },
  { key: 'pp',           labelKey: 'request.col_pp' },
  { key: 'st',           labelKey: 'request.col_st' },
  { key: 'new_or_copy',  labelKey: 'request.col_new_or_copy' },
  { key: 'product_name', labelKey: 'request.col_product_name' },
  { key: 'step',         labelKey: 'request.col_step' },
];

const BB_DIFF_FIELDS: DiffFieldDef[] = [
  { key: 'process_id',    labelKey: 'request.process_id' },
  { key: 'ss',            labelKey: 'request.col_sp' },
  { key: 'sd',            labelKey: 'request.col_sd' },
  { key: 'bb_process_id', labelKey: 'request.col_bb_process_id' },
  { key: 'bb_name',       labelKey: 'request.col_bb_partid' },
  { key: 'bb_layer',      labelKey: 'request.col_bb_layer' },
  { key: 'bb_ss',         labelKey: 'request.col_bb_stepseq' },
  { key: 'bb_step',       labelKey: 'request.col_bb_step' },
  { key: 'remark',        labelKey: 'request.col_remark' },
];

/** 컬럼 정의 → 라벨이 채워진 DiffField. 정의가 한 곳이라 판정 기준과 표시가 어긋나지 않는다. */
function toDiffFields(defs: DiffFieldDef[], t: TFunction): DiffField[] {
  return defs.map((d) => ({ key: d.key, label: d.label ?? t(d.labelKey as never) }));
}

// 회차 축 — 1차~직전 회차 스냅샷 + 현재값을 한 배열로 묶어 모든 이력 UI 가 공유한다.
const currentRoundLabel = (t: TFunction) => t('request.current_round_label');
const roundLabel = (t: TFunction, i: number) => t('request.round_submit_label', { n: i + 1 });

/** 이력 표에서 그 회차에 대응하는 행이 없을 때 쓰는 표시값(화면용) */
const noRowMark = (t: TFunction) => `(${t('request.value_none')})`;
/** 위 표시값과 별개로, "행 없음" 상태를 비교하는 내부 판정용 고정 시그니처(번역과 무관해야 한다) */
const NO_ROW_SIG = '__NO_ROW__';

interface RoundSnapshot {
  label: string;
  timestamp: string | null;
  detail: any;
  jayerRows: JayerRow[];
  oayerRows: OayerRow[];
  bbRows: BbTableRow[];
}

const fmtRoundTime = (ts: string | null): string => (ts ? new Date(ts).toLocaleString('ko-KR') : '-');

// 표 행 변경 전/후를 원본 표와 동일한 가로 형식(헤더=필드, 변경 전/후 2행)으로 비교
function RowDiffModal({
  title, fields, curRow, prevRow, onClose,
}: {
  title: string;
  fields: DiffField[];
  curRow: Record<string, any>;
  /** 이전 회차에 짝이 없는 행(이번에 새로 생긴 행)이면 null — 변경 전 칸을 '(없음)' 으로 채운다. */
  prevRow: Record<string, any> | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const cell = (f: DiffField, row: Record<string, any> | null) => {
    if (!row) return noRowMark(t);
    return (f.format ? f.format(row[f.key]) : String(row[f.key] ?? '')) || '';
  };
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
              <td style={{ ...rowHeadS, color: '#dc3545' }}>{t('request.before_label')}</td>
              {fields.map((f, i) => (
                <td key={f.key} style={{ ...tdS, color: changed[i] ? '#dc3545' : 'var(--text-primary)', background: changed[i] ? 'rgba(220,53,69,0.06)' : undefined }}>{cell(f, prevRow) || '-'}</td>
              ))}
            </tr>
            <tr>
              <td style={{ ...rowHeadS, color: '#155724' }}>{t('request.after_label')}</td>
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

// 표 행의 회차별 이력 모달 — 헤더=원본 표의 필드, 본문 1행 = 1회차.
// 결재 진행 중에는 쓰지 않는다(그 화면은 RowDiffModal 의 변경 전/후 2행 고정).
function RowRoundHistoryModal({
  title, fields, rounds, onClose,
}: {
  title: string;
  fields: DiffField[];
  rounds: { label: string; timestamp: string | null; row: Record<string, any> | null }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const cell = (f: DiffField, row: Record<string, any> | null): string => {
    if (!row) return noRowMark(t);
    return (f.format ? f.format(row[f.key]) : String(row[f.key] ?? '')) || '';
  };
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
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={thS}>{t('request.submit_round_col')}</th>
              <th style={thS}>{t('request.time_col')}</th>
              {fields.map((f) => <th key={f.key} style={thS}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rounds.map((r, ri) => {
              const isCurrent = ri === rounds.length - 1;
              const prev = ri > 0 ? rounds[ri - 1].row : null;
              return (
                <tr key={r.label} style={{ background: isCurrent ? 'rgba(37,99,235,0.07)' : undefined }}>
                  <td style={rowHeadS}>{r.label}</td>
                  <td style={{ ...tdS, color: 'var(--text-muted)', fontSize: '0.75rem' }}>{fmtRoundTime(r.timestamp)}</td>
                  {fields.map((f) => {
                    const v = cell(f, r.row);
                    const isChanged = ri > 0 && v !== cell(f, prev);
                    return (
                      <td
                        key={f.key}
                        style={{
                          ...tdS,
                          color: isChanged ? '#dc3545' : 'var(--text-primary)',
                          fontWeight: isChanged || isCurrent ? 700 : 400,
                          background: isChanged ? 'rgba(220,53,69,0.06)' : undefined,
                        }}
                      >
                        {v || '-'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// 지도 편차/C가문 판정에 쓰는 저장값(백엔드 저장 문자열과 동일)
const MAP_NO_CHANGE = '변경 없음';
const PRODC_YES = 'Yes';

// 업로드 이미지 경로 prefix (백엔드는 'mshot_images/xxx.png' 상대경로만 저장한다)
const MEDIA_URL_PREFIX = '/media/';
// 이력 모달 안 썸네일 크기 — 변경 전·후를 한 화면에서 대조하기 위해 본체(300x200)보다 작게 둔다
const DIFF_THUMB_MAX_WIDTH = 220;
const DIFF_THUMB_MAX_HEIGHT = 150;

// ===== Field-group(블록) 이력 =====
/**
 * 블록 한 회차분의 표시 항목. 회차별 표와 변경 전/후 표가 **같은 빌더**를 쓰므로
 * 항목 순서·개수는 어느 회차에서나 동일해야 한다(열 정렬이 그 전제 위에 선다).
 */
/** 표로 입력한 항목(Final GDS·TBV/TLV)은 이력에서도 표 그대로 보여준다. */
interface DiffTable { headers: string[]; rows: string[][]; }

interface DiffItem { label: string; value: string; kind?: 'text' | 'image' | 'table'; table?: DiffTable | null; }
type GroupBuilder = (d: any, t: TFunction) => DiffItem[];

/** kind='image' 는 썸네일, kind='table' 은 미니 표로 그린다. 미지정이면 텍스트다. */
interface DiffRow {
  label: string;
  before: string; after: string;
  kind?: 'text' | 'image' | 'table';
  beforeTable?: DiffTable | null; afterTable?: DiffTable | null;
}

/** 이미지·표 항목은 어느 회차에도 값이 없으면 행 자체를 감춘다(빈 줄만 늘어나는 것을 막는다). */
const keepItemRow = (kind: DiffItem['kind'], values: string[]): boolean =>
  (kind !== 'image' && kind !== 'table') || values.some((v) => !!v);

/** 블록 빌더로 '변경 전/후' 2열 행을 만든다 — 결재 진행 중 화면용. */
function toDiffRows(prev: any, cur: any, build: GroupBuilder, t: TFunction): DiffRow[] {
  const prevItems = build(prev, t);
  const curItems = build(cur, t);
  return prevItems
    .map((item, i) => ({
      label: item.label,
      before: item.value,
      after: curItems[i]?.value ?? '',
      kind: item.kind,
      beforeTable: item.table,
      afterTable: curItems[i]?.table,
    }))
    .filter((r) => keepItemRow(r.kind, [r.before, r.after]));
}

// 이력용 미니 표 — 원본 입력 표와 같은 열 구성으로, **다른 쪽과 값이 다른 셀만** 강조한다.
const DIFF_TONE = {
  before:  { text: '#dc3545', bg: 'rgba(220,53,69,0.12)' },
  after:   { text: '#155724', bg: 'rgba(21,87,36,0.12)' },
  neutral: { text: '#dc3545', bg: 'rgba(220,53,69,0.12)' },
} as const;

function DiffMiniTable({ table, other, tone }: {
  table: DiffTable;
  /** 비교 대상(변경 전↔후, 또는 직전 회차). 없으면 강조하지 않는다. */
  other?: DiffTable | null;
  tone: keyof typeof DIFF_TONE;
}) {
  const { text, bg } = DIFF_TONE[tone];
  const thS: React.CSSProperties = {
    border: '1px solid var(--border-light)', padding: '3px 8px',
    fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)',
    background: 'var(--bg-secondary)', whiteSpace: 'nowrap',
  };
  const tdS: React.CSSProperties = {
    border: '1px solid var(--border-light)', padding: '3px 8px',
    fontSize: '0.78rem', textAlign: 'center', whiteSpace: 'nowrap',
  };
  return (
    <table style={{ borderCollapse: 'collapse', width: 'fit-content' }}>
      <thead>
        <tr>{table.headers.map((h, i) => <th key={i} style={thS}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {table.rows.map((row, ri) => {
          const otherRow = other?.rows[ri];
          // 상대 쪽에 아예 없는 행(추가/삭제된 행)은 행 전체가 변경이다.
          const rowMissing = !!other && !otherRow;
          return (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const isChanged = !!other && (rowMissing || cell !== (otherRow?.[ci] ?? ''));
                return (
                  <td key={ci} style={{ ...tdS, ...(isChanged ? { color: text, background: bg, fontWeight: 700 } : {}) }}>
                    {cell || '—'}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FieldGroupHistoryModal({ title, rows, onClose }: {
  title: string;
  rows: DiffRow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const thS: React.CSSProperties = {
    textAlign: 'left', padding: '5px 10px', fontSize: '0.78rem',
    fontWeight: 700, color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)',
  };
  const tdS: React.CSSProperties = { padding: '5px 10px', fontSize: '0.82rem', verticalAlign: 'top' };
  const thumbStyle = (borderColor: string): React.CSSProperties => ({
    maxWidth: DIFF_THUMB_MAX_WIDTH, maxHeight: DIFF_THUMB_MAX_HEIGHT,
    borderRadius: 4, border: `1px solid ${borderColor}`, display: 'block',
  });
  /** 셀 내용 생성 — 이미지는 썸네일, 표 항목은 미니 표(바뀐 셀 강조), 그 외는 텍스트다. */
  const renderCell = (row: DiffRow, side: 'before' | 'after'): React.ReactNode => {
    const value = side === 'before' ? row.before : row.after;
    if (row.kind === 'image' && value) {
      const borderColor = side === 'before' ? '#dc3545' : '#155724';
      return <img src={`${MEDIA_URL_PREFIX}${value}`} alt={`${row.label} ${side === 'before' ? t('request.before_label') : t('request.after_label')}`} style={thumbStyle(borderColor)} />;
    }
    if (row.kind === 'table') {
      const table = side === 'before' ? row.beforeTable : row.afterTable;
      const other = side === 'before' ? row.afterTable : row.beforeTable;
      if (table && table.rows.length > 0) {
        return <DiffMiniTable table={table} other={other} tone={side} />;
      }
      return '-';
    }
    return value || '-';
  };
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={thS}>{t('request.item_col')}</th>
              <th style={{ ...thS, color: '#dc3545' }}>{t('request.before_label')}</th>
              <th style={{ ...thS, color: '#155724' }}>{t('request.after_label')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { label, before, after } = row;
              const isChanged = before !== after;
              // 표 항목은 셀 단위로 강조하므로 행 전체 색은 입히지 않는다(강조가 겹쳐 읽기 어려워진다).
              const isTable = row.kind === 'table';
              return (
                <tr key={label} style={{ background: isChanged && !isTable ? 'rgba(220,53,69,0.05)' : undefined }}>
                  <td style={{ ...tdS, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</td>
                  <td style={{ ...tdS, color: isChanged && !isTable ? '#dc3545' : 'var(--text-primary)' }}>{renderCell(row, 'before')}</td>
                  <td style={{ ...tdS, color: isChanged && !isTable ? '#155724' : 'var(--text-primary)', fontWeight: isChanged && !isTable ? 700 : 400 }}>{renderCell(row, 'after')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// 블록의 회차별 이력 모달 — 행=항목, 열=회차. 이력 조회 화면에서만 쓴다.
function FieldGroupRoundHistoryModal({ title, rounds, build, onClose }: {
  title: string;
  rounds: RoundSnapshot[];
  build: GroupBuilder;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const columns = rounds.map((r) => ({ round: r, items: build(r.detail, t) }));
  const template = columns.length > 0 ? columns[0].items : [];
  const thS: React.CSSProperties = {
    textAlign: 'left', padding: '5px 10px', fontSize: '0.78rem',
    fontWeight: 700, color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)',
    whiteSpace: 'nowrap',
  };
  const tdS: React.CSSProperties = { padding: '5px 10px', fontSize: '0.82rem', verticalAlign: 'top' };
  const thumbStyle: React.CSSProperties = {
    maxWidth: DIFF_THUMB_MAX_WIDTH, maxHeight: DIFF_THUMB_MAX_HEIGHT,
    borderRadius: 4, border: '1px solid var(--border)', display: 'block',
  };
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={thS}>{t('request.item_col')}</th>
              {columns.map(({ round }, ci) => (
                <th key={round.label} style={{ ...thS, color: ci === columns.length - 1 ? 'var(--accent)' : 'var(--text-muted)' }}>
                  <div>{round.label}</div>
                  <div style={{ fontWeight: 400, fontSize: '0.7rem' }}>{fmtRoundTime(round.timestamp)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {template.map((item, ri) => {
              const values = columns.map((c) => c.items[ri]?.value ?? '');
              if (!keepItemRow(item.kind, values)) return null;
              const isTable = item.kind === 'table';
              return (
                <tr key={item.label}>
                  <td style={{ ...tdS, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{item.label}</td>
                  {values.map((v, ci) => {
                    // 표 항목은 직전 회차와 견줘 셀 단위로 강조하므로 칸 전체 색은 입히지 않는다.
                    const isChanged = !isTable && ci > 0 && v !== values[ci - 1];
                    const isCurrent = ci === values.length - 1;
                    const table = columns[ci].items[ri]?.table;
                    const prevTable = ci > 0 ? columns[ci - 1].items[ri]?.table : null;
                    return (
                      <td
                        key={columns[ci].round.label}
                        style={{
                          ...tdS,
                          color: isChanged ? '#dc3545' : 'var(--text-primary)',
                          fontWeight: isChanged || (isCurrent && !isTable) ? 700 : 400,
                          background: isChanged ? 'rgba(220,53,69,0.06)' : undefined,
                        }}
                      >
                        {isTable
                          ? (table && table.rows.length > 0
                              ? <DiffMiniTable table={table} other={ci > 0 ? prevTable : null} tone="neutral" />
                              : '-')
                          : item.kind === 'image' && v
                            ? <img src={`${MEDIA_URL_PREFIX}${v}`} alt={`${item.label} ${columns[ci].round.label}`} style={thumbStyle} />
                            : (v || '-')}
                      </td>
                    );
                  })}
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

const fmtFinalEntries = (entries: any): string => {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  return entries.join(' | ');
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

// ===== 표로 입력한 항목의 이력용 표 데이터 (원본 입력 표와 같은 열 구성) =====

/** Final — 등록된 GDS version 값을 한 열로 쓴다. */
const buildFinalTable = (entries: any): DiffTable | null => {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return {
    headers: ['GDS'],
    rows: entries.map((gds: any) => [String(gds ?? '')]),
  };
};

/**
 * TBV/TLV — 원본 표(No / X / Y / 사용여부)에 어느 SD 묶음인지를 앞 열로 붙인다.
 * 구버전(자유 입력 note) 저장분은 좌표 행이 없으므로 SD 칸에 note 를 함께 적어 값을 잃지 않는다.
 */
const buildTbvtlvTable = (entries: any, t: TFunction): DiffTable | null => {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const rows: string[][] = [];
  for (const e of entries) {
    const sds = (e?.sds ?? []).join(', ');
    if (e?.noteRows?.length) {
      e.noteRows.forEach((r: any, i: number) => {
        rows.push([sds, String(i + 1), String(r?.x ?? ''), String(r?.y ?? ''), String(r?.used ?? '')]);
      });
    } else {
      rows.push([e?.note ? `${sds} (${e.note})` : sds, '-', '-', '-', '-']);
    }
  }
  return rows.length > 0 ? { headers: [t('request.tbvtlv_sd_select'), 'No', 'X', 'Y', t('request.tbvtlv_used')], rows } : null;
};

/**
 * 블록 빌더 3종 — 한 회차(detail) 하나만 받아 항목 목록을 만든다.
 * 변경 전/후 표(진행 중)와 회차별 표(이력 조회)가 같은 함수를 공유해야 값 비교가 성립한다.
 */
const MSHOT_IMAGE_ITEMS: [string, string][] = [
  ['mshot_image_copy', 'request.mshot_attached_image'],
  ['mshot_image_copy_top', 'request.mshot_attached_image_top'],
  ['mshot_image_copy_bottom', 'request.mshot_attached_image_bottom'],
];

const buildMshotItems: GroupBuilder = (d, t) => [
  { label: t('request.mshot_change_label'), value: fmtDiffVal(d?.mshot_change) },
  ...MSHOT_IMAGE_ITEMS.map(([k, labelKey]) => ({
    label: t(labelKey as never),
    value: fmtDiffVal(d?.[k]),
    kind: 'image' as const,
  })),
];

const buildProdcItems: GroupBuilder = (d, t) => [
  { label: t('request.prodc_info_label'), value: fmtDiffVal(d?.only_prodc) },
  { label: t('request.prodc_scope_label'), value: fmtDiffVal(d?.prodc_scope) },
  { label: t('request.plate_top'), value: fmtPlate(d, 'prodc_top') },
  { label: t('request.plate_middle'), value: d?.prodc_middle_use === '미사용' ? '미사용' : fmtPlate(d, 'prodc_middle') },
  { label: t('request.plate_bottom'), value: fmtPlate(d, 'prodc_bottom') },
];

const buildFinalItems: GroupBuilder = (d, t) => [
  { label: t('request.final_yn_label'), value: fmtDiffVal(d?.final_yn) },
  { label: t('request.final_gds'), value: fmtFinalEntries(d?.final_entries), kind: 'table', table: buildFinalTable(d?.final_entries) },
];

// ===== Table Components =====

/**
 * 표 3종이 공유하는 이력 props.
 * `rounds` 는 이력 조회에서만 넘어오며, 넘어오면 행 이력이 회차별 표로 열린다.
 */
interface TableHistoryProps<T extends { id: string }> {
  changedRowIds?: Set<string>;
  prevRowMap?: Map<string, T>;
  historyMode?: boolean;
  rounds?: RoundSnapshot[];
}

/**
 * 행 이력 버튼을 띄울 수 있는 상태인지 — 이전 회차가 있으면 띄운다.
 * 짝이 없는 행(이번에 새로 생긴 행)도 "변경 전 = (없음)" 으로 보여주므로,
 * 강조만 되고 눌러볼 수 없는 행이 남지 않는다.
 */
function canOpenRowHistory<T extends { id: string }>(
  _rowId: string, { rounds }: TableHistoryProps<T>,
): boolean {
  return (rounds?.length ?? 0) > 1;
}

function JayerTable({
  rows,
  changedRowIds = new Set<string>(),
  prevRowMap,
  historyMode = false,
  rounds = [],
}: {
  rows: JayerRow[];
} & TableHistoryProps<JayerRow>) {
  const { t } = useTranslation();
  const [diffId, setDiffId] = useState<string | null>(null);
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  const diffCur = diffId ? rows.find((r) => r.id === diffId) : null;
  const diffPrev = diffId ? prevRowMap?.get(diffId) : null;
  const diffRounds = diffId && historyMode ? buildRowTimeline(rows, rounds, (r) => r.jayerRows, diffId) : null;
  const fields = toDiffFields(JAYER_DIFF_FIELDS, t);
  // 이전 회차가 있으면 버튼 열을 연다(짝 없는 신규 행도 '(없음)' 으로 열어 보여주므로).
  const hasPrev = rounds.length > 1;
  return (
    <>
      {diffRounds
        ? <RowRoundHistoryModal title={t('request.jayer_row_history')} fields={fields} rounds={diffRounds} onClose={() => setDiffId(null)} />
        : diffCur && (
          <RowDiffModal title={t('request.jayer_row_history')} fields={fields} curRow={diffCur as any} prevRow={(diffPrev ?? null) as any} onClose={() => setDiffId(null)} />
        )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table table-compact" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              {hasPrev && <th style={{ width: 64 }}></th>}
              <th>{t('request.col_updated_date')}</th><th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_pp')}</th><th>{t('request.col_st')}</th><th>{t('request.col_new_or_copy')}</th><th>{t('request.col_product_name')}</th><th>{t('request.col_step')}</th><th>{t('request.col_item_id')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isChanged = changedRowIds.has(r.id);
              return (
                <tr key={r.id} style={isChanged ? changedRowStyle : undefined}>
                  {hasPrev && (
                    <td style={{ textAlign: 'center' }}>
                      {isChanged && canOpenRowHistory(r.id, { prevRowMap, historyMode, rounds }) && (
                        <button data-tour="jayer-hist-btn" style={histBtnStyle} onClick={() => setDiffId(r.id)}>{t('request.history_check_btn')}</button>
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
  historyMode = false,
  rounds = [],
}: {
  rows: OayerRow[];
} & TableHistoryProps<OayerRow>) {
  const { t } = useTranslation();
  const [diffId, setDiffId] = useState<string | null>(null);
  if (!rows || rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('common.no_data')}</div>;
  const diffCur = diffId ? rows.find((r) => r.id === diffId) : null;
  const diffPrev = diffId ? prevRowMap?.get(diffId) : null;
  const diffRounds = diffId && historyMode ? buildRowTimeline(rows, rounds, (r) => r.oayerRows, diffId) : null;
  const fields = toDiffFields(OAYER_DIFF_FIELDS, t);
  // 이전 회차가 있으면 버튼 열을 연다(짝 없는 신규 행도 '(없음)' 으로 열어 보여주므로).
  const hasPrev = rounds.length > 1;
  return (
    <>
      {diffRounds
        ? <RowRoundHistoryModal title={t('request.oayer_row_history')} fields={fields} rounds={diffRounds} onClose={() => setDiffId(null)} />
        : diffCur && (
          <RowDiffModal title={t('request.oayer_row_history')} fields={fields} curRow={diffCur as any} prevRow={(diffPrev ?? null) as any} onClose={() => setDiffId(null)} />
        )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table table-compact" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              {hasPrev && <th style={{ width: 64 }}></th>}
              <th>{t('request.col_updated_date')}</th><th>{t('request.process_id')}</th><th>{t('request.col_sp')}</th><th>{t('request.col_sd')}</th><th>{t('request.col_layer')}</th><th>{t('request.col_pp')}</th><th>{t('request.col_st')}</th><th>{t('request.col_new_or_copy')}</th><th>{t('request.col_product_name')}</th><th>{t('request.col_step')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isChanged = changedRowIds.has(r.id);
              return (
                <tr key={r.id} style={isChanged ? changedRowStyle : undefined}>
                  {hasPrev && (
                    <td style={{ textAlign: 'center' }}>
                      {isChanged && canOpenRowHistory(r.id, { prevRowMap, historyMode, rounds }) && (
                        <button style={histBtnStyle} onClick={() => setDiffId(r.id)}>{t('request.history_check_btn')}</button>
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
  historyMode = false,
  rounds = [],
  tabCount = 0,
  entryIds = [],
}: {
  rows: BbTableRow[];
  tabCount?: number;
  entryIds?: string[];
} & TableHistoryProps<BbTableRow>) {
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
  const diffRounds = diffId && historyMode ? buildRowTimeline(rows, rounds, (r) => r.bbRows, diffId) : null;
  const fields = toDiffFields(BB_DIFF_FIELDS, t);
  // 이전 회차가 있으면 버튼 열을 연다(짝 없는 신규 행도 '(없음)' 으로 열어 보여주므로).
  const hasPrev = rounds.length > 1;
  return (
    <>
      {diffRounds
        ? <RowRoundHistoryModal title={t('request.bb_row_history_title')} fields={fields} rounds={diffRounds} onClose={() => setDiffId(null)} />
        : diffCur && (
          <RowDiffModal title={t('request.bb_row_history_title')} fields={fields} curRow={diffCur as any} prevRow={(diffPrev ?? null) as any} onClose={() => setDiffId(null)} />
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
                      {isChanged && canOpenRowHistory(r.id, { prevRowMap, historyMode, rounds }) && (
                        <button style={histBtnStyle} onClick={() => setDiffId(r.id)}>{t('request.history_check_btn')}</button>
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

/**
 * 행 비교용 서명 — **이력 모달에 표시되는 컬럼만** 본다.
 * id·sortOrder·disabled 같은 내부 필드는 물론, loaded·manuallyDisabled·entryId 처럼
 * 화면에 없는 값도 비교에서 빠진다(이 값들은 재상신 편집 로드 때 시스템이 재계산하므로,
 * 함께 비교하면 사용자가 아무것도 고치지 않아도 '변경됨'으로 잡혔다).
 */
function rowContentSig(row: any, fields: DiffFieldDef[]): string {
  return JSON.stringify(fields.map((f) => String(row?.[f.key] ?? '')));
}

/**
 * 현재 행 ↔ 이전 회차 행 짝짓기. 세 단계를 순서대로 시도한다.
 *
 *  1. **id** — 손대지 않은 행. 겹치는 id 가 하나도 없으면(표가 통째로 재생성된 경우)
 *     위치(index)로 폴백한다.
 *  2. **sourceJayerRowId** — bb 행 전용. J-ayer 행을 고치면 그 행에 매핑된 bb 행이
 *     삭제되고(`unmapJayerRows`), 다시 지정하면 **새 id 로 만들어져 배열 끝에 붙는다**
 *     (`handleApplyMappings` → `makeBbRow`). id 로는 짝을 못 찾지만 어느 J-ayer 행에서
 *     왔는지는 남아 있으므로, 그 값으로 "이 J 행에 지정됐던 이전 bb 행"을 찾는다.
 *     한 J 행에 bb 행이 여럿이면 등장 순서대로 짝짓는다.
 *     (`entryId` 는 키로 쓰지 않는다 — 지정이 바뀌면 그 값 자체가 바뀌므로 짝이 깨진다.)
 *  3. 그래도 없으면 **이번 회차에 새로 생긴 행**이다(J-ayer 신규 행에서 온 bb, 수기 추가 행 등).
 */
function matchPrevRows<T extends { id: string }>(cur: T[], prev: T[]): Map<string, T> {
  const matched = new Map<string, T>();
  if (!prev || prev.length === 0) return matched;

  const prevById = new Map(prev.map((r) => [r.id, r]));
  const anyIdMatch = (cur ?? []).some((r) => prevById.has(r.id));

  if (!anyIdMatch) {
    for (let i = 0; i < (cur ?? []).length; i++) {
      if (prev[i]) matched.set(cur[i].id, prev[i]);
    }
    return matched;
  }

  const usedPrevIds = new Set<string>();
  for (const row of cur ?? []) {
    const p = prevById.get(row.id);
    if (p) { matched.set(row.id, p); usedPrevIds.add(p.id); }
  }

  // 남은 이전 행을 출처 J-ayer 행별로 모아 순서대로 소비한다.
  const sourceKey = (r: T): string => String((r as { sourceJayerRowId?: string }).sourceJayerRowId ?? '');
  const leftoverBySource = new Map<string, T[]>();
  for (const p of prev) {
    const key = sourceKey(p);
    if (!key || usedPrevIds.has(p.id)) continue;
    const bucket = leftoverBySource.get(key);
    if (bucket) bucket.push(p);
    else leftoverBySource.set(key, [p]);
  }
  for (const row of cur ?? []) {
    if (matched.has(row.id)) continue;
    const bucket = leftoverBySource.get(sourceKey(row));
    const p = bucket?.shift();
    if (p) matched.set(row.id, p);
  }

  return matched;
}

function computeTableDiff<T extends { id: string }>(
  cur: T[],
  prev: T[],
  fields: DiffFieldDef[]
): { changedIds: Set<string>; prevRowMap: Map<string, T> } {
  const changedIds = new Set<string>();
  const prevRowMap = matchPrevRows(cur, prev);

  if (!prev || prev.length === 0) {
    return { changedIds, prevRowMap };
  }

  for (const row of cur ?? []) {
    const p = prevRowMap.get(row.id);
    // 짝이 없으면 이번 회차에 새로 생긴 행이다.
    if (!p || rowContentSig(row, fields) !== rowContentSig(p, fields)) changedIds.add(row.id);
  }

  return { changedIds, prevRowMap };
}

/**
 * 이력 조회용 — 전 회차를 훑어 **한 번이라도** 바뀐 필드를 모은다.
 * 인접 회차(1↔2, 2↔3, …, 직전↔현재)의 diff 합집합이므로, 값이 되돌아온 필드도 포함된다.
 */
function computeEverChangedFields(rounds: RoundSnapshot[]): Set<string> {
  const changed = new Set<string>();
  for (let i = 1; i < rounds.length; i++) {
    computeDetailDiff(rounds[i].detail, rounds[i - 1].detail).forEach((k) => changed.add(k));
  }
  return changed;
}

/**
 * 현재 행 기준 회차별 값 타임라인 — 그 회차에 대응 행이 없으면 null 이다.
 * 짝짓기는 `matchPrevRows` 와 같은 규칙(id → sourceJayerRowId → 없음)이라
 * 강조 판정과 모달 내용이 어긋나지 않는다.
 */
function buildRowTimeline<T extends { id: string }>(
  cur: T[], rounds: RoundSnapshot[], pick: (r: RoundSnapshot) => T[], rowId: string,
): { label: string; timestamp: string | null; row: T | null }[] {
  return rounds.map((r) => ({
    label: r.label,
    timestamp: r.timestamp,
    row: matchPrevRows(cur, pick(r)).get(rowId) ?? null,
  }));
}

/** 이력 조회용 — 전 회차 중 한 번이라도 내용이 바뀐(또는 생겼다 사라진) 행 id 를 모은다. */
function computeTableEverChanged<T extends { id: string }>(
  cur: T[], rounds: RoundSnapshot[], pick: (r: RoundSnapshot) => T[], fields: DiffFieldDef[],
): Set<string> {
  const changedIds = new Set<string>();
  if (rounds.length < 2) return changedIds;
  for (const row of cur ?? []) {
    const timeline = buildRowTimeline(cur, rounds, pick, row.id);
    for (let i = 1; i < timeline.length; i++) {
      const a = timeline[i - 1].row;
      const b = timeline[i].row;
      const sig = (r: T | null) => (r ? rowContentSig(r, fields) : NO_ROW_SIG);
      if (sig(a) !== sig(b)) { changedIds.add(row.id); break; }
    }
  }
  return changedIds;
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
  /** J-ayer 검토 항목 — 넘기지 않으면 서브탭 자체가 뜨지 않는다(이력 조회 등 읽기 전용 화면) */
  reviewItems?: ReviewItemsPanelProps;
  /**
   * 이력 조회(결재 완료 문서) 화면인지. 이력 UI 의 동작이 통째로 갈린다.
   *  - false(결재 진행 중): **직전 회차와 다를 때만** 강조·버튼, 모달은 변경 전/후만.
   *  - true(이력 조회): **한 번이라도 바뀌었으면** 강조·버튼, 모달은 회차별 전체.
   */
  historyMode?: boolean;
}

export default function PagedDetailView({
  doc, role, pageIdx, setPageIdx, canEditValidationSystem = false, onValidationSystemChange,
  reviewItems, historyMode = false,
}: PagedDetailViewProps): React.ReactElement {
  const { t } = useTranslation();
  // J-ayer 정보 안의 서브탭. 검토 항목은 J 권한자에게만 열리므로 기본은 기존 표다.
  const [jayerSubtab, setJayerSubtab] = useState<'table' | 'items'>('table');
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

  // 엑셀 export — 시트 생성 로직은 상세 정보/MAP 정보 export, 전체 export(부모 컴포넌트)와
  // 공유하므로 utils/detailExport 에 모아 두고 여기서는 그대로 호출만 한다.
  const exportJayer = () => exportJayerXlsx(doc, t);
  const exportOayer = () => exportOayerXlsx(doc, t);
  const exportBb = () => exportBbXlsx(doc, t);
  const exportDetail = () => exportDetailInfoXlsx(doc, t);
  const exportMap = () => exportMapInfoXlsx(doc, t);

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

  // 회차 축 — 1차~직전 회차 + 현재. 이력 조회의 모든 이력 UI 가 이 배열 하나를 공유한다.
  // (결재 경로 섹션의 `rounds`(회차 번호 배열)와 다른 값이라 이름을 구분한다.)
  const roundSnaps: RoundSnapshot[] = [
    ...history.map((snap, i) => ({
      label: roundLabel(t, i),
      timestamp: snap.timestamp,
      detail: snap.detail ?? {},
      jayerRows: snap.jayerRows ?? [],
      oayerRows: snap.oayerRows ?? [],
      bbRows: snap.bbRows ?? [],
    })),
    { label: currentRoundLabel(t), timestamp: null, detail, jayerRows: jayer, oayerRows: oayer, bbRows: bb },
  ];
  /** 이력 UI 를 띄울 회차가 있는지 — 재상신이 한 번도 없으면 비교 대상 자체가 없다. */
  const hasRounds = history.length > 0;

  // 강조·버튼 판정 기준이 모드에 따라 갈린다(진행 중=직전 회차 대비 / 이력 조회=전 회차 중 한 번이라도).
  const changedFields = historyMode
    ? computeEverChangedFields(roundSnaps)
    : (prevSnap ? computeDetailDiff(detail, prevSnap.detail) : new Set<string>());

  const { changedIds: prevChangedJayerIds, prevRowMap: prevJayerMap } = prevSnap
    ? computeTableDiff(jayer, prevSnap.jayerRows ?? [], JAYER_DIFF_FIELDS)
    : { changedIds: new Set<string>(), prevRowMap: new Map<string, JayerRow>() };
  const { changedIds: prevChangedOayerIds, prevRowMap: prevOayerMap } = prevSnap
    ? computeTableDiff(oayer, prevSnap.oayerRows ?? [], OAYER_DIFF_FIELDS)
    : { changedIds: new Set<string>(), prevRowMap: new Map<string, OayerRow>() };
  const { changedIds: prevChangedBbIds, prevRowMap: prevBbMap } = prevSnap
    ? computeTableDiff(bb, prevSnap.bbRows ?? [], BB_DIFF_FIELDS)
    : { changedIds: new Set<string>(), prevRowMap: new Map<string, BbTableRow>() };

  const changedJayerIds = historyMode
    ? computeTableEverChanged(jayer, roundSnaps, (r) => r.jayerRows, JAYER_DIFF_FIELDS)
    : prevChangedJayerIds;
  const changedOayerIds = historyMode
    ? computeTableEverChanged(oayer, roundSnaps, (r) => r.oayerRows, OAYER_DIFF_FIELDS)
    : prevChangedOayerIds;
  const changedBbIds = historyMode
    ? computeTableEverChanged(bb, roundSnaps, (r) => r.bbRows, BB_DIFF_FIELDS)
    : prevChangedBbIds;

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
  // 이력 조회에서는 1차~직전 회차 스냅샷 + 현재값을 회차 순서대로 모두 보여주고,
  // 결재 진행 중에는 다른 이력 UI 와 통일해 **직전 회차 대비 변경 전/후만** 보여준다.
  const FieldHistoryModal = ({
    label, fieldKey, currentValue, onClose, format, buildValue, buildTable,
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
    /** 표로 입력한 항목(TBV/TLV 등)의 표 생성기 — 넘기면 값 대신 미니 표로 그린다. */
    buildTable?: (d: any) => DiffTable | null;
  }) => {
    const fmt = (v: any) => (format ? format(v) : String(v ?? '-')) || '-';
    const valueOf = (d: any) => (buildValue ? (buildValue(d ?? {}) || '-') : fmt(fieldKey ? d?.[fieldKey] : undefined));
    const curValue = (buildValue ? buildValue(detail) : currentValue) || '-';
    const tableOf = (d: any) => (buildTable ? buildTable(d ?? {}) : null);

    if (!historyMode) {
      return (
        <FieldGroupHistoryModal
          title={t('request.field_change_history', { label })}
          rows={[{
            label,
            before: prevSnap ? valueOf(prevSnap.detail) : '-',
            after: curValue,
            ...(buildTable ? {
              kind: 'table' as const,
              beforeTable: prevSnap ? tableOf(prevSnap.detail) : null,
              afterTable: tableOf(detail),
            } : {}),
          }]}
          onClose={onClose}
        />
      );
    }

    const rows = [
      ...history.map((snap, i) => ({
        label: roundLabel(t, i),
        timestamp: snap.timestamp,
        value: valueOf(snap.detail),
        table: tableOf(snap.detail),
      })),
      {
        label: currentRoundLabel(t),
        timestamp: null as string | null,
        value: curValue,
        table: tableOf(detail),
      },
    ];
    const thStyle: React.CSSProperties = {
      textAlign: 'left', padding: '6px 10px',
      borderBottom: '1px solid var(--border)', fontSize: '0.8rem',
      color: 'var(--text-muted)', fontWeight: 600,
    };
    const tdStyle: React.CSSProperties = { padding: '6px 10px', fontSize: '0.85rem' };
    return (
      <Modal isOpen onClose={onClose} title={t('request.field_change_history', { label })}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>{t('request.submit_round_col')}</th>
              <th style={thStyle}>{t('request.time_col')}</th>
              <th style={thStyle}>{t('request.value_col')}</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>{t('request.changed_col')}</th>
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
                  <td style={{ ...tdStyle, fontWeight: isCurrent && !buildTable ? 700 : 400 }}>
                    {buildTable
                      ? (row.table && row.table.rows.length > 0
                          ? <DiffMiniTable table={row.table} other={i > 0 ? rows[i - 1].table : null} tone="neutral" />
                          : '-')
                      : row.value}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {i === 0
                      ? <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('request.initial_label')}</span>
                      : isChangedRow
                        ? <span style={{ color: '#dc3545', fontWeight: 700, fontSize: '0.78rem' }}>{t('request.changed_label')}</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{t('request.no_change_label')}</span>}
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
              {t('request.history_check_btn')}
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

  /** CLONE/EXISTING 등 잠긴 항목용 — Map Option/Inter 와 동일한 회색 "없음" 플레이스홀더 칩. */
  const PlaceholderChip = ({ label, style }: { label: string; style?: React.CSSProperties }) => (
    <div style={{ ...chipBase, ...style }}>
      <div style={fieldLabel}>{label}</div>
      <div style={fieldValue}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('request.value_none')}</span>
      </div>
    </div>
  );

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
      const reasonPart = d.map_reason ? t('request.reason_suffix', { reason: d.map_reason }) : '';
      return `${regionLine('top')}\n${regionLine('bottom')}${reasonPart}`;
    }
    if (!d.map_change) return '';
    return t('request.change_prefix', { value: d.map_change })
      + (d.map_value_x ? ` / X: ${d.map_value_x}um` : '')
      + (d.map_value_y ? ` / Y: ${d.map_value_y}um` : '')
      + (d.map_reason ? t('request.reason_suffix', { reason: d.map_reason }) : '');
  };

  /** Exclusive Area — 변경 여부 + 값(mm) */
  const buildEaValue = (d: Partial<DetailFormState>): string => {
    if (!d.ea_change) return '';
    return t('request.change_prefix', { value: d.ea_change }) + (d.ea_value ? t('request.value_suffix_mm', { value: d.ea_value }) : '');
  };

  /** 뼈찜(Backbone) — 등록된 항목 목록. 라벨은 의뢰서 작성(Step1)과 동일한 i18n 키를 그대로 쓴다. */
  const buildBbValue = (d: Partial<DetailFormState>): string => {
    const entries = d.bb_entries;
    if (!Array.isArray(entries) || entries.length === 0) return '-';
    return entries
      .map((e, i) => (
        `[${i + 1}] ${t('request.bb_ref_line')}: ${e.location || '-'}`
        + ` / ${t('request.bb_ref_part_id')}: ${e.product || '-'}`
        + ` / ${t('request.bb_ref_process_id')}: ${e.process_id || '-'}`
      ))
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
      lines.push(`[${t('request.plate_top')}] ${detail.prodc_top_line || '-'} / ${detail.prodc_top_process || '-'} / ${detail.prodc_top_product || '-'}`);
    }
    const middleUse = detail.prodc_middle_use;
    if (middleUse) {
      if (middleUse === '미사용') {
        lines.push(`[${t('request.plate_middle')}] 미사용`);
      } else {
        lines.push(`[${t('request.plate_middle')}] ${detail.prodc_middle_line || '-'} / ${detail.prodc_middle_process || '-'} / ${detail.prodc_middle_product || '-'}`);
      }
    }
    if (detail.prodc_bottom_line || detail.prodc_bottom_process || detail.prodc_bottom_product) {
      lines.push(`[${t('request.plate_bottom')}] ${detail.prodc_bottom_line || '-'} / ${detail.prodc_bottom_process || '-'} / ${detail.prodc_bottom_product || '-'}`);
    }
    return lines.join('\n');
  };

  const isProdc = detail.only_prodc === PRODC_YES;
  /** CLONE/EXISTING — StepMap 에서 MAP 관련 입력칸이 전부 잠기므로, 상세보기에서도
   *  지도편차·예외구역·X표시·C가문 세부정보는 값이 있어도 회색 "없음"으로 표시한다.
   *  (MAP 목적·원본 위치·원본 제품·C가문 Yes/No 는 잠기지 않으므로 실값 유지) */
  const isMapRegisteredDetail = detail.map_type === 'EXISTING' || detail.map_type === 'CLONE';
  // 요청 목적 'ADI CD 변경' — StepMap 을 아예 작성하지 않으므로 MAP 정보 탭 자체를 감춘다
  // (map_change 등은 기본값이 빈 문자열이 아니라 실제로 채운 것처럼 보일 수 있다).
  const isAdiCdChange = detail.request_purpose === 'ADI CD 변경';
  const mshotChange = detail.mshot_change || '없음';
  const mshotHasDetail = mshotChange === '추가' || mshotChange === '수정';
  const mshotIsDelete = mshotChange === '삭제';

  const PLBasicSection = null;
  const [mapHistOpen, setMapHistOpen] = useState(false);
  const [mshotHistOpen, setMshotHistOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [prodcHistOpen, setProdcHistOpen] = useState(false);
  const [finalHistOpen, setFinalHistOpen] = useState(false);
  const [flowHistOpen, setFlowHistOpen] = useState(false);

  // ===== 흐름도 이력 (블록 단위 — 표 전체를 회차/전후로 대조한다) =====
  const flowChanged = changedFields.has('flow_chart');
  /** 흐름도 한 회차분을 원본 표와 같은 열 구성의 표 데이터로 만든다. */
  const buildFlowTable = (d: any): DiffTable | null => {
    const rows: FlowChartRow[] = d?.flow_chart ?? [];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return {
      headers: [t('request.flow_line'), t('request.flow_partid'), t('request.flow_process_id'), 'Step'],
      rows: rows.map((r) => [
        r.location ?? '',
        r.product_name ?? '',
        r.process_id ?? '',
        r.step_from && r.step_to ? `${r.step_from} ~ ${r.step_to}` : (r.step_from || r.step_to || ''),
      ]),
    };
  };

  /**
   * 흐름도 이력 모달 — 행 단위가 아니라 표 전체를 구간별로 쌓아 보여준다.
   * 흐름도는 행 추가·삭제가 잦아, 행끼리 짝지어 비교하면 늘고 준 것을 놓친다.
   */
  const renderFlowHistory = (): React.ReactNode => {
    if (!hasRounds) return null;
    const sections = historyMode
      ? roundSnaps.map((r) => ({ label: r.label, timestamp: r.timestamp, table: buildFlowTable(r.detail), tone: 'neutral' as const }))
      : [
          { label: t('request.before_label'), timestamp: prevSnap?.timestamp ?? null, table: buildFlowTable(prevSnap?.detail), tone: 'before' as const },
          { label: t('request.after_label'), timestamp: null, table: buildFlowTable(detail), tone: 'after' as const },
        ];
    return (
      <Modal isOpen onClose={() => setFlowHistOpen(false)} title={t('request.field_change_history', { label: t('request.flow_chart') })}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sections.map((s, si) => {
            // 진행 중에는 서로를(전↔후), 이력 조회에서는 직전 회차를 비교 대상으로 삼는다.
            const other = historyMode
              ? (si > 0 ? sections[si - 1].table : null)
              : sections[si === 0 ? 1 : 0].table;
            const headColor = s.tone === 'before' ? '#dc3545' : s.tone === 'after' ? '#155724' : 'var(--text-muted)';
            return (
              <div key={s.label}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: headColor, marginBottom: 6 }}>
                  {s.label}
                  {historyMode && <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--text-muted)' }}>{fmtRoundTime(s.timestamp)}</span>}
                </div>
                {s.table
                  ? <DiffMiniTable table={s.table} other={other} tone={s.tone} />
                  : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('request.value_none')}</span>}
              </div>
            );
          })}
        </div>
      </Modal>
    );
  };

  /**
   * 블록(엠샷/생산정보/Final) 이력 모달 — 모드에 따라 회차별 표와 변경 전/후 표가 갈린다.
   * 두 표 모두 같은 빌더를 쓰므로 항목 라벨·순서는 어느 쪽에서나 동일하다.
   */
  const renderGroupHistory = (title: string, build: GroupBuilder, onClose: () => void): React.ReactNode => {
    if (!hasRounds) return null;
    return historyMode
      ? <FieldGroupRoundHistoryModal title={title} rounds={roundSnaps} build={build} onClose={onClose} />
      : <FieldGroupHistoryModal title={title} rows={toDiffRows(prevSnap?.detail, detail, build, t)} onClose={onClose} />;
  };

type Page = { label: string; content: React.ReactNode };
  const pages: Page[] = [
    {
      label: t('request.section_detail'),
      content: (
        <div>
          {PLBasicSection}

          <div style={cardStyle}>
            <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('approval.section_basic')}</span>
              <button onClick={exportDetail} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 {t('request.export_btn')}</button>
            </div>
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

          {/* ADI CD 변경 전용 카드 — '기본 정보' 바로 아래(2026-08-21). 요청 목적이 'ADI CD 변경'일 때만
              보인다 — 과거 '기타 목적 > ADI CD 변경'으로 저장된 레거시 문서는 adi_cd_before/after 값이
              남아 있어도 더 이상 여기 나타나지 않는다(저장값 자체는 그대로, 표시 조건만 좁힌 것). */}
          {isAdiCdChange && (detail.adi_cd_extra_targets ?? []).length > 0 && (
            <div style={cardStyle}>
              <div style={sectionTitle}>{t('request.adi_cd_targets_title')}</div>
              <AdiCdTargetsTable
                first={{ partid_selection: detail.partid_selection ?? '', process_id: detail.process_id ?? '' }}
                extras={detail.adi_cd_extra_targets ?? []}
              />
            </div>
          )}

          {isAdiCdChange && ((detail.adi_cd_before ?? []).some((r) => r.unregistered || r.step_id.trim() || r.step_desc.trim())
            || (detail.adi_cd_after ?? []).some((r) => r.unregistered || r.step_id.trim() || r.step_desc.trim())) && (
            <div style={cardStyle}>
              <div style={sectionTitle}>{t('request.adi_cd_section_title')}</div>
              <AdiCdStepsTable
                before={detail.adi_cd_before ?? []}
                after={detail.adi_cd_after ?? []}
              />
            </div>
          )}

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

            {detail.change_purpose_note && (
              <div style={rowStyle}>
                <Chip label={t('request.change_purpose_note')} value={detail.change_purpose_note} style={chipFull} changed={changedFields.has('change_purpose_note')} fieldKey="change_purpose_note" />
              </div>
            )}


          </div>

          {showFlowChart && (detail.flow_chart?.length ?? 0) > 0 && (
            <div style={{ ...cardStyle, position: 'relative', ...(flowChanged ? { border: '2px solid #dc3545' } : {}) }}>
              {flowChanged && hasRounds && (
                <button
                  onClick={() => setFlowHistOpen(true)}
                  style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 }}
                >
                  {t('request.history_check_btn')}
                </button>
              )}
              {flowHistOpen && renderFlowHistory()}
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


          {doc.reference_materials && (
            <div style={cardStyle}>
              <div style={sectionTitle}>{t('request.submit_note_label')}</div>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {doc.reference_materials}
              </div>
            </div>
          )}
        </div>
      ),
    },
  ];

  // ADI CD 변경은 StepMap 자체를 작성하지 않는다 — map_change/ea_change 등은 기본값(빈 값이
  // 아닌 '변경 없음' 류)이 그대로 남아 있어 실제로 채운 것처럼 보이므로, 탭 자체를 감춘다.
  const showMap = (isR || isO || isP) && !isAdiCdChange;
  if (showMap) {
    pages.push({
      label: t('request.section_map'),
      content: (
        <div style={cardStyle}>
          <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🗺️ {t('request.section_map')}</span>
            <button onClick={exportMap} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 {t('request.export_btn')}</button>
          </div>

          {detail.map_type && (
            <div style={rowStyle}>
              <Chip label={t('request.map_type')} value={detail.map_type} changed={changedFields.has('map_type')} fieldKey="map_type" />
              {isMapRegisteredDetail && detail.source_line && (
                <Chip label={t('request.source_line')} value={detail.source_line} changed={changedFields.has('source_line')} fieldKey="source_line" />
              )}
              {isMapRegisteredDetail && detail.source_partid && (
                <Chip label={t('request.source_partid_selection')} value={detail.source_partid} changed={changedFields.has('source_partid')} fieldKey="source_partid" />
              )}
            </div>
          )}

          {/* MAP 삭제 이유 — 작성 화면과 동일하게 이 모드에서는 이것만 있으면 된다.
              (2026-08) '수정'이 없어지면서 라벨도 작성 화면과 같은 'MAP 삭제 이유' 하나가 됐다.
              본문은 RichTextEditor 가 만든 HTML 이라 공지·가이드·VOC 와 같은 방식으로 렌더한다. */}
          {isMapDeleteEditType(detail.map_type) && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6 }}>
                {t('request.map_change_reason_delete')}
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

          {/* CLONE/EXISTING — StepMap 에서 잠겨 의미 없는 기본값이므로 회색 "없음"으로 대체한다. */}
          {isMapRegisteredDetail && (isR || isO || isP) && (
            <div style={rowStyle}>
              <PlaceholderChip label={t('request.map')} style={chipWide} />
              <PlaceholderChip label={t('request.ea_change')} style={chipWide} />
            </div>
          )}

          {/* MAP 삭제 모드는 이 아래 항목들을 작성 화면에서부터 숨긴다 — 저장된 값은
              INITIAL_DETAIL 기본값('변경 없음'/'No'/'없음' 등)일 뿐이라 상세에서도 함께 숨긴다. */}
          {!isMapRegisteredDetail && !isMapDeleteEditType(detail.map_type) && (isR || isO || isJ || isP) && (detail.map_change || (detail as any).map_change_top || detail.ea_change) && (
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

          {/* CLONE/EXISTING — X표시 변경 여부도 잠긴 기본값이므로 회색 "없음"으로 대체한다. */}
          {isMapRegisteredDetail && (isR || isO || isP) && (
            <div style={rowStyle}>
              <PlaceholderChip label={t('request.mshot_change_status')} />
            </div>
          )}

          {!isMapRegisteredDetail && !isMapDeleteEditType(detail.map_type) && (isR || isO || isP) && detail.mshot_change && (() => {
            const mshotChanged = changedFields.has('mshot_change') || changedFields.has('mshot_image_copy') || changedFields.has('mshot_image_copy_top') || changedFields.has('mshot_image_copy_bottom');
            const imgStyle: React.CSSProperties = { maxWidth: '600px', maxHeight: '420px', borderRadius: '4px', border: '1px solid #ddd', marginTop: '8px', cursor: 'zoom-in' };
            const renderMshotImg = (src: string, alt: string) => (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={src} alt={alt} style={imgStyle} onClick={() => setZoomedImage(src)} />
                <button
                  type="button"
                  onClick={() => setZoomedImage(src)}
                  aria-label={t('request.mshot_image_zoom_btn')}
                  title={t('request.mshot_image_zoom_btn')}
                  style={{
                    position: 'absolute', right: 6, bottom: 14, width: 28, height: 28,
                    borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff',
                    cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  🔍
                </button>
              </div>
            );
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200, position: 'relative', ...(mshotChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  {mshotChanged && (
                    <button
                      onClick={() => setMshotHistOpen(true)}
                      style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 }}
                    >
                      {t('request.history_check_btn')}
                    </button>
                  )}
                  {mshotHistOpen && (
                    renderGroupHistory(t('request.mshot_history_title'), buildMshotItems, () => setMshotHistOpen(false))
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
                      {renderMshotImg(`/media/${detail.mshot_image_copy}`, 'attached')}
                    </div>
                  )}
                  {mshotHasDetail && isProdc && (detail.mshot_image_copy_top || detail.mshot_image_copy_bottom) && (
                    <div style={{ flex: 1, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                      {detail.mshot_image_copy_top && (
                        <div>
                          <div style={fieldLabel}>{t('request.mshot_change_image_attach_area')} — {t('request.prodc_top')}</div>
                          {renderMshotImg(`/media/${detail.mshot_image_copy_top}`, 'top')}
                        </div>
                      )}
                      {detail.mshot_image_copy_bottom && (
                        <div>
                          <div style={fieldLabel}>{t('request.mshot_change_image_attach_area')} — {t('request.prodc_bottom')}</div>
                          {renderMshotImg(`/media/${detail.mshot_image_copy_bottom}`, 'bottom')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {!isMapDeleteEditType(detail.map_type) && (isR || isO || isP) && detail.only_prodc && (() => {
            const prodcChanged = ['only_prodc','prodc_scope','prodc_top_line','prodc_top_process','prodc_top_product','prodc_middle_use','prodc_middle_line','prodc_middle_process','prodc_middle_product','prodc_bottom_line','prodc_bottom_process','prodc_bottom_product'].some((k) => changedFields.has(k));
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, display: 'flex', gap: 0, textAlign: 'left', flex: '1 1 auto', minWidth: 200, position: 'relative', ...(prodcChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  {prodcChanged && (
                    <button
                      onClick={() => setProdcHistOpen(true)}
                      style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 }}
                    >
                      {t('request.history_check_btn')}
                    </button>
                  )}
                  {prodcHistOpen && (
                    renderGroupHistory(t('request.prodc_history_title'), buildProdcItems, () => setProdcHistOpen(false))
                  )}
                  <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                    <div style={fieldLabel}>{t('request.prodc_status')}</div>
                    <div style={fieldValue}>{detail.only_prodc}</div>
                  </div>
                  {/* CLONE/EXISTING — C가문 Yes/No 자체는 실값을 유지하되, 잠긴 세부 정보(제품
                      해당 위치·상/중/하판)는 회색 "없음"으로 대체한다. */}
                  {isProdc && isMapRegisteredDetail && (
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>{t('approval.prodc_detail')}</div>
                      <div style={fieldValue}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('request.value_none')}</span>
                      </div>
                    </div>
                  )}
                  {isProdc && !isMapRegisteredDetail && buildProdcInfo() && (
                    <div style={{ flex: 1 }}>
                      <div style={fieldLabel}>{t('approval.prodc_detail')}</div>
                      <div style={{ ...fieldValue, whiteSpace: 'pre-line' }}>{buildProdcInfo()}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Final — C가문(only_prodc)과 독립된 항목이므로 C가문 Yes/No 와 무관하게 표시한다. */}
          {(isR || isO || isP) && (() => {
            const finalChanged = changedFields.has('final_yn') || changedFields.has('final_entries');
            const finalYn = detail.final_yn;
            const finalEntries = detail.final_entries;
            if (!finalYn) return null;
            return (
              <div style={rowStyle}>
                <div style={{ ...chipBase, textAlign: 'left', flex: '1 1 auto', minWidth: 200, position: 'relative', ...(finalChanged ? { border: '2px solid #dc3545' } : {}) }}>
                  {finalChanged && (
                    <button
                      onClick={() => setFinalHistOpen(true)}
                      style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 }}
                    >
                      {t('request.history_check_btn')}
                    </button>
                  )}
                  {finalHistOpen && (
                    renderGroupHistory(t('request.final_history_title'), buildFinalItems, () => setFinalHistOpen(false))
                  )}
                  <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                    <div style={{ flex: '0 0 auto', paddingRight: 12, borderRight: '1px solid var(--border)', marginRight: 12 }}>
                      <div style={fieldLabel}>{t('request.final_yn_label')}</div>
                      <div style={fieldValue}>{finalYn}</div>
                    </div>
                    {finalYn === 'YES' && Array.isArray(finalEntries) && finalEntries.length > 0 && (
                      <div style={{ flex: 1 }}>
                        <div style={{ ...fieldLabel, marginBottom: 6 }}>{t('request.final_gds')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {finalEntries.map((gds, idx) => (
                            <span key={idx} style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 999, padding: '2px 10px', fontSize: '0.78rem', fontWeight: 700 }}>{gds}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {!isMapDeleteEditType(detail.map_type) && (isR || isO || isP) && (() => {
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
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('request.value_none')}</span>
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
                        {t('request.history_check_btn')}
                      </button>
                    )}
                    <div style={fieldLabel}>{t('request.map_option_title')}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      {activeOptions.length > 0
                        ? activeOptions.map(o => <div key={o.fieldKey} style={tagStyle(true)}>{o.label}</div>)
                        : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('request.value_none')}</span>
                      }
                    </div>
                    {mapHistOpen && hasRounds && (() => {
                      // 값이 태그 목록이라 표 대신 구간별 목록으로 보여준다.
                      // 이력 조회는 회차 전부, 결재 진행 중은 직전·현재 두 구간만 나열한다.
                      const sections = historyMode
                        ? roundSnaps.map((r) => ({
                            label: r.label,
                            timestamp: r.timestamp,
                            opts: mapOptionDefs.filter(o => (r.detail as any)?.[o.fieldKey] === o.activeValue),
                          }))
                        : [
                            { label: t('request.previous_before_resubmit'), timestamp: prevSnap?.timestamp ?? null, opts: prevActiveOptions },
                            { label: currentRoundLabel(t), timestamp: null, opts: activeOptions },
                          ];
                      return (
                        <Modal isOpen onClose={() => setMapHistOpen(false)} title={t('request.field_change_history', { label: t('request.map_option_title') })}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {sections.map((s) => (
                              <div key={s.label}>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>
                                  {s.label}
                                  {historyMode && <span style={{ fontWeight: 400, marginLeft: 8 }}>{fmtRoundTime(s.timestamp)}</span>}
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {s.opts.length > 0
                                    ? s.opts.map(o => <div key={o.fieldKey} style={tagStyle(true)}>{o.label}</div>)
                                    : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('request.value_none')}</span>
                                  }
                                </div>
                              </div>
                            ))}
                          </div>
                        </Modal>
                      );
                    })()}
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
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>{t('request.total_count_items', { count: jayer.length })}</span>
              <button data-tour="export-jayer" onClick={exportJayer} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 export</button>
            </div>
          </div>
          {reviewItems && (
            <div className="ri-subtabs">
              <button
                type="button"
                data-tour="ri-subtab-table"
                className={`ri-subtab${jayerSubtab === 'table' ? ' active' : ''}`}
                onClick={() => setJayerSubtab('table')}
              >
                {t('request.job_li')}
              </button>
              <button
                type="button"
                data-tour="ri-subtab"
                className={`ri-subtab${jayerSubtab === 'items' ? ' active' : ''}`}
                onClick={() => setJayerSubtab('items')}
              >
                {t('request.ri_subtab_items')}
                {reviewItems.items.length > 0 && (
                  <span className={`ri-dot ${reviewItems.items.some((it) => !it.is_done) ? 'ri-dot-open' : 'ri-dot-done'}`} />
                )}
              </button>
            </div>
          )}
          {reviewItems && jayerSubtab === 'items' ? (
            <ReviewItems {...reviewItems} />
          ) : (
          <>
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
          <JayerTable rows={jayer.filter(r => !r.disabled)} changedRowIds={changedJayerIds} prevRowMap={prevJayerMap} historyMode={historyMode} rounds={roundSnaps} />
          </>
          )}
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
          const [infoHist, setInfoHist] = React.useState<{ label: string; fieldKey: string; value: string; format?: (v: any) => string; buildTable?: (d: any) => DiffTable | null } | null>(null);
          const infoHistBtnStyle: React.CSSProperties = { position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#dc3545', fontSize: '0.68rem', fontWeight: 700, padding: 0, zIndex: 1 };
          const infoChangedBox: React.CSSProperties = { border: '2px solid #dc3545', borderRadius: 6, padding: '8px 10px', position: 'relative' };
          return (
            <div style={cardStyle}>
              <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('request.ovl_li')}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>{t('request.total_count_items', { count: oayer.length })}</span>
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
                      ? <span title={t('request.changed_label')} style={{ width: 7, height: 7, borderRadius: '50%', background: '#dc3545', display: 'inline-block' }} />
                      : infoHasData
                        ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4CAF50', display: 'inline-block' }} />
                        : null)}
                  </button>
                ))}
              </div>
              {activeTab === 'table' && (
                <OayerTable rows={oayer.filter(r => !r.disabled)} changedRowIds={changedOayerIds} prevRowMap={prevOayerMap} historyMode={historyMode} rounds={roundSnaps} />
              )}
              {activeTab === 'info' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13 }}>
                  {infoHist && (
                    <FieldHistoryModal
                      label={infoHist.label}
                      fieldKey={infoHist.fieldKey}
                      currentValue={infoHist.value}
                      format={infoHist.format}
                      buildTable={infoHist.buildTable}
                      onClose={() => setInfoHist(null)}
                    />
                  )}
                  {/* Partial Shot */}
                  <div style={psChanged ? infoChangedBox : undefined}>
                    {psChanged && (
                      <button style={infoHistBtnStyle} onClick={() => setInfoHist({ label: t('request.partial_shot'), fieldKey: 'partial_shot', value: detail.partial_shot || '-' })}>{t('request.history_check_btn')}</button>
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
                          <button style={infoHistBtnStyle} onClick={() => setInfoHist({ label: t('request.tbvtlv_thickness'), fieldKey: 'tbvtlv_thickness', value: detail.tbvtlv_thickness || '-' })}>{t('request.history_check_btn')}</button>
                        )}
                        <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{t('request.tbvtlv_thickness')}:</span>
                        <span style={{ fontWeight: 600 }}>{detail.tbvtlv_thickness}</span>
                      </div>
                    )}
                    <div style={entChanged ? infoChangedBox : undefined}>
                    {entChanged && (
                      <button style={infoHistBtnStyle} onClick={() => setInfoHist({ label: t('request.tbvtlv'), fieldKey: 'tbvtlv_entries', value: fmtTbvtlvEntries(detail.tbvtlv_entries), format: fmtTbvtlvEntries, buildTable: (d) => buildTbvtlvTable(d?.tbvtlv_entries, t) })}>{t('request.history_check_btn')}</button>
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
              <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>{t('request.total_count_items', { count: bb.length })}</span>
              <button onClick={exportBb} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem', padding: '2px 10px' }}>📊 export</button>
            </div>
          </div>
          <BbTable rows={bb} changedRowIds={changedBbIds} prevRowMap={prevBbMap} historyMode={historyMode} rounds={roundSnaps} tabCount={Array.isArray(detail?.bb_entries) ? detail.bb_entries.length : 0} entryIds={Array.isArray(detail?.bb_entries) ? detail.bb_entries.map((e: { id?: string }) => e.id ?? '') : []} />
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

  // MAP 삭제: P·R·J·O 병렬 경로라 E·RA 는 아예 만들지 않는다(고정 후결자도 없다).
  const isMapDeleteEdit = (() => {
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      return parsed?.detail?.request_purpose === 'MAP 삭제';
    } catch { return false; }
  })();

  // ADI CD 변경: PL 검토 후 R·O 없이 P·J 만 병렬로 진행한다(E·RA 도 만들지 않는다 —
  // Jayer 가 비어 있어 판정 키워드가 없고, other_purpose 가 비어 있어 후결자 조건도 성립하지 않는다).
  // (isAdiCdChange 는 위에서 detail.request_purpose 로 이미 선언했다 — 재선언하지 않는다)

  // 기타 목적이 'Overlay 변경' 하나뿐이면 결재 경로에서 J 를 뺀다(백엔드 skip_j_stage 와 동일 기준).
  // 'MAP 삭제' 은 J 가 병렬 묶음의 구성원이라 제외 대상이 아니다.
  const skipJStage = (() => {
    if (isMapDeleteEdit) return false;
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      const raw = parsed?.detail?.other_purpose;
      const list: string[] = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
      return list.length === 1 && list[0] === OTHER_PURPOSE_OVERLAY;
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
  };

  // 단일 ApprovalStep → 표시 정보
  const stepToInfo = (s: NonNullable<ReturnType<typeof getStep>>): StepDisplayInfo => {
    const email = s.assignee_mail || undefined;
    if (s.action === 'approved') return {
      status: 'approved', label: t('approval.agree'),
      assignee: s.assignee_name || undefined, email,
      date: formatDateTimeShort(s.acted_at),
      comment: s.comment || undefined,
    };
    if (s.action === 'rejected') return {
      status: 'rejected', label: t('approval.reject'),
      assignee: s.assignee_name || undefined, email,
      date: formatDateTimeShort(s.acted_at),
      comment: s.comment || undefined,
    };
    // (2026-08 이전 OR 시절 문서에만 남는 이력) 그때는 EV 1명 합의로 단계가 끝나면 남은
    // 검토자가 skip 으로 닫혔다. 지금은 EV도 전원 합의(AND)라 새로 생기지 않는다.
    // comment 를 반드시 싣는다 — 그 검토자가 남긴 수정 요청 이력이 화면에서 사라지면 안 된다.
    if (s.action === 'skip') return {
      status: 'skipped', label: t('approval.step_skip'),
      assignee: s.assignee_name || undefined, email,
      date: formatDateTimeShort(s.acted_at),
      comment: s.comment || undefined,
    };
    // pending
    if (!s.assignee_name) return { status: 'unassigned', label: t('approval.step_unassigned') };
    return { status: 'reviewing', label: t('common.status_under_review'), assignee: s.assignee_name || undefined, email };
  };

  // 한 단계(agent·round)의 표시 정보 목록. PL/J 등 다중 담당자는 담당자별로 여러 항목을 반환한다.
  const getStepDisplays = (agent: string, round: number): StepDisplayInfo[] => {
    if (agent === 'E' && !hasPlel) {
      return [{ status: 'na', label: t('approval.step_na') }];
    }
    if (isOnlyMap && ['P', 'J', 'O', 'E'].includes(agent)) {
      return [{ status: 'na', label: t('approval.step_na') }];
    }
    // MAP 삭제은 RA(후결자)를 아예 만들지 않는다 — 없이도 fallback 을 타면
    // '대기'로 보여 영원히 끝나지 않는 단계처럼 오해를 준다(E 처럼 명시적 na 분기 필요).
    if (isMapDeleteEdit && agent === 'RA') {
      return [{ status: 'na', label: t('approval.step_na') }];
    }
    // ADI CD 변경은 R·O·RA 를 아예 만들지 않는다 — 없이도 fallback 을 타면 '대기'로 보여
    // 영원히 끝나지 않는 단계처럼 오해를 준다(위 두 분기와 같은 이유의 명시적 na 분기).
    if (isAdiCdChange && ['R', 'O', 'RA'].includes(agent)) {
      return [{ status: 'na', label: t('approval.step_na') }];
    }
    // 'Overlay 변경' 단독 문서는 J step 이 아예 없다 — 명시하지 않으면 아래 fallback 이
    // '대기'로 표시해 영원히 끝나지 않는 단계처럼 보인다(E·RA 와 같은 na 분기).
    if (skipJStage && agent === 'J') {
      return [{ status: 'na', label: t('approval.step_na') }];
    }
    // 영업/기술지원 합의자(SA)는 상신 시 PL 단계와 함께 만들어진다 — 그 회차에 단계가 없다는 것은
    // 아무도 지정하지 않았다는 뜻이므로 '대기'가 아니라 '해당없음'이다(E·RA 와 같은 na 분기).
    if (agent === 'SA') {
      const saSteps = allSteps.filter((s) => s.agent === 'SA' && (s.round ?? 1) === round);
      if (saSteps.length === 0) {
        return [{ status: 'na', label: t('approval.step_na') }];
      }
      return saSteps.map((s) => stepToInfo(s));
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
    // 영업/기술지원 합의자는 PL 검토와 병렬이라 PL 바로 다음 줄에 온다(지정했을 때만 단계가 있다).
    { key: 'SA', label: t('approval.agent_SA' as any) },
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
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', minWidth: 40 }}>{t('request.round_ordinal', { r })}</span>
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
              {(key === 'E' && !hasPlel) || (isOnlyMap && ['P', 'J', 'O', 'E'].includes(key)) || (isMapDeleteEdit && key === 'RA') || (skipJStage && key === 'J') || (isAdiCdChange && ['R', 'O', 'RA'].includes(key)) ? (
                <div style={historyItemStyle(false)}>
                  <span style={{ ...statusBadgeStyle('na') }}>{t('approval.step_na')}</span>
                </div>
              ) : (
                rounds.map((r) => {
                  const isCurrent = r === maxRound;
                  const infos = getStepDisplays(key, r);
                  return (
                    <div key={r} style={historyItemStyle(isCurrent)}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', minWidth: 40 }}>{t('request.round_ordinal', { r })}</span>
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
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{formatDateTimeShort(getApprovedAt())}</span>
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
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 4000,
            background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out', padding: 24,
          }}
        >
          <button
            type="button"
            onClick={() => setZoomedImage(null)}
            aria-label={t('common.close')}
            style={{
              position: 'absolute', top: 20, right: 24, width: 36, height: 36,
              borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff',
              cursor: 'pointer', fontSize: '18px',
            }}
          >
            ✕
          </button>
          <img
            src={zoomedImage}
            alt="zoomed"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: '4px', cursor: 'default' }}
          />
        </div>
      )}
    </div>
  );
}
