# 스케줄러 순차 제어 상태 머신 설계서

## 0. 용어 정의

| 용어 | 설명 |
|------|------|
| Row | 스케줄러 테이블의 한 행 (mainPgm + subPgm + preset + count) |
| M20 | FANUC 프로그램 종료 신호 (원사이클 스톱 위치) |
| Ghost M20 | 프로그램 선두 직후의 첫 번째 M20 (카운트에서 제외) |
| pcCount | Agent가 관리하는 PC-side 카운트 (SoT) |
| OneCycle | 원사이클 버튼 (ON 시 M20에서 장비 정지) |
| ClearCycle | 목표 수량 완료 후 Head2만 ON + CycleStart 1회 (잔재 클리어) |

---

## 1. 상태 머신 (State Machine)

### 1.1 상태 목록

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   IDLE ──▶ PRECHECK ──▶ PREPARE_PROGRAM ──▶ SYNC_COUNT              │
│                                               │                      │
│                                               ▼                      │
│                          CYCLE_START ◀── PANEL_ALIGN                 │
│                               │                                      │
│                               ▼                                      │
│                           RUNNING ──────────────┐                    │
│                            │  │                 │                    │
│                   [M20감지] │  │[Preset-1]      │[인터록위반]        │
│                            │  │                 │                    │
│                            ▼  ▼                 ▼                    │
│                     COUNT_CHECK           INTERRUPTED                │
│                        │    │                 │                      │
│               [미완료]  │    │[완료]     [복구] │                      │
│                  │     │    │                 │                      │
│                  ▼     │    ▼                 ▼                      │
│               RUNNING  │  CLEARING ──▶ ROW_DONE ──▶ NEXT_ROW        │
│                        │                           │                 │
│                        │                    [행없음]│                 │
│                        │                           ▼                 │
│                        │                      COMPLETED              │
│                        │                                             │
│                        └──▶ RESUMING ──▶ (복귀 시점 상태)            │
│                                                                      │
│   * 모든 상태에서 INTERRUPTED 전이 가능 (인터록 위반 시)              │
│   * 모든 상태에서 STOPPED 전이 가능 (사용자 정지 요청 시)            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 상태 정의 및 전이 조건

| 상태 | 설명 | 진입 조건 | 탈출 조건 |
|------|------|-----------|-----------|
| `IDLE` | 대기. 스케줄러 미실행 | 초기 / 완료 / 사용자 정지 | 사용자가 [시작] 클릭 |
| `PRECHECK` | 인터록+모드+CNC카운터 사전 검증 | IDLE에서 시작 요청 | 모든 조건 통과 → PREPARE_PROGRAM / 실패 → IDLE |
| `PREPARE_PROGRAM` | 프로그램 선택/등록/선두 이동 | PRECHECK 통과 | 프로그램 등록 확인 → SYNC_COUNT / 실패 → IDLE(에러) |
| `SYNC_COUNT` | Preset/Count를 CNC 매크로에 동기화 | PREPARE_PROGRAM 완료 | 동기화 확인 → PANEL_ALIGN |
| `PANEL_ALIGN` | OneCycle OFF 확인, Head ALL ON 보장 | SYNC_COUNT 완료 | 패널 정렬 완료 → CYCLE_START |
| `CYCLE_START` | 사이클 스타트 실행 | PANEL_ALIGN 완료 | CNC 운전 시작 확인 → RUNNING |
| `RUNNING` | 가공 중. M20 감시 + 인터록 감시 | CYCLE_START 성공 | M20 감지 → COUNT_CHECK / 인터록 위반 → INTERRUPTED |
| `COUNT_CHECK` | M20 수신 후 카운트 판정 | RUNNING에서 M20 감지 | Ghost → RUNNING / 유효 → pcCount++ → 미완료:RUNNING / 완료:CLEARING / Preset-1:OneCycle ON 후 RUNNING |
| `CLEARING` | 목표 완료 후 Head2 Only + CycleStart 1회 | COUNT_CHECK에서 완료 판정 | 클리어 M20 감지 → ROW_DONE |
| `ROW_DONE` | 현재 Row 완료 처리 | CLEARING 완료 | 다음 Row 있음 → NEXT_ROW / 없음 → COMPLETED |
| `NEXT_ROW` | 다음 Row로 전환 | ROW_DONE에서 다음 Row 존재 | 커서 이동 완료 → PRECHECK (다음 Row) |
| `COMPLETED` | 모든 Row 완료 | ROW_DONE에서 다음 Row 없음 | 사용자 확인 → IDLE |
| `INTERRUPTED` | 인터록 위반으로 중단 | 모든 상태에서 인터록 위반 | 인터록 복구 → RESUMING |
| `RESUMING` | 중단 후 재개. 조건 재검증 | INTERRUPTED에서 인터록 복구 | 검증 통과 → 중단 시점 상태 복귀 / 실패 → INTERRUPTED |
| `STOPPED` | 사용자 정지 (OneCycleStop 후 M20 대기) | 사용자 [정지] 클릭 | M20 감지 → IDLE |

