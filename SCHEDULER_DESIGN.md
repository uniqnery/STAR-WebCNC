# Scheduler System Design Document
# Star-WebCNC Scheduler 기능 설계

> 작성일: 2026-03-22
> 최종 수정: 2026-03-23 (실기기 검증 기반 3차 개정)
> 상태: 정책 재확정 (실설비 동작 방식 반영 완료)
> 목적: 실설비 검증 결과를 반영하여 설계 기준을 재확정

---

## 변경 이력

| 버전 | 일자 | 주요 변경 내용 |
|------|------|---------------|
| 1차 | 2026-03-22 | 초안 작성 |
| 2차 | 2026-03-22 | 세부 시퀀스 보완 |
| **3차** | **2026-03-23** | **실기기 검증 결과 반영** (인터락 처리 / 동시 확인 / OCS 기준 / M99 구조 / M20 역할 / 사이클 제어 방식 전면 수정) |

---

## 1. 시스템 개요

Scheduler는 CNC 프로그램을 순서대로 자동 실행하며 생산 수량을 집계하는 시스템이다.

### 역할 요약

| 역할 | 내용 |
|------|------|
| 자동 실행 | 큐(SchedulerRow list)의 행을 순서대로 실행 |
| 수량 집계 | M20 PMC 비트 기반으로 생산 count 관리 |
| 안전 보장 | 인터락 조건 확인 후 실행 (제어권 획득 개념) |
| 정상 정지 | 원사이클 스톱 기반 안전 종료 및 재개 |
| 동기화 | WebCNC count → CNC 매크로 변수 동기화 |

---

## 2. 설비 프로그램 구조 (M99 선두 복귀형) ★ 3차 신규

### 본 설비는 M30 종료형이 아닌 M99 선두 복귀형 사이클 구조이다.

```
O3001
(프로그램 선두)
...
M20  ← 선두 복귀 직후 일부 라인 이내 위치. 한 사이클 완료 신호 (부품 배출)
...
(가공 실행 블록)
...
M99  ← 프로그램 말단. 프로그램 선두로 복귀
```

### 사이클 구조 흐름

```
[사이클 스타트]
       ↓
   M20 발생 (선두 직후 — 이전 사이클 부품 배출)
       ↓
   가공 실행
       ↓
   M99 (선두 복귀)
       ↓
   M20 발생 (다음 사이클 부품 배출)
       ↓
   가공 실행
       ↓
   M99 ...
```

### 핵심 특성

| 항목 | 내용 |
|------|------|
| 프로그램 종료 방식 | M99 (선두 복귀, 자동 연속 사이클) |
| M20 위치 | 프로그램 선두 직후 (선두 복귀 후 일부 라인 이내) |
| M20 의미 | 한 사이클 완료 신호 (부품 배출 이벤트) |
| 연속 사이클 진행 | 원사이클 스톱 OFF 상태에서 M99 → 자동으로 다음 사이클 진행 |
| 사이클 정지 방법 | 원사이클 스톱 ON → M99 도달 시 기계 정지 |

---

## 3. 카운트 정책

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
→ cnc_wrmacro / cnc_wrpmacro로 CNC 매크로 변수 동기화
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
- Agent가 count를 직접 관리하고 CNC 매크로 변수에 동기화

### 첫 번째 M20 제외 정책 (M99 구조에 따른 설계)

본 설비는 M99 선두 복귀형 구조로, **M20이 프로그램 선두 직후에 위치**한다.

행 시작 시 `cnc_rewind`로 커서를 선두로 이동 후 사이클 스타트를 입력하면,
기계는 선두부터 실행하여 M20에 즉시 도달한다.
이 첫 번째 M20은 **이전 사이클의 부품 배출 신호** (또는 초기 기동 신호)이므로 **카운트에서 제외**한다.

```
사이클 스타트
    ↓
첫 번째 M20 → 제외 (skipFirstM20 = true → false 전환)
    ↓
가공 → M99 → 선두 복귀
    ↓
두 번째 M20 → count = 1 (이때부터 집계 시작)
```

Agent 내부에서 행 실행 시 `skipFirstM20 = true`로 초기화하고,
첫 M20 수신 시 `false`로 전환하여 관리한다.

### M20 감지 방식

**M20 감지는 PMC bit polling 방식으로 수행한다.**

