import { FlowChartRow, LayerStepOption, JayerRow, OayerRow, ValidationSystemValue, MergePair, MergePairKind, MergeRowInfo, MergeTable, MergeUnmatchedRow, AdiCdStep, ColorFilterSet } from '../../types';
import {
  VALIDATION_KEYWORD, NOC_NEW, NOC_BORROW, NOC_REGISTERED, NOC_LAYER_DELETE, NOC_NOT_PROCEEDING, ST_O, ST_X, isStO, isRowInactive, isNocSpecial, genId, VS_NA, VS_TARGET,
  ADI_CD_HEADER_SCAN_ROWS, ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL, makeAdiCdStep,
  MERGE_MANUAL_FIELDS, MERGE_DEFAULT_TABLE, MERGE_PP_PREFIXES, INTER_AUTO_YES_PROCESS_PREFIXES,
  MERGE_ENABLED_PURPOSES, OTHER_PURPOSE_OVERLAY, OTHER_PURPOSE_LAYER, OTHER_PURPOSE_STEPSEQ, STEPSEQ_LEAD_DIGITS,
  ERROR_KEY_STEPS, ERROR_KEY_DEFAULT_STEP, ITEM_ID_OPTIONAL_PP_KEYWORDS,
} from './constants';

// ===== 순수 헬퍼 (인자만 사용 — state 비의존) =====

/** YYYYMMDDhhmm... → "YYYYMMDD hh:mm" 표기 */
export const formatUpdatedDate = (updated: string): string => {
  if (!updated || updated.length < 12) return updated;
  const yyyyMMdd = updated.slice(0, 8);
  const hh = updated.slice(8, 10);
  const mm = updated.slice(10, 12);
  return `${yyyyMMdd} ${hh}:${mm}`;
};

/** 키워드 배열 기반 행 비활성화 판정 */
export const shouldDisableRow = (
  filterWords: { sp: string[]; sd: string[]; pp: string[] },
  row: { sp: string; sd: string; pp: string }
): boolean => {
  const { sp, sd, pp } = filterWords;
  if (sp.some(keyword => keyword && row.sp.toLowerCase().includes(keyword.toLowerCase()))) return true;
  if (sd.some(keyword => keyword && row.sd.toLowerCase().includes(keyword.toLowerCase()))) return true;
  if (pp.some(keyword => keyword && row.pp.toLowerCase().includes(keyword.toLowerCase()))) return true;
  return false;
};

// claude 수정 (2026-10-15): 조합법이 3번(inter) 자동 YES 기준 단어로 시작하는지 판정하는 함수 추가
/**
 * 조합법(process_selection)이 기준 단어 중 하나로 시작하는가 — 대소문자 무시, 앞뒤 공백 무시.
 * 빈 기준 단어는 무시한다(빈 문자열은 모든 값의 접두어라 전부 YES 가 되는 것을 막는다).
 */
export const isInterAutoYesProcess = (
  processSelection: string,
  prefixes: readonly string[] = INTER_AUTO_YES_PROCESS_PREFIXES,
): boolean => {
  const value = (processSelection || '').trim().toLowerCase();
  if (!value) return false;
  return prefixes.some((p) => {
    const prefix = p.trim().toLowerCase();
    return prefix !== '' && value.startsWith(prefix);
  });
};

/** 필터 키워드 초안 빈 값 */
export const emptyDraftWords = () => ({ sp: [] as string[], sd: [] as string[], pp: [] as string[] });

/**
 * {{request.partid_selection}}("-" 로 구분된 전체 제품 이름)에서 MAP 조회에 쓰는 8자리 코드를 뽑는다.
 * "-" 앞부분을 대문자화·8자 제한한다 — MapName.partid 코드(`_` 앞 8자, form_options_mapname 참조)와
 * 같은 규칙으로 맞춰야 매칭이 된다.
 */
export const sourceCodeFromPartid = (partidSelection: string): string =>
  (partidSelection.split('-')[0] || '').trim().toUpperCase().slice(0, 8);

/**
 * 의뢰서 제목의 Step 구간 — 흐름도 행 중 문서의 라인/제품 이름/조리법과 같은 행(상세 보기에서 굵은 검정으로
 * 보이는 행)의 Step 을 `[10~20][90~100]` 처럼 행 순서대로 이어 붙인다. 시작·끝 중 한쪽만 있으면 그 값만 쓰고
 * (`[10]`), 둘 다 비면 그 행은 건너뛴다. 일치 행이 없으면 빈 문자열 — 호출부가 TITLE_DEFAULT_LABEL 로 대체한다.
 * 일치 판정은 PagedDetailView 의 흐름도 색 강조(flowComboKey)와 같은 규칙(세 값 완전 일치)이다.
 */
export const buildFlowStepTitlePart = (
  flowChart: FlowChartRow[],
  line: string,
  partidSelection: string,
  processId: string,
): string =>
  flowChart
    .filter((r) => r.location === line && r.product_name === partidSelection && r.process_id === processId)
    .map((r) => (r.step_from && r.step_to ? `${r.step_from}~${r.step_to}` : (r.step_from || r.step_to || '')))
    .filter((step) => step !== '')
    .map((step) => `[${step}]`)
    .join('');

// claude 수정 (2026-10-15): 흐름도 Step 을 stepseq 순서대로 작성하도록 검증하는 순수 함수들.

/** Step(layerid) 입력값에 대응하는 stepseq 를 목록에서 찾은 결과 */
export type FlowStepSeqResolution =
  | { kind: 'skip'; seq: string }   // 값이 비었거나 목록 자체가 없음(직접 입력 인정) → 저장된 seq 를 그대로 쓴다
  | { kind: 'ok'; seq: string }
  | { kind: 'not_in_list' }
  | { kind: 'ambiguous' };          // 같은 layerid 가 여러 stepseq 에 있어 어느 것인지 정할 수 없음

/**
 * 저장된 seq 가 목록의 (layerid, stepseq) 와 맞으면 그대로, 아니면 layerid 가 목록에 한 번만 있을 때 그 stepseq 로 정한다.
 */
export const resolveFlowStepSeq = (
  layerid: string,
  storedSeq: string | undefined,
  opts: readonly LayerStepOption[],
): FlowStepSeqResolution => {
  const value = (layerid || '').trim();
  if (!value || opts.length === 0) return { kind: 'skip', seq: storedSeq || '' };
  const matches = opts.filter((o) => o.layerid === value);
  if (matches.length === 0) return { kind: 'not_in_list' };
  if (storedSeq && matches.some((o) => o.stepseq === storedSeq)) return { kind: 'ok', seq: storedSeq };
  if (matches.length === 1) return { kind: 'ok', seq: matches[0].stepseq };
  return { kind: 'ambiguous' };
};

// claude 수정 (2026-10-19): 알파벳 접미 stepseq(AAAA1234A) 인식 + 숫자 자릿수가 서로 달라도(AAAA1235 vs AAAA12345) 앞 4자리 → 나머지 자리 순으로 비교하도록 num 을 '앞4자리.나머지' 소수로 계산.
/**
 * stepseq 를 '접두어 + 숫자 + 알파벳 접미(선택)'로 나눈다(AAAA1234 → AAAA / 1234, AAAA1234A → AAAA / 1234).
 * num 은 숫자의 앞 4자리를 정수부, 5번째 자리부터를 소수부로 둔 값이다(AAAA12345 → 1234.5, AAAA1235 → 1235)
 * — 앞 4자리를 먼저 비교하고 같으면 나머지 자리로 비교한다. 백엔드 Step 목록 정렬(views.py _stepseq_sort_key)과 같은 규칙.
 * 접미는 순서 비교에 쓰지 않으므로 버린다. 숫자가 없거나 접미에 알파벳 외 문자가 있으면 비교 불가(null).
 */
export const splitStepseq = (seq: string | undefined): { prefix: string; num: number } | null => {
  const m = /^(.*?)(\d+)[A-Za-z]*$/.exec((seq || '').trim());
  if (!m) return null;
  const digits = m[2];
  return { prefix: m[1], num: parseFloat(`${digits.slice(0, STEPSEQ_LEAD_DIGITS)}.${digits.slice(STEPSEQ_LEAD_DIGITS) || '0'}`) };
};

export interface FlowStepSeqRow {
  id: string;
  fromSeq: string;
  toSeq: string;
}

export interface FlowStepOrderError {
  rowId: string;
  field: 'step_from' | 'step_to';
  kind: 'prefix_mismatch' | 'reversed' | 'overlap';
  /** overlap 일 때 겹친 위쪽 행 번호(1부터)와 그 행의 stepseq 구간 */
  refRowNo?: number;
  refRange?: string;
}

