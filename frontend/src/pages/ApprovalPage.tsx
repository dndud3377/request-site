import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { documentsAPI, usersAPI } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import PagedDetailView from '../components/PagedDetailView';
import { canUserAgree, canUserAssign, canUserClaim, ROLE_TO_AGENT } from '../components/ApprovalFlow';
import { RequestDocument, AgentType, UserRole, UserWithRole, ApprovalStepFrontend } from '../types';
import { formatDate } from '../utils/date';
import { TOUR_APPROVAL_DOCS, TOUR_APPROVAL_MY_IDS, TOUR_APPROVAL_DETAIL_DOC, TOUR_APPROVAL_ASSIGN_DOC, TOUR_ASSIGN_MEMBERS } from './approvalTourSeed';

// 전체 가이드 상세 모달에서 특정 페이지로 이동하기 위한 페이지 인덱스
// (MASTER 역할 기준 페이지 순서: 0 상세 · 1 MAP · 2 JOB · 3 OVL · 4 BB · 5 결재 경로)
const TOUR_PAGE_IDX: Record<string, number> = { jayer: 2, route: 5 };

const AGENT_TO_ROLE: Record<string, string> = {
  R: 'TE_R',
  P: 'TE_P',
  J: 'TE_J',
  O: 'TE_O',
  E: 'TE_E',
};

// ===== Utils =====

// TE_O/TE_E는 담당자 지정 불필요 — 나머지 단계에서 담당자 미지정 시 'unassigned' 반환
const getDisplayStatus = (doc: RequestDocument): string => {
  if (doc.status !== 'under_review') return doc.status;
  const steps = doc.approval_steps ?? [];
  const maxRound = steps.reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;
  const pending = steps.filter((s) => (s.round ?? 1) === maxRound && s.action === 'pending');
  const needsAssignment = pending.some(
    (s) => s.agent !== 'O' && s.agent !== 'E' && !s.assignee_loginid
  );
  return needsAssignment ? 'unassigned' : 'under_review';
};

const getCurrentRound = (doc: RequestDocument): number =>
  (doc.approval_steps ?? []).reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;

