# FEATURE_SPEC.md
# Star-WebCNC 기능 명세

> 현재 구현된 기능의 요구사항, UI 규칙, 권한 정책, 예외 처리 기준

---

## 1. 인증 & 권한

### 역할 체계
| 역할 | 설명 | 허용 기능 |
|------|------|-----------|
| `USER` | 일반 작업자 | 모니터링, 스케줄 조회 |
| `HQ_ENGINEER` | 본사 엔지니어 (구 AS_ENGINEER) | 원격 조작, 파일 전송, 템플릿 편집 |
| `ADMIN` | 관리자 | 전체 기능 + 사용자 관리 |

- **ADMIN 또는 HQ_ENGINEER 체크**: `user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER'`
- **제어권(controlLock)**: 원격 조작 전 반드시 취득 필요, 5분 TTL, 연장 가능

---

## 2. 실시간 모니터링

### 텔레메트리 데이터 (`TelemetryData`)
- `mode`: EDIT | MEM | MDI | HANDLE | JOG | JOG_HANDLE | DNC | UNKNOWN
- `runState`: 0=정지 | 1=대기 | 2=실행 중
- `programNo`: 현재 프로그램 번호 (MDI/EDIT 모드에서는 O0000 정상)
- `feedrate`, `spindleSpeed`, `partsCount`
- `absolutePosition`, `machinePosition`: raw 정수값 (÷ 10^`coordinateDecimalPlaces` = mm)
  - IS-B: 소수점 3자리 (÷1000), IS-C: 소수점 4자리 (÷10000)
- `pmcBits`: `{ "R6001.3": 1, "R6004.6": 1, ... }` — 대문자 키, 0|1 값 (**pmc_update WS 메시지로 갱신됨**)
- `path1`, `path2`: 2-Path 자동선반용 경로별 데이터

### WebSocket 업데이트 흐름 — 2개 채널 병행
```
[빠른 채널 — 100ms]
Agent (MQTT pmc_bits) → Server (WS pmc_update) → Frontend updatePmcBits() → 램프 갱신

[전체 채널 — 1000ms]
Agent (MQTT telemetry) → Server (Redis 60s + WS telemetry) → Frontend updateTelemetry() → 전체 UI 갱신
```
- **PMC bits (램프, 인터락 pills)**: `AgentSettings.Collector.PmcIntervalMs` (기본 100ms) — `pmc_bits` MQTT 토픽
- **전체 텔레메트리 (좌표, 속도 등)**: `AgentSettings.Collector.TelemetryIntervalMs` (기본 1000ms) — `telemetry` MQTT 토픽
- pmcBits는 전체 텔레메트리 패킷에서 **제외**되고 pmc_bits 채널로만 전달됨

### NC 모니터 (`NCMonitor`)
- path1/path2 경로별 좌표, 프로그램, 이송속도 표시
- 2-Path: Path1 = 메인 스핀들, Path2 = 서브 스핀들

---

## 3. 원격 조작반 (`RemoteControl`)

### 버튼 구조
- `PanelGroup` → `PanelKey` 계층
- 각 키: `id`, `label`, `hasLamp`, `lampAddr`(읽기), `reqAddr`(쓰기), `timing`, `color`, `size`
- 그룹: HEAD | CHUCKING | MODE | OPERATION | CYCLE

### 롱프레스 조작
- `longPressMs`: 완료까지 시간 (기본 1000ms, CYCLE_START는 2000ms)
- `holdMs`: PMC bit HIGH 유지 시간 (기본 300ms)
- `timeoutMs`: 타임아웃 (기본 2000ms)
- 완료 시: `PMC_WRITE { address, value:1, holdMs }` 명령 전송 → Agent가 holdMs 후 value:0으로 자동 해제

### 램프 상태 결정 순서
1. `key.lampAddr`이 `pmcBits`에 있으면 → `pmcBits[lampAddr] === 1`
2. MODE 그룹이고 pmcBits에 없으면 → `telemetry.mode`로 fallback
3. CYCLE_START 키이고 없으면 → `telemetry.runState === 2`
4. 그 외 → false

### 인터락 (현재 상태)
- `canOperate = hasControlLock` (인터락 조건 임시 비활성화 — 실기기 검증 전)
- TODO: 실기기 인터락 검증 후 `interlockSatisfied` 재활성화

---

## 4. 스케줄러 (`Scheduler`)