/**
 * 흐름도 행(화면 순서)의 stepseq 구간 검증.
 *  - 한 행: 시작·끝 접두어가 같고 시작 ≤ 끝.
 *  - 행 사이: 접두어가 같은 위쪽 행이 있으면 아래 행 시작은 그 행 끝보다 반드시 커야 한다(같은 번호도 불가).
 *    접두어가 다르면 비교하지 않는다. stepseq 가 없는(비교 불가) 칸은 건너뛴다.
 */
export const findFlowStepOrderErrors = (rows: readonly FlowStepSeqRow[]): FlowStepOrderError[] => {
  const errors: FlowStepOrderError[] = [];
  const ranges: ({ prefix: string; start: number; end: number; label: string } | null)[] = [];
  rows.forEach((r) => {
    const from = splitStepseq(r.fromSeq);
    const to = splitStepseq(r.toSeq);
    let range: { prefix: string; start: number; end: number; label: string } | null = null;
    if (from && to) {
      if (from.prefix !== to.prefix) {
        errors.push({ rowId: r.id, field: 'step_to', kind: 'prefix_mismatch' });
      } else if (from.num > to.num) {
        errors.push({ rowId: r.id, field: 'step_to', kind: 'reversed' });
      } else {
        range = { prefix: from.prefix, start: from.num, end: to.num, label: `${r.fromSeq}~${r.toSeq}` };
      }
    } else if (from || to) {
      const only = (from || to) as { prefix: string; num: number };
      range = { prefix: only.prefix, start: only.num, end: only.num, label: from ? r.fromSeq : r.toSeq };
    }
    if (range) {
      const cur = range;
      const refIdx = ranges.findIndex((x) => !!x && x.prefix === cur.prefix && cur.start <= x.end);
      if (refIdx >= 0) {
        errors.push({
          rowId: r.id,
          field: from ? 'step_from' : 'step_to',
          kind: 'overlap',
          refRowNo: refIdx + 1,
          refRange: (ranges[refIdx] as { label: string }).label,
        });
      }
    }
    ranges.push(range);
  });
  return errors;
};

// claude 수정 (2026-10-21): 결재 상세 흐름도 표·이력 확인 창·상세 내보내기에서 stepseq 를 빼고 Layer ID 만 표기한다(상세 표가 복잡해 보여서).
/** 'L01 ~ L03' — stepseq 는 표기하지 않는다. 한쪽만 있으면 그 칸만, 둘 다 없으면 빈 문자열. */
export const formatFlowStepText = (row: Pick<FlowChartRow, 'step_from' | 'step_to'>): string => {
  const from = row.step_from || '';
  const to = row.step_to || '';
  return from && to ? `${from} ~ ${to}` : (from || to);
};

/** 숫자 전용 입력 필터: 부호(-, 맨 앞 1개만)·소수점(1개만) 외 문자는 제거 (MAP X/Y, 예외구역 값 등) */
export const sanitizeSignedDecimal = (raw: string): string => {
  let v = raw.replace(/[^0-9.\-]/g, '');
  const neg = v.startsWith('-');
  v = v.replace(/-/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
  }
  return (neg ? '-' : '') + v;
};

// claude 수정 (2026-10-15): STEP2 X/Y·예외 구역 값에 '.'/'-' 처럼 숫자로 읽히지 않는 값이 통과하던 문제 — 숫자 판정 함수 추가
/**
 * 입력값이 숫자로 읽히는가 — 앞뒤 공백 제거 후 Number() 결과가 유한하면 참.
 * sanitizeSignedDecimal 은 글자만 걸러 '.'·'-'·'-.' 같은 값을 남기므로, 검증 단계에서 이 함수로 막는다.
 * 통과: '1.5' '-0.8' '0' '.5' '1.' / 막힘: '' '.' '-' '-.'
 */
export const isNumericValue = (value: string | null | undefined): boolean => {
  const v = (value ?? '').trim();
  return v !== '' && Number.isFinite(Number(v));
};

/**
 * Backbone 조합 영역(STEP1) 입력이 **필수**인가.
 * J-layer 활성 행에 st 가 'O 계열'인 행이 하나라도 있으면 그 요청서는 BB 조합이 반드시 필요하다.
 * (O-layer 는 판정 근거가 아니다 — J-layer 표 하나만 본다.)
 */
export const requiresBbEntries = (
  jayerRows: { st: string }[]
): boolean => jayerRows.some((r) => isStO(r.st));

/** Backbone 조합 영역 한 항목의 입력 상태 — 세 칸(위치·제품·조리법) 기준. */
const bbEntryFillState = (
  e: { location: string; product: string; process_id: string }
): 'empty' | 'partial' | 'full' => {
  const filled = [e.location, e.product, e.process_id].filter((v) => !!v?.trim()).length;
  if (filled === 0) return 'empty';
  return filled === 3 ? 'full' : 'partial';
};

/**
 * Backbone 조합 영역에서 진행을 막아야 하는 항목 id 목록.
 *  · required=true  : 완전히 채워지지 않은 모든 항목(빈 항목 포함) — 불필요한 항목은 삭제하도록 유도.
 *  · required=false : 일부만 채운 항목만. 빈 항목은 그대로 두어도 된다.
 */
export const findBbEntryViolations = (
  entries: { id: string; location: string; product: string; process_id: string }[],
  required: boolean
): string[] =>
  entries
    .filter((e) => {
      const state = bbEntryFillState(e);
      return required ? state !== 'full' : state === 'partial';
    })
    .map((e) => e.id);

/** st 또는 new_or_copy 가 공란인 행 id 목록 (J/O-ayer 공용). st==='X' 행도 new_or_copy 는 필수다. */
export const findEmptyStNocViolations = (
  rows: { id: string; st: string; new_or_copy: string }[]
): string[] =>
  rows
    .filter((r) => !r.st?.trim() || !r.new_or_copy?.trim())
    .map((r) => r.id);

// claude 수정 (2026-10-20): ST 와 요청 기준(new_or_copy)의 짝 규칙 — ST 가 O 계열('O'·'O (D)')이면 신규/차용,
// X 이면 기등록/layer삭제/미진행만 쓸 수 있다. ST 를 아직 고르지 않았으면 5개 모두 고를 수 있다
// (기등록/layer삭제/미진행을 고르면 기존대로 ST 가 'X' 가 된다).
const NOC_OPTIONS_ST_O = [NOC_NEW, NOC_BORROW];
const NOC_OPTIONS_ST_X = [NOC_REGISTERED, NOC_LAYER_DELETE, NOC_NOT_PROCEEDING];
const NOC_OPTIONS_ALL = [...NOC_OPTIONS_ST_O, ...NOC_OPTIONS_ST_X];

/** 이 ST 에서 고를 수 있는 요청 기준 목록 (J/O-ayer 공용) */
export const nocOptionsForSt = (st?: string): string[] => {
  if (isStO(st)) return NOC_OPTIONS_ST_O;
  if (isRowInactive(st)) return NOC_OPTIONS_ST_X;
  return NOC_OPTIONS_ALL;
};

/**
 * ST 와 요청 기준이 맞지 않는 행 id 목록 (J/O-ayer 공용) — 예: ST 'X' 인데 '신규', ST 'O' 인데 '미진행'.
 * 타이핑·붙여넣기·예전 문서로 들어온 값을 잡는다. ST·요청 기준 중 하나라도 비어 있는 행은
 * findEmptyStNocViolations 가 잡으므로 여기서는 뺀다. 목록에 없는 값(오타 등)은 이 검사 대상이 아니다.
 */
export const findStNocMismatchViolations = (
  rows: { id: string; st: string; new_or_copy: string }[]
): string[] =>
  rows
    .filter((r) => {
      const noc = (r.new_or_copy ?? '').trim();
      if (!r.st?.trim() || !NOC_OPTIONS_ALL.includes(noc)) return false;
      return !nocOptionsForSt(r.st).includes(noc);
    })
    .map((r) => r.id);

/** new_or_copy='차용' 활성 행 중 product_name·step 공란인 행 id 목록 (J/O-ayer 공용) */
export const findNocBorrowViolations = (
  rows: { id: string; st: string; new_or_copy: string; product_name: string; step: string }[]
): string[] =>
  rows
    .filter((r) => !isRowInactive(r.st) && r.new_or_copy === '차용' && (!r.product_name?.trim() || !r.step?.trim()))
    .map((r) => r.id);

// claude 수정 (2026-10-22): pp 에 ID 선택 입력 문구가 든 행은 ID 바코드가 없을 수도 있어 item_id 필수에서 제외.
/** pp 에 ID 선택 입력 문구(ITEM_ID_OPTIONAL_PP_KEYWORDS)가 포함되는가 — 대소문자 무관·부분 일치 */
export const isItemIdOptionalPp = (pp: string | undefined): boolean => {
  const v = (pp ?? '').toLowerCase();
  return !!v && ITEM_ID_OPTIONAL_PP_KEYWORDS.some((k) => !!k && v.includes(k.toLowerCase()));
};