---

## 2. 시퀀스 단계 테이블

### 2.1 정상 실행 시퀀스 (1 Row 기준)

| Step | 상태 | 설명 | FOCAS 명령 | 성공 조건 | 실패 처리 |
|------|------|------|-----------|-----------|-----------|
| S01 | PRECHECK | 인터록 전체 AND 확인 | PMC Read (인터록 주소들) | 모든 조건 true | 불충족 조건 메시지 → IDLE |
| S02 | PRECHECK | 운전모드 확인 (MEM/DNC) | `cnc_statinfo` | mode == MEM or DNC | "운전모드를 MEM/DNC로 변경하세요" → IDLE |
| S03 | PRECHECK | CNC Parts Counter OFF 확인 | PMC Read / `cnc_rdparam` | Parts Counter == OFF | "CNC 카운터를 OFF로 설정하세요" → IDLE |
| S04 | PREPARE_PROGRAM | 프로그램 선택 (MEM모드) | `cnc_pdf_slctmain` / `cnc_wrpmcrng` | 프로그램 번호 일치 확인 | 재시도 1회 → 실패 시 IDLE |
| S05 | PREPARE_PROGRAM | 프로그램 선두 확인/이동 | `cnc_rdexecprog` + 블록 확인 | 블록 == 선두 (N00000 등) | EDIT 전환 → 선두 이동 → MEM/DNC 복귀 |
| S06 | PREPARE_PROGRAM | (필요 시) EDIT 전환 | `cnc_wrpmcrng` (모드 변경 PMC) | mode == EDIT | "모드 전환 실패" → IDLE |
| S07 | PREPARE_PROGRAM | (필요 시) 선두 이동 후 MEM/DNC 복귀 | 모드 변경 PMC Write | mode == MEM or DNC | "모드 복귀 실패" → IDLE |
| S08 | SYNC_COUNT | Preset/Count → CNC 매크로 동기화 | `cnc_wrmacro(#macroNo, pcCount)` | 매크로 읽기로 검증 | 재시도 → 실패 시 IDLE |
| S09 | PANEL_ALIGN | OneCycle 상태 확인 | PMC Read (OneCycle 주소) | OneCycle 상태 파악 | - |
| S10 | PANEL_ALIGN | OneCycle ON → OFF 전환 | PMC Write (OneCycle = OFF) | OneCycle == OFF | "원사이클 해제 실패" → IDLE |
| S11 | PANEL_ALIGN | Head1/2/3 상태 확인 | PMC Read (Head 주소들) | 각 Head 상태 파악 | - |
| S12 | PANEL_ALIGN | OFF인 Head → ALL ON | PMC Write (Head = ON) | 모든 Head == ON | "헤드 ON 실패" → IDLE |
| S13 | CYCLE_START | 사이클 스타트 실행 | PMC Write (CycleStart ON → hold → OFF) | runState 변경 감지 | "사이클 스타트 실패" → IDLE |
| S14 | RUNNING | Ghost M20 대기 | PMC Read (M20 신호 감시, 200ms) | 첫 M20 감지 | (타임아웃 없음, Ghost가 없는 프로그램도 허용) |
| S15 | RUNNING | 유효 M20 감시 + 카운트 | PMC Read (M20 신호, 200ms) | M20 감지 시 pcCount++ | 인터록 위반 → INTERRUPTED |
| S16 | COUNT_CHECK | pcCount == preset-1 판정 | (내부 로직) | 조건 일치 → OneCycle ON | - |
| S17 | RUNNING | OneCycle ON 후 계속 운전 | PMC Write (OneCycle = ON) | 장비가 M20에서 정지 | - |
| S18 | COUNT_CHECK | pcCount == preset 판정 | (내부 로직) | 목표 도달 → CLEARING | 미도달 → RUNNING 유지 |
| S19 | CLEARING | Head2 Only ON (Head1/3 OFF) | PMC Write (Head1=OFF, Head2=ON, Head3=OFF) | Head 상태 확인 | 재시도 |
| S20 | CLEARING | OneCycle ON 유지 확인 | PMC Read | OneCycle == ON | ON 아니면 ON으로 설정 |
| S21 | CLEARING | CycleStart 1회 실행 | PMC Write (CycleStart) | 실행 확인 | 재시도 |
| S22 | CLEARING | 클리어 M20 대기 | PMC Read (M20 감시) | M20 감지 | 타임아웃 → 경고 |
| S23 | ROW_DONE | Row 완료 기록 | DB 저장 / 이벤트 로그 | 저장 성공 | - |
| S24 | NEXT_ROW | 다음 Row 존재 확인 | (내부 로직) | 있음 → S01로 | 없음 → COMPLETED |

