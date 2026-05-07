# BRIEFING.md
# Star-WebCNC 프로젝트 브리핑 문서

> 작업 시작 전 반드시 이 문서를 읽고 현재 상태를 파악할 것.
> 코드 작업 전 `KNOWN_MISTAKES.md`의 체크리스트도 함께 확인.

---

## 1. 프로젝트 개요

**프로젝트명**: Star-WebCNC  
**목적**: FANUC CNC 공작기계(자동선반)를 웹 기반으로 원격 모니터링·제어·스케줄링하는 산업용 MES/SCADA 시스템

### 폴더 구조

```
c:\Star-WebCNC\
├── packages/
│   ├── web/                     # React 18 프론트엔드
│   │   └── src/
│   │       ├── pages/           # 15개 페이지
│   │       ├── components/      # 재사용 컴포넌트 (NCMonitor, CameraStream 등)
│   │       ├── stores/          # Zustand 상태 관리 (6개 스토어)
│   │       └── lib/             # API 클라이언트, WebSocket 싱글턴
│   ├── server/                  # Node.js Express 백엔드
│   │   └── src/
│   │       ├── routes/          # 15개 API 라우트
│   │       ├── lib/             # mqtt, websocket, prisma, redis 클라이언트
│   │       ├── auth/            # JWT 발급/검증
│   │       └── prisma/          # schema.prisma, migrations, seed.ts
│   └── agent/
│       └── StarWebCNC.Agent/    # C# .NET 8 FOCAS2 에이전트
│           ├── Collectors/      # DataCollectorService (메인 수집 루프)
│           ├── Commands/        # CommandHandler (NC 명령 처리)
│           ├── Configuration/   # AgentSettings, appsettings.json
│           ├── Focas/           # FocasConnection, FocasDataReader
│           ├── Mqtt/            # MqttService
│           └── Template/        # TemplateModel, TemplateLoader
├── KNOWN_MISTAKES.md            # 반복 실수 방지 규칙 (M-01~M-21)
├── BRIEFING.md                  # 이 파일
└── start-all.bat / start-dev.bat
```

---

## 2. 아키텍처

### 4-Tier 전체 흐름

```
[Browser / React]
     ↕ REST API (HTTP)
     ↕ WebSocket (실시간 텔레메트리·알람·이벤트)
[Node.js Express Server]
     ↕ MQTT (star-webcnc/agent/{machineId}/...)
     ↕ PostgreSQL (Prisma ORM)
     ↕ Redis (캐시, 제어권 관리)
[C# .NET 8 Agent]  — 1 Agent = 1 CNC
     ↕ FOCAS2 (FANUC 전용 CNC 통신 라이브러리)
[FANUC CNC 장비]
```

### MQTT 토픽 구조 (장비 ID 기준 분리)

```
star-webcnc/agent/{machineId}/status          Agent → Server
star-webcnc/agent/{machineId}/telemetry       Agent → Server
star-webcnc/agent/{machineId}/pmc_bits        Agent → Server (100ms)
star-webcnc/agent/{machineId}/alarm           Agent → Server
star-webcnc/agent/{machineId}/command/result  Agent → Server
star-webcnc/agent/{machineId}/event           Agent → Server

star-webcnc/server/command/{machineId}        Server → Agent
star-webcnc/server/scheduler/{machineId}      Server → Agent
```

### 기술 스택

| 레이어 | 기술 |
|--------|------|
| **Frontend** | React 18.2, TypeScript 5.3, Vite 5.0, Zustand 4.5, Tailwind CSS 3.4, Recharts 2.10, Axios 1.6 |
| **Backend** | Node.js, Express 4.18, Prisma 5.9, PostgreSQL (TimescaleDB), Redis (ioredis 5.3), MQTT 5.3, WebSocket (ws 8.16), JWT (jsonwebtoken 9.0), Zod, FFmpeg (ffmpeg-static 5.3) |
| **Agent** | .NET 8.0 (win-x64), MQTTnet 4.3, FOCAS2 (Fwlib64.dll), Microsoft.Extensions.Hosting |
| **인프라** | Docker (PostgreSQL + Mosquitto MQTT 브로커), Redis (native 실행), Windows 배포 |

