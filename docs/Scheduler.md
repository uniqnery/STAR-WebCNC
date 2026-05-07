# Scheduler 기능 명세 및 구현 참조

> 최초 작성: 2026-03-22 / 최종 수정: 2026-03-24 (실기기 검증 기반 확정)
> 실기기 검증: Star SB-20R2 / FANUC 0i-TF Plus
> 구현 파일: `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`
> 구현 상태: **완료** (Path2Only 버그 포함 전체 플로우 실기기 동작 확인)

---

## 1. 시스템 개요

Scheduler는 CNC 프로그램을 순서대로 자동 실행하며 생산 수량을 집계하는 시스템이다.

| 역할 | 내용 |
|------|------|
| 자동 실행 | 큐(SchedulerRow list)의 행을 순서대로 실행 |
| 수량 집계 | M20 PMC 비트 기반으로 생산 count 관리 |
| 안전 보장 | 인터락 조건 확인 후 실행 |
| 정상 정지 | 원사이클 스톱 기반 안전 종료 및 재개 |
| 동기화 | WebCNC count → CNC 매크로 변수 동기화 |

---

## 2. 설비 프로그램 구조 — M99 선두 복귀형

본 설비는 **M30 종료형이 아닌 M99 선두 복귀형** 사이클 구조다.

```
O3001
(프로그램 선두)
...
M20  ← 선두 복귀 직후 일부 라인 이내. 한 사이클 완료 신호 (부품 배출)
...
(가공 실행 블록)
...
M99  ← 프로그램 말단. 프로그램 선두로 복귀
```

| 항목 | 내용 |
|------|------|
| 프로그램 종료 방식 | M99 (선두 복귀, 자동 연속 사이클) |
| M20 위치 | 프로그램 선두 직후 |
| M20 의미 | 한 사이클 완료 신호 (부품 배출 이벤트) |
| 연속 사이클 진행 | 원사이클 스톱 OFF 상태에서 M99 → 자동 다음 사이클 진행 |
| 사이클 정지 방법 | 원사이클 스톱 ON → M99 도달 시 기계 정지 |

---

## 3. 카운트 정책

### 기본 원칙

**CNC 자체 카운터는 사용하지 않는다.** Count Authority = Agent.

| 항목 | 정책 |
|------|------|
| 완료 판단 기준 | M20 PMC 비트 수신 |
| 카운트 관리 주체 | **Agent** |
| CNC 카운터 | 표시용 동기화 목적으로만 사용 |
| Server 역할 | Agent가 보고한 count 값을 DB / Redis / WS에 반영 |

Server는 count를 자체 계산하지 않는다. Agent 보고값을 그대로 반영한다.

### 첫 번째 M20 제외 정책

행 시작 후 `cnc_rewind`로 선두 복귀 + 사이클 스타트 → M20에 즉시 도달.
이 **첫 번째 M20은 이전 사이클 부품 배출 신호**이므로 카운트에서 제외한다.

```
사이클 스타트
    ↓
첫 번째 M20 → 제외 (skipFirstM20 = true → false 전환)
    ↓
가공 → M99 → 선두 복귀
    ↓
두 번째 M20 → count = 1 (이때부터 집계 시작)
```

---

## 4. PMC 어드레스 맵 (SB-20R2 실기기 기준)

### 4-1. 입력 신호 (기계 → PC)

| 어드레스 | 신호명 | 용도 | 접점 |
|----------|--------|------|------|
| R6001.2 | emergencyStop | 비상정지 | B접 (0=해제=정상) |
| R6001.3 | doorClosed | 안전 도어 닫힘 | A접 (1=닫힘=정상) |
| R6002.4 | M20 완료 신호 | M20 rising edge 감지 | A접 |
| R6003.0 | cycleRunning | 사이클 실행 중 | A접 |
| R6004.0 | HEAD1 상태 | HEAD1(주축) 현재 상태 | A접 (1=ON) |
| R6004.1 | HEAD2 상태 | HEAD2(서브축) 현재 상태 | A접 (1=ON) |
| R6006.0 | 원사이클 스톱 상태 | OCS 현재 상태 | A접 (1=ON) |
| A209.7 | Path2Only 확인 메시지 | 서브 단독 실행 준비 확인 | A접 |

