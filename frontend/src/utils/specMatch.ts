/**
 * needle(숫자 문자열)이 haystack 안에 "숫자 경계"로 등장하는지 검사한다.
 * 즉 needle 바로 앞/뒤 글자가 숫자가 아닐 때만 일치로 본다.
 * (정규식 (?<!\d)needle(?!\d) 와 동일 — 예: "1.0"은 "1.0CDE"/"1.0" O, "15.0"/"1.05" X)
 * lookbehind 미지원 환경을 피하려고 indexOf 기반 수동 검사로 구현.
 */
export const numberBoundaryMatch = (haystack: string, needle: string): boolean => {
  if (!needle) return false;
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return false;
    const before = idx > 0 ? haystack[idx - 1] : '';
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length] : '';
    const beforeDigit = before >= '0' && before <= '9';
    const afterDigit = after >= '0' && after <= '9';
    if (!beforeDigit && !afterDigit) return true;
    from = idx + 1;
  }
  return false;
};
