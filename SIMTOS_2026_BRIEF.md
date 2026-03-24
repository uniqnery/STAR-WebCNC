# 2026 SIMTOS 전시 메뉴 — 개발 브리핑

> 작성일: 2026-03-24
> 성격: 2026 SIMTOS 전시 전용 1회성 메뉴 (범용 설정 불필요, 고정 사양 기반)

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| 라우트 | `/simtos` |
| 파일 | `packages/web/src/pages/Simtos.tsx` |
| 사이드바 | Machines 하위 메뉴에 "SIMTOS 2026" 추가 |
| 접근 권한 | 로그인 사용자 누구나 열람, **ADMIN/HQ_ENGINEER만 실행** |
| 실행 조건 | 인터록 전항목 만족 + 제어권(ControlLock) 보유 |

---

## 2. 화면 구성

```
┌─────────────────────────────────────────────────────────────┐
│  [배너] 2026 SIMTOS — Star CNC Demo         [제어권 버튼]   │
│  안내 문구 + 인터록 상태 줄 (4항목)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   [O3001]      [O3002]      [O3003]                        │
│   제품카드      제품카드      제품카드                        │
│                                                             │
│       [O3004]          [O3005]                             │
│       제품카드          제품카드                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  실행 로그 (5줄 고정 + 스크롤)                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 인터록 항목 (하드코딩)

| 항목명 | 신호 소스 | 판정 기준 | 정상 조건 |
|--------|-----------|-----------|-----------|
| MEM 모드 | `telemetry.mode` | `=== 'MEM'` | 초록 (MEM 모드 진입 상태) |
| 절단 정지 | `telemetry.runState` | `=== 0` | 초록 (사이클 미실행 상태) |
| HEAD1 | PMC `R6004.0` | `=== 1` | 초록 (HEAD1 ON) |
| HEAD2 | PMC `R6004.1` | `=== 1` | 초록 (HEAD2 ON) |

> **보완 필요**: "DNC 모드 설정" 항목의 의도 확인 필요.
> 현재 해석: 메모리 모드 실행이므로 MEM 모드 여부를 확인하는 것으로 가정.
> → 전시 현장에서 DNC 모드 별도 설정 항목이 필요하면 추가 논의.

`interlockSatisfied = mode === 'MEM' && runState === 0 && head1 === 1 && head2 === 1`

---

## 4. 제어권 UI

- `ControlLockButton` 컴포넌트(기존) 재사용
- 우상단 배너 영역에 배치
- 제어권 없으면 제품 카드 longpress 비활성화

---

## 5. 제품 카드 (5개 고정)

| No | 프로그램 (Path1) | Path2 | 카드 레이아웃 |
|----|-----------------|-------|--------------|
| 1 | O3001 | O1111 | 상단 좌 |
| 2 | O3002 | O1111 | 상단 중 |
| 3 | O3003 | O1111 | 상단 우 |
| 4 | O3004 | O1111 | 하단 좌 |
| 5 | O3005 | O1111 | 하단 우 |

- Path2는 **O1111 고정**
- 실행 모드: **Memory 모드** (`cnc_search` + `cnc_rewind`)
- 레이아웃: 3+2 (상단 3개 / 하단 2개 중앙 정렬), 카드가 화면을 거의 채우는 크기

### 카드 상태 표시 (runState + programNo 기반)

| 조건 | 카드 표시 |
|------|----------|
| `programNo === 'O3001'` && `runState >= 2` | 이미지 순환 애니메이션 (0.5초 간격) |
| 그 외 (정지 중 / 다른 프로그램) | 기본 대표 이미지 고정 |

---

## 6. 롱프레스 → 실행 시퀀스

### 6-1. 롱프레스 (1500ms)
- 기존 `useLongPress` 훅 재사용
- `disabled`: `!canOperate || !interlockSatisfied || isExecuting`
- 원형 프로그레스 오버레이 (RemoteControl과 동일 스타일)
- 중간에 손 떼면 취소

### 6-2. 확인 팝업
```
"O3001 프로그램을 실행하시겠습니까?"
[확인]  [취소]
```
- 팝업 중 다른 카드 롱프레스 차단 (`isExecuting` 플래그)

### 6-3. 실행 시퀀스 (확인 후)

```
STEP 1. SEARCH_PROGRAM (Path1)
  commandApi.send(machineId, 'SEARCH_PROGRAM', { programNo: 3001, path: 1 })

STEP 2. SEARCH_PROGRAM (Path2)
  commandApi.send(machineId, 'SEARCH_PROGRAM', { programNo: 1111, path: 2 })

STEP 3. REWIND (Path1 선두 복귀)
  commandApi.send(machineId, 'PMC_WRITE', { address: 'R6103.0', value: 1, holdMs: 300 })
  → 500ms 대기

STEP 4. PATH2 REWIND
  commandApi.send(machineId, 'REWIND_PROGRAM', { path: 2 })

STEP 5. CYCLE_START 루프 (최대 5회, 2초 간격)
  for attempt 1~5:
    commandApi.send(machineId, 'PMC_WRITE', { address: 'R6105.4', value: 1, holdMs: 200 })
    2초 대기
    if runState >= 2 → 가동 확인, 루프 종료
    else → 재시도 (OCS ON으로 첫 M20 정지 후 재스타트 대비)
