# 2026 SIMTOS 전시 메뉴 — 개발 브리핑

> 최초 작성: 2026-03-24 / 최종 수정: 2026-04-04
> 성격: 2026 SIMTOS 전시 전용 1회성 메뉴 (범용 설정 불필요, 고정 사양 기반)
> 구현 상태: **완료** (git 커밋 완료, 커밋 해시: 별도 기록)

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| 라우트 | `/simtos` |
| 파일 | `packages/web/src/pages/Simtos.tsx` |
| 사이드바 | Layout.tsx에 "SIMTOS 2026" 메뉴 추가됨 |
| 접근 권한 | 로그인 사용자 누구나 열람, **ADMIN/HQ_ENGINEER만 실행** |
| 실행 조건 | 인터록 전항목 만족 + 제어권(ControlLock) 보유 |

---

## 2. 화면 구성

```
┌─────────────────────────────────────────────────────────────┐
│  MachineTopBar (lockDisabled=!interlockSatisfied)           │
│  rightSlot: 인터록 pills 4개 + 실행가능/조건미충족 배지       │
├─────────────────────────────────────────────────────────────┤
│   [O3001]      [O3002]      [O3003]                        │
│   제품카드      제품카드      제품카드                        │
│       [O3004]          [O3005]                             │
│       제품카드          제품카드                             │
├─────────────────────────────────────────────────────────────┤
│  실행 로그 (최대 50줄, auto-scroll)                          │
└─────────────────────────────────────────────────────────────┘
```

> **MachineTopBar 실제 사용 중** — 별도 배너로 대체하지 않고 표준 TopBar에 `rightSlot`으로 SIMTOS 전용 인터록 pills 삽입.

---

## 3. 인터록 항목 (PMC 직접 참조 — 하드코딩)

### 3-1. 확정된 인터록 조건

| 항목명 | PMC 주소 | 판정 기준 | 정상 조건 |
|--------|----------|-----------|-----------|
| 메모리 모드 | `R6037.0` | `=== 1` | 초록 |
| 운전 대기중 | `R6024.0` | `=== 0` | 초록 (비가동) |
| 도어 닫힘 | `R6011.0` | `=== 1` | 초록 |
| PATH ALL | `R6035.0` | `=== 1` | 초록 |

```typescript
const interlockMem     = pmcBits['R6037.0'] === 1;
const interlockStop    = pmcBits['R6024.0'] === 0;
const interlockDoor    = pmcBits['R6011.0'] === 1;
const interlockPathAll = pmcBits['R6035.0'] === 1;
const interlockSatisfied = interlockMem && interlockStop && interlockDoor && interlockPathAll;
```

### 3-2. 인터록 설계 정책 (확정)

- **모든 인터록 판단은 PMC 직접 참조만 사용**
- `telemetry.mode`, `telemetry.runState` 기반 인터록 설계는 완전 폐기
- 향후 SIMTOS 인터록 추가 시에도 PMC R6xxx 주소 기준만 허용
- R6035.0은 `extraPmcAddrs` 파이프라인을 통해 pmc_bits로 수신

### 3-3. extraPmcAddrs 연동

R6035.0은 topBarInterlock과 무관한 주소이므로 템플릿 JSON의 `extraPmcAddrs` 배열에 등록:

```json
"extraPmcAddrs": ["R6035.0"]
```

에이전트가 pmc_bits 발행 시 이 주소를 포함하여 100ms마다 읽음.

---

## 4. 제어권 UI

- `MachineTopBar`의 `lockDisabled={!interlockSatisfied}` 로 인터록 미충족 시 제어권 버튼 비활성화
- 제어권 없으면 제품 카드 롱프레스 비활성화 (`canOperate = controlLock.isOwner && isAdmin`)

---

## 5. 제품 카드 (5개 고정)

