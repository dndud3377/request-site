"""결재 알림 메일 발송 모듈

설계 개요
---------
1. 각 결재 전이(상신/합의/반려/완료) 시점에 `enqueue_*` 로 `MailNotification`
   행을 큐에 적재한다. 적재는 INSERT 한 번뿐이라 기존 결재 트랜잭션 안에서
   안전하게 수행된다(외부 HTTP 없음 → 문서 락을 오래 점유하지 않음).
2. APScheduler 잡 `process_mail_queue` 가 주기적으로 `pending` 행을 꺼내
   DXHUB 메일 API 로 발송한다. 실패 시 `attempts` 를 누적하며
   `max_attempts`(기본 5) 회까지 재시도한다. DB 영속이라 서버 재시작에도
   재시도 상태가 보존된다.

수신자 규칙
-----------
- PL 검토: 지정 PL 각각 1명(다중 지정 시 개별 발송)
- R: 담당자 지정 시 그 1명(제목에 "[이름님]" 표시), 미지정(도착 시점)이면 TE_R 팀 전원
- RV(검토자): 담당자 합의로 검토자 차례가 되는 시점에 그 1명(제목에 "[이름님]" 표시)
- RA(후결자): 병렬 진행 시작 시 각 후결자에게 개별 발송
  · 고정 후결자(settings.POST_APPROVER_LOGINID)는 "[후결 요청]" 제목 고정
  · 그 외(C가문 추가 후결자)는 다른 단계와 동일하게 "[이름님] [결재 요청] {제목}" 형식
- P: 담당자 지정 시 그 1명, 미지정 시 TE_P 권한 보유 전원
- J: 담당자(claim) 지정 시 그 1명, 미지정(도착 시점)이면 고정 주소
- O/E: 해당 역할(TE_O/TE_E) 팀 전원
- 반려: 요청서 작성자 + 현재 회차에서 이미 합의했던 전원(중복 제거)
  · PL 단계에서 반려된 경우, 아직 합의/반려하지 않은 나머지 지정 PL(pending)도 포함
  · 그 외 단계에서 반려된 경우, 아직 합의를 마치지 않은 결재선 단계의 담당 팀 전원도
    포함(반려한 본인 제외). 이미 합의를 마친 팀은 팀 전체 발송 대상이 아니다.
- 승인 완료: 현재 회차 결재 경로에 참여했던 전원(중복 제거)
- P 단계 완료 통보(notify_p_completed): TE_O + TE_J 팀 전원(참고용, 결재 권한과 무관)
- MAIL_REDIRECT_TO 설정 시 위 결과를 무시하고 전원 그 주소로 강제(개발/검증용)
"""
import logging
import threading

import requests
from urllib3.exceptions import InsecureRequestWarning

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.html import escape

from .models import ApprovalStep, MailNotification, UserProfile

logger = logging.getLogger(__name__)

# 사내 self-signed 인증서 대응으로 verify=False 사용 → 경고 억제
requests.packages.urllib3.disable_warnings(InsecureRequestWarning)

# DXHUB 외부 API 호출 타임아웃(초)
DXHUB_TIMEOUT = 10

# 결재 단계(agent) → 권한 역할(UserProfile.role) 매핑
AGENT_ROLE_MAP = {
    'PL': 'PL',
    'R': 'TE_R',
    'P': 'TE_P',
    'J': 'TE_J',
    'O': 'TE_O',
    'E': 'TE_E',
}

# 검토자 단계 → 담당자 단계. 검토자(RV/PV/EV)는 담당자와 같은 팀 소속이라
# 팀 이메일을 구할 때 담당자 단계로 환산한다(RV→R=TE_R, PV→P=TE_P, EV→E=TE_E).
REVIEWER_TO_MAIN_AGENT = {'RV': 'R', 'PV': 'P', 'EV': 'E'}

# 검토자 단계 — 지정됐을 때만 생성되는 선택 단계라, 실제 step 이 없으면 결재선에 없는 것으로 본다.
REVIEWER_AGENTS = ('RV', 'PV', 'EV')

# 반려 시 "잔여 결재선" 산출에 사용하는 결재선(라우팅) 단계 목록.
# PL 은 별도 규칙(미합의 지정 PL 포함)을 따르므로 여기서 제외한다.
# Only MAP 의뢰서는 P/O/E/J 없이 R 까지만 진행하고 후결자(RA)로 종단한다.
ROUTE_AGENTS_ONLY_MAP = ('R', 'RV', 'RA')
# 'MAP 삭제/수정' 의뢰서는 PL 합의 후 P·R·J·O 를 병렬로 진행한다.
# E(MASK)·EV 와 후결자(RA)는 생성하지 않으므로 경로에서도 빠진다(고정 후결자도 없는 유일한 경로).
ROUTE_AGENTS_MAP_DELETE_EDIT = ('P', 'PV', 'R', 'RV', 'J', 'O')
ROUTE_AGENTS_DEFAULT = ('R', 'RV', 'P', 'PV', 'J', 'O', 'E', 'EV', 'RA')


def route_agents_for(document):
    """의뢰서의 요청 목적에 맞는 결재선(라우팅) 단계 목록을 돌려준다.

    경로 카드 표시와 반려 수신자 산출이 같은 규칙을 쓰도록 여기에 모은다.
    """
    if document.is_map_delete_edit():
        return ROUTE_AGENTS_MAP_DELETE_EDIT
    if document.is_only_map():
        return ROUTE_AGENTS_ONLY_MAP
    return ROUTE_AGENTS_DEFAULT

# 메일 본문 '결재 경로' 카드의 표시 순서. 웹 '결재 경로' 탭과 같은 순서를 쓴다
# (검토자 RV/PV/EV 는 담당 단계 바로 뒤, 후결자 RA 는 R 다음).
ROUTE_DISPLAY_ORDER = ('PL', 'R', 'RV', 'RA', 'P', 'PV', 'J', 'O', 'E', 'EV')

