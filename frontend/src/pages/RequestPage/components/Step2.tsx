import React from 'react';
import { useTranslation } from 'react-i18next';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { JayerRow, FilterSet, GuideFeatureKey, ValidationSystemValue } from '../../../types';
import { ST_CELL_COLOR, VALIDATION_CELL_COLOR, VS_NA, NOC_LAYER_DELETE } from '../constants';
import { isValidationKeywordRow } from '../helpers';
import { ValidationSystemBadge, ValidationSystemToggle } from '../../../components/ValidationSystem';
import { CellSelectionApi } from '../../../hooks/useCellSelection';
import { numberBoundaryMatch } from '../../../utils/specMatch';

interface Step2Props {
  jayerRows: JayerRow[];
  setJayerRows: React.Dispatch<React.SetStateAction<JayerRow[]>>;
  jayerSortBySp: boolean;
  setJayerSortBySp: React.Dispatch<React.SetStateAction<boolean>>;
  jayerFilterSets: FilterSet[];
  jayerActiveFilterIds: Set<string>;
  setJayerActiveFilterIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setJayerFilterModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  jayerDragInfo: React.MutableRefObject<{ startId: string; mode: 'check' | 'uncheck' } | null>;
  jayerChecked: Set<string>;
  mappedJayerRowIds: Set<string>;
  jayerBarcodeCache: Record<string, { label: string; spec: string }[]>;
  errors: Partial<Record<string, string>>;
  calcDisabled: (
    row: { manuallyDisabled: boolean; sp: string; sd: string; pp: string },
    filterSets: FilterSet[],
    activeIds: Set<string>
  ) => boolean;
  handleJayerSetAll: (field: 'st' | 'new_or_copy', value: string) => void;
  handleJayerResetField: (field: 'st' | 'new_or_copy') => void;
  handleJayerCheckAll: () => void;
  handleJayerDragEnter: (id: string, renderedIds: string[]) => void;
  handleJayerDragStart: (id: string) => void;
  handleJayerCheckToggle: (id: string) => void;
  handleJayerChange: (id: string, field: keyof Omit<JayerRow, 'id'>, value: string) => void;
  handleJayerAddRow: () => void;
  handleJayerBulkDisable: () => void;
  handleJayerBulkRestore: () => void;
  cellSel: CellSelectionApi;
  GuideBadge: React.FC<{ fk: GuideFeatureKey; tk: string }>;
  validationSystem: ValidationSystemValue;
  /** 판정 키워드가 하나도 없어 대상/비대상을 고를 수 없는 문서인가('해당없음') */
  vsNotApplicable: boolean;
  onValidationSystemChange: (value: ValidationSystemValue) => void;
}

const ST_OPTIONS = ['O', 'O (D)', 'X'];
const NEW_OR_COPY_OPTIONS = ['신규', '차용', '기등록', 'layer삭제'];

