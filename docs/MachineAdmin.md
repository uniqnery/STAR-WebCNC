# 설비 관리 (MachineAdmin) 기능 명세

> 파일: `packages/web/src/pages/MachineAdmin.tsx`
> 관련 API: `packages/web/src/lib/api.ts` (machineApi)
> 서버 라우트: `packages/server/src/routes/machines.ts`

---

## 1. 현재 구현 상태

| 기능 | 상태 | 비고 |
|------|------|------|
| 설비 목록 조회 | ✅ 완료 | 실시간 온라인/오프라인 상태 표시 |
| 설비 등록 | ✅ 완료 | 이름, IP, 포트, 일련번호, 위치, 템플릿 |
| 설비 삭제 | ✅ 완료 | Cascade 삭제 (연결 데이터 전부 삭제) |
| **설비 편집** | ❌ **미구현** | [N-01] — 아래 구현 명세 참조 |

---

## 2. [N-01] 설비 편집 기능 구현 명세

### 2-1. 수정 파일 및 변경 내용

**`packages/web/src/lib/api.ts`** — `machineApi`에 update 메서드 추가:

```typescript
update: async (id: string, payload: {
  name?: string;
  ipAddress?: string;
  port?: number;
  serialNumber?: string;
  location?: string;
  templateId?: string;
}) => {
  const res = await apiClient.put(`/machines/${id}`, payload);
  return res.data;
}
```

**`packages/web/src/pages/MachineAdmin.tsx`** — 편집 UI 추가:
- 설비 목록 각 행에 편집 버튼 (연필 아이콘) 추가
- 편집 모달 (기존 등록 폼 재사용 또는 별도 구현)
  - 필드: 이름, IP 주소, 포트, 일련번호, 위치, 템플릿
  - 제출 시 `machineApi.update()` 호출
  - 성공 시 로컬 스토어 업데이트 (`machineStore.fetchMachines()` 재호출 또는 직접 업데이트)

### 2-2. 백엔드 현황

`PUT /api/machines/:id` 완전 구현됨 (`routes/machines.ts`). 프론트만 추가하면 됨.

지원 필드: `name`, `ipAddress`, `port`, `serialNumber`, `location`, `templateId`

### 2-3. 구현 시 주의사항

- IP 주소 변경 시 Agent가 이미 연결 중이면 Agent 재시작 필요 (UI 경고 메시지 권장)
- templateId 변경 시 Agent에 `RELOAD_TEMPLATE` 명령 전송 고려
- 편집 모달은 등록 폼과 구조 동일 — 재사용 권장

---

## 3. 설비 등록 폼 필드 정의

| 필드 | 필수 | 설명 |
|------|------|------|
| name | ✅ | 설비 표시 이름 |
| ipAddress | ✅ | CNC IP 주소 (예: 192.168.1.101) |
| port | ✅ | FOCAS2 포트 (기본 8193) |
| serialNumber | ❌ | 설비 일련번호 |
| location | ❌ | 설치 위치 |
| templateId | ✅ | 적용할 템플릿 ID |

---

## 4. 역할별 접근 권한

| 기능 | USER | HQ_ENGINEER | ADMIN |
|------|------|-------------|-------|
| 목록 조회 | ✅ | ✅ | ✅ |
| 설비 등록 | ❌ | ❌ | ✅ |
| 설비 편집 | ❌ | ❌ | ✅ |
| 설비 삭제 | ❌ | ❌ | ✅ |

---

## 5. 관련 Store / API

- `machineStore.ts` → `fetchMachines()`: 설비 목록 로드
- `machineApi.create(payload)`: 설비 등록
- `machineApi.delete(id)`: 설비 삭제
- `machineApi.update(id, payload)`: **미구현 — 추가 필요**