- FOCAS operator message API (`cnc_rdopmsg` 계열)는 D6G5 TT 기종에서 동작하지 않으므로 사용하지 않는다 (KNOWN_MISTAKES M-19 참조)
- M20 완료 신호에 해당하는 PMC 주소는 **템플릿 `schedulerConfig`에서 입력받는다**
- 코드에 하드코딩하지 않는다

---

## 4. 실행 모드 정책

### path1 실행 모드

장비별 공통 설정으로 관리한다. 행마다 선택하지 않는다.

| 모드 | 설명 |
|------|------|
| `memory` | CNC 내부 메모리에 저장된 프로그램을 번호로 호출하여 실행 |
| `dnc` | DNC 경로(외부 파일)에서 프로그램을 스트리밍으로 실행 |

> 설정 위치: MachineTopBar Settings → DNC 설정 화면 내 "실행 모드" 항목

### memory 모드 실행 방식

```
[4] 프로그램 번호 변경
    └─ FOCAS cnc_search(handle, programNo)
       → CNC 메모리에서 해당 번호의 프로그램을 활성화
       → path1: mainProgramNo, path2: subProgramNo 각각 호출

[5] 프로그램 선두 복귀 (Section 8-4 참조)
```

### dnc 모드 실행 방식

```
[4] DNC 경로 확인
    └─ schedulerConfig.dncPaths[path1/path2] 에 파일이 존재하는지 확인
    └─ 없으면 → Scheduler ERROR 처리

[5] CNC 이미 DNC 모드(aut=9) 상태 가정
    → 프로그램 번호 변경 불필요 (DNC 경로의 파일을 자동 로드)
    → 프로그램 선두 복귀: RESET 후 사이클 스타트로 대체

[6 이후] 동일 (HEAD/OCS 확인 → 사이클 스타트)
```

---

## 5. 인터락 정책 ★ 3차 수정

### 인터락은 제어권 획득 조건이다

인터락은 에러 조건이 아니라 **스케줄러 실행을 허가하는 제어권 획득 조건**이다.
인터락 불만족은 ERROR 전환이 아니라 **CONTROL DENIED** 처리한다.

```
START 요청
  ↓
인터락 확인 (Agent pmcBits 폴링 — AND 평가)
  ↓
  ├─ 인터락 OK  → 스케줄러 실행 시작 (RUNNING)
  └─ 인터락 FAIL → CONTROL DENIED
                   실행 시작하지 않음 / 상태 변경 없음 (IDLE 유지)
                   MQTT 보고: { code: "CONTROL_DENIED", failReasons: [...] }
```

### 인터락 조건 출처

Scheduler는 인터락 조건을 직접 정의하지 않는다.
**템플릿 → TopBar 인터락 설정** (`scheduler` pageId)에서 정의된 조건을 그대로 사용한다.

```
template.topBarInterlock.scheduler.fields
  → 각 field.pmcAddr + field.contact (A접/B접)
  → Agent가 pmcBits 폴링으로 전체 AND 평가
```

### 인터락 평가 위치

| 레이어 | 역할 |
|--------|------|
| **Agent** | pmcBits 직접 폴링 → AND 평가 → MQTT 보고 |
| **Server** | Agent 보고 수신 → DB/Redis 반영 (판단 안 함) |
| **UI** | 결과 표시 (topBarInterlock pills 재사용) |

### 예시 조건 (SB-20R2 — 템플릿 입력값이며 하드코딩 아님)

| 조건 | 주소 | 접점 |
|------|------|------|
| 도어 닫힘 | R6001.3 | A접 (1=OK) |
| 비상정지 해제 | R6001.2 | B접 (0=OK) |

### 시점별 처리 정책

| 시점 | 인터락 불만족 시 처리 |
|------|---------------------|
| **실행 시작 전** | **CONTROL DENIED — 실행 시작 안함, IDLE 유지** ★ |
| **실행 중 (RUNNING)** | 원사이클 스톱 ON → 현재 사이클 완료 후 PAUSED |

> ★ 변경: 기존 ERROR 전환 → CONTROL DENIED (IDLE 유지)로 수정

---

## 6. 행 편집 정책

### 상태별 편집 가능 여부

