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
- PL 검토: 지정 PL 1명
- R/P/J: 담당자(assignee)가 지정돼 있으면 그 1명, 미지정이면 단계별 고정 주소
- O/E: 해당 역할(TE_O/TE_E) 팀 전원
- 반려: 요청서 작성자 1명
- 승인 완료: 작성자가 속한 모든 그룹의 멤버 전원(중복 제거)
- MAIL_REDIRECT_TO 설정 시 위 결과를 무시하고 전원 그 주소로 강제(개발/검증용)
"""
import logging
import threading

import requests
from urllib3.exceptions import InsecureRequestWarning

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from .models import MailNotification, UserProfile

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
UNASSIGNED_FALLBACK = {
    'R': 'user_R@company.com',
    'P': 'user_P@company.com',
    'J': 'user_J@company.com',
}

# 단계 도착 시 팀 전원에게 보내는 단계 (담당자 지정 개념이 없는 병렬 단계)
TEAM_BROADCAST_AGENTS = ('O', 'E')

# 메일 본문 표기용 단계 라벨 (마스킹된 비즈니스 용어 대신 코드 사용)
AGENT_LABEL = {
    'PL': 'PL 검토',
    'R': 'R',
    'P': 'P',
    'J': 'J',
    'O': 'O',
    'E': 'E',
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
    else:
        # R/P/J: 담당자 지정 시 그 1명, 미지정 시 고정 주소
        if step is not None and step.assignee and step.assignee.mail:
            recipients = [step.assignee.mail]
        else:
            fallback = UNASSIGNED_FALLBACK.get(agent)
            recipients = [fallback] if fallback else []
    return _apply_redirect(recipients)


def resolve_reject_recipients(document):
    """반려 시 수신자: 요청서 작성자 1명."""
    recipients = [document.requester_email] if document.requester_email else []
    return _apply_redirect(recipients)


def resolve_approved_recipients(document):
    """승인 완료 시 수신자: 작성자가 속한 모든 그룹의 멤버 전원."""
    requester = document.requester
    if requester is None:
        return _apply_redirect([])
    emails = list(
        UserProfile.objects.filter(member_groups__in=requester.member_groups.all())
        .exclude(mail='')
        .distinct()
        .values_list('mail', flat=True)
    )
    return _apply_redirect(emails)


# --------------------------------------------------------------------------- #
# 메일 본문 생성
# --------------------------------------------------------------------------- #
def _approval_link():
    """메일 본문에 포함할 결재 현황 페이지 주소."""
    base = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')
    return f"{base}/approval"


def _build_message(event_type, document, agent=None):
    """이벤트 유형별 제목/본문(HTML)을 생성한다."""
    link = _approval_link()
    link_html = f'<p><a href="{link}">결재 현황에서 확인하기</a></p>'
    base_info = (
        f'<p>의뢰서: {document.title}</p>'
        f'<p>의뢰자: {document.requester_name}</p>'
    )

    if event_type == 'stage_arrival':
        label = AGENT_LABEL.get(agent, agent)
        subject = f'[결재 요청] {document.title} - {label}'
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
    else:
        subject = f'[알림] {document.title}'
        contents = f'{base_info}{link_html}'

    return subject, contents


# --------------------------------------------------------------------------- #
# 큐 적재 (enqueue) — 결재 트랜잭션 안에서 호출
# --------------------------------------------------------------------------- #
def _enqueue(document, event_type, recipients, agent=None):
    """수신자가 있을 때만 MailNotification 행을 적재한다."""
    if not recipients:
        logger.info(
            "[mailer] 수신자가 없어 메일 적재를 건너뜁니다 "
            "(event=%s, doc=%s, agent=%s)", event_type, document.pk, agent
        )
        return None
    subject, contents = _build_message(event_type, document, agent)
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


def enqueue_stage_arrival(document, agent, step=None):
    """단계 도착 알림 적재."""
    recipients = resolve_stage_recipients(document, agent, step)
    return _enqueue(document, 'stage_arrival', recipients, agent=agent)


def enqueue_rejected(document):
    """반려 알림 적재."""
    recipients = resolve_reject_recipients(document)
    return _enqueue(document, 'rejected', recipients)


def enqueue_approved(document):
    """승인 완료 알림 적재."""
    recipients = resolve_approved_recipients(document)
    return _enqueue(document, 'approved', recipients)


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
