# FANUC FOCAS Reference

이 문서는 Star-WebCNC에서 현재 구현된 FANUC FOCAS 기능과, 이후 Codex/Claude Code가 FOCAS 관련 기능을 구현할 때 반드시 지켜야 할 주의사항을 정리한 참고 문서다.

목표는 두 가지다.

- 기존에 구현한 FOCAS 기능의 위치와 역할을 빠르게 파악한다.
- 이미 겪었던 EW_HANDLE, PMC 지연, blocking API, DNC 오해 같은 실수를 반복하지 않는다.

## 현재 구현 구조

### 툴라이프 변수 타입·재적용 수정 (2026-11-26)

- `READ_TOOL_LIFE`와 `WRITE_TOOL_LIFE_PRESET`은 `ToolLifeVariables`로 macro→일반 매크로, pcode→P코드 전용 API, ddata→PMC D영역을 구분한다. 쓰기 전후 검증도 동일 타입을 사용하고 읽기 실패는 0으로 만들지 않는다. 요청 Path를 선택하고 처리 후 Path1로 복귀하며 수정 가능 항목은 같은 Path 설정에서만 검증한다. 웹/API의 쓰기 요청·감사 의도에도 Path를 전달한다.
- ToolLifeView는 템플릿 Path 설정 변경 시 재조회하고 미확인 값은 `—`로 표시하며 편집을 막는다. P코드 표기는 P로 구분한다. 템플릿 저장은 서버 저장 실패와 Agent 적용 확인 대기를 구분하고, 적용 완료/대기 설비를 각각 안내한다. 기존 최신 PMC·인터록 서명 검사와 관리자 수정 권한·감사 이력은 유지한다. 연결 안 된 설비의 재적용 ACK는 여전히 CNC 연결 후 처리되며 연결 복구 후 확인이 필요하다.
- 검증: Agent 74개, 서버 193개(저장 성공/적용 대기 분리 회귀 3개 포함), 실제 ToolLifeView 격리 DOM 12개 검사 및 서버/Web 빌드 통과. 2호기 실읽기 Path1 585ms(T0100 P14040=999999, P14280≈4000; T0500 COUNT≈5564), Path2 478ms/200 응답. 실기기 쓰기는 하지 않았다. 템플릿 주소는 사용자가 설정한 값을 유지했다.
- 운영 DLL SHA256 `FA8A6C70E77A03E595B16383724328D2C727464DB2C0813E5C4CC508A30FCD14`, 교체 전 백업 `agent-runtime/startup/rollback-pop-agent-20261126-091939`. 공유 publish와 MC-002 publish 두 곳에 반영했으며 자동 기동 상태 Agent 프로세스 4개 ready 및 2호기 CNC/PMC 연결 복구를 확인했다.

### 카운터 화면 수동 저장·프리셋 하한 (2026-11-26)

