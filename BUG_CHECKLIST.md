# 시스템 전체 구조 문서 & 버그 체크 현황

> **사용 방법**
> - `⬜ 미완료` : 아직 버그 체크를 하지 않은 섹션
> - `🔍 진행 중` : 현재 버그 체크 중인 섹션
> - `✅ 완료` : 버그 체크 완료 (결과는 섹션 내 기록)
>
> 순서: 섹션 선택 → 코드 상세 검토 → 버그 발견 시 수정 → `✅ 완료` 체크

---

## 📋 버그 체크 현황 요약

| # | 섹션 | 버그 체크 | 발견된 버그 수 |
|---|------|-----------|---------------|
| 1 | 데이터 모델 (Models) | ⬜ 미완료 | - |
| 2 | 인증 시스템 (Authentication) | ⬜ 미완료 | - |
| 3 | 의뢰서 API (RequestDocumentViewSet) | ⬜ 미완료 | - |
| 4 | VOC API (VOCViewSet) | ⬜ 미완료 | - |
| 5 | 사용자/권한 API (UserViewSet) | ⬜ 미완료 | - |
| 6 | 공지사항 API (AdminNoticeViewSet) | ⬜ 미완료 | - |
| 7 | 폼 옵션 API (form-options) | ⬜ 미완료 | - |
| 8 | 이미지 업로드 API | ⬜ 미완료 | - |
| 9 | SSE 실시간 알림 | ⬜ 미완료 | - |
| 10 | 스케줄러 (APScheduler + DCQ) | ⬜ 미완료 | - |
| 11 | Serializers | ⬜ 미완료 | - |
| 12 | API 클라이언트 공통 (client.ts) | ⬜ 미완료 | - |
| 13 | 인증 컨텍스트 (AuthContext.tsx) | ⬜ 미완료 | - |
| 14 | 의뢰서 작성 페이지 (RequestPage) | ⬜ 미완료 | - |
| 15 | 결재 현황 페이지 (ApprovalPage) | ⬜ 미완료 | - |
| 16 | 결재 흐름 컴포넌트 (ApprovalFlow) | ⬜ 미완료 | - |
| 17 | 이력 조회 페이지 (HistoryPage) | ⬜ 미완료 | - |
| 18 | VOC 페이지 (VOCPage) | ⬜ 미완료 | - |
| 19 | 권한 관리 페이지 (PermissionPage) | ⬜ 미완료 | - |
| 20 | 홈 페이지 (HomePage) | ⬜ 미완료 | - |
| 21 | 가이드 페이지 (GuidePage) | ⬜ 미완료 | - |
| 22 | 공통 컴포넌트 | ⬜ 미완료 | - |
| 23 | i18n (다국어) | ⬜ 미완료 | - |
| 24 | 타입 정의 (types/index.ts) | ⬜ 미완료 | - |

---

## 1. 데이터 모델 (Models)

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/models.py`

### 1.1 UserProfile

커스텀 User 모델. Django `AbstractBaseUser` 상속.

| 필드 | 타입 | 설명 |
|------|------|------|
| `loginid` | CharField(150) unique | 로그인 ID (USERNAME_FIELD) |
| `mail` | EmailField | 이메일 |
| `username` | CharField(150) | 표시 이름 |
| `deptname` | CharField(200) | 부서명 |
| `role` | CharField(10) choices | NONE/PL/TE_R/TE_P/TE_J/TE_O/TE_E/MASTER |
| `password` | (AbstractBaseUser 자동 포함) | |
| `last_login` | (AbstractBaseUser 자동 포함) | |

- `UserProfileManager.create_user(loginid, password)` : loginid 필수 검증
- `USERNAME_FIELD = 'loginid'`
- `REQUIRED_FIELDS = []`

---

### 1.2 RequestDocument (의뢰서)

| 필드 | 타입 | 설명 |
|------|------|------|
| `title` | CharField(300) | 의뢰서 제목 (중복 시 `_2`, `_3` 자동 suffix) |
| `requester` | FK(UserProfile) SET_NULL | 의뢰자 (nullable) |
| `requester_name` | CharField(100) | 의뢰자 이름 (비정규화) |
| `requester_email` | EmailField | 의뢰자 이메일 |
| `requester_department` | CharField(100) | 부서 |
| `product_name` | CharField(200) | 제품 이름 |
| `reference_materials` | TextField blank | 참고 자료 |
| `additional_notes` | TextField blank | 상세 폼 전체 JSON 저장 |
| `status` | CharField(20) choices | draft / submitted / under_review / approved / rejected |
| `created_at` | DateTimeField auto_now_add | |
| `updated_at` | DateTimeField auto_now | |
| `submitted_at` | DateTimeField null/blank | 최초 상신일 |

**status 전이:**
```
draft ──[submit]──▶ under_review ──[R합의]──▶ under_review(P대기)
                                  ──[reject]──▶ rejected
                                  ──[all합의]──▶ approved

rejected ──[resubmit]──▶ under_review
under_review/rejected ──[withdraw]──▶ draft
```

**주요 메서드:**
- `get_detail()` : `additional_notes` JSON 파싱, 실패 시 `{}` 반환
- `has_ppid_plel()` : `jayerRows[].pp` 에서 `'plel'` 포함 여부 (대소문자 무시) → EUV 단계 생성 여부 결정

---

### 1.3 ApprovalStep (결재 단계)

| 필드 | 타입 | 설명 |
|------|------|------|
| `document` | FK(RequestDocument) CASCADE | |
| `agent` | CharField(2) choices | R / P / J / O / E |
| `action` | CharField(10) choices | pending / approved / rejected (default=`'checking'`) |
| `acted_at` | DateTimeField null/blank | 처리 일시 |
| `comment` | TextField blank | 합의/반려 사유 |
| `is_parallel` | BooleanField default=False | J, O, E 병렬 처리 여부 |
| `assignee` | FK(UserProfile) SET_NULL null | 담당자 |
| `assignee_name` | CharField(100) blank | 담당자 이름 (비정규화) |
| `round` | PositiveSmallIntegerField default=1 | 상신 회차 |
| `created_at` | DateTimeField auto_now_add null/blank | 생성 일시 |

**결재 흐름별 단계 생성 규칙:**
```
상신(submit)       → agent='R', action='pending', round=1
R 합의(approve)    → agent='P', action='pending', round=현재
P 합의(approve)    → agent='J'+'O' (is_parallel=True), round=현재
                     + 'E' (PLEL 제품인 경우)
