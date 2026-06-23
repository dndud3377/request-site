# NOTICE — 공지사항 (AdminNotice)

> 작성일: 2026-06-23
> 목적: 공지사항 기능의 동작 방식과 자동 오픈 로직을 기록한다.

- 모델: `backend/api/models.py` `AdminNotice`
- 뷰: `backend/api/views.py` `AdminNoticeViewSet`
- 프론트 모달: `frontend/src/pages/HomePage.tsx` `NoticeManagerModal`
- 배지: `frontend/src/components/Navbar.tsx`
- 공통 스토리지 로직: `frontend/src/utils/noticeStorage.ts`

---

## 1. 모델 구조

| 필드 | 타입 | 설명 |
|------|------|------|
| `template` | `notice` / `release_note` | 공지 유형 |
| `date` | DateField | 공지 날짜 |
| `title` | CharField | 제목 |
| `content` | TextField | 본문 (notice 유형 전용, Rich Text HTML) |
| `items` | JSONField | 항목 목록 (release_note 유형 전용) |
| `created_at` | DateTimeField | 작성 시각 |
| `updated_at` | DateTimeField | 최종 수정 시각 |

`items` 배열 요소: `{ category: 'new' | 'updated' | 'bugfix', content: string }`

---

## 2. API 엔드포인트

| 메서드 | URL | 설명 | 권한 |
|--------|-----|------|------|
| GET | `/api/notices/` | 목록 (최신 날짜 순) | 전체 |
| POST | `/api/notices/` | 생성 | MASTER |
| GET | `/api/notices/{id}/` | 상세 | 전체 |
| PATCH | `/api/notices/{id}/` | 수정 | MASTER |
| DELETE | `/api/notices/{id}/` | 삭제 | MASTER |
| GET | `/api/notices/latest/` | `updated_at` 기준 가장 최근 수정 공지 1개 | 전체 |

`/notices/latest/` 는 Navbar 배지 판별에 사용된다.

---

## 3. 자동 오픈 로직

### 동작 원칙

- **매 접속마다 자동 오픈** — 억제 조건을 충족하지 않으면 홈 진입 시 항상 모달을 연다.
- **"오늘 하루 보지 않기"** — 모달 푸터 체크박스 체크 후 [확인] 시 오늘 23:59:59까지 억제.
- **내용 변경 시 재오픈** — 억제 기간 중이라도 공지 `updated_at`이 마지막 확인 시점보다 새로우면 강제 오픈.

### 오픈 조건

```
shouldShowNotice(maxUpdatedAt) = !hideActive || contentChanged

hideActive    = notice_hide_until 이 설정돼 있고 현재 시각 < 해당 값
contentChanged = maxUpdatedAt > notice_last_seen_updated_at
```

`maxUpdatedAt` = 전체 공지 중 `updated_at` 최댓값.

### localStorage 키

| 키 | 의미 |
|----|------|
| `notice_hide_until` | 억제 만료 시각 (ISO 8601). 없으면 억제 없음. |
| `notice_last_seen_updated_at` | 마지막으로 모달을 닫았을 때의 공지 `updated_at` 최댓값. |

---

## 4. 모달 UI

```
┌──────────────────────────────────────────────────────────────┐
│ 📣 공지사항                                            [×]  │
├────────────────────┬─────────────────────────────────────────┤
│ [전체][릴리즈][공지]│ [Notice] · 2026-06-23                  │
│                    │ 제목                                    │
│ 2026-06-23         │ ───────────────────────────────────    │
│ 제목        Notice │ 본문 내용...                            │
│                    │                                         │
│ [+ 공지 작성]      │                          [삭제] [편집] │
├────────────────────┴─────────────────────────────────────────┤
│ ☐ 오늘 하루 보지 않기                               [확인] │
└──────────────────────────────────────────────────────────────┘
```

- `[확인]` 또는 `[×]` 클릭 시 모달 닫힘.
- `[×]` 와 overlay 클릭은 체크박스 무관하게 "미체크"로 처리.
- 체크박스 체크 + `[확인]` → 내일 자정까지 자동 오픈 억제.
- MASTER 역할만 작성/편집/삭제 버튼 노출.

---

## 5. Navbar 배지

- 앱 마운트 시 `/api/notices/latest/` 호출 → `shouldShowNotice(updated_at)` 결과가 `true`이면 빨간 점 배지 표시.
- 모달 닫히면 `notice-read` 이벤트 수신 → 배지 즉시 제거 (세션 유지 중 재표시 없음).
- 다음 접속(앱 재마운트) 때 다시 평가.

---

*공지 로직이 바뀌면 이 문서를 반드시 함께 갱신한다.*
