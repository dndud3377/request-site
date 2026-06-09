# VOC.md — VOC (Voice of Customer) 기능 가이드

## 개요

사용자가 문의/오류 신고/기능 제안/작업 요청을 접수하고, 담당자가 처리 이력을 관리하는 기능이다.
댓글 기능과 처리 이력 추적을 지원한다.

---

## 관련 파일

### Backend
| 파일 | 역할 |
|------|------|
| `backend/api/models.py` | `VOC`, `VocComment`, `VocHistory` 모델 |
| `backend/api/views.py` | `VOCViewSet`, `VocHistoryViewSet` |
| `backend/api/serializers.py` | `VOCSerializer`, `VocCommentSerializer`, `VocHistorySerializer` |

### Frontend
| 파일 | 역할 |
|------|------|
| `frontend/src/pages/VOCPage.tsx` | VOC 접수 및 관리 전체 |
| `frontend/src/locales/ko.json` / `en.json` | `voc.*` 키 |

---

## API Endpoints

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/voc/` | VOC 목록 |
| POST | `/api/voc/` | VOC 생성 |
| GET | `/api/voc/{id}/` | VOC 상세 조회 |
| PATCH | `/api/voc/{id}/` | VOC 수정 |
| POST | `/api/voc/{id}/comment/` | 댓글 추가 |
| GET | `/api/voc-histories/` | 처리 이력 목록 |
| POST | `/api/voc-histories/` | 처리 이력 생성 |
| GET | `/api/voc-histories/by_voc/?voc_id=` | 특정 VOC 처리 이력 |

---

## 주요 모델

### VOC
| 필드 | 타입 | 설명 |
|------|------|------|
| `title` | CharField | VOC 제목 |
| `category` | CharField | `inquiry` / `error_report` / `feature_request` / `task_request` |
| `submitter_name` | CharField | 제출자 이름 |
| `submitter_email` | EmailField | 제출자 이메일 |
| `submitter_user_id` | CharField | 제출자 user ID |
| `page` | CharField | 관련 페이지: `request` / `approval` / `history` / `other` |
| `content` | TextField | 내용 |
| `response` | TextField | 응답 내용 |
| `status` | CharField | `checking` / `completed` / `rejected` |
| `responded_at` | DateTimeField | 응답 일시 |

### VocComment
| 필드 | 타입 | 설명 |
|------|------|------|
| `voc_fk` | FK | 연결된 VOC |
| `author_name` | CharField | 작성자 이름 |
| `author_role` | CharField | 작성자 역할 |
| `is_submitter` | BooleanField | 제출자 여부 |
| `content` | TextField | 댓글 내용 |
| `is_reject_reason` | BooleanField | 반려 사유 댓글 여부 |

### VocHistory
| 필드 | 타입 | 설명 |
|------|------|------|
| `voc_fk` | FK | 연결된 VOC |
| `action` | CharField | `checking` / `completed` / `rejected` |
| `acted_at` | DateTimeField | 처리 일시 |
| `comment` | TextField | 처리 의견 |
| `assignee_fk` | FK | 담당자 (UserProfile) |
| `assignee_name` | CharField | 담당자 이름 |

---

## 주요 로직 및 제약 조건

- **카테고리**: `inquiry`(문의) / `error_report`(오류 신고) / `feature_request`(기능 제안) / `task_request`(작업 요청)
- **상태 흐름**: `checking` → `completed` 또는 `rejected`
- **댓글**: 제출자(`is_submitter=true`)와 스태프 구분, 반려 사유는 `is_reject_reason=true`로 플래그.
- **처리 이력**: 상태 변경마다 `VocHistory` 레코드 생성으로 이력 추적.

---

## 수정 시 주의사항

- `category`, `page`, `status` 값 추가/변경 시 `ko.json` / `en.json` i18n 키도 반드시 함께 업데이트한다.
- `VocComment.is_reject_reason` 플래그는 UI에서 반려 사유를 별도 표시하는 데 사용되므로 삭제하지 않는다.
- VOC 접근 권한(본인 것만 vs. 전체 조회)을 변경할 경우 ViewSet의 `get_queryset()`을 확인한다.

---

## 완료 후 필수 처리

1. **이 파일(`docs/VOC.md`)을 반드시 최신 내용으로 업데이트한다.**
2. **`CLAUDE.md`를 다시 읽은 후 반드시 "다음 작업은 무엇인가요?" 라고 묻는다.**
