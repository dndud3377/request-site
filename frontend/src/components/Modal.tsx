import React, { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  topLevel?: boolean;
  style?: React.CSSProperties;
  hideFullscreen?: boolean;
}

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  topLevel?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  topLevel = false,
  style,
  hideFullscreen = false,
}: ModalProps): React.ReactElement | null {
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (!isOpen) return null;

  const modalClass = [
    'modal',
    size === 'xl' ? 'modal-xl' : size === 'lg' ? 'modal-lg' : size === 'sm' ? 'modal-sm' : '',
    isFullscreen ? 'modal-fullscreen' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="modal-overlay" style={topLevel ? { zIndex: 3000 } : undefined}>
      <div className={modalClass} style={isFullscreen ? undefined : style}>
        <div className="modal-header">
          <h3>{title}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {!hideFullscreen && (
              <button
                className="modal-close"
                onClick={() => setIsFullscreen((v) => !v)}
                style={{ fontSize: '0.75rem' }}
              >
                {isFullscreen ? '⊠ 창 복원' : '⛶ 전체화면'}
              </button>
            )}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  danger = false,
  loading = false,
  topLevel = false,
}: ConfirmModalProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      hideFullscreen
      topLevel={topLevel}
      style={{ maxWidth: '420px' }}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => { onConfirm(); onClose(); }}
            disabled={loading}
          >
            {loading ? t('common.loading') : (confirmLabel || t('common.confirm'))}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{message}</p>
    </Modal>
  );
}
