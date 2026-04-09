import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { documentsAPI, noticesAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { RequestDocument, AdminNotice, NoticeTemplate, ReleaseCategory, ReleaseItem } from '../types';
import { useAuth } from '../contexts/AuthContext';

const LAST_SEEN_NOTICE_KEY = 'last_seen_notice_id';

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ko-KR');
};

const CATEGORY_ICON: Record<ReleaseCategory, string> = {
  new: '🆕',
  updated: '✏️',
  bugfix: '🐛',
};

// ─── 공지 관리 모달 ───────────────────────────────────────────────────────────

interface NoticeManagerModalProps {
  notices: AdminNotice[];
  isMaster: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

function NoticeManagerModal({ notices, isMaster, onClose, onRefresh }: NoticeManagerModalProps) {
  const { t } = useTranslation();

  // 왼쪽 패널 상태
  const [tab, setTab] = useState<'all' | 'release_note' | 'notice'>('all');
  const [selected, setSelected] = useState<AdminNotice | null>(null);

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

  const handleDelete = async (notice: AdminNotice) => {
    if (!window.confirm(`"${notice.title}" 공지를 삭제하시겠습니까?`)) return;
    try {
      await noticesAPI.delete(notice.id);
      onRefresh();
      setSelected(null);
      setRightPanel('detail');
    } catch (err) {
      console.error('Failed to delete notice:', err);
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
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal notice-modal-lg">
        {/* 헤더 */}
        <div className="modal-header">
          <h3 className="modal-title">📣 공지사항</h3>
          <button className="modal-close" onClick={onClose} title={t('notice.close')}>×</button>
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
                  {tabKey === 'all' ? '전체' : tabKey === 'release_note' ? 'RN' : '공지'}
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
                    <span className="notice-list-title">{n.title}</span>
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
                목록에서 항목을 선택하세요
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
                  </div>
                  <div className="notice-detail-title">{selected.title}</div>

                  {selected.template === 'notice' && selected.content && (
                    <div className="notice-detail-content">{selected.content}</div>
                  )}

                  {selected.template === 'release_note' && (
                    <div className="notice-release-list">
                      {(['new', 'updated', 'bugfix'] as ReleaseCategory[]).map((cat) => {
                        const catItems = selected.items.filter((i) => i.category === cat);
                        if (catItems.length === 0) return null;
                        return catItems.map((item, idx) => (
                          <div key={`${cat}-${idx}`} className={`notice-release-row notice-release-${cat}`}>
                            <span className="notice-release-icon">{CATEGORY_ICON[cat]}</span>
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
                      onClick={() => handleDelete(selected)}
                    >
                      {t('common.delete')}
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
                      <textarea
                        className="form-control"
                        rows={5}
                        value={formContent}
                        onChange={(e) => setFormContent(e.target.value)}
                        placeholder={t('notice.content')}
                      />
                    </div>
                  )}

                  {/* Release Note: 3개 고정 섹션 */}
                  {formTemplate === 'release_note' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {(
                        [
                          { cat: 'new', icon: '🆕', label: t('notice.category_new'), items: newItems, setter: setNewItems },
                          { cat: 'updated', icon: '✏️', label: t('notice.category_updated'), items: updatedItems, setter: setUpdatedItems },
                          { cat: 'bugfix', icon: '🐛', label: t('notice.category_bugfix'), items: bugfixItems, setter: setBugfixItems },
                        ] as const
                      ).map(({ cat, icon, label, items, setter }) => (
                        <div key={cat} className={`notice-form-section notice-form-section-${cat}`}>
                          <div className={`notice-form-section-header ${cat}`}>
                            <span>{icon} {label}</span>
                          </div>
                          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {items.map((val, idx) => (
                              <div key={idx} className="notice-form-item-row">
                                <input
                                  type="text"
                                  className="form-control"
                                  value={val}
                                  onChange={(e) => updateItem(setter, items, idx, e.target.value)}
                                  placeholder="내용을 입력하세요"
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
      </div>
    </div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────

export default function HomePage(): React.ReactElement {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const isMaster = currentUser.role === 'MASTER';

  const [recent, setRecent] = useState<RequestDocument[]>([]);
  const [allNotices, setAllNotices] = useState<AdminNotice[]>([]);
  const [showNoticeModal, setShowNoticeModal] = useState(false);

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

  // 초기 로드 및 미확인 공지 자동 오픈
  useEffect(() => {
    loadNotices().then((list) => {
      if (list.length === 0) return;
      const latest = list[0];
      const lastSeen = parseInt(localStorage.getItem(LAST_SEEN_NOTICE_KEY) ?? '0', 10);
      if (latest.id > lastSeen) {
        setShowNoticeModal(true);
      }
    });
  }, []);

  // Navbar 확성기 클릭 이벤트 수신
  useEffect(() => {
    const handler = () => setShowNoticeModal(true);
    window.addEventListener('show-notice', handler);
    return () => window.removeEventListener('show-notice', handler);
  }, []);

  // 최근 의뢰 로드
  useEffect(() => {
    documentsAPI.list({}).then((r) => {
      const data = r.data;
      const all: RequestDocument[] = Array.isArray(data) ? data : (data as any).results ?? [];
      setRecent(all.filter((d) => d.status !== 'approved').slice(0, 5));
    }).catch(() => {});
  }, []);

  const handleCloseModal = useCallback(() => {
    if (allNotices.length > 0) {
      localStorage.setItem(LAST_SEEN_NOTICE_KEY, String(allNotices[0].id));
      window.dispatchEvent(new CustomEvent('notice-read'));
    }
    setShowNoticeModal(false);
  }, [allNotices]);

  const handleRefresh = useCallback(() => {
    loadNotices();
  }, [loadNotices]);

  return (
    <div>
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
            <div className="hero-badge">🗺️ Product Introduction Map System</div>
            <h1>
              <span className="highlight">{t('home.hero_title')}</span>
            </h1>
            <p className="hero-subtitle">{t('home.hero_subtitle')}</p>
            <p className="hero-desc">{t('home.hero_desc')}</p>
            <div className="hero-actions">
              <Link to="/request" className="btn btn-primary btn-lg">
                ✏️ {t('home.start_request')}
              </Link>
              <Link to="/approval" className="btn btn-secondary btn-lg">
                📋 {t('home.view_status')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="container page">
        {/* Recent */}
        {recent.length > 0 && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <h2 className="section-title">{t('home.recent_title')}</h2>
              <Link to="/approval" className="btn btn-secondary btn-sm">
                {t('home.view_all')} →
              </Link>
            </div>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('approval.col_title')}</th>
                    <th>{t('approval.col_product')}</th>
                    <th>{t('approval.col_requester')}</th>
                    <th>{t('approval.col_status')}</th>
                    <th>{t('approval.col_submitted')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((doc) => (
                    <tr key={doc.id}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        {doc.title}
                      </td>
                      <td>{doc.product_name}</td>
                      <td>{doc.requester_name}</td>
                      <td>
                        <StatusBadge status={doc.status} />
                      </td>
                      <td>{formatDate(doc.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
