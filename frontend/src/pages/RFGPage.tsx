import React from 'react';
import { useTranslation } from 'react-i18next';

export default function RFGPage(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('rfg.title')}</h1>
      </div>
    </div>
  );
}
