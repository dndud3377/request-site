import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import { useToast } from '../components/Toast';
import { ConfirmModal } from '../components/Modal';
import FormSelect from '../components/FormSelect';
import { CreateDocumentInput, DetailFormState, FlowChartRow } from '../types';

// ===== Option Constants =====
const OPTION_REQUEST_PURPOSE = ['신규', '복사', '변경'] as const;
const OPTION_LINE = ['A라인', 'B라인', 'C라인'] as const;
const OPTION_COMBINATION = ['조합법A', '조합법B', '조합법C'] as const;
const OPTION_PRODUCT = ['제품A', '제품B', '제품C'] as const;
const OPTION_COOKING = ['조리법1', '조리법2', '조리법3'] as const;
const OPTION_OTHER_PURPOSE = ['목적A', '목적B', '목적C'] as const;
const OPTION_SOURCE_LOCATION = ['위치A', '위치B', '위치C'] as const;
const OPTION_SOURCE_PRODUCT = ['원본제품A', '원본제품B', '원본제품C'] as const;
const OPTION_BONE_STEW_LOCATION = ['위치1', '위치2', '위치3'] as const;
const OPTION_BONE_STEW_PRODUCT = ['뼈찜제품A', '뼈찜제품B'] as const;
const OPTION_BONE_STEW_COOKING = ['뼈찜조리법1', '뼈찜조리법2'] as const;

// ===== CFamilyRow — 북쪽/중간/남쪽 공통 행 =====
type CRegion = 'north' | 'middle' | 'south';
interface CFamilyRowProps {
  region: CRegion;
  detail: DetailFormState;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}
const CFamilyRow: React.FC<CFamilyRowProps> = ({ region, detail, onChange }) => {
  const { t } = useTranslation();
  const showSelects = region !== 'middle' || detail.c_family_middle_use === '사용';
  return (
    <div className="flex-row">
      <span style={{ width: '40px', paddingTop: '32px', fontWeight: 600 }}>
        {t(`request.c_family_${region}`)}
      </span>
      {region === 'middle' && (
        <FormSelect
          label={t('request.c_family_middle_use')}
          name="c_family_middle_use"
          value={detail.c_family_middle_use}
          options={['사용', '미사용']}
          onChange={onChange}
          placeholder={t('request.select_placeholder')}
          className="flex-col"
        />
      )}
      {showSelects && (
        <>
          <FormSelect
            label={t('request.c_family_line')}
            name={`c_family_${region}_line`}
            value={detail[`c_family_${region}_line` as keyof DetailFormState] as string}
            options={OPTION_LINE}
            onChange={onChange}
            placeholder={t('request.select_placeholder')}
            className="flex-col"
          />
          <FormSelect
            label={t('request.c_family_combination')}
            name={`c_family_${region}_combination`}
            value={detail[`c_family_${region}_combination` as keyof DetailFormState] as string}
            options={OPTION_COMBINATION}
            onChange={onChange}
            placeholder={t('request.select_placeholder')}
            className="flex-col"
          />
          <FormSelect
            label={t('request.c_family_product')}
            name={`c_family_${region}_product`}
            value={detail[`c_family_${region}_product` as keyof DetailFormState] as string}
            options={OPTION_PRODUCT}
            onChange={onChange}
            placeholder={t('request.select_placeholder')}
            className="flex-col"
          />
        </>
      )}
    </div>
  );
};

// ===== Helpers =====
const makeRow = (): FlowChartRow => ({
  id: String(Date.now() + Math.random()),
  location: '',
  product_name: '',
  step: '',
});

const INITIAL_DETAIL: DetailFormState = {
  request_purpose: '',
  line: '',
  combination_method: '',
  product_name_select: '',
  other_purpose: '',
  source_location: '',
  source_product_name: '',
  change_purpose_note: '',
  flow_chart: [makeRow()],
  cooking_method: '',
  map_deviation_change: '변경 없음',
  map_deviation_value: '',
  map_deviation_reason: '',
  exception_zone_change: '변경 없음',
  exception_zone_value: '',
  separation_progress: '아니오',
  bone_stew_zone: '없음',
  bone_stew_location: '',
  bone_stew_product: '',
  bone_stew_cooking: '',
  only_c_family: 'No',
  c_family_north_line: '',
  c_family_north_combination: '',
  c_family_north_product: '',
  c_family_middle_use: '',
  c_family_middle_line: '',
  c_family_middle_combination: '',
  c_family_middle_product: '',
  c_family_south_line: '',
  c_family_south_combination: '',
  c_family_south_product: '',
  x_mark_change: '없음',
  x_mark_image_copy: '',
  anniversary_20: 'No',
  anniversary_20_option: '',
  t_family_apply: '미적용',
  main_product_change: '변경 없음',
  sugar_add: '아니오',
};

