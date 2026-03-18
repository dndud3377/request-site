import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import FormSelect from '../components/FormSelect';
import { useAuth } from '../contexts/AuthContext';
import {
  CreateDocumentInput,
  DetailFormState,
  FlowChartRow,
  JayerRow,
  OayerRow,
  BoneStewTableRow,
} from '../types';

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

// Step 2, 3 전용 제품 이름 옵션 (별도 관리 — 필요에 따라 변경)
const OPTION_JAYER_PRODUCT = ['제품A', '제품B', '제품C'] as const;
const OPTION_OAYER_PRODUCT = ['제품A', '제품B', '제품C'] as const;

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

// ===== Row Factories =====
const makeRow = (): FlowChartRow => ({
  id: String(Date.now() + Math.random()),
  location: '',
  product_name: '',
  step: '',
});

const makeJayerRow = (): JayerRow => ({
  id: String(Date.now() + Math.random()),
  cooking_method: '',
  sp: '',
  sd: '',
  pp: '',
  st: '',
  new_or_copy: '',
  product_name: '',
  step: '',
  item_id: '',
  rev: '',
  drawing_version: '',
});

const makeOayerRow = (): OayerRow => ({
  id: String(Date.now() + Math.random()),
  cooking_method: '',
  sp: '',
  sd: '',
  pp: '',
  st: '',
  new_or_copy: '',
  product_name: '',
  step: '',
  tt: '',
});

const makeBoneStewRow = (): BoneStewTableRow => ({
  id: String(Date.now() + Math.random()),
  cooking_method: '',
  ss: '',
  sd: '',
  bone_cooking: '',
  bone_name: '',
  bone_step: '',
  bone_ss: '',
  remark: '',
});

// ===== Initial States =====
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
  map_deviation_value_x: '',
  map_deviation_value_y: '',
  map_deviation_reason: '',
  exception_zone_change: '변경 없음',
  exception_zone_value: '',
  separation_progress: '아니오',
  bone_stew_zone: '없음',
  bone_stew_entries: [{ location: '', product: '', cooking: '' }],
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

// ===== Wizard Step Indicator =====
interface WizardIndicatorProps {
  currentStep: number;
  steps: string[];
}

