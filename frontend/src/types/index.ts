// ===== Auth / Role Types =====

// 역할 타입 (null 제외 - 기본)
export type UserRole = 'PL' | 'TE_R' | 'TE_P' | 'TE_J' | 'TE_O' | 'TE_E' | 'MASTER' | 'NONE';

// null 을 포함한 역할 타입
export type UserRoleWithNull = UserRole | null | 'NONE';

export interface MockUser {
  id: number;
  username: string;
  name: string;
  role: UserRoleWithNull;
  department: string;
  email: string;
}

export interface UserInfo {
  id: number;
  username: string;
  name: string;
  role: UserRoleWithNull;
  department: string;
  email: string;
}


export interface Line {
  id: number;
  name: string;
  order: number;
}


export type Status =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'pause'
  | 'approved'
  | 'rejected';

export type VocStatus = 'checking' | 'completed' | 'rejected';

export type VocCategory = 'inquiry' | 'error_report' | 'feature_request' | 'task_request';

export type AgentType = 'PL' | 'R' | 'RV' | 'P' | 'PV' | 'J' | 'O' | 'E' | 'EV' | 'RA';
export type StepAction = 'pending' | 'approved' | 'rejected' | 'skip';

// 역할 → 담당자 매핑 (null 제외)
export const ROLE_TO_AGENT: Partial<Record<UserRole, AgentType>> = {
  TE_R: 'R',
  TE_P: 'P',
  TE_J: 'J',
  TE_O: 'O',
  TE_E: 'E',
};

export interface ApprovalStepFrontend {
  id: number;
  agent: AgentType;
  action: StepAction;
  acted_at: string | null;
  comment?: string;
  is_parallel?: boolean;  // J, O 병렬 표시용
  assignee_loginid?: string; // 담당자 loginid
  assignee_name?: string;    // 담당자 이름
  assignee_mail?: string | null; // 담당자 이메일 (결재 경로 탭 표시용)
  round: number;             // 상신 회차
  created_at?: string | null; // 단계 생성일시 (R 단계의 경우 해당 회차 상신 시각)
  due_date?: string | null;   // 완료 기한 (YYYY-MM-DD)
}

// 결재 중단(PAUSE) 요청 상태
export type PauseState = 'requested' | 'confirmed' | 'cancelled' | 'resumed';

// 활성 중단 요청 정보 (서버 pause_request 필드)
export interface PauseRequestInfo {
  id: number;
  state: PauseState;
  reason: string;
  requester_loginid?: string | null;
  requester_name: string;
  round: number;
  target_step_ids: number[];   // 요청 시점의 pending 단계 id (전원 확인 대상)
  confirmed_step_ids: number[]; // '중단 확인'된 단계 id
  created_at: string;
}

// 의뢰서 철회 요청 상태 ('확정'은 문서가 삭제되므로 저장되지 않는다)
export type WithdrawState = 'requested' | 'rejected' | 'cancelled';

// 확인 대기 중인 철회 요청 정보 (서버 withdraw_request 필드)
export interface WithdrawRequestInfo {
  id: number;
  state: WithdrawState;
  reason: string;
  requester_loginid?: string | null;
  requester_name: string;
  round: number;
  target_step_ids: number[];    // 요청 시점의 pending 단계 id (전원 확인 시 의뢰서 삭제)
  confirmed_step_ids: number[]; // '철회 확인'된 단계 id
  created_at: string;
}

// ===== Domain Models =====

/** 검토 항목의 검토자 1명 (결재선 ApprovalStep 과 무관 — 결재 경로에는 표시되지 않는다) */
export interface ReviewItemReviewer {
  id: number;
  loginid: string;
  name: string;
  confirmed: boolean;
  confirmed_at: string | null;
}

/**
 * J-ayer 검토 항목. 마스터 목록의 문서별 사본이며, J 단계가 열리는 시점에 채워진다.
 * 결재가 진행 중인 동안에는 다른 문서에서의 추가·제목수정·삭제가 함께 반영된다.
 */
export interface ReviewItem {
  id: number;
  title: string;
  reviewers: ReviewItemReviewer[];
  is_done: boolean;
  created_at: string;
}

