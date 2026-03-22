# KNOWN_MISTAKES.md
# 이전 작업에서 발생한 실수 및 재발 방지 규칙

> 코드 작업 전 반드시 이 목록을 확인하고, 동일 패턴 사용 전에 여기서 검색할 것.

---

## [M-01] FOCAS thread에서 `await Task.Delay()` 사용

**증상**: PMC 쓰기 후 auto-release(value=0) 실패, 모니터링 멈춤, EW_HANDLE(-8)
**원인**: `async` 메서드 내 `await Task.Delay(holdMs)` → continuation이 thread pool 스레드로 이동 → FOCAS API가 wrong thread에서 호출됨
**재발 방지**:
- FOCAS thread 내부에서는 `Thread.Sleep(ms)` 또는 `stoppingToken.WaitHandle.WaitOne(ms)` 만 사용
- `ExecutePmcWriteAsync`처럼 보여도 내부는 `Task.FromResult(ExecutePmcWriteSync(...))` 패턴 사용
- `await`가 들어가는 순간 thread affinity 깨진다고 간주

---

## [M-02] Newtonsoft.Json이 Dictionary 키를 소문자로 변환

**증상**: 프론트엔드에서 `"R6001.3" in pmcBits` → false, 모든 램프 꺼짐
**원인**: `CamelCasePropertyNamesContractResolver`가 C# 속성명뿐 아니라 Dictionary 키(`"R6001.3"`)도 camelCase(`"r6001.3"`)로 변환
**재발 방지**:
- `MqttService.cs`의 JsonSerializerSettings에 `CamelCasePropertyNamesContractResolver` 단독 사용 금지
- 반드시 `DefaultContractResolver { NamingStrategy = CamelCaseNamingStrategy { ProcessDictionaryKeys = false } }` 사용
- Dictionary를 JSON으로 직렬화할 때마다 이 규칙 확인

---

## [M-03] PMC WritePmcBit에서 read-modify-write 패턴 사용

**증상**: `pmc_rdpmcrng` 호출 시 EW_HANDLE(-8), PMC 쓰기 전체 실패
**원인**: R6100~R6109 OUTPUT 영역은 PC→CNC 전용이라 read가 안정적으로 동작하지 않음
**재발 방지**:
- PMC 비트 쓰기는 항상 `WritePmcAreaValue`(pmc_wrpmcrng) 직접 쓰기만 사용
- `1 << addr.Bit`로 해당 비트만 세팅하는 방식은 OUTPUT 영역에서 안전
- read 후 write 패턴이 필요한 경우 별도 검토 필요

---

## [M-04] FOCAS 연결 안정화에서 PMC 준비를 CNC와 동시에 체크

**증상**: 초기 PMC 읽기 실패, 안정화 직후 EW_HANDLE(-8)
**원인**: `cnc_statinfo`(CNC) 성공 후에도 `pmc_rdpmcrng`(PMC)는 아직 미준비 상태일 수 있음
**재발 방지**:
- 반드시 2단계 안정화: ① CNC ready (`cnc_statinfo` 성공) → ② PMC ready (`pmc_rdpmcrng` R6000 성공)
- 단계 생략 또는 순서 바꾸기 금지

---

## [M-05] Vite proxy를 통한 WebSocket 연결

**증상**: 초기 로드(REST API 데이터)는 표시되나 실시간 업데이트 없음
**원인**: Vite의 `proxy: { '/ws': { ws: true } }` 설정이 서버→브라우저 방향 메시지를 신뢰성 있게 전달하지 못함
**재발 방지**:
- `wsClient.ts`에서 `window.location.host` 기반 연결 금지
- 항상 `import.meta.env.VITE_API_URL || 'http://localhost:3000'`에서 추출한 주소에 직접 연결
- `apiBase.replace(/^http/, 'ws')` 패턴으로 WS URL 생성

---

## [M-06] `_wsHandlersRegistered` 플래그로 WS 핸들러 단일 등록

**증상**: Vite HMR 후 WS 메시지는 수신되나 React 상태 업데이트 안 됨, 구독 미등록 커넥션 누적
**원인**: Vite HMR이 `machineStore.ts`를 재평가하면 새 store 인스턴스 생성. 그러나 `_wsHandlersRegistered = true`라 핸들러 재등록 안 됨 → 구 wsClient 핸들러가 구 store를 업데이트 → 신규 React 컴포넌트는 새 store 구독 중
**재발 방지**:
- `_wsHandlersRegistered` 플래그 패턴 사용 금지
- `_wsCleanups: Array<() => void>` 배열 사용: `initWebSocket` 재호출 시 먼저 cleanup 실행 후 재등록
- `wsClient.ts`에서 `globalThis.__wsClientInstance`로 이전 인스턴스 disconnect 처리

