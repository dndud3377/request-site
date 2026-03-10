import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { rfgAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

const INITIAL = {
  title: '',
  requester_name: '',
  requester_email: '',
  product_name: '',
  description: '',
};

export default function RFGPage() {
  const { t } = useTranslation();
  const addToast = useToast();
  const [rfgs, setRfgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(INITIAL);
  const [submitting, setSubmitting] = useState(false);

  const fetchRfgs = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filter) params.status = filter;
    rfgAPI.list(params)
      .then((r) => setRfgs(r.data.results || r.data || []))
      .catch(() => setRfgs([]))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { fetchRfgs(); }, [fetchRfgs]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await rfgAPI.create(form);
      addToast(t('rfg.submit_success'), 'success');
      setForm(INITIAL);
      setFormOpen(false);
      fetchRfgs();
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('ko-KR') : '-';

  const filterTabs = [
    { key: '', label: t('approval.filter_all') },
    { key: 'open', label: t('rfg.status_open') },
    { key: 'in_progress', label: t('rfg.status_in_progress') },
    { key: 'resolved', label: t('rfg.status_resolved') },
  ];

  return (
    <div className="container page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>{t('rfg.title')}</h1>
          <p>{t('rfg.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          + {t('rfg.new_rfg')}
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
      ) : rfgs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📖</div>
          <p>{t('rfg.no_data')}</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>No.</th>
                <th>{t('approval.col_title')}</th>
                <th>{t('rfg.product_name')}</th>
                <th>{t('rfg.requester_name')}</th>
                <th>{t('rfg.status')}</th>
                <th>접수일</th>
              </tr>
            </thead>
            <tbody>
              {rfgs.map((r) => (
                <tr key={r.id}>
                  <td style={{ color: 'var(--text-muted)' }}>#{r.id}</td>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.title}</td>
                  <td>{r.product_name}</td>
                  <td>{r.requester_name}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{formatDate(r.created_at)}</td>
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
        title={t('rfg.new_rfg')}
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
              {submitting ? t('common.loading') : t('rfg.submit')}
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
            <label className="form-label">{t('rfg.requester_name')} <span className="required">*</span></label>
            <input className="form-control" name="requester_name" value={form.requester_name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('rfg.email')} <span className="required">*</span></label>
            <input type="email" className="form-control" name="requester_email" value={form.requester_email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('rfg.product_name')} <span className="required">*</span></label>
            <input className="form-control" name="product_name" value={form.product_name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('rfg.description')} <span className="required">*</span></label>
            <textarea className="form-control" name="description" value={form.description} onChange={handleChange} rows={4} required />
          </div>
        </form>
      </Modal>
    </div>
  );
}
