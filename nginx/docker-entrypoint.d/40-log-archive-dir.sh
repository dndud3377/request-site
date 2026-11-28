#!/bin/sh
# claude 수정 (2026-11-28): 날짜별 접근 로그 폴더 준비 — nginx 공식 이미지가 기동 전에 root 로 실행한다.
# 날짜 변수가 들어간 access_log 는 워커(nginx 사용자)가 파일을 열므로 폴더에 쓰기 권한이 필요하다(docs/LOGGING.md).
set -e
LOG_ARCHIVE_DIR=/var/log/nginx-archive
mkdir -p "$LOG_ARCHIVE_DIR"
chown nginx:nginx "$LOG_ARCHIVE_DIR"
