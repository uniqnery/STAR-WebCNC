# DNC 모드 구현 계획 및 작업 원장

## POP 카운터 기반 전환 (2026-11-25, 구현·배포 및 실카운터 증가 확인)

- 사용자 승인: 스케줄러 제어는 유지하고 POP는 템플릿 카운터 증가량으로 전환한다. 원본·추정·수정/초기화·보정과 상태 시간 구간을 분리한다. 실제 가동/알람 원천은 현재 상단 표시와 같은 FOCAS 상태이며 초록 우선이다.
- Agent 원자적 기준값/미전송 journal, 수동 수정 쓰기 전 의도 기록, 서버 원본/실적 동시 트랜잭션과 ID 중복 차단, 30초 초과 미관측 시간 확인 불가, MES 경계 변화 수량 보류를 구현했다. 최초 카운터 값은 기준만 설정하고, 양의 변화는 자동/단절 추정/항목 불명으로 구분한다. 감소·0 초기화는 기존 누적 수량을 차감하지 않는다. 웹앱 수정은 감사 correlation ID로 연결하며 ADMIN/HQ 수동 보정은 원본을 유지한 별도 ± 실적과 감사 이력이다. 추정/보정은 작업지시에 자동 반영하지 않는다.
- 변경 파일: Agent `Collectors/CounterJournal.cs`, `DataCollectorService.cs`, `SchedulerManager.cs`(조회용 메타데이터만), `Commands/CommandHandler.cs`, `Mqtt/MqttService.cs`, `Program.cs`; Server `lib/{counterTracking,counterReporting,productionTracking,mqtt}.ts`, `routes/production.ts`, `index.ts`, Prisma schema와 `20261125020000_counter_production`; Web `pages/POP.tsx`, `lib/{api,popData}.ts`; 검증 `tests/StarWebCNC.Agent.Checks`, `packages/server/tests/{counterTracking,permissions,popData}.test.ts`, `tools/verify-pop.cjs`.
- 검증: Server 155개·Agent 51개·격리 PostgreSQL/HTTP API 57개 통과. 동시 이벤트/보정 중복, USER 보정 차단, 원본 보존·감사 1회 기록, 0→1 정상 집계, 감소·읽기 실패·재시작 추정·메인 항목 경계 보류·서브 호출 무시·초록+빨강 초록 우선·상태 시간 합계를 확인했다. DB 세션 시간대에 따른 raw SQL 비교 오류를 찾아 UTC timestamp 경계로 명시했고 상태 시간과 일/주/월 차트 일치를 확인했다. Server/Web/Agent build 성공. 시험 생산·보정은 격리 스키마에만 넣고 시험 스키마는 종료 시 제거했다.
- 배포: DB 백업 `agent-runtime/startup/rollback-counter-20261125-184603/database.dump` 후 추가 SQL 1건과 migrate resolve 적용. API 및 4대 Agent를 18:59~19:00 KST에 재기동하고 shared/MC-002 publish DLL 해시 `22AFBEACE62FACE169B667F2CB3B1F5D5C9F5622E9E3510EB3FC9C620E1ADFB4`, 기존 appsettings 해시 동일 확인. DLL 복구본은 `agent-runtime/startup/rollback-pop-agent-20261125-185941/agent-{0,1}.dll`. DB 복원은 실행 검증하지 않았다. 카운터 journal은 복구 시에도 삭제하지 않는다.
- 실기기: 19:00:10 KST O4592, #900=902, 프리셋 P10000=2000을 초기 기준으로 저장했고, 19:00:43 KST 902→903 증가에서 실적 1개가 자동 기록됐다. DB ACK 후 pending=0, 일/주/월 totalParts=1 및 차트 합계=1, 가동 구간 19:00:10 이후 누적을 확인했다. 실제 원본 코멘트가 읽히지 않아 O4592/생산 항목 미지정으로 남겼으며 다른 제품명으로 추정하지 않았다. 브라우저 로그인 화면까지 접근했으나 별도 로그인 세션이 없어 실제 로그인 후 PC/모바일 시각 검증은 남았다. API 일/주/월 조회 200과 브라우저 미접속 수집은 확인했다.
- 제한/다음 확인: 실제 CNC 카운터·프리셋을 시험용으로 변경하거나 설비 출력/알람을 발생시키지 않았다. 실기기 초기화·웹앱 수정·알람 전환은 미실행이며 격리 검사로 확인한 범위다. 통신 단절 중 초기화 후 증가 또는 여러 제품 가공은 최종 값만으로 복원 불가하다. 추정 수량은 재관측 시점에 배정하므로 단절 중 일자/작업 경계의 정확한 분배는 보정이 필요하다. 장기 단절 시 미전송 journal 크기가 증가하므로 향후 운영량/보관 정책을 검토한다. 스케줄러 M20 카운트 권한·자체 카운터 OFF 절차는 그대로다.
- 19:07 KST 최종 보완판 재배포: 서버 장애 시 FALLBACK_TEMPLATE 기본 변수로 POP를 집계하지 않고 이전 정상 기준값을 보존하도록 보완했으며 Agent 51개 검사에 포함했다. 최종 DLL 해시 `1ACADC6C871C75831EFE8B65072F0470D863E8096695433299B8D8B42429381D`, 교체 직전 백업 `agent-runtime/startup/rollback-pop-agent-20261125-190735/agent-{0,1}.dll`. 앞선 18:59 백업은 카운터 전환 전 복구 기준이며, 19:07 백업은 카운터 초판이다. 생성한 runtime journal과 기존 DB 이력은 재기동 중 보존했다.
- 19:08 KST 최종 확인: 실제 카운터 902→906에 총 4개(자동 4·추정 0·보정 0), 일/주/월 차트 합계 4, journal pending=0, 기준값 906과 4대 ready를 확인했다. 최종 재기동에서도 과거 4개를 다시 집계하지 않았고 19:07:34~19:08:02 수집 중단 구간은 대기/가동 대신 확인 불가로 분리됐다. 최종 격리 DB/API 검사는 사용자 감사 연결 및 120초 관측 공백에서 가동 30초·확인 불가 90초·이후 대기 10초 분리까지 포함해 57개 통과했다.

## POP-M20 연계 (2026-11-25, 구현·배포 완료 / 실제 완료 신호 검증 대기)

- 스케줄러의 유효 M20만 POP 완료 이벤트로 영속 기록한다. 첫 M20 및 Path2Only 완료 제외 규칙과 기존 제어 카운트는 유지한다.
- 생산 코멘트·원본 프로그램·실행 행을 이벤트에 스냅샷으로 남기며 파일전송/DNC 운전 방식은 변경하지 않는다. 일반 운전도 동일한 M20 엣지로 집계한다. 재접속 첫 ON은 기준 상태로만 읽는다.
- 변경 파일: Agent `Collectors/{DataCollectorService,SchedulerManager,ProductionOutbox,M20EdgeDetector,M20CompletionRules}.cs`, `Focas/FocasDataReader.cs`, `Mqtt/MqttService.cs`, `Program.cs`; Server `lib/{productionTracking,mqtt}.ts`, `routes/{production,scheduler,workOrder}.ts`, `index.ts`, Prisma schema 및 `20261125000000_add_m20_production`, `20261125010000_index_production_completion`; Web `pages/{POP,Scheduler,WorkOrder,Settings}.tsx`, `components/Layout.tsx`, `stores/{featureStore,machineStore}.ts`, `lib/api.ts`, `App.tsx`; 검증 `tests/StarWebCNC.Agent.Checks`, `packages/server/tests`, `tools/verify-pop.cjs`.
- 서버 126개, Agent 35개, 분리 PostgreSQL 25개 검증 통과. 동시 중복 이벤트 1회 저장/작업지시 1회 증가, 재전송, 코멘트 우선순위·스냅샷, MES 시점별 연결·프로그램 불일치, 시작/재접속 ON 및 첫 M20/Path2Only 제외를 확인했다. 테스트는 CNC 쓰기 및 운영 생산 이력 생성 없이 수행했다. Server/Web build와 Agent Release build 성공, 운영 POP 일·주·월 조회 200 및 MES OFF 작업지시 API 403 확인.
- 2026-11-25 10:07 KST API 및 4대 Agent에 적용. shared publish와 MC-002 전용 publish의 DLL을 교체했고 appsettings 해시가 동일함을 확인했다. 배포 전 스케줄 실행 행 및 최근 2분 대기 명령은 없었다. DB는 기존 이력 보존 추가 SQL 2건만 적용하고 각각 migration resolve 했으며 이전 미추적 migration은 실행하지 않았다.
- 복구 자료: `agent-runtime/startup/rollback-pop-2026-11-25T00-44-14-683Z/database.dump` 및 `agent-runtime/startup/rollback-pop-agent-20261125-100657/agent-{0,1}.dll`. DB 복원 실행은 검증하지 않았다. 이전 DLL 복귀 시 새 DB 컬럼은 유지 가능하며 이벤트 journal을 삭제하지 않는다.
- 남은 검증: 실제 설비의 자연 M20 완료 → journal → DB 저장/ACK, 스케줄러 실운전 및 모바일/PC 화면 확인. 전원 OFF 중 신호·100ms 폴링 사이 짧은 M20 누락은 보완할 수 없으며 래치+ACK는 별도 승인 후 검토한다. 과거 CNC 카운터 값은 소급 실적으로 만들지 않는다.
- 실기기 관찰 결과: 배포 후 55초씩 2회 MC-002 텔레메트리 197/198건을 수신했고 O4592·runState=3, 표시 카운터 673→674를 확인했다. 같은 관찰에서 M20/event/production/ACK는 없고 새 생산 이력도 0건이었다. 현재 적용 템플릿의 `schedulerConfig.m20Addr=R6020.0`과 `pmcMap.scheduler.m20Complete=R6002.4`가 다르다. 어느 주소가 실완료 신호인지, 실제 신호 폭 및 일반 운전에서 출력되는지 확인해야 한다. 주소를 추정해 바꾸거나 카운터 증가를 M20으로 대체하지 않았다. 따라서 소프트웨어 적용은 완료했으나 실생산 집계 성공은 아직 확인하지 못했다.
- 같은 날 POP 화면 `products.length` 오류 수정: 서버 교체 중 이전 형식 응답에 없는 목록을 직접 렌더링하던 문제였다. `packages/web/src/lib/popData.ts`에서 목록·수량 응답을 검사한 뒤 `pages/POP.tsx`의 상태를 교체한다. 누락 응답이면 안내와 마지막 정상 결과를 유지하고 기존 5초 자동 조회를 지속하며 정상 응답에서 안내를 지운다. MES 작업지시 목록도 배열을 확인한다. `packages/server/tests/popData.test.ts` 12개 통과, Web build 성공, 실행 중 Vite에서 수정 모듈 200 응답 확인. CNC/집계 로직 변경 없음. 이미 오류 경계가 표시된 탭은 한 번 새로고침해야 한다.

> 최초 작성: 2026-08-30
> 대상 설비: Star SB-20R2·SR-20J2B / FANUC 32i-B 포함
> 전체 상태: **FOCAS DNC 스트리밍 보류 / MEM 파일전송 방식으로 방향 전환**
> 현재 단계: 기존 구현·검증 이력 보존, 신규 운영 설계는 `docs/Scheduler.md` 기준

---

## 1. 문서 목적

이 문서는 Star-WebCNC의 DNC 실시간 스트리밍 구현에 대한 계획, 결정사항, 진행 상태, 검증 결과를 지속해서 관리하는 작업 원장이다. 2026-09-28 결정에 따라 DNC 스트리밍은 운영 적용을 보류하고 MEM 기반 파일전송 방식으로 전환했으며, 이 문서의 기존 DNC 내용은 과거 구현과 실기기 조사 기록으로 보존한다.

DNC 관련 작업은 시작 전에 이 문서를 확인하고, 작업 중 상태가 바뀌면 같은 작업 안에서 이 문서를 갱신한다. 코드만 변경하고 이 문서를 갱신하지 않은 작업은 완료로 보지 않는다.