### 4-2. 출력 신호 (PC → 기계)

| 어드레스 | 신호명 | 용도 | 동작 방식 |
|----------|--------|------|-----------|
| R6103.0 | RESET | 프로그램 선두 복귀 2차 fallback | 모멘터리 펄스 (300ms) |
| R6104.0 | HEAD1 토글 | HEAD1 ON/OFF 전환 명령 | 모멘터리 펄스 (300ms) |
| R6104.1 | HEAD2 토글 | HEAD2 ON/OFF 전환 명령 | 모멘터리 펄스 (300ms) |
| R6105.4 | cycleStart | 사이클 스타트 | 모멘터리 펄스 (200ms) |
| R6106.0 | 원사이클 스톱 토글 | OCS ON/OFF 전환 명령 | 모멘터리 펄스 (200ms) |

> **토글 방식 주의**: HEAD1/HEAD2/OCS는 모두 토글 신호다. 현재 상태를 읽고, 이미 목표 상태이면 펄스 출력 생략.

### 4-3. CNC 변수 (카운트 동기화)

| 변수 | 타입 | 용도 |
|------|------|------|
| #900 | macro | 현재 생산 수량 (count) |
| P10000 | pcode | 목표 수량 (preset) |

---

## 5. 인터락 정책

인터락은 에러 조건이 아니라 **실행 허가 조건**이다. 인터락 불만족 → CONTROL DENIED (IDLE 유지, ERROR 전환 없음).

### 시점별 처리

| 시점 | 인터락 불만족 시 처리 |
|------|---------------------|
| **실행 시작 전** | CONTROL DENIED — IDLE 유지 |
| **실행 중 (RUNNING)** | 원사이클 스톱 ON → 현재 사이클 완료(M99) 후 PAUSED |

### 인터락 조건 (SB-20R2 기준)

| 조건 | 어드레스 | 접점 |
|------|----------|------|
| 안전 도어 닫힘 | R6001.3 | A접 (1=OK) |
| 비상정지 해제 | R6001.2 | B접 (0=OK) |

---

## 6. 상태 머신

| 상태 | 설명 |
|------|------|
| `IDLE` | 실행 대기. 큐 비어있거나 모든 행 완료 |
| `RUNNING` | 행 실행 중. 사이클 진행 또는 M20 대기 중 |
| `PAUSED` | 원사이클 스톱 완료 또는 인터락 해소 대기. 동일 행 재개 가능 |
| `ERROR` | 프로그램 오류, timeout 등 비정상 정지 |

```
                    ┌─────────────────────────────────────┐
                    │              IDLE                    │
                    └────┬──────────────────────▲──────────┘
                         │ START                │ 전체 완료 / CANCEL
                         │ (인터락 OK)          │
                         ▼                      │
                    ┌──────────┐                │
          ┌────────▶│ RUNNING  │────────────────┘
          │         └──┬───┬───┘
          │            │   │ 시퀀스 오류 / timeout
     RESUME│   원사이클  │   ▼
          │   스톱완료  │  ERROR ──── CANCEL/RESET ──▶ IDLE
          │            ▼
          └─────── PAUSED ──── CANCEL/RESET ──▶ IDLE

인터락 실패 (실행 전):
  START → 인터락 FAIL → CONTROL DENIED → IDLE 유지
```

---

## 7. 행 실행 시퀀스 (StartRow)