- 같은 날 첫 조회 지연 수정: 개발 StrictMode가 effect를 정리·재실행할 때 cleanup의 generation 증가가 최초 READ_COUNT 응답을 폐기하고 다음 5초 poll까지 기다리게 했다. 실제 조회 API/웹 경유 측정은 293~497ms였고, 30ms 고정 응답의 격리 화면은 수정 전 5054ms(요청 2회)였다. 기기 변경은 keyed 패널의 mounted guard가 보호하므로 cleanup의 불필요한 generation 증가만 제거했고 쓰기 전후 generation 보호는 유지했다. 동일 재현 수정 후 StrictMode 64ms/요청 1회, 일반 모드 41ms/요청 1회. 첫 응답 즉시 표시·중복 조회 없음·기기 전환 및 저장 전 응답 폐기를 포함한 실제 CountView 격리 UI 28개와 Web build 통과. 서버/Agent/CNC 설정 변경 없음.
- 같은 날 화면 간소화: 재조회 버튼·상시 안내·변수 번호·하단 가동 설명을 제거했다. PRESET/COUNT/TOTAL 및 시간 행은 최초 응답 전부터 고정하고 값만 `—`에서 교체한다. 자동 조회, 저장/취소, 프리셋 COUNT+2 제한 및 실제 실패 알림은 유지했다. 지연된 최초 응답에서도 행 유지·미로딩 편집 차단을 포함한 격리 UI 24개 검사와 Web build 통과, 실행 중 Vite 모듈 200 및 새 화면 코드 제공 확인. Agent/서버/설비 설정은 이 간소화에서 변경하지 않았다.
- `READ_COUNT`는 템플릿 변수 목록과 함께 현재 설정의 사이클 타임(초), Run 상태, `presetMinGap=2` 지원을 반환한다. 화면은 5초마다 조회하고 편집 초안은 분리한다. PRESET/COUNT/TOTAL은 정수 표시이며 승인된 관리자만 항목별 저장/취소할 수 있다.
- `WRITE_COUNT`는 기존 FOCAS 스레드·서버 직렬 처리·수정 의도 journal·확인값 이력을 유지한다. `preset` 쓰기에서는 `CounterWriteRules.WritePreset`가 실제 CNC COUNT를 바로 읽고 target >= COUNT+2인 경우에만 write 함수를 호출한다. 읽기 실패나 조건 미달은 CNC 쓰기 없이 실패 원인을 반환한다. 화면 표시값이나 요청 파라미터의 count를 신뢰해 판정하지 않는다. 하드웨어 카운터는 검사와 쓰기 사이에도 변할 수 있어 PLC 수준의 원자적 인터록과 동일한 보장은 아니다.
- 수량은 0~Int32.MaxValue 정수로 제한하고, 작은 소수 환산 오차만 정수 표시에서 정리한다. COUNT/TOTAL에는 PRESET 하한을 적용하지 않으며 TOTAL의 P10001 직접 수정은 기존 WRITE_COUNT 감사 경로에 남는다. 스케줄러 내부 제어 쓰기에는 이 수동 저장 조건을 추가하지 않았다.
- 대상 템플릿 PRESET/COUNT를 CountDisplay와 맞추고 TOTAL은 P10001/writable로 저장했다. 기존 #503 remaining 필드를 계산 잔여 시간으로 대체했으며 D97 초/D98 분/D99 시간 설정은 유지했다. 템플릿 변경 전 백업은 `agent-runtime/startup/rollback-count-panel-1795648456746`, Agent 교체 전 DLL은 `agent-runtime/startup/rollback-pop-agent-20261126-081427`에 있다. 최종 DLL SHA256 `D851034E895DDA42E7F4B870C0CB56C50485A92E66BCFB4C0054CF6DA9143152`.
- 변경 파일: Agent `Commands/{CounterWriteRules,CommandHandler}.cs`, Server `routes/machines.ts`, Web `components/ncmonitor/CountView.tsx`, `lib/{countDisplay,api}.ts`, 해당 템플릿 JSON. Server 186개(시간 계산 22개 포함), Agent 61개, 별도 DOM의 실제 CountView/API 모의 검사 18개 통과. blur/Enter/취소 무전송·저장 1회·USER 차단·구형 Agent 차단·실패 시 초안 유지·CNC count 상승 후 하한 갱신을 확인했다. `tools/verify-count-ui.mjs`는 happy-dom을 별도 runtime 테스트 폴더에 설치해서 실행하며 본 프로젝트 의존성 변경은 없다.
- 2호기 운영 적용 후 READ_COUNT 200, PRESET P10000=2000.0000000000002→2000 표시, COUNT #900=1278, TOTAL P10001=1278 및 전부 readonly=false, presetMinGap=2, 사이클 2분 6초·잔여 25시간 16분 12초·예상 2026-11-27 09:31을 확인했다. 이 검증은 읽기만 했고 CNC 수량은 시험용으로 쓰지 않았다. 4대 Agent ready와 journal pending=0도 확인했다.

### POP 카운터 변화 수집 (2026-11-25 운영 전환)

