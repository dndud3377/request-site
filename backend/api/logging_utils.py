# claude 수정 (2026-11-28): 운영 로그 30일 보관 — 날짜별 파일 핸들러·쓰기 요청 기록 미들웨어·오래된 로그 삭제 추가(docs/LOGGING.md)
"""운영 로그 파일 보관 (docs/LOGGING.md).

- `DailyFileHandler`: `<prefix>-YYYY-MM-DD.log` 날짜별 파일에 이어 쓴다. 파일 이름을 바꾸는(rotate)
  방식이 아니라서 gunicorn 워커 여러 개와 scheduler 컨테이너가 같은 파일에 동시에 써도 서로의
  로그를 덮어쓰지 않는다(표준 `TimedRotatingFileHandler` 는 프로세스마다 따로 rename 해서 로그가 사라진다).
- `RequestLogMiddleware`: 쓰기 요청(POST/PUT/PATCH/DELETE)마다 누가·무엇을·결과를 한 줄로 남긴다.
  요청 본문은 남기지 않는다.
- `delete_old_log_files()`: 파일 이름의 날짜가 `LOG_RETENTION_DAYS` 보다 오래된 로그를 지운다
  (scheduler 일일 잡이 호출).

모두 환경변수 `LOG_DIR` 이 설정된 운영에서만 켜진다(`config/settings/base.py`).
"""
import logging
import os
import re
import time
from datetime import date, datetime, timedelta

LOG_RETENTION_DAYS = 30
DATE_FORMAT = '%Y-%m-%d'
# 정리 대상: `<prefix>-YYYY-MM-DD.log` (Django 의 app/request, nginx 의 access) — 그 밖의 파일은 건드리지 않는다.
DATED_LOG_FILE_RE = re.compile(r'^[A-Za-z0-9_]+-(\d{4}-\d{2}-\d{2})\.log$')
WRITE_METHODS = frozenset({'POST', 'PUT', 'PATCH', 'DELETE'})
REQUEST_LOGGER_NAME = 'api.request_log'
ANONYMOUS_LABEL = '-'

logger = logging.getLogger(__name__)
request_logger = logging.getLogger(REQUEST_LOGGER_NAME)


class DailyFileHandler(logging.FileHandler):
    """로그 레코드의 날짜(로컬 시각)별 파일 `<directory>/<prefix>-YYYY-MM-DD.log` 에 이어 쓴다."""

    def __init__(self, directory, prefix, encoding='utf-8'):
        self.directory = directory
        self.prefix = prefix
        self._current_date = self._date_of(time.time())
        os.makedirs(directory, exist_ok=True)
        super().__init__(self._path_for(self._current_date), mode='a', encoding=encoding, delay=True)

    @staticmethod
    def _date_of(timestamp):
        return time.strftime(DATE_FORMAT, time.localtime(timestamp))

    def _path_for(self, date_str):
        return os.path.join(self.directory, f'{self.prefix}-{date_str}.log')

    def emit(self, record):
        """날짜가 바뀌었으면 새 날짜 파일로 갈아탄 뒤 기록한다 (`Handler.handle` 이 lock 을 잡은 상태로 호출)."""
        record_date = self._date_of(record.created)
        if record_date != self._current_date:
            if self.stream:
                self.stream.close()
                self.stream = None
            self._current_date = record_date
            self.baseFilename = os.path.abspath(self._path_for(record_date))
        super().emit(record)


class RequestLogMiddleware:
    """쓰기 요청 1건당 1줄: `<loginid> <METHOD> <path> <status> <ms>ms`.

    DRF 는 뷰 안에서 인증한 사용자를 원래 HttpRequest.user 에도 넣어 주므로, 응답을 받은 뒤에
    읽으면 JWT·세션 어느 방식이든 실제 요청자를 알 수 있다.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method not in WRITE_METHODS:
            return self.get_response(request)
        started = time.monotonic()
        response = self.get_response(request)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        user = getattr(request, 'user', None)
        loginid = ANONYMOUS_LABEL
        if user is not None and getattr(user, 'is_authenticated', False):
            loginid = getattr(user, 'loginid', '') or ANONYMOUS_LABEL
        request_logger.info(
            '%s %s %s %s %sms',
            loginid, request.method, request.get_full_path(), response.status_code, elapsed_ms,
        )
        return response


def delete_old_log_files(log_dir=None, retention_days=LOG_RETENTION_DAYS, today=None):
    """`log_dir` 아래(하위 폴더 포함) 날짜 로그 중 `retention_days` 일보다 오래된 파일을 지운다.

    날짜는 파일 수정 시각이 아니라 파일 이름의 날짜로 판단한다. `log_dir` 을 주지 않으면
    환경변수 `LOG_DIR` 을 쓰고, 그것도 없으면(개발·테스트) 아무것도 하지 않는다.

    Returns:
        int: 삭제한 파일 수.
    """
    log_dir = log_dir or os.environ.get('LOG_DIR', '')
    if not log_dir or not os.path.isdir(log_dir):
        return 0
    cutoff = (today or date.today()) - timedelta(days=retention_days)
    deleted = 0
    for root, _dirs, files in os.walk(log_dir):
        for name in files:
            match = DATED_LOG_FILE_RE.match(name)
            if not match:
                continue
            try:
                file_date = datetime.strptime(match.group(1), DATE_FORMAT).date()
            except ValueError:
                continue
            if file_date >= cutoff:
                continue
            path = os.path.join(root, name)
            try:
                os.remove(path)
                deleted += 1
            except OSError:
                logger.exception('[LOG_CLEANUP] 로그 파일 삭제 실패: %s', path)
    if deleted:
        logger.info('[LOG_CLEANUP] %s일 지난 로그 파일 %s개 삭제: %s', retention_days, deleted, log_dir)
    return deleted
