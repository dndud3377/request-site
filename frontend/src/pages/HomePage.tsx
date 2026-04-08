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

// ─── 공지 배너 컴포넌트 ───────────────────────────────────────────────────────

interface NoticeBannerProps {
  notice: AdminNotice;
  onClose: () => void;
  onEdit: () => void;
  isMaster: boolean;
}

function NoticeBanner({ notice, onClose, onEdit, isMaster }: NoticeBannerProps) {
  const { t } = useTranslation();
  const label = notice.template === 'notice'
    ? t('notice.label_notice')
    : t('notice.label_release');

  return (
    <div className="notice-banner">
      <div className="container">
      <div className="notice-banner-header">
        <span className="notice-banner-label">
          📣 [{label}] {notice.date}
        </span>
        <div className="notice-banner-actions">
          {isMaster && (
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>
              {t('notice.edit')}
            </button>
          )}
          <button className="notice-close-btn" onClick={onClose} title={t('notice.close')}>
            ×
          </button>
        </div>
      </div>

      <div className="notice-banner-title">{notice.title}</div>

      {notice.template === 'notice' && notice.content && (
        <div className="notice-banner-content">{notice.content}</div>
      )}

      {notice.template === 'release_note' && notice.items.length > 0 && (
        <div className="notice-release-items">
          {notice.items.map((item, i) => (
            <span key={i} className={`notice-release-item notice-release-${item.category}`}>
              {CATEGORY_ICON[item.category]} {t(`notice.category_${item.category}`)}: {item.content}
            </span>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

// ─── 공지 편집 모달 ───────────────────────────────────────────────────────────

interface NoticeModalProps {
  initial?: AdminNotice | null;
  onSave: (data: Omit<AdminNotice, 'id' | 'created_at' | 'updated_at'>) => void;
  onClose: () => void;
}

function NoticeModal({ initial, onSave, onClose }: NoticeModalProps) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);

  const [template, setTemplate] = useState<NoticeTemplate>(initial?.template ?? 'notice');
  const [date, setDate] = useState(initial?.date ?? today);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [items, setItems] = useState<ReleaseItem[]>(
    initial?.items && initial.items.length > 0
      ? initial.items
      : [{ category: 'new', content: '' }]
  );

  const addItem = () => setItems((prev) => [...prev, { category: 'new', content: '' }]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof ReleaseItem, value: string) => {
    setItems((prev) =>
      prev.map((item, idx) =>
        idx === i ? { ...item, [field]: value } : item
      )
    );
  };

  const handleSave = () => {
    if (!title.trim() || !date) return;
    onSave({
      template,
      date,
      title: title.trim(),
      content: template === 'notice' ? content : '',
      items: template === 'release_note' ? items.filter((it) => it.content.trim()) : [],
    });
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3 className="modal-title">
            {initial ? t('notice.edit') : t('notice.write')}
          </h3>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 템플릿 선택 */}
          <div className="form-group">
            <label className="form-label">{t('notice.template')}</label>
            <div className="radio-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  value="notice"
                  checked={template === 'notice'}
                  onChange={() => setTemplate('notice')}
                />
                {t('notice.template_notice')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  value="release_note"
                  checked={template === 'release_note'}
                  onChange={() => setTemplate('release_note')}
                />
                {t('notice.template_release')}
              </label>
            </div>
          </div>

          {/* 날짜 */}
          <div className="form-group">
            <label className="form-label">{t('notice.date')}</label>
            <input
              type="date"
              className="form-control"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* 제목 */}
          <div className="form-group">
            <label className="form-label">{t('notice.title')}</label>
            <input
              type="text"
              className="form-control"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('notice.title')}
            />
          </div>

          {/* Notice: 본문 */}
          {template === 'notice' && (
            <div className="form-group">
              <label className="form-label">{t('notice.content')}</label>
              <textarea
                className="form-control"
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('notice.content')}
              />
            </div>
          )}

          {/* Release Note: 항목 */}
          {template === 'release_note' && (
            <div className="form-group">
              <label className="form-label">{t('notice.template_release')} 항목</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="form-control"
                      style={{ width: 110, flexShrink: 0 }}
                      value={item.category}
                      onChange={(e) => updateItem(i, 'category', e.target.value as ReleaseCategory)}
                    >
                      <option value="new">{t('notice.category_new')}</option>
                      <option value="updated">{t('notice.category_updated')}</option>
                      <option value="bugfix">{t('notice.category_bugfix')}</option>
                    </select>
                    <input
                      type="text"
                      className="form-control"
                      value={item.content}
                      onChange={(e) => updateItem(i, 'content', e.target.value)}
                      placeholder="내용을 입력하세요"
                    />
                    {items.length > 1 && (
                      <button
                        className="btn btn-danger btn-sm"
                        style={{ flexShrink: 0 }}
                        onClick={() => removeItem(i)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addItem}>
                  {t('notice.add_item')}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>{t('notice.cancel')}</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!title.trim() || !date}
          >
            {t('notice.save')}
          </button>
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
  const [latestNotice, setLatestNotice] = useState<AdminNotice | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false); // true=편집, false=신규 작성

  // 최신 공지 로드
  useEffect(() => {
    noticesAPI.latest().then((r) => {
      if (!r.data) return;
      setLatestNotice(r.data);
      const lastSeen = parseInt(localStorage.getItem(LAST_SEEN_NOTICE_KEY) ?? '0', 10);
      if (r.data.id > lastSeen) {
        setShowBanner(true);
      }
    }).catch(() => {});
  }, []);

  // Navbar 확성기 클릭 이벤트 수신
  useEffect(() => {
    const handler = () => setShowBanner(true);
    window.addEventListener('show-notice', handler);
    return () => window.removeEventListener('show-notice', handler);
  }, []);

  // Navbar 공지 작성 버튼 이벤트 수신
  useEffect(() => {
    const handler = () => { setEditMode(false); setShowModal(true); };
    window.addEventListener('open-write-notice', handler);
    return () => window.removeEventListener('open-write-notice', handler);
  }, []);

  // 최근 의뢰 로드
  useEffect(() => {
    documentsAPI.list({}).then((r) => {
      const data = r.data;
      const all: RequestDocument[] = Array.isArray(data) ? data : (data as any).results ?? [];
      setRecent(all.filter((d) => d.status !== 'approved').slice(0, 5));
    }).catch(() => {});
  }, []);

  const handleCloseBanner = useCallback(() => {
    if (latestNotice) {
      localStorage.setItem(LAST_SEEN_NOTICE_KEY, String(latestNotice.id));
      window.dispatchEvent(new CustomEvent('notice-read'));
    }
    setShowBanner(false);
  }, [latestNotice]);

  const handleSaveNotice = async (data: Omit<AdminNotice, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      let saved: AdminNotice;
      if (editMode && latestNotice) {
        const r = await noticesAPI.update(latestNotice.id, data);
        saved = r.data!;
      } else {
        const r = await noticesAPI.create(data);
        saved = r.data!;
      }
      setLatestNotice(saved);
      setShowModal(false);
      // 저장 후 배너 자동 표시
      localStorage.removeItem(LAST_SEEN_NOTICE_KEY);
      setShowBanner(true);
    } catch (err) {
      console.error('Failed to save notice:', err);
    }
  };

  const openWriteModal = () => {
    setEditMode(false);
    setShowModal(true);
  };

  const openEditModal = () => {
    setEditMode(true);
    setShowModal(true);
  };

  return (
    <div>
      {/* 공지 배너 */}
      {showBanner && latestNotice && (
        <NoticeBanner
          notice={latestNotice}
          onClose={handleCloseBanner}
          onEdit={openEditModal}
          isMaster={isMaster}
        />
      )}

      {/* 공지 편집/작성 모달 */}
      {showModal && (
        <NoticeModal
          initial={editMode ? latestNotice : null}
          onSave={handleSaveNotice}
          onClose={() => setShowModal(false)}
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