- POP는 `DataCollectorService`의 기존 카운트 상세 조회에서 템플릿 CountDisplay 변수값을 재사용한다. 카운트/프리셋 읽기 실패를 0으로 변환하지 않고 원본 null로 보관한다. 원본 메인 프로그램(스케줄러 실행 시 원본 행 메타데이터), 실행 번호, 코멘트, 카운터 주소, 상단과 동일한 Run/HasAlarm 근거를 스냅샷으로 기록한다. 상태는 초록(Run 2/3) 우선, 빨강(HasAlarm), 대기, 확인 불가 순이다.
- `CounterJournal`의 `counter-journal/MC-xxx/state.json`에 마지막 관측·유효 카운트·미전송 이벤트·수정 의도를 한 번에 원자적으로 저장한다. 변경 시 및 15초 생존 표본을 보관하고 서버 DB 커밋 ACK까지 재전송한다. 스케줄러 제어는 건드리지 않으며 POP M20 생성 구독만 해제했다. 과거 M20 미전송 파일은 보존하고 서버가 설비별 최초 카운터 수집 시점 이후 M20 실적을 중복 반영하지 않는다.
- 서버에서 실제 템플릿을 받지 못해 `FALLBACK_TEMPLATE`를 사용하는 동안은 기본 변수값을 POP 기준으로 신뢰하지 않는다. 카운트·프리셋은 미확인으로 기록하고 마지막 정상 카운터 기준을 유지한다. 정상 설정 복구 후 변화는 단절 구간 규칙을 적용한다.
- 카운터 수정은 `CommandHandler`의 기존 읽기→쓰기→재확인 중 최초 읽기에서 수정 의도를 먼저 영속 저장한다. 쓰기 도중 프로세스가 종료돼도 다음 표본을 수정으로 분리한다. 기록 실패 시 수정 의도 저장 전에 CNC 쓰기를 진행하지 않는다. 수정 완료 기록 실패는 의도를 유지하며 다음 정상 조회에서 복구한다.
- 상태 구간은 관측 간격 기준이며 30초보다 긴 미관측 구간을 계속 가동으로 계산하지 않는다. PC/설비 단절 중 초기화·원복·여러 프로그램 가공은 복원할 수 없다. 별도 초기화 불가 누적 카운터와 래치 설계는 이번 변경에 포함하지 않았다. 메시지는 수집 가능한 오퍼레이터 메시지 변경 스냅샷을 원본에 저장하고 실제 알람 발생/해제 DB 이력은 기존 경로를 유지한다.

### 이전 POP M20 완료 수집 (같은 날 카운터 방식으로 대체)

- `DataCollectorService`의 기존 M20 주소/전용 FOCAS 스레드에서 상승 엣지를 감지한다. 최초 읽기·CNC 재연결 첫 ON은 완료로 만들지 않는다. `SchedulerManager`가 소비하는 신호는 유효 생산만 별도 이벤트로 내보내 첫 M20/Path2Only 중복 집계를 피한다.
- `ProductionOutbox`가 설비별 `production-outbox/MC-xxx`에 이벤트를 영속 기록하고 DB 저장 ACK까지 재전송한다. MQTT 전송 성공만으로 삭제하지 않으며 DB eventId 유일키로 중복 수량을 막는다. 디스크 기록 실패 시 메모리 재시도는 하지만 그 상태의 PC 종료까지 무손실을 보장하지 않는다.
- 일반 운전 원본 프로그램 코멘트는 해당 O번호만 조회하고 기존 5분 캐시를 사용한다. POP 전용 upload3 읽기 예산은 타입별 200ms이며 기본 파일전송의 제한시간은 유지한다. O9000 이상은 이 추가 조회를 하지 않으며 코멘트가 없으면 O번호/미지정으로 기록한다.
- 이 기능은 CNC/PMC 출력 및 카운터 증감으로 실적을 만들지 않는다. 원래 스케줄러의 제어용 변수 쓰기는 유지한다. PC 정지 중 신호·폴링보다 짧은 펄스는 별도 PLC 래치 없이는 복구하지 못한다.

Star-WebCNC의 FANUC 통신은 C# Agent가 담당한다.

```text
Web UI
  -> Node.js Server
  -> MQTT command/topic
  -> C# Agent
  -> FANUC FOCAS2 Ethernet
  -> CNC
```

주요 파일:

- `packages/agent/StarWebCNC.Agent/Focas/FocasConnection.cs`
  - FOCAS DLL load, CNC 연결, handle 관리, 연결 해제, 연결 오류 처리
- `packages/agent/StarWebCNC.Agent/Focas/FocasDataReader.cs`
  - CNC 상태, 좌표, 속도, 알람, PMC, 프로그램, offset/counter/tool life, MDI, DNC 관련 FOCAS API wrapper
- `packages/agent/StarWebCNC.Agent/Collectors/DataCollectorService.cs`
  - FOCAS 전용 수집 루프
  - telemetry, alarm, pmc_bits 발행
  - MQTT 명령을 FOCAS thread에서 처리하도록 큐잉
- `packages/agent/StarWebCNC.Agent/Commands/CommandHandler.cs`
  - Server에서 내려온 명령을 실제 FOCAS 동작으로 변환
  - 프로그램 전송, PMC write, offset/counter/tool life, MDI, search 등 처리
- `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`
  - 스케줄러 상태 머신
  - memory mode 프로그램 search/rewind/cycle start
  - DNC mode의 현재 구현 수준 관리
- `packages/agent/StarWebCNC.Agent/Template/TemplateModel.cs`
  - 설비별 PMC 주소, scheduler 주소, interlock, panel, count display 등 템플릿 정의

