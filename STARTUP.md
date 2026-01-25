# Star-WebCNC 실행 가이드

## 빠른 시작 (Quick Start)

### 1. 인프라 실행 (Docker)

```bash
cd docker
docker-compose up -d
```

PostgreSQL (5432), Redis (6379), MQTT (1883) 서비스가 시작됩니다.

### 2. 서버 실행

```bash
cd packages/server

# 의존성 설치 (최초 1회)
npm install

# Prisma 클라이언트 생성
npm run db:generate

# DB 마이그레이션
npm run db:push

# 테스트 데이터 Seed
npm run db:seed

# 서버 실행
npm run dev
```

서버가 http://localhost:3000 에서 실행됩니다.

### 3. 프론트엔드 실행

```bash
cd packages/web

# 의존성 설치 (최초 1회)
npm install

# 개발 서버 실행
npm run dev
```

브라우저에서 http://localhost:5173 접속

---

## 테스트 계정

| 역할 | 아이디 | 비밀번호 | 권한 |
|------|--------|----------|------|
| Admin | admin | admin123! | 전체 관리 |
| AS | as_manager | as123! | 템플릿 관리, 전체 접근 |
| Operator | operator | user123! | 모니터링 전용 |

---

## Seed 데이터

| 데이터 | 수량 |
|--------|------|
| 장비 | 4대 (MC-001 ~ MC-004) |
| 알람 | 5건 (활성 3건, 해제 2건) |
| 작업지시 | 5건 |
| 스케줄러 작업 | 4건 |
| 생산 로그 | 50건 |
| 감사 로그 | 30건 |

---

## 서비스 상태 확인

```bash
# Docker 컨테이너 상태
docker ps

# 서버 Health Check
curl http://localhost:3000/health

# Redis 연결 확인
docker exec star-webcnc-redis redis-cli ping

# PostgreSQL 연결 확인
docker exec star-webcnc-db pg_isready -U starwebcnc
```

---

## 종료

```bash
# 인프라 종료
cd docker
docker-compose down

# 데이터 포함 전체 삭제
docker-compose down -v
```

---

## 문제 해결

### 포트 충돌
기본 포트가 사용 중인 경우 `.env` 파일에서 변경:
- PostgreSQL: 5432
- Redis: 6379
- MQTT: 1883
- Server: 3000
- Frontend: 5173

### DB 초기화
```bash
cd packages/server
npx prisma migrate reset
npm run db:seed
```

### Prisma Studio (DB 확인)
```bash
cd packages/server
npm run db:studio
```
브라우저에서 http://localhost:5555 접속