/** new_or_copy='차용' 활성 행 중 item_id 공란인 행 id 목록 (item_id 는 J-ayer 전용 필드라 O-ayer 는 대상 아님).
 *  pp 에 ITEM_ID_OPTIONAL_PP_KEYWORDS 문구가 든 행은 제외한다(product_name·step 필수는 findNocBorrowViolations 가 그대로 검사). */
export const findNocBorrowItemIdViolations = (
  rows: { id: string; st: string; new_or_copy: string; item_id: string; pp: string }[]
): string[] =>
  rows
    .filter((r) => !isRowInactive(r.st) && r.new_or_copy === '차용' && !r.item_id?.trim() && !isItemIdOptionalPp(r.pp))
    .map((r) => r.id);

/**
 * claude 수정 (2026-10-20): O-ayer 표('table' 탭)에 표시되는 오류가 있는가 — ST/요청 기준 미입력·불일치, 차용 필수칸.
 * validate(4)·validate(5) 가 O-ayer 표에 거는 검사와 같은 판정이어야 한다(어긋나면 오류가 없는 탭으로 전환된다).
 */
export const hasOayerTableErrors = (
  rows: { id: string; st: string; new_or_copy: string; product_name: string; step: string }[]
): boolean =>
  findEmptyStNocViolations(rows).length > 0
  || findStNocMismatchViolations(rows).length > 0
  || findNocBorrowViolations(rows).length > 0;

/** claude 수정 (2026-10-20): 검증 오류 키의 입력칸이 있는 단계 (ERROR_KEY_STEPS 를 위에서부터 맞춰 본다) */
export const errorKeyStep = (key: string): number => {
  const rule = ERROR_KEY_STEPS.find((r) => r.keys.includes(key) || r.prefixes.some((p) => key.startsWith(p)));
  return rule ? rule.step : ERROR_KEY_DEFAULT_STEP;
};

/**
 * claude 수정 (2026-10-20): 검증에 막혔을 때 보낼 단계. 현재 단계에 고칠 오류가 하나라도 있으면 그대로 머문다(undefined).
 * 없으면 오류가 있는 단계 중 가장 앞 단계 — 입력칸이 화면에 없으면 그 칸으로 이동해 표시할 수 없기 때문이다.
 */
export const errorRedirectStep = (errorKeys: string[], currentStep: number): number | undefined => {
  const steps = errorKeys.map(errorKeyStep);
  if (steps.length === 0 || steps.includes(currentStep)) return undefined;
  return Math.min(...steps);
};

/** item_id 바코드 후보 라벨 끝의 " [날짜]"를 제거한다 (form_options_barcode 가 붙이는 형식과 짝을 맞춤). */
export const stripDateBracket = (label: string): string => label.replace(/\s*\[[^\]]*\]\s*$/, '');

/**
 * item_id 다중 선택 결과를 저장용 문자열로 합친다.
 * 1개만 선택됐으면 원래 라벨(날짜 포함) 그대로, 2개 이상이면 "옵션(바코드 후보)에서 고른 라벨"의
 * "[날짜]"만 지워 값이 선택 개수만큼 길어지지 않게 한다. 직접 타이핑한 텍스트(isFromOptions=false)는
 * 후보 목록에 없어 날짜 유무를 판단할 근거가 없고 자유 입력의 자유도를 지켜야 하므로 건드리지 않는다.
 */
export const formatMultiItemId = (labels: string[], isFromOptions: boolean[] = []): string =>
  labels.length <= 1
    ? labels.join(', ')
    : labels.map((label, i) => (isFromOptions[i] ? stripDateBracket(label) : label)).join(', ');

/**
 * Jayer/Oayer "요청 기준"(new_or_copy) 값을 근거로 이 요청서에 맞는 요청 목적을 계산한다.
 * 비활성 행은 제외한다. 신규 → '신규' / 차용 → '차용' / 둘 다 → '신규+차용' /
 * 기등록·layer삭제·미진행만 있으면 → '기타'. 판정할 활성 행이 아예 없으면 null(판정 불가).
 */
export const computeExpectedRequestPurpose = (
  jayerRows: { new_or_copy: string }[],
  oayerRows: { new_or_copy: string }[]
): string | null => {
  // 구 disabled(수동/필터 비활성) 개념은 폐지됐다 — st==='X' 행(기등록/layer삭제/미진행 포함)도
  // new_or_copy 로 '기타' 판정에 그대로 기여해야 하므로 여기서는 아무것도 걸러내지 않는다.
  const activeNoc = [...jayerRows, ...oayerRows].map((r) => r.new_or_copy);
  const hasNew = activeNoc.includes(NOC_NEW);
  const hasBorrow = activeNoc.includes(NOC_BORROW);
  if (hasNew && hasBorrow) return '신규+차용';
  if (hasNew) return NOC_NEW;
  if (hasBorrow) return NOC_BORROW;
  if (activeNoc.includes(NOC_REGISTERED) || activeNoc.includes(NOC_LAYER_DELETE) || activeNoc.includes(NOC_NOT_PROCEEDING)) return '기타';
  return null;
};

// ===== J↔O layerid 교차 동기화 (st/new_or_copy) =====

/** 동기화 판정용 최소 행 형태 */
export interface LayerSyncRow {
  id: string;
  layerid: string;
  st: string;
  new_or_copy: string;
}

/** 동기화 "참여행" — 비활성(st==='X')도 기등록/layer삭제/미진행도 아닌 행. */
const isSyncParticipant = (r: LayerSyncRow): boolean => !isRowInactive(r.st) && !isNocSpecial(r.new_or_copy);

/**
 * 같은 layerid를 가진 J(또는 O) 참여행 전원이 이번 조작 후 `field` 값에 합의하는지 판정한다.
 * 한 layerid에 참여행이 여러 개 있을 수 있고, 서로 다른 값을 가질 수 있다 — 이 경우 합의가 없으므로
 * 교차 테이블로 전파하지 않는다(undefined 반환).
 *
 * - `preOpRows`: 이번 조작 **전** 상태 — "참여행이었는가"의 판정 기준(조작으로 st==='X'가 된 행도
 *   조작 전에는 참여행이었다면 포함시켜야 그 전환 자체가 전파될 수 있다).
 * - `postOpRows`: 이번 조작 **후** 상태 — 실제 비교할 값.
 */
export const layeridFieldConsensus = (
  preOpRows: LayerSyncRow[],
  postOpRows: LayerSyncRow[],
  layerid: string,
  field: 'st' | 'new_or_copy',
): string | undefined => {
  const eligibleIds = new Set(
    preOpRows.filter((r) => r.layerid?.trim() === layerid && isSyncParticipant(r)).map((r) => r.id)
  );
  if (eligibleIds.size === 0) return undefined;
  const group = postOpRows.filter((r) => eligibleIds.has(r.id));
  const value = group[0]?.[field];
  return group.every((r) => r[field] === value) ? value : undefined;
};

/** 대상 테이블에서 해당 layerid를 가진 참여행이 정확히 1개일 때만 그 행을 반환한다(0개/2개 이상이면 undefined). */
export const soleParticipantByLayerid = <T extends LayerSyncRow>(
  rows: T[],
  layerid: string,
): T | undefined => {
  const candidates = rows.filter((r) => r.layerid?.trim() === layerid && isSyncParticipant(r));
  return candidates.length === 1 ? candidates[0] : undefined;
};

/**
 * 전파(교차 동기화·일괄 적용)로 대상 행의 st가 'X'가 될 때, 직접 편집한 행과 동일하게
 * new_or_copy/product_name/step(J측이면 item_id도)을 함께 초기화하는 패치를 반환한다.
 * field가 'st'가 아니거나 값이 'X'가 아니면 빈 객체(추가 변경 없음).
 */
export const stClearExtra = (field: string, value: string, hasItemId: boolean): Record<string, string> => {
  if (field !== 'st' || value !== ST_X) return {};
  const extra: Record<string, string> = { new_or_copy: '', product_name: '', step: '' };
  if (hasItemId) extra.item_id = '';
  return extra;
};

// ===== Layer 추가/삭제 Merge (참조 요청서 A ↔ 작성 중 요청서 B) =====

/** Merge 비교에 필요한 최소 형태 — JayerRow / OayerRow 양쪽을 받는다. */
export interface MergeComparableRow {
  id: string;
  sortOrder: number;
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
  st: string;
  new_or_copy: string;
  loaded?: boolean;
}

/** Merge 결과 건수 — 확인 모달의 미리보기와 실제 반영이 같은 계산에서 나온다. */
export interface MergeStats {
  added: number;       // ① B 에만 있음 → 신규
  registered: number;  // ③ A·B 양쪽 → 기등록
  deleted: number;     // ② A 에만 있음 → layer삭제 행으로 추가
}