| No | 프로그램 (Path1) | Path2 | 카드 레이아웃 |
|----|-----------------|-------|--------------|
| 1 | O3001 (path1=3001) | O1111 | 상단 좌 |
| 2 | O3002 (path1=3002) | O1111 | 상단 중 |
| 3 | O3003 (path1=3003) | O1111 | 상단 우 |
| 4 | O3004 (path1=3004) | O1111 | 하단 좌 |
| 5 | O3005 (path1=3005) | O1111 | 하단 우 |

- Path2는 **O1111 고정** (`PATH2_PROGRAM = 1111`)
- 실행 모드: **Memory 모드** (`SEARCH_PROGRAM` 명령)
- 레이아웃: 3+2 (상단 3개 / 하단 2개 중앙 정렬)
- 이미지: `/simtos/{programNo}/main.jpg` (정지) / `/simtos/{programNo}/running.gif` (가동)

---

## 6. 롱프레스 → 실행 시퀀스

### 6-1. 롱프레스
- `useLongPress` 훅 사용, `LONG_PRESS_MS = 1500ms`
- 비활성 조건: `!canOperate || !interlockSatisfied || isExecuting`

### 6-2. 확인 팝업
- "O3001 프로그램을 실행하시겠습니까?" → [확인] [취소]

### 6-3. 실행 시퀀스

```
STEP 1. SEARCH_PROGRAM path=1  (programNo: 3001)
STEP 2. SEARCH_PROGRAM path=2  (programNo: 1111)
STEP 3. PMC_WRITE R6124.0=1 holdMs=300 (Path1 RESET → 선두 복귀) + 500ms 대기
STEP 4. REWIND_PROGRAM path=2
STEP 5. CYCLE_START 루프 최대 5회 (R6144.0=1 holdMs=500, 2초 간격)
         → 루프 종료 후 runState >= 2 확인
```

> **사이클 스타트 5회 루프**: 가동 확인 없이 무조건 5회 발행. OCS ON 상태에서 첫 M20 정지 후 재스타트 자동 처리 목적.

### 6-4. 중복 실행 방지
- `isExecuting: boolean` 상태로 차단

---

## 7. 이미지 파일 구조

```
packages/web/public/simtos/
├── O3001/main.jpg, running.gif
├── O3002/main.jpg, running.gif
├── O3003/main.jpg, running.gif
├── O3004/main.jpg, running.gif
└── O3005/main.jpg, running.gif
```

---

## 8. 실행 로그

- 최대 50줄 유지, auto-scroll
- 컬럼: 시간 / 사용자 / 프로그램 번호 / 상태 메시지
- 색상: 성공(초록), 오류(빨강), 정보(회색)

---

## 9. 기술 스택 및 사용 컴포넌트

| 항목 | 사용 방식 |
|------|----------|
| `useLongPress` | 그대로 재사용 |
| `MachineTopBar` | 실제 사용 중 (rightSlot으로 인터록 pills 삽입) |
| `commandApi.sendAndWait()` | SEARCH_PROGRAM, PMC_WRITE, REWIND_PROGRAM |
| `useMachineTelemetry` | runState, programNo, pmcBits |
| `useControlLock` | 제어권 상태 |
| `useAuthStore` | 사용자 역할 확인 |

---

## 10. git 관리 현황

| 항목 | 상태 |
|------|------|
| `Simtos.tsx` | 구현 완료, 커밋됨 |
| `extraPmcAddrs` 파이프라인 | 완료 (JSON + templateSync + Prisma + routes + Agent) |
| SIMTOS 전용 PMC 주소 | `extraPmcAddrs: ["R6035.0"]` 템플릿 JSON에 등록 완료 |

---

## 11. 알려진 이슈 / 향후 작업

| # | 항목 | 내용 |
|---|------|------|
| 1 | 사이클 스타트 가동 확인 | 현재 5회 루프 후 runState 확인. 가동 전 확인으로 개선 가능 |
| 2 | 이미지 파일 | 실제 전시용 이미지로 교체 필요 |
