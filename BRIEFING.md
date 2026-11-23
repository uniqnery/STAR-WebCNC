# BRIEFING.md

## 현재 개발 방향

- Star-WebCNC는 고객사별 일회성 커스텀 개발보다 설치형 기성 소프트웨어에 가깝게 완성한다.
- 업체별 차이는 코드 분기보다 설정, 템플릿, 기능 활성화 옵션으로 흡수하는 방향을 우선한다.
- 내부 개발/테스트 단계에서는 무선 네트워크를 사용할 수 있으나, 고객사 설치 기준은 유선 LAN 구성을 기본으로 한다.
- 서버 PC는 필요 시 인터넷망과 설비망을 분리하는 dual NIC 구성을 권장한다.
- 다중 설비 제어는 설비별 Agent, 설비별 MQTT topic, 설비별 설정을 기준으로 분리한다.
- MC-002의 Embedded Ethernet 환경에서는 현재 `cnc_dncstart2` 기반 DNC 스트리밍을 운영 기능으로 사용하지 않는다. 스케줄러는 MEM 모드에서 `파일전송` 또는 `CNC 저장` 프로그램을 실행하는 방향으로 전환한다.

## 최근 결정사항

- 2026-11-23 웹앱 설정에 `Windows 로그인 시 자동 시작`을 추가했다. HQ_ENGINEER만 변경하고 ADMIN은 상태를 조회한다. 현재 서버 Windows 사용자의 일반 권한 로그인 예약 작업으로 Docker·인프라·API·웹앱·설비별 Agent와 활성 카메라 파일럿을 준비 상태에 따라 기동한다. PC 전원 인가만으로 시작하는 Windows 서비스 방식과 자동 로그인 설정은 포함하지 않는다. 설정 해제 시 실행 중인 서비스는 유지한다. 상세 절차와 로그 위치는 `STARTUP.md`에 통합했다.
- AI 작업 규칙 문서는 `AGENTS.md`와 `CLAUDE.md`로 유지한다.
- 전체 프로젝트 구성과 현재 방향은 이 문서(`BRIEFING.md`)를 중심으로 관리한다.
- `BRIEFING.md`는 매 작업마다 전체 정독하는 문서가 아니라, 방향성 판단이 필요한 작업에서 우선 확인하는 중심 문서로 사용한다.
- `docs/` 아래 문서는 특정 기능 상세 또는 과거 요약 문서로 보고, 상시 읽기 대상이 아니라 필요할 때 참조한다.
- FANUC FOCAS 통신 참고 문서는 `FOCAS_REFERENCE.md`로 별도 관리한다.
- 기존 DNC 구현 계획과 실기기 검증 이력은 `docs/DNC.md`에 보존한다. 2026-09-28 이후 신규 기준은 MEM 기반 파일전송 실행이며 상세 설계는 `docs/Scheduler.md`와 `docs/scheduler-state-machine.md`에서 관리한다.
- 프로그램 저장소는 `PROGRAM_REPOSITORY_ROOT\{machineId}\path1` 고정 규칙을 사용하고 복수 선택·드롭·붙여넣기, O번호·코멘트·SHA-256 메타데이터와 스케줄러 일괄 등록 기능을 유지한다. 구 DNC 명칭의 API·MQTT·localStorage 키는 전환기 호환에만 사용한다.
- 파일전송 방식은 저장소의 원본 O번호·코멘트를 보존하되 CNC에는 설비별 실행용 임시 O번호로 전송한다. 시작 전 잔존 임시 프로그램을 조건부 삭제하고, 행의 메인·Path2Only 시퀀스가 모두 끝난 후 삭제 전 전환 프로그램으로 선택을 바꾼 뒤 임시 프로그램을 삭제한다. 가동 이력에는 임시 번호가 아닌 원본 번호·코멘트를 기록한다.
- 메인과 서브 프로그램은 각각 `파일전송` 또는 `CNC 저장` 방식을 선택한다. 설비별로 메인·서브 실행용 임시 번호와 삭제 전 전환 프로그램 번호를 설정하고, O9000 보호·번호 중복·전환 프로그램 존재 여부를 START 전에 검증한다.
- 스케줄러 count authority는 계속 Agent로 유지한다. 첫 M20은 제외하고 유효 M20마다 PC count를 증가시키며 `count == preset - 1`에서 원사이클 스톱을 켠다. M20 펄스 누락 가능성은 알려진 제한사항으로 남기고 래치+ACK 개선은 후속 검토한다.
- 템플릿에서 PRESET, COUNT, 설비 자체 카운트 ON/OFF 변수 종류·번호와 ON/OFF 값을 관리한다. SR-20J2B 기본값은 P10000, #900, P10002이며 스케줄러 시작 시 P10002를 0으로 만들고 종료·정지·PAUSE 후에도 복원하지 않는다. 모든 모니터링 화면은 스케줄러 상태와 무관하게 CNC 변수값만 읽어 표시한다.
- 장비 파라미터 `3202#4(NE9)`가 보호 상태이면 CNC 메모리의 O9000~O9999를 목록에서 숨기지 않고 잠금·비활성 표시한다. CNC 선택·열기와 PC↔CNC 입출력·백업·실행은 차단하되 PC 공용 저장소와 DNC 저장소의 파일 관리·스케줄러 등록은 허용한다. 보호 상태 확인 실패도 NC 입출력 시에는 안전상 차단하며 상세 상태는 `docs/DNC.md`의 DNC-76을 기준으로 관리한다.
- 2026-09-29 DNC Test 화면·API·Agent 명령과 전용 스트리밍 서비스는 제거했다. 테스트 조건과 `EW_REJECT(13)`, `SR1807` 결과는 `docs/DNC.md`에 역사 기록으로만 보존한다.
- MC-002는 프로그램 번호, 블록 번호, 실행 코드 줄, 축 좌표를 매 텔레메트리에서 읽는 버전을 운영 기준으로 확정한다. 수집 주기는 텔레메트리 220ms, 상세 정보 750ms, 화면용 PMC 1000ms, M20·스케줄러 확인 100ms로 설정한다. 실기기에서 좌표 메시지 수신 간격 중앙값 249ms와 Path 1 실행 코드 내용 변경 간격 중앙값 415ms를 확인했다. 스케줄러 운전 중 M20 검출은 별도 검증이 필요하다.
- 새 문서를 계속 늘리기보다 기존 문서에 통합하는 것을 우선한다.
- 작업 진행상황(예정/진행 중/완료)은 섹션 4(기능 표)·섹션 6(백로그)에 작업 시작 시 등록, 완료 시 갱신하는 방식으로 지속 관리한다.

