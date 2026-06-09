import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  visible: boolean;
  remainingMs: number;
  onExtend: () => void;
  onLogout: () => void;
}

export default function SessionWarningModal({
  visible,
  remainingMs,
  onExtend,
  onLogout,
}: Props): React.ReactElement | null {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(Math.ceil(remainingMs / 1000));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) return;

    setCountdown(Math.ceil(remainingMs / 1000));

    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, remainingMs]);

  if (!visible) return null;

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>{t('session.warning_title')}</h2>
        <p style={styles.body}>{t('session.warning_body')}</p>
        <div style={styles.countdown}>{formatted}</div>
        <div style={styles.buttons}>
          <button style={styles.extendBtn} onClick={onExtend}>
            {t('session.extend')}
          </button>
          <button style={styles.logoutBtn} onClick={onLogout}>
            {t('session.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-lg)',
    padding: '40px 36px',
    width: '100%',
    maxWidth: 400,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  body: {
    fontSize: 14,
    color: 'var(--text-muted)',
    textAlign: 'center',
    margin: 0,
    lineHeight: 1.6,
  },
  countdown: {
    fontSize: 40,
    fontWeight: 800,
    color: 'var(--accent)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '2px',
    margin: '8px 0',
  },
  buttons: {
    display: 'flex',
    gap: 12,
    width: '100%',
    marginTop: 8,
  },
  extendBtn: {
    flex: 1,
    padding: '12px 0',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  logoutBtn: {
    flex: 1,
    padding: '12px 0',
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
