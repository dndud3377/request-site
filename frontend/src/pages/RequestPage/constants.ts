import {
  CreateDocumentInput,
  DetailFormState,
  FlowChartRow,
  JayerRow,
  OayerRow,
  BbTableRow,
} from '../../types';

// ===== Option Constants =====
export const OPTION_REQUEST_PURPOSE = ['신규', '차용', '신규+차용', 'Only MAP', '기타'] as const;
export const OPTION_LINE = ['라인1', '라인2', '라인3', '라인4', '라인5'] as const;
export const OPTION_OTHER_PURPOSE = ['Layer 추가/삭제', 'STEPSEQ 변경', '공법 추가/변경', 'Overlay, ADI CD 추가/삭제/변경', 'Short loop'] as const;

export { ST_CELL_COLOR } from '../../utils/stCellColor';

// 엑셀식 붙여넣기용 편집 가능 컬럼 순서(표 표시 순서와 동일). No/체크박스/Update(읽기전용) 제외.
export const JAYER_EDITABLE_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp', 'st', 'new_or_copy', 'product_name', 'step', 'item_id'] as const;
export const OAYER_EDITABLE_COLS = ['process_id', 'sp', 'sd', 'layerid', 'pp', 'st', 'new_or_copy', 'product_name', 'step'] as const;

// ===== Shared Types =====
export type CRegion = 'top' | 'middle' | 'bottom';

// ===== Row Factories =====
export const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

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
  bb_step: '',
  bb_ss: '',
  remark: '',
});

// ===== Initial States =====
export const INITIAL_DETAIL: DetailFormState = {
  request_purpose: '',
  line: '',
  process_selection: '',
  partid_selection: '',
  customer_name: '',
  customer_requirement: '',
  other_purpose: '',
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
  mshot_image_copy_top: '',
  mshot_image_copy_bottom: '',
  photo_backside: '미적용',
  eds_backside: '미적용',
  inter: '미적용',
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
});

export const makeTourJayerRows = (): JayerRow[] => [
  makeJayerRow(), makeJayerRow(), makeJayerRow(), makeJayerRow(), makeJayerRow(),
];

export const makeTourOayerRows = (): OayerRow[] => [
  { ...makeOayerRow(), process_id: 'PROC_X1', sp: 'SP01', sd: 'SD01', pp: 'PP01', layerid: 'L01', st: 'ST1', new_or_copy: '신규', product_name: '샘플제품A', step: '10' },
  { ...makeOayerRow(), process_id: 'PROC_X1', sp: 'SP02', sd: 'SD02', pp: 'PP02', layerid: 'L02', st: 'ST1', new_or_copy: '신규', product_name: '샘플제품A', step: '20' },
];

export const makeTourBbRows = (): BbTableRow[] => [
  { ...makeBbRow(), process_id: 'PROC_X1', ss: 'SS01', sd: 'SD01', bb_process_id: 'BB_X1', bb_name: 'BB샘플A', bb_step: '10', bb_ss: 'BSS01', remark: '' },
  { ...makeBbRow(), process_id: 'PROC_X2', ss: 'SS02', sd: 'SD02', bb_process_id: 'BB_X2', bb_name: 'BB샘플B', bb_step: '20', bb_ss: 'BSS02', remark: '' },
];

// BB 자동채움 버튼을 활성화하기 위한 외부 데이터 샘플 (PhotoStepOption[][])
export const makeTourBbExternalData = () => [
  [
    { processid: 'BB_X1', stepseq: '10', descript: 'BB샘플A', layerid: 'L01' },
    { processid: 'BB_X2', stepseq: '20', descript: 'BB샘플B', layerid: 'L02' },
  ],
];

// J-ayer 데모에서 채워 넣을 샘플 값
export const TOUR_JAYER_PRODUCT = '샘플제품A';
export const TOUR_JAYER_STEPS = ['10', '20', '30', '40', '50'];
export const TOUR_JAYER_ITEMS = ['ITEM_1', 'ITEM_2', 'ITEM_3', 'ITEM_4', 'ITEM_5'];