## 진행 중인 개발 항목

- 스케줄러 기반 다중 설비 작업 실행 구조 정리
- MEM 기반 파일전송/CNC 저장 실행 구조 실기기 검증
- 고객사 설치형 소프트웨어 방향 정리
- 유선 LAN 기준 서버 PC, 스위칭 허브, 장비별 허브, 카메라 연결 구성 검토
- 카메라 재접속·동시 시청 개선 검증 중. `192.168.0.60` 한 대를 별도 MediaMTX/WebRTC로 시험하며 운영 MJPEG 경로를 유지한다. 파일럿 구성은 `docker/docker-compose.camera-pilot.yml`과 `docker/mediamtx.camera-pilot.yml`에 둔다. 2026-11-13 로컬 WebRTC 클라이언트 3개 동시 수신과 1·5·15초 뒤 재진입에서 동일 RTSP 원본을 유지했다. 재진입 시 첫 영상 패킷은 1.09~1.13초, 첫 IDR 시작 패킷은 6.96~10.94초였다. 브라우저 렌더링, 카메라 전원 재인가, PMC·오프셋 응답 시간 검증은 남아 있다.
- 2026-11-13 모바일 웹앱의 `.60` 카메라에 로그인으로 보호된 HLS 파일럿을 적용했다. 공유 인코더가 960×540, 15fps, 1초 키프레임으로 변환한다. HLS 재생 오류 또는 6.5초 내 재생 시작 실패 시 MJPEG로 복귀하며, API 환경 변수 `CAMERA_HLS_PILOT=0`으로 HLS를 끌 수 있다. 기존 HTTPS 주소에서 로그인 보호, 시청 요청 3개, 영상 조각의 첫 프레임 디코딩을 확인했다.
- 같은 날 `.60` 파일럿을 1280×720·20fps와 200ms 부분 조각을 사용하는 저지연 HLS로 전환했다. 기존 HTTPS 주소에서 인증, 저지연 목록 요청 전달, 부분 조각 수신과 첫 프레임 디코딩을 확인했다. 휴대폰에서 첫 화면과 실시간 영상 지연은 실측 대기다.
- 카메라 활성화 상태는 DB의 `camera.configs`에 저장한다. 현재 `.60`을 활성화하고 `.61`~`.63`은 비활성화했다. 미디어 컨테이너는 별도 Compose 프로젝트 `star-webcnc-camera-pilot`으로 운영하며, Docker 기동 시 `unless-stopped` 정책에 따라 재시작한다. 컨테이너를 다시 만들 때는 등록된 카메라의 RTSP 주소를 `CAMERA_PILOT_RTSP_URL`로 제공한다. 이 값에는 카메라 자격증명이 포함될 수 있으므로 저장소에 넣지 않는다. 초기 기동 배치와 PC 재부팅 후 전체 복구는 별도 검증이 필요하다.