---

## [M-07] seed.ts reseed 시 UI 수정 템플릿 데이터 덮어쓰기

**증상**: 템플릿 에디터에서 수정한 데이터가 서버 재시작(reseed) 후 초기화
**원인**: `prisma.template.upsert`의 `update: templateData`가 기존 DB 데이터를 덮어씀
**재발 방지**:
- seed.ts의 모든 upsert는 `update: {}` 사용 (이미 존재하면 건드리지 않음)
- 최초 생성만 seed 역할, 이후 수정은 UI/API를 통해서만

---

## [M-08] PMC 안정화 전에 모니터링 시작

**증상**: 초기 PMC 읽기 실패 후 장시간 EW_HANDLE 에러 반복
**원인**: FOCAS DLL 내부 모델 DLL(`FWLIB64.dll`)이 비동기 로드, PMC 함수는 더 늦게 준비됨
**재발 방지**:
- 2단계 안정화 완료 전까지 데이터 수집 루프 진입 금지
- PMC ready 타임아웃(10s) 초과 시 경고 후 진행은 허용하되 초기 에러는 정상으로 간주

---

## [M-09] `CommandMessage.Parameters` 잘못된 필드명 사용

**증상**: TypeScript 빌드 에러 `Property 'Parameters' does not exist`
**원인**: `CommandMessage`의 파라미터 필드명은 `Params` (not `Parameters`)
**재발 방지**:
- 명령 파라미터 접근 시 항상 `command.Params` 사용
- C# 모델 변경 시 반드시 `CommandMessage` 클래스 정의 확인

---

## [M-10] 롱프레스 완료 후 오버레이 원 미제거

**증상**: 롱프레스 완료 후 파란 원이 화면에 남음
**원인**: `useLongPress`의 `onComplete` 콜백에서 `onExecute`만 호출하고 `onPressEnd` 미호출 → `activePressId` 상태가 null로 초기화되지 않음
**재발 방지**:
- `onComplete: () => { onPressEnd(); onExecute(panelKey); }` 순서 유지
- `onPressEnd` 호출 없이 상태 변경 금지

---

## [M-11] `ODBST.hdck` 필드 잘못된 접근

**증상**: FOCAS 런타임 에러 또는 잘못된 상태값
**원인**: `cnc_statinfo` 반환 구조체에서 필드명 오타 (`hdck` → `0`)
**재발 방지**:
- FOCAS ODBST 구조체 필드 접근 시 반드시 `fwlib64.cs` 원본 정의 확인
- `cnc_statinfo` 후 `s.run`, `s.aut`, `s.edit` 등 실제 필드명 사용

---

## [M-12] ODBALMMSG2를 배열로 선언

**증상**: FOCAS `cnc_rdalminfo` 읽기 실패
**원인**: `ODBALMMSG2`는 배열이 아닌 단일 구조체로 사용해야 함
**재발 방지**:
- FOCAS 구조체는 FANUC 공식 문서 기준 선언 방식 그대로 사용
- `new ODBM[N]` 패턴 전에 해당 구조체가 단일/배열 중 어느 형태인지 확인

---

## [M-13] `ODBM.mcr_dec` 잘못된 필드명

**증상**: 매크로 변수 읽기 값 오류
**원인**: `cnc_rdmacro` 반환값의 소수점 필드는 `mcr_dec`이 아니라 `dec_val`
**재발 방지**:
- FOCAS 매크로 변수 읽기 후 값 변환: `data.mcr_val / Math.Pow(10, data.dec_val)` 패턴 확인

---

## [M-14] `role: 'AS_ENGINEER'` 사용

**증상**: 권한 체크 실패, 기능 접근 불가
**원인**: 역할 이름이 `AS_ENGINEER`에서 `HQ_ENGINEER`로 변경됨
**재발 방지**:
- 역할 체크는 항상 `'HQ_ENGINEER'` 사용
- `prisma/schema.prisma`의 `UserRole` enum 값 기준

---

## [M-15] wsClient.ts `_connect()`에서 stale closure로 새 WebSocket 참조 소실