# 결재 경로 카드의 상태 표기 — (라벨, 글자색, 배경색). 상태 색은 의미를 담고 있어
# 이벤트 테마(EVENT_THEME)와 무관하게 고정한다(웹 결재 경로 탭과 동일 팔레트).
ROUTE_STATUS_STYLE = {
    'approved': ('합의', '#059669', 'rgba(5,150,105,0.1)'),
    'rejected': ('반려', '#dc2626', 'rgba(220,38,38,0.1)'),
    'reviewing': ('검토중', '#d97706', 'rgba(217,119,6,0.1)'),
    'waiting': ('대기', '#8794a6', 'rgba(107,138,176,0.12)'),
    # (2026-08 이전 OR 시절 문서에만 남는 이력) EV 1명 합의로 단계가 끝나면 남은 검토자는
    # skip 으로 닫혔다. 지금은 EV도 전원 합의(AND)라 새로 생기지 않는다.
    # 색은 '대기' 와 같은 회색 계열 — 판단하지 않았다는 뜻이라 주의를 끌 필요가 없다.
    'skipped': ('건너뜀', '#8794a6', 'rgba(107,138,176,0.12)'),
}

# 담당자가 배정되지 않은 단계의 담당자 칸 문구
ROUTE_UNASSIGNED_LABEL = '담당자 미지정'

# 경로 카드에 싣는 코멘트 최대 길이(초과분은 잘라내고 말줄임표를 붙인다)
ROUTE_COMMENT_MAX_LEN = 300

# 단계 도착 시 팀 전원에게 보내는 단계 (담당자 지정 개념이 없는 병렬 단계 + 미배정 R)
TEAM_BROADCAST_AGENTS = ('O', 'E')

# (2026-08) 담당자 미지정 시 쓰던 고정 수신 주소(UNASSIGNED_FALLBACK = {'J': ...})를 삭제했다.
# J 가 R 합의 시점의 독립 병렬 단계가 되면서 TE_J 팀원 누구나 선점·합의하는 구조가 됐는데,
# 도착 메일만 대표 주소 1곳으로 가면 팀원 개개인이 자기 차례를 알 수 없다. 이제 J 도
# P/R 과 동일하게 "미배정이면 팀 전원, 배정 후엔 그 담당자 1명" 규칙을 쓴다.
# (하드코딩된 고정 주소 문제 `docs/E2E_TEST_AND_BUGS.md` B-44 도 함께 해소된다.)

# 메일 본문 표기용 단계 라벨 (마스킹된 비즈니스 용어 대신 코드 사용)
AGENT_LABEL = {
    'PL': 'PL 검토',
    'R': 'R',
    'RV': '검토자',
    'P': 'P',
    'PV': '검토자',
    'J': 'J',
    'O': 'O',
    'E': 'E',
    'EV': '검토자',
    'RA': '후결자',
}

# agent 가 없는 이벤트(반려/완료/통보)에서 KPI "결재 단계" 타일에 표시할 상태 문구
EVENT_STATUS_LABEL = {
    'rejected': '반려',
    'approved': '승인 완료',
    'notify_submitted': '상신 통보',
    'notify_approved': '결재 완료 통보',
    'notify_p_completed': 'P 단계 완료 통보',
    'revision_requested': '수정 요청',
}

# 이벤트 타입별 히어로+KPI 카드 이메일 색상 테마
EVENT_THEME = {
    'stage_arrival': {
        'hero': ('#2563eb', '#3b82f6'),
        'outer_bg': '#eef4ff', 'outer_border': '#dbe4f7',
        'label_color': '#3b5486',
        'tile_bg': '#f7faff', 'tile_border': '#e2e8f0',
        'note_label_color': '#2563eb',
        'footer_border': '#e2e8f0',
    },
    'rejected': {
        'hero': ('#dc2626', '#ef4444'),
        'outer_bg': '#fdf2f2', 'outer_border': '#f8d3d3',
        'label_color': '#9f5252',
        'tile_bg': '#fef7f7', 'tile_border': '#f1dede',
        'note_label_color': '#dc2626',
        'footer_border': '#f1dede',
    },
    'approved': {
        'hero': ('#16a34a', '#22c55e'),
        'outer_bg': '#f0faf4', 'outer_border': '#cdecd9',
        'label_color': '#3f7a56',
        'tile_bg': '#f6fdf9', 'tile_border': '#dcefe3',
        'note_label_color': '#16a34a',
        'footer_border': '#dcefe3',
    },
    'notify_submitted': {
        'hero': ('#7c3aed', '#8b5cf6'),
        'outer_bg': '#f6f2fe', 'outer_border': '#e1d3fb',
        'label_color': '#6b5490',
        'tile_bg': '#faf8ff', 'tile_border': '#ece3fb',
        'note_label_color': '#7c3aed',
        'footer_border': '#ece3fb',
    },
}
EVENT_THEME['notify_approved'] = EVENT_THEME['notify_submitted']
# P 단계 완료 통보(TE_O/TE_J)도 다른 통보 이벤트와 같은 보라 테마를 쓴다.
EVENT_THEME['notify_p_completed'] = EVENT_THEME['notify_submitted']
# 수정 요청: 결재를 되돌리진 않지만 상신자의 조치가 필요하다는 점에서 반려와 같은 주의 테마
EVENT_THEME['revision_requested'] = EVENT_THEME['rejected']


# --------------------------------------------------------------------------- #
# 수신자 해석
# --------------------------------------------------------------------------- #
def _apply_redirect(recipients):
    """MAIL_REDIRECT_TO 가 설정돼 있으면 모든 수신자를 해당 주소로 강제한다."""
    redirect_to = getattr(settings, 'MAIL_REDIRECT_TO', '') or ''
    redirect_to = redirect_to.strip()
    if redirect_to:
        return [redirect_to]
    # 빈 주소 제거 + 중복 제거(순서 보존)
    cleaned = []
    for addr in recipients:
        addr = (addr or '').strip()
        if addr and addr not in cleaned:
            cleaned.append(addr)
    return cleaned


