# Scheduler System Design Document
# Star-WebCNC Scheduler 기능 설계

> 작성일: 2026-03-22
> 최종 검토: 2026-03-22 (2차 보완)
> 상태: 정책 확정 (구현 준비 완료)
> 목적: 구현 전 정책·시퀀스·구조 확정

---

## 1. 시스템 개요

Scheduler는 CNC 프로그램을 순서대로 자동 실행하며 생산 수량을 집계하는 시스템이다.

### 역할 요약

| 역할 | 내용 |
|------|------|
| 자동 실행 | 큐(SchedulerRow list)의 행을 순서대로 실행 |
| 수량 집계 | M20 PMC 비트 기반으로 생산 count 관리 |
| 안전 보장 | 인터록 조건 확인 후 실행 |
| 정상 정지 | 원사이클 스톱 기반 안전 종료 및 재개 |
| 동기화 | WebCNC count → CNC 매크로 변수 동기화 |

---

## 2. 카운트 정책

### 기본 원칙

**CNC 자체 카운터는 사용하지 않는다.**

| 항목 | 정책 |
|------|------|
| 완료 판단 기준 | M20 PMC 비트 수신 |
| 카운트 관리 주체 | **Agent** |
| CNC 카운터 | 표시용 동기화 목적으로만 사용 (기능 OFF 유지) |
| Server 역할 | Agent가 보고한 count 값을 DB / Redis / WS에 반영 |

### Count Authority = Agent

네트워크 지연이나 MQTT 메시지 중복 발생 시 Server 측 count 증가 방식은 불일치를 유발할 수 있다.
따라서 count의 권위(authority)는 **Agent에 둔다.**

```
[Agent 내부]
M20 PMC 비트 감지
→ 내부 count 증가
→ cnc_wrmacro로 CNC 매크로 변수 동기화
→ MQTT 이벤트 발행: { type: "M20_COMPLETE", count: N }

[Server]
Agent가 보고한 count 값을 수신
→ DB update (count = N)
→ Redis update
→ WS broadcast (scheduler_count)
```

Server는 count를 자체 계산하지 않는다. Agent 보고값을 그대로 반영한다.

### 이유

- CNC 카운터 사용 시 COUNT UP 알람 발생 → CNC 화면에서만 해제 가능 → 자동화 불가
- Agent가 count를 직접 관리하고 CNC 매크로 변수(`schedulerConfig.countDisplay.macroNo`, 기본 `#500`)에 동기화

### 첫 번째 M20 제외 정책

프로그램 선두에서 약 10라인 이내에 M20 코드가 존재하는 구조이므로,
**행 시작 후 첫 번째 M20은 카운트에서 제외**한다.

```
사이클 스타트 → 첫 M20 (제외) → ... → 두 번째 M20부터 count 집계
```

Agent 내부에서 행 실행 시 `skipFirstM20 = true`로 초기화하고,
첫 M20 수신 시 `false`로 전환하여 관리한다.

### M20 감지 방식

**M20 감지는 PMC bit polling 방식으로 수행한다.**

- FOCAS operator message API (`cnc_rdopmsg` 계열)는 D6G5 TT 기종에서 동작하지 않으므로 사용하지 않는다 (KNOWN_MISTAKES M-19 참조)
- M20 완료 신호에 해당하는 PMC 주소는 **템플릿 `schedulerConfig`에서 입력받는다**
- 코드에 하드코딩하지 않는다

---

## 3. 실행 모드 정책

### path1 실행 모드

장비별 공통 설정으로 관리한다. 행마다 선택하지 않는다.

| 모드 | 설명 |
|------|------|
| `memory` | CNC 내부 메모리에 저장된 프로그램을 번호로 호출하여 실행 |
| `dnc` | DNC 경로(외부 파일)에서 프로그램을 스트리밍으로 실행 |

> 설정 위치: MachineTopBar Settings → DNC 설정 화면 내 "실행 모드" 항목
> 기존 `MachineDncConfig` 구조에 `executionMode: 'memory' | 'dnc'` 필드 추가

### memory 모드 실행 방식

```
[4] 프로그램 번호 변경
    └─ FOCAS cnc_search(handle, programNo)
       → CNC 메모리에서 해당 번호의 프로그램을 활성화
       → path1: mainProgramNo, path2: subProgramNo 각각 호출

[5] 프로그램 선두 복귀 (Section 7-1 [5] 참조)
```

### dnc 모드 실행 방식

