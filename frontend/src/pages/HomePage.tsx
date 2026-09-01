import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI, noticesAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import StageGrid from '../components/StageGrid';
import Modal, { ConfirmModal } from '../components/Modal';
import RichTextEditor from '../components/RichTextEditor';
import GuideTourModal from '../components/GuideTourModal';
import AnnualDesignRuleChart from '../components/AnnualDesignRuleChart';
import { RequestDocument, AdminNotice, NoticeTemplate, ReleaseCategory, ReleaseItem } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { shouldShowNotice, markNoticeSeen } from '../utils/noticeStorage';
import { formatDate, formatDateTime } from '../utils/date';
import {
  getDocTableRows, getFinalCompletionDate, getLastRejectionInfo, isMyDocument, submittedSortKey,
  getDocDetailFields, getDocSubmittedDate,
} from '../utils/approvalTable';

// 홈 '나의 의뢰 현황' 에 보여줄 최대 건수 (그 이상은 '전체 보기' 로 결재현황 MY 탭에서 본다)
const MY_REQUESTS_LIMIT = 5;

const CATEGORY_ICON: Record<ReleaseCategory, string> = {
  new: '🆕',
  updated: '✏️',
  bugfix: '🐛',
};

// ─── 공지 관리 모달 ───────────────────────────────────────────────────────────

interface NoticeManagerModalProps {
  notices: AdminNotice[];
  isMaster: boolean;
  onClose: (hideToday: boolean) => void;
  onRefresh: () => void;
}