def _team_emails(agent):
    """해당 단계 역할 권한을 가진 사용자 전원의 이메일 목록."""
    role = AGENT_ROLE_MAP.get(agent)
    if not role:
        return []
    return list(
        UserProfile.objects.filter(role=role)
        .exclude(mail='')
        .values_list('mail', flat=True)
    )


def _stage_team_emails(agent):
    """단계 담당 팀 전원의 이메일. 검토자(RV/PV/EV)는 담당자와 같은 팀이므로 환산해서 조회한다."""
    return _team_emails(REVIEWER_TO_MAIN_AGENT.get(agent, agent))


def post_approver_users(document):
    """후결자(RA) User 목록 = 고정 1명(settings.POST_APPROVER_LOGINID)
    + C가문(only_prodc=YES) 추가 후결자(detail.post_approvers). loginid 중복 제거.

    후결자는 역할(role)로 판별되지 않으므로 팀 조회(_team_emails) 대신 이 함수를 쓴다.
    결재 단계 생성(views)과 반려 수신자 산출(mailer)이 같은 규칙을 쓰도록 여기에 둔다.
    """
    users = []
    seen = set()
    fixed_lid = (getattr(settings, 'POST_APPROVER_LOGINID', '') or '').strip()
    if fixed_lid:
        u = UserProfile.objects.filter(loginid=fixed_lid).first()
        if u:
            users.append(u)
            seen.add(u.loginid)
    detail = document.get_detail().get('detail', {}) or {}
    for pa in (detail.get('post_approvers') or []):
        lid = str((pa or {}).get('loginid', '') or '').strip()
        if lid and lid not in seen:
            u = UserProfile.objects.filter(loginid=lid).first()
            if u:
                users.append(u)
                seen.add(lid)
    return users


def _is_fixed_post_approver(step):
    """RA 담당자가 고정 후결자(settings.POST_APPROVER_LOGINID)인지 여부.

    메일 제목 분기(고정 후결자만 "[후결 요청]" 고정 문구)에 쓰인다.
    """
    if not step or not step.assignee:
        return False
    fixed_lid = (getattr(settings, 'POST_APPROVER_LOGINID', '') or '').strip()
    return bool(fixed_lid) and step.assignee.loginid == fixed_lid


def resolve_stage_recipients(document, agent, step=None):
    """단계 도착 시 수신자 이메일 목록을 반환한다."""
    if agent in TEAM_BROADCAST_AGENTS:
        # O/E: 담당 팀 전원
        recipients = _team_emails(agent)
    elif agent == 'PL':
        # PL: 지정 PL 1명
        recipients = []
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
        elif document.designated_pl and document.designated_pl.mail:
            recipients = [document.designated_pl.mail]
    elif agent == 'P':
        # P: 담당자 지정 시 그 1명, 미지정 시 TE_P 권한 보유 전원
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
        else:
            recipients = _team_emails('P')
    elif agent in ('R', 'J'):
        # R/J: 담당자 지정 시 그 1명, 미지정(도착 시점) 시 해당 팀(TE_R/TE_J) 권한 보유 전원.
        # J 는 2026-08 병렬 분리 전까지 고정 주소 폴백을 썼다(위 주석 참고).
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
        else:
            recipients = _team_emails(agent)
    elif agent in ('RV', 'RA', 'PV', 'EV'):
        # RV/PV/EV(검토자)/RA(후결자): 항상 지정된 그 1명(호출 시점에 이미 assignee 확정)
        recipients = []
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
    else:
        # 위에서 PL·R·J·P·O·E·RV·PV·EV·RA 를 모두 다루므로 여기 오는 agent 는 없다.
        # 새 단계가 생겼는데 규칙을 안 넣은 경우 — 엉뚱한 곳으로 보내는 대신 발송하지 않는다.
        recipients = []
    return _apply_redirect(recipients)


def _current_round(document):
    """문서의 현재(최종) 결재 회차. 단계가 없으면 None."""
    return ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max']


def _current_round_step_emails(document, action=None):
    """현재(최종) 회차의 결재 단계 중 담당자 배정된 것의 이메일(중복 제거). action 지정 시 그 결과로만 한정."""
    max_round = _current_round(document)
    if max_round is None:
        return []
    qs = ApprovalStep.objects.filter(document=document, round=max_round)
    if action is not None:
        qs = qs.filter(action=action)
    return list(
        qs.exclude(assignee__isnull=True)
        .exclude(assignee__mail='')
        .values_list('assignee__mail', flat=True)
        .distinct()
    )


def _remaining_stage_emails(document, max_round):
    """반려 시점에 아직 합의를 마치지 않은 결재선 단계들의 담당 팀 이메일 전원.

    '이후 단계'를 정적인 순서표로 정의하지 않고 문서의 실제 상태로 판정한다.
    결재선(라우팅) 전체에서 이미 approved 된 단계를 빼면, 남는 것이
    (pending / 반려된 본인 / 아직 생성되지 않은) 미완료 단계다. 이렇게 하면
    병렬 단계(P·O·E·RA)가 서로 다른 속도로 진행돼도 누락 없이 잡히고,
    이미 일을 마친 팀에는 불필요한 팀 전체 메일이 나가지 않는다.
    """
    route = route_agents_for(document)
    steps = ApprovalStep.objects.filter(document=document, round=max_round)
    approved_agents = set(steps.filter(action='approved').values_list('agent', flat=True))
    existing_agents = set(steps.values_list('agent', flat=True))

    emails = []
    for agent in route:
        if agent in approved_agents:
            # 이미 끝난 단계는 팀 전체 발송 대상이 아니다(합의자 본인은 기합의자 규칙으로 포함).
            continue
        if agent in REVIEWER_AGENTS and agent not in existing_agents:
            # 검토자를 지정하지 않았으면 그 단계는 애초에 결재선에 없다.
            continue
        if agent == 'E' and not document.has_ppid_plel():
            # E 는 plel 인 의뢰서에만 생성된다.
            continue
        if agent == 'RA':
            emails.extend(u.mail for u in post_approver_users(document) if u.mail)
            continue
        emails.extend(_stage_team_emails(agent))
    return emails


