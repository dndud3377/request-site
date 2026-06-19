import React from 'react';
import { useTranslation } from 'react-i18next';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { OayerRow, FilterSet, DetailFormState, GuideFeatureKey } from '../../../types';
import { ST_CELL_COLOR } from '../constants';
import { CellSelectionApi } from '../../../hooks/useCellSelection';

const ST_OPTIONS = ['O', 'O (D)', 'O (혼용)', 'X'];
const NEW_OR_COPY_OPTIONS = ['신규', '차용', '기등록', 'layer삭제'];

interface Step3Props {
  oayerRows: OayerRow[];
  setOayerRows: React.Dispatch<React.SetStateAction<OayerRow[]>>;
  oayerSortBySp: boolean;
  setOayerSortBySp: React.Dispatch<React.SetStateAction<boolean>>;
  oayerFilterSets: FilterSet[];
  oayerActiveFilterIds: Set<string>;
  setOayerActiveFilterIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setOayerFilterModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  oayerDragInfo: React.MutableRefObject<{ startId: string; mode: 'check' | 'uncheck' } | null>;
  oayerChecked: Set<string>;
  oayerInfoTab: 'table' | 'info';
  setOayerInfoTab: React.Dispatch<React.SetStateAction<'table' | 'info'>>;
  detail: DetailFormState;
  setDetail: React.Dispatch<React.SetStateAction<DetailFormState>>;
  errors: Partial<Record<string, string>>;
  setErrors: React.Dispatch<React.SetStateAction<Partial<Record<string, string>>>>;
  tbvtlvSdsSelected: string[];
  setTbvtlvSdsSelected: React.Dispatch<React.SetStateAction<string[]>>;
  tbvtlvNote: string;
  setTbvtlvNote: React.Dispatch<React.SetStateAction<string>>;
  calcDisabled: (
    row: { manuallyDisabled: boolean; sp: string; sd: string; pp: string },
    filterSets: FilterSet[],
    activeIds: Set<string>
  ) => boolean;
  handleOayerSetAll: (field: 'st' | 'new_or_copy', value: string) => void;
  handleOayerResetField: (field: 'st' | 'new_or_copy') => void;
  handleOayerCheckAll: () => void;
  handleOayerDragEnter: (id: string, renderedIds: string[]) => void;
  handleOayerDragStart: (id: string) => void;
  handleOayerCheckToggle: (id: string) => void;
  handleOayerChange: (id: string, field: keyof Omit<OayerRow, 'id'>, value: string) => void;
  handleOayerAddRow: () => void;
  handleOayerBulkDisable: () => void;
  handleOayerBulkRestore: () => void;
  cellSel: CellSelectionApi;
  GuideBadge: React.FC<{ fk: GuideFeatureKey; tk: string }>;
}

