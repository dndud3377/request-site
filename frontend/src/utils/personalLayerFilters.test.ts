// claude 수정 (2026-11-28): 개인 J/O 필터·색상 필터 서버 조회 + localStorage 자동 이전 검증
import { personalLayerFiltersAPI } from '../api/client';
import { loadPersonalLayerFilters } from './personalLayerFilters';

jest.mock('../api/client', () => ({
  personalLayerFiltersAPI: { list: jest.fn(), importItems: jest.fn() },
}));

const api = personalLayerFiltersAPI as unknown as { list: jest.Mock; importItems: jest.Mock };

const serverRow = (id: number, label: string) => ({
  id, kind: 'color', table: 'J', label, words: { sp: [{ word: 'a', color: '#FF0000' }], sd: [], pp: [] }, created_at: '',
});

describe('loadPersonalLayerFilters', () => {
  beforeEach(() => {
    localStorage.clear();
    api.list.mockReset();
    api.importItems.mockReset();
  });

  it('localStorage 가 비어 있으면 서버 목록만 돌려주고 import 를 부르지 않는다(id 는 문자열)', async () => {
    api.list.mockResolvedValue([serverRow(3, '서버')]);
    const r = await loadPersonalLayerFilters('color', 'J');
    expect(api.list).toHaveBeenCalledWith('color', 'J');
    expect(api.importItems).not.toHaveBeenCalled();
    expect(r).toEqual({ sets: [{ id: '3', label: '서버', words: serverRow(3, '').words }], migrated: 0, migrateFailed: false });
  });

  it('서버에 이미 목록이 있어도 localStorage 목록을 순서대로 덧붙여 올리고, 성공하면 localStorage 를 지운다', async () => {
    localStorage.setItem('jayerColorFilterSets', JSON.stringify([
      { id: '1', label: '로컬1', words: { sp: [], sd: [], pp: [] } },
      { id: '2', label: '로컬2', words: { sp: [], sd: [], pp: [] } },
    ]));
    api.list.mockResolvedValue([serverRow(3, '서버')]);
    api.importItems.mockResolvedValue([serverRow(3, '서버'), serverRow(4, '로컬1'), serverRow(5, '로컬2')]);
    const r = await loadPersonalLayerFilters('color', 'J');
    expect(api.importItems).toHaveBeenCalledWith('color', 'J', [
      { label: '로컬1', words: { sp: [], sd: [], pp: [] } },
      { label: '로컬2', words: { sp: [], sd: [], pp: [] } },
    ]);
    expect(r.sets.map((s) => s.label)).toEqual(['서버', '로컬1', '로컬2']);
    expect(r.migrated).toBe(2);
    expect(localStorage.getItem('jayerColorFilterSets')).toBeNull();
  });

  it('이전이 실패하면 localStorage 를 남기고(다음에 재시도) 서버 목록과 실패 표시를 돌려준다', async () => {
    localStorage.setItem('oayerFilterSets', JSON.stringify([{ id: '1', label: '로컬', words: { sp: ['x'], sd: [], pp: [] } }]));
    api.list.mockResolvedValue([]);
    api.importItems.mockRejectedValue(new Error('network'));
    const r = await loadPersonalLayerFilters('filter', 'O');
    expect(r).toEqual({ sets: [], migrated: 0, migrateFailed: true });
    expect(localStorage.getItem('oayerFilterSets')).not.toBeNull();
  });

  it('localStorage 값이 깨져 있으면 옮길 것이 없는 것으로 본다', async () => {
    localStorage.setItem('jayerFilterSets', '{not json');
    api.list.mockResolvedValue([]);
    const r = await loadPersonalLayerFilters('filter', 'J');
    expect(api.importItems).not.toHaveBeenCalled();
    expect(r.migrated).toBe(0);
  });

  it('목록 조회가 실패하면 throw 한다(호출부가 에러 토스트)', async () => {
    api.list.mockRejectedValue(new Error('down'));
    await expect(loadPersonalLayerFilters('color', 'O')).rejects.toThrow('down');
  });
});