export interface RequestDocument {
  id: number;
  title: string;
  requester_name: string;
  requester_email: string;
  requester_department: string;
  product_name: string;
  reference_materials: string;
  additional_notes: string;
  status: Status;
  production_date: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  designated_pl_loginid?: string | null;
  designated_pl_name?: string;
  approval_steps?: ApprovalStepFrontend[];
  notifier_mails?: Record<string, string>; // 통보처 loginid → 이메일 (결재 경로 탭 표시용)
  // 임시저장 공유 그룹 — 작성자가 지정한 그룹 1개. 변경은 set-shared-group 액션으로만 한다(읽기 전용).
  shared_group?: number | null;
  shared_group_name?: string | null;
  // 서버가 요청자 기준으로 계산해 내려주는 권한 플래그 (읽기 전용)
  requester_loginid?: string | null;
  can_edit?: boolean;
  can_withdraw?: boolean;
  can_request_pause?: boolean; // 중단 요청 가능(작성자 본인·진행 중·기존 요청 없음)
  can_resume?: boolean;        // 재개 가능(작성자 본인·pause 상태)
  pause_request?: PauseRequestInfo | null; // 활성 중단 요청 (없으면 null)
  withdraw_request?: WithdrawRequestInfo | null; // 확인 대기 중인 철회 요청 (없으면 null)
  post_approver_fixed_loginid?: string | null; // 고정 후결자(.env) loginid — '🔒 고정' 표시/변경 잠금용
  review_items?: ReviewItem[];                 // J-ayer 검토 항목 (상세 응답)
  my_pending_review_items?: number;            // 내가 검토자인 미확인 항목 수 (목록 응답, MY 탭 조건)
}

/**
 * 반려 이력 1건 — 반려가 확정된 순간의 의뢰서를 통째로 얼려 둔 것.
 * 이력 조회 '반려' 탭의 행 하나에 대응한다. 재상신·승인으로 원본 문서가 바뀌어도,
 * 원본이 삭제돼도 이 레코드는 그대로 남는다(회차마다 1건씩 누적).
 */
export interface RejectionSnapshot {
  id: number;
  source_document_id: number;   // 원본 의뢰서 id (문서가 삭제돼도 유지)
  title: string;
  product_name: string;
  requester_name: string;
  requester_department: string;
  requester_loginid: string;
  submitted_at: string | null;
  additional_notes: string;                 // 반려 시점 상세 폼·표 전체 JSON
  approval_steps: ApprovalStepFrontend[];   // 반려 시점 결재 단계
  round: number;                            // 몇 회차에서 반려됐는지
  rejected_at: string;
  rejected_agent: string;
  rejected_by_name: string;
  rejected_by_loginid: string;
  reject_comment: string;
}

export type CreateDocumentInput = Omit<
  RequestDocument,
  'id' | 'status' | 'created_at' | 'updated_at' | 'submitted_at' | 'approval_steps'
>;

export type UpdateDocumentInput = Partial<CreateDocumentInput>;

export type VocPage = 'request' | 'approval' | 'history' | 'other';

export interface VocComment {
  id: number;
  author_name: string;
  author_role: UserRole;
  is_submitter: boolean;
  content: string;
  is_reject_reason: boolean;
  created_at: string;
}

export interface VOC {
  id: number;
  title: string;
  category: VocCategory;
  submitter_name: string;
  submitter_email: string;
  submitter_user_id?: number;
  content: string;
  page?: VocPage;
  comments: VocComment[];
  status: VocStatus;
  created_at: string;
}

export type CreateVocInput = Omit<VOC, 'id' | 'comments' | 'status' | 'created_at'>;

export type AddVocCommentInput = {
  content: string;
  is_reject_reason?: boolean;
};

export interface Stats {
  total: number;
  by_status: Record<string, number>;
}

// ===== Detail Form Types =====

export interface FlowChartRow {
  id: string;
  location: string;
  product_name: string;
  process_id: string;
  step_from: string;
  step_to: string;
}

export interface FilterSet {
  id: string;
  label: string;
  words: { sp: string[]; sd: string[]; pp: string[] };
}

export interface JayerRow {
  id: string;
  updated: string;      // 'YYYYMMDD HH:MM' 형식
  sortOrder: number;
  disabled: boolean;
  manuallyDisabled: boolean;
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
  layerid: string;      // Layer 컬럼
  st: string;           // 'O' | 'X' | ''
  new_or_copy: string;  // '신규' | '복사' | ''
  product_name: string;
  step: string;
  item_id: string;
  loaded?: boolean;     // 자동채움/병합으로 불러온 행 — 불러온 컬럼(LOADED_LOCK_COLS) 읽기전용
}

