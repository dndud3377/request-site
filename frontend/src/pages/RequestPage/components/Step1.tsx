import React from 'react';
import { useTranslation } from 'react-i18next';
import FormSelect from '../../../components/FormSelect';
import AutocompleteInput from '../../../components/AutocompleteInput';
import { DetailFormState, FlowChartRow, RequestDocument, GuideFeatureKey } from '../../../types';
import { OPTION_REQUEST_PURPOSE, OPTION_OTHER_PURPOSE } from '../constants';

interface Step1Props {
  detail: DetailFormState;
  errors: Partial<Record<string, string>>;
  isOnlyMap: boolean;
  lineOptions: string[];
  processOptions: string[];
  productOptions: string[];
  processIdOptions: string[];
  FlowProductOptions: Record<number, string[]>;
  FlowProcessIdOptions: Record<number, string[]>;
  FlowLayerIdOptions: Record<number, string[]>;
  BbProductOptions: Record<number, string[]>;
  BbProductidOptions: Record<number, string[]>;
  refDocLabel: string;
  setRefDocLabel: React.Dispatch<React.SetStateAction<string>>;
  refDocId: number | null;
  setRefDocId: React.Dispatch<React.SetStateAction<number | null>>;
  approvedDocs: RequestDocument[];
  productionDate: string;
  setProductionDate: React.Dispatch<React.SetStateAction<string>>;
  handleDetailChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  handleDetailSet: (name: string, value: string) => void;
  handleRequestPurposeSelect: (val: string) => void;
  handleRefDocSelect: (label: string) => void;
  handleMergeClick: () => void;
  handleFlowChange: (id: string, field: keyof Omit<FlowChartRow, 'id'>, value: string) => void;
  handleFlowDeleteRow: (id: string) => void;
  handleFlowAddRow: () => void;
  handleBbEntryChange: (idx: number, field: 'location' | 'product' | 'process_id', value: string) => void;
  handleBbEntryDelete: (idx: number) => void;
  handleBbEntryAdd: () => void;
  GuideBadge: React.FC<{ fk: GuideFeatureKey; tk: string }>;
}

const Step1: React.FC<Step1Props> = ({
  detail,
  errors,
  isOnlyMap,
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
  handleRequestPurposeSelect,
  handleRefDocSelect,
  handleMergeClick,
  handleFlowChange,
  handleFlowDeleteRow,
  handleFlowAddRow,
  handleBbEntryChange,
  handleBbEntryDelete,
  handleBbEntryAdd,
  GuideBadge,
}) => {
  const { t } = useTranslation();
  const canSelectPurpose =
    detail.line !== '' &&
    detail.process_selection !== '' &&
    detail.partid_selection !== '' &&
    detail.process_id !== '';
  // Only MAP 모드: 기타목적·흐름도·특이사항·Backbone·참조요청서는 초기화 후 작성 불가
  const disableOptional = !canSelectPurpose || isOnlyMap;

  return (
    <div className="form-section">
      <div className="form-section-title">📋 {t('request.section_detail')}</div>
      <div className="form-grid" data-tour="detail-fields">

        {/* 1. 라인 / 조합법 / 제품 이름 / 조리법 */}
        <div className="full-width" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('request.line')} / {t('request.process_selection')}</span>
          <GuideBadge fk="step1_line_process" tk={t('guide.feat.step1_line_process' as never)} />
        </div>
        <div className="full-width flex-row">
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
            required
            error={errors.partid_selection}
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
                {OPTION_OTHER_PURPOSE.map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`map-type-btn${detail.other_purpose === val ? ' active' : ''}`}
                    onClick={() => { if (!disableOptional) handleDetailSet('other_purpose', detail.other_purpose === val ? '' : val); }}
                    disabled={disableOptional}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </div>

            {/* Layer 추가/삭제: 참조 요청서 선택 */}
            {detail.other_purpose === 'Layer 추가/삭제' && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <AutocompleteInput
                    label="참조 요청서"
                    value={refDocLabel}
                    options={approvedDocs.map((d) => d.title)}
                    onChange={(v) => {
                      setRefDocLabel(v);
                      if (refDocId !== null) setRefDocId(null);
                    }}
                    onSelect={handleRefDocSelect}
                    placeholder="이력에서 요청서를 선택하세요"
                    disabled={disableOptional}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={disableOptional || refDocId === null}
                  style={disableOptional || refDocId === null ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                  onClick={handleMergeClick}
                >
                  Merge
                </button>
              </div>
            )}

            {/* 흐름도 */}
            <div className="form-group">
              <label className="form-label">{t('request.flow_chart')}<GuideBadge fk="step1_flow_chart" tk={t('guide.feat.step1_flow_chart' as never)} /></label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {detail.flow_chart.map((row, idx) => (
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
                        options={FlowProductOptions[idx] || []}
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
                        options={FlowProcessIdOptions[idx] || []}
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
                          options={FlowLayerIdOptions[idx] || []}
                          placeholder={t('request.select_placeholder')}
                          style={{ minWidth: '80px' }}
                          disabled={disableOptional}
                        />
                        <span style={{ whiteSpace: 'nowrap' }}>~</span>
                        <AutocompleteInput
                          value={row.step_to}
                          onChange={(v) => handleFlowChange(row.id, 'step_to', v)}
                          options={FlowLayerIdOptions[idx] || []}
                          placeholder={t('request.select_placeholder')}
                          style={{ minWidth: '80px' }}
                          disabled={disableOptional}
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
              <textarea
                className="form-control"
                name="change_purpose_note"
                value={detail.change_purpose_note}
                onChange={handleDetailChange}
                rows={3}
                disabled={disableOptional}
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
              <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
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
                    options={BbProductOptions[idx] || []}
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
                    options={BbProductidOptions[idx] || []}
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