## 앞으로 개발할 항목

- Windows 로그인 자동 시작의 실제 PC 재부팅 검증 및 모바일 설정 화면 조작 검증. 현재 예약 작업 수동 실행과 실제 API 활성화·해제/권한/중복 실행 검증은 완료했다.
- MEM 기반 `삭제 → 전송 → 실행 → Path2Only → 삭제` 시퀀스 Path1·Path2·혼합 모드 실기기 검증
- PRESET/COUNT/P10002 모니터링 표시값과 스케줄러 전송값 실기기 대조
- feature flag 또는 site config 기반 기능 활성화 구조 설계
- 템플릿 capabilities와 UI/API/Agent 권한 제한의 일관 적용
- 설치형 초기 설정 절차 정리
- 고객사 네트워크 설치 가이드 정리
- FANUC FOCAS 공통 참고 문서 지속 갱신

## 상세 문서 참조 기준

- 스케줄러 작업: `docs/Scheduler.md`, `docs/scheduler-state-machine.md`
- 설비 관리 화면 또는 설비 설정 작업: `docs/MachineAdmin.md`
- SIMTOS 데모/전시 관련 작업: `docs/Simtos.md`
- FOCAS, CNC 통신, PMC, 알람, 프로그램 관련 작업: `FOCAS_REFERENCE.md`를 먼저 확인하고 관련 Agent/Focas 코드를 함께 확인
- DNC 관련 작업: `FOCAS_REFERENCE.md`와 `docs/DNC.md`를 확인하고, 진행 상태와 검증 결과는 `docs/DNC.md`에 기록
- 과거 상세 아키텍처 추적: `architecture.md`

---
# Star-WebCNC 프로젝트 브리핑 문서

> 작업 시작 전 반드시 이 문서를 읽고 현재 상태를 파악할 것.
> 코드 작업 전 `KNOWN_MISTAKES.md`의 체크리스트도 함께 확인.

---

## 1. 프로젝트 개요

**프로젝트명**: Star-WebCNC  
**목적**: FANUC CNC 공작기계(자동선반)를 웹 기반으로 원격 모니터링·제어·스케줄링하는 산업용 MES/SCADA 시스템

### 폴더 구조

```
c:\Star-WebCNC\
├── packages/
│   ├── web/                     # React 18 프론트엔드
│   │   └── src/
│   │       ├── pages/           # 15개 페이지
│   │       ├── components/      # 재사용 컴포넌트 (NCMonitor, CameraStream 등)
│   │       ├── stores/          # Zustand 상태 관리 (6개 스토어)
│   │       └── lib/             # API 클라이언트, WebSocket 싱글턴
│   ├── server/                  # Node.js Express 백엔드
│   │   └── src/
│   │       ├── routes/          # 15개 API 라우트
│   │       ├── lib/             # mqtt, websocket, prisma, redis 클라이언트
│   │       ├── auth/            # JWT 발급/검증
│   │       └── prisma/          # schema.prisma, migrations, seed.ts
│   └── agent/
│       └── StarWebCNC.Agent/    # C# .NET 8 FOCAS2 에이전트
│           ├── Collectors/      # DataCollectorService (메인 수집 루프)
│           ├── Commands/        # CommandHandler (NC 명령 처리)
│           ├── Configuration/   # AgentSettings, appsettings.json
│           ├── Focas/           # FocasConnection, FocasDataReader
│           ├── Mqtt/            # MqttService
│           └── Template/        # TemplateModel, TemplateLoader
├── KNOWN_MISTAKES.md            # 반복 실수 방지 규칙 (M-01~M-21)
├── BRIEFING.md                  # 이 파일
└── start-all.bat / start-dev.bat
```

---

## 2. 아키텍처

### 4-Tier 전체 흐름