---

## 3. 인터록 중단 및 재개 정책

### 3.1 State Snapshot (중단 시 저장 데이터)

```typescript
interface SchedulerSnapshot {
  // 위치 정보
  currentRowIndex: number;         // 현재 실행 중인 Row 인덱스
  currentRowId: string;            // Row 고유 ID

  // 상태 머신
  stateBeforeInterrupt: SchedulerState;  // 중단 직전 상태
  stepBeforeInterrupt: number;           // 중단 직전 Step 번호

  // 카운트 정보
  pcCount: number;                 // 현재 카운트
  preset: number;                  // 목표 수량
  ghostM20Passed: boolean;         // Ghost M20 통과 여부
  oneCycleActivated: boolean;      // Preset-1 도달로 OneCycle ON 했는지

  // 프로그램 정보
  mainProgramNo: string;
  subProgramNo: string;
  operatingMode: 'MEM' | 'DNC';

  // 패널 상태 (중단 직전)
  headStates: { head1: boolean; head2: boolean; head3?: boolean };
  oneCycleState: boolean;

  // 타임스탬프
  interruptedAt: string;           // 중단 시각 (ISO 8601)
  interruptReason: string;         // 중단 사유
  violatedConditions: string[];    // 위반된 인터록 조건 목록
}
```

### 3.2 인터록 감시 루프 (모든 상태에서 동작)

```
┌──────────────────────────────────────────────────────────────────┐
│ Interlock Watcher (200ms 주기)                                   │
│                                                                  │
│ 매 200ms마다:                                                    │
│   1. PMC Read → 인터록 전체 조건 확인                            │
│   2. 하나라도 false → INTERRUPT 트리거                            │
│      a. 현재 상태 snapshot 저장                                  │
│      b. FOCAS 명령 전송 즉시 중단 (진행 중인 명령 취소)          │
│      c. 상태 → INTERRUPTED                                      │
│      d. 이벤트 로그: "[인터록 위반] {조건명} 해제됨"             │
│      e. 서버/UI에 상태 Push                                      │
│                                                                  │
│ INTERRUPTED 상태에서:                                             │
│   1. 인터록 감시 계속 (200ms)                                    │
│   2. 모든 조건 복구 감지 시 → RESUMING 전이 가능                 │
│   3. 자동 재개는 하지 않음 (사용자 [재개] 클릭 필요)             │
└──────────────────────────────────────────────────────────────────┘
```

### 3.3 재개(Resume) 시 재검증 절차

| 순서 | 검증 항목 | 실패 시 |
|------|-----------|---------|
| R01 | 인터록 전체 AND 재확인 | "인터록 조건이 아직 불만족합니다" → INTERRUPTED 유지 |
| R02 | 운전모드 확인 (MEM/DNC) | "운전모드가 변경되었습니다. 확인 후 재시도" |
| R03 | 프로그램 번호 일치 확인 | 불일치 시 PREPARE_PROGRAM부터 재실행 |
| R04 | CNC Parts Counter OFF 확인 | "CNC 카운터를 OFF로 설정하세요" |
| R05 | `ghostM20Passed` 복원 | snapshot에서 복원 (재감지 불필요) |
| R06 | pcCount 복원 및 CNC 매크로 재동기화 | `cnc_wrmacro`로 재기록 |
| R07 | 패널 상태 재정렬 (중단 시점 기준) | PANEL_ALIGN 재실행 |

**재개 전이 결정 로직**:
```
if (snapshot.stateBeforeInterrupt가 RUNNING/COUNT_CHECK):
  → PANEL_ALIGN부터 재개 (패널 상태 변조 가능성)
  → ghostM20Passed, pcCount는 snapshot 값 유지

if (snapshot.stateBeforeInterrupt가 PREPARE_PROGRAM 이전):
  → 해당 상태부터 처음부터 재실행

if (snapshot.stateBeforeInterrupt가 CLEARING):
  → CLEARING부터 재개 (Head2 Only + CycleStart 재시도)
```

### 3.4 Ghost M20과 재개 시 카운트 기준

