# 스케줄러 구현 문서 (SCHEDULER_IMPL.md)

> 최종 업데이트: 2026-03-24
> 실기기 검증 완료: Star SB-20R2 / FANUC 0i-TF Plus
> 구현 파일: `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`

---

## 1. 개요

스케줄러는 2-계통(Path1=주축, Path2=서브축) CNC 자동선반에서 여러 품번을 순서대로 자동 가공하는 기능이다.
각 **행(Row)**에 메인 프로그램 번호, 서브 프로그램 번호, 목표 수량(Preset)을 설정하면 Agent가 PMC 신호를 제어해 순차 실행한다.

---

## 2. PMC 어드레스 맵 (SB-20R2 실기기 기준)

### 2-1. 입력 신호 (기계 → PC, R6000~R6009)

| 어드레스 | 신호명 | 용도 | 접점 |
|----------|--------|------|------|
| R6000.2 | chuckClamped | 척 클램프 상태 | A접 |
| R6001.2 | emergencyStop | 비상정지 | B접 (0=해제=정상) |
| R6001.3 | doorClosed | 안전 도어 닫힘 | A접 (1=닫힘=정상) |
| R6001.6 | coolantLevel | 절삭유 레벨 | A접 |
| R6002.4 | M20 / programEnd | M20 완료 신호 | A접 (rising edge 감지) |
| R6003.0 | cycleRunning | 사이클 실행 중 | A접 |
| R6004.0 | HEAD1 상태 | HEAD1(주축) ON/OFF 현재 상태 | A접 (1=ON) |
| R6004.1 | HEAD2 상태 | HEAD2(서브축) ON/OFF 현재 상태 | A접 (1=ON) |
| R6006.0 | 원사이클 스톱 상태 | OCS 현재 상태 | A접 (1=ON) |
| A209.7 | Path2Only 확인 메시지 | 서브 단독 실행 준비 확인 오퍼레이터 메시지 | A접 |

### 2-2. 출력 신호 (PC → 기계, R6100~R6109)

| 어드레스 | 신호명 | 용도 | 동작 방식 |
|----------|--------|------|-----------|
| R6103.0 | RESET | 프로그램 선두 복귀 2차 fallback | 모멘터리 펄스 (300ms) |
| R6104.0 | HEAD1 토글 | HEAD1 ON/OFF 전환 명령 | 모멘터리 펄스 (300ms) |
| R6104.1 | HEAD2 토글 | HEAD2 ON/OFF 전환 명령 | 모멘터리 펄스 (300ms) |
| R6105.4 | cycleStart | 사이클 스타트 | 모멘터리 펄스 (200ms) |
| R6106.0 | 원사이클 스톱 토글 | OCS ON/OFF 전환 명령 | 모멘터리 펄스 (200ms) |

> **토글 방식 주의**: HEAD1/HEAD2/OCS는 모두 **토글** 신호다.
> 현재 상태를 먼저 읽고, 이미 목표 상태이면 펄스를 내보내지 않는다.
> 상태 주소(R6004.x, R6006.0)를 확인한 후 출력해야 한다.

### 2-3. CNC 변수 (스케줄러 카운트 동기화)

| 변수 | 타입 | 용도 |
|------|------|------|
| #900 | macro | 현재 생산 수량 (count) — CNC 화면에 표시 |
| P10000 | pcode | 목표 수량 (preset) — CNC 화면에 표시 |

> 설정 위치: `schedulerConfig.countDisplay` (템플릿 JSON)
> countMacroNo=900, countVarType="macro", presetMacroNo=10000, presetVarType="pcode"

---

## 3. 상태 머신

```
                    [START 명령]
    IDLE ──────────────────────────► RUNNING
     ▲                                  │
     │  [모든 행 완료]                   │ [PAUSE 요청 + M20]
     │  [CANCEL]                         ▼
     └──────────────────────────── PAUSED
                                        │
                                   [RESUME 명령]
                                        │
                                   (→ RUNNING)
```

| 상태 | 설명 |
|------|------|
| IDLE | 스케줄러 미실행. M20 발생 시 raw M20_COMPLETE MQTT 발행 |
| RUNNING | 행 실행 중. M20 엣지 감지 → count 증가 처리 |
| PAUSED | 사용자 PAUSE 또는 인터락 불만족으로 OCS ON 후 대기 |
| ERROR | 심각한 오류 (현재 미구현, RUNNING 상태에서 ERROR 이벤트로 보고) |

