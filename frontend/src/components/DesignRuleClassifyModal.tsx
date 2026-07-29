import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { useToast } from './Toast';
import { designRuleMappingsAPI } from '../api/client';
import { UnclassifiedTargets } from '../types';

type Tab = 'process' | 'document';

interface Props {
  /** 이 연도의 승인 건만 대상으로 한다. */
  year: number;
  onClose: () => void;
  /** 저장이 하나라도 성공했을 때 — 부모가 그래프를 다시 불러온다. */
  onSaved: () => void;
}

/**
 * 미분류 의뢰서를 디자인룰에 수동으로 붙이는 MASTER 전용 모달.
 *
 * 조합법 단위 매핑은 같은 조합법을 쓴 모든 의뢰서에 한 번에 적용되고,
 * 의뢰서 단위 매핑은 그보다 우선한다(예외 처리용).
 */
export default function DesignRuleClassifyModal({
  year, onClose, onSaved,
}: Props): React.ReactElement {
  const { t } = useTranslation();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('process');
  const [targets, setTargets] = useState<UnclassifiedTargets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  // 사용자가 고른 값만 담는다 — 비어 있으면 저장 대상이 아니다.
  const [processPicks, setProcessPicks] = useState<Record<string, string>>({});
  const [documentPicks, setDocumentPicks] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await designRuleMappingsAPI.unclassified(year);
      setTargets(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = useCallback(async () => {
    const processEntries = Object.entries(processPicks).filter(([, rule]) => rule);
    const documentEntries = Object.entries(documentPicks).filter(([, rule]) => rule);
    if (processEntries.length === 0 && documentEntries.length === 0) {
      toast(t('home.chart.classify_nothing_selected'), 'warning');
      return;
    }

    setSaving(true);
    try {
      for (const [process, rule] of processEntries) {
        await designRuleMappingsAPI.setProcess(process, rule);
      }
      for (const [docId, rule] of documentEntries) {
        await designRuleMappingsAPI.setDocument(Number(docId), rule);
      }
      toast(
        t('home.chart.classify_saved', { count: processEntries.length + documentEntries.length }),
        'success',
      );
      onSaved();
    } catch {
      toast(t('home.chart.classify_save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  }, [processPicks, documentPicks, toast, t, onSaved]);

  const ruleOptions = targets?.design_rules ?? [];

  const renderSelect = (value: string, onChange: (v: string) => void): React.ReactElement => (
    <select
      className="form-control adr-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('home.chart.classify_select')}</option>
      {ruleOptions.map((rule) => <option key={rule} value={rule}>{rule}</option>)}
    </select>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`🗂 ${t('home.chart.classify_title')}`}
      size="lg"
      hideFullscreen
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {t('home.chart.classify_cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || loading || error}
          >
            {t('home.chart.classify_save')}
          </button>
        </>
      }
    >
      <div className="adr-master-badge">{t('home.chart.classify_master_only')}</div>

      <div className="adr-tabs">
        {(['process', 'document'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`adr-chip${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'process'
              ? t('home.chart.classify_tab_process')
              : t('home.chart.classify_tab_document')}
          </button>
        ))}
      </div>

      {loading && <div className="adr-state">{t('home.chart.loading')}</div>}

      {error && (
        <div className="adr-state">
          <span>{t('home.chart.error')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('home.chart.retry')}
          </button>
        </div>
      )}

      {!loading && !error && targets && tab === 'process' && (
        <>
          <div className="adr-modal-note">{t('home.chart.classify_process_note')}</div>
          {targets.processes.length === 0 ? (
            <div className="adr-state">{t('home.chart.classify_empty_process')}</div>
          ) : (
            targets.processes.map((row) => (
              <div className="adr-maprow" key={row.process}>
                <span className="adr-maprow-name">{row.process}</span>
                <span className={`adr-maprow-reason${row.reason === 'ambiguous' ? ' warn' : ''}`}>
                  {row.reason === 'ambiguous'
                    ? `⚠ ${t('home.chart.classify_reason_ambiguous', { count: row.candidates.length })}`
                    : t('home.chart.classify_reason_missing')}
                </span>
                <span className="adr-maprow-count">
                  {t('home.chart.count_suffix', { count: row.count })}
                </span>
                {renderSelect(
                  processPicks[row.process] ?? '',
                  (v) => setProcessPicks((prev) => ({ ...prev, [row.process]: v })),
                )}
              </div>
            ))
          )}
        </>
      )}

      {!loading && !error && targets && tab === 'document' && (
        <>
          <div className="adr-modal-note">{t('home.chart.classify_document_note')}</div>
          {targets.documents.length === 0 ? (
            <div className="adr-state">{t('home.chart.classify_empty_document')}</div>
          ) : (
            targets.documents.map((row) => (
              <div className="adr-maprow" key={row.id}>
                <span className="adr-maprow-name">
                  {row.title}
                  <span className="adr-maprow-sub">
                    {row.process_selection
                      ? t('home.chart.classify_process_label', { process: row.process_selection })
                      : t('home.chart.classify_reason_empty')}
                  </span>
                </span>
                {renderSelect(
                  documentPicks[row.id] ?? '',
                  (v) => setDocumentPicks((prev) => ({ ...prev, [row.id]: v })),
                )}
              </div>
            ))
          )}
        </>
      )}
    </Modal>
  );
}