/** 비교 키 — layerid 는 포함하지 않는다(운영 데이터상 이 4개로 행이 유일하게 식별된다). */
const mergeKey = (r: { process_id: string; sp: string; sd: string; pp: string }): string =>
  [r.process_id, r.sp, r.sd, r.pp].map((v) => (v ?? '').trim()).join('||');

/**
 * 그 요청서에 이 layer 가 "존재"하는가.
 * new_or_copy='layer삭제' 는 그 시점에 이미 지워진 layer 이므로 **부재**로 본다.
 * 따라서 A 에서 삭제된 layer 가 B 에 있으면 "A 엔 없던 것이 B 에 생김" → 신규가 된다.
 */
const isMergePresent = (r: MergeComparableRow): boolean =>
  r.new_or_copy !== NOC_LAYER_DELETE;

/**
 * 참조 요청서(A)를 기준으로 작성 중인 요청서(B)의 layer 표를 3-way 로 재판정한다.
 * J-layer 는 J-layer 끼리, O-layer 는 O-layer 끼리 각각 독립 호출한다(표 간 값 전파 없음).
 *
 * | 구분 | 조건 | st | new_or_copy |
 * |------|------|----|-------------|
 * | ①    | B 에만 있음 | O | 신규 |
 * | ②    | A 에만 있음 → B 에 행 추가 | X | layer삭제 |
 * | ③    | A·B 양쪽 존재, A 의 st 가 X 가 아님(아직 확정 전) | X | 기등록 |
 * | ③'   | A·B 양쪽 존재, A 의 st 가 이미 X(이미 확정됨) | (건드리지 않음) | (건드리지 않음) |
 *
 * 비활성 행과 이미 layer삭제 인 행은 건드리지 않는다.
 * ③' 을 둔 이유: st='X' 는 이전 세대에서 이미 '기등록'으로 확정됐다는 뜻이라, 참조 체인
 * (A→B→C→...)을 탈 때마다 매번 다시 기등록으로 재도장(stamp)할 필요가 없다 — 이미 확정된
 * 행은 현재 표(cur)의 값을 그대로 둔다.
 */
export const computeLayerMerge = <T extends MergeComparableRow>(
  curRows: T[],
  refRows: T[]
): { merged: T[]; stats: MergeStats } => {
  const refPresentByKey = new Map(refRows.filter(isMergePresent).map((r) => [mergeKey(r), r]));
  const curPresentKeys = new Set(curRows.filter(isMergePresent).map(mergeKey));
  // 표의 모든 행(layer삭제 포함). A 행을 추가할 때 같은 키가 이미 있으면 중복을 만들지 않는다.
  const curActiveKeys = new Set(curRows.map(mergeKey));

  const stats: MergeStats = { added: 0, registered: 0, deleted: 0 };

  const merged: T[] = curRows.map((r) => {
    if (!isMergePresent(r)) return r; // 비활성 / 이미 layer삭제 → 유지
    const refRow = refPresentByKey.get(mergeKey(r));
    if (refRow) {
      stats.registered += 1;
      if (refRow.st === ST_X) return r; // 이미 확정(기등록)된 행은 현재 상태를 그대로 둔다
      return { ...r, st: ST_X, new_or_copy: NOC_REGISTERED };
    }
    stats.added += 1;
    return { ...r, st: ST_O, new_or_copy: NOC_NEW };
  });

  // sortOrder 는 base+index 로 부여해 같은 밀리초에 추가돼도 순서가 결정적이다.
  const base = Date.now();
  refRows.filter(isMergePresent).forEach((r, i) => {
    if (curActiveKeys.has(mergeKey(r))) return;
    stats.deleted += 1;
    merged.push({
      ...r,
      id: genId(),
      sortOrder: base + i,
      loaded: true,          // 원본 컬럼(LOADED_LOCK_COLS) 읽기전용
      st: ST_X,
      new_or_copy: NOC_LAYER_DELETE,
    });
  });

  return { merged, stats };
};

// ===== 참조 요청서 Merge — BEFORE/AFTER 비교 =====

/** 비교에 필요한 최소 형태 — JayerRow / OayerRow 양쪽을 받는다. */
export interface BaComparableRow {
  id: string;
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
  layerid: string;
  new_or_copy?: string;
}

/** 비교·표시 대상 5개 항목 */
const BA_FIELDS = ['process_id', 'sp', 'sd', 'pp', 'layerid'] as const;

const baNorm = (v: string | undefined): string => (v ?? '').trim();

/** 같은 줄로 볼지 판정하는 키 — process_id + layerid (나머지 3개가 다르면 '변경'으로 본다) */
const baKey = (r: BaComparableRow): string => `${baNorm(r.process_id)}||${baNorm(r.layerid)}`;

/** 표시·저장용 5개 항목만 뽑아 공백을 정규화한다. */
export const toMergeRowInfo = (r: BaComparableRow): MergeRowInfo => ({
  process_id: baNorm(r.process_id),
  sp: baNorm(r.sp),
  sd: baNorm(r.sd),
  pp: baNorm(r.pp),
  layerid: baNorm(r.layerid),
});

/** 5개 항목이 모두 같은가 (= 변경 없음 → 어느 표에도 싣지 않는다) */
const baSame = (a: MergeRowInfo, b: MergeRowInfo): boolean => BA_FIELDS.every((f) => a[f] === b[f]);

/**
 * 비활성 행과 layerid 가 빈 행은 비교 대상이 아니다.
 * 참조문서(ref)의 `layer삭제` 행도 대상에서 제외한다 — 그 시점에 이미 지워진 layer 이므로
 * 다음 세대 비교에서 "이번에 새로 삭제됨"으로 재등장하면 안 된다(참조 요청서 체인 A→B→C...).
 * `computeLayerMerge` 의 `isMergePresent` 와 동일한 기준.
 */
const baTarget = (r: BaComparableRow): boolean =>
  baNorm(r.layerid) !== '' && r.new_or_copy !== NOC_LAYER_DELETE;

/**
 * 자동 확정 짝의 행 id — 출처 행 id 로 만들어 **같은 입력이면 항상 같은 값**이 되게 한다
 * (genId 를 쓰면 computeBeforeAfter 가 순수 함수가 아니게 된다). 한 짝의 beforeId·afterId
 * 조합은 자동 판정에서 유일하므로 중복되지 않는다.
 */
const autoPairId = (beforeId: string | null, afterId: string | null): string =>
  `pair_${beforeId ?? 'none'}__${afterId ?? 'none'}`;

const toUnmatched = (r: BaComparableRow, table: MergeTable): MergeUnmatchedRow => ({
  id: `${table}_${r.id}`,
  table,
  ...toMergeRowInfo(r),
});

export interface BeforeAfterResult {
  /** 자동으로 짝이 확정된 항목 (변경전/변경후 표) */
  pairs: MergePair[];
  /** 자동으로 짝지을 수 없어 사용자가 직접 매핑할 항목 (BEFORE/AFTER 표) */
  unmatchedBefore: MergeUnmatchedRow[];
  unmatchedAfter: MergeUnmatchedRow[];
  /** 5개 항목이 모두 같아 표에서 제외한 건수 (요약 표시용) */
  sameCount: number;
}

/**
 * 참조 요청서(A)와 작성 중인 요청서(B)를 `process_id + layerid` 그룹으로 묶어 비교한다.
 *
 * 그룹 안에서 **5개 값이 모두 같은 짝을 먼저 소진**한 뒤(= 변경 없음, 어느 표에도 싣지 않는다),
 * 남은 행에만 아래 판정을 적용한다.
 *
 * | 남은 A 행 수 | B 행 수 | 처리 |
 * |---|---|---|
 * | 1 | 1 | 자동 1:1 짝 (완전 일치는 이미 빠졌으므로 반드시 '변경') |
 * | N(≥1) | 0 | 각 행을 AFTER=미등록 과 자동 짝 (모호성 없음) |
 * | 0 | N(≥1) | 각 행을 BEFORE=미등록 과 자동 짝 (모호성 없음) |
 * | 둘 다 ≥1 이고 한쪽이라도 ≥2 | | 자동 매칭하지 않고 BEFORE/AFTER 표로 (사용자가 직접 매핑) |
 *
 * J-ayer 는 J-ayer 끼리, O-ayer 는 O-ayer 끼리 독립 비교한다(표 간 값 전파 없음).
 */
