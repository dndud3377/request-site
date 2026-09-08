import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { PersonalColorRule } from '../../../types';
import { emptyDraftWords } from '../helpers';

export const DEFAULT_COLOR_RULE_COLOR = '#ffeb3b';

type ColorDraft = { label: string; words: { sp: string[]; sd: string[]; pp: string[] }; color: string };

export const emptyColorDraft = (): ColorDraft => ({ label: '', words: emptyDraftWords(), color: DEFAULT_COLOR_RULE_COLOR });

interface ColorManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  colorRules: PersonalColorRule[];
  newRule: ColorDraft;
  setNewRule: React.Dispatch<React.SetStateAction<ColorDraft>>;
  onAllDelete: () => void;
  onRequestDelete: (rule: PersonalColorRule) => void;
  onEdit: (ruleId: string, label: string, words: ColorDraft['words'], color: string) => void;
  /** 새 규칙 추가 — 개인용(localStorage) 저장은 호출부가 담당한다. */
  onAdd: (label: string, words: ColorDraft['words'], color: string) => void;
}

const ColorManageModal: React.FC<ColorManageModalProps> = ({
  isOpen,
  onClose,
  title,
  colorRules,
  newRule,
  setNewRule,
  onAllDelete,
  onRequestDelete,
  onEdit,
  onAdd,
}) => {
  const { t } = useTranslation();
  const addToast = useToast();
  // 수정 중인 규칙 id (null이면 새 규칙 만들기 모드)
  const [editingId, setEditingId] = useState<string | null>(null);

  // 모달이 닫히면 수정 모드 해제
  useEffect(() => {
    if (!isOpen) setEditingId(null);
  }, [isOpen]);

  const startEdit = (rule: PersonalColorRule) => {
    setEditingId(rule.id);
    setNewRule({
      label: rule.label,
      words: { sp: [...rule.words.sp], sd: [...rule.words.sd], pp: [...rule.words.pp] },
      color: rule.color,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNewRule(emptyColorDraft());
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="lg"
      style={{ width: '560px', maxWidth: '95%' }}
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
              disabled={newRule.words.sp.length === 0 && newRule.words.sd.length === 0 && newRule.words.pp.length === 0}
              onClick={() => {
                const label = newRule.label || t('request.color_default_label');
                if (editingId) {
                  onEdit(editingId, label, newRule.words, newRule.color);
                  setNewRule(emptyColorDraft());
                  setEditingId(null);
                  addToast(t('request.color_edit_success_toast', { label }), 'success');
                  return;
                }
                onAdd(label, newRule.words, newRule.color);
                setNewRule(emptyColorDraft());
                addToast(t('request.color_add_success_toast', { label }), 'success');
              }}
            >{editingId ? t('request.filter_apply_edit') : t('request.filter_add_btn')}</button>
            <button className="btn btn-secondary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      }
    >
      {(() => {
        const addKeyword = (field: 'sp'|'sd'|'pp', val: string) => {
          if (val && !newRule.words[field].includes(val))
            setNewRule(p => ({ ...p, words: { ...p.words, [field]: [...p.words[field], val] } }));
        };
        const removeKeyword = (field: 'sp'|'sd'|'pp', i: number) =>
          setNewRule(p => ({ ...p, words: { ...p.words, [field]: p.words[field].filter((_,j)=>j!==i) } }));
        const keywordSection = (field: 'sp'|'sd'|'pp', label: string, color: string, bg: string) => (
          <div style={{ border: `1.5px solid ${color}22`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color, marginBottom: 6 }}>{label}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input type="text" className="form-control" placeholder={t('request.filter_keyword_placeholder')}
                style={{ fontSize: 13, padding: '5px 8px' }}
                onKeyDown={(e) => { if (e.key==='Enter') { e.preventDefault(); addKeyword(field, e.currentTarget.value.trim()); e.currentTarget.value=''; } }} />
              <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
                onClick={(e) => { const inp=(e.currentTarget.previousSibling as HTMLInputElement); addKeyword(field, inp.value.trim()); inp.value=''; }}>{t('request.filter_add_btn')}</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 22 }}>
              {newRule.words[field].length === 0
                ? <span style={{ color: '#bbb', fontSize: 12 }}>{t('request.filter_keyword_empty')}</span>
                : newRule.words[field].map((k,i) => (
                  <span key={i} style={{ display:'inline-flex', alignItems:'center', background: bg, padding:'2px 8px', borderRadius:12, fontSize:12 }}>
                    {k}<button type="button" onClick={()=>removeKeyword(field,i)} style={{ marginLeft:4, border:'none', background:'none', cursor:'pointer', color:'#888', padding:0, fontSize:11, lineHeight:1 }}>✕</button>
                  </span>
                ))}
            </div>
          </div>
        );
        return (
          <div style={{ fontSize: 13 }}>
            {/* 저장된 규칙 목록 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{t('request.color_saved_label')}</div>
              {colorRules.length === 0
                ? <div style={{ color: '#bbb', fontSize: 13, padding: '6px 0' }}>{t('request.color_saved_empty')}</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {colorRules.map(rule => (
                      <div key={rule.id} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg-secondary)', padding:'8px 12px', borderRadius:8, border:'1px solid var(--border)' }}>
                        <span style={{ width: 16, height: 16, borderRadius: '50%', background: rule.color, border: '1px solid rgba(0,0,0,0.2)', flexShrink: 0 }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:600, marginBottom:3 }}>{rule.label||t('request.filter_unnamed')}</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                            {rule.words.sp.map((k,i)=><span key={i} style={{ background:'#e3f2fd', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🔵 {k}</span>)}
                            {rule.words.sd.map((k,i)=><span key={i} style={{ background:'#e8f5e9', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🟢 {k}</span>)}
                            {rule.words.pp.map((k,i)=><span key={i} style={{ background:'#fff3e0', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🟠 {k}</span>)}
                          </div>
                        </div>
                        <button type="button" className="btn btn-secondary btn-sm"
                          onClick={() => startEdit(rule)}>{t('common.edit')}</button>
                        <button type="button" className="btn btn-danger btn-sm"
                          onClick={() => onRequestDelete(rule)}>{t('common.delete')}</button>
                      </div>
                    ))}
                  </div>
              }
            </div>

            <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />

            {/* 새 규칙 만들기 */}
            <div style={{ fontWeight: 600, fontSize: 12, color: editingId ? 'var(--accent)' : '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>{editingId ? t('request.color_edit_title') : t('request.color_create_title')}</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
              <input
                type="text"
                placeholder={t('request.color_name_placeholder')}
                value={newRule.label}
                onChange={e => setNewRule(p=>({...p, label:e.target.value}))}
                style={{ flex: 1, border:'none', borderBottom:'2px solid var(--accent)', outline:'none', fontSize:17, fontWeight:700, padding:'4px 2px', background:'transparent', color:'var(--text-primary)' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#888', fontWeight: 600 }}>
                {t('request.color_picker_label')}
                <input
                  type="color"
                  value={newRule.color}
                  onChange={e => setNewRule(p => ({ ...p, color: e.target.value }))}
                  style={{ width: 32, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}
                />
              </label>
            </div>
            {keywordSection('sp', `🔵 ${t('request.filter_sp_label')}`, '#1976d2', '#e3f2fd')}
            {keywordSection('sd', `🟢 ${t('request.filter_sd_label')}`, '#388e3c', '#e8f5e9')}
            {keywordSection('pp', `🟠 ${t('request.filter_pp_label')}`, '#f57c00', '#fff3e0')}
          </div>
        );
      })()}
    </Modal>
  );
};

export default ColorManageModal;