export interface OayerRow {
  id: string;
  updated: string;      // 'YYYYMMDD HH:MM' 형식
  sortOrder: number;
  disabled: boolean;
  manuallyDisabled: boolean;
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
  layerid: string;      // Layer 컬럼 (Step2와 동일)
  st: string;
  new_or_copy: string;
  product_name: string;
  step: string;
  loaded?: boolean;     // 자동채움/병합으로 불러온 행 — 불러온 컬럼(LOADED_LOCK_COLS) 읽기전용
}

export interface BbTableRow {
  id: string;
  sourceJayerRowId?: string;  // 어떤 J-ayer 행에서 왔는지 추적
  sortOrder: number;
  disabled: boolean;
  process_id: string;
  ss: string;
  sd: string;
  bb_process_id: string;
  bb_name: string;
  bb_layer: string;
  bb_ss: string;
  bb_step: string;
  remark: string;
  entryId?: string;   // 출처 bb_entry의 안정 id — 탭별 색상/매핑 식별(위치 비의존)
  entryIdx?: number;  // [레거시 호환] 구버전 저장 문서의 출처 탭 인덱스 — entryId 없을 때 색상 fallback
}

/**
 * Validation System 판정 — 'YES'(대상) | 'NO'(비대상) | 'NA'(해당없음).
 * 'NA' 는 J-layer 에 판정 키워드가 하나도 없어 판정이 성립하지 않는 상태로,
 * 이때는 E(MASK) 단계도 결재 경로에 포함되지 않는다.
 */
export type ValidationSystemValue = 'YES' | 'NO' | 'NA';

export interface DetailFormState {
  // 항상 표시
  request_purpose: string;
  line: string;
  process_selection: string;
  partid_selection: string;
  customer_name: string;
  customer_requirement: string;

  // 복사 선택 시
  other_purpose: string[];
  source_line: string;
  source_partid: string;
  change_purpose_note: string;
  flow_chart: FlowChartRow[];

  // 제품 이름 선택 시
  process_id: string;

  map_type: string;
  map_change: string;
  map_value_x: string;
  map_value_y: string;
  map_reason: string;
  /**
   * 'MAP 삭제/수정' 요청 목적 전용 이유(RichTextEditor 의 HTML 문자열).
   * map_type 이 EDIT_REQ/DELETE_REQ 일 때만 쓰이며, 둘 사이를 오가도 값은 유지되고 라벨만 바뀐다.
   * ⚠️ C가문 지도편차 사유인 map_reason 과는 별개 필드다.
   */
  map_change_reason: string;

  // Exclusive Area
  ea_change: string;
  ea_value: string;

  // Backbone
  bb_zone: string;
  bb_entries: Array<{ id: string; location: string; product: string; process_id: string }>;

  only_prodc: string;
  /**
   * C가문(only_prodc='Yes') 의 '제품 해당 위치'.
   * '' 는 미선택(게이트 — 하위 입력 전체 잠금)이고, 'only_top'/'only_bottom' 은
   * 그 리전 하나만 사용하는 스코프라 나머지 리전을 초기화·잠금·필수해제한다.
   */
  prodc_scope: '' | 'top' | 'middle' | 'bottom' | 'only_top' | 'only_bottom';
  prodc_top_line: string;
  prodc_top_process: string;
  prodc_top_product: string;
  prodc_middle_use: string;
  prodc_middle_line: string;
  prodc_middle_process: string;
  prodc_middle_product: string;
  prodc_bottom_line: string;
  prodc_bottom_process: string;
  prodc_bottom_product: string;

  map_change_top: string;
  map_value_x_top: string;
  map_value_y_top: string;
  map_change_bottom: string;
  map_value_x_bottom: string;
  map_value_y_bottom: string;

  mshot_change: string;
  mshot_image_copy: string;       // C가문 No일 때 단일 이미지
  mshot_image_copy_top: string;   // C가문 Yes일 때 북쪽 이미지
  mshot_image_copy_bottom: string; // C가문 Yes일 때 남쪽 이미지

