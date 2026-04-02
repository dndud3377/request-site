import React from 'react';
import { useTranslation } from 'react-i18next';

interface StatusBadgeProps {
  status: string;
}

const STATUS_I18N_KEY: Record<string, string> = {
  draft: 'common.status_draft',
  submitted: 'common.status_submitted',
  under_review: 'common.status_under_review',
  approved: 'common.status_approved',
  rejected: 'common.status_rejected',
  open: 'voc.status_open',
  in_progress: 'voc.status_in_progress',
  resolved: 'voc.status_resolved',
  closed: 'voc.status_closed',
};

export default function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const i18nKey = STATUS_I18N_KEY[status];
  const label = i18nKey ? t(i18nKey as any) : status;

  return <span className={`badge badge-${status}`}>{label}</span>;
}