export const computeBeforeAfter = (
  refJayer: BaComparableRow[],
  refOayer: BaComparableRow[],
  curJayer: BaComparableRow[],
  curOayer: BaComparableRow[]
): BeforeAfterResult => {
  const pairs: MergePair[] = [];
  const unmatchedBefore: MergeUnmatchedRow[] = [];
  const unmatchedAfter: MergeUnmatchedRow[] = [];
  let sameCount = 0;

  const compareTable = (table: MergeTable, refRows: BaComparableRow[], curRows: BaComparableRow[]) => {
    const refs = (refRows ?? []).filter(baTarget);
    const curs = (curRows ?? []).filter(baTarget);

    const group = (rows: BaComparableRow[]): Map<string, BaComparableRow[]> => {
      const m = new Map<string, BaComparableRow[]>();
      rows.forEach((r) => {
        const k = baKey(r);
        const list = m.get(k);
        if (list) list.push(r);
        else m.set(k, [r]);
      });
      return m;
    };
    const refMap = group(refs);
    const curMap = group(curs);

    // 키 순서: 참조 요청서에 나온 순서 → 현재 요청서에만 있는 키. 입력이 같으면 결과 순서도 같다.
    const keys: string[] = [];
    const seen = new Set<string>();
    [...refs, ...curs].forEach((r) => {
      const k = baKey(r);
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    });

    keys.forEach((k) => {
      const aAll = refMap.get(k) ?? [];
      const bAll = curMap.get(k) ?? [];

      // ① 5개 값이 모두 같은 짝을 먼저 소진한다. 같은 그룹에 다른 행이 더 있어도 이 짝은
      //    '변경 없음'이므로 어느 표에도 싣지 않으며, 아래 모호 판정의 대상도 되지 않는다.
      //    한 A 행은 한 B 행만 소진한다(짝을 여러 개로 복제하지 않는다).
      const usedB = new Set<string>();
      const a: BaComparableRow[] = [];
      aAll.forEach((ar) => {
        const info = toMergeRowInfo(ar);
        const hit = bAll.find((br) => !usedB.has(br.id) && baSame(info, toMergeRowInfo(br)));
        if (hit) {
          usedB.add(hit.id);
          sameCount += 1;
          return;
        }
        a.push(ar);
      });
      const b = bAll.filter((br) => !usedB.has(br.id));

      // ② 완전 일치가 빠진 나머지에만 자동/수동 판정을 적용한다.
      if (a.length === 1 && b.length === 1) {
        pairs.push({
          id: autoPairId(`${table}_${a[0].id}`, `${table}_${b[0].id}`),
          table,
          beforeId: `${table}_${a[0].id}`, before: toMergeRowInfo(a[0]),
          afterId: `${table}_${b[0].id}`, after: toMergeRowInfo(b[0]),
          kind: 'changed',
        });
        return;
      }
      if (a.length === 0) {
        // 참조에 없던 항목 → BEFORE 미등록 (짝지을 상대가 하나뿐이라 자동 확정)
        b.forEach((r) => pairs.push({
          id: autoPairId(null, `${table}_${r.id}`),
          table,
          beforeId: null, before: null,
          afterId: `${table}_${r.id}`, after: toMergeRowInfo(r),
          kind: 'added',
        }));
        return;
      }
      if (b.length === 0) {
        // 현재 요청서에서 사라진 항목 → AFTER 미등록
        a.forEach((r) => pairs.push({
          id: autoPairId(`${table}_${r.id}`, null),
          table,
          beforeId: `${table}_${r.id}`, before: toMergeRowInfo(r),
          afterId: null, after: null,
          kind: 'deleted',
        }));
        return;
      }
      // 양쪽 모두 있고 한쪽이라도 2행 이상 → 어느 행끼리 짝인지 알 수 없으므로 사용자에게 맡긴다.
      a.forEach((r) => unmatchedBefore.push(toUnmatched(r, table)));
      b.forEach((r) => unmatchedAfter.push(toUnmatched(r, table)));
    });
  };

  compareTable('J', refJayer, curJayer);
  compareTable('O', refOayer, curOayer);

  return { pairs, unmatchedBefore, unmatchedAfter, sameCount };
};

/** AFTER 쪽 id 로부터 실제 J/O-layer 행을 찾는 데 필요한 최소 형태. */
export interface PairAfterLookupRow {
  id: string;
  st: string;
  new_or_copy: string;
}

/**
 * pair 의 AFTER 가 실제 J/O-layer 표의 행과 연결돼 있고, 그 행이 지금 비활성이거나 `기등록` 이면 true.
 * `afterId` 는 `${table}_${row.id}` 형태(`toUnmatched`/`computeBeforeAfter` 참조) — 접두사 2글자
 * (`J_`/`O_`)로 표를 가리고 나머지가 원본 행 id 다. 수기로 추가한 행(`afterId=null`)이나, 표에서 행
 * 자체가 지워진 경우는 연결이 없으므로 false.
 * 표시 전용 판정이라 값 자체는 건드리지 않는다 — Merge 확정 시점의 `pair.after` 스냅샷은 그대로 두고,
 * "지금 이 순간 실제 표 상태가 어떤지"만 매 렌더마다 다시 계산한다.
 */
export const isPairAfterInactive = (
  afterId: string | null,
  jayerRows: PairAfterLookupRow[],
  oayerRows: PairAfterLookupRow[]
): boolean => {
  if (!afterId) return false;
  const table = afterId.slice(0, 1);
  const rowId = afterId.slice(2);
  const rows = table === 'J' ? jayerRows : table === 'O' ? oayerRows : null;
  const row = rows?.find((r) => r.id === rowId);
  return !!row && (isRowInactive(row.st) || row.new_or_copy === NOC_REGISTERED);
};

// ===== 변경전/변경후 표 직접 입력 =====

/** 값이 하나도 없는 쪽 = '미등록'. null 도 미등록으로 본다. */
export const isMergeSideEmpty = (info: MergeRowInfo | null): boolean =>
  !info || MERGE_MANUAL_FIELDS.every((f) => baNorm(info[f]) === '');

/** 4칸이 모두 빈 쪽은 null(미등록)로 접는다 — 저장 형식을 자동 계산 결과와 같게 유지한다. */
export const normalizeMergeSide = (info: MergeRowInfo | null): MergeRowInfo | null =>
  isMergeSideEmpty(info) ? null : info;

/** 판정은 사용자가 고르지 않고 양쪽 미등록 여부로 계산한다. */
export const deriveMergeKind = (before: MergeRowInfo | null, after: MergeRowInfo | null): MergePairKind => {
  const b = isMergeSideEmpty(before);
  const a = isMergeSideEmpty(after);
  if (b && a) return 'empty';
  if (b) return 'added';
  if (a) return 'deleted';
  return 'changed';
};

/** 값이 비어 있는 수기 입력용 한 쪽. layerid 는 수기 대상이 아니라 항상 빈 값이다. */
export const emptyMergeRowInfo = (): MergeRowInfo => ({
  process_id: '', sp: '', sd: '', pp: '', layerid: '',
});

/** 양쪽 미등록으로 시작하는 새 행. 수기 행은 되돌릴 출처가 없어 beforeId/afterId 가 null 이다. */
export const emptyMergePair = (table: MergeTable = MERGE_DEFAULT_TABLE): MergePair => ({
  id: genId(),
  table,
  beforeId: null, before: null,
  afterId: null, after: null,
  kind: 'empty',
});

/**
 * 엑셀 붙여넣기 원문을 4칸 표로 파싱한다.
 * 열은 **항상 process_id 부터** 채우므로(커서 위치와 무관) 앞 4열만 쓰고 나머지는 버린다.
 * 4열보다 적으면 채운 칸만 반영한다(부족한 칸은 undefined 로 남겨 호출부가 기존 값을 유지한다).
 */
export const parseMergePasteRows = (raw: string): (string | undefined)[][] =>
  raw
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells = line.split('\t');
      return MERGE_MANUAL_FIELDS.map((_, i) => (cells[i] === undefined ? undefined : cells[i].trim()));
    });

/**
 * 붙여넣기 결과를 표에 반영한다 — 시작 행부터 아래로 채우고, 행이 모자라면 새 행을 만든다.
 * 한 행이 변경전+변경후 한 쌍이므로 **행을 늘리면 반대쪽 행 수도 함께 늘어난다**
 * (새로 생긴 행의 반대쪽은 미등록으로 남는다). 새 행의 구분은 직전 행을 따라간다.
 */
export const applyMergePaste = (
  pairs: MergePair[],
  startPairId: string,
  side: 'before' | 'after',
  grid: (string | undefined)[][]
): MergePair[] => {
  const startIdx = pairs.findIndex((p) => p.id === startPairId);
  if (startIdx === -1 || grid.length === 0) return pairs;
  const next = [...pairs];
  grid.forEach((cells, i) => {
    const idx = startIdx + i;
    while (next.length <= idx) next.push(emptyMergePair(next[next.length - 1]?.table));
    const target = next[idx];
    const info = { ...(target[side] ?? emptyMergeRowInfo()) };
    MERGE_MANUAL_FIELDS.forEach((f, c) => {
      const cell = cells[c];
      if (cell !== undefined) info[f] = cell;
    });
    const updated: MergePair = { ...target, [side]: normalizeMergeSide(info) };
    next[idx] = { ...updated, kind: deriveMergeKind(updated.before, updated.after) };
  });
  return next;
};

