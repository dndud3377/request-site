# APPROVAL.md — 결재 현황 기능 가이드

## 개요

상신된 의뢰서에 대해 단계별 합의/반려/담당자 지정 처리를 하는 기능이다.
R → P+O(+E) 병렬 → J 순서로 결재가 진행되며, 업무일 기준 due_date가 자동 계산된다.

---

## 관련 파일

### Backend
| 파일 | 역할 |
|------|------|
| `backend/api/models.py` | `ApprovalStep`, `Holiday` 모델 |
| `backend/api/views.py` | `RequestDocumentViewSet.approve_step()` / `reject_step()` / `assign_step()` |
| `backend/api/serializers.py` | `ApprovalStepSerializer` |
| `backend/api/utils.py` | `calculate_business_due_date()` (업무일 계산) |

### Frontend
| 파일 | 역할 |
|------|------|
| `frontend/src/pages/ApprovalPage.tsx` | 결재 대기 의뢰서 목록 및 상세 |
| `frontend/src/components/ApprovalFlow.tsx` | 결재 단계 시각화 및 처리 UI |
| `frontend/src/locales/ko.json` / `en.json` | `approval.*` 키 |

---

## API Endpoints

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/documents/?status=under_review` | 결재 대기 의뢰서 목록 |
| GET | `/api/documents/{id}/` | 의뢰서 + 결재 단계 상세 |
| POST | `/api/documents/{id}/approve-step/` | 단계 합의 |
| POST | `/api/documents/{id}/reject-step/` | 단계 반려 |
| POST | `/api/documents/{id}/assign-step/` | 담당자 지정 |

---

## 주요 모델

### ApprovalStep
| 필드 | 타입 | 설명 |
|------|------|------|
| `document_fk` | FK | 연결된 RequestDocument |
| `agent` | CharField | 결재자 역할: `R` / `P` / `J` / `O` / `E` |
| `action` | CharField | `pending` / `approved` / `rejected` |
| `acted_at` | DateTimeField | 처리 일시 |
| `comment` | TextField | 의견 |
| `is_parallel` | BooleanField | 병렬 처리 여부 (P, O, E는 병렬) |
| `assignee_fk` | FK | 담당자 (UserProfile) |
| `assignee_name` | CharField | 담당자 이름 |
| `round` | IntegerField | 결재 라운드 |
| `due_date` | DateField | 처리 기한 (업무일 기준) |

---

## 결재 플로우

```
상신 (under_review)
  └─ R 합의
       └─ P (due: +4영업일)
          O (due: +6영업일)   ← 병렬 생성
          E (due: +6영업일)   ← PLEL 조건 있을 때만 생성
            └─ P 합의
                 └─ J (due: +4영업일)
                      └─ J + O + [E] 모두 합의 → approved
```

- **반려**: 어느 단계에서든 반려 시 `rejected` 상태로 변경, 요청자에게 알림.
- **담당자 미지정**: `assignee_fk=null`이면 `unassigned` 상태로 표시.
- **due_date**: `Holiday` 모델 기반 공휴일 제외 영업일 계산.

---

## 수정 시 주의사항

- 결재 플로우 변경 시 `REQUEST.md`의 `has_ppid_plel()` 로직도 함께 확인한다.
- `calculate_business_due_date()` 수정 시 Holiday 모델 동기화 여부를 확인한다.
- `assign_step()` 변경 시 권한 관리(PERMISSION) 기능의 role 체계와 일관성을 유지한다.
- due_date CSS 클래스(미정/오버듀/당일)는 `ApprovalFlow.tsx`에서 관리한다.

---

## 완료 후 필수 처리

1. **이 파일(`docs/APPROVAL.md`)을 반드시 최신 내용으로 업데이트한다.**
2. **`CLAUDE.md`를 다시 읽은 후 반드시 "다음 작업은 무엇인가요?" 라고 묻는다.**
