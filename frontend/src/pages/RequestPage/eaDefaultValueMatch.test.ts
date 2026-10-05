/**
 * 예외 구역 '변경 있음' + 기본값 판정(isEaDefaultValue) 단위 테스트.
 *
 * '변경 있음'인데 값이 기본값(일반 300 / C가문 500)과 같으면 상신을 막는다.
 * 표기가 달라도(300.0, 0300, 공백) 숫자로 같으면 같은 값으로 본다 — 백엔드
 * RequestDocument._ea_value_state 와 같은 기준이다.
 */
import { isEaDefaultValue } from './constants';

describe('isEaDefaultValue', () => {
  it('일반(300): 표기가 달라도 숫자로 같으면 true', () => {
    ['300', '300.0', '0300', ' 300 ', '+300', '300.00'].forEach((v) => {
      expect(isEaDefaultValue(v, 'No')).toBe(true);
    });
  });

  it('C가문(500): 500 은 true, 300 은 false', () => {
    expect(isEaDefaultValue('500', 'Yes')).toBe(true);
    expect(isEaDefaultValue('500.0', 'Yes')).toBe(true);
    expect(isEaDefaultValue('300', 'Yes')).toBe(false);
  });

  it('숫자로 다르면 false', () => {
    expect(isEaDefaultValue('350', 'No')).toBe(false);
    expect(isEaDefaultValue('300.5', 'No')).toBe(false);
    expect(isEaDefaultValue('500', 'No')).toBe(false);
  });

  it('빈 값·숫자가 아닌 값은 false', () => {
    expect(isEaDefaultValue('', 'No')).toBe(false);
    expect(isEaDefaultValue('   ', 'No')).toBe(false);
    expect(isEaDefaultValue(undefined, 'No')).toBe(false);
    expect(isEaDefaultValue('-', 'No')).toBe(false);
    expect(isEaDefaultValue('예외구역 A', 'No')).toBe(false);
  });
});
