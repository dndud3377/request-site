import { FilterSet, ValidationSystemValue, MergePair, MergeRowInfo, MergeTable, MergeUnmatchedRow, AdiCdStep } from '../../types';
import {
  VALIDATION_KEYWORD, NOC_NEW, NOC_REGISTERED, NOC_LAYER_DELETE, ST_O, ST_X, genId, VS_NA, VS_TARGET,
  ADI_CD_HEADER_SCAN_ROWS, ADI_CD_STEP_ID_LABEL, ADI_CD_STEP_DESC_LABEL,
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

/** new_or_copy='차용' 활성 행 중 product_name·step 공란인 행 id 목록 (J/O-ayer 공용) */
export const findNocBorrowViolations = (
  rows: { id: string; disabled: boolean; new_or_copy: string; product_name: string; step: string }[]
): string[] =>
  rows
    .filter((r) => !r.disabled && r.new_or_copy === '차용' && (!r.product_name?.trim() || !r.step?.trim()))
    .map((r) => r.id);

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
 * | ③    | A·B 양쪽 존재 | X | 기등록 |
 *
 * 비활성 행과 이미 layer삭제 인 행은 건드리지 않는다.
 */
export const computeLayerMerge = <T extends MergeComparableRow>(
  curRows: T[],
  refRows: T[]
): { merged: T[]; stats: MergeStats } => {
  const refPresentKeys = new Set(refRows.filter(isMergePresent).map(mergeKey));
  const curPresentKeys = new Set(curRows.filter(isMergePresent).map(mergeKey));
  // 비활성이 아닌 모든 행(layer삭제 포함). A 행을 추가할 때 같은 키가 이미 있으면 중복을 만들지 않는다.
  const curActiveKeys = new Set(curRows.filter((r) => !r.disabled).map(mergeKey));

  const stats: MergeStats = { added: 0, registered: 0, deleted: 0 };

  const merged: T[] = curRows.map((r) => {
    if (!isMergePresent(r)) return r; // 비활성 / 이미 layer삭제 → 유지
    if (refPresentKeys.has(mergeKey(r))) {
      stats.registered += 1;
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

/** 비활성 행과 layerid 가 빈 행은 비교 대상이 아니다. */
const baTarget = (r: BaComparableRow): boolean => !r.disabled && baNorm(r.layerid) !== '';

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
  /** 2열 + 헤더 인식 성공만 즉시 적용, 그 외(3열 이상 또는 헤더 인식 실패)는 컬럼 매핑 모달이 필요하다. */
  needsModal: boolean;
}

/** 붙여넣은 표를 즉시 적용할지, 컬럼 매핑 모달을 띄울지 판정한다. */
export const decideAdiCdPaste = (grid: string[][]): AdiCdPasteDecision => {
  const columnCount = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const header = detectAdiCdHeader(grid);
  return { header, columnCount, needsModal: columnCount > 2 || !header };
};

/**
 * 헤더 행 아래(또는 지정한 시작 행부터) STEP_ID/STEP_DESC 두 열만 취해 `.trim()` 하고,
 * 두 값이 모두 빈 행은 드롭한다. 나머지 열은 전부 버린다.
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
    if (!step_id && !step_desc) continue;
    rows.push({ id: genId(), step_id, step_desc });
  }
  return rows;
};

export interface AdiCdValidationResult {
  /** STEP_ID/STEP_DESC 중 한쪽만 채워진 행 id */
  incompleteIds: string[];
  /** STEP_ID 가 다른 행과 중복된 행 id */
  duplicateIds: string[];
  /** 두 값이 모두 채워진 행 수 (완전히 빈 행은 세지 않는다) */
  validCount: number;
}

/** 게이트 통과 조건 3가지(유효 행 1개 이상 / 불완전 행 0개 / STEP_ID 중복 0개)를 판정한다. */
export const validateAdiCdRows = (rows: AdiCdStep[]): AdiCdValidationResult => {
  const incompleteIds: string[] = [];
  const duplicateIds: string[] = [];
  let validCount = 0;
  const idRowsById = new Map<string, string[]>();

  rows.forEach((r) => {
    const id = r.step_id.trim();
    const desc = r.step_desc.trim();
    if (!id && !desc) return; // 완전히 빈 행은 세지 않는다
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