// due_date 텍스트 + CSS 클래스 반환
const getDueDateDisplay = (
  dueDate: string | null | undefined,
  isDone: boolean,
  undecidedLabel: string,
): { text: string; cls: string } => {
  if (isDone) return { text: dueDate ? formatDate(dueDate) : '-', cls: 'due-date-done' };
  if (!dueDate) return { text: undecidedLabel, cls: 'due-date-undecided' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  if (due < today) return { text: formatDate(dueDate), cls: 'due-date-overdue' };
  if (due.getTime() === today.getTime()) return { text: formatDate(dueDate), cls: 'due-date-today' };
  return { text: formatDate(dueDate), cls: '' };
};

// 최종 완료 예상일: max(path1_end, path2_end)
// path1: J.due if exists, else P.due + 4 cal days (estimate before J is created)
// path2: max(O.due, E.due)
const getFinalCompletionDate = (doc: RequestDocument): string => {
  const maxRound = getCurrentRound(doc);
  const currentSteps = (doc.approval_steps ?? []).filter(s => (s.round ?? 1) === maxRound);
  const rStep = currentSteps.find(s => s.agent === 'R');
  if (!rStep || rStep.action !== 'approved') return '-';

  const pStep = currentSteps.find(s => s.agent === 'P');
  const jStep = currentSteps.find(s => s.agent === 'J');
  const oStep = currentSteps.find(s => s.agent === 'O');
  const eStep = currentSteps.find(s => s.agent === 'E');

  // path2: max(O.due, E.due)
  const path2Dates = [oStep?.due_date, eStep?.due_date].filter(Boolean) as string[];
  const path2End = path2Dates.length > 0 ? path2Dates.reduce((a, b) => (a > b ? a : b)) : null;

  // path1: J.due or estimated (P.due + 4 calendar days)
  let path1End: string | null = null;
  if (jStep?.due_date) {
    path1End = jStep.due_date;
  } else if (pStep?.due_date) {
    const d = new Date(pStep.due_date);
    d.setDate(d.getDate() + 4);
    path1End = d.toISOString().slice(0, 10);
  }

  const candidates = [path1End, path2End].filter(Boolean) as string[];
  if (candidates.length === 0) return '-';
  return formatDate(candidates.reduce((a, b) => (a > b ? a : b)));
};

interface DocTableRow {
  pathKey: 'single' | 'path1' | 'path2';
  stageText: string;
  dueDate: string | null;
  isDone: boolean;
  pathStatus: string; // 경로별 상태 (StatusBadge에 전달)
}

// 경로별 상태 계산: pending의 assignee 여부에 따라 unassigned / under_review / approved
const resolvePathStatus = (
  pendingStep: { agent: string; assignee_loginid?: string } | undefined,
  isDone: boolean,
  docStatus: string,
): string => {
  if (docStatus === 'rejected') return 'rejected';
  if (isDone) return 'approved';
  if (!pendingStep) return 'approved';
  return pendingStep.assignee_loginid ? 'under_review' : 'unassigned';
};

// 중단 요청 '확인' 가능 여부(프론트 가드): MASTER / 담당자 본인 / (미배정 시) 같은 팀
const canConfirmPauseStep = (
  user: { role?: UserRole | string | null; username?: string },
  step: ApprovalStepFrontend,
): boolean => {
  if (user.role === 'MASTER') return true;
  const loginid = user.username;
  if (step.assignee_loginid) return !!loginid && step.assignee_loginid === loginid;
  const agent = user.role ? ROLE_TO_AGENT[user.role as UserRole] : undefined;
  return agent === step.agent;
};

const buildStageText = (
  step: { agent: string; assignee_name?: string } | undefined,
  isDone: boolean,
  t: TFunction,
): string => {
  if (isDone) return t('common.status_approved');
  if (!step) return t('common.status_approved');
  const label = t(`approval.agent_${step.agent}` as any);
  return step.assignee_name ? `${label}(${step.assignee_name})` : label;
};

const getDocTableRows = (doc: RequestDocument, t: TFunction): DocTableRow[] => {
  const maxRound = getCurrentRound(doc);
  const currentSteps = (doc.approval_steps ?? []).filter(s => (s.round ?? 1) === maxRound);

  // 중단(PAUSE): 멈춘 단계를 그대로 보여준다 (PAUSE 뱃지 + 현재 단계 텍스트).
  if (doc.status === 'pause') {
    const pending = currentSteps.filter(s => s.action === 'pending');
    const stageText = pending.length > 0
      ? pending.map(s => t(`approval.agent_${s.agent}` as any)).join(' / ')
      : '-';
    return [{
      pathKey: 'single',
      stageText,
      dueDate: pending[0]?.due_date ?? null,
      isDone: false,
      pathStatus: 'pause',
    }];
  }

  // PL 검토 단계 pending: 기한 없음, R 단계 미생성 상태 (다중 PL은 아직 미합의자만 표시)
  const plPending = currentSteps.filter(s => s.agent === 'PL' && s.action === 'pending');
  if (plPending.length > 0) {
    const label = t('approval.agent_PL' as any);
    const names = plPending.map(s => s.assignee_name).filter(Boolean);
    const stageText = names.length > 0 ? `${label}(${names.join(' / ')})` : label;
    return [{
      pathKey: 'single',
      stageText,
      dueDate: null,
      isDone: false,
      pathStatus: 'under_review',
    }];
  }

  const rStep = currentSteps.find(s => s.agent === 'R');
  const inParallel = rStep?.action === 'approved';

  if (!inParallel) {
    const pending = currentSteps.filter(s => s.action === 'pending');
    if (pending.length === 0) {
      return [{
        pathKey: 'single',
        stageText: doc.status === 'approved' ? t('common.status_approved') : '-',
        dueDate: null,
        isDone: true,
        pathStatus: doc.status,
      }];
    }
    // R 단계 pending: assignee 여부로 상태 결정
    const rPending = pending.find(s => s.agent === 'R');
    const pathStatus = rPending
      ? (rPending.assignee_loginid ? 'under_review' : 'unassigned')
      : 'under_review';
    const stageText = pending
      .map(s => buildStageText(s, false, t))
      .join(' / ');
    return [{
      pathKey: 'single',
      stageText,
      dueDate: pending[0]?.due_date ?? null,
      isDone: false,
      pathStatus,
    }];
  }

  // 병렬 단계
  const pStep = currentSteps.find(s => s.agent === 'P');
  const jSteps = currentSteps.filter(s => s.agent === 'J');
  const oStep = currentSteps.find(s => s.agent === 'O');
  const eStep = currentSteps.find(s => s.agent === 'E');

  const jPendingSteps = jSteps.filter(s => s.action === 'pending');
  const path1PendingP = pStep?.action === 'pending' ? pStep : undefined;
  const path1Done = !path1PendingP && jPendingSteps.length === 0;

  let path1StageText: string;
  let path1DueDate: string | null;
  let path1PathStatus: string;
  if (path1Done) {
    path1StageText = t('common.status_approved');
    path1DueDate = null;
    path1PathStatus = doc.status === 'rejected' ? 'rejected' : 'approved';
  } else if (path1PendingP) {
    path1StageText = buildStageText(path1PendingP, false, t);
    path1DueDate = path1PendingP.due_date ?? null;
    path1PathStatus = doc.status === 'rejected' ? 'rejected' : path1PendingP.assignee_loginid ? 'under_review' : 'unassigned';
  } else {
    // J 단계는 검토중(claim) 방식 — 담당자 이름은 노출하지 않는다.
    path1StageText = t(`approval.agent_J` as any);
    path1DueDate = jPendingSteps[0]?.due_date ?? null;
    const jHasUnassigned = jPendingSteps.some(s => !s.assignee_loginid);
    path1PathStatus = doc.status === 'rejected' ? 'rejected' : jHasUnassigned ? 'unassigned' : 'under_review';
  }

  const path2PendingSteps = ([oStep, eStep] as (typeof oStep)[]).filter(
    (s): s is NonNullable<typeof oStep> => !!s && s.action === 'pending'
  );
  const path2Done = path2PendingSteps.length === 0;
  const path2StageText = path2Done
    ? t('common.status_approved')
    : path2PendingSteps
        .map(s => {
          const label = t(`approval.agent_${s.agent}` as any);
          return s.assignee_name ? `${label}(${s.assignee_name})` : label;
        })
        .join(' / ');
  const path2DueDate = path2PendingSteps.reduce<string | null>((max, s) => {
    if (!s.due_date) return max;
    return !max || s.due_date > max ? s.due_date : max;
  }, null);

  return [
    {
      pathKey: 'path1',
      stageText: path1StageText,
      dueDate: path1DueDate,
      isDone: path1Done,
      pathStatus: path1PathStatus,
    },
    {
      pathKey: 'path2',
      stageText: path2StageText,
      dueDate: path2DueDate,
      isDone: path2Done,
      pathStatus: resolvePathStatus(path2PendingSteps[0], path2Done, doc.status),
    },
  ];
};

// ===== (ApprovalFlow, PagedDetailView are imported from components/) =====

// ===== Main Page =====

interface FilterTab {
  key: string;
  label: string;
}

export default function ApprovalPage(): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const addToast = useToast();
  const { currentUser } = useAuth();

  // 전체 가이드 투어 모드: /approval?embed=tour — 샘플 데이터로 결재 현황을 시연한다.
  const isTourMode = new URLSearchParams(location.search).get('embed') === 'tour';
  // 투어에서 제목을 '실제로 클릭'하는 모습을 보여주기 위한 가짜 커서
  const [tourCursor, setTourCursor] = useState<{ x: number; y: number } | null>(null);
  const [tourClicking, setTourClicking] = useState(false);

  const [docs, setDocs] = useState<RequestDocument[]>([]);
  const [allDocs, setAllDocs] = useState<RequestDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RequestDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  // 합의/반려 comment 모달
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'agree' | 'reject'; agent: AgentType; isPeer?: boolean } | null>(null);
  const [commentInput, setCommentInput] = useState('');

  // 중단 요청 사유 입력 모달
  const [pauseReasonModalOpen, setPauseReasonModalOpen] = useState(false);
  const [pauseReasonInput, setPauseReasonInput] = useState('');

  // 지정하기 UI (모달 footer)
  const [assigningOpen, setAssigningOpen] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState('');
  const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
  const [teamMembers, setTeamMembers] = useState<UserWithRole[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // 지정자 변경 UI (모달 footer)
  const [changingDesigneeOpen, setChangingDesigneeOpen] = useState(false);
  const [changingDesigneeUserId, setChangingDesigneeUserId] = useState('');
  const [changingDesigneeQuery, setChangingDesigneeQuery] = useState('');
  const [changingDesigneeDropdownOpen, setChangingDesigneeDropdownOpen] = useState(false);
  const changingDesigneeRef = React.useRef<HTMLDivElement>(null);

  const handleLoadTeamMembers = async (agent: AgentType): Promise<UserWithRole[]> => {
    // 투어: 실제 API 대신 샘플 팀 인원을 반환(실제 지정 UI와 동일하게 select 채움)
    if (isTourMode) return TOUR_ASSIGN_MEMBERS;
    const role = AGENT_TO_ROLE[agent];
    if (!role) return [];
    const res = await usersAPI.list(role);
    return res.data;
  };

  const applyClientFilter = useCallback((all: RequestDocument[]): RequestDocument[] => {
    if (isTourMode) {
      if (filter === 'my') return all.filter(d => TOUR_APPROVAL_MY_IDS.has(d.id));
      return all;
    }
    if (filter === 'draft') return all.filter(d => d.status === 'draft');
    if (filter === 'rejected') return all.filter(d => d.status === 'rejected');
    if (filter === 'pause') return all.filter(d => d.status === 'pause');
    if (filter === 'my') {
      const role = currentUser.role;
      if (role === 'MASTER') return all;
      if (role === 'PL') {
        return all.filter((d) =>
          d.requester_name === currentUser.name ||
          d.designated_pl_loginid === currentUser.username ||
          (d.approval_steps ?? []).some(
            (s) => s.agent === 'PL' && s.assignee_loginid === currentUser.username
          )
        );
      }
      if (role === 'NONE' || !role) return [];
      // TE_* 역할: 내 loginid(username)가 assignee_loginid인 pending 단계가 있는 문서
      return all.filter((d) =>
        (d.approval_steps ?? []).some(
          (s) => s.action === 'pending' && s.assignee_loginid === currentUser.username
        )
      );
    }
    if (filter.startsWith('agent_')) {
      const agent = filter.replace('agent_', '') as AgentType;
      return all.filter((d) =>
        (d.approval_steps ?? []).some((s) => s.agent === agent && s.action === 'pending')
      );
    }
    return all;
  }, [filter, currentUser, isTourMode]);

  const getTabCount = useCallback((key: string, base: RequestDocument[]): number => {
    if (isTourMode) {
      if (key === '') return base.length;
      if (key === 'my') return base.filter(d => TOUR_APPROVAL_MY_IDS.has(d.id)).length;
      return 0;
    }
    if (key === '') return base.length;
    if (key === 'draft') return base.filter(d => d.status === 'draft').length;
    if (key === 'rejected') return base.filter(d => d.status === 'rejected').length;
    if (key === 'pause') return base.filter(d => d.status === 'pause').length;
    if (key === 'my') {
      const role = currentUser.role;
      if (role === 'MASTER') return base.length;
      if (role === 'PL') return base.filter(d =>
        d.requester_name === currentUser.name ||
        d.designated_pl_loginid === currentUser.username ||
        (d.approval_steps ?? []).some(s => s.agent === 'PL' && s.assignee_loginid === currentUser.username)
      ).length;
      if (role === 'NONE' || !role) return 0;
      return base.filter(d => (d.approval_steps ?? []).some(s => s.action === 'pending' && s.assignee_loginid === currentUser.username)).length;
    }
    if (key.startsWith('agent_')) {
      const agent = key.replace('agent_', '') as AgentType;
      return base.filter(d => (d.approval_steps ?? []).some(s => s.agent === agent && s.action === 'pending')).length;
    }
    return 0;
  }, [currentUser, isTourMode]);

  const fetchDocs = useCallback(() => {
    if (isTourMode) {
      setAllDocs(TOUR_APPROVAL_DOCS);
      setDocs(applyClientFilter(TOUR_APPROVAL_DOCS));
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    documentsAPI
      .list(params)
      .then((r) => {
        const data = r.data;
        let all: RequestDocument[] = Array.isArray(data) ? data : (data as any).results ?? [];
        // 결재 현황: approved 제외
        all = all.filter((d) => d.status !== 'approved');
        setAllDocs(all);
        setDocs(applyClientFilter(all));
      })
      .catch(() => { setError(true); setAllDocs([]); setDocs([]); })
      .finally(() => setLoading(false));
  }, [filter, search, applyClientFilter]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  // 전체 가이드(투어) 명령 수신: MY 필터 → 제목 클릭(커서)으로 상세 열기 → J-ayer export → 결재 경로 탭
  useEffect(() => {
    if (!isTourMode) return;
    let activeTok: { cancelled: boolean } | null = null;
    let paused = false;
    const rawSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // 일시정지를 반영하는 sleep — paused 동안 멈췄다가 재생 시 이어서 진행한다.
    const sleep = async (ms: number) => {
      let elapsed = 0;
      while (elapsed < ms) {
        if (paused) { await rawSleep(60); continue; }
        await rawSleep(60);
        elapsed += 60;
      }
    };

    // 커서를 의뢰 제목으로 이동(스크롤로 보이게) → 눌러서 상세 모달을 연다.
    const runOpenDetail = async (tok: { cancelled: boolean }) => {
      setTourCursor(null);
      setTourClicking(false);
      // 이전에 열린 모달(예: 지정하기 시연)이 있으면 닫고 목록으로 돌아간다.
      setModalOpen(false);
      setAssigningOpen(false);
      await sleep(400); if (tok.cancelled) return;
      const el = document.querySelector('[data-tour="approval-doc-title"]') as HTMLElement | null;
      if (el) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); await sleep(320); if (tok.cancelled) return; }
      const r = el?.getBoundingClientRect();
      if (r) setTourCursor({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 });
      await sleep(650); if (tok.cancelled) return;
      setTourClicking(true);
      el?.classList.add('tour-pressed');
      await sleep(300); if (tok.cancelled) return;
      setTourClicking(false);
      el?.classList.remove('tour-pressed');
      setSelected(TOUR_APPROVAL_DETAIL_DOC);
      setPageIdx(0);
      setModalOpen(true);
      await sleep(300);
      setTourCursor(null);
    };

    // 커서를 선택자 요소로 이동시키고 눌림 애니메이션을 재생하는 공용 헬퍼
    const cursorPress = async (selector: string, tok: { cancelled: boolean }): Promise<HTMLElement | null> => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); await sleep(320); if (tok.cancelled) return null; }
      const r = el?.getBoundingClientRect();
      if (r) setTourCursor({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 });
      await sleep(550); if (tok.cancelled) return null;
      setTourClicking(true);
      el?.classList.add('tour-pressed');
      await sleep(300); if (tok.cancelled) return null;
      setTourClicking(false);
      el?.classList.remove('tour-pressed');
      return el;
    };

    // 문서 C(지정 대기) 상세를 열고 → 실제 지정 UI(드롭다운 버튼→항목→확인)로 담당자를 배정하는 모습까지 시연한다.
    // 각 단계는 실제 DOM 클릭(el.click())을 호출해 운영과 동일한 onClick 동작을 그대로 탄다.
    const runOpenAssign = async (tok: { cancelled: boolean }) => {
      setTourCursor(null);
      setTourClicking(false);
      setModalOpen(false);
      setAssigningOpen(false);
      setAssigningUserId('');
      setAssignDropdownOpen(false);
      await sleep(300); if (tok.cancelled) return;
      setSelected(TOUR_APPROVAL_ASSIGN_DOC);
      setPageIdx(0);
      setModalOpen(true);
      await sleep(700); if (tok.cancelled) return;
      // ① '지정하기' 클릭 → 실제 onClick(후보 로드 + 지정 UI 노출)
      const assignBtn = await cursorPress('[data-tour="assign-btn"]', tok); if (tok.cancelled) return;
      assignBtn?.click();
      await sleep(700); if (tok.cancelled) return;
      // ② 드롭다운 버튼 클릭 → 후보 목록 펼침
      const ddBtn = await cursorPress('[data-tour="assign-select"]', tok); if (tok.cancelled) return;
      ddBtn?.click();
      await sleep(600); if (tok.cancelled) return;
      // ③ 후보 항목(첫 번째 인원) 클릭 → 선택
      const opt = await cursorPress('[data-tour="assign-option"]', tok); if (tok.cancelled) return;
      opt?.click();
      await sleep(600); if (tok.cancelled) return;
      // ④ '확인' 클릭 → 해당 단계에 담당자 배정(투어 로컬 반영)
      const ok = await cursorPress('[data-tour="assign-confirm"]', tok); if (tok.cancelled) return;
      ok?.click();
      await sleep(300);
      setTourCursor(null);
    };

    // 상세(문서 A) J-ayer 페이지의 '이력 확인' 버튼을 실제로 눌러 변경 전/후 모달을 연다.
    const runOpenRowDiff = async (tok: { cancelled: boolean }) => {
      await sleep(300); if (tok.cancelled) return;
      const btn = document.querySelector('[data-tour="jayer-hist-btn"]') as HTMLElement | null;
      btn?.scrollIntoView({ block: 'center', inline: 'nearest' });
      await sleep(280); if (tok.cancelled) return;
      btn?.click();
    };

    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== 'guide-tour-cmd') return;
      if (d.cmd === 'pause') { paused = true; return; }
      if (d.cmd === 'resume') { paused = false; return; }
      if (activeTok) activeTok.cancelled = true;
      const tok = { cancelled: false };
      activeTok = tok;
      switch (d.cmd) {
        case 'tour-reset':
          setModalOpen(false);
          setFilter('');
          setTourCursor(null);
          setTourClicking(false);
          break;
        case 'my-filter':
          setFilter('my');
          break;
        case 'all-filter':
          setFilter('');
          break;
        case 'open-detail':
          runOpenDetail(tok);
          break;
        case 'open-assign':
          runOpenAssign(tok);
          break;
        case 'open-rowdiff':
          runOpenRowDiff(tok);
          break;
        case 'page-jayer':
          setPageIdx(TOUR_PAGE_IDX.jayer);
          break;
        case 'page-route':
          setPageIdx(TOUR_PAGE_IDX.route);
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (activeTok) activeTok.cancelled = true;
    };
  }, [isTourMode]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (changingDesigneeRef.current && !changingDesigneeRef.current.contains(e.target as Node)) {
        setChangingDesigneeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const tabBaseLabels: { key: string; baseLabel: string }[] = [
    { key: '', baseLabel: t('approval.filter_all') },
    { key: 'my', baseLabel: t('approval.filter_my') },
    { key: 'agent_R', baseLabel: t('approval.filter_agent_R') },
    { key: 'agent_P', baseLabel: t('approval.filter_agent_P') },
    { key: 'agent_J', baseLabel: t('approval.filter_agent_J') },
    { key: 'agent_O', baseLabel: t('approval.filter_agent_O') },
    { key: 'agent_E', baseLabel: t('approval.filter_agent_E') },
    { key: 'pause', baseLabel: t('approval.filter_pause') },
    { key: 'draft', baseLabel: t('approval.filter_draft') },
    { key: 'rejected', baseLabel: t('approval.filter_rejected') },
  ];
  const filterTabs: FilterTab[] = tabBaseLabels.map(({ key, baseLabel }) => {
    const count = getTabCount(key, allDocs);
    return { key, label: count > 0 ? `${baseLabel}(${count})` : baseLabel };
  });

  const openDetail = async (doc: RequestDocument) => {
    if (isTourMode) {
      setSelected(doc);
    } else {
      try {
        const detailResult = await documentsAPI.get(doc.id);
        setSelected(detailResult.data);
      } catch {
        setSelected(doc);
      }
    }
    setPageIdx(0);
    setAssigningOpen(false);
    setAssigningUserId('');
    setTeamMembers([]);
    setChangingDesigneeOpen(false);
    setChangingDesigneeUserId('');
    setModalOpen(true);
  };

  const refreshAndSelect = async (docId: number) => {
    const listResult = await documentsAPI.list({});
    const listData = listResult.data;
    let newDocs: RequestDocument[] = Array.isArray(listData) ? listData : (listData as any).results ?? [];
    newDocs = newDocs.filter((d) => d.status !== 'approved');
    setAllDocs(newDocs);
    setDocs(applyClientFilter(newDocs));
    const freshDoc = await documentsAPI.get(docId).then(r => r.data).catch(() => newDocs.find(d => d.id === docId));
    if (freshDoc) setSelected(freshDoc);
  };

  // 합의/반려 버튼 클릭 → comment 모달 열기
  const triggerAgree = (agent: AgentType, isPeer = false) => {
    setPendingAction({ type: 'agree', agent, isPeer });
    setCommentInput('');
    setCommentModalOpen(true);
  };

  const triggerReject = (agent: AgentType, isPeer = false) => {
    setPendingAction({ type: 'reject', agent, isPeer });
    setCommentInput('');
    setCommentModalOpen(true);
  };

  const handleConfirmAction = async () => {
    if (!selected || !pendingAction) return;
    setCommentModalOpen(false);
    setProcessing(true);
    try {
      if (pendingAction.isPeer) {
        if (pendingAction.type === 'agree') {
          await documentsAPI.peerApprove(selected.id, commentInput || undefined);
          addToast(t('approval.agree_success', { agent: t('approval.agent_PL' as any) }), 'success');
          setModalOpen(false);
          fetchDocs();
        } else {
          await documentsAPI.peerReject(selected.id, commentInput || undefined);
          addToast(t('approval.reject_success'), 'error');
          await refreshAndSelect(selected.id);
        }
      } else if (pendingAction.type === 'agree') {
        await documentsAPI.approveStep(selected.id, pendingAction.agent, commentInput || undefined, currentUser.name);
        addToast(t('approval.agree_success', { agent: t(`approval.agent_${pendingAction.agent}` as any) }), 'success');
        setModalOpen(false);
        fetchDocs();
      } else {
        await documentsAPI.rejectStep(selected.id, pendingAction.agent, commentInput || undefined);
        addToast(t('approval.reject_success'), 'error');
        await refreshAndSelect(selected.id);
      }
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
      setPendingAction(null);
    }
  };

  const handlePeerSubmitNav = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { peerReviewDocId: doc.id } });
  };

  const handleChangeDesignee = async () => {
    if (!selected || !changingDesigneeUserId) return;
    setProcessing(true);
    try {
      await documentsAPI.changeDesignee(selected.id, changingDesigneeUserId);
      setChangingDesigneeOpen(false);
      setChangingDesigneeUserId('');
      setChangingDesigneeQuery('');
      setChangingDesigneeDropdownOpen(false);
      setTeamMembers([]);
      addToast('지정자가 변경되었습니다.', 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleClaim = async (agent: AgentType) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.claimStep(selected.id, agent);
      await refreshAndSelect(selected.id);
      addToast(t('approval.claim_success'), 'success');
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  // ===== 결재 중단(PAUSE) =====
  const handleRequestPauseClick = () => {
    setPauseReasonInput('');
    setPauseReasonModalOpen(true);
  };

  const submitRequestPause = async () => {
    if (!selected || !pauseReasonInput.trim()) return;
    setProcessing(true);
    try {
      await documentsAPI.requestPause(selected.id, pauseReasonInput.trim());
      setPauseReasonModalOpen(false);
      addToast(t('approval.pause_requested_toast'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmPause = async (agent: AgentType) => {
    if (!selected) return;
    setProcessing(true);
    try {
      const r = await documentsAPI.confirmPause(selected.id, agent);
      if (r.data.status === 'pause') {
        addToast(t('approval.pause_confirmed_toast'), 'success');
        setModalOpen(false);
        fetchDocs();
      } else {
        addToast(t('approval.pause_confirm_progress_toast'), 'success');
        await refreshAndSelect(selected.id);
      }
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelPause = async () => {
    if (!selected) return;
    setProcessing(true);
    try {
      await documentsAPI.cancelPause(selected.id);
      addToast(t('approval.pause_cancelled_toast'), 'success');
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleResumeNav = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { editDocId: doc.id } });
  };

  const handleAssign = async (agent: AgentType, loginid: string, userName: string) => {
    if (!selected) return;
    if (isTourMode) {
      // 투어: 실제 API 대신 로컬 상태로 해당 단계에 담당자 배정 결과를 반영
      const apply = (d: RequestDocument): RequestDocument =>
        d.id !== selected.id ? d : {
          ...d,
          approval_steps: (d.approval_steps ?? []).map((s) =>
            s.agent === agent && s.action === 'pending' && !s.assignee_loginid
              ? { ...s, assignee_name: userName, assignee_loginid: loginid }
              : s),
        };
      setAllDocs((prev) => prev.map(apply));
      setDocs((prev) => prev.map(apply));
      setSelected((prev) => (prev ? apply(prev) : prev));
      addToast(t('approval.assign_success'), 'success');
      return;
    }
    setProcessing(true);
    try {
      await documentsAPI.assignStep(selected.id, agent, loginid, userName);
      await refreshAndSelect(selected.id);
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
    }
  };

  // 철회 모달 상태
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawDoc, setWithdrawDoc] = useState<RequestDocument | null>(null);

  const handleWithdrawClick = (doc: RequestDocument) => {
    setWithdrawDoc(doc);
    setWithdrawModalOpen(true);
  };

  const handleWithdrawToDraft = async () => {
    if (!withdrawDoc) return;
    setProcessing(true);
    try {
      await documentsAPI.withdraw(withdrawDoc.id);
      addToast(t('approval.withdraw_success'), 'success');
      setWithdrawModalOpen(false);
      setModalOpen(false);
      fetchDocs();
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
      setWithdrawDoc(null);
    }
  };

  const handleDelete = async () => {
    if (!withdrawDoc) return;
    setProcessing(true);
    try {
      await documentsAPI.delete(withdrawDoc.id);
      addToast('의뢰서가 삭제되었습니다.', 'success');
      setWithdrawModalOpen(false);
      setModalOpen(false);
      fetchDocs();
    } catch {
      addToast(t('common.process_error'), 'error');
    } finally {
      setProcessing(false);
      setWithdrawDoc(null);
    }
  };

  const handleEditResubmit = (doc: RequestDocument) => {
    setModalOpen(false);
    navigate('/request', { state: { editDocId: doc.id } });
  };

  const isPL = currentUser.role === 'PL';
  const isMaster = currentUser.role === 'MASTER';
  const isNone = currentUser.role === 'NONE';

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
              data-tour={tab.key === 'my' ? 'approval-my-tab' : undefined}
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
      ) : error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p>{t('common.load_error')}</p>
          <button className="btn" onClick={fetchDocs}>{t('common.retry')}</button>
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
                <th>{t('approval.col_current_stage')}</th>
                <th>{t('approval.col_current_stage_completion')}</th>
                <th>{t('approval.col_final_completion')}</th>
                <th>{t('approval.col_production_date')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.flatMap((doc) => {
                const rows = getDocTableRows(doc, t);
                const isParallel = rows.length === 2;
                const undecided = t('approval.due_date_undecided');
                return rows.map((row, idx) => {
                  const dd = getDueDateDisplay(row.dueDate, row.isDone, undecided);
                  return (
                    <tr
                      key={`${doc.id}-${idx}`}
                      className={isParallel ? (idx === 0 ? 'doc-row-first' : 'doc-row-second') : ''}
                    >
                      {idx === 0 && (
                        <td rowSpan={rows.length}>
                          {isNone ? (
                            <span
                              data-tour={isTourMode && doc.id === TOUR_APPROVAL_DETAIL_DOC.id ? 'approval-doc-title' : undefined}
                              style={{ fontWeight: 600, fontSize: '0.9rem' }}
                            >
                              {doc.title}
                            </span>
                          ) : (
                            <button
                              data-tour={isTourMode && doc.id === TOUR_APPROVAL_DETAIL_DOC.id ? 'approval-doc-title' : undefined}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem', textAlign: 'left', padding: 0 }}
                              onClick={() => openDetail(doc)}
                            >
                              {doc.title}
                            </button>
                          )}
                        </td>
                      )}
                      {idx === 0 && <td rowSpan={rows.length}>{doc.product_name}</td>}
                      {idx === 0 && (
                        <td rowSpan={rows.length}>
                          <div>{doc.requester_name}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{doc.requester_department}</div>
                        </td>
                      )}
                      <td
                        style={{ fontWeight: 500 }}
                        data-tour={isTourMode && doc.id === TOUR_APPROVAL_DETAIL_DOC.id && idx === 0 ? 'approval-stage' : undefined}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <StatusBadge status={row.pathStatus} />
                          <span style={{ color: row.isDone ? 'var(--text-disabled)' : 'var(--text-primary)' }}>{row.stageText}</span>
                          {idx === 0 && doc.pause_request?.state === 'requested' && (
                            <span className="pause-req-chip">⏸ {t('approval.pause_requested_chip')}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={dd.cls}>{dd.text}</span>
                      </td>
                      {idx === 0 && <td rowSpan={rows.length}>{getFinalCompletionDate(doc)}</td>}
                      {idx === 0 && <td rowSpan={rows.length}>{doc.production_date ? formatDate(doc.production_date) : '-'}</td>}
                      {idx === 0 && (
                        <td rowSpan={rows.length}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {doc.can_edit && (doc.status === 'rejected' || doc.status === 'draft') && (
                              <button className="btn btn-primary btn-sm" onClick={() => handleEditResubmit(doc)}>
                                {t('approval.edit_resubmit')}
                              </button>
                            )}
                            {doc.can_withdraw && (doc.status === 'under_review' || doc.status === 'rejected' || doc.status === 'draft') && (
                              <button className="btn btn-secondary btn-sm" onClick={() => handleWithdrawClick(doc)} disabled={processing}>
                                {t('approval.withdraw')}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 합의/반려 이유 입력 모달 */}
      {commentModalOpen && pendingAction && (
        <Modal
          isOpen={commentModalOpen}
          onClose={() => { setCommentModalOpen(false); setPendingAction(null); }}
          title={pendingAction.type === 'agree' ? t('approval.modal_agree_title', { agent: t(`approval.agent_${pendingAction.agent}` as any) }) : t('approval.modal_reject_title', { agent: t(`approval.agent_${pendingAction.agent}` as any) })}
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className={pendingAction.type === 'agree' ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={handleConfirmAction}
                disabled={processing}
              >
                {t('common.confirm')}
              </button>
              <button className="btn btn-secondary" onClick={() => { setCommentModalOpen(false); setPendingAction(null); }}>
                {t('common.cancel')}
              </button>
            </div>
          }
        >
          <div>
            <p style={{ marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {pendingAction.type === 'agree' ? t('approval.comment_agree_label') : t('approval.comment_reject_label')}
            </p>
            <textarea
              className="form-control"
              rows={4}
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder={pendingAction.type === 'agree' ? t('approval.comment_agree_placeholder') : t('approval.comment_reject_placeholder')}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
        </Modal>
      )}

      {/* 중단 요청 사유 입력 모달 */}
      {pauseReasonModalOpen && (
        <Modal
          isOpen={pauseReasonModalOpen}
          onClose={() => setPauseReasonModalOpen(false)}
          title={t('approval.pause_request_modal_title')}
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-pause"
                onClick={submitRequestPause}
                disabled={processing || !pauseReasonInput.trim()}
              >
                {t('approval.pause_request_submit')}
              </button>
              <button className="btn btn-secondary" onClick={() => setPauseReasonModalOpen(false)} disabled={processing}>
                {t('common.cancel')}
              </button>
            </div>
          }
        >
          <div>
            <p style={{ marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {t('approval.pause_reason_label')} <span style={{ color: 'var(--danger)' }}>*</span>
            </p>
            <textarea
              className="form-control"
              rows={4}
              value={pauseReasonInput}
              onChange={(e) => setPauseReasonInput(e.target.value)}
              placeholder={t('approval.pause_reason_placeholder')}
              style={{ width: '100%', resize: 'vertical' }}
            />
            <p style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {t('approval.pause_reason_hint')}
            </p>
          </div>
        </Modal>
      )}

      {/* 철회/삭제 선택 모달 */}
      {withdrawModalOpen && (
        <Modal
          isOpen={withdrawModalOpen}
          onClose={() => { setWithdrawModalOpen(false); setWithdrawDoc(null); }}
          title="철회 방식 선택"
          size="md"
          topLevel
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={handleWithdrawToDraft}
                disabled={processing}
              >
                임시저장
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={processing}
              >
                삭제
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setWithdrawModalOpen(false); setWithdrawDoc(null); }}
                disabled={processing}
              >
                취소
              </button>
            </div>
          }
        >
          <div>
            <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              의뢰서를 철회하는 방식을 선택해주세요.
            </p>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-sm)', marginTop: 12 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>📝 임시저장</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                의뢰서가 임시저장 상태로 돌아갑니다. 이후 수정하여 재상신할 수 있습니다.
              </p>
            </div>
            <div style={{ background: '#fff0f0', padding: '12px', borderRadius: 'var(--radius-sm)', marginTop: 8 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#dc3545', marginBottom: 8 }}>🗑️ 삭제</p>
              <p style={{ fontSize: '0.8rem', color: '#dc3545', margin: 0 }}>
                의뢰서가 완전히 삭제됩니다. 복구할 수 없습니다.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* 상세 모달 */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selected?.title ?? ''}
        size="xl"
        footer={(() => {
          const userAgent = currentUser.role ? ROLE_TO_AGENT[currentUser.role] : undefined;
          const pendingSteps = selected?.approval_steps?.filter((s) => {
            if (s.action !== 'pending') return false;
            if (isMaster) return true;
            if (isPL && s.agent === 'PL') return true;
            return s.agent === userAgent;
          }) ?? [];
          // 투어 모드에서는 '지정하기' 시연을 위해 R 단계(아직 미지정)를 지정 가능 단계로 본다.
          // 배정 후에는 assignee_loginid가 채워져 자동으로 사라진다(실제 동작과 동일).
          const assignableStep = isTourMode
            ? selected?.approval_steps?.find((s) => s.agent === 'R' && s.action === 'pending' && !s.assignee_loginid)
            : pendingSteps.find((s) => canUserAssign(currentUser, s));
          const actableStep = pendingSteps.find((s) => canUserAgree(currentUser, s));
          const isPLStep = actableStep?.agent === 'PL';
          // 검토중(claim) 가능 단계: J/O/E 중 담당 역할이 아직 미배정인 단계를 선점
          const claimableStep = isTourMode ? undefined : pendingSteps.find((s) => canUserClaim(currentUser, s));

          // 지정자 변경 가능 여부: 원 PL 또는 MASTER, under_review, PL 단계 pending
          const hasPendingPLStep = (selected?.approval_steps ?? []).some(s => s.agent === 'PL' && s.action === 'pending');
          const isOriginalPL = isPL && selected?.requester_name === currentUser.name;
          const canChangeDesignee = (isOriginalPL || isMaster) && selected?.status === 'under_review' && hasPendingPLStep;

          // 중단(PAUSE) 관련 버튼 노출 계산
          const pr = selected?.pause_request;
          const isPauseRequester = selected
            ? (selected.requester_loginid
                ? selected.requester_loginid === currentUser.username
                : selected.requester_name === currentUser.name)
            : false;
          // 확인 가능한 대상 단계(요청됨 상태 + target pending + 미확인 + 확인권한)
          let pauseConfirmAgent: AgentType | undefined;
          if (pr && pr.state === 'requested') {
            const target = (selected?.approval_steps ?? []).find(
              (s) => s.action === 'pending'
                && pr.target_step_ids.includes(s.id)
                && !pr.confirmed_step_ids.includes(s.id)
                && canConfirmPauseStep(currentUser, s)
            );
            pauseConfirmAgent = target?.agent;
          }

          return (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* 중단 요청 (작성자·진행 중) */}
              {selected && selected.can_request_pause && (
                <button className="btn btn-pause" onClick={handleRequestPauseClick} disabled={processing}>
                  {t('approval.pause_request')}
                </button>
              )}
              {/* 중단 확인 (현재 단계 담당자/팀) */}
              {pauseConfirmAgent && (
                <button className="btn btn-pause" onClick={() => handleConfirmPause(pauseConfirmAgent as AgentType)} disabled={processing}>
                  {t('approval.pause_confirm')}
                </button>
              )}
              {/* 중단 요청 취소 (요청됨 상태 + 작성자) */}
              {pr && pr.state === 'requested' && isPauseRequester && (
                <button className="btn btn-secondary" onClick={handleCancelPause} disabled={processing}>
                  {t('approval.pause_cancel')}
                </button>
              )}
              {/* 재개 (작성자·pause) */}
              {selected && selected.can_resume && (
                <button className="btn btn-primary" onClick={() => handleResumeNav(selected)} disabled={processing}>
                  {t('approval.resume')}
                </button>
              )}
              {selected && selected.can_edit && (selected.status === 'rejected' || selected.status === 'draft') && (
                <button className="btn btn-primary" onClick={() => handleEditResubmit(selected)}>
                  {t('approval.edit_resubmit')}
                </button>
              )}
              {selected && selected.can_withdraw && (selected.status === 'under_review' || selected.status === 'rejected' || selected.status === 'draft') && (
                <button className="btn btn-secondary" onClick={() => handleWithdrawClick(selected)} disabled={processing}>
                  {t('approval.withdraw')}
                </button>
              )}
              {/* 지정자 변경 */}
              {canChangeDesignee && !changingDesigneeOpen && !assigningOpen && (
                <button
                  className="btn btn-secondary"
                  disabled={processing}
                  onClick={async () => {
                    setChangingDesigneeOpen(true);
                    setChangingDesigneeUserId('');
                    setLoadingMembers(true);
                    const members = await usersAPI.list('PL');
                    setTeamMembers(members.data.filter(u => u.loginid !== currentUser.username));
                    setLoadingMembers(false);
                  }}
                >
                  {t('approval.change_designee')}
                </button>
              )}
              {canChangeDesignee && changingDesigneeOpen && (
                <>
                  <div ref={changingDesigneeRef} style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="form-control"
                      value={changingDesigneeQuery}
                      placeholder={loadingMembers ? '로딩 중...' : '이름·ID·이메일·부서 검색'}
                      disabled={loadingMembers}
                      autoComplete="off"
                      style={{ fontSize: '0.85rem', padding: '4px 8px', width: 220 }}
                      onChange={(e) => {
                        setChangingDesigneeQuery(e.target.value);
                        setChangingDesigneeUserId('');
                        setChangingDesigneeDropdownOpen(true);
                      }}
                      onFocus={() => setChangingDesigneeDropdownOpen(true)}
                    />
                    {changingDesigneeDropdownOpen && !loadingMembers && (
                      <ul style={{
                        position: 'absolute', bottom: '100%', left: 0, right: 0,
                        background: 'var(--bg-modal)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)',
                        margin: 0, padding: 0, listStyle: 'none',
                        maxHeight: 220, overflowY: 'auto', zIndex: 9999,
                      }}>
                        {teamMembers.filter((u) => {
                          const q = changingDesigneeQuery.toLowerCase();
                          if (!q) return true;
                          return (
                            u.name.toLowerCase().includes(q) ||
                            u.loginid.toLowerCase().includes(q) ||
                            (u.mail ?? '').toLowerCase().includes(q) ||
                            (u.deptname ?? '').toLowerCase().includes(q)
                          );
                        }).length === 0 ? (
                          <li style={{ padding: '8px 12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            검색 결과 없음
                          </li>
                        ) : (
                          teamMembers.filter((u) => {
                            const q = changingDesigneeQuery.toLowerCase();
                            if (!q) return true;
                            return (
                              u.name.toLowerCase().includes(q) ||
                              u.loginid.toLowerCase().includes(q) ||
                              (u.mail ?? '').toLowerCase().includes(q) ||
                              (u.deptname ?? '').toLowerCase().includes(q)
                            );
                          }).map((u) => (
                            <li
                              key={u.loginid}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setChangingDesigneeQuery(u.name);
                                setChangingDesigneeUserId(u.loginid);
                                setChangingDesigneeDropdownOpen(false);
                              }}
                              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                            >
                              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.name}</span>
                              <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.75rem' }}>
                                {u.loginid}{u.mail ? ` · ${u.mail}` : ''}{u.deptname ? ` · ${u.deptname}` : ''}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!changingDesigneeUserId || processing || loadingMembers}
                    onClick={handleChangeDesignee}
                  >
                    변경
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setChangingDesigneeOpen(false);
                      setChangingDesigneeUserId('');
                      setChangingDesigneeQuery('');
                      setChangingDesigneeDropdownOpen(false);
                      setTeamMembers([]);
                    }}
                  >
                    취소
                  </button>
                </>
              )}
              {/* 담당자 지정 (R·P 단계) */}
              {assignableStep && !assigningOpen && !changingDesigneeOpen && (
                <button
                  className="btn btn-secondary"
                  data-tour={isTourMode ? 'assign-btn' : undefined}
                  disabled={processing}
                  onClick={async () => {
                    setAssigningOpen(true);
                    setAssigningUserId('');
                    setLoadingMembers(true);
                    const members = await handleLoadTeamMembers(assignableStep.agent);
                    setTeamMembers(members);
                    setLoadingMembers(false);
                  }}
                >
                  {t('approval.assign_btn')}
                </button>
              )}
              {/* 검토중(claim) — J/O/E 단계 선점 */}
              {claimableStep && !assigningOpen && !changingDesigneeOpen && (
                <button
                  className="btn btn-secondary"
                  disabled={processing}
                  onClick={() => handleClaim(claimableStep.agent)}
                >
                  {t('approval.claim')}
                </button>
              )}
              {/* 단일 담당자 지정 (R·P) */}
              {assignableStep && assigningOpen && (
                <>
                  <div className="assign-dropdown" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      data-tour={isTourMode ? 'assign-select' : undefined}
                      className="btn btn-secondary btn-sm"
                      onClick={() => setAssignDropdownOpen((o) => !o)}
                      style={{ minWidth: 130, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                    >
                      {assigningUserId ? (
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.3 }}>
                          <span style={{ fontWeight: 600 }}>{teamMembers.find((u) => u.loginid === assigningUserId)?.name}</span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{teamMembers.find((u) => u.loginid === assigningUserId)?.deptname}</span>
                        </span>
                      ) : (
                        <span>{t('approval.assign_select_placeholder')}</span>
                      )}
                      <span aria-hidden="true">▾</span>
                    </button>
                    {assignDropdownOpen && (
                      <ul className="assign-dropdown-list">
                        {loadingMembers ? (
                          <li className="assign-dropdown-empty">{t('common.loading')}</li>
                        ) : teamMembers.length === 0 ? (
                          <li className="assign-dropdown-empty">{t('approval.no_team_members')}</li>
                        ) : teamMembers.map((u, i) => (
                          <li
                            key={u.loginid}
                            data-tour={isTourMode && i === 0 ? 'assign-option' : undefined}
                            className="assign-dropdown-item"
                            onClick={() => { setAssigningUserId(u.loginid); setAssignDropdownOpen(false); }}
                          >
                            <strong>{u.name}</strong>
                            <span className="assign-dropdown-dept">{u.mail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    data-tour={isTourMode ? 'assign-confirm' : undefined}
                    className="btn btn-primary btn-sm"
                    disabled={!assigningUserId || processing || loadingMembers}
                    onClick={() => {
                      const user = teamMembers.find((u) => u.loginid === assigningUserId);
                      if (user) {
                        handleAssign(assignableStep.agent, user.loginid, user.name);
                        setAssigningOpen(false);
                        setAssigningUserId('');
                        setAssignDropdownOpen(false);
                      }
                    }}
                  >
                    {t('common.confirm')}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setAssigningOpen(false); setAssigningUserId(''); setAssignDropdownOpen(false); }}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              )}
              {/* PL 검토 단계 액션 */}
              {actableStep && isPLStep && selected && (
                <>
                  <button className="btn btn-primary" disabled={processing} onClick={() => triggerAgree(actableStep.agent, true)}>
                    {t('approval.agree')}
                  </button>
                  <button className="btn btn-danger" disabled={processing} onClick={() => triggerReject(actableStep.agent, true)}>
                    {t('approval.reject')}
                  </button>
                  <button className="btn btn-secondary" disabled={processing} onClick={() => handlePeerSubmitNav(selected)}>
                    {t('approval.peer_submit')}
                  </button>
                </>
              )}
              {/* 일반 단계 액션 */}
              {actableStep && !isPLStep && (
                <>
                  <button
                    className="btn btn-primary"
                    disabled={processing}
                    onClick={() => triggerAgree(actableStep.agent)}
                  >
                    {t('approval.agree')}
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={processing}
                    onClick={() => triggerReject(actableStep.agent)}
                  >
                    {t('approval.reject')}
                  </button>
                </>
              )}
              <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                {t('common.close')}
              </button>
            </div>
          );
        })()}
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <StatusBadge status={selected.status} />

            {/* 중단 요청/확정 배너 */}
            {selected.pause_request && (
              <div className="pause-banner">
                <div style={{ fontSize: '1.2rem', lineHeight: 1.2 }} aria-hidden="true">⏸</div>
                <div style={{ flex: 1 }}>
                  <p className="pause-banner-title">
                    {selected.status === 'pause'
                      ? t('approval.pause_banner_paused')
                      : t('approval.pause_banner_requested', { name: selected.pause_request.requester_name })}
                  </p>
                  <p className="pause-banner-reason">“{selected.pause_request.reason}”</p>
                  {selected.pause_request.state === 'requested' ? (
                    <>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                        {t('approval.pause_confirm_status')}
                      </div>
                      <div className="pause-confirm-track">
                        {(selected.approval_steps ?? [])
                          .filter((s) => selected.pause_request!.target_step_ids.includes(s.id))
                          .map((s) => {
                            const done = selected.pause_request!.confirmed_step_ids.includes(s.id);
                            const mine = !done && s.action === 'pending' && canConfirmPauseStep(currentUser, s);
                            const label = t(`approval.agent_${s.agent}` as any);
                            return (
                              <span key={s.id} className={`pause-cf ${done ? 'done' : mine ? 'mine' : ''}`}>
                                <span className="pause-cf-dot" aria-hidden="true" />
                                {label} · {done ? t('approval.pause_cf_done') : mine ? t('approval.pause_cf_mine') : t('approval.pause_cf_wait')}
                              </span>
                            );
                          })}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {t('approval.pause_resume_hint')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 페이지 네비게이션 + 의뢰 상세 */}
            <PagedDetailView
              doc={selected}
              role={isTourMode ? 'MASTER' : (currentUser.role as UserRole)}
              pageIdx={pageIdx}
              setPageIdx={setPageIdx}
            />
          </div>
        )}
      </Modal>

      {/* 전체 가이드 데모: 제목을 실제로 클릭하는 모습을 보여주는 가짜 커서 */}
      {isTourMode && tourCursor && (
        <div className={`tour-jcursor${tourClicking ? ' clicking' : ''}`} style={{ transform: `translate(${tourCursor.x}px, ${tourCursor.y}px)` }}>
          {tourClicking && <span className="tour-jcursor-ripple" />}
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path d="M2 2 L2 17 L6.2 13 L9 19 L11.4 18 L8.6 12 L14 12 Z" fill="#fff" stroke="#1a1a2e" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
