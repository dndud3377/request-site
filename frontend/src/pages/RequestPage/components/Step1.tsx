import React from 'react';
import { useTranslation } from 'react-i18next';
import FormSelect from '../../../components/FormSelect';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { DetailFormState, FlowChartRow, RequestDocument, GuideFeatureKey, MergeRefMode, MergeTable } from '../../../types';
import { OPTION_REQUEST_PURPOSE, OPTION_OTHER_PURPOSE, OTHER_PURPOSE_ADI_CD, OTHER_PURPOSE_LAB, isMergePurposeSelected } from '../constants';
import BeforeAfterPanel, { BaField, BaSide } from './BeforeAfterPanel';
import AdiCdPanel, { AdiCdField, AdiCdSide } from './AdiCdPanel';

interface Step1Props {
  detail: DetailFormState;
  errors: Partial<Record<string, string>>;
  isOnlyMap: boolean;
  /** '연구소 제품'을 고를 수 있는가 — 요청 목적이 Only MAP 일 때만 참 */
  isLabProductAllowed: boolean;
  lineOptions: string[];
  processOptions: string[];
  productOptions: string[];
  processIdOptions: string[];
  FlowProductOptions: Record<string, string[]>;
  FlowProcessIdOptions: Record<string, string[]>;
  FlowLayerIdOptions: Record<string, string[]>;
  BbProductOptions: Record<string, string[]>;
  BbProductidOptions: Record<string, string[]>;
  refDocLabel: string;
  setRefDocLabel: React.Dispatch<React.SetStateAction<string>>;
  refDocId: number | null;
  setRefDocId: React.Dispatch<React.SetStateAction<number | null>>;
  approvedDocs: RequestDocument[];
  productionDate: string;
  setProductionDate: React.Dispatch<React.SetStateAction<string>>;
  handleDetailChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  handleDetailSet: (name: string, value: string | string[]) => void;
  handlePartidSelectionBlur: () => void;
  handleRequestPurposeSelect: (val: string) => void;
  handleRefDocSelect: (label: string) => void;
  handleMergeClick: () => void;
  handleMergeReselect: () => void;
  hasMergeSnapshot: boolean;
  baSameCount: number;
  baSelBefore: string | null;
  baSelAfter: string | null;
  handleBaSelect: (side: BaSide, id: string) => void;
  handleBaApply: () => void;
  handleBaUnpair: (index: number) => void;
  handleMergeModeSelect: (mode: MergeRefMode) => void;
  handleBaCellChange: (pairId: string, side: BaSide, field: BaField, value: string) => void;
  handleBaCellBlur: (pairId: string, side: BaSide) => void;
  handleBaPasteRaw: (pairId: string, side: BaSide, raw: string) => void;
  handleBaTableChange: (pairId: string, table: MergeTable) => void;
  handleBaAddRow: () => void;
  handleBaResetRow: (pairId: string) => void;
  handleFlowChange: (id: string, field: keyof Omit<FlowChartRow, 'id'>, value: string) => void;
  handleFlowStepBlur: (rowId: string, field: 'step_from' | 'step_to') => void;
  handleFlowDeleteRow: (id: string) => void;
  handleFlowAddRow: () => void;
  handleBbEntryChange: (idx: number, field: 'location' | 'product' | 'process_id', value: string) => void;
  handleBbEntryDelete: (idx: number) => void;
  handleBbEntryAdd: () => void;
  isAdiCdSelected: boolean;
  handleSelectAdiCdPurpose: () => void;
  handleLeaveAdiCd: () => void;
  handleAdiCdCellChange: (side: AdiCdSide, id: string, field: AdiCdField, value: string) => void;
  handleAdiCdAddRow: (side: AdiCdSide) => void;
  handleAdiCdRemoveRow: (side: AdiCdSide, id: string) => void;
  handleAdiCdPasteRaw: (side: AdiCdSide, raw: string) => void;
  handleAdiCdToggleDeleteAll: (next: boolean) => void;
  GuideBadge: React.FC<{ fk: GuideFeatureKey; tk: string }>;
}