| 행 상태 | 프로그램 번호 수정 | preset 수정 | 삭제 |
|---------|-------------------|-------------|------|
| PENDING | ✅ | ✅ | ✅ |
| RUNNING | ❌ | ❌ | ❌ |
| PAUSED | ✅ | ✅ | ✅ |
| COMPLETED | ❌ | ❌ | ✅ |

### count > preset 처리 흐름

```
행 시작 시점에 count > preset 감지
→ 해당 행 실행 안 함 (PENDING 상태 유지)
→ Scheduler PAUSED 전환
→ UI 에러 메시지: "O0001 행의 COUNT(N)가 PRESET(M)을 초과합니다. 값을 수정 후 재개하세요."
→ 사용자: preset 또는 count 수정
→ RESUME → 해당 행 재검사 후 정상 실행
```

### Scheduler 실행 중 허용 작업

- PENDING 행 추가
- PENDING/PAUSED 행 수정 및 삭제
- 파일 업로드 (DNC 레포지토리)

---

## 7. 재개 정책

정상 원사이클 스톱(PAUSED) 후 재개 시:

- **동일 행**에서 재개
- count 유지 (리셋 없음)
- 다음 M20 수신 시 count 증가 재개

```
예: preset=100, count=63 → 재개 → 다음 M20 수신 → count=64
```

---

## 8. 실행 시퀀스 상세

### 8-1. 행 시작 시퀀스 ★ 3차 수정

```
[1] 인터락 확인 (Agent 자체 평가)
    └─ interlockSatisfied === false
       → CONTROL DENIED (IDLE 유지, ERROR 전환 없음)
       → MQTT 보고: { code: "CONTROL_DENIED", failReasons: [...] }
       ※ 변경: 기존 Scheduler ERROR → CONTROL DENIED로 수정

[2] count > preset 검사
    └─ 위반 시
       → 해당 행은 실행하지 않음 (PENDING 유지)
       → Scheduler PAUSED 전환
       → MQTT SCHEDULER_ERROR 보고: { code: "COUNT_EXCEEDS_PRESET", rowId }

[3] Control Lock 확인
    └─ Redis key: control:lock:{machineId}
    └─ lock 미보유 → CONTROL DENIED 처리

[4] 프로그램 번호 변경 (실행 모드에 따라 분기)
    ┌─ memory 모드
    │   └─ FOCAS cnc_search(programNo): path1(mainProgramNo), path2(subProgramNo) 각각
    └─ dnc 모드
        └─ DNC 경로 파일 존재 확인 → 없으면 ERROR

[5] 프로그램 선두 복귀 (3단계 fallback — 아래 8-4 참조)

[6] HEAD / 원사이클 스톱 동시 확인 ★ 3차 수정 (아래 8-2 참조)
    목표 상태: HEAD1 ON, HEAD2 ON, 원사이클 스톱 OFF
    확인 실패 시 → PAUSED (운영자 조치 후 RESUME)

[7] skipFirstM20 = true 초기화 (Agent 내부 상태)
    ※ M99 선두 복귀형 구조: 첫 M20은 제외 (Section 3 참조)

[8] CNC 카운트 변수 초기화
    └─ cnc_wrmacro / cnc_wrpmacro:
       countMacroNo ← count (현재 값)
       presetMacroNo ← preset (목표 값)

[9] 사이클 스타트 (1회 — 이후 OCS가 연속 여부 제어)
    └─ PMC Write: CYCLE_START (R6105.4) 2회 펄스
    ※ PC는 이후 사이클마다 사이클 스타트를 반복 출력하지 않는다
    ※ 원사이클 스톱 OFF = 기계가 M99 후 자동으로 다음 사이클 진행
```

### 8-2. HEAD / 원사이클 스톱 동시 확인 시퀀스 ★ 3차 신규

기존의 순차 확인(HEAD1 → HEAD2 → OCS) 방식을 **동시 확인** 방식으로 변경한다.

**목표 상태**

| 신호 | 어드레스 | 목표값 |
|------|----------|--------|
| HEAD1 상태 (입력) | R6004.0 | 1 (ON) |
| HEAD2 상태 (입력) | R6004.1 | 1 (ON) |
| 원사이클 스톱 상태 (입력) | R6006.0 | **0 (OFF)** ★ |

> ★ 변경: 원사이클 스톱 **OFF (0)** 가 정상 조건
> 원사이클 스톱 OFF = 연속 사이클 진행 모드
> OCS OFF 상태에서 사이클 스타트 → 기계가 M99 후 자동으로 다음 사이클 진행