```
프로그램 실행 타임라인:
─────────────────────────────────────────────────────────────
  [CycleStart] → [Ghost M20] → [유효 M20 #1] → [유효 M20 #2] → ...
                      │              │                │
                  카운트 무시     pcCount=1        pcCount=2
                      │
              ghostM20Passed=true
─────────────────────────────────────────────────────────────

중단/재개 시:
  - ghostM20Passed == true → 이후 모든 M20은 유효 카운트
  - ghostM20Passed == false → 다음 M20은 Ghost로 무시
  - pcCount는 snapshot 값 그대로 유지 (CNC 매크로에 재동기화)
```

---

## 4. Pseudocode

### 4.1 핵심 타입 정의

```typescript
// ─── 상태 정의 ───
type SchedulerState =
  | 'IDLE'
  | 'PRECHECK'
  | 'PREPARE_PROGRAM'
  | 'SYNC_COUNT'
  | 'PANEL_ALIGN'
  | 'CYCLE_START'
  | 'RUNNING'
  | 'COUNT_CHECK'
  | 'CLEARING'
  | 'ROW_DONE'
  | 'NEXT_ROW'
  | 'COMPLETED'
  | 'INTERRUPTED'
  | 'RESUMING'
  | 'STOPPED';

// ─── 이벤트 정의 ───
type SchedulerEvent =
  | { type: 'USER_START' }
  | { type: 'USER_STOP' }
  | { type: 'USER_RESUME' }
  | { type: 'PRECHECK_PASS' }
  | { type: 'PRECHECK_FAIL'; reason: string }
  | { type: 'PROGRAM_READY' }
  | { type: 'PROGRAM_FAIL'; reason: string }
  | { type: 'SYNC_DONE' }
  | { type: 'PANEL_ALIGNED' }
  | { type: 'CYCLE_STARTED' }
  | { type: 'M20_DETECTED' }
  | { type: 'INTERLOCK_VIOLATED'; conditions: string[] }
  | { type: 'INTERLOCK_RESTORED' }
  | { type: 'CLEAR_DONE' }
  | { type: 'ROW_COMPLETE' }
  | { type: 'ALL_ROWS_COMPLETE' }
  | { type: 'RESUME_VERIFIED' }
  | { type: 'STOP_M20_RECEIVED' };

// ─── Row 실행 컨텍스트 ───
interface RowContext {
  rowIndex: number;
  rowId: string;
  mainProgramNo: string;
  subProgramNo: string;
  preset: number;
  pcCount: number;
  ghostM20Passed: boolean;
  oneCycleActivated: boolean;   // Preset-1에서 OneCycle ON 했는지
  clearingInProgress: boolean;  // 클리어 사이클 진행 중
}

// ─── 스케줄러 전체 컨텍스트 ───
interface SchedulerContext {
  machineId: string;
  state: SchedulerState;
  rows: SchedulerRow[];         // 전체 대기열
  current: RowContext | null;   // 현재 실행 중인 Row
  snapshot: SchedulerSnapshot | null;  // 중단 시 저장
  operatingMode: 'MEM' | 'DNC';
  stopRequested: boolean;       // 사용자 정지 요청 플래그
}
```

### 4.2 메인 상태 전이 함수