문서별 역할은 다음과 같이 구분한다.

| 문서 | 역할 |
|------|------|
| `BRIEFING.md` | 프로젝트 전체 방향, 상위 백로그와 최근 결정사항 |
| `FOCAS_REFERENCE.md` | FOCAS API, 스레드 친화성, 오류 처리 등 공통 기술 기준 |
| `docs/DNC.md` | DNC 구현 계획, 진행 체크리스트, 실기기 결과, 작업 이력 |
| `docs/Scheduler.md` | 현재 스케줄러 기능과 실기기 확정 동작 |
| `docs/scheduler-state-machine.md` | 스케줄러 상태 전이 상세 설계 |

---

## 2. DNC 작업 운영 규칙

### 2.1 작업 시작 전

- [ ] `BRIEFING.md`의 현재 개발 방향, 최근 결정사항, 진행 중인 개발 항목을 확인한다.
- [ ] `FOCAS_REFERENCE.md`의 FOCAS 스레드, 연결, 프로그램 전송, DNC 관련 기준을 확인한다.
- [ ] 이 문서의 현재 단계, 차단 항목, 최근 작업 이력을 확인한다.
- [ ] 수행할 작업 ID를 `진행 중`으로 변경하고 작업 이력에 시작 내용을 기록한다.
- [ ] 실기기 동작에 영향을 주면 테스트 조건과 안전 조치를 먼저 적는다.

### 2.2 작업 완료 전

- [ ] 변경한 파일과 핵심 변경 내용을 작업 이력에 기록한다.
- [ ] 실행한 빌드·검증 명령과 결과를 기록한다.
- [ ] 실기기 검증 여부를 `미실행`, `실패`, `통과` 중 하나로 명시한다.
- [ ] 완료 근거가 있는 체크 항목만 `[x]`로 변경한다.
- [ ] 남은 문제와 다음 작업 ID를 기록한다.
- [ ] 전체 방향이나 결정사항이 바뀌면 `BRIEFING.md`도 갱신한다.
- [ ] FOCAS 공통 주의사항을 새로 확인했으면 `FOCAS_REFERENCE.md`도 갱신한다.

### 2.3 상태 기준

| 상태 | 기준 |
|------|------|
| 예정 | 아직 작업을 시작하지 않음 |
| 진행 중 | 코드·조사·실기기 확인 중이며 완료 근거가 부족함 |
| 차단 | 외부 정보, 장비 조건 또는 사용자 결정이 없으면 진행할 수 없음 |
| 구현 완료·테스트 대기 | 코드와 빌드는 완료했으나 실기기 검증 전 |
| 완료 | 코드, 빌드, 요구된 실기기 검증과 문서 갱신까지 완료 |

---

## 3. 현재 구현 상태

현재 구현은 DNC 스트리밍 완료 상태가 아니며 운영 적용을 보류했다.

### 2026-09-28 방향 전환 결정

상태: **핵심 코드·빌드 완료 / 화면·실기기 검증 대기**

- MC-002의 Embedded Ethernet 환경에서 `cnc_dncstart2` 기반 실행은 `EW_REJECT(13)`과 CNC `SR1807`이 재현됐다.
- 운영 스케줄러는 DNC/RMT 스트리밍 대신 CNC MEM 모드로 통일한다.
- 메인·서브 프로그램은 각각 `파일전송` 또는 `CNC 저장` 공급 방식을 선택한다.
- 기존 장비별 저장소는 `프로그램 저장소`로 명칭을 전환하고 업로드·코멘트·해시·일괄 등록 기능을 유지한다.
- 파일전송 방식은 원본 O번호를 설비별 실행용 임시 O번호로 변경하여 CNC에 전송한다.
- 행 시작 전 실행용 임시 프로그램이 남아 있으면 삭제 전 전환 프로그램을 선택한 뒤 삭제한다.
- 행 종료 시 메인 목표 수량과 Path2Only가 모두 끝난 후 전환 프로그램을 선택하고 실행용 임시 프로그램을 삭제한다.
- 생산 이력과 POP에는 임시 O번호가 아니라 저장소의 원본 O번호·코멘트·SHA-256 스냅샷을 기록한다.
- 2026-09-29에 DNC Test 화면·API·Agent 명령과 `DncStreamingService`를 제거했다. 테스트 경과와 실패 결과는 이 문서에만 보존한다.
- 신규 구현 순서와 상태 전이는 `docs/Scheduler.md`, `docs/scheduler-state-machine.md`를 기준으로 한다.

### DNC 보류 사유

- `I/O CHANNEL=6`은 FOCAS2/Ethernet DNC용이지만 현재 연결된 Embedded Ethernet에서는 `cnc_dncstart2`를 사용할 수 없다.
- `I/O CHANNEL=9`은 Embedded Ethernet FTP 파일 입출력용이며 FOCAS DNC 스트리밍 채널이 아니다.
- Fast/Multi-function Ethernet과 관련 옵션을 별도로 구성하지 않는 한 현재 Agent 구조를 운영 DNC로 사용할 수 없다.
- DNC 관련 기존 체크리스트의 미완료 항목은 실패가 아니라 방향 전환에 따른 보류 상태로 해석한다.

### DNC-98. MEM 파일전송 방식 전환

상태: **구현 완료·테스트 대기 — Server/Web/Agent 빌드 통과, 실기기 미검증**

- [x] DNC 저장소 명칭과 역할을 프로그램 저장소·파일전송 기준으로 전환
- [x] `memory/dnc` 설정을 `CNC 저장/파일전송` 공급 방식으로 마이그레이션
- [x] 설비별 메인·서브 실행용 임시 번호와 삭제 전 전환 번호 설정 추가
- [x] 시작 전 잔존 임시 프로그램 조건부 삭제
- [x] 원본 O번호·코멘트 유지 및 임시 O번호 변환 전송
- [x] 메인·Path2Only 최종 완료 후 안전 삭제
- [x] 이력·POP에 원본 프로그램 메타데이터 저장
- [x] 기존 DNC Test와 스트리밍 경로 제거 및 문서 이력 보존
- [ ] Path1, Path2 및 혼합 공급 방식 실기기 검증

구현 근거:

- 장비 설정 JSON과 공통 반응형 스케줄러 설정 팝업에 메인·서브 공급 방식, Path별 임시·대피 O번호를 추가했다.
- Server START/QUEUE_UPDATE 매니페스트는 메인·서브 파일전송 프로그램을 Path별로 구분하고 원본 O번호·코멘트·SHA-256 스냅샷을 유지한다.
- Agent는 스케줄러 시작 시 템플릿의 설비 카운터 ON/OFF 변수(기본 P10002)를 읽고 OFF 값으로 전환한 뒤 재검증한다. 정지·완료·오류 시 복원하지 않는다.
- Agent는 임시 프로그램 존재 확인 → 대피 프로그램 선택 → 조건부 삭제 → 원본 파일 O번호 변환 → 전송 → 임시 프로그램 선택 순으로 준비한다.
- 목표 수량과 선택적 Path2Only가 모두 끝난 뒤 CNC STOP을 확인하고 대피 프로그램 선택 → 임시 프로그램 삭제 순으로 정리한다.
- `npm run build:server`, `npm run build:web`, `dotnet build packages/agent/StarWebCNC.Agent/StarWebCNC.Agent.csproj --no-restore --verbosity:minimal`이 모두 성공했다.
- `npm test`는 구성된 서버 테스트 파일이 없어 Vitest가 `No test files found`로 종료했으며 기능 실패 테스트는 발생하지 않았다.
- 실기기 Cycle Start·프로그램 삭제·Agent 재배포는 수행하지 않았다.

### 2026-09-29 프로그램 저장소 명칭 전환

- Web의 활성 화면·상태·컴포넌트 명칭을 `ProgramRepository`와 `ProgramTransfer` 기준으로 변경했다.
- Server 저장소 모듈, 설정 API, 재동기화 API와 오류 코드를 프로그램 저장소 기준으로 변경했다.
- Agent MQTT 계약은 `transferPrograms`를 기본으로 사용하고 이전 `dncPrograms` 필드는 전환기 호환용으로만 수신한다.
- PostgreSQL 모델은 `ProgramRepositoryFile`, `program_transfer_config`, `program_repository_files`로 전환하는 migration을 추가했다.
- 운영 파일은 `C:\StarWebCNC-Data\program-repository`로 복사했으며 기존 `dnc` 폴더는 배포 검증 전 롤백용으로 보존한다.
- FANUC 고유 운전 모드명 `DNC/TAPE`, FOCAS 상태값, 과거 migration과 본 문서의 역사 기록은 변경 대상에서 제외한다.
- 구 API·MQTT·localStorage 별칭은 Server·Web·Agent 동시 배포가 확인된 후 제거한다.
- Server·Web production·Agent Release 빌드와 Prisma schema 검증, MC-002 새 경로의 매니페스트·SHA-256 검증이 성공했다.
- 현재 로컬 PostgreSQL에는 기존 migration 이력이 없고 애플리케이션 테이블도 없어 rename migration은 적용하지 않았다. 실제 운영 DB는 배포 전 백업과 migration baseline 확인이 필요하다.

### 2026-09-29 DNC 테스트 기능 종료 기록

운영 방향을 MEM 파일전송 방식으로 확정함에 따라 다음 DNC 전용 기능은 소스와 런타임에서 제거했다.

- Web의 데스크탑·모바일 `DNC Test` 메뉴, `/dnc-test` 화면과 API 클라이언트
- Server의 `/api/dnc-test` 라우트와 `DNC_TEST_START/STOP/STATUS` 명령 전달
- Agent의 DNC 테스트 명령 처리, 전용 FOCAS 핸들·스레드, `cnc_dncstart2/cnc_dnc2/cnc_dncend2` 래퍼
- MC-002 전용 `agent-runtime/*MC-002-dnc*` 실행본·백업과 오래된 전용 시작 스크립트

보존한 결론:

- 대상 컨트롤러는 FANUC 32i-B이며 MC-002 Embedded Ethernet 포트에서 시험했다.
- I/O CHANNEL 6, DNC/RMT 모드와 관련 파라미터를 확인했으나 `cnc_dncstart2`는 `EW_REJECT(13)`을 반환했다.
- CNC에서는 `SR1807 PARAMETER SETTING ERROR`가 재현됐고 파라미터 9 설정 후에도 동일했다.
- FOCAS2/Ethernet DNC를 유지하려면 Fast Ethernet 또는 Multi-function Ethernet, S707 옵션과 해당 포트 연결 조건이 필요하다는 진단까지 진행했다.
- 현재 설치 환경에서는 이 조건을 전제로 운영하지 않고 MEM 기반 파일전송으로 전환했다.
- 과거 단계별 테스트 절차·반환 코드·변경 이력은 아래 DNC-00~DNC-97과 작업 이력 표를 참고한다.

아래의 2026-08-30 이후 DNC 범위와 체크리스트는 방향 전환 이전의 구현·조사 이력이다.

### 2026-08-30 확정 범위

- 1차 DNC 구현 대상은 Path1만으로 제한한다.
- CNC의 MEM→DNC 모드 전환은 별도 기능으로 구현하며 현재 범위에서 제외한다.
- 스케줄러 행이 시작될 때 해당 행의 Path1 DNC 프로그램을 한 번 호출한다.
- 같은 행의 반복 가공은 CNC가 스케줄러의 `preset/count` 값을 사용해 내부적으로 처리한다.
- WebCNC는 카운트마다 DNC 세션을 다시 만들거나 같은 파일을 재공급하지 않는다.
- 기존 M20 카운트와 preset 완료 판단 흐름을 유지한다.
- 다음 스케줄러 행으로 전환할 때만 다음 행의 DNC 프로그램을 새로 호출한다.

### 2026-08-30 프로그램 업로드 화면 개편 협의안

상태: **코드 구현 완료 / 브라우저 수동 확인 대기**

