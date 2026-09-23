import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { useToast } from './Toast';
import { documentsAPI } from '../api/client';
import { RequestDocument, PersonalMarkCategory } from '../types';
import { OPTION_LINE } from '../pages/RequestPage/constants';
import { EXPORT_TEAMS, ExportTeam, filterDocsForExport, exportApprovalList } from '../utils/approvalListExport';

interface ApprovalListExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: PersonalMarkCategory[];
}

/** 결재 현황 목록과 같은 기준 — 완료(approved) 문서는 결재 현황에 나오지 않는다. */
const EXCLUDED_LIST_STATUS = 'approved';

/**
 * 결재 현황 목록 다운로드 창 — 라인·팀을 골라(기본 전체 선택) '전체 + 라인별' 시트의 xlsx 로 받는다.
 * 화면의 검색·탭·컬럼 필터와 무관하게, 열 때마다 목록을 새로 받아 임시저장만 뺀 전체를 대상으로 한다.
 */
export default function ApprovalListExportModal({
  isOpen, onClose, categories,
}: ApprovalListExportModalProps): React.ReactElement {
  const { t } = useTranslation();
  const addToast = useToast();
  const [sourceDocs, setSourceDocs] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lines, setLines] = useState<Set<string>>(new Set(OPTION_LINE));
  const [teams, setTeams] = useState<Set<ExportTeam>>(new Set(EXPORT_TEAMS));

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await documentsAPI.list();
      setSourceDocs(r.data.results.filter((d) => d.status !== EXCLUDED_LIST_STATUS));
    } catch {
      setError(true);
      setSourceDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setLines(new Set(OPTION_LINE));
    setTeams(new Set(EXPORT_TEAMS));
    loadDocs();
  }, [isOpen, loadDocs]);

  const selectedLines = useMemo(() => OPTION_LINE.filter((l) => lines.has(l)), [lines]);
  const selectedTeams = useMemo(() => EXPORT_TEAMS.filter((tm) => teams.has(tm)), [teams]);
  const targetDocs = useMemo(
    () => filterDocsForExport(sourceDocs, selectedLines, OPTION_LINE, selectedTeams),
    [sourceDocs, selectedLines, selectedTeams],
  );
  const selectionEmpty = selectedLines.length === 0 || selectedTeams.length === 0;

  const toggle = <T,>(setFn: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) => {
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const handleDownload = async () => {
    setExporting(true);
    try {
      await exportApprovalList(targetDocs, selectedLines, categories, t);
      onClose();
    } catch {
      addToast(t('approval.export_list_error'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const renderGroup = <T extends string>(
    title: string,
    options: readonly T[],
    selected: Set<T>,
    setFn: React.Dispatch<React.SetStateAction<Set<T>>>,
    labelFn: (v: T) => string,
  ) => (
    <div style={{ flex: 1, minWidth: 160 }}>
      <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6 }}>{title}</div>
      <button type="button" className="column-filter-popover-all" onClick={() => setFn(new Set(options))}>
        {t('approval.filter_select_all')}
      </button>
      <button type="button" className="column-filter-popover-all" onClick={() => setFn(new Set())}>
        {t('approval.filter_select_none')}
      </button>
      <div className="column-filter-popover-divider" />
      {options.map((opt) => (
        <label key={opt} className="column-filter-popover-item">
          <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(setFn, opt)} />
          {labelFn(opt)}
        </label>
      ))}
    </div>
  );

  const renderStatus = () => {
    if (loading) return <p>{t('common.loading')}</p>;
    if (error) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{t('common.load_error')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadDocs}>{t('common.retry')}</button>
        </div>
      );
    }
    if (selectionEmpty) return <p style={{ color: 'var(--danger)' }}>{t('approval.export_list_select_required')}</p>;
    if (targetDocs.length === 0) return <p>{t('approval.export_list_empty')}</p>;
    return <p>{t('approval.export_list_count', { count: targetDocs.length, sheets: selectedLines.length + 1 })}</p>;
  };

  const canDownload = !loading && !error && !exporting && !selectionEmpty && targetDocs.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('approval.export_list_title')}
      size="md"
      hideFullscreen
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={handleDownload} disabled={!canDownload}>
            {exporting ? t('approval.export_list_generating') : t('approval.export_list_download')}
          </button>
        </div>
      }
    >
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 14 }}>
        {t('approval.export_list_help')}
      </p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
        {renderGroup(t('approval.col_line'), OPTION_LINE, lines, setLines, (v) => v)}
        {renderGroup(t('approval.export_list_team'), EXPORT_TEAMS, teams, setTeams, (v) => t(`approval.filter_agent_${v}` as never))}
      </div>
      <div style={{ fontSize: '0.85rem' }}>{renderStatus()}</div>
    </Modal>
  );
}
