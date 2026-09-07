"""POP3 완료 알림 메일 → MAP 목적 'NEW' 요청서 매칭

개요
----
운영팀 메일함(POP3)에 도착하는 '[Smart] ... 완료 알림' 메일 제목을 10 분 주기로 조회해,
결재현황에 떠 있는(상신됨/검토중/중단) MAP 목적 'NEW' 요청서 중 product_name 이 그 제목에
포함된 문서를 찾아 `RequestDocument.mail_completion_matched` 를 True 로 표시한다.
한 번 True 가 된 문서는 다시 확인하지 않는다.

두 단계로 분리한다(`fetch_completion_mail_subjects` 는 외부 POP3 I/O라 테스트에서 mock 이
필요하고, `match_map_completion_mail` 은 순수 DB 로직이라 그대로 단위 테스트할 수 있다).
매 주기 메일함 전체를 재조회하며(단순함 우선), 본문은 필요 없으므로 TOP 명령으로 헤더만
받는다. 상세는 docs/MAP_COMPLETION_MAIL.md 참고.
"""
import logging
import os
import poplib
from email import message_from_bytes
from email.header import decode_header, make_header

from .models import RequestDocument

logger = logging.getLogger(__name__)

SUBJECT_PREFIX = '[Smart]'
SUBJECT_KEYWORD = '완료 알림'

# 결재현황(ApprovalPage)에서 approved 를 제외하고 보여주는 상태 중, 상신된(진행 중) 문서만
# 대상으로 한다 — draft(임시저장)·rejected(반려)는 제외.
TARGET_STATUSES = ['submitted', 'under_review', 'pause']


def _decode_subject(raw_subject: str) -> str:
    return str(make_header(decode_header(raw_subject or '')))


def fetch_completion_mail_subjects() -> list:
    """POP3 메일함을 조회해 '[Smart] ... 완료 알림' 제목만 반환한다.

    본문·첨부는 필요 없으므로 `TOP <n> 0` 으로 헤더만 받아온다. 접속 정보가 없거나
    접속에 실패하면 빈 리스트를 반환하고 경고만 남긴다(스케줄러 주기를 건너뛴다).
    """
    host = os.environ.get('MAIL_POP3_HOST', '')
    user = os.environ.get('MAIL_POP3_USER', '')
    password = os.environ.get('MAIL_POP3_PASSWORD', '')
    if not host or not user or not password:
        logger.warning('[POP3] MAIL_POP3_HOST/USER/PASSWORD 가 .env 에 설정되지 않았습니다')
        return []

    server = None
    try:
        server = poplib.POP3_SSL(host)
        server.user(user)
        server.pass_(password)
        mail_count = server.stat()[0]

        subjects = []
        for i in range(1, mail_count + 1):
            header_lines = server.top(i, 0)[1]
            raw_mail = b'\n'.join(header_lines)
            message = message_from_bytes(raw_mail)
            subject = _decode_subject(message.get('Subject'))
            if subject.startswith(SUBJECT_PREFIX) and SUBJECT_KEYWORD in subject:
                subjects.append(subject)
        return subjects
    except Exception:
        logger.error('[POP3] 완료 알림 메일 조회 실패', exc_info=True)
        return []
    finally:
        if server is not None:
            try:
                server.quit()
            except Exception:
                pass


def match_map_completion_mail(subjects: list) -> int:
    """필터링된 메일 제목 목록을 대상 문서의 product_name 과 매칭해 플래그를 세운다.

    반환값은 새로 매칭되어 플래그가 세워진 문서 수(로그용).
    """
    if not subjects:
        return 0

    candidates = RequestDocument.objects.filter(
        status__in=TARGET_STATUSES,
        mail_completion_matched=False,
    ).exclude(product_name='')

    matched_count = 0
    for doc in candidates:
        if not doc.is_map_type_new():
            continue
        if any(doc.product_name in subject for subject in subjects):
            doc.mail_completion_matched = True
            doc.save(update_fields=['mail_completion_matched'])
            matched_count += 1
            logger.info(
                '[POP3] 완료 메일 매칭: doc=%s product_name=%r', doc.id, doc.product_name
            )
    return matched_count


def check_map_completion_mail():
    """스케줄러 잡 진입점 — 10 분 주기로 등록된다(scheduler.py)."""
    subjects = fetch_completion_mail_subjects()
    if not subjects:
        return
    matched = match_map_completion_mail(subjects)
    if matched:
        logger.info('[POP3] 이번 주기 %d건 매칭 완료', matched)
