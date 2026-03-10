import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import StatusBadge, { PriorityBadge } from '../components/StatusBadge';
import Modal from '../components/Modal';
import { RequestDocument } from '../types';

interface FilterTab {
  key: string;
  label: string;
}

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

export default function ApprovalPage(): React.ReactElement {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RequestDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchDocs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (filter) params.status = filter;
    if (search) params.search = search;
    documentsAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        setDocs(Array.isArray(data) ? data : (data as any).results ?? []);
      })
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [filter, search]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const filterTabs: FilterTab[] = [
    { key: '', label: t('approval.filter_all') },
    { key: 'submitted', label: t('approval.filter_submitted') },
    { key: 'under_review', label: t('approval.filter_under_review') },
    { key: 'approved', label: t('approval.filter_approved') },
    { key: 'rejected', label: t('approval.filter_rejected') },
  ];

  const openDetail = (doc: RequestDocument) => {
    setSelected(doc);
    setModalOpen(true);
  };

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('approval.title')}</h1>
        <p>{t('approval.subtitle')}</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('approval.search_placeholder')}
          />
        </div>
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
      ) : docs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <p>{t('approval.no_data')}</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>{t('approval.col_title')}</th>
                <th>{t('approval.col_product')}</th>
                <th>{t('approval.col_requester')}</th>
                <th>{t('approval.col_status')}</th>
                <th>{t('approval.col_priority')}</th>
                <th>{t('approval.col_submitted')}</th>
                <th>{t('approval.col_deadline')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{doc.title}</td>
                  <td>{doc.product_name}</td>
                  <td>
                    <div>{doc.requester_name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {doc.requester_department}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={doc.status} />
                  </td>
                  <td>
                    <PriorityBadge priority={doc.priority} />
                  </td>
                  <td>{formatDate(doc.submitted_at)}</td>
                  <td>{formatDate(doc.deadline)}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => openDetail(doc)}>
                      {t('approval.view_detail')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selected?.title ?? ''}
        footer={
          <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
            {t('common.close')}
          </button>
        }
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <StatusBadge status={selected.status} />
              <PriorityBadge priority={selected.priority} />
            </div>
            {(
              [
                [t('approval.col_product'), selected.product_name],
                [
                  t('approval.col_requester'),
                  `${selected.requester_name} (${selected.requester_department})`,
                ],
                [t('approval.col_submitted'), formatDate(selected.submitted_at)],
                [t('approval.col_deadline'), formatDate(selected.deadline)],
              ] as [string, string][]
            ).map(([label, val]) => (
              <div key={label} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ color: 'var(--text-primary)' }}>{val}</div>
              </div>
            ))}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                제품 설명
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
                {selected.product_description}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