**증상**: React StrictMode(개발 환경) 또는 useEffect cleanup+재실행 직후 실시간 WS 업데이트 완전 중단, F5 새로고침 후에만 화면 갱신됨
**원인**:
- StrictMode 이중 마운트: WS1 생성 → cleanup(`disconnect()`) → WS2 생성 → `this.ws = WS2`
- 이후 WS1의 `onclose`가 비동기로 발화 → 기존 핸들러 `this.ws = null` → WS2 참조 덮어씀
- WS2의 `onopen`에서 `wsClient.subscribe()` 호출 시 `this.ws === null` → 구독 메시지 미전송
- 서버가 해당 클라이언트를 구독자로 인식하지 못함 → 텔레메트리 브로드캐스트 안 함 → UI 갱신 없음
**재발 방지**:
- `_connect()` 내에서 `const ws = new WebSocket(url); this.ws = ws;` 로컬 변수 사용 필수
- `ws.onopen`, `ws.onmessage`, `ws.onclose` 핸들러 첫 줄에 반드시 `if (this.ws !== ws) return;` 체크
- `ws.onclose`는 `if (this.ws === ws) { this.ws = null; ... }` 블록 안에서만 null 설정
- `this.ws.onopen = ...` 패턴(this.ws를 직접 키로 사용) 금지

---

## [M-16] App.tsx WsConnector `useEffect` deps에 store 액션 함수 미포함

**증상**: Vite HMR로 `machineStore.ts`가 재평가된 후 새 store가 생성되지만 `initWebSocket`이 재호출되지 않아 실시간 업데이트 중단
**원인**: `useEffect([isAuthenticated, accessToken])` deps만 있으면 machineStore HMR 후 새 함수 참조가 생겨도 effect가 재실행되지 않음 → 새 store에 WS 핸들러 미등록
**재발 방지**:
- `WsConnector`의 두 번째 `useEffect` deps는 반드시 `[isAuthenticated, accessToken, initWebSocket, destroyWebSocket, fetchMachines]`
- `// eslint-disable-next-line react-hooks/exhaustive-deps` 주석으로 이 deps를 건너뛰는 코드 작성 금지
- Zustand 액션 함수는 같은 store 인스턴스 내에서 안정적(stable)이므로 추가해도 불필요한 재실행 없음

---

## [M-17] DataCollectorService 루프 슬립이 가장 긴 주기로 설정되어 빠른 주기 설정이 무효화됨

**증상**: `PmcIntervalMs = 100` 설정에도 PMC 비트(램프)가 1000ms 주기로만 갱신됨. M20 엣지 감지도 실제로는 1000ms 주기로 동작.
**원인**: 루프 끝에 `WaitOne(telemetryIntervalMs = 1000)` 슬립을 두면, 루프 자체가 1000ms마다 한 번 실행됨. 내부의 `if (now - lastPmc >= 100ms)` 체크는 루프가 1000ms마다 도는 이상 항상 참이 되어 의미 없음.
**재발 방지**:
- 루프 슬립은 반드시 **가장 짧은 주기(min interval)** 로 설정: `WaitOne(pmcIntervalMs)`
- 각 작업은 `if (now - lastXxx >= xxxInterval)` 패턴으로 독립 주기 관리
- 새 수집 항목 추가 시: 루프 슬립보다 긴 주기만 사용 가능. 더 짧은 주기가 필요하면 루프 슬립도 함께 줄일 것

---

## [M-18] PMC 비트를 텔레메트리 패킷에 포함하면 램프 응답이 느림

**증상**: `PmcIntervalMs = 100`으로 설정해도 패널 램프가 1초 이상 지연됨
**원인**: pmcBits를 `TelemetryData`에 포함시켜 1000ms 주기 `telemetry` MQTT 토픽으로 발행하면, PMC 주기를 아무리 빠르게 설정해도 무의미함. 1000ms 텔레메트리 패킷과 함께 묶여 전달됨.
**재발 방지**:
- pmcBits(램프/인터락)는 반드시 별도 `pmc_bits` MQTT 토픽으로 발행 (`PmcIntervalMs = 100ms`)
- `TelemetryData.PmcBits` 필드는 비워두고 telemetry 패킷에 포함하지 말 것
- 프론트엔드에서는 `pmc_update` WS 메시지 → `updatePmcBits()` 로만 pmcBits 갱신
- `updateTelemetry()` 호출로 pmcBits를 갱신하는 코드 작성 금지

---

## [M-19] `cnc_rdopmsg3` FOCAS 루프 호출 → 화면 전체 동결

**증상**: 오퍼레이터 메시지가 화면에 표시된 직후 화면 갱신 완전 중단 (PMC 램프, 좌표, 상태 모두 멈춤)
**원인**: `cnc_rdopmsg3`를 FOCAS 전용 스레드에서 호출 시 CNC가 #3006 매크로 오퍼레이터 대기 상태가 되면 FANUC DLL 내부에서 블록킹 발생 → FOCAS 스레드 전체 정지 → PMC 100ms 루프, 텔레메트리 1000ms 루프 모두 중단. 5000ms 게이트로 호출 빈도를 줄여도 한 번 블록되면 수십 초~무한 대기가 발생하여 동일 증상 재현.
**재발 방지**:
- `cnc_rdopmsg3`는 FOCAS 수집 루프에서 **완전히 제거** (주기를 줄여도 해결 안 됨)
- 오퍼레이터 메시지(`#3006`)는 CNC 화면에서 직접 확인
- AlarmStrip UI는 `cnc_rdalmmsg2` 기반 CNC 알람만 표시 (이미 안정적으로 동작)
- 새 FOCAS API 추가 시 "CNC 대기 상태에서 블록킹되는지" 반드시 FANUC 매뉴얼 확인 후 적용