J/O/E 전원 합의    → document.status = 'approved'
재상신(resubmit)   → agent='R', round=max_round+1
```

**ordering:** `['round', 'id']`

---

### 1.4 VOC (Voice of Customer)

| 필드 | 타입 | 설명 |
|------|------|------|
| `title` | CharField(200) | |
| `category` | CharField(20) choices | inquiry / error_report / feature_request / task_request |
| `submitter_name` | CharField(100) | |
| `submitter_email` | EmailField | |
| `submitter_user_id` | IntegerField null/blank | 제출자 UserProfile.id |
| `page` | CharField(20) blank | 관련 페이지 |
| `content` | TextField | |
| `response` | TextField blank | 답변 (미사용 가능성 있음) |
| `status` | CharField(20) choices | checking / completed / rejected |
| `created_at` | DateTimeField auto_now_add | |
| `responded_at` | DateTimeField null/blank | 답변일 |

---

### 1.5 VocComment (VOC 댓글)

| 필드 | 타입 | 설명 |
|------|------|------|
| `voc` | FK(VOC) CASCADE | |
| `author_name` | CharField(100) | |
| `author_role` | CharField(20) | |
| `is_submitter` | BooleanField | 제출자 여부 |
| `content` | TextField | |
| `is_reject_reason` | BooleanField | 반려 사유 댓글 여부 |
| `created_at` | DateTimeField auto_now_add | |

**ordering:** `['created_at']`

---

### 1.6 VocHistory (VOC 처리 이력)

| 필드 | 타입 | 설명 |
|------|------|------|
| `voc` | FK(VOC) CASCADE | |
| `action` | CharField(20) choices | checking / completed / rejected |
| `acted_at` | DateTimeField auto_now_add | |
| `comment` | TextField blank | |
| `assignee` | FK(UserProfile) SET_NULL null | |
| `assignee_name` | CharField(100) blank | |

**indexes:** `voc`, `action`

---

### 1.7 Line (라인 마스터)

| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | CharField(50) unique | 라인 이름 |
| `order` | PositiveSmallIntegerField | 정렬 순서 |
| `is_active` | BooleanField | 활성 여부 |

---

### 1.8 ProcessProduct / ProductProcessId (외부 DB 캐시)

**ProcessProduct**

| 필드 | 타입 | 설명 |
|------|------|------|
| `line` | CharField(50) | 라인명 |
| `process` | CharField(200) | 조합법 |
| `product_name` | CharField(200) | 제품 이름 |
| `last_synced` | DateTimeField auto_now | |

**indexes:** `line`, `(line, process)`

**ProductProcessId**

| 필드 | 타입 | 설명 |
|------|------|------|
| `line` | CharField(50) | |
| `product_name` | CharField(200) | |
| `process_id` | CharField(200) | 조리법 |
| `last_synced` | DateTimeField auto_now | |

**indexes:** `line`, `(line, product_name)`

---

### 1.9 PhotoStepS1 / S3 / S4 / S5 (라인별 STEP 캐시)

각 라인(line1/line3/line4/line5)별 별도 모델. 동일 구조.

| 필드 | 타입 | 설명 |
|------|------|------|
| `processid` | CharField(200) | 조리법 ID |
| `stepseq` | CharField(200) | STEP 순번 |
| `descript` | CharField(200) | 공정명 |
| `recipeid` | CharField(200) | Recipe ID |
| `areaname` | CharField(50) | 영역명 |
| `eqptype` | CharField(50) | 장비 타입 (PMAINF / POVLAY) |
| `layerid` | CharField(200) blank | 레이어 ID |
| `updated` | CharField(50) blank | 업데이트 일시 문자열 |
| `last_synced` | DateTimeField auto_now | |

**indexes:** `processid`, `(processid, eqptype)` — index 이름 패턴: `api_pstep_line{N}_*`

**eqptype 용도:**
- `PMAINF` : J-ayer / BB 외부 데이터용
- `POVLAY` : O-ayer 데이터용

---

### 1.10 AdminNotice (공지사항)

| 필드 | 타입 | 설명 |
|------|------|------|
| `template` | CharField(20) choices | notice / release_note |
| `date` | DateField | 공지 날짜 |
| `title` | CharField(200) | |
| `content` | TextField blank | Notice 타입 전용 |
| `items` | JSONField default=list | Release Note 전용. `[{category, content}]` 형태 |
| `created_at` | DateTimeField auto_now_add | |
| `updated_at` | DateTimeField auto_now | |

**ordering:** `['-date', '-created_at']`

---

## 2. 인증 시스템 (Authentication)

> **버그 체크:** ⬜ 미완료
> **파일 (BE):** `backend/api/auth_views.py`, `backend/api/authentication.py`, `backend/api/auth_views_dev.py`
> **파일 (FE):** `frontend/src/contexts/AuthContext.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/OIDCCallbackPage.tsx`

### 2.1 CookieJWTAuthentication (`authentication.py`)

DRF `BaseAuthentication` 상속. 모든 API 요청에서 자동 실행.

**동작 흐름:**
```
요청 수신
  → request.COOKIES.get('access_token') 확인
  → 없으면 None 반환 (인증 안 함, AllowAny 뷰는 통과)
  → 있으면 jwt.decode(token, SERVICE_JWT_SECRET_KEY, HS256)
      → 성공: payload.username으로 User.objects.get(loginid=username)
          → 존재: (user, token) 반환
          → 미존재: None 반환 (쿠키 삭제 시도)
      → ExpiredSignatureError: AuthenticationFailed('토큰이 만료되었습니다.')
      → InvalidTokenError: AuthenticationFailed(...)
```

**User.DoesNotExist 처리 (`authentication.py:63-69`):**
```python
from django.http import HttpResponse
response = HttpResponse(status=401)
response.delete_cookie('access_token')
response.delete_cookie('refresh_token')
return None  # ← response 객체는 버려짐, 쿠키 삭제 실제 미작동
```

---

### 2.2 OIDC SSO 로그인 플로우 (`auth_views.py`)

```
[FE] loginSSO() 호출
  → GET /api/auth/oidc/login/
      → nonce(UUID) 생성
      → nonce를 HS256 JWT로 래핑 (10분 유효)
      → ADFS authorization URL 생성
          client_id, redirect_uri, response_mode=form_post,
          response_type=code+id_token, scope=openid+profile,
          nonce=nonce_val, state=random_uuid
      → { redirect_url, nonce_jwt } 반환
  → nonce_jwt → localStorage('oidc_state_jwt') 저장
  → window.location.href = redirect_url (ADFS로 이동)

[ADFS] 인증 성공
  → POST {redirect_uri}/oidc-callback
      form fields: id_token, code, state

[FE] OIDCCallbackPage
  → id_token, code, state 수집
  → localStorage에서 nonce_jwt 읽기
  → POST /api/auth/oidc/callback/ { id_token, state, nonce_jwt }

[BE] POST /api/auth/oidc/callback/
  → id_token을 ADFS 인증서(PEM)로 RS256 검증
  → decoded id_token에서 nonce 추출
  → nonce_jwt 있고 id_token nonce 있으면 검증
  → create_or_update_user_from_oidc(claims) 실행
      → loginid, mail, username, deptname 추출 (대소문자 우선순위 처리)
      → get_or_create(loginid=login_id) → NONE role로 생성
      → 기존 사용자면 mail, deptname, username 업데이트
      → 신규 생성 시 SSE broadcaster.broadcast('user_added', {...})
  → 서비스 JWT 생성 (HS256)
      access_token: exp=12h
      refresh_token: exp=7d, type='refresh'
  → Django 세션 login()
  → Cookie 설정 (HttpOnly, Secure, SameSite=Lax)
      access_token: max_age=12h
      refresh_token: max_age=7d
  → JSON 요청이면 { success, redirect_url, user } 반환
  → form_post면 redirect_url로 HttpResponseRedirect
```

---

### 2.3 토큰 갱신 (`POST /api/auth/refresh/`)

```
요청: Cookie에 refresh_token 필요
  → jwt.decode(refresh_token, SERVICE_JWT_SECRET_KEY)
  → payload.type == 'refresh' 검증
  → User.objects.get(loginid=payload.username) 조회
  → 새 access_token 생성 (exp=12h)
  → Cookie에 access_token 업데이트
  → { success, user } 반환
```

**토큰 자동 갱신 트리거:** 현재 FE에서 401 응답 시 자동 재시도 로직 없음. 수동으로만 갱신 가능.

---

### 2.4 로그아웃

**서버:** `POST /api/auth/oidc/logout/`
- Django `logout(request)` 세션 종료
- Cookie `access_token`, `refresh_token` max_age=0으로 삭제
- ADFS logout URL 반환

**FE `logout()` 함수 (`AuthContext.tsx:143`):**
```typescript
const logout = () => {
  clearToken();              // localStorage token 삭제
  setIsLoggedIn(false);
  setCurrentUser(EMPTY_USER);
  // ← authAPI.oidcLogout() 미호출 → 서버 쿠키 미삭제
};
```

**FE 비활동 자동 로그아웃 (`AuthContext.tsx:114`):**
```typescript
const handleTimeout = async () => {
  try { await authAPI.oidcLogout(); } catch {}  // ← 서버 호출 있음
  clearToken();
  setIsLoggedIn(false);
  window.location.href = '/?reason=inactive';
};
```

---

### 2.5 세션 초기화 (페이지 진입 시)

```typescript
// 운영 모드: /api/auth/me/ 최대 5회 재시도
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    const res = await authAPI.me();
    setCurrentUser(res.user);
    setIsLoggedIn(true);
    setIsLoading(false);
    return;
  } catch (e) {
    if (e.message.startsWith('HTTP ')) break;  // HTTP 에러는 재시도 안 함
    await sleep((attempt + 1) * 1000);         // 네트워크 에러만 재시도
  }
}
setIsLoading(false);  // 실패 시 로딩 종료
```

---

### 2.6 EMPTY_USER 초기값

```typescript
const EMPTY_USER: UserInfo = {
  id: 0,
  username: '',
  name: '',
  role: 'PL',    // ← 로그인 전 상태인데 'PL' 권한으로 초기화
  department: '',
  email: ''
};
```

---

### 2.7 Dev 모드 로그인 (`auth_views_dev.py`)

`AUTH_MODE=dev` 환경에서만 활성화.

```
POST /api/auth/dev-login/ { username }
  → User.objects.get(loginid=username)
  → JWT access/refresh 토큰 생성
  → { access, refresh, user } 반환
