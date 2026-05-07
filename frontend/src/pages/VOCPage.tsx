import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { vocAPI, uploadImageAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { VOC, VocCategory, VocStatus, VocPage, CreateVocInput } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface CategoryOption { value: VocCategory; labelKey: string; }
interface PageOption      { value: VocPage;    labelKey: string; }

const CATEGORIES: CategoryOption[] = [
  { value: 'inquiry',         labelKey: 'voc.category_inquiry' },
  { value: 'error_report',    labelKey: 'voc.category_error_report' },
  { value: 'feature_request', labelKey: 'voc.category_feature_request' },
  { value: 'task_request',    labelKey: 'voc.category_task_request' },
];

const PAGES: PageOption[] = [
  { value: 'request',  labelKey: 'voc.page_request' },
  { value: 'approval', labelKey: 'voc.page_approval' },
  { value: 'history',  labelKey: 'voc.page_history' },
  { value: 'other',    labelKey: 'voc.page_other' },
];

const VOC_STATUSES: VocStatus[] = ['checking', 'completed', 'rejected'];

const formatDate  = (d: string) => new Date(d).toLocaleDateString('ko-KR');
const formatTime  = (d: string) =>
  new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function VOCPage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const { currentUser } = useAuth();
  const isMaster = currentUser.role === 'MASTER';
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const contentEditableRef = useRef<HTMLDivElement>(null);

  // ── list state ──
  const [vocs, setVocs]           = useState<VOC[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('');
  const [searchQuery, setSearch]  = useState('');

  // ── register form ──
  const [formOpen, setFormOpen]   = useState(false);
  const [form, setForm]           = useState({ title: '', category: 'inquiry' as VocCategory, page: 'request' as VocPage});
  const [submitting, setSubmitting] = useState(false);

  // ── detail modal ──
  const [selected, setSelected]   = useState<VOC | null>(null);
  const [commentText, setComment] = useState('');
  const [sendingComment, setSending] = useState(false);

  // ── reject flow ──
  const [rejectOpen, setRejectOpen]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting]     = useState(false);

  // ─────────────── data ───────────────
  const fetchVocs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter === 'my')       params.submitter_user_id = String(currentUser.id);
    else if (filter)           params.category = filter;
    if (searchQuery)           params.search = searchQuery;

    vocAPI.list(params)
      .then((r) => {
        const data = r.data;
        setVocs(Array.isArray(data) ? data : (data as any).results ?? []);
      })
      .catch(() => setVocs([]))
      .finally(() => setLoading(false));
  }, [filter, searchQuery, currentUser.id]);

  useEffect(() => { fetchVocs(); }, [fetchVocs]);

  // scroll chat to bottom when new comment appears
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.comments?.length]);

  // ─────────────── register ───────────────
  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleContentPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        try {
          const result = await uploadImageAPI.upload(file);
          const img = `<img src="${result.url}" style="max-width:100%;border-radius:4px;margin:4px 0;" />`;
          document.execCommand('insertHTML', false, img);
        } catch {
          addToast('이미지 업로드에 실패했습니다.', 'error');
        }
        return;
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const contentHtml = contentEditableRef.current?.innerHTML ?? '';
    const contentText = contentEditableRef.current?.textContent?.trim() ?? '';
    if (!contentText) {
      addToast(t('voc.content') + ' 을(를) 입력해주세요.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const input: CreateVocInput = {
        title: form.title,
        category: form.category,
        page: form.page,
        content: contentHtml,
        submitter_name: currentUser.name,
        submitter_email: currentUser.email,
        submitter_user_id: currentUser.id,
      };
      await vocAPI.create(input);
      addToast(t('voc.submit_success'), 'success');
      setForm({ title: '', category: 'inquiry', page: 'request'});
      if (contentEditableRef.current) contentEditableRef.current.innerHTML = '';
      setFormOpen(false);
      fetchVocs();
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────── comment (chat) ───────────────
  const handleSendComment = async () => {
    if (!selected || !commentText.trim()) return;
    setSending(true);
    try {
      const res = await vocAPI.addComment(selected.id, {
        author_name: currentUser.name,
        author_role: currentUser.role,
        is_submitter: selected.submitter_user_id === currentUser.id,
        content: commentText.trim(),
        is_reject_reason: false,
      });
      setSelected(res.data);
      setVocs((prev) => prev.map((v) => (v.id === selected.id ? res.data : v)));
      setComment('');
      addToast(t('voc.comment_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSending(false);
    }
  };

  // ─────────────── mark completed (submitter) ───────────────
  const handleMarkCompleted = async () => {
    if (!selected) return;
    try {
      const res = await vocAPI.updateStatus(selected.id, 'completed');
      setSelected(res.data);
      setVocs((prev) => prev.map((v) => (v.id === selected.id ? res.data : v)));
      addToast(t('voc.status_update_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    }
  };

  // ─────────────── reject (master) ───────────────
  const handleReject = async () => {
    if (!selected || !rejectReason.trim()) return;
    setRejecting(true);
    try {
      // 1. 반려 사유를 댓글로 등록
      const withComment = await vocAPI.addComment(selected.id, {
        author_name: currentUser.name,
        author_role: currentUser.role,
        is_submitter: false,
        content: rejectReason.trim(),
        is_reject_reason: true,
      });
      // 2. 상태를 rejected로 변경
      const res = await vocAPI.updateStatus(selected.id, 'rejected');
      setSelected(res.data);
      setVocs((prev) => prev.map((v) => (v.id === selected.id ? res.data : v)));
      setRejectOpen(false);
      setRejectReason('');
      addToast(t('voc.status_update_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setRejecting(false);
    }
  };

  // ─────────────── helpers ───────────────
  const getCategoryLabel = (cat: VocCategory) =>
    t((CATEGORIES.find((c) => c.value === cat)?.labelKey ?? 'voc.category_inquiry') as any);

  const getPageLabel = (page?: VocPage) =>
    page ? t((PAGES.find((p) => p.value === page)?.labelKey ?? 'voc.page_request') as any) : '-';

  const filterTabs = [
    { key: '',    label: t('approval.filter_all') },
    { key: 'my',  label: t('voc.my_voc') },
    ...CATEGORIES.map((c) => ({ key: c.value, label: t(c.labelKey as any) })),
  ];

  const isMyVoc = (v: VOC) => v.submitter_user_id === currentUser.id;

  // ─────────────── render ───────────────
  return (
    <div className="container page">
      {/* header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('voc.title')}</h1>
          <p>{t('voc.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          + {t('voc.new_voc')}
        </button>
      </div>

      {/* toolbar */}
      <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div className="filter-tabs">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              className={`filter-tab ${filter === tab.key ? 'active' : ''}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="search-box" style={{ maxWidth: 320 }}>
          <span className="search-icon">🔍</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('voc.search_placeholder' as any)}
          />
        </div>
      </div>

      {/* list */}
      {loading ? (
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : vocs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💬</div>
          <p>{t('voc.no_data')}</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>No.</th>
                <th>{t('approval.col_title')}</th>
                <th>{t('voc.category')}</th>
                <th>{t('voc.page')}</th>
                <th>{t('voc.submitter_name')}</th>
                <th>{t('voc.status')}</th>
                <th>접수일</th>
              </tr>
            </thead>
            <tbody>
              {vocs.map((v) => (
                <tr key={v.id}>
                  <td style={{ color: 'var(--text-muted)' }}>#{v.id}</td>
                  <td>
                    <button
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        cursor: 'pointer', color: 'var(--text-primary)',
                        fontWeight: 500, textAlign: 'left',
                      }}
                      onClick={() => { setSelected(v); setComment(''); }}
                    >
                      {v.title}
                    </button>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>
                      {getCategoryLabel(v.category)}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {getPageLabel(v.page)}
                  </td>
                  <td>{v.submitter_name}</td>
                  <td><StatusBadge status={v.status} /></td>
                  <td>{formatDate(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 등록 모달 ── */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={t('voc.new_voc')}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('common.loading') : t('voc.submit')}
            </button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">{t('approval.col_title')} <span className="required">*</span></label>
            <input className="form-control" name="title" value={form.title} onChange={handleFormChange} required />
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">{t('voc.category')}</label>
              <select className="form-control" name="category" value={form.category} onChange={handleFormChange}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{t(c.labelKey as any)}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">{t('voc.page')} <span className="required">*</span></label>
              <select className="form-control" name="page" value={form.page} onChange={handleFormChange} required>
                {PAGES.map((p) => (
                  <option key={p.value} value={p.value}>{t(p.labelKey as any)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('voc.content')} <span className="required">*</span></label>
            <style>{`
              .voc-content-editor:empty::before {
                content: attr(data-placeholder);
                color: var(--text-muted, #a0aec0);
                pointer-events: none;
              }
            `}</style>
            <div
              ref={contentEditableRef}
              contentEditable
              onPaste={handleContentPaste}
              className="voc-content-editor"
              data-placeholder={t('voc.content')}
              style={{
                minHeight: 280,
                border: '1px solid var(--border-color, #e2e8f0)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: '0.95rem',
                lineHeight: 1.7,
                outline: 'none',
                background: 'var(--bg-primary, #fff)',
                overflowY: 'auto',
                cursor: 'text',
              }}
            />
          </div>
        </form>
      </Modal>

      {/* ── 상세 모달 ── */}
      {selected && (
        <Modal
          isOpen={!!selected}
          onClose={() => { setSelected(null); setRejectOpen(false); setRejectReason(''); }}
          title={selected.title}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
              {/* 반려 버튼 (MASTER, 확인중 상태에서만) */}
              {isMaster && selected.status === 'checking' && (
                <button
                  className="btn btn-danger"
                  style={{ marginRight: 'auto' }}
                  onClick={() => setRejectOpen(true)}
                >
                  {t('voc.reject_btn')}
                </button>
              )}
              {/* 답변완료 버튼 (작성자 본인, 확인중 상태에서만) */}
              {isMyVoc(selected) && !isMaster && selected.status === 'checking' && (
                <button className="btn btn-primary" onClick={handleMarkCompleted}>
                  {t('voc.mark_completed')}
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => { setSelected(null); setRejectOpen(false); setRejectReason(''); }}>
                {t('common.close')}
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* 메타 정보 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
                {getCategoryLabel(selected.category)}
              </span>
              {selected.page && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: 4 }}>
                  {getPageLabel(selected.page)}
                </span>
              )}
              <StatusBadge status={selected.status} />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {formatDate(selected.created_at)} · {selected.submitter_name}
              </span>
            </div>

            {/* 원본 내용 */}
            <div className="form-group">
              <label className="form-label">{t('voc.content')}</label>
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: '14px 16px',
                  fontSize: '0.95rem',
                  lineHeight: 1.7,
                }}
                dangerouslySetInnerHTML={{ __html: selected.content }}
              />
            </div>

            {/* 반려 사유 입력 (인라인) */}
            {rejectOpen && (
              <div style={{
                background: 'var(--danger-light)',
                border: '1px solid var(--danger)',
                borderRadius: 8,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}>
                <label className="form-label" style={{ color: 'var(--danger)' }}>
                  {t('voc.reject_btn')} — 사유 입력 후 확인
                </label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={t('voc.reject_reason_placeholder' as any)}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" onClick={() => { setRejectOpen(false); setRejectReason(''); }}>
                    {t('common.cancel')}
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={handleReject}
                    disabled={rejecting || !rejectReason.trim()}
                  >
                    {rejecting ? t('common.loading') : t('common.confirm')}
                  </button>
                </div>
              </div>
            )}

            {/* 댓글 */}
            <div className="form-group">
              <label className="form-label">{t('voc.discussion')}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(selected.comments ?? []).length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('voc.no_comments')}</p>
                ) : (
                  (selected.comments ?? []).map((c) => (
                    <div
                      key={c.id}
                      style={{
                        border: `1px solid ${c.is_reject_reason ? 'var(--danger, #e53e3e)' : 'var(--border-color, #e2e8f0)'}`,
                        borderRadius: 6,
                        padding: '10px 14px',
                        background: c.is_reject_reason ? 'var(--danger-light, #fff5f5)' : 'var(--bg-secondary, #f7fafc)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {c.author_name}
                          <span style={{ fontWeight: 400, marginLeft: 6 }}>{c.author_role}</span>
                          {c.is_reject_reason && (
                            <span style={{ color: 'var(--danger, #e53e3e)', marginLeft: 8 }}>[반려 사유]</span>
                          )}
                        </span>
                        <span>{formatTime(c.created_at)}</span>
                      </div>
                      <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{c.content}</div>
                    </div>
                  ))
                )}
              </div>

              {/* 댓글 입력 (완료/반려 상태면 숨김) */}
              {selected.status === 'checking' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <textarea
                    className="form-control"
                    value={commentText}
                    rows={3}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={t('voc.comment_placeholder' as any)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendComment();
                    }}
                    style={{ resize: 'vertical' }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleSendComment}
                    disabled={sendingComment || !commentText.trim()}
                    style={{ whiteSpace: 'nowrap', alignSelf: 'flex-end' }}
                  >
                    {t('voc.send_comment')}
                  </button>
                </div>
              )}
            </div>

          </div>
        </Modal>
      )}
    </div>
  );
}
