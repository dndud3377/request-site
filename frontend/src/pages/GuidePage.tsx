import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { guidesAPI } from '../api/client';
import { useToast } from '../components/Toast';
import Modal, { ConfirmModal } from '../components/Modal';
import RichTextEditor from '../components/RichTextEditor';
import {
  Guide,
  GuideType,
  GuideFeatureKey,
  CreateGuideInput,
  GUIDE_STEP_FEATURES,
} from '../types';
import { useAuth } from '../contexts/AuthContext';

// ===== Helpers =====

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });

type FilterTab = 'all' | 'feature' | 'info';

interface FormState {
  guide_type: GuideType;
  selectedStep: number | null;
  feature_key: GuideFeatureKey | null;
  title: string;
  content: string;
}

const EMPTY_FORM: FormState = {
  guide_type: 'feature',
  selectedStep: null,
  feature_key: null,
  title: '',
  content: '',
};

// ===== Page =====

export default function GuidePage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const { currentUser } = useAuth();

  // ── list state ──
  const [guides, setGuides]     = useState<Guide[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filterTab, setFilter]  = useState<FilterTab>('all');
  const [searchQuery, setSearch] = useState('');

  // ── detail modal (info guides only) ──
  const [selected, setSelected] = useState<Guide | null>(null);

  // ── write / edit modal ──
  const [formOpen, setFormOpen]           = useState(false);
  const [editTarget, setEditTarget]       = useState<Guide | null>(null);
  const [form, setForm]                   = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting]       = useState(false);
  const [allFeatureGuides, setAllFeatureGuides] = useState<Guide[]>([]);

  // ── delete confirm ──
  const [deleteTarget, setDeleteTarget] = useState<Guide | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // ─────────────── helpers ───────────────

  const canDelete = currentUser.role === 'MASTER';
  const canWrite = currentUser.role !== 'PL'; // PL은 가이드 작성/수정 불가(조회는 제한 없음)

  const featureLabel = useCallback(
    (key: GuideFeatureKey): string => t(`guide.feat.${key}` as never),
    [t]
  );

  // ─────────────── data ───────────────

  const fetchGuides = useCallback(() => {
    setLoading(true);
    const params: { guide_type?: string; search?: string } = {};
    if (filterTab !== 'all') params.guide_type = filterTab;
    if (searchQuery)         params.search = searchQuery;

    guidesAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        setGuides(Array.isArray(data) ? data : (data as { results: Guide[] }).results ?? []);
      })
      .catch(() => setGuides([]))
      .finally(() => setLoading(false));
  }, [filterTab, searchQuery]);

  useEffect(() => { fetchGuides(); }, [fetchGuides]);

  // ─────────────── actions ───────────────

  const openWrite = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    guidesAPI
      .list({ guide_type: 'feature' })
      .then((r) => {
        const data = r.data;
        setAllFeatureGuides(Array.isArray(data) ? data : (data as { results: Guide[] }).results ?? []);
      })
      .catch(() => setAllFeatureGuides([]));
    setFormOpen(true);
  };

  const openEdit = (guide: Guide) => {
    setEditTarget(guide);
    // reconstruct form state from existing guide
    let selectedStep: number | null = null;
    if (guide.guide_type === 'feature' && guide.feature_key) {
      for (const [step, features] of Object.entries(GUIDE_STEP_FEATURES)) {
        if (features.some((f) => f.key === guide.feature_key)) {
          selectedStep = Number(step);
          break;
        }
      }
    }
    setForm({
      guide_type: guide.guide_type,
      selectedStep,
      feature_key: guide.feature_key,
      title: guide.title,
      content: guide.content,
    });
    setSelected(null);
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    // validation
    if (form.guide_type === 'feature') {
      if (!form.feature_key) {
        addToast(t('guide.select_feature'), 'error');
        return;
      }
    } else {
      if (!form.title.trim()) {
        addToast(t('common.error'), 'error');
        return;
      }
    }
    if (!form.content.trim() || form.content === '<p></p>') {
      addToast(t('common.error'), 'error');
      return;
    }

    const payload: CreateGuideInput = {
      guide_type: form.guide_type,
      feature_key: form.guide_type === 'feature' ? form.feature_key : null,
      title: form.guide_type === 'feature' && form.feature_key
        ? featureLabel(form.feature_key)
        : form.title,
      content: form.content,
    };

    setSubmitting(true);
    try {
      if (editTarget) {
        const r = await guidesAPI.update(editTarget.id, payload);
        setGuides((prev) => prev.map((g) => (g.id === editTarget.id ? r.data : g)));
        addToast(t('guide.update_success'), 'success');
      } else {
        const r = await guidesAPI.create(payload);
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

  // ─────────────── derived ───────────────

  const stepFeatures = form.selectedStep ? GUIDE_STEP_FEATURES[form.selectedStep] ?? [] : [];

  // ─────────────── render ───────────────

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
        {canWrite && (
          <button className="btn btn-primary" onClick={openWrite}>
            + {t('guide.write')}
          </button>
        )}
      </div>

      {/* Layout: sidebar + main */}
      <div className="guide-layout">
        {/* Sidebar */}
        <aside className="guide-sidebar card" style={{ padding: '12px 8px' }}>
          {(['all', 'feature', 'info'] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              className={`guide-sidebar-btn${filterTab === tab ? ' active' : ''}`}
              onClick={() => setFilter(tab)}
            >
              {t(`guide.section_${tab}` as never)}
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
                  style={{ cursor: 'pointer' }}
                >
                  <span
                    className="guide-section-badge"
                    style={{
                      background: guide.guide_type === 'feature' ? '#eff6ff' : '#f0fdf4',
                      color: guide.guide_type === 'feature' ? '#3b82f6' : '#16a34a',
                    }}
                  >
                    {t(guide.guide_type === 'feature' ? 'guide.type_feature' : 'guide.type_info')}
                  </span>
                  <div className="guide-card-title">{guide.title}</div>
                  <div
                    className="guide-card-preview"
                    dangerouslySetInnerHTML={{
                      __html: guide.content.replace(/<[^>]+>/g, ' ').slice(0, 80),
                    }}
                  />
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

      {/* Info Guide Detail Modal */}
      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ''}
        size="lg"
        footer={
          selected ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {canWrite && (
                <button className="btn btn-secondary" onClick={() => openEdit(selected)}>
                  {t('guide.edit')}
                </button>
              )}
              {canDelete && (
                <button
                  className="btn btn-danger"
                  onClick={() => { setDeleteTarget(selected); setSelected(null); }}
                >
                  {t('guide.delete')}
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {selected && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
            <div
              className="guide-content-render"
              style={{ fontSize: 14, lineHeight: 1.85, color: '#333' }}
              dangerouslySetInnerHTML={{ __html: selected.content }}
            />
          </div>
        )}
      </Modal>

      {/* Write / Edit Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={t(editTarget ? 'guide.edit_title' : 'guide.write_title')}
        size="lg"
        footer={
          <>
            {editTarget && canDelete && (
              <button
                className="btn btn-danger"
                style={{ marginRight: 'auto' }}
                onClick={() => { setDeleteTarget(editTarget); setFormOpen(false); }}
                disabled={submitting}
              >
                {t('guide.delete')}
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setFormOpen(false)} disabled={submitting}>
              {t('guide.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('common.loading') : t('guide.save')}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {/* Guide type selection (only when creating) */}
          {!editTarget && (
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">{t('guide.type_label')}</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {(['feature', 'info'] as GuideType[]).map((type) => (
                  <div
                    key={type}
                    onClick={() => setForm((f) => ({
                      ...f,
                      guide_type: type,
                      selectedStep: null,
                      feature_key: null,
                      title: '',
                    }))}
                    style={{
                      flex: 1,
                      padding: '14px 16px',
                      border: `2px solid ${form.guide_type === type ? '#4f8ef7' : '#dde1ea'}`,
                      borderRadius: 10,
                      cursor: 'pointer',
                      background: form.guide_type === type ? '#eff6ff' : '#fafbff',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14, color: form.guide_type === type ? '#3b82f6' : '#333', marginBottom: 4 }}>
                      {type === 'feature' ? '⚙️' : '📋'} {t(`guide.type_${type}` as never)}
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      {t(`guide.type_${type}_desc` as never)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature type: step + feature selector */}
          {form.guide_type === 'feature' && (
            <>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">{t('guide.select_step')}</label>
                <select
                  className="form-control"
                  value={form.selectedStep ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      selectedStep: e.target.value ? Number(e.target.value) : null,
                      feature_key: null,
                    }))
                  }
                  disabled={!!editTarget}
                >
                  <option value="">{t('guide.select_step_placeholder')}</option>
                  {Object.keys(GUIDE_STEP_FEATURES).map(Number).map((s) => (
                    <option key={s} value={s}>{s <= 5 ? `Step ${s}` : t('guide.permission_step')}</option>
                  ))}
                </select>
              </div>

              {form.selectedStep && (
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">{t('guide.select_feature')}</label>
                  <select
                    className="form-control"
                    value={form.feature_key ?? ''}
                    onChange={(e) => {
                      const key = (e.target.value as GuideFeatureKey) || null;
                      if (key && allFeatureGuides.some((g) => g.feature_key === key)) {
                        addToast(t('guide.feature_already_exists'), 'error');
                        return;
                      }
                      setForm((f) => ({ ...f, feature_key: key }));
                    }}
                    disabled={!!editTarget}
                  >
                    <option value="">{t('guide.select_feature_placeholder')}</option>
                    {stepFeatures.map((feat) => (
                      <option key={feat.key} value={feat.key}>
                        {t(feat.labelKey as never)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* Info type: title input */}
          {form.guide_type === 'info' && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">{t('guide.info_title_label')}</label>
              <input
                className="form-control"
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t('guide.info_title_placeholder')}
              />
            </div>
          )}

          {/* Content editor */}
          <div className="form-group" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <label className="form-label">{t('guide.content_label')}</label>
            <RichTextEditor
              value={form.content}
              onChange={(html) => setForm((f) => ({ ...f, content: html }))}
              placeholder={t('guide.editor_placeholder')}
            />
          </div>
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