```

**FE dev 모드 초기화 (`AuthContext.tsx:70-79`):**
```typescript
if (IS_DEV_MODE) {
  const devUser = found ?? MOCK_USERS[0];
  setCurrentUser(devUser as unknown as UserInfo);
  authAPI.devLogin(devUser.username)
    .then((res: any) => setToken(res.access))
    .catch(() => clearToken());
  setIsLoggedIn(true);  // ← devLogin 성공 여부 무관하게 즉시 실행
  return;
}
```

---

### 2.8 비활동 자동 로그아웃 타이머

- `INACTIVITY_MS = 60 * 60 * 1000` (1시간)
- 이벤트 감지: `mousedown`, `keydown`, `scroll`, `touchstart`
- `isLoggedIn` 상태 변경 시 타이머 재등록/해제

---

## 3. 의뢰서 API (RequestDocumentViewSet)

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/views.py`, `backend/api/serializers.py`
> **엔드포인트 prefix:** `/api/documents/`

### 3.1 ViewSet 설정

```python
queryset = RequestDocument.objects.all()
permission_classes = [AllowAny]
filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
filterset_fields = ['status', 'product_name']
search_fields = ['title', 'product_name', 'requester_name', 'requester_department']
ordering_fields = ['created_at', 'submitted_at']
ordering = ['-created_at']
```

- list 액션: `RequestDocumentListSerializer` 사용
- 나머지: `RequestDocumentSerializer` 사용

---

### 3.2 엔드포인트 목록

| 메서드 | URL | 설명 |
|--------|-----|------|
| GET | `/documents/` | 목록 조회 (필터/검색/정렬) |
| POST | `/documents/` | 생성 (제목 중복 처리 포함) |
| GET | `/documents/{id}/` | 상세 조회 |
| PUT/PATCH | `/documents/{id}/` | 수정 |
| DELETE | `/documents/{id}/` | 기본 삭제 (DRF 기본) |
| POST | `/documents/{id}/submit/` | 상신 |
| POST | `/documents/{id}/resubmit/` | 재상신 |
| POST | `/documents/{id}/withdraw/` | 철회 |
| POST | `/documents/{id}/delete/` | 커스텀 삭제 |
| POST | `/documents/{id}/approve-step/` | 결재 단계 합의 |
| POST | `/documents/{id}/reject-step/` | 결재 단계 반려 |
| POST | `/documents/{id}/assign-step/` | 담당자 지정 |
| GET | `/documents/stats/` | 상태별 통계 |

---

### 3.3 상신 로직 (`submit`)

```
1. document.status != 'draft' → 400 에러
2. additional_notes JSON 파싱
   → jayerRows, bbRows 추출
   → bbRows에서 sourceJayerRowId 집합 생성
   → process_id 있는 jayerRow 중 매핑 안 된 행 있으면 → 400 에러
   → JSON 파싱 실패 시 pass (검증 스킵)
3. document.status = 'under_review'
4. document.submitted_at = document.submitted_at or timezone.now()
   (재상신이 아닌 경우에만 최초 상신일 기록)
5. ApprovalStep.objects.filter(document=document).delete()
6. ApprovalStep.objects.create(agent='R', action='pending', round=1)
```

---

### 3.4 재상신 로직 (`resubmit`)

```
1. document.status != 'rejected' → 400 에러
2. BB 매핑 검증 (submit과 동일한 로직)
3. document.status = 'under_review'
4. max_round = ApprovalStep.aggregate(Max('round'))
5. ApprovalStep.objects.create(agent='R', action='pending', round=max_round+1)
   (기존 단계는 삭제하지 않음 — 이력 보존)
```

---

### 3.5 철회 로직 (`withdraw`)

```
1. document.status not in ('under_review', 'rejected', 'submitted') → 400 에러
2. document.status = 'draft'
3. document.submitted_at = None
4. ApprovalStep.objects.filter(document=document).delete()
```

---

### 3.6 결재 합의 로직 (`approve_step`)

```
입력: agent (R/P/J/O/E), comment
1. max_round 조회
2. ApprovalStep(document, agent, action='pending', round=max_round) 조회
   → 없으면 400

3. step.action = 'approved', step.acted_at = now(), step.comment = comment 저장

4. agent == 'R':
   → ApprovalStep(agent='P', action='pending', round=현재) 생성
   → status = 'under_review' 유지

5. agent == 'P':
   → ApprovalStep(agent='J', is_parallel=True, round=현재) 생성
   → ApprovalStep(agent='O', is_parallel=True, round=현재) 생성
   → document.has_ppid_plel() == True:
       → ApprovalStep(agent='E', is_parallel=True, round=현재) 생성
   → status = 'under_review' 유지

6. agent in ('J', 'O', 'E'):
   → 현재 round의 J, O, E 단계 조회
   → e_step 존재 여부에 따라 전원 합의 여부 판단
   → 전원 합의 시: status = 'approved'
```

---

### 3.7 결재 반려 로직 (`reject_step`)

```
입력: agent, comment
1. max_round의 해당 agent pending step 조회 → 없으면 400
2. step.action = 'rejected', acted_at = now(), comment 저장
3. document.status = 'rejected'
```

---

### 3.8 담당자 지정 로직 (`assign_step`)

```
입력: agent, assignee_loginid, assignee_name
1. max_round의 해당 agent pending step 조회 → 없으면 400
2. assignee_loginid 있으면:
   → User.objects.get(loginid=assignee_loginid) → 없으면 400
   → step.assignee = user
3. step.assignee_name = assignee_name
4. step.save()
```

---

### 3.9 제목 중복 처리 (`_unique_title`)

```python
def _unique_title(base_title, exclude_id=None):
    if not qs.filter(title=base_title).exists():
        return base_title
    # 기존 _2, _3 등 suffix 파악 후 next_num 계산
    pattern = re.compile(r'^' + re.escape(base_title) + r'_(\d+)$')
    next_num = max(existing_numbers) + 1 if existing_numbers else 2
    return f"{base_title}_{next_num}"
```

---

### 3.10 통계 (`stats`)

```python
GET /documents/stats/
→ { total: int, by_status: { draft: n, submitted: n, under_review: n, approved: n, rejected: n } }
```

---

## 4. VOC API (VOCViewSet)

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/views.py`, `backend/api/serializers.py`
> **엔드포인트 prefix:** `/api/voc/`

### 4.1 ViewSet 설정

```python
queryset = VOC.objects.all()
serializer_class = VOCSerializer
permission_classes = [AllowAny]
filter_backends = [DjangoFilterBackend, SearchFilter]
filterset_fields = ['category', 'status', 'submitter_user_id']
search_fields = ['title', 'submitter_name', 'content']
ordering = ['-created_at']
```

---

### 4.2 엔드포인트 목록

| 메서드 | URL | 설명 |
|--------|-----|------|
| GET | `/voc/` | 목록 조회 |
| POST | `/voc/` | 등록 |
| GET | `/voc/{id}/` | 상세 조회 |
| PATCH | `/voc/{id}/` | 수정 (상태 변경 포함) |
| DELETE | `/voc/{id}/` | 삭제 |
| POST | `/voc/{id}/comment/` | 댓글 등록 |

---

### 4.3 VOCSerializer 설정

```python
class VOCSerializer(serializers.ModelSerializer):
    comments = VocCommentSerializer(many=True, read_only=True)

    class Meta:
        model = VOC
        fields = '__all__'
        read_only_fields = ['created_at', 'responded_at', 'status']
        #                                                    ^^^^^^ status가 read_only
