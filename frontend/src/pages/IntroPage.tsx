import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

interface ProcessStep {
  icon: string;
  titleKey: string;
  descKey: string;
}

interface GuideItem {
  titleKey: string;
  descKey: string;
}

const PROCESS_STEPS: ProcessStep[] = [
  { icon: '✏️', titleKey: 'intro.process_1', descKey: 'intro.process_1_desc' },
  { icon: '📤', titleKey: 'intro.process_2', descKey: 'intro.process_2_desc' },
  { icon: '✅', titleKey: 'intro.process_3', descKey: 'intro.process_3_desc' },
  { icon: '🗺️', titleKey: 'intro.process_4', descKey: 'intro.process_4_desc' },
];

const GUIDES: GuideItem[] = [
  { titleKey: 'intro.guide_1_title', descKey: 'intro.guide_1_desc' },
  { titleKey: 'intro.guide_2_title', descKey: 'intro.guide_2_desc' },
  { titleKey: 'intro.guide_3_title', descKey: 'intro.guide_3_desc' },
  { titleKey: 'intro.guide_4_title', descKey: 'intro.guide_4_desc' },
];

export default function IntroPage(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('intro.title')}</h1>
        <p>{t('intro.subtitle')}</p>
      </div>

      {/* What is */}
      <div className="card card-accent" style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 14, color: 'var(--accent)' }}>
          🗺️ {t('intro.what_title')}
        </h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, fontSize: '0.95rem' }}>
          {t('intro.what_desc')}
        </p>
      </div>

      {/* Process */}
      <div style={{ marginBottom: 56 }}>
        <h2 className="section-title" style={{ marginBottom: 32 }}>{t('intro.process_title')}</h2>
        <div className="process-grid">
          {PROCESS_STEPS.map((p) => (
            <div key={p.icon} className="process-step">
              <div className="process-number">{p.icon}</div>
              <div className="process-step-title">{t(p.titleKey as any)}</div>
              <div className="process-step-desc">{t(p.descKey as any)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Guide */}
      <div style={{ marginBottom: 48 }}>
        <h2 className="section-title" style={{ marginBottom: 24 }}>{t('intro.guide_title')}</h2>
        <div className="guide-grid">
          {GUIDES.map((g, i) => (
            <div key={i} className="guide-card">
              <div className="guide-number">{i + 1}</div>
              <div className="guide-content">
                <h4>{t(g.titleKey as any)}</h4>
                <p>{t(g.descKey as any)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div
        style={{
          textAlign: 'center',
          padding: '48px 24px',
          background: 'linear-gradient(135deg, var(--bg-card), var(--bg-secondary))',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border)',
        }}
      >
        <h3 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 12 }}>
          지금 바로 의뢰해보세요
        </h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          간단한 양식 작성만으로 제품 소개 지도 제작을 의뢰할 수 있습니다.
        </p>
        <Link to="/request" className="btn btn-primary btn-lg">
          ✏️ {t('nav.request')}
        </Link>
      </div>
    </div>
  );
}