---

## 3. 현재 구현 완료된 기능

### 인증 / 사용자 관리
- JWT 기반 로그인/로그아웃 (access 15분, refresh 7일)
- 역할: `USER`, `HQ_ENGINEER`, `ADMIN`
- 회원가입 승인 흐름 (isApproved 플래그)
- HQ_ENGINEER 등록 코드 (`hq1234`)

### 설비 관리
- 설비 등록 / 삭제 (MachineAdmin.tsx)
- 설비 목록 조회, 실시간 온라인/오프라인 상태 표시
- 제어권 획득/해제/연장 (Redis 기반, 세션 단위)
- ⚠️ 설비 **편집(IP·이름 등 수정)** 미구현 — 항목 5 참조

### 실시간 모니터링
- FOCAS2 → Agent → MQTT → Server → WebSocket → 브라우저 경로
- 텔레메트리: 좌표, 이송속도, 주축 RPM, 프로그램 번호 등 (500ms)
- PMC 비트: 램프·인터락 신호 (100ms, 별도 `pmc_bits` 토픽)
- 알람: 실시간 발생/해제, 이력 조회

### NC 모니터 (NCMonitor 컴포넌트)
- 좌표 / 상태 탭 (Path1, Path2)
- 오프셋(Wear Offset) 탭 — 읽기/쓰기
  - ⚠️ IDLE 상태에서 쓰기 미동작 이슈 있음 — 항목 5 참조
- 카운터 탭 — 읽기/쓰기
- 공구수명 탭 — 읽기/쓰기
- 카메라 탭

### 스케줄러
- 큐 기반 NC 프로그램 자동 실행 (SchedulerManager 상태 머신)
- 상태: IDLE / RUNNING / PAUSED / ERROR
- 행 추가/편집/삭제/순서 변경, 가동 중 행 추가 허용
- Path2Only 모드, 원사이클 스톱 지원
- M20 이벤트 기반 카운트 증가

### 파일 전송 (DNC)
- Repository / Share 저장소 파일 관리
- NC 프로그램 업로드(PC→CNC) / 다운로드(CNC→PC)
- DNC 가동 중 Repository 읽기 전용 잠금

### 카메라
- RTSP → FFmpeg → MJPEG 스트림 프록시
- 카메라 설정 (IP, 포트, RTSP 경로, 인증)
- 장비별 카메라 매핑
- FFmpeg stdout 워치독 (10초 무데이터 → 강제 재시작)
- 스트림 중복 방지 (force=true 강제 교체)

### 인터락 / 템플릿
- 템플릿 기반 PMC 인터락 설정 (페이지별 topBarInterlock)
- 탑바 인터락 pills 실시간 표시
- PMC 메시지 AlarmStrip 표시
- ExtraPmcAddrs 파이프라인 (커스텀 PMC 주소 수집)

### Simtos 2026 모드
- 제품 카드 롱프레스 → NC 프로그램 변경 + 사이클 스타트
- 제어권/인터락 미충족 시 팝업 경고
- 태블릿 전용 반응형 레이아웃 (xl: 1280px 기준 분기)

### Monitoring 페이지
- NC 모니터(좌) + 카메라(우) + 이벤트 로그(하단) 3분할
- 모바일 portrait 탭 바 + 스와이프 제스처

### 기타
- 감사 로그 (AuditLog)
- 생산 통계 / POP 화면
- 작업 지시서 (WorkOrder)
- 백업 관리
- 진단 페이지 (서비스 상태, Agent ping)
- 팩토리 뷰 (설비 배치 레이아웃)
- 인터락 에디터 (페이지별 인터락 설정 UI)

---

## 4. 미구현 / 진행 중인 기능