```

**`status`가 `read_only_fields`에 포함** → PATCH 요청으로 상태 변경 불가.

---

### 4.4 댓글 등록 (`comment` action)

```python
@action(detail=True, methods=['post'])
def comment(self, request, pk=None):
    voc = self.get_object()
    data = {**request.data, 'voc': voc.id}
    serializer = VocCommentSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(VOCSerializer(voc).data)  # 전체 VOC 반환
```

---

### 4.5 VocHistoryViewSet

```
GET /api/voc-histories/by_voc/?voc_id={id}
→ 특정 VOC의 처리 이력 목록 (acted_at 오름차순)
```

현재 VocHistory는 백엔드에 모델/뷰가 있지만, **FE에서 VocHistory를 생성하는 API 호출이 없음** (상태 변경 시 자동 생성되지 않음).

---

## 5. 사용자/권한 API (UserViewSet)

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/views.py`
> **엔드포인트 prefix:** `/api/users/`

### 5.1 ViewSet 설정

```python
queryset = User.objects.all()
permission_classes = [AllowAny]
filter_backends = [SearchFilter, OrderingFilter]
search_fields = ['loginid', 'username', 'deptname']
ordering_fields = ['id', 'loginid']
ordering = ['id']
```

---

### 5.2 엔드포인트 목록

| 메서드 | URL | 설명 |
|--------|-----|------|
| GET | `/users/` | 전체 목록 (role 파라미터로 필터 가능) |
| POST | `/users/` | 사용자 생성 (loginid 필수) |
| DELETE | `/users/{id}/` | 사용자 삭제 + SSE 이벤트 발송 |
| GET | `/users/for-assignment/` | role='NONE' 사용자 목록 |
| POST | `/users/{id}/assign-role/` | 역할 부여 + SSE 이벤트 발송 |
| GET | `/users/events/` | SSE 스트림 (권한 변경 실시간) |

---

### 5.3 역할 부여 (`assign_role`)

```python
valid_roles = ['PL', 'TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E', 'MASTER']
User.objects.filter(pk=user.pk).update(role=role)  # ← queryset update (save() 미호출)
user.refresh_from_db()
broadcaster.broadcast('user_updated', {...})
```

---

### 5.4 UserSerializer.create

```python
def create(self, validated_data):
    loginid = self.context.get('loginid')
    user, created = User.objects.get_or_create(
        loginid=loginid,
        defaults={'mail': '', 'role': validated_data.get('role', 'NONE'), ...}
    )
    if not created:
        # 이미 존재하는 사용자면 role, deptname, username 업데이트
        user.role = validated_data.get('role', user.role)
        user.save()
    return user
```

---

## 6. 공지사항 API (AdminNoticeViewSet)

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/views.py`
> **엔드포인트 prefix:** `/api/notices/`

### 6.1 권한

```python
permission_classes = [IsMasterOrReadOnly]
# 읽기(GET): 모두 허용
# 쓰기(POST/PATCH/PUT/DELETE): MASTER 역할만
```

### 6.2 엔드포인트 목록

| 메서드 | URL | 설명 |
|--------|-----|------|
| GET | `/notices/` | 전체 목록 (pagination 없음) |
| POST | `/notices/` | 생성 (MASTER) |
| GET | `/notices/{id}/` | 상세 |
| PATCH | `/notices/{id}/` | 수정 (MASTER) |
| DELETE | `/notices/{id}/` | 삭제 (MASTER) |
| GET | `/notices/latest/` | 최신 공지 1개 |

### 6.3 Release Note 아이템 구조

```json
items: [
  { "category": "new" | "updated" | "bugfix", "content": "..." }
]
```

---

## 7. 폼 옵션 API (form-options)

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/views.py`

### 7.1 엔드포인트 목록

| URL | 파라미터 | 반환 | 소스 모델 |
|-----|----------|------|-----------|
| `/form-options/processes/` | `line` | `{ options: [조합법,...] }` | ProcessProduct |
| `/form-options/products/` | `line`, `process`(선택) | `{ options: [제품명,...] }` | ProcessProduct |
| `/form-options/process-id/` | `line`, `product` | `{ options: [조리법,...] }` | ProductProcessId |
| `/form-options/job-file-layer/` | `line`, `process` | `{ options: [{processid,stepseq,descript,...},...] }` | PhotoStepS1~S5 |
| `/form-options/ovl-layer/` | `line`, `process` | `{ options: [{processid,stepseq,...},...] }` | PhotoStepS1~S5 |
| `/form-options/bb-external/` | `location`, `product`, `process_id` | `{ options: [{processid,stepseq,descript,layerid},...] }` | PhotoStepS1~S5 |
| `/form-options/layer-ids/` | `line`, `process` | `{ options: [layerid,...] }` | PhotoStepS1~S5 |

### 7.2 라인별 모델 매핑

```python
model_map = {
    'line1': PhotoStepS1,
    'line3': PhotoStepS3,
    'line4': PhotoStepS4,
    'line5': PhotoStepS5,
}
```

`line2`는 매핑 없음 → `options: []` 반환.

### 7.3 eqptype 필터 규칙

- `job-file-layer`, `bb-external`: `eqptype='PMAINF'`
- `ovl-layer`: `eqptype='POVLAY'`
- `layer-ids`: `eqptype='PMAINF'`, layerid 비어있지 않은 것만

### 7.4 form_options_process의 DEBUG 로그

```python
logger.warning(f"[DEBUG] line parameter: {repr(line)}")
logger.warning(f"[DEBUG] total records: {total}, line '{line}' count: {line_count}")
logger.warning(f"[DEBUG] options count: {len(options)}")
```
`logger.warning`으로 DEBUG 로그 → 운영 환경 로그 오염.

---

## 8. 이미지 업로드 API

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/views.py` (`upload_image` 함수)
> **엔드포인트:** `POST /api/upload-image/`

### 8.1 동작 흐름

```
요청: multipart/form-data, field name='image'
1. 'image' 필드 없으면 → 400
2. content_type이 'image/'로 시작하지 않으면 → 400
3. 파일 크기 > 2MB → 400
4. 파일명: mshot_{uuid_hex}.{ext}
5. 저장 경로: media/mshot_images/{파일명}
6. default_storage.save() → 저장
7. { path, url, original_name, size } 반환
```

### 8.2 사용처

- VOCPage: 댓글 입력 영역에 이미지 붙여넣기 시
- RequestPage: X표시(mshot) 이미지 첨부

### 8.3 보안

- `@csrf_exempt` 데코레이터 적용 (CSRF 토큰 검증 없음)
- JWT 인증 불요 (`AllowAny` 아니고 `@csrf_exempt` + `@require_POST`)
- 파일 확장자 검증 없음 (content_type만 검증)

---

## 9. SSE 실시간 알림

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/sse.py`, `backend/api/views.py` (`user_events`)
> **엔드포인트:** `GET /api/users/events/`

### 9.1 UserEventBroadcaster (`sse.py`)

```python
class UserEventBroadcaster:
    _lock: threading.Lock
    _queues: list[queue.Queue]  # maxsize=100 per queue

    def subscribe() → queue.Queue
    def unsubscribe(q)
    def broadcast(event_type, data):
        msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        # 각 큐에 put_nowait()
        # 큐가 가득 찬(Full) 경우 dead 목록에 추가 후 제거
```

**글로벌 싱글톤:** `broadcaster = UserEventBroadcaster()`

---

### 9.2 SSE 스트림 엔드포인트