```
[4] DNC 경로 확인
    └─ schedulerConfig.dncPaths[path1/path2] 에 파일이 존재하는지 확인
    └─ 없으면 → Scheduler ERROR 처리

[5] CNC 이미 DNC 모드(aut=9) 상태 가정
    → 프로그램 번호 변경 불필요 (DNC 경로의 파일을 자동 로드)
    → 프로그램 선두 복귀: RESET 후 사이클 스타트로 대체

[6 이후] 동일 (HEAD 확인 → 원사이클 스톱 → 사이클 스타트)
```

> DNC 모드에서는 CNC가 외부 장치(DNC 경로)에서 직접 스트리밍 실행한다.
> Agent의 역할은 파일 준비 확인 및 사이클 스타트 신호 입력이다.

---

## 4. 인터록 정책

### 인터록 조건 출처

Scheduler는 인터록 조건을 직접 정의하지 않는다.
**템플릿 → TopBar 인터록 설정** (`scheduler` pageId)에서 정의된 조건을 그대로 사용한다.

```
template.topBarInterlock.scheduler.fields
  → 각 field.pmcAddr + field.normalState (A접/B접)
  → Agent가 pmcBits 폴링으로 전체 AND 평가
  → interlockSatisfied (bool) + failReasons (string[]) 생성
```

### 인터록 평가 위치

| 레이어 | 역할 |
|--------|------|
| **Agent** | pmcBits 직접 폴링 → `interlockSatisfied` 평가 → MQTT 보고 |
| **Server** | Agent 보고 수신 → DB/Redis 반영 (판단 안 함) |
| **UI** | `interlockSatisfied` 결과 표시 (topBarInterlock pills 재사용) |

### 예시 조건 (SB-20R2 — 템플릿 입력값이며 하드코딩 아님)

| 조건 | 주소 | 타입 |
|------|------|------|
| 도어 닫힘 | R6001.3 | A접 (1=OK) |
| 비상정지 해제 | R6001.2 | B접 (0=OK) |
| 절삭유 ON | 미확인 | A접 |
| 바피더 AUTO | 미확인 | A접 |

### 동작 정책

| 시점 | 조건 불만족 시 |
|------|-------------|
| 실행 전 | 시작 불가 (failReasons 포함 에러 메시지) |
| 실행 중 | 원사이클 스톱 ON → 현재 사이클 완료 후 `PAUSED` |

---

## 5. 행 편집 정책

### 상태별 편집 가능 여부

| 행 상태 | 프로그램 번호 수정 | preset 수정 | 삭제 |
|---------|-------------------|-------------|------|
| PENDING | ✅ | ✅ | ✅ |
| RUNNING | ❌ | ❌ | ❌ |
| PAUSED (정상 정지 재개 대기) | ✅ | ✅ | ✅ |
| COMPLETED | ❌ | ❌ | ✅ |
| CANCELLED | ❌ | ❌ | ✅ |

### 검사 시점

`count > preset` 검사는 **행이 시작되는 시점**에 수행한다.

> 이유: Scheduler 실행 중에도 PAUSED/PENDING 행의 설정 변경이 허용되므로,
> 시작 버튼 시점이 아닌 실제 행 실행 직전에 최종 상태를 검증한다.

### count > preset 위반 처리 흐름

```
행 시작 시점에 count > preset 감지
→ 해당 행 실행 안 함 (PENDING 상태 유지, 장비 대기)
→ Scheduler PAUSED 전환
→ UI 에러 팝업: "O0001 행의 COUNT(N)가 PRESET(M)을 초과합니다. 값을 수정 후 재개하세요."
→ 사용자: preset 또는 count 수정
→ RESUME → 해당 행 재검사 후 정상 실행
```

장비는 이미 전 행 완료 후 대기 상태이므로 추가적인 기계 정지 동작은 필요하지 않다.

### Scheduler 실행 중 허용 작업

- PENDING 행 추가
- PENDING/PAUSED 행 수정 및 삭제
- 파일 업로드 (DNC 레포지토리)

---

## 6. 재개 정책

정상 원사이클 스톱(PAUSED) 후 재개 시:

- **동일 행**에서 재개
- count 유지 (리셋 없음)
- 다음 M20 수신 시 count 증가 재개

```
예: preset=100, count=63 → 재개 → 다음 M20 수신 → count=64
```

---

## 7. 실행 시퀀스 상세

### 7-1. 행 시작 시퀀스