| 항목 | 상태 | 비고 |
|------|------|------|
| 설비 편집 UI | ✅ 완료 | 편집 버튼 + 모달. IP 변경 경고 포함 |
| Offset IDLE 쓰기 | ⚠️ 이슈 | RUNNING 시만 동작. 항목 5 참조 |
| MQTT 브로커 주소 환경변수 외부화 | ⚠️ 부분 | .NET 이중언더스코어(`Agent__Mqtt__Host`) 방식은 동작하나 `MQTT_BROKER_HOST` 커스텀 이름 미지원 |
| 다중 CNC Agent 내 처리 | ❌ 미구현 | 현재 1 Agent = 1 CNC. 다중은 Agent 다중 실행으로 대응 |
| TemplateEditor Section 8 (스케줄러 설정 UI) | ❌ 미구현 | 백엔드/Agent 스케줄러 설정 구조는 완성됨 |
| cameraApi.create/update/delete (api.ts) | ⚠️ 미확인 | `cameraApi`에 WebRTC 관련 메서드가 남아있음 (실제 서버는 MJPEG만 지원) |

---

## 5. 현재 알려진 이슈

### [I-01] ~~설비 편집 UI 미구현~~ ✅ 완료 (2026-05-02)

- `machineApi.update()` 추가 (`api.ts`)
- 편집 버튼(연필 아이콘) + 편집 모달 추가 (`MachineAdmin.tsx`)
- IP 변경 시 Agent 재시작 필요 경고 배너 표시
- 권한: HQ_ENGINEER + ADMIN 모두 허용

### [I-02] Offset 쓰기 IDLE 상태에서 미동작