const Step2: React.FC<Step2Props> = ({
  jayerRows,
  setJayerRows,
  jayerSortBySp,
  setJayerSortBySp,
  jayerFilterSets,
  jayerActiveFilterIds,
  setJayerActiveFilterIds,
  setJayerFilterModalOpen,
  jayerDragInfo,
  jayerChecked,
  mappedJayerRowIds,
  jayerBarcodeCache,
  errors,
  calcDisabled,
  handleJayerSetAll,
  handleJayerResetField,
  handleJayerCheckAll,
  handleJayerDragEnter,
  handleJayerDragStart,
  handleJayerCheckToggle,
  handleJayerChange,
  handleJayerAddRow,
  handleJayerBulkDisable,
  handleJayerBulkRestore,
  cellSel,
  GuideBadge,
  validationSystem,
  vsNotApplicable,
  onValidationSystemChange,
}) => {
  const { t } = useTranslation();
  const renderedJayerRows = [
    ...jayerRows.filter(r => !r.disabled).sort((a, b) => jayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
    ...jayerRows.filter(r => r.disabled).sort((a, b) => jayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
  ];
  const renderedJayerIds = renderedJayerRows.map(r => r.id);
  return (
    <div className="form-section">
      <div className="form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          🔷 {t('request.job_li')}
          <GuideBadge fk="step3_jayer_table" tk={t('guide.feat.step3_jayer_table' as never)} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-tour="validation-system">
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('request.validation_system')}
            </span>
            <ValidationSystemToggle
              value={validationSystem}
              notApplicable={vsNotApplicable}
              onChange={onValidationSystemChange}
            />
            {vsNotApplicable && <ValidationSystemBadge value={VS_NA} />}
          </span>
          <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>
            {t('request.active_total_count', { active: jayerRows.filter(r => !r.disabled).length, total: jayerRows.length })}
          </span>
        </span>
      </div>
      {/* 일괄 설정 툴바 */}
      <div className="wizard-table-toolbar">
        <div className="wizard-table-toolbar-group">
          <span className="wizard-table-toolbar-label">{t('request.col_st')}:</span>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('st', 'O')}>{t('request.btn_all_o')}</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('st', 'X')}>{t('request.btn_all_x')}</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerResetField('st')}>{t('request.btn_reset')}</button>
        </div>
        <div className="wizard-table-toolbar-group">
          <span className="wizard-table-toolbar-label">{t('request.col_new_or_copy')}:</span>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('new_or_copy', '신규')}>{t('request.btn_all_new')}</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('new_or_copy', '차용')}>{t('request.btn_all_copy')}</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerResetField('new_or_copy')}>{t('request.btn_reset')}</button>
          <button
            type="button"
            className="th-header-btn"
            onClick={() => setJayerSortBySp(v => !v)}
            style={jayerSortBySp ? { background: 'var(--accent)', color: 'white' } : undefined}
          >
            {t('request.btn_sort_by_step')}{jayerSortBySp ? ' ▲' : ''}
          </button>
        </div>
        <div className="wizard-table-toolbar-group" style={{ marginLeft: 'auto' }}>
          {jayerFilterSets.map(fs => (
            <button
              key={fs.id}
              type="button"
              className="th-header-btn"
              onClick={() => {
                const next = jayerActiveFilterIds.has(fs.id) ? new Set<string>() : new Set([fs.id]);
                setJayerActiveFilterIds(next);
                setJayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, jayerFilterSets, next) })));
              }}
              style={jayerActiveFilterIds.has(fs.id) ? { background: 'var(--accent)', color: 'white' } : undefined}
            >
              {fs.label}
            </button>
          ))}
          <button type="button" className="th-header-btn" data-tour="jayer-filter" onClick={() => setJayerFilterModalOpen(true)}>{t('request.btn_add_filter')}</button>
          <GuideBadge fk="step3_jayer_filter" tk={t('guide.feat.step3_jayer_filter' as never)} />
        </div>
      </div>
      <div className="wizard-table-wrapper" ref={cellSel.containerRef}>
        <table className="wizard-table" style={{ userSelect: cellSel.isDragging || jayerDragInfo.current ? 'none' : undefined }} onPaste={(e) => cellSel.onCellPaste(e, renderedJayerIds)}>
          <colgroup>
            <col style={{ width: 44 }} />
            <col />
            <col />
            <col />
            <col />
            <col className="sd-column" />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 44, textAlign: 'center' }}>No</th>
              <th style={{ width: 32, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={jayerRows.filter(r => !r.disabled).length > 0 && jayerRows.filter(r => !r.disabled).every(r => jayerChecked.has(r.id))}
                  ref={(el) => { if (el) { const active = jayerRows.filter(r => !r.disabled); el.indeterminate = active.some(r => jayerChecked.has(r.id)) && !active.every(r => jayerChecked.has(r.id)); } }}
                  onChange={handleJayerCheckAll}
                />
              </th>
              <th style={{ width: 'auto' }}>{t('request.col_updated_date')}</th>
              <th style={{ width: 'auto' }}>{t('request.process_id')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_sp')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_sd')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_layer')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_pp')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_st')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_new_or_copy')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_product_name')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_step')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_item_id')}</th>
            </tr>
          </thead>
          <tbody>
            {renderedJayerRows.map((row, idx) => {
              const isFirstDisabled = row.disabled && (idx === 0 || !renderedJayerRows[idx - 1].disabled);
              const isRegistered = row.new_or_copy === '기등록';
              // layer삭제 행의 st 는 항상 'X' 로 고정 — 값 편집을 막는다.
              const isLayerDeleted = row.new_or_copy === NOC_LAYER_DELETE;
              const stError = errors[`jayer_stnoc_${row.id}_st`];
              const nocError = errors[`jayer_stnoc_${row.id}_new_or_copy`];
              const regBg = '#e5e7eb';
              // 편집 셀 공통 props: 셀 선택(드래그/Ctrl) + 선택 하이라이트
              const cellProps = (col: string, bg?: string, extra?: React.CSSProperties) => ({
                onMouseDown: (e: React.MouseEvent) => cellSel.onCellMouseDown(row.id, col, e),
                onMouseEnter: () => cellSel.onCellMouseEnter(row.id, col, renderedJayerIds),
                style: {
                  backgroundColor: bg,
                  ...extra,
                  ...(cellSel.isCellSelected(row.id, col) ? { boxShadow: 'inset 0 0 0 9999px rgba(37, 99, 235, 0.12)' } : {}),
                } as React.CSSProperties,
              });
              return (
                <React.Fragment key={row.id}>
                  {isFirstDisabled && (
                    <tr className="row-divider"><td colSpan={13} /></tr>
                  )}
                  <tr
                    className={[row.disabled ? 'row-disabled' : '', jayerChecked.has(row.id) ? 'row-checked' : '', mappedJayerRowIds.has(row.id) ? 'row-mapped' : ''].filter(Boolean).join(' ')}
                    onMouseEnter={() => handleJayerDragEnter(row.id, renderedJayerIds)}
                  >
                    <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{idx + 1}</td>
                    <td style={{ textAlign: 'center' }} onMouseDown={() => handleJayerDragStart(row.id)}>
                      <input type="checkbox" checked={jayerChecked.has(row.id)} onChange={() => handleJayerCheckToggle(row.id)} />
                    </td>
                    <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.updated ?? ''} readOnly style={{ background: isRegistered ? regBg : undefined, color: '#666' }} /></td>
                    <td {...cellProps('process_id', isRegistered ? regBg : undefined)}><input value={row.process_id} readOnly={row.disabled || isRegistered || row.loaded} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'process_id', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td {...cellProps('sp', isRegistered ? regBg : undefined)}><input value={row.sp} readOnly={row.disabled || isRegistered || row.loaded} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'sp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td {...cellProps('sd', isRegistered ? regBg : undefined)}><input value={row.sd} readOnly={row.disabled || isRegistered || row.loaded} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'sd', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td {...cellProps('layerid', isRegistered ? regBg : undefined)}><input value={row.layerid ?? ''} readOnly={row.disabled || isRegistered || row.loaded} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'layerid', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                    <td {...cellProps('pp', isRegistered ? regBg : undefined)}><input value={row.pp} readOnly={row.disabled || isRegistered || row.loaded} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'pp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : isValidationKeywordRow(row.pp) ? VALIDATION_CELL_COLOR : undefined }} /></td>
                    <td {...cellProps('st', isRegistered ? regBg : undefined)} className={stError ? 'field-error-target' : undefined}>
                      <AutocompleteInput
                        value={row.st}
                        onChange={(v) => handleJayerChange(row.id, 'st', v)}
                        options={ST_OPTIONS}
                        disabled={row.disabled || isRegistered || isLayerDeleted}
                        inputStyle={{
                          backgroundColor: isRegistered ? regBg : ST_CELL_COLOR[row.st],
                          ...(stError ? { border: '1px solid var(--danger)' } : {}),
                        }}
                        dropdownFontSize="0.7rem"
                        dropdownDirection="up"
                      />
                    </td>
                    <td {...cellProps('new_or_copy')} className={nocError ? 'field-error-target' : undefined}>
                      <AutocompleteInput
                        value={row.new_or_copy}
                        onChange={(v) => handleJayerChange(row.id, 'new_or_copy', v)}
                        options={NEW_OR_COPY_OPTIONS}
                        disabled={row.disabled}
                        inputStyle={{
                          backgroundColor: row.new_or_copy === '차용' ? '#93c5fd' : row.new_or_copy === 'layer삭제' ? '#fef08a' : undefined,
                          ...(nocError ? { border: '1px solid var(--danger)' } : {}),
                        }}
                        dropdownFontSize="0.7rem"
                        dropdownDirection="up"
                      />
                    </td>
                    <td data-jtour={`product_name-${idx}`} {...cellProps('product_name', isRegistered ? regBg : undefined)}><input value={row.product_name} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'product_name', e.target.value)} className={errors[`jayer_noc_${row.id}_product_name`] ? 'field-error-target' : undefined} style={{ backgroundColor: isRegistered ? regBg : undefined, ...(errors[`jayer_noc_${row.id}_product_name`] ? { border: '1px solid var(--danger)' } : {}) }} /></td>
                    <td data-jtour={`step-${idx}`} {...cellProps('step', isRegistered ? regBg : undefined)}><input value={row.step} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleJayerChange(row.id, 'step', e.target.value)} className={errors[`jayer_noc_${row.id}_step`] ? 'field-error-target' : undefined} style={{ backgroundColor: isRegistered ? regBg : undefined, ...(errors[`jayer_noc_${row.id}_step`] ? { border: '1px solid var(--danger)' } : {}) }} /></td>
                    <td data-jtour={`item_id-${idx}`} {...cellProps('item_id', isRegistered ? regBg : undefined, { minWidth: 160 })}>
                      <AutocompleteInput
                        value={row.item_id}
                        onChange={(v) => handleJayerChange(row.id, 'item_id', v)}
                        options={(jayerBarcodeCache[row.id] ?? [])
                          .filter((o) => !row.step || numberBoundaryMatch(o.spec, row.step))
                          .map((o) => o.label)}
                        disabled={row.disabled || isRegistered}
                        style={{ backgroundColor: isRegistered ? regBg : undefined }}
                        dropdownDirection="up"
                        dropdownFontSize="0.7rem"
                      />
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bulk-action-row">
        <button type="button" className="flow-table-add-btn" onClick={handleJayerAddRow}>{t('request.bb_add_row_btn')}</button>
        {jayerRows.filter(r => !r.disabled && jayerChecked.has(r.id)).length > 0 && (
          <button type="button" className="btn btn-danger btn-sm" onClick={handleJayerBulkDisable}>
            {t('request.btn_disable_selected', { count: jayerRows.filter(r => !r.disabled && jayerChecked.has(r.id)).length })}
          </button>
        )}
        {jayerRows.filter(r => r.disabled && jayerChecked.has(r.id)).length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleJayerBulkRestore}>
            {t('request.btn_restore_count', { count: jayerRows.filter(r => r.disabled && jayerChecked.has(r.id)).length })}
          </button>
        )}
      </div>
    </div>
  );
};

export default Step2;