```
[1] 인터록 확인 (Agent 자체 평가)
    └─ interlockSatisfied === false
       → Scheduler ERROR, MQTT 에러 보고 (failReasons 포함)

[2] count > preset 검사
    └─ 위반 시
       → 해당 행은 실행하지 않음 (상태 변경 없음, PENDING 유지)
       → Scheduler PAUSED 전환 (장비는 전 행 완료 후 대기 중이므로 추가 정지 불필요)
       → MQTT SCHEDULER_ERROR 보고: { code: "COUNT_EXCEEDS_PRESET", rowId }
       → WS scheduler_error 이벤트 → UI 에러 팝업/메시지 박스 표시
       → 사용자가 preset 또는 count 수정 후 재개(RESUME) 가능

[3] Control Lock 확인
    └─ Redis key: control:lock:{machineId}
    └─ lock 미보유 → Scheduler ERROR 보고

[4] 프로그램 번호 변경 (실행 모드에 따라 분기)
    ┌─ memory 모드
    │   └─ FOCAS cnc_search(programNo): path1(mainProgramNo), path2(subProgramNo) 각각
    └─ dnc 모드
        └─ DNC 경로 파일 존재 확인 → 없으면 ERROR

[5] 프로그램 선두 복귀 (3단계 fallback — 아래 7-4 참조)

[6] HEAD 상태 확인
    └─ schedulerConfig.mainHeadAddr: 빈값이 아니면 → 현재 상태 읽기 → OFF이면 ON 처리
    └─ schedulerConfig.subHeadAddr: 빈값이 아니면 → 현재 상태 읽기 → OFF이면 ON 처리

[7] 원사이클 스톱 OFF 확인
    └─ schedulerConfig.oneCycleStopAddr: 빈값이 아니면 → ON이면 OFF 처리

[8] skipFirstM20 = true 초기화 (Agent 내부 상태)

[9] 사이클 스타트
    └─ PMC Write: panelLayout CYCLE_START reqAddr (longPress 방식)
```

### 7-2. 사이클 중 시퀀스

```
[사이클 실행 중]
    │
    ├─ 인터록 불만족 감지 (Agent pmcBits polling)
    │   └─ 원사이클 스톱 ON → 현재 사이클 완료 후 PAUSED
    │
    ├─ M20 PMC 비트 감지 (schedulerConfig.m20Addr 폴링)
    │   ├─ skipFirstM20 === true → 제외, skipFirstM20 = false
    │   │
    │   └─ skipFirstM20 === false → Agent 내부 count 증가
    │       ├─ cnc_wrmacro: 매크로 #macroNo = count 동기화
    │       ├─ MQTT M20_COMPLETE 보고: { type: "M20_COMPLETE", count: N }
    │       │   └─ Server: DB count = N, Redis 갱신, WS broadcast
    │       │
    │       ├─ count === preset - 1
    │       │   └─ 원사이클 스톱 ON
    │       │      ※ 마지막 1사이클 실행 후 CNC 정상 정지 보장
    │       │
    │       └─ count === preset → 완료 처리
    │           ├─ path2 only 실행 조건 확인 (7-3 참조)
    │           └─ 조건 미충족 → 행 COMPLETED, 다음 행으로 또는 전체 완료
    │
    └─ 원사이클 스톱 ON 상태 + M20 수신 (인터록 정지 케이스)
        └─ → 행 상태 PAUSED, 동일 행 재개 대기
```

> **원사이클 스톱 타이밍 정리**
> - `count === preset - 1` 시점에 원사이클 스톱 ON
> - CNC가 마지막 1사이클을 완료한 후 원사이클 스톱 상태로 자동 정지
> - 이후 M20 수신 → `count === preset` → 완료 처리로 진행
> - 이 방식으로 목표 수량 완료와 함께 항상 정상 정지가 보장된다.

### 7-3. path2 only 실행 시퀀스

**실행 조건**: 해당 행에 `subProgramNo`가 지정되어 있고,
`schedulerConfig.path2OnlyConfirmAddr`이 비어 있지 않은 경우에만 수행한다.

> path2 only는 별도 프로그램을 지정하는 것이 아니라,
> 해당 행에서 사용된 path2(subProgramNo)를 1사이클 더 실행하는 개념이다.