```
[Browser / React]
     ↕ REST API (HTTP)
     ↕ WebSocket (실시간 텔레메트리·알람·이벤트)
[Node.js Express Server]
     ↕ MQTT (star-webcnc/agent/{machineId}/...)
     ↕ PostgreSQL (Prisma ORM)
     ↕ Redis (캐시, 제어권 관리)
[C# .NET 8 Agent]  — 1 Agent = 1 CNC
     ↕ FOCAS2 (FANUC 전용 CNC 통신 라이브러리)
[FANUC CNC 장비]
```

### MQTT 토픽 구조 (장비 ID 기준 분리)

```
star-webcnc/agent/{machineId}/status          Agent → Server
star-webcnc/agent/{machineId}/telemetry       Agent → Server
star-webcnc/agent/{machineId}/pmc_bits        Agent → Server (100ms)
star-webcnc/agent/{machineId}/alarm           Agent → Server
star-webcnc/agent/{machineId}/command/result  Agent → Server
star-webcnc/agent/{machineId}/event           Agent → Server

star-webcnc/server/command/{machineId}        Server → Agent
star-webcnc/server/scheduler/{machineId}      Server → Agent
```

### 기술 스택

| 레이어 | 기술 |
|--------|------|
| **Frontend** | React 18.2, TypeScript 5.3, Vite 5.0, Zustand 4.5, Tailwind CSS 3.4, Recharts 2.10, Axios 1.6 |
| **Backend** | Node.js, Express 4.18, Prisma 5.9, PostgreSQL (TimescaleDB), Redis (ioredis 5.3), MQTT 5.3, WebSocket (ws 8.16), JWT (jsonwebtoken 9.0), Zod, FFmpeg (ffmpeg-static 5.3) |
| **Agent** | .NET 8.0 (win-x64), MQTTnet 4.3, FOCAS2 (Fwlib64.dll), Microsoft.Extensions.Hosting |
| **인프라** | Docker (PostgreSQL + Mosquitto MQTT 브로커), Redis (native 실행), Windows 배포 |

---

## 3. 현재 구현 완료된 기능

### 인증 / 사용자 관리
- JWT 기반 로그인/로그아웃 (access 15분, refresh 7일)
- 역할: `USER`, `HQ_ENGINEER`, `ADMIN`
- 회원가입 승인 흐름 (isApproved 플래그)
- HQ_ENGINEER 등록 코드 (`hq1234`)

### 설비 관리
- 설비 등록 / 삭제 (MachineAdmin.tsx)
- 설비 목록 조회, 실시간 온라인/오프라인 상태 표시
- 제어권 획득/해제/연장 (Redis 기반, 세션 단위)
- ⚠️ 설비 **편집(IP·이름 등 수정)** 미구현 — 항목 5 참조

### 실시간 모니터링
- FOCAS2 → Agent → MQTT → Server → WebSocket → 브라우저 경로
- 텔레메트리: 좌표, 이송속도, 주축 RPM, 프로그램 번호 등 (500ms)
- PMC 비트: 램프·인터락 신호 (100ms, 별도 `pmc_bits` 토픽)
- 알람: 실시간 발생/해제, 이력 조회

### NC 모니터 (NCMonitor 컴포넌트)
- 좌표 / 상태 탭 (Path1, Path2)
- 오프셋(Wear Offset) 탭 — 읽기/쓰기
  - ⚠️ IDLE 상태에서 쓰기 미동작 이슈 있음 — 항목 5 참조
- 카운터 탭 — 읽기/쓰기
- 공구수명 탭 — 읽기/쓰기
- 카메라 탭

### 스케줄러
- 큐 기반 NC 프로그램 자동 실행 (SchedulerManager 상태 머신)
- 상태: IDLE / RUNNING / PAUSED / ERROR
- 행 추가/편집/삭제/순서 변경, 가동 중 행 추가 허용
- Path2Only 모드, 원사이클 스톱 지원
- M20 이벤트 기반 카운트 증가

### 파일 전송 (DNC)
- Repository / Share 저장소 파일 관리
- NC 프로그램 업로드(PC→CNC) / 다운로드(CNC→PC)
- DNC 가동 중 Repository 읽기 전용 잠금

### 카메라
- RTSP → FFmpeg → MJPEG 스트림 프록시
- 카메라 설정 (IP, 포트, RTSP 경로, 인증)
- 장비별 카메라 매핑
- FFmpeg stdout 워치독 (10초 무데이터 → 강제 재시작)
- 스트림 중복 방지 (force=true 강제 교체)

### 인터락 / 템플릿
- 템플릿 기반 PMC 인터락 설정 (페이지별 topBarInterlock)
- 탑바 인터락 pills 실시간 표시
- PMC 메시지 AlarmStrip 표시
- ExtraPmcAddrs 파이프라인 (커스텀 PMC 주소 수집)