## 핵심 설계 원칙

### 원격 인터록·데이터 수정 기준 (2026-11-25)

- 원격 패널 PMC_WRITE는 Agent의 제어 명령 인터록 대상이며 실제 출력 직전에 다시 검사한다. STOP/FEED_HOLD/CYCLE_STOP 및 명시적 0 출력 예외는 설치 템플릿에 유일하게 매칭되는 reqAddr만 허용한다. 모멘터리 자동 0 복귀는 인터록이 떨어져도 수행하고 해제 실패는 성공 처리하지 않는다.
- 서버는 최신 PMC 샘플과 remote 인터록 설정 서명 일치를 검사한다. 구 Agent처럼 서명이 없거나, 설정 재적용 미완료·미수신·3.5초 초과인 경우 획득/출력을 허용하지 않는다. 재적용 API는 Agent 응답을 기다리며 fallback 템플릿은 적용 성공으로 취급하지 않는다.
- WRITE_OFFSET/WRITE_COUNT/WRITE_TOOL_LIFE_PRESET은 ADMIN/HQ_ENGINEER의 전용 API로만 허용하고 제어권·PMC 인터록은 요구하지 않는다. 감사 로그를 전송 전에 만들며 actor/당시 role/입력/응답의 beforeValue·value/처리 시각/결과를 보존한다. 응답이 없거나 재조회 불일치이면 unknown이며 자동 재전송하지 않는다.
- `VerifiedDataWrite`는 FOCAS 스레드에서 동기적으로 기존값 읽기→증감 계산→쓰기→재조회한다. 읽기 실패를 0으로 치환해 덧셈하지 않는다. 오프셋 Path를 선택해 한 항목만 읽고 Path 1로 복귀한다. 서버 설비별 직렬화와 Agent 명령 큐를 함께 유지한다.
- 검증: 서버 86건, CNC를 로드하지 않는 `tests/StarWebCNC.Agent.Checks` 18건 통과. 로컬 API/Agent에 적용하고 2호기의 X0.1 불만족 판정 및 설정 서명 수신을 확인했다. 실제 PMC 출력과 데이터 쓰기를 통한 확인은 미실시다. 이전 DLL은 `agent-runtime/startup/rollback-interlock-20261125-080009`에 보관했다.

### 1. 1 Agent = 1 CNC

단독 DNC 시작은 파일·전용 핸들·Path1 준비 → 모드/STOP/알람/인터락 재검사 → 작업자가 설비 조작반 Cycle Start를 직접 누름 → `cnc_dncstart2` CNC 요청 확인 → 전송 순서로 처리한다. 웹·Agent는 단독 테스트에서 Cycle Start PMC를 출력하지 않는다. `awaiting_cycle_start` 상태로 최대 60초 대기하고, 시간초과 또는 사용자가 취소하면 데이터 공급 세션을 종료한다. `cnc_dncstart2`의 `char*`는 선택한 PC 파일명 입력이 아니라 CNC 요청명 출력 버퍼다. 비어 있지 않은 M198 요청이면 단독 파일 공급을 차단한다. 스케줄러 자동 시작 순서는 아직 별도 검증이 필요하다.

MC-002에서 확인한 `cnc_statinfo.aut` 기준은 `10=RMT/DNC`, `9=REF`이다. DNC 시작 검사와 `CncStatus.ModeString` 표시를 동일하게 유지한다. `run=1`은 현재 코드에서 HOLD로 표시하며, 단독 DNC 시작은 `run=0`만 허용한다.

현재 구조는 한 Agent 프로세스가 한 CNC를 담당하는 방식이다. 여러 장비를 연결할 때는 Agent를 여러 개 실행하고, 각 Agent가 서로 다른 MachineId, CNC IP, MQTT topic을 사용한다.

다중 CNC를 한 Agent 내부에서 동시에 처리하는 구조는 현재 구현되어 있지 않다.

### 2. FOCAS thread affinity 유지

FOCAS2 DLL은 handle을 만든 thread와 이후 API 호출 thread가 달라질 때 EW_HANDLE(-8) 문제가 발생할 수 있다.

현재 구조는 `DataCollectorService`의 FOCAS 전용 루프에서 수집과 명령 처리를 모아 thread affinity를 지킨다.

금지:

```csharp
await Task.Delay(holdMs);
```

허용:

```csharp
Thread.Sleep(holdMs);
stoppingToken.WaitHandle.WaitOne(ms);
```