```
[조건 확인]
    └─ subProgramNo 없음 → 스킵, 행 COMPLETED
    └─ path2OnlyConfirmAddr 빈값 → 스킵, 행 COMPLETED

[1] 사이클 스타트 입력

[2] path2 only 확인 메시지 감지 (timeout 포함)
    └─ pmcBits[schedulerConfig.path2OnlyConfirmAddr] === 1 대기
    └─ 대기 한도: schedulerConfig.path2OnlyTimeoutMs (기본 4000ms)
    └─ timeout 발생 시 → schedulerConfig.path2OnlyTimeoutAction 에 따라 처리
        ├─ 'error': Scheduler ERROR 처리 (행 CANCELLED)
        └─ 'skip': path2 only 단계 스킵 → 행 COMPLETED

[3] schedulerConfig.path2OnlyConfirmDelayMs 대기 (기본 500ms)

[4] 사이클 스타트 재입력 (확인 응답)

[5] path2 사이클 완료 대기 (M20 PMC 비트 수신)

[6] 행 COMPLETED 처리 → 다음 행으로
```

### 7-4. 프로그램 선두 복귀 (3단계 Fallback)

프로그램 선두 복귀는 다음 순서로 시도한다.
어느 단계에서든 성공하면 이후 단계를 스킵한다.

```
[1차] FOCAS rewind
    └─ cnc_rewind(handle)
    └─ EW_OK → 성공
    └─ 실패 (EW_FUNC 등 미지원) → 2차 시도

[2차] RESET 신호
    └─ PMC Write: schedulerConfig.resetAddr (빈값이면 스킵)
    └─ RESET 후 300ms 대기
    └─ CNC 상태가 RESET 완료 → 성공
    └─ resetAddr 빈값이거나 실패 → 3차 시도

[3차] 프로그램 재호출 (cnc_search 재실행)
    └─ cnc_search(handle, programNo) 재실행
    └─ 프로그램 포인터가 선두로 이동하는 효과 기대
    └─ 실패 시 → Scheduler ERROR 처리
```

> FANUC 0i-TF Plus 기준 `cnc_rewind` 지원 여부는 실기기 확인 필요 (미결 사항 참조).
> resetAddr도 템플릿 설정 입력 항목이며 하드코딩하지 않는다.

---

## 8. Scheduler 상태 머신

Scheduler 상태는 **Agent가 관리의 주체**이며,
Server/UI는 Agent 보고를 수신하여 상태를 동기화한다.

### 상태 정의

| 상태 | 설명 |
|------|------|
| `IDLE` | 실행 대기 중. 큐가 비어있거나 모든 행이 완료/취소됨 |
| `RUNNING` | 행 실행 중. 사이클 진행 또는 M20 대기 중 |
| `PAUSED` | 원사이클 스톱 완료 또는 인터록 해소 대기. 동일 행 재개 가능 |
| `ERROR` | 인터록 실패, 프로그램 오류, timeout 등 비정상 정지 |

### 상태 전이 다이어그램

```
                    ┌─────────────────────────────────────┐
                    │              IDLE                    │
                    └────┬──────────────────────▲──────────┘
                         │ START                │ 전체 완료 / CANCEL
                         ▼                      │
                    ┌──────────┐                │
          ┌────────▶│ RUNNING  │────────────────┘
          │         └──┬───┬───┘
          │            │   │
          │   원사이클  │   │ 인터록 실패(hard)
     RESUME│   스톱완료 │   │ 시퀀스 오류
          │            ▼   ▼
          │         ┌──────────┐   CANCEL / RESET
          └─────────│  PAUSED  │──────────────────▶ IDLE
                    └──────────┘
                         │ ERROR 계열
                         ▼
                    ┌──────────┐   CANCEL / RESET
                    │  ERROR   │──────────────────▶ IDLE
                    └──────────┘
```

### 유효 전이 목록

| 이벤트 | FROM | TO |
|--------|------|----|
| `START` (PENDING 행 존재) | IDLE | RUNNING |
| `RESUME` | PAUSED | RUNNING |
| 원사이클 스톱 완료 또는 인터록 감지 | RUNNING | PAUSED |
| 전체 행 COMPLETED | RUNNING | IDLE |
| count > preset 감지 (행 시작 시점) | RUNNING | PAUSED (UI 팝업, 사용자 수정 후 RESUME) |
| 시퀀스 오류 / timeout / 인터록 강제 정지 | RUNNING, PAUSED | ERROR |
| `CANCEL` | RUNNING, PAUSED, ERROR | IDLE |

> `CANCEL` 시 현재 RUNNING 행은 CANCELLED로 처리, 나머지 PENDING 행은 PENDING 유지.

---

## 9. 데이터 모델 정리

### 9-1. DB 모델 정의

기존 `SchedulerJob`, `SchedulerItem` 2개 모델은 모두 폐기한다.
요구사항에 맞는 **행 기반 단일 Scheduler 모델** `SchedulerRow`로 새로 정의한다.