### Simtos 2026 모드
- 제품 카드 롱프레스 → NC 프로그램 변경 + 사이클 스타트
- 제어권/인터락 미충족 시 팝업 경고
- 태블릿 전용 반응형 레이아웃 (xl: 1280px 기준 분기)

### Monitoring 페이지
- NC 모니터(좌) + 카메라(우) + 이벤트 로그(하단) 3분할
- 모바일 portrait 탭 바 + 스와이프 제스처

### 기타
- 감사 로그 (AuditLog)
- 생산 통계 / POP 화면
- 작업 지시서 (WorkOrder)
- 백업 관리
- 진단 페이지 (서비스 상태, Agent ping)
- 팩토리 뷰 (설비 배치 레이아웃)
- 인터락 에디터 (페이지별 인터락 설정 UI)

---

## 4. 미구현 / 진행 중인 기능

| 항목 | 상태 | 비고 |
|------|------|------|
| Windows 로그인 시 자동 시작 설정 | 구현·수동 기동 검증 완료 | 실제 재부팅/모바일 조작 검증 대기. HQ_ENGINEER 변경, 실제 예약 작업 상태 반영. `STARTUP.md` 참조 |
| 설비 편집 UI | ✅ 완료 | 편집 버튼 + 모달. IP 변경 경고 포함 |
| Offset IDLE 쓰기 | ⚠️ 이슈 | RUNNING 시만 동작. 항목 5 참조 |
| MQTT 브로커 주소 환경변수 외부화 | ⚠️ 부분 | .NET 이중언더스코어(`Agent__Mqtt__Host`) 방식은 동작하나 `MQTT_BROKER_HOST` 커스텀 이름 미지원 |
| 다중 CNC Agent 내 처리 | ❌ 미구현 | 현재 1 Agent = 1 CNC. 다중은 Agent 다중 실행으로 대응 |
| TemplateEditor Section 8 (스케줄러 설정 UI) | ❌ 미구현 | 백엔드/Agent 스케줄러 설정 구조는 완성됨 |
| cameraApi.create/update/delete (api.ts) | ⚠️ 미확인 | `cameraApi`에 WebRTC 관련 메서드가 남아있음 (실제 서버는 MJPEG만 지원) |
| PC→CNC 업로드 O번호 지정 + 덮어쓰기 확인 | 🔧 구현완료·테스트 대기 (2026-08-17) | 웹(Transfer.tsx)/서버(files.ts)/Agent(CommandHandler.cs, FocasDataReader.cs) 코드 완료. Agent 재빌드·재시작 및 실기기 검증 전. 상세: BACKLOG-07 |

---

## 5. 현재 알려진 이슈

### [I-01] ~~설비 편집 UI 미구현~~ ✅ 완료 (2026-05-02)

- `machineApi.update()` 추가 (`api.ts`)
- 편집 버튼(연필 아이콘) + 편집 모달 추가 (`MachineAdmin.tsx`)
- IP 변경 시 Agent 재시작 필요 경고 배너 표시
- 권한: HQ_ENGINEER + ADMIN 모두 허용

### [I-02] Offset 쓰기 IDLE 상태에서 미동작