def resolve_revision_request_recipients(document):
    """수정 요청 수신자: 의뢰서 작성자 본인.

    대상/비대상을 바꿀 수 있는 유일한 주체가 상신자이므로 다른 수신자를 두지 않는다.
    작성자 이메일이 비어 있으면 메일이 아예 적재되지 않으므로(_enqueue) 여기서 경고를 남긴다.
    """
    if not document.requester_email:
        logger.warning(
            "[mailer] 수정 요청 메일 수신자를 찾지 못했습니다 (doc=%s) — 작성자 이메일이 비어 있습니다.",
            document.pk,
        )
        return []
    return _apply_redirect([document.requester_email])


def resolve_reject_recipients(document):
    """반려 시 수신자: 요청서 작성자 + 현재 회차에서 이미 합의했던 전원(중복 제거).

    여기에 더해 반려된 단계에 따라 아래를 추가한다.
    - PL 단계 반려: 아직 합의/반려하지 않은 나머지 지정 PL(pending). PL 은 결재선
      팀 브로드캐스트 대상이 아니라 지정된 당사자들만 챙긴다.
    - 그 외 단계 반려: 아직 합의를 마치지 않은 결재선 단계의 담당 팀 전원
      (`_remaining_stage_emails`). 반려한 본인은 이 팀 브로드캐스트에서 제외한다
      (작성자·기합의자로 이미 포함된 주소는 그대로 유지).
    """
    max_round = _current_round(document)
    emails = []
    if document.requester_email:
        emails.append(document.requester_email)
    for mail in _current_round_step_emails(document, action='approved'):
        if mail not in emails:
            emails.append(mail)

    if max_round is not None:
        rejected_steps = list(
            ApprovalStep.objects.filter(document=document, round=max_round, action='rejected')
            .select_related('assignee')
        )
        rejected_agents = {s.agent for s in rejected_steps}

        if 'PL' in rejected_agents:
            pending_pl_qs = ApprovalStep.objects.filter(
                document=document, round=max_round, agent='PL', action='pending',
            ).exclude(assignee__isnull=True).exclude(assignee__mail='')
            for mail in pending_pl_qs.values_list('assignee__mail', flat=True).distinct():
                if mail not in emails:
                    emails.append(mail)
        elif rejected_agents:
            rejecter_mails = {
                s.assignee.mail for s in rejected_steps if s.assignee and s.assignee.mail
            }
            for mail in _remaining_stage_emails(document, max_round):
                if mail and mail not in rejecter_mails and mail not in emails:
                    emails.append(mail)
    return _apply_redirect(emails)


def resolve_approved_recipients(document):
    """승인 완료 시 수신자: 현재 회차 결재 경로에 참여했던 전원(중복 제거)."""
    return _apply_redirect(_current_round_step_emails(document))


def resolve_notifier_recipients(document):
    """통보처 수신자: detail.notifiers 의 loginid 로 발송 시점의 최신 이메일을 조회한다.

    통보자는 결재 권한이 없고, 상신·결재완료 시점에만 메일 통보를 받는다.
    이메일 stale 방지를 위해 저장은 loginid+name 만 하고 mail 은 여기서 조회한다.
    """
    detail = document.get_detail().get('detail', {})
    notifiers = detail.get('notifiers', []) if isinstance(detail, dict) else []
    loginids = [
        n.get('loginid') for n in notifiers
        if isinstance(n, dict) and n.get('loginid')
    ]
    if not loginids:
        return _apply_redirect([])
    emails = list(
        UserProfile.objects.filter(loginid__in=loginids)
        .exclude(mail='')
        .distinct()
        .values_list('mail', flat=True)
    )
    return _apply_redirect(emails)


# --------------------------------------------------------------------------- #
# 메일 본문 생성
# --------------------------------------------------------------------------- #
def _detail_link(document, use_history=False):
    """메일 본문에 포함할 의뢰 상세 딥링크.

    ?id= 쿼리로 결재현황/이력조회 페이지가 해당 문서 상세 모달을 자동으로 연다.
    완료(approved) 문서는 결재현황 목록에서 빠지므로 이력조회로 보낸다.
    """
    base = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
    path = 'history' if use_history else 'approval'
    return f"{base}/{path}?id={document.id}"


def _voc_link(voc_id):
    """메일 본문에 포함할 VOC 상세 페이지 주소."""
    base = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
    return f"{base}/voc?id={voc_id}"


# 완료 이후 결재현황 목록에서 빠지는 이벤트 — 이력조회로 딥링크
_HISTORY_LINK_EVENTS = ('approved', 'notify_approved')


def _kpi_grid(tiles, tile_bg, tile_border):
    """(label, value) 튜플 4개를 히어로+KPI 카드 이메일의 2x2 타일 그리드 HTML로 렌더링한다.

    label/value 는 사용자 입력을 포함할 수 있으므로(의뢰자 이름 등) 여기서 escape 한다.
    """
    cells = []
    for i, (label, value) in enumerate(tiles):
        pad = 'padding:0 6px 12px 0;' if i % 2 == 0 else 'padding:0 0 12px 6px;'
        cells.append(
            f'<td width="50%" style="{pad}">'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="background:{tile_bg};border:1px solid {tile_border};border-radius:10px;">'
            '<tr><td style="padding:13px 15px;">'
            f'<div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;color:#64748b;'
            f'text-transform:uppercase;">{escape(label)}</div>'
            f'<div style="margin-top:5px;font-size:15px;font-weight:700;color:#0f172a;">'
            f'{escape(str(value))}</div>'
            '</td></tr></table></td>'
        )
    rows = ''.join(f'<tr>{cells[i]}{cells[i + 1]}</tr>' for i in range(0, len(cells), 2))
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'