```prisma
model SchedulerRow {
  id            String             @id @default(uuid())
  machineDbId   String             @map("machine_id")        // Machine.id (FK)
  order         Int                                           // 실행 순서 (1부터, 큐 내 위치)
  mainProgramNo String             @map("main_program_no")   // 예: "O0001"
  subProgramNo  String?            @map("sub_program_no")    // 예: "O9001" (2-Path, null 가능)
  preset        Int                                           // 목표 수량
  count         Int                @default(0)               // 현재 완료 수량 (Agent authority)
  status        SchedulerRowStatus @default(PENDING)
  lastError     String?            @map("last_error")        // 마지막 오류 메시지
  lastErrorCode String?            @map("last_error_code")   // 오류 코드 (예: INTERLOCK_FAIL)
  lastErrorAt   DateTime?          @map("last_error_at")     // 오류 발생 시각
  createdBy     String             @map("created_by")        // username
  startedAt     DateTime?          @map("started_at")
  completedAt   DateTime?          @map("completed_at")
  createdAt     DateTime           @default(now()) @map("created_at")
  updatedAt     DateTime           @updatedAt @map("updated_at")

  machine Machine @relation(fields: [machineDbId], references: [id], onDelete: Cascade)

  @@index([machineDbId, order])
  @@index([machineDbId, status])
  @@map("scheduler_rows")
}

enum SchedulerRowStatus {
  PENDING      // 대기 (미실행)
  RUNNING      // 실행 중
  PAUSED       // 정상 원사이클 스톱 후 재개 대기
  COMPLETED    // 목표 수량 완료
  CANCELLED    // 취소 또는 에러 정지
}
```

> 기존 `SchedulerJob` / `SchedulerItem` 모델 및 관련 enum은 마이그레이션 시 제거.

### 9-2. Redis 키 구조

#### Scheduler 상태 키

| 키 | 내용 | TTL |
|----|------|-----|
| `scheduler:{machineId}:rows` | 큐 전체 (SchedulerRow[] JSON) | 없음 (명시적 삭제) |
| `scheduler:{machineId}:running` | `{ rowId: string, skipFirstM20: boolean, count: number }` | 24h |
| `scheduler:{machineId}:state` | `'IDLE' \| 'RUNNING' \| 'PAUSED' \| 'ERROR'` | 24h |

#### Control Lock 키 (기존 구조 유지)

| 키 | 내용 | TTL |
|----|------|-----|
| `control:lock:{machineId}` | `{ ownerId, ownerUsername, acquiredAt, expiresAt, sessionId }` | **300초 (5분)** |

#### Control Lock 정책 (Scheduler 연동)

Scheduler는 Control Lock을 통해 다른 제어 채널(Remote Panel, Manual API 등)과 충돌을 방지한다.

```
한 시점에 하나의 제어 주체만 허용:
  Scheduler 실행 중 → Control Lock 소유자만 조작 가능
  Remote Panel 제어 중 → Scheduler START 불가

TTL 정책:
  일반 조작: 300초 (5분), 수동 연장 가능
  Scheduler 자동 실행 중: 매 행 시작 시 TTL 자동 갱신 (재취득)
    → Scheduler가 장시간 실행되어도 Lock이 만료되지 않도록 보장
```

### 9-3. Frontend 타입 (machineStore)

```typescript
interface SchedulerRow {
  id: string;
  machineId: string;          // machineId (표시용, machineDbId 아님)
  order: number;
  mainProgramNo: string;
  subProgramNo?: string;
  preset: number;
  count: number;              // Agent authority — Server가 보고값으로 갱신
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  lastError?: string;
  lastErrorCode?: string;
  lastErrorAt?: string;
  createdBy?: string;
  startedAt?: string;
  completedAt?: string;
}

// Scheduler 전체 상태 (장비 단위)
type SchedulerState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'ERROR';
```

> 기존 `SchedulerJob` → `SchedulerRow` 대체.
> `useSchedulerJobs` → `useSchedulerRows` 이름 변경.
> `machineStore`에 장비별 `schedulerState: Record<string, SchedulerState>` 추가.

---

## 10. 템플릿 Scheduler 설정 구조

### `schedulerConfig` 재정의

모든 주소 값은 **템플릿 편집 화면에서 입력받는 항목**이다.
확정된 주소를 코드에 하드코딩하지 않는다.