- 작업자가 장비별 DNC 파일 경로를 직접 선택하는 UI는 제거하는 방향으로 검토한다.
- Path1 저장 경로는 `{DNC_ROOT}\{machineId}\path1` 규칙으로 시스템이 자동 결정한다.
- 설치 환경에서는 장비별 경로가 아니라 전역 `DNC_ROOT`만 설정한다.
- 업로드 화면에서 장비를 선택하면 해당 장비의 Path1 고정 폴더에 자동 저장한다.
- DNC 설정 화면에는 Path1/Path2 폴더 선택 대신 MEM/DNC 실행 모드만 유지하는 방향으로 검토한다.
- 현재 1차 범위에서 Path2 경로 설정은 화면에서 제거한다.
- Server와 Agent가 다른 PC라면 `DNC_ROOT`는 양쪽에서 접근 가능한 공유 경로 또는 별도 배포 구조가 필요하다.
- 2026-08-30 사용자 최종 진행 승인에 따라 데스크탑 업로드 모달 구현에 착수했다.
- 설정 아이콘 옆 데스크탑 전용 업로드 아이콘과 별도 모달을 구현했다.
- Windows 기본 파일 선택 창의 복수 선택, 탐색기 드래그 앤 드롭, 파일 붙여넣기를 지원한다.
- 허용 파일명을 `O0001`, `O0001.nc`, `O0001.txt` 형식으로 제한하고 저장명은 `O0001.nc`로 통일한다.
- 파일 내부 O번호를 대상 O번호로 치환하는 File Transfer 방식과 동일 프로그램 교체·건너뛰기 정책을 적용했다.
- 장비·프로그램별 코멘트, 원본명, 크기, SHA-256, 업로드 사용자·시각을 DB에 저장한다.
- 스케줄 START 시 코멘트·해시를 행에 스냅샷으로 저장하고 POP 기록 컬럼으로 이어지도록 구성했다.
- NC 파일은 UTF-8 BOM을 제거한 뒤 ASCII 호환 문자만 허용하며 한글 설명은 별도 코멘트에 저장한다.

### 구현되어 있는 범위

- 설비별 Path1/Path2 `memory`/`dnc` 모드 설정과 저장
- DNC 폴더 경로 설정 UI와 START payload 전달
- 스케줄러 행 시작 시 DNC 파일 존재 확인
- CNC 운전 모드가 DNC인지 확인 (`aut == 10`, RMT — 2026-09-03 MC-002 실기기 확인으로 9→10 정정. 9는 REF/원점복귀)
- Path2 프로그램이 있을 때 `cnc_rewind(path=2)` 호출
- HEAD, 원사이클 스톱, 사이클 스타트 기존 흐름 재사용
- DNC 관련 일부 오류 코드
  - `DNC_NO_PATHS`
  - `DNC_FILE_NOT_FOUND`
  - `DNC_MODE_INVALID`
  - `PATH2_REWIND_FAILED`

### 구현되지 않은 범위

- Agent가 CNC 소비 속도에 맞춰 프로그램 데이터를 연속 공급하는 스트리밍 엔진
- `cnc_dncstart2` → `cnc_dnc2` 반복 → `cnc_dncend2` 호출 흐름
- 전용 FOCAS 핸들·전용 스레드 분리
- `EW_BUFFER` 기반 flow control과 stall 감시
- 파일 스냅샷, 크기·해시 고정, 로컬 스풀
- 진행률, 공급 속도, 재시도 횟수, 진단 정보 보고
- RESET, 취소, 연결 끊김, Agent 종료 시 안전한 세션 종료
- 서버·Redis·WebSocket·UI의 DNC 세션 상태 연동
- Path1/Path2 동시 DNC 지원 여부 검증
- 장애 후 복구 정책과 장시간 운전 검증

---

## 4. 현재 설계 원칙

### 4.1 실행 위치

- DNC 데이터 공급 주체는 설비별 Agent로 한다.
- 서버가 MQTT 메시지로 프로그램 블록을 하나씩 전달하지 않는다.
- Agent는 실행 대상 파일을 로컬 스풀에 고정한 뒤 CNC에 공급한다.
- 네트워크 공유의 순간 지연이나 실행 중 파일 변경이 CNC 공급에 직접 영향을 주지 않도록 한다.

### 4.2 FOCAS 스레드

- 기존 `DataCollectorService` FOCAS 스레드에서 DNC 스트리밍 루프를 실행하지 않는다.
- 기존 스레드는 PMC와 인터락을 100ms 주기로 계속 감시해야 한다.
- DNC는 별도 LongRunning 스레드와 해당 스레드에서 생성한 별도 FOCAS 핸들을 사용한다.
- 별도 핸들의 실기기 동시 연결 가능 여부는 `DNC-00`과 `DNC-40`에서 확인한다.

### 4.3 안전과 복구

- Agent 또는 PC 재시작 후 DNC 작업을 자동 재개하지 않는다.
- 연결 장애 후 임의의 중간 블록에서 자동 재개하지 않는다.
- 1차 구현에서는 장애 발생 시 안전 정지와 작업자 확인 후 처음부터 재시작을 원칙으로 한다.
- DNC 중 PC 전원 차단 위험에 대비해 UPS와 현장 정지 절차를 별도로 검토한다.
- Path1 검증이 끝나기 전에는 Path2 동시 DNC를 활성화하지 않는다.
- PAUSE/RESUME 또는 개별 카운트 변화만으로 Path1 DNC 파일을 다시 호출하지 않는다.

### 4.4 파일 처리

- 시작 전 파일 존재, 읽기 권한, 크기, SHA-256을 확인한다.
- 실행 파일은 Agent 로컬 스풀에 복사하고 스트리밍 동안 불변으로 취급한다.
- 프로그램 내용을 임의로 수정하거나 줄바꿈을 조용히 변환하지 않는다.
- 허용 인코딩, `%`, O번호, EOB 조건은 실기기 결과를 근거로 확정한다.

---

## 5. 목표 상태 흐름

```text
IDLE
  → PREPARING
  → SPOOLING
  → CONNECTING
  → READY
  → STREAMING
  → DRAINING
  → COMPLETED
```

예외 상태:

- `PAUSING`
- `CANCELLING`
- `CANCELLED`
- `ERROR`

스케줄러 연동 후 목표 흐름:

```text
행 시작
  → 파일·모드·인터락 사전 검사
  → 로컬 스풀과 해시 생성
  → DNC 세션 READY 확인
  → HEAD/OCS 정렬
  → Cycle Start
  → CNC 내부 반복 가공과 기존 M20 count 감시
  → count == preset이면 행 완료
  → 다음 행에서 새 DNC 프로그램 호출 또는 안전 중단
```

---

## 6. 구현 로드맵

### DNC-00. 실기기 지원 조건 확인

상태: **차단 — MC-002 `cnc_dncstart2` EW_REJECT(13) 확인 (2026-09-03)**

- [ ] CNC 정확한 시리즈·소프트웨어 버전 확인
- [ ] FOCAS DNC 관련 옵션 유무 확인
- [ ] Ethernet DNC 채널과 Parameter 20 설정 확인
- [ ] DNC1/DNC2/OSI-Ethernet 중 실제 사용 채널 확인
- [ ] `cnc_dncstart2` 지원 여부 확정 — `EW_REJECT(13)` 재현만으로 지원 여부를 확정하지 않는다. DNC-96 호출 순서·출력 버퍼 수정 후 실기기 검증 필요
- [x] 별도 FOCAS 핸들 동시 연결 가능 여부 확인 — 됨. 모니터링용 메인 핸들이 살아있는 상태에서 DNC 전용 2번째 핸들 연결 및 `cnc_statinfo` 성공(`StabilizeHandle` 통과) 확인. 핸들 자체는 문제 없음, `cnc_dncstart2` 호출 시점에만 거부됨
- [ ] Path1/Path2 동시 DNC 가능 여부 확인
- [ ] MEM→DNC 전환 PMC 주소와 원격 전환 가능 여부 확인
- [ ] 스핀들·절삭 없이 사용할 짧은 Path1 테스트 프로그램 준비

**2026-09-03 발견 / 2026-09-16 판단 정정**: MC-002에서 인터락·모드 표시 문제 해결 후에도 `cnc_dncstart2=13`이 재현된다. 전용 핸들 연결 성공과 API 거부는 확인했지만, 코드 레벨에 문제가 없다는 기존 판단은 철회한다. 단독 시작 순서와 파일명 출력 버퍼 바인딩 문제를 DNC-96에서 수정하며 실기기 원인 확정은 보류한다.
- 실제 Ethernet 포트 구성과 사용 API 지원 여부 확인. FOCAS 스트리밍을 Data Server 방식과 동일시하거나 오류 13만으로 옵션 부족을 확정하지 않는다.
- Ethernet DNC 채널(Parameter 20 계열) 설정이 이 기능을 위해 맞게 되어 있는지
- CNC 화면에 이 시도 시점에 뜬 알람/메시지가 있는지
- 다른 DNC 클라이언트가 이미 채널을 점유하고 있지 않은지

완료 근거:

- 아직 없음

### DNC-10. 안전한 FOCAS DNC 래퍼

상태: **코드 구현 완료 / 실기기 검증 대기**

- [x] `cnc_dncstart2` 명시적 `LPStr` P/Invoke 작성
- [x] `cnc_dnc2` 명시적 길이 포인터·`byte[]` P/Invoke 작성
- [x] `cnc_dncend2` 명시적 P/Invoke 작성
- [ ] DNC 진단 구조체와 진단 API 래퍼 작성
- [x] `AsAny` 마샬링을 사용하지 않음
- [x] FOCAS 반환 코드와 사용자용 오류 코드 매핑
- [x] Agent Release 빌드 통과

완료 근거:

- `Dnc/FocasDncNative.cs`에 명시적 P/Invoke 구현
- `dotnet build -c Release` 성공, 오류 0개

예상 파일:

- `packages/agent/StarWebCNC.Agent/Dnc/FocasDncNative.cs`

### DNC-20. DNC 세션과 전용 스트리밍 서비스

상태: **역사 기록 — 2026-09-29 소스 제거**

- [ ] DNC 세션 상태·파일 정보·진행 정보 모델 작성
- [x] 별도 DNC 전용 스레드 작성
- [x] 같은 스레드에서 FOCAS 핸들 생성·사용·해제
- [x] 서버 매니페스트 SHA-256을 Agent 시작 직전 재검증
- [x] chunk 공급과 실제 소비 길이 추적
- [x] `EW_BUFFER` 재시도 처리
- [x] stall timeout과 취소 처리
- [x] DNC 시작 이후 모든 종료 경로에서 `cnc_dncend2` 호출
- [ ] Agent 종료 시 세션 정리
- [x] Agent Release 빌드 통과

예상 파일:

- `packages/agent/StarWebCNC.Agent/Dnc/DncSession.cs`
- `packages/agent/StarWebCNC.Agent/Dnc/DncStreamingService.cs` (2026-09-29 제거)
- `packages/agent/StarWebCNC.Agent/Program.cs`
- `packages/agent/StarWebCNC.Agent/Configuration/AgentSettings.cs`

### DNC-30. 진단 명령과 상태 보고

상태: **예정**

- [ ] `DNC_PROBE` 명령
- [ ] `DNC_START_TEST` 명령
- [ ] `DNC_CANCEL_TEST` 명령
- [ ] `DNC_STATUS` 명령
- [ ] 상태, 진행률, 공급 속도, 재시도 횟수 보고
- [ ] 오류 코드와 원인 메시지 구분
- [ ] 기능 활성화 설정 기본값을 비활성으로 설정
- [ ] 일반 텔레메트리와 PMC 감시가 DNC 중에도 유지되는지 확인

예상 파일:

- `packages/agent/StarWebCNC.Agent/Commands/CommandHandler.cs`
- `packages/agent/StarWebCNC.Agent/Mqtt/MqttService.cs`
- `packages/agent/StarWebCNC.Agent/appsettings.Production.json`