FOCAS thread 안에서는 `await`가 들어가는 순간 continuation이 thread pool로 이동할 수 있다고 보고 피한다.

### 3. 연결 안정화는 CNC ready 후 PMC ready

`FocasConnection.ConnectAsync()`는 연결 직후 바로 수집을 시작하지 않고 다음 순서를 둔다.

1. `cnc_statinfo` 성공 확인
2. `pmc_rdpmcrng` R6000 읽기 성공 확인

CNC 함수가 먼저 준비되고 PMC 함수가 더 늦게 준비되는 경우가 있었기 때문이다. 이 순서를 생략하면 초기 PMC 읽기 실패나 EW_HANDLE 반복 문제가 다시 생길 수 있다.

### 4. PMC bit는 별도 topic으로 빠르게 발행

PMC bit는 telemetry packet에 섞지 않는다.

현재 기준:

- telemetry: 일반 CNC 상태/좌표/속도 등, 상대적으로 느린 주기
- pmc_bits: 램프, interlock, PMC message 등 빠른 반응이 필요한 bit, 별도 MQTT topic

PMC bit를 telemetry에 넣으면 UI 램프와 interlock 표시가 telemetry 주기에 묶여 느려진다.

### 5. PMC write는 read-modify-write 금지

과거 PMC output 영역에서 `pmc_rdpmcrng` 후 bit 수정, 다시 write하는 패턴이 EW_HANDLE 문제를 만들었다.

현재 원칙:

- PMC bit write는 `WritePmcAreaValue` / `pmc_wrpmcrng` 직접 쓰기만 사용한다.
- output 영역은 읽기가 항상 안정적이라고 가정하지 않는다.
- momentary pulse는 write 1 -> `Thread.Sleep(holdMs)` -> write 0 순서로 처리한다.

## 현재 구현된 FOCAS 기능

### 연결/DLL 관리

구현 위치: `FocasConnection.cs`

현재 구현:

- `fwlibe64.dll` 사전 load
- `cnc_allclibhndl3` 명시적 P/Invoke wrapper 사용
- handle 생성/해제
- retry 기반 연결 시도
- CNC ready, PMC ready 안정화
- `EW_SOCKET`, `EW_HANDLE` 발생 시 disconnected 처리

주의:

- 모델 DLL을 임의로 미리 load하지 않는다.
- 연결 직후 바로 PMC polling을 시작하지 않는다.
- 연결 재시도 중 `Task.Delay`는 FOCAS handle을 아직 쓰는 구간이 아니므로 허용되지만, FOCAS API 호출 thread 안에서는 사용하지 않는다.

### CNC 상태/모드 읽기

구현 위치: `FocasDataReader.cs`

사용 API 예:

- `cnc_statinfo`
- `cnc_rdprgnum`
- `cnc_rdseqnum`

현재 읽는 정보:

- run 상태
- aut/mode 상태
- edit 상태
- 현재 프로그램 번호
- 현재 sequence 번호
- DNC mode 식별 값

주의:

- FOCAS 구조체 필드명은 반드시 `fwlib64.cs` 원본 정의를 확인한다.
- 과거 `ODBST` 필드명을 잘못 접근한 실수가 있었다.

### 텔레메트리 수집

구현 위치: `FocasDataReader.cs`, `DataCollectorService.cs`

현재 수집:

- 현재 프로그램/sequence
- 축 좌표
- distance to go
- feedrate
- spindle speed
- G code 일부
- 실행 중인 block/program text 일부
- CNC status

경로별 절대좌표·기계좌표·잔여 이동량은 `cnc_rdposition`으로 일괄 읽는다. 실제 축수와 소수점 자릿수를 확인하고 기존 좌표 정밀도로 정확히 표현할 수 없는 값은 기존 축별 읽기로 대체한다. Path 1에서 일괄 읽기에 성공하면 공통 텔레메트리 좌표에도 같은 값을 사용한다. 템플릿의 최대 축수는 경로별 화면 표시에 적용한다.

프로그램 번호, 시퀀스, 실행 블록 텍스트, 좌표와 CNC 상태는 매 텔레메트리에서 읽는다. `TelemetryDetailIntervalMs`를 설정하면 Path 1 상세 정보, Path 2 상세 정보, 표시용 카운터를 여러 텔레메트리에 나눠 읽는다. 상세 정보에는 모달 G코드, 축 이름, 이송·회전 속도가 포함된다. 설정하지 않으면 상세 정보도 매번 읽는다.

