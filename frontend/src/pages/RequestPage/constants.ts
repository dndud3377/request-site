import {
  CreateDocumentInput,
  DetailFormState,
  FlowChartRow,
  JayerRow,
  OayerRow,
  BbTableRow,
  AdiCdStep,
} from '../../types';

// ===== Option Constants =====
export const OPTION_REQUEST_PURPOSE = ['신규', '차용', '신규+차용', 'Only MAP', 'MAP 삭제/수정', '기타'] as const;
export const OPTION_LINE = ['라인1', '라인2', '라인3', '라인4', '라인5'] as const;
export const OPTION_OTHER_PURPOSE = ['Layer 추가/삭제', 'STEPSEQ 변경', '공법 추가/변경', 'Overlay 변경', 'ADI CD 변경', 'FirstA 변경', '연구소 제품'] as const;

// 참조 요청서 Merge(+ BEFORE/AFTER 비교)를 쓸 수 있는 기타 목적.
// 여러 개를 함께 골라도 참조 요청서는 의뢰서당 1건이므로 블록은 하나만 노출한다.
export const MERGE_ENABLED_PURPOSES = ['Layer 추가/삭제', 'STEPSEQ 변경', 'Overlay 변경'] as const;

/** 기타 목적에 Merge 사용 항목이 하나라도 포함됐는가 */
export const isMergePurposeSelected = (otherPurpose: string[]): boolean =>
  otherPurpose.some((o) => (MERGE_ENABLED_PURPOSES as readonly string[]).includes(o));

// BEFORE/AFTER 표의 '미등록' 행 선택 id — 실제 행 id 와 겹치지 않도록 예약어를 쓴다.
export const MERGE_UNREGISTERED_ID = '__merge_unregistered__';

// 'Only MAP' 요청 목적: StepMap 정보까지만 작성하고 결재 경로도 단축된다(backend RequestDocument.ONLY_MAP_PURPOSE 와 동일 값).
export const ONLY_MAP_PURPOSE = 'Only MAP';

// '기타 목적 > ADI CD 변경': 특정 제품 ADI CD 스텝 개수 증감/전체삭제 요청. 진입 시 map_type 을 이 값으로 고정한다.
export const OTHER_PURPOSE_ADI_CD = 'ADI CD 변경';
export const ADI_CD_MAP_TYPE = 'ADI';
// 초기 빈 템플릿 행 수
export const ADI_CD_TEMPLATE_ROWS = 5;
// 붙여넣기 허용 최대 행 수(초과 시 거부)
export const ADI_CD_MAX_ROWS = 500;
// 헤더 탐색 시 위에서부터 볼 최대 행 수(제목 행·빈 행이 섞여 있을 수 있어 첫 행만 보지 않는다)
export const ADI_CD_HEADER_SCAN_ROWS = 5;
// 헤더 라벨 — 의뢰자가 엑셀 원본과 대조해야 하므로 번역하지 않는다.
export const ADI_CD_STEP_ID_LABEL = 'STEP_ID';
export const ADI_CD_STEP_DESC_LABEL = 'STEP_DESC';

export { ST_CELL_COLOR } from '../../utils/stCellColor';

// ===== Validation System 대상 판정 =====
/** 판정 키워드 — J-layer 행의 pp 값에 포함되면 그 행은 대상 근거가 된다(대소문자 무관) */
export const VALIDATION_KEYWORD = 'plel';
/**
 * detail.validation_system 에 저장되는 값.
 * 판정 키워드가 아예 없는 문서는 판정 자체가 성립하지 않으므로 VS_NA('해당없음')이며,
 * 이때는 E(MASK) 단계도 결재 경로에 포함되지 않는다(백엔드 has_ppid_plel 과 동일 기준).
 */
export const VS_TARGET = 'YES';
export const VS_NONTARGET = 'NO';
export const VS_NA = 'NA';
/** 판정 키워드를 포함한 pp 셀 배경색 */
export const VALIDATION_CELL_COLOR = '#fff9c4';