  photo_backside: string;
  eds_backside: string;
  inter: string;
  inter_xs: string;
  inter_ys: string;
  in_apply: string;
  inter_select: string;
  tsv: string;
  rf: string;
  fullchip: string;
  split: string;
  st: string;
  ecc: string;
  labelsideshot: string;
  hpkglabelheight: string;

  rev_yn: string;
  rev_entries: Array<{ layers: string[]; gds: string }>;

  // O-ayer 정보 탭
  partial_shot: string;
  tbvtlv_thickness: string;
  // note: 과거(문자열 자유 입력) 저장분과의 하위 호환 표시용 — 신규 작성은 noteRows(X/Y 좌표 표)만 채운다.
  tbvtlv_entries: Array<{ sds: string[]; note?: string; noteRows?: TbvtlvNoteRow[] }>;

  // 통보처: 결재 권한 없이 상신·결재완료 시 메일만 받는 인원(loginid로 발송 시점에 이메일 조회)
  notifiers: NotifierRef[];

  // C가문(only_prodc=YES) 추가 후결자 — 상신 시 PL 중 지정. 고정 후결자(.env)는 별도로 항상 포함.
  post_approvers?: NotifierRef[];

  // Validation System 대상('YES')/비대상('NO'). 판정 주체는 상신자 하나이며,
  // MASK(E) 팀은 값을 바꾸지 않고 확인 후 합의만 한다.
  validation_system: ValidationSystemValue;
  // 상신·재상신 시점의 상신자 값. 이후 상신자가 결재 중에 값을 바꿔도 이 값은 유지돼
  // '상신 시 판단'과 '현재 값'의 차이를 남긴다.
  validation_system_submitted?: ValidationSystemValue;
  // 마지막으로 값을 바꾼 사람과 시각. 판정 주체가 상신자 하나뿐이라 변경 추적 지점이 필요하다.
  validation_system_changed_by?: string;
  validation_system_changed_at?: string;

  // 참조 요청서 Merge 를 완료한 문서. 참조는 의뢰서당 1건만 지정할 수 있어 값이 있으면
  // 선택·Merge 버튼을 잠그고, '재선택' 버튼으로만 해제한다(임시저장 후 재진입해도 유지).
  merge_ref_doc_id: number | null;
  merge_ref_doc_label: string;   // 잠긴 입력에 표시할 문서 제목

  // 참조 요청서 Merge 의 변경전/변경후 비교 결과. 확정된 짝과 아직 짝이 없는 행을 나눠 저장해
  // 임시저장 후 재진입에도 화면이 그대로 복원된다(상세 페이지 표시에도 merge_pairs 를 쓴다).
  merge_pairs: MergePair[];
  merge_unmatched_before: MergeUnmatchedRow[];
  merge_unmatched_after: MergeUnmatchedRow[];

  // '기타 목적 > ADI CD 변경' — 변경전/변경후 스텝 표. AFTER는 전체 삭제 요청 시 delete_all=true, 표는 비운다.
  adi_cd_before: AdiCdStep[];
  adi_cd_after: AdiCdStep[];
  adi_cd_delete_all: boolean;
}

/** ADI CD 변경 스텝 표 1행 — STEP_ID/STEP_DESC 2컬럼 고정. */
export interface AdiCdStep {
  id: string;
  step_id: string;
  step_desc: string;
}

// ===== 참조 요청서 Merge — BEFORE/AFTER 비교 =====

/** 비교 표에 싣는 행 정보. 이 5개 항목만 보여주고 저장한다. */
export interface MergeRowInfo {
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
  layerid: string;
}

/** 아직 짝이 없어 BEFORE/AFTER 표에 남아 있는 행. id 는 `J_`/`O_` 접두사로 표를 구분한다. */
export interface MergeUnmatchedRow extends MergeRowInfo {
  id: string;
  table: MergeTable;
}

/** J-ayer 끼리, O-ayer 끼리만 비교·매핑한다. */
export type MergeTable = 'J' | 'O';

/**
 * 확정된 변경전/변경후 한 쌍.
 * before 가 null 이면 '미등록'(참조에 없던 항목이 새로 생김 = added),
 * after 가 null 이면 '미등록'(참조에 있던 항목이 사라짐 = deleted).
 * beforeId/afterId 는 매핑 해제 시 원래 표로 되돌리기 위한 출처 행 id 다.
 */
