// ===== Auth / Role Types =====

export type UserRole = 'PL' | 'TE_R' | 'TE_J' | 'TE_O' | 'TE_E' | 'MASTER';

export interface MockUser {
  id: number;
  username: string;
  password: string;
  name: string;
  role: UserRole;
  department: string;
  email: string;
}

// ===== Domain Enums / Literal Types =====

export type Status =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'revision_required';

export type VocStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type RfgStatus = 'open' | 'in_progress' | 'resolved';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ProductType = 'new' | 'update' | 'add_feature' | 'change';
export type MapType = 'intro' | 'feature' | 'comparison' | 'roadmap';
export type VocCategory = 'inquiry' | 'complaint' | 'suggestion' | 'praise';

export type AgentType = 'R' | 'J' | 'O' | 'E';
export type StepAction = 'pending' | 'approved' | 'rejected';

export interface ApprovalStepFrontend {
  id: number;
  agent: AgentType;
  action: StepAction;
  acted_at: string | null;
  is_parallel?: boolean;  // J, O 병렬 표시용
}

// ===== Domain Models =====

export interface RequestDocument {
  id: number;
  title: string;
  requester_name: string;
  requester_email: string;
  requester_department: string;
  requester_position: string;
  product_name: string;
  product_name_en: string;
  product_type: ProductType;
  product_version: string;
  product_description: string;
  product_description_en: string;
  map_type: MapType;
  target_audience: string;
  key_features: string;
  key_features_en: string;
  changes_from_previous: string;
  reference_materials: string;
  deadline: string;
  priority: Priority;
  additional_notes: string;
  status: Status;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  approval_steps?: ApprovalStepFrontend[];
}

export type CreateDocumentInput = Omit<
  RequestDocument,
  'id' | 'status' | 'created_at' | 'updated_at' | 'submitted_at' | 'approval_steps'
>;

export type UpdateDocumentInput = Partial<CreateDocumentInput>;

export interface VOC {
  id: number;
  title: string;
  category: VocCategory;
  submitter_name: string;
  submitter_email: string;
  content: string;
  response: string;
  status: VocStatus;
  created_at: string;
  responded_at: string | null;
}

export type CreateVocInput = Omit<VOC, 'id' | 'response' | 'status' | 'created_at' | 'responded_at'>;

export interface RFG {
  id: number;
  title: string;
  requester_name: string;
  requester_email: string;
  product_name: string;
  description: string;
  status: RfgStatus;
  created_at: string;
}

export type CreateRfgInput = Omit<RFG, 'id' | 'status' | 'created_at'>;

export interface Stats {
  total: number;
  by_status: Record<string, number>;
}

// ===== Detail Form Types =====

export interface FlowChartRow {
  id: string;
  location: string;
  product_name: string;
  step: string;
}

export interface JayerRow {
  id: string;
  cooking_method: string;
  sp: string;
  sd: string;
  pp: string;
  st: string;           // 'O' | 'X' | ''
  new_or_copy: string;  // '신규' | '복사' | ''
  product_name: string;
  step: string;
  item_id: string;
  rev: string;
  drawing_version: string;
}

export interface OayerRow {
  id: string;
  cooking_method: string;
  sp: string;
  sd: string;
  pp: string;
  st: string;
  new_or_copy: string;
  product_name: string;
  step: string;
  tt: string;
}

export interface BoneStewTableRow {
  id: string;
  cooking_method: string;
  ss: string;
  sd: string;
  bone_cooking: string;
  bone_name: string;
  bone_step: string;
  bone_ss: string;
  remark: string;
}

export interface DetailFormState {
  // 항상 표시
  request_purpose: string;
  line: string;
  combination_method: string;
  product_name_select: string;

  // 복사 선택 시
  other_purpose: string;
  source_location: string;
  source_product_name: string;
  change_purpose_note: string;
  flow_chart: FlowChartRow[];

  // 제품 이름 선택 시
  cooking_method: string;

  // 지도 편차
  map_deviation_change: string;
  map_deviation_value: string;
  map_deviation_reason: string;

  // 예외 구역
  exception_zone_change: string;
  exception_zone_value: string;

  // 분리
  separation_progress: string;

  // 뼈찜
  bone_stew_zone: string;
  bone_stew_location: string;
  bone_stew_product: string;
  bone_stew_cooking: string;

  // C가문
  only_c_family: string;
  c_family_north_line: string;
  c_family_north_combination: string;
  c_family_north_product: string;
  c_family_middle_use: string;
  c_family_middle_line: string;
  c_family_middle_combination: string;
  c_family_middle_product: string;
  c_family_south_line: string;
  c_family_south_combination: string;
  c_family_south_product: string;

  // X표시
  x_mark_change: string;
  x_mark_image_copy: string;

  // 20주년
  anniversary_20: string;
  anniversary_20_option: string;

  // T가문 / 주력 / 설탕
  t_family_apply: string;
  main_product_change: string;
  sugar_add: string;
}

// ===== API Response Wrappers =====
// Pages consume responses as r.data or r.data.results

export interface ApiResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: { results: T[]; count: number } | T[];
}