function NoticeManagerModal({ notices, isMaster, onClose, onRefresh }: NoticeManagerModalProps) {
  const { t } = useTranslation();

  const [hideToday, setHideToday] = useState(false);

  // 왼쪽 패널 상태
  const [tab, setTab] = useState<'all' | 'release_note' | 'notice'>('all');
  const [selected, setSelected] = useState<AdminNotice | null>(null);
  const [deleteNoticeTarget, setDeleteNoticeTarget] = useState<AdminNotice | null>(null);

  // 오른쪽 패널 상태
  const [rightPanel, setRightPanel] = useState<'detail' | 'form'>('detail');
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');

  // 폼 필드
  const today = new Date().toISOString().slice(0, 10);
  const [formTemplate, setFormTemplate] = useState<NoticeTemplate>('notice');
  const [formDate, setFormDate] = useState(today);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [newItems, setNewItems] = useState<string[]>(['']);
  const [updatedItems, setUpdatedItems] = useState<string[]>(['']);
  const [bugfixItems, setBugfixItems] = useState<string[]>(['']);

  // 탭 필터
  const filtered = tab === 'all' ? notices : notices.filter((n) => n.template === tab);

  // 초기 선택: 목록 첫 번째 항목 자동 선택
  useEffect(() => {
    if (filtered.length > 0 && !selected) {
      setSelected(filtered[0]);
    }
  }, []);

  // 탭 변경 시 selected가 필터에 없으면 초기화
  useEffect(() => {
    if (selected && !filtered.find((n) => n.id === selected.id)) {
      setSelected(filtered.length > 0 ? filtered[0] : null);
      setRightPanel('detail');
    }
  }, [tab]);

  const openCreateForm = () => {
    setFormMode('create');
    setFormTemplate('notice');
    setFormDate(today);
    setFormTitle('');
    setFormContent('');
    setNewItems(['']);
    setUpdatedItems(['']);
    setBugfixItems(['']);
    setRightPanel('form');
  };

  const openEditForm = (notice: AdminNotice) => {
    setFormMode('edit');
    setFormTemplate(notice.template);
    setFormDate(notice.date);
    setFormTitle(notice.title);
    setFormContent(notice.content ?? '');
    setNewItems(
      notice.items.filter((i) => i.category === 'new').map((i) => i.content).concat([''])
    );
    setUpdatedItems(
      notice.items.filter((i) => i.category === 'updated').map((i) => i.content).concat([''])
    );
    setBugfixItems(
      notice.items.filter((i) => i.category === 'bugfix').map((i) => i.content).concat([''])
    );
    setRightPanel('form');
  };

  const handleTogglePin = async (notice: AdminNotice) => {
    try {
      const r = await noticesAPI.update(notice.id, { is_pinned: !notice.is_pinned });
      onRefresh();
      if (r.data) setSelected(r.data);
    } catch (err) {
      console.error('Failed to toggle notice pin:', err);
    }
  };

  const handleDelete = async () => {
    if (!deleteNoticeTarget) return;
    try {
      await noticesAPI.delete(deleteNoticeTarget.id);
      onRefresh();
      setSelected(null);
      setRightPanel('detail');
    } catch (err) {
      console.error('Failed to delete notice:', err);
    } finally {
      setDeleteNoticeTarget(null);
    }
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formDate) return;

    const items: ReleaseItem[] = formTemplate === 'release_note'
      ? [
          ...newItems.filter((s) => s.trim()).map((content) => ({ category: 'new' as ReleaseCategory, content })),
          ...updatedItems.filter((s) => s.trim()).map((content) => ({ category: 'updated' as ReleaseCategory, content })),
          ...bugfixItems.filter((s) => s.trim()).map((content) => ({ category: 'bugfix' as ReleaseCategory, content })),
        ]
      : [];

    const data = {
      template: formTemplate,
      date: formDate,
      title: formTitle.trim(),
      content: formTemplate === 'notice' ? formContent : '',
      items,
      is_pinned: formMode === 'edit' && selected ? selected.is_pinned : false,
    };

    try {
      let saved: AdminNotice;
      if (formMode === 'edit' && selected) {
        const r = await noticesAPI.update(selected.id, data);
        saved = r.data!;
      } else {
        const r = await noticesAPI.create(data);
        saved = r.data!;
      }
      onRefresh();
      setSelected(saved);
      setRightPanel('detail');
    } catch (err) {
      console.error('Failed to save notice:', err);
    }
  };

  // Release Note 항목 헬퍼
  const updateItem = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    list: string[],
    index: number,
    value: string
  ) => {
    setter(list.map((s, i) => (i === index ? value : s)));
  };

  const addItem = (setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter((prev) => [...prev, '']);
  };

  const removeItem = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    list: string[],
    index: number
  ) => {
    setter(list.filter((_, i) => i !== index));
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal notice-modal-lg">
        {/* 헤더 */}
        <div className="modal-header">
          <h3 className="modal-title">📣 {t('notice.modal_title')}</h3>
          <button className="modal-close" onClick={() => onClose(false)} title={t('notice.close')}>×</button>
        </div>

        {/* 2단 본문 */}
        <div className="notice-modal-body">
          {/* ── 왼쪽 패널 ── */}
          <div className="notice-left-panel">
            {/* 탭 */}
            <div className="notice-tabs">
              {(['all', 'release_note', 'notice'] as const).map((tabKey) => (
                <button
                  key={tabKey}
                  className={`notice-tab ${tab === tabKey ? 'active' : ''}`}
                  onClick={() => setTab(tabKey)}
                >
                  {tabKey === 'all' ? t('notice.tab_all') : tabKey === 'release_note' ? t('notice.label_release') : t('notice.label_notice')}
                </button>
              ))}
            </div>

            {/* 목록 */}
            <div className="notice-list">
              {filtered.length === 0 ? (
                <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                  {t('notice.no_notice')}
                </div>
              ) : (
                filtered.map((n) => (
                  <button
                    key={n.id}
                    className={`notice-list-item ${selected?.id === n.id ? 'active' : ''}`}
                    onClick={() => { setSelected(n); setRightPanel('detail'); }}
                  >
                    <span className="notice-list-date">{n.date}</span>
                    <span className="notice-list-title">
                      {n.is_pinned && <span title={t('notice.pinned')}>📌 </span>}
                      {n.title}
                    </span>
                    <span className="notice-list-type">
                      {n.template === 'release_note' ? t('notice.label_release') : t('notice.label_notice')}
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* MASTER: 공지 작성 버튼 */}
            {isMaster && (
              <div className="notice-left-footer">
                <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={openCreateForm}>
                  + {t('notice.write')}
                </button>
              </div>
            )}
          </div>

          {/* ── 오른쪽 패널 ── */}
          <div className="notice-right-panel">
            {rightPanel === 'detail' && !selected && (
              <div className="notice-empty-state">
                {t('notice.select_from_list')}
              </div>
            )}

            {rightPanel === 'detail' && selected && (
              <>
                <div className="notice-right-content">
                  <div className="notice-detail-meta">
                    <span className="notice-detail-label">
                      [{selected.template === 'release_note' ? t('notice.label_release') : t('notice.label_notice')}]
                    </span>
                    {' · '}{selected.date}
                    {selected.is_pinned && <span> · 📌 {t('notice.pinned')}</span>}
                  </div>
                  <div className="notice-detail-title">{selected.title}</div>

                  {selected.template === 'notice' && selected.content && (
                    <div
                      className="notice-detail-content"
                      style={{ whiteSpace: 'pre-wrap' }}
                      dangerouslySetInnerHTML={{ __html: selected.content }}
                    />
                  )}

                  {selected.template === 'release_note' && (
                    <div className="notice-release-list">
                      {(['new', 'updated', 'bugfix'] as ReleaseCategory[]).map((cat) => {
                        const catItems = selected.items.filter((i) => i.category === cat);
                        if (catItems.length === 0) return null;
                        return catItems.map((item, idx) => (
                          <div key={`${cat}-${idx}`} className={`notice-release-row notice-release-${cat}`}>
                            <span className="notice-release-cat">{t(`notice.category_${cat}`)}</span>
                            <span className="notice-release-text">{item.content}</span>
                          </div>
                        ));
                      })}
                    </div>
                  )}
                </div>

                {isMaster && (
                  <div className="notice-right-footer">
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setDeleteNoticeTarget(selected)}
                    >
                      {t('common.delete')}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleTogglePin(selected)}
                    >
                      {selected.is_pinned ? t('notice.unpin') : t('notice.pin')}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => openEditForm(selected)}
                    >
                      {t('notice.edit')}
                    </button>
                  </div>
                )}
              </>
            )}

            {rightPanel === 'form' && (
              <>
                <div className="notice-right-content">
                  <div style={{ marginBottom: 16, fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                    {formMode === 'create' ? t('notice.write') : t('notice.edit')}
                  </div>

                  {/* 템플릿 */}
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label">{t('notice.template')}</label>
                    <div style={{ display: 'flex', gap: 16 }}>
                      {(['notice', 'release_note'] as NoticeTemplate[]).map((tpl) => (
                        <label key={tpl} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            value={tpl}
                            checked={formTemplate === tpl}
                            onChange={() => setFormTemplate(tpl)}
                          />
                          {tpl === 'notice' ? t('notice.template_notice') : t('notice.template_release')}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 날짜 */}
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label">{t('notice.date')}</label>
                    <input
                      type="date"
                      className="form-control"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      style={{ maxWidth: 180 }}
                    />
                  </div>

                  {/* 제목 */}
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label">{t('notice.title')}</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder={t('notice.title')}
                    />
                  </div>

                  {/* Notice: 본문 */}
                  {formTemplate === 'notice' && (
                    <div className="form-group">
                      <label className="form-label">{t('notice.content')}</label>
                      <RichTextEditor
                        value={formContent}
                        onChange={(html) => setFormContent(html)}
                        placeholder={t('notice.content')}
                      />
                    </div>
                  )}

                  {/* Release Note: 3개 고정 섹션 */}
                  {formTemplate === 'release_note' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {(
                        [
                          { cat: 'new', label: t('notice.category_new'), items: newItems, setter: setNewItems },
                          { cat: 'updated', label: t('notice.category_updated'), items: updatedItems, setter: setUpdatedItems },
                          { cat: 'bugfix', label: t('notice.category_bugfix'), items: bugfixItems, setter: setBugfixItems },
                        ] as const
                      ).map(({ cat, label, items, setter }) => (
                        <div key={cat} className={`notice-form-section notice-form-section-${cat}`}>
                          <div className={`notice-form-section-header ${cat}`}>
                            <span>{label}</span>
                          </div>
                          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {items.map((val, idx) => (
                              <div key={idx} className="notice-form-item-row">
                                <input
                                  type="text"
                                  className="form-control"
                                  value={val}
                                  onChange={(e) => updateItem(setter, items, idx, e.target.value)}
                                  placeholder={t('notice.item_placeholder')}
                                />
                                {items.length > 1 && (
                                  <button
                                    className="btn btn-danger btn-sm"
                                    style={{ flexShrink: 0 }}
                                    onClick={() => removeItem(setter, items, idx)}
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            ))}
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ alignSelf: 'flex-start', marginTop: 2 }}
                              onClick={() => addItem(setter)}
                            >
                              {t('notice.add_item')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="notice-right-footer">
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setRightPanel('detail'); }}
                  >
                    {t('notice.cancel')}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSave}
                    disabled={!formTitle.trim() || !formDate}
                  >
                    {t('notice.save')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 푸터 */}
        <div className="notice-modal-footer">
          <label className="notice-hide-today-label">
            <input
              type="checkbox"
              checked={hideToday}
              onChange={(e) => setHideToday(e.target.checked)}
            />
            {t('notice.hide_today')}
          </label>
          <button className="btn btn-primary btn-sm" onClick={() => onClose(hideToday)}>
            {t('notice.confirm')}
          </button>
        </div>
      </div>
      <ConfirmModal
        isOpen={!!deleteNoticeTarget}
        onClose={() => setDeleteNoticeTarget(null)}
        onConfirm={handleDelete}
        title={t('notice.delete_title')}
        message={t('notice.delete_confirm', { title: deleteNoticeTarget?.title ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        topLevel
      />
    </div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────

export default function HomePage(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const isMaster = currentUser.role === 'MASTER';
  const hasNoRole = currentUser.role === 'NONE';

  const [recent, setRecent] = useState<RequestDocument[]>([]);
  const [allNotices, setAllNotices] = useState<AdminNotice[]>([]);
  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showPermissionAlert, setShowPermissionAlert] = useState(false);

  const goOrAlert = useCallback((path: string) => {
    if (hasNoRole) {
      setShowPermissionAlert(true);
      return;
    }
    navigate(path);
  }, [hasNoRole, navigate]);

  const loadNotices = useCallback(async () => {
    try {
      const r = await noticesAPI.list();
      const list = r.data ?? [];
      setAllNotices(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // 초기 로드 및 자동 오픈 (매 접속 시, hide_until 억제 or 내용 변경 시 오픈)
  // 권한 없는(NONE) 사용자는 공지사항 접근 권한이 없으므로 자동 오픈하지 않는다.
  useEffect(() => {
    if (hasNoRole) return;
    loadNotices().then((list) => {
      if (list.length === 0) return;
      const maxUpdatedAt = list.reduce((max, n) => (n.updated_at > max ? n.updated_at : max), '');
      if (shouldShowNotice(maxUpdatedAt)) {
        setShowNoticeModal(true);
      }
    });
  }, [hasNoRole, loadNotices]);

  // Navbar 확성기 클릭 이벤트 수신
  useEffect(() => {
    const handler = () => setShowNoticeModal(true);
    window.addEventListener('show-notice', handler);
    return () => window.removeEventListener('show-notice', handler);
  }, []);

  // 나의 의뢰 현황 로드 — 결재현황 MY 탭과 같은 판정(isMyDocument)을 쓴다.
  // 완료(approved)건은 빼고, 결재현황 기본 정렬과 같은 '상신 오래된 순'으로 최대 5건.
  useEffect(() => {
    if (hasNoRole) { setRecent([]); return; }
    documentsAPI.list({}).then((r) => {
      const data = r.data;
      const all: RequestDocument[] = Array.isArray(data) ? data : (data as any).results ?? [];
      setRecent(
        all
          .filter((d) => d.status !== 'approved' && isMyDocument(d, currentUser))
          .sort((a, b) => submittedSortKey(a).localeCompare(submittedSortKey(b)))
          .slice(0, MY_REQUESTS_LIMIT)
      );
    }).catch(() => {});
  }, [hasNoRole, currentUser]);

  const handleCloseModal = useCallback((hideToday: boolean) => {
    const maxUpdatedAt = allNotices.reduce((max, n) => (n.updated_at > max ? n.updated_at : max), '');
    markNoticeSeen(maxUpdatedAt, hideToday);
    window.dispatchEvent(new CustomEvent('notice-read'));
    setShowNoticeModal(false);
  }, [allNotices]);

  const handleRefresh = useCallback(() => {
    loadNotices();
  }, [loadNotices]);

  return (
    <div>
      {/* 권한 없음 안내 모달 */}
      <Modal
        isOpen={showPermissionAlert}
        onClose={() => setShowPermissionAlert(false)}
        title={t('home.permission_required_title')}
        size="sm"
        hideFullscreen
        style={{ maxWidth: '420px' }}
        footer={
          <button className="btn btn-primary" onClick={() => setShowPermissionAlert(false)}>
            {t('common.confirm')}
          </button>
        }
      >
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {t('home.permission_required_message')}
        </p>
      </Modal>

      {/* 전체 가이드 모달 */}
      <GuideTourModal isOpen={showTour} onClose={() => setShowTour(false)} />

      {/* 공지 모달 */}
      {showNoticeModal && (
        <NoticeManagerModal
          notices={allNotices}
          isMaster={isMaster}
          onClose={handleCloseModal}
          onRefresh={handleRefresh}
        />
      )}

      {/* Hero */}
      <div className="hero">
        <div className="hero-grid" />
        <div className="container">
          <div className="hero-content">
            <div className="hero-badge">Product Introduction Map System</div>
            <h1>
              <span className="highlight">{t('home.hero_title')}</span>
            </h1>
            <p className="hero-subtitle">{t('home.hero_subtitle')}</p>
            <p className="hero-desc">{t('home.hero_desc')}</p>
            <div className="hero-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => goOrAlert('/request')}
              >
                ✏️ {t('home.start_request')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-lg"
                onClick={() => goOrAlert('/approval')}
              >
                📋 {t('home.view_status')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-lg"
                onClick={() => (hasNoRole ? setShowPermissionAlert(true) : setShowTour(true))}
              >
                ❓ {t('guide.tour.button')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container page">
        {/* 나의 의뢰 현황 — 연간 차트보다 위에 둔다. 역할 없는 사용자에겐 노출하지 않는다. */}
        {!hasNoRole && (
          <div style={{ marginBottom: 32 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <h2 className="section-title">{t('home.my_requests_title')}</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => goOrAlert('/approval?filter=my')}
              >
                {t('home.view_all')} →
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📭</div>
                <p>{t('home.my_requests_empty')}</p>
              </div>
            ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('approval.col_line')}</th>
                    <th>{t('approval.col_purpose')}</th>
                    <th>{t('approval.col_map_purpose')}</th>
                    <th>{t('approval.col_product_combo')}</th>
                    <th>{t('approval.col_submitted')}</th>
                    <th>{t('approval.col_requester')}</th>
                    <th>{t('approval.col_current_stage')}</th>
                    <th>{t('approval.col_final_completion')}</th>
                    <th>{t('approval.col_production_date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((doc) => {
                    // 결재 현황(ApprovalPage)과 동일한 계산·렌더로 현재 단계를 표시한다.
                    // 병렬 진입 후에도 문서 1건 = 표 1행이며, 칸 안의 3행 2열 그리드가 경로를 모두 보여준다.
                    const row = getDocTableRows(doc, t)[0];
                    const isPaused = doc.status === 'pause';
                    const lastRejection = getLastRejectionInfo(doc, t);
                    const detail = getDocDetailFields(doc);
                    const comboText = [detail.processSelection, detail.partidSelection, detail.processId]
                      .filter(Boolean).join(' · ') || '-';
                    return (
                      <tr key={doc.id}>
                        <td><b>{detail.line || '-'}</b></td>
                        <td>
                          <div className="purpose-cell">
                            <span className="purpose-cell-main">{detail.purpose || '-'}</span>
                            {detail.otherPurpose.map((o) => (
                              <span key={o} className="purpose-cell-sub">{o}</span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {detail.isAdiCd ? (
                            <span className="map-purpose-na">{t('approval.step_na')}</span>
                          ) : (detail.mapType || '-')}
                        </td>
                        <td>
                          <button
                            className="product-combo-link"
                            onClick={() => goOrAlert('/approval')}
                          >
                            {comboText}
                          </button>
                          {detail.adiExtraCount > 0 && <span className="adi-extra-badge">+{detail.adiExtraCount}</span>}
                          {lastRejection && (
                            <div style={{ marginTop: 4 }}>
                              <span className="rejection-history-chip">
                                {t('approval.rejection_history_chip', { round: lastRejection.round, stage: lastRejection.stageLabel })}
                              </span>
                            </div>
                          )}
                        </td>
                        <td>{formatDateTime(getDocSubmittedDate(doc))}</td>
                        <td>
                          <div>{doc.requester_name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{doc.requester_department}</div>
                        </td>
                        <td style={{ fontWeight: 500 }}>
                          {row.cells ? (
                            <StageGrid cells={row.cells} columns={row.gridColumns} />
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <StatusBadge status={row.pathStatus} />
                              <span style={{ color: row.isDone ? 'var(--text-disabled)' : 'var(--text-primary)' }}>{row.stageText}</span>
                              {row.pauseRequested && (
                                <span className="pause-req-chip">⏸ {t('approval.pause_requested_chip')}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td>{isPaused ? <span style={{ color: 'var(--text-muted)' }}>{t('approval.filter_pause')}</span> : getFinalCompletionDate(doc)}</td>
                        <td>{doc.production_date ? formatDate(doc.production_date) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}

        {/* 연간 제품별(디자인룰) 의뢰 현황 — 역할 없는 사용자에겐 노출하지 않는다 */}
        {!hasNoRole && (
          <div>
            <AnnualDesignRuleChart isMaster={isMaster} />
          </div>
        )}
      </div>
    </div>
  );
}
