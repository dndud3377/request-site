import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import StatusBadge, { PriorityBadge } from '../components/StatusBadge';
import { RequestDocument, Stats } from '../types';

interface Feature {
  icon: string;
  titleKey: string;
  descKey: string;
}

const FEATURES: Feature[] = [
  { icon: '📝', titleKey: 'home.feature_1_title', descKey: 'home.feature_1_desc' },
  { icon: '🔍', titleKey: 'home.feature_2_title', descKey: 'home.feature_2_desc' },
  { icon: '📊', titleKey: 'home.feature_3_title', descKey: 'home.feature_3_desc' },
  { icon: '📧', titleKey: 'home.feature_4_title', descKey: 'home.feature_4_desc' },
];

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR');
};

export default function HomePage(): React.ReactElement {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Stats>({ total: 0, by_status: {} });
  const [recent, setRecent] = useState<RequestDocument[]>([]);

  useEffect(() => {
    documentsAPI.stats().then((r) => setStats(r.data)).catch(() => {});
    documentsAPI.list({ page_size: '5' }).then((r) => {
      const data = r.data;
      setRecent(Array.isArray(data) ? data : (data as any).results ?? []);
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
        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">{t('home.stat_total')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.by_status['submitted'] ?? 0}</div>
            <div className="stat-label">{t('home.stat_submitted')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.by_status['approved'] ?? 0}</div>
            <div className="stat-label">{t('home.stat_approved')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">
              {(stats.by_status['submitted'] ?? 0) + (stats.by_status['under_review'] ?? 0)}
            </div>
            <div className="stat-label">{t('home.stat_pending')}</div>
          </div>
        </div>

        {/* Features */}
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.icon} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-title">{t(f.titleKey as any)}</div>
              <div className="feature-desc">{t(f.descKey as any)}</div>
            </div>
          ))}
        </div>

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
              <Link to="/history" className="btn btn-secondary btn-sm">
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