/** 상신 게이트용 집계. */
export interface MergePairsValidation {
  /** 미등록이 아닌 쪽에서 비어 있는 칸 수 (4칸 필수) */
  incompleteCells: number;
  /** 양쪽 모두 미등록인 행 수 */
  blankRows: number;
  /** 한쪽이라도 값이 있는 행 수 */
  validCount: number;
}

/**
 * 변경전/변경후 표 검증 — 미등록이 아닌 쪽은 process_id·sp·sd·pp 4칸을 모두 채워야 한다.
 * layerid 는 수기 입력 대상이 아니므로 검사하지 않는다.
 */
export const validateMergePairs = (pairs: MergePair[]): MergePairsValidation => {
  let incompleteCells = 0;
  let blankRows = 0;
  let validCount = 0;
  (pairs ?? []).forEach((pair) => {
    const sides: (MergeRowInfo | null)[] = [pair.before, pair.after];
    if (sides.every(isMergeSideEmpty)) {
      blankRows += 1;
      return;
    }
    validCount += 1;
    sides.forEach((side) => {
      if (isMergeSideEmpty(side)) return;
      MERGE_MANUAL_FIELDS.forEach((f) => {
        if (baNorm(side![f]) === '') incompleteCells += 1;
      });
    });
  });
  return { incompleteCells, blankRows, validCount };
};

// claude 수정 (2026-10-16): 참조 요청서 '없음' 모드 — PP 접두사로 구분(J/O)을 정하고, 입력값을 현재 J/O 표와 대조한다.
// '있음' 모드는 Merge 가 구분을 정하므로 이 판정·검증을 쓰지 않는다.

/** PP 가 어느 구분의 접두사로 시작하는가 — 앞뒤 공백 무시·대소문자 무시. 어디에도 해당하지 않으면 null. */
export const mergeTableFromPp = (pp: string | undefined): MergeTable | null => {
  const value = baNorm(pp).toUpperCase();
  if (value === '') return null;
  const hit = (Object.keys(MERGE_PP_PREFIXES) as MergeTable[]).find((table) =>
    MERGE_PP_PREFIXES[table].some((prefix) => {
      const p = prefix.trim().toUpperCase();
      return p !== '' && value.startsWith(p);
    })
  );
  return hit ?? null;
};

/** 구분 판정 오류 — 'unknown': 접두사에 해당하지 않는 PP / 'mismatch': 변경전·변경후 PP 의 구분이 서로 다름 */
export type ManualPairTableError = 'unknown' | 'mismatch';

export interface ManualPairTableResolution {
  table: MergeTable | null;
  error: ManualPairTableError | null;
}

/**
 * 한 행의 구분 — 값이 있는 쪽의 PP 로 정한다. PP 가 빈 쪽은 판정에서 뺀다(빈 칸은 4칸 필수 검사가 잡는다).
 * 판정할 PP 가 하나도 없으면 오류 없이 null 이다.
 */
export const resolveManualPairTable = (
  pair: Pick<MergePair, 'before' | 'after'>
): ManualPairTableResolution => {
  const pps = [pair.before, pair.after]
    .filter((info): info is MergeRowInfo => !isMergeSideEmpty(info))
    .map((info) => baNorm(info.pp))
    .filter((pp) => pp !== '');
  if (pps.length === 0) return { table: null, error: null };
  const tables = pps.map(mergeTableFromPp);
  if (tables.some((table) => table === null)) return { table: null, error: 'unknown' };
  if (new Set(tables).size > 1) return { table: null, error: 'mismatch' };
  return { table: tables[0], error: null };
};

/** PP 로 구분이 정해지면 행의 구분을 그 값으로 맞춘다(판정할 수 없으면 기존 값을 그대로 둔다). */
export const syncManualPairTable = (pair: MergePair): MergePair => {
  const { table } = resolveManualPairTable(pair);
  return table && table !== pair.table ? { ...pair, table } : pair;
};

/** J/O-layer 표와 대조할 때 필요한 최소 형태 */
export interface ManualLayerKeyRow {
  process_id: string;
  sp: string;
  sd: string;
  pp: string;
}

/** 같은 데이터 판정 키 — process_id·SP·SD·PP 4값, 앞뒤 공백·대소문자 무시. st·요청 기준은 보지 않는다. */
const manualLayerKey = (r: ManualLayerKeyRow): string =>
  MERGE_MANUAL_FIELDS.map((f) => baNorm(r[f]).toUpperCase()).join('||');

/** 4칸이 모두 채워진 쪽만 J/O 표와 대조한다(미입력은 4칸 필수 검사가 잡는다). */
const isMergeSideComplete = (info: MergeRowInfo | null): info is MergeRowInfo =>
  !!info && MERGE_MANUAL_FIELDS.every((f) => baNorm(info[f]) !== '');

export interface ManualPairLayerCheck {
  /** PP 접두사로 정한 구분 — 판정할 PP 가 없거나 오류면 null */
  table: MergeTable | null;
  tableError: ManualPairTableError | null;
  /** 구분 판정 오류를 표시할 PP 칸 */
  ppError: { before: boolean; after: boolean };
  /** 변경전 값이 지금 J/O 표에 이미 있다(변경전은 없어야 한다) */
  beforeExists: boolean;
  /** 변경후 값이 지금 J/O 표에 없다(변경후는 있어야 한다) */
  afterMissing: boolean;
}

export interface ManualPairsLayerCheck {
  byPair: Record<string, ManualPairLayerCheck>;
  unknownRows: number;
  mismatchRows: number;
  beforeExistsRows: number;
  afterMissingRows: number;
}

/**
 * '없음' 모드 변경전/변경후 표를 현재 J/O-layer 표와 대조한다(검증만 — J/O 값은 바꾸지 않는다).
 * 행의 구분은 PP 접두사로 정하고, 그 구분의 표에서
 * 변경전 값은 **없어야** 하고 변경후 값은 **있어야** 한다.
 * '있다'는 4값이 같은 행이 하나라도 있다는 뜻이다(st·요청 기준·layer삭제 여부 무관).
 */
export const checkManualPairsAgainstLayers = (
  pairs: MergePair[],
  jayerRows: ManualLayerKeyRow[],
  oayerRows: ManualLayerKeyRow[]
): ManualPairsLayerCheck => {
  const keys: Record<MergeTable, Set<string>> = {
    J: new Set((jayerRows ?? []).map(manualLayerKey)),
    O: new Set((oayerRows ?? []).map(manualLayerKey)),
  };
  const result: ManualPairsLayerCheck = {
    byPair: {}, unknownRows: 0, mismatchRows: 0, beforeExistsRows: 0, afterMissingRows: 0,
  };
  (pairs ?? []).forEach((pair) => {
    const { table, error } = resolveManualPairTable(pair);
    const ppBad = (info: MergeRowInfo | null): boolean =>
      !isMergeSideEmpty(info) && baNorm(info!.pp) !== ''
      && (error === 'mismatch' || (error === 'unknown' && mergeTableFromPp(info!.pp) === null));
    const beforeExists = table !== null && isMergeSideComplete(pair.before)
      && keys[table].has(manualLayerKey(pair.before));
    const afterMissing = table !== null && isMergeSideComplete(pair.after)
      && !keys[table].has(manualLayerKey(pair.after));
    result.byPair[pair.id] = {
      table,
      tableError: error,
      ppError: { before: ppBad(pair.before), after: ppBad(pair.after) },
      beforeExists,
      afterMissing,
    };
    if (error === 'unknown') result.unknownRows += 1;
    if (error === 'mismatch') result.mismatchRows += 1;
    if (beforeExists) result.beforeExistsRows += 1;
    if (afterMissing) result.afterMissingRows += 1;
  });
  return result;
};

// claude 수정 (2026-10-20): 참조 요청서 '없음' 확정 — 변경전/변경후 표로 J/O 표의 st 를 정한다(확정 버튼·상신 검증 공용).

/** st 를 정하는 데 필요한 J/O 행의 최소 형태 */
export interface RefDocStRow extends ManualLayerKeyRow {
  id: string;
  st: string;
  new_or_copy: string;
}

