# FANUC FOCAS Reference

이 문서는 Star-WebCNC에서 현재 구현된 FANUC FOCAS 기능과, 이후 Codex/Claude Code가 FOCAS 관련 기능을 구현할 때 반드시 지켜야 할 주의사항을 정리한 참고 문서다.

목표는 두 가지다.

- 기존에 구현한 FOCAS 기능의 위치와 역할을 빠르게 파악한다.
- 이미 겪었던 EW_HANDLE, PMC 지연, blocking API, DNC 오해 같은 실수를 반복하지 않는다.

## 현재 구현 구조

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

### 1. 1 Agent = 1 CNC

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

주의:

- 새 수집 항목을 추가할 때 수집 루프 전체를 block할 수 있는 FOCAS API인지 먼저 확인한다.
- 느린 API를 100ms PMC 루프에 섞지 않는다.

### 알람 읽기

구현 위치: `FocasDataReader.ReadAlarms()`, `DataCollectorService`

사용 API:

- `cnc_rdalmmsg2`

현재 동작:

- 현재 CNC alarm message를 읽고 MQTT/WebSocket으로 전달한다.
- AlarmStrip UI는 안정적인 CNC alarm 기반으로 표시한다.

주의:

- `cnc_rdopmsg3`는 FOCAS 수집 루프에 넣지 않는다.
- 과거 CNC가 `#3006` operator message 대기 상태일 때 `cnc_rdopmsg3`가 block되어 화면 갱신 전체가 멈춘 문제가 있었다.

### PMC 읽기

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
- 프로그램 번호 search
- path 변경 후 작업하고 다시 path 1 복귀
- memory mode scheduler row 시작 시 search + rewind

주의:

- PATH2 작업 후 path 1 복귀를 빠뜨리지 않는다.
- HOLD/run 상태에서는 `cnc_search`/`cnc_rewind`가 EW_OK를 반환해도 실제 적용되지 않을 수 있으므로 상태 확인이 필요하다.

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
