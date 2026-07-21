# EXTERNAL_API — 외부 API Key 읽기 전용 연동

> 작성일: 2026-07-20
> 목적: 로그인 계정 없이 고정 API Key만으로 `RequestDocument`(의뢰서) 데이터를 외부에서 읽어갈 수 있도록 제공하는 별도 엔드포인트.
> 내부 사용자용 `/api/documents/*`(결재 액션 포함)와는 완전히 분리된 read-only 전용 경로다.

- 백엔드: `backend/api/authentication.py` (`ExternalApiKeyAuthentication`), `backend/api/views.py` (`HasExternalApiKey`, `ExternalRequestDocumentViewSet`), `backend/api/serializers.py` (`ExternalRequestDocumentSerializer`)
- 라우트 등록: `backend/api/urls.py`
- 설정: `backend/config/settings/base.py`(`EXTERNAL_API_KEY`), `.env` / `.env.dev`

---

## 1. 키 설정 방법

`.env`(운영) 또는 `.env.dev`(개발) 파일에 아래 값을 직접 채워 넣는다(`.env`는 AI가 수정하지 않는 파일 — 사용자가 직접 값을 지정).

```bash
# 랜덤 키 생성 예시
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

```env
EXTERNAL_API_KEY=<위에서 생성한 값>
```

값을 넣거나 바꾼 뒤에는 backend 컨테이너 재시작이 필요하다(`load_dotenv()`가 프로세스 시작 시 1회만 로드).

키를 비워두면(`EXTERNAL_API_KEY=`) 외부 엔드포인트는 **어떤 키를 보내도 401**을 반환한다(빈 문자열과는 비교하지 않음, `authentication.py`의 `if not expected or ...` 가드).

---

## 2. 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/external/v1/documents/` | 의뢰서 목록 (전체 상태: draft 포함) |
| GET | `/api/external/v1/documents/{id}/` | 의뢰서 상세 |

- **읽기 전용**: `ReadOnlyModelViewSet` 기반이라 POST/PUT/PATCH/DELETE 라우트 자체가 존재하지 않는다(호출 시 `405 Method Not Allowed`).
- **필터/검색/정렬**: 내부 `/api/documents/`와 동일한 파라미터 지원.
  - `?status=approved` / `?product_name=...` (filterset)
  - `?search=키워드` (title/product_name/requester_name/requester_department 대상)
  - `?ordering=created_at` / `?ordering=-submitted_at`
- **이 엔드포인트 전용 추가 파라미터** (둘 다 옵트인 — 미지정 시 기존과 동일하게 동작):
  - `?p_approved=true` : 결재 **회차(round) 상관없이** P단계가 한 번이라도 합의(`approved`)된 적 있는 문서만 반환. 반려 후 재상신되어 최신 회차의 P단계가 아직 `pending`이어도, 과거 회차에서 합의된 적 있으면 포함된다. `true`/`false` 외 값은 `400`.
  - `?fields=product_name,additional_notes` : 응답에 담을 필드를 직접 선택(콤마 구분). 허용되지 않는 필드명이 있으면 `400`(에러 메시지에 허용 필드 전체 목록 포함). 미지정 시 전체 필드 반환(기존과 동일).
- **페이지네이션 없음**: 전체 목록을 한 번에 반환(내부 `/api/documents/`와 동일 컨벤션).

### 요청 헤더

```
X-API-Key: <EXTERNAL_API_KEY 값>
```

### 응답 예시 (목록)

```json
[
  {
    "id": 123,
    "title": "의뢰서 제목",
    "requester_name": "홍길동",
    "requester_email": "hong@company.com",
    "requester_department": "개발팀",
    "requester_loginid": "hong123",
    "product_name": "PROD-A",
    "reference_materials": "",
    "additional_notes": "{\"detail\": {...}, \"jayerRows\": [...], \"oayerRows\": [...], \"bbRows\": [...]}",
    "status": "approved",
    "production_date": "2026-07-01",
    "created_at": "2026-06-20T01:23:45Z",
    "updated_at": "2026-06-25T04:00:00Z",
    "submitted_at": "2026-06-21T00:00:00Z",
    "designated_pl_loginid": "pl001",
    "designated_pl_name": "김검토",
    "approval_steps": [ /* ApprovalStepSerializer 배열 */ ]
  }
]
```

`additional_notes`는 위저드(RequestPage)에서 입력된 상세 폼 데이터가 그대로 담긴 JSON **문자열**이다. 외부에서 파싱할 때는 `json.loads()` 등으로 재파싱해야 한다(`RequestDocument.get_detail()`과 동일한 구조).

### 오류 응답