export interface RefDocStTargets {
  /** 행 id → 확정 시 st. 변경후 값과 4값이 같은 행은 'O', 그 밖의 행은 모두 'X' */
  jayer: Record<string, string>;
  oayer: Record<string, string>;
  /**
   * 'O' 가 될 행인데 요청 기준이 기등록/layer삭제/미진행인 행.
   * claude 수정 (2026-10-20): 확정은 이 행들의 요청 기준을 비우고 진행한다(사용자 결정). 상신 안전망은 여전히 이 값으로 막는다.
   */
  nocConflicts: { table: MergeTable; id: string }[];
}

/**
 * 변경전/변경후 표의 판정 추가·변경 행(변경후 4칸이 모두 찬 행)의 변경후 값과 4값이 같은 J/O 행은 st='O',
 * 나머지 J/O 행은 모두 st='X' 로 정한다. 구분은 PP 접두사 판정(resolveManualPairTable)을 따른다.
 * 삭제 행은 변경후 값이 없으므로 'O' 가 되는 행을 만들지 않는다.
 */
export const computeRefDocStTargets = (
  pairs: MergePair[],
  jayerRows: RefDocStRow[],
  oayerRows: RefDocStRow[]
): RefDocStTargets => {
  const keys: Record<MergeTable, Set<string>> = { J: new Set(), O: new Set() };
  (pairs ?? []).forEach((pair) => {
    const { table } = resolveManualPairTable(pair);
    if (table && isMergeSideComplete(pair.after)) keys[table].add(manualLayerKey(pair.after));
  });
  const nocConflicts: RefDocStTargets['nocConflicts'] = [];
  const targetsOf = (table: MergeTable, rows: RefDocStRow[]): Record<string, string> =>
    Object.fromEntries((rows ?? []).map((r) => {
      const hit = keys[table].has(manualLayerKey(r));
      if (hit && isNocSpecial(r.new_or_copy)) nocConflicts.push({ table, id: r.id });
      return [r.id, hit ? ST_O : ST_X];
    }));
  return { jayer: targetsOf('J', jayerRows), oayer: targetsOf('O', oayerRows), nocConflicts };
};

/**
 * claude 수정 (2026-10-20): 요청 기준 충돌(nocConflicts)을 일으키는 변경후/변경전 표 행(pair) id 목록 — 그 행의 변경후 칸을 빨간 표시한다.
 * 충돌 판정은 computeRefDocStTargets 를 그대로 쓰고, 충돌한 J/O 행과 변경후 4값이 같은 행을 찾는다.
 */
export const findRefDocNocConflictPairIds = (
  pairs: MergePair[],
  jayerRows: RefDocStRow[],
  oayerRows: RefDocStRow[]
): string[] => {
  const { nocConflicts } = computeRefDocStTargets(pairs, jayerRows, oayerRows);
  const conflictKeys: Record<MergeTable, Set<string>> = { J: new Set(), O: new Set() };
  nocConflicts.forEach(({ table, id }) => {
    const row = (table === 'J' ? jayerRows : oayerRows).find((r) => r.id === id);
    if (row) conflictKeys[table].add(manualLayerKey(row));
  });
  return (pairs ?? [])
    .filter((pair) => {
      const { table } = resolveManualPairTable(pair);
      return !!table && isMergeSideComplete(pair.after) && conflictKeys[table].has(manualLayerKey(pair.after));
    })
    .map((pair) => pair.id);
};

/** 지금 J/O 표의 st 가 확정 결과와 모두 같은가 — 다르면 확정 뒤 J/O 표가 바뀐 것이다(확정 해제 판단용). */
export const isRefDocStApplied = (
  targets: RefDocStTargets,
  jayerRows: RefDocStRow[],
  oayerRows: RefDocStRow[]
): boolean =>
  (jayerRows ?? []).every((r) => (r.st ?? '').trim() === targets.jayer[r.id])
  && (oayerRows ?? []).every((r) => (r.st ?? '').trim() === targets.oayer[r.id]);

/**
 * claude 수정 (2026-10-19): 참조 요청서 '없음' 변경전/변경후 표가 정하는 상세 목적.
 * 판정이 '미작성'이 아니고 구분(PP 접두사)이 정해진 행만 본다 — 그런 행이 없으면 null(자동 선택 안 함).
 * - 구분이 O 뿐 → 'Overlay만 변경' 단독(다른 상세 목적도 모두 뺀다 — J 단계를 빼는 축소 경로)
 * - J 가 하나라도 있음 → Overlay만 변경(구 값 포함)을 빼고, 추가·삭제가 있으면 Layer 추가/삭제,
 *   변경이 있으면 STEPSEQ 변경. Merge 와 무관한 상세 목적(FirstA 변경 등)은 그대로 둔다.
 * 값이 같은지 비교하지 않고 목표 배열을 그대로 돌려준다(반영 여부는 호출부가 sameOtherPurpose 로 정한다).
 */
export const deriveAutoOtherPurpose = (pairs: MergePair[], otherPurpose: string[]): string[] | null => {
  const tables = new Set<MergeTable>();
  let hasAddedOrDeleted = false;
  let hasChanged = false;
  (pairs ?? []).forEach((pair) => {
    const kind = deriveMergeKind(pair.before, pair.after);
    if (kind === 'empty') return;
    const { table } = resolveManualPairTable(pair);
    if (!table) return;
    tables.add(table);
    if (kind === 'changed') hasChanged = true;
    else hasAddedOrDeleted = true;
  });
  if (tables.size === 0) return null;
  if (!tables.has('J')) return [OTHER_PURPOSE_OVERLAY];
  return [
    ...otherPurpose.filter((v) => !(MERGE_ENABLED_PURPOSES as readonly string[]).includes(v)),
    ...(hasAddedOrDeleted ? [OTHER_PURPOSE_LAYER] : []),
    ...(hasChanged ? [OTHER_PURPOSE_STEPSEQ] : []),
  ];
};

/** 상세 목적 두 배열이 순서와 무관하게 같은 항목인가 — 자동 선택 결과를 반영할지 판단용 */
export const sameOtherPurpose = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v) => b.includes(v));

/** J/O-layer 행에 사용자가 입력한 값이 하나라도 있는가 — 수동 행 삭제 시 확인 모달 여부 판단용 */
export const layerRowHasInput = (row: JayerRow | OayerRow): boolean =>
  [row.process_id, row.sp, row.sd, row.pp, row.layerid, row.st, row.new_or_copy, row.product_name, row.step,
    'item_id' in row ? row.item_id : '']
    .some((v) => !!v?.trim());

/** 행 단위: 이 행의 pp 가 판정 키워드를 포함하는가 (셀 하이라이트·문서 판정 공용) */
export const isValidationKeywordRow = (pp: string | undefined): boolean =>
  !!pp && pp.toLowerCase().includes(VALIDATION_KEYWORD);

/**
 * 문서 단위: 활성 J-layer 행 중 하나라도 판정 키워드를 포함하면 Validation System 대상.
 * 비활성(st==='X') 행은 판정에서 제외한다.
 */
export const isValidationTarget = (
  rows: { st?: string; pp?: string }[]
): boolean => rows.some((r) => !isRowInactive(r.st) && isValidationKeywordRow(r.pp));

/**
 * 문서 단위 자동 판정값. 판정 키워드가 하나라도 있으면 '대상'(VS_TARGET),
 * 아예 없으면 판정이 성립하지 않으므로 '해당없음'(VS_NA).
 * '비대상'(VS_NONTARGET)은 자동 판정으로 나오지 않는다 — 키워드가 있는 문서에서
 * 상신자가 직접 토글했을 때만 나오며, 그 판단이 맞는지는 MASK(E)가 검증한다.
 */
export const autoValidationSystem = (
  rows: { st?: string; pp?: string }[]
): ValidationSystemValue => (isValidationTarget(rows) ? VS_TARGET : VS_NA);

// ===== 결재 상세페이지 J/O-layer "색상 적용" — 매칭 색상 판정 =====

/**
 * 켜져 있는(activeIds) 색상 필터들을 목록 순서대로 훑어, 이 셀 값(sp/sd/pp 중 하나)에
 * 매칭되는 첫 번째 키워드의 색을 찾는다. 필터 목록 순서 → 필터 안 키워드 등록 순서, 둘 다
 * 먼저 나온 쪽이 우선(같은 셀에 서로 다른 색이 동시에 매칭될 때의 결정 규칙).
 * 매칭 규칙은 기존 공유 필터(LayerFilterSet)와 동일 — 대소문자 무시, 부분 일치.
 */
export const matchLayerColor = (
  sets: ColorFilterSet[],
  activeIds: Set<string>,
  field: 'sp' | 'sd' | 'pp',
  value: string | undefined,
): string | undefined => {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  for (const fs of sets) {
    if (!activeIds.has(fs.id)) continue;
    for (const entry of fs.words[field]) {
      if (entry.word && lower.includes(entry.word.toLowerCase())) return entry.color;
    }
  }
  return undefined;
};