```typescript
interface SchedulerConfig {
  // ── M20 감지 (PMC bit polling) ────────────────
  m20Addr: string;             // M20 완료 신호 PMC 주소 (읽기 전용)
                               // 빈값이면 Scheduler 실행 불가 (필수 항목)

  // ── 카운트 동기화 ──────────────────────────────
  countDisplay: {
    macroNo: number;           // CNC 매크로 변수 번호 (기본 500 → #500)
  };

  // ── 프로그램 선두 복귀 ─────────────────────────
  resetAddr: string;           // 2차 fallback: RESET 신호 PMC 주소. 빈값이면 2차 스킵

  // ── 원사이클 스톱 ─────────────────────────────
  oneCycleStopAddr: string;    // PMC 주소 (읽기/쓰기). 빈값이면 제어 스킵

  // ── HEAD 상태 제어 ────────────────────────────
  mainHeadAddr: string;        // MAIN HEAD ON/OFF PMC 주소. 빈값이면 스킵
  subHeadAddr: string;         // SUB HEAD ON/OFF PMC 주소. 빈값이면 스킵

  // ── path2 only 확인 메시지 ────────────────────
  path2OnlyConfirmAddr: string;      // 확인 메시지 활성 PMC 주소 (읽기 전용)
                                     // 빈값이면 path2 only 시퀀스 전체 스킵
  path2OnlyConfirmDelayMs: number;   // 감지 후 사이클 스타트까지 대기 (기본 500ms)
  path2OnlyTimeoutMs: number;        // 확인 메시지 감지 대기 timeout (기본 4000ms)
  path2OnlyTimeoutAction: 'error' | 'skip'; // timeout 시 동작 (기본 'error')

  // ── 큐 설정 ───────────────────────────────────
  maxQueueSize: number;        // 큐 최대 행 수 (기본 15)
}
```

### 기본값

```typescript
const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  m20Addr: '',
  countDisplay: { macroNo: 500 },
  resetAddr: '',
  oneCycleStopAddr: '',
  mainHeadAddr: '',
  subHeadAddr: '',
  path2OnlyConfirmAddr: '',
  path2OnlyConfirmDelayMs: 500,
  path2OnlyTimeoutMs: 4000,
  path2OnlyTimeoutAction: 'error',
  maxQueueSize: 15,
};
```

> 기존 `countSignal`, `countMode`, `oneCycleStopSupported`, `oneCycleStopPmcAddress` 필드는
> 위 구조로 대체하므로 **제거 대상**.

---

## 11. Agent / Server / UI 역할 분리

### Agent 역할

Agent는 Scheduler 실행의 실질적 제어자다.
**count authority, 인터록 평가, 시퀀스 제어 모두 Agent에서 수행한다.**

| 작업 | 방법 |
|------|------|
| 큐 상태 수신 | MQTT `server/scheduler/{machineId}` 구독 |
| **인터록 평가** | pmcBits polling → `topBarInterlock.scheduler.fields` AND 평가 |
| **count 관리** | Agent 내부 count 증가 → wrmacro 동기화 → MQTT 보고 |
| 프로그램 선두 복귀 | cnc_rewind → RESET → cnc_search 재호출 (3단계 fallback) |
| 프로그램 번호 변경 | FOCAS `cnc_search` (memory 모드) / DNC 경로 확인 (dnc 모드) |
| HEAD ON/OFF | PMC Write (`mainHeadAddr`, `subHeadAddr`) |
| 원사이클 스톱 ON/OFF | PMC Write (`oneCycleStopAddr`) |
| 사이클 스타트 | PMC Write (panelLayout CYCLE_START reqAddr) |
| M20 감지 | pmcBits polling (`m20Addr`) — PMC bit 방식 |
| path2 only 감지 | pmcBits polling (`path2OnlyConfirmAddr`) + timeout |
| 매크로 변수 동기화 | FOCAS `cnc_wrmacro` (macroNo ← count) |
| 상태/에러 보고 | MQTT `agent/events/{machineId}` |
| Control Lock TTL 갱신 | 매 행 시작 시 Server에 갱신 요청 (MQTT 또는 API) |

### Server 역할

Server는 **상태 관리 및 UI 전달 역할만** 담당한다.
count 계산, 인터록 판단, 시퀀스 제어는 관여하지 않는다.

| 작업 | 방법 |
|------|------|
| 큐 CRUD | REST API `/api/scheduler/rows` |
| 큐 상태 Redis 저장 | `scheduler:{machineId}:*` |
| Agent 명령 전달 | MQTT `server/scheduler/{machineId}` 발행 |
| M20_COMPLETE 수신 | MQTT 구독 → count = Agent 보고값으로 DB/Redis 갱신 |
| WS 브로드캐스트 | `scheduler_update`, `scheduler_count`, `scheduler_state`, `scheduler_error` |
| Control Lock 관리 | Redis `control:lock:{machineId}` CRUD |
| 인터록 판단 | **하지 않음** — Agent 보고 결과 수신만 |

