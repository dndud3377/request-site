import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { vocAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

const INITIAL = {
  title: '',
  category: 'inquiry',
  submitter_name: '',
  submitter_email: '',
  content: '',
};

export default function VOCPage() {
  const { t } = useTranslation();
  const addToast = useToast();
  const [vocs, setVocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(INITIAL);
  const [submitting, setSubmitting] = useState(false);

  const fetchVocs = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filter) params.category = filter;
    vocAPI.list(params)
      .then((r) => setVocs(r.data.results || r.data || []))
      .catch(() => setVocs([]))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { fetchVocs(); }, [fetchVocs]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await vocAPI.create(form);
      addToast(t('voc.submit_success'), 'success');
      setForm(INITIAL);
      setFormOpen(false);
      fetchVocs();
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('ko-KR') : '-';

  const categories = [
    { value: 'inquiry', label: t('voc.category_inquiry') },
    { value: 'complaint', label: t('voc.category_complaint') },
    { value: 'suggestion', label: t('voc.category_suggestion') },
    { value: 'praise', label: t('voc.category_praise') },
  ];

  const filterTabs = [
    { key: '', label: t('approval.filter_all') },
    ...categories,
  ];

  return (
    <div className="container page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
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
              key={tab.key || 'all'}
              className={`filter-tab ${filter === (tab.key || '') ? 'active' : ''}`}
              onClick={() => setFilter(tab.key || '')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

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
                      {categories.find((c) => c.value === v.category)?.label || v.category}
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
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? t('common.loading') : t('voc.submit')}
            </button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">{t('approval.col_title')} <span className="required">*</span></label>
            <input className="form-control" name="title" value={form.title} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('voc.category')}</label>
            <select className="form-control" name="category" value={form.category} onChange={handleChange}>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('voc.submitter_name')} <span className="required">*</span></label>
            <input className="form-control" name="submitter_name" value={form.submitter_name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('voc.email')} <span className="required">*</span></label>
            <input type="email" className="form-control" name="submitter_email" value={form.submitter_email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('voc.content')} <span className="required">*</span></label>
            <textarea className="form-control" name="content" value={form.content} onChange={handleChange} rows={4} required />
          </div>
        </form>
      </Modal>
    </div>
  );
}
