/**
 * 날짜 문자열을 한국 로캘(YYYY. M. D.) 형식으로 변환한다.
 * 값이 없으면 '-'를 반환한다.
 */
export const formatDate = (d: string | null): string =>
  d ? new Date(d).toLocaleDateString('ko-KR') : '-';

/**
 * 날짜·시간 문자열을 한국 로캘(YYYY. M. D. HH:mm) 형식으로 변환한다.
 * 값이 없으면 '-'를 반환한다.
 */
export const formatDateTime = (d: string | null | undefined): string => {
  if (!d) return '-';
  const dt = new Date(d);
  const date = dt.toLocaleDateString('ko-KR');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
};

/**
 * 날짜 문자열에서 시:분만 추출한다(HH:mm). 값이 없으면 빈 문자열을 반환한다.
 */
export const formatTime = (d: string | null | undefined): string => {
  if (!d) return '';
  const dt = new Date(d);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};