---

## 4. 행 실행 시퀀스 (StartRow)

행 하나를 시작할 때 수행되는 단계. `StartRow()` 메서드 기준.

```
[1] 인터락 확인
    ├─ 도어 닫힘 (R6001.3 A접) ✓
    └─ 비상정지 해제 (R6001.2 B접) ✓
    ✗ → CONTROL_DENIED 이벤트, IDLE 유지

[2] count >= preset 검사
    ✓ count < preset → 계속
    ✗ count >= preset → COMPLETED 자동 스킵 → 다음 행
    ★ 이 자동 스킵이 Path2Only 무한루프를 방지하는 핵심 (§7 버그 이력 참조)

[3] 실행 모드 분기 (Path별 독립)
    ├─ mainMode="memory" → cnc_search(progNo, path=1)
    ├─ mainMode="dnc"    → DNC 파일 존재 확인 + CNC aut=9 확인
    ├─ subMode="memory"  → cnc_search(subProgNo, path=2) [SubProgramNo 있을 때만]
    └─ subMode="dnc"     → DNC 파일 존재 확인 [SubProgramNo 있을 때만]

[4] Path2 선두 복귀 (SubProgramNo 있을 때만, 모드 무관 필수)
    → cnc_rewind(path=2)
    ✗ 실패 시 PATH2_REWIND_FAILED ERROR → 실행 중단
    ★ Path1/Path2 동기 코드 위치 일치가 목적. 실패 시 "waiting M code" 알람 발생.

[5] Path1 선두 복귀 (memory 모드만, 3단계 fallback)
    ① cnc_rewind()                   → 성공 시 완료
    ② RESET 신호 R6103.0 펄스(300ms) → 성공으로 간주
    ③ cnc_search 재실행               → 성공 시 완료
    ✗ 모두 실패 → REWIND_FAILED ERROR

[6] EnsureHeadsAndOCSReady (최대 5초 폴링)
    목표: HEAD1=ON(R6004.0=1), HEAD2=ON(R6004.1=1), OCS=OFF(R6006.0=0)
    ├─ 1단계: 현재 상태 동시 읽기
    ├─ 2단계: 필요한 신호 동시 출력 (300ms 펄스)
    └─ 3단계: 동시 폴링 (HEAD1/HEAD2/OCS 모두 목표 도달까지)
    ✗ 타임아웃 → PAUSED (HEAD_OCS_TIMEOUT)

[7] skipFirstM20 = true
    M99 선두 복귀형 구조: 프로그램 선두에 M20이 있어 행 시작 직후 첫 M20은 제외

[8] CNC 변수 초기 동기화
    #900 = row.Count (현재 수량)
    P10000 = row.Preset (목표 수량)

[9] CycleStart 2회 (3초 간격)
    R6105.4=1 (200ms) → R6105.4=0 → 3초 대기 → R6105.4=1 (200ms) → R6105.4=0
    ★ 2-계통 기계: Path1 스타트 후 3초 후 Path2 스타트 (동기 코드 M105 대기 시간)
```

---

## 5. M20 엣지 감지 및 처리

### 5-1. 감지 방법

`DataCollectorService.DetectM20EdgeSync()`가 100ms마다 R6002.4를 폴링.
`_lastM20State` 플래그로 0→1 rising edge를 감지 → `SchedulerManager.OnM20Edge()` 호출.

```
FOCAS Worker Thread (100ms loop):
  CollectAndPublishPmcBitsSync()
  DetectM20EdgeSync()          ← M20 rising edge → OnM20Edge()
  SchedulerManager.Tick()      ← 명령 처리 + 인터락 감시
```

### 5-2. M20 처리 흐름 (OnM20Edge)

```
M20 rising edge 감지
    │
    ├─ state != RUNNING → false (raw M20_COMPLETE 발행)
    │
    ├─ _skipFirstM20 == true
    │   → _skipFirstM20 = false
    │   → M20_COMPLETE MQTT 발행 (count 미변경, 로그용)
    │   → return true (raw 발행 억제)
    │
    ├─ _waitingForPath2OnlyM20 == true
    │   → _waitingForPath2OnlyM20 = false
    │   → row.Status = "COMPLETED"
    │   → PublishSchedulerRowCompleted()
    │   → ExecuteNextPendingRow()   ← 다음 행 StartRow
    │   → return true
    │
    └─ 일반 처리:
        count++
        #900 = count (CNC 변수 갱신)
        M20_COMPLETE MQTT 발행 (rowId, count 포함)
        │
        ├─ _pauseRequested == true
        │   → PAUSED 전환
        │
        ├─ count == preset - 1
        │   → OCS ON (R6106.0 펄스)  ← 마지막 사이클 완료 후 자동 정지 예약
        │
        └─ count >= preset
            → CompleteCurrentRow()
```

