import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { useToast } from './Toast';
import { designRuleMappingsAPI } from '../api/client';
import {
  UnclassifiedTargets,
  UnclassifiedReason,
  DesignRuleOption,
  ProcessDesignRuleOverride,
  DocumentDesignRuleOverride,
} from '../types';

type Tab = 'process' | 'document' | 'reclassify';

/** 드롭다운에서 "분류 해제"를 고르기 위한 sentinel — 실제 디자인룰 값과 겹치지 않는다. */
const UNCLASSIFY_VALUE = '__unclassify__';
/** 백엔드가 나노 변환에 성공한 라벨은 항상 이 접미사로 끝난다(design_rule_stats._to_nano_label). */
const NANO_SUFFIX = '나노';

interface Props {
  /** 이 연도의 승인 건만 대상으로 한다(재분류 탭은 연도 무관 전체). */
  year: number;
  onClose: () => void;
  /** 매핑이 바뀔 때마다(분류/재분류/해제) — 부모가 그래프를 다시 불러온다. 모달은 닫지 않는다. */
  onChanged: () => void;
}

/**
 * 미분류 의뢰서를 디자인룰에 수동으로 붙이거나, 이미 분류된 것을 다시 고치는 MASTER 전용 모달.
 *
 * 드롭다운에서 값을 고르는 즉시 저장된다(권한 관리 화면과 동일한 방식) — 별도
 * 저장/취소 버튼은 없다. 조합법 단위 매핑은 같은 조합법을 쓴 모든 의뢰서에 한 번에
 * 적용되고, 의뢰서 단위 매핑은 그보다 우선한다(예외 처리용).
 */
