#!/bin/sh
# claude 수정 (2026-11-22): 개발 서버 접근 제한 — .env.dev 의 DEV_ALLOWED_IPS 로 nginx 허용 목록을 만든 뒤 nginx 를 띄운다.
#
# - 허용 목록에 없는 출발 주소($remote_addr)는 모든 경로(/, /api/, /admin/, /media/)에서 403.
# - 단일 IPv4 만 받는다. 값이 비었거나 형식이 틀리면(대역 표기·0.0.0.0·중복·빈 항목 포함)
#   nginx 를 띄우지 않는다(fail-closed) — 오타 하나로 전원에게 열리는 것보다 아무도 못 들어오는 쪽이 낫다.
# - 목록을 바꾼 뒤 반영(restart 로는 .env.dev 를 다시 읽지 않는다):
#     docker compose -f docker-compose.dev.yml up -d nginx
#
# 사용: docker-compose.dev.yml 의 nginx entrypoint. 인자로 받은 명령(nginx -g 'daemon off;')을 마지막에 exec 한다.
set -eu
set -f  # 입력값의 * ? 등이 파일 이름으로 펼쳐지지 않게 glob 확장을 끈다

ALLOWLIST_FILE=/etc/nginx/dev_allowed_ips.conf
LOG_PREFIX='[dev-allowlist]'
IPV4_OCTET_COUNT=4
IPV4_OCTET_MAX=255
IPV4_OCTET_MAX_DIGITS=3
FORBIDDEN_IP='0.0.0.0'

fail() {
    echo "$LOG_PREFIX 기동 거부: $1" >&2
    echo "$LOG_PREFIX .env.dev 의 DEV_ALLOWED_IPS 를 고친 뒤 'docker compose -f docker-compose.dev.yml up -d nginx' 로 다시 띄우세요." >&2
    exit 1
}

# 단일 IPv4(앞자리 0 없는 0~255 네 칸)인지 확인한다.
is_valid_ipv4() {
    case "$1" in
        *[!0-9.]* | .* | *. | *..*) return 1 ;;
    esac
    old_ifs=$IFS
    IFS=.
    # shellcheck disable=SC2086  # 숫자·점만 남은 값이라 glob 확장 위험이 없다
    set -- $1
    IFS=$old_ifs
    [ "$#" -eq "$IPV4_OCTET_COUNT" ] || return 1
    for octet in "$@"; do
        [ "${#octet}" -le "$IPV4_OCTET_MAX_DIGITS" ] || return 1
        case "$octet" in
            0?*) return 1 ;;  # 010 같은 앞자리 0 은 해석이 모호하므로 거부
        esac
        [ "$octet" -le "$IPV4_OCTET_MAX" ] || return 1
    done
    return 0
}

[ "$#" -gt 0 ] || fail '실행할 명령이 없습니다(예: nginx -g "daemon off;").'

# 공백·탭·CR 은 무시한다(Windows 에서 편집한 .env.dev 대비).
raw=$(printf '%s' "${DEV_ALLOWED_IPS:-}" | tr -d ' \t\r')

[ -n "$raw" ] || fail 'DEV_ALLOWED_IPS 가 비어 있습니다. 허용할 PC IP를 쉼표로 구분해 넣으세요 (예: DEV_ALLOWED_IPS=10.1.2.3,10.1.2.4).'

case "$raw" in
    ,* | *, | *,,*) fail "빈 항목이 있습니다(쉼표 앞뒤를 확인하세요): $raw" ;;
esac

seen=' '
for ip in $(printf '%s' "$raw" | tr ',' ' '); do
    case "$ip" in
        */*) fail "대역 표기는 허용하지 않습니다 — PC 한 대의 IP만 넣으세요: $ip" ;;
    esac
    [ "$ip" != "$FORBIDDEN_IP" ] || fail "$FORBIDDEN_IP 은 허용 목록에 넣을 수 없습니다."
    is_valid_ipv4 "$ip" || fail "IPv4 형식이 아닙니다: $ip"
    case "$seen" in
        *" $ip "*) fail "중복된 IP가 있습니다: $ip" ;;
    esac
    seen="$seen$ip "
done

tmp_file="$ALLOWLIST_FILE.tmp"
{
    echo '# 자동 생성(nginx/dev-allowlist.sh) — 직접 수정하지 않는다. .env.dev 의 DEV_ALLOWED_IPS 를 고친다.'
    for ip in $seen; do
        echo "allow $ip;"
    done
    echo 'deny all;'
} > "$tmp_file"
mv "$tmp_file" "$ALLOWLIST_FILE"

count=0
for ip in $seen; do
    count=$((count + 1))
    echo "$LOG_PREFIX 허용: $ip"
done
echo "$LOG_PREFIX 허용 IP ${count}개 적용 — 그 외 출발 주소는 403"

exec "$@"
