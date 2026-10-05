import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import { documentsAPI, usersAPI } from '../api/client';
import { ChangeRoutePayload, RequestDocument, UserWithRole, plRoleFor } from '../types';
import { getCurrentRound, getDocDetailFields } from '../utils/approvalTable';
import { ADI_CD_CHANGE_PURPOSE, MAP_DELETE_EDIT_PURPOSE } from '../pages/RequestPage/constants';

type MemberStatus = 'keep' | 'add' | 'remove';
type SectionKey = 'pl' | 'sa' | 'ra' | 'notifiers';

interface RouteMember {
  loginid: string;
  name: string;
  /** 이미 합의(pending 이 아닌 상태)를 마쳐 제거할 수 없는 사람 */
  locked: boolean;
  status: MemberStatus;
}

type RouteState = Record<SectionKey, RouteMember[]>;

interface RouteChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  doc: RequestDocument;
  /** 저장에 성공하면 호출된다(부모가 문서를 다시 불러와 화면을 갱신한다). */
  onChanged: (docId: number) => void | Promise<void>;
}

interface DetailPerson {
  loginid?: string;
  name?: string;
}

const MAX_CANDIDATE_ROWS = 50;

/** additional_notes(JSON) 에서 detail 의 사람 목록(후결자·통보처)을 읽는다. 파싱 실패면 빈 배열. */
const readDetailPeople = (doc: RequestDocument, key: 'post_approvers' | 'notifiers'): RouteMember[] => {
  try {
    const parsed = JSON.parse(doc.additional_notes ?? '{}');
    const list: DetailPerson[] = Array.isArray(parsed?.detail?.[key]) ? parsed.detail[key] : [];
    return list
      .filter((p) => p && typeof p.loginid === 'string' && p.loginid.trim() !== '')
      .map((p) => ({ loginid: (p.loginid as string).trim(), name: p.name || (p.loginid as string), locked: false, status: 'keep' as MemberStatus }));
  } catch {
    return [];
  }
};

/** 현재 회차 step 중 해당 agent 의 사람 목록. 합의를 마친 step 은 잠금. */
const readStepMembers = (doc: RequestDocument, round: number, agent: 'PL' | 'SA' | 'RA', excludeLoginid = ''): RouteMember[] =>
  (doc.approval_steps ?? [])
    .filter((s) => s.agent === agent && (s.round ?? 1) === round && s.assignee_loginid && s.assignee_loginid !== excludeLoginid)
    .map((s) => ({
      loginid: s.assignee_loginid as string,
      name: s.assignee_name || (s.assignee_loginid as string),
      locked: s.action !== 'pending',
      status: 'keep' as MemberStatus,
    }));

const buildInitialState = (doc: RequestDocument, round: number): { state: RouteState; raCreated: boolean } => {
  const fixedLid = doc.post_approver_fixed_loginid ?? '';
  const raCreated = (doc.approval_steps ?? []).some((s) => s.agent === 'RA' && (s.round ?? 1) === round);
  return {
    raCreated,
    state: {
      pl: readStepMembers(doc, round, 'PL'),
      sa: readStepMembers(doc, round, 'SA'),
      ra: raCreated ? readStepMembers(doc, round, 'RA', fixedLid) : readDetailPeople(doc, 'post_approvers'),
      notifiers: readDetailPeople(doc, 'notifiers'),
    },
  };
};

const keptLoginids = (members: RouteMember[]): string[] =>
  members.filter((m) => m.status !== 'remove').map((m) => m.loginid);

const hasChange = (members: RouteMember[]): boolean => members.some((m) => m.status !== 'keep');

interface RouteSectionProps {
  title: string;
  required?: boolean;
  help: string;
  members: RouteMember[];
  showStatus: boolean;
  candidates: UserWithRole[];
  loadingCandidates: boolean;
  disabled?: boolean;
  disabledMessage?: string;
  fixedChip?: React.ReactNode;
  onAdd: (user: UserWithRole) => void;
  onRemove: (loginid: string) => void;
  onUndo: (loginid: string) => void;
}

