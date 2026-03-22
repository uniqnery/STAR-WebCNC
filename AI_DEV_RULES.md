# AI_DEV_RULES.md
# Star-WebCNC 개발 고정 원칙 및 구현 금지사항

> 코드 작업 전 반드시 이 문서를 읽고 반영할 것.

---

## 1. 아키텍처 개요

| 레이어 | 스택 | 비고 |
|--------|------|------|
| Frontend | React 18 + TypeScript + Vite + Zustand + TailwindCSS | `packages/web/` |
| Backend | Node.js + Express + Prisma ORM + MQTT | `packages/server/` |
| Agent | C# .NET 8 + FOCAS2 | `packages/agent/` |
| Infra | Docker (PostgreSQL, Redis, MQTT Broker) | `docker-compose.yml` |

데이터 흐름: **CNC → FOCAS2 → Agent → MQTT → Server → WebSocket → Frontend**

---

## 2. FOCAS2 Agent 고정 원칙 (C#)

- **스레드 친화성 (Thread Affinity) 절대 준수**
  - `cnc_allclibhndl3`를 호출한 OS 스레드에서만 이후 모든 FOCAS API 호출 가능
  - `Task.Factory.StartNew(..., TaskCreationOptions.LongRunning)` 전용 스레드 사용
  - **절대 금지: `await Task.Delay()` in FOCAS thread** → continuation이 thread pool로 이동 → EW_HANDLE(-8) 발생
  - 대기가 필요하면 반드시 `Thread.Sleep()` 또는 `stoppingToken.WaitHandle.WaitOne()` 사용

- **PMC 쓰기 방식**
  - Read-Modify-Write 금지 (`pmc_rdpmcrng` 후 `pmc_wrpmcrng` 패턴)
  - 반드시 `WritePmcAreaValue`(pmc_wrpmcrng 직접 쓰기)만 사용
  - 이유: R6100~R6109 출력 영역은 PC→CNC 전용, read 시 EW_HANDLE(-8) 빈번

- **연결 안정화 2단계 필수**
  1. CNC 준비: `cnc_statinfo` 성공 확인
  2. PMC 준비: `pmc_rdpmcrng` R6000 1바이트 읽기 성공 확인
  - 순서 생략 금지 (PMC는 CNC보다 늦게 초기화됨)

- **JSON 직렬화 (Newtonsoft.Json)**
  - `CamelCasePropertyNamesContractResolver` 단독 사용 금지
    → Dictionary 키까지 소문자 변환되어 PMC 주소(`R6001.3` → `r6001.3`) 불일치 발생
  - 반드시 `DefaultContractResolver + CamelCaseNamingStrategy { ProcessDictionaryKeys = false }` 사용
  ```csharp
  ContractResolver = new DefaultContractResolver {
      NamingStrategy = new CamelCaseNamingStrategy { ProcessDictionaryKeys = false, OverrideSpecifiedNames = true }
  }
  ```

- **명령 처리 패턴**
  - 모든 FOCAS 명령은 `DataCollectorService`의 `_commandChannel` 큐를 통해 FOCAS 전용 스레드에서 실행
  - `CommandHandler.ExecuteOnFocasThread(cmd)` → FOCAS thread에서 호출
  - 비동기처럼 보이는 메서드도 내부는 동기로 구현 (`Task.FromResult` 래핑)

- **수집 루프 슬립 원칙**
  - 루프 끝 `WaitOne(ms)` 값은 **반드시 가장 짧은 수집 주기**로 설정
  - 각 수집 항목은 `if (now - lastXxx >= xxxInterval)` 패턴으로 독립 주기 관리
  - `WaitOne(telemetryIntervalMs)` 처럼 긴 값을 쓰면 `PmcIntervalMs` 등 빠른 주기 설정이 전부 무효화됨
  - 현재 기준: `WaitOne(pmcIntervalMs = 100)` → PMC 100ms, 텔레메트리 1000ms, 알람 1000ms

- **PMC 비트 발행 채널 분리 원칙**
  - pmcBits(램프·인터락)는 `pmc_bits` MQTT 토픽으로 `PmcIntervalMs(100ms)` 주기 별도 발행
  - `TelemetryData`에 `PmcBits` 필드를 포함하여 `telemetry` 토픽으로 보내는 방식 금지
  - Server: `AGENT_PMC_BITS` 핸들러 → `wsService.sendPmcBits()` → WS `pmc_update` 메시지
  - Frontend: `pmc_update` → `updatePmcBits(machineId, pmcBits)` — pmcBits 필드만 교체

---

## 3. WebSocket 연결 원칙 (Frontend)

- **wsClient는 API 서버에 직접 연결** (Vite proxy 우회)
  - `ws://localhost:3000/ws` (개발), `wss://{서버}/ws` (프로덕션)
  - `VITE_API_URL` env 기반으로 URL 결정
  - 이유: Vite proxy(`ws: true`)는 서버→브라우저 방향 메시지를 신뢰성 있게 전달하지 못함

