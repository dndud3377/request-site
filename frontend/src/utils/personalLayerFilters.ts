// claude 수정 (2026-11-28): 개인 J/O 필터·색상 필터를 서버에서 불러오고, 브라우저에 남은 옛 목록을 자동으로 서버에 옮긴다
import { personalLayerFiltersAPI } from '../api/client';
import { ColorFilterSet, FilterSet, PersonalLayerFilterKind, PersonalLayerFilterResponse } from '../types';

/** 종류별 화면 타입 — 'filter' 는 STEP3/4 개인 필터, 'color' 는 결재 상세 색상 필터. */
export type PersonalLayerSet<K extends PersonalLayerFilterKind> = K extends 'color' ? ColorFilterSet : FilterSet;

/** 종전 localStorage 키 — 서버로 옮긴 뒤 지운다. */
export const PERSONAL_LAYER_LOCAL_KEYS = {
  filter: { J: 'jayerFilterSets', O: 'oayerFilterSets' },
  color: { J: 'jayerColorFilterSets', O: 'oayerColorFilterSets' },
} as const;

/** 서버 응답 한 건을 화면 타입으로 바꾼다. 화면은 id 를 문자열로 다루므로(Set<string> 등) String 으로 맞춘다. */
export const toPersonalLayerSet = <K extends PersonalLayerFilterKind>(
  r: PersonalLayerFilterResponse<K>,
): PersonalLayerSet<K> => ({ id: String(r.id), label: r.label, words: r.words } as PersonalLayerSet<K>);

export interface PersonalLayerLoadResult<K extends PersonalLayerFilterKind> {
  sets: PersonalLayerSet<K>[];
  /** 이번에 localStorage 에서 서버로 옮긴 필터 수(0 이면 옮길 것이 없었다). */
  migrated: number;
  /** 옮기기가 실패했다 — localStorage 는 지우지 않았으므로 다음에 다시 시도된다. */
  migrateFailed: boolean;
}

const readLocalItems = (key: string): { label: string; words: unknown }[] => {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is { label?: unknown; words?: unknown } => typeof e === 'object' && e !== null)
      .map((e) => ({ label: typeof e.label === 'string' ? e.label : '', words: e.words ?? {} }));
  } catch {
    return [];
  }
};

const removeLocal = (key: string) => {
  try { localStorage.removeItem(key); } catch { /* 저장소 접근 불가 — 서버 저장은 이미 끝났다 */ }
};

/**
 * 서버에서 내 목록을 불러온다. 브라우저 localStorage 에 옛 목록이 남아 있으면 서버 목록 **뒤에 덧붙여** 올리고
 * (여러 PC 에서 쓰던 목록을 잃지 않도록 — 중복은 사용자가 지운다, 사용자 결정 A), 성공한 뒤에만 localStorage 를 지운다.
 * 목록 조회 자체가 실패하면 throw 한다(호출부가 에러 토스트를 띄운다).
 */
export const loadPersonalLayerFilters = async <K extends PersonalLayerFilterKind>(
  kind: K,
  table: 'J' | 'O',
): Promise<PersonalLayerLoadResult<K>> => {
  const list = await personalLayerFiltersAPI.list(kind, table);
  const key = PERSONAL_LAYER_LOCAL_KEYS[kind][table];
  const items = readLocalItems(key);
  if (items.length === 0) {
    return { sets: list.map(toPersonalLayerSet), migrated: 0, migrateFailed: false };
  }
  try {
    const merged = await personalLayerFiltersAPI.importItems(
      kind, table, items as { label: string; words: PersonalLayerFilterResponse<K>['words'] }[],
    );
    removeLocal(key);
    return { sets: merged.map(toPersonalLayerSet), migrated: items.length, migrateFailed: false };
  } catch {
    return { sets: list.map(toPersonalLayerSet), migrated: 0, migrateFailed: true };
  }
};
