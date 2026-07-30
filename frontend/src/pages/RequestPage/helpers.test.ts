import { isValidationKeywordRow, isValidationTarget } from './helpers';

describe('isValidationKeywordRow', () => {
  it('pp 가 판정 키워드를 포함하면 true', () => {
    expect(isValidationKeywordRow('PLEL')).toBe(true);
    expect(isValidationKeywordRow('xx-plel-01')).toBe(true);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(isValidationKeywordRow('PlEl')).toBe(true);
  });

  it('키워드가 없거나 값이 비어 있으면 false', () => {
    expect(isValidationKeywordRow('ABC')).toBe(false);
    expect(isValidationKeywordRow('')).toBe(false);
    expect(isValidationKeywordRow(undefined)).toBe(false);
  });
});

describe('isValidationTarget', () => {
  it('활성 행 중 하나라도 키워드를 포함하면 대상', () => {
    expect(isValidationTarget([{ pp: 'ABC' }, { pp: 'PLEL' }])).toBe(true);
  });

  it('비활성 행은 판정에서 제외한다', () => {
    expect(isValidationTarget([{ pp: 'PLEL', disabled: true }])).toBe(false);
  });

  it('활성 행에 키워드가 없으면 비대상', () => {
    expect(isValidationTarget([{ pp: 'ABC' }, { pp: 'DEF', disabled: true }])).toBe(false);
  });

  it('빈 배열이면 비대상', () => {
    expect(isValidationTarget([])).toBe(false);
  });

  it('pp 가 없는 행도 안전하게 처리한다', () => {
    expect(isValidationTarget([{}, { pp: undefined }])).toBe(false);
  });
});