```typescript
function transition(ctx: SchedulerContext, event: SchedulerEvent): SchedulerContext {
  const { state } = ctx;

  switch (state) {
    case 'IDLE':
      if (event.type === 'USER_START') {
        return { ...ctx, state: 'PRECHECK' };
      }
      break;

    case 'PRECHECK':
      if (event.type === 'PRECHECK_PASS') {
        return { ...ctx, state: 'PREPARE_PROGRAM' };
      }
      if (event.type === 'PRECHECK_FAIL') {
        log(ctx, 'ERROR', `사전 검증 실패: ${event.reason}`);
        return { ...ctx, state: 'IDLE' };
      }
      break;

    case 'PREPARE_PROGRAM':
      if (event.type === 'PROGRAM_READY') {
        return { ...ctx, state: 'SYNC_COUNT' };
      }
      if (event.type === 'PROGRAM_FAIL') {
        log(ctx, 'ERROR', `프로그램 준비 실패: ${event.reason}`);
        return { ...ctx, state: 'IDLE' };
      }
      break;

    case 'SYNC_COUNT':
      if (event.type === 'SYNC_DONE') {
        return { ...ctx, state: 'PANEL_ALIGN' };
      }
      break;

    case 'PANEL_ALIGN':
      if (event.type === 'PANEL_ALIGNED') {
        return { ...ctx, state: 'CYCLE_START' };
      }
      break;

    case 'CYCLE_START':
      if (event.type === 'CYCLE_STARTED') {
        return { ...ctx, state: 'RUNNING' };
      }
      break;

    case 'RUNNING':
      if (event.type === 'M20_DETECTED') {
        return { ...ctx, state: 'COUNT_CHECK' };
      }
      break;

    case 'COUNT_CHECK':
      // handleCountCheck에서 처리 (아래 4.4 참조)
      break;

    case 'CLEARING':
      if (event.type === 'M20_DETECTED') {
        return { ...ctx, state: 'ROW_DONE' };
      }
      break;

    case 'ROW_DONE':
      if (event.type === 'ROW_COMPLETE') {
        // 다음 Row 확인
        const nextIndex = ctx.current!.rowIndex + 1;
        if (nextIndex < ctx.rows.length) {
          return { ...ctx, state: 'NEXT_ROW' };
        } else {
          return { ...ctx, state: 'COMPLETED' };
        }
      }
      break;

    case 'NEXT_ROW':
      // initNextRow 후 → PRECHECK
      return { ...ctx, state: 'PRECHECK' };

    case 'INTERRUPTED':
      if (event.type === 'USER_RESUME' || event.type === 'INTERLOCK_RESTORED') {
        return { ...ctx, state: 'RESUMING' };
      }
      break;

    case 'RESUMING':
      if (event.type === 'RESUME_VERIFIED') {
        // snapshot의 중단 시점에 따라 복귀
        const resumeState = determineResumeState(ctx.snapshot!);
        return { ...ctx, state: resumeState, snapshot: null };
      }
      break;

    case 'STOPPED':
      if (event.type === 'STOP_M20_RECEIVED') {
        return { ...ctx, state: 'IDLE' };
      }
      break;
  }

  // ── 글로벌 전이: 모든 상태에서 처리 ──
  if (event.type === 'INTERLOCK_VIOLATED' && state !== 'IDLE' && state !== 'INTERRUPTED') {
    const snapshot = createSnapshot(ctx, event.conditions);
    return { ...ctx, state: 'INTERRUPTED', snapshot };
  }

  if (event.type === 'USER_STOP' && state !== 'IDLE' && state !== 'STOPPED') {
    return { ...ctx, state: 'STOPPED', stopRequested: true };
  }

  return ctx;
}
```

### 4.3 인터록 감시 루프 (Agent)

```typescript
// 200ms 주기로 실행
async function interlockWatcher(ctx: SchedulerContext, focas: FocasHandle): Promise<void> {
  const INTERLOCK_INTERVAL = 200; // ms

  while (ctx.state !== 'IDLE' && ctx.state !== 'COMPLETED') {
    await sleep(INTERLOCK_INTERVAL);

    const conditions = await readInterlockConditions(focas, ctx.machineId);
    // conditions: { doorLock, memoryMode, barFeederAuto, ... }

    const violated = Object.entries(conditions)
      .filter(([_, value]) => value === false)
      .map(([key, _]) => key);

    if (violated.length > 0 && ctx.state !== 'INTERRUPTED') {
      dispatch(ctx, {
        type: 'INTERLOCK_VIOLATED',
        conditions: violated,
      });
      // Agent는 진행 중인 FOCAS 명령 즉시 중단
      abortPendingCommands(focas);
    }

    if (violated.length === 0 && ctx.state === 'INTERRUPTED') {
      // 복구 감지 → UI에 알림 (자동 재개는 안 함)
      notifyInterlockRestored(ctx);
    }
  }
}
```

### 4.4 M20 핸들러 + Ghost M20 필터링

```typescript
async function handleM20(ctx: SchedulerContext): Promise<SchedulerEvent> {
  const row = ctx.current!;

  // ── Ghost M20 필터링 ──
  if (!row.ghostM20Passed) {
    row.ghostM20Passed = true;
    log(ctx, 'INFO', `[Row ${row.rowIndex + 1}] Ghost M20 감지 → 무시 (카운트 제외)`);
    return { type: 'M20_DETECTED' }; // COUNT_CHECK에서 ghost 처리
  }

  // ── 정지 요청 중이면 ──
  if (ctx.stopRequested) {
    log(ctx, 'INFO', `[Row ${row.rowIndex + 1}] 정지 요청에 의한 M20 정지`);
    return { type: 'STOP_M20_RECEIVED' };
  }

  // ── 클리어 사이클 중이면 ──
  if (row.clearingInProgress) {
    log(ctx, 'INFO', `[Row ${row.rowIndex + 1}] 클리어 사이클 완료`);
    return { type: 'CLEAR_DONE' };
  }

  // ── 유효 카운트 ──
  row.pcCount++;
  await syncCountToMacro(ctx, row.pcCount);
  log(ctx, 'COUNT', `[Row ${row.rowIndex + 1}] M20 카운트: ${row.pcCount}/${row.preset}`);

  return { type: 'M20_DETECTED' };
}
```

### 4.5 카운트 판정 (COUNT_CHECK 상태)

