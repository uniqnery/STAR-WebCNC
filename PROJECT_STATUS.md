# Star-WebCNC 프로젝트 브리핑

> 최종 업데이트: 2026-02-22 (아키텍처 분석 추가)

---

## 1. 프로젝트 개요

FANUC CNC 자동선반을 웹 기반으로 모니터링하고 원격 제어하는 스마트팩토리 시스템.

- **대상 장비**: FANUC 0i-TF Plus 계열 CNC 자동선반 (Star SB-20R2 등)
- **통신 방식**: FOCAS2 라이브러리 (UDP/TCP, 포트 8193)
- **현재 상태**: 프론트엔드 UI 완성, 전부 mock 데이터로 동작 중. 백엔드/Agent 미연결.

---

## 2. 기술 스택

| 레이어 | 기술 |
|--------|------|
| Frontend | React 18 + TypeScript + Vite + Zustand + TailwindCSS |
| Backend | Node.js + Express + Prisma ORM |
| Database | PostgreSQL (Docker) |
| Cache | Redis (Docker) |
| Message Broker | MQTT (Docker, Mosquitto) |
| Agent | C# .NET 8 (FOCAS2 CNC 통신) |
| 인프라 | Docker Compose |

---

## 3. 사용자 권한 체계

```typescript
type UserRole = 'USER' | 'ADMIN' | 'HQ_ENGINEER';
```

| 역할 | 설명 | 주요 접근 권한 |
|------|------|---------------|
| USER | 일반 사용자 | 대시보드 조회, 읽기 전용 |
| ADMIN | 공장 관리자 | 스케줄러 실행, Transfer, 설정 변경 |
| HQ_ENGINEER | 본사 엔지니어 | 전체 접근 + 템플릿/설비/인터록 관리 |

---

## 4. 페이지 구성

### 일반 페이지 (모든 사용자)
- `/` → `/dashboard` 대시보드 (CardView / FactoryView)
- `/alarms` 알람 이력

### Machines 메뉴 (ADMIN/HQ_ENGINEER)
- `/remote` 원격 제어 (제어권 획득 필요)
- `/scheduler` 스케줄러 + DNC 설정 + Repository 브라우저
- `/transfer` 파일 전송 (2패널: 장비 ↔ 서버)
- `/workorder` 작업 지시
- `/pop` 생산실적 (POP/MES)
- `/audit` 감사 로그

### Admin 메뉴 (HQ_ENGINEER 전용)
- `/admin/machines` 설비 등록/삭제
- `/admin/templates` 템플릿 편집기 (CNC 설정 JSON 편집)
- `/admin/panel` 가상 조작반 디자인 (PanelEditor)
- `/admin/interlocks` 인터록 조건 편집 (InterlockEditor)
- `/settings` 시스템 설정

---

## 5. 핵심 데이터 모델

### Machine (machineStore)
```typescript
interface Machine {
  id: string;
  machineId: string;        // "MC-001"
  name: string;             // "1호기 자동선반"
  ipAddress: string;
  port: number;             // 8193 (FOCAS2)
  isActive: boolean;
  pathCount?: number;       // 2-Path (주축/부축)
  serialNumber?: string;
  location?: string;
  template?: {
    templateId: string;     // "FANUC_0i-TF Plus_SB-20R2_V1"
    name: string;
    cncType: string;
    seriesName: string;
  };
  realtime?: {
    status: 'online' | 'offline';
    telemetry?: TelemetryData;
    controlLock?: { ownerId, ownerUsername, acquiredAt } | null;
  };
}
```

### TelemetryData (machineStore)
```typescript
interface TelemetryData {
  runState: number;         // 0=idle, 2=running
  mode: string;             // "AUTO" | "MDI" | "MEM" | "EDIT"
  programNo: string;        // "O1001"
  feedrate: number;
  spindleSpeed: number;
  spindleLoad?: number;     // %
  partsCount: number;
  presetCount?: number;
  cycleTime?: number;       // 초
  dailyRunRate?: number;    // %
  alarmActive: boolean;
  absolutePosition?: number[];
  path1?: PathData;         // 주축 (T01xx~T09xx)
  path2?: PathData;         // 부축 (T31xx~T32xx)
  interlock?: InterlockStatus;
}
```