```python
@csrf_exempt
def user_events(request):
    def event_stream():
        q = broadcaster.subscribe()
        try:
            yield ": connected\n\n"
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                except queue.Empty:
                    yield ": keepalive\n\n"  # 30초마다 keepalive
        finally:
            broadcaster.unsubscribe(q)

    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response
```

---

### 9.3 이벤트 종류

| event_type | 발생 시점 | data 필드 |
|------------|-----------|-----------|
| `user_added` | OIDC 로그인으로 신규 사용자 생성 | id, loginid, name, deptname, role, mail |
| `user_updated` | `assign_role` 호출 | id, loginid, name, deptname, role, mail |
| `user_deleted` | `destroy` 호출 | id |

---

### 9.4 FE 구독 (`PermissionPage.tsx:146`)

```typescript
const es = new EventSource('/api/users/events/');
es.addEventListener('user_added', handler);
es.addEventListener('user_updated', handler);
es.addEventListener('user_deleted', handler);
return () => es.close();
```

**재연결:** `EventSource`가 끊기면 브라우저가 자동 재연결 시도 (표준 동작).

---

## 10. 스케줄러 (APScheduler + DCQ)

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/scheduler.py`, `backend/api/utils.py`, `backend/api/apps.py`

### 10.1 스케줄러 설정

```python
# apps.py의 AppConfig.ready()에서 시작
scheduler = BackgroundScheduler(timezone='Asia/Seoul')
scheduler.add_jobstore(DjangoJobStore(), 'default')
scheduler.add_job(
    sync_form_options,
    trigger=IntervalTrigger(hours=1),
    id='sync_form_options',
    replace_existing=True,
)
scheduler.start()
# 시작 직후 별도 스레드로 즉시 1회 실행
threading.Thread(target=sync_form_options, daemon=True).start()
```

`SKIP_SCHEDULER=true` 환경변수로 비활성화 가능.

---

### 10.2 sync_form_options() 동작

```
1. get_django_engine() → SQLAlchemy MySQL 엔진 생성
2. dcq_login_with_retry() → DCQ 로그인 시도
3. 4개 라인(라인1, 라인3, 라인4, 라인5)에 대해:
   a. ProcessProduct 동기화
      → SELECT DISTINCT partnumber, descript FROM A.B_{suffix} WHERE X IS NOT NULL
      → api_processproduct 테이블 해당 라인 전체 DELETE 후 INSERT
   b. ProductProcessId 동기화
      → SELECT DISTINCT partnumber, processid FROM A.B_{suffix}_processproduct
      → api_productprocessid 테이블 해당 라인 전체 DELETE 후 INSERT
   c. PhotoStep 동기화
      → SELECT processid, stepseq, descript, recipeid, areaname, eqptype, updated, layerid
         FROM A.B_{suffix}_step WHERE X = 'Y'
      → table_map: {'라인 1': 'api_teps1', '라인 3': 'api_steps3', ...}
      → 해당 테이블 전체 DELETE 후 INSERT
```

---

### 10.3 LINE_SUFFIX_MAP 불일치

**`utils.py`:**
```python
LINE_SUFFIX_MAP = {
    'LINE1': 'line1', 'LINE2': 'line2',
    'LINE3': 'line3', 'LINE4': 'line4', 'LINE5': 'line5',
}
```

**`scheduler.py`:**
```python
LINES = ['라인 1', '라인 3', '라인 4', '라인 5']  # 한글, 공백 포함
```

**scheduler.py의 table_map:**
```python
table_map = {
    '라인 1': 'api_teps1',    # ← PhotoStepS1의 실제 DB 테이블명: api_photosteps1
    '라인 3': 'api_steps3',   # ← PhotoStepS3의 실제 DB 테이블명: api_photosteps3
    '라인 4': 'api_steps4',
    '라인 5': 'api_steps5',
}
```

→ Django 모델에 `db_table` 명시가 없으므로 실제 테이블명은 `api_photosteps1`, `api_photosteps3`, `api_photosteps4`, `api_photosteps5`.

---

### 10.4 DCQ 유틸리티 (`utils.py`)

```python
def cq_login(dcq_id, dcq_password):
    # sys.stdin을 override하여 DCQ 라이브러리에 인터랙티브 입력 주입
    account_info = io.StringIO(f'{dcq_id}\n{dcq_password}')
    sys.stdin = account_info
    try:
        login()  # DCQ 내부 login()
    finally:
        sys.stdin = sys.__stdin__  # 반드시 복구

def get_dcq_credentials():
    dcq_id = os.environ.get('DCQ_ID', '')
    pwd_pack_str = os.environ.get('DCQ_PASSWORD', '')  # JSON 형태의 비밀번호 목록
    pwd_pack = json.loads(pwd_pack_str)
    return dcq_id, pwd_pack

def dcq_login_with_retry():
    # JSON pack의 비밀번호를 순서대로 시도
```

---

## 11. Serializers

> **버그 체크:** ⬜ 미완료
> **파일:** `backend/api/serializers.py`

### 11.1 UserSerializer

```python
fields = ['id', 'loginid', 'name', 'mail', 'role', 'deptname']
# 'name'은 source='username'
```

`create()` 메서드: `loginid`를 context에서 가져와 `get_or_create`. 이미 존재하면 role/deptname/username 업데이트.

---

### 11.2 ApprovalStepSerializer

```python
fields = ['id', 'agent', 'action', 'acted_at', 'comment', 'is_parallel',
          'assignee_loginid', 'assignee_name', 'round', 'created_at']
# assignee_loginid: SerializerMethodField → obj.assignee.loginid if obj.assignee else None
```

---

### 11.3 RequestDocumentSerializer

```python
read_only_fields = ['status', 'created_at', 'updated_at', 'submitted_at']
# approval_steps: nested, read_only
```

`requester` 필드 없음 → 의뢰서 저장 시 requester FK는 저장되지 않음.

---

### 11.4 RequestDocumentListSerializer

목록 조회 최적화. `approval_steps` 포함 (N+1 쿼리 가능성).

---

### 11.5 VOCSerializer

```python
fields = '__all__'
read_only_fields = ['created_at', 'responded_at', 'status']
# status가 read_only → PATCH로 상태 변경 불가
```

---

### 11.6 VocHistorySerializer

```python
fields = ['id', 'voc', 'action', 'acted_at', 'comment', 'assignee_id', 'assignee_name']
# assignee_id: SerializerMethodField → obj.assignee_id (FK의 raw id값)
```

---

## 12. API 클라이언트 공통 (client.ts)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/api/client.ts`

### 12.1 HTTP 기본 함수

```typescript
async function request<T>(path, options): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',  // Cookie 자동 포함
  });

  if (!res.ok) {
    // 에러 메시지 파싱 후 throw Error
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
```

**자동 토큰 갱신 없음**: 401 응답 시 재시도 로직 부재.

---

### 12.2 Token 관리

```typescript
const TOKEN_KEY = 'access_token';
export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(token) { localStorage.setItem(TOKEN_KEY, token); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }
```

실제 인증은 HttpOnly Cookie 기반. localStorage token은 dev 모드에서만 실질적으로 사용됨.

---

### 12.3 API 모듈 목록

| export | 담당 |
|--------|------|
| `authAPI` | me, refresh, oidcLogin, oidcCallback, oidcLogout, devLogin |
| `documentsAPI` | list, get, create, update, submit, resubmit, withdraw, delete, approveStep, rejectStep, assignStep, stats, getApproved |
| `vocAPI` | list, create, get, updateStatus, updateResponse, addComment |
| `linesAPI` | list |
| `noticesAPI` | list, latest, get, create, update, delete |
| `guidesAPI` | list, get, create, update, delete |
| `usersAPI` | list, create, remove, forAssignment, assignRole |
| `formOptionsAPI` | getProcesses, getProducts, getProcessId, getJobFileLayer, getOvlLayer, getLayerIds, getBbExternalData |
| `uploadImageAPI` | upload |

---

