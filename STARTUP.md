# Star-WebCNC 실행 가이드

## Windows 로그인 시 자동 시작

- 웹앱 **설정 → Windows 로그인 시 자동 시작**에서 등록한다. PC·모바일·태블릿 모두 같은 서버 PC 설정을 변경하며, 변경은 `HQ_ENGINEER`만 가능하다. `ADMIN`은 상태만 조회한다.
- 서버를 실행한 Windows 계정의 **로그인 시점**에 예약 작업이 실행된다. 전원을 켜기만 하고 해당 계정으로 로그인하지 않으면 시작되지 않는다. Windows 자동 로그인이나 업데이트 정책을 바꾸지는 않는다.
- 체크하면 실제 Windows 예약 작업을 등록하고 등록 결과를 다시 확인한다. 권한 부족 시 오류를 표시하며 체크된 것으로 저장하지 않는다. 최초 설치에서 권한이 필요하면 서버 PC에서 같은 Windows 계정으로 관리자 PowerShell을 열어 다음을 실행한다.

```powershell
cd C:\Star-WebCNC
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/windows-startup.ps1 -Action Enable
```

- Node.js(`process.loadEnvFile` 지원 버전), .NET 8 Runtime, Docker Desktop, 프로젝트 의존성 및 Agent 배포본이 설치되어 있어야 한다. 현재 개발 배포 구조의 API(3000)와 Vite(5173)를 사용한다. 설치형 제품용 Windows 서비스 전환은 별도 작업이다.
- Docker → DB·Redis·MQTT → API → 웹앱·설비별 Agent 순으로 준비 상태를 확인한다. 늦게 준비되는 항목은 15초마다 다시 확인하며, 이미 실행 중인 항목을 종료하거나 중복 기동하지 않는다. 기존 MC-002 전용 배포본의 `active` 표시와 수집 주기 설정을 유지한다.
- 현재 활성 `.60` 카메라 파일럿 컨테이너도 시작한다. 컨테이너가 없다면 DB에 저장된 카메라 접속 정보를 환경 변수로 전달해 생성한다. 이 기능은 다른 카메라 구성으로 확대하는 작업을 포함하지 않는다.
- 체크 해제는 다음 로그인부터 자동 시작하지 않도록 설정하고 기동 관리자를 종료한다. 이미 실행한 웹앱·API·Agent·컨테이너는 계속 실행한다. 체크만으로 즉시 기동하지는 않는다.
- 예약 작업 이름은 `Star-WebCNC-Startup-<설치 경로 해시>`이며 비밀번호를 저장하지 않는 현재 사용자·일반 권한 작업이다. 경로나 Windows 계정을 바꾸면 재등록이 필요하다.
- 로그: `agent-runtime/startup/startup.log`, `api.log`, `web.log`, `MC-xxx.log`. 마지막 확인 결과는 `status.json`에 기록된다. 로그와 실행 설정 파일은 배포 소스로 커밋하지 않는다.
- 2026-11-23 검증: 서버·웹 빌드, 실제 예약 작업 수동 실행, API·MQTT·Redis 준비, Agent 4개 기동, 관리자 조회/변경 권한 제한, 설정 활성화·해제, 중복 관리자 실행 방지를 확인했다. 실제 Windows 재부팅 및 모바일 화면 조작 검증은 미실시다.

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
| ADMIN | admin | admin123! | 전체 관리 |
| HQ_ENGINEER | as_manager | as123! | 템플릿 관리, 전체 접근 |
| USER | operator | user123! | 모니터링 전용 |

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

### 스키마 변경 후 재동기화
```bash
cd packages/server
# 개발 환경: 스키마를 DB에 직접 반영 (마이그레이션 파일 없이)
npx prisma db push

# 운영 환경: 마이그레이션 파일 생성 후 적용
npx prisma migrate dev --name <변경내용>
```

### Prisma Studio (DB 확인)
```bash
cd packages/server
npm run db:studio
```
브라우저에서 http://localhost:5555 접속

---

## WebSocket 실시간 연결

로그인 후 자동으로 `ws://localhost:5173/ws` (Vite 프록시 → `ws://localhost:3000/ws`)에 연결됩니다.

- 인증: `?token=<JWT_ACCESS_TOKEN>` 쿼리 파라미터
- 구독: 로그인 직후 모든 장비 ID에 자동 구독
- 재연결: 연결 끊김 시 5초마다 자동 재시도

개발 모드 (`dev-token`)에서는 WebSocket 연결을 시도하지 않습니다.

---

## 통합 연동 검증 절차

### 1. 시스템 진단 (웹 UI)

1. 관리자 계정으로 로그인
2. **설정(Settings)** 페이지 이동
3. 하단 **시스템 진단** 카드에서 **"점검 실행"** 클릭
4. 서비스 상태 확인:
   - 데이터베이스: 초록색 + 응답시간 표시
   - Redis: 초록색
   - MQTT 브로커: 초록색
   - WebSocket: 클라이언트 수 표시

### 2. Agent 연결 검증

1. Agent 프로세스 시작 (`packages/agent/StarWebCNC.Agent/`)
   ```bash
   dotnet run --project packages/agent/StarWebCNC.Agent
   ```
2. 설정 페이지 진단에서 장비 행의 **PING** 버튼 클릭
3. Agent가 살아있으면 **PONG** 응답 (5초 이내)

### 3. 실장비 CNC 연동 확인

Agent가 CNC에 정상 연결되면:
- 텔레메트리 컬럼에 **"N초 전"** 표시 (초록 + 깜빡임)
- 대시보드에 실시간 가동 상태, 피드율, 스핀들 RPM 표시

MQTT 토픽 구조:
```
star-webcnc/agent/{machineId}/telemetry       ← CNC 상태 (60초 TTL)
star-webcnc/agent/{machineId}/alarm           ← 알람 발생/해제
star-webcnc/agent/{machineId}/command/result  ← 명령 실행 결과
star-webcnc/server/command/{machineId}        → 명령 송신
```

### 4. 명령 흐름 E2E curl 검증

```bash
# 로그인해서 토큰 획득
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123!"}' \
  | jq -r '.data.accessToken')

# PING 명령 전송 (Agent 응답 5초 동기 대기)
curl -X POST "http://localhost:3000/api/commands/MC-001?wait=true&timeout=5000" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"PING"}'
# 정상: {"success":true,"data":{"status":"SUCCESS","result":{"pong":true,...}}}

# CNC 프로그램 목록 조회 (FOCAS2)
curl -X POST "http://localhost:3000/api/commands/MC-001?wait=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"LIST_PROGRAMS"}'

# 시스템 진단 API 직접 호출
curl http://localhost:3000/api/diagnostics \
  -H "Authorization: Bearer $TOKEN"
```
