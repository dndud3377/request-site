// claude 수정 (2026-10-29): 결재현황·홈 MAP 목적 칸의 '예정 → 완료' 뱃지를 한 곳에서 판정하도록 신규 추가
import React from 'react';
import { useTranslation } from 'react-i18next';

/** 서버가 내려주는 예정일 형식(YYYY-MM-DD). 뱃지에는 MM/DD 만 보인다. */
const ISO_DATE_PATTERN = /^\d{4}-(\d{2})-(\d{2})$/;

interface MapPurposeBadgeProps {
  /** POP3 완료 알림 메일 매칭 여부(`mail_completion_matched`) */
  completed?: boolean;
  /** 가장 가까운 미래 예정일(`map_scheduled_date`, YYYY-MM-DD) */
  scheduledDate?: string | null;
}

/**
 * MAP 목적 칸 아래 줄 뱃지. 한 번에 하나만 보인다 — 완료가 예정보다 우선한다.
 * 예정은 보라 테두리만, 완료는 보라 채움(docs/MAP_COMPLETION_MAIL.md §6).
 */
export default function MapPurposeBadge({ completed, scheduledDate }: MapPurposeBadgeProps): React.ReactElement | null {
  const { t } = useTranslation();

  if (completed) {
    return (
      <span className="badge badge-mail-complete" title={t('approval.map_mail_complete_badge_tooltip')}>
        {t('approval.map_mail_complete_badge')}
      </span>
    );
  }

  const match = scheduledDate ? ISO_DATE_PATTERN.exec(scheduledDate) : null;
  if (!match) return null;
  const [, month, day] = match;
  return (
    <span
      className="badge badge-mail-scheduled"
      title={t('approval.map_scheduled_badge_tooltip', { date: scheduledDate })}
    >
      {t('approval.map_scheduled_badge', { date: `${month}/${day}` })}
    </span>
  );
}
