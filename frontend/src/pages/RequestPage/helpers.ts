import { FilterSet } from '../../types';

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