def _route_rows(document):
    """메일 '결재 경로' 카드에 실을 (단계명, 담당자, 상태키, 코멘트) 목록.

    현재(최종) 회차만 담는다 — 재상신 문서라도 이전 회차 이력은 싣지 않는다.
    라우팅(ROUTE_AGENTS_*)에 있으나 아직 step 이 생성되지 않은 단계는 '대기' 행으로
    채워, 앞으로 남은 결재가 몇 단계인지 보이게 한다. Only MAP 이거나 plel 이 아닌
    의뢰서에서 아예 거치지 않는 단계는 행 자체를 만들지 않는다.
    """
    max_round = _current_round(document)
    if max_round is None:
        return []

    route = set(route_agents_for(document))
    route.add('PL')  # PL 은 수신자 규칙에서만 예외이고 경로 표시에는 항상 포함된다
    if not document.has_ppid_plel():
        route -= {'E', 'EV'}

    steps = list(
        ApprovalStep.objects.filter(document=document, round=max_round)
        .select_related('assignee')
        .order_by('id')
    )
    steps_by_agent = {}
    for s in steps:
        steps_by_agent.setdefault(s.agent, []).append(s)

    rows = []
    for agent in ROUTE_DISPLAY_ORDER:
        if agent not in route:
            continue
        label = AGENT_LABEL.get(agent, agent)
        agent_steps = steps_by_agent.get(agent)
        if not agent_steps:
            # 아직 도달하지 않은 단계(검토자는 지정됐을 때만 생기므로 예정 표시 대상이 아니다)
            if agent not in REVIEWER_AGENTS:
                rows.append((label, '', 'waiting', ''))
            continue
        for s in agent_steps:
            if s.action == 'approved':
                status = 'approved'
            elif s.action == 'rejected':
                status = 'rejected'
            elif s.action == 'skip':
                status = 'skipped'
            elif s.assignee_id:
                status = 'reviewing'
            else:
                status = 'waiting'
            rows.append((label, s.assignee_name or '', status, s.comment or ''))
    return rows


def _render_route_card(document, theme):
    """현재 회차 결재 경로 카드 HTML. 경로가 없으면 빈 문자열(카드 자체를 넣지 않음).

    단계명/담당자/코멘트는 사용자 입력을 포함할 수 있으므로 전부 escape 하고,
    코멘트 줄바꿈은 white-space:pre-wrap 으로 살린다. Outlook 호환을 위해
    flex/grid 없이 table 로만 조판한다.
    """
    rows = _route_rows(document)
    if not rows:
        return ''

    tr_html = []
    last = len(rows) - 1
    for i, (label, assignee, status, comment) in enumerate(rows):
        border = '' if i == last else 'border-bottom:1px solid #eef1f6;'
        status_label, status_color, status_bg = ROUTE_STATUS_STYLE[status]

        if assignee:
            name_html = f'<span style="color:#0f172a;font-weight:500;">{escape(assignee)}</span>'
        else:
            name_html = (
                f'<span style="color:#94a3b8;">{escape(ROUTE_UNASSIGNED_LABEL)}</span>'
            )

        comment = (comment or '').strip()
        if comment:
            if len(comment) > ROUTE_COMMENT_MAX_LEN:
                comment = comment[:ROUTE_COMMENT_MAX_LEN] + '…'
            name_html += (
                '<div style="margin-top:5px;font-size:12.5px;line-height:1.6;color:#475569;'
                'font-style:italic;border-left:2px solid #dfe4ec;padding-left:9px;'
                f'white-space:pre-wrap;">{escape(comment)}</div>'
            )

        tr_html.append(
            f'<tr>'
            f'<td width="78" style="padding:7px 12px 7px 0;{border}vertical-align:top;'
            f'font-size:12px;font-weight:700;color:#334155;white-space:nowrap;">{escape(label)}</td>'
            f'<td style="padding:7px 0;{border}vertical-align:top;font-size:13px;">{name_html}</td>'
            f'<td align="right" style="padding:7px 0 7px 10px;{border}vertical-align:top;white-space:nowrap;">'
            f'<span style="display:inline-block;font-size:11px;font-weight:700;border-radius:10px;'
            f'padding:2px 9px;color:{status_color};background:{status_bg};white-space:nowrap;">'
            f'{status_label}</span></td>'
            f'</tr>'
        )

    round_label = f' · {_current_round(document)}회차'
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">'
        f'<tr><td style="background:#ffffff;border:1px solid {theme["outer_border"]};'
        'border-radius:10px;padding:14px 16px;">'
        '<div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;'
        f'color:{theme["note_label_color"]};text-transform:uppercase;">결재 경로{round_label}</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:9px;">'
        f'{"".join(tr_html)}'
        '</table></td></tr></table>'
    )


