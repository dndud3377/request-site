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
- RA(후결자): 병렬 진행 시작 시 각 후결자에게 개별 발송("[후결 요청]" 제목)
- P: 담당자 지정 시 그 1명, 미지정 시 TE_P 권한 보유 전원
- J: 담당자(claim) 지정 시 그 1명, 미지정(도착 시점)이면 고정 주소
- O/E: 해당 역할(TE_O/TE_E) 팀 전원
- 반려: 요청서 작성자 + 현재 회차에서 이미 합의했던 전원(중복 제거)
- 승인 완료: 현재 회차 결재 경로에 참여했던 전원(중복 제거)
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

# 담당자 미지정 시 단계별 고정 수신 주소 (담당 팀 1명 대표 주소)
#
# [수신자 변경 방법]
#   아래 딕셔너리의 이메일 문자열을 직접 수정한다(수정 후 백엔드 재시작 필요).
#   R/J 단계만 여기서 관리한다.
#   P 단계는 "라인별"로 주소가 달라지므로 여기 두지 않고,
#   settings 의 P_LINE_FALLBACK(.env 환경변수)에서 관리한다.
UNASSIGNED_FALLBACK = {
    'J': 'user_J@company.com',
}

# 단계 도착 시 팀 전원에게 보내는 단계 (담당자 지정 개념이 없는 병렬 단계 + 미배정 R)
TEAM_BROADCAST_AGENTS = ('O', 'E')

# 메일 본문 표기용 단계 라벨 (마스킹된 비즈니스 용어 대신 코드 사용)
AGENT_LABEL = {
    'PL': 'PL 검토',
    'R': 'R',
    'RV': '검토자',
    'P': 'P',
    'J': 'J',
    'O': 'O',
    'E': 'E',
    'RA': '후결자',
}


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


def _split_emails(value):
    """콤마로 구분된 이메일 문자열을 리스트로 분할한다(공백/빈값 제거)."""
    if not value:
        return []
    return [addr.strip() for addr in str(value).split(',') if addr.strip()]


# ---------------------------------------------------------------------------
# [추후 사용 예정] P 단계 담당자 미지정 시 라인별 고정 수신자
# ---------------------------------------------------------------------------
# 라인마다 다른 고정 주소로 발송이 필요해지면 아래 함수를 활성화하고
# resolve_stage_recipients 의 P 분기에서 _team_emails('P') 대신 호출한다.
# 설정은 .env 의 P_LINE_FALLBACK (settings/base.py 주석 참고).
#
# def _p_line_fallback_recipients(document):
#     line_map = getattr(settings, 'P_LINE_FALLBACK', {}) or {}
#     if not line_map:
#         return []
#     line = (document.get_detail().get('detail', {}) or {}).get('line', '')
#     line = (line or '').strip()
#     if line and line in line_map:
#         return _split_emails(line_map[line])
#     # 라인 미매칭/미지정 → 등록된 모든 라인 수신자
#     recipients = []
#     for value in line_map.values():
#         recipients.extend(_split_emails(value))
#     return recipients
# ---------------------------------------------------------------------------


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
        # (라인별 고정 수신자로 전환하려면 위의 주석 처리된 _p_line_fallback_recipients 활용)
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
        else:
            recipients = _team_emails('P')
    elif agent == 'R':
        # R: 담당자 지정 시 그 1명, 미지정(도착 시점) 시 TE_R 권한 보유 전원
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
        else:
            recipients = _team_emails('R')
    elif agent in ('RV', 'RA'):
        # RV(검토자)/RA(후결자): 항상 지정된 그 1명(호출 시점에 이미 assignee 확정)
        recipients = []
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
    else:
        # J: 담당자 지정 시 그 1명, 미지정 시 고정 주소
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
        else:
            fallback = UNASSIGNED_FALLBACK.get(agent)
            recipients = [fallback] if fallback else []
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


def resolve_reject_recipients(document):
    """반려 시 수신자: 요청서 작성자 + 현재 회차에서 이미 합의했던 전원(중복 제거)."""
    emails = []
    if document.requester_email:
        emails.append(document.requester_email)
    for mail in _current_round_step_emails(document, action='approved'):
        if mail not in emails:
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


def _build_message(event_type, document, agent=None, recipient_name=None):
    """이벤트 유형별 제목/본문(HTML)을 생성한다.

    recipient_name 이 주어지면(개인 지정 메일) 제목 맨 앞에 "[{이름}님] "을 붙인다.
    """
    use_history = event_type in _HISTORY_LINK_EVENTS
    link = _detail_link(document, use_history)
    link_text = '이력조회에서 확인하기' if use_history else '결재 현황에서 확인하기'
    link_html = f'<p><a href="{link}">{link_text}</a></p>'
    base_info = (
        f'<p>의뢰서: {document.title}</p>'
        f'<p>의뢰자: {document.requester_name}</p>'
    )
    name_prefix = f'[{recipient_name}님] ' if recipient_name else ''

    if event_type == 'stage_arrival':
        label = AGENT_LABEL.get(agent, agent)
        if agent == 'RA':
            # 후결 요청은 접미(- 라벨) 없이 고정 문구
            subject = f'[후결 요청] {document.title}'
        else:
            subject = f'{name_prefix}[결재 요청] {document.title} - {label}'
        contents = (
            f'<p>{label} 단계 결재가 도착했습니다.</p>'
            f'{base_info}{link_html}'
        )
    elif event_type == 'rejected':
        subject = f'[반려] {document.title}'
        contents = (
            '<p>요청하신 의뢰서가 반려되었습니다.</p>'
            f'{base_info}{link_html}'
        )
    elif event_type == 'approved':
        subject = f'[승인 완료] {document.title}'
        contents = (
            '<p>의뢰서 결재가 모두 완료되었습니다.</p>'
            f'{base_info}{link_html}'
        )
    elif event_type == 'notify_submitted':
        subject = f'[상신 통보] {document.title}'
        contents = (
            '<p>아래 의뢰서가 상신되어 통보드립니다. (통보처 수신)</p>'
            f'{base_info}{link_html}'
        )
    elif event_type == 'notify_approved':
        subject = f'[결재 완료 통보] {document.title}'
        contents = (
            '<p>아래 의뢰서의 결재가 완료되어 통보드립니다. (통보처 수신)</p>'
            f'{base_info}{link_html}'
        )
    else:
        subject = f'[알림] {document.title}'
        contents = f'{base_info}{link_html}'

    return subject, contents


# --------------------------------------------------------------------------- #
# 큐 적재 (enqueue) — 결재 트랜잭션 안에서 호출
# --------------------------------------------------------------------------- #
def _enqueue(document, event_type, recipients, agent=None, recipient_name=None):
    """수신자가 있을 때만 MailNotification 행을 적재한다."""
    if not recipients:
        logger.info(
            "[mailer] 수신자가 없어 메일 적재를 건너뜁니다 "
            "(event=%s, doc=%s, agent=%s)", event_type, document.pk, agent
        )
        return None
    subject, contents = _build_message(event_type, document, agent, recipient_name)
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
    """
    recipients = resolve_stage_recipients(document, agent, step)
    return _enqueue(document, 'stage_arrival', recipients, agent=agent, recipient_name=recipient_name)


def enqueue_rejected(document):
    """반려 알림 적재."""
    recipients = resolve_reject_recipients(document)
    return _enqueue(document, 'rejected', recipients)


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