// 엑셀식 붙여넣기용 편집 가능 컬럼 순서(표 표시 순서와 동일). No/체크박스/Update(읽기전용) 제외.
export const JAYER_EDITABLE_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp', 'st', 'new_or_copy', 'product_name', 'step', 'item_id'] as const;
export const OAYER_EDITABLE_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp', 'st', 'new_or_copy', 'product_name', 'step'] as const;
// 자동채움/병합으로 "불러온" 행에서 읽기전용으로 잠그는 컬럼(수동 추가 행은 편집 허용)
export const LOADED_LOCK_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp'] as const;
// J/O-layer 표의 col_new_or_copy · col_st 저장값(그대로 DB 에 들어간다).
export const NOC_NEW = '신규';
export const NOC_BORROW = '차용';
export const NOC_REGISTERED = '기등록';
export const NOC_LAYER_DELETE = 'layer삭제';
export const ST_O = 'O';
export const ST_X = 'X';

// new_or_copy가 이 값이면 J↔O 동기화(송신·수신)에서 제외하고 bb 원본 데이터 목록에서도 숨긴다.
export const isNocSpecial = (noc?: string): boolean => noc === NOC_REGISTERED || noc === NOC_LAYER_DELETE;

// ===== Shared Types =====
export type CRegion = 'top' | 'middle' | 'bottom';
/** C가문 '제품 해당 위치'. '' = 미선택(게이트), 'only_*' = 그 리전 하나만 사용. */
export type ProdcScope = DetailFormState['prodc_scope'];
/** 라디오 표시 순서 — 기존 3개 뒤에 ONLY 2개를 이어붙인다. */
export const PRODC_SCOPE_OPTIONS: {
  value: Exclude<ProdcScope, ''>;
  labelKey: 'prodc_top' | 'prodc_middle' | 'prodc_bottom' | 'prodc_only_top' | 'prodc_only_bottom';
}[] = [
  { value: 'top', labelKey: 'prodc_top' },
  { value: 'middle', labelKey: 'prodc_middle' },
  { value: 'bottom', labelKey: 'prodc_bottom' },
  { value: 'only_top', labelKey: 'prodc_only_top' },
  { value: 'only_bottom', labelKey: 'prodc_only_bottom' },
];

/**
 * prodc_scope 가 없는 옛 문서를 저장값으로 역추론한다(편집 로드 백필).
 * 북·남 둘 다 있으면 'top'(북/중/남 셋은 잠금·필수 규칙이 동일해 어느 값이든 동작이 같다),
 * 한쪽만 있으면 그쪽 ONLY 스코프로 본다.
 */
export function inferProdcScope(d: Partial<DetailFormState>): ProdcScope {
  const hasTop = !!(d.prodc_top_line || d.prodc_top_process || d.prodc_top_product);
  const hasBottom = !!(d.prodc_bottom_line || d.prodc_bottom_process || d.prodc_bottom_product);
  if (hasTop && hasBottom) return 'top';
  if (hasTop) return 'only_top';
  if (hasBottom) return 'only_bottom';
  return '';
}

// ===== Row Factories =====
export const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// Backbone 조합 영역 한 항목(bb_entries). React key·매핑 출처 식별을 위해 항목마다 고유 id를 둔다.
export const makeBbEntry = (): { id: string; location: string; product: string; process_id: string } => ({
  id: genId(),
  location: '',
  product: '',
  process_id: '',
});

export const makeRow = (): FlowChartRow => ({
  id: genId(),
  location: '',
  product_name: '',
  process_id: '',
  step_from: '',
  step_to: '',
});

export const makeJayerRow = (): JayerRow => ({
  id: genId(),
  updated: '',
  sortOrder: Date.now(),
  disabled: false,
  manuallyDisabled: false,
  process_id: '',
  sp: '',
  sd: '',
  pp: '',
  layerid: '',
  st: '',
  new_or_copy: '',
  product_name: '',
  step: '',
  item_id: '',
});

