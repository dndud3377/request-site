import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { ColorPalette } from '../../../components/RichTextEditor';
import { ColorFilterSet, ColorFilterKeyword } from '../../../types';

type ColorFilterDraft = { label: string; words: { sp: ColorFilterKeyword[]; sd: ColorFilterKeyword[]; pp: ColorFilterKeyword[] } };
type Field = 'sp' | 'sd' | 'pp';

export const emptyColorDraftWords = (): ColorFilterDraft['words'] => ({ sp: [], sd: [], pp: [] });

/** 새로 추가한 키워드의 임시 기본색 — 색상 버튼을 눌러 바꾸기 전까지의 값. */
const DEFAULT_KEYWORD_COLOR = '#FFFF00';

interface ColorFilterManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  filterSets: ColorFilterSet[];
  newFilter: ColorFilterDraft;
  setNewFilter: React.Dispatch<React.SetStateAction<ColorFilterDraft>>;
  onAllDelete: () => void;
  onRequestDelete: (fs: ColorFilterSet) => void;
  onEdit: (filterId: string, label: string, words: ColorFilterDraft['words']) => void;
  /** 새 색상 필터 추가 — 저장 방식(localStorage)은 호출부가 결정한다. */
  onAdd: (label: string, words: ColorFilterDraft['words']) => void;
}