- **증상**: NC 모니터 오프셋 탭에서 값 입력 시 RUNNING 중에는 정상 반영, IDLE 상태에서는 값이 전송되지 않음. RUNNING 진입 후 전송되는 것처럼 보임.
- **추정 원인**: FANUC `cnc_wrmacro`가 시스템 매크로 변수(#2001~#2464)를 AUTO 실행 상태 외에서는 내부적으로 차단하거나 무시하는 CNC 사양 특성
- **현재 코드**: `FocasDataReader.cs` `WriteWearOffset()` → `cnc_wrmacro()` — 실행 상태 사전 체크 없음
- **수정 방향 (미적용)**: 에이전트에서 run 상태 사전 체크 후 IDLE이면 즉시 WRITE_FAILED 반환 + 프론트 에러 피드백 추가

### [I-03] MQTT 브로커 주소 환경변수 비표준

- **현재 동작**: Agent는 .NET IConfiguration 기본 메커니즘(`Agent__Mqtt__Host`)으로만 오버라이드 가능
- **미구현**: 커스텀 이름(`MQTT_BROKER_HOST`) 환경변수를 명시적으로 읽는 코드 없음
- **영향 범위**: 다중 Agent 배포 시 각 Agent 설정 파일을 직접 수정해야 함

---

## 6. 다음 작업 예정 / 백로그

### Windows 자동 시작 후속 검증 (2026-11-23)

- 웹 설정·로그인 예약 작업·준비 대기 및 중복 기동 방지 구현과 수동 기동 시험 완료.
- 실제 Windows 재부팅 후 해당 사용자 로그인 시 전체 복구, Docker 지연 기동, 모바일 설정 조작을 확인해야 한다. 이번 작업에서는 PC를 재부팅하지 않았다.

### [N-01] 설비 편집 기능 추가 (우선순위: 높음)

**수정 파일:**
1. `packages/web/src/lib/api.ts`
   - `machineApi`에 `update(id, payload)` 메서드 추가
   - Payload: `{ name?, ipAddress?, port?, serialNumber?, location?, templateId? }`
2. `packages/web/src/pages/MachineAdmin.tsx`
   - 설비 목록 각 행에 편집 버튼 추가
   - 편집 모달 (기존 등록 폼 재사용 또는 별도 구현)
   - 편집 성공 시 로컬 스토어 업데이트

**참고**: 백엔드 `PUT /api/machines/:id`는 이미 완전 구현됨. 프론트만 추가하면 됨.
상세 명세: `docs/MachineAdmin.md`

### [BACKLOG-01] 템플릿 파일 기반 관리

현재 템플릿은 DB에만 저장되며 git에 반영되지 않아 신규 배포 시 재현 불가능.

- `routes/templates.ts` PUT 핸들러에 `fs.writeFile` 추가 → UI 저장 시 DB + JSON 동시 write
- `seed.ts`가 `templates/*.json`을 읽어서 DB 초기화하도록 리팩토링
- 현재 DB 내용을 JSON으로 export하는 1회성 마이그레이션 스크립트

### [BACKLOG-02] PMC 인터락 텔레메트리 연동

현재 `RemoteControl.tsx`에서 `interlockSatisfied` 체크를 bypass 중.
실운용 시 도어 닫힘(R6001.3), 비상정지 해제(R6001.2) 등 PMC 신호 실시간 연동 필요.

### [BACKLOG-03] 조작반 램프 상태 실PMC 연동

현재 램프 상태는 텔레메트리 mode/runState 기반 mock. `panelLayout[].keys[].lampAddr` 주소를 DataCollectorService에서 주기적으로 읽어 텔레메트리에 포함해야 함. BACKLOG-02 선행 필요.

### [BACKLOG-04] 오프셋 쓰기 전체 흐름 검증

API 레벨 단독 테스트는 성공. 웹 UI → 오프셋 수정 → CNC 반영 전체 흐름 실기기 검증 미완료.
IS-C 4자리 소수점 스케일 검증 포함.

### [BACKLOG-05] 멀티사이트 배포 구조 설계

단일 서버 + 단일 에이전트 → 여러 공장/사이트 배포 시 아키텍처 설계 필요. BACKLOG-01 완료 후 진행.

### [BACKLOG-06] E-STOP 출력 PMC 주소 확인

현재 panelLayout에서 E_STOP의 reqAddr 미확인. SB-20R2 실기기 또는 FANUC 매뉴얼에서 확인 필요.

### [BACKLOG-07] PC→CNC 업로드 O번호 지정 + 덮어쓰기 기능 실기기 테스트 (진행 중, 2026-08-17 코드 구현 완료)

**구현 완료 (미테스트)**:
- `Transfer.tsx`: PC→CNC 전송 시 O번호 편집 확인 다이얼로그(`PcToCncConfirmDialog`) + 번호 충돌 시 2차 덮어쓰기 확인(`OverwriteConfirmDialog`)
- `files.ts`: `/transfer`에 `targetProgramNos`/`forceOverwrite` 파라미터, content의 `O####` 라인 치환(`replaceONumber`)
- `CommandHandler.cs`: `UPLOAD_PROGRAM`에 `forceOverwrite` 처리 — content에서 O번호 파싱 후 `cnc_delete`로 기존 프로그램 삭제 후 업로드
- `FocasDataReader.cs`: `DeleteProgramAsync`(`cnc_delete` 래핑) 추가

**남은 작업**:
- Agent 재빌드·재배포 (아직 미실행 — Agent Build & Deploy 절차 참조)
- 실기기 검증: 정상 업로드, O번호 변경 업로드, 충돌 시 덮어쓰기 확인 플로우, `cnc_delete` 실패 케이스(EDIT 모드 아닐 때 등, I-02와 유사한 CNC 상태 의존성 가능성)
- 통과 시 섹션 4 표 상태를 "✅ 완료"로 갱신하고 본 항목 제거

### [BACKLOG-08] DNC 실시간 스트리밍 조사 종료 (역사 기록 — 상세는 `docs/DNC.md`)

> 단계별 체크리스트(DNC-00~DNC-90), 실기기 검증 결과, 작업 이력, 미확정·차단 항목(U-01~U-08)은 전부 `docs/DNC.md`에서 관리한다. 아래는 2026-09-01 기준 요약이며, 최신 상태는 항상 `docs/DNC.md`를 우선한다. (이전 버전에 있던 "폴더 경로 기반 파일 존재 확인 수준" 요약은 그 사이 진행된 작업으로 낡은 정보였으므로 제거함)

**역사 요약**:
- FOCAS DNC 래퍼와 전용 스트리밍 서비스까지 구현해 MC-002에서 시험했으나 Embedded Ethernet 조건에서 `EW_REJECT(13)`·`SR1807`이 재현되어 2026-09-29 관련 운영 코드를 제거했다.
- 스케줄러 상태 머신은 DNC 연동 대신 MEM 기반 `CNC 저장/파일전송` 구조로 전환했다.
- DNC 프로그램 관리 화면 개편(업로드/코멘트/일괄 스케줄러 등록/존재 표시): 핵심 코드 완료, 일부 실기기·화면 검증 대기 (DNC-75~77)
- O9000 보호(`3202#4`) 연동: 코드·빌드 완료, 실기기 검증 대기 (DNC-76)
- Path1 단독 DNC 테스트 화면·API·Agent 전용 실행본은 제거했으며 당시 절차와 결과만 `docs/DNC.md`에 보존한다.
- Fast/Multi-function Ethernet, S707 옵션 등 별도 하드웨어·옵션 조건은 조사 결과로 남기며 현 운영 범위에서는 재검증하지 않는다.

---

## 7. 주요 설정값

### Server 환경변수 (`packages/server/.env`)

```
DATABASE_URL=postgresql://starwebcnc:starwebcnc123@localhost:5432/starwebcnc
REDIS_URL=redis://localhost:6379
MQTT_BROKER_URL=mqtt://localhost:1883
PORT=3000
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
HQ_REGISTRATION_CODE=hq1234
```

### Agent 설정 (`appsettings.Production.json`)

```json
{
  "Agent": {
    "AgentId": "AGENT-001",
    "MachineId": "MC-001",
    "TemplateId": "FANUC_0i-TF Plus_SB-20R2_V1",
    "Cnc":       { "IpAddress": "192.168.1.101", "Port": 8193 },
    "Mqtt":      { "Host": "localhost", "Port": 1883, "AutoReconnect": true },
    "Server":    { "BaseUrl": "http://localhost:3000" },
    "Collector": { "StatusIntervalMs": 500, "TelemetryIntervalMs": 500,
                   "AlarmIntervalMs": 1000, "PmcIntervalMs": 100 }
  }
}
```

**환경변수 오버라이드**: .NET 이중 언더스코어 규칙  
예) `Agent__Mqtt__Host=192.168.1.10`, `Agent__Cnc__IpAddress=192.168.1.102`

