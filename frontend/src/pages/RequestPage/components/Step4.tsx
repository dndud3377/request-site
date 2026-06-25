import React from 'react';
import { useTranslation } from 'react-i18next';
import AutocompleteInput from '../../../components/AutocompleteInput';
import {
  PhotoStepOption,
  ExternalBbDataItem,
  BbAutoFillRange,
  JayerRow,
  BbTableRow,
  DetailFormState,
  GuideFeatureKey,
} from '../../../types';

interface Step4Props {
  bbExternalData: PhotoStepOption[][];
  activeBbTab: number;
  setActiveBbTab: React.Dispatch<React.SetStateAction<number>>;
  detail: DetailFormState;
  errors: Partial<Record<string, string>>;
  bbSearchQueries: string[];
  setBbSearchQueries: React.Dispatch<React.SetStateAction<string[]>>;
  stagedMappings: Record<string, ExternalBbDataItem>;
  showAutoFillPanel: boolean;
  setShowAutoFillPanel: React.Dispatch<React.SetStateAction<boolean>>;
  bbAutoFillRanges: BbAutoFillRange[];
  setBbAutoFillRanges: React.Dispatch<React.SetStateAction<BbAutoFillRange[]>>;
  jayerRows: JayerRow[];
  mappedJayerRowIds: Set<string>;
  selectedJayerRowId: string | null;
  setSelectedJayerRowId: React.Dispatch<React.SetStateAction<string | null>>;
  bbExternalLoading: boolean;
  bbRows: BbTableRow[];
  bbChecked: Set<string>;
  setDeleteConfirm: React.Dispatch<React.SetStateAction<{ message: string; onConfirm: () => void } | null>>;
  handleOpenAutoFillPanel: () => void;
  handleRangeChange: (id: string, field: keyof BbAutoFillRange, value: string) => void;
  handleRemoveRange: (id: string) => void;
  handleAddRange: () => void;
  handleApplyAutoFill: () => void;
  handleClearStaging: (jayerRowId: string) => void;
  handleStageMapping: (externalRow: ExternalBbDataItem) => void;
  handleApplyMappings: () => void;
  handleResetBbRows: () => void;
  handleBbCheckAll: () => void;
  handleBbCheckToggle: (id: string) => void;
  handleBbChange: (id: string, field: keyof Omit<BbTableRow, 'id'>, value: string) => void;
  handleSortBbRows: () => void;
  handleBbAddRow: () => void;
  handleBbBulkDelete: () => void;
  GuideBadge: React.FC<{ fk: GuideFeatureKey; tk: string }>;
}