### DNC-40. Path1 실기기 검증

상태: **예정**

- [ ] DNC 모드에서 세션 시작 성공
- [ ] 짧은 프로그램 정상 공급·완료
- [ ] `EW_BUFFER` 발생 여부와 재시도 동작 기록
- [ ] Cycle Start 전후 올바른 API 호출 순서 확정
- [ ] Feed Hold 시 동작 확인
- [ ] RESET 시 반환 코드와 세션 종료 확인
- [ ] 사용자 취소 시 안전 종료 확인
- [ ] CNC 알람 발생 시 처리 확인
- [ ] MQTT 또는 Server 중단이 스트리밍에 미치는 영향 확인
- [ ] Agent 로그와 CNC 화면 결과 기록

완료 조건:

- Path1 테스트 프로그램을 반복 실행해 정상 완료하고, 중단 시나리오에서 안전하게 종료됨

### DNC-50. 스케줄러 상태 머신 연동

상태: **Path1 코드 구현 완료 / 실기기 검증 대기**

- [x] 기존 DNC 파일 확인 로직을 세션 준비 흐름으로 변경
- [x] DNC 세션 `READY` 후 Cycle Start
- [ ] 행 변경 시 이전 세션 종료와 다음 스풀 준비
- [x] PAUSE·RESUME 시 DNC 재호출 금지, CANCEL 시 세션 취소 반영
- [ ] M20 카운트 흐름과 DNC 완료 상태 정합성 확인
- [x] 스케줄러 오류 코드 확장
- [ ] Memory 모드 동작 회귀 확인
- [ ] Path1 DNC 스케줄러 실기기 검증

예상 파일:

- `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`
- `packages/agent/StarWebCNC.Agent/Mqtt/MqttService.cs`
- `packages/server/src/routes/scheduler.ts`

### DNC-60. 서버 상태 저장과 복구 감지

상태: **START 매니페스트 구현 / 상태 복구 예정**

- [x] 행 ID, Path1, 프로그램 번호, 파일명·경로·크기·SHA-256 전달
- [ ] 세션 ID 전달
- [ ] DNC 상태·진행 이벤트 수신
- [ ] Redis에 현재 DNC 세션 상태 저장
- [ ] Agent 재연결 시 서버 상태 불일치 감지
- [ ] 서버 재시작 후 실제 Agent 상태 재조회
- [ ] 감사·작업 이력 기록 범위 확정

### DNC-70. 웹 상태 표시

상태: **프로그램 코멘트 표시 완료·화면 확인 대기 / 실행 상태 예정**

- [x] 리모트패널 EDIT·파일트랜스퍼 장비 목록의 실제 CNC 코멘트 조회 보완
- [x] 리모트패널 EDIT·파일트랜스퍼·DNC 업로드/목록에 `O번호 (코멘트)` 표시 UI 적용
- [ ] Scheduler에 준비·공급·완료·오류 상태 표시
- [ ] 파일명, 진행률, 공급 속도, 마지막 오류 표시
- [ ] DNC 실행 중 현재 실행 파일만 변경 차단하고 다른 프로그램 업로드·편집 허용
- [ ] 데스크탑 레이아웃 검증
- [ ] 모바일 세로·가로 레이아웃 검증
- [ ] 권한과 기능 활성화 설정 적용

### DNC-75. DNC 프로그램 관리 화면 개편

상태: **핵심 코드 완료·API/데스크탑 검증 완료·운전 중 실기기 검증 대기**

#### 상태 관리 규칙

- 각 구현 항목은 `예정 → 진행 중 → 코드 완료 → 검증 완료` 순서로 관리한다.
- `[x]`는 요구된 빌드와 화면·API 검증 근거가 기록된 항목에만 표시한다.
- 코드만 작성하고 수동 화면 확인이나 필요한 운전 검증을 마치지 않은 항목은 `[ ] 코드 완료`로 기록한다.
- 작업 시작 시 이 섹션의 대상 단계를 `진행 중`으로 변경하고, 작업 이력에 변경 파일·검증 결과·남은 문제를 기록한다.

#### 확정된 데스크탑 화면

- 팝업은 데스크탑 기준 좌우 2열로 구성한다.
- 좌측 상단은 파일 추가 영역으로 사용하며 드래그 앤 드롭, Windows 파일 선택 복수 업로드, 파일 붙여넣기를 지원한다.
- 좌측 하단은 업로드 대기 영역으로 사용하며 파일명, 원본 프로그램 번호, 대상 프로그램 번호, 추출 코멘트, 충돌 처리와 상태를 표시한다.
- 우측 전체는 장비별 Path1 DNC 프로그램 목록으로 사용한다.
- 목록에는 선택 체크박스, 프로그램 번호, 코멘트, 파일 용량을 표시한다.
- 저장소 경로는 `{DNC_ROOT}\{machineId}\path1` 고정 규칙을 유지하며 사용자가 장비별 경로를 직접 변경하지 않는다.

#### 업로드와 코멘트 처리

- 파일 추가 시 파일 내부 O-line의 프로그램 번호와 `O0001(COMMENT)` 형식의 코멘트를 먼저 추출한다.
- 업로드 대기 영역에서 대상 프로그램 번호와 코멘트를 수정할 수 있다.
- 파일 전송 시 O-line을 대상 번호와 수정 코멘트로 다시 작성하고 DB 코멘트도 동일한 값으로 저장한다.
- 코멘트가 비어 있으면 O-line은 `O0001`만 남기고 기존 괄호 코멘트를 제거한다.
- O-line에 직접 기록하는 코멘트는 현재 NC 파일의 ASCII 호환 정책과 괄호 구문을 따라 줄바꿈·괄호·비ASCII 문자를 허용하지 않는다.
- 기존 ASCII 호환 검사, UTF-8 BOM 제거, `.nc` 표준 파일명, 동일 프로그램 교체·건너뛰기 정책을 유지한다.
- 스케줄러 운전 중에도 신규 DNC 프로그램 업로드를 허용한다.
- 현재 실행 중인 DNC 프로그램과 같은 번호의 파일은 수정·교체하지 못하게 차단한다.

#### 목록 선택과 삭제

- 개별 선택과 전체 선택을 지원한다.
- 선택 파일 삭제 전 프로그램 번호와 개수를 포함한 확인 팝업을 표시한다.
- 확인해야 실제 파일과 `DncProgram` 메타데이터를 함께 삭제한다.
- 현재 스케줄러 화면에 남아 있는 행에서 참조하는 프로그램은 상태와 관계없이 삭제를 차단한다.
- 현재 실행 중인 프로그램은 편집과 삭제를 모두 차단한다.
- 권한 정책은 별도로 확정하기 전까지 기존 관리자·HQ 엔지니어 정책을 유지한다.

#### DNC 목록에서 스케줄러 일괄 등록

- DNC 프로그램 목록에 `스케줄러 등록` 선택 모드를 제공한다.
- 체크한 순서대로 선택 순번을 표시하며 동일 프로그램의 중복 스케줄러 등록을 허용한다.
- `확인` 전 선택은 임시 상태로 유지하고 `취소` 시 모두 폐기한다.
- `확인` 시 선택 순서대로 메인 프로그램 번호를 채운다.
- `PENDING` 상태이면서 메인 프로그램 번호가 비어 있는 행부터 채우고, 부족한 수만큼 새 행을 뒤에 추가한다.
- `RUNNING`, `PAUSED`, `COMPLETED`, `CANCELLED` 행은 빈 행 재사용 대상에서 제외한다.
- 서브 프로그램 번호는 설정 기본값이 있으면 적용하고, 없으면 공란으로 둔다.
- 기본 수량은 설정값을 적용하고 미설정이면 기존 기본값 `10`을 사용한다.
- 스케줄러 운전 중에도 대기 행 추가와 새 행 등록을 허용하며 현재 실행 행은 변경하지 않는다.
- 최대 큐 크기를 초과하면 저장 전에 안내하고 전체 등록을 취소한다.
- 여러 행 등록은 서버 트랜잭션으로 처리하여 전체 성공 또는 전체 취소를 보장한다.

#### 프로그램 존재 여부와 코멘트 확인

- 스케줄러 메인 프로그램 번호 입력·변경 시 현재 메인 운전 모드에 맞는 목록과 비교한다.
- Memory 모드는 Agent의 실장비 Path1 프로그램 목록을 기준으로 확인한다.
- DNC 모드는 해당 장비 Path1 DNC 저장소를 기준으로 확인한다.
- 메인 프로그램이 있으면 초록색 원, 없으면 빨간색 원으로 표시한다.
- Memory 서브 프로그램은 Agent의 실장비 Path2 프로그램 목록과 비교하여 같은 상태 표시를 적용한다.
- 장비 연결이 끊겨 Memory 목록을 읽지 못하면 `없음`이 아니라 `확인 불가`로 표시한다.
- 프로그램 번호 입력 중 매 키 입력마다 장비를 조회하지 않고 입력 완료 또는 목록 새로고침 시 확인한다.
- 메인·서브 프로그램 번호는 Tab 이동 또는 포커스 해제 시 4자리로 자동 보정한다. 예: `20` → `O0020`.
- 데스크탑 스케줄러에서는 프로그램 번호에 마우스를 올리면 코멘트 툴팁을 표시한다.

#### 등록 후 파일 변경과 안전 처리

- 현재 실행 중이 아닌 등록 프로그램은 코멘트 수정과 파일 교체를 허용한다.
- 스케줄러 행에 저장된 프로그램 번호·SHA-256·코멘트 스냅샷과 현재 DNC 파일 메타데이터를 비교한다.
- 등록 이후 파일이 바뀌어 불일치하면 해당 행에 `프로그램 변경됨/재확인 필요` 오류를 표시한다.
- 불일치 행은 확인 없이 실행하지 못하도록 차단한다.
- 작업자가 재확인·동기화를 실행하면 최신 SHA-256과 코멘트로 행 스냅샷을 갱신하고 오류를 해제한다.
- 실행 중인 행의 파일은 재확인·동기화 대상에서도 제외한다.

#### 모바일·터치 UI 제안

상태: **제안·최종 확정 대기**

- 모바일에서는 2열 대신 `파일 추가 / 업로드 대기 / 프로그램 목록` 3개 탭의 전체 화면 팝업을 사용한다.
- 프로그램 번호를 터치하면 코멘트와 용량을 보여주는 하단 상세창을 연다.
- 스케줄러 프로그램 번호 터치 시에도 코멘트 하단 상세창을 표시한다.
- 체크박스와 주요 버튼은 최소 44px 터치 영역을 확보한다.
- 선택 개수, 삭제, 스케줄러 등록 동작은 하단 고정 작업 막대에 표시한다.
- 스케줄러 등록 선택 순서는 체크박스 옆 숫자 배지로 표시한다.

#### 구현 순서와 체크리스트

1. **데이터·API 기반**
   - [x] DNC 프로그램 번호·코멘트·파일 크기·SHA-256 메타데이터 저장
   - [x] 장비별 Path1 프로그램 목록 API에서 코멘트와 실제 파일 크기 반환
   - [x] 일괄 스케줄러 등록 트랜잭션 API
   - [x] 프로그램별 스케줄러 참조 여부와 현재 실행 여부 조회
   - [x] 등록 스냅샷 불일치 확인·재동기화 API
2. **업로드 정규화**
   - [x] 복수 선택·드롭·붙여넣기와 프로그램 번호 정규화
   - [x] 파일 O-line 코멘트 추출 후 업로드 대기값으로 표시
   - [x] 수정 코멘트를 O-line과 DB에 동일하게 저장
   - [x] 빈 코멘트 입력 시 기존 O-line 코멘트 제거
   - [ ] 운전 중 신규 업로드 허용과 현재 실행 파일 교체 차단 — 코드 완료·실기기 대기