```
[1] 인터락 확인
    └─ 도어 닫힘 + 비상정지 해제 AND 평가
    ✗ → CONTROL_DENIED, IDLE 유지

[2] count >= preset 검사
    ✓ count < preset → 계속
    ✗ count >= preset → COMPLETED 자동 스킵 → 다음 행
    ★ 이 자동 스킵이 Path2Only 무한루프를 방지하는 핵심 (§10 버그 이력 참조)

[3] 실행 모드 분기
    ├─ memory 모드: cnc_search(programNo, path=1), cnc_search(subProgramNo, path=2)
    └─ dnc 모드: DNC 파일 존재 확인

[4] Path2 선두 복귀 (SubProgramNo 있을 때만)
    → cnc_rewind(path=2)
    ✗ 실패 시 PATH2_REWIND_FAILED ERROR
    ★ Path1/Path2 동기 코드 위치 일치가 목적. 실패 시 "waiting M code" 알람 발생.

[5] Path1 선두 복귀 (memory 모드, 3단계 fallback)
    ① cnc_rewind()                   → 성공 시 완료
    ② RESET 신호 R6103.0 펄스(300ms) → 성공으로 간주
    ③ cnc_search 재실행               → 성공 시 완료
    ✗ 모두 실패 → REWIND_FAILED ERROR

[6] EnsureHeadsAndOCSReady (최대 5초 폴링)
    목표: HEAD1=ON(R6004.0=1), HEAD2=ON(R6004.1=1), OCS=OFF(R6006.0=0)
    ① 현재 상태 동시 읽기
    ② 필요한 신호 동시 출력 (300ms 펄스)
    ③ 동시 폴링 100ms 간격 — 목표 도달 확인
    ✗ 타임아웃 → PAUSED (HEAD_OCS_TIMEOUT)

[7] skipFirstM20 = true
    M99 선두 복귀형: 첫 M20은 제외 (§3 참조)

[8] CNC 변수 초기 동기화
    #900 = row.Count, P10000 = row.Preset

[9] CycleStart 2회 (3초 간격)
    R6105.4=1 (200ms) → 0 → 3초 대기 → R6105.4=1 (200ms) → 0
    ★ 2-계통: Path1 스타트 후 3초 후 Path2 스타트 (M105 동기 코드 대기 시간)
```

---

## 8. M20 처리 흐름 (OnM20Edge)

M20 감지는 `DataCollectorService.DetectM20EdgeSync()`가 100ms마다 R6002.4를 폴링, rising edge → `SchedulerManager.OnM20Edge()` 호출.

```
M20 rising edge 감지
    │
    ├─ state != RUNNING → raw M20_COMPLETE 발행 (스케줄러 미실행 시)
    │
    ├─ _skipFirstM20 == true
    │   → _skipFirstM20 = false (이후부터 카운트)
    │   → M20_COMPLETE MQTT 발행 (count 미변경)
    │   → return
    │
    ├─ _waitingForPath2OnlyM20 == true
    │   → _waitingForPath2OnlyM20 = false
    │   → row.Status = "COMPLETED"
    │   → PublishSchedulerRowCompleted() → ExecuteNextPendingRow()
    │   → return
    │
    └─ 일반 처리:
        count++
        #900 = count (CNC 변수 갱신)
        M20_COMPLETE MQTT 발행 (rowId, count 포함)
        │
        ├─ _pauseRequested == true → PAUSED 전환
        │
        ├─ count == preset - 1
        │   → OCS ON (R6106.0 펄스) ← 마지막 사이클 완료 후 자동 정지 예약
        │
        └─ count >= preset → CompleteCurrentRow()
```

### M20의 역할

M20은 **카운트 이벤트**다 — 사이클 제어 신호가 아니다.

| 항목 | M20이 하는 것 | M20이 하지 않는 것 |
|------|-------------|-----------------|
| 카운트 | count++ | 다음 사이클 스타트 트리거 |
| NC 변수 | wrmacro 동기화 | 사이클 재기동 |
| 완료 판단 | count >= preset | — |

OCS OFF 상태에서 기계는 M99 도달 시 자동으로 다음 사이클 진행한다.

---

## 9. 행 완료 및 Path2Only 시퀀스

### 9-1. CompleteCurrentRow()