### Frontend (UI) 역할

| 작업 | 방법 |
|------|------|
| 큐 표시 및 편집 | REST API 호출 후 로컬 Zustand 반영 |
| 실행 / 정지 버튼 | REST API → Server → MQTT → Agent |
| 실시간 count 업데이트 | WS `scheduler_count` 이벤트 구독 |
| 상태 표시 | WS `scheduler_state` 이벤트 구독 |
| 인터록 상태 표시 | topBarInterlock pills (기존 구조 재사용) |
| 에러 표시 | WS `scheduler_error` 이벤트 + 행 `lastError` 필드 표시 |

---

## 12. API 설계

### REST Endpoints

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/scheduler/rows?machineId=` | 큐 목록 + Scheduler 상태 | 전체 |
| POST | `/api/scheduler/rows` | 행 추가 | ADMIN, HQ_ENGINEER |
| PUT | `/api/scheduler/rows/:id` | 행 수정 (PENDING, PAUSED만) | ADMIN, HQ_ENGINEER |
| DELETE | `/api/scheduler/rows/:id` | 행 삭제 (RUNNING 제외) | ADMIN, HQ_ENGINEER |
| POST | `/api/scheduler/rows/reorder` | 순서 변경 | ADMIN, HQ_ENGINEER |
| POST | `/api/scheduler/start?machineId=` | 큐 실행 시작 | ADMIN, HQ_ENGINEER |
| POST | `/api/scheduler/resume?machineId=` | PAUSED → RUNNING | ADMIN, HQ_ENGINEER |
| POST | `/api/scheduler/pause?machineId=` | 원사이클 스톱 요청 | ADMIN, HQ_ENGINEER |
| POST | `/api/scheduler/cancel?machineId=` | 즉시 정지 + 취소 | ADMIN, HQ_ENGINEER |

> start/resume/pause/cancel은 **장비 단위** 조작이다.

### WebSocket 이벤트 (서버 → 클라이언트)

| 이벤트 | 페이로드 | 용도 |
|--------|----------|------|
| `scheduler_update` | `{ machineId, rows: SchedulerRow[] }` | 큐 전체 갱신 |
| `scheduler_count` | `{ machineId, rowId, count }` | count 단건 갱신 (M20마다) |
| `scheduler_state` | `{ machineId, state: SchedulerState }` | 전체 상태 변경 |
| `scheduler_error` | `{ machineId, rowId?, code, message }` | 에러 표시 |

### MQTT Topics

| 토픽 | 발행자 | 메시지 type |
|------|--------|-------------|
| `server/scheduler/{machineId}` | Server | `START`, `RESUME`, `PAUSE`, `CANCEL` |
| `agent/events/{machineId}` | Agent | `M20_COMPLETE` `{ count: N }`, `SCHEDULER_PAUSED`, `SCHEDULER_ERROR` `{ code, message }`, `SCHEDULER_ROW_COMPLETED`, `SCHEDULER_COMPLETED` |

---

## 13. UI 구조

### 13-1. Scheduler 페이지 레이아웃

```
┌──────────────────────────────────────────────────────────────┐
│ MachineTopBar (장비선택 | 인터록 pills + 경광등)               │
│ [Settings: DNC경로 + path1 실행 모드 (memory/dnc)]            │
├─────────────────────┬────────────────────────────────────────┤
│  NC 모니터          │  현재 실행 상태                         │
│  (NCMonitor)        │  [RUNNING] O0001 / O9001   63 / 100    │
│                     │  [▶ 실행] [▶ 재개] [⏸ 원사이클 스톱] [■ 취소]
│  path1/path2        ├────────────────────────────────────────┤
│  좌표/프로그램      │  No │메인PGM│서브PGM│PRESET│COUNT│상태│ ✕ │
│                     │   1 │O0001  │O9001  │  100 │  63 │실행│    │
│  [탭: 모니터/카메라 │   2 │O0002  │O9001  │   50 │   0 │대기│ ✕  │
│   /오프셋/카운트/   │   3 │       │       │      │     │   │ ✕  │
│   툴라이프]         │  [+ 행 추가]                  [초기화]  │
├─────────────────────┴────────────────────────────────────────┤
│  FOCAS 이벤트 로그                                            │
└──────────────────────────────────────────────────────────────┘
```

### 13-2. 실행 제어 버튼 활성 조건

| 버튼 | 활성 조건 | 동작 |
|------|----------|------|
| ▶ 실행 | `hasControlLock && state==='IDLE'` && PENDING 행 존재 | 큐 실행 시작 |
| ▶ 재개 | `hasControlLock && state==='PAUSED'` | 동일 행 재개 |
| ⏸ 원사이클 스톱 | `hasControlLock && state==='RUNNING'` | 원사이클 스톱 ON |
| ■ 취소 | `hasControlLock && state!=='IDLE'` | 즉시 정지 + CANCELLED |

> ▶ 실행 / ▶ 재개는 동일 위치에서 상태에 따라 전환 표시한다.

### 13-3. 에러 행 표시

CANCELLED 상태이고 `lastError`가 있는 행은:
- 행 배경 빨간색 처리
- 상태 셀에 툴팁으로 `lastError` 표시

### 13-4. 템플릿 편집 화면 — Scheduler 설정 섹션 (Section 8)

```
8. Scheduler 설정
│
├── M20 감지 (필수)
│   └── M20 완료 신호 PMC 주소: [____.__]
│
├── 카운트 동기화
│   └── CNC 매크로 변수 번호: [500]
│
├── 프로그램 선두 복귀
│   └── RESET 신호 PMC 주소: [____.__]   ← 빈값이면 2차 fallback 스킵
│
├── 원사이클 스톱
│   └── PMC 주소: [____.__]   ← 빈값이면 제어 스킵
│
├── HEAD 제어
│   ├── MAIN HEAD PMC 주소: [____.__]   ← 빈값이면 스킵
│   └── SUB HEAD PMC 주소:  [____.__]   ← 빈값이면 스킵
│
├── path2 only 확인 메시지
│   ├── 확인 메시지 PMC 주소: [____.__]   ← 빈값이면 path2 only 전체 스킵
│   ├── 사이클 스타트 지연: [500] ms
│   ├── 감지 대기 timeout: [4000] ms
│   └── timeout 동작: [error ▼] (error / skip)
│
└── 큐 설정
    └── 최대 행 수: [15]
