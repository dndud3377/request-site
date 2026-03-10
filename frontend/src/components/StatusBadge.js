import React from 'react';
import { useTranslation } from 'react-i18next';

const STATUS_MAP = {
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

export default function StatusBadge({ status }) {
  const { t } = useTranslation();
  const label = STATUS_MAP[status] ? t(STATUS_MAP[status]) : status;

  return (
    <span className={`badge badge-${status}`}>
      {label}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const { t } = useTranslation();
  const labels = {
    low: t('common.priority_low'),
    medium: t('common.priority_medium'),
    high: t('common.priority_high'),
    urgent: t('common.priority_urgent'),
  };
  const icons = { low: '▽', medium: '◇', high: '△', urgent: '⚠' };

  return (
    <span className={`priority-${priority}`} style={{ fontWeight: 600, fontSize: '0.85rem' }}>
      {icons[priority]} {labels[priority]}
    </span>
  );
}
