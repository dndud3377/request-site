import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { loginSSO } = useAuth();

  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInactive = new URLSearchParams(window.location.search).get('reason') === 'inactive';

  const handleSSO = async () => {
    setSsoLoading(true);
    setError(null);
    try {
      await loginSSO();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('login.error_sso'));
      setSsoLoading(false);
    }
  };

  return (
    <div style={styles.root}>
      {/* 언어 전환 */}
      <div style={styles.langBar}>
        <button
          style={{ ...styles.langBtn, ...(i18n.language === 'ko' ? styles.langBtnActive : {}) }}
          onClick={() => i18n.changeLanguage('ko')}
        >
          KO
        </button>
        <button
          style={{ ...styles.langBtn, ...(i18n.language === 'en' ? styles.langBtnActive : {}) }}
          onClick={() => i18n.changeLanguage('en')}
        >
          EN
        </button>
      </div>

      <div style={styles.card}>
        {/* 로고 */}
        <div style={styles.logoWrap}>
          <div style={styles.logoIcon}>🗺️</div>
          <span style={styles.logoText}>ProductMap</span>
        </div>

        {/* 제목 */}
        <h1 style={styles.title}>
          {t('login.title').split('\n').map((line, i) => (
            <React.Fragment key={i}>{line}{i === 0 && <br />}</React.Fragment>
          ))}
        </h1>
        <p style={styles.subtitle}>{t('login.subtitle')}</p>

        {/* 비활동 로그아웃 안내 */}
        {isInactive && (
          <div style={styles.inactiveNotice}>
            {t('login.inactive_logout')}
          </div>
        )}

        {/* 에러 메시지 */}
        {error && <div style={styles.errorMsg}>{error}</div>}

        {/* SSO 로그인 버튼 */}
        <button
          style={{ ...styles.ssoBtn, ...(ssoLoading ? styles.btnDisabled : {}) }}
          onClick={handleSSO}
          disabled={ssoLoading}
        >
          {ssoLoading ? (
            <span style={styles.btnInner}>
              <span style={styles.spinner} />
              {t('login.logging_in')}
            </span>
          ) : (
            <span style={styles.btnInner}>
              <CompanyIcon />
              {t('login.btn')}
            </span>
          )}
        </button>

        <p style={styles.hint}>{t('login.hint')}</p>
      </div>

      <p style={styles.footer}>
        © 2026 Product Introduction Map Request System
      </p>
    </div>
  );
}

function CompanyIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-primary)',
    padding: '24px 16px',
    position: 'relative',
  },
  langBar: {
    position: 'absolute',
    top: 20,
    right: 24,
    display: 'flex',
    gap: 4,
  },
  langBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'var(--transition)',
  },
  langBtnActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: '#fff',
  },
  card: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-lg)',
    padding: '48px 40px 40px',
    width: '100%',
    maxWidth: 420,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
  },
  logoWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 28,
  },
  logoIcon: {
    fontSize: 32,
    lineHeight: 1,
  },
  logoText: {
    fontSize: 22,
    fontWeight: 800,
    color: 'var(--accent)',
    letterSpacing: '-0.5px',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 1.4,
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--text-muted)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 1.6,
  },
  inactiveNotice: {
    width: '100%',
    background: 'rgba(var(--accent-rgb, 99, 102, 241), 0.08)',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--accent)',
    textAlign: 'center',
    marginBottom: 16,
  },
  errorMsg: {
    width: '100%',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid #ef4444',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    fontSize: 13,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
  },
  ssoBtn: {
    width: '100%',
    padding: '14px 24px',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'var(--transition)',
    boxShadow: '0 2px 8px var(--accent-glow)',
    marginBottom: 0,
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  btnInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  spinner: {
    display: 'inline-block',
    width: 16,
    height: 16,
    border: '2px solid rgba(255,255,255,0.4)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-disabled)',
    textAlign: 'center',
    marginTop: 20,
  },
  footer: {
    marginTop: 32,
    fontSize: 12,
    color: 'var(--text-disabled)',
  },
};