- **증상**: NC 모니터 오프셋 탭에서 값 입력 시 RUNNING 중에는 정상 반영, IDLE 상태에서는 값이 전송되지 않음. RUNNING 진입 후 전송되는 것처럼 보임.
- **추정 원인**: FANUC `cnc_wrmacro`가 시스템 매크로 변수(#2001~#2464)를 AUTO 실행 상태 외에서는 내부적으로 차단하거나 무시하는 CNC 사양 특성
- **현재 코드**: `FocasDataReader.cs` `WriteWearOffset()` → `cnc_wrmacro()` — 실행 상태 사전 체크 없음
- **수정 방향 (미적용)**: 에이전트에서 run 상태 사전 체크 후 IDLE이면 즉시 WRITE_FAILED 반환 + 프론트 에러 피드백 추가

### [I-03] MQTT 브로커 주소 환경변수 비표준

- **현재 동작**: Agent는 .NET IConfiguration 기본 메커니즘(`Agent__Mqtt__Host`)으로만 오버라이드 가능
- **미구현**: 커스텀 이름(`MQTT_BROKER_HOST`) 환경변수를 명시적으로 읽는 코드 없음
- **영향 범위**: 다중 Agent 배포 시 각 Agent 설정 파일을 직접 수정해야 함

---

## 6. 다음 작업 예정 / 백로그

### [N-01] 설비 편집 기능 추가 (우선순위: 높음)

**수정 파일:**
1. `packages/web/src/lib/api.ts`
   - `machineApi`에 `update(id, payload)` 메서드 추가
   - Payload: `{ name?, ipAddress?, port?, serialNumber?, location?, templateId? }`
2. `packages/web/src/pages/MachineAdmin.tsx`
   - 설비 목록 각 행에 편집 버튼 추가
   - 편집 모달 (기존 등록 폼 재사용 또는 별도 구현)
   - 편집 성공 시 로컬 스토어 업데이트

**참고**: 백엔드 `PUT /api/machines/:id`는 이미 완전 구현됨. 프론트만 추가하면 됨.
상세 명세: `docs/MachineAdmin.md`

### [BACKLOG-01] 템플릿 파일 기반 관리

현재 템플릿은 DB에만 저장되며 git에 반영되지 않아 신규 배포 시 재현 불가능.

- `routes/templates.ts` PUT 핸들러에 `fs.writeFile` 추가 → UI 저장 시 DB + JSON 동시 write
- `seed.ts`가 `templates/*.json`을 읽어서 DB 초기화하도록 리팩토링
- 현재 DB 내용을 JSON으로 export하는 1회성 마이그레이션 스크립트

### [BACKLOG-02] PMC 인터락 텔레메트리 연동

현재 `RemoteControl.tsx`에서 `interlockSatisfied` 체크를 bypass 중.
실운용 시 도어 닫힘(R6001.3), 비상정지 해제(R6001.2) 등 PMC 신호 실시간 연동 필요.

### [BACKLOG-03] 조작반 램프 상태 실PMC 연동

현재 램프 상태는 텔레메트리 mode/runState 기반 mock. `panelLayout[].keys[].lampAddr` 주소를 DataCollectorService에서 주기적으로 읽어 텔레메트리에 포함해야 함. BACKLOG-02 선행 필요.

### [BACKLOG-04] 오프셋 쓰기 전체 흐름 검증

API 레벨 단독 테스트는 성공. 웹 UI → 오프셋 수정 → CNC 반영 전체 흐름 실기기 검증 미완료.
IS-C 4자리 소수점 스케일 검증 포함.

### [BACKLOG-05] 멀티사이트 배포 구조 설계

단일 서버 + 단일 에이전트 → 여러 공장/사이트 배포 시 아키텍처 설계 필요. BACKLOG-01 완료 후 진행.

### [BACKLOG-06] E-STOP 출력 PMC 주소 확인

현재 panelLayout에서 E_STOP의 reqAddr 미확인. SB-20R2 실기기 또는 FANUC 매뉴얼에서 확인 필요.

---

## 7. 주요 설정값

### Server 환경변수 (`packages/server/.env`)

```
DATABASE_URL=postgresql://starwebcnc:starwebcnc123@localhost:5432/starwebcnc
REDIS_URL=redis://localhost:6379
MQTT_BROKER_URL=mqtt://localhost:1883
PORT=3000
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
HQ_REGISTRATION_CODE=hq1234
```

### Agent 설정 (`appsettings.Production.json`)

```json
{
  "Agent": {
    "AgentId": "AGENT-001",
    "MachineId": "MC-001",
    "TemplateId": "FANUC_0i-TF Plus_SB-20R2_V1",
    "Cnc":       { "IpAddress": "192.168.1.101", "Port": 8193 },
    "Mqtt":      { "Host": "localhost", "Port": 1883, "AutoReconnect": true },
    "Server":    { "BaseUrl": "http://localhost:3000" },
    "Collector": { "StatusIntervalMs": 500, "TelemetryIntervalMs": 500,
                   "AlarmIntervalMs": 1000, "PmcIntervalMs": 100 }
  }
}
```

**환경변수 오버라이드**: .NET 이중 언더스코어 규칙  
예) `Agent__Mqtt__Host=192.168.1.10`, `Agent__Cnc__IpAddress=192.168.1.102`

### 다중 CNC 확장 방식

- Agent 바이너리를 별도 디렉토리에 복사
- `appsettings.Production.json`에서 `MachineId`, `Cnc.IpAddress` 변경
- Agent 프로세스 별도 실행
- DB에 Machine 레코드 추가 (MachineAdmin UI 또는 API)

### 인프라 실행 상태 (로컬 개발 기준)

| 서비스 | 방식 | 주소 |
|--------|------|------|
| PostgreSQL | Docker `star-webcnc-db` | localhost:5432 |
| MQTT Broker | Docker `star-webcnc-mqtt` | localhost:1883 |
| Redis | Native `redis-server.exe` | localhost:6379 |
| Node.js Server | tsx / ts-node | localhost:3000 |
| React Dev | Vite | localhost:5173 |
| Agent | `dotnet StarWebCNC.Agent.dll` | — |

### Agent 빌드 및 배포

