import React from 'react';
import { useTranslation } from 'react-i18next';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { JayerRow, FilterSet, GuideFeatureKey, ValidationSystemValue } from '../../../types';
import { ST_CELL_COLOR, VALIDATION_CELL_COLOR, VS_NA, NOC_LAYER_DELETE, isRowInactive } from '../constants';
import { isValidationKeywordRow } from '../helpers';
import { ValidationSystemBadge, ValidationSystemToggle } from '../../../components/ValidationSystem';
import { CellSelectionApi } from '../../../hooks/useCellSelection';
import { numberBoundaryMatch } from '../../../utils/specMatch';

interface Step2Props {
  jayerRows: JayerRow[];
  jayerSortBySp: boolean;
  setJayerSortBySp: React.Dispatch<React.SetStateAction<boolean>>;
  jayerFilterSets: FilterSet[];
  setJayerFilterModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  mappedJayerRowIds: Set<string>;
  jayerBarcodeCache: Record<string, { label: string; spec: string }[]>;
  errors: Partial<Record<string, string>>;
  handleJayerSetAll: (field: 'st' | 'new_or_copy', value: string) => void;
  handleJayerResetField: (field: 'st' | 'new_or_copy') => void;
  handleJayerApplyFilter: (filterId: string) => void;
  handleJayerChange: (id: string, field: keyof Omit<JayerRow, 'id'>, value: string) => void;
  handleJayerAddRow: () => void;
  cellSel: CellSelectionApi;
  /** 이 스텝 전체를 훑는 하이라이트 가이드 투어 배지 (섹션 제목 옆) */
  GuideTourBadge: React.ReactNode;
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
  jayerSortBySp,
  setJayerSortBySp,
  jayerFilterSets,
  setJayerFilterModalOpen,
  mappedJayerRowIds,
  jayerBarcodeCache,
  errors,
  handleJayerSetAll,
  handleJayerResetField,
  handleJayerApplyFilter,
  handleJayerChange,
  handleJayerAddRow,
  cellSel,
  GuideTourBadge,
  GuideBadge,
  validationSystem,
  vsNotApplicable,
  onValidationSystemChange,
}) => {
  const { t } = useTranslation();
  const renderedJayerRows = [...jayerRows].sort((a, b) => jayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder);
  const renderedJayerIds = renderedJayerRows.map(r => r.id);
  return (
    <div className="form-section">
      <div className="form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          🔷 {t('request.job_li')}
          {GuideTourBadge}
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
            {t('request.active_total_count', { active: jayerRows.filter(r => !isRowInactive(r.st)).length, total: jayerRows.length })}
          </span>
        </span>
      </div>
      {/* 일괄 설정 툴바 */}
      <div className="wizard-table-toolbar">
        <div className="wizard-table-toolbar-group">
          <span className="wizard-table-toolbar-label">{t('request.col_st_j')}:</span>
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
              title={t('request.filter_apply_hint' as never) as string}
              onClick={() => handleJayerApplyFilter(fs.id)}
            >
              {fs.label}
            </button>
          ))}
          <button type="button" className="th-header-btn" data-tour="jayer-filter" onClick={() => setJayerFilterModalOpen(true)}>{t('request.btn_add_filter')}</button>
          <GuideBadge fk="step3_jayer_filter" tk={t('guide.feat.step3_jayer_filter' as never)} />
        </div>
      </div>
      <div className="wizard-table-wrapper" data-tour="jayer-table" ref={cellSel.containerRef}>
        <table className="wizard-table" style={{ userSelect: cellSel.isDragging ? 'none' : undefined }} onPaste={(e) => cellSel.onCellPaste(e, renderedJayerIds)}>
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
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 44, textAlign: 'center' }}>No</th>
              <th style={{ width: 'auto' }}>{t('request.col_updated_date')}</th>
              <th style={{ width: 'auto' }}>{t('request.process_id')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_sp')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_sd')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_layer')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_pp')}</th>
              <th style={{ width: 'auto' }} data-tour="jayer-sync-cols">{t('request.col_st_j')}</th>
              <th style={{ width: 'auto' }} data-tour="jayer-sync-cols">{t('request.col_new_or_copy')}</th>
              <th style={{ width: 'auto' }} data-tour="jayer-sync-cols">{t('request.col_product_name')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_step')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_item_id')}</th>
            </tr>
          </thead>
          <tbody>
            {renderedJayerRows.map((row, idx) => {
              const rowInactive = isRowInactive(row.st);
              const isRegistered = row.new_or_copy === '기등록';
              // layer삭제 행의 st 는 항상 'X' 로 고정 — 값 편집을 막는다.
              const isLayerDeleted = row.new_or_copy === NOC_LAYER_DELETE;
              const stError = errors[`jayer_stnoc_${row.id}_st`];
              const nocError = errors[`jayer_stnoc_${row.id}_new_or_copy`];
              const itemIdError = errors[`jayer_noc_${row.id}_item_id`];
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
                <tr
                  key={row.id}
                  className={mappedJayerRowIds.has(row.id) ? 'row-mapped' : ''}
                >
                  <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{idx + 1}</td>
                  <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.updated ?? ''} readOnly style={{ background: isRegistered ? regBg : undefined, color: '#666' }} /></td>
                  <td {...cellProps('process_id', isRegistered ? regBg : undefined)}><input value={row.process_id} readOnly={rowInactive || isRegistered || row.loaded} disabled={rowInactive || isRegistered} onChange={(e) => handleJayerChange(row.id, 'process_id', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                  <td {...cellProps('sp', isRegistered ? regBg : undefined)}><input value={row.sp} readOnly={rowInactive || isRegistered || row.loaded} disabled={rowInactive || isRegistered} onChange={(e) => handleJayerChange(row.id, 'sp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                  <td {...cellProps('sd', isRegistered ? regBg : undefined)}><input value={row.sd} readOnly={rowInactive || isRegistered || row.loaded} disabled={rowInactive || isRegistered} onChange={(e) => handleJayerChange(row.id, 'sd', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                  <td {...cellProps('layerid', isRegistered ? regBg : undefined)}><input value={row.layerid ?? ''} readOnly={rowInactive || isRegistered || row.loaded} disabled={rowInactive || isRegistered} onChange={(e) => handleJayerChange(row.id, 'layerid', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                  <td {...cellProps('pp', isRegistered ? regBg : undefined)}><input value={row.pp} readOnly={rowInactive || isRegistered || row.loaded} disabled={rowInactive || isRegistered} onChange={(e) => handleJayerChange(row.id, 'pp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : isValidationKeywordRow(row.pp) ? VALIDATION_CELL_COLOR : undefined }} /></td>
                  <td {...cellProps('st', isRegistered ? regBg : undefined)} data-tour="jayer-sync-cols" className={stError ? 'field-error-target' : undefined}>
                    <AutocompleteInput
                      value={row.st}
                      onChange={(v) => handleJayerChange(row.id, 'st', v)}
                      options={ST_OPTIONS}
                      disabled={isRegistered || isLayerDeleted}
                      inputStyle={{
                        backgroundColor: isRegistered ? regBg : ST_CELL_COLOR[row.st],
                        ...(stError ? { border: '1px solid var(--danger)' } : {}),
                      }}
                      dropdownFontSize="0.7rem"
                      dropdownDirection="up"
                    />
                  </td>
                  <td {...cellProps('new_or_copy')} data-tour="jayer-sync-cols" className={nocError ? 'field-error-target' : undefined}>
                    <AutocompleteInput
                      value={row.new_or_copy}
                      onChange={(v) => handleJayerChange(row.id, 'new_or_copy', v)}
                      options={NEW_OR_COPY_OPTIONS}
                      disabled={rowInactive && !isRegistered && !isLayerDeleted}
                      inputStyle={{
                        backgroundColor: row.new_or_copy === '차용' ? '#93c5fd' : row.new_or_copy === 'layer삭제' ? '#fef08a' : undefined,
                        ...(nocError ? { border: '1px solid var(--danger)' } : {}),
                      }}
                      dropdownFontSize="0.7rem"
                      dropdownDirection="up"
                    />
                  </td>
                  <td data-jtour={`product_name-${idx}`} data-tour="jayer-sync-cols" {...cellProps('product_name', isRegistered ? regBg : undefined)}><input value={row.product_name} readOnly={rowInactive || isRegistered} disabled={rowInactive || isRegistered} onChange={(e) => handleJayerChange(row.id, 'product_name', e.target.value)} className={errors[`jayer_noc_${row.id}_product_name`] ? 'field-error-target' : undefined} style={{ backgroundColor: isRegistered ? regBg : undefined, ...(errors[`jayer_noc_${row.id}_product_name`] ? { border: '1px solid var(--danger)' } : {}) }} /></td>
                  <td data-jtour={`step-${idx}`} {...cellProps('step', isRegistered ? regBg : undefined)}><input value={row.step} readOnly={rowInactive || isRegistered} disabled={rowInactive || isRegistered} onChange={(e) => handleJayerChange(row.id, 'step', e.target.value)} className={errors[`jayer_noc_${row.id}_step`] ? 'field-error-target' : undefined} style={{ backgroundColor: isRegistered ? regBg : undefined, ...(errors[`jayer_noc_${row.id}_step`] ? { border: '1px solid var(--danger)' } : {}) }} /></td>
                  <td data-jtour={`item_id-${idx}`} className={itemIdError ? 'field-error-target' : undefined} {...cellProps('item_id', isRegistered ? regBg : undefined, { minWidth: 160 })}>
                    <AutocompleteInput
                      value={row.item_id}
                      onChange={(v) => handleJayerChange(row.id, 'item_id', v)}
                      options={(jayerBarcodeCache[row.id] ?? [])
                        .filter((o) => !row.step || numberBoundaryMatch(o.spec, row.step))
                        .map((o) => o.label)}
                      disabled={rowInactive || isRegistered}
                      style={{ backgroundColor: isRegistered ? regBg : undefined }}
                      inputStyle={itemIdError ? { border: '1px solid var(--danger)' } : undefined}
                      dropdownDirection="up"
                      dropdownFontSize="0.7rem"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bulk-action-row" data-tour="jayer-bulk-actions">
        <button type="button" className="flow-table-add-btn" onClick={handleJayerAddRow}>{t('request.bb_add_row_btn')}</button>
      </div>
    </div>
  );
};

export default Step2;