const WizardIndicator: React.FC<WizardIndicatorProps> = ({ currentStep, steps }) => (
  <div className="wizard-indicator">
    {steps.map((label, idx) => {
      const stepNum = idx + 1;
      const isDone = currentStep > stepNum;
      const isActive = currentStep === stepNum;
      return (
        <React.Fragment key={stepNum}>
          <div className="wizard-step">
            <div className={`wizard-step-circle${isDone ? ' done' : isActive ? ' active' : ''}`}>
              {isDone ? '✓' : stepNum}
            </div>
            <span className={`wizard-step-label${isDone ? ' done' : isActive ? ' active' : ''}`}>
              {label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div className={`wizard-connector${isDone ? ' done' : ''}`} />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

// ===== Main Component =====
export default function RequestPage(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const addToast = useToast();
  const { currentUser } = useAuth();

  // 반려 후 재상신 모드: location.state.editDocId 가 있을 때
  const editDocId: number | null = (location.state as any)?.editDocId ?? null;
  const isEditMode = !!editDocId;

  const [step, setStep] = useState(1);
  const [form] = useState<CreateDocumentInput>(INITIAL_FORM);
  const [detail, setDetail] = useState<DetailFormState>(INITIAL_DETAIL);
  const [jayerRows, setJayerRows] = useState<JayerRow[]>([makeJayerRow()]);
  const [oayerRows, setOayerRows] = useState<OayerRow[]>([makeOayerRow()]);
  const [boneStewRows, setBoneStewRows] = useState<BoneStewTableRow[]>([makeBoneStewRow()]);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [savedId, setSavedId] = useState<number | null>(editDocId);

  // 편집 모드: 기존 문서 데이터 로드
  useEffect(() => {
    if (!editDocId) return;
    documentsAPI.get(editDocId).then((res) => {
      const doc = res.data;
      try {
        const parsed = JSON.parse(doc.additional_notes ?? '{}');
        if (parsed.detail) setDetail(parsed.detail);
        if (parsed.jayerRows) setJayerRows(parsed.jayerRows);
        if (parsed.oayerRows) setOayerRows(parsed.oayerRows);
        if (parsed.boneStewRows) setBoneStewRows(parsed.boneStewRows);
      } catch { /* noop */ }
    }).catch(() => {});
  }, [editDocId]);

  // Derived booleans for Step 1 conditional rendering
  const isCopy = detail.request_purpose === '복사';
  const hasMapDeviation = detail.map_deviation_change === '변경 있음';
  const hasExceptionZone = detail.exception_zone_change === '변경 있음';
  const hasBoneStew = detail.bone_stew_zone === '존재';
  const isCFamily = detail.only_c_family === 'Yes';
  const xMarkDeleteMode = detail.x_mark_change === '삭제';
  const xMarkEditAddMode = detail.x_mark_change === '추가' || detail.x_mark_change === '수정';
  const isAnniversary = detail.anniversary_20 === 'Yes';

  // ===== Step 1 Handlers =====
  const handleDetailChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setDetail((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const handleRadioChange = (name: keyof DetailFormState, value: string) => {
    setDetail((prev) => ({ ...prev, [name]: value }));
  };

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

  // ===== Jayer Handlers =====
  const handleJayerChange = (id: string, field: keyof Omit<JayerRow, 'id'>, value: string) => {
    setJayerRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleJayerSetAll = (field: 'st' | 'new_or_copy', value: string) => {
    setJayerRows((rows) => rows.map((r) => ({ ...r, [field]: value })));
  };

  const handleJayerResetField = (field: 'st' | 'new_or_copy') => {
    setJayerRows((rows) => rows.map((r) => ({ ...r, [field]: '' })));
  };

  const handleJayerAddRow = () => setJayerRows((rows) => [...rows, makeJayerRow()]);

  const handleJayerDeleteRow = (id: string) => {
    setJayerRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== id)));
  };

  // ===== Oayer Handlers =====
  const handleOayerChange = (id: string, field: keyof Omit<OayerRow, 'id'>, value: string) => {
    setOayerRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleOayerSetAll = (field: 'st' | 'new_or_copy', value: string) => {
    setOayerRows((rows) => rows.map((r) => ({ ...r, [field]: value })));
  };

  const handleOayerResetField = (field: 'st' | 'new_or_copy') => {
    setOayerRows((rows) => rows.map((r) => ({ ...r, [field]: '' })));
  };

  const handleOayerAddRow = () => setOayerRows((rows) => [...rows, makeOayerRow()]);

  const handleOayerDeleteRow = (id: string) => {
    setOayerRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== id)));
  };

  // ===== BoneStew Entry Handlers (Step 1 - 뼈찜 조합 영역 다중 행) =====
  const handleBoneStewEntryChange = (idx: number, field: 'location' | 'product' | 'cooking', value: string) => {
    setDetail((prev) => ({
      ...prev,
      bone_stew_entries: prev.bone_stew_entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)),
    }));
  };

  const handleBoneStewEntryAdd = () => {
    setDetail((prev) => ({
      ...prev,
      bone_stew_entries: [...prev.bone_stew_entries, { location: '', product: '', cooking: '' }],
    }));
  };

  const handleBoneStewEntryDelete = (idx: number) => {
    setDetail((prev) => {
      if (prev.bone_stew_entries.length <= 1) return prev;
      return { ...prev, bone_stew_entries: prev.bone_stew_entries.filter((_, i) => i !== idx) };
    });
  };

  // ===== BoneStew Handlers =====
  const handleBoneStewChange = (
    id: string,
    field: keyof Omit<BoneStewTableRow, 'id'>,
    value: string
  ) => {
    setBoneStewRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleBoneStewAddRow = () => setBoneStewRows((rows) => [...rows, makeBoneStewRow()]);

  const handleBoneStewDeleteRow = (id: string) => {
    setBoneStewRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== id)));
  };

  // ===== Validation =====
  const validate = (): boolean => {
    const newErrors: Partial<Record<string, string>> = {};
    DETAIL_REQUIRED.forEach((field) => {
      const val = detail[field] as string;
      if (!val?.trim()) newErrors[field] = t('request.required');
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ===== API =====
  const buildEnrichedForm = (note?: string): CreateDocumentInput => {
    const title = `${detail.line}(${detail.request_purpose})_${detail.combination_method}_${detail.product_name_select}_${detail.cooking_method}_요청서`;
    return {
      ...form,
      title,
      product_name: detail.product_name_select,
      requester_name: currentUser.name,
      requester_email: currentUser.email,
      requester_department: currentUser.department,
      reference_materials: note ?? '',
      additional_notes: JSON.stringify({ detail, jayerRows, oayerRows, boneStewRows }),
    };
  };

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

  const handleNextStep = () => {
    if (step === 1 && !validate()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrevStep = () => {
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      const enriched = buildEnrichedForm(submitNote);
      let docId = savedId;
      if (!docId) {
        const res = await documentsAPI.create(enriched);
        docId = res.data.id;
        setSavedId(docId);
      } else {
        await documentsAPI.update(docId, enriched);
      }

      if (isEditMode && docId) {
        // 반려 후 재상신: resubmit 호출
        await documentsAPI.resubmit(docId);
        addToast('재상신되었습니다.', 'success');
      } else {
        const submitRes = await documentsAPI.submit(docId!);
        addToast(t('request.submit_success'), 'success');
        if (submitRes.data.email_sent) {
          setTimeout(() => addToast(t('request.submit_email_sent'), 'info'), 800);
        }
      }
      setTimeout(() => navigate('/approval'), 1500);
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ===== Step Render Functions =====
  const renderStep1 = () => (
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

        {/* 2-4. 라인 / 조합법 / 제품 이름 / 조리법 */}
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

        {/* 5. 지도 편차 */}
        <div className="full-width flex-row">
          <div className="form-group" style={{ flex: 25 }}>
            <label className="form-label">{t('request.map_deviation_change')}</label>
            <select className="form-control" name="map_deviation_change" value={detail.map_deviation_change} onChange={handleDetailChange}>
              <option value="변경 없음">{t('request.map_deviation_no_change')}</option>
              <option value="변경 있음">{t('request.map_deviation_has_change')}</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 10, visibility: hasMapDeviation ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.map_deviation_value_x')}</label>
            <input className="form-control" name="map_deviation_value_x" value={detail.map_deviation_value_x} onChange={handleDetailChange} />
          </div>
          <div className="form-group" style={{ flex: 10, visibility: hasMapDeviation ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.map_deviation_value_y')}</label>
            <input className="form-control" name="map_deviation_value_y" value={detail.map_deviation_value_y} onChange={handleDetailChange} />
          </div>
          <div className="form-group" style={{ flex: 30, visibility: hasMapDeviation ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.map_deviation_reason')}</label>
            <input className="form-control" name="map_deviation_reason" value={detail.map_deviation_reason} onChange={handleDetailChange} />
          </div>
        </div>

        {/* 6. 예외 구역 */}
        <div className="full-width flex-row">
          <div className="form-group" style={{ flex: 25 }}>
            <label className="form-label">{t('request.exception_zone_change')}</label>
            <select className="form-control" name="exception_zone_change" value={detail.exception_zone_change} onChange={handleDetailChange}>
              <option value="변경 없음">{t('request.no_change')}</option>
              <option value="변경 있음">{t('request.has_change')}</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 10, visibility: hasExceptionZone ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.exception_zone_value')}</label>
            <input className="form-control" name="exception_zone_value" value={detail.exception_zone_value} onChange={handleDetailChange} />
          </div>
        </div>

        {/* 8. 뼈찜 조합 영역 */}
        <div className="full-width flex-row" style={{ alignItems: 'flex-start' }}>
          <div className="form-group" style={{ flex: '0 0 auto', minWidth: '120px' }}>
            <label className="form-label">{t('request.bone_stew_zone')}</label>
            <select className="form-control" name="bone_stew_zone" value={detail.bone_stew_zone} onChange={handleDetailChange}>
              <option value="없음">{t('request.bone_stew_zone_none')}</option>
              <option value="존재">{t('request.bone_stew_zone_exists')}</option>
            </select>
          </div>
          {hasBoneStew && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {detail.bone_stew_entries.map((entry, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                    <label className="form-label">{t('request.bone_stew_location')}</label>
                    <select
                      className="form-control"
                      value={entry.location}
                      onChange={(e) => handleBoneStewEntryChange(idx, 'location', e.target.value)}
                    >
                      <option value="">{t('request.select_placeholder')}</option>
                      {OPTION_BONE_STEW_LOCATION.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                    <label className="form-label">{t('request.bone_stew_product')}</label>
                    <select
                      className="form-control"
                      value={entry.product}
                      onChange={(e) => handleBoneStewEntryChange(idx, 'product', e.target.value)}
                    >
                      <option value="">{t('request.select_placeholder')}</option>
                      {OPTION_BONE_STEW_PRODUCT.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                    <label className="form-label">{t('request.bone_stew_cooking')}</label>
                    <select
                      className="form-control"
                      value={entry.cooking}
                      onChange={(e) => handleBoneStewEntryChange(idx, 'cooking', e.target.value)}
                    >
                      <option value="">{t('request.select_placeholder')}</option>
                      {OPTION_BONE_STEW_COOKING.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  {detail.bone_stew_entries.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: '6px 10px', marginBottom: '2px' }}
                      onClick={() => handleBoneStewEntryDelete(idx)}
                    >
                      {t('request.bone_stew_delete')}
                    </button>
                  )}
                </div>
              ))}
              <div>
                <button type="button" className="btn btn-secondary" onClick={handleBoneStewEntryAdd}>
                  + {t('request.bone_stew_add')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 9. Only C가문 제품 */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: '0 0 auto', minWidth: '160px' }}>
            <label className="form-label">{t('request.only_c_family')}</label>
            <select className="form-control" name="only_c_family" value={detail.only_c_family} onChange={handleDetailChange}>
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </div>
          {isCFamily && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <CFamilyRow region="north"  detail={detail} onChange={handleDetailChange} />
              <CFamilyRow region="middle" detail={detail} onChange={handleDetailChange} />
              <CFamilyRow region="south"  detail={detail} onChange={handleDetailChange} />
            </div>
          )}
        </div>

        {/* 10. X표시 변경 여부 */}
        <div className="form-group full-width">
          <label className="form-label">{t('request.x_mark_change')}</label>
          <select className="form-control" name="x_mark_change" value={detail.x_mark_change} onChange={handleDetailChange}>
            <option value="없음">{t('request.x_mark_none')}</option>
            <option value="추가">{t('request.x_mark_add')}</option>
            <option value="수정">{t('request.x_mark_edit')}</option>
            <option value="삭제">{t('request.x_mark_delete')}</option>
          </select>
          {xMarkDeleteMode && (
            <p style={{ color: 'red', fontWeight: 600, margin: '8px 0 0 0' }}>특정 제품 삭제 필요</p>
          )}
          {xMarkEditAddMode && (
            <div className="form-group" style={{ width: '50%', marginTop: '8px' }}>
              <label className="form-label">{t('request.x_mark_image_copy')}</label>
              <textarea
                className="form-control"
                name="x_mark_image_copy"
                value={detail.x_mark_image_copy}
                onChange={handleDetailChange}
                style={{ aspectRatio: '1 / 1', resize: 'none' }}
              />
            </div>
          )}
        </div>

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
          <div className="form-group" style={{ flex: '0 0 auto', minWidth: '160px', marginLeft: '32px' }}>
            <label className="form-label">{t('request.separation_progress')}</label>
            <select className="form-control" name="separation_progress" value={detail.separation_progress} onChange={handleDetailChange}>
              <option value="아니오">{t('request.no')}</option>
              <option value="예">{t('request.yes')}</option>
            </select>
          </div>
        </div>

        {/* 12-14. T가문 적용 / 주력 제품 변경 / 설탕 추가 */}
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
  );

  const renderStep2 = () => (
    <div className="form-section">
      <div className="form-section-title">🔷 {t('request.section_jayer')}</div>
      <div className="wizard-table-wrapper">
        <table className="wizard-table">
          <thead>
            <tr>
              <th style={{ minWidth: 90 }}>조리법</th>
              <th style={{ minWidth: 60 }}>SP</th>
              <th style={{ minWidth: 60 }}>SD</th>
              <th style={{ minWidth: 60 }}>PP</th>
              <th style={{ minWidth: 90 }}>
                ST
                <div className="th-header-btns">
                  <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('st', 'O')}>모두O</button>
                  <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('st', 'X')}>모두X</button>
                  <button type="button" className="th-header-btn" onClick={() => handleJayerResetField('st')}>초기화</button>
                </div>
              </th>
              <th style={{ minWidth: 110 }}>
                신규/복사
                <div className="th-header-btns">
                  <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('new_or_copy', '신규')}>모두 신규</button>
                  <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('new_or_copy', '복사')}>모두 복사</button>
                  <button type="button" className="th-header-btn" onClick={() => handleJayerResetField('new_or_copy')}>초기화</button>
                </div>
              </th>
              <th style={{ minWidth: 110 }}>제품 이름</th>
              <th style={{ minWidth: 70 }}>STEP</th>
              <th style={{ minWidth: 70 }}>ID</th>
              <th style={{ minWidth: 80 }}>REV 여부</th>
              <th style={{ minWidth: 110 }}>그림판 version</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {jayerRows.map((row) => (
              <tr key={row.id}>
                <td><input value={row.cooking_method} onChange={(e) => handleJayerChange(row.id, 'cooking_method', e.target.value)} /></td>
                <td><input value={row.sp} onChange={(e) => handleJayerChange(row.id, 'sp', e.target.value)} /></td>
                <td><input value={row.sd} onChange={(e) => handleJayerChange(row.id, 'sd', e.target.value)} /></td>
                <td><input value={row.pp} onChange={(e) => handleJayerChange(row.id, 'pp', e.target.value)} /></td>
                <td>
                  <select value={row.st} onChange={(e) => handleJayerChange(row.id, 'st', e.target.value)}>
                    <option value=""></option>
                    <option value="O">O</option>
                    <option value="X">X</option>
                  </select>
                </td>
                <td>
                  <select value={row.new_or_copy} onChange={(e) => handleJayerChange(row.id, 'new_or_copy', e.target.value)}>
                    <option value=""></option>
                    <option value="신규">신규</option>
                    <option value="복사">복사</option>
                  </select>
                </td>
                <td>
                  <select value={row.product_name} onChange={(e) => handleJayerChange(row.id, 'product_name', e.target.value)}>
                    <option value=""></option>
                    {OPTION_JAYER_PRODUCT.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td><input value={row.step} onChange={(e) => handleJayerChange(row.id, 'step', e.target.value)} /></td>
                <td><input value={row.item_id} onChange={(e) => handleJayerChange(row.id, 'item_id', e.target.value)} /></td>
                <td><input value={row.rev} onChange={(e) => handleJayerChange(row.id, 'rev', e.target.value)} /></td>
                <td><input value={row.drawing_version} onChange={(e) => handleJayerChange(row.id, 'drawing_version', e.target.value)} /></td>
                <td style={{ textAlign: 'center' }}>
                  <button type="button" className="flow-delete-btn" onClick={() => handleJayerDeleteRow(row.id)} disabled={jayerRows.length <= 1}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="flow-table-add-btn" onClick={handleJayerAddRow}>+ 행 추가</button>
    </div>
  );

  const renderStep3 = () => (
    <div className="form-section">
      <div className="form-section-title">🔶 {t('request.section_oayer')}</div>
      <div className="wizard-table-wrapper">
        <table className="wizard-table">
          <thead>
            <tr>
              <th style={{ minWidth: 90 }}>조리법</th>
              <th style={{ minWidth: 60 }}>SP</th>
              <th style={{ minWidth: 60 }}>SD</th>
              <th style={{ minWidth: 60 }}>PP</th>
              <th style={{ minWidth: 90 }}>
                ST
                <div className="th-header-btns">
                  <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('st', 'O')}>모두O</button>
                  <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('st', 'X')}>모두X</button>
                  <button type="button" className="th-header-btn" onClick={() => handleOayerResetField('st')}>초기화</button>
                </div>
              </th>
              <th style={{ minWidth: 110 }}>
                신규/복사
                <div className="th-header-btns">
                  <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('new_or_copy', '신규')}>모두 신규</button>
                  <button type="button" className="th-header-btn" onClick={() => handleOayerSetAll('new_or_copy', '복사')}>모두 복사</button>
                  <button type="button" className="th-header-btn" onClick={() => handleOayerResetField('new_or_copy')}>초기화</button>
                </div>
              </th>
              <th style={{ minWidth: 110 }}>제품 이름</th>
              <th style={{ minWidth: 70 }}>STEP</th>
              <th style={{ minWidth: 70 }}>TT</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {oayerRows.map((row) => (
              <tr key={row.id}>
                <td><input value={row.cooking_method} onChange={(e) => handleOayerChange(row.id, 'cooking_method', e.target.value)} /></td>
                <td><input value={row.sp} onChange={(e) => handleOayerChange(row.id, 'sp', e.target.value)} /></td>
                <td><input value={row.sd} onChange={(e) => handleOayerChange(row.id, 'sd', e.target.value)} /></td>
                <td><input value={row.pp} onChange={(e) => handleOayerChange(row.id, 'pp', e.target.value)} /></td>
                <td>
                  <select value={row.st} onChange={(e) => handleOayerChange(row.id, 'st', e.target.value)}>
                    <option value=""></option>
                    <option value="O">O</option>
                    <option value="X">X</option>
                  </select>
                </td>
                <td>
                  <select value={row.new_or_copy} onChange={(e) => handleOayerChange(row.id, 'new_or_copy', e.target.value)}>
                    <option value=""></option>
                    <option value="신규">신규</option>
                    <option value="복사">복사</option>
                  </select>
                </td>
                <td>
                  <select value={row.product_name} onChange={(e) => handleOayerChange(row.id, 'product_name', e.target.value)}>
                    <option value=""></option>
                    {OPTION_OAYER_PRODUCT.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td><input value={row.step} onChange={(e) => handleOayerChange(row.id, 'step', e.target.value)} /></td>
                <td><input value={row.tt} onChange={(e) => handleOayerChange(row.id, 'tt', e.target.value)} /></td>
                <td style={{ textAlign: 'center' }}>
                  <button type="button" className="flow-delete-btn" onClick={() => handleOayerDeleteRow(row.id)} disabled={oayerRows.length <= 1}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="flow-table-add-btn" onClick={handleOayerAddRow}>+ 행 추가</button>
    </div>
  );

  const renderStep4 = () => {
    const isDisabled = detail.bone_stew_zone === '없음';
    return (
      <div className="form-section">
        <div className="form-section-title">🦴 {t('request.section_bone_stew')}</div>
        {isDisabled && (
          <div className="wizard-disabled-notice">
            Step 1에서 '뼈찜 조합 영역'을 <strong>존재</strong>로 설정해야 입력할 수 있습니다.
          </div>
        )}
        <div className={`wizard-table-wrapper${isDisabled ? ' wizard-table-disabled' : ''}`}>
          <table className="wizard-table">
            <thead>
              <tr>
                <th style={{ minWidth: 40 }}>No</th>
                <th style={{ minWidth: 90 }}>조리법</th>
                <th style={{ minWidth: 60 }}>SS</th>
                <th style={{ minWidth: 60 }}>SD</th>
                <th style={{ minWidth: 90 }}>뼈찜 조리법</th>
                <th style={{ minWidth: 90 }}>뼈찜 이름</th>
                <th style={{ minWidth: 80 }}>뼈찜 STEP</th>
                <th style={{ minWidth: 70 }}>뼈찜 SS</th>
                <th style={{ minWidth: 90 }}>비고</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {boneStewRows.map((row, idx) => (
                <tr key={row.id}>
                  <td className="wizard-table-no">{idx + 1}</td>
                  <td><input value={row.cooking_method} onChange={(e) => handleBoneStewChange(row.id, 'cooking_method', e.target.value)} disabled={isDisabled} /></td>
                  <td><input value={row.ss} onChange={(e) => handleBoneStewChange(row.id, 'ss', e.target.value)} disabled={isDisabled} /></td>
                  <td><input value={row.sd} onChange={(e) => handleBoneStewChange(row.id, 'sd', e.target.value)} disabled={isDisabled} /></td>
                  <td><input value={row.bone_cooking} onChange={(e) => handleBoneStewChange(row.id, 'bone_cooking', e.target.value)} disabled={isDisabled} /></td>
                  <td><input value={row.bone_name} onChange={(e) => handleBoneStewChange(row.id, 'bone_name', e.target.value)} disabled={isDisabled} /></td>
                  <td><input value={row.bone_step} onChange={(e) => handleBoneStewChange(row.id, 'bone_step', e.target.value)} disabled={isDisabled} /></td>
                  <td><input value={row.bone_ss} onChange={(e) => handleBoneStewChange(row.id, 'bone_ss', e.target.value)} disabled={isDisabled} /></td>
                  <td><input value={row.remark} onChange={(e) => handleBoneStewChange(row.id, 'remark', e.target.value)} disabled={isDisabled} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="flow-delete-btn"
                      onClick={() => handleBoneStewDeleteRow(row.id)}
                      disabled={isDisabled || boneStewRows.length <= 1}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="flow-table-add-btn"
          onClick={handleBoneStewAddRow}
          disabled={isDisabled}
        >
          + 행 추가
        </button>
      </div>
    );
  };

  // ===== Main Render =====
  return (
    <div className="container page">
      <div className="page-header">
        <h1>{isEditMode ? '의뢰서 수정·재상신' : t('request.title')}</h1>
        <p>{isEditMode ? '내용을 수정한 후 재상신하면 반려 단계부터 다시 검토됩니다.' : t('request.subtitle')}</p>
      </div>

      <WizardIndicator
        currentStep={step}
        steps={[
          t('request.section_detail'),
          t('request.section_jayer'),
          t('request.section_oayer'),
          t('request.section_bone_stew'),
        ]}
      />

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}

      <div className="form-actions" style={step > 1 ? { justifyContent: 'space-between' } : {}}>
        {step > 1 && (
          <button className="btn btn-secondary" onClick={handlePrevStep}>
            ← 이전
          </button>
        )}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving}>
            💾 {saving ? t('common.loading') : t('request.save_draft')}
          </button>
          {step < 4 ? (
            <button className="btn btn-primary" onClick={handleNextStep}>
              다음 →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSubmitClick} disabled={submitting}>
              📤 {submitting ? t('common.loading') : t('request.submit')}
            </button>
          )}
        </div>
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('request.submit')}
        size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              📤 {submitting ? t('common.loading') : t('request.submit')}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">{t('request.submit_note_label')}</label>
          <textarea
            className="form-control"
            rows={5}
            placeholder={t('request.submit_note_placeholder')}
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
