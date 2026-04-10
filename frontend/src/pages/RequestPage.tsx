import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI, linesAPI, formOptionsAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import FormSelect from '../components/FormSelect';
import AutocompleteInput from '../components/AutocompleteInput';
import { useAuth } from '../contexts/AuthContext';
import {
  CreateDocumentInput,
  DetailFormState,
  FlowChartRow,
  JayerRow,
  OayerRow,
  BbTableRow,
  HistorySnapshot,
} from '../types';

// ===== Option Constants =====
const OPTION_REQUEST_PURPOSE = ['신규', '복사', '변경'] as const;
const OPTION_LINE = ['라인1', '라인2', '라인3', '라인4', '라인5'] as const;
const OPTION_OTHER_PURPOSE = ['목적A', '목적B', '목적C'] as const;
const OPTION_SOURCE_LINE = ['위치A', '위치B', '위치C'] as const;
const OPTION_SOURCE_PARTID = ['원본제품A', '원본제품B', '원본제품C'] as const;
const OPTION_BB_LOCATION = ['위치1', '위치2', '위치3'] as const;
const OPTION_BB_PRODUCT = ['뼈찜제품A', '뼈찜제품B'] as const;
const OPTION_BB_PROCESS_ID = ['뼈찜조리법1', '뼈찜조리법2'] as const;

// Step 2, 3 전용 제품 이름 옵션 (별도 관리 — 필요에 따라 변경)
const OPTION_JAYER_PRODUCT = ['제품A', '제품B', '제품C'] as const;
const OPTION_OAYER_PRODUCT = ['제품A', '제품B', '제품C'] as const;

