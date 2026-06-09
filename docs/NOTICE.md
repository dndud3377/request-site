# NOTICE.md — 공지사항/가이드 기능 가이드

## 개요

두 가지 독립적인 기능으로 구성된다:
- **AdminNotice**: 공지사항/릴리즈 노트 게시 (MASTER만 작성)
- **Guide**: 기능별·정보성 가이드 문서 관리 (슬라이드 패널로 표시)

---

## 관련 파일

### Backend
| 파일 | 역할 |
|------|------|
| `backend/api/models.py` | `AdminNotice`, `Guide` 모델 |
| `backend/api/views.py` | `AdminNoticeViewSet`, `GuideViewSet` |
| `backend/api/serializers.py` | `AdminNoticeSerializer`, `GuideSerializer` |

### Frontend
| 파일 | 역할 |
|------|------|
| `frontend/src/pages/GuidePage.tsx` | 가이드 관리 (작성/편집/삭제) |
| `frontend/src/components/GuideSlidePanel.tsx` | 가이드 슬라이드 패널 (각 페이지에서 호출) |
| `frontend/src/components/RichTextEditor.tsx` | HTML 콘텐츠 편집기 |
| `frontend/src/locales/ko.json` / `en.json` | `notice.*` 키 |

---

## API Endpoints

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/notices/` | 공지사항 목록 |
| POST | `/api/notices/` | 공지사항 생성 (MASTER만) |
| GET | `/api/notices/latest/` | 최신 공지 1개 |
| PATCH | `/api/notices/{id}/` | 공지사항 수정 (MASTER만) |
| DELETE | `/api/notices/{id}/` | 공지사항 삭제 (MASTER만) |
| GET | `/api/guides/` | 가이드 목록 |
| POST | `/api/guides/` | 가이드 생성 (인증 필요) |
| GET | `/api/guides/?guide_type=feature&feature_key=` | 타입/키 필터 조회 |
| PATCH | `/api/guides/{id}/` | 가이드 수정 (인증 필요) |
| DELETE | `/api/guides/{id}/` | 가이드 삭제 (MASTER만) |

---

## 주요 모델

### AdminNotice
| 필드 | 타입 | 설명 |
|------|------|------|
| `template` | CharField | `notice` / `release_note` |
| `date` | DateField | 공지 날짜 |
| `title` | CharField | 제목 |
| `content` | TextField | 내용 (notice 템플릿용) |
| `items` | JSONField | 릴리즈 항목 목록 (release_note 템플릿용) |

### Guide
| 필드 | 타입 | 설명 |
|------|------|------|
| `guide_type` | CharField | `feature` (기능 가이드) / `info` (정보 가이드) |
| `feature_key` | CharField | 기능 고유 키 (feature 타입일 때 사용, unique) |
| `title` | CharField | 가이드 제목 |
| `content` | TextField | HTML 형식 가이드 내용 |
| `author_name` | CharField | 작성자 이름 |
| `author_role` | CharField | 작성자 역할 |

---

## 주요 로직 및 제약 조건

- **AdminNotice 템플릿**:
  - `notice`: `content` 필드 사용 (일반 텍스트/HTML)
  - `release_note`: `items` JSON 필드 사용 (항목별 릴리즈 내용)
- **Guide feature_key**: `guide_type=feature`일 때 고유 키로 특정 기능 페이지에서 가이드를 직접 링크할 수 있다.
- **권한**:
  - 읽기: 인증된 모든 사용자
  - 쓰기(생성/수정): 인증 필요
  - 삭제: MASTER만 가능
- **GuideSlidePanel**: 각 페이지에서 `feature_key`로 해당 기능 가이드를 조회하여 슬라이드 패널로 표시한다.

---

## 수정 시 주의사항

- `AdminNotice.template` 값 추가 시 프론트엔드 렌더링 분기 로직(`GuidePage.tsx`)도 함께 수정한다.
- `Guide.feature_key`는 각 페이지와 연동되어 있으므로 변경 시 해당 페이지 컴포넌트의 키 참조도 확인한다.
- `RichTextEditor`는 `REQUEST.md`의 의뢰서 작성과 공유 컴포넌트이므로 수정 시 양쪽 모두 영향을 받는다.
- `items` JSON 구조 변경 시 기존 릴리즈 노트 데이터 마이그레이션 여부를 반드시 확인한다.

---

## 완료 후 필수 처리

1. **이 파일(`docs/NOTICE.md`)을 반드시 최신 내용으로 업데이트한다.**
2. **`CLAUDE.md`를 다시 읽은 후 반드시 "다음 작업은 무엇인가요?" 라고 묻는다.**
