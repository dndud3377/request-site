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
- 라인 수신 설정(mail_lines) 필터: 위에서 산출된 수신자 중, 의뢰서의 라인(detail.line)을
  권한 관리 '이메일 설정'에서 끈 사람을 제외한다(`_filter_by_mail_lines`). '전체 받기'
  (receive_all_mail, 기본값)가 켜져 있으면 라인과 무관하게 전부 받는다. 대상 역할은
  TE_R/P/J/O/E·MASTER 이고 PL·NONE 은 적용받지 않는다. 담당자로 지정된 단계의 결재 요청
  메일도 예외 없이 필터를 탄다. VOC 메일은 라인 개념이 없어 필터 대상이 아니다.
- MAIL_REDIRECT_TO 설정 시 위 결과를 무시하고 전원 그 주소로 강제(개발/검증용)
"""
import logging
import re
import threading
from html import unescape

import requests
from urllib3.exceptions import InsecureRequestWarning

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Max, Q
from django.utils import timezone
from django.utils.html import escape

from .models import VOC, ApprovalStep, MailNotification, UserProfile, ADDRESS_BOOK_MAIL_DOMAIN

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
ROUTE_AGENTS_ONLY_MAP = ('SA', 'R', 'RV', 'RA')
# 'MAP 삭제' 의뢰서는 PL 합의 후 P·R·J·O 를 병렬로 진행한다.
# E(MASK)·EV 와 후결자(RA)는 생성하지 않으므로 경로에서도 빠진다(고정 후결자도 없는 유일한 경로).
ROUTE_AGENTS_MAP_DELETE_EDIT = ('SA', 'P', 'PV', 'R', 'RV', 'J', 'O')
ROUTE_AGENTS_DEFAULT = ('SA', 'R', 'RV', 'P', 'PV', 'J', 'O', 'E', 'EV', 'RA')
# 기타 목적이 'Overlay 변경' 하나뿐인 의뢰서는 일반 경로에서 J 만 빠진다(나머지는 동일).
ROUTE_AGENTS_NO_J = tuple(a for a in ROUTE_AGENTS_DEFAULT if a != 'J')


def route_agents_for(document):
    """의뢰서의 요청 목적에 맞는 결재선(라우팅) 단계 목록을 돌려준다.

    경로 카드 표시와 반려 수신자 산출이 같은 규칙을 쓰도록 여기에 모은다.
    """
    if document.is_map_delete_edit():
        return ROUTE_AGENTS_MAP_DELETE_EDIT
    if document.is_only_map():
        return ROUTE_AGENTS_ONLY_MAP
    if document.skip_j_stage():
        return ROUTE_AGENTS_NO_J
    return ROUTE_AGENTS_DEFAULT

# 메일 본문 '결재 경로' 카드의 표시 순서. 웹 '결재 경로' 탭과 같은 순서를 쓴다
# (검토자 RV/PV/EV 는 담당 단계 바로 뒤, 후결자 RA 는 R 다음).
ROUTE_DISPLAY_ORDER = ('PL', 'SA', 'R', 'RV', 'RA', 'P', 'PV', 'J', 'O', 'E', 'EV')

# 결재 경로 카드의 상태 표기 — (라벨, 글자색, 배경색). 상태 색은 의미를 담고 있어
# 이벤트 테마(EVENT_THEME)와 무관하게 고정한다(웹 결재 경로 탭과 동일 팔레트).
ROUTE_STATUS_STYLE = {
    # (2026-08) 라벨을 웹 결재현황 '현재 단계' 그리드와 맞췄다: 합의→완료, 대기→대기중.
    'approved': ('완료', '#059669', 'rgba(5,150,105,0.1)'),
    'rejected': ('반려', '#dc2626', 'rgba(220,38,38,0.1)'),
    'reviewing': ('검토중', '#d97706', 'rgba(217,119,6,0.1)'),
    'waiting': ('대기중', '#8794a6', 'rgba(107,138,176,0.12)'),
    # (2026-08) 이 의뢰서의 결재 경로에 없는 단계. 예전엔 행 자체를 만들지 않아 "왜 없는지"가
    # 드러나지 않았다. 웹 그리드처럼 행을 남기고 해당없음으로 표시한다.
    'na': ('해당없음', '#adb5bd', 'rgba(107,138,176,0.1)'),
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
    'SA': '영업/기술지원 합의자',
}

# (2026-08) 후결자 행 라벨을 웹 그리드와 맞춘다.
#  - 고정 후결자(settings.POST_APPROVER_LOGINID)는 RFG 팀 1명이라 단계명 R 로 표기한다.
#    ⚠️ 세로 목록인 메일 카드에서는 R(담당자) 행과 라벨이 같아져 'R' 이 두 줄 나온다.
#    웹 그리드에는 일반 경로에 R 담당자 칸이 없어 겹치지 않지만, 메일은 겹친다 —
#    두 화면의 표기를 같게 가져가기로 한 결정에 따른 것이다(담당자 이름으로 구분한다).
#  - PL 이 지정한 추가 후결자는 '추가후결자'.
POST_APPROVER_FIXED_LABEL = 'R'
POST_APPROVER_EXTRA_LABEL = '추가후결자'

# agent 가 없는 이벤트(반려/완료/통보)에서 KPI "결재 단계" 타일에 표시할 상태 문구
EVENT_STATUS_LABEL = {
    'rejected': '반려',
    'approved': '승인 완료',
    'notify_submitted': '상신 통보',
    'notify_approved': '결재 완료 통보',
    'notify_p_completed': 'P 단계 완료 통보',
    'revision_requested': '수정 요청',
    'withdraw_requested': '철회 요청',
    'withdraw_completed': '철회 완료',
    'withdraw_rejected': '철회 거부',
    'withdraw_cancelled': '철회 요청 취소',
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
# 철회 요청/완료: 결재가 멈추거나 문서가 사라지는 알림이라 반려와 같은 주의(레드) 테마
EVENT_THEME['withdraw_requested'] = EVENT_THEME['rejected']
EVENT_THEME['withdraw_completed'] = EVENT_THEME['rejected']
# 철회 거부/취소: 결재가 그대로 이어진다는 정보성 통보라 통보 계열(퍼플) 테마
EVENT_THEME['withdraw_rejected'] = EVENT_THEME['notify_submitted']
EVENT_THEME['withdraw_cancelled'] = EVENT_THEME['notify_submitted']
# VOC 등록: 새 요청이 도착했다는 알림이라 결재 도착과 같은 블루 테마
EVENT_THEME['voc_created'] = EVENT_THEME['stage_arrival']
# VOC 답글: 논의가 진행됐다는 정보성 알림이라 통보 계열(퍼플) 테마
EVENT_THEME['voc_comment'] = EVENT_THEME['notify_submitted']


# --------------------------------------------------------------------------- #
# 수신자 해석
# --------------------------------------------------------------------------- #
def _document_line(document):
    """의뢰서의 라인(detail.line). 값이 없으면 빈 문자열."""
    detail = document.get_detail().get('detail', {}) or {}
    if not isinstance(detail, dict):
        return ''
    return str(detail.get('line') or '').strip()


def _filter_by_mail_lines(recipients, document):
    """수신자 중 이 의뢰서의 라인을 메일 수신 대상에서 뺀 사람을 제외한다.

    - '전체 받기'(receive_all_mail)가 켜진 사람은 라인과 무관하게 그대로 통과한다(기본 상태).
    - 대상 역할은 `UserProfile.MAIL_LINE_FILTER_ROLES`(TE_R/P/J/O/E·MASTER)뿐이다.
      PL·NONE 은 이 설정을 쓰지 않으므로 라인과 무관하게 그대로 통과한다.
    - 의뢰서에 라인 값이 없으면(임시저장 등) 필터가 성립하지 않으므로 그대로 통과시킨다.
    - 한 주소를 여러 사용자가 공유할 수 있으므로, **그 주소로 받아야 할 사람이
      한 명이라도 있으면 제외하지 않는다**(수신 누락 방지).
    """
    line = _document_line(document)
    if not line or not recipients:
        return list(recipients)

    filter_roles = UserProfile.MAIL_LINE_FILTER_ROLES
    # 이 라인을 끈 사람 = 필터 대상 역할 + 전체 받기 해제 + mail_lines 에 이 라인이 없는 사용자
    blocked = set(
        UserProfile.objects.filter(role__in=filter_roles, receive_all_mail=False)
        .exclude(mail='')
        .exclude(mail_lines__name=line)
        .values_list('mail', flat=True)
    )
    if not blocked:
        return list(recipients)
    # 같은 주소를 쓰면서 이 라인을 받아야 하는 사람
    # (전체 받기 사용자 · 필터 비대상 역할 · 이 라인을 켠 사람)
    receiving = set(
        UserProfile.objects.exclude(mail='')
        .filter(Q(receive_all_mail=True) | Q(mail_lines__name=line) | ~Q(role__in=filter_roles))
        .values_list('mail', flat=True)
    )
    blocked -= receiving
    return [addr for addr in recipients if (addr or '').strip() not in blocked]


def _apply_redirect(recipients, document=None):
    """수신자 목록을 정리한다 — 라인 수신 설정 필터 → MAIL_REDIRECT_TO 강제 순.

    document 를 넘기면 그 의뢰서의 라인을 끈 사람을 먼저 제외한다(결재·통보·철회 메일 전부).
    VOC 메일은 라인 개념이 없으므로 document 를 넘기지 않아 필터를 타지 않는다.
    """
    if document is not None and recipients:
        filtered = _filter_by_mail_lines(recipients, document)
        if not filtered:
            # 라인 설정으로 수신자가 전부 빠졌다 — MAIL_REDIRECT_TO 가 있어도 보내지 않는다.
            return []
        recipients = filtered
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
    elif agent in ('RV', 'RA', 'PV', 'EV', 'SA'):
        # RV/PV/EV(검토자)/RA(후결자)/SA(합의자): 항상 지정된 그 1명(호출 시점에 이미 assignee 확정)
        recipients = []
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
    else:
        # 위에서 PL·R·J·P·O·E·RV·PV·EV·RA·SA 를 모두 다루므로 여기 오는 agent 는 없다.
        # 새 단계가 생겼는데 규칙을 안 넣은 경우 — 엉뚱한 곳으로 보내는 대신 발송하지 않는다.
        recipients = []
    return _apply_redirect(recipients, document)


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
        if agent == 'SA':
            # 합의자는 팀이 아니라 지정된 개인이라, 실제 생성된 단계의 담당자만 대상이다
            # (지정하지 않았으면 단계가 없어 아무에게도 보내지 않는다).
            emails.extend(
                m for m in steps.filter(agent='SA')
                .exclude(assignee__isnull=True).exclude(assignee__mail='')
                .values_list('assignee__mail', flat=True) if m
            )
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
    return _apply_redirect([document.requester_email], document)


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
    return _apply_redirect(emails, document)


def resolve_approved_recipients(document):
    """승인 완료 시 수신자: 현재 회차 결재 경로에 참여했던 전원(중복 제거)."""
    return _apply_redirect(_current_round_step_emails(document), document)


def resolve_notifier_recipients(document):
    """통보처 수신자: detail.notifiers 의 loginid 로 이메일 주소를 만든다.

    통보자는 결재 권한이 없고, 상신·결재완료 시점에만 메일 통보를 받는다.
    주소록 관리(AddressBook)에 등록된 loginid는 사이트 로그인 이력(로컬 User
    테이블 존재)과 무관해야 하므로(2026-08), 여기서도 로컬 User 테이블을
    조회하지 않고 {loginid}@ADDRESS_BOOK_MAIL_DOMAIN 규칙으로 생성한다 —
    주소록 관리 화면·상신 모달에 표시되는 이메일과 동일한 값이다.
    라인별 메일 수신 설정 필터(_filter_by_mail_lines, 아래 _apply_redirect 에서 적용)는
    이 주소가 실제 UserProfile.mail 과 일치하는 경우에만(=로컬 계정이 있는 사람만)
    걸러진다 — 로컬 계정이 없는 통보처는 라인 설정 대상이 아니므로 그대로 통과한다.
    """
    detail = document.get_detail().get('detail', {})
    notifiers = detail.get('notifiers', []) if isinstance(detail, dict) else []
    loginids = {
        n.get('loginid') for n in notifiers
        if isinstance(n, dict) and n.get('loginid')
    }
    if not loginids:
        return _apply_redirect([], document)
    emails = [f'{lid}@{ADDRESS_BOOK_MAIL_DOMAIN}' for lid in sorted(loginids)]
    return _apply_redirect(emails, document)


def resolve_withdraw_target_recipients(document, step_ids):
    """철회 요청 확인 대상 단계의 수신자.

    단계마다 "담당자가 배정돼 있으면 그 1명, 미배정이면 그 단계 담당 팀 전원"이다 —
    확인 인가(`views._can_confirm_pause`, 중단 확인과 동일 규칙)와 같은 기준이라,
    실제로 '철회 확인'을 누를 수 있는 사람에게만 메일이 간다.

    ⚠️ 통보처는 여기에 포함하지 않는다(2026-08 결정) — 통보처는 확인 주체가 아니므로
    철회 '완료' 시점에만 통보받는다.
    """
    emails = []
    steps = (
        ApprovalStep.objects.filter(document=document, id__in=list(step_ids or []))
        .select_related('assignee')
    )
    for step in steps:
        if step.assignee and step.assignee.mail:
            emails.append(step.assignee.mail)
        else:
            emails.extend(_stage_team_emails(step.agent))
    return _apply_redirect(emails, document)


def _designated_pl_emails(document):
    """상신 시 지정된 PL 전원의 이메일 = 최종 회차 PL 단계 담당자들.

    PL 단계가 아직 없는(임시저장 등) 문서는 대표 지정 PL(designated_pl)로 보조 판정한다.
    """
    max_round = _current_round(document)
    if max_round is not None:
        emails = list(
            ApprovalStep.objects.filter(document=document, agent='PL', round=max_round)
            .exclude(assignee__isnull=True).exclude(assignee__mail='')
            .values_list('assignee__mail', flat=True).distinct()
        )
        if emails:
            return emails
    if document.designated_pl and document.designated_pl.mail:
        return [document.designated_pl.mail]
    return []


def _reached_stage_emails(document):
    """**실제로 결재가 진행된** 단계의 담당 팀 전원 이메일.

    "진행됐다"의 기준은 단계(ApprovalStep)가 생성됐는지다 — R 단계까지만 열린 문서라면
    TE_R 만 대상이 되고, 아직 열리지 않은 P·J·O·E 팀에는 철회 완료 메일이 가지 않는다.
    회차는 구분하지 않는다(반려 후 재상신된 문서에서 이전 회차에 결재했던 팀도 대상).

    - 검토자(RV/PV/EV)는 담당자와 같은 팀이므로 `_stage_team_emails` 가 환산한다.
    - 후결자(RA)는 역할(팀)이 아니라 지정된 개인이므로 그 담당자 본인만 넣는다.
    - PL 은 팀 브로드캐스트 대상이 아니다(지정 PL 은 `_designated_pl_emails` 로 따로 포함).
    """
    emails = []
    steps = ApprovalStep.objects.filter(document=document).select_related('assignee')
    for step in steps:
        if step.agent == 'PL':
            continue
        if step.agent in ('RA', 'SA'):
            # 후결자(RA)·합의자(SA)는 역할(팀)이 아니라 지정된 개인이다.
            if step.assignee and step.assignee.mail:
                emails.append(step.assignee.mail)
            continue
        emails.extend(_stage_team_emails(step.agent))
    return emails


def resolve_withdraw_completed_recipients(document):
    """철회 완료(문서 삭제) 통보 수신자.

    ① 상신 시 지정된 PL 전원  ② 통보처 전원  ③ 실제로 결재가 진행된 단계의 담당 팀 전원
    ④ 의뢰서 작성자 본인. 중복·빈 주소는 `_apply_redirect` 가 정리한다.

    ⚠️ ③ 은 "TE_R·TE_P·TE_J·TE_O·TE_E 5개 팀 전원"이 아니다(2026-08 결정) —
    R 단계까지만 진행된 의뢰서는 TE_R 에게만 통보된다(`_reached_stage_emails`).
    """
    emails = []
    emails.extend(_designated_pl_emails(document))
    emails.extend(resolve_notifier_recipients(document))
    emails.extend(_reached_stage_emails(document))
    if document.requester_email:
        emails.append(document.requester_email)
    return _apply_redirect(emails, document)


def resolve_withdraw_rejected_recipients(document, withdraw_request):
    """철회 거부 수신자: 철회를 요청한 사람(+ 의뢰서 작성자).

    요청자와 작성자가 다를 수 있어(지정 PL·공유 그룹 멤버가 철회를 요청한 경우) 둘 다 넣는다.
    """
    emails = []
    if withdraw_request.requester_id and withdraw_request.requester.mail:
        emails.append(withdraw_request.requester.mail)
    if document.requester_email:
        emails.append(document.requester_email)
    return _apply_redirect(emails, document)


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

# 딥링크 버튼을 싣지 않는 이벤트 — 발송 시점에 의뢰서가 이미 삭제돼 링크가 죽는다.
_NO_LINK_EVENTS = ('withdraw_completed',)


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
        label = AGENT_LABEL.get(agent, agent)
        # 검토자(RV/PV/EV)는 지정됐을 때만 생기는 선택 단계라, 경로 밖이어도 '해당없음' 행을
        # 만들지 않는다(지정하지 않은 것과 거치지 않는 것을 구분할 수 없다).
        if agent not in route:
            if agent not in REVIEWER_AGENTS:
                rows.append((label, '', 'na', ''))
            continue
        agent_steps = steps_by_agent.get(agent)
        if not agent_steps:
            # SA(합의자)는 PL 과 동시에 만들어지므로, 단계가 없다 = 아무도 지정하지 않았다
            # → '예정'이 아니라 '해당없음'이다(웹 결재현황 그리드와 같은 표기).
            if agent == 'SA':
                rows.append((label, '', 'na', ''))
                continue
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
            row_label = label
            if agent == 'RA':
                row_label = (POST_APPROVER_FIXED_LABEL if _is_fixed_post_approver(s)
                             else POST_APPROVER_EXTRA_LABEL)
            rows.append((row_label, s.assignee_name or '', status, s.comment or ''))
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
    # link 가 없으면 버튼 블록을 통째로 비운다 — 철회 완료 메일은 문서가 이미 삭제돼
    # 딥링크가 죽은 링크가 되므로 버튼을 싣지 않는다.
    button_html = f'''  <tr>
    <td style="padding:22px 32px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td bgcolor="{hero_from}" style="border-radius:8px;">
          <a href="{link}" style="display:inline-block;padding:12px 22px;font-size:13.5px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">{link_text} →</a>
        </td></tr>
      </table>
    </td>
  </tr>
''' if link else ''

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
{button_html}  <tr>
    <td style="padding:24px 32px 30px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid {theme['footer_border']};font-size:0;line-height:0;">&nbsp;</td></tr></table>
      <p style="margin:16px 0 0;font-size:11.5px;line-height:1.7;color:#94a3b8;">본 메일은 제품 소개 지도 의뢰 시스템에서 자동 발송되었습니다. 이 메일에는 회신하지 마세요.</p>
    </td>
  </tr>
</table>
<!--[if mso]>
</td></tr></table>
<![endif]-->'''


def _build_message(event_type, document, agent=None, recipient_name=None, is_fixed_post_approver=False,
                   note_override=None):
    """이벤트 유형별 제목/본문(HTML)을 생성한다.

    recipient_name 이 주어지면(개인 지정 메일) 제목 맨 앞에 "[{이름}님] "을 붙인다.
    note_override: '특이사항' 칸을 의뢰서 참고자료 대신 이 값으로 채운다(철회 사유 등).
    is_fixed_post_approver: agent='RA'이고 그 담당자가 고정 후결자(settings.POST_APPROVER_LOGINID)일
    때만 True — 이 경우에만 "[후결 요청]" 고정 제목을 쓰고, 그 외 RA(추가 후결자)는 다른 단계와
    동일한 제목 규칙을 따른다.
    본문은 히어로 헤더 + KPI 카드형 템플릿(_render_hero_kpi_email)을 공통으로 사용하며,
    히어로/버튼/카드 테두리 색상은 event_type 별 EVENT_THEME 를 따른다.
    """
    use_history = event_type in _HISTORY_LINK_EVENTS
    link = '' if event_type in _NO_LINK_EVENTS else _detail_link(document, use_history)
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
    elif event_type == 'withdraw_requested':
        subject = f'[철회 요청] {document.title}'
        headline = (
            '의뢰서 철회 요청이 도착했습니다. 결재 현황에서 내용을 확인한 뒤 '
            "'철회 확인' 또는 '철회 거부'를 선택해 주세요."
        )
        stage_value = EVENT_STATUS_LABEL[event_type]
    elif event_type == 'withdraw_completed':
        subject = f'[철회 완료] {document.title}'
        headline = '아래 의뢰서가 철회되어 삭제되었습니다. 더 이상 조회할 수 없습니다.'
        stage_value = EVENT_STATUS_LABEL[event_type]
    elif event_type == 'withdraw_rejected':
        subject = f'[철회 거부] {document.title}'
        headline = '요청하신 의뢰서 철회가 거부되었습니다. 결재는 그대로 진행됩니다.'
        stage_value = EVENT_STATUS_LABEL[event_type]
    elif event_type == 'withdraw_cancelled':
        subject = f'[철회 요청 취소] {document.title}'
        headline = '의뢰서 철회 요청이 취소되었습니다. 결재를 그대로 진행해 주세요.'
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
    note_value = (note_override or document.reference_materials or '').strip()

    contents = _render_hero_kpi_email(event_type, headline, document, kpi_tiles, note_value, link, link_text)

    return subject, contents


# --------------------------------------------------------------------------- #
# 큐 적재 (enqueue) — 결재 트랜잭션 안에서 호출
# --------------------------------------------------------------------------- #
def _enqueue(document, event_type, recipients, agent=None, recipient_name=None, is_fixed_post_approver=False,
             note_override=None):
    """수신자가 있을 때만 MailNotification 행을 적재한다."""
    if not recipients:
        logger.info(
            "[mailer] 수신자가 없어 메일 적재를 건너뜁니다 "
            "(event=%s, doc=%s, agent=%s)", event_type, document.pk, agent
        )
        return None
    subject, contents = _build_message(
        event_type, document, agent, recipient_name, is_fixed_post_approver, note_override,
    )
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
    recipients = _apply_redirect(_team_emails('O') + _team_emails('J'), document)
    return _enqueue(document, 'notify_p_completed', recipients)


def enqueue_withdraw_requested(document, withdraw_request):
    """철회 요청 접수 알림 적재 — 확인 대상 단계의 담당자/팀 대상(통보처 제외)."""
    recipients = resolve_withdraw_target_recipients(document, withdraw_request.target_step_ids)
    return _enqueue(
        document, 'withdraw_requested', recipients, note_override=withdraw_request.reason,
    )


def enqueue_withdraw_completed(document, reason=''):
    """철회 완료(문서 삭제) 통보 적재.

    ⚠️ **반드시 `document.delete()` 앞에서 호출**해야 한다 — 본문(결재 경로 카드·수신자)이
    문서와 결재 단계를 읽어 만들어지기 때문이다. 적재된 본문은 HTML 로 굳으므로 문서가
    지워져도 내용은 그대로 남고, `MailNotification.document` FK 만 SET_NULL 로 비워진다.
    """
    recipients = resolve_withdraw_completed_recipients(document)
    return _enqueue(document, 'withdraw_completed', recipients, note_override=reason)


def enqueue_withdraw_rejected(document, withdraw_request):
    """철회 거부 알림 적재 — 철회를 요청한 사람과 의뢰서 작성자 대상."""
    recipients = resolve_withdraw_rejected_recipients(document, withdraw_request)
    return _enqueue(
        document, 'withdraw_rejected', recipients, note_override=withdraw_request.reason,
    )


def enqueue_withdraw_cancelled(document, withdraw_request):
    """철회 요청 취소 알림 적재 — 요청 메일을 받았던 확인 대상 단계 담당자/팀 대상."""
    recipients = resolve_withdraw_target_recipients(document, withdraw_request.target_step_ids)
    return _enqueue(
        document, 'withdraw_cancelled', recipients, note_override=withdraw_request.reason,
    )


# --------------------------------------------------------------------------- #
# VOC 알림
# --------------------------------------------------------------------------- #
# VOC 카테고리/상태 코드 → 메일에 실을 한글 라벨. 모델 choices 와 같은 값을 쓰되
# 메일 문구는 화면 라벨과 어휘를 맞춘다("완료" → "답변완료").
VOC_CATEGORY_LABEL = dict(VOC.CATEGORY_CHOICES)
VOC_STATUS_LABEL = {'checking': '확인중', 'completed': '답변완료'}
VOC_PAGE_LABEL = {
    'request': '의뢰서 작성',
    'approval': '결재 현황',
    'history': '이력 조회',
    'other': '기타',
}

# 제출자에게만 덧붙이는 안내 — 답변 완료 처리는 작성자 본인(또는 MASTER)만 할 수 있다.
VOC_COMPLETE_GUIDE = '답변이 만족스러우셨다면 답변 완료 처리 해주세요.'


def _html_to_text(html):
    """RichTextEditor 가 만든 HTML 을 메일 카드에 실을 평문으로 바꾼다.

    블록/개행 태그는 줄바꿈으로 바꾼 뒤 나머지 태그를 걷어낸다. 반환값은
    _render_voc_email 에서 escape 되므로 여기서는 escape 하지 않는다.
    """
    if not html:
        return ''
    text = re.sub(r'<br\s*/?>', '\n', html, flags=re.IGNORECASE)
    text = re.sub(r'</(p|div|li|h[1-6])>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = unescape(text).replace('\xa0', ' ')
    # 태그 제거 과정에서 생긴 연속 빈 줄을 하나로 줄인다.
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _resolve_voc_master_recipients():
    """VOC 등록 알림 수신자: role='MASTER' 사용자 중 VOC 메일을 켜둔 사람의 메일 주소.

    MASTER 계정이 늘어나도 설정 변경 없이 자동 반영된다. 라인 수신 설정 필터는
    VOC 에 라인 개념이 없어 타지 않는다(_apply_redirect 에 document 를 넘기지 않음).
    개별 MASTER 가 권한 관리 '이메일 설정'의 VOC 토글을 끄면(receive_voc_mail=False)
    제외한다(mail-lines 와 별개 설정).
    """
    emails = list(
        UserProfile.objects.filter(role='MASTER', receive_voc_mail=True)
        .exclude(mail='')
        .exclude(mail__isnull=True)
        .values_list('mail', flat=True)
    )
    return _apply_redirect(emails)


def _voc_submitter_email(voc):
    """VOC 제출자의 메일 주소. FK 가 있으면 계정의 주소를 우선한다.

    submitter_name/submitter_email 은 프론트가 보낸 값이라 개발 모드에서는 실제
    계정 정보와 다를 수 있다. FK 는 서버가 확정하므로 그쪽이 더 정확하다.
    """
    if voc.submitter_id and voc.submitter.mail:
        return voc.submitter.mail.strip()
    return (voc.submitter_email or '').strip()


def _resolve_voc_comment_recipients(voc, commenter_email):
    """VOC 댓글 알림 수신자를 (제출자, 그 외 참여자) 로 나눠 반환한다.

    제출자에게 가는 메일에만 '답변 완료 처리' 안내를 넣어야 해서, 한 통에 모든
    수신자를 담지 않고 본문이 다른 두 통으로 나눈다.
    그 외 참여자 = 기존 댓글 작성자 전원 - 제출자 - 이번 댓글 작성자 본인.
    """
    me = (commenter_email or '').strip()
    submitter_email = _voc_submitter_email(voc)

    others = set()
    for comment in voc.comments.all():
        if comment.author_email:
            others.add(comment.author_email.strip())
    others.discard(submitter_email)
    others.discard(me)

    submitter = [submitter_email] if submitter_email and submitter_email != me else []
    return _apply_redirect(submitter), _apply_redirect(sorted(others))


def _voc_info_grid(voc, theme):
    """VOC 메일 본문의 2x2 정보 타일. 결재 메일의 KPI 그리드와 같은 형식을 쓴다."""
    tiles = [
        ('유형', VOC_CATEGORY_LABEL.get(voc.category, voc.category)),
        ('관련 페이지', VOC_PAGE_LABEL.get(voc.page, voc.page or '-')),
        ('작성자', voc.submitter_name or '-'),
        ('상태', VOC_STATUS_LABEL.get(voc.status, voc.status)),
    ]
    return _kpi_grid(tiles, theme['tile_bg'], theme['tile_border'])


def _render_voc_email(event_type, headline, voc, body_text, guide_text, link):
    """VOC 알림용 히어로 헤더 + 카드형 본문(HTML).

    결재 알림(_render_hero_kpi_email)과 같은 디자인 언어를 쓰되, 그 함수는
    의뢰서와 결재 경로 카드를 필수로 요구해 VOC 에는 재사용할 수 없어 별도로 둔다.
    voc.title / body_text 는 사용자 입력이므로 escape 한다.
    """
    theme = EVENT_THEME.get(event_type, EVENT_THEME['stage_arrival'])
    hero_from, hero_to = theme['hero']
    info_html = _voc_info_grid(voc, theme)

    guide_html = f'''      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
        <tr><td style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;">
          <div style="font-size:13.5px;font-weight:600;color:#92400e;line-height:1.6;">{escape(guide_text)}</div>
        </td></tr>
      </table>
''' if guide_text else ''

    return f'''<!--[if mso]>
<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0"><tr><td>
<![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="width:100%;max-width:600px;margin:0 auto;background:{theme['outer_bg']};border-radius:14px;overflow:hidden;border:1px solid {theme['outer_border']};">
  <tr>
    <td bgcolor="{hero_from}" style="background:linear-gradient(135deg,{hero_from} 0%,{hero_to} 100%);padding:30px 32px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="font-size:12px;font-weight:700;letter-spacing:.06em;color:rgba(255,255,255,.75);text-transform:uppercase;">제품 소개 지도 의뢰 시스템 · VOC</td></tr>
        <tr><td style="padding-top:12px;font-size:19px;line-height:1.45;font-weight:700;color:#ffffff;">{escape(headline)}</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 32px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid {theme['outer_border']};border-radius:12px;">
        <tr><td style="padding:18px 18px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td>
              <div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;color:{theme['label_color']};text-transform:uppercase;">VOC 제목</div>
              <div style="margin-top:6px;font-size:17px;font-weight:700;color:#0f172a;line-height:1.5;">{escape(voc.title)}</div>
            </td></tr>
          </table>
          {info_html}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
        <tr><td style="background:#ffffff;border:1px solid {theme['outer_border']};border-radius:10px;padding:14px 16px;">
          <div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;color:{theme['note_label_color']};text-transform:uppercase;">내용</div>
          <div style="margin-top:5px;font-size:14px;font-weight:500;color:#0f172a;line-height:1.6;white-space:pre-wrap;">{escape(body_text) or '-'}</div>
        </td></tr>
      </table>
{guide_html}    </td>
  </tr>
  <tr>
    <td style="padding:22px 32px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td bgcolor="{hero_from}" style="border-radius:8px;">
          <a href="{link}" style="display:inline-block;padding:12px 22px;font-size:13.5px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">VOC 상세에서 확인하기 →</a>
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


def _latest_comment_text(voc):
    """가장 최근 댓글 본문(HTML → 평문). 없으면 빈 문자열.

    댓글 입력이 RichTextEditor 로 HTML 을 만들므로, voc.content 와 동일하게
    _html_to_text 로 태그를 걷어낸 뒤 메일 본문에 싣는다.
    """
    comment = voc.comments.order_by('-created_at', '-id').first()
    return _html_to_text(comment.content) if comment else ''


def _build_voc_message(event_type, voc, commenter_name=None, for_submitter=False):
    """VOC 이벤트 유형별 제목/본문(HTML)을 생성한다.

    for_submitter=True 면 제출자용 메일이라 '답변 완료 처리' 안내를 함께 싣는다.
    """
    link = _voc_link(voc.id)
    guide_text = VOC_COMPLETE_GUIDE if for_submitter else ''

    if event_type == 'voc_created':
        subject = f'[VOC 등록] {voc.title}'
        headline = '새로운 VOC가 등록되었습니다.'
        body_text = _html_to_text(voc.content)
    else:
        writer = commenter_name or '누군가'
        subject = f'[VOC 답글] {voc.title}'
        headline = f'{writer}님이 답글을 남겼습니다.'
        body_text = _latest_comment_text(voc)

    contents = _render_voc_email(event_type, headline, voc, body_text, guide_text, link)
    return subject, contents


def _enqueue_voc(voc, event_type, recipients, commenter_name=None, for_submitter=False):
    """VOC 알림용 MailNotification 적재 (document=None)."""
    if not recipients:
        logger.info(
            "[mailer] 수신자가 없어 VOC 메일 적재를 건너뜁니다 (event=%s, voc=%s)",
            event_type, voc.pk,
        )
        return None
    subject, contents = _build_voc_message(
        event_type, voc, commenter_name, for_submitter=for_submitter,
    )
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
    """VOC 신규 등록 알림 적재 — MASTER 전원 수신."""
    recipients = _resolve_voc_master_recipients()
    return _enqueue_voc(voc, 'voc_created', recipients)


def enqueue_voc_comment(voc, commenter_email, commenter_name=None):
    """VOC 답글 등록 알림 적재.

    제출자와 그 외 참여자에게 본문이 다른 두 통을 보낸다 — 제출자 메일에만
    '답변 완료 처리' 안내가 들어간다. (제출자용, 그 외용) 튜플을 반환한다.
    """
    submitter_recipients, other_recipients = _resolve_voc_comment_recipients(voc, commenter_email)
    to_submitter = _enqueue_voc(
        voc, 'voc_comment', submitter_recipients,
        commenter_name=commenter_name, for_submitter=True,
    )
    to_others = _enqueue_voc(
        voc, 'voc_comment', other_recipients, commenter_name=commenter_name,
    )
    return to_submitter, to_others


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
