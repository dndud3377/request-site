import {
  CreateDocumentInput,
  DetailFormState,
  FlowChartRow,
  JayerRow,
  OayerRow,
  BbTableRow,
} from '../../types';

// ===== Option Constants =====
export const OPTION_REQUEST_PURPOSE = ['신규', '차용', '신규+차용', 'Only MAP'] as const;
export const OPTION_LINE = ['라인1', '라인2', '라인3', '라인4', '라인5'] as const;
export const OPTION_OTHER_PURPOSE = ['Layer 추가/삭제', 'STEPSEQ 변경', '공법 추가/변경', 'Overlay, ADI CD 추가/삭제/변경'] as const;

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