const Step4: React.FC<Step4Props> = ({
  bbExternalData,
  activeBbTab,
  setActiveBbTab,
  detail,
  errors,
  bbSearchQueries,
  setBbSearchQueries,
  stagedMappings,
  showAutoFillPanel,
  setShowAutoFillPanel,
  bbAutoFillRanges,
  setBbAutoFillRanges,
  jayerRows,
  mappedJayerRowIds,
  selectedJayerRowId,
  setSelectedJayerRowId,
  bbExternalLoading,
  bbRows,
  bbChecked,
  setDeleteConfirm,
  handleOpenAutoFillPanel,
  handleRangeChange,
  handleRemoveRange,
  handleAddRange,
  handleApplyAutoFill,
  handleClearStaging,
  handleStageMapping,
  handleApplyMappings,
  handleResetBbRows,
  handleBbCheckAll,
  handleBbCheckToggle,
  handleBbChange,
  handleSortBbRows,
  handleBbAddRow,
  handleBbBulkDelete,
  GuideBadge,
}) => {
  const { t } = useTranslation();
  const currentTabPhotoSteps = bbExternalData[activeBbTab] ?? [];
  const currentEntry = detail.bb_entries[activeBbTab];
  const currentTabData: ExternalBbDataItem[] = currentTabPhotoSteps.map((step, idx) => ({
    id: `photo-${activeBbTab}-${idx}`,
    bb_process_id: step.processid,
    bb_name: currentEntry?.product || '',
    bb_step: step.descript,
    bb_ss: step.stepseq,
    layerid: step.layerid,
    location: currentEntry?.location || '',
  }));

  const currentSearchQuery = bbSearchQueries[activeBbTab] || '';
  const filteredTabData = currentSearchQuery
    ? currentTabData.filter(item =>
        item.bb_process_id.toLowerCase().includes(currentSearchQuery.toLowerCase()) ||
        item.bb_name.toLowerCase().includes(currentSearchQuery.toLowerCase()) ||
        item.bb_ss.toLowerCase().includes(currentSearchQuery.toLowerCase()) ||
        item.bb_step.toLowerCase().includes(currentSearchQuery.toLowerCase()) ||
        (item.layerid || '').toLowerCase().includes(currentSearchQuery.toLowerCase())
      )
    : currentTabData;
  const stagedCount = Object.keys(stagedMappings).length;

  // 자동채움 범위 후보 layer: 원본 목록에 남은(미매핑) 행 기준
  const remainingLayerOptions = [...new Set(
    jayerRows.filter(r => !r.disabled && !mappedJayerRowIds.has(r.id)).map(r => r.layerid).filter(Boolean)
  )].sort((a, b) => parseFloat(a) - parseFloat(b));

  return (
    <div className="form-section">
      <div className="form-section-title"><span style={{ color: '#4CAF50' }}>🔷</span> {t('request.bb_li')}</div>

      {errors.jayer_mapping && (
        <div className="form-group" style={{ marginBottom: 12 }}>
          <span className="form-error">{errors.jayer_mapping}</span>
        </div>
      )}

      {/* 자동 채움 버튼 */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          data-tour="bb-autofill"
          onClick={handleOpenAutoFillPanel}
          disabled={bbExternalData.length === 0 || bbExternalData.every(tab => tab.length === 0)}
        >
          📋 Backbone 자동 채움
        </button>
        {jayerRows.filter(r => !r.disabled).length > 0 && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {jayerRows.filter(r => !r.disabled && !mappedJayerRowIds.has(r.id)).length}행 조회됨
          </span>
        )}
        <GuideBadge fk="step5_bb_autofill" tk={t('guide.feat.step5_bb_autofill' as never)} />
      </div>

      {/* 자동 채움 패널 */}
      {showAutoFillPanel && (
        <div style={{
          marginBottom: 16,
          padding: 16,
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          border: '1px solid var(--border)'
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            🔷 Layer 범위 설정
          </div>
          {bbAutoFillRanges.map((range, idx) => (
            <div
              key={range.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                flexWrap: 'wrap'
              }}
            >
              <span style={{ fontSize: 13, minWidth: 50 }}>범위 {idx + 1}:</span>
              <div style={{ minWidth: 100 }}>
                <AutocompleteInput
                  value={range.layerFrom}
                  onChange={(v) => handleRangeChange(range.id, 'layerFrom', v)}
                  options={remainingLayerOptions}
                  placeholder="시작 Layer"
                  dropdownFontSize="0.8rem"
                />
              </div>
              <span>~</span>
              <div style={{ minWidth: 100 }}>
                <AutocompleteInput
                  value={range.layerTo}
                  onChange={(v) => handleRangeChange(range.id, 'layerTo', v)}
                  options={remainingLayerOptions}
                  placeholder="종료 Layer"
                  dropdownFontSize="0.8rem"
                />
              </div>
              <select
                value={range.entryIdx}
                onChange={(e) => handleRangeChange(range.id, 'entryIdx', e.target.value)}
                style={{ padding: '4px 8px', fontSize: 13, minWidth: 120 }}
              >
                {detail.bb_entries.map((entry, entryIdx) => (
                  <option key={entryIdx} value={entryIdx}>
                    {`[${entry.location}] ${entry.product}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="flow-delete-btn"
                onClick={() => handleRemoveRange(range.id)}
                style={{ width: 24, height: 24, padding: 0 }}
              >✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleAddRange}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              + 범위 추가
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-bbtour="autofill-apply"
              onClick={handleApplyAutoFill}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              ✔ 적용
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowAutoFillPanel(false);
                setBbAutoFillRanges([]);
              }}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 분할 패널 */}
      <div className="bb-split-panel">
        {/* 왼쪽: 원본 행 목록 + 매핑 미리보기 */}
        <div className="bb-split-panel-left">
          <div className="bb-split-panel-title">
            ① 원본 데이터 목록 — 행을 클릭하면 오른쪽에서 bb 데이터 매핑 가능
          </div>
          <div className="bb-split-panel-scroll">
            {jayerRows.filter(r => !r.disabled).length === 0 ? (
              <div className="bb-split-hint">원본 layer 정보가 없습니다. Step 3를 먼저 입력하세요.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>공법</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>STEPSEQ</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>STEP 설명</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>Layer</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>Backbone Data</th>
                    <th style={{ padding: '6px 8px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, width: 28 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {jayerRows
                    .filter((row) => !mappedJayerRowIds.has(row.id))
                    .filter(r => !r.disabled).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => {
                      const staged = stagedMappings[row.id];
                      const isSelected = selectedJayerRowId === row.id;
                      return (
                        <tr
                          key={row.id}
                          data-bbtour={`jrow-${row.layerid}`}
                          className={isSelected ? 'bb-jayer-selected' : ''}
                          onClick={() => setSelectedJayerRowId(row.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.process_id || '—'}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.sp || '—'}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.sd || '—'}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.layerid || '—'}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>
                            {staged ? (
                              <span className="bb-staged-badge">{staged.bb_process_id} / {staged.bb_step}</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>미선택</span>
                            )}
                          </td>
                          <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--border-light)', textAlign: 'center' }}>
                            {staged && (
                              <button
                                type="button"
                                className="flow-delete-btn"
                                style={{ width: 20, height: 20, fontSize: 11 }}
                                onClick={(e) => { e.stopPropagation(); handleClearStaging(row.id); }}
                                title="매핑 취소"
                              >✕</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 오른쪽: bb_entries 탭별 외부 데이터 */}
        <div className="bb-split-panel-right">
          <div className="bb-split-panel-title">
            {t('request.ext_data_assign_to_jayer')}
          </div>
          <div className="bb-tab-bar">
            {detail.bb_entries.map((entry, idx) => (
              <button
                key={idx}
                type="button"
                data-bbtour={`bbtab-${idx}`}
                className={`bb-tab${activeBbTab === idx ? ' bb-tab-active' : ''}`}
                onClick={() => setActiveBbTab(idx)}
              >
                {`[${entry.location}] ${entry.product}`}
              </button>
            ))}
          </div>
          <div className="bb-split-panel-scroll">
            {bbExternalLoading ? (
              <div className="bb-split-loading">데이터 로드 중...</div>
            ) : currentTabData.length === 0 ? (
              <div className="bb-split-hint">
                {currentEntry?.process_id
                  ? '해당 bb 에 대한 데이터가 없습니다.'
                  : 'Step 1에서 뼈찜 조합 조리법을 먼저 선택하세요.'}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="검색어 입력"
                  value={bbSearchQueries[activeBbTab] || ''}
                  onChange={(e) => {
                    const newQueries = [...bbSearchQueries];
                    newQueries[activeBbTab] = e.target.value;
                    setBbSearchQueries(newQueries);
                  }}
                  style={{ marginBottom: 8, padding: '6px 10px', width: '100%', boxSizing: 'border-box' }}
                />
                {currentSearchQuery && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                    검색 결과: {filteredTabData.length}건
                  </div>
                )}
                <table className="bb-external-table">
                  <thead>
                    <tr>
                      <th>Ref.공법</th>
                      <th>Ref.PART ID</th>
                      <th>Ref.SEQ</th>
                      <th>설명</th>
                      <th>Layer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTabData.map((item) => {
                      const isStaged = selectedJayerRowId
                        ? stagedMappings[selectedJayerRowId]?.id === item.id
                        : false;
                      return (
                        <tr
                          key={item.id}
                          data-bbtour={`ext-${item.layerid}`}
                          className={`bb-external-row${isStaged ? ' bb-external-staged' : ''}`}
                          onClick={() => handleStageMapping(item)}
                          title="클릭하면 선택된 원본 layer 에 지정됩니다"
                        >
                          <td>{item.bb_process_id}</td>
                          <td>{item.bb_name}</td>
                          <td>{item.bb_ss}</td>
                          <td>{item.bb_step}</td>
                          <td>{item.layerid || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 적용 버튼 */}
      <div className="bb-apply-row">
        <span className="bb-apply-hint">
          {stagedCount > 0
            ? `${stagedCount}개 행이 매핑됨 — 적용 버튼을 눌러 bb 정보에 반영하세요.`
            : '왼쪽에서 원본 layer 를 선택하고 오른쪽에서 bb 데이터를 클릭하여 매핑하세요.'}
        </span>
        <GuideBadge fk="step5_bb_mapping" tk={t('guide.feat.step5_bb_mapping' as never)} />
        <button
          type="button"
          className="btn btn-primary"
          data-bbtour="map-apply"
          onClick={handleApplyMappings}
          disabled={stagedCount === 0}
        >
          ✔ 적용 ({stagedCount}건)
        </button>
      </div>

      {/* bb 정보 테이블 (적용 후 채워짐) */}
      <div className="bb-selected-section">
        <div className="form-section-title" style={{ fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#4CAF50' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            bb 정보 (적용 결과)
            <GuideBadge fk="step5_bb_table" tk={t('guide.feat.step5_bb_table' as never)} />
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleResetBbRows}
            style={{ fontSize: 13, padding: '6px 12px' }}
          >
            🗑️ 초기화
          </button>
        </div>
        <div className="wizard-table-wrapper">
          <table className="wizard-table">
            <thead>
              <tr>
                <th style={{ width: 32, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={bbRows.length > 0 && bbChecked.size === bbRows.length}
                    ref={(el) => { if (el) el.indeterminate = bbChecked.size > 0 && bbChecked.size < bbRows.length; }}
                    onChange={handleBbCheckAll}
                  />
                </th>
                <th style={{ width: 'auto' }}>{t('request.col_no')}</th>
                <th style={{ width: 'auto' }}>{t('request.process_id')}</th>
                <th
                  style={{ width: 'auto', cursor: 'pointer', userSelect: 'none' }}
                  onClick={handleSortBbRows}
                  title="클릭하여 SEQ 기준 오름차순 정렬"
                >
                  {t('request.col_sp')} 🔼
                </th>
                <th style={{ width: 'auto' }}>{t('request.col_sd')}</th>
                <th style={{ width: 'auto' }}>{t('request.col_bb_process_id')}</th>
                <th style={{ width: 'auto' }}>{t('request.col_bb_partid')}</th>
                <th style={{ width: 'auto' }}>{t('request.col_bb_layer')}</th>
                <th style={{ width: 'auto' }}>{t('request.col_bb_stepseq')}</th>
                <th style={{ width: 'auto' }}>{t('request.col_remark')}</th>
              </tr>
            </thead>
            <tbody>
              {bbRows.map((row, idx) => (
                <tr key={row.id} className={bbChecked.has(row.id) ? 'row-checked' : ''}>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={bbChecked.has(row.id)} onChange={() => handleBbCheckToggle(row.id)} />
                  </td>
                  <td className="wizard-table-no">{idx + 1}</td>
                  <td><input value={row.process_id} onChange={(e) => handleBbChange(row.id, 'process_id', e.target.value)} /></td>
                  <td><input value={row.ss} onChange={(e) => handleBbChange(row.id, 'ss', e.target.value)} /></td>
                  <td><input value={row.sd} onChange={(e) => handleBbChange(row.id, 'sd', e.target.value)} /></td>
                  <td><input value={row.bb_process_id} onChange={(e) => handleBbChange(row.id, 'bb_process_id', e.target.value)} /></td>
                  <td><input value={row.bb_name} onChange={(e) => handleBbChange(row.id, 'bb_name', e.target.value)} /></td>
                  <td><input value={row.bb_step} onChange={(e) => handleBbChange(row.id, 'bb_step', e.target.value)} /></td>
                  <td><input value={row.bb_ss} onChange={(e) => handleBbChange(row.id, 'bb_ss', e.target.value)} /></td>
                  <td><input value={row.remark} onChange={(e) => handleBbChange(row.id, 'remark', e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bulk-action-row">
          <button type="button" className="flow-table-add-btn" onClick={handleBbAddRow}>+ 행 추가</button>
          {bbChecked.size > 0 && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setDeleteConfirm({ message: `${bbChecked.size}개 항목을 원복하시겠습니까?`, onConfirm: handleBbBulkDelete })}
            >선택 원복 ({bbChecked.size})</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Step4;