### 12.4 listDocuments 응답 타입 처리

```typescript
const data = await get<{ results: RequestDocument[]; count: number } | RequestDocument[]>(`/documents/${qs}`);
if (Array.isArray(data)) {
  return { data: { results: data, count: data.length } };
}
return { data };
```

---

### 12.5 getApprovedDocuments 타입 캐스팅

```typescript
const data = await get<RequestDocument[]>(`/documents/${qs}`);
return { data: Array.isArray(data) ? data : (data as any).results ?? [] };
// ↑ any 캐스팅 사용
```

---

### 12.6 linesAPI.list 반환 형태 불일치

```typescript
export const linesAPI = {
  list: (): Promise<Line[]> => get<Line[]>('/lines/'),
  // ↑ { data: ... } 래핑 없이 직접 반환 (다른 API와 불일치)
};
```

---

## 13. 인증 컨텍스트 (AuthContext.tsx)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/contexts/AuthContext.tsx`

### 13.1 상태

```typescript
currentUser: UserInfo     // 현재 로그인 사용자
isLoggedIn: boolean
isLoading: boolean        // 초기값: !IS_DEV_MODE (운영은 true, dev는 false)
```

---

### 13.2 EMPTY_USER

```typescript
const EMPTY_USER: UserInfo = {
  id: 0, username: '', name: '',
  role: 'PL',  // ← 비로그인 상태 기본값이 'PL'
  department: '', email: ''
};
```

---

### 13.3 MOCK_USERS (dev 모드)

총 17명 (PL×1, TE_R×3, TE_P×3, TE_J×3, TE_O×3, TE_E×3, MASTER×1).  
`department` 필드에 i18n key 문자열이 직접 저장됨 (`ROLE_LABEL['TE_R']` 등).

---

### 13.4 세션 초기화 흐름

```
IS_DEV_MODE === true:
  → localStorage 'approval_system_user_id' 조회
  → 없으면 MOCK_USERS[0](PL) 사용
  → setCurrentUser() + setIsLoggedIn(true) 즉시
  → authAPI.devLogin() 비동기 (성공/실패 무관하게 로그인 처리)

IS_DEV_MODE === false:
  → /api/auth/me/ 최대 5회 호출
  → HTTP 에러(401 등) 시 즉시 중단
  → 네트워크 에러 시 지수 백오프(1s, 2s, 3s, 4s) 후 재시도
  → 성공: setCurrentUser, setIsLoggedIn(true), setIsLoading(false)
  → 실패: setIsLoading(false)
```

---

### 13.5 비활동 자동 로그아웃

```
isLoggedIn 상태가 true가 되면:
  → document에 mousedown, keydown, scroll, touchstart 리스너 등록
  → 1시간 타이머 시작
  → 이벤트 발생 시 타이머 리셋
  → 타임아웃:
      authAPI.oidcLogout() 호출 (에러 무시)
      clearToken()
      setIsLoggedIn(false)
      window.location.href = '/?reason=inactive'
```

---

### 13.6 loginSSO / logout / switchUser

```typescript
loginSSO():
  → authAPI.oidcLogin() → { redirect_url, nonce_jwt }
  → localStorage 'oidc_state_jwt' = nonce_jwt
  → window.location.href = redirect_url

logout():
  → clearToken()        // localStorage만 삭제
  → setIsLoggedIn(false)
  → setCurrentUser(EMPTY_USER)
  // authAPI.oidcLogout() 미호출

switchUser(username):  // dev 모드 전용
  → MOCK_USERS에서 찾아 setCurrentUser
  → localStorage 'approval_system_user_id' 저장
  → authAPI.devLogin(username)
```

---

## 14. 의뢰서 작성 페이지 (RequestPage)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/pages/RequestPage.tsx`

### 14.1 주요 상태

| state | 타입 | 설명 |
|-------|------|------|
| `editingDocId` | number \| null | 수정 중인 의뢰서 ID |
| `detail` | DetailFormState | 의뢰 상세 폼 전체 |
| `jayerRows` | JayerRow[] | J-ayer 테이블 행 목록 |
| `oayerRows` | OayerRow[] | O-ayer 테이블 행 목록 |
| `bbRows` | BbTableRow[] | BB 테이블 행 목록 |
| `historySnapshots` | HistorySnapshot[] | 재상신 이전 스냅샷 목록 |
| `errors` | Record | 필드별 유효성 에러 |
| `lines` | Line[] | 라인 목록 |
| `processOptions` | string[] | 조합법 목록 |
| `productOptions` | string[] | 제품 이름 목록 |
| `processIdOptions` | string[] | 조리법 목록 |

---

### 14.2 폼 섹션 구조

```
섹션 A. 의뢰 상세
  - 요청 목적: [신규 / 차용 / 신규+차용 / MAP 변경]
  - 라인 선택
  - 조합법 선택 (라인 연동)
  - 제품 이름 선택 (라인+조합법 연동)
  - 조리법 선택 (라인+제품 연동)
  - 고객명, 고객 요구사항
  - 요청 목적 == 차용/신규+차용 시 추가:
      - 기타 목적, 원본 위치, 원본 제품 이름, 특이사항
      - 흐름도(FlowChartRow 테이블)

섹션 B. MAP 정보
  - MAP 목적: [NEW / CLONE / EXISTING]
  - 지도 편차 변경: [변경 없음 / 변경 있음] → X값, Y값, 변경 사유
  - 예외 구역 변경: [변경 없음 / 변경 있음] → 예외 구역 값(mm)
  - BB 조합 영역: [없음 / 존재] → 뼈찜 위치/제품/조리법 행 추가

섹션 C. J-ayer 정보
  - 조리법 ID 기준 STEP 테이블
  - 자동 채우기: /form-options/job-file-layer/
  - 컬럼: updated, process_id, sp, sd, pp, layerid, st, new_or_copy, product_name, step, item_id
  - 행 비활성화(disabled), 수동 비활성화(manuallyDisabled)
  - 필터셋(FilterSet) 관리

섹션 D. O-ayer 정보
  - 조리법 ID 기준 OVL STEP 테이블
  - 자동 채우기: /form-options/ovl-layer/
  - 컬럼: updated, process_id, sp, sd, pp, st, new_or_copy, product_name, step

섹션 E. BB 정보
  - J-ayer 행 선택 → BB 외부 데이터 조회
  - BbTableRow: sourceJayerRowId 로 J-ayer 행 추적
  - 상신 전 모든 process_id 있는 J-ayer 행에 BB 매핑 필수

섹션 F. C가문 제품 (only_prodc)
  - 북쪽/중간/남쪽 각 라인+조합법+제품 선택
  - 중간 위치: 사용/미사용 선택 가능

섹션 G. X표시(mshot) 변경
  - 없음/추가/수정/삭제
  - 이미지 첨부 영역
  - MAP 옵션 10개 체크박스

섹션 H. 변경 이력 (reversion)
  - rev_yn: [예 / 아니오]
  - rev_entries: [{layers: string[], gds: string}]
```

---

### 14.3 데이터 저장 구조 (additional_notes JSON)

```json
{
  "detail": { /* DetailFormState */ },
  "jayerRows": [ /* JayerRow[] */ ],
  "oayerRows": [ /* OayerRow[] */ ],
  "bbRows": [ /* BbTableRow[] */ ],
  "historySnapshots": [ /* HistorySnapshot[] */ ]
}
```

---

### 14.4 저장(임시저장) 플로우

```
1. 유효성 검사 (필수 필드 체크)
2. additional_notes = JSON.stringify({ detail, jayerRows, oayerRows, bbRows, historySnapshots })
3. editingDocId 있으면 documentsAPI.update()
   없으면 documentsAPI.create()
4. editingDocId 업데이트
5. 성공 toast
```

---

### 14.5 상신 플로우

```
1. 상신 확인 모달 표시
2. additional_notes 빌드 후 update
3. documentsAPI.submit(editingDocId) 호출
   → BE에서 BB 매핑 검증
   → 성공 시 status = under_review
4. toast 표시 후 결재 현황 페이지로 navigate
```

