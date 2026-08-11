import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { documentsAPI, linesAPI, rejectionSnapshotsAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import Modal, { ConfirmModal } from '../components/Modal';
import PagedDetailView, { ReviewItemsPanelProps } from '../components/PagedDetailView';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { OPTION_LINE } from './RequestPage/constants';
import { RejectionSnapshot, RequestDocument } from '../types';
import { formatDate } from '../utils/date';

// ===== 필터 탭 키 =====
// 전체/MY/라인N 은 결재 완료 문서(docs)를, 반려는 반려 이력(snapshots)을 대상으로 한다.
const FILTER_ALL = '';
const FILTER_MY = 'my';
const FILTER_REJECTED = 'rejected';
const LINE_FILTER_PREFIX = 'line_';

/**
 * 라인 선택값 → i18n 키 접미사.
 * 라인 목록은 마스터 데이터(`GET /api/lines/`)라 여기 없는 이름이 얼마든지 올 수 있다.
 * 그런 라인은 번역 키가 없으므로 이름을 그대로 라벨로 쓴다(`lineLabel` 참조).
 */
const LINE_I18N_SUFFIX: Record<string, string> = {
  라인1: '1',
  라인2: '2',
  라인3: '3',
  라인4: '4',
  라인5: '5',
  nv: 'nv',
};

const getApprovalCompletedDate = (doc: RequestDocument): string => {
  const approved = (doc.approval_steps ?? []).filter((s) => s.action === 'approved' && s.acted_at);
  if (!approved.length) return '-';
  const latest = approved.reduce((a, b) =>
    new Date(a.acted_at!) > new Date(b.acted_at!) ? a : b
  );
  return formatDate(latest.acted_at);
};

/** 의뢰서에 선택된 라인. 제목이 아니라 원본값(additional_notes.detail.line)을 본다. */
const getDocLine = (doc: RequestDocument): string => {
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    return parsed?.detail?.line ?? '';
  } catch {
    return '';
  }
};

/**
 * 반려 이력을 상세 모달(PagedDetailView)이 받는 문서 모양으로 변환한다.
 * 내용·결재 경로 모두 스냅샷 값이라, 이후 재상신으로 원본이 바뀌어도 이 화면은 반려 당시 그대로다.
 */
const snapshotToDocument = (snap: RejectionSnapshot): RequestDocument => ({
  id: snap.source_document_id,
  title: snap.title,
  requester_name: snap.requester_name,
  requester_email: '',
  requester_department: snap.requester_department,
  product_name: snap.product_name,
  reference_materials: '',
  additional_notes: snap.additional_notes,
  status: 'rejected',
  production_date: null,
  created_at: snap.rejected_at,
  updated_at: snap.rejected_at,
  submitted_at: snap.submitted_at,
  approval_steps: snap.approval_steps,
  requester_loginid: snap.requester_loginid,
});

/** 삭제 확인 대상 — 문서와 반려 이력은 지우는 API 가 다르다. */
type DeleteTarget =
  | { kind: 'doc'; doc: RequestDocument }
  | { kind: 'snapshot'; snapshot: RejectionSnapshot };