export interface MergePair {
  table: MergeTable;
  beforeId: string | null;
  before: MergeRowInfo | null;
  afterId: string | null;
  after: MergeRowInfo | null;
  kind: 'changed' | 'added' | 'deleted';
}

/**
 * '재선택' 롤백용 스냅샷 — Merge 로 3-way 재판정을 반영하기 **직전**의 J/O 표.
 * additional_notes 최상위(detail 형제)에 저장해 임시저장·재진입 후에도 롤백할 수 있다.
 */
export interface MergeSnapshot {
  jayerRows: JayerRow[];
  oayerRows: OayerRow[];
  refDocId: number | null;
  savedAt: string;   // ISO 8601
}

// 통보자 참조: 화면 표시용 이름 + 메일 발송용 loginid
export interface NotifierRef {
  loginid: string;
  name: string;
}

// TBV/TLV 비고 — X/Y 좌표 표 1행 (사용 여부는 단순 표시용, 검증에 영향 없음)
export interface TbvtlvNoteRow {
  id: string;
  x: string;
  y: string;
  used: 'O' | 'X';
}

// 주소록 구성원(조회 응답): 최신 이름·이메일 + 이메일 등록 여부(무이메일 경고용)
export interface AddressBookMember {
  loginid: string;
  name: string;
  mail: string;
  has_mail: boolean;
}

// 주소록: 통보처로 자주 쓰는 사람 묶음(본인 전용)
export interface AddressBook {
  id: number;
  name: string;
  members: AddressBookMember[];
  member_count: number;
  created_at: string;
  updated_at: string;
}

// ===== Change History =====

export interface HistorySnapshot {
  timestamp: string;   // ISO 8601, 재상신 직전 시각
  detail: DetailFormState;
  jayerRows: JayerRow[];
  oayerRows: OayerRow[];
  bbRows: BbTableRow[];
}

// ===== API Response Wrappers =====
// Pages consume responses as r.data or r.data.results

export interface ApiResponse<T> {
  data: T;
}

export interface ApiListResponse<T> {
  data: { results: T[]; count: number } | T[];
}

// ===== Admin Notice =====

export type NoticeTemplate = 'notice' | 'release_note';
export type ReleaseCategory = 'new' | 'updated' | 'bugfix';

export interface ReleaseItem {
  category: ReleaseCategory;
  content: string;
}

export interface AdminNotice {
  id: number;
  template: NoticeTemplate;
  date: string;          // 'YYYY-MM-DD'
  title: string;
  content: string;       // Notice 타입 전용
  items: ReleaseItem[];  // Release Note 타입 전용
  created_at: string;
  updated_at: string;
}

export type CreateNoticeInput = Omit<AdminNotice, 'id' | 'created_at' | 'updated_at'>;
export type UpdateNoticeInput = Partial<CreateNoticeInput>;

// ===== User Management =====

export interface UserWithRole {
  id: number;
  loginid: string;
  name: string;
  deptname: string;
  role: UserRole;
  mail: string;
  role_assigned_at?: string | null;
  /** 메일을 수신할 라인 이름 목록(권한 관리 '이메일 설정'). 빈 배열이면 해당 메일을 받지 않는다. */
  mail_lines?: string[];
}

/** PATCH /users/{id}/mail-lines/ 응답 */
export interface MailLinesResponse {
  id: number;
  mail_lines: string[];
}

export interface CreateUserInput {
  loginid: string;
  role: UserRole;
}

export interface AssignRoleInput {
  userId: number;
  role: UserRole;
}

// ===== User Groups =====

export interface UserGroupMember {
  id: number;
  loginid: string;
  name: string;
  mail: string;
  deptname: string;
  role: UserRole;
}

export interface UserGroup {
  id: number;
  name: string;
  creator_loginid: string;
  members: UserGroupMember[];
  created_at: string;
}

export interface AvailableGroupMember {
  id: number;
  loginid: string;
  name: string;
  mail: string;
  deptname: string;
}

export interface UserForAssignment {
  id: number;
  username: string;       // DB loginid
  display_name: string;   // DB username (표시 이름)
  department: string;     // DB deptname
  email: string;          // DB mail
  current_role?: UserRole; // MASTER 조회 시에만 포함
}