---

### 14.6 폼 옵션 연쇄 로딩

```
라인 변경 → getProcesses(line) → processOptions 갱신
           → process 초기화
           → product 초기화
           → processId 초기화

조합법 변경 → getProducts(line, process) → productOptions 갱신
             → product 초기화

제품 선택 → getProcessId(line, product) → processIdOptions 갱신

조리법 선택 → [자동 채우기 버튼 활성화]
            → getJobFileLayer() → J-ayer 행 자동 채우기
            → getOvlLayer() → O-ayer 행 자동 채우기
```

---

## 15. 결재 현황 페이지 (ApprovalPage)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/pages/ApprovalPage.tsx`

### 15.1 주요 상태

| state | 설명 |
|-------|------|
| `docs` | 의뢰서 목록 |
| `filter` | 상태 필터 (all/draft/under_review/rejected) |
| `search` | 검색어 |
| `selected` | 상세보기 중인 의뢰서 |
| `processing` | 결재 처리 중 플래그 |
| `agreeModal` / `rejectModal` | 합의/반려 모달 상태 |

---

### 15.2 목록 필터

- `filter_all`: 모든 status (approved 제외)
- `filter_draft`: status=draft
- `filter_under_review`: status=under_review
- `filter_rejected`: status=rejected

---

### 15.3 날짜 계산 함수

| 함수 | 설명 |
|------|------|
| `getStartDate(doc)` | R 합의 다음날 = 시작일 |
| `formatCurrentStageCompletionDate(doc)` | 현재 단계 완료 예상일 |
| `getTotalDays(hasEUV)` | P(3) + J/O/E(3) = 6일 (R 제외) |
| `formatExpectedCompletion(doc)` | 시작일 + getTotalDays |

---

### 15.4 hasEUVStep 판별

```typescript
const hasEUVStep = (doc) => {
  // 1. 이미 E 단계 존재하면 true
  // 2. J/O 모두 합의됐는데 E 없으면 false
  // 3. 아직 진행 중이면 additional_notes.jayerRows에서 PLEL 확인
};
```

---

### 15.5 결재 처리 흐름

```
합의 버튼 클릭 → agreeModal 열기
  → 이유 입력 (선택)
  → documentsAPI.approveStep(docId, agent, comment)
  → 목록 새로고침
  → selected 업데이트

반려 버튼 클릭 → rejectModal 열기
  → documentsAPI.rejectStep(docId, agent, comment)
  → 목록 새로고침

담당자 지정:
  → usersAPI.list(role=AGENT_TO_ROLE[agent])로 팀원 목록 조회
  → documentsAPI.assignStep(docId, agent, loginid, name)
```

---

### 15.6 AGENT_TO_ROLE 매핑

```typescript
const AGENT_TO_ROLE: Record<string, string> = {
  R: 'TE_R', P: 'TE_P', J: 'TE_J', O: 'TE_O', E: 'TE_E',
};
```

---

## 16. 결재 흐름 컴포넌트 (ApprovalFlow)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/components/ApprovalFlow.tsx`

### 16.1 props

```typescript
interface ApprovalFlowProps {
  doc: RequestDocument;
  onAgree: (agent: AgentType) => void;
  onReject: (agent: AgentType) => void;
  onAssign: (agent: AgentType, loginid: string, userName: string) => void;
  onLoadTeamMembers: (agent: AgentType) => Promise<UserWithRole[]>;
  processing: boolean;
  currentUser: MockUser;
}
```

---

### 16.2 렌더링 구조

```
상신됨(submitted_at) ──▶ [R] ──▶ [P] ──▶ [J][O][E?] ──▶ 결재완료
```

현재 round의 단계만 표시. 이전 round 단계는 표시 안 함.

---

### 16.3 권한 체크 함수

```typescript
canUserAssign(user, step):
  // 같은 팀 + step.action='pending' + assignee_loginid 없음

canUserAgree(user, step):
  // MASTER: 항상 가능
  // TE_O, TE_E: 자기 단계 pending이면 항상 가능 (담당자 지정 불필요)
  // 나머지: assignee_loginid === user.username
```

---

### 16.4 담당자 지정 UI

```
지정하기 버튼 클릭
  → onLoadTeamMembers(agent) 호출 → usersAPI.list(role)
  → 팀원 드롭다운 표시
  → 선택 후 확인 → onAssign(agent, loginid, name)
```

**하드코딩 텍스트:** `"지정하기"`, `"로딩 중..."`, `"선택하세요"`, `"확인"`, `"취소"` — i18n 미적용.

---

## 17. 이력 조회 페이지 (HistoryPage)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/pages/HistoryPage.tsx`

### 17.1 기능

- `status=approved` 인 의뢰서만 조회
- 검색: title, product_name, requester_name, requester_department
- 상세보기: `PagedDetailView` 컴포넌트 사용
- 삭제: MASTER만 가능

### 17.2 결재 완료일 계산

```typescript
const getApprovalCompletedDate = (doc) => {
  const approved = approval_steps.filter(s => s.action === 'approved' && s.acted_at);
  const latest = approved.reduce((a, b) =>
    new Date(a.acted_at) > new Date(b.acted_at) ? a : b
  );
  return formatDate(latest.acted_at);
};
// ← 가장 마지막 approved step의 acted_at을 완료일로 사용
```

---

## 18. VOC 페이지 (VOCPage)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/pages/VOCPage.tsx`

### 18.1 주요 상태

| state | 설명 |
|-------|------|
| `vocs` | VOC 목록 |
| `filter` | '' / 'my' / category값 |
| `searchQuery` | 검색어 |
| `formOpen` | 등록 모달 열림 여부 |
| `selected` | 상세보기 중인 VOC |
| `commentText` | 댓글 입력 텍스트 |
| `rejectOpen` | 반려 모달 |
| `rejectReason` | 반려 사유 |

---

### 18.2 VOC 등록 플로우

```
form: { title, category, page }
content: contentEditable div (HTML)
  → 이미지 붙여넣기 시 uploadImageAPI.upload() 후 img 태그 삽입

제출 시:
  content = contentEditableRef.current.innerHTML (HTML 문자열)
  vocAPI.create({ title, category, page, content, submitter_name, submitter_email, submitter_user_id })
```

---

### 18.3 상태 변경 흐름

```
MASTER가 "답변완료로 처리":
  → vocAPI.updateStatus(id, 'completed')
  → PATCH /voc/{id}/ { status: 'completed' }
  → VOCSerializer.status = read_only → 실제 DB 변경 안 됨

MASTER가 반려:
  1. vocAPI.addComment(..., is_reject_reason=true)
  2. vocAPI.updateStatus(id, 'rejected')
  → 마찬가지로 status 변경 안 됨
```

---

### 18.4 댓글 등록

```typescript
vocAPI.addComment(selected.id, {
  author_name: currentUser.name,
  author_role: currentUser.role,
  is_submitter: selected.submitter_user_id === currentUser.id,
  content: commentText.trim(),
  is_reject_reason: false,
})
→ POST /voc/{id}/comment/ → VOCSerializer(voc) 전체 반환
→ setSelected(res.data)
```

---

### 18.5 이미지 붙여넣기 (VOC 내용 작성 시)

```typescript
contentEditableRef의 onPaste 핸들러:
  → clipboardData에서 image/* 타입 찾기
  → uploadImageAPI.upload(file) 호출
  → img 태그 HTML로 삽입 (document.execCommand 사용 — deprecated API)
```

---

## 19. 권한 관리 페이지 (PermissionPage)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/pages/PermissionPage.tsx`

### 19.1 탭 구조

전체 역할 탭: `PL / TE_R / TE_P / TE_J / TE_O / TE_E / MASTER / NONE`

초기 탭:
- MASTER → `PL` 탭
- 그 외 → 본인 role 탭

---

### 19.2 수정 권한 판별

```typescript
const canModifyTab = isMaster || currentUser.role === activeTab;
// MASTER 또는 현재 탭이 본인 역할이면 수정(추가/삭제) 가능
```