const CHIP_BASE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 'var(--radius-sm)',
  padding: '3px 9px', fontSize: '0.82rem', border: '1px solid var(--border)', background: 'var(--bg-secondary)',
};
const CHIP_BUTTON: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 2px', fontSize: '0.85rem', lineHeight: 1,
};
const STATUS_TAG: React.CSSProperties = { fontSize: '0.7rem', fontWeight: 700 };

function RouteSection({
  title, required, help, members, showStatus, candidates, loadingCandidates, disabled, disabledMessage,
  fixedChip, onAdd, onRemove, onUndo,
}: RouteSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const taken = useMemo(() => new Set(members.map((m) => m.loginid)), [members]);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((u) => !taken.has(u.loginid))
      .filter((u) => !q
        || u.name.toLowerCase().includes(q)
        || u.loginid.toLowerCase().includes(q)
        || (u.mail ?? '').toLowerCase().includes(q)
        || (u.deptname ?? '').toLowerCase().includes(q))
      .slice(0, MAX_CANDIDATE_ROWS);
  }, [candidates, taken, query]);

  const renderChip = (m: RouteMember): React.ReactElement => {
    if (m.locked) {
      return (
        <span key={m.loginid} style={{ ...CHIP_BASE, border: '1px dashed var(--text-disabled)', color: 'var(--text-muted)', background: 'var(--bg-primary)' }}>
          🔒 {m.name}
          <small style={{ ...STATUS_TAG, color: 'var(--success)' }}>{t('approval.route_status_agreed')}</small>
        </span>
      );
    }
    if (m.status === 'remove') {
      return (
        <span key={m.loginid} style={{ ...CHIP_BASE, background: 'var(--danger-light)', borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          <span style={{ textDecoration: 'line-through' }}>{m.name}</span>
          <small style={STATUS_TAG}>{t('approval.route_status_remove')}</small>
          <button type="button" aria-label={t('approval.route_undo_remove')} title={t('approval.route_undo_remove')} style={CHIP_BUTTON} onClick={() => onUndo(m.loginid)}>↩</button>
        </span>
      );
    }
    const isAdd = m.status === 'add';
    return (
      <span key={m.loginid} style={isAdd ? { ...CHIP_BASE, background: 'var(--success-light)', borderColor: 'var(--success)' } : CHIP_BASE}>
        {m.name}
        {showStatus && (
          <small style={{ ...STATUS_TAG, color: isAdd ? 'var(--success)' : 'var(--warning)' }}>
            {isAdd ? t('approval.route_status_add') : t('approval.route_status_pending')}
          </small>
        )}
        <button type="button" aria-label={t('approval.route_remove')} title={t('approval.route_remove')} style={CHIP_BUTTON} onClick={() => onRemove(m.loginid)}>✕</button>
      </span>
    );
  };

  return (
    <div style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 12, background: disabled ? 'var(--bg-primary)' : undefined }}>
      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
        {title}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </div>
      <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '2px 0 8px' }}>{help}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {fixedChip}
        {members.map(renderChip)}
        {members.length === 0 && !fixedChip && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('approval.route_no_members')}</span>
        )}
      </div>
      {disabled ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
          {disabledMessage}
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className="form-control"
            style={{ fontSize: '0.85rem' }}
            value={query}
            autoComplete="off"
            disabled={loadingCandidates}
            placeholder={loadingCandidates ? t('common.loading') : t('approval.route_search_placeholder')}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
          />
          {open && !loadingCandidates && (
            <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-modal)' }}>
              {options.length === 0 ? (
                <li style={{ padding: '8px 12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('approval.no_search_results')}</li>
              ) : options.map((u) => (
                <li
                  key={u.loginid}
                  style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onAdd(u);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.84rem' }}>{u.name}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.74rem' }}>
                    {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 결재 경로 변경 모달 — 상신 때 지정했던 사람(PL·영업/기술지원 합의자·추가 후결자·통보처)을 수정한다.
 * 합의를 마친 사람은 🔒 로 잠겨 제거할 수 없고(서버도 400), 변경이 있는 항목만 서버로 보낸다.
 */
export default function RouteChangeModal({ isOpen, onClose, doc, onChanged }: RouteChangeModalProps): React.ReactElement | null {
  const { t } = useTranslation();
  const round = getCurrentRound(doc);
  const detailFields = getDocDetailFields(doc);
  // 후결자 단계 자체가 없는 문서 유형(MAP 삭제·ADI CD 변경)은 후결자 항목을 보여주지 않는다.
  const hasPostApprover = detailFields.purpose !== MAP_DELETE_EDIT_PURPOSE && detailFields.purpose !== ADI_CD_CHANGE_PURPOSE;
  const stageOpen = (doc.approval_steps ?? []).some(
    (s) => (s.agent === 'PL' || s.agent === 'SA') && (s.round ?? 1) === round && s.action === 'pending'
  );

  const initial = useMemo(() => buildInitialState(doc, round), [doc, round]);
  const [state, setState] = useState<RouteState>(initial.state);
  const [candidates, setCandidates] = useState<UserWithRole[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setState(initial.state);
    setSaveError('');
  }, [isOpen, initial]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      setLoadingCandidates(true);
      setCandidatesError(false);
      try {
        // 후보는 로그인한 사람이 아니라 문서의 지역으로 고른다(서버 검증과 같은 규칙).
        const res = await usersAPI.list(plRoleFor(doc.is_overseas));
        if (!cancelled) setCandidates(res.data);
      } catch {
        if (!cancelled) {
          setCandidates([]);
          setCandidatesError(true);
        }
      } finally {
        if (!cancelled) setLoadingCandidates(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isOpen, doc.is_overseas]);

  const addMember = (key: SectionKey) => (u: UserWithRole) =>
    setState((prev) => ({ ...prev, [key]: [...prev[key], { loginid: u.loginid, name: u.name, locked: false, status: 'add' as MemberStatus }] }));
  const removeMember = (key: SectionKey) => (loginid: string) =>
    setState((prev) => ({
      ...prev,
      [key]: prev[key]
        .filter((m) => !(m.loginid === loginid && m.status === 'add'))
        .map((m) => (m.loginid === loginid && m.status === 'keep' && !m.locked ? { ...m, status: 'remove' as MemberStatus } : m)),
    }));
  const undoRemove = (key: SectionKey) => (loginid: string) =>
    setState((prev) => ({
      ...prev,
      [key]: prev[key].map((m) => (m.loginid === loginid && m.status === 'remove' ? { ...m, status: 'keep' as MemberStatus } : m)),
    }));

  const changed = {
    pl: stageOpen && hasChange(state.pl),
    sa: stageOpen && hasChange(state.sa),
    ra: hasPostApprover && hasChange(state.ra),
    notifiers: hasChange(state.notifiers),
  };
  const anyChange = changed.pl || changed.sa || changed.ra || changed.notifiers;
  const plEmpty = changed.pl && keptLoginids(state.pl).length === 0;

  const sectionTitle: Record<SectionKey, string> = {
    pl: t('approval.route_section_pl'),
    sa: t('approval.route_section_sa'),
    ra: t('approval.route_section_ra'),
    notifiers: t('approval.route_section_notifiers'),
  };

  // 저장 전 미리보기 — 어떤 변경이 어떤 메일을 만드는지 보여준다(통보처·R 합의 전 후결자는 메일 없음).
  const summaryLines = (['pl', 'sa', 'ra', 'notifiers'] as SectionKey[]).flatMap((key) => {
    if (!changed[key]) return [];
    const sendsMail = key === 'pl' || key === 'sa' || (key === 'ra' && initial.raCreated);
    return state[key]
      .filter((m) => m.status !== 'keep')
      .map((m) => {
        const adding = m.status === 'add';
        const tKey = `approval.route_summary_${adding ? 'add' : 'remove'}_${sendsMail ? 'mail' : 'nomail'}` as const;
        return { id: `${key}:${m.loginid}`, adding, text: t(tKey, { section: sectionTitle[key], name: m.name }) };
      });
  });

  const handleSave = async () => {
    const payload: ChangeRoutePayload = {};
    if (changed.pl) payload.designated_pl_loginids = keptLoginids(state.pl);
    if (changed.sa) payload.sales_agreer_loginids = keptLoginids(state.sa);
    if (changed.ra) payload.post_approver_loginids = keptLoginids(state.ra);
    if (changed.notifiers) {
      payload.notifiers = state.notifiers.filter((m) => m.status !== 'remove').map((m) => ({ loginid: m.loginid, name: m.name }));
    }
    setSaving(true);
    setSaveError('');
    try {
      await documentsAPI.changeRoute(doc.id, payload);
      await onChanged(doc.id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '');
    } finally {
      setSaving(false);
    }
  };

  const fixedChip = doc.post_approver_fixed_loginid ? (
    <span style={{ ...CHIP_BASE, border: '1px dashed var(--text-disabled)', color: 'var(--text-muted)', background: 'var(--bg-primary)' }}>
      🔒 {doc.post_approver_fixed_name || doc.post_approver_fixed_loginid}
      <small style={{ ...STATUS_TAG, color: 'var(--text-muted)' }}>{t('approval.route_fixed_tag')}</small>
    </span>
  ) : undefined;

  const lockedMessage = t('approval.route_locked_stage_done');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('approval.change_route_title')}
      topLevel
      hideFullscreen
      style={{ maxWidth: 760 }}
      bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
      footer={(
        <>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginRight: 'auto' }}>{t('approval.route_footer_hint')}</span>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!anyChange || plEmpty || saving}>
            {saving ? t('common.loading') : t('approval.route_save')}
          </button>
        </>
      )}
    >
      <div style={{ background: 'var(--info-light)', border: '1px solid var(--blue-200)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '0.78rem', color: 'var(--blue-800)', marginBottom: 12 }}>
        {t('approval.route_intro')}
      </div>
      {candidatesError && (
        <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginBottom: 8 }}>{t('approval.route_candidates_failed')}</p>
      )}

      <RouteSection
        title={sectionTitle.pl} required help={t('approval.route_section_pl_help')}
        members={state.pl} showStatus candidates={candidates} loadingCandidates={loadingCandidates}
        disabled={!stageOpen} disabledMessage={lockedMessage}
        onAdd={addMember('pl')} onRemove={removeMember('pl')} onUndo={undoRemove('pl')}
      />
      {plEmpty && <p style={{ color: 'var(--danger)', fontSize: '0.78rem', margin: '-6px 0 10px' }}>{t('approval.route_pl_min')}</p>}
      <RouteSection
        title={sectionTitle.sa} help={t('approval.route_section_sa_help')}
        members={state.sa} showStatus candidates={candidates} loadingCandidates={loadingCandidates}
        disabled={!stageOpen} disabledMessage={lockedMessage}
        onAdd={addMember('sa')} onRemove={removeMember('sa')} onUndo={undoRemove('sa')}
      />
      {hasPostApprover && (
        <RouteSection
          title={sectionTitle.ra}
          help={initial.raCreated ? t('approval.route_section_ra_help_after_r') : t('approval.route_section_ra_help_before_r')}
          members={state.ra} showStatus={initial.raCreated} candidates={candidates} loadingCandidates={loadingCandidates}
          fixedChip={fixedChip}
          onAdd={addMember('ra')} onRemove={removeMember('ra')} onUndo={undoRemove('ra')}
        />
      )}
      <RouteSection
        title={sectionTitle.notifiers} help={t('approval.route_section_notifiers_help')}
        members={state.notifiers} showStatus={false} candidates={candidates} loadingCandidates={loadingCandidates}
        onAdd={addMember('notifiers')} onRemove={removeMember('notifiers')} onUndo={undoRemove('notifiers')}
      />

      {summaryLines.length > 0 && (
        <div style={{ background: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: '0.8rem' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('approval.route_summary_title')}</div>
          {summaryLines.map((l) => (
            <div key={l.id} style={{ color: l.adding ? 'var(--success)' : 'var(--danger)' }}>{l.text}</div>
          ))}
        </div>
      )}
      {saveError && (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem', marginTop: 10 }}>
          {t('approval.route_save_failed')} {saveError}
        </p>
      )}
    </Modal>
  );
}