모달 G코드는 경로별 상세 수집 1회에 최대 두 그룹을 읽고, 20개 그룹을 확인했을 때 그리드를 갱신한다. 프로그램 번호가 바뀌거나 CNC가 재연결되면 이전 모달 데이터를 비운다. 실행 블록 읽기에 실패하면 해당 메시지의 실행 블록 텍스트를 비운다.

Agent의 `DataCollectorService`와 `FocasDataReader` 로그 수준을 `Debug`로 설정하면 경로별 좌표·상세 정보 읽기 시간, MQTT 발행 시간, PMC·알람 처리 시간과 M20·스케줄러 확인 간격을 확인할 수 있다.

주의:

- 새 수집 항목을 추가할 때 수집 루프 전체를 block할 수 있는 FOCAS API인지 먼저 확인한다.
- 느린 API를 100ms PMC 루프에 섞지 않는다.

### 알람 읽기

구현 위치: `FocasDataReader.ReadAlarms()`, `DataCollectorService`

사용 API:

- `cnc_rdalmmsg2`

현재 동작:

- 현재 CNC alarm message를 읽고 MQTT/WebSocket으로 전달한다.
- Agent는 최초 정상 읽기와 이후 10초 주기로 현재 알람 전체 스냅샷을 발행한다.
- Server는 정상 스냅샷과 DB의 미해제 알람을 대조하여 재시작 중 누락된 해제 상태를 복구한다.
- FOCAS 읽기 실패는 빈 알람 목록과 구분하며, 읽기 실패 시 DB 알람을 해제하지 않는다.
- AlarmStrip UI는 안정적인 CNC alarm 기반으로 표시한다.

주의:

- `cnc_rdopmsg3`는 FOCAS 수집 루프에 넣지 않는다.
- 과거 CNC가 `#3006` operator message 대기 상태일 때 `cnc_rdopmsg3`가 block되어 화면 갱신 전체가 멈춘 문제가 있었다.

### PMC 읽기

모니터링용 PMC 비트는 동일 영역에서 최대 5바이트씩 읽은 후 요청한 비트만 발행한다. 범위 읽기 실패 시 개별 읽기를 사용한다. `PmcMonitorIntervalMs`로 화면용 수집 간격을 지정할 수 있으며, 미설정 시 `PmcIntervalMs`를 따른다. M20 및 스케줄러 처리는 `PmcIntervalMs` 기준으로 독립적으로 실행한다. 모든 읽기는 같은 FOCAS 스레드에서 순차 처리되므로 설정값과 실측 간격은 다를 수 있다.

구현 위치: `FocasDataReader.cs`, `DataCollectorService.CollectAndPublishPmcBitsSync()`

사용 API:

- `pmc_rdpmcrng`

현재 사용처:

- top bar interlock
- panel lamp 상태
- PMC message 표시
- scheduler M20 edge 감지
- scheduler 관련 상태/출력 확인
- count display cycle time 등 일부 D 영역

주의:

- 새 PMC 주소 기반 기능을 추가하면 반드시 `CollectAndPublishPmcBitsSync()`의 수집 대상에 해당 주소 source를 추가한다.
- 주소를 템플릿에 추가해도 수집 대상에 포함하지 않으면 MQTT `pmc_bits`에 key 자체가 나오지 않는다.

현재 known source:

- interlock addresses
- panel lamp addresses
- PMC message addresses
- scheduler/count 관련 addresses

### PMC 쓰기

구현 위치: `FocasDataReader.WritePmcAreaValue()`, `CommandHandler.ExecutePmcWriteSync()`

사용 API:

- `pmc_wrpmcrng`

현재 사용처:

- 조작반 button/pulse 출력
- cycle start 등 template 기반 control output
- scheduler에서 필요한 one-cycle stop, head on/off 등 출력

주의:

- `PMC_WRITE`는 FOCAS thread에서 동기 처리한다.
- auto-release에는 `Thread.Sleep`을 사용한다.
- PMC address는 코드에 고정하지 말고 template/config에서 가져온다.

### 프로그램 목록/검색/선택

구현 위치: `FocasDataReader.ListPrograms()`, `SearchProgram()`, `SchedulerManager`

사용 API 예:

- `cnc_rdprogdir3`
- `cnc_search`
- `cnc_rewind`
- `cnc_setpath`

현재 구현:

- PATH1/PATH2 프로그램 목록 조회
- V1 목록에 없는 사용자 프로그램(O0001~O7999) 코멘트는 `cnc_upstart3`/`cnc_upload3` 헤더 조회로 보완하고 5분간 캐시
- 비축 파라미터 `3202#4(NE9)`를 `cnc_rdparam(handle, 3202, 0, 8, ...)`으로 읽어 O9000~O9999 보호 상태를 판정
- `NE9=1`이면 O9000~O9999를 목록에서 숨기지 않고 `isProtected=true`로 반환하며, 파라미터 읽기 실패도 안전상 보호 상태로 취급
- 프로그램 번호 search
- path 변경 후 작업하고 다시 path 1 복귀
- memory mode scheduler row 시작 시 search + rewind

주의:

- PATH2 작업 후 path 1 복귀를 빠뜨리지 않는다.
- V2/V3 디렉터리 API는 일부 실장비에서 블로킹되므로 코멘트 조회에 사용하지 않는다.
- HOLD/run 상태에서는 `cnc_search`/`cnc_rewind`가 EW_OK를 반환해도 실제 적용되지 않을 수 있으므로 상태 확인이 필요하다.
- O9000~O9999 보호 상태에서는 CNC 대상 `SEARCH_PROGRAM`, 업로드, 다운로드와 백업 추출을 Agent에서 최종 차단한다. PC 공용·DNC 저장소의 파일 관리는 이 파라미터의 적용 대상이 아니다.
- `3202#4` 비트 방향과 `axis=0` 읽기 성공 여부는 CNC 시리즈별 실기기에서 화면 보호 상태와 대조한다.

### 프로그램 업로드/다운로드/백업

구현 위치: `FocasDataReader.cs`, `CommandHandler.cs`

사용 API 예:

- upload to CNC: `cnc_dwnstart3`, `cnc_download3`, `cnc_dwnend3`
- download from CNC: `cnc_upstart3`, `cnc_upload3`, `cnc_upend3`
- delete: `cnc_delete`
- fallback read: `cnc_rdpdf_line`, `cnc_rdprogline`, FTP fallback

현재 구현:

- PC -> CNC 프로그램 업로드
- force overwrite 시 기존 O번호 삭제 후 업로드
- CNC -> PC 프로그램 다운로드
- 프로그램 목록 기반 backup zip 생성
- `3202#4(NE9)` 보호 또는 확인 불가 상태에서는 O9000~O9999를 업로드·다운로드·백업 대상에서 제외

주의:

- 프로그램 전송은 CNC mode, memory protect, background edit 상태에 영향을 받는다.
- `EW_MODE`, `EW_REJECT`, `EW_DATA`를 구분해서 사용자에게 의미 있는 오류로 반환한다.
- `cnc_upload3`는 `EW_BUFFER`일 때 CNC data 준비 대기가 필요하므로 짧은 `Thread.Sleep` retry를 사용한다.

### MDI write

구현 위치: `FocasDataReader.WriteMdiProgram()`, `CommandHandler.ExecuteWriteMdi()`

사용 API:

- `cnc_wrmdiprog`

현재 구현:

- MDI buffer에 program line 기록
- path 지정 가능
- EOB 처리

주의:

- MDI 실행 자체와 MDI buffer 기록은 구분한다.
- 제어권 확인은 필요하지만 일반 PMC interlock과 동일하게 볼지는 기능 성격에 따라 판단한다.

### offset/counter/tool life

구현 위치: `FocasDataReader.cs`, `CommandHandler.cs`

현재 구현:

- wear offset 읽기/쓰기
- macro/pcode 기반 counter 읽기/쓰기
- tool life 관련 변수 읽기/쓰기
- D data 영역 일부 읽기/쓰기

사용 API 예:

- `cnc_rdmacro`
- `cnc_wrmacro`
- `cnc_rdmacror2`
- `cnc_rdpmacro`
- PMC D 영역 read/write

주의:

- macro 값 변환은 `mcr_val / Math.Pow(10, dec_val)` 패턴을 확인한다.
- `mcr_dec` 같은 잘못된 필드명을 쓰지 않는다.
- IDLE 상태에서 `cnc_wrmacro`가 시스템 macro 영역 write를 무시하거나 차단할 수 있는 이슈가 있다.
- write 기능은 CNC 상태와 실제 반영 여부를 실기기에서 검증해야 한다.

### 스케줄러와 DNC 관련 현재 상태

> DNC의 상세 구현 계획, 진행 체크리스트, 실기기 검증 결과와 작업 이력은 `docs/DNC.md`에서 관리한다. 이 문서는 DNC 작업에 적용되는 FOCAS 공통 기술 기준을 제공한다.