export const makeOayerRow = (): OayerRow => ({
  id: genId(),
  updated: '',
  sortOrder: Date.now(),
  disabled: false,
  manuallyDisabled: false,
  process_id: '',
  sp: '',
  sd: '',
  pp: '',
  layerid: '',
  st: '',
  new_or_copy: '',
  product_name: '',
  step: '',
});

export const makeBbRow = (): BbTableRow => ({
  id: genId(),
  sortOrder: Date.now(),
  disabled: false,
  process_id: '',
  ss: '',
  sd: '',
  bb_process_id: '',
  bb_name: '',
  bb_layer: '',
  bb_ss: '',
  bb_step: '',
  remark: '',
});

export const makeAdiCdStep = (): AdiCdStep => ({
  id: genId(),
  step_id: '',
  step_desc: '',
});

// ===== Initial States =====
export const INITIAL_DETAIL: DetailFormState = {
  request_purpose: '',
  line: '',
  process_selection: '',
  partid_selection: '',
  customer_name: '',
  customer_requirement: '',
  other_purpose: [],
  source_line: '',
  source_partid: '',
  change_purpose_note: '',
  flow_chart: [makeRow()],
  process_id: '',
  map_type: '',
  map_change: '변경 없음',
  map_value_x: '',
  map_value_y: '',
  map_reason: '',
  map_change_top: '변경 있음',
  map_value_x_top: '',
  map_value_y_top: '',
  map_change_bottom: '변경 있음',
  map_value_x_bottom: '',
  map_value_y_bottom: '',
  ea_change: '변경 없음',
  ea_value: '',
  bb_zone: '존재',
  bb_entries: [makeBbEntry()],
  only_prodc: 'No',
  prodc_scope: '',
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
  mshot_image_copy_top: '',
  mshot_image_copy_bottom: '',
  photo_backside: '미적용',
  eds_backside: '미적용',
  inter: 'NO',
  inter_xs: '미적용',
  inter_ys: '미적용',
  in_apply: '',
  inter_select: '',
  tsv: '미적용',
  rf: '미적용',
  fullchip: '미적용',
  split: '미적용',
  st: '미적용',
  ecc: '미적용',
  labelsideshot: '미적용',
  hpkglabelheight: '미적용',
  rev_yn: '',
  rev_entries: [],
  partial_shot: '',
  tbvtlv_thickness: '',
  tbvtlv_entries: [],
  notifiers: [],
  validation_system: VS_NONTARGET,
  merge_ref_doc_id: null,
  merge_ref_doc_label: '',
  merge_pairs: [],
  merge_unmatched_before: [],
  merge_unmatched_after: [],
  adi_cd_before: [],
  adi_cd_after: [],
  adi_cd_delete_all: false,
};

export const INITIAL_FORM: CreateDocumentInput = {
  title: '',
  requester_name: '',
  requester_email: '',
  requester_department: '',
  product_name: '',
  production_date: null,
  reference_materials: '',
  additional_notes: '',
};

export const DETAIL_REQUIRED: (keyof DetailFormState)[] = [
  'request_purpose',
  'line',
  'process_selection',
  'partid_selection',
  'process_id',
];

// ===== 전체 가이드(투어) 샘플 시드 =====
// /request?embed=tour 진입 시, 위저드 각 단계를 "값이 채워진" 상태로 보여주기 위한 샘플 데이터.
export const makeTourDetail = (): DetailFormState => ({
  ...INITIAL_DETAIL,
  request_purpose: '신규',
  line: '라인1',
  process_selection: 'RECIPE_A',
  partid_selection: 'PART_1000',
  process_id: 'PROC_X1',
  customer_name: '샘플 고객사',
  customer_requirement: '신규 라인 제품 소개 지도 제작 요청',
  map_type: 'NEW',
  // BB 자동채움/매핑 데모용 — 외부 데이터 탭 2개와 1:1로 대응한다.
  bb_entries: [
    { ...makeBbEntry(), product: 'BB제품1', process_id: 'BB_R1' },
    { ...makeBbEntry(), product: 'BB제품2', process_id: 'BB_R2' },
  ],
});

