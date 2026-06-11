/**
 * 날짜 문자열을 한국 로캘(YYYY. M. D.) 형식으로 변환한다.
 * 값이 없으면 '-'를 반환한다.
 */
export const formatDate = (d: string | null): string =>
  d ? new Date(d).toLocaleDateString('ko-KR') : '-';