**1단계 — 현재 상태 동시 읽기**

```
동시에 읽음:
  R6004.0 (HEAD1 상태)
  R6004.1 (HEAD2 상태)
  R6006.0 (원사이클 스톱 상태)
```

**2단계 — 필요한 명령만 출력**

```
HEAD1 = OFF → R6104.0 모멘터리 펄스 출력 (1 → 300ms → 0)
HEAD2 = OFF → R6104.1 모멘터리 펄스 출력 (1 → 300ms → 0)
원사이클 스톱 = ON → R6106.0 = 0 출력 (OFF 명령)

※ 이미 목표값이면 출력 스킵
```

**3단계 — 동시 상태 확인 (최대 5초 폴링)**

```
100ms 간격으로 동시 폴링:
  R6004.0 == 1 (HEAD1 ON 확인)
  R6004.1 == 1 (HEAD2 ON 확인)
  R6006.0 == 0 (원사이클 스톱 OFF 확인)

세 조건 모두 충족 → 다음 단계 진행
5초 이내 미충족 → PAUSED (운영자가 조치 후 RESUME)
```

### 8-3. 사이클 중 시퀀스 ★ 3차 수정

**PC는 사이클 스타트를 최초 1회만 출력한다. M20을 기반으로 사이클 스타트를 반복하지 않는다.**
**연속 사이클 진행 여부는 원사이클 스톱 상태(R6006.0)가 결정한다.**

```
[초기 사이클 스타트 후]
        │
        ├─ 인터락 불만족 감지 (Agent pmcBits polling, RUNNING 중 100ms 간격)
        │   └─ 원사이클 스톱 ON (R6106.0 = 1) → 현재 사이클 완료(M99) 후 PAUSED
        │
        └─ M20 PMC 비트 감지 (schedulerConfig.m20Addr 폴링 — 카운트 이벤트만 처리)
            │
            ├─ skipFirstM20 === true → 제외 (skipFirstM20 = false로 전환)
            │   ※ M99 선두 복귀 직후 첫 M20 제외 (Section 3 참조)
            │
            └─ skipFirstM20 === false → M20 = 카운트 이벤트
                │
                ├─ Agent 내부 count 증가
                ├─ cnc_wrmacro / cnc_wrpmacro: countMacroNo ← count 동기화
                ├─ MQTT M20_COMPLETE 보고: { count: N, rowId }
                │   └─ Server: DB count = N, Redis 갱신, WS broadcast
                │
                ├─ [PAUSE 요청 중] → PAUSED 전환 (사이클 스타트 없음)
                │
                ├─ count == preset - 1
                │   └─ 원사이클 스톱 ON (R6106.0 = 1)
                │      → 기계가 다음 M99 도달 시 자동 정지 보장
                │      ※ count 증가는 계속됨
                │
                └─ count == preset → 행 완료 처리
                    ├─ path2 only 실행 조건 확인 (8-5 참조)
                    └─ 조건 미충족 → 행 COMPLETED, 다음 행 또는 전체 완료
```

> **원사이클 스톱 타이밍 (M99 선두 복귀형 기준)**
>
> ```
> (예: preset = 3)
>
> 사이클 스타트
>   M20 → skipFirstM20, 제외
>   가공 → M99 (OCS OFF = 연속 진행)
>   M20 → count = 1
>   가공 → M99 (OCS OFF = 연속 진행)
>   M20 → count = 2 (= preset - 1 = 2) → 원사이클 스톱 ON (R6106.0 = 1)
>   가공 → M99 (OCS ON = 이번 M99에서 기계 정지)
>   ※ 정지 후 기계는 선두로 복귀된 상태
>   M20 → count = 3 (= preset) → 행 완료
>   ※ 원사이클 스톱 ON 상태로 기계는 M99 직후에 정지
> ```
>
> M20 = 카운트 이벤트 (사이클 제어 신호 아님)
> M99 = 사이클 연속/정지 분기점 (OCS 상태에 따라 결정)

### 8-4. 프로그램 선두 복귀 (3단계 Fallback)

프로그램 선두 복귀는 다음 순서로 시도한다.
어느 단계에서든 성공하면 이후 단계를 스킵한다.