export interface StepInfo {
  line: string;
  process: string;
  processid: string;
  stepseq: string;
  descript: string;
  recipeid: string;
  layerid: string;  
  updated: string;  // 'YYYYMMDDHHMMSS' 형식
}

// ===== Guide =====

export type GuideType = 'feature' | 'info';

// 기능 가이드의 feature_key 목록 (Step별 고정)
export type GuideFeatureKey =
  | 'step1_line_process' | 'step1_request_purpose' | 'step1_other_purpose'
  | 'step1_flow_chart' | 'step1_bb_entry' | 'step1_customer_vendor'
  | 'step2_map_type' | 'step2_source_location' | 'step2_map_deviation'
  | 'step2_exception_zone' | 'step2_cfamily' | 'step2_rev'
  | 'step2_xmark' | 'step2_map_options'
  | 'step3_jayer_table' | 'step3_jayer_filter'
  | 'step4_oayer_table' | 'step4_partial_shot' | 'step4_tbvtlv'
  | 'step5_bb_autofill' | 'step5_bb_mapping' | 'step5_bb_table'
  | 'permission_user_group';

export interface Guide {
  id: number;
  guide_type: GuideType;
  feature_key: GuideFeatureKey | null;
  title: string;
  content: string;
  author_name: string;
  author_role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface CreateGuideInput {
  guide_type: GuideType;
  feature_key?: GuideFeatureKey | null;
  title: string;
  content: string;
}

// Step별 기능 목록 상수
export const GUIDE_STEP_FEATURES: Record<number, { key: GuideFeatureKey; labelKey: string }[]> = {
  1: [
    { key: 'step1_line_process',    labelKey: 'guide.feat.step1_line_process' },
    { key: 'step1_request_purpose', labelKey: 'guide.feat.step1_request_purpose' },
    { key: 'step1_other_purpose',   labelKey: 'guide.feat.step1_other_purpose' },
    { key: 'step1_flow_chart',      labelKey: 'guide.feat.step1_flow_chart' },
    { key: 'step1_bb_entry',        labelKey: 'guide.feat.step1_bb_entry' },
    { key: 'step1_customer_vendor', labelKey: 'guide.feat.step1_customer_vendor' },
  ],
  2: [
    { key: 'step2_map_type',        labelKey: 'guide.feat.step2_map_type' },
    { key: 'step2_source_location', labelKey: 'guide.feat.step2_source_location' },
    { key: 'step2_map_deviation',   labelKey: 'guide.feat.step2_map_deviation' },
    { key: 'step2_exception_zone',  labelKey: 'guide.feat.step2_exception_zone' },
    { key: 'step2_cfamily',         labelKey: 'guide.feat.step2_cfamily' },
    { key: 'step2_rev',             labelKey: 'guide.feat.step2_rev' },
    { key: 'step2_xmark',           labelKey: 'guide.feat.step2_xmark' },
    { key: 'step2_map_options',     labelKey: 'guide.feat.step2_map_options' },
  ],
  3: [
    { key: 'step3_jayer_table',  labelKey: 'guide.feat.step3_jayer_table' },
    { key: 'step3_jayer_filter', labelKey: 'guide.feat.step3_jayer_filter' },
  ],
  4: [
    { key: 'step4_oayer_table',   labelKey: 'guide.feat.step4_oayer_table' },
    { key: 'step4_partial_shot',  labelKey: 'guide.feat.step4_partial_shot' },
    { key: 'step4_tbvtlv',        labelKey: 'guide.feat.step4_tbvtlv' },
  ],
  5: [
    { key: 'step5_bb_autofill', labelKey: 'guide.feat.step5_bb_autofill' },
    { key: 'step5_bb_mapping',  labelKey: 'guide.feat.step5_bb_mapping' },
    { key: 'step5_bb_table',    labelKey: 'guide.feat.step5_bb_table' },
  ],
  // 권한 관리 (의뢰서 Step 이 아닌 별도 페이지)
  6: [
    { key: 'permission_user_group', labelKey: 'guide.feat.permission_user_group' },
  ],
};

export interface ExternalBbDataItem {
  id: string;
  bb_process_id: string;
  bb_name: string;
  bb_step: string;
  bb_ss: string;
  layerid?: string;
  location?: string;  // 라인(bb_entries.location) — bb_name을 [라인] 제품 형식으로 채우기 위함
  entryId?: string;   // 출처 bb_entry의 안정 id — 매핑 시 bb 행에 그대로 복사
}


export interface PhotoStepOption {
  processid: string;
  stepseq: string;
  descript: string;
  layerid: string;  
}


export interface BbAutoFillRange {
  id: string;
  layerFrom: string;      // 시작 Layer
  layerTo: string;        // 종료 Layer
  entryId: string;        // 선택된 bb_entry의 안정 id — 라인+제품을 유일하게 식별
}


// ===== 연간 디자인룰 통계 (홈 화면 그래프) =====

/** 막대 종류 — 'etc'는 상위 N 밖 묶음, 'unclassified'는 디자인룰 판정 실패 묶음. */
export type DesignRuleBucketKind = 'rule' | 'etc' | 'unclassified';

/** 비교 연도 대비 증감 상태. 'new'는 비교 연도 0건이라 %를 낼 수 없는 경우. */
export type DesignRuleDeltaState = 'up' | 'down' | 'flat' | 'new';

/** 요청 목적별 건수. 키는 백엔드 REQUEST_PURPOSES 값. */
export type PurposeBreakdown = Record<string, number>;

export interface DesignRuleBucket {
  /** 서버 저장·매칭에 쓰이는 원본 값. etc/unclassified는 고정 sentinel 키. */
  key: string;
  /** kind==='rule'일 때만 "N나노" 형태의 표시용 라벨. etc/unclassified는 빈 문자열이며 프론트가 i18n 라벨을 붙인다. */
  label: string;
  kind: DesignRuleBucketKind;
  /** 'etc'가 묶은 디자인룰 개수. rule은 1, unclassified는 0. */
  member_count: number;
  count: number;
  compare_count: number | null;
  delta_pct: number | null;
  delta_state: DesignRuleDeltaState | null;
  purposes: PurposeBreakdown;
  compare_purposes: PurposeBreakdown | null;
}

export interface AnnualDesignRuleStats {
  /** 승인 의뢰서가 하나도 없으면 null. */
  year: number | null;
  compare_year: number | null;
  /** null이면 '전체'(기타 묶음 없음). */
  top: number | null;
  available_years: number[];
  /** 요청 목적 표시 순서. */
  purposes: string[];
  buckets: DesignRuleBucket[];
  total: number;
  compare_total: number | null;
}

/** 미분류 사유 — 프론트가 안내 문구를 고르는 데 쓴다.
 * non_numeric: 조합법/의뢰서에 디자인룰이 매칭됐지만 값이 숫자가 아니라 나노 표시를 만들 수 없음. */
export type UnclassifiedReason = 'missing' | 'ambiguous' | 'empty' | 'non_numeric';

export interface UnclassifiedProcess {
  process: string;
  count: number;
  reason: Exclude<UnclassifiedReason, 'empty'>;
  /** reason==='ambiguous'일 때 마스터에 실제로 걸려 있는 후보 디자인룰. */
  candidates: string[];
}

export interface UnclassifiedDocument {
  id: number;
  title: string;
  process_selection: string;
  submitted_at: string;
  reason: UnclassifiedReason;
  /** reason==='ambiguous'일 때 마스터에 실제로 걸려 있는 후보 디자인룰. 그 외엔 빈 배열. */
  candidates: string[];
}

/** 분류 모달 select 후보 — value는 저장용 원본 값, label은 "N나노" 표시용. */
export interface DesignRuleOption {
  value: string;
  label: string;
}

export interface UnclassifiedTargets {
  processes: UnclassifiedProcess[];
  documents: UnclassifiedDocument[];
  design_rules: DesignRuleOption[];
}

/** 조합법 단위 디자인룰 수동 매핑 — "재분류" 탭에서 이미 분류된 것을 다시 고칠 때 쓴다. */
export interface ProcessDesignRuleOverride {
  id: number;
  process: string;
  design_rule: string;
  /** "N나노" 표시용. 숫자가 아니면 원본 값 그대로. */
  design_rule_label: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

/** 의뢰서 단위 디자인룰 수동 매핑 — "재분류" 탭에서 이미 분류된 것을 다시 고칠 때 쓴다. */
export interface DocumentDesignRuleOverride {
  id: number;
  document: number;
  document_title: string;
  design_rule: string;
  /** "N나노" 표시용. 숫자가 아니면 원본 값 그대로. */
  design_rule_label: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}
