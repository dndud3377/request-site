import React from 'react';
import { useTranslation } from 'react-i18next';
import { Status, Priority } from '../types';

interface StatusBadgeProps {
  status: string;
}

interface PriorityBadgeProps {
  priority: Priority;
}

const STATUS_I18N_KEY: Record<string, string> = {
  draft: 'common.status_draft',
  submitted: 'common.status_submitted',
  under_review: 'common.status_under_review',
  approved: 'common.status_approved',
  rejected: 'common.status_rejected',
  revision_required: 'common.status_revision_required',
  open: 'voc.status_open',
  in_progress: 'voc.status_in_progress',
  resolved: 'voc.status_resolved',
  closed: 'voc.status_closed',
};

const PRIORITY_ICONS: Record<Priority, string> = {
  low: '▽',
  medium: '◇',
  high: '△',
  urgent: '⚠',
};

const PRIORITY_I18N_KEY: Record<Priority, string> = {
  low: 'common.priority_low',
  medium: 'common.priority_medium',
  high: 'common.priority_high',
  urgent: 'common.priority_urgent',
};

export default function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const i18nKey = STATUS_I18N_KEY[status];
  const label = i18nKey ? t(i18nKey as any) : status;

  return <span className={`badge badge-${status}`}>{label}</span>;
}

export function PriorityBadge({ priority }: PriorityBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const label = t(PRIORITY_I18N_KEY[priority] as any);
  const icon = PRIORITY_ICONS[priority];

  return (
    <span className={`priority-${priority}`} style={{ fontWeight: 600, fontSize: '0.85rem' }}>
      {icon} {label}
    </span>
  );
}