```
[1차] FOCAS rewind
    └─ cnc_rewind(handle)
    └─ EW_OK → 성공
       ※ run=0(STOP): 즉시 선두 복귀 완료
       ※ run=1(HOLD): 선두 복귀 예약 완료 — 다음 사이클 스타트 시 선두부터 실행
       ※ run=2(START) + seqNo≠0: 실행 중 → 실패 처리
    └─ 실패 → 2차 시도

[2차] RESET 신호
    └─ PMC Write: schedulerConfig.resetAddr (빈값이면 스킵)
    └─ RESET 후 300ms 대기
    └─ resetAddr 빈값이거나 실패 → 3차 시도

[3차] 프로그램 재호출 (cnc_search 재실행)
    └─ cnc_search(handle, programNo) 재실행
    └─ 실패 시 → Scheduler ERROR 처리
```

### 8-5. path2 only 실행 시퀀스

**실행 조건**: 해당 행에 `subProgramNo`가 지정되어 있고,
`schedulerConfig.path2OnlyConfirmAddr`이 비어 있지 않은 경우에만 수행한다.

```
[조건 확인]
    └─ subProgramNo 없음 → 스킵, 행 COMPLETED
    └─ path2OnlyConfirmAddr 빈값 → 스킵, 행 COMPLETED

[1] 사이클 스타트 입력

[2] path2 only 확인 메시지 감지 (timeout 포함)
    └─ pmcBits[path2OnlyConfirmAddr] === 1 대기
    └─ 대기 한도: path2OnlyTimeoutMs (기본 4000ms)
    └─ timeout 발생 시 → path2OnlyTimeoutAction 에 따라 처리
        ├─ 'error': Scheduler ERROR 처리
        └─ 'skip': path2 only 단계 스킵 → 행 COMPLETED

[3] path2OnlyConfirmDelayMs 대기 (기본 500ms)

[4] 사이클 스타트 재입력 (확인 응답)

[5] path2 사이클 완료 대기 (M20 수신)

[6] 행 COMPLETED 처리 → 다음 행으로
```

---

## 9. M20 역할 정의 ★ 3차 신규

### M20 = 카운트 이벤트 (사이클 제어 신호 아님)

**M20 수신 시 수행 작업:**

| 작업 | 내용 |
|------|------|
| count 증가 | Agent 내부 count++ |
| NC 변수 동기화 | cnc_wrmacro(countMacroNo ← count) |
| MQTT 이벤트 발행 | M20_COMPLETE { count, rowId } |
| 행 완료 여부 판단 | count >= preset → 행 COMPLETED |
| OCS 제어 | count == preset - 1 → 원사이클 스톱 ON |

**M20이 하지 않는 역할:**

| 항목 | 이유 |
|------|------|
| 다음 사이클 스타트 트리거 | 연속 사이클은 OCS OFF + M99에 의해 자동 진행 |
| 사이클 제어 신호 | M99가 사이클 연속/정지 분기점 역할 |
| 재기동 명령 | PC는 초기 사이클 스타트 1회만 출력 |

---

## 10. 사이클 스타트 제어 방식 ★ 3차 수정

### PC의 역할 — 초기 스타트 1회 출력

```
PC 역할:
  ① 초기 사이클 스타트 출력 (행 시작 시 1회)
  ② M20 이벤트 감시 (카운트 관리)
  ③ count == preset - 1 시점에 원사이클 스톱 ON
  ④ count == preset 시 행 완료 처리

PC가 하지 않는 것:
  × 매 사이클마다 사이클 스타트 반복 출력
  × M20 수신 후 사이클 스타트 재출력
```

### 연속 사이클 제어 — OCS 상태가 결정

```
원사이클 스톱 OFF (R6006.0 = 0, R6106.0 = 0):
  → 기계가 M99 도달 시 자동으로 다음 사이클 진행 (연속 운전)

원사이클 스톱 ON (R6106.0 = 1):
  → 기계가 현재 사이클 완료(M99 도달) 후 정지
```

### 사이클 진행 흐름 전체

```
[행 시작]
  HEAD/OCS 동시 확인 → 목표 상태: HEAD1 ON, HEAD2 ON, OCS OFF
  사이클 스타트 1회 출력
  → 기계 연속 사이클 진행 (OCS OFF = M99 자동 루프)

[카운트 관리]
  M20 감지마다: count++, NC 동기화, MQTT 보고
  count == preset - 1: OCS ON (다음 M99에서 기계 정지 예약)

[행 완료]
  count == preset: 행 COMPLETED → 다음 행 시작 또는 전체 완료
```

