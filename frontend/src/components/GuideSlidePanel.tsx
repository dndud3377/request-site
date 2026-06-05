import React, { useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { guidesAPI } from '../api/client';
import { Guide, GuideFeatureKey } from '../types';

interface Props {
  featureKey: GuideFeatureKey;
  featureTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

const GuideSlidePanel: React.FC<Props> = ({ featureKey, featureTitle, isOpen, onClose }) => {
  const { t } = useTranslation();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !featureKey) return;
    setLoading(true);
    guidesAPI
      .list({ feature_key: featureKey })
      .then((res) => {
        const results = res.data.results;
        setGuide(results.length > 0 ? results[0] : null);
      })
      .catch(() => setGuide(null))
      .finally(() => setLoading(false));
  }, [isOpen, featureKey]);

  // ESC 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 480,
            background: '#fff',
            boxShadow: '-6px 0 24px rgba(0,0,0,0.12)',
            zIndex: 400,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1.5px solid #e8ecf2',
          }}
        >
          {/* 헤더 */}
          <div
            style={{
              padding: '16px 20px',
              background: 'linear-gradient(135deg, #1a1a2e, #2d2d5e)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 18 }}>📖</span>
            <h3 style={{ flex: 1, fontSize: 15, fontWeight: 700, margin: 0 }}>
              {featureTitle}
            </h3>
            <button
              onClick={onClose}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>

          {/* 안내 */}
          <div
            style={{
              padding: '8px 20px',
              background: '#f7f9fc',
              borderBottom: '1px solid #e8ecf2',
              fontSize: 12,
              color: '#888',
              flexShrink: 0,
            }}
          >
            {t('guide.panel_hint')}
          </div>

          {/* 바디 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa', fontSize: 13 }}>
                {t('common.loading')}
              </div>
            ) : guide ? (
              <div
                className="guide-content-render"
                style={{ fontSize: 14, lineHeight: 1.85, color: '#333' }}
                dangerouslySetInnerHTML={{ __html: guide.content }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb' }}>
                <div style={{ fontSize: 42, marginBottom: 10 }}>📭</div>
                <div style={{ fontSize: 13 }}>{t('guide.no_content')}</div>
              </div>
            )}
          </div>

          {/* 하단 힌트 */}
          <div
            style={{
              padding: '9px 20px',
              background: '#fffbeb',
              borderTop: '1px solid #fde68a',
              fontSize: 11,
              color: '#92400e',
              flexShrink: 0,
            }}
          >
            💡 {t('guide.panel_form_hint')}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default GuideSlidePanel;
