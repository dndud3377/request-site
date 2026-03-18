import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { documentsAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import ApprovalFlow from '../components/ApprovalFlow';
import PagedDetailView from '../components/PagedDetailView';
import { MOCK_USERS } from '../contexts/AuthContext';
import { RequestDocument } from '../types';

const MASTER_USER = MOCK_USERS.find((u) => u.role === 'MASTER')!;

const formatDate = (d: string | null): string => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');

const getApprovalCompletedDate = (doc: RequestDocument): string => {
  const approved = (doc.approval_steps ?? []).filter((s) => s.action === 'approved' && s.acted_at);
  if (!approved.length) return '-';
  const latest = approved.reduce((a, b) =>
    new Date(a.acted_at!) > new Date(b.acted_at!) ? a : b
  );
  return formatDate(latest.acted_at);
};

export default function HistoryPage(): React.ReactElement {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RequestDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  const fetchDocs = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = { status: 'approved' };
    if (search) params.search = search;
    documentsAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        setDocs(Array.isArray(data) ? data : (data as any).results ?? []);
      })
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const openDetail = (doc: RequestDocument) => {
    setSelected(doc);
    setPageIdx(0);
    setModalOpen(true);
  };

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
      </div>

      {loading ? (
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
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
                <th>{t('history.col_requester')}</th>
                <th>{t('history.col_status')}</th>
                <th>{t('history.col_submitted')}</th>
                <th>{t('history.col_approved')}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ color: 'var(--text-muted)' }}>#{doc.id}</td>
                  <td>
                    <span
                      style={{ color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
                      onClick={() => openDetail(doc)}
                    >
                      {doc.title}
                    </span>
                  </td>
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
                  <td>{formatDate(doc.submitted_at)}</td>
                  <td>{getApprovalCompletedDate(doc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 상세 모달 (읽기 전용) */}
      {selected && (
        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title={selected.title}
          size="lg"
          footer={
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
              {t('common.close')}
            </button>
          }
        >
          {/* 결재 경로 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              marginBottom: 10,
            }}>
              {t('approval.section_approval_flow')}
            </div>
            <ApprovalFlow
              doc={selected}
              onAgree={() => {}}
              onReject={() => {}}
              onAssign={() => {}}
              processing={false}
              currentUser={MASTER_USER}
            />
          </div>

          {/* 상세 정보 */}
          <PagedDetailView
            doc={selected}
            role="MASTER"
            pageIdx={pageIdx}
            setPageIdx={setPageIdx}
          />
        </Modal>
      )}
    </div>
  );
}
