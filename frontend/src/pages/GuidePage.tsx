import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { guidesAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal, { ConfirmModal } from '../components/Modal';
import { Guide, GuideSection, CreateGuideInput } from '../types';
import { useAuth } from '../contexts/AuthContext';

// ===== Constants =====

type SectionFilter = GuideSection | 'all';

interface SectionOption {
  value: SectionFilter;
  labelKey: string;
}

const SECTIONS: SectionOption[] = [
  { value: 'all',            labelKey: 'guide.section_all' },
];

const SECTION_KEYS = SECTIONS.filter((s) => s.value !== 'all').map((s) => s.value as GuideSection);

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });

// ===== Page =====

export default function GuidePage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const { currentUser } = useAuth();

  // ── list state ──
  const [guides, setGuides]       = useState<Guide[]>([]);
  const [loading, setLoading]     = useState(true);
  const [section, setSection]     = useState<SectionFilter>('all');
  const [searchQuery, setSearch]  = useState('');

  // ── detail modal ──
  const [selected, setSelected]   = useState<Guide | null>(null);

  // ── write / edit modal ──
  const [formOpen, setFormOpen]   = useState(false);
  const [editTarget, setEditTarget] = useState<Guide | null>(null);
  const [form, setForm]           = useState<CreateGuideInput>({ title: '', section: 'general', content: '' });
  const [submitting, setSubmitting] = useState(false);

  // ── delete confirm ──
  const [deleteTarget, setDeleteTarget] = useState<Guide | null>(null);
  const [deleting, setDeleting]   = useState(false);

  // ─────────────── helpers ───────────────

  const canEdit = useCallback(
    (guide: Guide) =>
      currentUser.role === 'MASTER' ||
      currentUser.role === guide.author_role ||
      currentUser.name === guide.author_name,
    [currentUser]
  );

  // ─────────────── data ───────────────

  const fetchGuides = useCallback(() => {
    setLoading(true);
    const params: { section?: string; search?: string } = {};
    if (section !== 'all') params.section = section;
    if (searchQuery)       params.search  = searchQuery;

    guidesAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        setGuides(Array.isArray(data) ? data : (data as { results: Guide[] }).results ?? []);
      })
      .catch(() => setGuides([]))
      .finally(() => setLoading(false));
  }, [section, searchQuery]);

  useEffect(() => { fetchGuides(); }, [fetchGuides]);

  // ─────────────── actions ───────────────

  const openWrite = () => {
    setEditTarget(null);
    setForm({ title: '', section: 'general', content: '' });
    setFormOpen(true);
  };

  const openEdit = (guide: Guide) => {
    setEditTarget(guide);
    setForm({ title: guide.title, section: guide.section, content: guide.content });
    setSelected(null);
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      addToast(t('common.error'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      if (editTarget) {
        const r = await guidesAPI.update(editTarget.id, form);
        setGuides((prev) => prev.map((g) => (g.id === editTarget.id ? r.data : g)));
        addToast(t('guide.update_success'), 'success');
      } else {
        const r = await guidesAPI.create(form);
        setGuides((prev) => [r.data, ...prev]);
        addToast(t('guide.create_success'), 'success');
      }
      setFormOpen(false);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await guidesAPI.delete(deleteTarget.id);
      setGuides((prev) => prev.filter((g) => g.id !== deleteTarget.id));
      if (selected?.id === deleteTarget.id) setSelected(null);
      addToast(t('guide.delete_success'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // ─────────────── render ───────────────

  const sectionLabel = (s: GuideSection): string =>
    t(`guide.section_${s}` as any);

  return (
    <div className="container page">
      {/* Header */}
      <div className="page-header">
        <h1>{t('guide.title')}</h1>
        <p>{t('guide.subtitle')}</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('guide.search_placeholder')}
          />
        </div>
        <button className="btn btn-primary" onClick={openWrite}>
          + {t('guide.write')}
        </button>
      </div>

      {/* Layout: sidebar + main */}
      <div className="guide-layout">
        {/* Sidebar */}
        <aside className="guide-sidebar card" style={{ padding: '12px 8px' }}>
          {SECTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`guide-sidebar-btn${section === opt.value ? ' active' : ''}`}
              onClick={() => setSection(opt.value)}
            >
              {t(opt.labelKey as any)}
            </button>
          ))}
        </aside>

        {/* Main grid */}
        <main className="guide-main">
          {loading ? (
            <p style={{ color: 'var(--text-muted)', padding: '32px 0' }}>{t('common.loading')}</p>
          ) : guides.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', padding: '32px 0' }}>{t('guide.no_guides')}</p>
          ) : (
            <div className="guide-grid">
              {guides.map((guide) => (
                <div
                  key={guide.id}
                  className="card guide-card"
                  onClick={() => setSelected(guide)}
                >
                  <span className="guide-section-badge">{sectionLabel(guide.section)}</span>
                  <div className="guide-card-title">{guide.title}</div>
                  <div className="guide-card-preview">{guide.content}</div>
                  <div className="guide-card-meta">
                    <span>{guide.author_name}</span>
                    <span>·</span>
                    <span>{formatDate(guide.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Detail Modal */}
      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ''}
        size="lg"
        footer={
          selected && canEdit(selected) ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => openEdit(selected)}>
                {t('guide.edit')}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => { setDeleteTarget(selected); setSelected(null); }}
              >
                {t('guide.delete')}
              </button>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="guide-section-badge">{sectionLabel(selected.section)}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {t('guide.author')}: {selected.author_name}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {t('guide.created_at')}: {formatDate(selected.created_at)}
              </span>
              {selected.updated_at !== selected.created_at && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {t('guide.updated_at')}: {formatDate(selected.updated_at)}
                </span>
              )}
            </div>
            <pre className="guide-content-body">{selected.content}</pre>
          </div>
        )}
      </Modal>

      {/* Write / Edit Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={t(editTarget ? 'guide.modal_edit_title' : 'guide.modal_write_title')}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setFormOpen(false)} disabled={submitting}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('common.loading') : t('common.save')}
            </button>
          </>
        }
      >
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">{t('guide.form_title')}</label>
          <input
            className="form-control"
            type="text"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder={t('guide.form_title')}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">{t('guide.form_section')}</label>
          <select
            className="form-control"
            value={form.section}
            onChange={(e) => setForm((f) => ({ ...f, section: e.target.value as GuideSection }))}
          >
            {SECTION_KEYS.map((s) => (
              <option key={s} value={s}>{sectionLabel(s)}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{t('guide.form_content')}</label>
          <textarea
            className="form-control"
            rows={12}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder={t('guide.form_content')}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('guide.delete')}
        message={t('guide.confirm_delete')}
        confirmLabel={deleting ? t('common.loading') : t('guide.delete')}
        danger
      />
    </div>
  );
}