export default function DesignRuleClassifyModal({
  year, onClose, onChanged,
}: Props): React.ReactElement {
  const { t } = useTranslation();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('process');
  const [targets, setTargets] = useState<UnclassifiedTargets | null>(null);
  const [processOverrides, setProcessOverrides] = useState<ProcessDesignRuleOverride[]>([]);
  const [documentOverrides, setDocumentOverrides] = useState<DocumentDesignRuleOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // 지금 처리 중인 행 하나만 표시 — 그 행의 select 만 잠근다.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [targetsRes, procOverrides, docOverrides] = await Promise.all([
        designRuleMappingsAPI.unclassified(year),
        designRuleMappingsAPI.listProcessOverrides(),
        designRuleMappingsAPI.listDocumentOverrides(),
      ]);
      setTargets(targetsRes.data);
      setProcessOverrides(procOverrides);
      setDocumentOverrides(docOverrides);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { void load(); }, [load]);

  const runAction = useCallback(async (
    key: string, action: () => Promise<void>, successMessage: string,
  ) => {
    setBusyKey(key);
    try {
      await action();
      toast(successMessage, 'success');
      onChanged();
      await load();
    } catch {
      toast(t('home.chart.classify_save_failed'), 'error');
    } finally {
      setBusyKey(null);
    }
  }, [toast, t, onChanged, load]);

  const handleProcessPick = useCallback((process: string, value: string) => {
    if (!value) return;
    void runAction(
      `p:${process}`,
      () => designRuleMappingsAPI.setProcess(process, value),
      t('home.chart.classify_item_saved'),
    );
  }, [runAction, t]);

  const handleDocumentPick = useCallback((docId: number, value: string) => {
    if (!value) return;
    void runAction(
      `d:${docId}`,
      () => designRuleMappingsAPI.setDocument(docId, value),
      t('home.chart.classify_item_saved'),
    );
  }, [runAction, t]);

  const handleReclassifyProcess = useCallback((row: ProcessDesignRuleOverride, value: string) => {
    if (!value || value === row.design_rule) return;
    if (value === UNCLASSIFY_VALUE) {
      if (!window.confirm(t('home.chart.classify_unclassify_confirm'))) return;
      void runAction(
        `ro:${row.id}`,
        () => designRuleMappingsAPI.deleteProcessOverride(row.id),
        t('home.chart.classify_unclassify_done'),
      );
      return;
    }
    void runAction(
      `ro:${row.id}`,
      () => designRuleMappingsAPI.setProcess(row.process, value),
      t('home.chart.classify_item_saved'),
    );
  }, [runAction, t]);

  const handleReclassifyDocument = useCallback((row: DocumentDesignRuleOverride, value: string) => {
    if (!value || value === row.design_rule) return;
    if (value === UNCLASSIFY_VALUE) {
      if (!window.confirm(t('home.chart.classify_unclassify_confirm'))) return;
      void runAction(
        `do:${row.id}`,
        () => designRuleMappingsAPI.deleteDocumentOverride(row.id),
        t('home.chart.classify_unclassify_done'),
      );
      return;
    }
    void runAction(
      `do:${row.id}`,
      () => designRuleMappingsAPI.setDocument(row.document, value),
      t('home.chart.classify_item_saved'),
    );
  }, [runAction, t]);

  const ruleOptions = targets?.design_rules ?? [];

  // 재분류 탭 대상 — 나노로 정상 표시되는 것만. 비숫자 값은 조합법/의뢰서 탭에서
  // non_numeric 사유로 이미 다루므로 여기서 중복 노출하지 않는다.
  const reclassifiableProcesses = useMemo(
    () => processOverrides.filter((o) => o.design_rule_label.endsWith(NANO_SUFFIX)),
    [processOverrides],
  );
  const reclassifiableDocuments = useMemo(
    () => documentOverrides.filter((o) => o.design_rule_label.endsWith(NANO_SUFFIX)),
    [documentOverrides],
  );

  const isWarnReason = (reason: UnclassifiedReason): boolean =>
    reason === 'ambiguous' || reason === 'non_numeric';

  const reasonText = (row: { reason: UnclassifiedReason; candidates: string[] }): string => {
    if (row.reason === 'ambiguous') {
      return `⚠ ${t('home.chart.classify_reason_ambiguous', { count: row.candidates.length })}`;
    }
    if (row.reason === 'non_numeric') {
      return `⚠ ${t('home.chart.classify_reason_non_numeric')}`;
    }
    if (row.reason === 'missing') {
      return `⚠ ${t('home.chart.classify_reason_missing')}`;
    }
    return t('home.chart.classify_reason_empty');
  };

  const renderPickSelect = (
    value: string, onChange: (v: string) => void, busy: boolean,
  ): React.ReactElement => (
    <select
      className="form-control adr-select"
      value={value}
      disabled={busy}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('home.chart.classify_select')}</option>
      {ruleOptions.map((rule) => (
        <option key={rule.value} value={rule.value}>{rule.label}</option>
      ))}
    </select>
  );

  const renderReclassifySelect = (
    current: DesignRuleOption, onChange: (v: string) => void, busy: boolean,
  ): React.ReactElement => {
    const others = ruleOptions.filter((o) => o.value !== current.value);
    return (
      <select
        className="form-control adr-select"
        value={current.value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={current.value}>
          {current.label} ({t('home.chart.classify_current_suffix')})
        </option>
        {others.map((rule) => (
          <option key={rule.value} value={rule.value}>{rule.label}</option>
        ))}
        <option value={UNCLASSIFY_VALUE}>↩ {t('home.chart.classify_unclassify_option')}</option>
      </select>
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`🗂 ${t('home.chart.classify_title')}`}
      size="lg"
      hideFullscreen
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busyKey !== null}>
          {t('common.close')}
        </button>
      }
    >
      <div className="adr-master-badge">{t('home.chart.classify_master_only')}</div>

      <div className="adr-tabs">
        {(['process', 'document', 'reclassify'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`adr-chip${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'process' && t('home.chart.classify_tab_process')}
            {key === 'document' && t('home.chart.classify_tab_document')}
            {key === 'reclassify' && t('home.chart.classify_tab_reclassify')}
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
                <span className={`adr-maprow-reason${isWarnReason(row.reason) ? ' warn' : ''}`}>
                  {reasonText(row)}
                </span>
                <span className="adr-maprow-count">
                  {t('home.chart.count_suffix', { count: row.count })}
                </span>
                {renderPickSelect(
                  '',
                  (v) => handleProcessPick(row.process, v),
                  busyKey === `p:${row.process}`,
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
                  {row.process_selection && (
                    <span className={`adr-maprow-reason${isWarnReason(row.reason) ? ' warn' : ''}`}>
                      {reasonText(row)}
                    </span>
                  )}
                </span>
                {renderPickSelect(
                  '',
                  (v) => handleDocumentPick(row.id, v),
                  busyKey === `d:${row.id}`,
                )}
              </div>
            ))
          )}
        </>
      )}

      {!loading && !error && tab === 'reclassify' && (
        <>
          <div className="adr-modal-note">{t('home.chart.classify_reclassify_note')}</div>
          {reclassifiableProcesses.length === 0 && reclassifiableDocuments.length === 0 ? (
            <div className="adr-state">{t('home.chart.classify_empty_reclassify')}</div>
          ) : (
            <>
              {reclassifiableProcesses.length > 0 && (
                <>
                  <div className="adr-modal-note">{t('home.chart.classify_tab_process')}</div>
                  {reclassifiableProcesses.map((row) => (
                    <div className="adr-maprow" key={row.id}>
                      <span className="adr-maprow-name">
                        {row.process}
                        <span className="adr-maprow-sub">
                          {t('home.chart.classify_reclassify_current', { value: row.design_rule_label })}
                        </span>
                      </span>
                      {renderReclassifySelect(
                        { value: row.design_rule, label: row.design_rule_label },
                        (v) => handleReclassifyProcess(row, v),
                        busyKey === `ro:${row.id}`,
                      )}
                    </div>
                  ))}
                </>
              )}
              {reclassifiableDocuments.length > 0 && (
                <>
                  <div className="adr-modal-note">{t('home.chart.classify_tab_document')}</div>
                  {reclassifiableDocuments.map((row) => (
                    <div className="adr-maprow" key={row.id}>
                      <span className="adr-maprow-name">
                        {row.document_title}
                        <span className="adr-maprow-sub">
                          {t('home.chart.classify_reclassify_current', { value: row.design_rule_label })}
                        </span>
                      </span>
                      {renderReclassifySelect(
                        { value: row.design_rule, label: row.design_rule_label },
                        (v) => handleReclassifyDocument(row, v),
                        busyKey === `do:${row.id}`,
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