3. **데스크탑 2열 UI**
   - [x] 좌측 상단 파일 추가·좌측 하단 업로드 대기 배치
   - [x] 우측 DNC 목록에 체크박스·프로그램 번호·코멘트·용량 표시
   - [x] 전체 선택·삭제 확인 팝업과 삭제 차단 사유 표시
4. **스케줄러 등록 연동**
   - [x] 선택 모드·선택 순번·확인·취소 UI
   - [x] 빈 `PENDING` 행 우선 채우기와 부족 행 추가
   - [x] 설정의 서브 프로그램·수량 적용과 기본 수량 10 확인
   - [ ] 운전 중 현재 행을 보존한 추가 등록 — Server/Agent 코드 완료·실기기 대기
   - [ ] 최대 큐 초과와 서버 실패 시 전체 원복 — 코드 완료·경계값 검증 대기
5. **존재·불일치 상태 표시**
   - [ ] Memory 실장비 목록 존재·없음·확인 불가 표시 — 코드 완료·화면 검증 대기
   - [x] DNC 저장소 존재 여부 표시
   - [ ] 변경된 등록 파일 오류 표시와 해당 행 실행 차단 — API 검증 완료·실기기 실행 차단 대기
   - [x] 재확인·동기화 후 오류 해제
   - [x] 데스크탑 프로그램 코멘트 툴팁
6. **모바일·권한·회귀 검증**
   - [ ] 모바일 3탭·하단 상세창 방식 최종 승인
   - [ ] 모바일 세로·가로와 터치 영역 검증
   - [ ] 업로드·편집·삭제·등록 권한 최종 확정
   - [ ] 기존 Memory 스케줄러와 File Transfer 회귀 테스트
   - [ ] DNC 운전 중 업로드·등록·편집·불일치 차단 실기기 검증

### DNC-76. O9000 프로그램 보호 연동

상태: **코드·빌드 완료·실기기 검증 대기**

#### 확정 동작

- CNC 파라미터 `3202#4(NE9)`를 장비별 보호 상태 기준으로 사용한다.
- `NE9=0`이면 O9000~O9999를 일반 프로그램처럼 사용할 수 있다.
- `NE9=1`이면 O9000~O9999를 목록에서 숨기지 않고 회색 비활성 행과 잠금 표시로 유지한다.
- 파라미터 읽기 실패 또는 Agent 미연결 상태는 안전상 `확인 불가` 보호 상태로 취급한다.
- CNC 메모리 보호 행은 체크박스·전체 선택에서 제외하고 열기, 다운로드와 CNC 선택을 차단한다.
- PC 공용 저장소와 장비별 DNC 저장소의 O9000 파일은 일반 파일처럼 업로드·열기·편집·삭제할 수 있다.
- DNC 저장소에서 O9000을 스케줄러에 등록하는 것은 허용하되 실제 NC 공급이 시작되는 START 시점에는 보호 상태를 다시 확인해 실행을 차단한다.
- 이미 실행 중인 프로그램은 파라미터 상태 변화로 강제 중단하지 않고 이후 신규 조작만 제한한다.

#### 적용 범위와 강제 차단

- 리모트패널 EDIT 프로그램 목록은 `LIST_PROGRAMS`의 `isProtected` 값을 사용한다.
- 파일트랜스퍼에서는 CNC 목록만 비활성화하고 PC 공용 저장소 목록은 보호하지 않는다.
- 장비별 DNC Path1 목록·업로드 대기·코멘트·삭제·스케줄러 일괄 등록은 보호하지 않는다.
- 스케줄러 Memory/DNC 존재 확인에는 `보호` 상태를 별도로 표시하고 START 시 메인·서브 프로그램을 서버에서 재검사한다.
- UI 우회 방지를 위해 Agent가 CNC 업로드·다운로드·검색·백업을 최종 차단하고, 서버는 스케줄러 START에서 DNC 공급·Memory 실행을 재검사한다.

#### 체크리스트

- [x] Agent `cnc_rdparam(3202)` 및 `protected/unprotected/unknown` 판정
- [x] CNC 목록 `isProtected`·상위 `program9000Protection` 응답
- [x] 리모트패널·파일트랜스퍼 CNC 목록 회색 비활성·잠금 표시
- [x] 보호 행 체크박스·전체 선택·열기·편집 차단
- [x] Agent 업로드·다운로드·검색·백업 강제 차단
- [x] PC 공용·DNC 저장소 O9000 파일 관리 허용
- [x] 스케줄러 O9000 등록·수정 허용, START 강제 차단
- [x] Server TypeScript, Web production, Agent Release 빌드
- [ ] 실기기에서 `3202#4=1`일 때 O9000 행 보호 표시와 모든 조작 차단 확인
- [ ] 실기기에서 `3202#4=0`일 때 O9000 행 활성화와 정상 조작 확인
- [ ] 장비별 `cnc_rdparam(handle, 3202, 0, 8, ...)` 반환 코드 기록
- [ ] 데스크탑·모바일 목록 잠금 표시 육안 확인

### DNC-77. 스케줄러 프로그램 번호 표시 보완

상태: **코드·빌드 완료·실기기 검증 대기**

- [x] 메인 프로그램 존재 시 초록색 원, 미존재 시 빨간색 원 표시
- [x] Memory 서브 프로그램을 Path2 NC 목록과 비교하여 초록색·빨간색 원 표시
- [x] 메인·서브 프로그램 번호를 Tab 이동 또는 포커스 해제 시 4자리로 자동 보정
- [x] Server TypeScript 및 Web production 빌드
- [ ] 실기기 Path1·Path2 목록과 스케줄러 표시 대조
- [ ] 데스크탑에서 Tab 이동 시 `20` → `O0020` 저장·표시 확인

### DNC-80. Path2와 혼합 운전

상태: **예정**

- [ ] Path2 단독 DNC 지원 가능 여부 확정
- [ ] Path1 DNC + Path2 Memory 검증
- [ ] Path1 Memory + Path2 DNC 검증
- [ ] Path1 DNC + Path2 DNC 가능 여부와 핸들 구조 확정
- [ ] Path2 rewind 문서 불일치 해소
- [ ] 동기 코드와 waiting M-code 알람 검증

### DNC-92. Path1 단독 DNC 테스트 화면

상태: **코드·빌드 완료 / MC-002 실기기 검증 대기**

- [x] 데스크탑 전용 단독 테스트 화면과 메뉴
- [x] 고정 Path1 저장소 프로그램 번호 검증
- [x] 스케줄러를 거치지 않는 DNC 시작·중지 API
- [x] Agent Path1 DNC 세션과 설비 Cycle Start 요청 대기
- [x] 스케줄러 실행·중복 DNC 세션 상호 배제
- [x] 단계별 상태·FOCAS 오류 표시
- [x] Server, Web, Agent 빌드
- [ ] MC-002 실기기 단독 실행 검증

구현 범위:

- 기존 CNC IP·FOCAS 연결 설정과 `{DNC_ROOT}\{machineId}\path1` 고정 저장소를 그대로 사용한다.
- 사용자가 입력한 프로그램 번호의 Path1 파일을 크기·SHA-256 매니페스트로 확정한 뒤 `DNC_TEST_START` 명령으로 Agent에 전달한다.
- Agent는 `aut=10`(DNC/RMT), `run=0`(STOP), 알람·인터락과 O9000 보호를 재검사한 후 Path1 DNC 세션을 열고, 작업자가 설비 조작반에서 Cycle Start를 누를 때까지 대기한다. 단독 테스트의 웹·Agent는 Cycle Start PMC를 출력하지 않는다.
- 스케줄러 큐·PRESET·COUNT·Path2 시퀀스는 호출하지 않는다. 스케줄러가 `IDLE`이 아니면 서버에서 시작을 차단한다.
- 공유 `DncStreamingService`의 단독 테스트 세션만 중지할 수 있으며, 스케줄러 세션은 단독 테스트 중지 API로 취소할 수 없다.
- 최초 구현은 데스크탑 전용이었으며, DNC-93에서 모바일 테스트 접근을 허용하는 반응형 화면으로 확장했다.

### DNC-93. 모바일 단독 DNC 테스트 화면

상태: **코드·빌드 완료 / 모바일·MC-002 실기기 검증 대기**

- [x] 모바일 Machines 메뉴에 DNC Test 표시
- [x] 휴대폰 세로 1열 테스트 화면
- [x] 휴대폰 가로·태블릿 반응형 배치
- [x] 모바일 실행 확인·제어권·안전 조건 유지
- [x] Web production build
- [ ] Android·iPhone·태블릿 화면 확인
- [ ] MC-002 모바일 실기기 단독 실행 검증

### DNC-94. 단독 테스트 Agent 배포 누락 복구

상태: **코드·빌드·MC-002 배포 및 상태 조회 검증 완료 / 단독 실행 검증 대기**

- [x] 모드 표시 `aut=10=DNC`, `aut=9=REF` 수정
- [x] Agent Release 빌드
- [x] 기존 MC-002 배포본·시작 스크립트 백업
- [x] MC-002 전용 최신 배포본 구성·재시작
- [x] `DNC_TEST_STATUS` 읽기 전용 응답·텔레메트리 검증
- [ ] MC-002 단독 실행 실기기 검증

실제 Cycle Start와 RESET은 이번 배포 검증에서 호출하지 않는다. `run=1`(HOLD)은 계속 시작 차단하며 `run=0` 조건을 유지한다.

배포 경로: `agent-runtime/MC-002-dnc94-20260916`. 백업: `agent-runtime/backup_MC-002-dnc94-20260916`. MC-002 시작 스크립트의 작업 폴더만 새 배포 경로로 변경했으며 기존 IP·TemplateId·MQTT 설정과 공용 publish 폴더는 보존한다. 원복 시 백업 시작 스크립트를 복원하고 MC-002만 재시작한다.

2026-09-16 검증: 새 PID 13556, 로그의 Content root·FOCAS BaseDirectory가 새 배포 경로와 일치. 템플릿 로드·CNC/PMC 연결 성공, `DNC_TEST_STATUS` 응답 `success / state=idle`, 실제 텔레메트리 `mode=DNC / runState=1`. 실제 START는 미호출했고 `run=1` 차단은 유지한다.

### DNC-95. 전체 실행 후 MC-002 구버전 재실행 복구

상태: **MC-002 별도 실행·상태 조회 검증 완료 / 전체 실행 경로 통합 대기**

- 전체 실행의 `_runner-agents-dynamic.ps1`이 장비별 시작 스크립트를 생성하므로 MC-002 전용 경로가 공용 publish 경로로 덮어써지는 현상을 확인했다.
- 승인 범위: MC-002 시작 경로 복구와 별도 재실행, 다른 장비 유지, 상태 조회 검증. Cycle Start·RESET·CNC 설정 변경은 하지 않는다.
- [x] MC-002 전용 배포본 재실행 및 상태 조회 검증
- [ ] 전체 실행과 전용 배포 경로 통합 — 별도 승인 후 진행

2026-09-16 검증: 구버전 MC-002 PID 29656 종료 후 최신 전용 배포본 PID 10544 실행. 다른 장비 PID 20064(MC-001), 18880(MC-003), 31132(MC-004)는 유지. Content root·FOCAS BaseDirectory가 전용 폴더와 일치하고 CNC/PMC 연결 성공. 상태 API 응답 `success=true / state=idle`, 실제 MQTT 텔레메트리 `mode=DNC / runState=0 / alarmActive=false` 확인. 변경 파일: `agent-runtime/start_agent_MC-002.ps1`, `docs/DNC.md`. 기존 빌드 산출물을 사용했으므로 재빌드하지 않았으며 실기기 읽기 전용 검증만 수행했다. Cycle Start·RESET은 미호출. 전체 실행 스크립트는 변경하지 않았으므로 다시 사용하면 전용 경로가 덮어써질 수 있다. 다음 작업은 전체 실행 경로 통합과 오류 13 호출 순서·지원 조건 검증이다.

### DNC-96. 단독 DNC 시작 순서와 출력 버퍼 수정