def _render_hero_kpi_email(event_type, headline, document, kpi_tiles, note_value, link, link_text):
    """히어로 헤더 + KPI 카드형 트랜잭셔널 이메일 본문(HTML)을 렌더링한다.

    document.title / note_value 는 사용자 입력이므로 escape 하고, 특이사항의 줄바꿈은
    white-space:pre-wrap 으로 그대로 살린다(별도 개행 변환 불필요). 색상은 event_type 별
    EVENT_THEME 를 사용하고, 매핑에 없는 타입은 stage_arrival(블루) 테마로 대체한다.
    """
    theme = EVENT_THEME.get(event_type, EVENT_THEME['stage_arrival'])
    hero_from, hero_to = theme['hero']
    title_html = escape(document.title)
    kpi_html = _kpi_grid(kpi_tiles, theme['tile_bg'], theme['tile_border'])
    route_html = _render_route_card(document, theme)
    note_html = escape(note_value) if note_value else '-'
    headline_html = escape(headline)

    return f'''<!--[if mso]>
<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td>
<![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="width:100%;max-width:600px;margin:0 auto;background:{theme['outer_bg']};border-radius:14px;overflow:hidden;border:1px solid {theme['outer_border']};">
  <tr>
    <td bgcolor="{hero_from}" style="background:linear-gradient(135deg,{hero_from} 0%,{hero_to} 100%);padding:30px 32px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="font-size:12px;font-weight:700;letter-spacing:.06em;color:rgba(255,255,255,.75);text-transform:uppercase;">제품 소개 지도 의뢰 시스템</td></tr>
        <tr><td style="padding-top:12px;font-size:19px;line-height:1.45;font-weight:700;color:#ffffff;">{headline_html}</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 32px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid {theme['outer_border']};border-radius:12px;margin-bottom:20px;">
        <tr><td style="padding:18px 18px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td>
              <div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;color:{theme['label_color']};text-transform:uppercase;">의뢰서 제목</div>
              <div style="margin-top:6px;font-size:17px;font-weight:700;color:#0f172a;line-height:1.5;">{title_html}</div>
            </td></tr>
          </table>
          {kpi_html}
        </td></tr>
      </table>
      {route_html}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
        <tr><td style="background:#ffffff;border:1px solid {theme['outer_border']};border-radius:10px;padding:14px 16px;">
          <div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;color:{theme['note_label_color']};text-transform:uppercase;">특이사항</div>
          <div style="margin-top:5px;font-size:14px;font-weight:500;color:#0f172a;line-height:1.6;white-space:pre-wrap;">{note_html}</div>
        </td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:22px 32px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td bgcolor="{hero_from}" style="border-radius:8px;">
          <a href="{link}" style="display:inline-block;padding:12px 22px;font-size:13.5px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">{link_text} →</a>
        </td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:24px 32px 30px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid {theme['footer_border']};font-size:0;line-height:0;">&nbsp;</td></tr></table>
      <p style="margin:16px 0 0;font-size:11.5px;line-height:1.7;color:#94a3b8;">본 메일은 제품 소개 지도 의뢰 시스템에서 자동 발송되었습니다. 이 메일에는 회신하지 마세요.</p>
    </td>
  </tr>
</table>
<!--[if mso]>
</td></tr></table>
<![endif]-->'''


def _build_message(event_type, document, agent=None, recipient_name=None, is_fixed_post_approver=False):
    """이벤트 유형별 제목/본문(HTML)을 생성한다.

    recipient_name 이 주어지면(개인 지정 메일) 제목 맨 앞에 "[{이름}님] "을 붙인다.
    is_fixed_post_approver: agent='RA'이고 그 담당자가 고정 후결자(settings.POST_APPROVER_LOGINID)일
    때만 True — 이 경우에만 "[후결 요청]" 고정 제목을 쓰고, 그 외 RA(추가 후결자)는 다른 단계와
    동일한 제목 규칙을 따른다.
    본문은 히어로 헤더 + KPI 카드형 템플릿(_render_hero_kpi_email)을 공통으로 사용하며,
    히어로/버튼/카드 테두리 색상은 event_type 별 EVENT_THEME 를 따른다.
    """
    use_history = event_type in _HISTORY_LINK_EVENTS
    link = _detail_link(document, use_history)
    link_text = '이력조회에서 확인하기' if use_history else '결재 현황에서 확인하기'
    name_prefix = f'[{recipient_name}님] ' if recipient_name else ''

    if event_type == 'stage_arrival':
        label = AGENT_LABEL.get(agent, agent)
        if agent == 'RA' and is_fixed_post_approver:
            subject = f'[후결 요청] {document.title}'
        else:
            subject = f'{name_prefix}[결재 요청] {document.title}'
        headline = '후결 요청이 도착했습니다.' if agent == 'RA' else f'{label} 단계 결재가 도착했습니다.'
        stage_value = label
    elif event_type == 'rejected':
        subject = f'[반려] {document.title}'
        headline = '요청하신 의뢰서가 반려되었습니다.'
        stage_value = EVENT_STATUS_LABEL[event_type]
    elif event_type == 'approved':
        subject = f'[승인 완료] {document.title}'
        headline = '의뢰서 결재가 모두 완료되었습니다.'
        stage_value = EVENT_STATUS_LABEL[event_type]
    elif event_type == 'notify_submitted':
        subject = f'[상신 통보] {document.title}'
        headline = '아래 의뢰서가 상신되어 통보드립니다. (통보처 수신)'
        stage_value = EVENT_STATUS_LABEL[event_type]
    elif event_type == 'notify_approved':
        subject = f'[결재 완료 통보] {document.title}'
        headline = '아래 의뢰서의 결재가 완료되어 통보드립니다. (통보처 수신)'
        stage_value = EVENT_STATUS_LABEL[event_type]
    elif event_type == 'notify_p_completed':
        subject = f'[P 완료 통보] {document.title}'
        headline = 'P 단계 결재가 완료되어 통보드립니다. (TE_O·TE_J 수신)'
        stage_value = EVENT_STATUS_LABEL[event_type]
    elif event_type == 'revision_requested':
        subject = f'[수정 요청] {document.title}'
        headline = (
            'Validation System 대상/비대상 확인 요청이 도착했습니다. '
            '결재 현황에서 의뢰서를 열어 값을 확인해 주세요.'
        )
        stage_value = EVENT_STATUS_LABEL[event_type]
    else:
        subject = f'[알림] {document.title}'
        headline = '새로운 알림이 있습니다.'
        stage_value = '-'

    submitted_at_str = document.submitted_at.strftime('%Y-%m-%d') if document.submitted_at else '-'
    production_date_str = document.production_date.strftime('%Y-%m-%d') if document.production_date else '-'
    kpi_tiles = [
        ('결재 단계', stage_value),
        ('의뢰자', document.requester_name),
        ('상신일', submitted_at_str),
        ('생산 진행일', production_date_str),
    ]
    note_value = (document.reference_materials or '').strip()

    contents = _render_hero_kpi_email(event_type, headline, document, kpi_tiles, note_value, link, link_text)

    return subject, contents