### 구조
- `SchedulerJob`: 실행 단위 (프로그램 번호, 수량, 상태)
- `M20_COMPLETE` 이벤트로 카운트 증가 (메인 스핀들)
- `M20_SUB_COMPLETE` 이벤트로 서브 스핀들 카운트 증가 (SB-20R2)
- `CountDisplay.MacroNo`: CNC 표시용 매크로 변수 번호 (기본 #500)

### DNC 설정
- DNC_RUNNING 중에는 레포지토리 읽기 전용
- `machineStore.dncConfig`에 설정 저장

---

## 5. 파일 전송 (`Transfer`)

### 파일 저장소 3가지
| 저장소 | 경로 | 역할 |
|--------|------|------|
| `repo` | 서버 로컬 `/files/repo/` | PC 마스터 저장소 |
| `share` | 서버 로컬 `/files/share/` | 공용 공유 폴더 |
| `cnc` | CNC 장비 내부 | CNC 프로그램 목록 (FOCAS로 조회) |

### 전송 방향
- PC→CNC: `DOWNLOAD_PROGRAM` 명령 → Agent FOCAS dwnstart3/download3/dwnend3
- CNC→PC: `UPLOAD_PROGRAM` 명령 → Agent FOCAS upstart3/upload3/upend3 → share 저장소에 저장
- 전송 완료 시 WS `file_downloaded` 이벤트로 UI 갱신

---

## 6. NC 데이터 (`NCMonitor` 탭)

### 오프셋 (Wear Offset)
- wear only (형상 오프셋은 제외)
- 64개, 16개씩 페이징
- 포커스 셀 + 방향키 이동
- `INPUT` 또는 `+INPUT` 방식으로 값 입력 후 confirm

### 카운터 (Counter)
- 템플릿 `CounterConfig.fields` 기반 동적 구성
- `varType`: `macro`(#변수) | `pcode`(P코드)
- onBlur commit (저장 버튼 없음)

### 공구 수명 (Tool Life)
- 템플릿 `ToolLifeConfig.paths[*]` 기반 동적 컬럼
- `varType`: `macro` | `pcode` | `ddata`
- 사용률 바 표시
- Path1 / Path2 탭 구분 (2-Path 장비)

---

## 7. MachineTopBar 구조

```
[Row1] 로고 | 페이지 타이틀              | 알림/상태
[Row2] 장비선택(좌) | 인터락pills + 경광등(우)
```

- 인터락 pills: 템플릿 `topBarInterlock.[pageId].fields`에서 동적 로드
- 경광등: `template.towerLight.{red|yellow|green}Addr` → pmcBits로 ON/OFF
- `pageId`: `remote` | `scheduler` | `transfer` | `backup`

---

## 8. PMC 메시지 시스템

### 개요
FOCAS 오퍼레이터 메시지 API(`cnc_rdopmsg*`)에 의존하지 않고, **PMC 비트 상태를 템플릿에 직접 정의**하여 Web UI에 메시지를 표시하는 시스템.

### 데이터 구조 (`PmcMessageEntry`)
```ts
{ id: string; pmcAddr: string; message: string; }
```
- `pmcAddr`: PMC 주소/비트 (예: `"A209.5"`, `"R6001.3"`)
- `message`: 표시할 메시지 내용 (예: `"Are you sure of AIR-CUT mode?"`)
- 메시지 번호 없음 — 주소/비트 + 텍스트가 핵심

### 등록 위치
- 템플릿 편집 화면 → **"7. PMC 메시지 등록"** 섹션
- `CncTemplate.pmcMessages: PmcMessageEntry[]` (Prisma: `pmc_messages JSON`, 기본 `[]`)

### 표시 조건 및 데이터 흐름
```
Agent (pmcBits polling 100ms) → MQTT pmc_bits → Server WS pmc_update → machineStore.pmcBits
Template pmcMessages → filter where pmcBits[pmcAddr] === 1 → AlarmStrip 표시
```
- **Agent 폴링 포함 조건**: `pmcMessages[*].pmcAddr`은 `CollectAndPublishPmcBitsSync()`에서 인터락/패널 램프와 함께 수집
- 비트가 1이면 활성, 0이면 비표시 (비트 내려올 때 자동 사라짐)

### AlarmStrip 통합 표시 규칙
- CNC 알람(`cnc_rdalmmsg2` 채널)과 PMC 메시지를 **하나의 리스트**에 통합 표시
- CNC 알람: 빨간색 배경, `{CATEGORY} {alarmNo}` 라벨
- PMC 메시지: 노란색 배경, `{pmcAddr}` 라벨 + 메시지 텍스트
- 테두리 색: 알람 있음=빨강, PMC 메시지만=노랑, 없음=회색
- 내부 채널은 분리 (CNC 알람은 MQTT `alarm` 토픽, PMC 메시지는 `pmc_bits` 폴링) — 향후 구분 표시 가능

### FOCAS 오퍼레이터 메시지 API 포기 이유
- `cnc_rdopmsg3`: FOCAS 루프 blocking → M-19 (완전 금지)
- `cnc_rdopmsg` / `cnc_rdopmsg2`: 이 기종(D6G5 TT)에서 EW_PARAM(9) 또는 EW_LENGTH(2) 반환 — 모든 파라미터 조합 실패
- 결론: PMC 비트 + 템플릿 정의 방식으로 대체

---

## 10. 진단 & 설정 (`Settings` → Diagnostics)

- `/api/diagnostics` — DB, Redis, MQTT, WebSocket 상태
- Agent 온라인 여부: Redis 키 TTL 기반 (60s 이내 = online)
- WebSocket 클라이언트 수 표시

---

## 9. UI 공통 규칙

- **다크 테마** 고정 (`bg-gray-900`, `bg-gray-800` 계열)
- **버튼 색상**: green=사이클시작, yellow=피드홀드, red=비상정지, gray=일반
- **비활성화**: `opacity-35 cursor-not-allowed`
- **에러 표시**: 버튼 위에 `WarningBadge` (5초 후 자동 사라짐)
- **컴포넌트 경로**: 기능별 subdirectory (`components/ncmonitor/`, `components/filemanager/` 등)
- **emojis 금지** (명시적 요청 없으면)

---

## 11. 예외 처리 규칙

- **API 실패 시**: Mock 데이터 fallback (console.error만 출력, 앱 크래시 없음)
- **WS 끊김 시**: 5초 간격 자동 재연결 (`wsClient.ts` RECONNECT_DELAY_MS)
- **FOCAS 연결 실패 시**: 30초 간격 재시도 (장비 전원 ON 대기)
- **PMC 쓰기 실패 시**: `LogWarning` 출력 후 failure 반환 (예외 throw 없음)
- **명령 타임아웃**: `commandWaiter.ts`에서 상관관계 ID 기반 대기, 타임아웃 시 오류 응답