---

## 6. 행 완료 및 Path2Only 시퀀스

### 6-1. CompleteCurrentRow()

```
row.Status = "COMPLETED"
    │
    └─ SubProgramNo 있음 + Path2OnlyConfirmAddr 있음?
        ├─ YES → ExecutePath2Only()  ← 서브 단독 실행
        └─ NO  → PublishSchedulerRowCompleted() → ExecuteNextPendingRow()
```

### 6-2. ExecutePath2Only() — 서브 단독 실행 시퀀스

메인(Path1) 목표 수량 달성 후, 서브(Path2)에서 아직 가공 중인 마지막 제품을 단독으로 완료하는 시퀀스.

```
[1] HEAD1 OFF (주축 해제)
    현재 R6004.0 읽기
    ├─ R6004.0 == 0 → 이미 OFF, 스킵
    └─ R6004.0 == 1 → R6104.0=1 펄스(300ms) → R6104.0=0
                      R6004.0=0 대기 (최대 5초)
                      ✗ 타임아웃 → HEAD1_OFF_TIMEOUT ERROR, 중단

[2] Path2Only 확인 메시지 대기
    A209.7=1 대기 (최대 4000ms)
    ★ CNC 오퍼레이터 메시지: "서브 단독 실행 준비 완료" 등 기계가 준비됐음을 알리는 신호
    ✗ 타임아웃 → path2OnlyTimeoutAction에 따라 "error" 또는 "skip"

[3] 500ms 대기 (확인 후 사이클 스타트까지 여유)

[4] CycleStart 2회 (3초 간격)
    ★ 이 시점에서 HEAD1=OFF, HEAD2=ON → Path2(서브)만 사이클 실행

[5] _waitingForPath2OnlyM20 = true
    ★ 다음 M20 수신 시 OnM20Edge에서 카운트 없이 행 완료 처리
    ★ 기계는 OCS=ON 상태이므로 M99에서 자동 정지 (PC가 정지 명령 불필요)
```

### 6-3. Path2Only 완료 후 다음 행 시작

```
_waitingForPath2OnlyM20 M20 수신
    → row.Status = "COMPLETED"
    → ExecuteNextPendingRow()
        → StartRow(nextRow)
            → EnsureHeadsAndOCSReady()
                ★ HEAD1 = OFF 상태 → HEAD1 ON 명령 자동 출력 (R6104.0 펄스)
                ★ OCS = ON 상태   → OCS OFF 명령 자동 출력 (R6106.0 펄스)
                → HEAD1=ON, HEAD2=ON, OCS=OFF 동시 확인 후 CycleStart
```

---

## 7. 원사이클 스톱 (OCS) 제어

OCS는 **토글 방식**으로 동작한다.

| 동작 | 어드레스 | 방식 |
|------|----------|------|
| 상태 읽기 | R6006.0 | 1=ON, 0=OFF |
| ON 토글 | R6106.0=1 펄스(200ms) → 0 | R6006.0=1 확인 후 스킵 방지 |
| OFF 토글 | R6106.0=1 펄스(200ms) → 0 | R6006.0=0 확인 후 스킵 방지 |

**OCS가 ON되는 시점:**
- count == preset - 1 (마지막 사이클 예약)
- PAUSE 요청 수신 시
- 실행 중 인터락 불만족 감지 시
- CANCEL 수신 시

**OCS가 OFF되는 시점:**
- EnsureHeadsAndOCSReady() 에서 (행 시작/재개 시 항상 확인)

---

## 8. 스레드 모델 및 명령 큐

