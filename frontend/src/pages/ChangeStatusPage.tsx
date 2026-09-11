import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeStatusAPI } from '../api/client';
import Modal from '../components/Modal';
import { PhotoStepChangeGroup, PhotoStepChangeRow, PhotoStepChangeTableType } from '../types';
import { formatDateTime } from '../utils/date';

const LINE_OPTIONS = ['라인1', '라인3', '라인4', '라인5'] as const;
const LINE_I18N_SUFFIX: Record<string, string> = { 라인1: '1', 라인3: '3', 라인4: '4', 라인5: '5' };
const TABLE_TYPE_OPTIONS: PhotoStepChangeTableType[] = ['ALL', 'OV', 'CD'];

// 변경이 잦을 수 있어 결재 현황보다 좁은 페이지 크기를 쓴다.
const PAGE_SIZE = 15;
// 숫자 페이지 버튼 표시 시 현재 페이지 앞뒤로 보여줄 개수(그 밖은 '…'로 생략) — 결재 현황과 동일한 방식.
const PAGE_WINDOW = 2;
// 검색어 입력 후 조회 API를 호출하기까지의 대기 시간(과도한 요청 방지).
const SEARCH_DEBOUNCE_MS = 300;

const buildPageNumbers = (current: number, total: number): (number | 'ellipsis')[] => {
  const pages = new Set<number>([1, total]);
  for (let p = current - PAGE_WINDOW; p <= current + PAGE_WINDOW; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | 'ellipsis')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push('ellipsis');
    result.push(p);
    prev = p;
  }
  return result;
};

