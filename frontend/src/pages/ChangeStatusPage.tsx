import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeStatusAPI } from '../api/client';
import { PhotoStepChangeGroup, PhotoStepChangeRow, PhotoStepChangeTableType } from '../types';
import { formatDateTime } from '../utils/date';

const LINE_OPTIONS = ['라인1', '라인3', '라인4', '라인5'] as const;
const LINE_I18N_SUFFIX: Record<string, string> = { 라인1: '1', 라인3: '3', 라인4: '4', 라인5: '5' };
const TABLE_TYPE_OPTIONS: PhotoStepChangeTableType[] = ['ALL', 'OV', 'CD'];

const PAGE_SIZE = 20;

export default function ChangeStatusPage(): React.ReactElement {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<PhotoStepChangeGroup[]>([]);
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [lineFilter, setLineFilter] = useState('');
  const [tableTypeFilter, setTableTypeFilter] = useState<PhotoStepChangeTableType | ''>('');

  const lineLabel = useCallback((line: string): string => {
    const suffix = LINE_I18N_SUFFIX[line];
    return suffix ? t(`change_status.line_${suffix}` as 'change_status.line_1') : line;
  }, [t]);

  const tableTypeLabel = useCallback((tableType: PhotoStepChangeTableType): string =>
    t(`change_status.table_type_${tableType}` as 'change_status.table_type_ALL'),
  [t]);

  const fetchChanges = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await changeStatusAPI.list({
        line: lineFilter || undefined,
        tableType: tableTypeFilter || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setGroups(res.results);
      setCount(res.count);
      setTruncated(res.truncated);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [lineFilter, tableTypeFilter, page]);

  useEffect(() => {
    fetchChanges();
  }, [fetchChanges]);

  useEffect(() => {
    setPage(1);
  }, [lineFilter, tableTypeFilter]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const groupTitle = (group: PhotoStepChangeGroup): string =>
    group.table_type === 'ALL'
      ? t('change_status.group_title', { line: lineLabel(group.line), processid: group.processid })
      : t('change_status.group_title_with_type', {
        line: lineLabel(group.line),
        tableType: tableTypeLabel(group.table_type),
        processid: group.processid,
      });

  const rowSummary = (row: PhotoStepChangeRow): string =>
    row.descript ? `${row.stepseq} (${row.descript})` : row.stepseq;

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('change_status.title')}</h1>
        <p>{t('change_status.subtitle')}</p>
      </div>

      <div className="toolbar">
        <select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}>
          <option value="">{t('change_status.filter_line_all')}</option>
          {LINE_OPTIONS.map((line) => (
            <option key={line} value={line}>{lineLabel(line)}</option>
          ))}
        </select>
        <select
          value={tableTypeFilter}
          onChange={(e) => setTableTypeFilter(e.target.value as PhotoStepChangeTableType | '')}
        >
          <option value="">{t('change_status.filter_table_type_all')}</option>
          {TABLE_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>{tableTypeLabel(type)}</option>
          ))}
        </select>
      </div>

      {truncated && (
        <p style={{ color: 'var(--warning)', fontSize: '0.85rem', marginBottom: 16 }}>
          {t('change_status.truncated_notice')}
        </p>
      )}

      {loading ? (
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p>{t('common.load_error')}</p>
          <button className="btn" onClick={fetchChanges}>{t('common.retry')}</button>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <p>{t('change_status.no_data')}</p>
        </div>
      ) : (
        <>
          <div className="change-status-list">
            {groups.map((group) => (
              <div key={`${group.sync_run_id}-${group.processid}`} className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{groupTitle(group)}</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {t('change_status.detected_at_label')}: {formatDateTime(group.detected_at)}
                  </span>
                </div>
                {group.removed.length > 0 && (
                  <div style={{ marginBottom: group.added.length > 0 ? 8 : 0 }}>
                    <span className="badge badge-rejected">{t('change_status.removed_label')}</span>{' '}
                    {group.removed.map(rowSummary).join(', ')}
                  </div>
                )}
                {group.added.length > 0 && (
                  <div>
                    <span className="badge badge-approved">{t('change_status.added_label')}</span>{' '}
                    {group.added.map(rowSummary).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination" role="navigation">
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label={t('common.prev')}
              >
                ◀
              </button>
              <span style={{ padding: '0 12px' }}>{t('change_status.page_info', { page, totalPages })}</span>
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label={t('common.next')}
              >
                ▶
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
