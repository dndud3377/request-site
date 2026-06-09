# REQUEST.md — 의뢰서 작성 기능 가이드

## 개요

의뢰서(RequestDocument)를 작성, 임시저장, 상신, 철회, 재상신하는 기능이다.
외부 DB(Cloudera Impala ODBC)에서 동기화된 form_options 데이터를 기반으로 드롭다운을 구성한다.

---

## 관련 파일

### Backend
| 파일 | 역할 |
|------|------|
| `backend/api/models.py` | `RequestDocument` 모델 |
| `backend/api/views.py` | `RequestDocumentViewSet`, `form_options` 함수들 |
| `backend/api/serializers.py` | `RequestDocumentSerializer`, `RequestDocumentListSerializer` |

### Frontend
| 파일 | 역할 |
|------|------|
| `frontend/src/pages/RequestPage.tsx` | 의뢰서 작성/편집 폼 전체 |
| `frontend/src/components/RichTextEditor.tsx` | HTML 에디터 (reference_materials 등) |
| `frontend/src/components/AutocompleteInput.tsx` | 자동완성 입력 |
| `frontend/src/components/FormSelect.tsx` | 드롭다운 선택 |
| `frontend/src/locales/ko.json` / `en.json` | `request.*` 키 |

---

## API Endpoints

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/documents/` | 의뢰서 목록 (본인 것만) |
| POST | `/api/documents/` | 의뢰서 생성 (draft) |
| GET | `/api/documents/{id}/` | 의뢰서 상세 조회 |
| PATCH | `/api/documents/{id}/` | 의뢰서 수정 |
| DELETE | `/api/documents/{id}/` | 의뢰서 삭제 |
| POST | `/api/documents/{id}/submit/` | 상신 (draft → under_review) |
| POST | `/api/documents/{id}/resubmit/` | 재상신 (rejected → under_review) |
| POST | `/api/documents/{id}/withdraw/` | 철회 (under_review → draft) |
| GET | `/api/documents/stats/` | 상태별 통계 |
| GET | `/api/form-options/processes/?line=` | Line별 Process 목록 |
| GET | `/api/form-options/products/?line=&process=` | Process별 Product 목록 |
| GET | `/api/form-options/process-id/?line=&product=` | Product별 Process ID |
| GET | `/api/form-options/job-file-layer/` | Job File Layer 정보 |
| GET | `/api/form-options/ovl-layer/` | OVL Layer 정보 |
| GET | `/api/form-options/bb-external/` | BB 외부 데이터 |
| GET | `/api/form-options/layer-ids/` | Layer ID 목록 |
| GET | `/api/form-options/barcode/` | Barcode 옵션 |

---

## 주요 모델

### RequestDocument
| 필드 | 타입 | 설명 |
|------|------|------|
| `title` | CharField | 의뢰서 제목 (중복 시 suffix 자동 추가: `_2`, `_3`, ...) |
| `requester_*` | CharField | 요청자 이름/소속/부서/이메일 |
| `product_name` | CharField | 제품명 |
| `reference_materials` | TextField | 참고 자료 (HTML) |
| `additional_notes` | JSONField | 상세 폼 데이터 (jayerRows, bbRows 등) |
| `status` | CharField | `draft` / `submitted` / `under_review` / `approved` / `rejected` |
| `production_date` | DateField | 생산 날짜 |
| `submitted_at` | DateTimeField | 상신 일시 |

---

## 주요 로직 및 제약 조건

- **제목 중복 방지**: 같은 제목 존재 시 `_2`, `_3`, ... suffix 자동 추가.
- **PLEL 조건 확인**: `has_ppid_plel()` 메서드로 특정 pp 포함 여부 체크. PLEL 있으면 결재 시 E 단계가 추가된다.
- **상신 전 유효성 검사**: 모든 J-layer 행이 BB로 매핑되어야 상신 가능.
- **additional_notes**: JSON 형식으로 복잡한 폼 데이터(jayerRows, bbRows 등)를 저장.
- **form_options**: 외부 DB(Cloudera Impala)에서 1시간마다 스케줄러로 동기화. `ProcessProduct`, `ProductProcessId`, `PhotoStep`, `ProductBarcode` 모델에 저장.
- **삭제 권한**: `approved` 상태는 MASTER만 삭제 가능.

---

## 수정 시 주의사항

- `additional_notes` JSON 구조 변경 시 기존 데이터 마이그레이션 여부를 반드시 확인한다.
- `form_options` 관련 수정 시 외부 DB 스키마 변경 여부도 함께 확인한다.
- 상태 전이 로직(`submit`, `resubmit`, `withdraw`) 변경 시 `ApprovalPage` 흐름에 영향을 미친다.
- `RequestDocumentListSerializer`와 `RequestDocumentSerializer`는 용도가 다르므로 혼용하지 않는다.

---

## 완료 후 필수 처리

1. **이 파일(`docs/REQUEST.md`)을 반드시 최신 내용으로 업데이트한다.**
2. **`CLAUDE.md`를 다시 읽은 후 반드시 "다음 작업은 무엇인가요?" 라고 묻는다.**
