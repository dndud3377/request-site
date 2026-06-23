export const NOTICE_HIDE_UNTIL_KEY = 'notice_hide_until';
export const NOTICE_LAST_SEEN_UPDATED_AT_KEY = 'notice_last_seen_updated_at';

/** hide 기간이 유효하고 공지 내용이 변경되지 않았으면 false (모달 억제) */
export function shouldShowNotice(latestUpdatedAt: string): boolean {
  const hideUntil = localStorage.getItem(NOTICE_HIDE_UNTIL_KEY);
  const lastSeen = localStorage.getItem(NOTICE_LAST_SEEN_UPDATED_AT_KEY) ?? '';
  const hideActive = !!hideUntil && new Date() < new Date(hideUntil);
  const contentChanged = latestUpdatedAt > lastSeen;
  return !hideActive || contentChanged;
}

/** 모달 닫을 때 localStorage 갱신 */
export function markNoticeSeen(latestUpdatedAt: string, hideToday: boolean): void {
  if (hideToday) {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    localStorage.setItem(NOTICE_HIDE_UNTIL_KEY, endOfToday.toISOString());
  } else {
    localStorage.removeItem(NOTICE_HIDE_UNTIL_KEY);
  }
  if (latestUpdatedAt) {
    localStorage.setItem(NOTICE_LAST_SEEN_UPDATED_AT_KEY, latestUpdatedAt);
  }
}
