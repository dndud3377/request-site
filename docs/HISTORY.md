# HISTORY.md — 이력 조회 기능 가이드

## 개요

승인 완료(`approved`)된 의뢰서 목록을 조회하고, 상세 내용 및 결재 이력을 확인하는 기능이다.
별도 모델 없이 `RequestDocument` + `ApprovalStep`을 그대로 활용한다.

---

## 관련 파일

### Backend
| 파일 | 역할 |
|------|------|
| `backend/api/models.py` | `RequestDocument`, `ApprovalStep` 모델 (공유) |
| `backend/api/views.py` | `RequestDocumentViewSet` (list + detail, status 필터) |
| `backend/api/serializers.py` | `RequestDocumentListSerializer`, `RequestDocumentSerializer` |

### Frontend
| 파일 | 역할 |
|------|------|
| `frontend/src/pages/HistoryPage.tsx` | 승인 완료 의뢰서 목록 및 상세 |
| `frontend/src/components/PagedDetailView.tsx` | 페이지네이션된 상세 뷰 |
| `frontend/src/locales/ko.json` / `en.json` | `history.*` 키 |

---

## API Endpoints

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/documents/?status=approved` | 승인 완료 의뢰서 목록 |
| GET | `/api/documents/?status=approved&search=키워드` | 검색 (title, product_name, requester_name, requester_department) |
| GET | `/api/documents/{id}/` | 상세 조회 (결재 이력 포함) |
| DELETE | `/api/documents/{id}/` | 삭제 (MASTER만 approved 상태 삭제 가능) |

---

## 주요 기능 및 제약 조건

- **상태 필터**: `status=approved`로 고정하여 승인 완료 항목만 표시한다.
- **검색 필드**: `title`, `product_name`, `requester_name`, `requester_department` 대상으로 검색.
- **삭제 권한**: `approved` 상태 삭제는 MASTER 역할만 가능.
- **결재 이력**: 상세 조회 시 `ApprovalStep` 목록도 함께 반환된다.
- **직렬화**: 목록은 `RequestDocumentListSerializer`, 상세는 `RequestDocumentSerializer`를 사용한다.

---

## 수정 시 주의사항

- `HistoryPage`는 `RequestPage`, `ApprovalPage`와 동일한 백엔드 ViewSet을 사용하므로, ViewSet 수정 시 세 페이지 모두 영향을 받는다.
- 검색 로직 변경 시 `RequestPage`의 목록 검색에도 동일하게 적용되는지 확인한다.
- 페이지네이션 설정은 `PagedDetailView.tsx`에서 관리한다.

---

## 완료 후 필수 처리

1. **이 파일(`docs/HISTORY.md`)을 반드시 최신 내용으로 업데이트한다.**
2. **`CLAUDE.md`를 다시 읽은 후 반드시 "다음 작업은 무엇인가요?" 라고 묻는다.**
