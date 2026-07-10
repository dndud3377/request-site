// 결재 현황 테이블 계산 헬퍼 — ApprovalPage 와 HomePage(최근 의뢰 현황)가 동일한 표를 그리도록 공유한다.
import type { TFunction } from 'i18next';
import { RequestDocument } from '../types';
import { formatDate } from './date';

// TE_O/TE_E는 담당자 지정 불필요 — 나머지 단계에서 담당자 미지정 시 'unassigned' 반환
export const getDisplayStatus = (doc: RequestDocument): string => {
  if (doc.status !== 'under_review') return doc.status;
  const steps = doc.approval_steps ?? [];
  const maxRound = steps.reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;
  const pending = steps.filter((s) => (s.round ?? 1) === maxRound && s.action === 'pending');
  const needsAssignment = pending.some(
    (s) => s.agent !== 'O' && s.agent !== 'E' && !s.assignee_loginid
  );
  return needsAssignment ? 'unassigned' : 'under_review';
};

export const getCurrentRound = (doc: RequestDocument): number =>
  (doc.approval_steps ?? []).reduce((m, s) => Math.max(m, s.round ?? 1), 0) || 1;

// due_date 텍스트 + CSS 클래스 반환
export const getDueDateDisplay = (
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
export const getFinalCompletionDate = (doc: RequestDocument): string => {
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

export interface DocTableRow {
  pathKey: 'single' | 'path1' | 'path2';
  stageText: string;
  dueDate: string | null;
  isDone: boolean;
  pathStatus: string; // 경로별 상태 (StatusBadge에 전달)
}

// 경로별 상태 계산: pending의 assignee 여부에 따라 unassigned / under_review / approved
export const resolvePathStatus = (
  pendingStep: { agent: string; assignee_loginid?: string } | undefined,
  isDone: boolean,
  docStatus: string,
): string => {
  if (docStatus === 'rejected') return 'rejected';
  if (isDone) return 'approved';
  if (!pendingStep) return 'approved';
  return pendingStep.assignee_loginid ? 'under_review' : 'unassigned';
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

export const getDocTableRows = (doc: RequestDocument, t: TFunction): DocTableRow[] => {
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