상태: **코드·빌드·MC-002 배포·상태 조회 완료 / 실제 실행 검증 대기**

- 단독 테스트에서 파일·전용 핸들·Path1 준비 후 안전 조건을 재검사하고 Cycle Start를 1회 출력한 뒤 CNC DNC 요청을 제한시간 동안 확인한다.
- `cnc_dncstart2` 파일명 인자는 입력 파일명이 아니라 출력 버퍼로 처리한다. M198 요청으로 확인되면 선택한 단독 파일을 공급하지 않는다.
- 스케줄러 시작 시퀀스 변경은 이번 범위에서 제외한다. 공유 native 출력 버퍼 수정은 스케줄러에도 적용된다.
- Cycle Start 바이트에 다른 비트가 ON이면 기존 쓰기 방식으로 덮어쓰지 않고 시작을 차단한다. 읽기 실패도 차단한다.
- 실제 Cycle Start·RESET 검증은 실행하지 않는다. 빌드·배포·상태 조회 후 실제 실행 검증은 미완료로 남긴다.
- [x] 빌드·MC-002 배포·읽기 전용 상태 조회
- [ ] 단독 실행·거부 대기·취소·실기기 검증

2026-09-16 변경 파일: `packages/agent/StarWebCNC.Agent/Dnc/FocasDncNative.cs`, `packages/agent/StarWebCNC.Agent/Dnc/DncStreamingService.cs`, `packages/agent/StarWebCNC.Agent/Commands/CommandHandler.cs`, `FOCAS_REFERENCE.md`, `docs/DNC.md`. 출력 버퍼 256 byte, 단독 요청 13 반환은 50ms 간격 최대 10초 대기, 그 외 오류는 즉시 종료한다. 단독 START 성공 응답은 Cycle Start 출력과 요청 대기 시작을 의미하며 실제 전송 실패는 상태 조회로 확인한다. ON 출력 후 OFF는 finally에서 시도한다. 기존 공유 PMC byte 직접 쓰기 방식은 유지하므로 사전 0 확인 이후 래더가 같은 바이트를 변경하는 경쟁 위험은 남는다. 실제 테스트 전에 해당 바이트 전용성 확인 필요. 취소·시간초과 시 Agent 데이터 공급만 종료하며 CNC RESET을 자동 출력하지 않는다. 장비가 대기 상태에 남으면 조작반에서 안전하게 정지·RESET 확인이 필요하다.

검증: Agent Release build 성공(기존 경고 328, 오류 0), `git diff --check` 성공. 기존 오류 세션이 completedAt을 가진 종료 상태임을 확인하고 MC-002 PID 10544를 14952로 교체. 다른 장비 PID는 유지. 기존 배포 파일 백업 `agent-runtime/backup_MC-002-dnc96-20260916`, 배포 폴더는 기존 전용 폴더 유지. CNC 연결·Content root 정상, 상태 API `success=true / idle`, MQTT `DNC / runState=0 / alarmActive=false` 확인. 실제 START·RESET 미호출, 거부 대기·취소·PMC 출력·파일 가공은 미검증. 원복은 백업의 Agent 산출물을 전용 폴더로 복원 후 MC-002만 재시작한다. 전체 실행 배치파일의 공용 경로 덮어쓰기 문제는 DNC-95 미완료로 유지한다. 다음 작업: 출력 바이트 전용성 확인 후 안전한 단독 실기기 시험, API/포트 지원 여부 확정, 검증 후 스케줄러 시퀀스 적용.

### DNC-97. 설비 Cycle Start 기반 단독 DNC 대기

상태: **코드·빌드·MC-002 배포 완료 / CNC 연결·실기기 검증 대기**

- [x] 단독 테스트의 Cycle Start PMC 출력 제거
- [x] `awaiting_cycle_start` 상태와 60초 제한 대기 추가
- [x] 웹 버튼·안내·확인 팝업을 `DNC 준비` 방식으로 변경
- [x] Agent Release 및 Web production 빌드
- [x] MC-002 전용 배포본 교체·Agent 실행
- [ ] CNC 연결 후 읽기 전용 상태 조회
- [ ] 설비 Cycle Start 요청·파일 공급·완료 실기기 검증

단독 테스트 START는 파일·전용 핸들·Path1을 준비하고 모드·STOP·알람·인터락을 재검사한 뒤 즉시 `awaiting_cycle_start`를 반환한다. 이후 60초 동안 `cnc_dncstart2`의 CNC 요청을 기다리며 작업자가 설비 조작반의 Cycle Start 버튼을 직접 눌러야 한다. 웹·Agent는 Cycle Start와 RESET PMC를 출력하지 않는다. 시간초과·사용자 취소 시 Agent 공급 세션만 종료한다. 이 변경은 단독 테스트에만 적용하며 스케줄러 자동 시퀀스는 변경하지 않는다.

2026-09-21 변경 파일: `packages/agent/StarWebCNC.Agent/Dnc/DncStreamingService.cs`, `packages/agent/StarWebCNC.Agent/Commands/CommandHandler.cs`, `packages/web/src/lib/api.ts`, `packages/web/src/pages/DncTest.tsx`, `FOCAS_REFERENCE.md`, `BRIEFING.md`, `docs/DNC.md`. Agent Release build 성공(기존 경고 328, 오류 0), Web production build 성공(기존 chunk-size·Browserslist 경고), `git diff --check` 오류 없음. MC-002 Agent가 실행 중이 아니어서 기존 전용 배포본을 `agent-runtime/backup_MC-002-dnc97-20260921`에 백업하고 전용 폴더를 교체한 뒤 PID 28768로 실행했다. Agent·MQTT·템플릿 로드는 정상이나 CNC `192.168.0.102:8193` 연결은 4회 모두 `-16`으로 실패하여 30초 재시도 중이다. 따라서 상태 API와 텔레메트리 검증 및 실제 설비 Cycle Start 시험은 미완료다. Cycle Start·RESET PMC는 출력하지 않았다. CNC 전원·네트워크 복구 후 `idle`, DNC 모드, run=0, alarm=false를 확인하고 실기기 시험한다.

### DNC-90. 다중 설비와 운영 검증

상태: **예정**

- [ ] 여러 Agent가 동시에 DNC 스트리밍할 때 부하 측정
- [ ] 장시간 연속 가동과 큰 프로그램 검증
- [ ] 네트워크 지연·단절 시나리오 검증
- [ ] Agent 프로세스 비정상 종료 시나리오 검증
- [ ] PC 재부팅 후 자동 재개 금지 확인
- [ ] Windows 서비스와 UPS 운영 절차 반영
- [ ] 설치형 고객사 가이드 반영

---

## 7. 오류 코드 초안

| 코드 | 의미 | 기본 처리 |
|------|------|-----------|
| `DNC_DISABLED` | 기능 비활성 | 시작 거부 |
| `DNC_FILE_NOT_FOUND` | 원본 파일 없음 | 시작 거부 |
| `DNC_SPOOL_FAILED` | 로컬 스풀 생성 실패 | 시작 거부 |
| `DNC_HASH_FAILED` | 파일 해시 계산 실패 | 시작 거부 |
| `DNC_MODE_INVALID` | CNC가 DNC 모드가 아님 | 시작 거부 |
| `DNC_CONNECT_FAILED` | 전용 FOCAS 핸들 생성 실패 | 오류 종료 |
| `DNC_HANDLE_NOT_READY` | 전용 FOCAS 핸들 안정화 실패 | 오류 종료 |
| `DNC_PATH_SELECT_FAILED` | FOCAS Path1 선택 실패 | 오류 종료 |
| `DNC_START_FAILED` | `cnc_dncstart2` 실패 | 오류 종료 |
| `DNC_BUFFER_STALL` | 버퍼 공급 위치가 제한 시간 동안 진행되지 않음 | 안전 중단 |
| `DNC_WRITE_FAILED` | `cnc_dnc2` 데이터 공급 실패 | 오류 종료 |
| `DNC_FILE_CHANGED` | START 이후 파일 크기·해시 변경 | 시작 거부 |
| `DNC_SCHEDULER_FILE_MISMATCH` | 등록 스냅샷과 현재 DNC 파일 불일치 | 행 오류 표시·재확인 전 실행 거부 |
| `DNC_SESSION_BUSY` | 이전 행 DNC 세션 미종료 | 시작 거부 |
| `DNC_CNC_CANCELLED` | CNC에서 DNC 취소 | 취소 종료 |
| `DNC_RESET` | CNC RESET 또는 STOP 발생 | 안전 중단 |
| `DNC_STREAM_FAILED` | 데이터 공급 중 일반 오류 | 오류 종료 |
| `DNC_END_FAILED` | DNC 종료 API 실패 | 오류·점검 필요 |
| `DNC_RECOVERY_REQUIRED` | 자동 복구 금지 상태 | 작업자 확인 필요 |
| `PROGRAM_9000_PROTECTED` | `3202#4(NE9)`로 O9000~O9999 보호 | 해당 조작 거부 |
| `PROGRAM_PROTECTION_UNKNOWN` | 파라미터 3202 보호 상태 확인 실패 | 안전상 O9000~O9999 조작 거부 |

오류 코드는 실기기 반환값을 확인한 뒤 확정한다.

---

## 8. 실기기 테스트 기록 양식

| 항목 | 기록 내용 |
|------|-----------|
| 일시 |  |
| 작업 ID |  |
| CNC 시리즈·버전 |  |
| CNC 모드 |  |
| Path |  |
| 테스트 파일·SHA-256 |  |
| FOCAS API 순서 |  |
| 반환 코드 |  |
| CNC 알람 |  |
| Agent 로그 |  |
| 결과 | 미실행 / 실패 / 통과 |
| 후속 작업 |  |

필수 테스트 시나리오:

- 정상 시작과 정상 완료
- CNC가 DNC 모드가 아닐 때 시작 거부
- 파일 없음·읽기 실패
- `EW_BUFFER` 반복 후 정상 진행
- 장시간 buffer stall
- Feed Hold
- RESET
- 사용자 취소
- CNC 네트워크 단절
- MQTT·Server 중단
- Agent 정상 종료와 비정상 종료
- PC 재부팅 후 자동 재개 금지

---

## 9. 미확정·차단 항목

| ID | 항목 | 상태 | 확인 방법 |
|----|------|------|-----------|
| U-01 | SB-20R2에서 `cnc_dncstart2` 지원 여부 | MC-002에서 항상 EW_REJECT(13) — 옵션 미활성 의심, 원인 미확정 | CNC 옵션 목록에서 DNC 운전(Data Server) 활성화 여부, Parameter 20 Ethernet DNC 채널 설정, CNC 화면 알람 확인 |
| U-02 | 별도 FOCAS 핸들 동시 사용 가능 여부 | 미확정 | 모니터링 유지 상태에서 DNC 핸들 연결 시험 |
| U-03 | Path1/Path2 동시 DNC 가능 여부 | 미확정 | CNC 옵션·Path별 실기기 시험 |
| U-04 | MEM→DNC 원격 전환 PMC 주소 | 미확정 | 래더·매뉴얼·실기기 확인 |
| U-05 | `cnc_dncend2` 종료 인수와 취소 정책 | 미확정 | FANUC API 자료 및 실기기 반환값 확인 |
| U-06 | 허용 파일 인코딩·EOB 형식 | 미확정 | 테스트 파일별 실행 결과 확인 |
| U-07 | Path2 rewind 실기 검증 여부 문서 불일치 | 미확정 | 과거 테스트 기록 및 재검증 |
| U-08 | 장비별 `3202#4` 비트 방향·비축 파라미터 읽기 | 코드 기준 `1=보호`, 실기 확인 필요 | CNC 화면 설정과 Agent raw byte 로그 대조 |

---

## 10. 완료 기준

아래 항목은 방향 전환 이전 FOCAS DNC 스트리밍의 역사적 완료 기준이다. 2026-09-28 이후 운영 구현 완료 여부는 `DNC-98`과 `docs/Scheduler.md`의 MEM 파일전송 기준으로 판단한다.