const ColorFilterManageModal: React.FC<ColorFilterManageModalProps> = ({
  isOpen,
  onClose,
  title,
  filterSets,
  newFilter,
  setNewFilter,
  onAllDelete,
  onRequestDelete,
  onEdit,
  onAdd,
}) => {
  const { t } = useTranslation();
  const addToast = useToast();
  // 수정 중인 필터 id (null이면 새 필터 만들기 모드)
  const [editingId, setEditingId] = useState<string | null>(null);
  // 지금 색상 팔레트가 열려 있는 키워드 — null 이면 닫힘
  const [paletteTarget, setPaletteTarget] = useState<{ field: Field; idx: number } | null>(null);

  useEffect(() => {
    if (!isOpen) { setEditingId(null); setPaletteTarget(null); }
  }, [isOpen]);

  const startEdit = (fs: ColorFilterSet) => {
    setEditingId(fs.id);
    setPaletteTarget(null);
    setNewFilter({
      label: fs.label,
      words: { sp: fs.words.sp.map((e) => ({ ...e })), sd: fs.words.sd.map((e) => ({ ...e })), pp: fs.words.pp.map((e) => ({ ...e })) },
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setPaletteTarget(null);
    setNewFilter({ label: '', words: emptyColorDraftWords() });
  };

  const addKeyword = (field: Field, word: string) => {
    if (!word) return;
    setNewFilter((p) => ({ ...p, words: { ...p.words, [field]: [...p.words[field], { word, color: DEFAULT_KEYWORD_COLOR }] } }));
  };
  const removeKeyword = (field: Field, i: number) => {
    setPaletteTarget(null);
    setNewFilter((p) => ({ ...p, words: { ...p.words, [field]: p.words[field].filter((_, j) => j !== i) } }));
  };
  const setKeywordColor = (field: Field, i: number, color: string) => {
    setNewFilter((p) => ({
      ...p,
      words: { ...p.words, [field]: p.words[field].map((e, j) => (j === i ? { ...e, color } : e)) },
    }));
    setPaletteTarget(null);
  };

  const fieldSection = (field: Field, label: string) => (
    <div key={field} style={{ border: '1.5px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input type="text" className="form-control" placeholder={t('request.filter_keyword_placeholder')}
          style={{ fontSize: 13, padding: '5px 8px' }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(field, e.currentTarget.value.trim()); e.currentTarget.value = ''; } }} />
        <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
          onClick={(e) => { const inp = (e.currentTarget.previousSibling as HTMLInputElement); addKeyword(field, inp.value.trim()); inp.value = ''; }}>{t('request.filter_add_btn')}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {newFilter.words[field].length === 0
          ? <span style={{ color: '#bbb', fontSize: 12 }}>{t('request.color_filter_keyword_empty')}</span>
          : newFilter.words[field].map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}>
              <div style={{ position: 'relative', display: 'inline-flex' }}>
                <button
                  type="button"
                  title={t('request.color_filter_change_color_title')}
                  onClick={() => setPaletteTarget((cur) => (cur && cur.field === field && cur.idx === i ? null : { field, idx: i }))}
                  style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid rgba(0,0,0,0.2)', background: e.color, cursor: 'pointer', padding: 0, flexShrink: 0 }}
                />
                {paletteTarget?.field === field && paletteTarget.idx === i && (
                  <ColorPalette onSelect={(color) => { if (color) setKeywordColor(field, i, color); else setPaletteTarget(null); }} />
                )}
              </div>
              <span style={{ flex: 1 }}>{e.word}</span>
              <button type="button" onClick={() => removeKeyword(field, i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', padding: 0, fontSize: 11 }}>✕ {t('common.delete')}</button>
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="lg"
      style={{ width: '620px', maxWidth: '95%' }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '12px' }}
            onClick={onAllDelete}
          >
            {t('request.filter_delete_all')}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {editingId && (
              <button type="button" className="btn btn-secondary" onClick={cancelEdit}>
                {t('request.filter_edit_cancel')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={newFilter.words.sp.length === 0 && newFilter.words.sd.length === 0 && newFilter.words.pp.length === 0}
              onClick={() => {
                const label = newFilter.label || t('request.color_filter_default_label');
                if (editingId) {
                  onEdit(editingId, label, newFilter.words);
                  cancelEdit();
                  addToast(t('request.color_filter_edit_success_toast', { label }), 'success');
                  return;
                }
                onAdd(label, newFilter.words);
                setNewFilter({ label: '', words: emptyColorDraftWords() });
                addToast(t('request.color_filter_add_success_toast', { label }), 'success');
              }}
            >{editingId ? t('request.filter_apply_edit') : t('request.filter_add_btn')}</button>
            <button className="btn btn-secondary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ fontSize: 13 }}>
        {/* 저장된 색상 필터 목록 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{t('request.color_filter_saved_label')}</div>
          {filterSets.length === 0
            ? <div style={{ color: '#bbb', fontSize: 13, padding: '6px 0' }}>{t('request.color_filter_saved_empty')}</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filterSets.map((fs) => (
                  <div key={fs.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, marginBottom: 3 }}>{fs.label || t('request.filter_unnamed')}</div>
                      {(['sp', 'sd', 'pp'] as Field[]).filter((f) => fs.words[f].length > 0).map((f) => (
                        <div key={f} style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', marginBottom: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginRight: 2 }}>{t(`request.filter_${f}_label` as any)}:</span>
                          {fs.words[f].map((e, i) => (
                            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f2f4f8', padding: '1px 8px 1px 4px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                              <span style={{ width: 9, height: 9, borderRadius: '50%', background: e.color, border: '1px solid rgba(0,0,0,0.15)', display: 'inline-block' }} />
                              {e.word}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm"
                      onClick={() => startEdit(fs)}>{t('common.edit')}</button>
                    <button type="button" className="btn btn-danger btn-sm"
                      onClick={() => onRequestDelete(fs)}>{t('common.delete')}</button>
                  </div>
                ))}
              </div>
          }
        </div>

        <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />

        {/* 새 색상 필터 만들기 */}
        <div style={{ fontWeight: 600, fontSize: 12, color: editingId ? 'var(--accent)' : '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>{editingId ? t('request.color_filter_edit_title') : t('request.color_filter_create_title')}</div>
        <input
          type="text"
          placeholder={t('request.color_filter_name_placeholder')}
          value={newFilter.label}
          onChange={(e) => setNewFilter((p) => ({ ...p, label: e.target.value }))}
          style={{ width: '100%', border: 'none', borderBottom: '2px solid var(--accent)', outline: 'none', fontSize: 17, fontWeight: 700, padding: '4px 2px', marginBottom: 14, background: 'transparent', color: 'var(--text-primary)' }}
        />
        {fieldSection('sp', t('request.filter_sp_label'))}
        {fieldSection('sd', t('request.filter_sd_label'))}
        {fieldSection('pp', t('request.filter_pp_label'))}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{t('request.color_filter_flow_hint')}</div>
      </div>
    </Modal>
  );
};

export default ColorFilterManageModal;