```typescript
async function handleCountCheck(ctx: SchedulerContext, focas: FocasHandle): Promise<void> {
  const row = ctx.current!;

  // Ghost M20인 경우 → 바로 RUNNING 복귀
  if (!row.ghostM20Passed) {
    // ghost 처리는 handleM20에서 이미 완료
    dispatch(ctx, { type: 'M20_DETECTED' }); // RUNNING으로 복귀
    return;
  }

  // ── Preset-1 판정: OneCycle ON ──
  if (row.pcCount === row.preset - 1 && !row.oneCycleActivated) {
    row.oneCycleActivated = true;
    await pmcWrite(focas, ADDR.ONE_CYCLE, 1); // OneCycle ON
    log(ctx, 'INFO', `[Row ${row.rowIndex + 1}] Preset-1 도달 → 원사이클 ON`);
    // RUNNING으로 복귀 (마지막 1개 가공)
    transition(ctx, { type: 'M20_DETECTED' }); // → RUNNING
    return;
  }

  // ── 목표 도달 판정 ──
  if (row.pcCount >= row.preset) {
    log(ctx, 'INFO', `[Row ${row.rowIndex + 1}] 목표 수량 도달 (${row.pcCount}/${row.preset})`);
    transition(ctx, { type: 'ROW_COMPLETE' }); // → CLEARING
    await executeClearingCycle(ctx, focas);
    return;
  }

  // ── 미도달: 계속 운전 ──
  transition(ctx, { type: 'M20_DETECTED' }); // → RUNNING 복귀
}
```

### 4.6 클리어 사이클 (CLEARING 상태)

```typescript
async function executeClearingCycle(ctx: SchedulerContext, focas: FocasHandle): Promise<void> {
  const row = ctx.current!;
  row.clearingInProgress = true;

  // Step 1: Head2만 ON (Head1/Head3 OFF)
  await pmcWrite(focas, ADDR.HEAD1, 0);
  await pmcWrite(focas, ADDR.HEAD2, 1);
  if (ADDR.HEAD3) await pmcWrite(focas, ADDR.HEAD3, 0);
  log(ctx, 'INFO', `[Row ${row.rowIndex + 1}] 클리어 사이클: Head2 Only ON`);

  // Step 2: OneCycle ON 유지 확인
  const oneCycle = await pmcRead(focas, ADDR.ONE_CYCLE);
  if (!oneCycle) {
    await pmcWrite(focas, ADDR.ONE_CYCLE, 1);
  }

  // Step 3: CycleStart 1회
  await executeCycleStart(focas);
  log(ctx, 'INFO', `[Row ${row.rowIndex + 1}] 클리어 사이클: CycleStart 실행`);

  // Step 4: M20 대기는 RUNNING 루프에서 처리
  // → M20 감지 시 handleM20에서 clearingInProgress 확인 → CLEAR_DONE
}
```

### 4.7 Row 전환 핸들러

```typescript
async function advanceToNextRow(ctx: SchedulerContext): Promise<void> {
  const nextIndex = ctx.current!.rowIndex + 1;

  if (nextIndex >= ctx.rows.length) {
    // 모든 Row 완료
    log(ctx, 'INFO', '모든 스케줄러 항목이 완료되었습니다');
    transition(ctx, { type: 'ALL_ROWS_COMPLETE' });
    return;
  }

  // 현재 Row 상태 업데이트
  ctx.rows[ctx.current!.rowIndex].status = 'COMPLETED';

  // 다음 Row 초기화
  const nextRow = ctx.rows[nextIndex];
  ctx.current = {
    rowIndex: nextIndex,
    rowId: nextRow.id,
    mainProgramNo: nextRow.mainProgramNo,
    subProgramNo: nextRow.subProgramNo,
    preset: nextRow.preset,
    pcCount: 0,
    ghostM20Passed: false,
    oneCycleActivated: false,
    clearingInProgress: false,
  };
  nextRow.status = 'RUNNING';

  log(ctx, 'INFO', `Row ${nextIndex + 1} 시작: ${nextRow.mainProgramNo}/${nextRow.subProgramNo}`);

  // → PRECHECK부터 다시 실행
  transition(ctx, { type: 'PRECHECK_PASS' }); // 실제로는 PRECHECK 진입
}
```

### 4.8 재개(Resume) 핸들러