const Step3: React.FC<Step3Props> = ({
  oayerRows,
  setOayerRows,
  oayerSortBySp,
  setOayerSortBySp,
  oayerFilterSets,
  oayerActiveFilterIds,
  setOayerActiveFilterIds,
  setOayerFilterModalOpen,
  oayerDragInfo,
  oayerChecked,
  oayerInfoTab,
  setOayerInfoTab,
  detail,
  setDetail,
  errors,
  setErrors,
  tbvtlvSdsSelected,
  setTbvtlvSdsSelected,
  tbvtlvNote,
  setTbvtlvNote,
  calcDisabled,
  handleOayerSetAll,
  handleOayerResetField,
  handleOayerCheckAll,
  handleOayerDragEnter,
  handleOayerDragStart,
  handleOayerCheckToggle,
  handleOayerChange,
  handleOayerAddRow,
  handleOayerBulkDisable,
  handleOayerBulkRestore,
  cellSel,
  GuideBadge,
}) => {
  const { t } = useTranslation();
  const renderedOayerRows = [
    ...oayerRows.filter(r => !r.disabled).sort((a, b) => oayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
    ...oayerRows.filter(r => r.disabled).sort((a, b) => oayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
  ];
  const renderedOayerIds = renderedOayerRows.map(r => r.id);
  const tbvtlvSdOptions = Array.from(
    new Set(
      oayerRows
        .filter(r => !r.disabled && (r.sd.toUpperCase().includes('TBV') || r.sd.toUpperCase().includes('TLV')))
        .map(r => r.sd)
    )
  );
  const hasTbvtlv = tbvtlvSdOptions.length > 0;
  const usedTbvtlvSds = new Set((detail.tbvtlv_entries ?? []).flatMap(e => e.sds));
  const availableTbvtlvSds = tbvtlvSdOptions.filter(sd => !usedTbvtlvSds.has(sd));
  const infoHasData = detail.partial_shot !== '' || (detail.tbvtlv_entries ?? []).length > 0 || detail.tbvtlv_thickness !== '';

  return (
    <div className="form-section">
      <div className="form-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          🔶 {t('request.ovl_li')}
          <GuideBadge fk="step4_oayer_table" tk={t('guide.feat.step4_oayer_table' as never)} />
        </span>
        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>
          활성 {oayerRows.filter(r => !r.disabled).length} / 전체 {oayerRows.length}
        </span>
      </div>

      {/* 탭 버튼 */}
      <div data-tour="oayer-tabs" style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid var(--border)' }}>
        {([
          { key: 'table', label: t('request.ovl_tab_table') },
          { key: 'info',  label: t('request.ovl_tab_info') },
        ] as const).map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setOayerInfoTab(tab.key)}
            style={{
              padding: '8px 20px',
              fontSize: '0.9rem',
              fontWeight: oayerInfoTab === tab.key ? 700 : 400,
              color: oayerInfoTab === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
              background: 'none',
              border: 'none',
              borderBottom: oayerInfoTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {tab.label}
            {tab.key === 'info' && infoHasData && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4CAF50', display: 'inline-block' }} />
            )}
          </button>
        ))}
      </div>

      {/* 탭 1: OVL Layer 목록 */}
      {oayerInfoTab === 'table' && (
        <>
          <div className="wizard-table-toolbar">
            <div className="wizard-table-toolbar-group">
              <span className="wizard-table-toolbar-label">{t('request.col_st')}:</span>
              <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('st', 'O')}>{t('request.btn_all_o')}</button>
              <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('st', 'X')}>{t('request.btn_all_x')}</button>
              <button type="button" className="th-header-btn" onClick={() => handleOayerResetField('st')}>{t('request.btn_reset')}</button>
            </div>
            <div className="wizard-table-toolbar-group">
              <span className="wizard-table-toolbar-label">{t('request.col_new_or_copy')}:</span>
              <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('new_or_copy', '신규')}>{t('request.btn_all_new')}</button>
              <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('new_or_copy', '차용')}>{t('request.btn_all_copy')}</button>
              <button type="button" className="th-header-btn" onClick={() => handleOayerResetField('new_or_copy')}>{t('request.btn_reset')}</button>
              <button
                type="button"
                className="th-header-btn"
                onClick={() => setOayerSortBySp(v => !v)}
                style={oayerSortBySp ? { background: 'var(--accent)', color: 'white' } : undefined}
              >
                STEP 정렬{oayerSortBySp ? ' ▲' : ''}
              </button>
            </div>
            <div className="wizard-table-toolbar-group" style={{ marginLeft: 'auto' }}>
              {oayerFilterSets.map(fs => (
                <button
                  key={fs.id}
                  type="button"
                  className="th-header-btn"
                  onClick={() => {
                    const next = oayerActiveFilterIds.has(fs.id) ? new Set<string>() : new Set([fs.id]);
                    setOayerActiveFilterIds(next);
                    setOayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, oayerFilterSets, next) })));
                  }}
                  style={oayerActiveFilterIds.has(fs.id) ? { background: 'var(--accent)', color: 'white' } : undefined}
                >
                  {fs.label}
                </button>
              ))}
              <button type="button" className="th-header-btn" onClick={() => setOayerFilterModalOpen(true)}>+ 필터</button>
            </div>
          </div>
          <div className="wizard-table-wrapper" ref={cellSel.containerRef}>
            <table className="wizard-table" style={{ userSelect: oayerDragInfo.current ? 'none' : undefined }} onPaste={(e) => cellSel.onCellPaste(e, renderedOayerIds)}>
              <colgroup>
                <col style={{ width: 44 }} />
                <col /><col /><col /><col />
                <col className="sd-column" />
                <col /><col /><col /><col /><col /><col /><col />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ width: 44, textAlign: 'center' }}>No</th>
                  <th style={{ width: 32, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={oayerRows.filter(r => !r.disabled).length > 0 && oayerRows.filter(r => !r.disabled).every(r => oayerChecked.has(r.id))}
                      ref={(el) => { if (el) { const active = oayerRows.filter(r => !r.disabled); el.indeterminate = active.some(r => oayerChecked.has(r.id)) && !active.every(r => oayerChecked.has(r.id)); } }}
                      onChange={handleOayerCheckAll}
                    />
                  </th>
                  <th style={{ width: 'auto' }}>Update 날짜</th>
                  <th style={{ width: 'auto' }}>{t('request.process_id')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_sp')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_sd')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_layer')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_pp')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_st')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_new_or_copy')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_product_name')}</th>
                  <th style={{ width: 'auto' }}>{t('request.col_step')}</th>
                </tr>
              </thead>
              <tbody>
                {renderedOayerRows.map((row, idx) => {
                  const isFirstDisabled = row.disabled && (idx === 0 || !renderedOayerRows[idx - 1].disabled);
                  const isRegistered = row.new_or_copy === '기등록';
                  const regBg = '#e5e7eb';
                  const cellProps = (col: string, bg?: string, extra?: React.CSSProperties) => ({
                    onMouseDown: (e: React.MouseEvent) => cellSel.onCellMouseDown(row.id, col, e),
                    onMouseEnter: () => cellSel.onCellMouseEnter(row.id, col, renderedOayerIds),
                    style: {
                      backgroundColor: bg,
                      ...extra,
                      ...(cellSel.isCellSelected(row.id, col) ? { boxShadow: 'inset 0 0 0 9999px rgba(37, 99, 235, 0.12)' } : {}),
                    } as React.CSSProperties,
                  });
                  return (
                    <React.Fragment key={row.id}>
                      {isFirstDisabled && (
                        <tr className="row-divider"><td colSpan={12} /></tr>
                      )}
                      <tr
                        className={[row.disabled ? 'row-disabled' : '', oayerChecked.has(row.id) ? 'row-checked' : ''].filter(Boolean).join(' ')}
                        onMouseEnter={() => handleOayerDragEnter(row.id, renderedOayerIds)}
                      >
                        <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{idx + 1}</td>
                        <td style={{ textAlign: 'center' }} onMouseDown={() => handleOayerDragStart(row.id)}>
                          <input type="checkbox" checked={oayerChecked.has(row.id)} onChange={() => handleOayerCheckToggle(row.id)} />
                        </td>
                        <td style={{ backgroundColor: isRegistered ? regBg : undefined }}><input value={row.updated ?? ''} readOnly style={{ background: isRegistered ? regBg : '#f5f5f5', color: '#666' }} /></td>
                        <td {...cellProps('process_id', isRegistered ? regBg : undefined)}><input value={row.process_id} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'process_id', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                        <td {...cellProps('sp', isRegistered ? regBg : undefined)}><input value={row.sp} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'sp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                        <td {...cellProps('sd', isRegistered ? regBg : undefined)}><input value={row.sd} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'sd', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                        <td {...cellProps('layerid', isRegistered ? regBg : undefined)}><input value={row.layerid ?? ''} readOnly={isRegistered} disabled={isRegistered} onChange={(e) => handleOayerChange(row.id, 'layerid', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                        <td {...cellProps('pp', isRegistered ? regBg : undefined)}><input value={row.pp} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'pp', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : row.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }} /></td>
                        <td {...cellProps('st', isRegistered ? regBg : undefined)}>
                          <AutocompleteInput
                            value={row.st}
                            onChange={(v) => handleOayerChange(row.id, 'st', v)}
                            options={ST_OPTIONS}
                            disabled={row.disabled || isRegistered}
                            inputStyle={{ backgroundColor: isRegistered ? regBg : ST_CELL_COLOR[row.st] }}
                            dropdownFontSize="0.7rem"
                            dropdownDirection="up"
                          />
                        </td>
                        <td {...cellProps('new_or_copy')}>
                          <AutocompleteInput
                            value={row.new_or_copy}
                            onChange={(v) => handleOayerChange(row.id, 'new_or_copy', v)}
                            options={NEW_OR_COPY_OPTIONS}
                            disabled={row.disabled}
                            inputStyle={{ backgroundColor: row.new_or_copy === '차용' ? '#93c5fd' : row.new_or_copy === 'layer삭제' ? '#fef08a' : undefined }}
                            dropdownFontSize="0.7rem"
                            dropdownDirection="up"
                          />
                        </td>
                        <td {...cellProps('product_name', isRegistered ? regBg : undefined)}><input value={row.product_name} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'product_name', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                        <td {...cellProps('step', isRegistered ? regBg : undefined)}><input value={row.step} readOnly={row.disabled || isRegistered} disabled={row.disabled || isRegistered} onChange={(e) => handleOayerChange(row.id, 'step', e.target.value)} style={{ backgroundColor: isRegistered ? regBg : undefined }} /></td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bulk-action-row">
            <button type="button" className="flow-table-add-btn" onClick={handleOayerAddRow}>+ 행 추가</button>
            {oayerRows.filter(r => !r.disabled && oayerChecked.has(r.id)).length > 0 && (
              <button type="button" className="btn btn-danger btn-sm" onClick={handleOayerBulkDisable}>
                선택 비활성화 ({oayerRows.filter(r => !r.disabled && oayerChecked.has(r.id)).length})
              </button>
            )}
            {oayerRows.filter(r => r.disabled && oayerChecked.has(r.id)).length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleOayerBulkRestore}>
                복원 ({oayerRows.filter(r => r.disabled && oayerChecked.has(r.id)).length})
              </button>
            )}
          </div>
        </>
      )}

      {/* 탭 2: OVL 정보 */}
      {oayerInfoTab === 'info' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* Partial Shot 계측 필요 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>
                {t('request.partial_shot')} <span className="required">*</span>
                <GuideBadge fk="step4_partial_shot" tk={t('guide.feat.step4_partial_shot' as never)} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['O', 'X'] as const).map(val => (
                  <button
                    key={val}
                    type="button"
                    className={`map-type-btn${detail.partial_shot === val ? ' active' : ''}`}
                    onClick={() => {
                      setDetail(prev => ({ ...prev, partial_shot: prev.partial_shot === val ? '' : val }));
                      if (errors['partial_shot']) setErrors(prev => ({ ...prev, partial_shot: '' }));
                    }}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>
            {errors['partial_shot'] && <span className="form-error">{errors['partial_shot']}</span>}
          </div>

          {/* TBV/TLV */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
            <label className="form-label" style={{ marginBottom: 20 }}>
              {t('request.tbvtlv')}
              <GuideBadge fk="step4_tbvtlv" tk={t('guide.feat.step4_tbvtlv' as never)} />
              {!hasTbvtlv && (
                <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>
                  ({t('request.tbvtlv_no_data')})
                </span>
              )}
            </label>

            {!hasTbvtlv ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('request.tbvtlv_no_data')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* 두께 입력 — 한 줄 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>{t('request.tbvtlv_thickness')}</label>
                  <input
                    className="form-control"
                    style={{ width: 260 }}
                    value={detail.tbvtlv_thickness}
                    onChange={e => setDetail(prev => ({ ...prev, tbvtlv_thickness: e.target.value }))}
                    placeholder="두께 값 입력"
                  />
                </div>

                {/* SD 선택 (좌) + 비고·추가 (우) — 좌우 반반 */}
                <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
                  {/* 왼쪽: SD 선택 */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>{t('request.tbvtlv_sd_select')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {availableTbvtlvSds.length > 0 ? availableTbvtlvSds.map(sd => {
                        const isSelected = tbvtlvSdsSelected[0] === sd;
                        return (
                          <button
                            key={sd}
                            type="button"
                            onClick={() => setTbvtlvSdsSelected(isSelected ? [] : [sd])}
                            style={{
                              padding: '5px 13px',
                              borderRadius: '4px',
                              border: `1.5px solid ${isSelected ? 'var(--accent, #1976D2)' : '#ccc'}`,
                              backgroundColor: isSelected ? 'var(--accent, #1976D2)' : '#fff',
                              color: isSelected ? '#fff' : '#333',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: isSelected ? 600 : 400,
                              transition: 'all 0.15s',
                            }}
                          >
                            {sd}
                          </button>
                        );
                      }) : (
                        <span style={{ fontSize: 13, color: '#999' }}>모든 SD가 추가되었습니다.</span>
                      )}
                    </div>
                  </div>

                  {/* 오른쪽: 비고 + 추가 버튼 */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>{t('request.tbvtlv_note')}</label>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <textarea
                        className="form-control"
                        style={{ flex: 1, minHeight: 120, resize: 'vertical' }}
                        rows={5}
                        value={tbvtlvNote}
                        onChange={e => setTbvtlvNote(e.target.value)}
                        placeholder="비고 입력"
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ whiteSpace: 'nowrap', marginTop: 2 }}
                        disabled={tbvtlvSdsSelected.length === 0}
                        onClick={() => {
                          if (tbvtlvSdsSelected.length === 0) return;
                          setDetail(prev => ({
                            ...prev,
                            tbvtlv_entries: [...(prev.tbvtlv_entries ?? []), { sds: tbvtlvSdsSelected, note: tbvtlvNote }],
                          }));
                          setTbvtlvSdsSelected([]);
                          setTbvtlvNote('');
                        }}
                      >
                        + {t('request.tbvtlv_add')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 추가된 항목 테이블 */}
                {(detail.tbvtlv_entries ?? []).length > 0 && (
                  <table style={{ borderCollapse: 'collapse', width: 'fit-content', fontSize: 12, marginTop: 4 }}>
                    <thead>
                      <tr>
                        <th style={{ border: '1px solid #ddd', padding: '4px 10px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>{t('request.tbvtlv_sd_select')}</th>
                        <th style={{ border: '1px solid #ddd', padding: '4px 10px', background: '#f5f5f5', whiteSpace: 'nowrap' }}>{t('request.tbvtlv_note')}</th>
                        <th style={{ border: '1px solid #ddd', padding: '4px 6px', background: '#f5f5f5' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.tbvtlv_entries ?? []).map((entry, idx) => (
                        <tr key={idx}>
                          <td style={{ border: '1px solid #ddd', padding: '4px 10px', whiteSpace: 'nowrap' }}>{entry.sds.join(', ')}</td>
                          <td style={{ border: '1px solid #ddd', padding: '4px 10px', whiteSpace: 'pre-wrap' }}>{entry.note}</td>
                          <td style={{ border: '1px solid #ddd', padding: '4px 6px', textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              style={{ fontSize: 11, padding: '2px 7px' }}
                              onClick={() =>
                                setDetail(prev => ({
                                  ...prev,
                                  tbvtlv_entries: (prev.tbvtlv_entries ?? []).filter((_, i) => i !== idx),
                                }))
                              }
                            >
                              {t('common.delete')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};

export default Step3;
