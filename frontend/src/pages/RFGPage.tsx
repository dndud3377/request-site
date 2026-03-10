import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { rfgAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { RFG, CreateRfgInput, RfgStatus } from '../types';

interface StatusOption {
  key: string;
  labelKey: string;
}

const STATUS_OPTIONS: StatusOption[] = [
  { key: '', labelKey: 'approval.filter_all' },
  { key: 'open', labelKey: 'rfg.status_open' },
  { key: 'in_progress', labelKey: 'rfg.status_in_progress' },
  { key: 'resolved', labelKey: 'rfg.status_resolved' },
];

const INITIAL_FORM: CreateRfgInput = {
  title: '',
  requester_name: '',
  requester_email: '',
  product_name: '',
  description: '',
};

const formatDate = (d: string): string => new Date(d).toLocaleDateString('ko-KR');

export default function RFGPage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const [rfgs, setRfgs] = useState<RFG[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CreateRfgInput>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchRfgs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter) params.status = filter;
    rfgAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        setRfgs(Array.isArray(data) ? data : (data as any).results ?? []);
      })
      .catch(() => setRfgs([]))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    fetchRfgs();
  }, [fetchRfgs]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await rfgAPI.create(form);
      addToast(t('rfg.submit_success'), 'success');
      setForm(INITIAL_FORM);
      setFormOpen(false);
      fetchRfgs();
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container page">
      <div
        className="page-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
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
          {STATUS_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              className={`filter-tab ${filter === tab.key ? 'active' : ''}`}
              onClick={() => setFilter(tab.key)}
            >
              {t(tab.labelKey as any)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
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
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
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
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t('common.loading') : t('rfg.submit')}
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
            <label className="form-label">
              {t('rfg.requester_name')} <span className="required">*</span>
            </label>
            <input
              className="form-control"
              name="requester_name"
              value={form.requester_name}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              {t('rfg.email')} <span className="required">*</span>
            </label>
            <input
              type="email"
              className="form-control"
              name="requester_email"
              value={form.requester_email}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              {t('rfg.product_name')} <span className="required">*</span>
            </label>
            <input
              className="form-control"
              name="product_name"
              value={form.product_name}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              {t('rfg.description')} <span className="required">*</span>
            </label>
            <textarea
              className="form-control"
              name="description"
              value={form.description}
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