# --------------------------------------------------------------------------- #
# 큐 적재 (enqueue) — 결재 트랜잭션 안에서 호출
# --------------------------------------------------------------------------- #
def _enqueue(document, event_type, recipients, agent=None, recipient_name=None, is_fixed_post_approver=False):
    """수신자가 있을 때만 MailNotification 행을 적재한다."""
    if not recipients:
        logger.info(
            "[mailer] 수신자가 없어 메일 적재를 건너뜁니다 "
            "(event=%s, doc=%s, agent=%s)", event_type, document.pk, agent
        )
        return None
    subject, contents = _build_message(event_type, document, agent, recipient_name, is_fixed_post_approver)
    noti = MailNotification.objects.create(
        document=document,
        event_type=event_type,
        recipients=recipients,
        subject=subject,
        contents=contents,
    )
    # 하이브리드: 커밋 직후 즉시 1회 발송 시도(거의 실시간). 실패하면 pending 으로
    # 남아 큐 잡(1분 주기)이 최대 max_attempts 회까지 재시도한다.
    noti_id = noti.id
    transaction.on_commit(lambda: _send_now_async(noti_id))
    return noti


def enqueue_stage_arrival(document, agent, step=None, recipient_name=None):
    """단계 도착 알림 적재.

    recipient_name: 개인 지정(담당자/검토자) 메일일 때만 넘긴다 — 제목 맨 앞에 "[이름님]" 표시용.
    팀 전원 브로드캐스트(무배정 도착)에는 넘기지 않는다(수신자가 여럿이라 개인화 불가).
    agent='RA'인 경우 step.assignee가 고정 후결자(settings.POST_APPROVER_LOGINID)인지 여기서
    직접 판별해 제목 분기에 사용한다(호출부는 recipient_name만 넘기면 된다).
    """
    recipients = resolve_stage_recipients(document, agent, step)
    is_fixed = agent == 'RA' and _is_fixed_post_approver(step)
    return _enqueue(
        document, 'stage_arrival', recipients,
        agent=agent, recipient_name=recipient_name, is_fixed_post_approver=is_fixed,
    )


def enqueue_rejected(document):
    """반려 알림 적재."""
    recipients = resolve_reject_recipients(document)
    return _enqueue(document, 'rejected', recipients)


def enqueue_revision_requested(document):
    """MASK(E/EV) 수정 요청 알림 적재.

    반려와 달리 결재 상태를 되돌리지 않는다 — 상신자에게 확인을 요청하는 알림일 뿐이다.
    """
    recipients = resolve_revision_request_recipients(document)
    return _enqueue(document, 'revision_requested', recipients)


def enqueue_approved(document):
    """승인 완료 알림 적재."""
    recipients = resolve_approved_recipients(document)
    return _enqueue(document, 'approved', recipients)


def enqueue_notify_submitted(document):
    """상신 시 통보처 알림 적재(결재 권한 없는 통보 수신자 대상)."""
    recipients = resolve_notifier_recipients(document)
    return _enqueue(document, 'notify_submitted', recipients)


def enqueue_notify_approved(document):
    """결재 완료 시 통보처 알림 적재(결재 권한 없는 통보 수신자 대상)."""
    recipients = resolve_notifier_recipients(document)
    return _enqueue(document, 'notify_approved', recipients)


def enqueue_notify_p_completed(document):
    """P 단계 완료 통보 적재(TE_O + TE_J 팀 전원 대상, 결재 권한과 무관한 참고 통보).

    TE_J 는 예전에 P 단계 '도착' 시점에 notify_p_arrival 로 참고 통보를 받았다. J 가 R 합의
    시점부터 독립 병렬 단계가 되면서 TE_J 는 stage_arrival(J) 결재 요청 메일을 직접 받게 돼
    도착 통보가 중복이 됐고, 대신 P 진행 상황을 알 수 있도록 이 완료 통보에 합류시켰다.
    """
    # _apply_redirect 가 빈 주소 제거 + 중복 제거(순서 보존)까지 하므로 두 팀을 그대로 이어 붙인다.
    recipients = _apply_redirect(_team_emails('O') + _team_emails('J'))
    return _enqueue(document, 'notify_p_completed', recipients)


# --------------------------------------------------------------------------- #
# VOC 알림
# --------------------------------------------------------------------------- #
def _resolve_voc_master_recipients():
    """VOC 등록 알림 수신자: settings.VOC_MASTER_EMAIL (고정 주소)."""
    raw = getattr(settings, 'VOC_MASTER_EMAIL', '') or ''
    recipients = [addr.strip() for addr in raw.split(',') if addr.strip()]
    return _apply_redirect(recipients)


def _resolve_voc_comment_recipients(voc, commenter_email):
    """VOC 댓글 알림 수신자: 제출자 + 기존 댓글 작성자 집합 - 본인."""
    emails = set()
    if voc.submitter_email:
        emails.add(voc.submitter_email.strip())
    for comment in voc.comments.all():
        if comment.author_email:
            emails.add(comment.author_email.strip())
    emails.discard((commenter_email or '').strip())
    return _apply_redirect(list(emails))


