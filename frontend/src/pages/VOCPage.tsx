import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { vocAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { VOC, VocCategory, CreateVocInput } from '../types';

interface CategoryOption {
  value: VocCategory;
  labelKey: string;
}

const CATEGORIES: CategoryOption[] = [
  { value: 'inquiry', labelKey: 'voc.category_inquiry' },
  { value: 'complaint', labelKey: 'voc.category_complaint' },
  { value: 'suggestion', labelKey: 'voc.category_suggestion' },
  { value: 'praise', labelKey: 'voc.category_praise' },
];

const INITIAL_FORM: CreateVocInput = {
  title: '',
  category: 'inquiry',
  submitter_name: '',
  submitter_email: '',
  content: '',
};

const formatDate = (d: string): string => new Date(d).toLocaleDateString('ko-KR');

export default function VOCPage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const [vocs, setVocs] = useState<VOC[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CreateVocInput>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchVocs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter) params.category = filter;
    vocAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        setVocs(Array.isArray(data) ? data : (data as any).results ?? []);
      })
      .catch(() => setVocs([]))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    fetchVocs();
  }, [fetchVocs]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await vocAPI.create(form);
      addToast(t('voc.submit_success'), 'success');
      setForm(INITIAL_FORM);
      setFormOpen(false);
      fetchVocs();
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filterTabs = [
    { key: '', label: t('approval.filter_all') },
    ...CATEGORIES.map((c) => ({ key: c.value, label: t(c.labelKey as any) })),
  ];

  return (
    <div className="container page">
      <div
        className="page-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div>
          <h1>{t('voc.title')}</h1>
          <p>{t('voc.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          + {t('voc.new_voc')}
        </button>
      </div>

      <div className="toolbar">
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
      </div>

      {loading ? (
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
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
                <th>{t('voc.submitter_name')}</th>
                <th>{t('voc.status')}</th>
                <th>접수일</th>
              </tr>
            </thead>
            <tbody>
              {vocs.map((v) => (
                <tr key={v.id}>
                  <td style={{ color: 'var(--text-muted)' }}>#{v.id}</td>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{v.title}</td>
                  <td>
                    <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>
                      {t(
                        (CATEGORIES.find((c) => c.value === v.category)?.labelKey ?? 'voc.category_inquiry') as any
                      )}
                    </span>
                  </td>
                  <td>{v.submitter_name}</td>
                  <td>
                    <StatusBadge status={v.status} />
                  </td>
                  <td>{formatDate(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={t('voc.new_voc')}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('common.loading') : t('voc.submit')}
            </button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">
              {t('approval.col_title')} <span className="required">*</span>
            </label>
            <input className="form-control" name="title" value={form.title} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('voc.category')}</label>
            <select className="form-control" name="category" value={form.category} onChange={handleChange}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {t(c.labelKey as any)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              {t('voc.submitter_name')} <span className="required">*</span>
            </label>
            <input
              className="form-control"
              name="submitter_name"
              value={form.submitter_name}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              {t('voc.email')} <span className="required">*</span>
            </label>
            <input
              type="email"
              className="form-control"
              name="submitter_email"
              value={form.submitter_email}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              {t('voc.content')} <span className="required">*</span>
            </label>
            <textarea
              className="form-control"
              name="content"
              value={form.content}
              onChange={handleChange}
              rows={4}
              required
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}