```

---

## 14. 구현 대상 파일 목록 (참고용)

| 레이어 | 파일 | 작업 내용 |
|--------|------|----------|
| Agent | `CommandHandler.cs` | `START`, `RESUME`, `PAUSE`, `CANCEL` MQTT 핸들러 |
| Agent | `DataCollectorService.cs` | M20 PMC 폴링, 인터록 평가 루프, Scheduler 시퀀스 루프 |
| Agent | `TemplateModel.cs` | `SchedulerConfig` 재정의 |
| Server | `routes/scheduler.ts` | SchedulerRow API 재설계, 상태 머신 관리 |
| Server | `lib/websocket.ts` | scheduler_* 이벤트 4종 추가 |
| Server | `prisma/schema.prisma` | `SchedulerRow` 신규, `SchedulerJob`/`SchedulerItem` 제거 |
| Server | `prisma/migrations/` | 마이그레이션 파일 |
| Frontend | `stores/machineStore.ts` | `SchedulerRow` 타입, `schedulerState` 추가, WS 핸들러 |
| Frontend | `stores/templateStore.ts` | `SchedulerConfig` 재정의 |
| Frontend | `lib/api.ts` | `schedulerApi` 엔드포인트 재정의 |
| Frontend | `pages/Scheduler.tsx` | 실행 버튼 연결, 상태 머신 반영, 에러 표시 |
| Frontend | `pages/TemplateEditor.tsx` | Section 8 Scheduler 설정 UI |

---

## 15. 미결 사항 (실기기 확인 필요)

모든 PMC 주소는 **템플릿 설정 입력 항목**이며 코드에 하드코딩하지 않는다.

| # | 항목 | 현황 |
|---|------|------|
| 1 | M20 완료 신호 PMC 주소 | R6002.4 기확인 — 실기기 최종 확인 필요 |
| 2 | 원사이클 스톱 PMC 주소 | 미확인 |
| 3 | MAIN HEAD PMC 주소 | 미확인 |
| 4 | SUB HEAD PMC 주소 | 미확인 |
| 5 | RESET 신호 PMC 주소 | 미확인 |
| 6 | path2 only 확인 메시지 PMC 주소 | 미확인 (A209.x 계열 예상) |
| 7 | `cnc_rewind` FOCAS 지원 여부 | FANUC D6G5 TT 기종 미확인 |
| 8 | `cnc_search` 동작 확인 | memory 모드 프로그램 선택 방식 실기기 검증 필요 |

---

*정책 확정 완료 → 구현 단계 진입 가능*
