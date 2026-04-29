import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI, linesAPI, formOptionsAPI, uploadImageAPI } from '../api/client';
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
  RequestDocument,
  ExternalBbDataItem,
  PhotoStepOption,
  BbAutoFillRange,
} from '../types';

// ===== Option Constants =====
const OPTION_REQUEST_PURPOSE = ['신규', '복사', '변경'] as const;
const OPTION_LINE = ['라인1', '라인2', '라인3', '라인4', '라인5'] as const;
const OPTION_OTHER_PURPOSE = ['목적A', '목적B', '목적C'] as const;
const OPTION_SOURCE_LINE = ['위치A', '위치B', '위치C'] as const;


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
  sortOrder: Date.now(),
  disabled: false,
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
  sortOrder: Date.now(),
  disabled: false,
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
  sortOrder: Date.now(),
  disabled: false,
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

  const [BbProductOptions, setBbProductOptions] = useState<Record<number, string[]>>({});
  const [BbProductidOptions, setBbProductidOptions] = useState<Record<number, string[]>>({});

  const [FlowProductOptions, setFlowProductOptions] = useState<Record<number, string[]>>({});

  const [step, setStep] = useState(1);
  const [form] = useState<CreateDocumentInput>(INITIAL_FORM);
  const [detail, setDetail] = useState<DetailFormState>(INITIAL_DETAIL);
  const [jayerRows, setJayerRows] = useState<JayerRow[]>([makeJayerRow()]);
  const [oayerRows, setOayerRows] = useState<OayerRow[]>([makeOayerRow()]);
  const [bbRows, setBbRows] = useState<BbTableRow[]>([]);
  const [bbExternalData, setBbExternalData] = useState<PhotoStepOption[][]>([]);
  const [bbExternalLoading, setBbExternalLoading] = useState(false);
  const [activeBbTab, setActiveBbTab] = useState(0);
  const [selectedJayerRowId, setSelectedJayerRowId] = useState<string | null>(null);
  const [stagedMappings, setStagedMappings] = useState<Record<string, ExternalBbDataItem>>({});
  const [mappedJayerRowIds, setMappedJayerRowIds] = useState<Set<string>>(new Set());
  const [bbAutoFillRanges, setBbAutoFillRanges] = useState<BbAutoFillRange[]>([]);
  const [showAutoFillPanel, setShowAutoFillPanel] = useState(false);
  const [isBbSorted, setIsBbSorted] = useState(false);  // STEPSEQ 정렬 상태
  const [bbSearchQueries, setBbSearchQueries] = useState<string[]>([]);  // 탭별 검색어
  const [jayerChecked, setJayerChecked] = useState<Set<string>>(new Set());
  const [oayerChecked, setOayerChecked] = useState<Set<string>>(new Set());
  const [bbChecked, setBbChecked] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
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

  const [approvedDocs, setApprovedDocs] = useState<RequestDocument[]>([]);
  const [sourcePartIdOptions, setSourcePartIdOptions] = useState<string[]>([]);

  const [jayerFilterWords, setJayerFilterWords] = useState<{ sp: string[]; sd: string[]; pp: string[] }>({ sp: [], sd: [], pp: [] });
  const [oayerFilterWords, setOayerFilterWords] = useState<{ sp: string[]; sd: string[]; pp: string[] }>({ sp: [], sd: [], pp: [] });
  const [jayerFilterModalOpen, setJayerFilterModalOpen] = useState(false);
  const [oayerFilterModalOpen, setOayerFilterModalOpen] = useState(false);

  useEffect(() => {
    linesAPI.list()
      .then((lines) => { if (lines.length > 0) setLineOptions(lines.map((l) => l.name)); })
      .catch(() => { /* 폴백 유지 */ });

    // 승인된 문서 목록 로드
    documentsAPI.getApproved()
      .then((r) => {
        setApprovedDocs(r.data);
        // PART ID 목록 추출 (중복 제거)
        const partIds = Array.from(new Set(r.data.map((doc: RequestDocument) => doc.product_name)));
        setSourcePartIdOptions(partIds);
      })
      .catch(console.error);

    // localStorage에서 비활성화 필터 단어 로드
    const savedJayerFilter = localStorage.getItem('jayerFilterWords');
    if (savedJayerFilter) {
      try {
        const parsed = JSON.parse(savedJayerFilter);
        const converted = {
          sp: Array.isArray(parsed.sp) ? parsed.sp : parsed.sp ? [parsed.sp] : [],
          sd: Array.isArray(parsed.sd) ? parsed.sd : parsed.sd ? [parsed.sd] : [],
          pp: Array.isArray(parsed.pp) ? parsed.pp : parsed.pp ? [parsed.pp] : [],
        };
        setJayerFilterWords(converted);
      } catch (e) { /* 파싱 실패 시 기본값 유지 */ }
    }
    const savedOayerFilter = localStorage.getItem('oayerFilterWords');
    if (savedOayerFilter) {
      try {
        const parsed = JSON.parse(savedOayerFilter);
        const converted = {
          sp: Array.isArray(parsed.sp) ? parsed.sp : parsed.sp ? [parsed.sp] : [],
          sd: Array.isArray(parsed.sd) ? parsed.sd : parsed.sd ? [parsed.sd] : [],
          pp: Array.isArray(parsed.pp) ? parsed.pp : parsed.pp ? [parsed.pp] : [],
        };
        setOayerFilterWords(converted);
      } catch (e) { /* 파싱 실패 시 기본값 유지 */ }
    }
  }, []);

  useEffect(() => {
    if (detail.request_purpose === '신규') {
      setJayerRows((rows) =>
        rows.map((r) => ({
          ...r,
          product_name: '',
          layerid: '',
          item_id: '',
          rev: '',
          drawing_version: '',
        }))
      );
      setOayerRows((rows) =>
        rows.map((r) => ({
          ...r,
          product_name: '',
          step: '',
        }))
      );
    }
  }, [detail.request_purpose]);

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

  useEffect(() => {
    if (!detail.source_line || approvedDocs.length === 0) {
      setSourcePartIdOptions([]);
      return;
    }

    const filteredDocs = approvedDocs.filter(doc => {
      try {
        const parsed = JSON.parse(doc.additional_notes ?? '{}');
        const docLine = parsed.detail?.line;
        return docLine === detail.source_line;
      } catch {
        return false;
      }
    });

    const partIds = Array.from(new Set(filteredDocs.map((doc: RequestDocument) => doc.product_name)));
    setSourcePartIdOptions(partIds);
    setDetail((prev) => ({ ...prev, source_partid: '' }));
  }, [detail.source_line, approvedDocs]);

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
    if (isLoadingEditRef.current) return; // 편집 모드 로드 중엔 jayerRows/oayerRows 덮어쓰기 방지
    fetchJobFileLayerAndPopulateJayer(detail.line, detail.process_id);
    fetchOvlLayerAndPopulateOayer(detail.line, detail.process_id);
  }, [detail.process_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const jayerMaxLength = Math.max(
      'STEP 설명'.length,
      ...jayerRows.map(r => r.sd?.length || 0)
    );

    const oayerMaxLength = Math.max(
      'STEP 설명'.length,
      ...oayerRows.map(r => r.sd?.length || 0)
    );

    const calculateWidth = (charLength: number) =>
      Math.min(Math.max(charLength * 10, 80), 200);

    const jayerTable = document.querySelector('.wizard-table-wrapper:nth-of-type(2) .wizard-table');
    if (jayerTable) {
      const sdCol = jayerTable.querySelector('.col-sd-column');
      if (sdCol) {
        sdCol.setAttribute('width', `${calculateWidth(jayerMaxLength)}px`);
      }
    }

    const oayerTable = document.querySelector('.wizard-table-wrapper:nth-of-type(3) .wizard-table');
    if (oayerTable) {
      const sdCol = oayerTable.querySelector('.col-sd-column');
      if (sdCol) {
        sdCol.setAttribute('width', `${calculateWidth(oayerMaxLength)}px`);
      }
    }
  }, [jayerRows, oayerRows]);

  useEffect(() => {
    detail.bb_entries.forEach((entry, idx) => {
      if (!entry.location) {
        setBbProductOptions((prev) => ({ ...prev, [idx]: [] }));
        setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      formOptionsAPI.getProducts(entry.location)
        .then((opts) => setBbProductOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setBbProductOptions((prev) => ({ ...prev, [idx]: [] })));
      setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
    });
  }, [detail.bb_entries.map(e => e.location).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry, idx) => {
      if (!entry.location) {
        setFlowProductOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      formOptionsAPI.getProducts(entry.location)
        .then((opts) => setFlowProductOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setFlowProductOptions((prev) => ({ ...prev, [idx]: [] })));
    });
  }, [detail.flow_chart.map(e => e.location).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.bb_entries.forEach((entry, idx) => {
      if (!entry.location || !entry.product) {
        setBbProductidOptions((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      formOptionsAPI.getProcessId(entry.location, entry.product)
        .then((opts) => setBbProductidOptions((prev) => ({ ...prev, [idx]: opts })))
        .catch(() => setBbProductidOptions((prev) => ({ ...prev, [idx]: [] })));
    });
  }, [detail.bb_entries.map(e => e.product).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // bb_entries 변경 시 외부 데이터 로드
  useEffect(() => {
    if (detail.bb_entries.length === 0) return;
    setBbExternalLoading(true);
    Promise.all(detail.bb_entries.map((entry) => formOptionsAPI.getBbExternalData(entry)))
      .then((results) => {
        setBbExternalData(results);
        setActiveBbTab(0);
      })
      .catch(() => setBbExternalData([]))
      .finally(() => setBbExternalLoading(false));
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
        if (parsed.bbRows) {
          setBbRows(parsed.bbRows);
          const existingJayerIds = parsed.bbRows
            .map((row: BbTableRow) => row.sourceJayerRowId)
            .filter(Boolean);
          setMappedJayerRowIds(new Set(existingJayerIds));
        }
      } catch { /* noop */ }
    }).catch(() => { isLoadingEditRef.current = false; });
  }, [editDocId]);

  // Derived booleans for Step 1 conditional rendering
  const isCopy = detail.request_purpose === '차용';
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

  // 이미지 붙여넣기 핸들러 - 백엔드로 업로드
  const handleImagePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          try {
            const result = await uploadImageAPI.upload(file);
            setDetail((prev) => ({
              ...prev,
              mshot_image_copy: result.path
            }));
            addToast(`이미지 업로드 완료: ${file.name}`, 'info');
          } catch (err) {
            console.error('이미지 업로드 실패:', err);
            addToast('이미지 업로드 실패', 'error');
          }
          e.preventDefault();
          break;
        }
      }
    }
  };

  const handleDetailSet = (name: string, value: string) => {
    isLoadingEditRef.current = false; // 사용자 상호작용 시 로드 가드 해제
    setDetail((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  // C가문 리전별 조합법 변경 → 해당 리전 제품이름 fetch
  // 차용 시 원본 PART ID 의 데이터 불러오기
  const loadSourceDocumentData = (partId: string) => {
    const sourceDoc = approvedDocs
      .filter(doc => doc.product_name === partId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    if (!sourceDoc) {
      addToast('원본 문서를 찾을 수 없습니다.', 'error');
      return;
    }

    try {
      const parsed = JSON.parse(sourceDoc.additional_notes ?? '{}');
      const sourceDetail = parsed.detail ?? {};

      const fieldsToCopy: Partial<DetailFormState> = {};

      if (sourceDetail.map_change) fieldsToCopy.map_change = sourceDetail.map_change;
      if (sourceDetail.map_value_x) fieldsToCopy.map_value_x = sourceDetail.map_value_x;
      if (sourceDetail.map_value_y) fieldsToCopy.map_value_y = sourceDetail.map_value_y;
      if (sourceDetail.map_reason) fieldsToCopy.map_reason = sourceDetail.map_reason;

      if (sourceDetail.ea_change) fieldsToCopy.ea_change = sourceDetail.ea_change;
      if (sourceDetail.ea_value) fieldsToCopy.ea_value = sourceDetail.ea_value;

      if (sourceDetail.mshot_change) fieldsToCopy.mshot_change = sourceDetail.mshot_change;
      if (sourceDetail.mshot_image_copy) fieldsToCopy.mshot_image_copy = sourceDetail.mshot_image_copy;

      if (sourceDetail.ip_status) fieldsToCopy.ip_status = sourceDetail.ip_status;
      if (sourceDetail.ip_option) fieldsToCopy.ip_option = sourceDetail.ip_option;

      if (sourceDetail.split_progress) fieldsToCopy.split_progress = sourceDetail.split_progress;

      if (sourceDetail.tmap_apply) fieldsToCopy.tmap_apply = sourceDetail.tmap_apply;

      if (sourceDetail.hplhc_change) fieldsToCopy.hplhc_change = sourceDetail.hplhc_change;

      setDetail(prev => ({ ...prev, ...fieldsToCopy }));

      addToast('원본 제품의 데이터가 적용되었습니다.', 'info');
    } catch (err) {
      console.error('원본 데이터 로드 실패:', err);
      addToast('원본 데이터를 불러오는데 실패했습니다.', 'error');
    }
  };

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

  // ===== Date Format Helper =====
  const formatUpdatedDate = (updated: string): string => {
    if (!updated || updated.length < 12) return updated;
    const yyyyMMdd = updated.slice(0, 8);
    const hh = updated.slice(8, 10);
    const mm = updated.slice(10, 12);
    return `${yyyyMMdd} ${hh}:${mm}`;
  };

  const handleFlowDeleteRow = (id: string) => {
    setDetail((prev) => {
      if (prev.flow_chart.length <= 1) return prev;
      return { ...prev, flow_chart: prev.flow_chart.filter((r) => r.id !== id) };
    });
  };

  // ===== Jayer & Oayer Handlers =====
  // ===== 비활성화 필터 확인 함수 (키워드 배열 지원) =====
  const shouldDisableRow = (filterWords: { sp: string[]; sd: string[]; pp: string[] }, row: { sp: string; sd: string; pp: string }): boolean => {
    const { sp, sd, pp } = filterWords;
    if (sp.some(keyword => keyword && row.sp.toLowerCase().includes(keyword.toLowerCase()))) return true;
    if (sd.some(keyword => keyword && row.sd.toLowerCase().includes(keyword.toLowerCase()))) return true;
    if (pp.some(keyword => keyword && row.pp.toLowerCase().includes(keyword.toLowerCase()))) return true;
    return false;
  };

  const fetchJobFileLayerAndPopulateJayer = async (line: string, process: string) => {
    try {
      const jobFileData = await formOptionsAPI.getJobFileLayer(line, process);

      if (jobFileData && jobFileData.length > 0) {
        const newJayerRows: JayerRow[] = jobFileData.map((item) => {
          const row = {
            ...makeJayerRow(),
            updated: item.updated ? formatUpdatedDate(item.updated) : '',
            process_id: item.processid,
            sp: item.stepseq,
            sd: item.descript,
            pp: item.recipeid,
            layerid: item.layerid || '',
          };
          return { ...row, disabled: shouldDisableRow(jayerFilterWords, row) };
        });
        setJayerRows(newJayerRows);
        addToast(t('request.toast_job_auto_fill', { count: jobFileData.length }), 'info');
      }
    } catch (e) {
      console.error('JOB FILE layer 정보 조회 실패:', e);
      addToast(t('request.toast_job_auto_fill_error'), 'error');
    }
  };

  const fetchOvlLayerAndPopulateOayer = async (line: string, process: string) => {
    try {
      const ovlData = await formOptionsAPI.getOvlLayer(line, process);

      if (ovlData && ovlData.length > 0) {
        const newOayerRows: OayerRow[] = ovlData.map((item) => {
          const row = {
            ...makeOayerRow(),
            updated: item.updated ? formatUpdatedDate(item.updated) : '',
            process_id: item.processid,
            sp: item.stepseq,
            sd: item.descript,
            pp: item.recipeid,
          };
          return { ...row, disabled: shouldDisableRow(oayerFilterWords, row) };
        });
        setOayerRows(newOayerRows);
        addToast(t('request.toast_ovl_auto_fill', { count: ovlData.length }), 'info');
      }
    } catch (e) {
      console.error('OVL layer 정보 조회 실패:', e);
      addToast(t('request.toast_ovl_auto_fill_error'), 'error');
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

  const handleJayerAddRow = () => {
    setJayerRows((rows) => [...rows, makeJayerRow()]);
  };

  const handleJayerBulkDisable = () => {
    setJayerRows((rows) =>
      rows.map((r) => (jayerChecked.has(r.id) && !r.disabled ? { ...r, disabled: true } : r))
    );
    setSelectedJayerRowId((prev) => (prev && jayerChecked.has(prev) ? null : prev));
    setStagedMappings((prev) => {
      const next = { ...prev };
      jayerChecked.forEach((id) => delete next[id]);
      return next;
    });
    setJayerChecked(new Set());
  };

  const handleJayerBulkRestore = () => {
    setJayerRows((rows) =>
      rows.map((r) => (jayerChecked.has(r.id) && r.disabled ? { ...r, disabled: false } : r))
    );
    setJayerChecked(new Set());
  };

  const handleJayerCheckToggle = (id: string) => {
    setJayerChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleJayerCheckAll = () => {
    const activeIds = jayerRows.filter((r) => !r.disabled).map((r) => r.id);
    const allActiveChecked = activeIds.every((id) => jayerChecked.has(id));
    if (allActiveChecked) {
      setJayerChecked(new Set());
    } else {
      setJayerChecked(new Set(activeIds));
    }
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

  const handleOayerAddRow = () => {
    setOayerRows((rows) => [...rows, makeOayerRow()]);
  };

  const handleOayerBulkDisable = () => {
    setOayerRows((rows) =>
      rows.map((r) => (oayerChecked.has(r.id) && !r.disabled ? { ...r, disabled: true } : r))
    );
    setOayerChecked(new Set());
  };

  const handleOayerBulkRestore = () => {
    setOayerRows((rows) =>
      rows.map((r) => (oayerChecked.has(r.id) && r.disabled ? { ...r, disabled: false } : r))
    );
    setOayerChecked(new Set());
  };

  const handleOayerCheckToggle = (id: string) => {
    setOayerChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleOayerCheckAll = () => {
    const activeIds = oayerRows.filter((r) => !r.disabled).map((r) => r.id);
    const allActiveChecked = activeIds.every((id) => oayerChecked.has(id));
    if (allActiveChecked) {
      setOayerChecked(new Set());
    } else {
      setOayerChecked(new Set(activeIds));
    }
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

  const handleBbAddRow = () => {
    setBbRows((rows) => [...rows, makeBbRow()]);
  };

  const handleBbBulkDelete = () => {
    const rowsToRestore = bbRows.filter((r) =>
      bbChecked.has(r.id) && r.sourceJayerRowId
    );

    setBbRows((rows) => rows.filter((r) => !bbChecked.has(r.id)));

    setMappedJayerRowIds((prev) => {
      const next = new Set(prev);
      rowsToRestore.forEach((row) => {
        if (row.sourceJayerRowId) next.delete(row.sourceJayerRowId);
      });
      return next;
    });

    setBbChecked(new Set());
  };

  const handleBbCheckToggle = (id: string) => {
    setBbChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBbCheckAll = () => {
    if (bbChecked.size === bbRows.length) {
      setBbChecked(new Set());
    } else {
      setBbChecked(new Set(bbRows.map((r) => r.id)));
    }
  };

  // 오른쪽 외부 데이터 클릭 → 선택된 J-ayer 행에 스테이징 (즉시 적용 X)
  const handleStageMapping = (externalRow: ExternalBbDataItem) => {
    if (!selectedJayerRowId) return;
    setStagedMappings((prev) => ({ ...prev, [selectedJayerRowId]: externalRow }));
  };

  // 스테이징 취소
  const handleClearStaging = (jayerRowId: string) => {
    setStagedMappings((prev) => {
      const next = { ...prev };
      delete next[jayerRowId];
      return next;
    });
  };

  const handleApplyMappings = () => {
    const mappedRows: BbTableRow[] = jayerRows
      .filter((jr) => stagedMappings[jr.id])
      .map((jr) => {
        const ext = stagedMappings[jr.id];
        const newRow = makeBbRow();
        newRow.sourceJayerRowId = jr.id;
        newRow.process_id = jr.process_id;
        newRow.ss = jr.sp;
        newRow.sd = jr.sd;
        newRow.bb_process_id = ext.bb_process_id;
        newRow.bb_name = ext.bb_name;
        newRow.bb_step = '';
        newRow.bb_ss = ext.bb_ss;
        return newRow;
      });
    if (mappedRows.length === 0) return;

    setBbRows((prev) => [...prev, ...mappedRows]);
    setMappedJayerRowIds((prev) => {
      const next = new Set(prev);
      mappedRows.forEach((row) => {
        if (row.sourceJayerRowId) next.add(row.sourceJayerRowId);
      });
      return next;
    });
    setStagedMappings({});
    setSelectedJayerRowId(null);
  };

  const handleOpenAutoFillPanel = () => {
    const layerIds = [...new Set(jayerRows.map(r => r.layerid).filter(Boolean))]
      .sort((a, b) => parseFloat(a) - parseFloat(b));

    const productIds = detail.bb_entries.map(e => e.product).filter(Boolean);

    if (layerIds.length > 0 && productIds.length > 0) {
      setBbAutoFillRanges([{
        id: String(Date.now()),
        layerFrom: layerIds[0],
        layerTo: layerIds[layerIds.length - 1],
        productId: productIds[0],
      }]);
    } else {
      setBbAutoFillRanges([]);
    }
    setShowAutoFillPanel(true);
  };

  const handleAddRange = () => {
    const productIds = detail.bb_entries.map(e => e.product).filter(Boolean);
    setBbAutoFillRanges(prev => [
      ...prev,
      {
        id: String(Date.now()),
        layerFrom: '',
        layerTo: '',
        productId: productIds[0] || '',
      },
    ]);
  };

  const handleRemoveRange = (id: string) => {
    setBbAutoFillRanges(prev => prev.filter(r => r.id !== id));
  };

  const handleRangeChange = (id: string, field: keyof BbAutoFillRange, value: string) => {
    setBbAutoFillRanges(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));
  };

  const handleApplyAutoFill = () => {
    const hasExistingData = bbRows.some(
      (row) => row.bb_process_id || row.bb_ss || row.bb_name
    );

    if (hasExistingData) {
      const confirmed = window.confirm('기존 입력된 Backbone 데이터가 있습니다. 덮어쓰시겠습니까?');
      if (!confirmed) return;
    }

    const newBbRows: BbTableRow[] = [];

    bbAutoFillRanges.forEach(range => {
      if (!range.layerFrom || !range.layerTo || !range.productId) return;

      const from = parseFloat(range.layerFrom);
      const to = parseFloat(range.layerTo);

      if (isNaN(from) || isNaN(to)) return;

      const jayerRowsInRange = jayerRows.filter(row => {
        const layer = parseFloat(row.layerid);
        return !isNaN(layer) && layer >= from && layer <= to;
      });

      const entryIdx = detail.bb_entries.findIndex(
        e => e.product === range.productId
      );

      if (entryIdx === -1) return;

      const photoSteps = bbExternalData[entryIdx] ?? [];

      jayerRowsInRange.forEach(jayerRow => {
        const matchedStep = photoSteps.find(
          step => step.layerid === jayerRow.layerid
        );

        if (!matchedStep) return;

        newBbRows.push({
          id: String(Date.now() + Math.random()),
          sourceJayerRowId: jayerRow.id,
          sortOrder: jayerRow.sortOrder,
          disabled: jayerRow.disabled,
          process_id: jayerRow.process_id,
          ss: jayerRow.sp,
          sd: jayerRow.sd,
          bb_process_id: matchedStep.processid,
          bb_name: range.productId,
          bb_step: matchedStep.layerid,
          bb_ss: matchedStep.stepseq,
          remark: '',
        });
      });
    });

    if (newBbRows.length === 0) {
      addToast('매칭된 Backbone 데이터가 없습니다.', 'error');
      return;
    }

    setBbRows(newBbRows);
    const mappedIds = newBbRows.map(r => r.sourceJayerRowId).filter(Boolean) as string[];
    setMappedJayerRowIds(new Set(mappedIds));
    setShowAutoFillPanel(false);
    setBbAutoFillRanges([]);
    setIsBbSorted(false);
    addToast(`Backbone 데이터가 ${newBbRows.length}행 자동 채워졌습니다.`, 'success');
  };

  const handleResetBbRows = () => {
    const confirmed = window.confirm('모든 Backbone 데이터를 지우시겠습니까?');
    if (!confirmed) return;

    setBbRows([]);
    setMappedJayerRowIds(new Set());
    setIsBbSorted(false);
    addToast('Backbone 데이터가 초기화되었습니다.', 'info');
  };

  const handleSortBbRows = () => {
    setBbRows(prev => {
      const sorted = [...prev].sort((a, b) =>
        a.ss.localeCompare(b.ss, undefined, { numeric: true })
      );
      setIsBbSorted(true);
      return sorted;
    });
  };

  // ===== Validation =====
  const validate = (currentStep: number): { valid: boolean; errors: string[] } => {
    const newErrors: Partial<Record<string, string>> = {};
    const errorMessages: string[] = [];

    if (currentStep === 1) {
      DETAIL_REQUIRED.forEach((field) => {
        const val = detail[field] as string;
        if (!val?.trim()) {
          newErrors[field] = t('request.required');
          errorMessages.push(`${field}: 필수 입력 항목입니다.`);
        }
      });
      if (detail.map_change === '변경 있음') {
        if (!detail.map_value_x?.trim()) {
          newErrors['map_value_x'] = t('request.required');
          errorMessages.push('MAP 변경 X: 필수 입력 항목입니다.');
        }
        if (!detail.map_value_y?.trim()) {
          newErrors['map_value_y'] = t('request.required');
          errorMessages.push('MAP 변경 Y: 필수 입력 항목입니다.');
        }
        if (!detail.map_reason?.trim()) {
          newErrors['map_reason'] = t('request.required');
          errorMessages.push('MAP 변경 사유: 필수 입력 항목입니다.');
        }
      }
      const filledBb = detail.bb_entries.filter(
        (e) => e.location?.trim() && e.product?.trim() && e.process_id?.trim()
      );
      if (filledBb.length === 0) {
        newErrors['bb_entries'] = t('request.required');
        errorMessages.push('Backbone 조합 영역: 최소 1개 이상 입력해야 합니다.');
      }
    }

    if (currentStep === 2) {
      // TODO: J-ayer 행 검증 로직 추가
    }

    if (currentStep === 3) {
      // TODO: O-ayer 행 검증 로직 추가
    }

    if (currentStep === 4) {
      const unmappedJayerRows = jayerRows.filter(
        (row) => row.process_id && !mappedJayerRowIds.has(row.id)
      );
      if (unmappedJayerRows.length > 0) {
        newErrors['jayer_mapping'] = '모든 원본 데이터에 Backbone을 매핑해야 상신할 수 있습니다.';
        errorMessages.push('모든 원본 데이터에 Backbone을 매핑해야 상신할 수 있습니다.');
      }
    }

    setErrors(newErrors);
    return { valid: Object.keys(newErrors).length === 0, errors: errorMessages };
  };

  // ===== API =====
  const buildEnrichedForm = (note?: string, shouldAddHistory = false): CreateDocumentInput => {
    const title = `${detail.line}(${detail.request_purpose})_${detail.process_selection}_${detail.partid_selection}_${detail.process_id}_요청서`;

    // 반려된 문서 재상신 시 이전 스냅샷을 history 에 누적
    let history: HistorySnapshot[] = [];
    if (shouldAddHistory && prevParsedRef.current) {
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
      additional_notes: JSON.stringify({
        detail,
        jayerRows: jayerRows.filter(r => !r.disabled),
        oayerRows: oayerRows.filter(r => !r.disabled),
        bbRows,
        history,
      }),
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
    if (step === 1) {
      const result = validate(step);
      if (!result.valid) {
        result.errors.forEach(msg => addToast(msg, 'error'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrevStep = () => {
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmitClick = () => {
    const result = validate(4);
    if (!result.valid) {
      result.errors.forEach(msg => addToast(msg, 'error'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let docId = savedId;

      const enriched = buildEnrichedForm(submitNote, false);
      if (!docId) {
        const res = await documentsAPI.create(enriched);
        docId = res.data.id;
        setSavedId(docId);
      } else {
        await documentsAPI.update(docId, enriched);
      }

      const doc = await documentsAPI.get(docId!);
      const isRejected = doc.data.status === 'rejected';

      if (isRejected) {
        const enrichedWithHistory = buildEnrichedForm(submitNote, true);
        await documentsAPI.update(docId!, enrichedWithHistory);
        await documentsAPI.resubmit(docId!);
        addToast('재상신되었습니다.', 'success');
      } else {
        const submitRes = await documentsAPI.submit(docId!);
        addToast(t('request.submit_success'), 'success');
        if (submitRes.data.email_sent) {
          setTimeout(() => addToast(t('request.messenger_sent_to_manager'), 'info'), 800);
        }
      }
      setTimeout(() => navigate('/approval'), 1500);
    } catch (err) {
      console.error('상신 오류:', err);
      addToast(`오류 발생: ${err instanceof Error ? err.message : '알 수 없는 오류'}`, 'error');
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

        {/* 차용 선택 시 sub-fields */}
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
                  options={lineOptions}
                  onChange={handleDetailChange}
                  placeholder={t('request.select_placeholder')}
                  className="flex-col"
                />
                <AutocompleteInput
                  label={t('request.source_partid_selection')}
                  value={detail.source_partid}
                  options={sourcePartIdOptions}
                  onChange={(v) => {
                    handleDetailSet('source_partid', v);
                    if (v) {
                      loadSourceDocumentData(v);
                    }
                  }}
                  style={{ flex: 1 }}
                />
              </div>

              {/* 흐름도 */}
              <div className="form-group">
                <label className="form-label">{t('request.flow_chart')}</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {detail.flow_chart.map((row, idx) => (
                    <div key={row.id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                        <label className="form-label">{t('request.flow_line')}</label>
                        <select
                          className="form-control"
                          value={row.location}
                          onChange={(e) => handleFlowChange(row.id, 'location', e.target.value)}
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
                        />
                      </div>
                      <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                        <label className="form-label">{t('request.flow_progress_layer')}</label>
                        <input
                          className="form-control"
                          value={row.step}
                          onChange={(e) => handleFlowChange(row.id, 'step', e.target.value)}
                          placeholder="ex) 1.0 ~ 15.0"
                        />
                      </div>
                      {detail.flow_chart.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '6px 10px', marginBottom: '2px' }}
                          onClick={() => handleFlowDeleteRow(row.id)}
                        >
                          {t('request.bb_delete')}
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={handleFlowAddRow}>
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
                  />
                </div>
                <div className="form-group flex-col" style={{ marginBottom: 0 }}>
                  <label className="form-label">{t('request.bb_ref_process_id')}</label>
                  <select
                    className="form-control"
                    value={entry.process_id}
                    onChange={(e) => handleBbEntryChange(idx, 'process_id', e.target.value)}
                  >
                    <option value="">{t('request.select_placeholder')}</option>
                    {(BbProductidOptions[idx] || []).map((o) => <option key={o} value={o}>{o}</option>)}
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
              <div
                className="image-upload-area"
                style={{
                  border: '2px dashed #ccc',
                  borderRadius: '8px',
                  padding: '20px',
                  textAlign: 'center',
                  minHeight: '100px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#f9f9f9'
                }}
                onPaste={handleImagePaste}
              >
                {detail.mshot_image_copy ? (
                  <div style={{ width: '100%' }}>
                    <img
                      src={`/media/${detail.mshot_image_copy}`}
                      alt="attached"
                      style={{
                        maxWidth: '100%',
                        maxHeight: '300px',
                        borderRadius: '4px',
                        border: '1px solid #ddd'
                      }}
                    />
                    <p style={{ margin: '8px 0 0 0', color: '#666', fontSize: '13px' }}>
                      이미지가 첨부되었습니다. Ctrl+V 로 다시 붙여넣으면 변경됩니다.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '36px', marginBottom: '8px' }}>📋</div>
                    <p style={{ margin: '0', color: '#666' }}>Ctrl+V 로 이미지를 붙여넣으세요</p>
                  </div>
                )}
              </div>
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
        </div>
        <div className="wizard-table-toolbar-group" style={{ marginLeft: 'auto' }}>
          <button type="button" className="th-header-btn" onClick={() => setJayerFilterModalOpen(true)}>비활성화 필터</button>
        </div>
      </div>
      <div className="wizard-table-wrapper">
        <table className="wizard-table">
          <colgroup>
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
            <col />
            <col />
            <col style={{ width: '32px' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 32, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={jayerRows.filter(r => !r.disabled).length > 0 && jayerRows.filter(r => !r.disabled).every(r => jayerChecked.has(r.id))}
                  ref={(el) => { if (el) { const active = jayerRows.filter(r => !r.disabled); el.indeterminate = active.some(r => jayerChecked.has(r.id)) && !active.every(r => jayerChecked.has(r.id)); } }}
                  onChange={handleJayerCheckAll}
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
              <th style={{ width: 'auto' }}>{t('request.col_item_id')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_rev')}</th>
              <th style={{ width: 'auto' }}>{t('request.col_drawing_version')}</th>
              <th style={{ minWidth: 48 }}>{t('request.col_step')}</th>
              <th style={{ minWidth: 90 }}>{t('request.col_item_id')}</th>
              <th style={{ minWidth: 42 }}>{t('request.col_rev')}</th>
              <th style={{ minWidth: 200 }}>{t('request.col_drawing_version')}</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...jayerRows.filter(r => !r.disabled).sort((a, b) => a.sortOrder - b.sortOrder),
              ...jayerRows.filter(r => r.disabled).sort((a, b) => a.sortOrder - b.sortOrder),
            ].map((row, idx, arr) => {
              const isFirstDisabled = row.disabled && (idx === 0 || !arr[idx - 1].disabled);
              return (
                <>
                  {isFirstDisabled && (
                    <tr key={`divider-${row.id}`} className="row-divider"><td colSpan={12} /></tr>
                  )}
                  <tr key={row.id} className={[row.disabled ? 'row-disabled' : '', jayerChecked.has(row.id) ? 'row-checked' : ''].filter(Boolean).join(' ')}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={jayerChecked.has(row.id)} onChange={() => handleJayerCheckToggle(row.id)} />
                    </td>
                    <td><input value={row.process_id} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'process_id', e.target.value)} /></td>
                    <td><input value={row.sp} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'sp', e.target.value)} /></td>
                    <td><input value={row.sd} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'sd', e.target.value)} /></td>
                    <td><input value={row.pp} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'pp', e.target.value)} /></td>
                    <td>
                      <select value={row.st} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'st', e.target.value)}>
                        <option value=""></option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td>
                      <select value={row.new_or_copy} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'new_or_copy', e.target.value)}>
                        <option value=""></option>
                        <option value="신규">신규</option>
                        <option value="복사">복사</option>
                      </select>
                    </td>
                    <td><input value={row.product_name} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'product_name', e.target.value)} /></td>
                    <td><input value={row.step} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'step', e.target.value)} /></td>
                    <td><input value={row.item_id} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'item_id', e.target.value)} /></td>
                    <td><input value={row.rev} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'rev', e.target.value)} /></td>
                    <td><input value={row.drawing_version} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleJayerChange(row.id, 'drawing_version', e.target.value)} /></td>
                  </tr>
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bulk-action-row">
        <button type="button" className="flow-table-add-btn" onClick={handleJayerAddRow}>+ 행 추가</button>
        {jayerRows.filter(r => !r.disabled && jayerChecked.has(r.id)).length > 0 && (
          <button type="button" className="btn btn-danger btn-sm" onClick={handleJayerBulkDisable}>
            선택 비활성화 ({jayerRows.filter(r => !r.disabled && jayerChecked.has(r.id)).length})
          </button>
        )}
        {jayerRows.filter(r => r.disabled && jayerChecked.has(r.id)).length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleJayerBulkRestore}>
            복원 ({jayerRows.filter(r => r.disabled && jayerChecked.has(r.id)).length})
          </button>
        )}
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="form-section">
      <div className="form-section-title">🔶 {t('request.ovl_li')}</div>
      <div className="wizard-table-wrapper">
        <table className="wizard-table">
          <thead>
            <tr>
              <th style={{ width: 32, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={oayerRows.filter(r => !r.disabled).length > 0 && oayerRows.filter(r => !r.disabled).every(r => oayerChecked.has(r.id))}
                  ref={(el) => { if (el) { const active = oayerRows.filter(r => !r.disabled); el.indeterminate = active.some(r => oayerChecked.has(r.id)) && !active.every(r => oayerChecked.has(r.id)); } }}
                  onChange={handleOayerCheckAll}
                />
              </th>
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
            </tr>
          </thead>
          <tbody>
            {[
              ...oayerRows.filter(r => !r.disabled).sort((a, b) => a.sortOrder - b.sortOrder),
              ...oayerRows.filter(r => r.disabled).sort((a, b) => a.sortOrder - b.sortOrder),
            ].map((row, idx, arr) => {
              const isFirstDisabled = row.disabled && (idx === 0 || !arr[idx - 1].disabled);
              return (
                <>
                  {isFirstDisabled && (
                    <tr key={`divider-${row.id}`} className="row-divider"><td colSpan={10} /></tr>
                  )}
                  <tr key={row.id} className={[row.disabled ? 'row-disabled' : '', oayerChecked.has(row.id) ? 'row-checked' : ''].filter(Boolean).join(' ')}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={oayerChecked.has(row.id)} onChange={() => handleOayerCheckToggle(row.id)} />
                    </td>
                    <td><input value={row.process_id} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'process_id', e.target.value)} /></td>
                    <td><input value={row.sp} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'sp', e.target.value)} /></td>
                    <td><input value={row.sd} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'sd', e.target.value)} /></td>
                    <td><input value={row.pp} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'pp', e.target.value)} /></td>
                    <td>
                      <select value={row.st} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'st', e.target.value)}>
                        <option value=""></option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td>
                      <select value={row.new_or_copy} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'new_or_copy', e.target.value)}>
                        <option value=""></option>
                        <option value="신규">신규</option>
                        <option value="복사">복사</option>
                      </select>
                    </td>
                    <td><input value={row.product_name} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'product_name', e.target.value)} /></td>
                    <td><input value={row.step} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'step', e.target.value)} /></td>
                    <td><input value={row.tt} readOnly={row.disabled} disabled={row.disabled} onChange={(e) => handleOayerChange(row.id, 'tt', e.target.value)} /></td>
                  </tr>
                </>
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
    </div>
  );

  const renderStep4 = () => {
    const currentTabData = bbExternalData[activeBbTab] ?? [];
    const currentEntry = detail.bb_entries[activeBbTab];
    const stagedCount = Object.keys(stagedMappings).length;

    return (
      <div className="form-section">
        <div className="form-section-title">🦴 {t('request.bb_li')}</div>

        {/* 분할 패널 */}
        <div className="bb-split-panel">
          {/* 왼쪽: J-ayer 행 목록 + 매핑 미리보기 */}
          <div className="bb-split-panel-left">
            <div className="bb-split-panel-title">
              ① J-ayer 행 선택 — 클릭하여 선택 후 오른쪽에서 데이터 지정
            </div>
            <div className="bb-split-panel-scroll">
              {jayerRows.filter(r => !r.disabled).length === 0 ? (
                <div className="bb-split-hint">J-ayer 정보가 없습니다. Step 2를 먼저 입력하세요.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>조리법</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>SP</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 }}>매핑된 뼈찜 데이터</th>
                      <th style={{ padding: '6px 8px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jayerRows.filter(r => !r.disabled).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => {
                      const staged = stagedMappings[row.id];
                      const isSelected = selectedJayerRowId === row.id;
                      return (
                        <tr
                          key={row.id}
                          className={isSelected ? 'bb-jayer-selected' : ''}
                          onClick={() => setSelectedJayerRowId(row.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.process_id || '—'}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>{row.sp || '—'}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>
                            {staged ? (
                              <span className="bb-staged-badge">{staged.bb_name} ({staged.bb_step})</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>미지정</span>
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
              ② 외부 데이터 선택 — 선택된 J-ayer 행에 지정됨
            </div>
            <div className="bb-tab-bar">
              {detail.bb_entries.map((entry, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`bb-tab${activeBbTab === idx ? ' bb-tab-active' : ''}`}
                  onClick={() => setActiveBbTab(idx)}
                >
                  {entry.product || entry.location || `항목 ${idx + 1}`}
                </button>
              ))}
            </div>
            <div className="bb-split-panel-scroll">
              {!selectedJayerRowId ? (
                <div className="bb-split-hint">← 먼저 왼쪽에서 J-ayer 행을 선택하세요.</div>
              ) : bbExternalLoading ? (
                <div className="bb-split-loading">데이터 로드 중...</div>
              ) : currentTabData.length === 0 ? (
                <div className="bb-split-hint">
                  {currentEntry?.process_id
                    ? '해당 조리법에 대한 외부 데이터가 없습니다.'
                    : 'Step 1에서 뼈찜 조합 조리법을 먼저 선택하세요.'}
                </div>
              ) : (
                <table className="bb-external-table">
                  <thead>
                    <tr>
                      <th>뼈찜 조리법</th>
                      <th>뼈찜 이름</th>
                      <th>STEP</th>
                      <th>뼈찜 SS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentTabData.map((item) => {
                      const isStaged = selectedJayerRowId
                        ? stagedMappings[selectedJayerRowId]?.id === item.id
                        : false;
                      return (
                        <tr
                          key={item.id}
                          className={`bb-external-row${isStaged ? ' bb-external-staged' : ''}`}
                          onClick={() => handleStageMapping(item)}
                          title="클릭하면 선택된 J-ayer 행에 지정됩니다"
                        >
                          <td>{item.bb_process_id}</td>
                          <td>{item.bb_name}</td>
                          <td>{item.bb_step}</td>
                          <td>{item.bb_ss}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* 적용 버튼 */}
        <div className="bb-apply-row">
          <span className="bb-apply-hint">
            {stagedCount > 0
              ? `${stagedCount}개 행이 매핑됨 — 적용 버튼을 눌러 뼈찜 정보에 반영하세요.`
              : 'J-ayer 행을 선택하고 외부 데이터를 지정한 뒤 적용하세요.'}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApplyMappings}
            disabled={stagedCount === 0}
          >
            ✔ 적용 ({stagedCount}건)
          </button>
        </div>

        {/* 뼈찜 정보 테이블 (적용 후 채워짐) */}
        <div className="bb-selected-section">
          <div className="form-section-title" style={{ fontSize: 14, marginBottom: 8 }}>
            뼈찜 정보 (적용 결과)
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
                  <th style={{ minWidth: 40 }}>No</th>
                  <th style={{ minWidth: 90 }}>조리법</th>
                  <th style={{ minWidth: 60 }}>SS</th>
                  <th style={{ minWidth: 60 }}>SD</th>
                  <th style={{ minWidth: 90 }}>뼈찜 조리법</th>
                  <th style={{ minWidth: 90 }}>뼈찜 이름</th>
                  <th style={{ minWidth: 80 }}>뼈찜 STEP</th>
                  <th style={{ minWidth: 70 }}>뼈찜 SS</th>
                  <th style={{ minWidth: 90 }}>비고</th>
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
                onClick={() => setDeleteConfirm({ message: `${bbChecked.size}개 항목을 삭제하시겠습니까?`, onConfirm: handleBbBulkDelete })}
              >선택 삭제 ({bbChecked.size})</button>
            )}
            {bbDeleted.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleBbRestore}>
                복원 ({bbDeleted.length}개)
              </button>
            )}
          </div>
        </div>
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

      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <p className="delete-confirm-message">{deleteConfirm.message}</p>
            <div className="delete-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>취소</button>
              <button
                className="btn btn-danger"
                onClick={() => { deleteConfirm.onConfirm(); setDeleteConfirm(null); }}
              >삭제</button>
            </div>
          </div>
        </div>
      )}

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
