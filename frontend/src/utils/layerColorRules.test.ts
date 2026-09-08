import {
  loadColorRules, saveColorRules, loadAppliedColors, saveAppliedColors, clearAppliedColors, matchColorFields,
} from './layerColorRules';
import { PersonalColorRule } from '../types';

describe('matchColorFields', () => {
  const words = { sp: ['SP01'], sd: [], pp: ['plel'] };

  it('키워드가 포함된 필드만 반환한다(대소문자 무관, 부분 일치)', () => {
    expect(matchColorFields({ sp: 'sp01_a', sd: 'X', pp: 'ABC' }, words)).toEqual(['sp']);
    expect(matchColorFields({ sp: 'X', sd: 'X', pp: 'xx-PLEL-01' }, words)).toEqual(['pp']);
    expect(matchColorFields({ sp: 'SP01', sd: 'X', pp: 'PLEL' }, words)).toEqual(['sp', 'pp']);
  });

  it('매칭되는 필드가 없으면 빈 배열을 반환한다', () => {
    expect(matchColorFields({ sp: 'X', sd: 'X', pp: 'Y' }, words)).toEqual([]);
  });

  it('키워드가 비어 있으면 매칭되지 않는다', () => {
    expect(matchColorFields({ sp: 'anything', sd: '', pp: '' }, { sp: [], sd: [], pp: [] })).toEqual([]);
  });
});

describe('localStorage 저장/조회', () => {
  beforeEach(() => localStorage.clear());

  it('규칙이 없으면 빈 배열을 반환한다', () => {
    expect(loadColorRules('J')).toEqual([]);
  });

  it('규칙을 저장하고 다시 읽을 수 있다', () => {
    const rules: PersonalColorRule[] = [
      { id: '1', label: '테스트', words: { sp: ['A'], sd: [], pp: [] }, color: '#ffeb3b' },
    ];
    saveColorRules('J', rules);
    expect(loadColorRules('J')).toEqual(rules);
    expect(loadColorRules('O')).toEqual([]); // 테이블별로 분리 저장됨
  });

  it('적용 결과가 없으면 빈 객체를 반환한다', () => {
    expect(loadAppliedColors('J', 1)).toEqual({});
  });

  it('적용 결과를 저장/조회/삭제할 수 있다', () => {
    saveAppliedColors('J', 1, { row1: { pp: '#ff0000' } });
    expect(loadAppliedColors('J', 1)).toEqual({ row1: { pp: '#ff0000' } });
    expect(loadAppliedColors('J', 2)).toEqual({}); // 문서별로 분리 저장됨
    clearAppliedColors('J', 1);
    expect(loadAppliedColors('J', 1)).toEqual({});
  });

  it('손상된 JSON이 저장돼 있어도 예외 없이 빈 값을 반환한다', () => {
    localStorage.setItem('layerColorRules_J', '{broken');
    expect(loadColorRules('J')).toEqual([]);
    localStorage.setItem('layerColorApplied_J_1', '{broken');
    expect(loadAppliedColors('J', 1)).toEqual({});
  });
});