```typescript
async function handleResume(ctx: SchedulerContext, focas: FocasHandle): Promise<void> {
  const snap = ctx.snapshot!;

  // R01: 인터록 재확인
  const conditions = await readInterlockConditions(focas, ctx.machineId);
  const violated = Object.entries(conditions).filter(([_, v]) => !v);
  if (violated.length > 0) {
    log(ctx, 'WARN', '인터록 조건이 아직 불만족합니다');
    return; // INTERRUPTED 유지
  }

  // R02: 운전모드 확인
  const mode = await readCncMode(focas);
  if (mode !== snap.operatingMode) {
    log(ctx, 'WARN', `운전모드 불일치: 현재=${mode}, 필요=${snap.operatingMode}`);
    return;
  }

  // R03: 프로그램 번호 확인
  const currentPgm = await readCurrentProgram(focas);
  if (currentPgm !== snap.mainProgramNo) {
    log(ctx, 'INFO', '프로그램 변경 감지 → PREPARE_PROGRAM부터 재실행');
    ctx.current!.pcCount = snap.pcCount;
    ctx.current!.ghostM20Passed = snap.ghostM20Passed;
    transition(ctx, { type: 'PROGRAM_FAIL', reason: '재등록 필요' });
    return;
  }

  // R04: CNC Parts Counter OFF 확인
  const partsCounterOff = await checkPartsCounterOff(focas);
  if (!partsCounterOff) {
    log(ctx, 'WARN', 'CNC 카운터를 OFF로 설정하세요');
    return;
  }

  // R05~R06: 카운트 복원 및 매크로 동기화
  ctx.current!.pcCount = snap.pcCount;
  ctx.current!.ghostM20Passed = snap.ghostM20Passed;
  ctx.current!.oneCycleActivated = snap.oneCycleActivated;
  await syncCountToMacro(ctx, snap.pcCount);

  // R07: 복귀 시점 결정
  const resumeState = determineResumeState(snap);
  log(ctx, 'INFO', `재개: ${resumeState}부터 실행 (pcCount=${snap.pcCount})`);
  transition(ctx, { type: 'RESUME_VERIFIED' });
}

function determineResumeState(snap: SchedulerSnapshot): SchedulerState {
  const s = snap.stateBeforeInterrupt;

  // RUNNING/COUNT_CHECK → 패널 재정렬 후 CycleStart
  if (s === 'RUNNING' || s === 'COUNT_CHECK') {
    return 'PANEL_ALIGN';
  }

  // CLEARING → 클리어 사이클 재시도
  if (s === 'CLEARING') {
    return 'CLEARING';
  }

  // 그 외 → 해당 상태 그대로
  return s;
}
```

---

## 5. 이벤트 로그 규격

### 5.1 로그 코드 체계

| 코드 | 카테고리 | 메시지 템플릿 |
|------|----------|---------------|
| `SCH-001` | 시작 | `스케줄러 시작 (총 {n}개 항목)` |
| `SCH-002` | Row 시작 | `[Row {n}] 실행 시작: {mainPgm}/{subPgm} (Preset: {preset})` |
| `SCH-010` | 사전검증 | `인터록 검증 통과` |
| `SCH-011` | 사전검증 실패 | `인터록 검증 실패: {조건명}` |
| `SCH-012` | 모드 검증 실패 | `운전모드 불일치: 현재={mode}, 필요=MEM/DNC` |
| `SCH-020` | 프로그램 | `프로그램 선택 완료: {pgmNo}` |
| `SCH-021` | 프로그램 | `프로그램 선두 이동 완료` |
| `SCH-022` | 프로그램 실패 | `프로그램 등록 실패: {reason}` |
| `SCH-030` | 카운트 동기화 | `카운트 동기화: Preset={preset}, Count={count} → 매크로 #{macroNo}` |
| `SCH-040` | 패널 정렬 | `원사이클 OFF 확인` |
| `SCH-041` | 패널 정렬 | `Head ALL ON 완료 (Head1={s}, Head2={s}, Head3={s})` |
| `SCH-050` | 사이클스타트 | `사이클스타트 실행` |
| `SCH-060` | Ghost M20 | `[Row {n}] Ghost M20 감지 → 무시` |
| `SCH-061` | 유효 M20 | `[Row {n}] M20 카운트: {count}/{preset}` |
| `SCH-062` | Preset-1 | `[Row {n}] Preset-1 도달 → 원사이클 ON` |
| `SCH-070` | 클리어 | `[Row {n}] 클리어 사이클: Head2 Only + CycleStart` |
| `SCH-071` | 클리어 완료 | `[Row {n}] 클리어 사이클 완료` |
| `SCH-080` | Row 완료 | `[Row {n}] 완료 ({count}/{preset})` |
| `SCH-090` | 전체 완료 | `모든 항목 완료. 가동 정지.` |
| `SCH-100` | 인터록 중단 | `인터록 위반 → 시퀀스 중단: {조건명}` |
| `SCH-101` | 인터록 복구 | `인터록 복구 감지. [재개] 가능.` |
| `SCH-102` | 재개 | `시퀀스 재개: {state}부터 (pcCount={count})` |
| `SCH-110` | 사용자 정지 | `사용자 정지 요청 → OneCycleStop 대기` |
| `SCH-111` | 정지 완료 | `OneCycleStop 완료. 가동 정지.` |