```
row.Status = "COMPLETED"
    │
    └─ SubProgramNo 있음 + Path2OnlyConfirmAddr 있음?
        ├─ YES → ExecutePath2Only()  ← 서브 단독 실행
        └─ NO  → PublishRowCompleted() → ExecuteNextPendingRow()
```

### 9-2. ExecutePath2Only() — 서브 단독 실행

메인(Path1) 목표 수량 달성 후, 서브(Path2)에서 아직 가공 중인 마지막 제품을 완료하는 시퀀스.

```
[1] HEAD1 OFF (주축 해제)
    R6004.0 읽기 → 이미 OFF면 스킵
    R6104.0=1 펄스(300ms) → R6004.0=0 대기 (최대 5초)
    ✗ 타임아웃 → HEAD1_OFF_TIMEOUT ERROR

[2] Path2Only 확인 메시지 대기
    A209.7=1 대기 (최대 4000ms)
    ✗ 타임아웃 → path2OnlyTimeoutAction: "error" | "skip"

[3] 500ms 대기

[4] CycleStart 2회 (3초 간격)
    이 시점 HEAD1=OFF, HEAD2=ON → Path2(서브)만 실행

[5] _waitingForPath2OnlyM20 = true
    다음 M20 수신 시 OnM20Edge에서 행 완료 처리
```

### 9-3. Path2Only 완료 후 다음 행

```
_waitingForPath2OnlyM20 M20 수신
    → row.Status = "COMPLETED"
    → ExecuteNextPendingRow() → StartRow(nextRow)
        → EnsureHeadsAndOCSReady()
            ★ HEAD1=OFF → HEAD1 ON 명령 자동 출력
            ★ OCS=ON   → OCS OFF 명령 자동 출력
```

---

## 10. 원사이클 스톱 (OCS) 제어

OCS는 **토글 방식**으로 동작한다. ON과 OFF 모두 같은 주소(R6106.0)에 펄스 출력.

| 동작 | 어드레스 | 방식 |
|------|----------|------|
| 상태 읽기 | R6006.0 | 1=ON, 0=OFF |
| ON/OFF 토글 | R6106.0=1 펄스(200ms) → 0 | 이미 목표 상태면 스킵 |

**OCS ON 시점:**
- count == preset - 1 (마지막 사이클 자동 정지 예약)
- PAUSE 요청 수신 시
- 실행 중 인터락 불만족 감지 시
- CANCEL 수신 시

**OCS OFF 시점:**
- EnsureHeadsAndOCSReady() — 행 시작/재개 시 항상 확인

---

## 11. 버그 이력

### Path2Only 무한루프 (2026-03-24 수정 완료)

**증상**: 서브 단독 실행이 무한 반복됨.

**원인**: `StartRow()`에서 count >= preset인 완료 행에 대해 PAUSED 전환 → RESUME 큐 → `CompleteCurrentRow()` → `ExecutePath2Only()` 무한 루프.

**수정 1** — `StartRow()` count >= preset 처리:
```csharp
// 이전: SetState(PAUSED)
// 수정:
if (row.Count >= row.Preset)
{
    row.Status = "COMPLETED";
    PublishSchedulerRowCompleted(row.Id);
    ExecuteNextPendingRow(ct);  // 다음 PENDING 행으로 바로 진행
    return;
}
```

**수정 2** — `_waitingForPath2OnlyM20` 핸들러에서 `CompleteCurrentRow()` 직접 호출 금지:
```csharp
// CompleteCurrentRow() 호출 시 ExecutePath2Only() 재귀 호출됨
// 대신 직접 행 완료 처리:
_waitingForPath2OnlyM20 = false;
_currentRow.Status = "COMPLETED";
PublishSchedulerRowCompleted(rowId);
ExecuteNextPendingRow(CancellationToken.None);
```

---

## 12. 스레드 모델