// J-ayer 행의 Layer 값 — BB 자동채움이 실제로 매칭되도록 외부 데이터 layerid와 맞춘다.
export const TOUR_JAYER_LAYERS = ['10', '20', '30', '40', '50'];

export const makeTourJayerRows = (): JayerRow[] =>
  TOUR_JAYER_LAYERS.map((layer, i) => ({
    ...makeJayerRow(),
    sortOrder: i,
    process_id: 'PROC_X1',
    sp: `SP0${i + 1}`,
    sd: `SD0${i + 1}`,
    layerid: layer,
    st: 'O',
    new_or_copy: '신규',
    product_name: '',
    step: '',
    item_id: '',
  }));

export const makeTourOayerRows = (): OayerRow[] => [
  { ...makeOayerRow(), sortOrder: 0, process_id: 'PROC_X1', sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01', st: 'ST1', new_or_copy: '신규', product_name: '샘플제품A', step: '10' },
  { ...makeOayerRow(), sortOrder: 1, process_id: 'PROC_X1', sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'ST1', new_or_copy: '신규', product_name: '샘플제품A', step: '20' },
  // TBV/TLV는 O-ayer에 TBV/TLV 항목이 있어야 '정보' 탭에 노출된다 — 데모용 시드 1행.
  { ...makeOayerRow(), sortOrder: 2, process_id: 'PROC_X1', sp: 'SP03', sd: 'TBV', pp: 'PP03', layerid: 'L03', st: 'ST1', new_or_copy: '신규', product_name: '샘플제품A', step: '30' },
];

export const makeTourBbRows = (): BbTableRow[] => [
  { ...makeBbRow(), process_id: 'PROC_X1', ss: 'SP01', sd: 'SD01', bb_process_id: 'BB_R1', bb_name: 'BB제품1', bb_layer: '10', bb_ss: '110', bb_step: 'BB제품1 STEP', remark: '' },
  { ...makeBbRow(), process_id: 'PROC_X1', ss: 'SP02', sd: 'SD02', bb_process_id: 'BB_R1', bb_name: 'BB제품1', bb_layer: '20', bb_ss: '120', bb_step: 'BB제품1 STEP', remark: '' },
];

// BB 자동채움·매핑 데모용 외부 데이터 (PhotoStepOption[][]) — 탭은 bb_entries와 1:1 대응.
// 탭1(BB제품1)은 Layer 10/20/30, 탭2(BB제품2)는 Layer 40/50을 담당한다.
export const makeTourBbExternalData = () => [
  [
    { processid: 'BB_R1', stepseq: '110', descript: 'BB제품1 STEP', layerid: '10' },
    { processid: 'BB_R1', stepseq: '120', descript: 'BB제품1 STEP', layerid: '20' },
    { processid: 'BB_R1', stepseq: '130', descript: 'BB제품1 STEP', layerid: '30' },
  ],
  [
    { processid: 'BB_R2', stepseq: '240', descript: 'BB제품2 STEP', layerid: '40' },
    { processid: 'BB_R2', stepseq: '250', descript: 'BB제품2 STEP', layerid: '50' },
  ],
];

// J-ayer 데모에서 채워 넣을 샘플 값
export const TOUR_JAYER_PRODUCT = '샘플제품A';
export const TOUR_JAYER_STEPS = ['10', '20', '30', '40', '50'];
export const TOUR_JAYER_ITEMS = ['ITEM_1', 'ITEM_2', 'ITEM_3', 'ITEM_4', 'ITEM_5'];