```bash
# 1. Agent 프로세스 종료 (DLL 잠금 해제)
powershell.exe -Command "Get-Process dotnet -ErrorAction SilentlyContinue | Stop-Process -Force"

# 2. 빌드
cd packages/agent/StarWebCNC.Agent
dotnet build -c Release

# 3. DLL 복사
cp bin/Release/net8.0/win-x64/StarWebCNC.Agent.dll publish/

# 4. 재시작
cd publish && ASPNETCORE_ENVIRONMENT=Production dotnet StarWebCNC.Agent.dll > /c/temp/agent_prod.log 2>&1 &
```

> ⚠️ `dotnet publish`를 Agent 실행 중 실행하면 파일 잠금으로 silently fail됨

---

## 8. 작업 규칙 (KNOWN_MISTAKES.md 핵심 요약)

> 전체 목록은 `KNOWN_MISTAKES.md` 참조 (M-01 ~ M-21)

### FOCAS (C# Agent)

- **`await` 금지**: FOCAS thread 내에서는 `Thread.Sleep()` 또는 `WaitHandle.WaitOne()` 만 사용. `await Task.Delay()` 사용 시 thread affinity 깨짐 → EW_HANDLE(-8) [M-01]
- **루프 슬립**: 반드시 가장 짧은 주기(`pmcIntervalMs = 100ms`)로 설정. `telemetryIntervalMs`로 설정하면 PMC 100ms 주기가 무효화됨 [M-17]
- **PMC 쓰기**: read-modify-write 패턴 금지. `pmc_wrpmcrng` 직접 쓰기만 사용 [M-03]
- **2단계 안정화 필수**: CNC ready → PMC ready 순서 생략 금지 [M-04, M-08]
- **블록킹 FOCAS API 금지**: `cnc_rdopmsg3` 등 CNC 대기 상태에서 블록킹되는 API는 수집 루프에서 사용 금지 [M-19]
- **pmcBits 별도 토픽**: telemetry 패킷에 포함 금지. 반드시 `pmc_bits` 토픽으로 별도 발행 [M-18]
- **PMC 주소 수집 대상**: 새 PMC 주소 기반 기능 추가 시 `CollectAndPublishPmcBitsSync()`의 `uniqueAddrs`에 Concat 필수 [M-20]

### JSON 직렬화 (C#)

- **Dictionary 키 보존**: `CamelCasePropertyNamesContractResolver` 단독 사용 금지. `ProcessDictionaryKeys = false` 설정 필수 [M-02]

### WebSocket (TypeScript)

- **직접 연결**: `import.meta.env.VITE_API_URL`에서 추출한 주소로 직접 연결. Vite proxy 경유 금지 [M-05]
- **stale closure 방지**: `_connect()`에서 `const ws = new WebSocket(url)` 로컬 변수 사용 + `if (this.ws !== ws) return` 체크 필수 [M-15]
- **핸들러 재등록**: `_wsHandlersRegistered` 플래그 패턴 금지. `_wsCleanups` 배열로 cleanup 후 재등록 [M-06]

### React / Zustand (TypeScript)

- **useEffect deps**: WsConnector의 deps에 `initWebSocket`, `destroyWebSocket`, `fetchMachines` 포함 필수 [M-16]
- **롱프레스**: `onComplete`에 `onPressEnd()` 호출 포함 필수 [M-10]

### 기타

- **역할명**: 항상 `HQ_ENGINEER` 사용 (구 `AS_ENGINEER` 사용 금지) [M-14]
- **seed.ts upsert**: 항상 `update: {}` — 기존 데이터 덮어쓰기 금지 [M-07]
- **CommandMessage**: 파라미터 접근은 `command.Params` (not `Parameters`) [M-09]
- **템플릿 새 JSON 컬럼 추가 시**: schema.prisma → db push → prisma generate → 서버 재빌드 → DB 기존 레코드 업데이트 → Agent 재시작 5단계 필수 [M-21]
