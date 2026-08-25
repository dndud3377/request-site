import React, { ReactNode, createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 모달의 전체화면 상태를 자식 컴포넌트에서도 읽고 바꿀 수 있게 하는 Context.
 * 화면을 이미지로 캡처하기 전에(예: export) 잠깐 전체화면으로 강제 전환했다가
 * 캡처 후 원래 상태로 되돌리는 용도로 쓴다. Modal 바깥에서 쓰면 no-op 기본값이 반환된다.
 */
interface ModalFullscreenState {
  isFullscreen: boolean;
  setIsFullscreen: (value: boolean) => void;
}
const ModalFullscreenContext = createContext<ModalFullscreenState>({
  isFullscreen: false,
  setIsFullscreen: () => {},
});
export const useModalFullscreen = (): ModalFullscreenState => useContext(ModalFullscreenContext);

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** 제목 오른쪽, 닫기/전체화면 버튼 왼쪽에 끼워 넣는 커스텀 영역(예: 전체 export 버튼). */
  titleExtra?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  topLevel?: boolean;
  style?: React.CSSProperties;
  /** 본문(.modal-body)에만 덧입히는 스타일. 공용 CSS 를 건드리지 않고 이 모달의 높이만 조절할 때 쓴다. */
  bodyStyle?: React.CSSProperties;
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
  titleExtra,
  children,
  footer,
  size = 'md',
  topLevel = false,
  style,
  bodyStyle,
  hideFullscreen = false,
}: ModalProps): React.ReactElement | null {
  const { t } = useTranslation();
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {titleExtra}
            {!hideFullscreen && (
              <button
                className="modal-close"
                onClick={() => setIsFullscreen((v) => !v)}
                style={{ fontSize: '0.75rem' }}
              >
                {isFullscreen ? `⊠ ${t('common.exit_fullscreen')}` : `⛶ ${t('common.enter_fullscreen')}`}
              </button>
            )}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        {/* 전체화면일 때는 본문이 화면을 꽉 채워야 하므로 개별 높이 지정을 무시한다. */}
        <div className="modal-body" style={isFullscreen ? undefined : bodyStyle}>
          <ModalFullscreenContext.Provider value={{ isFullscreen, setIsFullscreen }}>
            {children}
          </ModalFullscreenContext.Provider>
        </div>
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
