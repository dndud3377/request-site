import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailFormState, MergePair, MergeRowInfo, MergeTable, MergeUnmatchedRow } from '../../../types';
import { MERGE_UNREGISTERED_ID, MERGE_MANUAL_FIELDS } from '../constants';
import { deriveMergeKind, isMergeSideEmpty, isPairAfterInactive, PairAfterLookupRow } from '../helpers';

/**
 * 참조 요청서 Merge 의 변경전/변경후 비교 패널.
 *
 * 표 2개로 구성한다.
 *  ① BEFORE / AFTER — 자동으로 짝지을 수 없어 사용자가 직접 매핑할 항목. 참조 요청서가 있을 때만 그린다.
 *     BEFORE 행은 여러 번 선택할 수 있고(1:N), AFTER 행은 적용하면 목록에서 사라진다.
 *  ② 변경전 / 변경후 — 확정된 짝. **모든 행을 직접 편집**할 수 있다(엑셀 붙여넣기 포함).
 *     ✕ 로 해제하면 양쪽 행이 각자의 표로 되돌아가고, ↺ 는 그 행을 양쪽 미등록으로 되돌린다.
 *
 * 값 계산은 하지 않는다(부모가 넘긴 detail 을 그리기만 한다). 편집 결과의 판정·정규화도 부모가 소유한다.
 */

export type BaSide = 'before' | 'after';
export type BaField = typeof MERGE_MANUAL_FIELDS[number];

export interface BeforeAfterPanelProps {
  detail: DetailFormState;
  /** AFTER 가 실제 J/O-layer 행과 연결돼 있을 때, 그 행이 지금 비활성/기등록인지 판정하는 데 쓴다 */
  jayerRows: PairAfterLookupRow[];
  oayerRows: PairAfterLookupRow[];
  /** 5개 항목이 모두 같아 표에서 제외한 건수 — 요약 표시용 */
  sameCount: number;
  /** 참조 요청서 없이 '없음' 으로 확정한 경우 — BEFORE/AFTER 매핑 표를 감춘다 */
  manualOnly: boolean;
  selBefore: string | null;
  selAfter: string | null;
  onSelect: (side: BaSide, id: string) => void;
  onApply: () => void;
  onUnpair: (index: number) => void;
  onCellChange: (pairId: string, side: BaSide, field: BaField, value: string) => void;
  onCellBlur: (pairId: string, side: BaSide) => void;
  onPasteRaw: (pairId: string, side: BaSide, raw: string) => void;
  onTableChange: (pairId: string, table: MergeTable) => void;
  onAddRow: () => void;
  onResetRow: (pairId: string) => void;
}

const FIELDS: (keyof MergeRowInfo)[] = ['process_id', 'sp', 'sd', 'pp', 'layerid'];