// ===== ADI CD 변경 — 변경전/변경후 스텝 표 붙여넣기 =====

/** 한 줄을 탭 구분으로 나누되, `"..."` 로 감싼 셀 안의 탭·이스케이프된 `""` 를 존중한다(엑셀 TSV 규칙). */
const parseTsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur === '') {
      inQuotes = true;
    } else if (ch === '\t') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
};

/**
 * 클립보드 원문(`text/plain`, 엑셀은 TSV 를 넣는다)을 2차원 배열로 분해한다.
 * 개행 정규화 → 인용 인식 TSV 분해 → 가장자리 완전 빈 행 제거.
 */
export const parseClipboardTable = (raw: string): string[][] => {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = normalized.split('\n').map(parseTsvLine);
  const isBlankRow = (row: string[]): boolean => row.every((c) => c.trim() === '');
  let start = 0;
  let end = rows.length;
  while (start < end && isBlankRow(rows[start])) start += 1;
  while (end > start && isBlankRow(rows[end - 1])) end -= 1;
  return rows.slice(start, end);
};

const normalizeHeaderCell = (s: string): string => s.toUpperCase().replace(/[\s_-]/g, '');
const ADI_CD_STEP_ID_KEY = normalizeHeaderCell(ADI_CD_STEP_ID_LABEL);
const ADI_CD_STEP_DESC_KEY = normalizeHeaderCell(ADI_CD_STEP_DESC_LABEL);

export interface AdiCdHeaderMatch {
  headerRow: number;
  stepIdCol: number;
  stepDescCol: number;
}

/**
 * 위에서부터 최대 `ADI_CD_HEADER_SCAN_ROWS` 행 안에서 STEP_ID/STEP_DESC 헤더를 모두 포함한 행을 찾는다.
 * 첫 행만 보지 않는 이유: 엑셀 상단 제목 행·빈 행까지 통째로 드래그하는 일이 흔하다.
 * 열 순서가 뒤바뀌어 있어도 인덱스로 정확히 잡는다.
 */
export const detectAdiCdHeader = (grid: string[][]): AdiCdHeaderMatch | null => {
  const scanRows = Math.min(grid.length, ADI_CD_HEADER_SCAN_ROWS);
  for (let i = 0; i < scanRows; i += 1) {
    const row = grid[i];
    const stepIdCol = row.findIndex((c) => normalizeHeaderCell(c) === ADI_CD_STEP_ID_KEY);
    const stepDescCol = row.findIndex((c) => normalizeHeaderCell(c) === ADI_CD_STEP_DESC_KEY);
    if (stepIdCol !== -1 && stepDescCol !== -1 && stepIdCol !== stepDescCol) {
      return { headerRow: i, stepIdCol, stepDescCol };
    }
  }
  return null;
};

export interface AdiCdPasteDecision {
  header: AdiCdHeaderMatch | null;
  columnCount: number;
  /** 2열이면 헤더 인식 여부와 무관하게 즉시 적용, 3열 이상만 컬럼 매핑 모달이 필요하다. */
  needsModal: boolean;
}

/** 붙여넣은 표를 즉시 적용할지, 컬럼 매핑 모달을 띄울지 판정한다. */
export const decideAdiCdPaste = (grid: string[][]): AdiCdPasteDecision => {
  const columnCount = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const header = detectAdiCdHeader(grid);
  return { header, columnCount, needsModal: columnCount > 2 };
};

/**
 * 헤더 행 아래(또는 지정한 시작 행부터) STEPSEQ/STEP 설명 두 열만 취해 `.trim()` 한다. 나머지 열은 전부 버린다.
 * 두 값이 모두 빈 행은 '미등록' 행(수동 체크박스와 같은 상태)으로 만든다(2026-08-20) —
 * 앞뒤 완전 빈 행은 parseClipboardTable 이 이미 걷어내므로, 여기 남는 빈 행은 표 중간에 있던
 * 의도적인 빈 자리다. 한쪽만 빈 행은 미등록으로 바꾸지 않고 값 그대로 채운다(불완전 행 검증은 그대로).
 */
export const buildAdiCdRows = (
  grid: string[][],
  mapping: { stepIdCol: number; stepDescCol: number },
  dataStartRow: number
): AdiCdStep[] => {
  const rows: AdiCdStep[] = [];
  for (let i = dataStartRow; i < grid.length; i += 1) {
    const row = grid[i];
    const step_id = (row[mapping.stepIdCol] ?? '').trim();
    const step_desc = (row[mapping.stepDescCol] ?? '').trim();
    if (!step_id && !step_desc) {
      rows.push({ id: genId(), step_id: '', step_desc: '', unregistered: true });
      continue;
    }
    rows.push({ id: genId(), step_id, step_desc, unregistered: false });
  }
  return rows;
};

export interface AdiCdValidationResult {
  /** STEP_ID/STEP_DESC 중 한쪽만 채워진 행 id */
  incompleteIds: string[];
  /** STEP_ID 가 다른 행과 중복된 행 id */
  duplicateIds: string[];
  /** 두 값이 모두 채워진 행 + '미등록' 행의 수 (완전히 빈 행은 세지 않는다) */
  validCount: number;
}

/** 게이트 통과 조건 3가지(유효 행 1개 이상 / 불완전 행 0개 / STEP_ID 중복 0개)를 판정한다.
 *  '미등록' 행은 값 자체가 없는 것이 정상이므로 유효 1건으로 세고
 *  불완전·중복 검사에서는 제외한다. 미등록이 아니면서 완전히 빈 행도 불완전으로 본다 —
 *  값을 채우지 않고 그냥 둔 행이 상신을 통과하면 안 되므로, 미등록 체크로 명시해야 통과된다. */
export const validateAdiCdRows = (rows: AdiCdStep[]): AdiCdValidationResult => {
  const incompleteIds: string[] = [];
  const duplicateIds: string[] = [];
  let validCount = 0;
  const idRowsById = new Map<string, string[]>();

  rows.forEach((r) => {
    if (r.unregistered) { validCount += 1; return; }
    const id = r.step_id.trim();
    const desc = r.step_desc.trim();
    if (id && desc) validCount += 1;
    else incompleteIds.push(r.id);
    if (id) {
      const list = idRowsById.get(id) ?? [];
      list.push(r.id);
      idRowsById.set(id, list);
    }
  });

  idRowsById.forEach((ids) => {
    if (ids.length > 1) duplicateIds.push(...ids);
  });

  return { incompleteIds, duplicateIds, validCount };
};

/**
 * 변경전/변경후 표는 같은 인덱스끼리 짝을 이루므로(같은 STEP 위치를 가리킨다) 행 개수가
 * 항상 같아야 한다. 짧은 쪽 끝에 빈 행을 채워 길이를 맞춘다(값을 지우지 않는 쪽으로만 조정).
 * 이미 같은 길이면 원본 배열을 그대로(참조 동일하게) 돌려준다.
 */
export const balanceAdiCdRows = (
  before: AdiCdStep[],
  after: AdiCdStep[]
): { before: AdiCdStep[]; after: AdiCdStep[] } => {
  const diff = before.length - after.length;
  if (diff === 0) return { before, after };
  if (diff > 0) {
    return { before, after: [...after, ...Array.from({ length: diff }, () => makeAdiCdStep())] };
  }
  return { before: [...before, ...Array.from({ length: -diff }, () => makeAdiCdStep())], after };
};

export interface AdiCdTargetsValidation {
  hasIncomplete: boolean;
  hasDuplicate: boolean;
}

/**
 * '동일 변경 적용 대상' 표 검증. 1행(first)은 Step1 필수 검증이 이미 채움을 보장하므로 그대로
 * 신뢰하고, 추가 행(extras)만 완전성을 검사한다 — 제품 이름/조리법 중 하나만 채운 행이 있으면
 * hasIncomplete. 1행을 포함해 전체 조합(제품 이름+조리법) 중 완전히 같은 게 둘 이상이면
 * hasDuplicate(미완성 행은 중복 판정에서 제외 — 불완전 오류가 이미 따로 뜬다).
 */
export const validateAdiCdTargets = (
  first: { partid_selection: string; process_id: string },
  extras: Array<{ partid_selection: string; process_id: string }>
): AdiCdTargetsValidation => {
  const hasIncomplete = extras.some(
    (r) => !!r.partid_selection.trim() !== !!r.process_id.trim()
  );
  const seen = new Set<string>();
  let hasDuplicate = false;
  [first, ...extras].forEach((r) => {
    const partid = r.partid_selection.trim();
    const processId = r.process_id.trim();
    if (!partid || !processId) return;
    const key = `${partid}|${processId}`;
    if (seen.has(key)) hasDuplicate = true;
    else seen.add(key);
  });
  return { hasIncomplete, hasDuplicate };
};
