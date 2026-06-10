import React from 'react';
import Modal from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { FilterSet } from '../../../types';
import { emptyDraftWords } from '../helpers';

type FilterDraft = { label: string; words: { sp: string[]; sd: string[]; pp: string[] } };

interface FilterManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  storageKey: string;
  filterSets: FilterSet[];
  setFilterSets: React.Dispatch<React.SetStateAction<FilterSet[]>>;
  newFilter: FilterDraft;
  setNewFilter: React.Dispatch<React.SetStateAction<FilterDraft>>;
  onAllDelete: () => void;
  onRequestDelete: (fs: FilterSet) => void;
}

const FilterManageModal: React.FC<FilterManageModalProps> = ({
  isOpen,
  onClose,
  title,
  storageKey,
  filterSets,
  setFilterSets,
  newFilter,
  setNewFilter,
  onAllDelete,
  onRequestDelete,
}) => {
  const addToast = useToast();
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
            전체 삭제
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={newFilter.words.sp.length === 0 && newFilter.words.sd.length === 0 && newFilter.words.pp.length === 0}
              onClick={() => {
                const newSet: FilterSet = { id: String(Date.now()), label: newFilter.label || '필터', words: newFilter.words };
                const updated = [...filterSets, newSet];
                setFilterSets(updated);
                localStorage.setItem(storageKey, JSON.stringify(updated));
                setNewFilter({ label: '', words: emptyDraftWords() });
                addToast(`필터 "${newSet.label}"이 추가되었습니다.`, 'success');
              }}
            >+ 추가</button>
            <button className="btn btn-secondary" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      }
    >
      {(() => {
        const addKeyword = (field: 'sp'|'sd'|'pp', val: string) => {
          if (val && !newFilter.words[field].includes(val))
            setNewFilter(p => ({ ...p, words: { ...p.words, [field]: [...p.words[field], val] } }));
        };
        const removeKeyword = (field: 'sp'|'sd'|'pp', i: number) =>
          setNewFilter(p => ({ ...p, words: { ...p.words, [field]: p.words[field].filter((_,j)=>j!==i) } }));
        const keywordSection = (field: 'sp'|'sd'|'pp', label: string, color: string, bg: string) => (
          <div style={{ border: `1.5px solid ${color}22`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color, marginBottom: 6 }}>{label}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input type="text" className="form-control" placeholder="키워드 입력 후 Enter"
                style={{ fontSize: 13, padding: '5px 8px' }}
                onKeyDown={(e) => { if (e.key==='Enter') { e.preventDefault(); addKeyword(field, e.currentTarget.value.trim()); e.currentTarget.value=''; } }} />
              <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
                onClick={(e) => { const inp=(e.currentTarget.previousSibling as HTMLInputElement); addKeyword(field, inp.value.trim()); inp.value=''; }}>+ 추가</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 22 }}>
              {newFilter.words[field].length === 0
                ? <span style={{ color: '#bbb', fontSize: 12 }}>없음</span>
                : newFilter.words[field].map((k,i) => (
                  <span key={i} style={{ display:'inline-flex', alignItems:'center', background: bg, padding:'2px 8px', borderRadius:12, fontSize:12 }}>
                    {k}<button type="button" onClick={()=>removeKeyword(field,i)} style={{ marginLeft:4, border:'none', background:'none', cursor:'pointer', color:'#888', padding:0, fontSize:11, lineHeight:1 }}>✕</button>
                  </span>
                ))}
            </div>
          </div>
        );
        return (
          <div style={{ fontSize: 13 }}>
            {/* 저장된 필터 목록 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>저장된 필터</div>
              {filterSets.length === 0
                ? <div style={{ color: '#bbb', fontSize: 13, padding: '6px 0' }}>저장된 필터가 없습니다.</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filterSets.map(fs => (
                      <div key={fs.id} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg-secondary)', padding:'8px 12px', borderRadius:8, border:'1px solid var(--border)' }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:600, marginBottom:3 }}>{fs.label||'(이름 없음)'}</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                            {fs.words.sp.map((k,i)=><span key={i} style={{ background:'#e3f2fd', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🔵 {k}</span>)}
                            {fs.words.sd.map((k,i)=><span key={i} style={{ background:'#e8f5e9', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🟢 {k}</span>)}
                            {fs.words.pp.map((k,i)=><span key={i} style={{ background:'#fff3e0', padding:'1px 7px', borderRadius:10, fontSize:11 }}>🟠 {k}</span>)}
                          </div>
                        </div>
                        <button type="button" className="btn btn-danger btn-sm"
                          onClick={() => onRequestDelete(fs)}>삭제</button>
                      </div>
                    ))}
                  </div>
              }
            </div>

            <hr style={{ margin: '14px 0', borderColor: 'var(--border)' }} />

            {/* 새 필터 만들기 */}
            <div style={{ fontWeight: 600, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>새 필터 만들기</div>
            <input
              type="text"
              placeholder="필터 이름을 입력하세요..."
              value={newFilter.label}
              onChange={e => setNewFilter(p=>({...p, label:e.target.value}))}
              style={{ width:'100%', border:'none', borderBottom:'2px solid var(--accent)', outline:'none', fontSize:17, fontWeight:700, padding:'4px 2px', marginBottom:14, background:'transparent', color:'var(--text-primary)' }}
            />
            {keywordSection('sp', '🔵 STEPSEQ', '#1976d2', '#e3f2fd')}
            {keywordSection('sd', '🟢 STEP 설명', '#388e3c', '#e8f5e9')}
            {keywordSection('pp', '🟠 PPID', '#f57c00', '#fff3e0')}
          </div>
        );
      })()}
    </Modal>
  );
};

export default FilterManageModal;
