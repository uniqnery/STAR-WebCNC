# Star-WebCNC 백로그 (1차 개발 완료 후 작업 예정)

> 이 파일은 1차 개발(실장비 연동 검증) 완료 후 2차 업데이트에서 처리할 작업 목록입니다.
> 우선순위 순으로 정렬. 각 항목은 배경/이유와 함께 기록.

---

## [BACKLOG-01] 템플릿 파일 기반 관리 (2단계)

**배경:**
현재 템플릿은 DB(PostgreSQL)에만 저장되며, `seed.ts`는 초기값 하드코딩. UI에서 수정한 내용이
git에 반영되지 않아 신규 배포 시 재현이 불가능하다.

**목표:**
- `templates/*.json` 폴더를 정식 소스로 사용
- UI 저장 시 DB + JSON 파일 동시 write
- `seed.ts`가 `templates/*.json`을 읽어서 DB 초기화
- git으로 버전 관리 → 배포/복원 시 파일만 있으면 DB 자동 구성

**작업 항목:**
- [ ] `routes/templates.ts` PUT 핸들러에 `fs.writeFile` 추가
- [ ] `seed.ts` 파일 기반으로 리팩토링 (하드코딩 제거)
- [ ] `templates/` 폴더 `.gitignore` 제외 처리
- [ ] 현재 DB 내용을 JSON으로 export 하는 1회성 마이그레이션 스크립트

**선행 조건:** 1차 개발 완료, 템플릿 구조 안정화

---

## [BACKLOG-02] PMC 인터록 텔레메트리 연동

**배경:**
현재 `RemoteControl.tsx`에서 `interlockSatisfied` 체크를 임시로 bypass하여 테스트 중.
실운용 시에는 도어 닫힘(R6001.3), 비상정지 해제(R6001.2) 등 PMC 신호를 실시간으로
읽어 인터록 조건을 충족해야만 조작반 버튼이 활성화되어야 한다.

**목표:**
- 텔레메트리에 `interlock` 오브젝트 포함 (doorLock, memoryMode 등 PMC 비트 기반)
- `RemoteControl.tsx` `interlockSatisfied` 로직 재활성화
- `MachineTopBar` 인터록 pills 실PMC 신호 연동

**작업 항목:**
- [ ] `DataCollectorService.cs`: 텔레메트리에 interlock 필드 추가
- [ ] `machineStore.ts`: telemetry.interlock 타입 정의
- [ ] `RemoteControl.tsx`: `canOperate = hasControlLock && interlockSatisfied` 복원
- [ ] SB-20R2 실기기 인터록 어드레스 최종 확인 (doorClosed, eStop 등)

**선행 조건:** 실기기 조작반 동작 검증 완료

---

## [BACKLOG-03] 조작반 램프 상태 실PMC 연동

**배경:**
현재 램프 상태는 텔레메트리 mode/runState 기반 mock으로만 동작.
각 키의 `lampAddr` (예: `R6004.4`)를 실시간으로 읽어 실제 CNC 출력 신호를 표시해야 한다.

**목표:**
- `panelLayout[].keys[].lampAddr` 주소를 DataCollectorService에서 주기적으로 읽기
- 텔레메트리에 `lampStates: Record<string, boolean>` 포함
- `RemoteControl.tsx` `lampStates`를 텔레메트리 기반으로 전환

**작업 항목:**
- [ ] `DataCollectorService.cs`: panelLayout lampAddr 목록 수집 → PMC 읽기 → 텔레메트리 포함
- [ ] `machineStore.ts`: telemetry.lampStates 타입 추가
- [ ] `RemoteControl.tsx`: mock lampStates 제거, 텔레메트리 연동

**선행 조건:** BACKLOG-02 완료

---

## [BACKLOG-04] 오프셋 쓰기 검증

**배경:**
API 레벨에서는 오프셋 쓰기가 동작 확인됨(T01 X=0.003 왕복 테스트 성공).
그러나 실제 웹 UI → 오프셋 수정 → CNC 반영 전체 흐름을 실기기에서 검증하지 않은 상태.

**작업 항목:**
- [ ] OffsetView.tsx에서 실제 값 수정 → CNC 적용 확인
- [ ] IS-C 4자리 소수점 스케일 검증 (입력값 × 10000 변환 로직)
- [ ] Path1/Path2 분리 쓰기 동작 확인

---

## [BACKLOG-05] 멀티사이트 배포 구조

**배경:**
현재는 단일 서버 + 단일 에이전트 구조. 향후 여러 공장/사이트 배포 시
장비별 에이전트, 사이트별 서버 분리, 템플릿 분기 관리가 필요.

**작업 항목:**
- [ ] 배포 아키텍처 설계 (단일 서버 멀티 에이전트 vs 사이트별 서버)
- [ ] BACKLOG-01 완료 후 장비별 템플릿 파일 관리 체계
- [ ] `start-agent.cmd` 장비별 복사/설정 가이드 문서화

---

## [BACKLOG-06] EMERGENCY STOP 출력 주소 확인

**배경:**
현재 panelLayout에서 E_STOP의 reqAddr이 비어있음.
SB-20R2 실기기에서 E-STOP 출력 PMC 주소 미확인 상태.

**작업 항목:**
- [ ] 고객사 또는 FANUC 매뉴얼에서 E-STOP 출력 주소 확인
- [ ] PanelEditor에서 reqAddr 입력
- [ ] 안전 인터록 조건 재검토 (E-STOP은 별도 하드웨어 회로 확인 필요)

---

_마지막 업데이트: 2026-03-21_
