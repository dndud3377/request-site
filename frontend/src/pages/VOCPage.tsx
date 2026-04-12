import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { vocAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { VOC, VocCategory, VocStatus, CreateVocInput } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface CategoryOption {
  value: VocCategory;
  labelKey: string;
}

const CATEGORIES: CategoryOption[] = [
  { value: 'inquiry',         labelKey: 'voc.category_inquiry' },
  { value: 'error_report',    labelKey: 'voc.category_error_report' },
  { value: 'feature_request', labelKey: 'voc.category_feature_request' },
  { value: 'task_request',    labelKey: 'voc.category_task_request' },
];

const VOC_STATUSES: VocStatus[] = ['checking', 'completed', 'rejected'];

const formatDate = (d: string): string => new Date(d).toLocaleDateString('ko-KR');

export default function VOCPage(): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const { currentUser } = useAuth();
  const isMaster = currentUser.role === 'MASTER';

  const [vocs, setVocs] = useState<VOC[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'inquiry' as VocCategory, content: '' });
  const [submitting, setSubmitting] = useState(false);

  const [selectedVoc, setSelectedVoc] = useState<VOC | null>(null);
  const [responseText, setResponseText] = useState('');
  const [savingResponse, setSavingResponse] = useState(false);

  const fetchVocs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter === 'my') {
      params.submitter_user_id = String(currentUser.id);
    } else if (filter) {
      params.category = filter;
    }
    if (searchQuery) params.search = searchQuery;

    vocAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        setVocs(Array.isArray(data) ? data : (data as any).results ?? []);
      })
      .catch(() => setVocs([]))
      .finally(() => setLoading(false));
  }, [filter, searchQuery, currentUser.id]);

  useEffect(() => {
    fetchVocs();
  }, [fetchVocs]);

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const input: CreateVocInput = {
        title: form.title,
        category: form.category,
        content: form.content,
        submitter_name: currentUser.name,
        submitter_email: currentUser.email,
        submitter_user_id: currentUser.id,
      };
      await vocAPI.create(input);
      addToast(t('voc.submit_success'), 'success');
      setForm({ title: '', category: 'inquiry', content: '' });
      setFormOpen(false);
      fetchVocs();
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (voc: VOC, status: VocStatus) => {
    try {
      const res = await vocAPI.updateStatus(voc.id, status);
      setVocs((prev) => prev.map((v) => (v.id === voc.id ? res.data : v)));
      if (selectedVoc?.id === voc.id) setSelectedVoc(res.data);
      addToast(t('voc.status_update_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    }
  };

  const handleSaveResponse = async () => {
    if (!selectedVoc) return;
    setSavingResponse(true);
    try {
      const res = await vocAPI.updateResponse(selectedVoc.id, responseText);
      setVocs((prev) => prev.map((v) => (v.id === selectedVoc.id ? res.data : v)));
      setSelectedVoc(res.data);
      addToast(t('voc.response_success'), 'success');
    } catch {
      addToast(t('common.error'), 'error');
    } finally {
      setSavingResponse(false);
    }
  };

  const openDetail = (voc: VOC) => {
    setSelectedVoc(voc);
    setResponseText(voc.response ?? '');
  };

  const filterTabs = [
    { key: '',    label: t('approval.filter_all') },
    { key: 'my',  label: t('voc.my_voc') },
    ...CATEGORIES.map((c) => ({ key: c.value, label: t(c.labelKey as any) })),
  ];

  const getCategoryLabel = (cat: VocCategory) =>
    t((CATEGORIES.find((c) => c.value === cat)?.labelKey ?? 'voc.category_inquiry') as any);

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
        <input
          className="form-control"
          style={{ width: 220 }}
          placeholder={t('voc.search_placeholder' as any)}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
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
                <th>{t('voc.submitter_department')}</th>
                <th>{t('voc.status')}</th>
                <th>접수일</th>
              </tr>
            </thead>
            <tbody>
              {vocs.map((v) => (
                <tr key={v.id}>
                  <td style={{ color: 'var(--text-muted)' }}>#{v.id}</td>
                  <td>
                    <button
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        color: 'var(--text-primary)', fontWeight: 500, textAlign: 'left',
                      }}
                      onClick={() => openDetail(v)}
                    >
                      {v.title}
                    </button>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>
                      {getCategoryLabel(v.category)}
                    </span>
                  </td>
                  <td>{v.submitter_name}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {(v as any).submitter_department ?? '-'}
                  </td>
                  <td>
                    {isMaster ? (
                      <select
                        className="form-control"
                        style={{ padding: '2px 6px', fontSize: '0.8rem', height: 'auto' }}
                        value={v.status}
                        onChange={(e) => handleStatusChange(v, e.target.value as VocStatus)}
                      >
                        {VOC_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t(`voc.status_${s}` as any)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge status={v.status} />
                    )}
                  </td>
                  <td>{formatDate(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* VOC 등록 모달 */}
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
            <input className="form-control" name="title" value={form.title} onChange={handleFormChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('voc.category')}</label>
            <select className="form-control" name="category" value={form.category} onChange={handleFormChange}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {t(c.labelKey as any)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              {t('voc.content')} <span className="required">*</span>
            </label>
            <textarea
              className="form-control"
              name="content"
              value={form.content}
              onChange={handleFormChange}
              rows={4}
              required
            />
          </div>
        </form>
      </Modal>

      {/* VOC 상세 모달 */}
      {selectedVoc && (
        <Modal
          isOpen={!!selectedVoc}
          onClose={() => setSelectedVoc(null)}
          title={selectedVoc.title}
          footer={
            <button className="btn btn-secondary" onClick={() => setSelectedVoc(null)}>
              {t('common.close')}
            </button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 메타 정보 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>
                {getCategoryLabel(selectedVoc.category)}
              </span>
              <StatusBadge status={selectedVoc.status} />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {formatDate(selectedVoc.created_at)}
              </span>
            </div>

            {/* 제출자 정보 */}
            <div style={{ display: 'flex', gap: 16, fontSize: '0.9rem' }}>
              <span>
                <strong>{t('voc.submitter_name')}:</strong> {selectedVoc.submitter_name}
              </span>
              {(selectedVoc as any).submitter_department && (
                <span>
                  <strong>{t('voc.submitter_department')}:</strong>{' '}
                  {(selectedVoc as any).submitter_department}
                </span>
              )}
            </div>

            {/* 내용 */}
            <div className="form-group">
              <label className="form-label">{t('voc.content')}</label>
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.9rem',
                  lineHeight: 1.6,
                }}
              >
                {selectedVoc.content}
              </div>
            </div>

            {/* 상태 변경 (MASTER) */}
            {isMaster && (
              <div className="form-group">
                <label className="form-label">{t('voc.change_status')}</label>
                <select
                  className="form-control"
                  value={selectedVoc.status}
                  onChange={(e) => handleStatusChange(selectedVoc, e.target.value as VocStatus)}
                  style={{ maxWidth: 180 }}
                >
                  {VOC_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`voc.status_${s}` as any)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 답변 영역 */}
            <div className="form-group">
              <label className="form-label">{t('voc.response')}</label>
              {isMaster ? (
                <>
                  <textarea
                    className="form-control"
                    rows={4}
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder={t('voc.response_placeholder' as any)}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 8 }}
                    onClick={handleSaveResponse}
                    disabled={savingResponse}
                  >
                    {savingResponse ? t('common.loading') : t('voc.save_response' as any)}
                  </button>
                </>
              ) : (
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    padding: '10px 12px',
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.9rem',
                    lineHeight: 1.6,
                    color: selectedVoc.response ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {selectedVoc.response || t('voc.response_none' as any)}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