---

### 19.3 사용자 추가 플로우

```
1. usersAPI.forAssignment() → role='NONE' 사용자 목록 조회
2. 검색 드롭다운으로 여러 명 선택
3. 선택된 사용자들에 대해 usersAPI.assignRole(user.id, activeTab) 병렬 실행
4. 성공/실패 결과에 따라 toast 표시
5. fetchUsers(), fetchUsersForAssignment() 재호출
```

---

### 19.4 사용자 삭제 플로우

```
삭제 버튼 → ConfirmModal
  → usersAPI.remove(id) → DELETE /users/{id}/
  → 로컬 state에서 제거
  → toast 표시
```

---

### 19.5 SSE 실시간 업데이트

```typescript
new EventSource('/api/users/events/')
  user_added  → users 목록에 추가, role='NONE'이면 forAssignment에도 추가
  user_updated → users 목록 업데이트, forAssignment에서 제거
  user_deleted → users/forAssignment 양쪽에서 제거
```

---

## 20. 홈 페이지 (HomePage)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/pages/HomePage.tsx`

### 20.1 기능

1. **공지사항 뱃지**: `localStorage('last_seen_notice_id')` 와 최신 공지 id 비교 → 새 공지 있으면 뱃지 표시
2. **공지 모달**: Notice/Release Note 목록 + 상세 표시, MASTER는 작성/수정/삭제
3. **최근 의뢰 현황**: `documentsAPI.list()` → 최신 5건

### 20.2 공지 관리 모달 (NoticeManagerModal)

```
좌측 패널: 탭(all/release_note/notice) + 공지 목록
우측 패널: 선택된 공지 상세 or 작성/수정 폼

탭 변경 시 dep 없이 selected 초기화 (useEffect [tab] 에서)
초기화 시 useEffect 의존성 누락 가능성
```

### 20.3 Release Note 폼

```
newItems: string[]     → category='new'
updatedItems: string[] → category='updated'
bugfixItems: string[]  → category='bugfix'

저장 시:
items = [
  ...newItems.filter(Boolean).map(c => ({category:'new', content:c})),
  ...updatedItems.filter(Boolean).map(c => ({category:'updated', content:c})),
  ...bugfixItems.filter(Boolean).map(c => ({category:'bugfix', content:c})),
]
```

---

## 21. 가이드 페이지 (GuidePage)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/pages/GuidePage.tsx`
> **주의:** `guidesAPI`가 `/api/guides/` 호출하는데 **backend에 Guide 모델 및 뷰가 없음** (미구현 또는 별도 앱)

### 21.1 기능

- 섹션 필터 + 검색
- 가이드 목록 표시
- 상세보기 모달
- 작성/수정/삭제 (MASTER 또는 작성자)

### 21.2 수정 권한

```typescript
const canEdit = (guide) =>
  currentUser.role === 'MASTER' ||
  currentUser.role === guide.author_role ||
  currentUser.name === guide.author_name;
// author_name 기반 판별 → 동명이인 충돌 가능성
```

### 21.3 SECTIONS 상수

```typescript
const SECTIONS: SectionOption[] = [
  { value: 'all', labelKey: 'guide.section_all' },
  // 나머지 섹션 없음 — 상수가 'all' 하나만 정의됨
];
```

`ko.json`에 `guide.*` 키 없음 → 섹션 레이블 번역 누락.

---

## 22. 공통 컴포넌트

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/components/`

### 22.1 Modal (`Modal.tsx`)

| 컴포넌트 | 설명 |
|----------|------|
| `Modal` | title, body, footer actions, onClose |
| `ConfirmModal` | title, message, onConfirm, onCancel, confirmText, cancelText |

---

### 22.2 StatusBadge (`StatusBadge.tsx`)

```typescript
status → 색상 + 텍스트 매핑
draft → 회색
submitted → 파랑
under_review → 주황
approved → 초록
rejected → 빨강
```

---

### 22.3 Toast (`Toast.tsx`)

```typescript
type ToastType = 'success' | 'error' | 'info' | 'warning';
useToast(): (message: string, type?: ToastType) => void
```

---

### 22.4 FormSelect (`FormSelect.tsx`)

```typescript
props: label, name, value, options, onChange, placeholder, required, error, className
```

---

### 22.5 AutocompleteInput (`AutocompleteInput.tsx`)

```typescript
props: label, value, options, onChange, error
// 입력 시 options 필터링 + 드롭다운 표시
```

---

### 22.6 PagedDetailView (`PagedDetailView.tsx`)

의뢰서 상세 + 이력 탭 구조. ApprovalPage, HistoryPage에서 공유 사용.

---

## 23. i18n (다국어)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/i18n.ts`, `frontend/src/locales/ko.json`, `frontend/src/locales/en.json`

### 23.1 설정

```typescript
// i18n.ts
i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'ko',
    detection: { order: ['localStorage', 'navigator'] },
    resources: { ko: { translation: koJson }, en: { translation: enJson } }
  });
```

---

### 23.2 번역 키 구조

| 네임스페이스 | 키 수 | 비고 |
|-------------|-------|------|
| `nav.*` | 6개 | |
| `home.*` | 8개 | |
| `request.*` | ~70개 | 가장 많음 |
| `approval.*` | ~30개 | agent_R~E 포함 |
| `history.*` | 9개 | |
| `voc.*` | ~25개 | |
| `login.*` | 6개 | |
| `permission.*` | ~20개 | |
| `common.*` | ~20개 | role_label 포함 |
| `notice.*` | ~12개 | |
| `guide.*` | 없음 | GuidePage에서 사용하지만 키 미정의 |

---

### 23.3 하드코딩 텍스트 (i18n 미적용)

`ApprovalFlow.tsx`:
- `"지정하기"`, `"로딩 중..."`, `"선택하세요"`, `"확인"`, `"취소"`

`VOCPage.tsx`:
- `'이미지 업로드에 실패했습니다.'`

---

## 24. 타입 정의 (types/index.ts)

> **버그 체크:** ⬜ 미완료
> **파일:** `frontend/src/types/index.ts`

### 24.1 주요 타입 목록

| 타입 | 설명 |
|------|------|
| `UserRole` | PL/TE_R/TE_P/TE_J/TE_O/TE_E/MASTER/NONE |
| `UserRoleWithNull` | UserRole \| null \| 'NONE' |
| `Status` | draft/submitted/under_review/approved/rejected |
| `AgentType` | R/P/J/O/E |
| `StepAction` | pending/approved/rejected |
| `RequestDocument` | 의뢰서 전체 |
| `ApprovalStepFrontend` | 결재 단계 |
| `VOC` | VOC 전체 |
| `DetailFormState` | 의뢰서 폼 상태 전체 |
| `JayerRow` | J-ayer 테이블 행 |
| `OayerRow` | O-ayer 테이블 행 |
| `BbTableRow` | BB 테이블 행 |
| `HistorySnapshot` | 재상신 이전 스냅샷 |
| `StepInfo` | PhotoStep 데이터 |
| `Guide` | 가이드 문서 |

---

### 24.2 중복 선언

```typescript
// Line 319
export interface UserForAssignment {
  id: number; username: string; display_name: string; department: string; email: string;
}

// Line 337 (중복)
export interface UserForAssignment {
  id: number; username: string; display_name: string; department: string; email: string;
}
// → TypeScript interface 선언 병합(merging)으로 에러는 없지만 코드 중복
```

---

### 24.3 ROLE_TO_AGENT

```typescript
export const ROLE_TO_AGENT: Partial<Record<UserRole, AgentType>> = {
  TE_R: 'R', TE_P: 'P', TE_J: 'J', TE_O: 'O', TE_E: 'E',
};
// PL, MASTER, NONE은 매핑 없음
```

---

*문서 생성일: 2026-06-01*
*다음 단계: 위 현황 요약 테이블에서 ⬜ 섹션을 하나씩 선택하여 버그 체크 진행*