### InterlockStatus (machineStore - 실시간 상태값)
```typescript
interface InterlockStatus {
  doorLock: boolean;
  memoryMode: boolean;
  barFeederAuto: boolean;
  coolantOn: boolean;
  machiningMode: boolean;
  cuttingMode: boolean;
}
```

### CncTemplate (templateStore - 설정 데이터)
```typescript
interface CncTemplate {
  id: string;               // UUID
  templateId: string;       // "FANUC_0i-TF Plus_SB-20R2_V1"
  name: string;             // "Star SB-20R2 (FANUC 0i-TF Plus)"
  version: string;
  systemInfo: SystemInfo;   // cncType, seriesName, modelName, maxPaths
  axisConfig: AxisConfig;   // path1/path2/path3 축 구성
  pmcMap: PmcMap;           // PMC 주소 매핑 (doorClosed, cycleStart 등)
  interlockConfig: InterlockConfig;   // 구형 인터록 (미사용 예정)
  remoteControlInterlock: RemoteControlInterlock;
  interlockModules: InterlockModules; // 신규 4모듈 인터록 (InterlockEditor 편집)
  virtualPanel: VirtualPanel;         // 가상 조작반 키 구성 (PanelEditor 편집)
  schedulerConfig: SchedulerConfig;
  capabilities: Capabilities;
}
```

### InterlockModules (신규 구조 - InterlockEditor가 편집)
```typescript
interface InterlockModuleConfig {
  enabled: boolean;
  conditions: InterlockDefinition[];
}
interface InterlockDefinition {
  id: string;
  name: string;
  pmcAddr: string;    // "R6001.3" 형식 (타입.주소.비트)
  expected: boolean;  // 기대값 (true=1, false=0)
  description: string;
}
interface InterlockModules {
  remotePanel:     InterlockModuleConfig;  // 원격 조작반 인터록
  scheduler:       InterlockModuleConfig;  // 스케줄러 인터록
  fileTransferIn:  InterlockModuleConfig;  // 파일 수신 인터록
  fileTransferOut: InterlockModuleConfig;  // 파일 송신 인터록
}
```

---

## 6. Zustand 스토어 구조

| 스토어 | 파일 | 역할 |
|--------|------|------|
| machineStore | `stores/machineStore.ts` | 설비 목록, 실시간 텔레메트리, 스케줄러, DNC 설정 |
| templateStore | `stores/templateStore.ts` | CNC 템플릿 CRUD, 선택된 템플릿 상태 |
| authStore | `stores/authStore.ts` | 로그인 사용자, 역할, accessToken |
| fileStore | `stores/fileStore.ts` | 파일 Repository, Transfer, GCode 뷰어 |
| layoutStore | `stores/layoutStore.ts` | 대시보드 레이아웃 (CardView/FactoryView) |
| cameraStore | `stores/cameraStore.ts` | 카메라 스트림 설정 |

---

## 7. API 스텁 현황 (lib/api.ts)

모든 API는 정의되어 있으나 **백엔드 미연결 → catch 블록에서 mock 데이터 반환** 패턴.