구현 위치: `SchedulerManager.cs`, `FocasDataReader.cs`, server scheduler route

현재 구현된 것:

- scheduler row별 memory/dnc mode 구분
- DNC path payload 저장
- DNC 파일 존재 확인
- CNC가 DNC mode인지 확인
- 조건 만족 시 cycle start 흐름 수행
- memory mode에서는 `cnc_search` + `cnc_rewind` 기반 실행

아직 완성되지 않은 것:

- 서버 PC가 DNC 데이터를 실시간 line/block stream으로 CNC에 공급하는 구조
- 여러 CNC에 동시에 안정적으로 DNC stream을 공급하는 flow control
- stream 중 끊김/지연/재시도/정지 조건
- stream 위치 추적, checksum, recovery 정책

중요:

DNC 운전은 단순 파일 경로 확인이나 cycle start가 아니라, CNC가 소비하는 속도에 맞춰 데이터를 연속 공급하는 기능이다. 현재 구조는 DNC 운전을 위한 준비 흐름 일부가 있을 뿐, 완성된 실시간 DNC streaming 구조로 보면 안 된다.

## 새 FOCAS 기능 추가 전 체크리스트

작업 전 반드시 확인한다.

- [ ] 이 기능이 FOCAS API를 호출하는가?
- [ ] 호출 위치가 FOCAS 전용 thread 안인가?
- [ ] FOCAS thread 안에서 `await`, `Task.Delay`, thread 전환 가능 코드가 없는가?
- [ ] API가 CNC 대기 상태에서 block될 가능성이 있는가?
- [ ] polling 루프에 넣어도 100ms PMC 갱신을 막지 않는가?
- [ ] 새 PMC 주소가 있다면 template/config로 분리했는가?
- [ ] 새 PMC 주소 source를 `CollectAndPublishPmcBitsSync()` 수집 대상에 추가했는가?
- [ ] `pmcBits`를 telemetry에 섞지 않았는가?
- [ ] PMC write에 read-modify-write를 쓰지 않았는가?
- [ ] PATH2 작업 후 path 1 복귀가 필요한가?
- [ ] `EW_MODE`, `EW_REJECT`, `EW_DATA`, `EW_HANDLE`, `EW_SOCKET` 오류를 구분해서 처리하는가?
- [ ] CNC mode, run state, edit state, memory protect 영향을 검토했는가?
- [ ] 실제 장비에서 IDLE/RUN/HOLD/ALARM 상태별 동작을 검증해야 하는가?

## 절대 반복하지 말아야 할 실수

### FOCAS thread에서 await 사용

문제:

- continuation이 다른 thread로 이동
- FOCAS handle이 wrong thread에서 사용됨
- EW_HANDLE(-8), auto-release 실패, 모니터링 정지 가능

대응:

- FOCAS API 호출 구간은 동기 처리
- 대기는 `Thread.Sleep` 또는 `WaitHandle.WaitOne`

### PMC bit를 telemetry에 포함

문제:

- PMC 100ms 설정이 의미 없어짐
- UI 램프/interlock 반응이 telemetry 주기로 느려짐

대응:

- `pmc_bits` topic 별도 유지
- frontend는 `pmc_update`로만 pmcBits 갱신

### `cnc_rdopmsg3`를 수집 루프에 추가

문제:

- CNC operator message 대기 상태에서 FOCAS thread block
- 전체 화면 갱신 정지

대응:

- 수집 루프에서 사용 금지
- alarm UI는 `cnc_rdalmmsg2` 기반 유지

### 새 PMC 기능 추가 후 수집 대상 누락

문제:

- template에 주소가 있어도 MQTT에 key가 나오지 않음
- UI에는 항상 OFF/미표시처럼 보임

대응:

- `CollectAndPublishPmcBitsSync()`의 unique address 구성에 새 source를 추가

### FOCAS 구조체 필드 추측

문제:

- compile/runtime 오류 또는 잘못된 상태 표시

대응:

- `fwlib64.cs` 원본 선언 확인
- FANUC 문서 기준 구조체/필드명 사용

## 관련 문서

- `BRIEFING.md`: 전체 프로젝트 방향과 현재 개발 항목
- `KNOWN_MISTAKES.md`: 과거 실수 목록과 체크리스트
- `docs/Scheduler.md`: 스케줄러 기능 상세
- `docs/scheduler-state-machine.md`: 스케줄러 상태 머신 상세
- `docs/MachineAdmin.md`: 설비 관리 상세