// ===== ProdcRow — 북쪽/중간/남쪽 공통 행 =====
type CRegion = 'top' | 'middle' | 'bottom';
interface ProdcRowProps {
  region: CRegion;
  detail: DetailFormState;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onSetValue: (name: string, value: string) => void;
  lineOptions: string[];
  processOptions: string[];
  productOptions: string[];
  onProcessChange: (region: CRegion, value: string) => void;
}
const REGION_LABEL_KEY = { top: 'prodc_top', middle: 'prodc_middle', bottom: 'prodc_bottom' } as const;
const ProdcRow: React.FC<ProdcRowProps> = ({ region, detail, onChange, onSetValue, lineOptions, processOptions, productOptions, onProcessChange }) => {
  const { t } = useTranslation();
  const showSelects = region !== 'middle' || detail.prodc_middle_use === '사용';
  return (
    <div className="flex-row">
      <span style={{ width: '40px', paddingTop: '32px', fontWeight: 600 }}>
        {t(`request.${REGION_LABEL_KEY[region]}`)}
      </span>
      {region === 'middle' && (
        <FormSelect
          label={t('request.prodc_use')}
          name="prodc_middle_use"
          value={detail.prodc_middle_use}
          options={['사용', '미사용']}
          onChange={onChange}
          placeholder={t('request.select_placeholder')}
          className="flex-col"
        />
      )}
      {showSelects && (
        <>
          <FormSelect
            label={t('request.prodc_line')}
            name={`prodc_${region}_line`}
            value={detail[`prodc_${region}_line` as keyof DetailFormState] as string}
            options={lineOptions}
            onChange={onChange}
            placeholder={t('request.select_placeholder')}
            className="flex-col"
          />
          <AutocompleteInput
            label={t('request.prodc_process_selection')}
            value={detail[`prodc_${region}_process` as keyof DetailFormState] as string}
            options={processOptions}
            onChange={(v) => { onSetValue(`prodc_${region}_process`, v); onProcessChange(region, v); }}
            style={{ flex: 1 }}
          />
          <AutocompleteInput
            label={t('request.prodc_partid')}
            value={detail[`prodc_${region}_product` as keyof DetailFormState] as string}
            options={productOptions}
            onChange={(v) => onSetValue(`prodc_${region}_product`, v)}
            style={{ flex: 1 }}
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
  process_id: '',
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
  process_id: '',
  sp: '',
  sd: '',
  pp: '',
  st: '',
  new_or_copy: '',
  product_name: '',
  step: '',
  tt: '',
});

const makeBbRow = (): BbTableRow => ({
  id: String(Date.now() + Math.random()),
  process_id: '',
  ss: '',
  sd: '',
  bb_process_id: '',
  bb_name: '',
  bb_step: '',
  bb_ss: '',
  remark: '',
});

// ===== Initial States =====
const INITIAL_DETAIL: DetailFormState = {
  request_purpose: '',
  line: '',
  process_selection: '',
  partid_selection: '',
  other_purpose: '',
  source_line: '',
  source_partid: '',
  change_purpose_note: '',
  flow_chart: [makeRow()],
  process_id: '',
  map_change: '변경 없음',
  map_value_x: '',
  map_value_y: '',
  map_reason: '',
  ea_change: '변경 없음',
  ea_value: '',
  split_progress: '아니오',
  bb_zone: '존재',
  bb_entries: [{ location: '', product: '', process_id: '' }],
  only_prodc: 'No',
  prodc_top_line: '',
  prodc_top_process: '',
  prodc_top_product: '',
  prodc_middle_use: '',
  prodc_middle_line: '',
  prodc_middle_process: '',
  prodc_middle_product: '',
  prodc_bottom_line: '',
  prodc_bottom_process: '',
  prodc_bottom_product: '',
  mshot_change: '없음',
  mshot_image_copy: '',
  ip_status: 'No',
  ip_option: '',
  tmap_apply: '미적용',
  hplhc_change: '변경 없음',
  e_lps: '아니오',
};

const INITIAL_FORM: CreateDocumentInput = {
  title: '',
  requester_name: '',
  requester_email: '',
  requester_department: '',
  product_name: '',
  reference_materials: '',
  additional_notes: '',
};

const DETAIL_REQUIRED: (keyof DetailFormState)[] = [
  'request_purpose',
  'line',
  'process_selection',
  'partid_selection',
  'process_id',
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

  const [lineOptions, setLineOptions] = useState<string[]>(OPTION_LINE as unknown as string[]);
  const [processOptions, setProcessOptions] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [processIdOptions, setProcessIdOptions] = useState<string[]>([]);
  const [topProductOptions, setTopProductOptions] = useState<string[]>([]);
  const [middleProductOptions, setMiddleProductOptions] = useState<string[]>([]);
  const [bottomProductOptions, setBottomProductOptions] = useState<string[]>([]);
  const [sourceProductOptions, setSourceProductOptions] = useState<string[]>([]);
  const [BbProductOptions, setBbProductOptions] = useState<Record<number, string[]>>({});
  const [BbProductidOptions, setBbProductidOptions] = useState<Record<number, string[]>>({});
  const [step, setStep] = useState(1);
  const [form] = useState<CreateDocumentInput>(INITIAL_FORM);
  const [detail, setDetail] = useState<DetailFormState>(INITIAL_DETAIL);
  const [jayerRows, setJayerRows] = useState<JayerRow[]>([makeJayerRow()]);
  const [oayerRows, setOayerRows] = useState<OayerRow[]>([makeOayerRow()]);
  const [bbRows, setBbRows] = useState<BbTableRow[]>([makeBbRow()]);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [savedId, setSavedId] = useState<number | null>(editDocId);
  const prevParsedRef = useRef<{
    detail: DetailFormState;
    jayerRows: JayerRow[];
    oayerRows: OayerRow[];
    bbRows: BbTableRow[];
    history: HistorySnapshot[];
  } | null>(null);
  const isLoadingEditRef = useRef(false);

  useEffect(() => {
    linesAPI.list()
      .then((lines) => { if (lines.length > 0) setLineOptions(lines.map((l) => l.name)); })
      .catch(() => { /* 폴백 유지 */ });
  }, []);

  // 라인 변경 → 조합법 fetch + 하위 초기화 (C가문 리전 포함)
  useEffect(() => {
    if (!detail.line) {
      setProcessOptions([]); setProductOptions([]); setProcessIdOptions([]);
      setTopProductOptions([]); setMiddleProductOptions([]); setBottomProductOptions([]);
      return;
    }
    formOptionsAPI.getProcesses(detail.line)
      .then(setProcessOptions)
      .catch(() => setProcessOptions([]));
    if (!isLoadingEditRef.current) {
      setProductOptions([]);
      setProcessIdOptions([]);
      setTopProductOptions([]); setMiddleProductOptions([]); setBottomProductOptions([]);
      setDetail((prev) => ({ ...prev, process_selection: '', partid_selection: '', process_id: '' }));
    }
  }, [detail.line]); // eslint-disable-line react-hooks/exhaustive-deps

  // 조합법 변경 → 제품이름 fetch + 하위 초기화
  useEffect(() => {
    if (!detail.line || !detail.process_selection) {
      if (!isLoadingEditRef.current) { setProductOptions([]); setProcessIdOptions([]); }
      return;
    }
    formOptionsAPI.getProducts(detail.line, detail.process_selection)
      .then(setProductOptions)
      .catch(() => setProductOptions([]));
    if (!isLoadingEditRef.current) {
      setProcessIdOptions([]);
      setDetail((prev) => ({ ...prev, partid_selection: '', process_id: '' }));
    }
  }, [detail.process_selection]); // eslint-disable-line react-hooks/exhaustive-deps

  // 제품이름 변경 → 조리법 fetch
  useEffect(() => {
    if (!detail.line || !detail.partid_selection) {
      if (!isLoadingEditRef.current) { setProcessIdOptions([]); }
      return;
    }
    formOptionsAPI.getProcessId(detail.line, detail.partid_selection)
      .then(setProcessIdOptions)
      .catch(() => setProcessIdOptions([]));
    if (!isLoadingEditRef.current) {
      setDetail((prev) => ({ ...prev, process_id: '' }));
    }
  }, [detail.partid_selection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detail.line || !detail.process_id) return;
    if (isLoadingEditRef.current) return; // 편집 모드 로드 중엔 jayerRows 덮어쓰기 방지
    fetchStepInfoAndPopulateJayer(detail.line, detail.process_id);
  }, [detail.process_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const isCopy = detail.request_purpose === '복사';
    if (!isCopy || !detail.source_line) { setSourceProductOptions([]); return; }
    const lineName = detail.source_line.replace(' 라인', '');
    formOptionsAPI.getProducts(lineName)
      .then(setSourceProductOptions)
      .catch(() => setSourceProductOptions([]));
    if (!isLoadingEditRef.current) {
      setDetail((prev) => ({ ...prev, source_partid: '' }));
    }
  }, [detail.request_purpose, detail.source_line]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.bb_entries.forEach((entry, idx) => {
      if (!entry.location) {
        setBbProductOptions((prev) => ({ ...prev, [idx]: [] }));
        setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      const lineName = entry.location.replace(' 라인', '');
      formOptionsAPI.getProducts(lineName)
        .then((opts) => setBbProductOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setBbProductOptions((prev) => ({ ...prev, [idx]: [] })));
      setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
    });
  }, [detail.bb_entries]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.bb_entries.forEach((entry, idx) => {
      if (!entry.location || !entry.product) {
        setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      const lineName = entry.location.replace(' 라인', '');
      formOptionsAPI.getProcessId(lineName, entry.product)
        .then((opts) => setBbProductidOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setBbProductidOptions((prev) => ({ ...prev, [idx]: [] })));
    });
  }, [detail.bb_entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // 편집 모드: 기존 문서 데이터 로드
  useEffect(() => {
    if (!editDocId) return;
    isLoadingEditRef.current = true;
    documentsAPI.get(editDocId).then((res) => {
      const doc = res.data;
      try {
        const parsed = JSON.parse(doc.additional_notes ?? '{}');
        prevParsedRef.current = {
          detail: parsed.detail ?? {},
          jayerRows: parsed.jayerRows ?? [],
          oayerRows: parsed.oayerRows ?? [],
          bbRows: parsed.bbRows ?? [],
          history: parsed.history ?? [],
        };
        if (parsed.detail) setDetail(parsed.detail);
        if (parsed.jayerRows) setJayerRows(parsed.jayerRows);
        if (parsed.oayerRows) setOayerRows(parsed.oayerRows);
        if (parsed.bbRows) setBbRows(parsed.bbRows);
      } catch { /* noop */ }
    }).catch(() => { isLoadingEditRef.current = false; });
  }, [editDocId]);

  // Derived booleans for Step 1 conditional rendering
  const isCopy = detail.request_purpose === '복사';
  const hasMapChange = detail.map_change === '변경 있음';
  const hasEaChange = detail.ea_change === '변경 있음';
const isProdc = detail.only_prodc === 'Yes';
  const mshotDeleteMode = detail.mshot_change === '삭제';
  const mshotEditAddMode = detail.mshot_change === '추가' || detail.mshot_change === '수정';
  const isIp = detail.ip_status === 'Yes';

  // ===== Step 1 Handlers =====
  const handleDetailChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    isLoadingEditRef.current = false; // 사용자 상호작용 시 로드 가드 해제
    const { name, value } = e.target;
    setDetail((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const handleDetailSet = (name: string, value: string) => {
    isLoadingEditRef.current = false; // 사용자 상호작용 시 로드 가드 해제
    setDetail((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  // C가문 리전별 조합법 변경 → 해당 리전 제품이름 fetch
  const handleProdcProcessChange = (region: CRegion, value: string) => {
    if (!detail.line || !value) {
      if (region === 'top') setTopProductOptions([]);
      else if (region === 'middle') setMiddleProductOptions([]);
      else setBottomProductOptions([]);
      return;
    }
    formOptionsAPI.getProducts(detail.line, value)
      .then((opts) => {
        if (region === 'top') setTopProductOptions(opts);
        else if (region === 'middle') setMiddleProductOptions(opts);
        else setBottomProductOptions(opts);
      })
      .catch(() => {
        if (region === 'top') setTopProductOptions([]);
        else if (region === 'middle') setMiddleProductOptions([]);
        else setBottomProductOptions([]);
      });
    setDetail((prev) => ({ ...prev, [`prodc_${region}_product`]: '' }));
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
  // ===== Jayer 자동 채움 함수 (bigdata STEP 정보 조회) =====
  const fetchStepInfoAndPopulateJayer = async (line: string, process: string) => {
    try {
      const stepData = await formOptionsAPI.getStepInfo(line, process);
      if (stepData && stepData.length > 0) {
        // Jayer 행을 bigdata 데이터로 자동 채움 (항상 덮어쓰기)
        const newJayerRows: JayerRow[] = stepData.map((item) => ({
          ...makeJayerRow(),
          process_id: item.processid,
          sp: item.stepseq,
          sd: item.descript,
          pp: item.recipeid,
        }));
        setJayerRows(newJayerRows);
        addToast(`Jayer 정보 ${stepData.length}건 자동 채움`, 'info');
      }
    } catch (e) {
      console.error('STEP 정보 조회 실패:', e);
      addToast('Jayer layer 정보 조회 실패', 'error');
    }
  };

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

  // ===== Bb Entry Handlers (Step 1 - 뼈찜 조합 영역 다중 행) =====
  const handleBbEntryChange = (idx: number, field: 'location' | 'product' | 'process_id', value: string) => {
    setDetail((prev) => ({
      ...prev,
      bb_entries: prev.bb_entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)),
    }));
  };

  const handleBbEntryAdd = () => {
    setDetail((prev) => ({
      ...prev,
      bb_entries: [...prev.bb_entries, { location: '', product: '', process_id: '' }],
    }));
  };

  const handleBbEntryDelete = (idx: number) => {
    setDetail((prev) => {
      if (prev.bb_entries.length <= 1) return prev;
      return { ...prev, bb_entries: prev.bb_entries.filter((_, i) => i !== idx) };
    });
  };

  // ===== Bb Handlers =====
  const handleBbChange = (
    id: string,
    field: keyof Omit<BbTableRow, 'id'>,
    value: string
  ) => {
    setBbRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const handleBbAddRow = () => setBbRows((rows) => [...rows, makeBbRow()]);

  const handleBbDeleteRow = (id: string) => {
    setBbRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== id)));
  };

  // ===== Validation =====
  const validate = (): boolean => {
    const newErrors: Partial<Record<string, string>> = {};
    DETAIL_REQUIRED.forEach((field) => {
      const val = detail[field] as string;
      if (!val?.trim()) newErrors[field] = t('request.required');
    });
    if (detail.map_change === '변경 있음') {
      if (!detail.map_value_x?.trim()) newErrors['map_value_x'] = t('request.required');
      if (!detail.map_value_y?.trim()) newErrors['map_value_y'] = t('request.required');
      if (!detail.map_reason?.trim())  newErrors['map_reason']  = t('request.required');
    }
    const filledBb = detail.bb_entries.filter(
      (e) => e.location?.trim() && e.product?.trim() && e.process_id?.trim()
    );
    if (filledBb.length === 0) {
      newErrors['bb_entries'] = t('request.required');
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ===== API =====
  const buildEnrichedForm = (note?: string): CreateDocumentInput => {
    const title = `${detail.line}(${detail.request_purpose})_${detail.process_selection}_${detail.partid_selection}_${detail.process_id}_요청서`;

    // 재상신 모드일 때 이전 스냅샷을 history에 누적
    let history: HistorySnapshot[] = [];
    if (isEditMode && prevParsedRef.current) {
      const prev = prevParsedRef.current;
      history = [
        ...prev.history,
        {
          timestamp: new Date().toISOString(),
          detail: prev.detail as DetailFormState,
          jayerRows: prev.jayerRows,
          oayerRows: prev.oayerRows,
          bbRows: prev.bbRows,
        },
      ];
    }

    return {
      ...form,
      title,
      product_name: detail.partid_selection,
      requester_name: currentUser.name,
      requester_email: currentUser.email,
      requester_department: currentUser.department,
      reference_materials: note ?? '',
      additional_notes: JSON.stringify({ detail, jayerRows, oayerRows, bbRows, history }),
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
          setTimeout(() => addToast(t('request.messenger_sent_to_manager'), 'info'), 800);
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
                  label={t('request.source_line')}
                  name="source_line"
                  value={detail.source_line}
                  options={OPTION_SOURCE_LINE}
                  onChange={handleDetailChange}
                  placeholder={t('request.select_placeholder')}
                  className="flex-col"
                />
                <AutocompleteInput
                  label={t('request.source_partid_selection')}
                  value={detail.source_partid}
                  options={OPTION_SOURCE_PARTID}
                  onChange={(v) => handleDetailSet('source_partid', v)}
                  style={{ flex: 1 }}
                />
              </div>

              {/* 흐름도 */}
              <div className="form-group">
                <label className="form-label">{t('request.flow_chart')}</label>
                <div className="flow-table flow-table-wrapper">
                  <div className="flow-table-header flow-table-row">
                    <div className="flow-table-cell header-cell">{t('request.flow_line')}</div>
                    <div className="flow-table-cell header-cell">{t('request.flow_partid')}</div>
                    <div className="flow-table-cell header-cell">{t('request.flow_progress_layer')}</div>
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
          <FormSelect
            label={t('request.process_id')}
            name="process_id"
            value={detail.process_id}
            options={processIdOptions}
            onChange={handleDetailChange}
            placeholder={t('request.select_placeholder')}
            required
            error={errors.process_id}
            className="flex-col"
          />
        </div>

        {/* 5. 지도 편차 */}
        <div className="full-width flex-row">
          <div className="form-group" style={{ flex: 25 }}>
            <label className="form-label">{t('request.map')}</label>
            <select className="form-control" name="map_change" value={detail.map_change} onChange={handleDetailChange}>
              <option value="변경 없음">{t('request.map_no_change')}</option>
              <option value="변경 있음">{t('request.map_has_change')}</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 10, visibility: hasMapChange ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.map_value_x')} <span className="required">*</span></label>
            <input className={`form-control${errors.map_value_x ? ' error' : ''}`} name="map_value_x" value={detail.map_value_x} onChange={handleDetailChange} />
            {errors.map_value_x && <span className="form-error">{errors.map_value_x}</span>}
          </div>
          <div className="form-group" style={{ flex: 10, visibility: hasMapChange ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.map_value_y')} <span className="required">*</span></label>
            <input className={`form-control${errors.map_value_y ? ' error' : ''}`} name="map_value_y" value={detail.map_value_y} onChange={handleDetailChange} />
            {errors.map_value_y && <span className="form-error">{errors.map_value_y}</span>}
          </div>
          <div className="form-group" style={{ flex: 30, visibility: hasMapChange ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.map_reason')} <span className="required">*</span></label>
            <input className={`form-control${errors.map_reason ? ' error' : ''}`} name="map_reason" value={detail.map_reason} onChange={handleDetailChange} />
            {errors.map_reason && <span className="form-error">{errors.map_reason}</span>}
          </div>
        </div>

        {/* 6. 예외 구역 */}
        <div className="full-width flex-row">
          <div className="form-group" style={{ flex: 25 }}>
            <label className="form-label">{t('request.ea_change')}</label>
            <select className="form-control" name="ea_change" value={detail.ea_change} onChange={handleDetailChange}>
              <option value="변경 없음">{t('request.no_change')}</option>
              <option value="변경 있음">{t('request.has_change')}</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 10, visibility: hasEaChange ? 'visible' : 'hidden' }}>
            <label className="form-label">{t('request.ea_value')}</label>
            <input className="form-control" name="ea_value" value={detail.ea_value} onChange={handleDetailChange} />
          </div>
        </div>

        {/* 8. 뼈찜 조합 영역 */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="form-label">
            {t('request.bb_status')} <span className="required">*</span>
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
                  >
                    <option value="">{t('request.select_placeholder')}</option>
                    {OPTION_BB_LOCATION.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <AutocompleteInput
                  label={t('request.bb_ref_part_id')}
                  value={entry.product}
                  options={OPTION_BB_PRODUCT}
                  onChange={(v) => handleBbEntryChange(idx, 'product', v)}
                  style={{ flex: 1 }}
                />
                <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                  <label className="form-label">{t('request.bb_ref_process_id')}</label>
                  <select
                    className="form-control"
                    value={entry.process_id}
                    onChange={(e) => handleBbEntryChange(idx, 'process_id', e.target.value)}
                  >
                    <option value="">{t('request.select_placeholder')}</option>
                    {OPTION_BB_PROCESS_ID.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                {detail.bb_entries.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ padding: '6px 10px', marginBottom: '2px' }}
                    onClick={() => handleBbEntryDelete(idx)}
                  >
                    {t('request.bb_delete')}
                  </button>
                )}
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-secondary" onClick={handleBbEntryAdd}>
                + {t('request.bb_add')}
              </button>
            </div>
          </div>
        </div>

        {/* 9. Only C가문 제품 */}
        <div className="full-width" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: '0 0 auto', minWidth: '160px' }}>
            <label className="form-label">{t('request.prodc_status')}</label>
            <select className="form-control" name="only_prodc" value={detail.only_prodc} onChange={handleDetailChange}>
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </div>
          {isProdc && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <ProdcRow region="top"    detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={topProductOptions}    onProcessChange={handleProdcProcessChange} />
              <ProdcRow region="middle" detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={middleProductOptions}  onProcessChange={handleProdcProcessChange} />
              <ProdcRow region="bottom" detail={detail} onChange={handleDetailChange} onSetValue={handleDetailSet} lineOptions={lineOptions} processOptions={processOptions} productOptions={bottomProductOptions}  onProcessChange={handleProdcProcessChange} />
            </div>
          )}
        </div>

        {/* 10. X표시 변경 여부 */}
        <div className="form-group full-width">
          <label className="form-label">{t('request.mshot_change_status')}</label>
          <select className="form-control" name="mshot_change" value={detail.mshot_change} onChange={handleDetailChange}>
            <option value="없음">{t('request.mshot_none')}</option>
            <option value="추가">{t('request.mshot_add')}</option>
            <option value="수정">{t('request.mshot_edit')}</option>
            <option value="삭제">{t('request.mshot_delete')}</option>
          </select>
          {mshotDeleteMode && (
            <p style={{ color: 'red', fontWeight: 600, margin: '8px 0 0 0' }}>특정 제품 삭제 필요</p>
          )}
          {mshotEditAddMode && (
            <div className="form-group" style={{ width: '50%', marginTop: '8px' }}>
              <label className="form-label">{t('request.mshot_change_image_attach_area')}</label>
              <textarea
                className="form-control"
                name="mshot_image_copy"
                value={detail.mshot_image_copy}
                onChange={handleDetailChange}
                style={{ aspectRatio: '1 / 1', resize: 'none' }}
              />
            </div>
          )}
        </div>

        {/* 11. 20주년 제품 + 분리 진행 여부 */}
        <div className="full-width flex-row">
          <div className="form-group" style={{ flex: '0 0 auto', minWidth: '160px' }}>
            <label className="form-label">{t('request.ip_application_status')}</label>
            <select className="form-control" name="ip_status" value={detail.ip_status} onChange={handleDetailChange}>
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </div>
          {isIp && (
            <div className="form-group" style={{ flex: '0 0 auto' }}>
              <label className="form-label">{t('request.ip_option_selection')}</label>
              <div className="radio-group">
                {(['옵션A', '옵션B', '옵션C'] as const).map((opt) => (
                  <label key={opt} className="radio-item">
                    <input
                      type="radio"
                      name="ip_option"
                      value={opt}
                      checked={detail.ip_option === opt}
                      onChange={() => handleRadioChange('ip_option', opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="form-group" style={{ flex: '0 0 auto', minWidth: '160px', marginLeft: '32px' }}>
            <label className="form-label">{t('request.split_progress_status')}</label>
            <select className="form-control" name="split_progress" value={detail.split_progress} onChange={handleDetailChange}>
              <option value="아니오">{t('request.no')}</option>
              <option value="예">{t('request.yes')}</option>
            </select>
          </div>
        </div>

        {/* 12-14. T가문 적용 / 주력 제품 변경 / 설탕 추가 */}
        <div className="full-width flex-row">
          <div className="form-group flex-col">
            <label className="form-label">{t('request.tmap_application_status')}</label>
            <select className="form-control" name="tmap_apply" value={detail.tmap_apply} onChange={handleDetailChange}>
              <option value="미적용">{t('request.tmap_not_applied')}</option>
              <option value="적용">{t('request.tmap_applied')}</option>
            </select>
          </div>
          <div className="form-group flex-col">
            <label className="form-label">{t('request.hplhc_status')}</label>
            <select className="form-control" name="hplhc_change" value={detail.hplhc_change} onChange={handleDetailChange}>
              <option value="변경 없음">{t('request.no_change')}</option>
              <option value="변경 있음">{t('request.has_change')}</option>
            </select>
          </div>
          <div className="form-group flex-col">
            <label className="form-label">{t('request.e_lps')}</label>
            <select className="form-control" name="e_lps" value={detail.e_lps} onChange={handleDetailChange}>
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
      <div className="form-section-title">🔷 {t('request.job_li')}</div>
      {/* 일괄 설정 툴바 */}
      <div className="wizard-table-toolbar">
        <div className="wizard-table-toolbar-group">
          <span className="wizard-table-toolbar-label">ST:</span>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('st', 'O')}>모두 O</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('st', 'X')}>모두 X</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerResetField('st')}>초기화</button>
        </div>
        <div className="wizard-table-toolbar-group">
          <span className="wizard-table-toolbar-label">신규/복사:</span>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('new_or_copy', '신규')}>모두 신규</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerSetAll('new_or_copy', '복사')}>모두 복사</button>
          <button type="button" className="th-header-btn" onClick={() => handleJayerResetField('new_or_copy')}>초기화</button>
        </div>
      </div>
      <div className="wizard-table-wrapper">
        <table className="wizard-table">
          <thead>
            <tr>
              <th style={{ minWidth: 58 }}>조리법</th>
              <th style={{ minWidth: 78 }}>SP</th>
              <th style={{ minWidth: 160 }}>SD</th>
              <th style={{ minWidth: 95 }}>PP</th>
              <th style={{ minWidth: 42 }}>ST</th>
              <th style={{ minWidth: 52 }}>신규/복사</th>
              <th style={{ minWidth: 75 }}>제품 이름</th>
              <th style={{ minWidth: 48 }}>STEP</th>
              <th style={{ minWidth: 90 }}>ID</th>
              <th style={{ minWidth: 42 }}>REV</th>
              <th style={{ minWidth: 200 }}>그림판 Version</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {jayerRows.map((row) => (
              <tr key={row.id}>
                <td><input value={row.process_id} onChange={(e) => handleJayerChange(row.id, 'process_id', e.target.value)} /></td>
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
                  <AutocompleteInput
                    value={row.product_name}
                    options={OPTION_JAYER_PRODUCT}
                    onChange={(v) => handleJayerChange(row.id, 'product_name', v)}
                  />
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
      <div className="form-section-title">🔶 {t('request.ovl_li')}</div>
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
                <td><input value={row.process_id} onChange={(e) => handleOayerChange(row.id, 'process_id', e.target.value)} /></td>
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
                  <AutocompleteInput
                    value={row.product_name}
                    options={OPTION_OAYER_PRODUCT}
                    onChange={(v) => handleOayerChange(row.id, 'product_name', v)}
                  />
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

  const renderStep4 = () => (
    <div className="form-section">
      <div className="form-section-title">🦴 {t('request.bb_li')}</div>
      <div className="wizard-table-wrapper">
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
            {bbRows.map((row, idx) => (
              <tr key={row.id}>
                <td className="wizard-table-no">{idx + 1}</td>
                <td><input value={row.process_id} onChange={(e) => handleBbChange(row.id, 'process_id', e.target.value)} /></td>
                <td><input value={row.ss} onChange={(e) => handleBbChange(row.id, 'ss', e.target.value)} /></td>
                <td><input value={row.sd} onChange={(e) => handleBbChange(row.id, 'sd', e.target.value)} /></td>
                <td><input value={row.bb_process_id} onChange={(e) => handleBbChange(row.id, 'bb_process_id', e.target.value)} /></td>
                <td><input value={row.bb_name} onChange={(e) => handleBbChange(row.id, 'bb_name', e.target.value)} /></td>
                <td><input value={row.bb_step} onChange={(e) => handleBbChange(row.id, 'bb_step', e.target.value)} /></td>
                <td><input value={row.bb_ss} onChange={(e) => handleBbChange(row.id, 'bb_ss', e.target.value)} /></td>
                <td><input value={row.remark} onChange={(e) => handleBbChange(row.id, 'remark', e.target.value)} /></td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="flow-delete-btn"
                    onClick={() => handleBbDeleteRow(row.id)}
                    disabled={bbRows.length <= 1}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="flow-table-add-btn" onClick={handleBbAddRow}>
        + 행 추가
      </button>
    </div>
  );

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
          t('request.job_li'),
          t('request.ovl_li'),
          t('request.bb_li'),
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