---

## [M-20] PMC 메시지 주소가 pmcBits 수집 대상에 누락

**증상**: 템플릿 PMC 메시지 등록 후 AlarmStrip에 메시지가 표시되지 않음. MQTT `pmc_bits` 패킷에 해당 주소 키 자체가 없음.
**원인**: `CollectAndPublishPmcBitsSync()`가 수집 대상 주소를 TopBarInterlock + PanelLampAddrs만으로 구성. `PmcMessages[*].PmcAddr`은 포함하지 않아 폴링 자체가 안 됨.
**재발 방지**:
- 새로운 PMC 주소 기반 기능 추가 시, `CollectAndPublishPmcBitsSync()`의 `uniqueAddrs` 구성에 해당 주소 소스도 `Concat` 해야 함
- 현재 3개 소스: `interlockAddrs` + `PanelLampAddrs` + `pmcMessageAddrs`
- 새 소스 추가 시 위 목록에 반드시 포함

---

## [M-21] 템플릿에 새 JSON 컬럼 추가 시 Prisma 스키마/시드/에이전트 모두 처리 필요

**증상**: 새 템플릿 필드(`pmcMessages`)가 프론트엔드/에이전트에서 항상 빈 값 또는 기본값으로만 나옴. MQTT에 해당 주소가 폴링되지 않음.
**원인**: 다음 4단계 중 하나라도 누락되면 전체가 안 됨:
1. Prisma `schema.prisma`에 컬럼 미추가 → DB에 컬럼 없음 → `prisma db push` 필요
2. `npx prisma generate` 미실행 → Prisma Client가 새 필드 모름 → 서버 재빌드 필요
3. `seed.ts`의 `update: {}` 정책으로 기존 레코드에 새 필드 미적용 → DB에 직접 업데이트 필요
4. Agent가 이전 템플릿 캐시 유지 → 에이전트 재시작으로 템플릿 리로드 필요
**재발 방지**:
- 템플릿에 새 JSON 컬럼 추가 시 반드시 4단계 체크:
  - `schema.prisma` 컬럼 추가 → `npx prisma db push --skip-generate`
  - 서버 프로세스 중지 → `npx prisma generate` → 서버 재빌드(`npx tsc`) → 재시작
  - 기존 DB 레코드 업데이트 (`node -e "prisma.template.updateMany(...)"`)
  - 에이전트 재시작 (새 템플릿 로드)

---

## 체크리스트 (코드 작업 전)

- [ ] FOCAS thread 내에서 `await` 사용 여부 확인
- [ ] Newtonsoft.Json Dictionary 직렬화 시 `ProcessDictionaryKeys = false` 확인
- [ ] PMC 쓰기 시 read-modify-write 없는지 확인
- [ ] WS 연결 URL이 직접 연결(`localhost:3000`)인지 확인
- [ ] seed.ts upsert가 `update: {}` 인지 확인
- [ ] 롱프레스 `onComplete`에 `onPressEnd()` 포함 여부 확인
- [ ] `CommandMessage.Params` (not `Parameters`) 사용 확인
- [ ] 역할 체크가 `HQ_ENGINEER` 사용하는지 확인
- [ ] wsClient `_connect()`에서 로컬 `const ws` 사용 + `if (this.ws !== ws) return` 체크 확인
- [ ] WsConnector `useEffect` deps에 `initWebSocket`, `destroyWebSocket`, `fetchMachines` 포함 확인
- [ ] Agent 루프 슬립이 가장 짧은 주기(`pmcIntervalMs`)인지 확인
- [ ] pmcBits가 `pmc_bits` 토픽으로 별도 발행되는지 확인 (telemetry 패킷 미포함)
- [ ] 새 FOCAS API 추가 시 CNC 대기 상태에서 블록킹 여부 FANUC 매뉴얼 확인 (`cnc_rdopmsg3` 같은 함수 금지)
- [ ] PMC 주소 기반 기능 추가 시 `CollectAndPublishPmcBitsSync()`의 uniqueAddrs에 해당 소스 Concat 여부 확인
- [ ] 템플릿에 새 JSON 컬럼 추가 시: schema.prisma → db push → 서버중지 → prisma generate → tsc → 서버재시작 → 기존 DB 레코드 업데이트 → agent 재시작 순서 확인