```
MQTT 스레드
    │
    ├─ OnSchedulerCommandReceived()
    │     → _commandChannel.Writer.TryWrite(cmd)  [Channel<SchedulerMessage>, cap=8]
    │
    └─ OnCommandReceived()  (일반 FOCAS 명령)
          → DataCollectorService._commandChannel

FOCAS Worker Thread (LongRunning, 100ms loop)
    │
    ├─ CommandChannel 처리 (FOCAS 명령: SEARCH/UPLOAD 등)
    │
    ├─ CollectAndPublishPmcBitsSync()        [PMC bits 100ms]
    │
    ├─ DetectM20EdgeSync()                   [M20 edge → OnM20Edge()]
    │     _lastM20State: 이전 상태 기억 (rising edge 감지용)
    │
    ├─ SchedulerManager.Tick()               [100ms]
    │     ├─ _commandChannel 처리 (START/RESUME/PAUSE/CANCEL)
    │     └─ CheckInterlockWhileRunning()    [RUNNING 중 인터락 감시]
    │
    ├─ CollectAndPublishTelemetrySync()      [1000ms]
    └─ CollectAndPublishAlarmsSync()         [1000ms]
```

> **중요**: CycleStart (3초×2회 = ~6.4초), HEAD1 OFF 대기 (최대 5초) 등 블로킹 호출이
> FOCAS 스레드에서 동기 실행된다. 이 기간 동안 Tick(), M20 감지, 텔레메트리 수집이 모두 멈춘다.

---

## 9. 인터락

### 9-1. 스케줄러 인터락 (TopBarInterlock.Scheduler)

| 조건 | 어드레스 | 접점 | 정상 조건 |
|------|----------|------|-----------|
| 안전 도어 닫힘 | R6001.3 | A접 | =1 |
| 비상정지 해제 | R6001.2 | B접 | =0 |

### 9-2. 인터락 평가 흐름

```
행 시작 시 (StartRow): CheckInterlock() → TopBarInterlock.Scheduler.Evaluate()
    ✗ → CONTROL_DENIED 이벤트, 실행 중단, IDLE 상태 유지 (ERROR 아님)

RUNNING 중 (CheckInterlockWhileRunning(), 100ms 마다):
    ✗ → HandlePauseRequest() → OCS ON → _pauseRequested=true
         다음 M20 후 PAUSED 전환
```

---

## 10. MQTT 메시지 구조

### 10-1. 서버 → Agent (스케줄러 명령)

토픽: `server/{machineId}/scheduler`

```json
{
  "type": "START",
  "mainMode": "memory",
  "subMode": "memory",
  "dncPaths": { "path1": "/data/repo/path1", "path2": "/data/repo/path2" },
  "rows": [
    {
      "id": "uuid",
      "order": 0,
      "mainProgramNo": "O3001",
      "subProgramNo": "O3101",
      "preset": 10,
      "count": 0,
      "status": "PENDING"
    }
  ]
}
```

| type | 조건 | 동작 |
|------|------|------|
| START | state=IDLE | 행 목록 초기화 후 첫 PENDING 행 실행 |
| PAUSE | state=RUNNING | OCS ON, 다음 M20 이후 PAUSED |
| RESUME | state=PAUSED | HEAD/OCS 재확인 후 CycleStart |
| CANCEL | any | OCS ON, 상태 IDLE, 행 목록 초기화 |

### 10-2. Agent → 서버 (이벤트)

토픽: `agent/{machineId}/events`

| eventType | 설명 | 포함 필드 |
|-----------|------|-----------|
| M20_COMPLETE | M20 수신 | programNo, rowId, count |
| SCHEDULER_ROW_COMPLETED | 행 완료 | rowId |
| SCHEDULER_COMPLETED | 전체 완료 | - |
| SCHEDULER_PAUSED | PAUSED 전환 | rowId, code, message |
| SCHEDULER_ERROR | 오류 | rowId, code, message |
| SCHEDULER_CONTROL_DENIED | 인터락 불만족 | code, message |

---

## 11. 버그 이력 및 수정

### 11-1. Path2Only 무한루프 (2026-03-24 수정)

**증상**: 서브 단독 실행이 무한 반복됨. 로그에 "Path2Only 시작" 반복 출력.

**원인 분석**:
```
시나리오: Row A (count=3=preset), Row B (count=0, PENDING) 동시 존재 시
START 수신 → Row B StartRow → 정상 실행
Row B 완료 → ExecuteNextPendingRow → Row A StartRow
  → count >= preset → PAUSED (이전 코드)
     └─ RESUME 명령이 _commandChannel에 대기 중
         → Tick() 처리 → HandleResume() → ResumeRow()
             → count >= preset → CompleteCurrentRow()
                 → ExecutePath2Only()  ← 무한루프 시작
```