export default function ChangeStatusPage(): React.ReactElement {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<PhotoStepChangeGroup[]>([]);
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [lineFilter, setLineFilter] = useState('');
  const [tableTypeFilter, setTableTypeFilter] = useState<PhotoStepChangeTableType | ''>('');
  const [detailGroup, setDetailGroup] = useState<PhotoStepChangeGroup | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const lineLabel = useCallback((line: string): string => {
    const suffix = LINE_I18N_SUFFIX[line];
    return suffix ? t(`change_status.line_${suffix}` as 'change_status.line_1') : line;
  }, [t]);

  const tableTypeLabel = useCallback((tableType: PhotoStepChangeTableType): string =>
    t(`change_status.table_type_${tableType}` as 'change_status.table_type_ALL'),
  [t]);

  const fetchChanges = useCallback(async () => {
    // 검색/필터 변경 시 동시에 여러 요청이 뜰 수 있으므로, 가장 나중에 시작된 요청의
    // 응답만 반영한다 — 늦게 도착한 이전 페이지 응답이 최신 결과를 덮어쓰는 것을 막는다.
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const res = await changeStatusAPI.list({
        line: lineFilter || undefined,
        tableType: tableTypeFilter || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;
      setGroups(res.results);
      setCount(res.count);
      setTruncated(res.truncated);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [lineFilter, tableTypeFilter, search, page]);

  useEffect(() => {
    fetchChanges();
  }, [fetchChanges]);

  useEffect(() => {
    setPage(1);
  }, [lineFilter, tableTypeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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

  const diffCell = (rows: PhotoStepChangeRow[], kind: 'added' | 'removed'): React.ReactElement => {
    if (rows.length === 0) return <span style={{ color: 'var(--text-disabled)' }}>-</span>;
    const [first, ...rest] = rows;
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <span className={`badge ${kind === 'added' ? 'badge-approved' : 'badge-rejected'}`}>
          {t(kind === 'added' ? 'change_status.added_label' : 'change_status.removed_label')}
        </span>
        <span>
          {rowSummary(first)}
          {rest.length > 0 && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
              {t('change_status.more_count', { count: rest.length })}
            </span>
          )}
        </span>
      </div>
    );
  };

  const detailTable = (rows: PhotoStepChangeRow[], kind: 'added' | 'removed'): React.ReactElement | null => {
    if (rows.length === 0) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, marginBottom: 10 }}>
          <span className={`badge ${kind === 'added' ? 'badge-approved' : 'badge-rejected'}`}>
            {t(kind === 'added' ? 'change_status.added_label' : 'change_status.removed_label')}
          </span>
          {t('change_status.count_unit', { count: rows.length })}
        </div>
        <div className="table-wrapper">
          <table className="table table-compact change-status-detail-table">
            <thead>
              <tr>
                <th>{t('change_status.modal_col_step')}</th>
                <th>{t('change_status.modal_col_descript')}</th>
                <th>{t('change_status.modal_col_recipe')}</th>
                <th>{t('change_status.modal_col_area')}</th>
                <th>{t('change_status.modal_col_layer')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td><span className="cell-clamp-2">{row.stepseq}</span></td>
                  <td><span className="cell-clamp-2">{row.descript}</span></td>
                  <td><span className="cell-clamp-2">{row.recipeid}</span></td>
                  <td><span className="cell-clamp-2">{row.areaname}</span></td>
                  <td><span className="cell-clamp-2">{row.layerid || '-'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="container page">
      <div className="page-header">
        <h1>{t('change_status.title')}</h1>
        <p>{t('change_status.subtitle')}</p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('change_status.search_placeholder')}
          />
        </div>
        <div className="filter-tabs">
          <button
            type="button"
            className={`filter-tab ${lineFilter === '' ? 'active' : ''}`}
            onClick={() => setLineFilter('')}
          >
            {t('change_status.filter_line_all')}
          </button>
          {LINE_OPTIONS.map((line) => (
            <button
              key={line}
              type="button"
              className={`filter-tab ${lineFilter === line ? 'active' : ''}`}
              onClick={() => setLineFilter(line)}
            >
              {lineLabel(line)}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar">
        <div className="filter-tabs">
          <button
            type="button"
            className={`filter-tab ${tableTypeFilter === '' ? 'active' : ''}`}
            onClick={() => setTableTypeFilter('')}
          >
            {t('change_status.filter_table_type_all')}
          </button>
          {TABLE_TYPE_OPTIONS.map((type) => (
            <button
              key={type}
              type="button"
              className={`filter-tab ${tableTypeFilter === type ? 'active' : ''}`}
              onClick={() => setTableTypeFilter(type)}
            >
              {tableTypeLabel(type)}
            </button>
          ))}
        </div>
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
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('change_status.col_line')}</th>
                  <th>{t('change_status.col_processid')}</th>
                  <th>{t('change_status.col_removed')}</th>
                  <th>{t('change_status.col_added')}</th>
                  <th>{t('change_status.col_changed_at')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={`${group.sync_run_id}-${group.processid}`}>
                    <td>{lineLabel(group.line)}</td>
                    <td style={{ fontWeight: 700 }}>{group.processid}</td>
                    <td>{diffCell(group.removed, 'removed')}</td>
                    <td>{diffCell(group.added, 'added')}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {formatDateTime(group.detected_at)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setDetailGroup(group)}
                      >
                        {t('approval.view_detail')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              {buildPageNumbers(page, totalPages).map((item, idx) =>
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${idx}`} className="pagination-ellipsis">…</span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={`pagination-btn ${item === page ? 'active' : ''}`}
                    onClick={() => setPage(item)}
                    aria-current={item === page ? 'page' : undefined}
                  >
                    {item}
                  </button>
                )
              )}
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

      {detailGroup && (
        <Modal
          isOpen
          onClose={() => setDetailGroup(null)}
          title={groupTitle(detailGroup)}
        >
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '8px 18px', fontSize: '0.85rem',
            color: 'var(--text-muted)', paddingBottom: 16, marginBottom: 18,
            borderBottom: '1px solid var(--border-light)',
          }}>
            <span>{t('change_status.col_line')} <b style={{ color: 'var(--text-primary)' }}>{lineLabel(detailGroup.line)}</b></span>
            <span>{t('change_status.table_type_label')} <b style={{ color: 'var(--text-primary)' }}>{tableTypeLabel(detailGroup.table_type)}</b></span>
            <span>{t('change_status.col_changed_at')} <b style={{ color: 'var(--text-primary)' }}>{formatDateTime(detailGroup.detected_at)}</b></span>
          </div>
          {detailTable(detailGroup.removed, 'removed')}
          {detailTable(detailGroup.added, 'added')}
        </Modal>
      )}
    </div>
  );
}
