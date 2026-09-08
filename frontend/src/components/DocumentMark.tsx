import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { ColorPalette, EXCEL_STANDARD_COLORS } from './RichTextEditor';
import { PersonalMarkCategory } from '../types';

interface FixedPos {
  top: number;
  left: number;
}

/** document 클릭이 anchor/popover 바깥일 때만 닫는 공용 훅. */
function useClosePopoverOnOutsideClick(active: boolean, popRef: React.RefObject<HTMLElement>, close: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onDocClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [active, popRef, close]);
}

interface MarkDotProps {
  /** 내가 만든 범주 목록. */
  categories: PersonalMarkCategory[];
  /** 이 문서에 현재 표시된 범주 id (없으면 null). */
  value: number | null;
  onChange: (categoryId: number | null) => void;
  /** "범주 관리" 클릭 시 설정 모달을 열기 위한 콜백. */
  onManage: () => void;
}

/**
 * 결재 현황 표에서 개인이 의뢰서를 마킹하는 점(●) 하나 — 도형은 이거 하나뿐이고 색으로만 구분한다.
 * 전용 컬럼이 아니라 제품 조합 셀 앞에 인라인으로 붙여 쓴다.
 */
export function MarkDot({ categories, value, onChange, onManage }: MarkDotProps): React.ReactElement {
  const { t } = useTranslation();
  const [pos, setPos] = useState<FixedPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useClosePopoverOnOutsideClick(pos !== null, popRef, () => setPos(null));

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, left: rect.left });
  };

  const current = categories.find((c) => c.id === value) ?? null;
  const dotColor = current?.color;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="mark-dot-btn"
        title={current ? current.name : t('approval.category_none')}
        onClick={toggle}
      >
        <span className="mark-dot" style={dotColor ? { background: dotColor, borderColor: dotColor } : undefined} />
      </button>
      {pos && (
        <div
          ref={popRef}
          className="column-filter-popover mark-dot-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
        >
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className="column-filter-popover-item mark-dot-popover-item"
              onClick={() => { onChange(cat.id); setPos(null); }}
            >
              <span className="legend-swatch" style={{ background: cat.color }} />
              {cat.name}
            </button>
          ))}
          <button
            type="button"
            className="column-filter-popover-item mark-dot-popover-item"
            onClick={() => { onChange(null); setPos(null); }}
          >
            <span className="legend-swatch legend-swatch-none" />
            {t('approval.category_none')}
          </button>
          <div className="column-filter-popover-divider" />
          <button type="button" className="column-filter-popover-all" onClick={() => { setPos(null); onManage(); }}>
            {t('approval.category_manage_link')}
          </button>
        </div>
      )}
    </>
  );
}

interface MarkCategorySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: PersonalMarkCategory[];
  onCreate: (name: string, color: string) => void;
  /** 입력할 때마다 — 화면에 즉시 반영만 한다(서버 저장은 onRenameCommit). */
  onRename: (id: number, name: string) => void;
  /** 입력을 마쳤을 때(blur) — 이 시점에 서버에 저장한다. 실패 시 되돌릴 수 있도록
   *  편집을 시작하기 전 이름(previousName)도 함께 넘긴다. */
  onRenameCommit: (id: number, name: string, previousName: string) => void;
  onRecolor: (id: number, color: string) => void;
  onDelete: (id: number) => void;
}

/**
 * 범주 추가·삭제·이름/색 변경 화면. 범주는 개인 전용이라 여기서 바꾼 내용은
 * 나에게만 보인다(다른 사용자와 공유되지 않음).
 */
export function MarkCategorySettingsModal({
  isOpen, onClose, categories, onCreate, onRename, onRenameCommit, onRecolor, onDelete,
}: MarkCategorySettingsModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [colorPickerId, setColorPickerId] = useState<number | null>(null);
  const colorPopRef = useRef<HTMLDivElement>(null);
  // 편집 시작(focus) 시점의 이름 — blur 시 저장 실패하면 이 값으로 되돌린다.
  const originalNameRef = useRef<Record<number, string>>({});

  useClosePopoverOnOutsideClick(colorPickerId !== null, colorPopRef, () => setColorPickerId(null));

  const handleAdd = () => {
    const color = EXCEL_STANDARD_COLORS[categories.length % EXCEL_STANDARD_COLORS.length];
    onCreate(t('approval.category_new_default_name'), color);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('approval.category_settings_title')}
      size="sm"
      footer={<button className="btn btn-secondary btn-sm" onClick={onClose}>{t('common.close')}</button>}
    >
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 14 }}>
        {t('approval.category_settings_help')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {categories.map((cat) => (
          <div key={cat.id} className="cat-row">
            <div
              ref={colorPickerId === cat.id ? colorPopRef : undefined}
              style={{ position: 'relative', display: 'inline-flex' }}
            >
              <button
                type="button"
                className="cat-color-swatch"
                style={{ background: cat.color }}
                title={t('approval.category_pick_color')}
                onClick={(e) => { e.stopPropagation(); setColorPickerId((id) => (id === cat.id ? null : cat.id)); }}
              />
              {colorPickerId === cat.id && (
                <ColorPalette onSelect={(color) => { if (color) onRecolor(cat.id, color); setColorPickerId(null); }} />
              )}
            </div>
            <input
              type="text"
              className="form-control"
              value={cat.name}
              maxLength={30}
              onFocus={() => { originalNameRef.current[cat.id] = cat.name; }}
              onChange={(e) => onRename(cat.id, e.target.value)}
              onBlur={(e) => onRenameCommit(cat.id, e.target.value, originalNameRef.current[cat.id] ?? cat.name)}
            />
            <button
              type="button"
              className="flow-delete-btn"
              title={t('approval.category_delete_title')}
              onClick={() => onDelete(cat.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="flow-table-add-btn" onClick={handleAdd}>
        + {t('approval.category_add')}
      </button>
    </Modal>
  );
}