- [ ] Path1 DNC 스트리밍 정상 운전과 중단 시나리오 통과
- [ ] 기존 100ms PMC·인터락 감시가 DNC 중에도 유지됨
- [ ] Agent·서버·웹 상태가 동일한 세션 상태를 표시함
- [ ] PAUSE, CANCEL, RESET, 연결 끊김 정책이 실기기에서 검증됨
- [ ] Memory 모드 스케줄러 회귀 테스트 통과
- [ ] 지원하기로 한 Path2·혼합 운전 시나리오 통과
- [ ] 여러 설비 동시 운전과 장시간 테스트 통과
- [ ] 장애 후 자동 중간 재개가 발생하지 않음
- [ ] 설치·Windows 서비스·UPS·복구 절차가 문서화됨
- [ ] `BRIEFING.md`, `FOCAS_REFERENCE.md`, Scheduler 문서가 최종 구현과 일치함

---

## 11. 작업 이력

| 일시 | 작업 ID | 상태 변경 | 변경·확인 내용 | 검증 결과 | 다음 작업 |
|------|---------|-----------|----------------|-----------|-----------|
| 2026-08-30 | 문서 체계 | 신규 | DNC 구현 계획, 체크리스트, 테스트·완료 기준과 작업 기록 규칙 생성 | 문서 작성 | `DNC-00` 착수 승인 대기 |
| 2026-08-30 | Path1 저장소·호출 기반 | 코드 완료·실기기 대기 | 장비별 Path1 실제 업로드·조회·편집·삭제, START 전 행별 파일 중복·누락 검증 및 SHA-256 매니페스트, Agent 전용 핸들·스레드 DNC 호출 구현. PAUSE·RESUME·count 변경 시 재호출하지 않음 | Server build 성공, Web production build 성공, Agent Release build 성공. 실기기 미검증 | 짧은 Path1 프로그램으로 `start2→dnc2→end2`, Cycle Start 순서와 종료 인수 검증 |
| 2026-08-30 | Path1 저장소 화면 연결 | 원상복구 | 임시로 연결했던 `RepositoryBrowser` 표시를 제거하고 기존 스케줄러 화면으로 복구. 업로드 화면은 요구사항 재정리 후 별도 구현 예정 | 화면 연결 코드 제거 | 업로드 화면 구현 범위 협의 |
| 2026-08-30 | 업로드 경로 구조 협의 | 기록 완료 | 장비별 수동 경로 선택 대신 `{DNC_ROOT}\{machineId}\path1` 자동 경로, 전역 루트 설정, Path2 화면 제외 방향을 협의안으로 기록 | 문서 반영, 코드 변경 없음 | 업로드 화면 구성과 사용자 동작 확정 |
| 2026-08-30 | 데스크탑 업로드 모달 | 코드 완료·수동 확인 대기 | 설정 옆 아이콘, 복수 선택·드롭·붙여넣기, 실제 고정 경로 표시, O번호 확인·수정, 동일 번호 교체·건너뛰기, `.nc` 저장명 통일, ASCII 검사, 프로그램 코멘트·해시와 Scheduler/POP 스냅샷 구현 | DB `prisma db push` 성공, Prisma 직접 조회 성공, Server build 성공, Web production build 성공, Agent Release build 성공 | Edge/Chrome에서 복수 선택·드롭·탐색기 파일 붙여넣기와 실파일 교체 확인 |
| 2026-08-31 | DNC-70 프로그램 코멘트 표시 | 코드 완료·화면 확인 대기 | 코멘트 문자 제한 없이 리모트패널 EDIT, 파일트랜스퍼 CNC·PC 목록, DNC 업로드 대기·현재 목록을 `O번호 (코멘트)` 형식으로 통일. PC 저장소 NC 파일은 선두 8KB의 O-line 코멘트를 읽어 목록 API에 포함. 변경 파일: `packages/server/src/routes/files.ts`, `packages/web/src/components/filemanager/FileListPanel.tsx`, `packages/web/src/components/ncmonitor/ProgramListModal.tsx`, `packages/web/src/components/filemanager/DncProgramUploadModal.tsx`, `packages/web/src/pages/Transfer.tsx` | Server TypeScript build 성공, Web production build 성공, PC 저장소 API에서 `O0336 (GEAR-SCREW)` 등 실제 코멘트 응답 확인, 서버 재시작·health 정상. DNC DB에는 현재 비어 있지 않은 코멘트 데이터가 없어 해당 화면 실데이터 확인은 대기 | DNC 업로드에서 코멘트 입력 후 목록 즉시 표시와 모바일·데스크탑 줄임표 확인 |
| 2026-08-31 | DNC-70 장비 프로그램 코멘트 보완 | 코드·실기기 검증 완료 | `cnc_rdprogdir` V1이 O번호만 반환하는 실장비를 위해 O8000 미만 사용자 프로그램의 O-line 코멘트를 `cnc_upload3` 헤더에서 제한 시간 내 읽고 5분 캐시. V2/V3 블로킹 위험은 회피하며 업로드·삭제 성공 시 캐시 초기화. 변경 파일: `packages/agent/StarWebCNC.Agent/Focas/FocasDataReader.cs`, `FOCAS_REFERENCE.md` | Agent Debug/Release build 오류 0, Agent 4대 재배포·기동 확인, MC-002 PATH1 `O0336 (GEAR-SCREW)` 및 PATH2 `O0003 (GEAR-SCREW)` API 실응답 확인(각 약 2초 이내) | 리모트패널 EDIT·파일트랜스퍼 화면에서 최종 표시 육안 확인 |
| 2026-08-31 | DNC-75 프로그램 관리 개편 정의 | 요구사항 정의 완료·구현 예정 | 데스크탑 2열, 업로드 O-line 코멘트 편집, DNC 목록 선택·삭제, 체크 순서 기반 스케줄러 일괄 등록, 모드별 프로그램 존재 확인, 운전 중 업로드·대기 프로그램 편집, 해시 불일치 실행 차단, 모바일 제안과 단계별 체크리스트를 정의 | 문서 검토 및 기존 API·DB 구조 대조 완료, 코드 변경 없음 | 모바일 방식·권한 확정 후 데이터/API 단계부터 구현 |
| 2026-09-01 | DNC-75 프로그램 관리 개편 구현 | 핵심 코드 완료·실기기 대기 | 데스크탑 2열 관리, O-line 코멘트 추출·재작성, 용량·등록·변경 상태 목록, 일괄 삭제 보호, 선택 순서 기반 트랜잭션 등록, Memory/DNC 존재 표시, SHA-256 불일치·재동기화, 운전 중 Agent `QUEUE_UPDATE` 구현. DNC 목록 등록은 메인 DNC 모드에서만 허용. 변경 파일: `packages/server/src/routes/files.ts`, `packages/server/src/routes/scheduler.ts`, `packages/server/src/lib/dncRepository.ts`, `packages/web/src/components/filemanager/DncProgramUploadModal.tsx`, `packages/web/src/pages/Scheduler.tsx`, `packages/web/src/lib/api.ts`, `packages/web/src/stores/fileStore.ts`, `packages/web/src/stores/machineStore.ts`, `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`, `packages/agent/StarWebCNC.Agent/Mqtt/MqttService.cs` | Server build, Web production build, Agent Release build 오류 0. MC-003 임시 O7998로 O-line `O7998(NEW-COMMENT)`, 중복 2행 순서 등록, 등록 파일 삭제 차단, 편집 후 mismatch=true, 2행 재동기화 후 mismatch=false 확인 및 데이터 원복. 서버 보호 조건 반영 후 DNC 모드 MC-001에서도 임시 O7998 등록 성공 및 6행·저장소 0개로 원복. 1280×720 데스크탑 2열 육안 확인, 브라우저 콘솔 오류 없음. Server/Agent 재배포·health 정상 | 실제 DNC 운전 중 신규 업로드·대기 행 `QUEUE_UPDATE`, 현재 실행 파일 교체 차단과 다음 행 실행을 실기기 검증 |
| 2026-09-01 | DNC-76 O9000 보호 연동 | 코드·빌드 완료·실기기 대기 | 파라미터 `3202#4(NE9)`를 Agent에서 읽어 CNC 메모리 O9000~O9999를 목록에 유지하되 잠금·비활성화. CNC 열기·선택·업로드·다운로드·백업과 스케줄러 START를 차단한다. PC 공용·DNC 저장소 파일 관리와 스케줄러 등록은 허용한다. 확인 불가는 NC 입출력 시 안전상 차단. 변경 파일: `packages/agent/StarWebCNC.Agent/Focas/FocasDataReader.cs`, `packages/agent/StarWebCNC.Agent/Commands/CommandHandler.cs`, `packages/server/src/lib/programProtection.ts`, `packages/server/src/routes/files.ts`, `packages/server/src/routes/scheduler.ts`, `packages/web/src/components/filemanager/FileListPanel.tsx`, `packages/web/src/components/filemanager/DncProgramUploadModal.tsx`, `packages/web/src/components/ncmonitor/ProgramListModal.tsx`, `packages/web/src/pages/Transfer.tsx`, `packages/web/src/pages/Scheduler.tsx`, `packages/web/src/stores/fileStore.ts`, `FOCAS_REFERENCE.md` | Server TypeScript build 성공, Web production build 성공, Agent Release build 오류 0(`EnableDefaultNoneItems/ContentItems=false`로 기존 재귀 publish 산출물 제외). 실기기 미검증 | 장비별 3202 raw byte·반환 코드와 CNC 화면 보호 상태 대조, NE9 1/0에서 목록·명령 동작 확인 |
| 2026-09-01 | DNC-77 스케줄러 프로그램 번호 표시 보완 | 코드·빌드 완료·실기기 대기 | 메인 프로그램 미존재 표시를 빨간색 원으로 통일하고, Memory 서브 프로그램을 Path2 NC 목록과 비교해 초록색·빨간색 원으로 표시. 메인·서브 입력은 Tab 이동 또는 포커스 해제 시 4자리로 보정하여 저장. 변경 파일: `packages/web/src/pages/Scheduler.tsx`, `docs/DNC.md` | Server TypeScript build 성공, Web production build 성공, `git diff --check` 오류 없음. 실기기·화면 검증 미수행 | Path1·Path2 실제 목록과 표시 대조, `20` 입력 후 Tab 이동 시 `O0020` 저장·표시 확인 |
| 2026-09-02 | DNC-70 O9000 코멘트 보완 | 코드·빌드 완료·실기기 대기 | 원인 확인: `FocasDataReader.EnrichProgramComments()`가 `program.Number < 8000`만 대상으로 코멘트를 조회해 O9000~O9999는 항상 코멘트가 비어 있었음(2026-08-31 DNC-70에서 "사용자 프로그램"만 대상으로 의도적으로 걸어둔 경계였고, 하루 뒤 DNC-76이 O9000을 목록에 노출시키면서 간극이 생김). 조건을 `program.Number < 8000 || program.Number >= 9000`으로 확장해 O8000~O8999(매크로 영역)는 계속 제외하고 O9000~O9999만 포함. 변경 파일: `packages/agent/StarWebCNC.Agent/Focas/FocasDataReader.cs`. 부수 조치: Agent 빌드를 막던 `packages/agent/StarWebCNC.Agent/publish/publish/...`(23단계 자기 자신 재귀 복사, 코드 변경과 무관한 기존 산출물 손상) 삭제 — 최상위 `publish/`(실제 배포본)는 유지 | Agent Release build 오류 0·경고 0(정리 후 재빌드로 확인). Agent 재배포·실기기 미검증(4대 라이브 Agent가 실기기 연결 중이라 재시작 보류) | 재배포 시점 확정 후 4대 Agent 재빌드·재시작, O9000 프로그램 코멘트가 리모트패널/파일트랜스퍼/DNC 목록에 정상 표시되는지 실기기 확인 |
| 2026-09-03 | DNC-70 O9000 코멘트 보완 재배포 | 배포 완료·실기기 화면 확인 대기 | 4대 Agent(AGENT-001~004 / MC-001~004) 모두 `Stop-Process -Force` 종료 → 재빌드 DLL을 `packages/agent/StarWebCNC.Agent/publish/`에 교체 → 원래 커맨드라인(AgentId/MachineId/TemplateId/Cnc IP)으로 재기동. 재기동 직후 MC-001·MC-003(ping·8193 모두 무응답)과 MC-004(ping은 응답, 8193 무응답)는 CNC 연결 실패 로그 발생, MC-002만 연결 성공 및 정상 동작 로그(OPMSG-PROBE, ALARM-SNAPSHOT) 확인. 사용자 확인 결과 MC-002만 실제 실기기와 연결된 설비이고 나머지 3대는 애초에 연결 대상 실기기가 없는 구성이라 연결 실패가 정상 상태임을 확인 | Agent 4대 프로세스 정상 기동 확인(PID 갱신), MC-002 CNC 연결·정상 텔레메트리 확인. O9000 코멘트 표시 자체는 아직 화면에서 육안 확인 전 | MC-002에 O9000~O9999 프로그램이 있으면 리모트패널 EDIT·파일트랜스퍼·DNC 목록에서 코멘트가 정상 표시되는지 실기기 화면 확인 |
| 2026-09-03 | 스케줄러 인터락 오탐 (DNC 모드 START 차단) | 배포 완료·실기기 재현 검증 대기 | MC-002에서 DNC 모드 스케줄러 START 시 인터락 알람으로 계속 거부되는 문제 조사. 탑바 pill은 초록불인데 스케줄러만 실패하는 것을 근거로 원인 추적 → `SchedulerManager.CheckInterlock()`/`CommandHandler.CheckInterlock()`/`DataCollectorService.DetectM20EdgeSync()` 3곳 모두 R영역 전용 `ReadPmcR()`을 사용해, MC-002 스케줄러 인터락에 걸린 `X47.5`(머시닝 모드)·`Y1.6`(비가동중) 같은 비R타입 주소를 엉뚱한 R영역으로 읽고 있었음(탑바 pill은 타입 인식 `ReadPmcBit()`를 써서 정상 표시). 3곳 모두 `ReadPmcBit()` 사용으로 통일. `KNOWN_MISTAKES.md`에 M-22로 기록. 변경 파일: `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`, `packages/agent/StarWebCNC.Agent/Commands/CommandHandler.cs`, `packages/agent/StarWebCNC.Agent/Collectors/DataCollectorService.cs`, `KNOWN_MISTAKES.md`. 4대 Agent 재빌드·재배포(`Stop-Process -Force` → DLL 교체 → 원 커맨드라인 재기동) 완료, MC-002 CNC 재연결·정상 동작 로그 확인 | Agent Release build 오류 0, 4대 재기동 확인. MC-002 실기기 재테스트로 인터락 오탐 해소 확인(사용자 확인) | 인터락은 해결, 이어서 DNC_MODE_INVALID 오류 발생 — DNC-91로 후속 기록 |
| 2026-09-03 | DNC-91 DNC 모드 aut 코드값 정정 (9→10) | 코드·빌드 완료·재배포 대기 | 인터락 수정 후 MC-002 DNC 모드 START 재시도 시 `DNC_MODE_INVALID` 오류로 정지. 로그: `현재 aut=10`. `SchedulerManager`의 DNC 모드 확인 로직 2곳(`StartRowExec`의 mainMode=="dnc" 분기, dead code인 `StartRowDnc()`)이 모두 `status.Aut != 9`를 "DNC 아님" 판정 기준으로 하드코딩하고 있었음 — 실기기 확인 결과 9=REF(원점복귀), 10=RMT(DNC/원격운전)로 확인되어 `!= 9` → `!= 10`으로 정정. `KNOWN_MISTAKES.md`에 M-23으로 기록, 본 문서 3절의 `aut == 9` 기재도 정정. 변경 파일: `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`, `docs/DNC.md`, `KNOWN_MISTAKES.md` | Agent Release build 오류 0. 재배포·실기기 검증 전 | Agent 재배포 후 MC-002 DNC 모드 스케줄러 START가 인터락·모드 오류 없이 실제로 프로그램을 실행하는지 실기기 확인 |
| 2026-09-06 | DNC-92 Path1 단독 DNC 테스트 화면 | 코드·빌드 완료·실기기 대기 | 데스크탑 Machines 메뉴에 DNC Test 화면을 추가하고 프로그램 번호 입력, 고정 Path1 파일·코멘트·용량 확인, 제어권·스케줄러·CNC 상태 표시, 확인 팝업, 단독 시작·중지와 상세 오류 표시를 구현. 서버는 스케줄러 `IDLE`, 제어권, O9000 보호, 파일 중복·누락과 SHA-256을 검사하고 `DNC_TEST_START/STOP/STATUS`를 전달. Agent는 공유 DNC 서비스에 세션 상태를 추가하고 `aut=10`, `run=0`, Cycle Start 주소를 확인한 뒤 Path1 세션과 사이클 스타트 1회를 실행하며 단독 세션만 취소하도록 보호. 변경 파일: `packages/web/src/pages/DncTest.tsx`, `packages/web/src/App.tsx`, `packages/web/src/components/Layout.tsx`, `packages/web/src/lib/api.ts`, `packages/server/src/routes/dncTest.ts`, `packages/server/src/index.ts`, `packages/agent/StarWebCNC.Agent/Commands/CommandHandler.cs`, `packages/agent/StarWebCNC.Agent/Dnc/DncStreamingService.cs` | Server TypeScript build 성공, Web production build 성공, Agent Release build 오류 0(기존 FOCAS 바인딩 경고 328개), 실기기 미검증 | 서버·웹·Agent 재배포 후 MC-002에서 DNC/RMT·STOP 상태로 단독 실행하여 `cnc_dncstart2` 반환 코드와 실제 가공 시작 여부 확인. 기존 `EW_REJECT(13)`이 재현되면 스케줄러 외 CNC 옵션·채널 조건 문제로 범위를 축소 |
| 2026-09-15 | DNC-93 모바일 단독 DNC 테스트 화면 | 코드·빌드 완료·모바일 실기기 대기 | 모바일 Machines 메뉴의 DNC Test 제한을 해제하고, 휴대폰 세로 1열·휴대폰 가로 및 태블릿 2열 반응형 배치, 터치용 56px 실행·중지 버튼, 하단 고정 실행 영역, 장비명·프로그램 번호·파일명을 크게 표시하는 실행 확인 모달과 safe-area 여백을 적용. 서버·Agent의 제어권, 스케줄러 IDLE, DNC/RMT, STOP, 파일 검증과 실제 PMC 출력 로직은 변경하지 않음. 변경 파일: `packages/web/src/components/Layout.tsx`, `packages/web/src/pages/DncTest.tsx` | Web production build 성공, TypeScript 오류 없음. 실제 Android·iPhone·태블릿 및 MC-002 동작 미검증 | 모바일 브라우저 새로고침 후 메뉴·세로/가로 배치 확인, MC-002에서 실행 확인 모달과 기존 `EW_REJECT(13)` 표시 여부 검증 |
| 2026-09-28 | DNC-98 MEM 파일전송 방식 전환 정의 | 설계 확정·문서 반영·코드 미구현 | Embedded Ethernet 환경의 FOCAS DNC 스트리밍을 운영 적용에서 보류하고 MEM 기반 `파일전송/CNC 저장` 공급 방식으로 전환. 원본 O번호·코멘트 보존, 설비별 메인·서브 실행용 임시 번호와 삭제 전 전환 번호, 시작 전 잔존 조건부 삭제, 최종 Path2Only 후 안전 삭제, P10002 OFF 고정, P10000/#900 표시 동기화와 기존 M20 count authority 유지 정책을 정의. 변경 파일: `BRIEFING.md`, `docs/DNC.md`, `docs/Scheduler.md`, `docs/scheduler-state-machine.md` | `git diff --check`에서 문서 공백 오류 없음. 코드·빌드·실기기 검증 미실행 | DNC-98 구현 브리핑과 승인 후 설정 모델·Agent 프로그램 준비/정리 상태부터 구현 |
| 2026-09-28 | DNC-98 MEM 파일전송 방식 전환 구현 | 구현 완료·테스트 대기 | `CNC 저장/파일전송` 메인·서브 독립 설정, 설비별 임시·대피 O번호, Path별 START 매니페스트, P10002 OFF 검증, 잔존 임시 조건부 삭제, 원본 O-line 코멘트 유지 번호 변환·전송, 최종 Path2Only 후 STOP 확인·대피·삭제를 구현. 변경 파일: `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`, `packages/agent/StarWebCNC.Agent/Focas/FocasDataReader.cs`, `packages/agent/StarWebCNC.Agent/Mqtt/MqttService.cs`, `packages/agent/StarWebCNC.Agent/Template/TemplateModel.cs`, `packages/server/src/lib/dncRepository.ts`, `packages/server/src/routes/machines.ts`, `packages/server/src/routes/scheduler.ts`, `packages/web/src/pages/Scheduler.tsx`, `packages/web/src/pages/SchedulerConfig.tsx`, `packages/web/src/pages/TemplateEditor.tsx`, `packages/web/src/stores/machineStore.ts`, `packages/web/src/stores/templateStore.ts`, `packages/web/src/lib/api.ts` | Server TypeScript build 성공, Web production build 성공, Agent Debug build 오류 0·경고 0. 실기기·화면 수동 검증 미실행 | 설정 화면 육안 확인 후 MC-002에서 Path1 파일전송 1행 → Path2 파일전송 → 혼합 모드 순으로 임시 O번호 전송·실행·최종 삭제 검증 |
| 2026-09-29 | DNC 테스트·스트리밍 기능 정리 | 제거 완료·문서 보존 | DNC Test 메뉴·화면·API, Agent `DNC_TEST_*` 명령, 전용 스트리밍 서비스·FOCAS 래퍼와 Scheduler 잔여 DNC 분기를 제거. MC-002 DNC 전용 런타임·백업 폴더와 전용 시작 스크립트 삭제. 테스트 환경·`EW_REJECT(13)`·`SR1807`·옵션 진단 결과는 본 문서에 보존 | Server TypeScript build 성공, Web production build 성공, Agent Debug·Release build 오류 0(기존 FOCAS 바인딩 경고 328개). 공용 publish 배포·재실행은 미수행 | 최신 Agent를 공용 publish에 배포한 뒤 기존 `start-all.bat`만 사용 |