### 다중 CNC 확장 방식

- Agent 바이너리를 별도 디렉토리에 복사
- `appsettings.Production.json`에서 `MachineId`, `Cnc.IpAddress` 변경
- Agent 프로세스 별도 실행
- DB에 Machine 레코드 추가 (MachineAdmin UI 또는 API)

### 인프라 실행 상태 (로컬 개발 기준)

| 서비스 | 방식 | 주소 |
|--------|------|------|
| PostgreSQL | Docker `star-webcnc-db` | localhost:5432 |
| MQTT Broker | Docker `star-webcnc-mqtt` | localhost:1883 |
| Redis | Native `redis-server.exe` | localhost:6379 |
| Node.js Server | tsx / ts-node | localhost:3000 |
| React Dev | Vite | localhost:5173 |
| Agent | `dotnet StarWebCNC.Agent.dll` | — |

### Agent 빌드 및 배포

`start-agent.vbs`는 `_runner-agent.bat`를 통해 MC-002 Agent를 시작한다. `start-all.bat`와 동일한 `_runner-agents-dynamic.ps1`을 사용하며, 서버 API에서 활성 설비 설정을 조회한 뒤 `agent-runtime/MC-002/publish`의 `active` 파일과 Agent DLL이 있으면 전용 배포본을 실행한다. Agent 단독 시작 시에는 서버가 먼저 실행되어 있어야 한다. 시작 로그는 `agent-runtime/agent_start.log`, 설비 로그는 `agent-runtime/agent_MC002.log`에 남는다.