```

> **OCS 처리 방침**: 전시 환경에서 OCS(원사이클 스톱)가 ON 상태일 수 있음.
> OCS ON → 첫 M20 이후 기계 정지 → runState = 0 → CYCLE_START 재시도로 자동 처리.
> 세부 OCS ON/OFF 제어는 이 메뉴에서 직접 하지 않고, 기계가 멈추면 재스타트하는 방식으로 단순화.

### 6-4. 중복 실행 방지
- `isExecuting: boolean` 상태
- 실행 중 다른 카드 롱프레스 비활성화
- 팝업 중복 표시 차단

---

## 7. 이미지 파일 구조

```
packages/web/public/simtos/
├── O3001/
│   ├── default.jpg     ← 기본 대표 이미지 (정지 시 표시)
│   ├── 001.jpg         ← 가공 중 순환 이미지 1~10
│   ├── 002.jpg
│   └── ... (최대 010.jpg)
├── O3002/
│   ├── default.jpg
│   └── 001.jpg ~ 010.jpg
├── O3003/ ...
├── O3004/ ...
└── O3005/ ...
```

### 이미지 로딩 규칙
- 기본 이미지: `/simtos/{programNo}/default.jpg`
- 순환 이미지: `/simtos/{programNo}/001.jpg` ~ `/simtos/{programNo}/010.jpg`
- 순환 이미지가 없을 경우 대표 이미지 고정 (오류 없이 폴백)
- 이미지 파일 부재 시: 회색 플레이스홀더 카드 표시 (에러 없음)

### 순환 로직
- `runState >= 2` && `programNo === currentProduct.programNo` → `setInterval` 0.5초마다 인덱스 증가
- 정지 → 인덱스 0으로 리셋, `default.jpg` 표시

---

## 8. 실행 로그

```
┌──────────────────────────────────────────────────────────────┐
│ 14:23:05  admin  O3001  ▶ 실행 시작                         │
│ 14:23:07  admin  O3001  ✓ 프로그램 선택 완료                 │
│ 14:23:08  admin  O3001  ✓ 선두 복귀 완료                     │
│ 14:23:10  admin  O3001  ▶ 사이클 스타트 1/5                  │
│ 14:23:12  admin  O3001  ✓ 가동 확인                          │
└──────────────────────────────────────────────────────────────┘
```

- 고정 5줄 표시 영역 (overflow-y-scroll)
- `useRef` 배열로 최신 50줄 유지
- 컬럼: 시간 / 사용자 / 프로그램 번호 / 상태 메시지
- 색상: 성공(초록), 오류(빨강), 정보(회색)

---

## 9. 기술 스택 및 재사용 컴포넌트

| 항목 | 사용 방식 |
|------|----------|
| `useLongPress` | 그대로 재사용 |
| `ControlLockButton` | 기존 컴포넌트 import |
| `commandApi.send()` | 기존 API 함수 |
| `useMachineTelemetry` | runState, mode, programNo, pmcBits |
| `useControlLock` | 제어권 상태 |
| `useAuthStore` | 사용자 역할 확인 |
| `MachineTopBar` | **미사용** (전시 전용 배너로 대체) |

---

## 10. 보완 사항 및 확인 필요 항목

| # | 항목 | 내용 | 처리 방향 |
|---|------|------|-----------|
| 1 | `REWIND_PROGRAM` 커맨드 | Agent CommandHandler에 path 지정 rewind가 있는지 확인 필요 | PMC RESET 펄스(R6103.0) fallback 사용 |
| 2 | `SEARCH_PROGRAM` path 파라미터 | path=2 cnc_search 지원 여부 확인 (FocasDataReader.SearchProgram 인자) | 기존 구현 확인 후 확정 |
| 3 | 인터록 "DNC 모드 설정" 항목 | 요구사항의 의도가 불명확 — MEM 모드 여부로 해석 | **확인 필요** |
| 4 | 제품 이미지 파일 | 실제 이미지 없음 → 플레이스홀더로 우선 구현 | 전시 전 이미지 파일 추가 |
| 5 | 사이드바 노출 조건 | 모든 사용자 / ADMIN만? | ADMIN/HQ_ENGINEER에게만 사이드바 표시 권장 |
| 6 | `programNo` 형식 | telemetry.programNo가 `'O3001'`인지 `'3001'`인지 확인 | 기존 telemetry 파이프라인 확인 필요 |
| 7 | OCS 자동 제어 여부 | 전시 중 OCS 켜진 상태로 운영 가능성 — 재스타트로만 처리 | 현재 방침 유지 (단순화) |

---

## 11. 구현 범위 (이번 작업)

- [x] `packages/web/public/simtos/` 폴더 구조 생성 (플레이스홀더 포함)
- [ ] `packages/web/src/pages/Simtos.tsx` 구현
- [ ] `packages/web/src/App.tsx` 라우트 추가 (`/simtos`)
- [ ] `packages/web/src/components/Layout.tsx` 사이드바 항목 추가

---

*이 문서는 구현 시작 전 확인 및 보완 사항 정리용. 실제 구현은 확인 완료 후 진행.*