```
MQTT 스레드
    → _commandChannel.Writer.TryWrite(cmd)

FOCAS Worker Thread (LongRunning, 100ms loop)
    ├─ CollectAndPublishPmcBitsSync()
    ├─ DetectM20EdgeSync()           → OnM20Edge()
    ├─ SchedulerManager.Tick()       → 명령 처리 + 인터락 감시
    ├─ CollectAndPublishTelemetrySync()
    └─ CollectAndPublishAlarmsSync()
```

> CycleStart (3초×2회 = ~6.4초), HEAD1 OFF 대기 (최대 5초) 등 블로킹 호출이 FOCAS 스레드에서 동기 실행된다. 이 기간 동안 Tick(), M20 감지, 텔레메트리 수집이 모두 멈춘다.

---

## 13. MQTT 메시지 구조

### 서버 → Agent

토픽: `server/{machineId}/scheduler`

```json
{
  "type": "START",
  "mainMode": "memory",
  "subMode": "memory",
  "rows": [
    { "id": "uuid", "order": 0, "mainProgramNo": "O3001", "subProgramNo": "O3101", "preset": 10, "count": 0, "status": "PENDING" }
  ]
}
```

| type | 조건 | 동작 |
|------|------|------|
| START | state=IDLE | 행 목록 초기화 후 첫 PENDING 행 실행 |
| PAUSE | state=RUNNING | OCS ON, 다음 M20 후 PAUSED |
| RESUME | state=PAUSED | HEAD/OCS 재확인 후 CycleStart |
| CANCEL | any | OCS ON, 상태 IDLE, 행 목록 초기화 |

### Agent → 서버 이벤트

토픽: `agent/{machineId}/events`

| eventType | 포함 필드 |
|-----------|-----------|
| M20_COMPLETE | programNo, rowId, count |
| SCHEDULER_ROW_COMPLETED | rowId |
| SCHEDULER_COMPLETED | — |
| SCHEDULER_PAUSED | rowId, code, message |
| SCHEDULER_ERROR | rowId, code, message |
| SCHEDULER_CONTROL_DENIED | code, message |

---

## 14. 템플릿 schedulerConfig (SB-20R2 기준)

```json
"schedulerConfig": {
  "m20Addr":                "R6002.4",
  "resetAddr":              "R6103.0",
  "mainHeadAddr":           "R6104.0",
  "mainHeadStatusAddr":     "R6004.0",
  "subHeadAddr":            "R6104.1",
  "subHeadStatusAddr":      "R6004.1",
  "oneCycleStopAddr":       "R6106.0",
  "oneCycleStopStatusAddr": "R6006.0",
  "path2OnlyConfirmAddr":   "A209.7",
  "path2OnlyConfirmDelayMs": 500,
  "path2OnlyTimeoutMs":     4000,
  "path2OnlyTimeoutAction": "error",
  "maxQueueSize":           15,
  "countDisplay": {
    "countMacroNo":  900,
    "countVarType":  "macro",
    "presetMacroNo": 10000,
    "presetVarType": "pcode"
  }
}
```

---

## 15. 행 편집 정책

| 행 상태 | 프로그램 번호 수정 | preset 수정 | 삭제 |
|---------|-------------------|-------------|------|
| PENDING | ✅ | ✅ | ✅ |
| RUNNING | ❌ | ❌ | ❌ |
| PAUSED | ✅ | ✅ | ✅ |
| COMPLETED | ❌ | ❌ | ✅ |

**RUNNING 중 행 추가는 허용** (2026-04-03 변경).

---

## 16. 재개 정책

원사이클 스톱(PAUSED) 후 재개 시:
- **동일 행** 재개 (행 변경 없음)
- count 유지 (리셋 없음)
- RESUME 시 `skipFirstM20 = false` (이전 사이클 이어서 카운트)

---

## 17. 미구현 항목

| 항목 | 우선순위 |
|------|----------|
| TemplateEditor Section 8 (스케줄러 설정 UI) | 중간 |
| ERROR 상태 복구 플로우 (RESUME/RESET) | 중간 |
| DNC 모드 Path2 rewind 실기 검증 | 낮음 |