---

## 6. 상태 전이 다이어그램 (전체)

```
                    USER_START
         IDLE ────────────────────▶ PRECHECK
          ▲                           │
          │                    PASS   │   FAIL
          │              ┌────────────┘    │
          │              ▼                 │
          │        PREPARE_PROGRAM         │
          │              │                 │
          │        PROGRAM_READY           │
          │              ▼                 │
          │         SYNC_COUNT             │
          │              │                 │
          │          SYNC_DONE             │
          │              ▼                 │
          │         PANEL_ALIGN            │
          │              │                 │
          │        PANEL_ALIGNED           │
          │              ▼                 │
          │         CYCLE_START            │
          │              │                 │
          │        CYCLE_STARTED           │
          │              ▼                 │
          │  ┌──────▶ RUNNING ◀──────┐    │
          │  │           │           │    │
          │  │      M20_DETECTED     │    │
          │  │           ▼           │    │
          │  │      COUNT_CHECK      │    │
          │  │      │    │    │      │    │
          │  │  ghost  미완료  완료   │    │
          │  │      │    │    │      │    │
          │  └──────┘    │    ▼      │    │
          │         └────┘ CLEARING  │    │
          │                   │      │    │
          │              CLEAR_DONE  │    │
          │                   ▼      │    │
          │               ROW_DONE   │    │
          │              │        │  │    │
          │         다음Row    전체완료 │    │
          │              ▼        │  │    │
          │          NEXT_ROW     │  │    │
          │              │        │  │    │
          │              └─▶ PRECHECK  │    │
          │                       │  │    │
          │                       ▼  │    │
          │                  COMPLETED    │
          │                       │      │
          └───────────────────────┘      │
          ▲                              │
          │         USER_STOP            │
       STOPPED ◀─────────── (any) ◀──────┘
          ▲
          │
     INTERRUPTED ◀────── INTERLOCK_VIOLATED (any state)
          │
     USER_RESUME
          │
          ▼
       RESUMING ──────▶ (복귀 시점 상태)
```

---

## 7. Agent 메인 루프 구조

```typescript
class SchedulerEngine {
  private ctx: SchedulerContext;
  private focas: FocasHandle;
  private interlockWatcherHandle: NodeJS.Timer | null = null;
  private m20WatcherHandle: NodeJS.Timer | null = null;

  async start(rows: SchedulerRow[]): Promise<void> {
    this.ctx = initContext(rows);
    this.dispatch({ type: 'USER_START' });

    // 인터록 감시 시작 (200ms)
    this.interlockWatcherHandle = setInterval(
      () => this.checkInterlock(), 200
    );

    // 상태 머신 루프
    while (this.ctx.state !== 'IDLE' && this.ctx.state !== 'COMPLETED') {
      await this.executeCurrentState();
    }

    // 정리
    this.cleanup();
  }

  private async executeCurrentState(): Promise<void> {
    switch (this.ctx.state) {
      case 'PRECHECK':
        await this.runPrecheck();
        break;
      case 'PREPARE_PROGRAM':
        await this.prepareProgram();
        break;
      case 'SYNC_COUNT':
        await this.syncCount();
        break;
      case 'PANEL_ALIGN':
        await this.alignPanel();
        break;
      case 'CYCLE_START':
        await this.executeCycleStart();
        break;
      case 'RUNNING':
        await this.monitorRunning();  // M20 폴링 (200ms)
        break;
      case 'COUNT_CHECK':
        await this.handleCountCheck();
        break;
      case 'CLEARING':
        await this.executeClearingCycle();
        break;
      case 'ROW_DONE':
        await this.finalizeRow();
        break;
      case 'NEXT_ROW':
        await this.advanceToNextRow();
        break;
      case 'INTERRUPTED':
        await this.waitForResume();  // 블로킹 대기
        break;
      case 'RESUMING':
        await this.handleResume();
        break;
      case 'STOPPED':
        await this.waitForStopM20();
        break;
    }
  }

  // M20 감시 (RUNNING 상태에서 200ms 폴링)
  private async monitorRunning(): Promise<void> {
    while (this.ctx.state === 'RUNNING') {
      await sleep(200);

      const m20Signal = await pmcRead(this.focas, ADDR.M20_SIGNAL);

      if (m20Signal) {
        await this.handleM20();
        break;
      }
    }
  }
}
```