def _build_voc_message(event_type, voc, commenter_name=None):
    """VOC 이벤트 유형별 제목/본문(HTML)을 생성한다."""
    link = _voc_link(voc.id)
    link_html = f'<p><a href="{link}">VOC 상세에서 확인하기</a></p>'
    base_info = (
        f'<p>제목: {voc.title}</p>'
        f'<p>작성자: {voc.submitter_name}</p>'
    )

    if event_type == 'voc_created':
        subject = f'[VOC 등록] {voc.title}'
        contents = (
            '<p>새로운 VOC가 등록되었습니다.</p>'
            f'{base_info}{link_html}'
        )
    else:
        subject = f'[VOC 댓글] {voc.title}'
        contents = (
            f'<p>{commenter_name or "누군가"}님이 댓글을 남겼습니다.</p>'
            f'{base_info}{link_html}'
        )
    return subject, contents


def _enqueue_voc(voc, event_type, recipients, commenter_name=None):
    """VOC 알림용 MailNotification 적재 (document=None)."""
    if not recipients:
        logger.info(
            "[mailer] 수신자가 없어 VOC 메일 적재를 건너뜁니다 (event=%s, voc=%s)",
            event_type, voc.pk,
        )
        return None
    subject, contents = _build_voc_message(event_type, voc, commenter_name)
    from .models import MailNotification
    noti = MailNotification.objects.create(
        document=None,
        event_type=event_type,
        recipients=recipients,
        subject=subject,
        contents=contents,
    )
    noti_id = noti.id
    transaction.on_commit(lambda: _send_now_async(noti_id))
    return noti


def enqueue_voc_created(voc):
    """VOC 신규 등록 알림 적재."""
    recipients = _resolve_voc_master_recipients()
    return _enqueue_voc(voc, 'voc_created', recipients)


def enqueue_voc_comment(voc, commenter_email, commenter_name=None):
    """VOC 댓글 등록 알림 적재."""
    recipients = _resolve_voc_comment_recipients(voc, commenter_email)
    return _enqueue_voc(voc, 'voc_comment', recipients, commenter_name=commenter_name)


# --------------------------------------------------------------------------- #
# 발송 (APScheduler 잡 / 관리 명령에서 호출)
# --------------------------------------------------------------------------- #
def _send_via_dxhub(recipients, subject, contents):
    """DXHUB 메일 API 로 발송한다. 실패 시 예외를 발생시킨다."""
    url = getattr(settings, 'DXHUB_MAIL_URL', '') or ''
    api_key = getattr(settings, 'DXHUB_API_KEY', '') or ''
    if not url or not api_key:
        raise RuntimeError('DXHUB_MAIL_URL/DXHUB_API_KEY 가 설정되지 않았습니다.')

    resp = requests.post(
        f"{url.rstrip('/')}/api/public/gateway/mail/send",
        headers={'X-API-Key': api_key},
        json={
            'to': recipients,
            'subject': subject,
            'contents': contents,
        },
        verify=False,
        timeout=DXHUB_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def _process_one(noti_id):
    """단일 알림을 행 락으로 점유한 뒤 발송/재시도 처리한다."""
    with transaction.atomic():
        noti = (
            MailNotification.objects.select_for_update(skip_locked=True)
            .filter(id=noti_id, status='pending')
            .first()
        )
        if noti is None or noti.attempts >= noti.max_attempts:
            return
        try:
            _send_via_dxhub(noti.recipients, noti.subject, noti.contents)
        except Exception as e:  # noqa: BLE001 — 모든 발송 실패를 재시도 대상으로 처리
            noti.attempts += 1
            noti.last_error = str(e)[:2000]
            if noti.attempts >= noti.max_attempts:
                noti.status = 'failed'
                logger.error(
                    "[mailer] 메일 발송 최종 실패 (id=%s, attempts=%s): %s",
                    noti.id, noti.attempts, e
                )
            else:
                logger.warning(
                    "[mailer] 메일 발송 실패, 재시도 예정 (id=%s, attempts=%s): %s",
                    noti.id, noti.attempts, e
                )
            noti.save()
            return
        noti.status = 'sent'
        noti.sent_at = timezone.now()
        noti.last_error = ''
        noti.save()
        logger.info("[mailer] 메일 발송 완료 (id=%s, to=%s)", noti.id, noti.recipients)


def process_mail_queue():
    """pending 상태의 알림을 모두 발송 시도한다 (재시도 5회까지)."""
    pending_ids = list(
        MailNotification.objects.filter(status='pending')
        .values_list('id', flat=True)
    )
    for noti_id in pending_ids:
        try:
            _process_one(noti_id)
        except Exception as e:  # noqa: BLE001 — 한 건 실패가 전체 처리를 막지 않도록
            logger.error("[mailer] 큐 처리 중 예외 (id=%s): %s", noti_id, e)


def _run_immediate(noti_id):
    """별도 스레드에서 단일 알림을 즉시 발송 처리하고 DB 커넥션을 정리한다."""
    try:
        _process_one(noti_id)
    except Exception as e:  # noqa: BLE001 — 즉시 발송 실패는 큐 잡이 재시도한다
        logger.error("[mailer] 즉시 발송 처리 실패 (id=%s): %s", noti_id, e)
    finally:
        # 스레드 전용 DB 커넥션 누수 방지
        connection.close()


def _send_now_async(noti_id):
    """커밋 직후 호출되어 즉시 1회 발송을 데몬 스레드에 위임한다.

    on_commit 콜백에서 실행되므로 **절대 예외를 전파하지 않는다**
    (이미 커밋된 결재 응답을 깨뜨리지 않기 위함).
    """
    try:
        threading.Thread(target=_run_immediate, args=(noti_id,), daemon=True).start()
    except Exception as e:  # noqa: BLE001 — 스레드 생성 실패해도 큐 잡이 재시도한다
        logger.error("[mailer] 즉시 발송 스레드 생성 실패 (id=%s): %s", noti_id, e)
