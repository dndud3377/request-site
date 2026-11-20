import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { vocAPI } from '../api/client';
import RichTextEditor from '../components/RichTextEditor';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import Modal, { ConfirmModal } from '../components/Modal';
import { VOC, VocStatus, VocTeamFilter, CreateVocInput, UserRole } from '../types';
import { useAuth, ROLE_LABEL } from '../contexts/AuthContext';
import { sanitizeRichHtml } from '../utils/sanitizeRichHtml';

interface TeamOption     { value: VocTeamFilter; labelKey: string; }
interface StatusOption   { value: VocStatus;   labelKey: string; }

// claude 수정 (2026-11-20): 유형·페이지 선택 폐지 → 작성자 팀 필터 탭. 관리자·미지정·해외 제품 담당자는 '기타'(etc)로 묶는다
// (서버 VOCViewSet ?team= 와 같은 규칙).
const TEAMS: TeamOption[] = [
  { value: 'PL',   labelKey: ROLE_LABEL.PL },
  { value: 'TE_R', labelKey: ROLE_LABEL.TE_R },
  { value: 'TE_P', labelKey: ROLE_LABEL.TE_P },
  { value: 'TE_J', labelKey: ROLE_LABEL.TE_J },
  { value: 'TE_O', labelKey: ROLE_LABEL.TE_O },
  { value: 'TE_E', labelKey: ROLE_LABEL.TE_E },
  { value: 'etc',  labelKey: 'voc.team_etc' },
];

// 필터 탭 '확인중' / '답변완료' — 유형 탭과 마찬가지로 서버의 status 파라미터로 위임한다.
const STATUSES: StatusOption[] = [
  { value: 'checking',  labelKey: 'voc.status_checking' },
  { value: 'completed', labelKey: 'voc.status_completed' },
];

// 목록 페이지네이션 — 결재 현황(ApprovalPage)과 동일하게 페이지당 10건.
const VOC_LIST_PAGE_SIZE = 10;
const VOC_PAGE_WINDOW = 2;

/** 페이지네이션 숫자 버튼 목록. 1·마지막 페이지는 항상 포함하고, 현재 페이지 앞뒤로
 * VOC_PAGE_WINDOW 개만 보여준 뒤 나머지 구간은 'ellipsis' 로 접는다. (ApprovalPage.buildPageNumbers 와 동일 로직) */
const buildPageNumbers = (current: number, total: number): (number | 'ellipsis')[] => {
  const pages = new Set<number>([1, total]);
  for (let p = current - VOC_PAGE_WINDOW; p <= current + VOC_PAGE_WINDOW; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | 'ellipsis')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push('ellipsis');
    result.push(p);
    prev = p;
  }
  return result;
};