const BeforeAfterPanel: React.FC<BeforeAfterPanelProps> = ({
  detail,
  jayerRows,
  oayerRows,
  sameCount,
  manualOnly,
  selBefore,
  selAfter,
  onSelect,
  onApply,
  onUnpair,
  onCellChange,
  onCellBlur,
  onPasteRaw,
  onTableChange,
  onAddRow,
  onResetRow,
}) => {
  const { t } = useTranslation();
  const pairs = detail.merge_pairs ?? [];
  const unmatchedBefore = detail.merge_unmatched_before ?? [];
  const unmatchedAfter = detail.merge_unmatched_after ?? [];

  // 미등록 셀을 클릭해 입력 칸으로 연 상태 — 화면 전용이라 문서에 저장하지 않는다.
  // 값을 비운 채 포커스를 벗어나면 부모가 null 로 접고 여기서도 닫는다.
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const editKey = (pairId: string, side: BaSide) => `${pairId}_${side}`;
  const openEdit = (pairId: string, side: BaSide) => {
    setEditing((prev) => new Set(prev).add(editKey(pairId, side)));
  };
  const closeEdit = (pairId: string, side: BaSide) => {
    setEditing((prev) => {
      const next = new Set(prev);
      next.delete(editKey(pairId, side));
      return next;
    });
  };

  const findBefore = (id: string | null) =>
    id && id !== MERGE_UNREGISTERED_ID ? unmatchedBefore.find((r) => r.id === id) : undefined;
  const findAfter = (id: string | null) =>
    id && id !== MERGE_UNREGISTERED_ID ? unmatchedAfter.find((r) => r.id === id) : undefined;

  // 적용 가능 여부 — 양쪽 선택 필수, 양쪽 미등록 불가, J/O 교차 불가
  const selectedBeforeRow = findBefore(selBefore);
  const selectedAfterRow = findAfter(selAfter);
  const bothPicked = selBefore !== null && selAfter !== null;
  const bothUnregistered = selBefore === MERGE_UNREGISTERED_ID && selAfter === MERGE_UNREGISTERED_ID;
  const crossTable = !!selectedBeforeRow && !!selectedAfterRow && selectedBeforeRow.table !== selectedAfterRow.table;
  const canApply = bothPicked && !bothUnregistered && !crossTable;

  const hintText = (): string => {
    if (!bothPicked) return t('request.ba_hint_select');
    if (bothUnregistered) return t('request.ba_hint_both_unreg');
    if (crossTable) return t('request.ba_hint_same_table');
    return t('request.ba_hint_ready');
  };
  const hintIsError = bothPicked && (bothUnregistered || crossTable);

  const tableBadge = (table: MergeTable) => (
    <span className={`ba-badge ba-badge-${table === 'J' ? 'j' : 'o'}`}>
      {t(table === 'J' ? 'request.jayer' : 'request.oayer')}
    </span>
  );

  const kindBadge = (pair: MergePair) => {
    const kind = deriveMergeKind(pair.before, pair.after);
    return <span className={`ba-badge ba-badge-${kind}`}>{t(`request.ba_kind_${kind}`)}</span>;
  };

  /** AFTER 가 실제 J/O-layer 행과 연결돼 있고 그 행이 지금 비활성/기등록이면 배지를 덧붙인다. */
  const afterInactiveBadge = (pair: MergePair) =>
    isPairAfterInactive(pair.afterId, jayerRows, oayerRows) && (
      <span className="ba-badge ba-badge-inactive">{t('request.ba_after_inactive')}</span>
    );

  /** 미매칭 목록 한쪽(BEFORE/AFTER)을 그린다. 첫 행은 항상 '미등록'. */
  const renderPickList = (side: BaSide, rows: MergeUnmatchedRow[], selected: string | null) => (
    <table className="ba-table">
      <thead>
        <tr>
          <th>{t('request.ba_table_division')}</th>
          <th>{t('request.process_id')}</th>
          <th>{t('request.col_sp')}</th>
          <th>{t('request.col_sd')}</th>
          <th>{t('request.col_pp')}</th>
          <th>{t('request.col_layer')}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          className={`ba-pick ba-pick-unreg${selected === MERGE_UNREGISTERED_ID ? ' ba-pick-selected' : ''}`}
          onClick={() => onSelect(side, MERGE_UNREGISTERED_ID)}
        >
          <td colSpan={6}>
            {t(side === 'before' ? 'request.ba_before_unreg_hint' : 'request.ba_after_unreg_hint')}
          </td>
        </tr>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={`ba-pick${selected === row.id ? ' ba-pick-selected' : ''}`}
            onClick={() => onSelect(side, row.id)}
          >
            <td>{tableBadge(row.table)}</td>
            {FIELDS.map((f) => <td key={f}>{row[f] || '—'}</td>)}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={6} className="ba-hint">{t('request.ba_empty')}</td></tr>
        )}
      </tbody>
    </table>
  );

  /**
   * 확정 표의 한쪽 5칸.
   * 미등록(값이 하나도 없음)이고 아직 편집을 열지 않았으면 5칸을 합쳐 '미등록' 한 줄로 표시하고,
   * 클릭하면 입력 칸으로 바뀐다. layerid 는 수기 입력 대상이 아니라 항상 읽기 전용이다.
   */
  const renderPairCells = (pair: MergePair, side: BaSide) => {
    const info = pair[side];
    const other = pair[side === 'before' ? 'after' : 'before'];
    const empty = isMergeSideEmpty(info);
    if (empty && !editing.has(editKey(pair.id, side))) {
      return (
        <td
          colSpan={5}
          className="ba-cell-unreg ba-cell-unreg-click"
          title={t('request.ba_cell_edit_hint')}
          onClick={() => openEdit(pair.id, side)}
        >
          {t('request.ba_unregistered')}
        </td>
      );
    }
    // 양쪽에 값이 있을 때만 컬럼끼리 비교해 다른 값을 강조한다(한쪽이 미등록이면 비교 대상이 없다).
    const compare = !empty && !isMergeSideEmpty(other);
    return (
      <>
        {MERGE_MANUAL_FIELDS.map((f) => {
          const value = info?.[f] ?? '';
          const missing = !empty && value.trim() === '';
          const changed = compare && value.trim() !== (other?.[f] ?? '').trim();
          return (
            <td key={f}>
              <input
                className={`ba-cell-input${missing ? ' ba-cell-input-error' : ''}${changed ? ' ba-cell-changed' : ''}`}
                value={value}
                autoFocus={empty && f === 'process_id'}
                aria-label={t(f === 'process_id' ? 'request.process_id' : `request.col_${f}`)}
                onChange={(e) => onCellChange(pair.id, side, f, e.target.value)}
                onBlur={() => {
                  onCellBlur(pair.id, side);
                  closeEdit(pair.id, side);
                }}
                onPaste={(e) => {
                  const raw = e.clipboardData.getData('text/plain');
                  if (!raw) return;
                  e.preventDefault();
                  onPasteRaw(pair.id, side, raw);
                }}
              />
            </td>
          );
        })}
        <td className="ba-cell-readonly">{info?.layerid || '—'}</td>
      </>
    );
  };

  return (
    <div className="ba-panel">
      <div className="ba-summary">
        {t('request.ba_summary', { same: sameCount, done: pairs.length, pending: unmatchedAfter.length })}
      </div>

      {!manualOnly && (
        <div className={`ba-gate ${unmatchedAfter.length === 0 ? 'ba-gate-ok' : 'ba-gate-ng'}`}>
          {unmatchedAfter.length === 0
            ? t('request.ba_gate_ok')
            : t('request.ba_gate_ng', { count: unmatchedAfter.length })}
        </div>
      )}

      {/* ① BEFORE / AFTER — 직접 매핑. 참조 요청서가 있을 때만 의미가 있다. */}
      {!manualOnly && (
        <>
          <div className="ba-section-title">{t('request.ba_manual_title')}</div>
          <div className="ba-split">
            <div className="ba-pane">
              <div className="ba-pane-title">
                <span>{t('request.ba_before')}</span>
                <span className="ba-pane-count">{t('request.ba_before_count', { count: unmatchedBefore.length })}</span>
              </div>
              <div className="ba-pane-scroll">{renderPickList('before', unmatchedBefore, selBefore)}</div>
            </div>
            <div className="ba-pane">
              <div className="ba-pane-title">
                <span>{t('request.ba_after')}</span>
                <span className="ba-pane-count">{t('request.ba_after_count', { count: unmatchedAfter.length })}</span>
              </div>
              <div className="ba-pane-scroll">{renderPickList('after', unmatchedAfter, selAfter)}</div>
            </div>
          </div>

          <div className="ba-apply-bar">
            <span className={`ba-apply-hint${hintIsError ? ' ba-apply-hint-error' : ''}`}>{hintText()}</span>
            <button type="button" className="btn btn-primary" onClick={onApply} disabled={!canApply}>
              ✔ {t('request.ba_apply')}
            </button>
          </div>
          <div className="ba-note">{t('request.ba_hint_reuse')}</div>
        </>
      )}

      {/* ② 변경전 / 변경후 — 확정된 짝. 모든 셀을 직접 편집할 수 있다. */}
      <div className="ba-section-title">{t('request.ba_result_title')}</div>
      <div className="ba-pane">
        <div className="ba-result-scroll">
          <table className="ba-table ba-result-table">
            <thead>
              <tr>
                <th rowSpan={2}>{t('request.ba_table_division')}</th>
                <th colSpan={5} className="ba-group-before">{t('request.ba_before_col')}</th>
                <th colSpan={5} className="ba-group-after">{t('request.ba_after_col')}</th>
                <th rowSpan={2}>{t('request.ba_kind')}</th>
                <th rowSpan={2} aria-label={t('request.ba_unpair')} />
              </tr>
              <tr>
                <th className="ba-group-before">{t('request.process_id')}</th>
                <th className="ba-group-before">{t('request.col_sp')}</th>
                <th className="ba-group-before">{t('request.col_sd')}</th>
                <th className="ba-group-before">{t('request.col_pp')}</th>
                <th className="ba-group-before">{t('request.col_layer')}</th>
                <th className="ba-group-after">{t('request.process_id')}</th>
                <th className="ba-group-after">{t('request.col_sp')}</th>
                <th className="ba-group-after">{t('request.col_sd')}</th>
                <th className="ba-group-after">{t('request.col_pp')}</th>
                <th className="ba-group-after">{t('request.col_layer')}</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair, idx) => (
                <tr key={pair.id}>
                  <td>
                    <select
                      className="ba-table-select"
                      value={pair.table}
                      aria-label={t('request.ba_table_division')}
                      onChange={(e) => onTableChange(pair.id, e.target.value as MergeTable)}
                    >
                      <option value="J">{t('request.jayer')}</option>
                      <option value="O">{t('request.oayer')}</option>
                    </select>
                  </td>
                  {renderPairCells(pair, 'before')}
                  {renderPairCells(pair, 'after')}
                  <td>{kindBadge(pair)} {afterInactiveBadge(pair)}</td>
                  <td className="ba-row-actions">
                    <button
                      type="button"
                      className="ba-reset-btn"
                      title={t('request.ba_reset_row')}
                      onClick={() => {
                        closeEdit(pair.id, 'before');
                        closeEdit(pair.id, 'after');
                        onResetRow(pair.id);
                      }}
                    >
                      ↺
                    </button>
                    <button
                      type="button"
                      className="ba-unpair-btn"
                      title={t('request.ba_unpair')}
                      onClick={() => onUnpair(idx)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {pairs.length === 0 && (
                <tr><td colSpan={13} className="ba-hint">{t('request.ba_result_empty')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ba-apply-bar">
        <span className="ba-apply-hint">{t('request.ba_paste_hint')}</span>
        <button type="button" className="btn btn-secondary" onClick={onAddRow}>
          + {t('request.ba_add_row')}
        </button>
      </div>
    </div>
  );
};

export default BeforeAfterPanel;
