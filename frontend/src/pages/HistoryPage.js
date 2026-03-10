import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function HistoryPage() {
  const { t } = useTranslation();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');

  const fetchDocs = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (filter) params.status = filter;
    documentsAPI.list(params)
      .then((r) => setDocs(r.data.results || r.data || []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [search, filter]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('ko-KR') : '-';

  const PRODUCT_TYPES = {
    new: t('request.product_type_new'),
    update: t('request.product_type_update'),
    add_feature: t('request.product_type_add_feature'),
    change: t('request.product_type_change'),
  };

  const filterTabs = [
    { key: '', label: t('history.filter_all') },
    { key: 'draft', label: t('common.status_draft') },
    { key: 'submitted', label: t('common.status_submitted') },
    { key: 'approved', label: t('common.status_approved') },
    { key: 'rejected', label: t('common.status_rejected') },
  ];

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('history.title')}</h1>
        <p>{t('history.subtitle')}</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('history.search_placeholder')}
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
        <div className="empty-state"><p>{t('common.loading')}</p></div>
      ) : docs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <p>{t('history.no_data')}</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>{t('history.col_id')}</th>
                <th>{t('history.col_title')}</th>
                <th>{t('history.col_product')}</th>
                <th>{t('history.col_type')}</th>
                <th>{t('history.col_requester')}</th>
                <th>{t('history.col_status')}</th>
                <th>{t('history.col_created')}</th>
                <th>{t('history.col_submitted')}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, i) => (
                <tr key={doc.id}>
                  <td style={{ color: 'var(--text-muted)' }}>#{doc.id}</td>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{doc.title}</td>
                  <td>{doc.product_name}</td>
                  <td>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {PRODUCT_TYPES[doc.product_type] || doc.product_type}
                    </span>
                  </td>
                  <td>
                    <div>{doc.requester_name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {doc.requester_department}
                    </div>
                  </td>
                  <td><StatusBadge status={doc.status} /></td>
                  <td>{formatDate(doc.created_at)}</td>
                  <td>{formatDate(doc.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