작업 이력에는 완료된 결과뿐 아니라 실패한 시도, 실기기 반환 코드, 설계 변경 이유도 남긴다.

---

## 12. 관련 코드와 문서

### Agent

- `packages/agent/StarWebCNC.Agent/Collectors/DataCollectorService.cs`
- `packages/agent/StarWebCNC.Agent/Collectors/SchedulerManager.cs`
- `packages/agent/StarWebCNC.Agent/Focas/FocasConnection.cs`
- `packages/agent/StarWebCNC.Agent/Focas/FocasDataReader.cs`
- `packages/agent/StarWebCNC.Agent/Commands/CommandHandler.cs`
- `packages/agent/StarWebCNC.Agent/Mqtt/MqttService.cs`

### Server / Web

- `packages/server/src/routes/scheduler.ts`
- `packages/server/src/routes/machines.ts`
- `packages/server/src/routes/files.ts`
- `packages/server/src/lib/dncRepository.ts`
- `packages/web/src/components/filemanager/RepositoryBrowser.tsx`
- `packages/web/src/pages/Scheduler.tsx`
- `packages/web/src/stores/machineStore.ts`

### FOCAS / 문서

- `libs/focas/Fwlib64.h`
- `libs/focas/fwlib64.cs`
- `FOCAS_REFERENCE.md`
- `BRIEFING.md`
- `docs/Scheduler.md`
- `docs/scheduler-state-machine.md`