export default function HistoryPage(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const addToast = useToast();
  const location = useLocation();
  const { currentUser } = useAuth();
  const isMaster = currentUser.role === 'MASTER';
  const isNone = currentUser.role === 'NONE';
  const [docs, setDocs] = useState<RequestDocument[]>([]);
  const [snapshots, setSnapshots] = useState<RejectionSnapshot[]>([]);
  // 라인 탭 목록. 의뢰서 작성 화면과 같은 마스터를 쓰고, 조회 전·실패 시에는 기본 선택지로 둔다.
  const [lineOptions, setLineOptions] = useState<string[]>(OPTION_LINE as unknown as string[]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(FILTER_ALL);
  const [selected, setSelected] = useState<RequestDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const isRejectedTab = filter === FILTER_REJECTED;

  // fetchDocs 는 search 가 바뀔 때마다 재실행되는데, 응답이 요청 순서와 다르게
  // 도착할 수 있다. 시퀀스 토큰으로 "가장 최근에 보낸 요청"의 응답만 반영한다.
  const fetchSeqRef = useRef(0);

  // 탭 전환은 클라이언트 필터로만 처리하므로, 진입·검색 시 두 목록을 한 번에 받아둔다.
  const fetchDocs = useCallback(() => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(false);
    const docParams: Record<string, string> = { status: 'approved' };
    const snapParams: Record<string, string> = {};
    if (search) {
      docParams.search = search;
      snapParams.search = search;
    }
    Promise.all([documentsAPI.list(docParams), rejectionSnapshotsAPI.list(snapParams)])
      .then(([docRes, snapRes]) => {
        if (seq !== fetchSeqRef.current) return; // 이미 더 최신 요청이 나간 뒤 도착한 응답 — 무시
        const data = docRes.data;
        setDocs(Array.isArray(data) ? data : (data as { results?: RequestDocument[] }).results ?? []);
        setSnapshots(snapRes.data);
      })
      .catch(() => {
        if (seq !== fetchSeqRef.current) return;
        setError(true); setDocs([]); setSnapshots([]);
      })
      .finally(() => {
        if (seq !== fetchSeqRef.current) return;
        setLoading(false);
      });
  }, [search]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    linesAPI.list()
      .then((lines) => { if (lines.length > 0) setLineOptions(lines.map((l) => l.name)); })
      .catch(() => { /* 폴백 유지 */ });
  }, []);

  /**
   * MY: 내가 의뢰자이거나, 결재 단계 담당자였던 문서.
   * 이력 조회는 결재가 끝난 문서라 진행 중 단계가 없으므로, 결재 현황의 MY(내 pending 단계)와 달리
   * 합의·반려 여부를 가리지 않고 "관여했는가"로 판정한다. 역할과 무관하게 동작한다.
   */
  const isMyDoc = useCallback((doc: RequestDocument): boolean => {
    const loginid = currentUser.username;
    if (!loginid) return false;
    if (doc.requester_loginid === loginid) return true;
    return (doc.approval_steps ?? []).some((s) => s.assignee_loginid === loginid);
  }, [currentUser.username]);

  const filterDocs = useCallback((all: RequestDocument[], key: string): RequestDocument[] => {
    if (key === FILTER_MY) return all.filter(isMyDoc);
    if (key.startsWith(LINE_FILTER_PREFIX)) {
      const line = key.slice(LINE_FILTER_PREFIX.length);
      return all.filter((d) => getDocLine(d) === line);
    }
    return all;
  }, [isMyDoc]);

  /**
   * 라인 탭 라벨. 번역 키가 있는 라인은 번역문을, 없는 라인은 마스터의 이름을 그대로 쓴다.
   * (키 존재 여부를 확인하지 않으면 i18next 가 없는 키를 그대로 반환해 `history.filter_line_…`
   *  같은 원문이 탭에 노출된다.)
   */
  const lineLabel = useCallback((line: string): string => {
    const suffix = LINE_I18N_SUFFIX[line];
    if (!suffix) return line;
    const key = `history.filter_line_${suffix}`;
    return i18n.exists(key) ? t(key as 'history.filter_line_1') : line;
  }, [t, i18n]);

  const filterTabs = useMemo(() => {
    const base = [
      { key: FILTER_ALL, label: t('history.filter_all') },
      { key: FILTER_MY, label: t('history.filter_my') },
      ...lineOptions.map((line) => ({
        key: `${LINE_FILTER_PREFIX}${line}`,
        label: lineLabel(line),
      })),
      { key: FILTER_REJECTED, label: t('history.filter_rejected') },
    ];
    return base.map(({ key, label }) => {
      const count = key === FILTER_REJECTED ? snapshots.length : filterDocs(docs, key).length;
      return { key, label: count > 0 ? `${label}(${count})` : label };
    });
  }, [t, docs, snapshots, filterDocs, lineOptions, lineLabel]);

  const visibleDocs = useMemo(
    () => (isRejectedTab ? [] : filterDocs(docs, filter)),
    [isRejectedTab, filterDocs, docs, filter]
  );
  const isEmpty = isRejectedTab ? snapshots.length === 0 : visibleDocs.length === 0;

  /**
   * 이력 조회의 검토 항목은 **읽기 전용**이다 — 결재가 끝난 문서라 편집·확인이 모두 닫혀 있다.
   * J 권한자(TE_J/MASTER)에게만 서브탭을 노출하고, 항목이 없으면 아예 띄우지 않는다.
   */
  const reviewItemsReadonly = (doc: RequestDocument): ReviewItemsPanelProps | undefined => {
    const isJ = currentUser.role === 'TE_J' || currentUser.role === 'MASTER';
    const items = doc.review_items ?? [];
    if (!isJ || items.length === 0) return undefined;
    const noop = (): void => undefined;
    return {
      items,
      canEdit: false,
      canConfirm: false,
      currentLoginid: currentUser.username,
      candidates: [],
      notice: 'approved',
      onAdd: noop,
      onRename: noop,
      onDelete: noop,
      onAddReviewer: noop,
      onRemoveReviewer: noop,
      onConfirm: noop,
    };
  };

  // 목록 응답에는 검토 항목이 없으므로 상세를 한 번 더 받아 연다(실패하면 목록 행 그대로).
  const openDetail = async (doc: RequestDocument) => {
    try {
      const detail = await documentsAPI.get(doc.id);
      setSelected(detail.data);
    } catch {
      setSelected(doc);
    }
    setPageIdx(0);
    setModalOpen(true);
  };

  // 반려 이력은 이미 받아둔 스냅샷만으로 연다 — 원본 문서를 다시 읽으면 반려 당시가 아니게 된다.
  const openSnapshotDetail = (snap: RejectionSnapshot) => {
    setSelected(snapshotToDocument(snap));
    setPageIdx(0);
    setModalOpen(true);
  };

  // 메일 딥링크(?id=) — 해당 문서를 직접 조회해 상세 모달을 열고, 배경 목록도 그
  // 문서 제목으로 자동 검색되게 한다(필터 탭은 검색과 충돌하지 않도록 전체로 리셋).
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) return;
    documentsAPI.get(Number(id))
      .then((res) => {
        openDetail(res.data);
        setFilter(FILTER_ALL);
        setSearch(res.data.title);
      })
      .catch(() => { /* 존재하지 않거나 접근 불가한 문서 — 조용히 무시 */ });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === 'doc') {
        await documentsAPI.delete(deleteTarget.doc.id);
        addToast(t('history.delete_success'), 'success');
      } else {
        await rejectionSnapshotsAPI.delete(deleteTarget.snapshot.id);
        addToast(t('history.delete_snapshot_success'), 'success');
      }
      fetchDocs();
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const confirmTitle = deleteTarget?.kind === 'snapshot'
    ? t('history.delete_snapshot_title')
    : t('history.delete_title');
  const confirmMessage = deleteTarget?.kind === 'snapshot'
    ? t('history.delete_snapshot_confirm', {
        title: deleteTarget.snapshot.title,
        round: deleteTarget.snapshot.round,
      })
    : t('history.delete_confirm', { title: deleteTarget?.doc.title ?? '' });

  const titleCell = (label: string, onOpen: () => void) => (
    isNone ? (
      <span style={{ fontWeight: 600 }}>{label}</span>
    ) : (
      <span
        style={{ color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
        onClick={onOpen}
      >
        {label}
      </span>
    )
  );

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
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p>{t('common.load_error')}</p>
          <button className="btn" onClick={fetchDocs}>{t('common.retry')}</button>
        </div>
      ) : isEmpty ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <p>{isRejectedTab ? t('history.no_data_rejected') : t('history.no_data')}</p>
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
                <th>{isRejectedTab ? t('history.col_rejected') : t('history.col_approved')}</th>
                {isMaster && <th></th>}
              </tr>
            </thead>
            <tbody>
              {isRejectedTab
                ? snapshots.map((snap, index) => (
                  <tr key={snap.id}>
                    <td style={{ color: 'var(--text-muted)' }}>{index + 1}</td>
                    <td>{titleCell(snap.title, () => openSnapshotDetail(snap))}</td>
                    <td>{snap.product_name}</td>
                    <td>
                      <div>{snap.requester_name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {snap.requester_department}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status="rejected" />
                    </td>
                    <td>{formatDate(snap.submitted_at)}</td>
                    <td>{formatDate(snap.rejected_at)}</td>
                    {isMaster && (
                      <td>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeleteTarget({ kind: 'snapshot', snapshot: snap })}
                        >
                          {t('history.delete')}
                        </button>
                      </td>
                    )}
                  </tr>
                ))
                : visibleDocs.map((doc, index) => (
                  <tr key={doc.id}>
                    <td style={{ color: 'var(--text-muted)' }}>{index + 1}</td>
                    <td>{titleCell(doc.title, () => openDetail(doc))}</td>
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
                    {isMaster && (
                      <td>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeleteTarget({ kind: 'doc', doc })}
                        >
                          {t('history.delete')}
                        </button>
                      </td>
                    )}
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
          <PagedDetailView
            doc={selected}
            role="MASTER"
            pageIdx={pageIdx}
            setPageIdx={setPageIdx}
            reviewItems={reviewItemsReadonly(selected)}
          />
        </Modal>
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={t('history.delete')}
        danger
      />
    </div>
  );
}
