import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { documentsAPI, linesAPI, formOptionsAPI, uploadImageAPI, guidesAPI, usersAPI, addressBooksAPI, userGroupsAPI } from '../../api/client';
import { useToast } from '../../components/Toast';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { useCellSelection } from '../../hooks/useCellSelection';
import { numberBoundaryMatch } from '../../utils/specMatch';
import Modal, { ConfirmModal } from '../../components/Modal';
import { useAuth } from '../../contexts/AuthContext';
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
  BbAutoFillAmbiguousRow,
  FilterSet,
  GuideFeatureKey,
  UserWithRole,
  AddressBook,
  UserGroup,
  TbvtlvNoteRow,
  ValidationSystemValue,
  MergePair,
  MergeRefMode,
  MergeRowInfo,
  MergeSnapshot,
  MergeTable,
  AdiCdStep,
} from '../../types';
import StepGuideTour from '../../components/StepGuideTour';
import { useStepGuideTour } from './useStepGuideTour';
import GuideSlidePanel from '../../components/GuideSlidePanel';
import {
  OPTION_LINE,
  CRegion,
  ProdcScope,
  genId,
  makeRow,
  makeBbEntry,
  makeJayerRow,
  makeOayerRow,
  makeBbRow,
  INITIAL_DETAIL,
  INITIAL_FORM,
  DETAIL_REQUIRED,
  ONLY_MAP_PURPOSE,
  MAP_DELETE_EDIT_PURPOSE,
  OTHER_PURPOSE_LAB,
  MAP_TYPE_DELETE_REQ,
  isMapDeleteEditType,
  EA_NO_CHANGE,
  EA_HAS_CHANGE,
  eaDefaultValue,
  MAP_NO_CHANGE,
  MAP_TYPE_EXISTING,
  isMapRegisteredType,
  regionMapChangeDefault,
  PRODC_SCOPE_OPTIONS,
  inferProdcScope,
  JAYER_EDITABLE_COLS,
  isBbMirroredCol,
  OAYER_EDITABLE_COLS,
  LOADED_LOCK_COLS,
  isNocSpecial,
  NOC_LAYER_DELETE,
  makeTourDetail,
  makeTourJayerRows,
  makeTourOayerRows,
  makeTourBbRows,
  makeTourBbExternalData,
  makeTourAdiCdBefore,
  makeTourAdiCdAfter,
  TOUR_MERGE_PURPOSE,
  TOUR_JAYER_PRODUCT,
  TOUR_JAYER_STEPS,
  TOUR_JAYER_ITEMS,
  VS_TARGET,
  VS_NONTARGET,
  VS_NA,
  VS_UNSELECTED,
  isMergePurposeSelected,
  MERGE_UNREGISTERED_ID,
  ADI_CD_CHANGE_PURPOSE,
  ADI_CD_TEMPLATE_ROWS,
  ADI_CD_MAX_ROWS,
  makeAdiCdStep,
  makeAdiCdTarget,
  mapInfoDefaults,
  MERGE_MANUAL_FIELDS,
} from './constants';
import {
  formatUpdatedDate, calcDisabled, emptyDraftWords, findNocBorrowViolations, findNocBorrowItemIdViolations, findEmptyStNocViolations,
  requiresBbEntries, findBbEntryViolations, autoValidationSystem, computeLayerMerge, MergeStats, computeBeforeAfter,
  parseClipboardTable, decideAdiCdPaste, buildAdiCdRows, validateAdiCdRows, balanceAdiCdRows, AdiCdHeaderMatch,
  validateAdiCdTargets,
  deriveMergeKind, emptyMergePair, emptyMergeRowInfo, normalizeMergeSide, parseMergePasteRows, validateMergePairs, applyMergePaste,
  sourceCodeFromPartid, computeExpectedRequestPurpose,
} from './helpers';
import WizardIndicator from './components/WizardIndicator';
import FilterManageModal from './components/FilterManageModal';
import AdiCdColumnMapModal from './components/AdiCdColumnMapModal';
import Step1 from './components/Step1';
import { BaField, BaSide } from './components/BeforeAfterPanel';
import StepMap from './components/StepMap';
import Step2 from './components/Step2';
import Step3 from './components/Step3';
import Step4 from './components/Step4';

// bb 행의 bb_name(Ref.PART ID)을 "[라인] 제품" 형식으로 만든다(라인 없으면 제품만).
const formatBbName = (location: string, product: string): string =>
  location ? `[${location}] ${product}` : product;

// step 값으로 바코드 후보를 좁혀 item_id 자동값을 결정한다.
// 정확히 1개 매칭이면 그 label, 그 외(0개·2개+)면 '' (드롭다운에서 선택).
const autoMatchItemId = (
  row: { step: string },
  candidates: { label: string; spec: string }[],
): string => {
  const step = row.step?.trim();
  if (!step) return '';
  const matched = candidates.filter((c) => numberBoundaryMatch(c.spec, step));
  return matched.length === 1 ? matched[0].label : '';
};

// product_name 타이핑 시 바코드 후보 조회를 디바운스하는 지연(ms). Impala 백엔드 중복 호출 감소.
const BARCODE_DEBOUNCE_MS = 300;

// 작성 마법사 단계: 1 기본 정보 / 2 MAP 정보 / 3 J-ayer / 4 O-ayer / 5 Backbone
const STEP_MAP_INFO = 2;
const STEP_LAST = 5;

// 상신 모달 크기 — 지정자·후결자·합의자·통보자를 한 화면에서 다루도록 기존(520px)의 2배로 넓혔다.
// 세로는 공용 `.modal-body { max-height: 82vh }` 안에서만 늘릴 수 있어 최소 높이로 지정한다.
const SUBMIT_MODAL_MAX_WIDTH = '1040px';
const SUBMIT_MODAL_MIN_BODY_HEIGHT = '62vh';
// 특이사항 입력칸 줄 수(기존 3줄 → 넓어진 모달에 맞춰 확대).
const SUBMIT_NOTE_ROWS = 10;

