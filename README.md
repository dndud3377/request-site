# 제품 소개 지도 의뢰 시스템
# Product Introduction Map Request System

제품의 소개 지도 제작을 위한 의뢰서를 작성하고 상신하는 웹 플랫폼입니다.

## 기술 스택

- **Backend**: Django 4.2 + Django REST Framework
- **Frontend**: React 18 + react-i18next
- **Database**: PostgreSQL 15
- **Server**: Nginx
- **Container**: Docker + Docker Compose

## 주요 기능

- 📝 의뢰서 작성 (임시저장 / 상신)
- 📧 상신 시 담당자 이메일 자동 발송
- 📋 결재 현황 조회
- 📂 이력 조회
- 💬 VOC (Voice of Customer) 등록
- 📖 RFG (Request For Guide) 등록
- 🌐 한국어 / 영어 다국어 지원
- 🎨 다크 블루 테마

## 빠른 시작

### 1. 환경변수 설정

```bash
cp .env.example .env
# .env 파일을 편집하여 이메일, DB 비밀번호 등을 설정하세요
```

### 2. Docker Compose 실행

```bash
docker-compose up -d --build
```

### 3. 접속

- 웹사이트: http://localhost
- Django Admin: http://localhost/admin

### Admin 계정 생성

```bash
docker-compose exec backend python manage.py createsuperuser
```

## 이메일 설정

`.env` 파일에서 이메일 설정을 구성하세요:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password
APPROVAL_EMAIL_LIST=approver@company.com
```

Gmail 사용 시 앱 비밀번호를 생성하여 사용하세요.

## 개발 환경

### Backend 개발

```bash
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

### Frontend 개발

```bash
cd frontend
npm install
REACT_APP_API_URL=http://localhost:8000/api npm start
```

## 페이지 구성

| 경로 | 페이지 | 설명 |
|------|--------|------|
| `/` | 홈 | 메인 대시보드, 통계 |
| `/intro` | 소개 | 시스템 소개, 사용 가이드 |
| `/request` | 의뢰서 작성 | 제품 소개 지도 의뢰서 작성 |
| `/approval` | 결재 현황 | 상신된 의뢰서 결재 상태 |
| `/history` | 이력 조회 | 전체 의뢰 이력 |
| `/voc` | VOC | 고객의 소리 등록 |
| `/rfg` | RFG | 가이드 제작 요청 |