| 상황 | 상태 코드 |
|---|---|
| `X-API-Key` 헤더 없음 | `401 Unauthorized` |
| `X-API-Key` 값이 서버 설정과 불일치 | `401 Unauthorized` |
| `EXTERNAL_API_KEY` 서버에 미설정(빈 값) | 어떤 키를 보내도 `401` |
| 쓰기 메서드(POST 등) 호출 | `405 Method Not Allowed` |
| `p_approved` 값이 `true`/`false`가 아님 | `400 Bad Request` |
| `fields`에 존재하지 않는 필드명 포함 | `400 Bad Request` (허용 필드 목록 안내) |

---

## 3. 사용 예시

```bash
# 목록 조회
curl -H "X-API-Key: <키>" https://<서버주소>/api/external/v1/documents/

# 승인 완료 문서만
curl -H "X-API-Key: <키>" "https://<서버주소>/api/external/v1/documents/?status=approved"

# 상세 조회
curl -H "X-API-Key: <키>" https://<서버주소>/api/external/v1/documents/123/

# product_name 검색 + P단계 합의 완료 이력 있는 문서만 + 원하는 필드만
curl -H "X-API-Key: <키>" \
  "https://<서버주소>/api/external/v1/documents/?product_name=PROD-A&p_approved=true&fields=product_name,additional_notes"
```

---

## 4. 보안 설계 및 주의사항

- **인증 방식**: `X-API-Key` 헤더 값을 `hmac.compare_digest`로 상수시간 비교(`authentication.py`). `==` 비교 대비 타이밍 공격에 안전.
- **내부 API와 완전 분리**: `ExternalRequestDocumentViewSet`은 `RequestDocumentViewSet`과 별개 클래스이며 `submit`/`approve-step`/`delete` 등 결재·쓰기 액션이 물리적으로 존재하지 않는다.
- **노출 범위(운영 결정 사항, 2026-07-20 확정)**:
  - 상태: **전체 상태**(draft 포함) 노출. 내부 정책(`RequestDocumentViewSet.get_queryset()`)은 draft를 작성자 본인/그룹 멤버/MASTER로 제한하지만, 이 외부 엔드포인트는 그 제한을 적용하지 않는다(의도된 동작).
  - 필드: `additional_notes` 포함 **전체 필드** 노출. `requester_email` 등 개인 이메일 정보가 포함된다.
  - 단, 로그인 사용자 컨텍스트에 의존하는 권한 플래그(`can_edit`/`can_withdraw`/`pause_request` 등, 내부 `DocPermFieldsMixin`)는 외부 요청에 의미가 없으므로 제외했다.
- **키 유출 시 영향**: 단일 고정 키이므로 유출되면 회수(재발급) 전까지 전체 이력(모든 상태 + 개인정보 포함)이 노출된다. **주기적 키 교체를 권장**한다.
- **HTTPS 필수**: 운영은 nginx가 443(HTTPS)만 개방하므로 키가 평문 네트워크로 노출되지 않는다. 개발(10011, HTTP)에서 테스트 시에는 키 노출에 유의.
- **Rate limiting / 영속 접근 로깅은 현재 미구현**이다. 실제 운영 노출 전 과다 조회 방지(Throttle)·접근 로그 적재(DB/파일) 여부를 별도로 결정해야 한다.
- **필터 조건 서버 콘솔 출력**: `/api/external/v1/documents/` 목록 조회 시마다 `product_name`/`p_approved`/`fields` 파라미터와 매칭 건수를 `print()`로 서버 콘솔에 남긴다(`docker logs`로 확인). **HTTP 응답 바디에는 포함되지 않으며**, DB에 영속 저장되지도 않는다(위 "영속 접근 로깅 미구현"과는 별개의 즉시성 디버그 출력).
- **CORS**: 서버-투-서버(curl/backend) 호출에는 적용되지 않는다. 외부 시스템이 브라우저 JS로 직접 호출하는 경우에만 `CORS_ALLOWED_ORIGINS`에 해당 도메인 추가가 필요하다(현재 미추가).

---

## 5. 관련 코드 위치

| 파일 | 역할 |
|---|---|
| `backend/api/authentication.py` | `ExternalApiKeyAuthentication` — 헤더 검증 |
| `backend/api/views.py` | `HasExternalApiKey`(permission), `ExternalRequestDocumentViewSet` |
| `backend/api/serializers.py` | `ExternalRequestDocumentSerializer` |
| `backend/api/urls.py` | `external_router` → `/api/external/v1/documents/` |
| `backend/config/settings/base.py` | `EXTERNAL_API_KEY` 로드 |
| `backend/api/tests.py` | `ExternalApiKeyAccessTest` |