// 오늘 날짜를 <input type="date"> 가 쓰는 'YYYY-MM-DD' 로. toISOString 은 UTC 기준이라 쓰지 않는다.
const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 전체 가이드 되감기(seek)용 투어 상태 스냅샷 — 프리뷰가 정주행 중 챕터별로 캡처해 두었다가
// 되감을 때 그대로 복원한다. (mappedJayerRowIds는 직렬화 위해 배열로 보관)
export interface TourSnapshot {
  step: number;
  detail: DetailFormState;
  jayerRows: JayerRow[];
  bbRows: BbTableRow[];
  oayerInfoTab: 'table' | 'info';
  showAutoFillPanel: boolean;
  bbAutoFillRanges: BbAutoFillRange[];
  stagedMappings: Record<string, ExternalBbDataItem>;
  mappedJayerRowIds: string[];
  activeBbTab: number;
  confirmOpen: boolean;
  submitNote: string;
  designees: { loginid: string; name: string }[];
}

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

  // 지정 PL 수정 후 상신 모드
  const peerReviewDocId: number | null = (location.state as any)?.peerReviewDocId ?? null;
  const isPeerReviewMode = !!peerReviewDocId;

  // 전체 가이드 투어 모드: /request?embed=tour (&step=N) — 샘플 값이 채워진 읽기 전용 미리보기
  const tourParams = new URLSearchParams(location.search);
  const isTourMode = tourParams.get('embed') === 'tour';
  const initialTourStep = Math.min(5, Math.max(1, parseInt(tourParams.get('step') || '1', 10) || 1));

  const [lineOptions, setLineOptions] = useState<string[]>(OPTION_LINE as unknown as string[]);
  const [processOptions, setProcessOptions] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [processIdOptions, setProcessIdOptions] = useState<string[]>([]);
  const [topProductOptions, setTopProductOptions] = useState<string[]>([]);
  const [middleProductOptions, setMiddleProductOptions] = useState<string[]>([]);
  const [bottomProductOptions, setBottomProductOptions] = useState<string[]>([]);
  // C가문 리전별 조합법 옵션 — 각 리전의 prodc_{region}_line 에 따라 로드된다.
  const [topProcessOptions, setTopProcessOptions] = useState<string[]>([]);
  const [middleProcessOptions, setMiddleProcessOptions] = useState<string[]>([]);
  const [bottomProcessOptions, setBottomProcessOptions] = useState<string[]>([]);

  // bb_entries 옵션 캐시는 위치(index)가 아니라 항목 id로 키한다(삭제 시 시프트 불필요).
  const [BbProductOptions, setBbProductOptions] = useState<Record<string, string[]>>({});
  const [BbProductidOptions, setBbProductidOptions] = useState<Record<string, string[]>>({});

  // flow_chart 옵션 캐시도 위치(index)가 아니라 행 id로 키한다(중간 행 삭제 시 시프트/깜빡임 방지 — R-12).
  const [FlowProductOptions, setFlowProductOptions] = useState<Record<string, string[]>>({});
  const [FlowProcessIdOptions, setFlowProcessIdOptions] = useState<Record<string, string[]>>({});
  const [FlowLayerIdOptions, setFlowLayerIdOptions] = useState<Record<string, string[]>>({});

  // ADI CD 변경 '동일 변경 적용 대상' — 표 안 행은 읽기 전용이고, 아직 표에 반영하지 않은
  // "입력 중인 값"만 이 draft 로 관리한다("추가" 버튼을 눌러야 표(adi_cd_extra_targets)로 옮겨간다).
  // 제품 이름 옵션은 위쪽 productOptions 를 그대로 재사용하고(라인+조합법 고정), 조리법 옵션만
  // 지금 입력된 제품 이름 기준으로 fetch한다(입력칸이 하나뿐이라 행 id 캐시 대신 배열 하나로 충분).
  const [adiCdTargetDraft, setAdiCdTargetDraft] = useState<{ partid_selection: string; process_id: string }>({
    partid_selection: '', process_id: '',
  });
  const [adiCdTargetDraftProcessIdOptions, setAdiCdTargetDraftProcessIdOptions] = useState<string[]>([]);

  const [step, setStep] = useState(isTourMode ? initialTourStep : 1);
  const [form] = useState<CreateDocumentInput>(INITIAL_FORM);
  const [detail, setDetail] = useState<DetailFormState>(isTourMode ? makeTourDetail() : INITIAL_DETAIL);
  const [jayerRows, setJayerRows] = useState<JayerRow[]>(isTourMode ? makeTourJayerRows() : []);
  // Validation System: 상신자가 토글을 직접 건드렸는지. true 면 J-layer 가 바뀌어도 값을 건드리지 않는다.
  // 세션 로컬 상태라 detail 에 넣지 않고 저장도 하지 않는다.
  const [vsManuallySet, setVsManuallySet] = useState(false);
  // J-layer 가 바뀌면 Validation System 판정 가능 여부를 다시 본다.
  // - 판정 키워드가 전부 사라지면 판정 자체가 성립하지 않으므로 수동 설정 이력과 무관하게
  //   '해당없음'으로 되돌린다 — 그러지 않으면 '비대상'만 남고 E 단계는 생기지 않는 불일치가 남는다.
  // - 키워드가 있으면 (2026-08) **자동 선택하지 않고 미선택으로 둔다.** 대상/비대상 판정은
  //   상신자가 직접 내려야 하며, 고르기 전에는 validate(3) 이 O-layer 단계로 넘어가지 못하게 막는다.
  useEffect(() => {
    const auto = autoValidationSystem(jayerRows);
    if (auto === VS_NA) {
      setVsManuallySet(false);
      setDetail((prev) => (prev.validation_system === VS_NA ? prev : { ...prev, validation_system: VS_NA }));
      return;
    }
    if (vsManuallySet) return;
    // 직접 고른 적이 없으면 미선택으로 되돌린다. 'NA' 로 잠겨 있던 문서가 키워드를 갖게 된
    // 경우도 여기서 미선택이 되어 상신자에게 선택을 요구한다.
    setDetail((prev) => (prev.validation_system === VS_UNSELECTED ? prev : { ...prev, validation_system: VS_UNSELECTED }));
  }, [jayerRows, vsManuallySet]);
  const [jayerBarcodeCache, setJayerBarcodeCache] = useState<Record<string, { label: string; spec: string }[]>>({});
  // 바코드 후보 조회 경합/부하 방지: 행별 요청 시퀀스 토큰(최신 요청만 반영) + 타이핑 디바운스 타이머
  const barcodeReqSeq = useRef<Record<string, number>>({});
  const barcodeDebounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 옵션 조회(연쇄 선택) 경합 방지: 조회 키별 요청 시퀀스 토큰(최신 요청 응답만 반영)
  const optionReqSeq = useRef<Record<string, number>>({});
  // 뼈찜 외부데이터: (항목,값) 조합별 결과 캐시 + 직전 조회 process_id(토스트용)
  const bbExtCache = useRef<Record<string, PhotoStepOption[]>>({});
  const bbExtPrevPid = useRef<Record<string, string>>({});
  const [oayerRows, setOayerRows] = useState<OayerRow[]>(isTourMode ? makeTourOayerRows() : []);
  const [bbRows, setBbRows] = useState<BbTableRow[]>(isTourMode ? makeTourBbRows() : []);
  const [bbExternalData, setBbExternalData] = useState<PhotoStepOption[][]>(isTourMode ? (makeTourBbExternalData() as PhotoStepOption[][]) : []);
  // 전체 가이드 J-ayer 데모: 실제 표 위에 떠 있는 가짜 커서 + Ctrl C/V 칩
  const [tourJCursor, setTourJCursor] = useState<{ x: number; y: number } | null>(null);
  const [tourJChip, setTourJChip] = useState<{ kind: 'copy' | 'paste'; x: number; y: number } | null>(null);
  // BB 적용 버튼을 커서로 '누르는' 순간의 클릭 애니메이션 표시 여부
  const [tourJClicking, setTourJClicking] = useState(false);
  // 가이드 BB 데모에서 최신 핸들러/상태를 stale-closure 없이 호출하기 위한 참조
  const tourRef = useRef<{
    jayerRows: JayerRow[];
    bbExternalData: PhotoStepOption[][];
    handleOpenAutoFillPanel: () => void;
    handleApplyAutoFill: () => void;
    handleStageMapping: (item: ExternalBbDataItem) => void;
    handleApplyMappings: () => void;
  } | null>(null);
  // 되감기(seek) 복원용 현재 투어 상태 스냅샷 참조
  const snapStateRef = useRef<TourSnapshot | null>(null);
  const [bbExternalLoading, setBbExternalLoading] = useState(false);
  const [activeBbTab, setActiveBbTab] = useState(0);
  const [selectedJayerRowId, setSelectedJayerRowId] = useState<string | null>(null);
  const [stagedMappings, setStagedMappings] = useState<Record<string, ExternalBbDataItem>>({});
  const [mappedJayerRowIds, setMappedJayerRowIds] = useState<Set<string>>(new Set());
  const [bbAutoFillRanges, setBbAutoFillRanges] = useState<BbAutoFillRange[]>([]);
  const [showAutoFillPanel, setShowAutoFillPanel] = useState(false);
  // 자동채움 매칭 후보가 2개 이상인 행들 — 확인 모달에서 사용자가 선택할 때까지 보류
  const [bbAutoFillAmbiguous, setBbAutoFillAmbiguous] = useState<BbAutoFillAmbiguousRow[]>([]);
  const [bbAutoFillAmbiguousChoices, setBbAutoFillAmbiguousChoices] = useState<Record<string, number | 'skip'>>({});
  // 애매하지 않아 바로 확정된 행 — 확인 모달에서 "적용" 시 선택 결과와 합쳐 함께 반영
  const [bbAutoFillPendingResolved, setBbAutoFillPendingResolved] = useState<BbTableRow[]>([]);
  const [bbSearchQueries, setBbSearchQueries] = useState<Record<string, string>>({});  // 탭(bb_entry id)별 검색어
  const [jayerChecked, setJayerChecked] = useState<Set<string>>(new Set());
  const [oayerChecked, setOayerChecked] = useState<Set<string>>(new Set());
  const jayerDragInfo = useRef<{ startId: string; mode: 'check' | 'uncheck' } | null>(null);
  const oayerDragInfo = useRef<{ startId: string; mode: 'check' | 'uncheck' } | null>(null);
  const [bbChecked, setBbChecked] = useState<Set<string>>(new Set());
  const [refDocId, setRefDocId] = useState<number | null>(null);
  const [refDocLabel, setRefDocLabel] = useState<string>('');
  const [refJayerRows, setRefJayerRows] = useState<JayerRow[]>([]);
  const [refOayerRows, setRefOayerRows] = useState<OayerRow[]>([]);
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [mergePreview, setMergePreview] = useState<{ jayer: MergeStats; oayer: MergeStats } | null>(null);
  // 재선택 롤백용 — Merge 로 3-way 재판정을 반영하기 '직전'의 J/O 표. 문서에도 저장해
  // 임시저장 후 재진입·재상신 이후에도 되돌릴 수 있다.
  const [mergeSnapshot, setMergeSnapshot] = useState<MergeSnapshot | null>(null);
  const [mergeReselectConfirm, setMergeReselectConfirm] = useState(false);
  // 참조 요청서 있음/없음 전환 확인 — 확인해야 초기화와 함께 모드가 바뀐다(취소하면 아무것도 바뀌지 않는다).
  const [mergeModeConfirm, setMergeModeConfirm] = useState<MergeRefMode | null>(null);
  // BEFORE/AFTER 표에서 지금 선택한 행 id ('미등록'은 MERGE_UNREGISTERED_ID). 저장하지 않는 화면 상태.
  const [baSelBefore, setBaSelBefore] = useState<string | null>(null);
  const [baSelAfter, setBaSelAfter] = useState<string | null>(null);
  // 5개 값이 모두 같아 비교 표에서 제외한 건수(요약 표시 전용 — 저장하지 않는다)
  const [baSameCount, setBaSameCount] = useState(0);

  /**
   * 비교 결과·스냅샷·참조 문서 기록을 모두 지운다(J/O 표는 건드리지 않는다).
   * 조리법 변경·Merge 목적 전체 해제·재선택에서 공통으로 쓴다.
   */
  const clearMergeComparison = (nextMode: MergeRefMode = 'ref') => {
    setMergeSnapshot(null);
    setBaSelBefore(null);
    setBaSelAfter(null);
    setBaSameCount(0);
    setDetail((prev) => (
      prev.merge_ref_doc_id === null
        && !prev.merge_applied
        && prev.merge_ref_mode === nextMode
        && (prev.merge_pairs?.length ?? 0) === 0
        && (prev.merge_unmatched_before?.length ?? 0) === 0
        && (prev.merge_unmatched_after?.length ?? 0) === 0
        ? prev   // 이미 비어 있으면 새 객체를 만들지 않는다(불필요한 리렌더 방지)
        : {
          ...prev,
          merge_ref_doc_id: null,
          merge_ref_doc_label: '',
          merge_ref_mode: nextMode,
          merge_applied: false,
          merge_pairs: [],
          merge_unmatched_before: [],
          merge_unmatched_after: [],
        }
    ));
  };
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [mapTypeChangeConfirm, setMapTypeChangeConfirm] = useState<{ targetType: string } | null>(null);
  // Only MAP / MAP 삭제 진입·이탈 확인 모달 — 전환 대상 목적을 함께 들고 있는다.
  const [onlyMapConfirm, setOnlyMapConfirm] = useState<{ targetPurpose: string } | null>(null);
  // ADI CD 변경(기타 목적) — 변경전/변경후 스텝 표
  const [adiCdMapModal, setAdiCdMapModal] = useState<{ side: 'before' | 'after'; grid: string[][]; header: AdiCdHeaderMatch | null; startIndex: number } | null>(null);
  const [adiCdPendingApply, setAdiCdPendingApply] = useState<{ side: 'before' | 'after'; rows: AdiCdStep[]; startIndex: number } | null>(null); // 붙여넣기 범위에 값이 있을 때 겹쳐쓰기 확인
  const [adiCdRemoveConfirm, setAdiCdRemoveConfirm] = useState<{ index: number } | null>(null); // 행 삭제 시 반대쪽에 값이 있을 때 확인
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 편집/지정PL 로드 실패 여부. 로드 실패 시 빈 폼으로 기존 문서를 덮어쓰는 것을 막는다(R-10).
  const [loadError, setLoadError] = useState(false);
  // 임시저장/자동저장/상신이 동시에 create()를 호출해 의뢰서가 중복 생성되는 race 방지 가드
  const isPersistingRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [savedId, setSavedId] = useState<number | null>(editDocId ?? peerReviewDocId);
  // 편집 대상 문서의 상태 — 'pause' 이면 상신 대신 '재개'(resume) 로 동작한다.
  const [editDocStatus, setEditDocStatus] = useState<string | null>(null);
  const isResumeMode = editDocStatus === 'pause';

  // 이력 바로 등록 (MASTER 전용) — 결재 경로를 타지 않고 상신일·결재 완료일을 직접 지정한다.
  const [directHistoryOpen, setDirectHistoryOpen] = useState(false);
  const [directSubmittedAt, setDirectSubmittedAt] = useState(todayISO());
  const [directApprovedAt, setDirectApprovedAt] = useState(todayISO());
  const [directHistoryError, setDirectHistoryError] = useState('');
  // 노출 조건: MASTER + 아직 결재선이 없는 문서(신규 작성·임시저장 재진입).
  // 반려 재상신·지정 PL 수정·재개는 이미 결재가 진행된 문서라 대상이 아니다.
  const canDirectHistory =
    currentUser.role === 'MASTER' && !isPeerReviewMode &&
    (editDocStatus === null || editDocStatus === 'draft');

  // 동료 PL 지정 (상신 모달) — 다중 지정(전원 합의)
  const [designees, setDesignees] = useState<{ loginid: string; name: string }[]>([]);
  const [designeeSearchQuery, setDesigneeSearchQuery] = useState('');
  const [designeeDropdownOpen, setDesigneeDropdownOpen] = useState(false);
  const [plUserOptions, setPlUserOptions] = useState<UserWithRole[]>([]);
  const designeeContainerRef = useRef<HTMLDivElement>(null);
  const [designeeError, setDesigneeError] = useState('');
  const designeeInputRef = useRef<HTMLInputElement>(null);

  // C가문(only_prodc=YES) 추가 후결자 — 상신 모달에서 PL 중 지정(고정 후결자 1명은 서버가 항상 포함)
  const [postApprovers, setPostApprovers] = useState<{ loginid: string; name: string }[]>([]);
  const [postApproverSearch, setPostApproverSearch] = useState('');
  const [postApproverDropdownOpen, setPostApproverDropdownOpen] = useState(false);
  const [postApproverDropdownRect, setPostApproverDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const postApproverInputRef = useRef<HTMLInputElement>(null);
  const postApproverContainerRef = useRef<HTMLDivElement>(null);

  // 영업/기술지원 합의자 — PL 검토와 병렬인 결재 단계. 상신 모달에서 PL 중 지정한다.
  // 예외 구역 값을 기본값과 다르게 바꾼 의뢰서는 지정(또는 미지정 사유)이 필수다.
  const [salesAgreers, setSalesAgreers] = useState<{ loginid: string; name: string }[]>([]);
  const [salesAgreerSearch, setSalesAgreerSearch] = useState('');
  const [salesAgreerDropdownOpen, setSalesAgreerDropdownOpen] = useState(false);
  const [salesAgreerDropdownRect, setSalesAgreerDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const salesAgreerInputRef = useRef<HTMLInputElement>(null);
  const salesAgreerContainerRef = useRef<HTMLDivElement>(null);
  // '지정하지 않음' 사유 — 합의자가 필수인데 아무도 지정하지 않을 때 입력한다.
  const [salesAgreerNoneReason, setSalesAgreerNoneReason] = useState('');
  // 합의자 검색/지정 UI 와 '없음' 사유 입력은 상호 배타적이다 — 이 토글로 어느 쪽을 보여줄지 정한다.
  const [salesAgreerNone, setSalesAgreerNone] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // 통보자 다중 지정 (상신 모달) — 결재 권한 없이 상신·결재완료 메일만 받는 인원
  const [notifierUserOptions, setNotifierUserOptions] = useState<UserWithRole[]>([]);
  const [notifierSearchQuery, setNotifierSearchQuery] = useState('');
  const [notifierDropdownOpen, setNotifierDropdownOpen] = useState(false);
  const [notifierDropdownRect, setNotifierDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const notifierInputRef = useRef<HTMLInputElement>(null);
  const notifierContainerRef = useRef<HTMLDivElement>(null);

  // 주소록(통보처 프리셋) — 상신 모달에서 통보처를 세트로 저장/불러오기
  const [addressBooks, setAddressBooks] = useState<AddressBook[]>([]);
  const [abLoadOpen, setAbLoadOpen] = useState(false);
  const [abSaveOpen, setAbSaveOpen] = useState(false);
  const [abSaveMode, setAbSaveMode] = useState<'new' | number>('new'); // 'new' 또는 덮어쓸 기존 주소록 id
  const [abSaveNewName, setAbSaveNewName] = useState('');
  const [abConfirm, setAbConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // 통보처 불러오기 — 검색 입력 + 포털 드롭다운(주소록 이름 필터)
  const [abLoadQuery, setAbLoadQuery] = useState('');
  const [abLoadRect, setAbLoadRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const abLoadInputRef = useRef<HTMLInputElement>(null);
  // 나만의 그룹 — 상신 모달에서 그룹 멤버 전원을 통보처에 한 번에 '추가'
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [groupLoadOpen, setGroupLoadOpen] = useState(false);
  const [groupLoadQuery, setGroupLoadQuery] = useState('');
  const [groupLoadRect, setGroupLoadRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const groupLoadInputRef = useRef<HTMLInputElement>(null);
  const prevParsedRef = useRef<{
    detail: DetailFormState;
    jayerRows: JayerRow[];
    oayerRows: OayerRow[];
    bbRows: BbTableRow[];
    history: HistorySnapshot[];
  } | null>(null);
  // 편집/지정PL 모드에서 불러온 원본 의뢰자 — 수정/재상신 시에도 최초 작성자로 고정
  const originalRequesterRef = useRef<{ name: string; email: string; department: string } | null>(null);
  // 투어 모드에선 시드한 값이 라인/조합법 변경 reset 효과로 지워지지 않도록 로드 가드를 켠 채 시작
  const isLoadingEditRef = useRef(isTourMode);
  // 자동 MAP 매칭이 source_line 을 세팅한 직후 1틱 — "원본 위치 변경 → 원본 제품 초기화" 효과가
  // 방금 채운 source_partid 를 지우지 않도록 이번 한 번만 건너뛰게 하는 플래그.
  const autoMapMatchRef = useRef(false);

  const [approvedDocs, setApprovedDocs] = useState<RequestDocument[]>([]);
  const [sourcePartIdOptions, setSourcePartIdOptions] = useState<string[]>([]);

  const [jayerFilterSets, setJayerFilterSets] = useState<FilterSet[]>([]);
  const [oayerFilterSets, setOayerFilterSets] = useState<FilterSet[]>([]);
  const [jayerActiveFilterIds, setJayerActiveFilterIds] = useState<Set<string>>(new Set());
  const [oayerActiveFilterIds, setOayerActiveFilterIds] = useState<Set<string>>(new Set());
  const [jayerFilterModalOpen, setJayerFilterModalOpen] = useState(false);
  const [oayerFilterModalOpen, setOayerFilterModalOpen] = useState(false);
  const [jayerNewFilter, setJayerNewFilter] = useState<{ label: string; words: { sp: string[]; sd: string[]; pp: string[] } }>({ label: '', words: emptyDraftWords() });
  const [oayerNewFilter, setOayerNewFilter] = useState<{ label: string; words: { sp: string[]; sd: string[]; pp: string[] } }>({ label: '', words: emptyDraftWords() });
  const [jayerSortBySp, setJayerSortBySp] = useState(false);
  const [oayerSortBySp, setOayerSortBySp] = useState(false);
  const [productionDate, setProductionDate] = useState<string>('');
  // 제품 해당 위치 전환 확인 모달(전환하면 지워질 입력이 있을 때만 값이 들어간다)
  const [prodcScopeConfirm, setProdcScopeConfirm] = useState<ProdcScope | null>(null);
  const [finalGds, setFinalGds] = useState<string>('');
  const [oayerInfoTab, setOayerInfoTab] = useState<'table' | 'info'>('table');
  const [tbvtlvSdsSelected, setTbvtlvSdsSelected] = useState<string[]>([]);
  const [tbvtlvNoteRows, setTbvtlvNoteRows] = useState<TbvtlvNoteRow[]>([{ id: genId(), x: '', y: '', used: 'O' }]);
  const [tbvtlvWarnModal, setTbvtlvWarnModal] = useState(false);
  const [bbResetConfirm, setBbResetConfirm] = useState(false);
  const [specialCareConfirm, setSpecialCareConfirm] = useState(false);
  // STEP4(O-layer)→STEP5(Backbone) 전환 관문 — Jayer/Oayer '요청 기준'으로 계산한 요청 목적이
  // 현재 값과 다를 때, 계산된 값을 담아 모달을 띄운다. null 이면 닫힘.
  const [purposeMismatchConfirm, setPurposeMismatchConfirm] = useState<string | null>(null);
  // 관문 모달(특이사항·TBV/TLV·요청 목적 확인)이 뜬 시점의 최종 목적지 단계. 탭으로 여러 단계를
  // 건너뛰는 도중 모달이 뜨면 '계속 진행' 후 원래 목적지까지 이어서 가야 하므로 보관한다.
  const [pendingStepTarget, setPendingStepTarget] = useState<number | null>(null);
  // 이번 이동에서 사용자가 이미 확인한 관문. 한 번에 여러 단계를 건너뛰면 step1·step4 관문이
  // 연달아 뜰 수 있는데, 확인 기록이 없으면 두 모달이 서로를 다시 띄워 무한 반복된다.
  const ackedStepGatesRef = useRef<{ specialCare: boolean; tbvtlv: boolean; purposeMismatch: boolean }>({
    specialCare: false, tbvtlv: false, purposeMismatch: false,
  });
  const [filterDeleteConfirm, setFilterDeleteConfirm] = useState<{
    type: 'jayer' | 'oayer';
    filterId: string;
    label: string;
  } | null>(null);
  const [filterAllDeleteConfirm, setFilterAllDeleteConfirm] = useState<'jayer' | 'oayer' | null>(null);
  const [featureGuideKeys, setFeatureGuideKeys] = useState<Set<string>>(new Set());
  const [slidePanel, setSlidePanel] = useState<{ open: boolean; featureKey: GuideFeatureKey; title: string }>({
    open: false, featureKey: 'step1_line_process', title: ''
  });

  // 연쇄 선택 옵션 조회 공용 헬퍼.
  // - matchedOrLoading: 값이 부모 옵션에 "정확히" 존재할 때만 조회(편집/투어 로드 중엔 우회).
  // - fetchOptions: 키별 시퀀스 토큰으로 stale 응답을 버리고 최신 요청 결과만 반영.
  const matchedOrLoading = (opts: string[], value: string): boolean =>
    isLoadingEditRef.current || (!!value && opts.includes(value));
  const fetchOptions = (key: string, fetcher: () => Promise<string[]>, apply: (opts: string[]) => void) => {
    const seq = (optionReqSeq.current[key] ?? 0) + 1;
    optionReqSeq.current[key] = seq;
    fetcher()
      .then((opts) => { if (optionReqSeq.current[key] === seq) apply(opts); })
      .catch(() => { if (optionReqSeq.current[key] === seq) apply([]); });
  };

  useEffect(() => {
    linesAPI.list()
      .then((lines) => { if (lines.length > 0) setLineOptions(lines.map((l) => l.name)); })
      .catch(() => { /* 폴백 유지 */ });

    // 승인된 문서 목록 로드
    documentsAPI.getApproved()
      .then((r) => {
        setApprovedDocs(r.data);
      })
      .catch(console.error);

    // localStorage에서 비활성화 FilterSet 로드 (구버전 jayerFilterWords 마이그레이션 포함)
    const savedJayerSets = localStorage.getItem('jayerFilterSets');
    if (savedJayerSets) {
      try { setJayerFilterSets(JSON.parse(savedJayerSets)); } catch { /* 파싱 실패 시 기본값 유지 */ }
    } else {
      const oldJayer = localStorage.getItem('jayerFilterWords');
      if (oldJayer) {
        try {
          const w = JSON.parse(oldJayer);
          const migrated: FilterSet[] = [{ id: String(Date.now()), label: '기존 필터', words: { sp: Array.isArray(w.sp) ? w.sp : [], sd: Array.isArray(w.sd) ? w.sd : [], pp: Array.isArray(w.pp) ? w.pp : [] } }];
          setJayerFilterSets(migrated);
          localStorage.setItem('jayerFilterSets', JSON.stringify(migrated));
          localStorage.removeItem('jayerFilterWords');
        } catch { /* noop */ }
      }
    }
    const savedOayerSets = localStorage.getItem('oayerFilterSets');
    if (savedOayerSets) {
      try { setOayerFilterSets(JSON.parse(savedOayerSets)); } catch { /* 파싱 실패 시 기본값 유지 */ }
    } else {
      const oldOayer = localStorage.getItem('oayerFilterWords');
      if (oldOayer) {
        try {
          const w = JSON.parse(oldOayer);
          const migrated: FilterSet[] = [{ id: String(Date.now() + 1), label: '기존 필터', words: { sp: Array.isArray(w.sp) ? w.sp : [], sd: Array.isArray(w.sd) ? w.sd : [], pp: Array.isArray(w.pp) ? w.pp : [] } }];
          setOayerFilterSets(migrated);
          localStorage.setItem('oayerFilterSets', JSON.stringify(migrated));
          localStorage.removeItem('oayerFilterWords');
        } catch { /* noop */ }
      }
    }

    // 기능 가이드 키 목록 로드 — 필드 배지는 글 가이드가 실제로 있는 기능에만 노출한다
    // (빌트인 데모 영상은 스텝 제목 옆 하이라이트 투어 배지 하나로만 안내한다).
    guidesAPI.list({ guide_type: 'feature' })
      .then((r) => {
        const data = r.data;
        const items = Array.isArray(data) ? data : (data as { results: { feature_key: string }[] }).results ?? [];
        const dbKeys = items.map((g: { feature_key: string | null }) => g.feature_key).filter(Boolean) as string[];
        setFeatureGuideKeys(new Set(dbKeys));
      })
      .catch(() => { setFeatureGuideKeys(new Set()); });
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
      setTopProcessOptions([]); setMiddleProcessOptions([]); setBottomProcessOptions([]);
      setFinalGds('');
      // 제품 이름 옵션 자체가 바뀌므로(라인 기준) '동일 변경 적용 대상' 입력칸도 함께 비운다.
      setAdiCdTargetDraft({ partid_selection: '', process_id: '' });
      setDetail((prev) => ({
        ...prev,
        process_selection: '', partid_selection: '', process_id: '',
        adi_cd_extra_targets: [],
        // 메인 라인 변경 시 C가문 스코프·리전·지도편차·Final 값도 초기화(옛 라인 기준 잔존 방지 — 감사 R-6)
        prodc_scope: '',
        prodc_top_line: '', prodc_top_process: '', prodc_top_product: '',
        prodc_middle_use: '', prodc_middle_line: '', prodc_middle_process: '', prodc_middle_product: '',
        prodc_bottom_line: '', prodc_bottom_process: '', prodc_bottom_product: '',
        map_change_top: regionMapChangeDefault(prev.map_type),
        map_value_x_top: '', map_value_y_top: '',
        map_change_bottom: regionMapChangeDefault(prev.map_type),
        map_value_x_bottom: '', map_value_y_bottom: '',
        final_yn: '', final_entries: [],
      }));
    }
  }, [detail.line]); // eslint-disable-line react-hooks/exhaustive-deps

  // C가문 리전별 라인 변경 → 해당 리전 조합법 옵션 fetch (값 리셋은 하지 않음 — 복사/수동변경 핸들러가 담당)
  useEffect(() => {
    const line = detail.prodc_top_line as string;
    if (!line) { setTopProcessOptions([]); return; }
    fetchOptions('prodc-top-process', () => formOptionsAPI.getProcesses(line), setTopProcessOptions);
  }, [detail.prodc_top_line]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const line = detail.prodc_middle_line as string;
    if (!line) { setMiddleProcessOptions([]); return; }
    fetchOptions('prodc-middle-process', () => formOptionsAPI.getProcesses(line), setMiddleProcessOptions);
  }, [detail.prodc_middle_line]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const line = detail.prodc_bottom_line as string;
    if (!line) { setBottomProcessOptions([]); return; }
    fetchOptions('prodc-bottom-process', () => formOptionsAPI.getProcesses(line), setBottomProcessOptions);
  }, [detail.prodc_bottom_line]); // eslint-disable-line react-hooks/exhaustive-deps

  // 원본 위치 변경 → 원본 제품 목록 fetch
  useEffect(() => {
    // 하위 선택값 초기화는 '사용자가 원본 위치를 바꾼 경우'에만 해야 한다.
    // 편집/투어 로드는 저장된 source_line 을 채우는 것뿐이라 여기서 초기화하면
    // 불러온 source_partid 가 지워져 그대로 다시 저장될 때 영구 유실된다
    // (다른 연쇄 초기화 effect 들과 동일한 로드 가드).
    // 자동 MAP 매칭 직후에도 같은 이유로 건너뛴다 — 그 효과가 source_line·source_partid 를
    // 함께 채우는데, 여기서 지우면 자동 채움이 무의미해진다.
    if (!isLoadingEditRef.current && !autoMapMatchRef.current) {
      setDetail((prev) => ({ ...prev, source_partid: '' }));
    }
    autoMapMatchRef.current = false;
    if (!detail.source_line) {
      setSourcePartIdOptions([]);
      return;
    }
    formOptionsAPI.getMapNames(detail.source_line)
      .then(setSourcePartIdOptions)
      .catch(() => setSourcePartIdOptions([]));
  }, [detail.source_line]); // eslint-disable-line react-hooks/exhaustive-deps

  // 라인 + 제품 이름(Step1) → 이미 등록된 MAP 이 있으면 map_type 을 EXISTING 으로 자동 선택.
  // map_type 이 이미 선택돼 있으면(사용자가 이미 골랐으면) 덮어쓰지 않는다 — 자동 선택은
  // "아직 아무것도 안 골랐을 때의 기본값"일 뿐, 잠그거나 사용자의 선택을 되돌리지 않는다.
  useEffect(() => {
    // MAP 삭제 모드는 map_type 버튼 자체가 다르므로(삭제 전용) 제외한다.
    // ADI CD 변경은 MAP 정보 자체를 작성하지 않으므로(StepMap 비노출) 제외한다.
    // (아래에서 선언되는 isMapDeleteEdit/isAdiCdChange 대신 원본 조건을 그대로 써서 선언 순서 문제를 피한다.)
    if (detail.request_purpose === MAP_DELETE_EDIT_PURPOSE || detail.request_purpose === ADI_CD_CHANGE_PURPOSE) return;
    if (detail.map_type) return;
    if (!detail.line || !detail.partid_selection) return;
    const code = sourceCodeFromPartid(detail.partid_selection);
    if (!code) return;
    let cancelled = false;
    formOptionsAPI.getMapNames(detail.line)
      .then((codes) => {
        if (cancelled || !codes.includes(code)) return;
        autoMapMatchRef.current = true;
        setSourcePartIdOptions(codes);
        setDetail((prev) => {
          if (prev.map_type) return prev; // 그 사이 사용자가 이미 선택했으면 덮어쓰지 않는다
          return {
            ...prev,
            map_type: MAP_TYPE_EXISTING,
            source_line: detail.line,
            source_partid: code,
            map_change_top: regionMapChangeDefault(MAP_TYPE_EXISTING),
            map_change_bottom: regionMapChangeDefault(MAP_TYPE_EXISTING),
            ...(prev.ea_change === EA_NO_CHANGE ? { ea_value: eaDefaultValue(prev.only_prodc) } : {}),
          };
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [detail.line, detail.partid_selection, detail.request_purpose]); // eslint-disable-line react-hooks/exhaustive-deps

  // 조합법 변경 → 제품이름 fetch + 하위 초기화
  useEffect(() => {
    if (!detail.line || !detail.process_selection) {
      if (!isLoadingEditRef.current) { setProductOptions([]); setProcessIdOptions([]); }
      return;
    }
    // 하위 선택값은 부모 변경 시 즉시 초기화(이전 값과 부모 불일치 방지)
    if (!isLoadingEditRef.current) {
      setProcessIdOptions([]);
      // 제품 이름 옵션 자체가 바뀌므로(조합법 기준) '동일 변경 적용 대상' 입력칸·추가 행도 함께 비운다.
      setAdiCdTargetDraft({ partid_selection: '', process_id: '' });
      setDetail((prev) => (
        prev.partid_selection || prev.process_id || prev.adi_cd_extra_targets.length > 0
          ? { ...prev, partid_selection: '', process_id: '', adi_cd_extra_targets: [] }
          : prev
      ));
    }
    // 제품 조회는 조합법이 옵션에 정확히 존재할 때만(시퀀스 토큰으로 stale 응답 무시)
    if (matchedOrLoading(processOptions, detail.process_selection)) {
      fetchOptions('product', () => formOptionsAPI.getProducts(detail.line, detail.process_selection), setProductOptions);
    } else if (!isLoadingEditRef.current) {
      setProductOptions([]);
    }
  }, [detail.process_selection, processOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // 제품이름 변경 → 조리법 fetch
  useEffect(() => {
    if (!detail.line || !detail.partid_selection) {
      if (!isLoadingEditRef.current) { setProcessIdOptions([]); }
      return;
    }
    // 하위(process_id) 즉시 초기화
    if (!isLoadingEditRef.current) {
      setDetail((prev) => (prev.process_id ? { ...prev, process_id: '' } : prev));
    }
    // 조리법 조회는 제품이 옵션에 정확히 존재할 때만
    if (matchedOrLoading(productOptions, detail.partid_selection)) {
      fetchOptions('processId', () => formOptionsAPI.getProcessId(detail.line, detail.partid_selection), setProcessIdOptions);
    } else if (!isLoadingEditRef.current) {
      setProcessIdOptions([]);
    }
  }, [detail.partid_selection, productOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLoadingEditRef.current) return; // 편집/투어 로드 중엔 보존(저장된 J/O/bb 유지)
    // 조리법(process_id)이 비워지면 J/O 원본이 없으므로 bb 매핑 상태를 초기화하고 종료.
    if (!detail.line || !detail.process_id) {
      setBbRows([]);
      setMappedJayerRowIds(new Set());
      setStagedMappings({});
      setSelectedJayerRowId(null);
      return;
    }
    // 유효한(옵션에 존재하는) 조리법일 때만 J/O를 새로 재생성한다.
    // 부분 입력 중(미일치)엔 기존 J/O·매핑을 비우지 않는다(파괴적 동작 방지).
    if (!processIdOptions.includes(detail.process_id)) return;
    // J/O가 새 id로 재생성되므로 고아 bb 행 방지를 위해 매핑 상태 초기화
    setBbRows([]);
    setMappedJayerRowIds(new Set());
    setStagedMappings({});
    setSelectedJayerRowId(null);
    setRefDocId(null);
    setRefDocLabel('');
    setRefJayerRows([]);
    setRefOayerRows([]);
    // 조리법이 바뀌면 J/O 가 통째로 재조회되므로 옛 스냅샷으로 롤백되면 안 된다 → 비교 상태 전부 정리.
    clearMergeComparison();
    // Only MAP·MAP 삭제·ADI CD 변경은 J/O 를 작성하지 않는다 → 자동 재조회 없이 빈 상태로 유지한다.
    // (isStep1OnlyScope 는 이 effect 아래에서 선언되므로 detail 로 직접 판정)
    if (detail.request_purpose === ONLY_MAP_PURPOSE || detail.request_purpose === MAP_DELETE_EDIT_PURPOSE
      || detail.request_purpose === ADI_CD_CHANGE_PURPOSE) {
      setJayerRows([]);
      setOayerRows([]);
      return;
    }
    fetchJobFileLayerAndPopulateJayer(detail.line, detail.process_id);
    fetchOvlLayerAndPopulateOayer(detail.line, detail.process_id);
  }, [detail.process_id, processIdOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Merge 사용 목적(Layer 추가/삭제·STEPSEQ 변경·Overlay 변경)을 모두 해제하면 참조·비교 상태를 비운다.
    // (J/O 표는 되돌리지 않는다 — 되돌리려면 '재선택' 버튼을 쓴다)
    if (!isMergePurposeSelected(detail.other_purpose)) {
      setRefDocId(null);
      setRefDocLabel('');
      setRefJayerRows([]);
      setRefOayerRows([]);
      clearMergeComparison();
    }
  }, [detail.other_purpose]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    detail.bb_entries.forEach((entry) => {
      if (!entry.location) {
        setBbProductOptions((prev) => ({ ...prev, [entry.id]: [] }));
        setBbProductidOptions((prev) => ({ ...prev, [entry.id]: [] }));
        return;
      }
      formOptionsAPI.getProducts(entry.location)
        .then((opts) => setBbProductOptions((prev) => ({ ...prev, [entry.id]: opts })))
        .catch(() => setBbProductOptions((prev) => ({ ...prev, [entry.id]: [] })));
      setBbProductidOptions((prev) => ({ ...prev, [entry.id]: [] }));
    });
  }, [detail.bb_entries.map(e => e.location).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry) => {
      if (!entry.location) {
        setFlowProductOptions((prev) => ({ ...prev, [entry.id]: [] }));
        return;
      }
      formOptionsAPI.getProducts(entry.location)
        .then((opts) => setFlowProductOptions((prev) => ({ ...prev, [entry.id]: opts })))
        .catch(() => setFlowProductOptions((prev) => ({ ...prev, [entry.id]: [] })));
    });
  }, [detail.flow_chart.map(e => e.location).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry) => {
      // 제품이 해당 행 옵션에 정확히 일치할 때만 조리법 조회(시퀀스 토큰으로 stale 무시)
      if (entry.location && matchedOrLoading(FlowProductOptions[entry.id] ?? [], entry.product_name)) {
        fetchOptions(
          `flow-pid-${entry.id}`,
          () => formOptionsAPI.getProcessId(entry.location, entry.product_name),
          (opts) => setFlowProcessIdOptions((prev) => ({ ...prev, [entry.id]: opts })),
        );
      } else {
        setFlowProcessIdOptions((prev) => ({ ...prev, [entry.id]: [] }));
      }
    });
  }, [detail.flow_chart.map(e => `${e.location}|${e.product_name}`).join(','), FlowProductOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.flow_chart.forEach((entry) => {
      // 조리법이 해당 행 옵션에 정확히 일치할 때만 Layer 조회
      if (entry.location && matchedOrLoading(FlowProcessIdOptions[entry.id] ?? [], entry.process_id)) {
        fetchOptions(
          `flow-layer-${entry.id}`,
          () => formOptionsAPI.getLayerIds(entry.location, entry.process_id),
          (opts) => setFlowLayerIdOptions((prev) => ({ ...prev, [entry.id]: opts })),
        );
      } else {
        setFlowLayerIdOptions((prev) => ({ ...prev, [entry.id]: [] }));
      }
    });
  }, [detail.flow_chart.map(e => `${e.location}|${e.process_id}`).join(','), FlowProcessIdOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    detail.bb_entries.forEach((entry) => {
      // 제품이 해당 항목 옵션에 정확히 존재할 때만 조리법 조회(시퀀스 토큰으로 stale 무시)
      if (entry.location && matchedOrLoading(BbProductOptions[entry.id] ?? [], entry.product)) {
        fetchOptions(
          `bb-pid-${entry.id}`,
          () => formOptionsAPI.getProcessId(entry.location, entry.product),
          (opts) => setBbProductidOptions((prev) => ({ ...prev, [entry.id]: opts })),
        );
      } else {
        setBbProductidOptions((prev) => ({ ...prev, [entry.id]: [] }));
      }
    });
  }, [detail.bb_entries.map(e => `${e.id}|${e.product}`).join(','), BbProductOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ADI CD 변경 '동일 변경 적용 대상' — 지금 입력 중인 제품 이름(draft) 기준으로 조리법을 조회한다.
  // 제품 이름 옵션은 라인+조합법 고정이라 위쪽 productOptions 를 그대로 쓴다(재조회 없음).
  useEffect(() => {
    if (adiCdTargetDraft.partid_selection && matchedOrLoading(productOptions, adiCdTargetDraft.partid_selection)) {
      fetchOptions(
        'adi-cd-target-draft-pid',
        () => formOptionsAPI.getProcessId(detail.line, adiCdTargetDraft.partid_selection),
        setAdiCdTargetDraftProcessIdOptions,
      );
    } else {
      setAdiCdTargetDraftProcessIdOptions([]);
    }
  }, [adiCdTargetDraft.partid_selection, productOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  // bb_entries 외부 데이터 로드: 항목별로 제품·조리법이 옵션에 정확히 일치할 때만 조회한다.
  // (항목,값) 조합 캐시로 변경 없는 항목 재조회를 막고, 시퀀스 토큰으로 stale 응답을 버린다.
  // 토스트(나): 조리법이 새로 유효해진 항목에 대해서만 effect 결과 기준으로 안내(중복 fetch 없음).
  useEffect(() => {
    if (isTourMode) return; // 투어 모드는 시드(makeTourBbExternalData)를 유지 — API 빈 결과로 덮어쓰지 않음
    if (detail.bb_entries.length === 0) return;
    const entries = detail.bb_entries;
    const seq = (optionReqSeq.current['bb-ext'] ?? 0) + 1;
    optionReqSeq.current['bb-ext'] = seq;
    setBbExternalLoading(true);
    Promise.all(entries.map((entry) => {
      const valid = isLoadingEditRef.current || (
        (BbProductOptions[entry.id] ?? []).includes(entry.product) &&
        (BbProductidOptions[entry.id] ?? []).includes(entry.process_id)
      );
      if (!valid || !entry.process_id) return Promise.resolve([] as PhotoStepOption[]);
      const cacheKey = `${entry.id}|${entry.location}|${entry.product}|${entry.process_id}`;
      const cached = bbExtCache.current[cacheKey];
      if (cached) return Promise.resolve(cached);
      return formOptionsAPI.getBbExternalData(entry).then((res) => { bbExtCache.current[cacheKey] = res; return res; });
    }))
      .then((results) => {
        if (optionReqSeq.current['bb-ext'] !== seq) return; // 더 최신 요청이 있으면 무시(stale)
        setBbExternalData(results);
        setActiveBbTab(0);
        entries.forEach((entry, i) => {
          const validNow = !!entry.process_id && (isLoadingEditRef.current || (BbProductidOptions[entry.id] ?? []).includes(entry.process_id));
          if (!validNow) return;
          const changed = bbExtPrevPid.current[entry.id] !== entry.process_id;
          bbExtPrevPid.current[entry.id] = entry.process_id;
          if (changed && !isLoadingEditRef.current) {
            addToast(
              results[i].length > 0 ? t('request.toast_bb_auto_fill', { count: results[i].length }) : t('request.toast_bb_no_data'),
              results[i].length > 0 ? 'info' : 'warning',
            );
          }
        });
      })
      .catch(() => { if (optionReqSeq.current['bb-ext'] === seq) setBbExternalData([]); })
      .finally(() => { if (optionReqSeq.current['bb-ext'] === seq) setBbExternalLoading(false); });
  }, [detail.bb_entries.map(e => `${e.id}|${e.location}|${e.product}|${e.process_id}`).join(','), BbProductOptions, BbProductidOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleDragEnd = () => {
      jayerDragInfo.current = null;
      oayerDragInfo.current = null;
    };
    document.addEventListener('mouseup', handleDragEnd);
    return () => document.removeEventListener('mouseup', handleDragEnd);
  }, []);

  // 언마운트 시 진행 중인 바코드 디바운스 타이머 정리(불필요한 setState 방지)
  useEffect(() => {
    const timers = barcodeDebounceTimers.current;
    return () => { Object.values(timers).forEach((tm) => clearTimeout(tm)); };
  }, []);

  // TBV/TLV 항목은 활성 O-layer의 TBV/TLV SD에만 유효하다. 해당 SD 행이 비활성화/삭제/변경되면
  // 그 항목을 영구 삭제하고(R-16), 선택 중이던 draft SD도 정리한다(복원해도 되돌아오지 않음 — 사용자 결정).
  useEffect(() => {
    const activeTbvtlvSds = new Set(
      oayerRows
        .filter((r) => !r.disabled && (r.sd.toUpperCase().includes('TBV') || r.sd.toUpperCase().includes('TLV')))
        .map((r) => r.sd)
    );
    setDetail((prev) => {
      const entries = prev.tbvtlv_entries ?? [];
      if (entries.length === 0) return prev;
      const pruned = entries
        .map((e) => ({ ...e, sds: e.sds.filter((sd) => activeTbvtlvSds.has(sd)) }))
        .filter((e) => e.sds.length > 0);
      let changed = pruned.length !== entries.length;
      if (!changed) {
        for (let i = 0; i < entries.length; i += 1) {
          if (entries[i].sds.length !== pruned[i].sds.length) { changed = true; break; }
        }
      }
      return changed ? { ...prev, tbvtlv_entries: pruned } : prev;
    });
    setTbvtlvSdsSelected((prev) => {
      const next = prev.filter((sd) => activeTbvtlvSds.has(sd));
      return next.length === prev.length ? prev : next;
    });
  }, [oayerRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // 편집 모드 (반려 재상신 or 지정 PL 수정 후 상신): 기존 문서 데이터 로드
  useEffect(() => {
    const targetDocId = editDocId ?? peerReviewDocId;
    if (!targetDocId) return;
    isLoadingEditRef.current = true;
    documentsAPI.get(targetDocId).then((res) => {
      const doc = res.data;
      setEditDocStatus(doc.status);
      try {
        const parsed = JSON.parse(doc.additional_notes ?? '{}');
        prevParsedRef.current = {
          detail: parsed.detail ?? {},
          jayerRows: parsed.jayerRows ?? [],
          oayerRows: parsed.oayerRows ?? [],
          bbRows: parsed.bbRows ?? [],
          history: parsed.history ?? [],
        };
        // 원본 의뢰자 보관 — 수정/재상신 시에도 최초 작성자 유지
        originalRequesterRef.current = {
          name: doc.requester_name ?? '',
          email: doc.requester_email ?? '',
          department: doc.requester_department ?? '',
        };
        // 검토자(지정 PL) 프리필: 이전 회차에 지정했던 PL 담당자를 상신 모달에 미리 채운다(수정 가능).
        const plSteps = (doc.approval_steps ?? []).filter((s) => s.agent === 'PL');
        if (plSteps.length > 0) {
          const maxPlRound = Math.max(...plSteps.map((s) => s.round ?? 1));
          const seen = new Set<string>();
          const prevDesignees = plSteps
            .filter((s) => (s.round ?? 1) === maxPlRound && s.assignee_loginid)
            .filter((s) => !seen.has(s.assignee_loginid!) && seen.add(s.assignee_loginid!))
            .map((s) => ({ loginid: s.assignee_loginid!, name: s.assignee_name ?? s.assignee_loginid! }));
          if (prevDesignees.length > 0) setDesignees(prevDesignees);
        }
        if (doc.production_date) setProductionDate(doc.production_date);
        // 구버전 저장 문서의 bb_entries에는 id가 없으므로 로드 시 백필(React key·매핑 식별 안정화).
        // 백필된 항목 목록은 아래 bbRows의 레거시 entryIdx → entryId 링크에도 사용한다.
        const loadedBbEntries: { id: string; location: string; product: string; process_id: string }[] =
          Array.isArray(parsed.detail?.bb_entries)
            ? parsed.detail.bb_entries.map((e: { id?: string; location: string; product: string; process_id: string }) => ({ ...e, id: e.id ?? genId() }))
            : [];
        // 변경전/변경후 표는 같은 인덱스끼리 짝을 이루어야 한다 — 이 규칙 도입 전 문서는 개수가
        // 다를 수 있어 로드 시점에 짧은 쪽을 채워 맞춘다.
        const loadedAdiCd = balanceAdiCdRows(
          parsed.detail?.adi_cd_before ?? [],
          parsed.detail?.adi_cd_after ?? []
        );
        if (parsed.detail) {
          // 구버전 문서는 other_purpose 가 문자열이므로 배열로 정규화(런타임 오류 방지)
          const normalizedOtherPurpose = Array.isArray(parsed.detail.other_purpose)
            ? parsed.detail.other_purpose
            : (parsed.detail.other_purpose ? [parsed.detail.other_purpose] : []);
          // 저장된 값이 실제 선택값(대상/비대상/해당없음)이면 그대로 살린다.
          // 레거시 문서(validation_system 필드 도입 전)는 판정 키워드가 없을 때만 '해당없음'으로
          // 백필하고, 키워드가 있으면 (2026-08) **미선택으로 두어 상신자가 직접 고르게 한다** —
          // 예전처럼 '대상'을 자동 백필하면 사용자가 판단하지 않은 값이 그대로 남는다.
          const savedVs = parsed.detail.validation_system as (ValidationSystemValue | undefined);
          const legacyAuto = autoValidationSystem(Array.isArray(parsed.jayerRows) ? parsed.jayerRows : []);
          const backfilledVs = savedVs === VS_TARGET || savedVs === VS_NONTARGET || savedVs === VS_NA
            ? savedVs
            : (legacyAuto === VS_NA ? VS_NA : VS_UNSELECTED);
          setDetail({ ...parsed.detail, other_purpose: normalizedOtherPurpose, bb_entries: loadedBbEntries, notifiers: parsed.detail.notifiers ?? [], validation_system: backfilledVs,
            // Merge 잠금 필드 도입 전 문서는 값이 없다 → 미Merge 로 백필한다.
            merge_ref_doc_id: parsed.detail.merge_ref_doc_id ?? null,
            merge_ref_doc_label: parsed.detail.merge_ref_doc_label ?? '',
            // 모드 도입 전 문서는 모두 '참조 있음' 이다. 확정 여부는 참조 문서 id 로 판단한다.
            merge_ref_mode: parsed.detail.merge_ref_mode ?? 'ref',
            merge_applied: parsed.detail.merge_applied ?? (parsed.detail.merge_ref_doc_id != null),
            // BEFORE/AFTER 비교 도입 전 문서도 같은 이유로 빈 배열 백필.
            // 행 id 도입 전 문서는 편집 키가 없으므로 로드 시 백필한다.
            merge_pairs: (parsed.detail.merge_pairs ?? []).map((pair: MergePair) => ({
              ...pair,
              id: pair.id ?? genId(),
              kind: deriveMergeKind(pair.before, pair.after),
            })),
            merge_unmatched_before: parsed.detail.merge_unmatched_before ?? [],
            merge_unmatched_after: parsed.detail.merge_unmatched_after ?? [],
            // ADI CD 변경 도입 전 문서는 값이 없다 → 같은 이유로 빈 값 백필.
            // (2026-08) 두 표는 같은 인덱스끼리 짝을 이루어야 하므로, 이 규칙 도입 전에 저장돼
            // 개수가 다를 수 있는 문서는 로드 시점에 짧은 쪽을 채워 맞춘다(값 삭제 없음).
            adi_cd_before: loadedAdiCd.before,
            adi_cd_after: loadedAdiCd.after,
            // '동일 변경 적용 대상' 도입 전 문서는 값이 없다 → 빈 배열 백필.
            adi_cd_extra_targets: parsed.detail.adi_cd_extra_targets ?? [],
            // prodc_scope 도입 전 문서는 값이 없다 → 저장된 리전 값으로 역추론해 백필한다.
            // (백필하지 않으면 '미선택' 게이트에 걸려 기존 C가문 문서의 입력이 잠겨 보인다)
            prodc_scope: parsed.detail.prodc_scope || inferProdcScope(parsed.detail),
            // MAP 삭제 도입 전 문서는 값이 없다 → 빈 문자열 백필(undefined 면 RichTextEditor 가 깨진다).
            map_change_reason: parsed.detail.map_change_reason ?? '',
          });
          // 불러온 문서의 값은 이미 확정된 판단이므로 자동 갱신으로 덮어쓰지 않는다.
          setVsManuallySet(true);
          setPostApprovers(Array.isArray(parsed.detail.post_approvers) ? parsed.detail.post_approvers : []);
          // 재상신·수정 시 이전 지정을 그대로 되살린다(작성자가 모달에서 바꿀 수 있다).
          const loadedSalesAgreers = Array.isArray(parsed.detail.sales_agreers) ? parsed.detail.sales_agreers : [];
          const loadedSalesAgreerNoneReason = parsed.detail.sales_agreer_none_reason ?? '';
          setSalesAgreers(loadedSalesAgreers);
          setSalesAgreerNoneReason(loadedSalesAgreerNoneReason);
          setSalesAgreerNone(loadedSalesAgreers.length === 0 && !!loadedSalesAgreerNoneReason.trim());
        }
        // 재선택 롤백용 스냅샷 복원 — 없으면 null(옛 문서는 매핑만 초기화된다).
        setMergeSnapshot(parsed.mergeSnapshot ?? null);
        if (parsed.jayerRows) {
          const fSets: FilterSet[] = (() => { try { return JSON.parse(localStorage.getItem('jayerFilterSets') ?? '[]'); } catch { return []; } })();
          const savedActiveIds: Set<string> = new Set(Array.isArray(parsed.jayerActiveFilterIds) ? parsed.jayerActiveFilterIds : []);
          setJayerActiveFilterIds(savedActiveIds);
          setJayerRows(parsed.jayerRows.map((r: JayerRow) => {
            const md = r.manuallyDisabled ?? r.disabled;
            // 옛 문서(loaded 없음)는 Update 날짜로 보정: 날짜는 백엔드 자동채움에서만 채워지므로
            // 수동 행을 잘못 잠그지 않는다.
            const loaded = r.loaded ?? !!r.updated?.trim();
            return { ...r, loaded, manuallyDisabled: md, disabled: calcDisabled({ ...r, manuallyDisabled: md }, fSets, savedActiveIds) };
          }));
        }
        if (parsed.oayerRows) {
          const fSets: FilterSet[] = (() => { try { return JSON.parse(localStorage.getItem('oayerFilterSets') ?? '[]'); } catch { return []; } })();
          const savedActiveIds: Set<string> = new Set(Array.isArray(parsed.oayerActiveFilterIds) ? parsed.oayerActiveFilterIds : []);
          setOayerActiveFilterIds(savedActiveIds);
          setOayerRows(parsed.oayerRows.map((r: OayerRow) => {
            const md = r.manuallyDisabled ?? r.disabled;
            const loaded = r.loaded ?? !!r.updated?.trim();
            return { ...r, loaded, manuallyDisabled: md, disabled: calcDisabled({ ...r, manuallyDisabled: md }, fSets, savedActiveIds) };
          }));
        }
        if (parsed.bbRows) {
          // bb_step → bb_layer 필드명 변경 호환: 구버전 저장 문서 지원
          // - 아주 구버전: bb_step = layerid 값 (bb_layer 없음) → bb_layer로 마이그레이션, 새 bb_step = ''
          // - 중간 버전: bb_layer 있음, bb_step 없음 → bb_step = ''
          // - 현재 버전: 둘 다 있음
          type LegacyBbRow = Omit<BbTableRow, 'bb_layer' | 'bb_step'> & { bb_layer?: string; bb_step?: string };
          setBbRows(parsed.bbRows.map((r: LegacyBbRow) => {
            const hasBbLayer = r.bb_layer != null;
            // 레거시 행(entryId 없음, entryIdx만)은 백필된 항목 id로 링크해 위치 비의존 색상/매핑을 재현한다.
            const entryId = r.entryId ?? (r.entryIdx != null ? loadedBbEntries[r.entryIdx]?.id : undefined);
            return {
              ...r,
              entryId,
              bb_layer: r.bb_layer ?? r.bb_step ?? '',
              bb_step: hasBbLayer ? (r.bb_step ?? '') : '',
            } as BbTableRow;
          }));
          const existingJayerIds = parsed.bbRows
            .map((row: BbTableRow) => row.sourceJayerRowId)
            .filter(Boolean);
          setMappedJayerRowIds(new Set(existingJayerIds));
        }
      } catch {
        // 저장된 JSON 파싱 실패 → 조용히 빈 폼으로 두면 저장/상신 시 기존 문서를 덮어쓸 위험이 있으므로 차단
        isLoadingEditRef.current = false;
        setLoadError(true);
        addToast(t('request.edit_load_failed'), 'error');
      }
    }).catch(() => {
      // 문서 조회(네트워크) 실패 → 동일하게 덮어쓰기 방지
      isLoadingEditRef.current = false;
      setLoadError(true);
      addToast(t('request.edit_load_failed'), 'error');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDocId, peerReviewDocId]);

  // 전체 가이드 투어: 부모(GuideTourStepPreview)가 보낸 명령 수신 — 실제 상태/핸들러로 시연
  useEffect(() => {
    if (!isTourMode) return;
    let activeTok: { cancelled: boolean } | null = null;
    let paused = false;
    const rawSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // 일시정지를 반영하는 sleep — paused 동안에는 경과 시간을 세지 않아 그 자리에서 멈추고, 재생 시 이어서 진행한다.
    const sleep = async (ms: number) => {
      let elapsed = 0;
      while (elapsed < ms) {
        if (paused) { await rawSleep(60); continue; }
        await rawSleep(60);
        elapsed += 60;
      }
    };

    const setJayerCellById = (id: string, field: keyof JayerRow, val: string) =>
      setJayerRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));

    const cellRect = (sel: string): DOMRect | null =>
      document.querySelector(sel)?.getBoundingClientRect() ?? null;
    // sel 위치로 커서 이동. scroll=true면 요소를 화면 안으로 스크롤해 잘리지 않게 한다.
    const moveCursor = async (sel: string, scroll = false) => {
      const el = document.querySelector(sel);
      if (el && scroll) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); await sleep(320); }
      const r = el?.getBoundingClientRect();
      if (r) setTourJCursor({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 });
      await sleep(480);
    };
    // 커서가 버튼을 '누르는' 연출: 버튼 눌림 효과 + 커서 클릭 리플
    const pressButton = async (sel: string) => {
      const el = document.querySelector(sel);
      setTourJClicking(true);
      el?.classList.add('tour-pressed');
      await sleep(300);
      el?.classList.remove('tour-pressed');
      setTourJClicking(false);
    };
    const showChip = (sel: string, kind: 'copy' | 'paste') => {
      const r = cellRect(sel);
      if (r) setTourJChip({ kind, x: r.right + 8, y: r.top - 6 });
    };

    // J-ayer: 실제 표 위에서 커서 이동 → 1행 입력 → 복사(Ctrl+C) → 아래로 드래그 선택 →
    // 붙여넣기(Ctrl+V) → step·item_id(바코드) 자동 채움까지 직접 연출한다.
    const runJayerAnim = async (tok: { cancelled: boolean }) => {
      const seed = makeTourJayerRows();
      setJayerRows(seed);
      setTourJChip(null);
      jayerCellSel.clearCellSelection();
      await sleep(650); if (tok.cancelled) return;

      await moveCursor('[data-jtour="product_name-0"]'); if (tok.cancelled) return;
      setJayerCellById(seed[0].id, 'product_name', TOUR_JAYER_PRODUCT);
      await sleep(550); if (tok.cancelled) return;

      // 복사
      jayerCellSel.selectCells([{ rowId: seed[0].id, col: 'product_name' }]);
      showChip('[data-jtour="product_name-0"]', 'copy');
      await sleep(950); if (tok.cancelled) return;
      setTourJChip(null);
      await sleep(250); if (tok.cancelled) return;

      // 아래로 드래그 선택
      for (let i = 1; i < seed.length; i += 1) {
        await moveCursor(`[data-jtour="product_name-${i}"]`); if (tok.cancelled) return;
        jayerCellSel.selectCells(seed.slice(1, i + 1).map((r) => ({ rowId: r.id, col: 'product_name' })));
        await sleep(260); if (tok.cancelled) return;
      }

      // 붙여넣기
      showChip(`[data-jtour="product_name-${seed.length - 1}"]`, 'paste');
      await sleep(550); if (tok.cancelled) return;
      for (let i = 1; i < seed.length; i += 1) {
        setJayerCellById(seed[i].id, 'product_name', TOUR_JAYER_PRODUCT);
        await sleep(200); if (tok.cancelled) return;
      }
      setTourJChip(null);
      jayerCellSel.clearCellSelection();
      await sleep(450); if (tok.cancelled) return;

      // step → item_id(바코드) 자동 채움
      for (let i = 0; i < seed.length; i += 1) {
        setJayerCellById(seed[i].id, 'step', TOUR_JAYER_STEPS[i]);
        setJayerCellById(seed[i].id, 'item_id', TOUR_JAYER_ITEMS[i]);
        await sleep(300); if (tok.cancelled) return;
      }
      await sleep(400);
      setTourJCursor(null);
    };

    // BB 자동 채움(설명): 패널 열기만 — 적용은 별도 단계에서 커서로 직접 누른다.
    const runBbAutofillOpen = async (tok: { cancelled: boolean }) => {
      setShowAutoFillPanel(false);
      setBbRows([]);
      setMappedJayerRowIds(new Set());
      setActiveBbTab(0);
      setTourJCursor(null);
      setTourJClicking(false);
      await sleep(500); if (tok.cancelled) return;
      tourRef.current?.handleOpenAutoFillPanel();   // 범위 1개 시드(10~50, BB제품1)
    };

    // BB 자동 채움(적용): 커서를 '적용' 버튼으로 이동(스크롤로 보이게) → 눌러서 BB제품1 3행 생성
    const runBbAutofillApply = async (tok: { cancelled: boolean }) => {
      await sleep(400); if (tok.cancelled) return;
      await moveCursor('[data-bbtour="autofill-apply"]', true); if (tok.cancelled) return;
      await sleep(250); if (tok.cancelled) return;
      await pressButton('[data-bbtour="autofill-apply"]'); if (tok.cancelled) return;
      tourRef.current?.handleApplyAutoFill();        // BB제품1 3행 생성
      await sleep(700);
      setTourJCursor(null);
    };

    // BB 매핑: 커서로 BB제품2 탭 클릭 → 원본 행(Layer 40·50) 선택 → 외부데이터 매핑 → 적용(아래에 BB제품2 행 추가)
    const runBbMapping = async (tok: { cancelled: boolean }) => {
      setTourJCursor(null);
      await sleep(500); if (tok.cancelled) return;
      // 외부 데이터 탭을 커서로 BB제품2로 전환하는 모습
      await moveCursor('[data-bbtour="bbtab-1"]'); if (tok.cancelled) return;
      setActiveBbTab(1);
      await sleep(500); if (tok.cancelled) return;

      const mapOne = async (layer: string): Promise<boolean> => {
        const target = tourRef.current?.jayerRows.find((r) => !r.disabled && r.layerid === layer);
        const ext = tourRef.current?.bbExternalData[1]?.find((s) => s.layerid === layer);
        if (!target || !ext) return false;
        await moveCursor(`[data-bbtour="jrow-${layer}"]`); if (tok.cancelled) return false;
        setSelectedJayerRowId(target.id);
        await sleep(500); if (tok.cancelled) return false;
        await moveCursor(`[data-bbtour="ext-${layer}"]`); if (tok.cancelled) return false;
        tourRef.current?.handleStageMapping({
          id: `tour-ext-${layer}`,
          bb_process_id: ext.processid,
          bb_name: 'BB제품2',
          bb_step: ext.descript,
          bb_ss: ext.stepseq,
          layerid: ext.layerid,
        });
        await sleep(700);
        return true;
      };

      if (!(await mapOne('40'))) return;
      if (tok.cancelled) return;
      await mapOne('50');
      if (tok.cancelled) return;

      await moveCursor('[data-bbtour="map-apply"]', true); if (tok.cancelled) return;
      await sleep(250); if (tok.cancelled) return;     // 적용 버튼 위에서 잠깐 멈춤
      await pressButton('[data-bbtour="map-apply"]'); if (tok.cancelled) return;
      tourRef.current?.handleApplyMappings();          // BB제품2 2행 추가 → 결과표에 두 제품 모두 반영
      await sleep(700);
      setTourJCursor(null);
    };

    const openSubmitDemo = () => {
      setSubmitNote(t('guide.tour.steps.request.flow.submit_note_sample'));
      setDesignees([{ loginid: 'tour-reviewer', name: t('guide.tour.steps.request.flow.submit_designee_sample') }]);
      setConfirmOpen(true);
    };

    // 챕터 되감기(seek) 즉시 복원: 부모(프리뷰)가 정주행 중 캡처해 둔 스냅샷을 주입한다.
    const applySnapshot = (s: TourSnapshot) => {
      setStep(s.step);
      setDetail(s.detail);
      setJayerRows(s.jayerRows);
      setBbRows(s.bbRows);
      setOayerInfoTab(s.oayerInfoTab);
      setShowAutoFillPanel(s.showAutoFillPanel);
      setBbAutoFillRanges(s.bbAutoFillRanges);
      setStagedMappings(s.stagedMappings);
      setMappedJayerRowIds(new Set(s.mappedJayerRowIds));
      setActiveBbTab(s.activeBbTab);
      setConfirmOpen(s.confirmOpen);
      setSubmitNote(s.submitNote);
      setDesignees(s.designees);
      // 임시 커서/칩 오버레이는 항상 정리
      setTourJCursor(null);
      setTourJChip(null);
      setTourJClicking(false);
    };

    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== 'guide-tour-cmd') return;
      // 일시정지/재생은 진행 중인 데모를 취소하지 않고 paused 플래그만 토글한다.
      if (d.cmd === 'pause') { paused = true; return; }
      if (d.cmd === 'resume') { paused = false; return; }
      // 스냅샷 요청: 현재 투어 상태를 부모(프리뷰)로 회신한다(진행 중 데모 취소 안 함).
      if (d.cmd === 'snapshot') {
        window.parent?.postMessage(
          { type: 'guide-tour-state', index: d.index, state: snapStateRef.current },
          window.location.origin,
        );
        return;
      }
      if (activeTok) activeTok.cancelled = true;
      const tok = { cancelled: false };
      activeTok = tok;

      switch (d.cmd) {
        case 'step':
          setConfirmOpen(false);
          setShowAutoFillPanel(false);
          setTourJCursor(null);
          setTourJChip(null);
          setTourJClicking(false);
          if (typeof d.step === 'number') setStep(Math.min(5, Math.max(1, d.step)));
          break;
        case 'restore':
          // 부모가 보낸 스냅샷으로 그 챕터의 정확한 상태를 즉시 복원
          if (d.state) applySnapshot(d.state as TourSnapshot);
          break;
        // 참조 요청서 Merge 블록은 Merge 사용 기타 목적을 골라야 열린다.
        case 'merge-demo':
          setDetail((dd) => ({ ...dd, other_purpose: [TOUR_MERGE_PURPOSE] }));
          break;
        // ADI CD 변경 표(행 단위 '미등록' 포함)를 연다. ADI CD 변경은 요청 목적이라 이 값이 켜져 있는
        // 동안은 request_purpose 도 함께 바뀐다 — 다음 'purpose-reset' 에서 시드 값으로 되돌린다.
        case 'adi-demo':
          setDetail((dd) => ({
            ...dd,
            request_purpose: ADI_CD_CHANGE_PURPOSE,
            adi_cd_before: makeTourAdiCdBefore(),
            adi_cd_after: makeTourAdiCdAfter(),
          }));
          break;
        // 기타 목적/ADI CD 변경 시연을 끝내고 Step1 을 시드 상태로 되돌린다(이후 단계에 영향이 없도록).
        case 'purpose-reset':
          setDetail((dd) => ({
            ...dd,
            request_purpose: makeTourDetail().request_purpose,
            other_purpose: [],
            adi_cd_before: [],
            adi_cd_after: [],
          }));
          break;
        // Validation System 은 자동 선택되지 않는다 — 상신자가 직접 '대상'을 고르는 장면.
        case 'vs-select':
          setVsManuallySet(true);
          setDetail((dd) => ({ ...dd, validation_system: VS_TARGET }));
          break;
        case 'map-reset':
          setDetail((dd) => ({
            ...dd,
            map_type: 'NEW',
            only_prodc: 'No',
            final_yn: '',
            final_entries: [],
            map_change: MAP_NO_CHANGE,
            map_value_x: '',
            map_value_y: '',
            map_reason: '',
            ea_change: EA_NO_CHANGE,
            // 바로 위에서 map_type='NEW'·only_prodc='No' 로 되돌리므로 300 이다
            ea_value: eaDefaultValue('No'),
            mshot_change: '없음',
          }));
          break;
        case 'map-deviation':
          setDetail((dd) => ({ ...dd, map_change: '변경 있음', map_value_x: '1.2', map_value_y: '0.8', map_reason: '신규 라인 보정' }));
          break;
        case 'map-exception':
          setDetail((dd) => ({ ...dd, ea_change: '변경 있음', ea_value: '예외구역 A' }));
          break;
        case 'map-xmark':
          setDetail((dd) => ({ ...dd, mshot_change: '추가' }));
          break;
        case 'jayer-anim':
          runJayerAnim(tok);
          break;
        case 'oayer-table':
          setOayerInfoTab('table');
          break;
        case 'oayer-info':
          setOayerInfoTab('info');
          break;
        case 'bb-autofill-open':
          runBbAutofillOpen(tok);
          break;
        case 'bb-autofill-apply':
          runBbAutofillApply(tok);
          break;
        case 'bb-mapping':
          runBbMapping(tok);
          break;
        case 'open-submit':
          openSubmitDemo();
          break;
        case 'submitted':
          setConfirmOpen(false);
          addToast(t('guide.tour.steps.request.flow.submitted_toast'), 'success');
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (activeTok) activeTok.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTourMode]);

  // 동료 PL 지정 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (designeeContainerRef.current && !designeeContainerRef.current.contains(e.target as Node)) {
        setDesigneeDropdownOpen(false);
        setDropdownRect(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 통보자 지정 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifierContainerRef.current && !notifierContainerRef.current.contains(e.target as Node)) {
        setNotifierDropdownOpen(false);
        setNotifierDropdownRect(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 후결자 지정 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (postApproverContainerRef.current && !postApproverContainerRef.current.contains(e.target as Node)) {
        setPostApproverDropdownOpen(false);
        setPostApproverDropdownRect(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 영업/기술지원 합의자 지정 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (salesAgreerContainerRef.current && !salesAgreerContainerRef.current.contains(e.target as Node)) {
        setSalesAgreerDropdownOpen(false);
        setSalesAgreerDropdownRect(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 지정 PL 추가/제거 (다중, 전원 합의)
  const addDesignee = (u: UserWithRole) => {
    setDesignees((prev) =>
      prev.some((d) => d.loginid === u.loginid)
        ? prev
        : [...prev, { loginid: u.loginid, name: `${u.name} (${u.deptname})` }]
    );
    setDesigneeError('');
  };
  const removeDesignee = (loginid: string) => {
    setDesignees((prev) => prev.filter((d) => d.loginid !== loginid));
  };

  // 통보자 추가/제거 — detail.notifiers(폼 상태)에 반영되어 상신 시 함께 저장된다.
  const addNotifier = (u: UserWithRole) => {
    setDetail((prev) =>
      (prev.notifiers ?? []).some((n) => n.loginid === u.loginid)
        ? prev
        : { ...prev, notifiers: [...(prev.notifiers ?? []), { loginid: u.loginid, name: u.name }] }
    );
  };
  const removeNotifier = (loginid: string) => {
    setDetail((prev) => ({ ...prev, notifiers: (prev.notifiers ?? []).filter((n) => n.loginid !== loginid) }));
  };

  // 현재 통보처 중 이메일 미등록(발송 제외) 대상 — 통보처 후보 목록(mail 포함)으로 판별
  const noMailNotifiers = (detail.notifiers ?? []).filter((n) => {
    const u = notifierUserOptions.find((o) => o.loginid === n.loginid);
    return u ? !u.mail : false;
  });

  // 주소록 불러오기 — 현재 통보처를 주소록 구성원으로 '덮어쓰기'
  const applyAddressBook = (book: AddressBook) => {
    setDetail((prev) => ({
      ...prev,
      notifiers: book.members.map((m) => ({ loginid: m.loginid, name: m.name })),
    }));
    setAbLoadOpen(false);
    const noMail = book.members.filter((m) => !m.has_mail).length;
    if (noMail > 0) {
      addToast(t('addressbook.warn_no_mail', { count: noMail }), 'warning');
    }
    addToast(t('addressbook.loaded', { name: book.name }), 'success');
  };
  // 나만의 그룹 불러오기 — 그룹 멤버를 현재 통보처에 '추가'한다.
  // 주소록(loadAddressBook)은 세트 교체가 목적이라 덮어쓰지만, 그룹은 여러 개를 겹쳐
  // 넣을 수 있어야 하므로 append 하고 이미 담긴 사람과 본인은 건너뛴다.
  const loadNotifierGroup = (group: UserGroup) => {
    const existing = new Set((detail.notifiers ?? []).map((n) => n.loginid));
    const added = group.members.filter(
      (m) => m.loginid !== currentUser.username && !existing.has(m.loginid)
    );
    setGroupLoadOpen(false);
    setGroupLoadRect(null);
    setGroupLoadQuery('');
    if (added.length === 0) {
      addToast(t('request.notifier_group_none_added', { name: group.name }), 'warning');
      return;
    }
    setDetail((prev) => ({
      ...prev,
      notifiers: [...(prev.notifiers ?? []), ...added.map((m) => ({ loginid: m.loginid, name: m.name }))],
    }));
    const noMail = added.filter((m) => !m.mail).length;
    if (noMail > 0) {
      addToast(t('addressbook.warn_no_mail', { count: noMail }), 'warning');
    }
    addToast(t('request.notifier_group_loaded', { name: group.name, count: added.length }), 'success');
  };

  const loadAddressBook = (book: AddressBook) => {
    if ((detail.notifiers ?? []).length > 0) {
      setAbConfirm({
        message: t('addressbook.load_overwrite_confirm', { name: book.name, cur: (detail.notifiers ?? []).length, next: book.member_count }),
        onConfirm: () => applyAddressBook(book),
      });
    } else {
      applyAddressBook(book);
    }
  };

  // 주소록으로 저장 — 기존 선택 시 덮어쓰기(확인), 새 이름이면 신규 생성
  const persistAddressBook = async (mode: 'create' | 'update', idOrName: number | string) => {
    const members = (detail.notifiers ?? []).map((n) => ({ loginid: n.loginid, name: n.name }));
    try {
      if (mode === 'update') {
        await addressBooksAPI.update(idOrName as number, { members });
      } else {
        await addressBooksAPI.create(idOrName as string, members);
      }
      setAddressBooks(await addressBooksAPI.list());
      setAbSaveOpen(false);
      setAbSaveNewName('');
      setAbSaveMode('new');
      addToast(t('addressbook.saved'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
    }
  };
  const saveAddressBook = () => {
    if ((detail.notifiers ?? []).length === 0) {
      addToast(t('addressbook.empty_save'), 'warning');
      return;
    }
    if (abSaveMode !== 'new') {
      const book = addressBooks.find((b) => b.id === abSaveMode);
      if (!book) return;
      setAbConfirm({
        message: t('addressbook.save_overwrite_confirm', { name: book.name, count: (detail.notifiers ?? []).length }),
        onConfirm: () => persistAddressBook('update', book.id),
      });
      return;
    }
    const name = abSaveNewName.trim();
    if (!name) {
      addToast(t('addressbook.name_required'), 'warning');
      return;
    }
    const dup = addressBooks.find((b) => b.name === name);
    if (dup) {
      setAbConfirm({
        message: t('addressbook.save_overwrite_confirm', { name: dup.name, count: (detail.notifiers ?? []).length }),
        onConfirm: () => persistAddressBook('update', dup.id),
      });
    } else {
      persistAddressBook('create', name);
    }
  };
  // Derived booleans for Step 1 conditional rendering
  const isMapRegistered = isMapRegisteredType(detail.map_type);
  const isOnlyMap = detail.request_purpose === ONLY_MAP_PURPOSE;
  // 'MAP 삭제': Only MAP 과 동일하게 MAP 정보만 작성한다(J/O/Backbone 비움 + Step1 부가항목 잠금).
  const isMapDeleteEdit = detail.request_purpose === MAP_DELETE_EDIT_PURPOSE;
  // Step1 부가 입력(기타 목적·흐름도·Backbone·참조 요청서) 잠금 + STEP3~5 비움 대상 목적.
  const isMapOnlyScope = isOnlyMap || isMapDeleteEdit;
  // '요청 목적 > ADI CD 변경' — MAP 정보까지 포함해 STEP1 의 ADI CD 표 외에는 아무것도 작성하지
  // 않는다(기타 목적도 선택할 수 없다). 다른 요청 목적과 동시 선택은 불가능하다(요청 목적은 단일값).
  const isAdiCdChange = detail.request_purpose === ADI_CD_CHANGE_PURPOSE;
  // Step1 부가 입력을 잠그는 대상 전체(MAP 전용 두 목적 + ADI CD 변경).
  const isStep1OnlyScope = isMapOnlyScope || isAdiCdChange;
  // (2026-08) 이 목적들은 J-ayer·O-ayer·Backbone 을 아예 작성하지 않는다. 예전에는 그 단계들에
  // 들어가 입력까지 할 수 있었지만 저장 시 전부 버려져(빈 배열) 혼란을 줬다 — 이제 단계 자체를
  // 막고 마지막으로 작성하는 단계에서 바로 상신한다.
  // ADI CD 변경은 MAP 정보(2단계)도 작성하지 않으므로 STEP1 에서 바로 상신한다.
  const lastStep = isAdiCdChange ? 1 : (isMapOnlyScope ? STEP_MAP_INFO : STEP_LAST);
  /** 이 의뢰서에서 들어갈 수 없는 단계(인디케이터에 흐리게 표시) */
  const disabledSteps = useMemo(
    () => Array.from({ length: STEP_LAST - lastStep }, (_, i) => lastStep + 1 + i),
    [lastStep],
  );
  // StepMap 에서 '수정'/'삭제' 를 고른 상태 — 이유 입력칸만 남기고 나머지 MAP 블록은 숨긴다.
  const isMapReasonMode = isMapDeleteEditType(detail.map_type);
  // '연구소 제품'(Only MAP 전용) — 선택 시 기존 C가문 후결자 기능이 그대로 켜진다.
  const isLabProduct = detail.other_purpose.includes(OTHER_PURPOSE_LAB);
  // 상신 시 후결자 지정이 필수인가 — C가문 또는 연구소 제품.
  // (결재 경로·후결자 생성 로직은 그대로이고, 이 '문을 여는 조건'만 넓힌 것이다)
  // (isProdc 는 아래에서 선언되므로 TDZ 를 피해 detail 로 직접 판정한다)
  const requiresPostApprover = detail.only_prodc === 'Yes' || isLabProduct;
  // 상신 시 영업/기술지원 합의자 지정이 필수인가 — 예외 구역을 '변경 있음'으로 두고
  // 값까지 기본값(일반 300 / C가문 500)과 다르게 바꿨을 때.
  // 백엔드 RequestDocument.requires_sales_agreer 와 같은 기준이어야 한다.
  const requiresSalesAgreer =
    detail.ea_change === EA_HAS_CHANGE
    && !!detail.ea_value?.trim()
    && detail.ea_value.trim() !== eaDefaultValue(detail.only_prodc);
  // ADI CD 변경 표(STEP1 인라인)를 보여줄지 — 이제 요청 목적 자체이므로 isAdiCdChange 와 같다.
  const isAdiCdSelected = isAdiCdChange;
  const hasMapChange = detail.map_change === '변경 있음';
  const hasEaChange = detail.ea_change === EA_HAS_CHANGE;
  const isProdc = detail.only_prodc === 'Yes';
  // ===== C가문 '제품 해당 위치'(prodc_scope) 파생 판정 =====
  // 게이트: 위치를 고르기 전에는 C가문 하위 입력(판별 정보·지도편차·X표시 이미지)을 전부 잠근다.
  const prodcScopeSet = !!detail.prodc_scope;
  const isOnlyTopScope = detail.prodc_scope === 'only_top';
  const isOnlyBottomScope = detail.prodc_scope === 'only_bottom';
  /** ONLY 스코프에서 '쓰지 않는' 리전인가 — 값 초기화·잠금·필수해제 대상 */
  const prodcRegionOff = (region: CRegion) =>
    (isOnlyTopScope && region !== 'top') || (isOnlyBottomScope && region !== 'bottom');
  /** 게이트 + ONLY 스코프 + CLONE/EXISTING 을 합친 리전 최종 잠금 판정 */
  const prodcLocked = (region: CRegion) =>
    isMapRegistered || !prodcScopeSet || prodcRegionOff(region);
  /** 리전 지도편차가 실제로 '변경 있음'으로 살아있는가(X/Y 입력·필수 판정의 기준) */
  const regionHasMapChange = (region: 'top' | 'bottom') =>
    !prodcRegionOff(region) && detail[`map_change_${region}`] === '변경 있음';
  const anyRegionMapChange = regionHasMapChange('top') || regionHasMapChange('bottom');
  const mshotDeleteMode = detail.mshot_change === '삭제';
  const mshotEditAddMode = detail.mshot_change === '추가' || detail.mshot_change === '수정';
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
  const handleImagePaste = async (e: React.ClipboardEvent<HTMLDivElement>, fieldName: 'mshot_image_copy' | 'mshot_image_copy_top' | 'mshot_image_copy_bottom') => {
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
              [fieldName]: result.path
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

  const handleDetailSet = (name: string, value: string | string[]) => {
    isLoadingEditRef.current = false; // 사용자 상호작용 시 로드 가드 해제
    setDetail((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  /** 'Only MAP'/'MAP 삭제'/'ADI CD 변경' 전환 시 지워질 값이 하나라도 있는가 (확인 모달 노출 판정) */
  const mapOnlyScopeHasData = (): boolean =>
    detail.other_purpose.length > 0 ||
    !!detail.change_purpose_note?.trim() ||
    detail.flow_chart.some((r) => Object.entries(r).some(([k, v]) => k !== 'id' && !!String(v ?? '').trim())) ||
    detail.bb_entries.some((e) => !!e.location?.trim() || !!e.product?.trim() || !!e.process_id?.trim()) ||
    refDocId !== null ||
    postApprovers.length > 0;

  /** 'ADI CD 변경' 진입 시에만 추가로 검사 — MAP 정보(StepMap 소유 필드)가 기본값과 다르면 지워진다. */
  const mapInfoHasData = (): boolean => {
    const defaults = mapInfoDefaults();
    return (Object.keys(defaults) as (keyof DetailFormState)[]).some((k) => {
      const cur = detail[k];
      const def = defaults[k];
      if (Array.isArray(cur) || Array.isArray(def)) return (cur as unknown[])?.length > 0;
      return String(cur ?? '') !== String(def ?? '');
    });
  };

  const handleRequestPurposeSelect = (val: string) => {
    if (val === detail.request_purpose) return;
    // Only MAP / MAP 삭제 / ADI CD 변경 으로 바꾸면 Step1 부가항목과 J/O/Bb 가 초기화되므로 확인을 받는다.
    // (지울 값이 아예 없으면 모달 없이 바로 적용 — 기존 Only MAP 동작과 동일한 판단)
    if (val === ONLY_MAP_PURPOSE || val === MAP_DELETE_EDIT_PURPOSE || val === ADI_CD_CHANGE_PURPOSE) {
      const hasData = mapOnlyScopeHasData() || (val === ADI_CD_CHANGE_PURPOSE && mapInfoHasData());
      if (detail.request_purpose && hasData) {
        setOnlyMapConfirm({ targetPurpose: val });
        return;
      }
      applyMapOnlyScope(val);
      return;
    }
    // Only MAP → 다른 목적: '연구소 제품'과 지정 후결자는 Only MAP 전용이라 함께 해제한다.
    // MAP 삭제 → 다른 목적: map_type('삭제' 고정값)과 작성한 삭제 이유도 함께 해제한다.
    if (isMapOnlyScope && (isLabProduct || postApprovers.length > 0 || isMapDeleteEdit)) {
      setOnlyMapConfirm({ targetPurpose: val });
      return;
    }
    // ADI CD 변경 → 다른 목적: 표에 입력한 값이 있으면 확인을 받는다(기존 '해제' 동작과 동일한 판단).
    if (isAdiCdChange && adiCdHasData()) {
      setOnlyMapConfirm({ targetPurpose: val });
      return;
    }
    handleDetailSet('request_purpose', val);
  };

  /**
   * 'Only MAP'/'MAP 삭제'/'ADI CD 변경' 적용 → 라인/조합법/제품/조리법/고객/요구사항/생산일을 제외한 Step1 항목 초기화.
   * 세 목적 모두 최소한 StepMap 정보까지만(또는 그보다 더 적게) 작성하므로 초기화 범위가 겹친다.
   */
  const applyMapOnlyScope = (purpose: string) => {
    setDetail((prev) => ({
      ...prev,
      request_purpose: purpose,
      other_purpose: INITIAL_DETAIL.other_purpose,
      flow_chart: [makeRow()],
      change_purpose_note: INITIAL_DETAIL.change_purpose_note,
      bb_entries: INITIAL_DETAIL.bb_entries.map((e) => ({ ...e })),
      // StepMap 정보까지만 필요 → O-layer 정보 탭(partial_shot/TBV·TLV) 초기화
      partial_shot: INITIAL_DETAIL.partial_shot,
      tbvtlv_thickness: INITIAL_DETAIL.tbvtlv_thickness,
      tbvtlv_entries: [],
      // MAP 삭제 는 후보가 '삭제' 하나뿐이라 자동 고정한다(2026-08).
      // 이유는 새로 입력해야 하므로 비운다. Only MAP 은 기존대로 손대지 않는다.
      ...(purpose === MAP_DELETE_EDIT_PURPOSE
        ? { map_type: MAP_TYPE_DELETE_REQ, map_change_reason: INITIAL_DETAIL.map_change_reason }
        : {}),
      // ADI CD 변경은 MAP 정보 자체가 필요 없다 — StepMap 이 아예 렌더되지 않으므로 진입 시
      // 한 번만 초기화하면 이후 사용자가 값을 바꿀 방법이 없다. 변경전/변경후 표는 빈 템플릿으로 시작.
      ...(purpose === ADI_CD_CHANGE_PURPOSE
        ? {
            ...mapInfoDefaults(),
            adi_cd_before: Array.from({ length: ADI_CD_TEMPLATE_ROWS }, () => makeAdiCdStep()),
            adi_cd_after: Array.from({ length: ADI_CD_TEMPLATE_ROWS }, () => makeAdiCdStep()),
            adi_cd_extra_targets: [],
          }
        : {}),
    }));
    setAdiCdTargetDraft({ partid_selection: '', process_id: '' });
    setRefDocId(null);
    setRefDocLabel('');
    setRefJayerRows([]);
    setRefOayerRows([]);
    // 후결자는 '연구소 제품'(Only MAP 전용)에 딸린 값이라 목적을 바꾸면 함께 비운다.
    setPostApprovers([]);
    // StepMap 정보까지만 필요 → J-layer/O-layer/Backbone 표 데이터 비우기
    // (빈 행 1개를 남기면 활성 행으로 취급돼 st/new_or_copy 필수 검증에 걸린다 — bbRows처럼 완전히 비운다)
    setJayerRows([]);
    setOayerRows([]);
    setBbRows([]);
    setBbExternalData([]);
    setMappedJayerRowIds(new Set());
    setStagedMappings({});
    setSelectedJayerRowId(null);
    setJayerChecked(new Set());
    setOayerChecked(new Set());
    setBbChecked(new Set());
    setErrors((prev) => ({ ...prev, request_purpose: '', bb_entries: '' }));
  };

  /** Only MAP/MAP 삭제/ADI CD 변경 에서 벗어날 때 — 전용 값만 정리한다
   *  ('연구소 제품'·후결자, MAP 삭제의 map_type·이유, ADI CD 변경전/변경후 표). */
  const applyLeaveMapOnlyScope = (purpose: string) => {
    setDetail((prev) => ({
      ...prev,
      request_purpose: purpose,
      other_purpose: prev.other_purpose.filter((o) => o !== OTHER_PURPOSE_LAB),
      // MAP 삭제 진입 시 자동 고정됐던 map_type('삭제')과 작성한 이유는 다른 목적에서 의미가 없으므로 비운다.
      ...(prev.request_purpose === MAP_DELETE_EDIT_PURPOSE
        ? { map_type: INITIAL_DETAIL.map_type, map_change_reason: INITIAL_DETAIL.map_change_reason }
        : {}),
      ...(prev.request_purpose === ADI_CD_CHANGE_PURPOSE
        ? {
            adi_cd_before: INITIAL_DETAIL.adi_cd_before,
            adi_cd_after: INITIAL_DETAIL.adi_cd_after,
            adi_cd_extra_targets: INITIAL_DETAIL.adi_cd_extra_targets,
          }
        : {}),
    }));
    setAdiCdTargetDraft({ partid_selection: '', process_id: '' });
    setPostApprovers([]);
    setErrors((prev) => ({ ...prev, request_purpose: '' }));
  };

  const handleOnlyMapConfirm = () => {
    if (!onlyMapConfirm) return;
    const target = onlyMapConfirm.targetPurpose;
    // 진입(Only MAP·MAP 삭제·ADI CD 변경)이면 전체 초기화, 이탈이면 전용 값만 정리한다.
    if (target === ONLY_MAP_PURPOSE || target === MAP_DELETE_EDIT_PURPOSE || target === ADI_CD_CHANGE_PURPOSE) applyMapOnlyScope(target);
    else applyLeaveMapOnlyScope(target);
    setOnlyMapConfirm(null);
  };

  const handleMapTypeSelect = (val: string) => {
    if (val === detail.map_type) return;
    // 이미 선택된 map_type이 있으면 "어느 값으로 바꾸든" 초기화 모달을 띄운다(R-13).
    // (기존엔 CLONE/EXISTING 전환만 초기화해 NEW로 바꿀 때 원본 등 StepMap 값이 잔존하던 버그 수정)
    if (detail.map_type) {
      setMapTypeChangeConfirm({ targetType: val });
      return;
    }
    // 첫 선택은 초기화할 것이 없으므로 바로 적용.
    // 잠기는 칸 중 리전별 지도편차는 map_type 이 기본값을 정한다 — CLONE/EXISTING 이면 '변경 없음',
    // 그 외에는 '변경 있음'. 예외구역은 map_type 과 무관하게 only_prodc 기준 300/500 그대로다.
    setDetail((prev) => ({
      ...prev,
      map_type: val,
      map_change_top: regionMapChangeDefault(val),
      map_change_bottom: regionMapChangeDefault(val),
      ...(prev.ea_change === EA_NO_CHANGE ? { ea_value: eaDefaultValue(prev.only_prodc) } : {}),
    }));
    if (errors['map_type']) setErrors((prev) => ({ ...prev, map_type: '' }));
  };

  const handleMapTypeChangeConfirm = () => {
    if (!mapTypeChangeConfirm) return;
    const newType = mapTypeChangeConfirm.targetType;
    // StepMap(원본·C가문·지도편차·예외구역·X표시·Map Option·Final) 필드만 초기화한다.
    // Step1/3/4/5 데이터(라인·뼈찜·partial_shot·tbvtlv 등)는 보존한다.
    // 리전별 지도편차의 기본값은 새 map_type 이 정한다(regionMapChangeDefault). 예외구역은
    // map_type 과 무관하게 only_prodc 기준(eaDefaultValue)으로 계산하며, only_prodc 도 함께
    // 초기화되므로 그 초기값(No) 기준인 300이 들어간다.
    setDetail((prev) => ({
      ...prev,
      map_type: newType,
      source_line: INITIAL_DETAIL.source_line,
      source_partid: INITIAL_DETAIL.source_partid,
      map_change: INITIAL_DETAIL.map_change,
      map_value_x: INITIAL_DETAIL.map_value_x,
      map_value_y: INITIAL_DETAIL.map_value_y,
      map_reason: INITIAL_DETAIL.map_reason,
      map_change_top: regionMapChangeDefault(newType),
      map_value_x_top: INITIAL_DETAIL.map_value_x_top,
      map_value_y_top: INITIAL_DETAIL.map_value_y_top,
      map_change_bottom: regionMapChangeDefault(newType),
      map_value_x_bottom: INITIAL_DETAIL.map_value_x_bottom,
      map_value_y_bottom: INITIAL_DETAIL.map_value_y_bottom,
      ea_change: INITIAL_DETAIL.ea_change,
      ea_value: eaDefaultValue(INITIAL_DETAIL.only_prodc),
      only_prodc: INITIAL_DETAIL.only_prodc,
      prodc_scope: INITIAL_DETAIL.prodc_scope,
      prodc_top_line: INITIAL_DETAIL.prodc_top_line,
      prodc_top_process: INITIAL_DETAIL.prodc_top_process,
      prodc_top_product: INITIAL_DETAIL.prodc_top_product,
      prodc_middle_use: INITIAL_DETAIL.prodc_middle_use,
      prodc_middle_line: INITIAL_DETAIL.prodc_middle_line,
      prodc_middle_process: INITIAL_DETAIL.prodc_middle_process,
      prodc_middle_product: INITIAL_DETAIL.prodc_middle_product,
      prodc_bottom_line: INITIAL_DETAIL.prodc_bottom_line,
      prodc_bottom_process: INITIAL_DETAIL.prodc_bottom_process,
      prodc_bottom_product: INITIAL_DETAIL.prodc_bottom_product,
      mshot_change: INITIAL_DETAIL.mshot_change,
      mshot_image_copy: INITIAL_DETAIL.mshot_image_copy,
      mshot_image_copy_top: INITIAL_DETAIL.mshot_image_copy_top,
      mshot_image_copy_bottom: INITIAL_DETAIL.mshot_image_copy_bottom,
      photo_backside: INITIAL_DETAIL.photo_backside,
      eds_backside: INITIAL_DETAIL.eds_backside,
      inter: INITIAL_DETAIL.inter,
      inter_xs: INITIAL_DETAIL.inter_xs,
      inter_ys: INITIAL_DETAIL.inter_ys,
      in_apply: INITIAL_DETAIL.in_apply,
      inter_select: INITIAL_DETAIL.inter_select,
      tsv: INITIAL_DETAIL.tsv,
      rf: INITIAL_DETAIL.rf,
      fullchip: INITIAL_DETAIL.fullchip,
      split: INITIAL_DETAIL.split,
      st: INITIAL_DETAIL.st,
      ecc: INITIAL_DETAIL.ecc,
      labelsideshot: INITIAL_DETAIL.labelsideshot,
      hpkglabelheight: INITIAL_DETAIL.hpkglabelheight,
      final_yn: INITIAL_DETAIL.final_yn,
      final_entries: INITIAL_DETAIL.final_entries,
    }));
    setFinalGds('');
    setErrors({});
    setMapTypeChangeConfirm(null);
  };

  // C가문 리전별 조합법 변경 → 해당 리전 제품이름 fetch (해당 리전 라인 기준)
  // lineOverride: 복사(적용 위치) 경로에서 아직 state 반영 전 라인을 명시적으로 넘길 때 사용
  const handleProdcProcessChange = (region: CRegion, value: string, lineOverride?: string) => {
    const line = lineOverride ?? ((detail[`prodc_${region}_line` as keyof DetailFormState] as string) || '');
    const regionProcessOpts = region === 'top' ? topProcessOptions : region === 'middle' ? middleProcessOptions : bottomProcessOptions;
    const apply = (opts: string[]) => {
      if (region === 'top') setTopProductOptions(opts);
      else if (region === 'middle') setMiddleProductOptions(opts);
      else setBottomProductOptions(opts);
    };
    // 조합법 변경 시 해당 리전 제품 즉시 초기화
    setDetail((prev) => ({ ...prev, [`prodc_${region}_product`]: '' }));
    // 제품 조회는 (복사 경로거나) 조합법이 해당 리전 옵션에 존재할 때만(시퀀스 토큰으로 stale 무시)
    const canFetch = !!lineOverride || matchedOrLoading(regionProcessOpts, value);
    if (line && value && canFetch) {
      fetchOptions(`prodc-${region}`, () => formOptionsAPI.getProducts(line, value), apply);
    } else {
      apply([]);
    }
  };

  // C가문 리전별 라인 직접 변경 → 라인 설정 + 하위(조합법/제품) 초기화 (조합법 옵션은 effect가 재로드)
  const handleProdcLineChange = (region: CRegion, value: string) => {
    setDetail((prev) => ({
      ...prev,
      [`prodc_${region}_line`]: value,
      [`prodc_${region}_process`]: '',
      [`prodc_${region}_product`]: '',
    }));
    if (region === 'top') setTopProductOptions([]);
    else if (region === 'middle') setMiddleProductOptions([]);
    else setBottomProductOptions([]);
  };

  // ===== C가문 '제품 해당 위치'(prodc_scope) 선택 =====
  // 스코프별 주 리전(메인 라인·조합법·제품을 복사해 넣을 곳). ONLY 스코프는 그 리전 하나만 쓴다.
  const scopePrimaryRegion = (scope: ProdcScope): CRegion | null => {
    if (scope === 'only_top') return 'top';
    if (scope === 'only_bottom') return 'bottom';
    return scope === '' ? null : scope;
  };
  /** 그 스코프에서 '쓰지 않는' 리전 목록 — 값 초기화 대상 */
  const scopeOffRegions = (scope: ProdcScope): CRegion[] => {
    if (scope === 'only_top') return ['middle', 'bottom'];
    if (scope === 'only_bottom') return ['top', 'middle'];
    return [];
  };

  /** 스코프를 next 로 바꿀 때 지워질 사용자 입력이 실제로 존재하는가(확인 모달 노출 판단) */
  const prodcScopeWouldClear = (next: ProdcScope): boolean => {
    const prev = scopePrimaryRegion(detail.prodc_scope);
    const cleared = new Set<CRegion>(scopeOffRegions(next));
    // 주 리전이 바뀌면 이전 주 리전 값도 지워진다(기존 동작 계승)
    if (prev && prev !== scopePrimaryRegion(next)) cleared.add(prev);
    return Array.from(cleared).some((r) =>
      !!(detail[`prodc_${r}_line` as keyof DetailFormState]
        || detail[`prodc_${r}_process` as keyof DetailFormState]
        || detail[`prodc_${r}_product` as keyof DetailFormState]
        || (r !== 'middle' && (detail[`map_value_x_${r}` as keyof DetailFormState]
          || detail[`map_value_y_${r}` as keyof DetailFormState]
          || detail[`mshot_image_copy_${r}` as keyof DetailFormState])))
    );
  };

  /** 스코프 실제 적용 — 초기화·복사를 단일 setDetail 로 원자 처리한다. */
  const applyProdcScope = (next: ProdcScope) => {
    isLoadingEditRef.current = false;
    const prevPrimary = scopePrimaryRegion(detail.prodc_scope);
    const nextPrimary = scopePrimaryRegion(next);
    const offRegions = scopeOffRegions(next);
    // 지울 리전 = ONLY 로 인해 죽는 리전 + (주 리전이 바뀐 경우) 이전 주 리전
    const clearRegions = new Set<CRegion>(offRegions);
    if (prevPrimary && prevPrimary !== nextPrimary) clearRegions.add(prevPrimary);

    setDetail((prev) => {
      const patch: Record<string, unknown> = { ...prev };
      patch.prodc_scope = next;
      clearRegions.forEach((r) => {
        patch[`prodc_${r}_line`] = '';
        patch[`prodc_${r}_process`] = '';
        patch[`prodc_${r}_product`] = '';
        if (r === 'middle') patch.prodc_middle_use = '미사용';
        else {
          patch[`map_value_x_${r}`] = '';
          patch[`map_value_y_${r}`] = '';
          patch[`mshot_image_copy_${r}`] = '';
        }
      });
      if (nextPrimary) {
        // 주 리전에는 메인 라인·조합법을 복사한다(기존 '적용 위치' 동작).
        // 제품은 여기서 넣지 않는다 — 아래 handleProdcProcessChange 가 리전 제품을 ''로 비우므로
        // 그 뒤에 handleDetailSet 으로 넣어야 값이 살아남는다(기존 핸들러의 호출 순서와 동일).
        if (nextPrimary === 'middle') patch.prodc_middle_use = '사용';
        patch[`prodc_${nextPrimary}_line`] = prev.line;
        patch[`prodc_${nextPrimary}_process`] = prev.process_selection;
      }
      return patch as unknown as DetailFormState;
    });

    // 옵션 캐시는 setDetail 밖에서 갱신(리전 라인 기준 제품 목록 재조회)
    clearRegions.forEach((r) => handleProdcProcessChange(r, ''));
    if (nextPrimary) {
      handleProdcProcessChange(nextPrimary, detail.process_selection, detail.line);
      handleDetailSet(`prodc_${nextPrimary}_product`, detail.partid_selection);
    }

    setErrors((prev) => {
      const nextErrors: Record<string, string> = { ...prev, prodc_scope: '' };
      clearRegions.forEach((r) => {
        nextErrors[`prodc_${r}_line`] = '';
        nextErrors[`prodc_${r}_process`] = '';
        nextErrors[`prodc_${r}_product`] = '';
        if (r !== 'middle') {
          nextErrors[`map_value_x_${r}`] = '';
          nextErrors[`map_value_y_${r}`] = '';
          nextErrors[`mshot_image_copy_${r}`] = '';
        }
      });
      return nextErrors;
    });
    setProdcScopeConfirm(null);
  };

  /** 라디오 클릭 진입점 — 지울 데이터가 있으면 확인 모달을 거친다. */
  const handleProdcScopeSelect = (next: ProdcScope) => {
    if (next === detail.prodc_scope) return;
    if (prodcScopeWouldClear(next)) setProdcScopeConfirm(next);
    else applyProdcScope(next);
  };

  /** 리전별 지도 편차 변경 — '변경 없음' 전환 시 그 리전 X/Y 를 비운다. */
  const handleRegionMapChangeChange = (region: 'top' | 'bottom', value: string) => {
    isLoadingEditRef.current = false;
    setDetail((prev) => {
      if (value !== '변경 없음') return { ...prev, [`map_change_${region}`]: value };
      const next = { ...prev, [`map_change_${region}`]: value, [`map_value_x_${region}`]: '', [`map_value_y_${region}`]: '' };
      // 양쪽 다 '변경 없음'이 되면 공용 사유도 비운다(숨은 값이 저장되지 않도록).
      const other = region === 'top' ? 'bottom' : 'top';
      const otherOff = (isOnlyTopScope && other !== 'top') || (isOnlyBottomScope && other !== 'bottom');
      if (otherOff || prev[`map_change_${other}`] === '변경 없음') next.map_reason = '';
      return next;
    });
    if (value === '변경 없음') {
      setErrors((prev) => ({ ...prev, [`map_value_x_${region}`]: '', [`map_value_y_${region}`]: '', map_reason: '' }));
    }
  };

  // ===== 조건부 섹션 '해제' 시 하위 값 초기화 =====
  // 조건부 필드를 '변경 없음/미사용/없음'으로 되돌리면 숨겨진 하위 값까지 비운다.
  // (숨김 상태로 state 에 잔존해 backend 에 잘못 저장되는 것을 막기 위함 — 감사 R-2~R-5)

  // C가문(only_prodc) — No 로 전환 시 상/중/하판·지도편차(prodc)·X표시 값 전체 초기화.
  // Final(final_yn/final_entries) 값 자체는 C가문과 독립된 항목이므로 여기서 건드리지 않는다
  // (단 C가문이 Yes 일 때 최소 1건 등록은 validate(2) 에서 별도로 강제한다).
  const handleOnlyProdcChange = (value: string) => {
    isLoadingEditRef.current = false;
    if (value !== 'No') {
      // Yes 전환 시 X표시 변경 여부를 '수정'으로 자동 설정한다(C가문은 X표시 수정이 기본 전제).
      // 단, CLONE/EXISTING(isMapRegistered)은 MAP 입력칸이 전부 잠겨 실제로 값을 넣을 수 없으므로
      // mshot_change 를 건드리지 않는다 — 안 그러면 아무 것도 안 바꿨는데 '수정'으로 상신되는 문제가 생긴다.
      // 편집 로드·프리필 경로에는 걸지 않는다 — 저장된 mshot_change 가 덮어써지기 때문.
      // 예외 구역이 '변경 없음'이면 기본값도 C가문 기준(500)으로 함께 갱신한다.
      // '변경 있음'이면 사용자가 직접 넣은 값이므로 건드리지 않는다.
      // 잠기는 칸(리전별 지도편차·예외구역)의 값은 map_type 이 정하므로 CLONE/EXISTING 이면
      // C가문 기본값(500) 대신 '변경 없음'/빈 값이 들어간다.
      setDetail((prev) => ({
        ...prev,
        only_prodc: value,
        ...(isMapRegisteredType(prev.map_type) ? {} : { mshot_change: '수정' }),
        map_change_top: regionMapChangeDefault(prev.map_type),
        map_change_bottom: regionMapChangeDefault(prev.map_type),
        ...(prev.ea_change === EA_NO_CHANGE ? { ea_value: eaDefaultValue(value) } : {}),
      }));
      if (errors['only_prodc']) setErrors((prev) => ({ ...prev, only_prodc: '' }));
      return;
    }
    setDetail((prev) => ({
      ...prev,
      only_prodc: 'No',
      prodc_scope: '',
      prodc_top_line: '', prodc_top_process: '', prodc_top_product: '',
      prodc_middle_use: '', prodc_middle_line: '', prodc_middle_process: '', prodc_middle_product: '',
      prodc_bottom_line: '', prodc_bottom_process: '', prodc_bottom_product: '',
      map_change_top: regionMapChangeDefault(prev.map_type),
      map_value_x_top: '', map_value_y_top: '',
      map_change_bottom: regionMapChangeDefault(prev.map_type),
      map_value_x_bottom: '', map_value_y_bottom: '',
      // Yes 전환 시 자동으로 넣었던 '수정'과 그때 붙여넣은 이미지를 함께 되돌린다
      // (C가문을 되돌린 뒤 원하지 않은 X표시 정보가 저장되는 것을 막기 위함).
      mshot_change: INITIAL_DETAIL.mshot_change,
      mshot_image_copy: '', mshot_image_copy_top: '', mshot_image_copy_bottom: '',
      // 예외 구역이 '변경 없음'이면 기본값도 일반 기준(300)으로 되돌린다(Yes 전환의 반대 동작).
      ...(prev.ea_change === EA_NO_CHANGE ? { ea_value: eaDefaultValue('No') } : {}),
    }));
    setTopProductOptions([]); setMiddleProductOptions([]); setBottomProductOptions([]);
    setTopProcessOptions([]); setMiddleProcessOptions([]); setBottomProcessOptions([]);
    setErrors((prev) => ({
      ...prev,
      only_prodc: '', prodc_scope: '', prodc_top_line: '', prodc_top_process: '', prodc_bottom_line: '', prodc_bottom_process: '',
      map_value_x_top: '', map_value_y_top: '', map_value_x_bottom: '', map_value_y_bottom: '', map_reason: '',
      mshot_image_copy: '', mshot_image_copy_top: '', mshot_image_copy_bottom: '',
    }));
  };

  // 지도 편차(map_change) — '변경 없음' 전환 시 X/Y/사유 초기화
  const handleMapChangeChange = (value: string) => {
    isLoadingEditRef.current = false;
    setDetail((prev) => value === '변경 없음'
      ? { ...prev, map_change: value, map_value_x: '', map_value_y: '', map_reason: '' }
      : { ...prev, map_change: value });
    if (value === '변경 없음') {
      setErrors((prev) => ({ ...prev, map_value_x: '', map_value_y: '', map_reason: '' }));
    }
  };

  // 예외 구역(ea_change) — '변경 없음' 전환 시 C가문 여부에 맞는 기본값(300/500)을 되돌려 넣는다.
  // map_type 과 무관하다 — CLONE/EXISTING 도 입력칸만 잠길 뿐 기본값은 300/500 그대로 표시된다.
  const handleEaChangeChange = (value: string) => {
    isLoadingEditRef.current = false;
    setDetail((prev) => value === EA_NO_CHANGE
      ? { ...prev, ea_change: value, ea_value: eaDefaultValue(prev.only_prodc) }
      : { ...prev, ea_change: value });
    if (value === EA_NO_CHANGE && errors['ea_value']) setErrors((prev) => ({ ...prev, ea_value: '' }));
  };

  // X표시(mshot_change) — 추가/수정 이외(없음·삭제)로 전환 시 붙여넣은 이미지 경로 전체 초기화
  // (여러 번 붙여넣어도 마지막 것만 저장되며, 해제 시 잔상이 남지 않도록 비운다)
  const handleMshotChangeChange = (value: string) => {
    isLoadingEditRef.current = false;
    const keepImages = value === '추가' || value === '수정';
    setDetail((prev) => keepImages
      ? { ...prev, mshot_change: value }
      : { ...prev, mshot_change: value, mshot_image_copy: '', mshot_image_copy_top: '', mshot_image_copy_bottom: '' });
    if (!keepImages) {
      setErrors((prev) => ({ ...prev, mshot_image_copy: '', mshot_image_copy_top: '', mshot_image_copy_bottom: '' }));
    }
  };

  const handleRadioChange = (name: keyof DetailFormState, value: string) => {
    setDetail((prev) => ({ ...prev, [name]: value }));
  };

  const handleFlowChange = (id: string, field: keyof Omit<FlowChartRow, 'id'>, value: string) => {
    setDetail((prev) => ({
      ...prev,
      flow_chart: prev.flow_chart.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    }));
    if (field === 'step_from' || field === 'step_to') {
      const key = `flow_step_${id}_${field}`;
      if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
    }
  };

  // 흐름도 Step(step_from/step_to): 목록에 없는 값이면 해당 필드를 에러로 표시 + 빨간 에러 토스트
  const handleFlowStepBlur = (rowId: string, field: 'step_from' | 'step_to') => {
    const row = detail.flow_chart.find((r) => r.id === rowId);
    const value = (row?.[field] || '').trim();
    const opts = FlowLayerIdOptions[rowId] || [];
    const key = `flow_step_${rowId}_${field}`;
    if (value && !opts.includes(value)) {
      setErrors((prev) => ({ ...prev, [key]: t('request.flow_step_not_in_list') }));
      addToast(t('request.flow_step_not_in_list'), 'error');
    } else if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: '' }));
    }
  };

  // 제품 이름(partid_selection): 목록에 없는 값이면 에러 표시(문구는 Step1에서 값 존재 시 숨김) + 빨간 에러 토스트
  const handlePartidSelectionBlur = () => {
    const value = detail.partid_selection.trim();
    if (value && !productOptions.includes(value)) {
      setErrors((prev) => ({ ...prev, partid_selection: t('request.partid_not_in_list') }));
      addToast(t('request.partid_not_in_list'), 'error');
    }
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

  // ===== Jayer & Oayer Handlers =====

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
          return { ...row, loaded: true, manuallyDisabled: false, disabled: calcDisabled(row, jayerFilterSets, jayerActiveFilterIds) };
        });
        setJayerRows(newJayerRows);
        addToast(t('request.toast_job_auto_fill', { count: jobFileData.length }), 'info');
      } else {
        setJayerRows([]);
        addToast(t('request.toast_job_no_data'), 'warning');
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
            layerid: item.layerid || '',
          };
          return { ...row, loaded: true, manuallyDisabled: false, disabled: calcDisabled(row, oayerFilterSets, oayerActiveFilterIds) };
        });
        setOayerRows(newOayerRows);
        addToast(t('request.toast_ovl_auto_fill', { count: ovlData.length }), 'info');
      } else {
        setOayerRows([]);
        addToast(t('request.toast_ovl_no_data'), 'warning');
      }
    } catch (e) {
      console.error('OVL layer 정보 조회 실패:', e);
      addToast(t('request.toast_ovl_auto_fill_error'), 'error');
    }
  };

  // 매핑된 J-layer 행이 수정/비활성화되면 매핑을 해제한다:
  // 해당 bb 행 제거 + mappedJayerRowIds/stagedMappings/선택 정리 → 원본 데이터 목록에 다시 노출.
  const unmapJayerRows = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setBbRows((prev) => prev.filter((r) => !(r.sourceJayerRowId && idSet.has(r.sourceJayerRowId))));
    setMappedJayerRowIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setStagedMappings((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setSelectedJayerRowId((prev) => (prev && idSet.has(prev) ? null : prev));
  };

  // 매핑된 행만 골라 unmap (편집/붙여넣기/Delete 공용)
  const unmapIfMapped = (ids: string[]) => unmapJayerRows(ids.filter((id) => mappedJayerRowIds.has(id)));

  /**
   * 붙여넣기·Delete 로 bb 반영 컬럼이 실제로 바뀐 행만 골라 unmap.
   * bb 행은 J-ayer 에서 process_id/sp/sd 만 복사해 가므로, 나머지 컬럼이 바뀌어도
   * bb 내용은 달라지지 않는다 — 그런 변경까지 매핑을 풀면 재선택만 강요된다.
   */
  const unmapIfBbValueChanged = (changes: { rowId: string; values: Record<string, string> }[]) => {
    const rowById = new Map(jayerRows.map((r) => [r.id, r]));
    const targets = changes
      .filter(({ rowId, values }) => {
        const row = rowById.get(rowId);
        return Object.entries(values).some(
          ([col, v]) => isBbMirroredCol(col) && row?.[col as keyof JayerRow] !== v,
        );
      })
      .map((c) => c.rowId);
    unmapIfMapped(targets);
  };

  // 바코드 후보 조회 + 적용. seq 토큰으로 최신 요청만 반영하고(out-of-order 무시),
  // 응답 시점에 행의 product_name이 그대로일 때만 item_id를 자동 채운다.
  const runBarcodeFetch = (id: string, productName: string, seq: number) => {
    formOptionsAPI.getBarcodeOptions(productName).then((options) => {
      if (barcodeReqSeq.current[id] !== seq) return; // 더 최신 요청이 있으면 무시
      setJayerBarcodeCache((prev) => ({ ...prev, [id]: options }));
      setJayerRows((rows) => rows.map((r) =>
        r.id === id && r.product_name === productName
          ? { ...r, item_id: autoMatchItemId(r, options) }
          : r));
    });
  };

  const handleJayerChange = (id: string, field: keyof Omit<JayerRow, 'id'>, value: string) => {
    const changedRow = jayerRows.find(r => r.id === id);
    // bb 행이 J-ayer 에서 복사해 가는 값이 실제로 바뀐 경우에만 매핑을 해제한다.
    // (예전엔 컬럼을 가리지 않고 해제해, st 하나만 바꿔도 bb 재선택을 다시 해야 했다.)
    if (mappedJayerRowIds.has(id) && isBbMirroredCol(field) && changedRow?.[field] !== value) {
      unmapJayerRows([id]);
    }
    // 동기화 전파 여부: 소스 행이 참여행(활성 && 기등록/layer삭제 아님)이고,
    // 전파할 값이 특수값(기등록/layer삭제)이 아닐 때만 같은 layer의 참여행으로 전파한다.
    const layerid = changedRow?.layerid?.trim();
    const sourceParticipant = !!changedRow && !changedRow.disabled && !isNocSpecial(changedRow.new_or_copy);
    const propagate = (field === 'st' || field === 'new_or_copy' || field === 'product_name') && !!layerid && sourceParticipant
      && !(field === 'new_or_copy' && isNocSpecial(value));
    setJayerRows((rows) => rows.map((r) => {
      if (r.id === id) {
        if (field === 'product_name') {
          const next = { ...r, product_name: value, item_id: '' };
          // product_name을 채우면 step이 비어있을 때 layer 값으로 자동 채움(layer 없으면 무동작)
          if (value && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
          return next;
        }
        if (field === 'step') {
          // step 변경 시 캐시된 후보로 item_id 자동매칭 재실행
          const candidates = jayerBarcodeCache[id] ?? [];
          return { ...r, step: value, item_id: autoMatchItemId({ ...r, step: value }, candidates) };
        }
        if (field === 'new_or_copy') {
          const next = { ...r, new_or_copy: value };
          // 기등록/layer삭제 선택 시 st를 자동으로 'X'로 설정
          if (isNocSpecial(value)) next.st = 'X';
          return next;
        }
        return { ...r, [field]: value };
      }
      // J→J 동기화: 같은 layer의 "참여행"에만 반영(비활성·기등록·layer삭제 제외)
      if (propagate && r.layerid?.trim() === layerid) {
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, [field]: value };
      }
      return r;
    }));
    // J→O 동기화: 같은 layer의 O-layer 참여행에만 반영
    if (propagate) {
      setOayerRows(rows => rows.map(r => {
        if (r.layerid?.trim() !== layerid) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        if (field === 'product_name') {
          const next = { ...r, product_name: value };
          if (value && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
          return next;
        }
        return { ...r, [field]: value };
      }));
    }
    if (field === 'product_name') {
      // 진행 중 요청 무효화(seq +1) + 대기 중 디바운스 타이머 취소
      const seq = (barcodeReqSeq.current[id] ?? 0) + 1;
      barcodeReqSeq.current[id] = seq;
      if (barcodeDebounceTimers.current[id]) clearTimeout(barcodeDebounceTimers.current[id]);
      if (value) {
        // 타이핑 부하 감소: 행별 디바운스 후 최신 product로만 조회
        barcodeDebounceTimers.current[id] = setTimeout(() => runBarcodeFetch(id, value, seq), BARCODE_DEBOUNCE_MS);
      } else {
        setJayerBarcodeCache((prev) => ({ ...prev, [id]: [] }));
      }
    }
  };

  // 붙여넣기 후 J-layer 자동채움/바코드 조회 연동
  const handleJayerAfterPaste = (changes: { rowId: string; values: Record<string, string> }[]) => {
    // 붙여넣기로 bb 반영 컬럼이 바뀐 행만 매핑 해제(원본 목록 복귀)
    unmapIfBbValueChanged(changes);
    changes.forEach(({ rowId, values }) => {
      if ('product_name' in values) {
        const pn = values.product_name;
        if (pn) {
          // 붙여넣기는 단발 이벤트라 즉시 조회하되, seq 토큰으로 최신 요청만 반영(타이핑과 경합 방지)
          const seq = (barcodeReqSeq.current[rowId] ?? 0) + 1;
          barcodeReqSeq.current[rowId] = seq;
          if (barcodeDebounceTimers.current[rowId]) clearTimeout(barcodeDebounceTimers.current[rowId]);
          formOptionsAPI.getBarcodeOptions(pn).then((options) => {
            if (barcodeReqSeq.current[rowId] !== seq) return; // 더 최신 요청이 있으면 무시
            setJayerBarcodeCache((prev) => ({ ...prev, [rowId]: options }));
            setJayerRows((rows) => rows.map((r) => {
              if (r.id !== rowId || r.product_name !== pn) return r; // 현재 product 일치 시만
              let step = r.step;
              if (!step?.trim() && r.layerid?.trim()) step = r.layerid;
              return { ...r, step, item_id: autoMatchItemId({ ...r, step }, options) };
            }));
          });
        } else {
          barcodeReqSeq.current[rowId] = (barcodeReqSeq.current[rowId] ?? 0) + 1; // 진행 중 요청 무효화
          if (barcodeDebounceTimers.current[rowId]) clearTimeout(barcodeDebounceTimers.current[rowId]);
          setJayerBarcodeCache((prev) => ({ ...prev, [rowId]: [] }));
          setJayerRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, item_id: '' } : r)));
        }
      } else if ('step' in values) {
        const candidates = jayerBarcodeCache[rowId] ?? [];
        setJayerRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, item_id: autoMatchItemId(r, candidates) } : r)));
      }
    });
    // 기등록/layer삭제를 붙여넣은 행은 st를 자동으로 'X'로 설정
    const nocSpecialPastedIds = new Set(
      changes.filter(c => 'new_or_copy' in c.values && isNocSpecial(c.values.new_or_copy)).map(c => c.rowId)
    );
    if (nocSpecialPastedIds.size > 0) {
      setJayerRows(rows => rows.map(r => nocSpecialPastedIds.has(r.id) ? { ...r, st: 'X' } : r));
    }
    // J→J + J→O 동기화: st / new_or_copy / product_name 붙여넣기를 같은 layer의 "참여행"에만 반영
    type SyncFields = Partial<Record<'st' | 'new_or_copy' | 'product_name', string>>;
    const layeridSyncMap = new Map<string, SyncFields>();
    const directlyPastedIds = new Set<string>();
    changes.forEach(({ rowId, values }) => {
      if (!('st' in values) && !('new_or_copy' in values) && !('product_name' in values)) return;
      const jRow = jayerRows.find(r => r.id === rowId);
      if (!jRow?.layerid?.trim()) return;
      directlyPastedIds.add(rowId);
      // 소스가 참여행이 아니면 전파하지 않음(비활성·기등록·layer삭제)
      if (jRow.disabled || isNocSpecial(jRow.new_or_copy)) return;
      const layerid = jRow.layerid.trim();
      const entry = layeridSyncMap.get(layerid) ?? {};
      if ('st' in values) entry.st = values.st;
      // 특수값(기등록/layer삭제)은 전파 제외
      if ('new_or_copy' in values && !isNocSpecial(values.new_or_copy)) entry.new_or_copy = values.new_or_copy;
      if ('product_name' in values) entry.product_name = values.product_name;
      layeridSyncMap.set(layerid, entry);
    });
    if (layeridSyncMap.size > 0) {
      setJayerRows(rows => rows.map(r => {
        if (directlyPastedIds.has(r.id)) return r;
        const layerid = r.layerid?.trim();
        if (!layerid || !layeridSyncMap.has(layerid)) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, ...layeridSyncMap.get(layerid)! };
      }));
      setOayerRows(rows => rows.map(r => {
        const layerid = r.layerid?.trim();
        if (!layerid || !layeridSyncMap.has(layerid)) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        const sync = layeridSyncMap.get(layerid)!;
        if (sync.product_name !== undefined) {
          const next = { ...r, ...sync };
          if (sync.product_name && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
          return next;
        }
        return { ...r, ...sync };
      }));
    }
  };

  // 붙여넣기 후 O-layer 자동채움(바코드 없음 — step=layer 자동만)
  const handleOayerAfterPaste = (changes: { rowId: string; values: Record<string, string> }[]) => {
    changes.forEach(({ rowId, values }) => {
      if ('product_name' in values && values.product_name) {
        setOayerRows((rows) => rows.map((r) => {
          if (r.id !== rowId) return r;
          if (!r.step?.trim() && r.layerid?.trim()) return { ...r, step: r.layerid };
          return r;
        }));
      }
    });
    // 기등록/layer삭제를 붙여넣은 행은 st를 자동으로 'X'로 설정
    const nocSpecialPastedIds = new Set(
      changes.filter(c => 'new_or_copy' in c.values && isNocSpecial(c.values.new_or_copy)).map(c => c.rowId)
    );
    if (nocSpecialPastedIds.size > 0) {
      setOayerRows(rows => rows.map(r => nocSpecialPastedIds.has(r.id) ? { ...r, st: 'X' } : r));
    }
    // O→O + O→J 동기화: st / new_or_copy / product_name 붙여넣기를 같은 layer의 "참여행"에만 반영
    type SyncFields = Partial<Record<'st' | 'new_or_copy' | 'product_name', string>>;
    const layeridSyncMap = new Map<string, SyncFields>();
    const directlyPastedIds = new Set<string>();
    changes.forEach(({ rowId, values }) => {
      if (!('st' in values) && !('new_or_copy' in values) && !('product_name' in values)) return;
      const oRow = oayerRows.find(r => r.id === rowId);
      if (!oRow?.layerid?.trim()) return;
      directlyPastedIds.add(rowId);
      // 소스가 참여행이 아니면 전파하지 않음(비활성·기등록·layer삭제)
      if (oRow.disabled || isNocSpecial(oRow.new_or_copy)) return;
      const layerid = oRow.layerid.trim();
      const entry = layeridSyncMap.get(layerid) ?? {};
      if ('st' in values) entry.st = values.st;
      // 특수값(기등록/layer삭제)은 전파 제외
      if ('new_or_copy' in values && !isNocSpecial(values.new_or_copy)) entry.new_or_copy = values.new_or_copy;
      if ('product_name' in values) entry.product_name = values.product_name;
      layeridSyncMap.set(layerid, entry);
    });
    if (layeridSyncMap.size > 0) {
      setOayerRows(rows => rows.map(r => {
        if (directlyPastedIds.has(r.id)) return r;
        const layerid = r.layerid?.trim();
        if (!layerid || !layeridSyncMap.has(layerid)) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, ...layeridSyncMap.get(layerid)! };
      }));
      setJayerRows(rows => rows.map(r => {
        const layerid = r.layerid?.trim();
        if (!layerid || !layeridSyncMap.has(layerid)) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        const sync = layeridSyncMap.get(layerid)!;
        if (sync.product_name !== undefined) {
          const next = { ...r, ...sync, item_id: '' };
          if (sync.product_name && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
          return next;
        }
        return { ...r, ...sync };
      }));
      // 대상 J-ayer 행에 product_name이 동기화됐다면 바코드(ID) 재조회
      const pnLayerids = new Set(
        Array.from(layeridSyncMap.entries()).filter(([, v]) => v.product_name !== undefined).map(([k]) => k)
      );
      if (pnLayerids.size > 0) {
        jayerRows.forEach(r => {
          const layerid = r.layerid?.trim();
          if (!layerid || !pnLayerids.has(layerid)) return;
          if (r.disabled || isNocSpecial(r.new_or_copy)) return;
          const pn = layeridSyncMap.get(layerid)!.product_name;
          const rid = r.id;
          const seq = (barcodeReqSeq.current[rid] ?? 0) + 1;
          barcodeReqSeq.current[rid] = seq;
          if (barcodeDebounceTimers.current[rid]) clearTimeout(barcodeDebounceTimers.current[rid]);
          if (pn) {
            barcodeDebounceTimers.current[rid] = setTimeout(() => runBarcodeFetch(rid, pn, seq), BARCODE_DEBOUNCE_MS);
          } else {
            setJayerBarcodeCache((prev) => ({ ...prev, [rid]: [] }));
          }
        });
      }
    }
  };

  // 엑셀식 셀 선택 + 붙여넣기 (J/O 표 공용 훅). 붙여넣기 후 자동채움/바코드 조회 연동.
  // 셀 단위 잠금: 비활성/기등록 행은 전체 잠금, 불러온(loaded) 행은 LOADED_LOCK_COLS만 잠금
  // layer삭제 행의 st 는 항상 'X' 로 고정이므로 붙여넣기로도 덮어쓸 수 없다.
  const isLayerCellLocked = (row: { disabled?: boolean; new_or_copy?: string; loaded?: boolean }, col: string): boolean =>
    !!row.disabled || row.new_or_copy === '기등록'
    || (row.new_or_copy === NOC_LAYER_DELETE && col === 'st')
    || (!!row.loaded && (LOADED_LOCK_COLS as readonly string[]).includes(col));
  const jayerCellSel = useCellSelection<JayerRow>(jayerRows, setJayerRows, JAYER_EDITABLE_COLS, handleJayerAfterPaste, isLayerCellLocked, unmapIfBbValueChanged);
  const oayerCellSel = useCellSelection<OayerRow>(oayerRows, setOayerRows, OAYER_EDITABLE_COLS, handleOayerAfterPaste, isLayerCellLocked);

  // 참여행(활성 && 기등록/layer삭제 아님)에만 일괄 적용 + 같은 layer의 O 참여행 동기화
  const handleJayerSetAll = (field: 'st' | 'new_or_copy', value: string) => {
    setJayerRows((rows) => rows.map((r) => (r.disabled || isNocSpecial(r.new_or_copy)) ? r : { ...r, [field]: value }));
    const layerids = new Set(jayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && r.layerid?.trim()).map(r => r.layerid.trim()));
    setOayerRows(rows => rows.map(r => {
      if (!r.layerid?.trim() || !layerids.has(r.layerid.trim())) return r;
      if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
      return { ...r, [field]: value };
    }));
  };

  const handleJayerResetField = (field: 'st' | 'new_or_copy') => {
    setJayerRows((rows) => rows.map((r) => (r.disabled || isNocSpecial(r.new_or_copy)) ? r : { ...r, [field]: '' }));
    const layerids = new Set(jayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && r.layerid?.trim()).map(r => r.layerid.trim()));
    setOayerRows(rows => rows.map(r => {
      if (!r.layerid?.trim() || !layerids.has(r.layerid.trim())) return r;
      if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
      return { ...r, [field]: '' };
    }));
  };

  const handleJayerAddRow = () => {
    setJayerRows((rows) => [...rows, makeJayerRow()]);
  };

  const handleJayerBulkDisable = () => {
    setJayerRows((rows) =>
      rows.map((r) => (jayerChecked.has(r.id) && !r.disabled ? { ...r, manuallyDisabled: true, disabled: true } : r))
    );
    // 비활성화되는 행은 매핑 해제 → bb 정보에서 제거(비활성이라 원본 목록에도 안 뜸)
    unmapJayerRows([...jayerChecked]);
    setJayerChecked(new Set());
  };

  const handleJayerBulkRestore = () => {
    setJayerRows((rows) =>
      rows.map((r) => jayerChecked.has(r.id) && r.disabled
        ? { ...r, manuallyDisabled: false, disabled: calcDisabled({ ...r, manuallyDisabled: false }, jayerFilterSets, jayerActiveFilterIds) }
        : r
      )
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

  const handleJayerDragStart = (id: string) => {
    // 드래그 선택 모드만 설정한다. 시작 행 토글은 단일 클릭 시 체크박스 onChange가,
    // 드래그 시 handleJayerDragEnter(시작 행 포함 범위)가 처리한다.
    // (여기서 토글하면 onChange와 이중 토글되어 단일 클릭이 먹지 않는 버그가 생긴다.)
    const mode = jayerChecked.has(id) ? 'uncheck' : 'check';
    jayerDragInfo.current = { startId: id, mode };
  };

  const handleJayerDragEnter = (id: string, renderedIds: string[]) => {
    if (!jayerDragInfo.current) return;
    const { startId, mode } = jayerDragInfo.current;
    const startIdx = renderedIds.indexOf(startId);
    const endIdx = renderedIds.indexOf(id);
    if (startIdx === -1 || endIdx === -1) return;
    const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const rangeIds = new Set(renderedIds.slice(from, to + 1));
    setJayerChecked((prev) => {
      const next = new Set(prev);
      rangeIds.forEach((rid) => (mode === 'check' ? next.add(rid) : next.delete(rid)));
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
    const changedRow = oayerRows.find(r => r.id === id);
    const layerid = changedRow?.layerid?.trim();
    const sourceParticipant = !!changedRow && !changedRow.disabled && !isNocSpecial(changedRow.new_or_copy);
    const propagate = (field === 'st' || field === 'new_or_copy' || field === 'product_name') && !!layerid && sourceParticipant
      && !(field === 'new_or_copy' && isNocSpecial(value));
    setOayerRows((rows) => rows.map((r) => {
      if (r.id === id) {
        if (field === 'product_name') {
          const next = { ...r, product_name: value };
          // product_name을 채우면 step이 비어있을 때 layer 값으로 자동 채움(layer 없으면 무동작)
          if (value && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
          return next;
        }
        if (field === 'new_or_copy') {
          const next = { ...r, new_or_copy: value };
          // 기등록/layer삭제 선택 시 st를 자동으로 'X'로 설정
          if (isNocSpecial(value)) next.st = 'X';
          return next;
        }
        return { ...r, [field]: value };
      }
      // O→O 동기화: 같은 layer의 "참여행"에만 반영(비활성·기등록·layer삭제 제외)
      if (propagate && r.layerid?.trim() === layerid) {
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        return { ...r, [field]: value };
      }
      return r;
    }));
    // O→J 동기화: 같은 layer의 J-layer 참여행에만 반영
    if (propagate) {
      setJayerRows(rows => rows.map(r => {
        if (r.layerid?.trim() !== layerid) return r;
        if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
        if (field === 'product_name') {
          const next = { ...r, product_name: value, item_id: '' };
          if (value && !r.step?.trim() && r.layerid?.trim()) next.step = r.layerid;
          return next;
        }
        return { ...r, [field]: value };
      }));
      if (field === 'product_name') {
        // 대상 J-ayer 행에 반영된 product_name으로 바코드(ID) 재조회
        jayerRows.forEach(r => {
          if (r.layerid?.trim() !== layerid) return;
          if (r.disabled || isNocSpecial(r.new_or_copy)) return;
          const rid = r.id;
          const seq = (barcodeReqSeq.current[rid] ?? 0) + 1;
          barcodeReqSeq.current[rid] = seq;
          if (barcodeDebounceTimers.current[rid]) clearTimeout(barcodeDebounceTimers.current[rid]);
          if (value) {
            barcodeDebounceTimers.current[rid] = setTimeout(() => runBarcodeFetch(rid, value, seq), BARCODE_DEBOUNCE_MS);
          } else {
            setJayerBarcodeCache((prev) => ({ ...prev, [rid]: [] }));
          }
        });
      }
    }
  };

  const handleOayerSetAll = (field: 'st' | 'new_or_copy', value: string) => {
    setOayerRows((rows) => rows.map((r) => (r.disabled || isNocSpecial(r.new_or_copy)) ? r : { ...r, [field]: value }));
    const layerids = new Set(oayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && r.layerid?.trim()).map(r => r.layerid.trim()));
    setJayerRows(rows => rows.map(r => {
      if (!r.layerid?.trim() || !layerids.has(r.layerid.trim())) return r;
      if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
      return { ...r, [field]: value };
    }));
  };

  const handleOayerResetField = (field: 'st' | 'new_or_copy') => {
    setOayerRows((rows) => rows.map((r) => (r.disabled || isNocSpecial(r.new_or_copy)) ? r : { ...r, [field]: '' }));
    const layerids = new Set(oayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && r.layerid?.trim()).map(r => r.layerid.trim()));
    setJayerRows(rows => rows.map(r => {
      if (!r.layerid?.trim() || !layerids.has(r.layerid.trim())) return r;
      if (r.disabled || isNocSpecial(r.new_or_copy)) return r;
      return { ...r, [field]: '' };
    }));
  };

  const handleOayerAddRow = () => {
    setOayerRows((rows) => [...rows, makeOayerRow()]);
  };

  const handleOayerBulkDisable = () => {
    setOayerRows((rows) =>
      rows.map((r) => (oayerChecked.has(r.id) && !r.disabled ? { ...r, manuallyDisabled: true, disabled: true } : r))
    );
    setOayerChecked(new Set());
  };

  const handleOayerBulkRestore = () => {
    setOayerRows((rows) =>
      rows.map((r) => oayerChecked.has(r.id) && r.disabled
        ? { ...r, manuallyDisabled: false, disabled: calcDisabled({ ...r, manuallyDisabled: false }, oayerFilterSets, oayerActiveFilterIds) }
        : r
      )
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

  const handleOayerDragStart = (id: string) => {
    // 드래그 선택 모드만 설정한다(시작 행 토글은 onChange/handleOayerDragEnter가 처리).
    const mode = oayerChecked.has(id) ? 'uncheck' : 'check';
    oayerDragInfo.current = { startId: id, mode };
  };

  const handleOayerDragEnter = (id: string, renderedIds: string[]) => {
    if (!oayerDragInfo.current) return;
    const { startId, mode } = oayerDragInfo.current;
    const startIdx = renderedIds.indexOf(startId);
    const endIdx = renderedIds.indexOf(id);
    if (startIdx === -1 || endIdx === -1) return;
    const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const rangeIds = new Set(renderedIds.slice(from, to + 1));
    setOayerChecked((prev) => {
      const next = new Set(prev);
      rangeIds.forEach((rid) => (mode === 'check' ? next.add(rid) : next.delete(rid)));
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

  // ===== Layer 추가/삭제 Handlers =====
  const handleRefDocSelect = async (label: string) => {
    const doc = approvedDocs.find((d) => d.title === label);
    if (!doc) {
      setRefDocId(null);
      setRefJayerRows([]);
      setRefOayerRows([]);
      return;
    }
    setRefDocId(doc.id);
    try {
      const res = await documentsAPI.get(doc.id);
      const parsed = JSON.parse(res.data.additional_notes ?? '{}');
      setRefJayerRows(parsed.jayerRows ?? []);
      setRefOayerRows(parsed.oayerRows ?? []);
    } catch {
      setRefJayerRows([]);
      setRefOayerRows([]);
      addToast(t('request.merge_ref_load_fail'), 'error');
    }
  };

  // 미리보기·실제 반영을 같은 순수 함수(computeLayerMerge)로 계산해 모달 건수와 표 결과가 어긋날 수 없게 한다.
  // J-layer 와 O-layer 는 각각 독립 호출한다 — 한쪽 판정이 다른 쪽으로 전파되면 안 된다.
  const handleMergeClick = () => {
    // '없음' 은 3-way 로 반영할 참조가 없다 — 확인 모달 없이 바로 '없음' 으로 확정하고 표를 연다.
    if (detail.merge_ref_mode === 'none') {
      setDetail((prev) => ({
        ...prev,
        merge_ref_doc_id: null,
        merge_ref_doc_label: '',
        merge_applied: true,
        merge_pairs: prev.merge_pairs.length > 0 ? prev.merge_pairs : [emptyMergePair()],
        merge_unmatched_before: [],
        merge_unmatched_after: [],
      }));
      setBaSameCount(0);
      setBaSelBefore(null);
      setBaSelAfter(null);
      return;
    }
    setMergePreview({
      jayer: computeLayerMerge(jayerRows, refJayerRows).stats,
      oayer: computeLayerMerge(oayerRows, refOayerRows).stats,
    });
    setMergeConfirmOpen(true);
  };

  const handleMergeConfirm = () => {
    const jayer = computeLayerMerge(jayerRows, refJayerRows);
    const oayer = computeLayerMerge(oayerRows, refOayerRows);
    // BEFORE/AFTER 비교는 3-way 반영과 무관하게 '참조 원본 대 작성 원본'으로 계산한다
    // (반영 후 표로 계산하면 layer삭제로 추가된 행이 B 쪽에 섞여 비교가 왜곡된다).
    const ba = computeBeforeAfter(refJayerRows, refOayerRows, jayerRows, oayerRows);
    // 재선택 롤백용 스냅샷 — 반영 '직전' 상태를 남긴다.
    setMergeSnapshot({
      jayerRows,
      oayerRows,
      refDocId,
      savedAt: new Date().toISOString(),
    });
    setJayerRows(jayer.merged);
    setOayerRows(oayer.merged);
    // 참조 요청서는 의뢰서당 1건 — 문서에 기록해 임시저장 후 재진입해도 재Merge 를 막는다('재선택'으로만 해제).
    setDetail((prev) => ({
      ...prev,
      merge_ref_doc_id: refDocId,
      merge_ref_doc_label: refDocLabel,
      merge_ref_mode: 'ref',
      merge_applied: true,
      merge_pairs: ba.pairs,
      merge_unmatched_before: ba.unmatchedBefore,
      merge_unmatched_after: ba.unmatchedAfter,
    }));
    setBaSameCount(ba.sameCount);
    setBaSelBefore(null);
    setBaSelAfter(null);
    setMergeConfirmOpen(false);
    addToast(t('request.toast_merge_complete', {
      added: jayer.stats.added + oayer.stats.added,
      registered: jayer.stats.registered + oayer.stats.registered,
      deleted: jayer.stats.deleted + oayer.stats.deleted,
    }), 'success');
  };

  // ===== 참조 요청서 재선택 / BEFORE·AFTER 매핑 =====

  /**
   * 재선택 확정 — 저장된 스냅샷으로 J/O 표를 Merge 직전 상태로 되돌리고 참조·비교 상태를 비운다.
   * Merge 이후의 수동 편집도 함께 사라지므로 ConfirmModal 로 먼저 경고한다.
   */
  const rollbackMergeSnapshot = () => {
    if (!mergeSnapshot) return;
    setJayerRows(mergeSnapshot.jayerRows);
    setOayerRows(mergeSnapshot.oayerRows);
    // Merge 로 추가됐던 행에 걸린 bb 매핑은 롤백하면 고아가 되므로 함께 정리한다.
    const keepIds = new Set(mergeSnapshot.jayerRows.map((r) => r.id));
    setBbRows((prev) => prev.filter((r) => !r.sourceJayerRowId || keepIds.has(r.sourceJayerRowId)));
    setMappedJayerRowIds((prev) => new Set(Array.from(prev).filter((id) => keepIds.has(id))));
    setStagedMappings((prev) => Object.fromEntries(
      Object.entries(prev).filter(([id]) => keepIds.has(id))
    ));
    setSelectedJayerRowId((prev) => (prev && !keepIds.has(prev) ? null : prev));
  };

  const handleMergeReselectConfirm = () => {
    rollbackMergeSnapshot();
    setRefDocId(null);
    setRefDocLabel('');
    setRefJayerRows([]);
    setRefOayerRows([]);
    clearMergeComparison(detail.merge_ref_mode);
    addToast(t('request.toast_merge_reselect'), 'info');
  };

  /** BEFORE/AFTER 표에서 행 선택(같은 행을 다시 누르면 해제) */
  const handleBaSelect = (side: 'before' | 'after', id: string) => {
    if (side === 'before') setBaSelBefore((prev) => (prev === id ? null : id));
    else setBaSelAfter((prev) => (prev === id ? null : id));
  };

  /**
   * 선택한 BEFORE·AFTER 를 즉시 확정한다(스테이징 단계 없음).
   * BEFORE 행은 여러 짝에 재사용할 수 있어 목록에 남기고, AFTER 행만 목록에서 뺀다.
   */
  const handleBaApply = () => {
    if (baSelBefore === null || baSelAfter === null) return;
    const before = baSelBefore === MERGE_UNREGISTERED_ID
      ? undefined
      : detail.merge_unmatched_before.find((r) => r.id === baSelBefore);
    const after = baSelAfter === MERGE_UNREGISTERED_ID
      ? undefined
      : detail.merge_unmatched_after.find((r) => r.id === baSelAfter);
    if (!before && !after) return;                                   // 양쪽 미등록은 의미가 없다
    if (before && after && before.table !== after.table) return;     // J-ayer ↔ O-ayer 교차 금지
    const table = (before ?? after)!.table;
    const pair: MergePair = {
      id: genId(),
      table,
      beforeId: before ? before.id : null,
      before: before ? { process_id: before.process_id, sp: before.sp, sd: before.sd, pp: before.pp, layerid: before.layerid } : null,
      afterId: after ? after.id : null,
      after: after ? { process_id: after.process_id, sp: after.sp, sd: after.sd, pp: after.pp, layerid: after.layerid } : null,
      kind: !before ? 'added' : (!after ? 'deleted' : 'changed'),
    };
    setDetail((prev) => ({
      ...prev,
      merge_pairs: [...prev.merge_pairs, pair],
      merge_unmatched_after: after
        ? prev.merge_unmatched_after.filter((r) => r.id !== after.id)
        : prev.merge_unmatched_after,
    }));
    setBaSelBefore(null);
    setBaSelAfter(null);
  };

  /**
   * 확정된 짝을 해제한다. BEFORE·AFTER 행이 각자의 표로 되돌아가되,
   * 재사용 중이라 이미 목록에 있는 행은 중복으로 추가하지 않는다.
   */
  const handleBaUnpair = (index: number) => {
    setDetail((prev) => {
      const pair = prev.merge_pairs[index];
      if (!pair) return prev;
      const nextBefore = [...prev.merge_unmatched_before];
      const nextAfter = [...prev.merge_unmatched_after];
      if (pair.before && pair.beforeId && !nextBefore.some((r) => r.id === pair.beforeId)) {
        nextBefore.push({ id: pair.beforeId, table: pair.table, ...pair.before });
      }
      if (pair.after && pair.afterId && !nextAfter.some((r) => r.id === pair.afterId)) {
        nextAfter.push({ id: pair.afterId, table: pair.table, ...pair.after });
      }
      return {
        ...prev,
        merge_pairs: prev.merge_pairs.filter((_, i) => i !== index),
        merge_unmatched_before: nextBefore,
        merge_unmatched_after: nextAfter,
      };
    });
    setBaSelBefore(null);
    setBaSelAfter(null);
  };

  // ===== 변경전/변경후 표 직접 편집 =====

  /** 한 행의 한쪽을 통째로 바꾼다 — 판정(kind)은 항상 미등록 여부에서 다시 계산한다. */
  const updateMergePair = (
    pairId: string,
    side: BaSide,
    next: (info: MergeRowInfo | null) => MergeRowInfo | null
  ) => {
    setDetail((prev) => ({
      ...prev,
      merge_pairs: prev.merge_pairs.map((pair) => {
        if (pair.id !== pairId) return pair;
        const updated = { ...pair, [side]: next(pair[side]) } as MergePair;
        return { ...updated, kind: deriveMergeKind(updated.before, updated.after) };
      }),
    }));
  };

  const handleBaCellChange = (pairId: string, side: BaSide, field: BaField, value: string) => {
    updateMergePair(pairId, side, (info) => ({ ...(info ?? emptyMergeRowInfo()), [field]: value }));
  };

  /** 포커스를 벗어날 때 4칸이 모두 비었으면 '미등록'(null)으로 접는다. */
  const handleBaCellBlur = (pairId: string, side: BaSide) => {
    updateMergePair(pairId, side, normalizeMergeSide);
  };

  /**
   * 엑셀 붙여넣기 — 붙여넣은 행부터 아래로 채운다. 열은 항상 process_id 부터 고정이며,
   * 행이 모자라면 새 행을 만든다(반대쪽은 미등록이라 양쪽 행 수가 함께 늘어난다).
   */
  const handleBaPasteRaw = (pairId: string, side: BaSide, raw: string) => {
    const grid = parseMergePasteRows(raw);
    if (grid.length === 0) return;
    setDetail((prev) => ({ ...prev, merge_pairs: applyMergePaste(prev.merge_pairs, pairId, side, grid) }));
  };

  const handleBaTableChange = (pairId: string, table: MergeTable) => {
    setDetail((prev) => ({
      ...prev,
      merge_pairs: prev.merge_pairs.map((pair) => (pair.id === pairId ? { ...pair, table } : pair)),
    }));
  };

  /** 새 행은 양쪽 미등록으로 시작한다. 구분은 마지막 행을 따라간다(연속 입력 편의). */
  const handleBaAddRow = () => {
    setDetail((prev) => ({
      ...prev,
      merge_pairs: [...prev.merge_pairs, emptyMergePair(prev.merge_pairs[prev.merge_pairs.length - 1]?.table)],
    }));
  };

  /** 그 행을 양쪽 미등록으로 되돌린다(행은 남는다 — 지우려면 ✕). */
  const handleBaResetRow = (pairId: string) => {
    setDetail((prev) => ({
      ...prev,
      merge_pairs: prev.merge_pairs.map((pair) => (
        pair.id === pairId
          ? { ...pair, before: null, after: null, kind: 'empty' as const }
          : pair
      )),
    }));
  };

  /**
   * 참조 요청서 있음/없음 전환 — 데이터가 무조건 초기화되므로 항상 확인 모달을 먼저 띄운다.
   * 확인 전에는 아무것도 바꾸지 않는다(취소하면 라디오도 원래 값 그대로 남는다).
   */
  const handleMergeModeSelect = (mode: MergeRefMode) => {
    if (mode === detail.merge_ref_mode) return;
    setMergeModeConfirm(mode);
  };

  /**
   * 확인 시: J/O 표를 Merge 직전으로 되돌리고(스냅샷이 있으면) 비교·참조 상태를 모두 비운 뒤 모드를 바꾼다.
   * '없음'은 짝지을 참조 문서가 없어 별도 Merge 클릭이 무의미하므로, 확인 즉시 확정하고
   * 변경전/변경후 표를 바로 연다(빈 행 1개로 시작). '있음'은 문서 선택 후 Merge 클릭이 여전히 필요하다.
   */
  const handleMergeModeConfirm = () => {
    const mode = mergeModeConfirm;
    if (mode === null) return;
    rollbackMergeSnapshot();
    setRefDocId(null);
    setRefDocLabel('');
    setRefJayerRows([]);
    setRefOayerRows([]);
    clearMergeComparison(mode);
    if (mode === 'none') {
      setDetail((prev) => ({
        ...prev,
        merge_applied: true,
        merge_pairs: prev.merge_pairs.length > 0 ? prev.merge_pairs : [emptyMergePair()],
      }));
    }
    setMergeModeConfirm(null);
  };

  // ===== ADI CD 변경 (요청 목적 — 진입/해제는 handleRequestPurposeSelect 가 담당) =====
  const adiCdSideKey = (side: 'before' | 'after'): 'adi_cd_before' | 'adi_cd_after' =>
    side === 'before' ? 'adi_cd_before' : 'adi_cd_after';

  const adiCdSideHasData = (side: 'before' | 'after') =>
    detail[adiCdSideKey(side)].some((r) => r.step_id.trim() || r.step_desc.trim());

  const adiCdTargetsHaveData = () =>
    detail.adi_cd_extra_targets.length > 0
    || adiCdTargetDraft.partid_selection.trim() !== ''
    || adiCdTargetDraft.process_id.trim() !== '';

  const adiCdHasData = () =>
    adiCdSideHasData('before') || adiCdSideHasData('after') || adiCdTargetsHaveData();

  // 표 안 행은 읽기 전용이다 — 입력칸(draft) 값은 여기서만 바뀐다.
  // 제품 이름을 바꾸면 조리법 입력칸은 비운다 — 이전 제품 기준 조리법이 새 제품에는 맞지 않을 수 있다.
  const handleAdiCdTargetDraftChange = (field: 'partid_selection' | 'process_id', value: string) => {
    setAdiCdTargetDraft((prev) => (
      field === 'partid_selection' ? { partid_selection: value, process_id: '' } : { ...prev, process_id: value }
    ));
  };

  // '추가' 클릭 — 입력칸 값을 검증(완전성·중복)해 통과해야 표에 반영한다. 실패하면 토스트로 막고
  // 표는 건드리지 않는다(입력칸 값도 그대로 남겨 사용자가 고쳐서 다시 시도할 수 있게 한다).
  const handleAdiCdTargetAdd = () => {
    const draft = adiCdTargetDraft;
    if (!draft.partid_selection.trim() || !draft.process_id.trim()) {
      addToast(t('request.adi_cd_targets_incomplete'), 'error');
      return;
    }
    const check = validateAdiCdTargets(
      { partid_selection: detail.partid_selection, process_id: detail.process_id },
      [...detail.adi_cd_extra_targets, draft]
    );
    if (check.hasDuplicate) {
      addToast(t('request.adi_cd_targets_duplicate'), 'error');
      return;
    }
    setDetail((prev) => ({
      ...prev,
      adi_cd_extra_targets: [...prev.adi_cd_extra_targets, { ...makeAdiCdTarget(), ...draft }],
    }));
    setAdiCdTargetDraft({ partid_selection: '', process_id: '' });
  };

  const handleAdiCdTargetDelete = (id: string) => {
    setDetail((prev) => ({ ...prev, adi_cd_extra_targets: prev.adi_cd_extra_targets.filter((r) => r.id !== id) }));
  };

  /** '미등록' 체크든 실제 값이든, 지우면 잃어버릴 게 있는 행인가(행 삭제 확인 판정용). */
  const adiCdRowIsMeaningful = (row: AdiCdStep) =>
    row.unregistered || !!row.step_id.trim() || !!row.step_desc.trim();

  const handleAdiCdCellChange = (side: 'before' | 'after', id: string, field: 'step_id' | 'step_desc', value: string) => {
    const key = adiCdSideKey(side);
    setDetail((prev) => ({ ...prev, [key]: prev[key].map((r) => (r.id === id ? { ...r, [field]: value } : r)) }));
  };

  // 변경전/변경후는 같은 인덱스끼리 짝을 이루어야 하므로(§행 수 동일 규칙) 행 추가는
  // 항상 양쪽에 동시에 일어난다 — 버튼도 하나로 통합했다.
  const handleAdiCdAddRow = () => {
    setDetail((prev) => ({
      ...prev,
      adi_cd_before: [...prev.adi_cd_before, makeAdiCdStep()],
      adi_cd_after: [...prev.adi_cd_after, makeAdiCdStep()],
    }));
  };

  /** 실제로 행을 지운다 — index 는 두 표에서 공통이다(짝을 이루므로). */
  const removeAdiCdRowAt = (index: number) => {
    setDetail((prev) => ({
      ...prev,
      adi_cd_before: prev.adi_cd_before.filter((_, i) => i !== index),
      adi_cd_after: prev.adi_cd_after.filter((_, i) => i !== index),
    }));
  };

  // 삭제 요청: 반대쪽 같은 인덱스 행에 잃어버릴 값이 있으면 확인 모달, 없으면 바로 양쪽에서 지운다.
  const handleAdiCdRemoveRow = (side: 'before' | 'after', id: string) => {
    const index = detail[adiCdSideKey(side)].findIndex((r) => r.id === id);
    if (index === -1) return;
    const otherSide = side === 'before' ? 'after' : 'before';
    const otherRow = detail[adiCdSideKey(otherSide)][index];
    if (otherRow && adiCdRowIsMeaningful(otherRow)) {
      setAdiCdRemoveConfirm({ index });
      return;
    }
    removeAdiCdRowAt(index);
  };

  const handleAdiCdRemoveConfirm = () => {
    if (!adiCdRemoveConfirm) return;
    removeAdiCdRowAt(adiCdRemoveConfirm.index);
    setAdiCdRemoveConfirm(null);
  };

  // 행 단위 '미등록' 토글. 켜면 그 행의 STEP_ID/STEP_DESC 를 비운다 — 미등록은 값이 없는 것이
  // 정상 상태라 잔존 값이 저장되면 안 된다. 끄면 빈 입력칸으로 돌아온다(이전 값 복원 없음).
  const handleAdiCdToggleUnregistered = (side: 'before' | 'after', id: string, next: boolean) => {
    const key = adiCdSideKey(side);
    setDetail((prev) => ({
      ...prev,
      [key]: prev[key].map((r) => (
        r.id === id ? { ...r, unregistered: next, step_id: '', step_desc: '' } : r
      )),
    }));
  };

  // startIndex 부터 rows.length 개만 덮어쓴다(엑셀 붙여넣기와 동일) — 그 앞뒤 기존 행은 그대로 둔다.
  // 이 붙여넣기로 이 쪽 표가 반대쪽보다 길어지면, 반대쪽 끝에 빈 행을 채워 개수를 다시 맞춘다.
  const commitAdiCdRows = (side: 'before' | 'after', rows: AdiCdStep[], startIndex: number) => {
    const key = adiCdSideKey(side);
    setDetail((prev) => {
      const merged = [
        ...prev[key].slice(0, startIndex),
        ...rows,
        ...prev[key].slice(startIndex + rows.length),
      ];
      const balanced = balanceAdiCdRows(
        side === 'before' ? merged : prev.adi_cd_before,
        side === 'after' ? merged : prev.adi_cd_after
      );
      return { ...prev, adi_cd_before: balanced.before, adi_cd_after: balanced.after };
    });
  };

  // 파싱된 행을 실제로 적용 — 500행 초과·0행 거부, 붙여넣는 범위에 이미 값이 있으면 확인 모달 후 그 범위만 덮어쓴다.
  const requestAdiCdApply = (side: 'before' | 'after', rows: AdiCdStep[], startIndex: number) => {
    if (rows.length === 0) { addToast(t('request.adi_cd_paste_empty'), 'error'); return; }
    if (rows.length > ADI_CD_MAX_ROWS) { addToast(t('request.adi_cd_paste_too_many', { max: ADI_CD_MAX_ROWS }), 'error'); return; }
    const overwritten = detail[adiCdSideKey(side)].slice(startIndex, startIndex + rows.length);
    const overwritesData = overwritten.some((r) => r.step_id.trim() || r.step_desc.trim());
    if (overwritesData) setAdiCdPendingApply({ side, rows, startIndex });
    else commitAdiCdRows(side, rows, startIndex);
  };

  // 붙여넣기 시작 행(포커스돼 있던 셀의 행) id → 현재 표에서의 인덱스. 못 찾으면(표가 비었거나
  // 포커스 없이 붙여넣은 경우) 0부터(표 처음부터) 채운다.
  const adiCdStartIndex = (side: 'before' | 'after', startRowId: string | null): number => {
    if (!startRowId) return 0;
    const idx = detail[adiCdSideKey(side)].findIndex((r) => r.id === startRowId);
    return idx === -1 ? 0 : idx;
  };

  // 붙여넣기 원문 → 파싱 → 모달 필요 여부 판정(§5). 실제 적용은 requestAdiCdApply 로 위임.
  const handleAdiCdPasteRaw = (side: 'before' | 'after', raw: string, startRowId: string | null) => {
    const grid = parseClipboardTable(raw);
    if (grid.length === 0) { addToast(t('request.adi_cd_paste_empty'), 'error'); return; }
    const decision = decideAdiCdPaste(grid);
    const startIndex = adiCdStartIndex(side, startRowId);
    if (!decision.needsModal) {
      // 2열이면 헤더 인식 여부와 무관하게 즉시 적용한다 — 헤더가 있으면 그 행만 건너뛰고,
      // 없으면 1열=STEPSEQ·2열=STEP 설명으로 전체를 데이터로 본다.
      const mapping = decision.header ?? { stepIdCol: 0, stepDescCol: 1 };
      const dataStartRow = decision.header ? decision.header.headerRow + 1 : 0;
      const rows = buildAdiCdRows(grid, mapping, dataStartRow);
      requestAdiCdApply(side, rows, startIndex);
      return;
    }
    setAdiCdMapModal({ side, grid, header: decision.header, startIndex });
  };

  const handleAdiCdMapConfirm = (mapping: { stepIdCol: number; stepDescCol: number; skipFirstRow: boolean }) => {
    if (!adiCdMapModal) return;
    const rows = buildAdiCdRows(adiCdMapModal.grid, mapping, mapping.skipFirstRow ? 1 : 0);
    const { side, startIndex } = adiCdMapModal;
    setAdiCdMapModal(null);
    requestAdiCdApply(side, rows, startIndex);
  };

  // ===== Bb Entry Handlers (Step 1 - 뼈찜 조합 영역 다중 행) =====
  // 특정 bb_entry(id)에서 나온 결과표 행을 제거하고 그 원본 J행 매핑을 해제한다(재매핑 가능).
  // 항목 삭제/수정 시 stale 매핑이 남지 않도록 공용으로 사용.
  const clearMappedBbRowsForEntry = (entryId: string) => {
    if (!bbRows.some((r) => r.entryId === entryId)) return;
    const removedSourceJayerIds = bbRows
      .filter((r) => r.entryId === entryId && r.sourceJayerRowId)
      .map((r) => r.sourceJayerRowId as string);
    setBbRows((prev) => prev.filter((r) => r.entryId !== entryId));
    if (removedSourceJayerIds.length > 0) {
      setMappedJayerRowIds((prev) => {
        const next = new Set(prev);
        removedSourceJayerIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const handleBbEntryChange = (idx: number, field: 'location' | 'product' | 'process_id', value: string) => {
    const target = detail.bb_entries[idx];
    if (!target || target[field] === value) return; // 값 변경 없음 → 무동작(매핑 보존)
    // 매핑된 출처(bb_entry)를 수정하면 그 항목의 결과표 행을 정리하고 원본 J행 매핑을 해제한다.
    // → 새 제품/조리법 데이터로 다시 매핑하도록 유도(stale 데이터 방지).
    clearMappedBbRowsForEntry(target.id);
    setDetail((prev) => ({
      ...prev,
      bb_entries: prev.bb_entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)),
    }));
    // 외부데이터 조회/토스트는 외부데이터 effect가 "조리법이 옵션에 정확히 일치"할 때 한 번만 처리한다.
    // (여기서 별도 조회하던 토스트 전용 fetch는 이중 조회라 제거 — R-04)
  };

  const handleBbEntryAdd = () => {
    setDetail((prev) => ({
      ...prev,
      bb_entries: [...prev.bb_entries, makeBbEntry()],
    }));
  };

  // bb_entry 삭제: 해당 항목(id)에서 나온 결과표 행 제거 + 원본 J행 매핑 해제(재노출).
  // entryId가 안정 id이므로 인덱스 시프트가 필요 없다(옵션/검색어 캐시의 잔여 키는 안 읽혀 무해,
  // bbExternalData·activeBbTab은 [bb_entries] effect가 재조회·탭0으로 재구성).
  const handleBbEntryDelete = (idx: number) => {
    if (detail.bb_entries.length <= 1) return;
    const delId = detail.bb_entries[idx].id;
    clearMappedBbRowsForEntry(delId);
    setDetail((prev) => ({ ...prev, bb_entries: prev.bb_entries.filter((_, i) => i !== idx) }));
    setBbAutoFillRanges((prev) => prev.filter((r) => r.entryId !== delId));
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
      .filter((jr) => !jr.disabled && stagedMappings[jr.id])
      .map((jr) => {
        const ext = stagedMappings[jr.id];
        const newRow = makeBbRow();
        newRow.sourceJayerRowId = jr.id;
        newRow.process_id = jr.process_id;
        newRow.ss = jr.sp;
        newRow.sd = jr.sd;
        newRow.bb_process_id = ext.bb_process_id;
        newRow.bb_name = formatBbName(ext.location ?? '', ext.bb_name);
        newRow.entryId = ext.entryId;
        // 자동 채움(makeBbRowFromMatch)과 동일하게 layer 컬럼을 외부 데이터의 layerid로 채운다.
        newRow.bb_layer = ext.layerid ?? '';
        newRow.bb_ss = ext.bb_ss;
        newRow.bb_step = ext.bb_step;
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
    // 원본 데이터 목록에 남은(미매핑) 행 기준으로 기본 범위를 시드한다.
    const layerIds = [...new Set(jayerRows.filter(r => !r.disabled && !isNocSpecial(r.new_or_copy) && !mappedJayerRowIds.has(r.id)).map(r => r.layerid).filter(Boolean))]
      .sort((a, b) => parseFloat(a) - parseFloat(b));

    // 제품이 입력된 첫 bb_entries 항목을 기본 선택값(id)으로 시드한다.
    const firstProductEntry = detail.bb_entries.find(e => e.product);

    if (layerIds.length > 0 && firstProductEntry) {
      setBbAutoFillRanges([{
        id: String(Date.now()),
        layerFrom: layerIds[0],
        layerTo: layerIds[layerIds.length - 1],
        entryId: firstProductEntry.id,
      }]);
    } else {
      setBbAutoFillRanges([]);
    }
    setShowAutoFillPanel(true);
  };

  const handleAddRange = () => {
    const seedEntry = detail.bb_entries.find(e => e.product) ?? detail.bb_entries[0];
    setBbAutoFillRanges(prev => [
      ...prev,
      {
        id: String(Date.now()),
        layerFrom: '',
        layerTo: '',
        entryId: seedEntry?.id ?? '',
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

  // 매칭된 외부데이터 1건 + J-ayer 행 + bb_entry 로 bb 결과 행 하나를 만든다(자동채움/확인모달 선택 공용).
  const makeBbRowFromMatch = (
    jayerRow: JayerRow,
    entry: { id: string; location: string; product: string },
    matchedStep: PhotoStepOption,
  ): BbTableRow => ({
    id: genId(),
    sourceJayerRowId: jayerRow.id,
    sortOrder: jayerRow.sortOrder,
    disabled: jayerRow.disabled,
    process_id: jayerRow.process_id,
    ss: jayerRow.sp,
    sd: jayerRow.sd,
    bb_process_id: matchedStep.processid,
    bb_name: formatBbName(entry.location, entry.product),
    bb_layer: matchedStep.layerid,
    bb_ss: matchedStep.stepseq,
    bb_step: matchedStep.descript,
    remark: '',
    entryId: entry.id,
  });

  /**
   * 자동채움 매칭 규칙: layerid 일치 ∪ (sp===stepseq, 둘 다 값이 있을 때만) 일치를 후보로 모은다.
   * 후보가 0개면 스킵(매칭 없음), 1개면 바로 확정, 2개 이상이면 확인모달 대상(ambiguous)으로 분류한다.
   */
  const buildAutoFillPlan = (): { resolved: BbTableRow[]; ambiguous: BbAutoFillAmbiguousRow[] } => {
    const resolved: BbTableRow[] = [];
    const ambiguous: BbAutoFillAmbiguousRow[] = [];
    bbAutoFillRanges.forEach(range => {
      if (!range.layerFrom || !range.layerTo || !range.entryId) return;
      const from = parseFloat(range.layerFrom);
      const to = parseFloat(range.layerTo);
      if (isNaN(from) || isNaN(to)) return;

      const jayerRowsInRange = jayerRows.filter(row => {
        const layer = parseFloat(row.layerid);
        // 원본 데이터 목록에 남은(미매핑) 행만 자동채움 대상으로 한다.
        // 이미 채워진 행은 목록에서 빠지므로 재채움/덮어쓰기가 발생하지 않는다.
        return !row.disabled && !isNocSpecial(row.new_or_copy) && !mappedJayerRowIds.has(row.id) && !isNaN(layer) && layer >= from && layer <= to;
      });

      // 선택 항목을 안정 id로 집어 라인+제품을 유일하게 식별한다.
      // (제품명만으로 찾으면 라인만 다른 동일 제품을 구분 못 함)
      const entryPos = detail.bb_entries.findIndex(e => e.id === range.entryId);
      const entry = detail.bb_entries[entryPos];
      if (!entry || !entry.product) return;

      // 외부데이터(bbExternalData)는 위치 배열이므로 현재 위치로 인덱싱한다(매번 effect가 재구성).
      const photoSteps = bbExternalData[entryPos] ?? [];
      jayerRowsInRange.forEach(jayerRow => {
        const layerMatches = photoSteps.filter(step => step.layerid === jayerRow.layerid);
        const seqMatches = jayerRow.sp
          ? photoSteps.filter(step => !!step.stepseq && step.stepseq === jayerRow.sp)
          : [];
        const candidates = Array.from(new Set([...layerMatches, ...seqMatches]));

        if (candidates.length === 0) return; // 매칭 없음 — 조용히 스킵
        if (candidates.length === 1) {
          resolved.push(makeBbRowFromMatch(jayerRow, entry, candidates[0]));
          return;
        }
        ambiguous.push({
          jayerRowId: jayerRow.id,
          process_id: jayerRow.process_id,
          sp: jayerRow.sp,
          sd: jayerRow.sd,
          layerid: jayerRow.layerid,
          entryId: entry.id,
          candidates,
        });
      });
    });
    return { resolved, ambiguous };
  };

  // 자동채움은 "원본 목록에 남은(미매핑) 행"만 대상으로 하므로 기존 bb 행과 겹칠 수 없다.
  // 따라서 덮어쓰기/충돌 없이 항상 결과 표에 추가(append)만 한다.
  const applyBbRowChanges = (rowsToAdd: BbTableRow[]) => {
    setBbRows(prev => [...prev, ...rowsToAdd]);
    setMappedJayerRowIds(prevMapped => {
      const next = new Set(prevMapped);
      rowsToAdd.forEach(r => {
        if (r.sourceJayerRowId) next.add(r.sourceJayerRowId);
      });
      return next;
    });
    setShowAutoFillPanel(false);
    setBbAutoFillRanges([]);
    addToast(t('request.toast_bb_autofill_apply', { count: rowsToAdd.length }), 'success');
  };

  const handleApplyAutoFill = () => {
    const { resolved, ambiguous } = buildAutoFillPlan();
    if (resolved.length === 0 && ambiguous.length === 0) {
      if (!isTourMode) addToast(t('request.toast_bb_autofill_apply_empty'), 'info');
      return;
    }
    if (ambiguous.length === 0) {
      applyBbRowChanges(resolved);
      return;
    }
    // 후보가 여러 개인 행이 있으면 바로 적용하지 않고 확인 모달에서 선택받는다.
    setBbAutoFillPendingResolved(resolved);
    setBbAutoFillAmbiguous(ambiguous);
    setBbAutoFillAmbiguousChoices({});
  };

  const handleBbAmbiguousChoice = (jayerRowId: string, choice: number | 'skip') => {
    setBbAutoFillAmbiguousChoices(prev => ({ ...prev, [jayerRowId]: choice }));
  };

  const handleCancelBbAmbiguous = () => {
    setBbAutoFillAmbiguous([]);
    setBbAutoFillPendingResolved([]);
    setBbAutoFillAmbiguousChoices({});
  };

  const handleResolveBbAmbiguous = () => {
    const extraRows: BbTableRow[] = [];
    bbAutoFillAmbiguous.forEach(item => {
      const choice = bbAutoFillAmbiguousChoices[item.jayerRowId];
      if (choice === undefined || choice === 'skip') return;
      const candidate = item.candidates[choice];
      const entry = detail.bb_entries.find(e => e.id === item.entryId);
      const jayerRow = jayerRows.find(r => r.id === item.jayerRowId);
      if (!candidate || !entry || !jayerRow) return;
      extraRows.push(makeBbRowFromMatch(jayerRow, entry, candidate));
    });
    const allRows = [...bbAutoFillPendingResolved, ...extraRows];
    setBbAutoFillAmbiguous([]);
    setBbAutoFillPendingResolved([]);
    setBbAutoFillAmbiguousChoices({});
    if (allRows.length === 0) {
      if (!isTourMode) addToast(t('request.toast_bb_autofill_apply_empty'), 'info');
      return;
    }
    applyBbRowChanges(allRows);
  };

  const handleResetBbRows = () => {
    setBbResetConfirm(true);
  };

  const proceedResetBbRows = () => {
    setBbRows([]);
    setMappedJayerRowIds(new Set());
    addToast(t('request.toast_bb_reset'), 'info');
  };

  // 가이드 BB 데모가 매 렌더의 최신 핸들러/상태를 참조하도록 갱신 (stale closure 방지)
  if (isTourMode) {
    tourRef.current = {
      jayerRows,
      bbExternalData,
      handleOpenAutoFillPanel,
      handleApplyAutoFill,
      handleStageMapping,
      handleApplyMappings,
    };
    // 되감기 스냅샷용 현재 상태 — 메시지 핸들러가 stale closure 없이 회신할 수 있도록 ref에 보관
    snapStateRef.current = {
      step,
      detail,
      jayerRows,
      bbRows,
      oayerInfoTab,
      showAutoFillPanel,
      bbAutoFillRanges,
      stagedMappings,
      mappedJayerRowIds: Array.from(mappedJayerRowIds),
      activeBbTab,
      confirmOpen,
      submitNote,
      designees,
    };
  }

  const handleFilterDeleteConfirm = () => {
    if (!filterDeleteConfirm) return;
    const { type, filterId, label } = filterDeleteConfirm;
    if (type === 'jayer') {
      const updated = jayerFilterSets.filter(f => f.id !== filterId);
      const nextActive = new Set(jayerActiveFilterIds);
      nextActive.delete(filterId);
      setJayerFilterSets(updated);
      setJayerActiveFilterIds(nextActive);
      localStorage.setItem('jayerFilterSets', JSON.stringify(updated));
      setJayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, updated, nextActive) })));
    } else {
      const updated = oayerFilterSets.filter(f => f.id !== filterId);
      const nextActive = new Set(oayerActiveFilterIds);
      nextActive.delete(filterId);
      setOayerFilterSets(updated);
      setOayerActiveFilterIds(nextActive);
      localStorage.setItem('oayerFilterSets', JSON.stringify(updated));
      setOayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, updated, nextActive) })));
    }
    addToast(`필터 "${label}"이 삭제되었습니다.`, 'info');
  };

  const handleFilterAllDeleteConfirm = () => {
    if (!filterAllDeleteConfirm) return;
    if (filterAllDeleteConfirm === 'jayer') {
      setJayerFilterSets([]);
      setJayerActiveFilterIds(new Set());
      localStorage.removeItem('jayerFilterSets');
      setJayerRows(rows => rows.map(r => ({ ...r, disabled: r.manuallyDisabled })));
    } else {
      setOayerFilterSets([]);
      setOayerActiveFilterIds(new Set());
      localStorage.removeItem('oayerFilterSets');
      setOayerRows(rows => rows.map(r => ({ ...r, disabled: r.manuallyDisabled })));
    }
    addToast('모든 필터가 삭제되었습니다.', 'info');
  };

  const handleSortBbRows = () => {
    setBbRows(prev => {
      const sorted = [...prev].sort((a, b) =>
        a.ss.localeCompare(b.ss, undefined, { numeric: true })
      );
      return sorted;
    });
  };

  // ===== Validation =====
  /**
   * Backbone 조합 영역(STEP1) 검증 — required 에 따라 판정 기준이 달라진다.
   *  · required=true  : 모든 항목이 완전히(위치·제품·조리법) 입력돼야 한다. 불필요한 항목은 삭제하도록 유도.
   *  · required=false : 빈 항목은 허용하고, 일부만 채운 항목만 막는다.
   * 판정 자체는 helpers 의 순수 함수(findBbEntryViolations)가 하고, 여기서는 메시지만 붙인다.
   */
  const addBbEntryError = (
    newErrors: Partial<Record<string, string>>,
    errorMessages: string[],
    required: boolean
  ) => {
    if (findBbEntryViolations(detail.bb_entries, required).length === 0) return;
    const msg = t(required ? 'request.bb_entries_required' : 'request.bb_entries_partial');
    newErrors['bb_entries'] = msg;
    errorMessages.push(msg);
  };

  /**
   * J/O-layer 표의 st·new_or_copy 공란 검증 — 활성 행은 두 값을 반드시 채워야 한다.
   * 오류 셀은 차용 행 검증(jayer_noc_*)과 같은 방식으로 표 안에서 강조한다.
   */
  const addStNocError = (
    newErrors: Partial<Record<string, string>>,
    errorMessages: string[],
    table: 'jayer' | 'oayer',
    rows: { id: string; disabled: boolean; st: string; new_or_copy: string }[]
  ) => {
    const violations = findEmptyStNocViolations(rows);
    if (violations.length === 0) return;
    violations.forEach((id) => {
      newErrors[`${table}_stnoc_${id}_st`] = t('request.stnoc_field_error');
      newErrors[`${table}_stnoc_${id}_new_or_copy`] = t('request.stnoc_field_error');
    });
    const msg = t(`request.${table}_stnoc_required` as never, { count: violations.length }) as string;
    newErrors[`${table}_stnoc_required`] = msg;
    errorMessages.push(msg);
  };

  /**
   * BEFORE/AFTER 게이트 — AFTER 항목이 하나라도 짝 없이 남아 있으면 진행을 막는다.
   * (BEFORE 잔여는 허용한다. 임시저장은 이 검증을 타지 않는다)
   */
  const addBaGateError = (
    newErrors: Partial<Record<string, string>>,
    errorMessages: string[]
  ) => {
    const pending = detail.merge_unmatched_after?.length ?? 0;
    if (pending > 0) {
      const msg = t('request.ba_gate_ng', { count: pending });
      newErrors['merge_unmatched_after'] = msg;
      errorMessages.push(msg);
    }
    // 표를 직접 채울 수 있으므로 확정한 짝도 검사한다 —
    // 미등록이 아닌 쪽은 4칸 필수, 양쪽 미등록인 빈 행은 남길 수 없다.
    // '없음' 으로 확정했으면 유효 행이 1건 이상이어야 한다.
    if (!detail.merge_applied && detail.merge_ref_doc_id === null) return;
    const { incompleteCells, blankRows, validCount } = validateMergePairs(detail.merge_pairs ?? []);
    if (detail.merge_ref_mode === 'none' && validCount === 0) {
      const msg = t('request.ba_gate_manual_empty');
      newErrors['merge_pairs'] = msg;
      errorMessages.push(msg);
    }
    if (incompleteCells > 0) {
      const msg = t('request.ba_gate_manual_incomplete', { count: incompleteCells });
      newErrors['merge_pairs'] = msg;
      errorMessages.push(msg);
    }
    if (blankRows > 0) {
      const msg = t('request.ba_gate_manual_blank_row', { count: blankRows });
      newErrors['merge_pairs_blank'] = msg;
      errorMessages.push(msg);
    }
  };

  /**
   * ADI CD 변경 게이트 — 켜져 있으면 항상 적용된다(다른 목적과 함께 선택해도).
   * BEFORE/AFTER 각각 독립 검사: 유효 행 1개 이상 / 불완전 행 0개 / STEP_ID 중복 0개.
   * 행 개수 동일 검사는 안전망이다 — 행 추가/삭제/붙여넣기가 항상 양쪽을 함께 맞추므로
   * (§helpers.ts balanceAdiCdRows) 정상 흐름에서는 걸릴 일이 없다.
   */
  const addAdiCdGateError = (
    newErrors: Partial<Record<string, string>>,
    errorMessages: string[]
  ) => {
    if (!isAdiCdSelected) return;
    const checkSide = (side: 'before' | 'after', rows: AdiCdStep[]) => {
      const result = validateAdiCdRows(rows);
      const key = side === 'before' ? 'adi_cd_before' : 'adi_cd_after';
      if (result.validCount === 0) {
        const msg = t(`request.adi_cd_gate_${side}_empty` as never) as string;
        newErrors[key] = msg;
        errorMessages.push(msg);
        return;
      }
      if (result.incompleteIds.length > 0 || result.duplicateIds.length > 0) {
        const msg = t(`request.adi_cd_gate_${side}_invalid` as never) as string;
        newErrors[key] = msg;
        errorMessages.push(msg);
      }
    };
    checkSide('before', detail.adi_cd_before);
    checkSide('after', detail.adi_cd_after);
    if (detail.adi_cd_before.length !== detail.adi_cd_after.length) {
      const msg = t('request.adi_cd_gate_length_mismatch') as string;
      newErrors['adi_cd_after'] = msg;
      errorMessages.push(msg);
    }
    // '동일 변경 적용 대상' 검사도 안전망이다 — "추가" 버튼(handleAdiCdTargetAdd)이 클릭 시점에
    // 이미 완전성·중복을 막으므로 정상 흐름에서는 걸릴 일이 없다.
    const targetsValidation = validateAdiCdTargets(
      { partid_selection: detail.partid_selection, process_id: detail.process_id },
      detail.adi_cd_extra_targets
    );
    if (targetsValidation.hasIncomplete || targetsValidation.hasDuplicate) {
      const msg = t(
        (targetsValidation.hasDuplicate ? 'request.adi_cd_targets_duplicate' : 'request.adi_cd_targets_incomplete') as never
      ) as string;
      newErrors['adi_cd_extra_targets'] = msg;
      errorMessages.push(msg);
    }
  };

  // redirectStep: 오류를 고칠 수 있는 단계가 currentStep 이 아닐 때만 채워진다(현재는 Backbone 조합 영역 → STEP1).
  const validate = (currentStep: number): { valid: boolean; errors: string[]; redirectStep?: number } => {
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
      // 제품 이름(partid_selection)은 목록에 있는 값만 허용 (값은 있으나 목록 밖이면 진행 차단)
      const partidVal = detail.partid_selection.trim();
      if (partidVal && !productOptions.includes(partidVal)) {
        newErrors['partid_selection'] = t('request.partid_not_in_list');
        errorMessages.push(t('request.partid_not_in_list'));
      }
      // Backbone 조합 영역은 STEP1 에서 더 이상 무조건 필수가 아니다.
      // 필수 여부는 J-layer 표(st 가 'O 계열'인 활성 행의 존재)가 정하며, 그 검증은 STEP3→4 에서 한다.
      // 여기서는 '일부만 채운 항목'만 막는다 — 세 칸 중 일부만 채워진 항목은 어떤 경우에도 잘못된 값이다.
      // (Only MAP·ADI CD 단독 모드용 우회 분기는 필요 없다. 그 문서들은 J-layer 에 O 행이 생기지 않는다.)
      addBbEntryError(newErrors, errorMessages, requiresBbEntries(jayerRows));
      // 흐름도 Step(step_from/step_to)은 목록에 있는 값만 허용 (목록 밖 값이면 해당 필드를 표시하고 진행 차단)
      let flowStepInvalid = false;
      detail.flow_chart.forEach((row) => {
        const opts = FlowLayerIdOptions[row.id] || [];
        (['step_from', 'step_to'] as const).forEach((f) => {
          const v = (row[f] || '').trim();
          if (v && !opts.includes(v)) {
            newErrors[`flow_step_${row.id}_${f}`] = t('request.flow_step_not_in_list');
            flowStepInvalid = true;
          }
        });
      });
      if (flowStepInvalid) {
        errorMessages.push(t('request.flow_step_not_in_list'));
      }
      // 흐름도 행 중 위치/제품이름/조리법/Step 중 하나라도 값이 있으면 나머지 전부를 채워야 상신 가능
      let flowRowIncomplete = false;
      detail.flow_chart.forEach((row) => {
        const fields: (keyof Omit<FlowChartRow, 'id'>)[] = ['location', 'product_name', 'process_id', 'step_from', 'step_to'];
        const values = fields.map((f) => (row[f] || '').trim());
        const anyFilled = values.some((v) => !!v);
        const allFilled = values.every((v) => !!v);
        if (anyFilled && !allFilled) {
          fields.forEach((f, i) => {
            if (!values[i]) {
              newErrors[`flow_step_${row.id}_${f}`] = t('request.flow_row_incomplete');
            }
          });
          flowRowIncomplete = true;
        }
      });
      if (flowRowIncomplete) {
        errorMessages.push(t('request.flow_row_incomplete'));
      }
      addBaGateError(newErrors, errorMessages);
      addAdiCdGateError(newErrors, errorMessages);
    }

    if (currentStep === 2) {
      if (!detail.map_type?.trim()) {
        newErrors['map_type'] = t('request.required');
        errorMessages.push('MAP 요청 목적: 필수 입력 항목입니다.');
      }
      // MAP 삭제('수정'·'삭제')은 이유 입력칸 하나만 화면에 남는다.
      // 나머지 MAP 블록은 렌더 자체를 하지 않으므로 검증도 전부 건너뛴다
      // — '숨김 = 검증 제외'를 여기서 명시적으로 끊어 두지 않으면, 나중에 INITIAL_DETAIL
      //   기본값이 바뀔 때 화면에 없는 항목 때문에 진행이 막히는 버그가 생긴다.
      if (isMapReasonMode) {
        // RichTextEditor 는 빈 내용도 '<p></p>' 같은 빈 태그를 남기므로 태그를 걷어내고 판정한다.
        const reasonText = (detail.map_change_reason || '')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim();
        const hasImage = /<img\b/i.test(detail.map_change_reason || '');
        if (!reasonText && !hasImage) {
          newErrors['map_change_reason'] = t('request.required');
          errorMessages.push('MAP 삭제 이유: 필수 입력 항목입니다.');
        }
        // 정식 종료와 동일한 판정 기준(newErrors 기준)을 쓴다.
        setErrors(newErrors);
        return { valid: Object.keys(newErrors).length === 0, errors: errorMessages };
      }
      // CLONE(차용)·EXISTING(기등록)은 원본 위치/Part ID가 필수(R-13). NEW는 해당 없음.
      if (isMapRegisteredType(detail.map_type)) {
        if (!detail.source_line?.trim()) {
          newErrors['source_line'] = t('request.required');
          errorMessages.push('원본 위치: 필수 입력 항목입니다.');
        }
        if (!detail.source_partid?.trim()) {
          newErrors['source_partid'] = t('request.required');
          errorMessages.push('원본 Part ID: 필수 입력 항목입니다.');
        }
      }
      // Final 은 map_type 과 무관한 독립 항목이지만, C가문(only_prodc=YES) 일 때는
      // 최소 1건 등록을 강제한다(CLONE/EXISTING 잠금과도 무관 — Final 입력칸 자체가 잠기지 않는다).
      if (detail.only_prodc === 'Yes' && (detail.final_entries ?? []).length === 0) {
        newErrors['final_entries'] = t('request.final_entries_required');
        errorMessages.push('Final: C가문 Yes 일 때 1개 이상 등록해야 합니다.');
      }
      if (!isMapRegistered) {
      if (detail.only_prodc === 'Yes') {
        // 제품 해당 위치(prodc_scope)를 먼저 골라야 나머지 C가문 입력이 열린다.
        if (!prodcScopeSet) {
          newErrors['prodc_scope'] = t('request.required');
          errorMessages.push('제품 해당 위치: 필수 선택 항목입니다.');
        }
        // C가문 Yes: 살아있는(ONLY 로 죽지 않은) 리전 중 '변경 있음'인 곳만 X/Y 필수.
        const REGION_LABEL = { top: '북쪽', bottom: '남쪽' } as const;
        (['top', 'bottom'] as const).forEach((region) => {
          if (!regionHasMapChange(region)) return;
          if (!detail[`map_value_x_${region}`]?.trim()) {
            newErrors[`map_value_x_${region}`] = t('request.required');
            errorMessages.push(`MAP 변경 X (${REGION_LABEL[region]}): 필수 입력 항목입니다.`);
          }
          if (!detail[`map_value_y_${region}`]?.trim()) {
            newErrors[`map_value_y_${region}`] = t('request.required');
            errorMessages.push(`MAP 변경 Y (${REGION_LABEL[region]}): 필수 입력 항목입니다.`);
          }
        });
        // 사유는 한 리전이라도 '변경 있음'일 때만 필수
        if (anyRegionMapChange && !detail.map_reason?.trim()) {
          newErrors['map_reason'] = t('request.required');
          errorMessages.push('MAP 변경 사유: 필수 입력 항목입니다.');
        }
        // 북·남 상호검증은 두 리전이 모두 살아있고 모두 '변경 있음'일 때만 성립한다
        // (ONLY 스코프이거나 한쪽이 '변경 없음'이면 비교 대상 자체가 없다).
        if (regionHasMapChange('top') && regionHasMapChange('bottom')) {
          // X값 부호 반대 + 절대값 동일 검증
          if (detail.map_value_x_top?.trim() && detail.map_value_x_bottom?.trim()) {
            const xTop = parseFloat(detail.map_value_x_top);
            const xBot = parseFloat(detail.map_value_x_bottom);
            if (!isNaN(xTop) && !isNaN(xBot)) {
              // 절대값은 항상 동일해야 하고, 0이 아닐 때만 부호가 서로 반대여야 한다
              // (0/0 은 부호 개념이 없으므로 Y처럼 허용).
              if (Math.abs(xTop) !== Math.abs(xBot) || (xTop !== 0 && Math.sign(xTop) === Math.sign(xBot))) {
                newErrors['map_value_x_bottom'] = t('request.map_x_sign_error');
                errorMessages.push(t('request.map_x_sign_error'));
              }
            }
          }
          // Y값 동일 검증
          if (detail.map_value_y_top?.trim() && detail.map_value_y_bottom?.trim()) {
            if (detail.map_value_y_top.trim() !== detail.map_value_y_bottom.trim()) {
              newErrors['map_value_y_bottom'] = t('request.map_y_equal_error');
              errorMessages.push(t('request.map_y_equal_error'));
            }
          }
        }
      } else if (detail.map_change === '변경 있음') {
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
      if (detail.ea_change === EA_HAS_CHANGE) {
        if (!detail.ea_value?.trim()) {
          newErrors['ea_value'] = t('request.required');
          errorMessages.push('예외 구역 값: 필수 입력 항목입니다.');
        }
      }
      if (detail.inter === 'YES') {
        if (!detail.in_apply?.trim()) {
          newErrors['in_apply'] = t('request.required');
          errorMessages.push('IN 적용 여부: 필수 선택 항목입니다.');
        }
        if (!detail.inter_select?.trim()) {
          newErrors['inter_select'] = t('request.required');
          errorMessages.push('IN 적용 대상: 필수 선택 항목입니다.');
        }
      }
      if (detail.only_prodc === 'Yes') {
        (['top', 'bottom'] as const).forEach((region) => {
          // ONLY 스코프로 죽은 리전은 값이 비워져 있으므로 필수 검증 대상이 아니다.
          if (prodcRegionOff(region)) return;
          if (!detail[`prodc_${region}_line` as keyof DetailFormState]?.toString().trim()) {
            newErrors[`prodc_${region}_line`] = t('request.required');
            errorMessages.push(`C가문 ${region === 'top' ? '북쪽' : '남쪽'} 위치: 필수 입력 항목입니다.`);
          }
          if (!detail[`prodc_${region}_process` as keyof DetailFormState]?.toString().trim()) {
            newErrors[`prodc_${region}_process`] = t('request.required');
            errorMessages.push(`C가문 ${region === 'top' ? '북쪽' : '남쪽'} 조합법: 필수 입력 항목입니다.`);
          }
          if (!detail[`prodc_${region}_product` as keyof DetailFormState]?.toString().trim()) {
            newErrors[`prodc_${region}_product`] = t('request.required');
            errorMessages.push(`C가문 ${region === 'top' ? '북쪽' : '남쪽'} 제품: 필수 입력 항목입니다.`);
          }
        });
      }
      if (detail.mshot_change === '추가' || detail.mshot_change === '수정') {
        if (detail.only_prodc === 'Yes') {
          // ONLY 스코프로 죽은 리전의 이미지는 필수가 아니다(값도 비워져 있다).
          if (!prodcRegionOff('top') && !detail.mshot_image_copy_top) {
            newErrors['mshot_image_copy_top'] = t('request.required');
            errorMessages.push('X표시 이미지 (북쪽): 필수 입력 항목입니다.');
          }
          if (!prodcRegionOff('bottom') && !detail.mshot_image_copy_bottom) {
            newErrors['mshot_image_copy_bottom'] = t('request.required');
            errorMessages.push('X표시 이미지 (남쪽): 필수 입력 항목입니다.');
          }
        } else {
          if (!detail.mshot_image_copy) {
            newErrors['mshot_image_copy'] = t('request.required');
            errorMessages.push('X표시 이미지: 필수 입력 항목입니다.');
          }
        }
      }
      } // end !isMapRegistered
    }

    // step 3(J-layer)·step 4 O-layer 행은 그 외에는 의도적으로 행 단위 필수값 검증을 두지 않는다(행은 선택사항).
    // 예외: new_or_copy='차용' 행은 product_name·step 필수(아래). 상신 시 step 5의
    // "활성 + process_id 있는 J-layer 행은 Bb 매핑 필수" 규칙으로도 간접 검증된다.

    if (currentStep === 3) {
      addStNocError(newErrors, errorMessages, 'jayer', jayerRows);
      const violations = findNocBorrowViolations(jayerRows);
      violations.forEach((id) => {
        newErrors[`jayer_noc_${id}_product_name`] = t('request.jayer_noc_field_error' as never);
        newErrors[`jayer_noc_${id}_step`] = t('request.jayer_noc_field_error' as never);
      });
      const itemIdViolations = findNocBorrowItemIdViolations(jayerRows);
      itemIdViolations.forEach((id) => {
        newErrors[`jayer_noc_${id}_item_id`] = t('request.jayer_noc_field_error' as never);
      });
      const nocRowCount = new Set([...violations, ...itemIdViolations]).size;
      if (nocRowCount > 0) {
        newErrors['jayer_noc_required'] = t('request.jayer_noc_required' as never, { count: nocRowCount });
        errorMessages.push(t('request.jayer_noc_required' as never, { count: nocRowCount }) as string);
      }
      // J-layer 에 st='O 계열' 활성 행이 있으면 Backbone 조합 영역(STEP1)이 필수가 된다.
      // 여기서 처음 판정되므로, 막히면 goToStep 이 STEP1 로 되돌려 보낸다.
      if (requiresBbEntries(jayerRows)) addBbEntryError(newErrors, errorMessages, true);
      // Validation System — 판정 키워드가 있으면 대상/비대상을 상신자가 직접 골라야 O-layer 로 넘어간다.
      // 키워드가 없으면 판정 자체가 성립하지 않아('해당없음') 검사 대상이 아니다.
      if (autoValidationSystem(jayerRows) !== VS_NA && !detail.validation_system) {
        const msg = t('request.validation_system_required') as string;
        newErrors['validation_system'] = msg;
        errorMessages.push(msg);
      }
    }

    if (currentStep === 4 && !isMapOnlyScope) {
      if (!detail.partial_shot?.trim()) {
        newErrors['partial_shot'] = t('request.required');
        errorMessages.push('Partial Shot 계측 필요: 필수 선택 항목입니다.');
      }
      addStNocError(newErrors, errorMessages, 'oayer', oayerRows);
      const oViolations = findNocBorrowViolations(oayerRows);
      oViolations.forEach((id) => {
        newErrors[`oayer_noc_${id}_product_name`] = t('request.oayer_noc_field_error' as never);
        newErrors[`oayer_noc_${id}_step`] = t('request.oayer_noc_field_error' as never);
      });
      if (oViolations.length > 0) {
        newErrors['oayer_noc_required'] = t('request.oayer_noc_required' as never, { count: oViolations.length });
        errorMessages.push(t('request.oayer_noc_required' as never, { count: oViolations.length }) as string);
      }
    }

    if (currentStep === 5) {
      const unmappedJayerRows = jayerRows.filter(
        (row) => !row.disabled && !isNocSpecial(row.new_or_copy) && row.process_id && !mappedJayerRowIds.has(row.id)
      );
      if (unmappedJayerRows.length > 0) {
        newErrors['jayer_mapping'] = '모든 원본 데이터에 Backbone을 매핑해야 상신할 수 있습니다.';
        errorMessages.push('모든 원본 데이터에 Backbone을 매핑해야 상신할 수 있습니다.');
      }
      // 초안 복원 등으로 step 3/4 검증을 건너뛰었을 경우를 대비한 최종 안전망
      const jViolations = findNocBorrowViolations(jayerRows);
      jViolations.forEach((id) => {
        newErrors[`jayer_noc_${id}_product_name`] = t('request.jayer_noc_field_error' as never);
        newErrors[`jayer_noc_${id}_step`] = t('request.jayer_noc_field_error' as never);
      });
      const jItemIdViolations = findNocBorrowItemIdViolations(jayerRows);
      jItemIdViolations.forEach((id) => {
        newErrors[`jayer_noc_${id}_item_id`] = t('request.jayer_noc_field_error' as never);
      });
      const jNocRowCount = new Set([...jViolations, ...jItemIdViolations]).size;
      if (jNocRowCount > 0) {
        newErrors['jayer_noc_required'] = t('request.jayer_noc_required' as never, { count: jNocRowCount });
        errorMessages.push(t('request.jayer_noc_required' as never, { count: jNocRowCount }) as string);
      }
      const oViolations = findNocBorrowViolations(oayerRows);
      oViolations.forEach((id) => {
        newErrors[`oayer_noc_${id}_product_name`] = t('request.oayer_noc_field_error' as never);
        newErrors[`oayer_noc_${id}_step`] = t('request.oayer_noc_field_error' as never);
      });
      if (oViolations.length > 0) {
        newErrors['oayer_noc_required'] = t('request.oayer_noc_required' as never, { count: oViolations.length });
        errorMessages.push(t('request.oayer_noc_required' as never, { count: oViolations.length }) as string);
      }
      // 초안 복원 등으로 STEP 1 검증을 건너뛴 경우를 대비한 최종 안전망
      addStNocError(newErrors, errorMessages, 'jayer', jayerRows);
      addStNocError(newErrors, errorMessages, 'oayer', oayerRows);
      addBbEntryError(newErrors, errorMessages, requiresBbEntries(jayerRows));
      addBaGateError(newErrors, errorMessages);
      addAdiCdGateError(newErrors, errorMessages);
      // Validation System 미선택도 여기서 한 번 더 막는다 — 상신 검증은 validate(lastStep) 하나만
      // 도는 탓에, STEP3 게이트를 거치지 않고 온 문서가 미선택 상태로 상신되면 안 된다.
      if (autoValidationSystem(jayerRows) !== VS_NA && !detail.validation_system) {
        const msg = t('request.validation_system_required') as string;
        newErrors['validation_system'] = msg;
        errorMessages.push(msg);
      }
    }

    setErrors(newErrors);
    // Backbone 조합 영역은 STEP1 에만 입력칸이 있다. 다른 단계에서 이 오류 하나로만 막혔다면
    // 사용자가 고칠 수 있는 곳이 STEP1 뿐이므로 그리로 돌려보낸다(다른 오류가 섞여 있으면
    // 그 오류는 현재 단계에서 고쳐야 하므로 이동하지 않는다).
    const bbOnly = newErrors['bb_entries'] !== undefined && Object.keys(newErrors).length === 1;
    return {
      valid: Object.keys(newErrors).length === 0,
      errors: errorMessages,
      redirectStep: bbOnly && currentStep !== 1 ? 1 : undefined,
    };
  };

  // ===== API =====
  // 제목 끝의 `_요청서_YYMMDD`. 기본은 오늘이지만, 이력 바로 등록은 직접 지정한 상신일을 넣는다.
  const titleDateStr = (isoDate?: string): string => {
    const d = isoDate ? new Date(`${isoDate}T12:00:00`) : new Date();
    return `${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  };

  const buildEnrichedForm = (
    note?: string, shouldAddHistory = false, isDraft = false, submittedDate?: string,
  ): CreateDocumentInput => {
    const dateStr = titleDateStr(submittedDate);
    const purposePart = detail.other_purpose.length
      ? `${detail.request_purpose}-${detail.other_purpose.map((o) => `[${o}]`).join('')}`
      : detail.request_purpose;
    // ADI CD 변경은 MAP 정보 자체가 없으므로(map_type 미사용) 제목에서 그 구간을 뺀다.
    // '동일 변경 적용 대상' 추가 행이 있으면 제품 이름/조리법 뒤에 (+N) 배지만 붙인다(전체 나열은 안 함).
    const adiCdTargetsBadge = detail.adi_cd_extra_targets.length > 0 ? `(+${detail.adi_cd_extra_targets.length})` : '';
    const title = isAdiCdChange
      ? `${detail.line}(${purposePart})_${detail.process_selection}_${detail.partid_selection}_${detail.process_id}${adiCdTargetsBadge}_요청서_${dateStr}`
      : `${detail.line}(${purposePart})_MAP(${detail.map_type})_${detail.process_selection}_${detail.partid_selection}_${detail.process_id}_요청서_${dateStr}`;

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

    // 편집/지정PL 모드면 원본 의뢰자 유지, 신규 작성이면 현재 사용자
    const requester = (isEditMode || isPeerReviewMode) && originalRequesterRef.current
      ? originalRequesterRef.current
      : { name: currentUser.name, email: currentUser.email, department: currentUser.department };

    return {
      ...form,
      title,
      product_name: detail.partid_selection,
      requester_name: requester.name,
      requester_email: requester.email,
      requester_department: requester.department,
      production_date: productionDate || null,
      reference_materials: note ?? '',
      additional_notes: JSON.stringify({
        // C가문(only_prodc=YES) 추가 후결자를 detail 에 함께 저장(고정 후결자는 서버에서 추가)
        detail: {
          ...detail,
          post_approvers: requiresPostApprover ? postApprovers : [],
          // 합의자는 필수 조건과 무관하게 지정한 그대로 저장한다(선택 지정도 실제 결재 단계가 된다).
          sales_agreers: salesAgreers,
          sales_agreer_none_reason: salesAgreers.length === 0 ? salesAgreerNoneReason.trim() : '',
          // 상신·재상신 시점의 상신자 판단을 고정 기록한다(임시저장에는 남기지 않는다).
          // 이후 MASK(E)가 detail.validation_system 을 바꿔도 이 값은 유지된다.
          ...(isDraft ? {} : { validation_system_submitted: detail.validation_system }),
        },
        // Only MAP·MAP 삭제·ADI CD 변경은 StepMap 정보까지만(또는 그보다 적게) 필요 → J/O/bb 표를 비워 저장한다.
        // 비활성(필터/수동) 행도 임시저장과 동일하게 항상 포함해서 저장한다 — 반려·중단 후
        // 재상신 편집 화면에서 상신 전 상태(비활성 행 포함) 그대로 복원할 수 있어야 한다.
        jayerRows: isStep1OnlyScope ? [] : [...jayerRows].sort((a, b) => jayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
        oayerRows: isStep1OnlyScope ? [] : [...oayerRows].sort((a, b) => oayerSortBySp ? a.sp.localeCompare(b.sp) : a.sortOrder - b.sortOrder),
        bbRows: isStep1OnlyScope ? [] : bbRows,
        history,
        jayerActiveFilterIds: [...jayerActiveFilterIds],
        oayerActiveFilterIds: [...oayerActiveFilterIds],
        // 참조 요청서 '재선택'으로 J/O 를 Merge 이전으로 되돌리기 위한 스냅샷.
        // detail 형제 키라 상세 페이지의 변경 이력 diff(detail 기준)에는 잡히지 않는다.
        mergeSnapshot,
      }),
    };
  };

  const handleSaveDraft = async () => {
    if (loadError) { addToast(t('request.edit_load_failed'), 'error'); return; } // 로드 실패 시 덮어쓰기 차단(R-10)
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    setSaving(true);
    try {
      const enriched = buildEnrichedForm(undefined, false, true);
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
      isPersistingRef.current = false;
    }
  };

  const handleIdleAutoSave = async () => {
    if (!detail.line || !detail.partid_selection || !detail.process_selection || !detail.process_id) return;
    // 수동 저장/상신이 진행 중이면 중복 create 방지를 위해 자동저장을 건너뛴다
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    try {
      const enriched = buildEnrichedForm(undefined, false, true);
      if (savedId) {
        await documentsAPI.update(savedId, enriched);
      } else {
        const res = await documentsAPI.create(enriched);
        setSavedId(res.data.id);
      }
      addToast(t('request.auto_save_success'), 'info');
    } catch {
      // 자동저장 실패는 조용히 무시
    } finally {
      isPersistingRef.current = false;
    }
  };

  useIdleTimer(handleIdleAutoSave, 20 * 60 * 1000);

  // 검증 실패 시 첫 번째 오류 필드로 스크롤·강조한다.
  // O-layer(step 4)의 partial_shot 오류는 'info' 탭에 있으므로 먼저 탭을 전환한다.
  // atStep: 오류가 발생한 단계. 탭 클릭으로 여러 단계를 건너뛸 때는 setStep 직후 호출되는데
  // 그 시점의 `step` state 는 아직 갱신 전이라 신뢰할 수 없어, 대상 단계를 인자로 받는다.
  // (기본값이 `step` 이므로 인자 없이 부르는 기존 호출부는 동작이 완전히 동일하다.)
  const scrollToFirstError = (atStep: number = step) => {
    // O-ayer 표(oayer_noc_*)는 'table' 탭, Partial Shot 은 'info' 탭 — 에러가 있는 탭으로만 전환한다.
    // (validate()가 방금 setErrors 했더라도 이 시점의 `errors` state는 아직 갱신 전이라 신뢰할 수 없어,
    //  동일한 소스 값으로 직접 재계산한다.)
    if (atStep === 4) {
      const oViolations = findNocBorrowViolations(oayerRows);
      // validate(4) 의 우회 조건과 반드시 같은 판정이어야 한다 — 어긋나면 없는 오류로 탭이 전환된다.
      const partialShotMissing = !isMapOnlyScope && !detail.partial_shot?.trim();
      if (partialShotMissing && oViolations.length === 0) setOayerInfoTab('info');
    }
    // 탭 전환·에러 span 렌더가 끝난 뒤 DOM을 조회하도록 지연한다.
    setTimeout(() => {
      // J/O-ayer 차용 행 에러(.field-error-target)는 표 안의 정확한 셀로 조용히 스크롤만 한다(깜빡임 없음).
      const errorEl = document.querySelector('.form-error, .field-error-target');
      if (!errorEl) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const isTableCellTarget = errorEl.classList.contains('field-error-target');
      const container = (errorEl.closest('.form-group') ?? errorEl.parentElement ?? errorEl) as HTMLElement;
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!isTableCellTarget) {
        container.classList.add('field-error-flash');
        setTimeout(() => container.classList.remove('field-error-flash'), 1600);
      }
      const focusable = container.querySelector('input, select, textarea, button') as HTMLElement | null;
      focusable?.focus({ preventScroll: true });
    }, 60);
  };

  // 단계 이동의 단일 진입점 — '다음'/'이전' 버튼과 단계 인디케이터 탭 클릭이 모두 이 함수를 쓴다.
  //  · 뒤로(target < step): 검증 없이 즉시 이동. 이미 통과해서 지나온 단계이고, 되돌아가 값을 고치면
  //    다시 앞으로 나갈 때 아래 전진 규칙이 그 단계를 처음부터 재검증하므로 안전하다.
  //  · 앞으로(target > step): 현재 단계부터 target 직전까지를 순서대로 검증하고, 처음 막힌 단계에
  //    멈춰 오류를 보여준다. **통과 여부를 캐시하지 않는다** — 되돌아가 필수값을 지웠다면 그 즉시
  //    다시 막혀야 하기 때문이다(한 번 통과했다는 기록을 남기면 이 요구사항이 깨진다).
  const goToStep = (target: number) => {
    if (target === step || target < 1 || target > lastStep) return;

    if (target < step) {
      setStep(target);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    for (let s = step; s < target; s++) {
      const result = validate(s);
      if (!result.valid) {
        result.errors.forEach(msg => addToast(msg, 'error'));
        // Backbone 조합 영역만 막았다면 입력칸이 있는 STEP1 로 되돌려 보낸다(확인 모달 없이 즉시).
        const errorStep = result.redirectStep ?? s;
        if (errorStep !== step) setStep(errorStep);
        scrollToFirstError(errorStep);
        return;
      }
      // 검증은 통과했으나 사용자 확인이 필요한 관문. 확인 후 원래 목적지까지 이어서 가야 하므로
      // 목적지를 보관하고, 관문이 있는 단계로 먼저 이동해 둔다(취소하면 그 단계에 머문다).
      if (s === 1 && !ackedStepGatesRef.current.specialCare && !detail.customer_requirement.trim()) {
        setPendingStepTarget(target);
        setSpecialCareConfirm(true);
        return;
      }
      if (s === 4 && !ackedStepGatesRef.current.tbvtlv) {
        const hasTbvtlvActive = oayerRows.some(
          r => !r.disabled && (r.sd.toUpperCase().includes('TBV') || r.sd.toUpperCase().includes('TLV'))
        );
        if (hasTbvtlvActive) {
          const thicknessEmpty = !detail.tbvtlv_thickness.trim();
          const entriesEmpty = (detail.tbvtlv_entries ?? []).length === 0;
          if (thicknessEmpty || entriesEmpty) {
            if (s !== step) setStep(s);
            setPendingStepTarget(target);
            setTbvtlvWarnModal(true);
            return;
          }
        }
      }
      // Jayer/Oayer '요청 기준'(new_or_copy)으로 계산한 요청 목적이 현재 값과 다르면 확인을 받는다.
      // 판정 불가(활성 행 없음)면 검사를 건너뛴다.
      if (s === 4 && !ackedStepGatesRef.current.purposeMismatch) {
        const expectedPurpose = computeExpectedRequestPurpose(jayerRows, oayerRows);
        if (expectedPurpose && expectedPurpose !== detail.request_purpose) {
          if (s !== step) setStep(s);
          setPendingStepTarget(target);
          setPurposeMismatchConfirm(expectedPurpose);
          return;
        }
      }
    }

    setPendingStepTarget(null);
    ackedStepGatesRef.current = { specialCare: false, tbvtlv: false, purposeMismatch: false };
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 사용자가 새로 시작하는 이동('다음'/'이전' 버튼·탭 클릭)의 진입점.
  // 관문 확인 기록을 여기서만 비운다 — ConfirmModal 이 onConfirm 직후 항상 onClose 를 부르므로
  // onClose 에서 비우면 방금 이어서 뜬 다음 관문의 기록까지 지워진다.
  const startStepMove = (target: number) => {
    ackedStepGatesRef.current = { specialCare: false, tbvtlv: false, purposeMismatch: false };
    goToStep(target);
  };

  // 관문 모달의 '계속 진행' — 그 관문을 확인 처리하고 원래 목적지까지 이어서 이동한다.
  const resumePendingStep = (gate: 'specialCare' | 'tbvtlv' | 'purposeMismatch') => {
    ackedStepGatesRef.current = { ...ackedStepGatesRef.current, [gate]: true };
    goToStep(pendingStepTarget ?? step + 1);
  };

  // 요청 목적 확인 모달 — '적용'(onConfirm): 계산된 값으로 바꾸고 이어서 진행.
  // '취소/닫기'(onClose): 값은 그대로 두고 이어서 진행. ConfirmModal 은 onConfirm 클릭 시
  // onConfirm 직후 onClose 도 항상 부르는데, goToStep 이 성공적으로 끝나면 ackedStepGatesRef 를
  // 전부 리셋해 버려 그 시점엔 이미 purposeMismatch 플래그가 false 로 돌아가 있다 — 그 플래그로
  // '적용 직후의 onClose'를 걸러낼 수 없으므로, 이 상호작용 전용의 별도 ref 로 구분한다.
  const purposeMismatchAppliedRef = useRef(false);

  const handlePurposeMismatchApply = () => {
    purposeMismatchAppliedRef.current = true;
    if (purposeMismatchConfirm) handleDetailSet('request_purpose', purposeMismatchConfirm);
    resumePendingStep('purposeMismatch');
  };

  const handlePurposeMismatchClose = () => {
    if (purposeMismatchAppliedRef.current) {
      purposeMismatchAppliedRef.current = false; // '적용' 직후 ConfirmModal 이 이어서 부른 onClose — 무시
    } else {
      resumePendingStep('purposeMismatch'); // 사용자가 직접 취소/닫기 — 값은 그대로 두고 진행
    }
    setPurposeMismatchConfirm(null);
  };

  const handleNextStep = () => startStepMove(step + 1);

  const handlePrevStep = () => startStepMove(step - 1);

  const handleReset = () => {
    setDetail(prev => ({
      ...prev,
      map_type: INITIAL_DETAIL.map_type,
      source_line: INITIAL_DETAIL.source_line,
      source_partid: INITIAL_DETAIL.source_partid,
      map_change: INITIAL_DETAIL.map_change,
      map_value_x: INITIAL_DETAIL.map_value_x,
      map_value_y: INITIAL_DETAIL.map_value_y,
      map_reason: INITIAL_DETAIL.map_reason,
      map_change_top: INITIAL_DETAIL.map_change_top,
      map_value_x_top: INITIAL_DETAIL.map_value_x_top,
      map_value_y_top: INITIAL_DETAIL.map_value_y_top,
      map_change_bottom: INITIAL_DETAIL.map_change_bottom,
      map_value_x_bottom: INITIAL_DETAIL.map_value_x_bottom,
      map_value_y_bottom: INITIAL_DETAIL.map_value_y_bottom,
      ea_change: INITIAL_DETAIL.ea_change,
      ea_value: INITIAL_DETAIL.ea_value,
      only_prodc: INITIAL_DETAIL.only_prodc,
      prodc_scope: INITIAL_DETAIL.prodc_scope,
      prodc_top_line: INITIAL_DETAIL.prodc_top_line,
      prodc_top_process: INITIAL_DETAIL.prodc_top_process,
      prodc_top_product: INITIAL_DETAIL.prodc_top_product,
      prodc_middle_use: INITIAL_DETAIL.prodc_middle_use,
      prodc_middle_line: INITIAL_DETAIL.prodc_middle_line,
      prodc_middle_process: INITIAL_DETAIL.prodc_middle_process,
      prodc_middle_product: INITIAL_DETAIL.prodc_middle_product,
      prodc_bottom_line: INITIAL_DETAIL.prodc_bottom_line,
      prodc_bottom_process: INITIAL_DETAIL.prodc_bottom_process,
      prodc_bottom_product: INITIAL_DETAIL.prodc_bottom_product,
      mshot_change: INITIAL_DETAIL.mshot_change,
      mshot_image_copy: INITIAL_DETAIL.mshot_image_copy,
      mshot_image_copy_top: INITIAL_DETAIL.mshot_image_copy_top,
      mshot_image_copy_bottom: INITIAL_DETAIL.mshot_image_copy_bottom,
      photo_backside: INITIAL_DETAIL.photo_backside,
      eds_backside: INITIAL_DETAIL.eds_backside,
      inter: INITIAL_DETAIL.inter,
      inter_xs: INITIAL_DETAIL.inter_xs,
      inter_ys: INITIAL_DETAIL.inter_ys,
      in_apply: INITIAL_DETAIL.in_apply,
      inter_select: INITIAL_DETAIL.inter_select,
      tsv: INITIAL_DETAIL.tsv,
      rf: INITIAL_DETAIL.rf,
      fullchip: INITIAL_DETAIL.fullchip,
      split: INITIAL_DETAIL.split,
      st: INITIAL_DETAIL.st,
      ecc: INITIAL_DETAIL.ecc,
      labelsideshot: INITIAL_DETAIL.labelsideshot,
      hpkglabelheight: INITIAL_DETAIL.hpkglabelheight,
      final_yn: INITIAL_DETAIL.final_yn,
      final_entries: INITIAL_DETAIL.final_entries,
      partial_shot: INITIAL_DETAIL.partial_shot,
      tbvtlv_thickness: INITIAL_DETAIL.tbvtlv_thickness,
      tbvtlv_entries: INITIAL_DETAIL.tbvtlv_entries,
    }));
    setErrors({});
    setFinalGds('');
  };

  const handleSubmitClick = async () => {
    // 마지막 단계의 검증만 돌린다 — 앞 단계들은 전진할 때 이미 통과했다.
    // Only MAP·MAP 삭제 는 2단계가 마지막이므로 5단계(J-ayer↔Backbone 매핑) 검증을 돌리면 안 된다.
    const result = validate(lastStep);
    if (!result.valid) {
      result.errors.forEach(msg => addToast(msg, 'error'));
      // 상신에서도 Backbone 조합 영역만 막았다면 고칠 수 있는 STEP1 로 이동시킨다.
      if (result.redirectStep) setStep(result.redirectStep);
      scrollToFirstError(result.redirectStep ?? 5);
      return;
    }
    // peer review 모드가 아닐 때만 PL 목록 로드
    if (!isPeerReviewMode && plUserOptions.length === 0) {
      try {
        const res = await usersAPI.list('PL');
        setPlUserOptions(res.data.filter(u => u.loginid !== currentUser.username));
      } catch {
        setPlUserOptions([]);
      }
    }
    // 통보자 후보(제품담당자 PL) 로드 — 검토자·후결자와 동일하게 PL 만 검색 대상
    if (!isPeerReviewMode && notifierUserOptions.length === 0) {
      try {
        const res = await usersAPI.list('PL');
        setNotifierUserOptions(res.data.filter(u => u.loginid !== currentUser.username));
      } catch {
        setNotifierUserOptions([]);
      }
    }
    // 내 주소록 로드(통보처 불러오기/저장용)
    if (!isPeerReviewMode) {
      try {
        setAddressBooks(await addressBooksAPI.list());
      } catch {
        setAddressBooks([]);
      }
      // 내가 속한 나만의 그룹 로드(통보처 일괄 추가용)
      try {
        setUserGroups(await userGroupsAPI.list());
      } catch {
        setUserGroups([]);
      }
    }
    setDesignees([]);
    setDesigneeSearchQuery('');
    setDesigneeError('');
    setNotifierSearchQuery('');
    setNotifierDropdownOpen(false);
    setNotifierDropdownRect(null);
    setAbLoadOpen(false);
    setAbSaveOpen(false);
    setConfirmOpen(true);
  };

  // 이력 바로 등록 — 상신과 동일한 문서 내용 검증을 통과해야 날짜 모달이 열린다.
  // (결재선 관련 입력인 지정 PL·후결자·통보자는 결재를 돌리지 않으므로 요구하지 않는다.)
  const handleDirectHistoryClick = () => {
    const result = validate(5);
    if (!result.valid) {
      result.errors.forEach(msg => addToast(msg, 'error'));
      scrollToFirstError();
      return;
    }
    setDirectSubmittedAt(todayISO());
    setDirectApprovedAt(todayISO());
    setDirectHistoryError('');
    setDirectHistoryOpen(true);
  };

  const handleDirectHistoryRegister = async () => {
    if (loadError) { addToast(t('request.edit_load_failed'), 'error'); return; } // 로드 실패 시 덮어쓰기 차단(R-10)
    if (!directSubmittedAt || !directApprovedAt) {
      setDirectHistoryError(t('request.direct_history_date_required'));
      return;
    }
    if (directApprovedAt < directSubmittedAt) {
      setDirectHistoryError(t('request.direct_history_date_order'));
      return;
    }
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    setSubmitting(true);
    try {
      // 제목의 `_요청서_YYMMDD` 도 입력한 상신일을 따른다.
      const enriched = buildEnrichedForm('', false, false, directSubmittedAt);
      let docId = savedId;
      if (!docId) {
        const res = await documentsAPI.create(enriched);
        docId = res.data.id;
        setSavedId(docId);
      } else {
        await documentsAPI.update(docId, enriched);
      }
      await documentsAPI.directApprove(docId!, directSubmittedAt, directApprovedAt);
      setDirectHistoryOpen(false);
      addToast(t('request.direct_history_success'), 'success');
      setTimeout(() => navigate('/history'), 1500);
    } catch (err) {
      addToast(`오류 발생: ${err instanceof Error ? err.message : '알 수 없는 오류'}`, 'error');
    } finally {
      setSubmitting(false);
      isPersistingRef.current = false;
    }
  };

  const handleSubmit = async () => {
    if (loadError) { addToast(t('request.edit_load_failed'), 'error'); return; } // 로드 실패 시 덮어쓰기 차단(R-10)
    // peer review·재개(resume) 모드 외 일반 상신: 지정자(1명 이상) 필수
    // (재개는 멈춘 단계부터 이어지므로 지정 PL 선택이 필요 없다)
    if (!isPeerReviewMode && !isResumeMode && designees.length === 0) {
      setDesigneeError(t('request.designee_required'));
      return;
    }
    // C가문(only_prodc=YES): 추가 후결자 1명 이상 필수
    if (!isPeerReviewMode && !isResumeMode && requiresPostApprover && postApprovers.length === 0) {
      addToast(t('request.post_approver_required'), 'error');
      return;
    }
    // 예외 구역 값을 기본값과 다르게 바꾼 의뢰서: 합의자 1명 이상 또는 미지정 사유 필수
    if (!isPeerReviewMode && !isResumeMode && requiresSalesAgreer
        && salesAgreers.length === 0 && !salesAgreerNoneReason.trim()) {
      addToast(t('request.sales_agreer_required'), 'error');
      return;
    }
    if (isPersistingRef.current) return;
    isPersistingRef.current = true;
    setSubmitting(true);
    try {
      let docId = savedId;

      if (isPeerReviewMode) {
        // 지정 PL 수정 후 상신: history 포함본으로 1회만 저장(중복 update 제거 — R-09)
        const enriched = buildEnrichedForm(submitNote, true);
        if (!docId) {
          const res = await documentsAPI.create(enriched);
          docId = res.data.id;
          setSavedId(docId);
        } else {
          await documentsAPI.update(docId, enriched);
        }
        await documentsAPI.peerSubmit(docId!, submitNote || undefined);
        addToast('수정 후 상신되었습니다.', 'success');
      } else {
        // 기존 문서 상태 조회(신규는 draft). update는 경로당 1회.
        const currentStatus = docId ? (await documentsAPI.get(docId)).data.status : 'draft';
        const isRejected = currentStatus === 'rejected';
        const isPause = currentStatus === 'pause';
        const enriched = buildEnrichedForm(submitNote, isRejected || isPause); // 재상신·재개 수정 시 history 누적
        if (!docId) {
          const res = await documentsAPI.create(enriched);
          docId = res.data.id;
          setSavedId(docId);
        } else {
          await documentsAPI.update(docId, enriched);
        }
        if (isPause) {
          // 중단(PAUSE) 문서 재개: 멈춘 단계부터 이어진다(지정 PL 불필요).
          await documentsAPI.resume(docId!);
          addToast(t('request.resume_success'), 'success');
        } else if (isRejected) {
          // R-09: 위에서 enriched(history 포함)로 이미 1회 update했으므로 중복 update 없이 재상신
          await documentsAPI.resubmit(docId!, designees.map(d => d.loginid));
          addToast('재상신되었습니다.', 'success');
        } else {
          const submitRes = await documentsAPI.submit(docId!, designees.map(d => d.loginid));
          addToast(t('request.submit_success'), 'success');
          if (submitRes.data.email_sent) {
            setTimeout(() => addToast(t('request.messenger_sent_to_manager'), 'info'), 800);
          }
        }
      }
      setTimeout(() => navigate('/approval'), 1500);
    } catch (err) {
      addToast(`오류 발생: ${err instanceof Error ? err.message : '알 수 없는 오류'}`, 'error');
    } finally {
      setSubmitting(false);
      isPersistingRef.current = false;
    }
  };

  // ===== 스텝 하이라이트 가이드 투어 =====
  const stepTour = useStepGuideTour({
    detail,
    setDetail,
    jayerRows,
    setJayerRows,
    jayerChecked,
    setJayerChecked,
    jayerCellSel,
    oayerRows,
    oayerChecked,
    setOayerChecked,
    oayerInfoTab,
    setOayerInfoTab,
    showAutoFillPanel,
    setShowAutoFillPanel,
    bbRows,
    setBbRows,
  });

  // 스텝 제목 옆에 붙는 단일 "영상 가이드" 배지 — 누르면 그 스텝 전체를 훑는 하이라이트 투어가 열린다.
  const StepTourBadge = ({ step }: { step: number }) => {
    const open = (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      stepTour.openStep(step);
    };
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}
        className={`guide-video-badge${stepTour.activeStep === step ? ' active' : ''}`}
      >
        {t('guide.video_btn')}
      </span>
    );
  };

  // ===== Guide helpers (필드별 글 가이드 배지) =====
  const toggleSlidePanel = (featureKey: GuideFeatureKey, title: string) => {
    setSlidePanel((prev) =>
      prev.open && prev.featureKey === featureKey
        ? { ...prev, open: false }
        : { open: true, featureKey, title }
    );
  };

  // 가이드 배지는 <label> 안에 위치하는 경우가 많다. <button> 으로 두면 label 의
  // "연결된 컨트롤"이 되어 label(행) 아무 곳이나 클릭해도 가이드가 열린다.
  // labelable 이 아닌 <span role="button"> 으로 렌더해 배지를 직접 클릭할 때만 열리게 한다.
  // 빌트인 데모가 있는 기능은 '영상 가이드' 배지로 구분한다.
  const GuideBadge = ({ fk, tk }: { fk: GuideFeatureKey; tk: string }) => {
    if (!featureGuideKeys.has(fk)) return null;
    const active = slidePanel.open && slidePanel.featureKey === fk;
    const open = (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSlidePanel(fk, tk);
    };
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}
        className={`guide-badge${active ? ' active' : ''}`}
      >
        {t('guide.guide_btn')}
      </span>
    );
  };

  // ===== Main Render =====
  return (
    <div className="container page">
      <div className="page-header">
        <h1>{isPeerReviewMode ? '의뢰서 수정·재상신' : isEditMode ? '의뢰서 수정·재상신' : t('request.title')}</h1>
        <p>{isPeerReviewMode || isEditMode ? '내용을 수정한 후 재상신하면 반려 단계부터 다시 검토됩니다.' : t('request.subtitle')}</p>
      </div>
      {isPeerReviewMode && (
        <div style={{ background: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 16, color: 'var(--warning)', fontSize: '0.9rem', fontWeight: 500 }}>
          🟡 {t('request.peer_review_banner')}
        </div>
      )}

      <WizardIndicator
        currentStep={step}
        // 투어 모드는 URL 이 단계를 지정하는 읽기 전용 미리보기라 탭 이동을 막는다.
        onStepClick={isTourMode ? undefined : startStepMove}
        stepTitle={(label) => t('request.step_move' as never, { label }) as string}
        disabledSteps={disabledSteps}
        disabledStepTitle={(label) => t('request.step_locked_map_only' as never, { label }) as string}
        steps={[
          t('request.section_detail'),
          t('request.section_map'),
          t('request.job_li'),
          t('request.ovl_li'),
          t('request.bb_li'),
        ]}
      />

      {step === 1 && (
        <Step1
          detail={detail}
          errors={errors}
          isOnlyMap={isStep1OnlyScope}
          bbEntriesRequired={requiresBbEntries(jayerRows)}
          isLabProductAllowed={isOnlyMap}
          lineOptions={lineOptions}
          processOptions={processOptions}
          productOptions={productOptions}
          processIdOptions={processIdOptions}
          FlowProductOptions={FlowProductOptions}
          FlowProcessIdOptions={FlowProcessIdOptions}
          FlowLayerIdOptions={FlowLayerIdOptions}
          BbProductOptions={BbProductOptions}
          BbProductidOptions={BbProductidOptions}
          refDocLabel={refDocLabel}
          setRefDocLabel={setRefDocLabel}
          refDocId={refDocId}
          setRefDocId={setRefDocId}
          approvedDocs={approvedDocs}
          productionDate={productionDate}
          setProductionDate={setProductionDate}
          handleDetailChange={handleDetailChange}
          handleDetailSet={handleDetailSet}
          handlePartidSelectionBlur={handlePartidSelectionBlur}
          handleRequestPurposeSelect={handleRequestPurposeSelect}
          handleRefDocSelect={handleRefDocSelect}
          handleMergeClick={handleMergeClick}
          handleMergeReselect={() => setMergeReselectConfirm(true)}
          hasMergeSnapshot={mergeSnapshot !== null}
          jayerRows={jayerRows}
          oayerRows={oayerRows}
          baSameCount={baSameCount}
          baSelBefore={baSelBefore}
          baSelAfter={baSelAfter}
          handleBaSelect={handleBaSelect}
          handleBaApply={handleBaApply}
          handleBaUnpair={handleBaUnpair}
          handleMergeModeSelect={handleMergeModeSelect}
          handleBaCellChange={handleBaCellChange}
          handleBaCellBlur={handleBaCellBlur}
          handleBaPasteRaw={handleBaPasteRaw}
          handleBaTableChange={handleBaTableChange}
          handleBaAddRow={handleBaAddRow}
          handleBaResetRow={handleBaResetRow}
          handleFlowChange={handleFlowChange}
          handleFlowStepBlur={handleFlowStepBlur}
          handleFlowDeleteRow={handleFlowDeleteRow}
          handleFlowAddRow={handleFlowAddRow}
          handleBbEntryChange={handleBbEntryChange}
          handleBbEntryDelete={handleBbEntryDelete}
          handleBbEntryAdd={handleBbEntryAdd}
          isAdiCdSelected={isAdiCdSelected}
          handleAdiCdCellChange={handleAdiCdCellChange}
          handleAdiCdAddRow={handleAdiCdAddRow}
          handleAdiCdRemoveRow={handleAdiCdRemoveRow}
          handleAdiCdPasteRaw={handleAdiCdPasteRaw}
          handleAdiCdToggleUnregistered={handleAdiCdToggleUnregistered}
          adiCdTargetDraft={adiCdTargetDraft}
          adiCdTargetDraftProcessIdOptions={adiCdTargetDraftProcessIdOptions}
          handleAdiCdTargetDraftChange={handleAdiCdTargetDraftChange}
          handleAdiCdTargetAdd={handleAdiCdTargetAdd}
          handleAdiCdTargetDelete={handleAdiCdTargetDelete}
          GuideTourBadge={<StepTourBadge step={1} />}
          GuideBadge={GuideBadge}
        />
      )}
      {step === 2 && (
        <StepMap
          detail={detail}
          errors={errors}
          isMapDeleteEdit={isMapDeleteEdit}
          isMapReasonMode={isMapReasonMode}
          lineOptions={lineOptions}
          sourcePartIdOptions={sourcePartIdOptions}
          topProductOptions={topProductOptions}
          middleProductOptions={middleProductOptions}
          bottomProductOptions={bottomProductOptions}
          topProcessOptions={topProcessOptions}
          middleProcessOptions={middleProcessOptions}
          bottomProcessOptions={bottomProcessOptions}
          handleProdcLineChange={handleProdcLineChange}
          prodcScopeSet={prodcScopeSet}
          prodcLocked={prodcLocked}
          prodcRegionOff={prodcRegionOff}
          regionHasMapChange={regionHasMapChange}
          anyRegionMapChange={anyRegionMapChange}
          handleProdcScopeSelect={handleProdcScopeSelect}
          handleRegionMapChangeChange={handleRegionMapChangeChange}
          finalGds={finalGds}
          setFinalGds={setFinalGds}
          isProdc={isProdc}
          isMapRegistered={isMapRegistered}
          hasMapChange={hasMapChange}
          hasEaChange={hasEaChange}
          mshotDeleteMode={mshotDeleteMode}
          mshotEditAddMode={mshotEditAddMode}
          setDetail={setDetail}
          handleReset={handleReset}
          handleMapTypeSelect={handleMapTypeSelect}
          handleDetailChange={handleDetailChange}
          handleDetailSet={handleDetailSet}
          handleProdcProcessChange={handleProdcProcessChange}
          handleOnlyProdcChange={handleOnlyProdcChange}
          handleMapChangeChange={handleMapChangeChange}
          handleEaChangeChange={handleEaChangeChange}
          handleMshotChangeChange={handleMshotChangeChange}
          handleImagePaste={handleImagePaste}
          GuideTourBadge={<StepTourBadge step={2} />}
          GuideBadge={GuideBadge}
        />
      )}
      {step === 3 && (
        <Step2
          jayerRows={jayerRows}
          setJayerRows={setJayerRows}
          jayerSortBySp={jayerSortBySp}
          setJayerSortBySp={setJayerSortBySp}
          jayerFilterSets={jayerFilterSets}
          jayerActiveFilterIds={jayerActiveFilterIds}
          setJayerActiveFilterIds={setJayerActiveFilterIds}
          setJayerFilterModalOpen={setJayerFilterModalOpen}
          jayerDragInfo={jayerDragInfo}
          jayerChecked={jayerChecked}
          mappedJayerRowIds={mappedJayerRowIds}
          jayerBarcodeCache={jayerBarcodeCache}
          errors={errors}
          calcDisabled={calcDisabled}
          handleJayerSetAll={handleJayerSetAll}
          handleJayerResetField={handleJayerResetField}
          handleJayerCheckAll={handleJayerCheckAll}
          handleJayerDragEnter={handleJayerDragEnter}
          handleJayerDragStart={handleJayerDragStart}
          handleJayerCheckToggle={handleJayerCheckToggle}
          handleJayerChange={handleJayerChange}
          handleJayerAddRow={handleJayerAddRow}
          handleJayerBulkDisable={handleJayerBulkDisable}
          handleJayerBulkRestore={handleJayerBulkRestore}
          cellSel={jayerCellSel}
          GuideTourBadge={<StepTourBadge step={3} />}
          GuideBadge={GuideBadge}
          validationSystem={detail.validation_system}
          vsNotApplicable={autoValidationSystem(jayerRows) === VS_NA}
          onValidationSystemChange={(v) => {
            setVsManuallySet(true);
            setDetail((prev) => ({ ...prev, validation_system: v }));
          }}
        />
      )}
      {step === 4 && (
        <Step3
          oayerRows={oayerRows}
          setOayerRows={setOayerRows}
          oayerSortBySp={oayerSortBySp}
          setOayerSortBySp={setOayerSortBySp}
          oayerFilterSets={oayerFilterSets}
          oayerActiveFilterIds={oayerActiveFilterIds}
          setOayerActiveFilterIds={setOayerActiveFilterIds}
          setOayerFilterModalOpen={setOayerFilterModalOpen}
          oayerDragInfo={oayerDragInfo}
          oayerChecked={oayerChecked}
          oayerInfoTab={oayerInfoTab}
          setOayerInfoTab={setOayerInfoTab}
          oayerInfoLocked={isMapOnlyScope}
          detail={detail}
          setDetail={setDetail}
          errors={errors}
          setErrors={setErrors}
          tbvtlvSdsSelected={tbvtlvSdsSelected}
          setTbvtlvSdsSelected={setTbvtlvSdsSelected}
          tbvtlvNoteRows={tbvtlvNoteRows}
          setTbvtlvNoteRows={setTbvtlvNoteRows}
          calcDisabled={calcDisabled}
          handleOayerSetAll={handleOayerSetAll}
          handleOayerResetField={handleOayerResetField}
          handleOayerCheckAll={handleOayerCheckAll}
          handleOayerDragEnter={handleOayerDragEnter}
          handleOayerDragStart={handleOayerDragStart}
          handleOayerCheckToggle={handleOayerCheckToggle}
          handleOayerChange={handleOayerChange}
          handleOayerAddRow={handleOayerAddRow}
          handleOayerBulkDisable={handleOayerBulkDisable}
          handleOayerBulkRestore={handleOayerBulkRestore}
          cellSel={oayerCellSel}
          GuideTourBadge={<StepTourBadge step={4} />}
          GuideBadge={GuideBadge}
        />
      )}
      {step === 5 && (
        <Step4
          bbExternalData={bbExternalData}
          activeBbTab={activeBbTab}
          setActiveBbTab={setActiveBbTab}
          detail={detail}
          errors={errors}
          bbSearchQueries={bbSearchQueries}
          setBbSearchQueries={setBbSearchQueries}
          stagedMappings={stagedMappings}
          showAutoFillPanel={showAutoFillPanel}
          setShowAutoFillPanel={setShowAutoFillPanel}
          bbAutoFillRanges={bbAutoFillRanges}
          setBbAutoFillRanges={setBbAutoFillRanges}
          jayerRows={jayerRows}
          mappedJayerRowIds={mappedJayerRowIds}
          selectedJayerRowId={selectedJayerRowId}
          setSelectedJayerRowId={setSelectedJayerRowId}
          bbExternalLoading={bbExternalLoading}
          bbRows={bbRows}
          bbChecked={bbChecked}
          setDeleteConfirm={setDeleteConfirm}
          handleOpenAutoFillPanel={handleOpenAutoFillPanel}
          handleRangeChange={handleRangeChange}
          handleRemoveRange={handleRemoveRange}
          handleAddRange={handleAddRange}
          handleApplyAutoFill={handleApplyAutoFill}
          handleClearStaging={handleClearStaging}
          handleStageMapping={handleStageMapping}
          handleApplyMappings={handleApplyMappings}
          handleResetBbRows={handleResetBbRows}
          handleBbCheckAll={handleBbCheckAll}
          handleBbCheckToggle={handleBbCheckToggle}
          handleBbChange={handleBbChange}
          handleSortBbRows={handleSortBbRows}
          handleBbAddRow={handleBbAddRow}
          handleBbBulkDelete={handleBbBulkDelete}
          GuideTourBadge={<StepTourBadge step={5} />}
          GuideBadge={GuideBadge}
        />
      )}

      <div className="form-actions" style={step > 1 ? { justifyContent: 'space-between' } : {}}>
        {step > 1 && (
          <button className="btn btn-secondary" onClick={handlePrevStep}>
            ← 이전
          </button>
        )}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving || loadError}>
            💾 {saving ? t('common.loading') : t('request.save_draft')}
          </button>
          {/* Only MAP·MAP 삭제 는 MAP 정보(2단계)가 마지막이라 여기서 바로 상신한다. */}
          {step < lastStep ? (
            <button className="btn btn-primary" onClick={() => handleNextStep()}>
              다음 →
            </button>
          ) : (
            <>
              {canDirectHistory && (
                <button className="btn btn-secondary" onClick={handleDirectHistoryClick} disabled={submitting || loadError}>
                  📋 {t('request.direct_history')}
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSubmitClick} disabled={submitting || loadError}>
                📤 {submitting ? t('common.loading') : (isResumeMode ? t('approval.resume') : t('request.submit'))}
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm?.onConfirm()}
        title={t('common.confirm')}
        message={deleteConfirm?.message ?? ''}
        confirmLabel={t('common.restore')}
        danger
      />

      {/* 주소록 저장/불러오기/삭제 확인 (상신 모달 위에 표시) */}
      <ConfirmModal
        isOpen={!!abConfirm}
        onClose={() => setAbConfirm(null)}
        onConfirm={() => abConfirm?.onConfirm()}
        title={t('common.confirm')}
        message={abConfirm?.message ?? ''}
        topLevel
      />

      {/* J-ayer 필터 관리 모달 */}
      <FilterManageModal
        isOpen={jayerFilterModalOpen}
        onClose={() => { setJayerFilterModalOpen(false); setJayerNewFilter({ label: '', words: emptyDraftWords() }); }}
        title={t('request.jayer_filter_manage')}
        storageKey="jayerFilterSets"
        filterSets={jayerFilterSets}
        setFilterSets={setJayerFilterSets}
        newFilter={jayerNewFilter}
        setNewFilter={setJayerNewFilter}
        onAllDelete={() => setFilterAllDeleteConfirm('jayer')}
        onRequestDelete={(fs) => setFilterDeleteConfirm({ type: 'jayer', filterId: fs.id, label: fs.label })}
        onEdit={(filterId, label, words) => {
          const updated = jayerFilterSets.map(f => f.id === filterId ? { ...f, label, words } : f);
          setJayerFilterSets(updated);
          localStorage.setItem('jayerFilterSets', JSON.stringify(updated));
          setJayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, updated, jayerActiveFilterIds) })));
        }}
      />

      {/* O-ayer 필터 관리 모달 */}
      <FilterManageModal
        isOpen={oayerFilterModalOpen}
        onClose={() => { setOayerFilterModalOpen(false); setOayerNewFilter({ label: '', words: emptyDraftWords() }); }}
        title={t('request.oayer_filter_manage')}
        storageKey="oayerFilterSets"
        filterSets={oayerFilterSets}
        setFilterSets={setOayerFilterSets}
        newFilter={oayerNewFilter}
        setNewFilter={setOayerNewFilter}
        onAllDelete={() => setFilterAllDeleteConfirm('oayer')}
        onRequestDelete={(fs) => setFilterDeleteConfirm({ type: 'oayer', filterId: fs.id, label: fs.label })}
        onEdit={(filterId, label, words) => {
          const updated = oayerFilterSets.map(f => f.id === filterId ? { ...f, label, words } : f);
          setOayerFilterSets(updated);
          localStorage.setItem('oayerFilterSets', JSON.stringify(updated));
          setOayerRows(rows => rows.map(r => ({ ...r, disabled: calcDisabled(r, updated, oayerActiveFilterIds) })));
        }}
      />

      <Modal
        isOpen={mergeConfirmOpen}
        onClose={() => setMergeConfirmOpen(false)}
        title={t('request.merge_confirm_title')}
        size="md"
        style={{ maxWidth: '420px' }}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setMergeConfirmOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleMergeConfirm}>
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <div style={{ color: 'var(--text-secondary)', lineHeight: 2 }}>
          {([
            [t('request.jayer'), mergePreview?.jayer],
            [t('request.oayer'), mergePreview?.oayer],
          ] as const).map(([label, s]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '4px' }}>
              <span>{label}</span>
              <span>
                <Trans
                  i18nKey="request.merge_confirm_counts"
                  values={{ added: s?.added ?? 0, registered: s?.registered ?? 0, deleted: s?.deleted ?? 0 }}
                  components={[<span />, <b />, <span />, <b />, <span />, <b />]}
                />
              </span>
            </div>
          ))}
          <p style={{ margin: '12px 0 0', color: 'var(--danger)' }}>{t('request.merge_confirm_once_warning')}</p>
          <p style={{ margin: 0 }}>{t('request.merge_confirm_proceed')}</p>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={tbvtlvWarnModal}
        onClose={() => setTbvtlvWarnModal(false)}
        onConfirm={() => resumePendingStep('tbvtlv')}
        title={t('request.tbvtlv_warn_title')}
        message={t('request.tbvtlv_warn_body')}
        confirmLabel={t('request.tbvtlv_warn_proceed')}
      />

      <ConfirmModal
        isOpen={!!purposeMismatchConfirm}
        onClose={handlePurposeMismatchClose}
        onConfirm={handlePurposeMismatchApply}
        title={t('request.purpose_mismatch_title')}
        message={purposeMismatchConfirm ? t('request.purpose_mismatch_body', { purpose: purposeMismatchConfirm }) : ''}
        confirmLabel={t('request.purpose_mismatch_apply')}
      />

      <Modal
        isOpen={directHistoryOpen}
        onClose={() => setDirectHistoryOpen(false)}
        title={t('request.direct_history')}
        size="sm"
        style={{ maxWidth: '420px' }}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDirectHistoryOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleDirectHistoryRegister} disabled={submitting}>
              📋 {submitting ? t('common.loading') : t('request.direct_history_register')}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">{t('request.direct_history_submitted_at')}</label>
          <input
            type="date"
            className="form-control"
            value={directSubmittedAt}
            onChange={(e) => { setDirectSubmittedAt(e.target.value); setDirectHistoryError(''); }}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('request.direct_history_approved_at')}</label>
          <input
            type="date"
            className="form-control"
            value={directApprovedAt}
            onChange={(e) => { setDirectApprovedAt(e.target.value); setDirectHistoryError(''); }}
          />
        </div>
        {directHistoryError && (
          <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}>{directHistoryError}</p>
        )}
      </Modal>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={isPeerReviewMode ? t('approval.peer_submit') : isResumeMode ? t('approval.resume') : t('request.submit')}
        size="md"
        // 상신 모달은 지정자·후결자·합의자·통보자를 한 번에 다루므로 가로/세로를 넓게 잡는다(2026-08).
        style={{ maxWidth: SUBMIT_MODAL_MAX_WIDTH }}
        bodyStyle={{ minHeight: SUBMIT_MODAL_MIN_BODY_HEIGHT }}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || (!isPeerReviewMode && !isResumeMode && designees.length === 0)}
            >
              📤 {submitting ? t('common.loading') : (isPeerReviewMode ? t('approval.peer_submit') : isResumeMode ? t('approval.resume') : t('request.submit'))}
            </button>
          </>
        }
      >
        <div data-tour="submit-fields">
        <div className="form-group" data-tour="submit-note">
          <label className="form-label">{t('request.submit_note_label')}</label>
          <textarea
            className="form-control"
            rows={SUBMIT_NOTE_ROWS}
            style={{ resize: 'vertical' }}
            placeholder={t('request.submit_note_placeholder')}
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
          />
        </div>
        {isResumeMode && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 12 }}>
            {t('request.resume_hint')}
          </p>
        )}
        {!isPeerReviewMode && !isResumeMode && (
          <>
          <div className="form-group" data-tour="submit-designee" style={{ marginTop: 12 }}>
            <label className="form-label">
              {t('request.designee_label')} <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
              {t('request.designee_help')}
            </p>
            {designees.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {designees.map((d) => (
                  <span
                    key={d.loginid}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '0.82rem' }}
                  >
                    {d.name}
                    <button
                      type="button"
                      onClick={() => removeDesignee(d.loginid)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '0.85rem', lineHeight: 1 }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div ref={designeeContainerRef} style={{ position: 'relative' }}>
              <input
                ref={designeeInputRef}
                className="form-control"
                placeholder={t('request.designee_placeholder')}
                value={designeeSearchQuery}
                onChange={(e) => {
                  setDesigneeSearchQuery(e.target.value);
                  setDesigneeError('');
                  setDesigneeDropdownOpen(true);
                  if (designeeInputRef.current) {
                    const r = designeeInputRef.current.getBoundingClientRect();
                    setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                onFocus={() => {
                  setDesigneeDropdownOpen(true);
                  if (designeeInputRef.current) {
                    const r = designeeInputRef.current.getBoundingClientRect();
                    setDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                autoComplete="off"
              />
              {designeeDropdownOpen && dropdownRect && createPortal(
                <div style={{ position: 'fixed', top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 220, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                  {(() => {
                    const q = designeeSearchQuery.toLowerCase();
                    const filtered = plUserOptions.filter(u =>
                      !designees.some(d => d.loginid === u.loginid) &&
                      (!q ||
                        u.name.toLowerCase().includes(q) ||
                        u.loginid.toLowerCase().includes(q) ||
                        (u.mail ?? '').toLowerCase().includes(q) ||
                        (u.deptname ?? '').toLowerCase().includes(q))
                    );
                    if (filtered.length === 0) {
                      return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('request.search_no_result')}</div>;
                    }
                    return filtered.map(u => (
                      <div
                        key={u.loginid}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addDesignee(u);
                          setDesigneeSearchQuery('');
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                          {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                        </span>
                      </div>
                    ));
                  })()}
                </div>,
                document.body
              )}
            </div>
            {designeeError && (
              <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 4 }}>{designeeError}</p>
            )}
          </div>

          {/* 후결자: C가문(only_prodc=YES) 일 때만 — PL 중 1명 이상 지정(고정 후결자는 서버가 항상 포함) */}
          {requiresPostApprover && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">
                {t('request.post_approver_label')} <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
                {t('request.post_approver_help')}
              </p>
              {postApprovers.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {postApprovers.map((p) => (
                    <span key={p.loginid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '0.82rem' }}>
                      {p.name}
                      <button type="button" onClick={() => setPostApprovers((prev) => prev.filter((x) => x.loginid !== p.loginid))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '0.85rem', lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div ref={postApproverContainerRef} style={{ position: 'relative' }}>
                <input
                  ref={postApproverInputRef}
                  className="form-control"
                  placeholder={t('request.post_approver_placeholder')}
                  value={postApproverSearch}
                  onChange={(e) => {
                    setPostApproverSearch(e.target.value);
                    setPostApproverDropdownOpen(true);
                    if (postApproverInputRef.current) {
                      const r = postApproverInputRef.current.getBoundingClientRect();
                      setPostApproverDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                    }
                  }}
                  onFocus={() => {
                    setPostApproverDropdownOpen(true);
                    if (postApproverInputRef.current) {
                      const r = postApproverInputRef.current.getBoundingClientRect();
                      setPostApproverDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                    }
                  }}
                  autoComplete="off"
                />
                {postApproverDropdownOpen && postApproverDropdownRect && createPortal(
                  <div style={{ position: 'fixed', top: postApproverDropdownRect.top, left: postApproverDropdownRect.left, width: postApproverDropdownRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 220, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                    {(() => {
                      const q = postApproverSearch.toLowerCase();
                      const filtered = plUserOptions.filter(u =>
                        !postApprovers.some(p => p.loginid === u.loginid) &&
                        (!q ||
                          u.name.toLowerCase().includes(q) ||
                          u.loginid.toLowerCase().includes(q) ||
                          (u.mail ?? '').toLowerCase().includes(q) ||
                          (u.deptname ?? '').toLowerCase().includes(q))
                      );
                      if (filtered.length === 0) {
                        return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('request.search_no_result')}</div>;
                      }
                      return filtered.map(u => (
                        <div
                          key={u.loginid}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setPostApprovers((prev) => [...prev, { loginid: u.loginid, name: u.name }]);
                            setPostApproverSearch('');
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{u.name}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                            {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                          </span>
                        </div>
                      ));
                    })()}
                  </div>,
                  document.body
                )}
              </div>
            </div>
          )}

          {/* 영업/기술지원 합의자: PL 검토와 병렬인 결재 단계. PL 중 지정(다중, 전원 합의).
              예외 구역 값을 기본값과 다르게 바꾼 의뢰서에서만 노출되며, 지정 또는 미지정 사유가 필수다. */}
          {requiresSalesAgreer && (
          <div className="form-group" data-tour="submit-agreer" style={{ marginTop: 12 }}>
            <label className="form-label">
              {t('request.sales_agreer_label')}
              <span style={{ color: 'var(--danger)' }}> *</span>
            </label>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
              {t('request.sales_agreer_help_required')}
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={salesAgreerNone}
                onChange={(e) => {
                  const none = e.target.checked;
                  setSalesAgreerNone(none);
                  if (none) {
                    setSalesAgreers([]);
                    setSalesAgreerSearch('');
                  } else {
                    setSalesAgreerNoneReason('');
                  }
                }}
              />
              {t('request.sales_agreer_none_toggle')}
            </label>
            {!salesAgreerNone && (<>
            {salesAgreers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {salesAgreers.map((p) => (
                  <span key={p.loginid} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '0.82rem' }}>
                    {p.name}
                    <button type="button" onClick={() => setSalesAgreers((prev) => prev.filter((x) => x.loginid !== p.loginid))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '0.85rem', lineHeight: 1 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <div ref={salesAgreerContainerRef} style={{ position: 'relative' }}>
              <input
                ref={salesAgreerInputRef}
                className="form-control"
                placeholder={t('request.sales_agreer_placeholder')}
                value={salesAgreerSearch}
                onChange={(e) => {
                  setSalesAgreerSearch(e.target.value);
                  setSalesAgreerDropdownOpen(true);
                  if (salesAgreerInputRef.current) {
                    const r = salesAgreerInputRef.current.getBoundingClientRect();
                    setSalesAgreerDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                onFocus={() => {
                  setSalesAgreerDropdownOpen(true);
                  if (salesAgreerInputRef.current) {
                    const r = salesAgreerInputRef.current.getBoundingClientRect();
                    setSalesAgreerDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                autoComplete="off"
              />
              {salesAgreerDropdownOpen && salesAgreerDropdownRect && createPortal(
                <div style={{ position: 'fixed', top: salesAgreerDropdownRect.top, left: salesAgreerDropdownRect.left, width: salesAgreerDropdownRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 220, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                  {(() => {
                    const q = salesAgreerSearch.toLowerCase();
                    const filtered = plUserOptions.filter(u =>
                      !salesAgreers.some(p => p.loginid === u.loginid) &&
                      (!q ||
                        u.name.toLowerCase().includes(q) ||
                        u.loginid.toLowerCase().includes(q) ||
                        (u.mail ?? '').toLowerCase().includes(q) ||
                        (u.deptname ?? '').toLowerCase().includes(q))
                    );
                    if (filtered.length === 0) {
                      return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('request.search_no_result')}</div>;
                    }
                    return filtered.map(u => (
                      <div
                        key={u.loginid}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSalesAgreers((prev) => [...prev, { loginid: u.loginid, name: u.name }]);
                          setSalesAgreerSearch('');
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                          {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                        </span>
                      </div>
                    ));
                  })()}
                </div>,
                document.body
              )}
            </div>
            </>)}
            {/* '없음'을 선택했을 때만 사유를 받는다 — 사유만 있으면 상신할 수 있다. */}
            {salesAgreerNone && (
              <div style={{ marginTop: 6 }}>
                <input
                  className="form-control"
                  placeholder={t('request.sales_agreer_none_reason_placeholder')}
                  value={salesAgreerNoneReason}
                  onChange={(e) => setSalesAgreerNoneReason(e.target.value)}
                />
              </div>
            )}
          </div>
          )}

          {/* 통보자: 결재 권한 없이 상신·결재완료 메일만 받는 인원 (다중) */}
          <div className="form-group" data-tour="submit-notifier" style={{ marginTop: 12 }}>
            <label className="form-label">{t('request.notifier_label')}</label>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
              {t('request.notifier_help')}
            </p>

            {/* 주소록 툴바: 통보처 불러오기 / 통보처로 저장 */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { setAbLoadOpen((v) => !v); setAbSaveOpen(false); setGroupLoadOpen(false); setAbLoadQuery(''); setAbLoadRect(null); }}
              >
                📁 {t('addressbook.load_btn')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { setGroupLoadOpen((v) => !v); setAbLoadOpen(false); setAbSaveOpen(false); setGroupLoadQuery(''); setGroupLoadRect(null); }}
              >
                👥 {t('request.notifier_group_btn')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => { setAbSaveOpen((v) => !v); setAbLoadOpen(false); setGroupLoadOpen(false); setAbSaveMode('new'); setAbSaveNewName(''); }}
              >
                💾 {t('addressbook.save_btn')}
              </button>
            </div>

            {/* 불러오기: 검색 입력 + 포털 드롭다운(주소록 이름 필터) */}
            {abLoadOpen && (
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  ref={abLoadInputRef}
                  className="form-control"
                  placeholder={t('addressbook.search_placeholder')}
                  value={abLoadQuery}
                  autoFocus
                  autoComplete="off"
                  style={{ fontSize: '0.85rem' }}
                  onChange={(e) => {
                    setAbLoadQuery(e.target.value);
                    if (abLoadInputRef.current) {
                      const r = abLoadInputRef.current.getBoundingClientRect();
                      setAbLoadRect({ top: r.bottom + 2, left: r.left, width: r.width });
                    }
                  }}
                  onFocus={() => {
                    if (abLoadInputRef.current) {
                      const r = abLoadInputRef.current.getBoundingClientRect();
                      setAbLoadRect({ top: r.bottom + 2, left: r.left, width: r.width });
                    }
                  }}
                  onBlur={() => setTimeout(() => setAbLoadRect(null), 150)}
                />
                {abLoadRect && createPortal(
                  <div style={{ position: 'fixed', top: abLoadRect.top, left: abLoadRect.left, width: abLoadRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 280, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                    {(() => {
                      const q = abLoadQuery.trim().toLowerCase();
                      const filtered = addressBooks.filter((b) => !q || b.name.toLowerCase().includes(q));
                      if (filtered.length === 0) {
                        return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{addressBooks.length === 0 ? t('addressbook.empty_list') : t('request.search_no_result')}</div>;
                      }
                      return filtered.map((b) => (
                        <div
                          key={b.id}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                          onMouseDown={(e) => { e.preventDefault(); loadAddressBook(b); }}
                        >
                          <span style={{ fontWeight: 600 }}>{b.name}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>{t('addressbook.member_count', { count: b.member_count })}</span>
                        </div>
                      ));
                    })()}
                  </div>,
                  document.body
                )}
              </div>
            )}

            {/* 그룹 불러오기: 검색 입력 + 포털 드롭다운(내가 속한 나만의 그룹 이름 필터) */}
            {groupLoadOpen && (
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  ref={groupLoadInputRef}
                  className="form-control"
                  placeholder={t('request.notifier_group_search_placeholder')}
                  value={groupLoadQuery}
                  autoFocus
                  autoComplete="off"
                  style={{ fontSize: '0.85rem' }}
                  onChange={(e) => {
                    setGroupLoadQuery(e.target.value);
                    if (groupLoadInputRef.current) {
                      const r = groupLoadInputRef.current.getBoundingClientRect();
                      setGroupLoadRect({ top: r.bottom + 2, left: r.left, width: r.width });
                    }
                  }}
                  onFocus={() => {
                    if (groupLoadInputRef.current) {
                      const r = groupLoadInputRef.current.getBoundingClientRect();
                      setGroupLoadRect({ top: r.bottom + 2, left: r.left, width: r.width });
                    }
                  }}
                  onBlur={() => setTimeout(() => setGroupLoadRect(null), 150)}
                />
                {groupLoadRect && createPortal(
                  <div style={{ position: 'fixed', top: groupLoadRect.top, left: groupLoadRect.left, width: groupLoadRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 280, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                    {(() => {
                      const q = groupLoadQuery.trim().toLowerCase();
                      const filtered = userGroups.filter((g) => !q || g.name.toLowerCase().includes(q));
                      if (filtered.length === 0) {
                        return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{userGroups.length === 0 ? t('request.notifier_group_empty_list') : t('request.search_no_result')}</div>;
                      }
                      return filtered.map((g) => (
                        <div
                          key={g.id}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                          onMouseDown={(e) => { e.preventDefault(); loadNotifierGroup(g); }}
                        >
                          <span style={{ fontWeight: 600 }}>{g.name}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>{t('addressbook.member_count', { count: g.members.length })}</span>
                        </div>
                      ));
                    })()}
                  </div>,
                  document.body
                )}
              </div>
            )}

            {/* 저장 패널: 기존 주소록 선택(덮어쓰기) 또는 새 이름(추가) */}
            {abSaveOpen && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', padding: 10, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select
                  className="form-control"
                  value={abSaveMode === 'new' ? 'new' : String(abSaveMode)}
                  onChange={(e) => setAbSaveMode(e.target.value === 'new' ? 'new' : Number(e.target.value))}
                  style={{ fontSize: '0.85rem' }}
                >
                  <option value="new">{t('addressbook.save_as_new')}</option>
                  {addressBooks.map((b) => (
                    <option key={b.id} value={b.id}>{t('addressbook.save_overwrite_option', { name: b.name })}</option>
                  ))}
                </select>
                {abSaveMode === 'new' && (
                  <input
                    className="form-control"
                    placeholder={t('addressbook.name_placeholder')}
                    value={abSaveNewName}
                    onChange={(e) => setAbSaveNewName(e.target.value)}
                    style={{ fontSize: '0.85rem' }}
                    autoComplete="off"
                  />
                )}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAbSaveOpen(false)}>{t('common.cancel')}</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={saveAddressBook}>{t('common.save')}</button>
                </div>
              </div>
            )}

            {(detail.notifiers ?? []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {(detail.notifiers ?? []).map((n) => (
                  <span
                    key={n.loginid}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: '0.82rem' }}
                  >
                    {n.name}
                    <button
                      type="button"
                      onClick={() => removeNotifier(n.loginid)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '0.85rem', lineHeight: 1 }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div ref={notifierContainerRef} style={{ position: 'relative' }}>
              <input
                ref={notifierInputRef}
                className="form-control"
                placeholder={t('request.notifier_placeholder')}
                value={notifierSearchQuery}
                onChange={(e) => {
                  setNotifierSearchQuery(e.target.value);
                  setNotifierDropdownOpen(true);
                  if (notifierInputRef.current) {
                    const r = notifierInputRef.current.getBoundingClientRect();
                    setNotifierDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                onFocus={() => {
                  setNotifierDropdownOpen(true);
                  if (notifierInputRef.current) {
                    const r = notifierInputRef.current.getBoundingClientRect();
                    setNotifierDropdownRect({ top: r.bottom + 2, left: r.left, width: r.width });
                  }
                }}
                autoComplete="off"
              />
              {notifierDropdownOpen && notifierDropdownRect && createPortal(
                <div style={{ position: 'fixed', top: notifierDropdownRect.top, left: notifierDropdownRect.left, width: notifierDropdownRect.width, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', zIndex: 9999, maxHeight: 220, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                  {(() => {
                    const q = notifierSearchQuery.toLowerCase();
                    const chosen = detail.notifiers ?? [];
                    const filtered = notifierUserOptions.filter(u =>
                      !chosen.some(n => n.loginid === u.loginid) &&
                      (!q ||
                        u.name.toLowerCase().includes(q) ||
                        u.loginid.toLowerCase().includes(q) ||
                        (u.mail ?? '').toLowerCase().includes(q) ||
                        (u.deptname ?? '').toLowerCase().includes(q))
                    );
                    if (filtered.length === 0) {
                      return <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('request.search_no_result')}</div>;
                    }
                    return filtered.map(u => (
                      <div
                        key={u.loginid}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '0.875rem', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addNotifier(u);
                          setNotifierSearchQuery('');
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                          {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                        </span>
                      </div>
                    ));
                  })()}
                </div>,
                document.body
              )}
            </div>
            {noMailNotifiers.length > 0 && (
              <p style={{ fontSize: '0.78rem', color: 'var(--warning, #b26a00)', margin: '6px 0 0', lineHeight: 1.5 }}>
                ⚠️ {t('addressbook.inline_no_mail', { count: noMailNotifiers.length, names: noMailNotifiers.map((n) => n.name).join(', ') })}
              </p>
            )}
          </div>
          </>
        )}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!mapTypeChangeConfirm}
        onClose={() => setMapTypeChangeConfirm(null)}
        onConfirm={handleMapTypeChangeConfirm}
        title={t('request.map_type_change_confirm_title')}
        message={t('request.map_type_change_confirm_msg')}
        danger
      />

      <ConfirmModal
        isOpen={prodcScopeConfirm !== null}
        onClose={() => setProdcScopeConfirm(null)}
        onConfirm={() => { if (prodcScopeConfirm !== null) applyProdcScope(prodcScopeConfirm); }}
        title={t('request.prodc_scope_change_title')}
        message={t('request.prodc_scope_change_msg')}
        danger
      />

      <ConfirmModal
        isOpen={onlyMapConfirm !== null}
        onClose={() => setOnlyMapConfirm(null)}
        onConfirm={handleOnlyMapConfirm}
        title={
          onlyMapConfirm?.targetPurpose === MAP_DELETE_EDIT_PURPOSE
            ? t('request.map_delete_edit_confirm_title')
            : onlyMapConfirm?.targetPurpose === ONLY_MAP_PURPOSE
              ? t('request.only_map_confirm_title')
              : onlyMapConfirm?.targetPurpose === ADI_CD_CHANGE_PURPOSE
                ? t('request.adi_cd_request_purpose_confirm_title')
                : detail.request_purpose === MAP_DELETE_EDIT_PURPOSE
                  ? t('request.map_delete_leave_confirm_title')
                  : detail.request_purpose === ADI_CD_CHANGE_PURPOSE
                    ? t('request.adi_cd_leave_title')
                    : t('request.map_only_leave_confirm_title')
        }
        message={
          onlyMapConfirm?.targetPurpose === MAP_DELETE_EDIT_PURPOSE
            ? t('request.map_delete_edit_confirm_msg')
            : onlyMapConfirm?.targetPurpose === ONLY_MAP_PURPOSE
              ? t('request.only_map_confirm_msg')
              : onlyMapConfirm?.targetPurpose === ADI_CD_CHANGE_PURPOSE
                ? t('request.adi_cd_request_purpose_confirm_msg')
                : detail.request_purpose === MAP_DELETE_EDIT_PURPOSE
                  ? t('request.map_delete_leave_confirm_msg')
                  : detail.request_purpose === ADI_CD_CHANGE_PURPOSE
                    ? t('request.adi_cd_leave_msg')
                    : t('request.map_only_leave_confirm_msg')
        }
        danger
      />

      <ConfirmModal
        isOpen={mergeReselectConfirm}
        onClose={() => setMergeReselectConfirm(false)}
        onConfirm={handleMergeReselectConfirm}
        title={t('request.merge_reselect_confirm_title')}
        message={mergeSnapshot
          ? t('request.merge_reselect_confirm_msg')
          : t('request.merge_reselect_no_snapshot')}
        danger
      />

      {/* 참조 요청서 있음/없음 전환 — 확인해야 초기화와 함께 모드가 바뀐다 */}
      <ConfirmModal
        isOpen={mergeModeConfirm !== null}
        onClose={() => setMergeModeConfirm(null)}
        onConfirm={handleMergeModeConfirm}
        title={t('request.merge_mode_change_title')}
        message={t('request.merge_mode_change_confirm')}
        danger
      />

      <ConfirmModal
        isOpen={adiCdPendingApply !== null}
        onClose={() => setAdiCdPendingApply(null)}
        onConfirm={() => { if (adiCdPendingApply) commitAdiCdRows(adiCdPendingApply.side, adiCdPendingApply.rows, adiCdPendingApply.startIndex); }}
        title={t('request.adi_cd_replace_title')}
        message={t('request.adi_cd_replace_msg')}
        danger
      />

      <ConfirmModal
        isOpen={adiCdRemoveConfirm !== null}
        onClose={() => setAdiCdRemoveConfirm(null)}
        onConfirm={handleAdiCdRemoveConfirm}
        title={t('request.adi_cd_remove_row_title')}
        message={t('request.adi_cd_remove_row_msg')}
        danger
      />

      <AdiCdColumnMapModal
        isOpen={adiCdMapModal !== null}
        grid={adiCdMapModal?.grid ?? []}
        initialStepIdCol={adiCdMapModal?.header?.stepIdCol ?? null}
        initialStepDescCol={adiCdMapModal?.header?.stepDescCol ?? null}
        onCancel={() => setAdiCdMapModal(null)}
        onConfirm={handleAdiCdMapConfirm}
      />

      <ConfirmModal
        isOpen={bbResetConfirm}
        onClose={() => setBbResetConfirm(false)}
        onConfirm={proceedResetBbRows}
        title={t('common.confirm')}
        message={t('request.bb_reset_confirm')}
        danger
      />

      {bbAutoFillAmbiguous.length > 0 && (
        <Modal
          isOpen
          onClose={handleCancelBbAmbiguous}
          title={t('request.bb_ambiguous_modal_title')}
          size="lg"
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={handleCancelBbAmbiguous}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={handleResolveBbAmbiguous}>
                {t('request.bb_ambiguous_apply_btn')}
              </button>
            </>
          }
        >
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
            {t('request.bb_ambiguous_modal_desc')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bbAutoFillAmbiguous.map((item) => (
              <div key={item.jayerRowId} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  {t('request.bb_ambiguous_src_label', {
                    process: item.process_id || '—',
                    sp: item.sp || '—',
                    layer: item.layerid || '—',
                  })}
                </div>
                <select
                  value={bbAutoFillAmbiguousChoices[item.jayerRowId] ?? 'skip'}
                  onChange={(e) =>
                    handleBbAmbiguousChoice(item.jayerRowId, e.target.value === 'skip' ? 'skip' : Number(e.target.value))
                  }
                  style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
                >
                  <option value="skip">{t('request.bb_ambiguous_skip_option')}</option>
                  {item.candidates.map((c, idx) => (
                    <option key={idx} value={idx}>
                      {`${c.processid} / ${c.stepseq} / ${c.descript} / Layer ${c.layerid}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Modal>
      )}

      <ConfirmModal
        isOpen={specialCareConfirm}
        onClose={() => setSpecialCareConfirm(false)}
        onConfirm={() => resumePendingStep('specialCare')}
        title={t('request.tbvtlv_warn_title')}
        message={t('request.special_care_confirm')}
        confirmLabel={t('request.tbvtlv_warn_proceed')}
      />

      <ConfirmModal
        isOpen={!!filterDeleteConfirm}
        onClose={() => setFilterDeleteConfirm(null)}
        onConfirm={handleFilterDeleteConfirm}
        title={t('common.confirm')}
        message={t('request.filter_delete_confirm', { label: filterDeleteConfirm?.label ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        topLevel
      />

      <ConfirmModal
        isOpen={!!filterAllDeleteConfirm}
        onClose={() => setFilterAllDeleteConfirm(null)}
        onConfirm={handleFilterAllDeleteConfirm}
        title={t('common.confirm')}
        message={t('request.filter_all_delete_confirm')}
        confirmLabel={t('common.delete')}
        danger
        topLevel
      />

      <StepGuideTour
        isOpen={stepTour.activeStep !== null}
        title={stepTour.activeStep !== null ? stepTour.stepTitle(stepTour.activeStep) : ''}
        groups={stepTour.activeStep !== null ? stepTour.groupsForStep(stepTour.activeStep) : []}
        onRestoreBase={stepTour.restoreBase}
        onClose={stepTour.close}
      />

      <GuideSlidePanel
        featureKey={slidePanel.featureKey}
        featureTitle={slidePanel.title}
        isOpen={slidePanel.open}
        onClose={() => setSlidePanel((prev) => ({ ...prev, open: false }))}
      />

      {/* 전체 가이드 데모: 실제 표/패널 위에 떠 있는 가짜 커서 + 복사/붙여넣기 칩 (J-ayer step3 · BB step5) */}
      {isTourMode && (step === 3 || step === 5) && tourJCursor && (
        <div className={`tour-jcursor${tourJClicking ? ' clicking' : ''}`} style={{ transform: `translate(${tourJCursor.x}px, ${tourJCursor.y}px)` }}>
          {tourJClicking && <span className="tour-jcursor-ripple" />}
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path d="M2 2 L2 17 L6.2 13 L9 19 L11.4 18 L8.6 12 L14 12 Z" fill="#fff" stroke="#1a1a2e" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {isTourMode && step === 3 && tourJChip && (
        <div className="tour-jchip" style={{ top: tourJChip.y, left: tourJChip.x }}>
          📋 Ctrl + {tourJChip.kind === 'copy' ? 'C' : 'V'}
        </div>
      )}
    </div>
  );
}
