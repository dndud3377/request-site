ARG IMAGE_PATH
FROM ${IMAGE_PATH}nginx:1.25-alpine
COPY nginx.conf /etc/nginx/nginx.conf
# claude 수정 (2026-11-28): 날짜별 접근 로그 폴더를 만드는 기동 스크립트(docs/LOGGING.md)
COPY docker-entrypoint.d/40-log-archive-dir.sh /docker-entrypoint.d/40-log-archive-dir.sh
RUN chmod +x /docker-entrypoint.d/40-log-archive-dir.sh
