// claude 수정 (2026-11-10): '숫자 확인 필수' 사진 증빙 입력 신설 — M-shot 붙여넣기 칸(MshotImageUpload)과 같은 방식을 여러 칸으로 확장
import React from 'react';
import { useTranslation } from 'react-i18next';
import { NUM_CHECK_PP_KEYWORD } from '../constants';

/** 붙여넣기 대상 — 이미 첨부된 사진의 순번(교체) 또는 null(빈 칸 → 새 사진 추가) */
export type NumCheckPasteTarget = number | null;

interface NumCheckImageUploadProps {
  /** 첨부된 사진 경로 목록(detail.num_check_images) */
  images: string[];
  /** 사진 뒤에 보여줄 빈 붙여넣기 칸 수 */
  emptySlots: number;
  /** 항목 활성 여부 — false 면 회색 잠금(붙여넣기·추가·삭제 불가) */
  active: boolean;
  /** MAP 정보 잠금 등 외부 잠금 */
  locked: boolean;
  error?: string;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>, target: NumCheckPasteTarget) => void;
  onAddSlot: () => void;
  onRemoveImage: (index: number) => void;
  onRemoveEmptySlot: () => void;
}

const SLOT_MIN_WIDTH = '280px';

const NumCheckImageUpload: React.FC<NumCheckImageUploadProps> = ({
  images, emptySlots, active, locked, error, onPaste, onAddSlot, onRemoveImage, onRemoveEmptySlot,
}) => {
  const { t } = useTranslation();
  const disabled = !active || locked;
  const keyword = NUM_CHECK_PP_KEYWORD.toUpperCase();
  // 빈 칸이 하나뿐이고 사진이 없으면 그 칸은 지울 수 없다(입력할 자리가 사라지지 않도록).
  const canRemoveEmpty = images.length + emptySlots > 1;

  const areaStyle = (hasError: boolean): React.CSSProperties => ({
    border: `2px dashed ${hasError ? '#dc3545' : '#ccc'}`,
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
    minHeight: '100px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: disabled ? 'var(--bg-secondary)' : (hasError ? '#fff5f5' : '#f9f9f9'),
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : undefined,
  });

  const renderSlot = (key: string, no: number, target: NumCheckPasteTarget, path: string | null, onRemove: (() => void) | null) => (
    <div key={key} style={{ flex: '1 1 0', minWidth: SLOT_MIN_WIDTH }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span className="form-label" style={{ marginBottom: 0 }}>{t('request.num_check_image_no', { no })}</span>
        {onRemove && (
          <button type="button" className="btn btn-danger btn-sm" disabled={disabled} onClick={onRemove}>
            {t('common.delete')}
          </button>
        )}
      </div>
      <div
        className="image-upload-area"
        style={areaStyle(!!error && !path)}
        onPaste={disabled ? undefined : (e) => onPaste(e, target)}
      >
        {path ? (
          <div style={{ width: '100%' }}>
            <img
              src={`/media/${path}`}
              alt={`num-check-${no}`}
              style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px', border: '1px solid #ddd' }}
            />
            <p style={{ margin: '8px 0 0 0', color: '#666', fontSize: '13px' }}>
              {t('request.mshot_image_attached_hint')}
            </p>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>📋</div>
            <p style={{ margin: '0', color: '#666' }}>{t('request.mshot_image_paste_hint')}</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="form-group full-width">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <label className="form-label" style={{ marginBottom: 0 }}>
          {t('request.num_check_title')} {active && <span className="required">*</span>}
        </label>
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={onAddSlot}>
          {t('request.num_check_add_image')}
        </button>
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 8px' }}>
        {active
          ? t('request.num_check_active_hint', { keyword })
          : t('request.num_check_locked_hint', { keyword })}
      </p>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {images.map((path, idx) => renderSlot(`img-${idx}`, idx + 1, idx, path, () => onRemoveImage(idx)))}
        {Array.from({ length: emptySlots }, (_, i) =>
          renderSlot(`empty-${i}`, images.length + i + 1, null, null, canRemoveEmpty ? onRemoveEmptySlot : null))}
      </div>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
};

export default NumCheckImageUpload;