const formatDate  = (d: string) => new Date(d).toLocaleDateString('ko-KR');
const formatTime  = (d: string) =>
  new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function VOCPage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const { currentUser } = useAuth();
  const isMaster = currentUser.role === 'MASTER';
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // ── list state ──
  const [vocs, setVocs]           = useState<VOC[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('');
  const [searchQuery, setSearch]  = useState('');
  // 목록 페이지네이션 — 필터 탭·검색어가 바뀌면 항상 1페이지로 돌아간다.
  const [listPage, setListPage]   = useState(1);
  useEffect(() => { setListPage(1); }, [filter, searchQuery]);

  // ── register form ──
  const [formOpen, setFormOpen]   = useState(false);
  // claude 수정 (2026-11-20): 유형·페이지 입력 제거 — 작성자 팀은 서버가 로그인 사용자 역할로 확정한다
  const [form, setForm]           = useState({ title: '', content: '' });
  const [submitting, setSubmitting] = useState(false);

  // ── detail modal ──
  const [selected, setSelected]   = useState<VOC | null>(null);
  const [commentText, setComment] = useState('');
  const [sendingComment, setSending] = useState(false);

  // ── delete flow ──
  const [deleteTarget, setDeleteTarget] = useState<VOC | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // ─────────────── data ───────────────
  const fetchVocs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    // '내 VOC' 는 사용자 id 를 보내지 않고 서버가 로그인 사용자로 판단한다
    // (개발 모드의 목 사용자 id 는 DB 의 실제 user.id 와 어긋날 수 있다).
    // claude 수정 (2026-11-20): 유형(category) 필터 → 작성자 팀(team) 필터
    if (filter === 'my')                                        params.mine = 'true';
    else if (filter === 'checking' || filter === 'completed')    params.status = filter;
    else if (filter)                                             params.team = filter;
    if (searchQuery)           params.search = searchQuery;

    vocAPI.list(params)
      .then((r) => {
        const data = r.data;
        setVocs(Array.isArray(data) ? data : (data as any).results ?? []);
      })
      .catch(() => setVocs([]))
      .finally(() => setLoading(false));
  }, [filter, searchQuery]);

  useEffect(() => { fetchVocs(); }, [fetchVocs]);

  // ?id=123 query param → 해당 VOC 자동 선택
  useEffect(() => {
    if (loading || vocs.length === 0) return;
    const idParam = searchParams.get('id');
    if (!idParam) return;
    const target = vocs.find((v) => v.id === Number(idParam));
    if (target) {
      setSelected(target);
      setComment('');
      setSearchParams({}, { replace: true });
    }
  }, [loading, vocs, searchParams, setSearchParams]);

  // scroll chat to bottom when new comment appears
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.comments?.length]);

  // ─────────────── register ───────────────
  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const contentHtml = form.content;
    const contentText = form.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
    if (!contentText) {
      addToast(t('voc.content_required'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      // 제출자 계정(submitter)은 서버가 로그인 사용자로 확정하므로 보내지 않는다.
      const input: CreateVocInput = {
        title: form.title,
        content: contentHtml,
        submitter_name: currentUser.name,
        submitter_email: currentUser.email,
      };
      await vocAPI.create(input);
      addToast(t('voc.submit_success'), 'success');
      setForm({ title: '', content: '' });
      setFormOpen(false);
      fetchVocs();
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────── comment (chat) ───────────────
  const isCommentEmpty = (html: string) =>
    !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();

  const handleSendComment = async () => {
    if (!selected || isCommentEmpty(commentText)) return;
    setSending(true);
    try {
      const res = await vocAPI.addComment(selected.id, {
        author_name: currentUser.name,
        author_role: currentUser.role,
        is_submitter: isMyVoc(selected),
        content: commentText,
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

  // ─────────────── mark completed (작성자 본인 또는 MASTER) ───────────────
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

  // ─────────────── delete (master) ───────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await vocAPI.delete(deleteTarget.id);
      setVocs((prev) => prev.filter((v) => v.id !== deleteTarget.id));
      addToast(t('voc.delete_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // ─────────────── helpers ───────────────
  // claude 수정 (2026-11-20): 작성자 팀 라벨(권한 라벨 재사용). 작성자 계정이 없던 옛 VOC 는 '-'
  const getTeamLabel = (role: UserRole | '' | null) => (role ? t(ROLE_LABEL[role] as any) : '-');

  const filterTabs = [
    { key: '',    label: t('approval.filter_all') },
    { key: 'my',  label: t('voc.my_voc') },
    ...TEAMS.map((tm) => ({ key: tm.value, label: t(tm.labelKey as any) })),
    ...STATUSES.map((s) => ({ key: s.value, label: t(s.labelKey as any) })),
  ];

  // ── 목록 페이지네이션 ──
  const totalListPages = Math.max(1, Math.ceil(vocs.length / VOC_LIST_PAGE_SIZE));
  const pagedVocs = vocs.slice((listPage - 1) * VOC_LIST_PAGE_SIZE, listPage * VOC_LIST_PAGE_SIZE);
  useEffect(() => {
    if (listPage > totalListPages) setListPage(totalListPages);
  }, [listPage, totalListPages]);

  // 본인 판정은 id 가 아니라 loginid(= currentUser.username) 로 한다 — 개발 모드의
  // 목 사용자 id 는 DB 의 실제 user.id 와 어긋날 수 있지만 loginid 는 어긋나지 않는다.
  const isMyVoc = (v: VOC) => !!v.submitter_loginid && v.submitter_loginid === currentUser.username;

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
                {/* claude 수정 (2026-11-20): 유형·페이지 컬럼 → 작성자 팀 */}
                <th>{t('voc.team')}</th>
                <th>{t('voc.submitter_name')}</th>
                <th>{t('voc.status')}</th>
                <th>{t('voc.col_created_at')}</th>
              </tr>
            </thead>
            <tbody>
              {pagedVocs.map((v) => (
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
                      {getTeamLabel(v.submitter_role)}
                    </span>
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

      {!loading && vocs.length > 0 && totalListPages > 1 && (
        <div className="pagination" role="navigation" aria-label={t('approval.pagination_nav')}>
          <button
            type="button"
            className="pagination-btn"
            onClick={() => setListPage((p) => Math.max(1, p - 1))}
            disabled={listPage === 1}
            aria-label={t('common.prev')}
          >
            ◀
          </button>
          {buildPageNumbers(listPage, totalListPages).map((item, idx) =>
            item === 'ellipsis' ? (
              <span key={`ellipsis-${idx}`} className="pagination-ellipsis">…</span>
            ) : (
              <button
                key={item}
                type="button"
                className={`pagination-btn ${item === listPage ? 'active' : ''}`}
                onClick={() => setListPage(item)}
                aria-current={item === listPage ? 'page' : undefined}
                aria-label={t('approval.pagination_go_to_page', { page: item })}
              >
                {item}
              </button>
            )
          )}
          <button
            type="button"
            className="pagination-btn"
            onClick={() => setListPage((p) => Math.min(totalListPages, p + 1))}
            disabled={listPage === totalListPages}
            aria-label={t('common.next')}
          >
            ▶
          </button>
        </div>
      )}

      {/* ── 등록 모달 ── */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={t('voc.new_voc')}
        // claude 수정 (2026-11-20): 'VOC 등록' 옆에 작성자 팀(현재 로그인 사용자 권한)을 표시. 저장값은 서버가 확정한다
        titleExtra={
          <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: 4 }}>
            {t('voc.team')}: {getTeamLabel(currentUser.role)}
          </span>
        }
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
          <div className="form-group">
            <label className="form-label">{t('voc.content')} <span className="required">*</span></label>
            <RichTextEditor
              value={form.content}
              onChange={(html) => setForm((f) => ({ ...f, content: html }))}
              placeholder={t('voc.content')}
            />
          </div>
        </form>
      </Modal>

      {/* ── 상세 모달 ── */}
      {selected && (
        <Modal
          isOpen={!!selected}
          onClose={() => setSelected(null)}
          title={selected.title}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
              {/* 삭제 버튼 (MASTER 전용) */}
              {isMaster && (
                <button
                  className="btn btn-danger"
                  style={{ marginRight: 'auto' }}
                  onClick={() => { setDeleteTarget(selected); setSelected(null); }}
                >
                  {t('voc.delete_btn')}
                </button>
              )}
              {/* 답변완료 버튼 (작성자 본인 또는 MASTER, 확인중 상태에서만) */}
              {(isMyVoc(selected) || isMaster) && selected.status === 'checking' && (
                <button className="btn btn-primary" onClick={handleMarkCompleted}>
                  {t('voc.mark_completed')}
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setSelected(null)}>
                {t('common.close')}
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* 메타 정보 — claude 수정 (2026-11-20): 유형·페이지 배지 → 작성자 팀 배지 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: 4 }}>
                {getTeamLabel(selected.submitter_role)}
              </span>
              <StatusBadge status={selected.status} />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {formatDate(selected.created_at)} · {selected.submitter_name}
              </span>
            </div>

            {/* 원본 내용 */}
            <div className="form-group">
              <label className="form-label">{t('voc.content')}</label>
              {/* claude 수정 (2026-10-23): 에디터로 넣은 표가 보이도록 공통 표 스타일 클래스 추가 */}
              {/* claude 수정 (2026-11-20): 저장형 XSS(B-26) 방어 — 에디터 스키마로 정화한 HTML 만 렌더 */}
              <div
                className="rich-table-render"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: '14px 16px',
                  fontSize: '0.95rem',
                  lineHeight: 1.7,
                }}
                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(selected.content) }}
              />
            </div>

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
                        border: '1px solid var(--border-color, #e2e8f0)',
                        borderRadius: 6,
                        padding: '10px 14px',
                        background: 'var(--bg-secondary, #f7fafc)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {c.author_name}
                          <span style={{ fontWeight: 400, marginLeft: 6 }}>{c.author_role}</span>
                        </span>
                        <span>{formatTime(c.created_at)}</span>
                      </div>
                      {/* claude 수정 (2026-10-23): 에디터로 넣은 표가 보이도록 공통 표 스타일 클래스 추가 */}
                      {/* claude 수정 (2026-11-20): 저장형 XSS(B-26) 방어 — 에디터 스키마로 정화한 HTML 만 렌더 */}
                      <div
                        className="rich-table-render"
                        style={{ fontSize: '0.9rem', lineHeight: 1.6 }}
                        dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(c.content) }}
                      />
                    </div>
                  ))
                )}
              </div>

              {/* 댓글 입력 (완료/반려 상태면 숨김) */}
              {selected.status === 'checking' && (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendComment();
                  }}
                >
                  <RichTextEditor
                    value={commentText}
                    onChange={setComment}
                    placeholder={t('voc.comment_placeholder' as any)}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleSendComment}
                    disabled={sendingComment || isCommentEmpty(commentText)}
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
      {/* ── 삭제 확인 모달 (상세 모달 밖에 배치) ── */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('voc.delete_confirm_title')}
        message={t('voc.delete_confirm_body')}
        confirmLabel={deleting ? t('common.loading') : t('voc.delete_btn')}
        danger
      />
    </div>
  );
}