---

## 11. Scheduler 상태 머신 ★ 3차 수정

Scheduler 상태는 **Agent가 관리의 주체**이며,
Server/UI는 Agent 보고를 수신하여 상태를 동기화한다.

### 상태 정의

| 상태 | 설명 |
|------|------|
| `IDLE` | 실행 대기 중. 큐가 비어있거나 모든 행이 완료됨 |
| `RUNNING` | 행 실행 중. 사이클 진행 또는 M20 대기 중 |
| `PAUSED` | 원사이클 스톱 완료 또는 인터락 해소 대기. 동일 행 재개 가능 |
| `ERROR` | 프로그램 오류, timeout 등 시퀀스 비정상 정지 |

> ★ 변경: 인터락 실패는 ERROR 상태 전환 없음 — IDLE 유지 + CONTROL DENIED 처리

### 상태 전이 다이어그램

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
          │            │   │
          │   원사이클  │   │ 시퀀스 오류
     RESUME│   스톱완료 │   │ timeout
          │   인터락실패│   │ 프로그램 오류
          │            ▼   ▼
          │         ┌──────────┐   CANCEL / RESET
          └─────────│  PAUSED  │──────────────────▶ IDLE
                    └──────────┘
                         │ 복구 불가 오류
                         ▼
                    ┌──────────┐   CANCEL / RESET
                    │  ERROR   │──────────────────▶ IDLE
                    └──────────┘

인터락 실패 (실행 전):
  START → 인터락 FAIL → CONTROL DENIED → IDLE 유지 (ERROR 전환 없음)