- **`_connect()` 내 WebSocket 인스턴스 로컬 변수 사용 필수**
  - `const ws = new WebSocket(url); this.ws = ws;` 패턴으로 로컬 변수에 저장
  - `ws.onopen`, `ws.onmessage`, `ws.onclose` 핸들러 첫 줄에 `if (this.ws !== ws) return;` 체크
  - `ws.onclose` 내 `this.ws = null`은 반드시 `if (this.ws === ws) { ... }` 블록 안에서만 실행
  - 이유: React StrictMode 이중 마운트 시, 이전 WS의 `onclose`가 비동기로 늦게 발화하여 새로 생성된 WS의 `this.ws` 참조를 null로 덮어쓰면 구독 전송 실패 → 실시간 업데이트 영구 중단

- **WS 핸들러 등록 방식**
  - `_wsHandlersRegistered` 플래그 사용 금지 (Vite HMR 시 flag 초기화 후 재등록 불가)
  - `_wsCleanups` 배열에 cleanup 함수 저장, `initWebSocket` 재호출 시 먼저 cleanup 후 재등록
  - `globalThis.__wsClientInstance`로 HMR 시 이전 연결 해제

- **WsConnector `useEffect` deps**
  - `[isAuthenticated, accessToken, initWebSocket, destroyWebSocket, fetchMachines]` 전체 포함 필수
  - `// eslint-disable-next-line react-hooks/exhaustive-deps`로 함수 deps를 생략하는 코드 작성 금지
  - 이유: Vite HMR로 `machineStore.ts`가 재평가되면 새 store + 새 함수 참조가 생성되고, 함수 deps가 없으면 effect가 재실행되지 않아 새 store에 WS 핸들러가 등록되지 않음

- **구독 타이밍**
  - `wsClient.onConnect` 핸들러에서 `get().machines`로 최신 목록 구독
  - `fetchMachines` 완료 후에도 `wsClient.isConnected` 확인 후 재구독

---

## 4. Zustand 상태 관리 원칙 (Frontend)

- **telemetry 업데이트**: `updateTelemetry(machineId, data)` 호출 시 spread merge 패턴
  - `path1/path2/offsetData/countData/toolLifeData`는 `'field' in data` 체크 후 선택적 override
- **Mock fallback 패턴**: API 호출 → catch → Mock 데이터 사용 (개발/서버 미연결 시)
- **역할 체크**: `user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER'` (AS → HQ_ENGINEER 통일됨)
- **인라인 편집**: onBlur commit 패턴 (저장 버튼 없음) — OffsetView, CountView, ToolLifeView

---

## 5. 서버 아키텍처 원칙 (Node.js)

- **MQTT → Redis → WebSocket** 흐름 유지
  - Agent telemetry는 Redis에 TTL=60s로 캐시 후 WS로 forwarding
  - `machines.ts` GET 응답에 Redis 캐시 telemetry 포함 (`realtime.telemetry`)

- **WebSocket 구독 방식**
  - 클라이언트가 `{ type: 'subscribe', payload: { machineIds: [...] } }` 메시지 전송
  - `broadcastToMachine(machineId, msg)`는 해당 machineId 구독 클라이언트에만 전송
  - Heartbeat 30s 간격으로 dead connection 정리

- **인증**: JWT Access Token (Authorization 헤더 또는 쿼리 파라미터) + Refresh Token (쿠키)

---

## 6. PMC 메시지 시스템 원칙

- **FOCAS 오퍼레이터 메시지 API 사용 금지**
  - `cnc_rdopmsg3`: FOCAS 루프 blocking → 완전 금지 (M-19)
  - `cnc_rdopmsg` / `cnc_rdopmsg2`: 이 기종에서 EW_PARAM(9) / EW_LENGTH(2) 반환 — 사용 불가
  - 대안: PMC 비트 + 템플릿 정의 방식 (`pmcMessages`)

- **PMC 메시지는 템플릿 기반으로 관리**
  - `CncTemplate.pmcMessages: PmcMessageEntry[]` — PMC 주소/비트 + 메시지 텍스트
  - 메시지 번호 없이도 등록 가능 (주소+내용만으로 의미 완결)
  - 등록/수정: TemplateEditor "PMC 메시지 등록" 섹션 (UI)

- **PMC 메시지 주소도 폴링 대상에 포함 필수**
  - `CollectAndPublishPmcBitsSync()`의 `uniqueAddrs`에 `pmcMessages[*].PmcAddr` 반드시 포함
  - 새로운 PMC 주소 소스 추가 시 이 목록에 `Concat` 해야 함
  - 누락 시: MQTT `pmc_bits`에 해당 키가 없어 프론트에서 비트 상태를 알 수 없음 (M-20)

- **알람/메시지 통합 표시 원칙**
  - CNC 알람(`cnc_rdalmmsg2`)과 PMC 메시지를 AlarmStrip 하나에 통합 표시
  - CNC 알람 = 빨간 계열, PMC 메시지 = 노란 계열
  - 채널 분리는 내부에서만 (향후 필터 UI 추가 가능)