**수정 1**: `StartRow()` count >= preset 처리 변경

```csharp
// 이전 (버그):
if (row.Count >= row.Preset)
{
    SetState(SchedulerRunState.PAUSED);
    PublishSchedulerPaused(row.Id, "COUNT_EXCEEDS_PRESET", "...");
    return;
}

// 수정 (2026-03-24):
if (row.Count >= row.Preset)
{
    row.Status = "COMPLETED";
    PublishSchedulerRowCompleted(row.Id);
    ExecuteNextPendingRow(ct);  // 다음 PENDING 행으로 바로 진행
    return;
}
```

**수정 2**: `_waitingForPath2OnlyM20` 핸들러에서 `CompleteCurrentRow()` 직접 호출 금지

```csharp
// CompleteCurrentRow() 호출 시 SubProgramNo 조건으로 ExecutePath2Only() 재호출됨
// 대신 직접 행 완료 처리:
if (_waitingForPath2OnlyM20)
{
    _waitingForPath2OnlyM20 = false;
    var rowId = _currentRow.Id;
    _currentRow.Status = "COMPLETED";
    PublishSchedulerRowCompleted(rowId);       // 행 완료 보고
    ExecuteNextPendingRow(CancellationToken.None);  // 다음 행 진행
    return true;
}
```

### 11-2. 향후 주의사항

- **CycleStart 블로킹**: 6초+ 블로킹 중 M20 감지 불가. CycleStart 완료 후 첫 M20은 `_skipFirstM20`으로 제외.
- **OCS 토글 중복 방지**: OCS 상태(R6006.0) 확인 후 이미 목표 상태면 펄스 출력 생략.
- **RESUME 후 skipFirstM20**: RESUME 시에는 `skipFirstM20 = false` (이전 사이클 이어서 카운트).
- **Path2 rewind 필수**: Path2 선두 복귀 실패 시 반드시 중단. Path1/Path2 동기 코드 위치 불일치로 "waiting M code" 알람 발생 가능.

---

## 12. 템플릿 설정 참조 (schedulerConfig)

파일: `templates/FANUC_0i-TF Plus_SB-20R2_V1.json`

```json
"schedulerConfig": {
  "m20Addr":               "R6002.4",   // M20 감지 주소
  "resetAddr":             "R6103.0",   // 선두 복귀 2차 fallback RESET
  "mainHeadAddr":          "R6104.0",   // HEAD1 토글 출력
  "mainHeadStatusAddr":    "R6004.0",   // HEAD1 현재 상태 읽기
  "subHeadAddr":           "R6104.1",   // HEAD2 토글 출력
  "subHeadStatusAddr":     "R6004.1",   // HEAD2 현재 상태 읽기
  "oneCycleStopAddr":      "R6106.0",   // OCS 토글 출력
  "oneCycleStopStatusAddr":"R6006.0",   // OCS 현재 상태 읽기
  "path2OnlyConfirmAddr":  "A209.7",    // Path2Only 확인 메시지 어드레스
  "path2OnlyConfirmDelayMs": 500,       // 확인 후 CycleStart까지 대기 (ms)
  "path2OnlyTimeoutMs":    4000,        // 확인 메시지 대기 최대 시간 (ms)
  "path2OnlyTimeoutAction": "error",    // timeout 시 동작: "error" | "skip"
  "cycleRunningAddr":      "R6003.0",   // 사이클 실행 중 상태 (미사용 - 예약)
  "maxQueueSize":          15,
  "countDisplay": {
    "countMacroNo":  900,               // 현재 수량 CNC 변수 #900
    "countVarType":  "macro",
    "presetMacroNo": 10000,             // 목표 수량 P10000
    "presetVarType": "pcode"
  }
}
```

---

## 13. 미구현 / 개선 예정

| 항목 | 설명 | 우선순위 |
|------|------|----------|
| 행 상태 UI 표시 | 대기/가동/완료 실시간 표시 (Scheduler.tsx) | 높음 |
| TemplateEditor 스케줄러 설정 | Section 8 UI 미구현 | 중간 |
| ERROR 상태 복구 | ERROR 후 RESUME 또는 RESET 플로우 | 중간 |
| DNC 모드 Path2 rewind | 실기 검증은 완료, Path2 DNC rewind 추가 검토 필요 | 낮음 |

---

*이 문서는 실제 코드(`SchedulerManager.cs`)와 실기기 테스트 결과를 기반으로 작성됨.*