const Step1: React.FC<Step1Props> = ({
  detail,
  errors,
  isOnlyMap,
  isLabProductAllowed,
  lineOptions,
  processOptions,
  productOptions,
  processIdOptions,
  FlowProductOptions,
  FlowProcessIdOptions,
  FlowLayerIdOptions,
  BbProductOptions,
  BbProductidOptions,
  refDocLabel,
  setRefDocLabel,
  refDocId,
  setRefDocId,
  approvedDocs,
  productionDate,
  setProductionDate,
  handleDetailChange,
  handleDetailSet,
  handlePartidSelectionBlur,
  handleRequestPurposeSelect,
  handleRefDocSelect,
  handleMergeClick,
  handleMergeReselect,
  hasMergeSnapshot,
  baSameCount,
  baSelBefore,
  baSelAfter,
  handleBaSelect,
  handleBaApply,
  handleBaUnpair,
  handleMergeModeSelect,
  handleBaCellChange,
  handleBaCellBlur,
  handleBaPasteRaw,
  handleBaTableChange,
  handleBaAddRow,
  handleBaResetRow,
  handleFlowChange,
  handleFlowStepBlur,
  handleFlowDeleteRow,
  handleFlowAddRow,
  handleBbEntryChange,
  handleBbEntryDelete,
  handleBbEntryAdd,
  isAdiCdSelected,
  handleSelectAdiCdPurpose,
  handleLeaveAdiCd,
  handleAdiCdCellChange,
  handleAdiCdAddRow,
  handleAdiCdRemoveRow,
  handleAdiCdPasteRaw,
  handleAdiCdToggleDeleteAll,
  GuideBadge,
}) => {
  const { t } = useTranslation();
  const canSelectPurpose =
    detail.line !== '' &&
    detail.process_selection !== '' &&
    detail.partid_selection !== '' &&
    detail.process_id !== '';
  // Only MAP / MAP 삭제/수정 모드: 기타목적·흐름도·Backbone·참조요청서는 초기화 후 작성 불가
  // (특이사항·변경 요청 목적은 초기화되지만 작성은 가능 — change_purpose_note 는 disableOptional 대상 아님)
  const disableOptional = !canSelectPurpose || isOnlyMap;
  /**
   * 기타 목적 버튼의 개별 잠금.
   * '연구소 제품'만 Only MAP 전용이라 잠금 규칙이 반대다 —
   * Only MAP 에서는 이것만 열리고, 다른 목적에서는 이것만 잠긴다.
   */
  const otherPurposeDisabled = (val: string): boolean =>
    val === OTHER_PURPOSE_LAB ? !canSelectPurpose || !isLabProductAllowed : disableOptional;
  // 참조 요청서는 의뢰서당 1건만 지정할 수 있다. 확정하면 모드 선택·참조 선택·Merge 를 잠그고,
  // 바꾸려면 '재선택' 버튼을 쓴다(문서에 저장되므로 임시저장 후 재진입해도 유지된다).
  // '없음' 으로 확정한 경우는 문서 id 가 없으므로 merge_applied 로 판단한다.
  const isMergeDone = detail.merge_ref_doc_id !== null || detail.merge_applied;
  // '없음' 으로 확정 — 짝지을 참조가 없어 BEFORE/AFTER 매핑 표를 감추고 변경전/변경후만 쓴다.
  const isMergeNone = detail.merge_ref_mode === 'none';
  // Merge 사용 목적(Layer 추가/삭제·STEPSEQ 변경·Overlay 변경)을 하나라도 골랐으면 블록을 1개만 노출한다.
  const showMergeBlock = isMergePurposeSelected(detail.other_purpose);

  return (
    <div className="form-section">
      <div className="form-section-title">📋 {t('request.section_detail')}</div>
      <div className="form-grid" data-tour="detail-fields">

        {/* 1. 라인 / 조합법 / 제품 이름 / 조리법 */}
        <div className="full-width" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('request.line')} / {t('request.process_selection')}</span>
          <GuideBadge fk="step1_line_process" tk={t('guide.feat.step1_line_process' as never)} />
        </div>
        <div className="full-width flex-row" data-tour="line-fields">
          <FormSelect
            label={t('request.line')}
            name="line"
            value={detail.line}
            options={lineOptions}
            onChange={handleDetailChange}
            placeholder={t('request.select_placeholder')}
            required
            error={errors.line}
            className="flex-col"
          />
          <AutocompleteInput
            label={t('request.process_selection')}
            value={detail.process_selection}
            options={processOptions}
            onChange={(v) => handleDetailSet('process_selection', v)}
            required
            error={errors.process_selection}
            style={{ flex: 1 }}
          />
          <AutocompleteInput
            label={t('request.partid_selection')}
            value={detail.partid_selection}
            options={productOptions}
            onChange={(v) => handleDetailSet('partid_selection', v)}
            onBlur={handlePartidSelectionBlur}
            required
            error={errors.partid_selection}
            hideErrorMessage={!!detail.partid_selection.trim()}
            disabled={productOptions.length === 0}
            style={{ flex: 1 }}
          />
          <AutocompleteInput
            label={t('request.process_id')}
            value={detail.process_id}
            options={processIdOptions}
            onChange={(v) => handleDetailSet('process_id', v)}
            placeholder={t('request.select_placeholder')}
            required
            error={errors.process_id}
            style={{ flex: 1 }}
          />
        </div>

        {/* 안내 문구 */}
        {!canSelectPurpose && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            라인, 조합법, 제품 이름, 조리법을 모두 선택하면 나머지 항목을 입력할 수 있습니다.
          </span>
        )}

        {/* 2. 요청 목적 */}
        <div className="form-group full-width">
          <label className="form-label">
            {t('request.request_purpose')} <span className="required">*</span>
            <GuideBadge fk="step1_request_purpose" tk={t('guide.feat.step1_request_purpose' as never)} />
          </label>
          <div style={{ display: 'flex', gap: '8px', marginTop: 4 }}>
            {OPTION_REQUEST_PURPOSE.map((val) => (
              <button
                key={val}
                type="button"
                className={`map-type-btn${detail.request_purpose === val ? ' active' : ''}`}
                onClick={() => { if (canSelectPurpose) handleRequestPurposeSelect(val); }}
                disabled={!canSelectPurpose}
              >
                {val}
              </button>
            ))}
          </div>
          {errors.request_purpose && <span className="form-error">{errors.request_purpose}</span>}
        </div>

        {/* 기타 목적 / 흐름도 / 특이사항 */}
        <div className="form-group full-width">
          <div className="conditional-group">
            <div className="flex-col">
              <label className="form-label">{t('request.other_purpose')}<GuideBadge fk="step1_other_purpose" tk={t('guide.feat.step1_other_purpose' as never)} /></label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 4 }}>
                {OPTION_OTHER_PURPOSE.map((val) => {
                  const selected = detail.other_purpose.includes(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      className={`map-type-btn${selected ? ' active' : ''}`}
                      onClick={() => {
                        if (otherPurposeDisabled(val)) return;
                        // ADI CD 변경: 단독 전용이 아니라 다른 목적과 함께 켤 수 있다.
                        if (val === OTHER_PURPOSE_ADI_CD) {
                          if (isAdiCdSelected) handleLeaveAdiCd(); else handleSelectAdiCdPurpose();
                          return;
                        }
                        handleDetailSet(
                          'other_purpose',
                          selected
                            ? detail.other_purpose.filter((v) => v !== val)
                            : [...detail.other_purpose, val]
                        );
                      }}
                      disabled={otherPurposeDisabled(val)}
                    >
                      {val}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 참조 요청서 Merge — Layer 추가/삭제·STEPSEQ 변경·Overlay 변경 공용 (여러 개를 골라도 1개만) */}
            {showMergeBlock && (
              <div>
                {/* 참조 요청서 있음/없음 — 바꿀 때는 index.tsx 가 확인 모달을 먼저 띄운다(내용이 모두 초기화된다) */}
                <div className="merge-mode-row">
                  {([
                    { value: 'ref' as MergeRefMode, label: t('request.merge_mode_ref') },
                    { value: 'none' as MergeRefMode, label: t('request.merge_mode_none') },
                  ]).map((opt) => (
                    <label key={opt.value} className="merge-mode-option">
                      <input
                        type="radio"
                        name="merge_ref_mode"
                        value={opt.value}
                        checked={detail.merge_ref_mode === opt.value}
                        disabled={disableOptional || isMergeDone}
                        onChange={() => handleMergeModeSelect(opt.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', maxWidth: 920 }}>
                  <div style={{ flex: 1 }}>
                    <AutocompleteInput
                      label={t('request.merge_ref_doc')}
                      value={isMergeNone ? t('request.merge_ref_none') : (isMergeDone ? detail.merge_ref_doc_label : refDocLabel)}
                      options={approvedDocs.map((d) => d.title)}
                      onChange={(v) => {
                        setRefDocLabel(v);
                        if (refDocId !== null) setRefDocId(null);
                      }}
                      onSelect={handleRefDocSelect}
                      placeholder={t('request.merge_ref_placeholder')}
                      disabled={disableOptional || isMergeDone || isMergeNone}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={disableOptional || isMergeDone || (!isMergeNone && refDocId === null)}
                    style={disableOptional || isMergeDone || (!isMergeNone && refDocId === null) ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    onClick={handleMergeClick}
                  >
                    {t('request.merge_button')}
                  </button>
                  {/* 재선택: Merge 결과·매핑을 비우고 J/O 표를 Merge 직전으로 되돌린다 */}
                  {isMergeDone && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleMergeReselect}
                      title={hasMergeSnapshot ? undefined : t('request.merge_reselect_no_snapshot')}
                    >
                      ↻ {t('request.merge_reselect')}
                    </button>
                  )}
                </div>
                {isMergeDone && (
                  <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    ⓘ {t(isMergeNone ? 'request.merge_none_done' : 'request.merge_already_done')}
                  </div>
                )}
                {/* 변경전/변경후 표 — 참조를 Merge 했거나 '없음' 으로 확정했을 때 */}
                {isMergeDone && (
                  <BeforeAfterPanel
                    detail={detail}
                    sameCount={baSameCount}
                    manualOnly={isMergeNone}
                    selBefore={baSelBefore}
                    selAfter={baSelAfter}
                    onSelect={handleBaSelect}
                    onApply={handleBaApply}
                    onUnpair={handleBaUnpair}
                    onCellChange={handleBaCellChange}
                    onCellBlur={handleBaCellBlur}
                    onPasteRaw={handleBaPasteRaw}
                    onTableChange={handleBaTableChange}
                    onAddRow={handleBaAddRow}
                    onResetRow={handleBaResetRow}
                  />
                )}
              </div>
            )}

            {/* ADI CD 변경: 변경전/변경후 스텝 표 — map_type 은 index.tsx 가 'ADI' 로 자동 고정한다 */}
            {isAdiCdSelected && (
              <AdiCdPanel
                before={detail.adi_cd_before}
                after={detail.adi_cd_after}
                deleteAll={detail.adi_cd_delete_all}
                onCellChange={handleAdiCdCellChange}
                onAddRow={handleAdiCdAddRow}
                onRemoveRow={handleAdiCdRemoveRow}
                onPasteRaw={handleAdiCdPasteRaw}
                onToggleDeleteAll={handleAdiCdToggleDeleteAll}
              />
            )}

            {/* 흐름도 */}
            <div className="form-group">
              <label className="form-label">{t('request.flow_chart')}<GuideBadge fk="step1_flow_chart" tk={t('guide.feat.step1_flow_chart' as never)} /></label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {detail.flow_chart.map((row) => (
                  <div key={row.id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                      <label className="form-label">{t('request.flow_line')}</label>
                      <select
                        className="form-control"
                        value={row.location}
                        onChange={(e) => handleFlowChange(row.id, 'location', e.target.value)}
                        disabled={disableOptional}
                      >
                        <option value="">{t('request.select_placeholder')}</option>
                        {lineOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                      <label className="form-label">{t('request.flow_partid')}</label>
                      <AutocompleteInput
                        value={row.product_name}
                        onChange={(v) => handleFlowChange(row.id, 'product_name', v)}
                        options={FlowProductOptions[row.id] || []}
                        placeholder={t('request.select_placeholder')}
                        style={{ width: '100%' }}
                        disabled={disableOptional}
                      />
                    </div>
                    <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                      <label className="form-label">{t('request.flow_process_id')}</label>
                      <AutocompleteInput
                        value={row.process_id}
                        onChange={(v) => handleFlowChange(row.id, 'process_id', v)}
                        options={FlowProcessIdOptions[row.id] || []}
                        placeholder={t('request.select_placeholder')}
                        style={{ width: '100%' }}
                        disabled={disableOptional}
                      />
                    </div>
                    <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                      <label className="form-label">{t('request.flow_progress_layer')}</label>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <AutocompleteInput
                          value={row.step_from}
                          onChange={(v) => handleFlowChange(row.id, 'step_from', v)}
                          onBlur={() => handleFlowStepBlur(row.id, 'step_from')}
                          options={FlowLayerIdOptions[row.id] || []}
                          placeholder={t('request.select_placeholder')}
                          style={{ minWidth: '80px' }}
                          error={errors[`flow_step_${row.id}_step_from`]}
                          hideErrorMessage
                          disabled={disableOptional || (FlowLayerIdOptions[row.id] || []).length === 0}
                        />
                        <span style={{ whiteSpace: 'nowrap' }}>~</span>
                        <AutocompleteInput
                          value={row.step_to}
                          onChange={(v) => handleFlowChange(row.id, 'step_to', v)}
                          onBlur={() => handleFlowStepBlur(row.id, 'step_to')}
                          options={FlowLayerIdOptions[row.id] || []}
                          placeholder={t('request.select_placeholder')}
                          style={{ minWidth: '80px' }}
                          error={errors[`flow_step_${row.id}_step_to`]}
                          hideErrorMessage
                          disabled={disableOptional || (FlowLayerIdOptions[row.id] || []).length === 0}
                        />
                      </div>
                    </div>
                    {detail.flow_chart.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '6px 10px', marginBottom: '2px' }}
                        onClick={() => handleFlowDeleteRow(row.id)}
                        disabled={disableOptional}
                      >
                        {t('request.bb_delete')}
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={handleFlowAddRow} disabled={disableOptional}>
                  + {t('request.flow_add_row')}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">{t('request.change_purpose_note')}</label>
              {/* 특이사항·변경 요청 목적은 Only MAP / MAP 삭제/수정 에서도 입력할 수 있다.
                  (목적 전환 시 값이 초기화되는 동작은 그대로 — applyMapOnlyScope) */}
              <textarea
                className="form-control"
                name="change_purpose_note"
                value={detail.change_purpose_note}
                onChange={handleDetailChange}
                rows={3}
                disabled={!canSelectPurpose}
              />
            </div>
          </div>
        </div>

        {/* 3. 뼈찜 조합 영역 */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="form-label">
            {t('request.bb_status')} <span className="required">*</span>
            <GuideBadge fk="step1_bb_entry" tk={t('guide.feat.step1_bb_entry' as never)} />
          </label>
          {errors.bb_entries && <span className="form-error">{errors.bb_entries}</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {detail.bb_entries.map((entry, idx) => (
              <div key={entry.id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                  <label className="form-label">{t('request.bb_ref_line')}</label>
                  <select
                    className="form-control"
                    value={entry.location}
                    onChange={(e) => handleBbEntryChange(idx, 'location', e.target.value)}
                    disabled={disableOptional}
                  >
                    <option value="">{t('request.select_placeholder')}</option>
                    {lineOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                  <label className="form-label">{t('request.bb_ref_part_id')}</label>
                  <AutocompleteInput
                    value={entry.product}
                    onChange={(v) => handleBbEntryChange(idx, 'product', v)}
                    options={BbProductOptions[entry.id] || []}
                    placeholder={t('request.select_placeholder')}
                    style={{ width: '100%' }}
                    disabled={disableOptional}
                  />
                </div>
                <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                  <label className="form-label">{t('request.bb_ref_process_id')}</label>
                  <AutocompleteInput
                    value={entry.process_id}
                    onChange={(v) => handleBbEntryChange(idx, 'process_id', v)}
                    options={BbProductidOptions[entry.id] || []}
                    placeholder={t('request.select_placeholder')}
                    style={{ width: '100%' }}
                    disabled={disableOptional}
                  />
                </div>
                {detail.bb_entries.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: '6px 10px', marginBottom: '2px' }}
                    onClick={() => handleBbEntryDelete(idx)}
                    disabled={disableOptional}
                  >
                    {t('request.bb_delete')}
                  </button>
                )}
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-secondary" onClick={handleBbEntryAdd} disabled={disableOptional}>
                + {t('request.bb_add')}
              </button>
            </div>
          </div>
        </div>

        {/* 4. 고객/업체명 / 요구 사항 */}
        <div className="full-width flex-row">
          <div className="form-group flex-col" style={{ flex: 1 }}>
            <label className="form-label">{t('request.customer_name')}<GuideBadge fk="step1_customer_vendor" tk={t('guide.feat.step1_customer_vendor' as never)} /></label>
            <input
              className="form-control"
              name="customer_name"
              value={detail.customer_name}
              onChange={handleDetailChange}
              disabled={!canSelectPurpose}
            />
          </div>
          <div className="form-group flex-col" style={{ flex: 2 }}>
            <label className="form-label">{t('request.customer_requirement')}</label>
            <input
              className="form-control"
              name="customer_requirement"
              value={detail.customer_requirement}
              onChange={handleDetailChange}
              disabled={!canSelectPurpose}
            />
          </div>
        </div>

        {/* 5. 실제 생산 진행 날짜 */}
        <div className="form-group full-width">
          <label className="form-label">{t('request.production_date')}</label>
          <input
            type="date"
            className="form-control"
            value={productionDate}
            onChange={(e) => setProductionDate(e.target.value)}
            disabled={!canSelectPurpose}
            style={{ maxWidth: '200px' }}
          />
        </div>

      </div>
    </div>
  );
};

export default Step1;