```

### 유효 전이 목록

| 이벤트 | FROM | TO |
|--------|------|----|
| `START` (인터락 OK + PENDING 행 존재) | IDLE | RUNNING |
| `START` (인터락 FAIL) | IDLE | **IDLE 유지 (CONTROL DENIED)** ★ |
| `RESUME` | PAUSED | RUNNING |
| 원사이클 스톱 완료 / 인터락 감지 | RUNNING | PAUSED |
| count > preset 감지 (행 시작 시점) | RUNNING | PAUSED |
| 전체 행 COMPLETED | RUNNING | IDLE |
| 시퀀스 오류 / timeout | RUNNING, PAUSED | ERROR |
| `CANCEL` | RUNNING, PAUSED, ERROR | IDLE |

---

## 12. 데이터 모델 정리

### 12-1. DB 모델 정의

```prisma
model SchedulerRow {
  id            String             @id @default(uuid())
  machineDbId   String             @map("machine_id")
  order         Int
  mainProgramNo String             @map("main_program_no")
  subProgramNo  String?            @map("sub_program_no")
  preset        Int
  count         Int                @default(0)
  status        SchedulerRowStatus @default(PENDING)
  lastError     String?            @map("last_error")
  lastErrorCode String?            @map("last_error_code")
  lastErrorAt   DateTime?          @map("last_error_at")
  createdBy     String             @map("created_by")
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

### 12-2. Redis 키 구조

| 키 | 내용 | TTL |
|----|------|-----|
| `scheduler:{machineId}:rows` | 큐 전체 (SchedulerRow[] JSON) | 없음 |
| `scheduler:{machineId}:running` | `{ rowId, skipFirstM20, count }` | 24h |
| `scheduler:{machineId}:state` | `'IDLE' \| 'RUNNING' \| 'PAUSED' \| 'ERROR'` | 24h |

### 12-3. Control Lock 정책

```
한 시점에 하나의 제어 주체만 허용:
  Scheduler 실행 중 → Control Lock 소유자만 조작 가능
  Remote Panel 제어 중 → Scheduler START 불가

TTL 정책:
  일반 조작: 300초 (5분), 수동 연장 가능
  Scheduler 자동 실행 중: 매 행 시작 시 TTL 자동 갱신
```

---

## 13. 템플릿 Scheduler 설정 구조 ★ 3차 수정

### `schedulerConfig` 정의

```typescript
interface SchedulerConfig {
  // ── M20 감지 ──────────────────────────────────
  m20Addr: string;             // M20 완료 신호 PMC 주소 (읽기 전용, 필수)

  // ── 카운트 동기화 ──────────────────────────────
  countDisplay: {
    countMacroNo: number;      // count 매크로 변수 번호 (기본 #900)
    countVarType: 'macro' | 'pcode';  // 변수 타입

    presetMacroNo: number;     // preset 매크로 변수 번호 (기본 P#10000)
    presetVarType: 'macro' | 'pcode';
  };

  // ── 프로그램 선두 복귀 ─────────────────────────
  resetAddr: string;           // 2차 fallback RESET 신호 PMC 주소

  // ── 원사이클 스톱 ─────────────────────────────
  oneCycleStopAddr: string;    // OCS 출력 PMC 주소 (쓰기, R6106.0)
  oneCycleStopStatusAddr: string; // OCS 상태 PMC 주소 (읽기, R6006.0)
                               // ★ 목표 확인값 = 0 (OFF)

  // ── HEAD 상태 제어 ────────────────────────────
  mainHeadAddr: string;        // MAIN HEAD 출력 PMC 주소 (쓰기, R6104.0)
  mainHeadStatusAddr: string;  // MAIN HEAD 상태 PMC 주소 (읽기, R6004.0)
  subHeadAddr: string;         // SUB HEAD 출력 PMC 주소 (쓰기, R6104.1)
  subHeadStatusAddr: string;   // SUB HEAD 상태 PMC 주소 (읽기, R6004.1)

  // ── path2 only 확인 메시지 ────────────────────
  path2OnlyConfirmAddr: string;
  path2OnlyConfirmDelayMs: number;   // 기본 500ms
  path2OnlyTimeoutMs: number;        // 기본 4000ms
  path2OnlyTimeoutAction: 'error' | 'skip';

  // ── 큐 설정 ───────────────────────────────────
  maxQueueSize: number;        // 기본 15
}
```

### SB-20R2 기준 실제 주소값 (참고 — 템플릿 입력 항목)

| 항목 | 주소 | 방향 |
|------|------|------|
| M20 완료 신호 | R6002.4 | 입력 |
| HEAD1 출력 | R6104.0 | 출력 |
| HEAD1 상태 | R6004.0 | 입력 |
| HEAD2 출력 | R6104.1 | 출력 |
| HEAD2 상태 | R6004.1 | 입력 |
| 원사이클 스톱 출력 | R6106.0 | 출력 |
| 원사이클 스톱 상태 | R6006.0 | 입력 (목표: 0=OFF) |
| 사이클 스타트 | R6105.4 | 출력 |
| 리셋 | R6103.0 | 출력 |
| count 변수 | #900 (macro) | NC 변수 |
| preset 변수 | P#10000 (pcode) | NC 변수 |

---

## 14. Agent / Server / UI 역할 분리

### Agent 역할

| 작업 | 방법 |
|------|------|
| 큐 상태 수신 | MQTT `server/scheduler/{machineId}` 구독 |
| 인터락 평가 | pmcBits polling → AND 평가 → CONTROL DENIED 또는 실행 |
| count 관리 | 내부 count++ → wrmacro 동기화 → MQTT 보고 |
| 프로그램 선두 복귀 | cnc_rewind → RESET → cnc_search (3단계 fallback) |
| HEAD/OCS 동시 확인 | 상태 동시 읽기 → 필요 명령 출력 → 동시 폴링 확인 |
| 사이클 스타트 | PMC Write (R6105.4) — 행 시작 시 1회 |
| M20 감지 | pmcBits polling (m20Addr) |
| 원사이클 스톱 ON | count == preset - 1 시점에 출력 (R6106.0 = 1) |
| 매크로 변수 동기화 | cnc_wrmacro / cnc_wrpmacro |
| 상태/에러 보고 | MQTT `agent/events/{machineId}` |

### Server 역할

Server는 **상태 관리 및 UI 전달 역할만** 담당한다.

| 작업 | 방법 |
|------|------|
| 큐 CRUD | REST API `/api/scheduler/rows` |
| Agent 명령 전달 | MQTT `server/scheduler/{machineId}` 발행 |
| M20_COMPLETE 수신 | Agent 보고값으로 DB/Redis 갱신 |
| WS 브로드캐스트 | `scheduler_update/count/state/error` |
| Control Lock 관리 | Redis `control:lock:{machineId}` CRUD |

---

## 15. API 설계

### REST Endpoints

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/scheduler/rows?machineId=` | 큐 목록 + Scheduler 상태 |
| POST | `/api/scheduler/rows` | 행 추가 |
| PUT | `/api/scheduler/rows/:id` | 행 수정 (PENDING, PAUSED만) |
| DELETE | `/api/scheduler/rows/:id` | 행 삭제 (RUNNING 제외) |
| POST | `/api/scheduler/rows/reorder` | 순서 변경 |
| POST | `/api/scheduler/start?machineId=` | 큐 실행 시작 |
| POST | `/api/scheduler/resume?machineId=` | PAUSED → RUNNING |
| POST | `/api/scheduler/pause?machineId=` | 원사이클 스톱 요청 |
| POST | `/api/scheduler/cancel?machineId=` | 즉시 정지 + 취소 |

### WebSocket 이벤트

| 이벤트 | 페이로드 |
|--------|----------|
| `scheduler_update` | `{ machineId, rows: SchedulerRow[] }` |
| `scheduler_count` | `{ machineId, rowId, count }` |
| `scheduler_state` | `{ machineId, state: SchedulerState }` |
| `scheduler_error` | `{ machineId, rowId?, code, message }` |

---

## 16. UI 구조

### 실행 제어 버튼 활성 조건

| 버튼 | 활성 조건 |
|------|----------|
| ▶ 실행 | `hasControlLock && state==='IDLE'` && PENDING 행 존재 |
| ▶ 재개 | `hasControlLock && state==='PAUSED'` |
| ⏸ 원사이클 스톱 | `hasControlLock && state==='RUNNING'` |
| ■ 취소 | `hasControlLock && state!=='IDLE'` |

### 에러 행 표시

`lastError` 필드가 있는 행:
- 행 배경 주황색 처리 (PENDING 상태 유지 중 에러 정보 표시)
- 상태 셀: "⚠ 대기" 표시 + `lastError` 툴팁
- START 버튼 클릭 시 서버 START 핸들러에서 `lastError` 자동 초기화

---

## 17. 변경 요약 (2차 → 3차)

| # | 항목 | 기존 (2차) | 변경 (3차) |
|---|------|-----------|-----------|
| 1 | 인터락 실패 처리 | ERROR 상태 전환 | **CONTROL DENIED (IDLE 유지)** |
| 2 | HEAD/OCS 확인 방식 | HEAD1 → HEAD2 → OCS 순차 확인 | **동시 읽기 → 동시 명령 → 동시 폴링** |
| 3 | 원사이클 스톱 목표 상태 | ON (1) | **OFF (0)** |
| 4 | 프로그램 구조 | M30 종료 언급 없음 | **M99 선두 복귀형 명시** |
| 5 | M20 역할 | 사이클 제어 포함 | **카운트 이벤트만 (사이클 제어 없음)** |
| 6 | 사이클 스타트 출력 | M20 이후 재출력 구조 포함 | **초기 1회만, OCS가 연속 제어** |
| 7 | 정지 제어 | count==preset-1 → OCS ON 명시 미흡 | **count==preset-1 → OCS ON 명시** |

---

## 18. 코드 수정 필요 항목 (설계 확정 후 반영 예정)

설계 문서 3차 개정 내용 기준으로 코드 수정이 필요한 항목 목록이다.

| # | 파일 | 수정 내용 |
|---|------|----------|
| 1 | `SchedulerManager.cs` | 인터락 실패 → ERROR 대신 CONTROL_DENIED 처리 (IDLE 유지) |
| 2 | `SchedulerManager.cs` | HEAD/OCS 순차 확인 → 동시 확인 구조로 변경 |
| 3 | `SchedulerManager.cs` | EnsureOneCycleStopOn → EnsureOneCycleStopOff (목표값 0=OFF) |
| 4 | `SchedulerManager.cs` | OnM20Edge: M20 후 사이클 스타트 출력 코드 제거 |
| 5 | `SchedulerManager.cs` | OnM20Edge: count==preset-1 → OCS ON 로직 복원 |
| 6 | `SchedulerManager.cs` | `_skipFirstM20 = true` 복원 (M99 구조 기준) |
| 7 | `routes/scheduler.ts` | 인터락 실패 → CONTROL_DENIED 응답 처리 |

---

*3차 개정 완료 — 코드 수정 단계 진입 가능*
