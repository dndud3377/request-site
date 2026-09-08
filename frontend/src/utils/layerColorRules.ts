import { PersonalColorRule } from '../types';

/**
 * 결재 상세페이지 J/O-layer "색상적용" 기능의 로컬 저장소 유틸.
 *
 * 공유 필터(LayerFilterSet, 서버 저장)와 달리 규칙 정의와 적용 결과 모두 이 브라우저에만
 * 저장되는 개인용 기능이다 — 서버로 전송하지 않으며 다른 사용자에게 보이지 않는다.
 */

export type CellColorField = 'sp' | 'sd' | 'pp';
/** rowId -> 필드별 적용된 색상(hex) */
export type CellColorMap = Record<string, Partial<Record<CellColorField, string>>>;

const rulesKey = (table: 'J' | 'O') => `layerColorRules_${table}`;
const appliedKey = (table: 'J' | 'O', docId: number) => `layerColorApplied_${table}_${docId}`;

export const loadColorRules = (table: 'J' | 'O'): PersonalColorRule[] => {
  try {
    const raw = localStorage.getItem(rulesKey(table));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveColorRules = (table: 'J' | 'O', rules: PersonalColorRule[]): void => {
  try {
    localStorage.setItem(rulesKey(table), JSON.stringify(rules));
  } catch { /* noop — localStorage 사용 불가 환경(사생활 보호 모드 등)이면 조용히 무시 */ }
};

export const loadAppliedColors = (table: 'J' | 'O', docId: number): CellColorMap => {
  try {
    const raw = localStorage.getItem(appliedKey(table, docId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const saveAppliedColors = (table: 'J' | 'O', docId: number, map: CellColorMap): void => {
  try {
    localStorage.setItem(appliedKey(table, docId), JSON.stringify(map));
  } catch { /* noop */ }
};

export const clearAppliedColors = (table: 'J' | 'O', docId: number): void => {
  try {
    localStorage.removeItem(appliedKey(table, docId));
  } catch { /* noop */ }
};

/**
 * 행의 sp/sd/pp 중 규칙 키워드(대소문자 무관, 부분 일치)와 매칭되는 필드 목록을 반환한다.
 * 공유 필터의 매칭 로직(백엔드 apply_layer_filter)과 동일한 기준이나, 어느 필드가 매칭됐는지도
 * 함께 반환해 그 필드의 셀만 색칠할 수 있게 한다.
 */
export const matchColorFields = (
  row: { sp?: string; sd?: string; pp?: string },
  words: { sp: string[]; sd: string[]; pp: string[] }
): CellColorField[] => {
  const fields: CellColorField[] = [];
  (['sp', 'sd', 'pp'] as CellColorField[]).forEach((field) => {
    const val = (row[field] || '').toLowerCase();
    const keywords = words[field] || [];
    if (keywords.some((kw) => kw && val.includes(kw.toLowerCase()))) {
      fields.push(field);
    }
  });
  return fields;
};