---

## 7. 템플릿 시스템 원칙 (신규 컬럼 추가 절차 포함)

- **DB가 원본** (파일은 초기 seed용)
  - `seed.ts`의 `upsert`는 반드시 `update: {}` (이미 존재하면 덮어쓰지 않음)
  - 이유: UI에서 수정한 DB 데이터를 reseed로 덮어쓰면 안 됨

- **템플릿에 새 JSON 컬럼 추가 시 반드시 4단계 실행** (M-21)
  1. `schema.prisma`에 컬럼 추가 → `npx prisma db push --skip-generate`
  2. 서버 프로세스 중지 → `npx prisma generate` → `npx tsc` → 서버 재시작
  3. 기존 DB 레코드에 새 필드 직접 업데이트 (`prisma.template.updateMany(...)`)
  4. 에이전트 재시작 (템플릿 캐시 무효화 → 새 템플릿 로드)
  - `update: {}` 정책 때문에 3단계는 수동 실행 필수

- **topBarInterlock = 탑바 pills = 해당 페이지 인터락 조건** (통합 구조)
  - `interlockModules`, `interlockConfig`, `remoteControlInterlock` 필드 없음 (제거됨)
  - 4개 페이지: `remote`, `scheduler`, `transfer`, `backup`

- **panelLayout.keys[*].lampAddr** 형식: `"R6004.6"` (대문자, 점 구분)
  - Agent에서 pmcBits 키도 동일 형식 유지 (ProcessDictionaryKeys = false로 보장)

---

## 7. PMC 주소 체계 (SB-20R2 기준)

- **INPUT** (기계→PC): R6000~R6009
- **OUTPUT** (PC→기계): R6100~R6109
- reqAddr (쓰기용): R6100~R6109 범위
- lampAddr (읽기용): R6000~R6009 범위
- 주소 형식: `"R{번호}.{비트}"` (예: `"R6001.3"`)
- 상세 표: `memory/pmc_sb20r2.md` 참조

---

## 8. TypeScript 빌드 규칙

- **빌드 확인**: `cd packages/web && npx tsc --noEmit` (frontend)
- **빌드 확인**: `cd packages/server && npx tsc --noEmit` (server)
- 미사용 변수: `_` prefix로 suppress (e.g., `_req`, `_topic`)
- 코드 수정 후 반드시 타입 에러 없음 확인 후 완료

---

## 9. 구현 금지사항 목록

| 금지 | 이유 |
|------|------|
| FOCAS thread에서 `await Task.Delay()` | thread pool 이동 → EW_HANDLE |
| PMC WritePmcBit에서 read-modify-write | R61xx 영역 read 시 EW_HANDLE |
| Newtonsoft `CamelCasePropertyNamesContractResolver` 단독 사용 | Dictionary 키 소문자 변환 |
| wsClient Vite proxy 경유 WS 연결 | server→browser 메시지 미전달 |
| `_wsHandlersRegistered` 플래그로 단일 등록 | Vite HMR 후 핸들러 등록 불가 |
| seed.ts에서 `update: templateData` | UI 수정 데이터 덮어쓰기 |
| `interlockModules` / `remoteControlInterlock` 필드 신규 사용 | 제거된 구조 |
| PMC 주소 소문자 키 (`r6001.3`) 프론트 사용 | 대문자 형식 `R6001.3`이 표준 |
| `wsClient._connect()` 내 `this.ws.onopen/onclose` 직접 대입 | 이전 WS onclose가 새 WS 참조를 null로 덮어씀 → 구독 실패 → 실시간 업데이트 중단 |
| WsConnector `useEffect` deps에서 store 함수 생략 (`// eslint-disable`) | HMR 후 새 store에 WS 핸들러 미등록 |
| Agent 루프 슬립을 `telemetryIntervalMs(1000)`으로 설정 | pmcInterval(100ms) 등 빠른 주기 설정이 전부 무효화됨 |
| pmcBits를 `telemetry` MQTT 패킷에 포함 | 텔레메트리 주기(1000ms)에 묶여 램프 응답 지연 발생 |
| `cnc_rdopmsg` / `cnc_rdopmsg2` / `cnc_rdopmsg3` 사용 | rdopmsg3=FOCAS thread blocking(M-19), rdopmsg/rdopmsg2=이 기종 EW_PARAM/EW_LENGTH → 모두 사용 불가 |
| 새 PMC 주소 소스를 `CollectAndPublishPmcBitsSync` uniqueAddrs에 미포함 | 해당 주소가 MQTT pmc_bits에 실리지 않아 프론트 비트 상태 수신 불가(M-20) |
| 템플릿 JSON 컬럼 추가 후 prisma generate 없이 서버 재시작 | Prisma Client가 새 컬럼을 모름 → DB 쿼리 오류(M-21) |