MC-002를 재배포할 때는 전용 배포본의 `appsettings.Production.json`에 위 수집 주기를 유지하고, 같은 폴더에 `active` 파일을 둔다. 단독 시작 시 이미 MC-002 Agent가 실행 중이면 추가 기동을 건너뛴다.

```bash
# 1. Agent 프로세스 종료 (DLL 잠금 해제)
powershell.exe -Command "Get-Process dotnet -ErrorAction SilentlyContinue | Stop-Process -Force"

# 2. 빌드
cd packages/agent/StarWebCNC.Agent
dotnet build -c Release

# 3. DLL 복사
cp bin/Release/net8.0/win-x64/StarWebCNC.Agent.dll publish/

# 4. 재시작
cd publish && ASPNETCORE_ENVIRONMENT=Production dotnet StarWebCNC.Agent.dll > /c/temp/agent_prod.log 2>&1 &
```

> ⚠️ `dotnet publish`를 Agent 실행 중 실행하면 파일 잠금으로 silently fail됨

---

## 8. 작업 규칙 (KNOWN_MISTAKES.md 핵심 요약)

> 전체 목록은 `KNOWN_MISTAKES.md` 참조 (M-01 ~ M-21)

### FOCAS (C# Agent)

- **`await` 금지**: FOCAS thread 내에서는 `Thread.Sleep()` 또는 `WaitHandle.WaitOne()` 만 사용. `await Task.Delay()` 사용 시 thread affinity 깨짐 → EW_HANDLE(-8) [M-01]
- **루프 슬립**: 반드시 가장 짧은 주기(`pmcIntervalMs = 100ms`)로 설정. `telemetryIntervalMs`로 설정하면 PMC 100ms 주기가 무효화됨 [M-17]
- **PMC 쓰기**: read-modify-write 패턴 금지. `pmc_wrpmcrng` 직접 쓰기만 사용 [M-03]
- **2단계 안정화 필수**: CNC ready → PMC ready 순서 생략 금지 [M-04, M-08]
- **블록킹 FOCAS API 금지**: `cnc_rdopmsg3` 등 CNC 대기 상태에서 블록킹되는 API는 수집 루프에서 사용 금지 [M-19]
- **pmcBits 별도 토픽**: telemetry 패킷에 포함 금지. 반드시 `pmc_bits` 토픽으로 별도 발행 [M-18]
- **PMC 주소 수집 대상**: 새 PMC 주소 기반 기능 추가 시 `CollectAndPublishPmcBitsSync()`의 `uniqueAddrs`에 Concat 필수 [M-20]

### JSON 직렬화 (C#)

- **Dictionary 키 보존**: `CamelCasePropertyNamesContractResolver` 단독 사용 금지. `ProcessDictionaryKeys = false` 설정 필수 [M-02]

### WebSocket (TypeScript)

- **직접 연결**: `import.meta.env.VITE_API_URL`에서 추출한 주소로 직접 연결. Vite proxy 경유 금지 [M-05]
- **stale closure 방지**: `_connect()`에서 `const ws = new WebSocket(url)` 로컬 변수 사용 + `if (this.ws !== ws) return` 체크 필수 [M-15]
- **핸들러 재등록**: `_wsHandlersRegistered` 플래그 패턴 금지. `_wsCleanups` 배열로 cleanup 후 재등록 [M-06]

### React / Zustand (TypeScript)

- **useEffect deps**: WsConnector의 deps에 `initWebSocket`, `destroyWebSocket`, `fetchMachines` 포함 필수 [M-16]
- **롱프레스**: `onComplete`에 `onPressEnd()` 호출 포함 필수 [M-10]

### 기타

- **역할명**: 항상 `HQ_ENGINEER` 사용 (구 `AS_ENGINEER` 사용 금지) [M-14]
- **seed.ts upsert**: 항상 `update: {}` — 기존 데이터 덮어쓰기 금지 [M-07]
- **CommandMessage**: 파라미터 접근은 `command.Params` (not `Parameters`) [M-09]
- **템플릿 새 JSON 컬럼 추가 시**: schema.prisma → db push → prisma generate → 서버 재빌드 → DB 기존 레코드 업데이트 → Agent 재시작 5단계 필수 [M-21]