// Minimal CreateDocumentInput shell — real data serialized into additional_notes
const INITIAL_FORM: CreateDocumentInput = {
  title: '',
  requester_name: '',
  requester_email: '',
  requester_department: '',
  requester_position: '',
  product_name: '',
  product_name_en: '',
  product_type: 'new',
  product_version: '',
  product_description: '',
  product_description_en: '',
  map_type: 'intro',
  target_audience: '',
  key_features: '',
  key_features_en: '',
  changes_from_previous: '',
  reference_materials: '',
  deadline: '',
  priority: 'medium',
  additional_notes: '',
};

const DETAIL_REQUIRED: (keyof DetailFormState)[] = [
  'request_purpose',
  'line',
  'combination_method',
  'product_name_select',
];

export default function RequestPage(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToast();

  const [form] = useState<CreateDocumentInput>(INITIAL_FORM);
  const [detail, setDetail] = useState<DetailFormState>(INITIAL_DETAIL);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);

  // Derived booleans for conditional rendering
  const isCopy = detail.request_purpose === '복사';
  const hasMapDeviation = detail.map_deviation_change === '변경 있음';
  const hasExceptionZone = detail.exception_zone_change === '변경 있음';
  const hasBoneStew = detail.bone_stew_zone === '존재';
  const isCFamily = detail.only_c_family === 'Yes';
  const xMarkDeleteMode = detail.x_mark_change === '삭제';
  const xMarkEditAddMode = detail.x_mark_change === '추가' || detail.x_mark_change === '수정';
  const isAnniversary = detail.anniversary_20 === 'Yes';

  const handleDetailChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setDetail((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleRadioChange = (name: keyof DetailFormState, value: string) => {
    setDetail((prev) => ({ ...prev, [name]: value }));
  };

  // Flow chart row handlers
  const handleFlowChange = (id: string, field: keyof Omit<FlowChartRow, 'id'>, value: string) => {
    setDetail((prev) => ({
      ...prev,
      flow_chart: prev.flow_chart.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    }));
  };

  const handleFlowAddRow = () => {
    setDetail((prev) => ({ ...prev, flow_chart: [...prev.flow_chart, makeRow()] }));
  };

  const handleFlowDeleteRow = (id: string) => {
    setDetail((prev) => {
      if (prev.flow_chart.length <= 1) return prev;
      return { ...prev, flow_chart: prev.flow_chart.filter((r) => r.id !== id) };
    });
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<string, string>> = {};
    DETAIL_REQUIRED.forEach((field) => {
      const val = detail[field] as string;
      if (!val?.trim()) {
        newErrors[field] = t('request.required');
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const buildEnrichedForm = (): CreateDocumentInput => ({
    ...form,
    title: `[${detail.request_purpose}] ${detail.line} - ${detail.product_name_select}`,
    product_name: detail.product_name_select,
    additional_notes: JSON.stringify(detail),
  });

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const enriched = buildEnrichedForm();
      if (savedId) {
        await documentsAPI.update(savedId, enriched);
      } else {
        const res = await documentsAPI.create(enriched);
        setSavedId(res.data.id);
      }
      addToast(t('request.save_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitClick = () => {
    if (!validate()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const enriched = buildEnrichedForm();
      let docId = savedId;
      if (!docId) {
        const res = await documentsAPI.create(enriched);
        docId = res.data.id;
        setSavedId(docId);
      } else {
        await documentsAPI.update(docId, enriched);
      }
      const submitRes = await documentsAPI.submit(docId);
      addToast(t('request.submit_success'), 'success');
      if (submitRes.data.email_sent) {
        setTimeout(() => addToast(t('request.submit_email_sent'), 'info'), 800);
      }
      setTimeout(() => navigate('/approval'), 1500);
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('request.title')}</h1>
        <p>{t('request.subtitle')}</p>
      </div>

      {/* 의뢰 상세 */}
      <div className="form-section">
        <div className="form-section-title">📋 {t('request.section_detail')}</div>

        <div className="form-grid">

          {/* 1. 요청 목적 */}
          <div className="form-group full-width">
            <label className="form-label">
              {t('request.request_purpose')} <span className="required">*</span>
            </label>
            <select
              className={`form-control ${errors.request_purpose ? 'error' : ''}`}
              name="request_purpose"
              value={detail.request_purpose}
              onChange={handleDetailChange}
            >
              <option value="">{t('request.select_placeholder')}</option>
              {OPTION_REQUEST_PURPOSE.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            {errors.request_purpose && <span className="form-error">{errors.request_purpose}</span>}
          </div>

          {/* 복사 선택 시 sub-fields */}
          {isCopy && (
            <div className="form-group full-width">
              <div className="conditional-group">

                {/* 기타 목적 | 원본 위치 | 원본 제품 이름 — 한 행 */}
                <div className="flex-row">
                  <FormSelect
                    label={t('request.other_purpose')}
                    name="other_purpose"
                    value={detail.other_purpose}
                    options={OPTION_OTHER_PURPOSE}
                    onChange={handleDetailChange}
                    placeholder={t('request.select_placeholder')}
                    className="flex-col"
                  />
                  <FormSelect
                    label={t('request.source_location')}
                    name="source_location"
                    value={detail.source_location}
                    options={OPTION_SOURCE_LOCATION}
                    onChange={handleDetailChange}
                    placeholder={t('request.select_placeholder')}
                    className="flex-col"
                  />
                  <FormSelect
                    label={t('request.source_product_name')}
                    name="source_product_name"
                    value={detail.source_product_name}
                    options={OPTION_SOURCE_PRODUCT}
                    onChange={handleDetailChange}
                    placeholder={t('request.select_placeholder')}
                    className="flex-col"
                  />
                </div>

                {/* 흐름도 */}
                <div className="form-group">
                  <label className="form-label">{t('request.flow_chart')}</label>
                  <div className="flow-table flow-table-wrapper">
                    <div className="flow-table-header flow-table-row">
                      <div className="flow-table-cell header-cell">{t('request.flow_location')}</div>
                      <div className="flow-table-cell header-cell">{t('request.flow_product_name')}</div>
                      <div className="flow-table-cell header-cell">{t('request.flow_step')}</div>
                      <div className="flow-table-cell header-cell"></div>
                    </div>
                    {detail.flow_chart.map((row) => (
                      <div key={row.id} className="flow-table-row">
                        <div className="flow-table-cell">
                          <select
                            value={row.location}
                            onChange={(e) => handleFlowChange(row.id, 'location', e.target.value)}
                          >
                            <option value="">위치 선택</option>
                            <option value="위치A">위치A</option>
                            <option value="위치B">위치B</option>
                            <option value="위치C">위치C</option>
                          </select>
                        </div>
                        <div className="flow-table-cell">
                          <input
                            value={row.product_name}
                            onChange={(e) => handleFlowChange(row.id, 'product_name', e.target.value)}
                            placeholder="제품 이름"
                          />
                        </div>
                        <div className="flow-table-cell">
                          <input
                            value={row.step}
                            onChange={(e) => handleFlowChange(row.id, 'step', e.target.value)}
                            placeholder="Step"
                          />
                        </div>
                        <div className="flow-table-cell">
                          <button
                            type="button"
                            className="flow-delete-btn"
                            onClick={() => handleFlowDeleteRow(row.id)}
                            disabled={detail.flow_chart.length <= 1}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="flow-table-add-btn" onClick={handleFlowAddRow}>
                    {t('request.flow_add_row')}
                  </button>
                </div>

                {/* 특이사항·변경 요청 목적 */}
                <div className="form-group">
                  <label className="form-label">{t('request.change_purpose_note')}</label>
                  <textarea
                    className="form-control"
                    name="change_purpose_note"
                    value={detail.change_purpose_note}
                    onChange={handleDetailChange}
                    rows={3}
                  />
                </div>

              </div>
            </div>
          )}

          {/* 2-4. 라인 / 조합법 선택 / 제품 이름 선택 / 조리법 — 한 줄 */}
          <div className="full-width flex-row">
            <FormSelect
              label={t('request.line')}
              name="line"
              value={detail.line}
              options={OPTION_LINE}
              onChange={handleDetailChange}
              placeholder={t('request.select_placeholder')}
              required
              error={errors.line}
              className="flex-col"
            />
            <FormSelect
              label={t('request.combination_method')}
              name="combination_method"
              value={detail.combination_method}
              options={OPTION_COMBINATION}
              onChange={handleDetailChange}
              placeholder={t('request.select_placeholder')}
              required
              error={errors.combination_method}
              className="flex-col"
            />
            <FormSelect
              label={t('request.product_name_select')}
              name="product_name_select"
              value={detail.product_name_select}
              options={OPTION_PRODUCT}
              onChange={handleDetailChange}
              placeholder={t('request.select_placeholder')}
              required
              error={errors.product_name_select}
              className="flex-col"
            />
            <FormSelect
              label={t('request.cooking_method')}
              name="cooking_method"
              value={detail.cooking_method}
              options={OPTION_COOKING}
              onChange={handleDetailChange}
              placeholder={t('request.select_placeholder')}
              className="flex-col"
            />
          </div>

          {/* 5-6. 지도 편차 변경 / 예외 구역 변경 — 고정 비율 (25:10:30:25:10) */}
          <div className="full-width flex-row">
            {/* 지도 편차 변경 — 25% */}
            <div className="form-group" style={{ flex: 25 }}>
              <label className="form-label">{t('request.map_deviation_change')}</label>
              <select className="form-control" name="map_deviation_change" value={detail.map_deviation_change} onChange={handleDetailChange}>
                <option value="변경 없음">{t('request.map_deviation_no_change')}</option>
                <option value="변경 있음">{t('request.map_deviation_has_change')}</option>
              </select>
            </div>
            {/* 지도 편차 값 — 10% (공간 항상 확보) */}
            <div className="form-group" style={{ flex: 10, visibility: hasMapDeviation ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_deviation_value')}</label>
              <input className="form-control" name="map_deviation_value" value={detail.map_deviation_value} onChange={handleDetailChange} />
            </div>
            {/* 변경 사유 — 30% (공간 항상 확보) */}
            <div className="form-group" style={{ flex: 30, visibility: hasMapDeviation ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.map_deviation_reason')}</label>
              <input className="form-control" name="map_deviation_reason" value={detail.map_deviation_reason} onChange={handleDetailChange} />
            </div>
            {/* 예외 구역 변경 — 25% */}
            <div className="form-group" style={{ flex: 25 }}>
              <label className="form-label">{t('request.exception_zone_change')}</label>
              <select className="form-control" name="exception_zone_change" value={detail.exception_zone_change} onChange={handleDetailChange}>
                <option value="변경 없음">{t('request.no_change')}</option>
                <option value="변경 있음">{t('request.has_change')}</option>
              </select>
            </div>
            {/* 예외 구역 값 — 10% (공간 항상 확보) */}
            <div className="form-group" style={{ flex: 10, visibility: hasExceptionZone ? 'visible' : 'hidden' }}>
              <label className="form-label">{t('request.exception_zone_value')}</label>
              <input className="form-control" name="exception_zone_value" value={detail.exception_zone_value} onChange={handleDetailChange} />
            </div>
          </div>

          {/* 8. 뼈찜 조합 영역 */}
          <div className="full-width flex-row">
            <div className="form-group flex-col">
              <label className="form-label">{t('request.bone_stew_zone')}</label>
              <select className="form-control" name="bone_stew_zone" value={detail.bone_stew_zone} onChange={handleDetailChange}>
                <option value="없음">{t('request.bone_stew_zone_none')}</option>
                <option value="존재">{t('request.bone_stew_zone_exists')}</option>
              </select>
            </div>
            {hasBoneStew && (
              <>
                <FormSelect
                  label={t('request.bone_stew_location')}
                  name="bone_stew_location"
                  value={detail.bone_stew_location}
                  options={OPTION_BONE_STEW_LOCATION}
                  onChange={handleDetailChange}
                  placeholder={t('request.select_placeholder')}
                  className="flex-col"
                />
                <FormSelect
                  label={t('request.bone_stew_product')}
                  name="bone_stew_product"
                  value={detail.bone_stew_product}
                  options={OPTION_BONE_STEW_PRODUCT}
                  onChange={handleDetailChange}
                  placeholder={t('request.select_placeholder')}
                  className="flex-col"
                />
                <FormSelect
                  label={t('request.bone_stew_cooking')}
                  name="bone_stew_cooking"
                  value={detail.bone_stew_cooking}
                  options={OPTION_BONE_STEW_COOKING}
                  onChange={handleDetailChange}
                  placeholder={t('request.select_placeholder')}
                  className="flex-col"
                />
              </>
            )}
          </div>

          {/* 9. Only C가문 제품 */}
          <div className="form-group full-width">
            <label className="form-label">{t('request.only_c_family')}</label>
            <select className="form-control" name="only_c_family" value={detail.only_c_family} onChange={handleDetailChange}>
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </div>

          {isCFamily && (
            <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <CFamilyRow region="north"  detail={detail} onChange={handleDetailChange} />
              <CFamilyRow region="middle" detail={detail} onChange={handleDetailChange} />
              <CFamilyRow region="south"  detail={detail} onChange={handleDetailChange} />
            </div>
          )}

          {/* 10. X표시 변경 여부 */}
          <div className="form-group full-width">
            <label className="form-label">{t('request.x_mark_change')}</label>
            <select className="form-control" name="x_mark_change" value={detail.x_mark_change} onChange={handleDetailChange}>
              <option value="없음">{t('request.x_mark_none')}</option>
              <option value="추가">{t('request.x_mark_add')}</option>
              <option value="수정">{t('request.x_mark_edit')}</option>
              <option value="삭제">{t('request.x_mark_delete')}</option>
            </select>
          </div>

          {xMarkDeleteMode && (
            <div className="full-width">
              <p style={{ color: 'red', fontWeight: 600, margin: '4px 0' }}>특정 제품 삭제 필요</p>
            </div>
          )}

          {xMarkEditAddMode && (
            <div className="full-width">
              <div className="form-group" style={{ width: '50%' }}>
                <label className="form-label">{t('request.x_mark_image_copy')}</label>
                <textarea
                  className="form-control"
                  name="x_mark_image_copy"
                  value={detail.x_mark_image_copy}
                  onChange={handleDetailChange}
                  style={{ aspectRatio: '1 / 1', resize: 'none' }}
                />
              </div>
            </div>
          )}

          {/* 11. 20주년 제품 + 분리 진행 여부 */}
          <div className="full-width flex-row">
            <div className="form-group" style={{ flex: '0 0 auto', minWidth: '160px' }}>
              <label className="form-label">{t('request.anniversary_20')}</label>
              <select className="form-control" name="anniversary_20" value={detail.anniversary_20} onChange={handleDetailChange}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>
            {isAnniversary && (
              <div className="form-group" style={{ flex: '0 0 auto' }}>
                <label className="form-label">{t('request.anniversary_20_option')}</label>
                <div className="radio-group">
                  {(['옵션A', '옵션B', '옵션C'] as const).map((opt) => (
                    <label key={opt} className="radio-item">
                      <input
                        type="radio"
                        name="anniversary_20_option"
                        value={opt}
                        checked={detail.anniversary_20_option === opt}
                        onChange={() => handleRadioChange('anniversary_20_option', opt)}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {/* 7. 분리 진행 여부 — 20주년 행 우측, 라디오 옵션과 32px 간격 */}
            <div className="form-group" style={{ flex: '0 0 auto', minWidth: '160px', marginLeft: '32px' }}>
              <label className="form-label">{t('request.separation_progress')}</label>
              <select className="form-control" name="separation_progress" value={detail.separation_progress} onChange={handleDetailChange}>
                <option value="아니오">{t('request.no')}</option>
                <option value="예">{t('request.yes')}</option>
              </select>
            </div>
          </div>

          {/* 12-14. T가문 적용 / 주력 제품 변경 / 설탕 추가 진행 여부 */}
          <div className="full-width flex-row">
            <div className="form-group flex-col">
              <label className="form-label">{t('request.t_family_apply')}</label>
              <select className="form-control" name="t_family_apply" value={detail.t_family_apply} onChange={handleDetailChange}>
                <option value="미적용">{t('request.t_family_not_applied')}</option>
                <option value="적용">{t('request.t_family_applied')}</option>
              </select>
            </div>
            <div className="form-group flex-col">
              <label className="form-label">{t('request.main_product_change')}</label>
              <select className="form-control" name="main_product_change" value={detail.main_product_change} onChange={handleDetailChange}>
                <option value="변경 없음">{t('request.no_change')}</option>
                <option value="변경 있음">{t('request.has_change')}</option>
              </select>
            </div>
            <div className="form-group flex-col">
              <label className="form-label">{t('request.sugar_add')}</label>
              <select className="form-control" name="sugar_add" value={detail.sugar_add} onChange={handleDetailChange}>
                <option value="아니오">{t('request.no')}</option>
                <option value="예">{t('request.yes')}</option>
              </select>
            </div>
          </div>

        </div>
      </div>

      <div className="form-actions">
        <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving}>
          💾 {saving ? t('common.loading') : t('request.save_draft')}
        </button>
        <button className="btn btn-primary" onClick={handleSubmitClick} disabled={submitting}>
          📤 {submitting ? t('common.loading') : t('request.submit')}
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleSubmit}
        title={t('request.submit')}
        message={t('request.submit_confirm')}
        confirmLabel={t('request.submit')}
      />
    </div>
  );
}
