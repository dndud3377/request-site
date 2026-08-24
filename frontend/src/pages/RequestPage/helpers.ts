import { FilterSet, ValidationSystemValue, MergePair, MergePairKind, MergeRowInfo, MergeTable, MergeUnmatchedRow, AdiCdStep } from '../../types';
import {
  VALIDATION_KEYWORD, NOC_NEW, NOC_BORROW, NOC_REGISTERED, NOC_LAYER_DELETE, ST_O, ST_X, isStO, genId, VS_NA, VS_TARGET,
  ADI_CD_HEADER_SCAN_ROWS, ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL, makeAdiCdStep,
  MERGE_MANUAL_FIELDS, MERGE_DEFAULT_TABLE,
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

/** 수동 비활성화 또는 활성 필터셋 매칭 시 disabled */
export const calcDisabled = (
  row: { manuallyDisabled: boolean; sp: string; sd: string; pp: string },
  filterSets: FilterSet[],
  activeIds: Set<string>
): boolean =>
  row.manuallyDisabled || filterSets.some(fs => activeIds.has(fs.id) && shouldDisableRow(fs.words, row));

/** 필터 키워드 초안 빈 값 */
export const emptyDraftWords = () => ({ sp: [] as string[], sd: [] as string[], pp: [] as string[] });

/**
 * {{request.partid_selection}}("-" 로 구분된 전체 제품 이름)에서 MAP 조회에 쓰는 8자리 코드를 뽑는다.
 * "-" 앞부분을 대문자화·8자 제한한다 — MapName.partid 코드(`_` 앞 8자, form_options_mapname 참조)와
 * 같은 규칙으로 맞춰야 매칭이 된다.
 */
export const sourceCodeFromPartid = (partidSelection: string): string =>
  (partidSelection.split('-')[0] || '').trim().toUpperCase().slice(0, 8);

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

/**
 * Backbone 조합 영역(STEP1) 입력이 **필수**인가.
 * J-layer 활성 행에 st 가 'O 계열'인 행이 하나라도 있으면 그 요청서는 BB 조합이 반드시 필요하다.
 * (O-layer 는 판정 근거가 아니다 — J-layer 표 하나만 본다.)
 */
export const requiresBbEntries = (
  jayerRows: { disabled: boolean; st: string }[]
): boolean => jayerRows.some((r) => !r.disabled && isStO(r.st));

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

/** 활성 행 중 st 또는 new_or_copy 가 공란인 행 id 목록 (J/O-ayer 공용) */
export const findEmptyStNocViolations = (
  rows: { id: string; disabled: boolean; st: string; new_or_copy: string }[]
): string[] =>
  rows
    .filter((r) => !r.disabled && (!r.st?.trim() || !r.new_or_copy?.trim()))
    .map((r) => r.id);

/** new_or_copy='차용' 활성 행 중 product_name·step 공란인 행 id 목록 (J/O-ayer 공용) */
export const findNocBorrowViolations = (
  rows: { id: string; disabled: boolean; new_or_copy: string; product_name: string; step: string }[]
): string[] =>
  rows
    .filter((r) => !r.disabled && r.new_or_copy === '차용' && (!r.product_name?.trim() || !r.step?.trim()))
    .map((r) => r.id);

/** new_or_copy='차용' 활성 행 중 item_id 공란인 행 id 목록 (item_id 는 J-ayer 전용 필드라 O-ayer 는 대상 아님) */
export const findNocBorrowItemIdViolations = (
  rows: { id: string; disabled: boolean; new_or_copy: string; item_id: string }[]
): string[] =>
  rows
    .filter((r) => !r.disabled && r.new_or_copy === '차용' && !r.item_id?.trim())
    .map((r) => r.id);

/**
 * Jayer/Oayer "요청 기준"(new_or_copy) 값을 근거로 이 요청서에 맞는 요청 목적을 계산한다.
 * 비활성 행은 제외한다. 신규 → '신규' / 차용 → '차용' / 둘 다 → '신규+차용' /
 * 기등록·layer삭제만 있으면 → '기타'. 판정할 활성 행이 아예 없으면 null(판정 불가).
 */
export const computeExpectedRequestPurpose = (
  jayerRows: { disabled: boolean; new_or_copy: string }[],
  oayerRows: { disabled: boolean; new_or_copy: string }[]
): string | null => {
  const activeNoc = [...jayerRows, ...oayerRows].filter((r) => !r.disabled).map((r) => r.new_or_copy);
  const hasNew = activeNoc.includes(NOC_NEW);
  const hasBorrow = activeNoc.includes(NOC_BORROW);
  if (hasNew && hasBorrow) return '신규+차용';
  if (hasNew) return NOC_NEW;
  if (hasBorrow) return NOC_BORROW;
  if (activeNoc.includes(NOC_REGISTERED) || activeNoc.includes(NOC_LAYER_DELETE)) return '기타';
  return null;
};

// ===== Layer 추가/삭제 Merge (참조 요청서 A ↔ 작성 중 요청서 B) =====

/** Merge 비교에 필요한 최소 형태 — JayerRow / OayerRow 양쪽을 받는다. */
export interface MergeComparableRow {
  id: string;
  sortOrder: number;
  disabled: boolean;
  manuallyDisabled: boolean;
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
  !r.disabled && r.new_or_copy !== NOC_LAYER_DELETE;

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
  // 비활성이 아닌 모든 행(layer삭제 포함). A 행을 추가할 때 같은 키가 이미 있으면 중복을 만들지 않는다.
  const curActiveKeys = new Set(curRows.filter((r) => !r.disabled).map(mergeKey));

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
      disabled: false,       // 필터에 걸려 숨겨지면 삭제 정보가 상신 시 누락되므로 항상 활성
      manuallyDisabled: false,
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
  disabled: boolean;
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
  !r.disabled && baNorm(r.layerid) !== '' && r.new_or_copy !== NOC_LAYER_DELETE;

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
  disabled: boolean;
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
  return !!row && (row.disabled || row.new_or_copy === NOC_REGISTERED);
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

/** 행 단위: 이 행의 pp 가 판정 키워드를 포함하는가 (셀 하이라이트·문서 판정 공용) */
export const isValidationKeywordRow = (pp: string | undefined): boolean =>
  !!pp && pp.toLowerCase().includes(VALIDATION_KEYWORD);

/**
 * 문서 단위: 활성 J-layer 행 중 하나라도 판정 키워드를 포함하면 Validation System 대상.
 * 비활성(disabled) 행은 상신 시 저장에서 제외되므로 판정에서도 제외한다.
 */
export const isValidationTarget = (
  rows: { disabled?: boolean; pp?: string }[]
): boolean => rows.some((r) => !r.disabled && isValidationKeywordRow(r.pp));

/**
 * 문서 단위 자동 판정값. 판정 키워드가 하나라도 있으면 '대상'(VS_TARGET),
 * 아예 없으면 판정이 성립하지 않으므로 '해당없음'(VS_NA).
 * '비대상'(VS_NONTARGET)은 자동 판정으로 나오지 않는다 — 키워드가 있는 문서에서
 * 상신자가 직접 토글했을 때만 나오며, 그 판단이 맞는지는 MASK(E)가 검증한다.
 */
export const autoValidationSystem = (
  rows: { disabled?: boolean; pp?: string }[]
): ValidationSystemValue => (isValidationTarget(rows) ? VS_TARGET : VS_NA);

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