| API 객체 | 엔드포인트 | 상태 |
|----------|-----------|------|
| authApi | /api/auth/* | 스텁 (mock 로그인 동작) |
| machineApi | /api/machines/* | 스텁 |
| commandApi | /api/machines/:id/commands | 스텁 |
| schedulerApi | /api/machines/:id/scheduler/* | 스텁 |
| transferApi | /api/machines/:id/programs/* | 스텁 |
| templateApi | /api/templates/* | 스텁 |
| alarmApi | /api/machines/:id/alarms | 스텁 |
| auditApi | /api/audit | 스텁 |

---

## 8. CNC 도메인 지식

### 2-Path 자동선반 구조
- **Path 1** (주축): 공구번호 T01xx ~ T09xx
- **Path 2** (부축): 공구번호 T31xx ~ T32xx
- 각 Path 독립적으로 프로그램 실행

### FOCAS2 통신
- FANUC CNC와 직접 통신하는 라이브러리
- Agent (C# .NET 8)가 FOCAS2를 통해 데이터 수집
- 수집 주기: 텔레메트리 500ms, 알람 2초, PMC 1초

### DNC 모드
- `DNC_RUNNING` 상태일 때 Repository는 읽기 전용 잠금
- 스케줄러가 프로그램을 순차 실행하는 모드

### 제어권 (Control Lock)
- RemoteControl, Scheduler 페이지에서 제어 조작 시 필요
- 1인 독점 방식: 다른 사용자가 이미 획득 시 대기

---

## 9. 현재 구현 완료 항목

| 항목 | 완료도 |
|------|--------|
| 전체 UI 페이지 | ✅ 100% |
| 대시보드 (CardView / FactoryView) | ✅ |
| 원격 제어 (RemoteControl) | ✅ UI 완성 |
| 스케줄러 | ✅ UI 완성 |
| 파일 Transfer (2패널) | ✅ UI 완성 |
| 알람 이력 | ✅ |
| 감사 로그 | ✅ |
| 작업 지시 / POP | ✅ UI 완성 |
| 설비 관리 (MachineAdmin) | ✅ |
| 템플릿 편집기 (TemplateEditor) | ✅ 8개 섹션 |
| 가상 조작반 디자인 (PanelEditor) | ✅ |
| 인터록 편집기 (InterlockEditor) | ✅ 4모듈 |
| 권한 체계 (3단계) | ✅ |
| 다크모드 | ✅ |
| Mock 데이터 fallback | ✅ |

---

## 10. 미구현 / 실 장비 연동 전 필요 항목

### [HIGH] 스키마 불일치 해결
- DB `template` 테이블: `interlockConfig` JSON (구형)
- Frontend templateStore: `interlockModules` (신형 4모듈)
- Agent TemplateModel.cs: `InterlockConfig` (구형 Signal 경로 방식)
- → 세 곳 모두 신형 `interlockModules` 구조로 통일 필요

### [HIGH] DB 스키마 마이그레이션
```
Template 테이블에 추가 필요:
- axisConfig JSON
- interlockModules JSON
- virtualPanel JSON
(기존 interlockConfig → deprecated)
```

### [HIGH] MQTT 토픽 스키마 확정
```
cnc/{machineId}/telemetry   → 텔레메트리
cnc/{machineId}/alarms      → 알람
cnc/{machineId}/interlock   → 인터록 상태
cnc/{machineId}/status      → Agent online/offline
cnc/{machineId}/commands    → 명령 수신
cnc/{machineId}/command/ack → 명령 응답
```

### [HIGH] Server 템플릿 CRUD API 구현
- GET/POST/PUT/DELETE /api/templates
- POST /api/templates/:id/reload (Agent 캐시 무효화)

### [MEDIUM] Agent 업데이트
- TemplateModel.cs에 `interlockModules` 추가
- PMC 주소 파서: "R6001.3" → { type: R, addr: 6001, bit: 3 }
- 인터록 평가 엔진: 조건 AND 평가 → MQTT publish
- 템플릿 핫 리로드 (RELOAD_TEMPLATE 커맨드)

### [MEDIUM] Frontend WebSocket 실 연결
- machineStore에 WebSocket/MQTT 구독 추가
- 현재 mock → 실시간 텔레메트리 수신으로 교체

### [LOW] RemoteControl → virtualPanel 동적 렌더링
- 현재 버튼 하드코딩 → PanelEditor 데이터 기반 동적 렌더링

### [LOW] 설비 등록 → Agent 연결 자동화
- MachineAdmin 등록 → DB 저장 → Agent가 IP/Port 읽어 자동 연결

---

## 11. 주요 패턴 / 컨벤션

```typescript
// Mock fallback 패턴 (api.ts 전체에 적용)
const data = await someApi.fetch().catch(() => MOCK_DATA);

// 역할 체크 패턴
const canWrite = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';

// inline editing 패턴 (저장 버튼 없음, onBlur에서 commit)
<input onBlur={(e) => commitValue(e.target.value)} />

// templateStore 선택 패턴
const selectedTemplate = useSelectedTemplate(); // 현재 선택된 템플릿
const { selectTemplate, updateTemplate } = useTemplateStore();
```

---

## 12. 파일 경로 치트시트

```
packages/web/src/
├── pages/
│   ├── RemoteControl.tsx      원격 제어
│   ├── Scheduler.tsx          스케줄러 + DNC + Repository
│   ├── Transfer.tsx           파일 전송 2패널
│   ├── TemplateEditor.tsx     템플릿 편집 (8섹션)
│   ├── PanelEditor.tsx        가상 조작반 디자인
│   ├── InterlockEditor.tsx    인터록 편집 (4모듈)
│   └── MachineAdmin.tsx       설비 등록/삭제
├── stores/
│   ├── machineStore.ts        설비/텔레메트리/스케줄러
│   ├── templateStore.ts       CncTemplate 관리
│   ├── authStore.ts           인증/권한
│   └── fileStore.ts           파일 관리
├── components/
│   ├── MachineTopBar.tsx      상단 인터록 바 + 호기 선택 (pageId로 템플릿 기반 인터록)
│   ├── NCMonitor.tsx          NC 데이터 뷰어
│   ├── Layout.tsx             사이드바 + 네비게이션
│   └── ControlLockButton.tsx  제어권 획득/해제
└── lib/
    └── api.ts                 모든 API 클라이언트 스텁

packages/server/src/
├── routes/                    Express 라우터
└── prisma/schema.prisma       DB 스키마

packages/agent/StarWebCNC.Agent/
├── Focas/                     FOCAS2 연결/데이터 읽기
├── Collectors/                백그라운드 데이터 수집
├── Commands/                  명령 처리
├── Mqtt/                      MQTT publish/subscribe
└── Template/                  서버에서 템플릿 로드
```

---

## 13. 아키텍처 심층 분석 (2026-02-22)

### 종합 평가

레이어 설계(Frontend/Backend/Agent 분리)와 Mock Fallback 패턴, 템플릿 기반 추상화는 우수하다.
그러나 **레이어 간 계약(타입/토픽/API)이 미확정** 상태이며 실 장비 연결 전에 반드시 해결해야 한다.

---

### 구조적 강점

| 강점 | 설명 |
|------|------|
| Zustand 단방향 흐름 | API → Store → UI, 사이드이펙트 없음 |
| Mock Fallback 설계 | API 호출 실패 시 mock으로 자동 전환 → 백엔드 없이 개발 가능 |
| 템플릿 기반 추상화 | CncTemplate 1개로 PMC맵/인터록/조작반/스케줄러 설정 통합 |
| InterlockModules 4모듈 | remotePanel/scheduler/fileTransferIn/Out 각각 독립 조건 관리 |
| TopBarInterlock pageId | MachineTopBar가 페이지별로 다른 인터록 필드를 템플릿에서 동적 로드 |

---

### 위험 요소 (실 연동 전 필수 해결)

| 등급 | 항목 | 증상 |
|------|------|------|
| 🔴 HIGH | **템플릿 3중 불일치** | Frontend: interlockModules / DB: interlockConfig / Agent: InterlockConfig |
| 🔴 HIGH | **Control Lock SPOF** | 브라우저 메모리 저장 → 탭 닫으면 락 증발, 서버 재시작 시 고아 락 |
| 🔴 HIGH | **Mock→Real 타입 불일치** | TelemetryData 필드가 MQTT payload와 다를 경우 런타임 undefined |
| 🟡 MED | **MQTT QoS 미확정** | commands QoS0이면 명령 유실 위험 |
| 🟡 MED | **Agent 캐시 30분 고정** | 템플릿 핫 리로드 명령이 없어서 변경 반영이 늦음 |

---

### 필수 리팩터링 우선순위 (10개)

1. **[P0] interlockModules 스키마 통일** — DB 마이그레이션 + Agent TemplateModel.cs 신형으로 교체
2. **[P0] Control Lock → Redis SETNX+TTL** — 브라우저 메모리 제거, 서버 관리로 전환
3. **[P0] MQTT QoS 정책 확정** — 아래 표준안 적용
4. **[P1] DB 스키마 마이그레이션** — axisConfig, interlockModules, virtualPanel, panelLayout JSON 컬럼 추가
5. **[P1] Template CRUD API 구현** — GET/POST/PUT/DELETE /api/templates + reload 엔드포인트
6. **[P1] PMC 주소 파서 구현** — Agent: "R6001.3" → { type, addr, bit } 파싱
7. **[P1] 인터록 평가 엔진** — Agent: 조건 AND 평가 → MQTT 인터록 상태 publish
8. **[P2] machineStore WebSocket 실 연결** — mock 데이터 제거, MQTT over WebSocket 구독
9. **[P2] RemoteControl 가상조작반 동적 렌더링** — panelLayout 기반 버튼 동적 생성
10. **[P3] 설비 등록 → Agent 자동 연결** — MachineAdmin 저장 → Agent IP/Port 동적 관리

---

### MQTT 페이로드 표준 (확정안)

```
cnc/{machineId}/telemetry    QoS 0  retain=false  500ms
cnc/{machineId}/alarms       QoS 1  retain=true   이벤트
cnc/{machineId}/interlock    QoS 1  retain=true   1초
cnc/{machineId}/status       QoS 1  retain=true   이벤트 (online/offline)
cnc/{machineId}/commands     QoS 2  retain=false  명령
cnc/{machineId}/command/ack  QoS 2  retain=false  명령 응답
```

텔레메트리 페이로드 예시:
```json
{
  "ts": 1708567890123,
  "runState": 2,
  "mode": "MEM",
  "programNo": "O1001",
  "feedrate": 1200,
  "spindleSpeed": 3500,
  "spindleLoad": 42,
  "partsCount": 128,
  "presetCount": 200,
  "cycleTime": 45,
  "alarmActive": false,
  "absolutePosition": [12.3, -45.6],
  "path1": { "toolNo": "T0101", "feedrate": 1200 },
  "path2": { "toolNo": "T3101", "feedrate": 800 },
  "interlock": {
    "doorLock": true,
    "memoryMode": true,
    "barFeederAuto": true,
    "coolantOn": true,
    "machiningMode": true,
    "cuttingMode": true
  }
}
```

---

### Redis Control Lock 설계안

```
KEY:   cnc:lock:{machineId}
VALUE: { ownerId, ownerUsername, acquiredAt, expiresAt }
TTL:   300초 (5분)

획득: SETNX → 성공 시 TTL 300 설정
연장: 소유자만 EXPIRE 갱신 (300초 추가)
해제: DEL (소유자만)
확인: GET → TTL 남은 시간 = remaining
HeartBeat: 클라이언트가 30초마다 연장 요청
```

---

### 통합 Template DB 스키마 (확정안)

```sql
-- prisma/schema.prisma 추가 예정
model Template {
  id                  String   @id @default(uuid())
  templateId          String   @unique        -- "FANUC_0i-TF Plus_SB-20R2_V1"
  version             String
  name                String
  description         String   @default("")
  systemInfo          Json                    -- SystemInfo
  axisConfig          Json                    -- AxisConfig (신규)
  pmcMap              Json                    -- PmcMap
  interlockModules    Json                    -- InterlockModules 4모듈 (신규, 구 interlockConfig 대체)
  virtualPanel        Json                    -- VirtualPanel (신규)
  panelLayout         Json    @default("[]")  -- PanelGroup[] (신규)
  topBarInterlock     Json                    -- TopBarInterlockConfig (신규)
  schedulerConfig     Json
  capabilities        Json
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  createdBy           String
  isActive            Boolean  @default(true)
}
```

---

### 상용화 로드맵

| Phase | 내용 | 목표 |
|-------|------|------|
| Phase 1 (현재) | Frontend UI 완성, Mock 동작 | 사용성 검증 |
| Phase 2 | 백엔드 API + DB 마이그레이션 + Redis Control Lock | 서버 연동 |
| Phase 3 | Agent 업데이트 (인터록 평가) + MQTT 실 연결 | 1대 장비 연동 |
| Phase 4 | 다중 장비 + 실시간 대시보드 + 알람 이력 연동 | 공장 전체 운용 |
| Phase 5 | 멀티 테넌트 (tenantId + MQTT 네임스페이스 분리) | SaaS 전환 |

멀티 테넌트 MQTT 네임스페이스:
```
{tenantId}/cnc/{siteId}/{machineId}/telemetry
```
