import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import StatusBadge, { PriorityBadge } from '../components/StatusBadge';
import { RequestDocument } from '../types';

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR');
};

export default function HomePage(): React.ReactElement {
  const { t } = useTranslation();
  const [recent, setRecent] = useState<RequestDocument[]>([]);

  useEffect(() => {
    documentsAPI.list({}).then((r) => {
      const data = r.data;
      const all: RequestDocument[] = Array.isArray(data) ? data : (data as any).results ?? [];
      setRecent(all.filter((d) => d.status !== 'approved').slice(0, 5));
    }).catch(() => {});
  }, []);

  return (
    <div>
      {/* Hero */}
      <div className="hero">
        <div className="hero-grid" />
        <div className="container">
          <div className="hero-content">
            <div className="hero-badge">🗺️ Product Introduction Map System</div>
            <h1>
              <span className="highlight">{t('home.hero_title')}</span>
            </h1>
            <p className="hero-subtitle">{t('home.hero_subtitle')}</p>
            <p className="hero-desc">{t('home.hero_desc')}</p>
            <div className="hero-actions">
              <Link to="/request" className="btn btn-primary btn-lg">
                ✏️ {t('home.start_request')}
              </Link>
              <Link to="/approval" className="btn btn-secondary btn-lg">
                📋 {t('home.view_status')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="container page">
        {/* Recent */}
        {recent.length > 0 && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <h2 className="section-title">{t('home.recent_title')}</h2>
              <Link to="/approval" className="btn btn-secondary btn-sm">
                {t('home.view_all')} →
              </Link>
            </div>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('approval.col_title')}</th>
                    <th>{t('approval.col_product')}</th>
                    <th>{t('approval.col_requester')}</th>
                    <th>{t('approval.col_status')}</th>
                    <th>{t('approval.col_priority')}</th>
                    <th>{t('approval.col_submitted')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((doc) => (
                    <tr key={doc.id}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        {doc.title}
                      </td>
                      <td>{doc.product_name}</td>
                      <td>{doc.requester_name}</td>
                      <td>
                        <StatusBadge status={doc.status} />
                      </td>
                      <td>
                        <PriorityBadge priority={doc.priority} />
                      </td>
                      <td>{formatDate(doc.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
