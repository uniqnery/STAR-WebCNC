// Settings Page - 시스템 설정

import { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMachineStore, useControlLockDuration } from '../stores/machineStore';
import { useCameraStore, CameraConfig } from '../stores/cameraStore';
import { diagnosticsApi, DiagnosticsData, AgentDiagStatus, settingsApi } from '../lib/api';

export function Settings() {
  const user = useAuthStore((state) => state.user);
  const machines = useMachineStore((state) => state.machines);
  const {
    cameraEnabled, cameras,
    setCameraEnabled, addCamera, updateCamera, removeCamera, syncToServer,
  } = useCameraStore();
  const controlLockDuration = useControlLockDuration();
  const setControlLockDuration = useMachineStore((s) => s.setControlLockDuration);

  const isAdmin = user?.role === 'ADMIN';

  const [editingCamera, setEditingCamera] = useState<CameraConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // 등록 코드 설정
  const [regCodes, setRegCodes] = useState({ adminCode: '', operatorCode: '' });
  const [regEdit, setRegEdit] = useState({ adminCode: '', operatorCode: '' });
  const [regSaving, setRegSaving] = useState(false);
  const [regMsg, setRegMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    settingsApi.getRegistrationCodes().then((res) => {
      if (res.success && res.data) {
        setRegCodes({ adminCode: res.data.adminCode, operatorCode: res.data.operatorCode });
        setRegEdit({ adminCode: res.data.adminCode, operatorCode: res.data.operatorCode });
      }
    });
  }, [isAdmin]);

  const openCreateModal = () => {
    setEditingCamera({
      id: `cam-${Date.now()}`,
      name: '',
      ipAddress: '',
      rtspPort: 554,
      username: 'admin',
      password: '',
      streamPath: '/Streaming/Channels/101',
      enabled: true,
    });
    setIsCreating(true);
  };

  const openEditModal = (camera: CameraConfig) => {
    setEditingCamera({ ...camera, password: '' }); // 비밀번호는 재입력
    setIsCreating(false);
  };

  const handleSave = () => {
    if (!editingCamera) return;
    if (isCreating) {
      const cam = { ...editingCamera };
      if (cam.password) cam.password = btoa(cam.password);
      addCamera(cam);
    } else {
      const updates: Partial<CameraConfig> = { ...editingCamera };
      if (!updates.password) delete updates.password; // 빈 비밀번호는 기존 유지
      else updates.password = btoa(updates.password);
      updateCamera(editingCamera.id, updates);
    }
    setEditingCamera(null);
    void syncToServer(); // DB 영속화
  };

  const handleDelete = (id: string) => {
    removeCamera(id);
  };

  const handleRegSave = async () => {
    setRegSaving(true);
    setRegMsg(null);
    try {
      const payload: { adminCode?: string; operatorCode?: string } = {};
      if (regEdit.adminCode !== regCodes.adminCode) payload.adminCode = regEdit.adminCode;
      if (regEdit.operatorCode !== regCodes.operatorCode) payload.operatorCode = regEdit.operatorCode;
      if (Object.keys(payload).length === 0) { setRegMsg({ type: 'ok', text: '변경 사항 없음' }); return; }
      const res = await settingsApi.updateRegistrationCodes(payload);
      if (res.success) {
        setRegCodes({ ...regCodes, ...payload });
        setRegMsg({ type: 'ok', text: '저장되었습니다.' });
      } else {
        setRegMsg({ type: 'err', text: res.error?.message ?? '저장 실패' });
      }
    } finally {
      setRegSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">시스템 설정</h1>
        <p className="text-gray-500">제어권 타이머, 카메라 연동 및 시스템 옵션 관리</p>
      </div>

      {/* 제어권 타이머 설정 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              제어권 타이머
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              장비 제어권 자동 해제 시간 설정
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[5, 10].map((min) => (
              <button
                key={min}
                onClick={() => setControlLockDuration(min)}
                disabled={!isAdmin}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  controlLockDuration === min
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {min}분
              </button>
            ))}
          </div>
        </div>
        {!isAdmin && (
          <p className="text-xs text-gray-400 mt-2">관리자만 변경할 수 있습니다</p>
        )}
      </div>

      {/* 카메라 연동 토글 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              카메라 연동
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              IP 카메라 실시간 영상 스트리밍 (RTSP → WebRTC)
            </p>
          </div>
          <button
            onClick={() => setCameraEnabled(!cameraEnabled)}
            disabled={!isAdmin}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              cameraEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                cameraEnabled ? 'translate-x-7' : ''
              }`}
            />
          </button>
        </div>
        {!isAdmin && (
          <p className="text-xs text-gray-400 mt-2">관리자만 변경할 수 있습니다</p>
        )}
      </div>

      {/* 카메라 목록 (활성화 시에만) */}
      {cameraEnabled && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              등록된 카메라
            </h2>
            {isAdmin && (
              <button
                onClick={openCreateModal}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                + 카메라 추가
              </button>
            )}
          </div>

          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">No.</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">이름</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP 주소</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">연결 장비</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">상태</th>
                {isAdmin && (
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">작업</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
              {cameras.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-4 py-8 text-center text-gray-500">
                    등록된 카메라가 없습니다
                  </td>
                </tr>
              ) : (
                cameras.map((cam, index) => {
                  const assignedMachine = machines.find((m) => m.machineId === cam.assignedMachineId);
                  return (
                    <tr key={cam.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-sm text-gray-500">{index + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                        {cam.name}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500">
                        {cam.ipAddress}:{cam.rtspPort}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {assignedMachine?.name || (cam.assignedMachineId ? cam.assignedMachineId : '-')}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {cam.enabled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-xs font-medium">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                            활성
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 rounded text-xs">
                            비활성
                          </span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEditModal(cam)}
                              className="text-blue-600 hover:text-blue-700 text-sm"
                            >
                              편집
                            </button>
                            <button
                              onClick={() => handleDelete(cam.id)}
                              className="text-red-500 hover:text-red-600 text-sm"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 카메라 등록/편집 모달 */}
      {editingCamera && (
        <CameraModal
          camera={editingCamera}
          machines={machines}
          isCreating={isCreating}
          onChange={setEditingCamera}
          onSave={handleSave}
          onCancel={() => setEditingCamera(null)}
        />
      )}

      {/* 등록 코드 관리 (ADMIN only) */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            회원가입 등록 코드
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            신규 가입 시 코드에 따라 역할이 자동 부여됩니다. 코드 없이 가입하면 승인 대기 상태가 됩니다.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                관리자 코드 <span className="text-xs text-gray-400 font-normal">(가입 즉시 ADMIN 승인)</span>
              </label>
              <input
                type="text"
                value={regEdit.adminCode}
                onChange={(e) => setRegEdit((p) => ({ ...p, adminCode: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                           bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                           focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="최소 4자"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                오퍼레이터 코드 <span className="text-xs text-gray-400 font-normal">(가입 즉시 USER 승인)</span>
              </label>
              <input
                type="text"
                value={regEdit.operatorCode}
                onChange={(e) => setRegEdit((p) => ({ ...p, operatorCode: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                           bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                           focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="최소 4자"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRegSave}
              disabled={regSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400
                         text-white text-sm font-medium rounded-lg transition-colors"
            >
              {regSaving ? '저장 중...' : '저장'}
            </button>
            {regMsg && (
              <span className={`text-sm ${regMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {regMsg.text}
              </span>
            )}
          </div>

          <p className="mt-3 text-xs text-gray-400">
            본사 엔지니어 코드(HQ_ENGINEER)는 서버 환경변수로 관리되며 이 화면에서 변경할 수 없습니다.
          </p>
        </div>
      )}

      {/* 시스템 진단 */}
      {(isAdmin || user?.role === 'HQ_ENGINEER') && (
        <DiagnosticsSection />
      )}
    </div>
  );
}

// ── 시스템 진단 섹션 ────────────────────────────────────────────

type PingState = 'idle' | 'pinging' | 'ok' | 'fail';

function DiagnosticsSection() {
  const [loading, setLoading] = useState(false);
  const [diag, setDiag] = useState<DiagnosticsData | null>(null);
  const [pingMap, setPingMap] = useState<Record<string, PingState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await diagnosticsApi.getStatus();
      if (res.success && res.data) setDiag(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const pingAgent = useCallback(async (agent: AgentDiagStatus) => {
    setPingMap((prev) => ({ ...prev, [agent.machineId]: 'pinging' }));
    try {
      const res = await diagnosticsApi.pingAgent(agent.machineId);
      const ok = res.success && (res.data as { status?: string })?.status === 'SUCCESS';
      setPingMap((prev) => ({ ...prev, [agent.machineId]: ok ? 'ok' : 'fail' }));
    } catch {
      setPingMap((prev) => ({ ...prev, [agent.machineId]: 'fail' }));
    }
  }, []);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden mt-6">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">시스템 진단</h2>
          <p className="text-sm text-gray-500">서비스 연결 상태 및 Agent 응답 확인</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <RefreshIcon className="w-4 h-4" />
          )}
          점검 실행
        </button>
      </div>

      {/* 서비스 상태 */}
      {diag && (
        <div className="p-6 space-y-6">
          {/* 서비스 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ServiceCard
              label="데이터베이스"
              connected={diag.services.database.connected}
              detail={diag.services.database.latencyMs != null
                ? `${diag.services.database.latencyMs}ms`
                : diag.services.database.error ?? ''}
            />
            <ServiceCard
              label="Redis"
              connected={diag.services.redis.connected}
              detail={diag.services.redis.error ?? ''}
            />
            <ServiceCard
              label="MQTT 브로커"
              connected={diag.services.mqtt.connected}
              detail={diag.services.mqtt.error ?? ''}
            />
            <ServiceCard
              label="WebSocket"
              connected={true}
              detail={`클라이언트 ${diag.services.websocket.clientCount}개`}
            />
          </div>

          {/* Agent 상태 테이블 */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Agent 연결 상태
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">장비 ID</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">장비명</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">텔레메트리</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">PING</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {diag.agents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                      등록된 장비가 없습니다
                    </td>
                  </tr>
                ) : (
                  diag.agents.map((agent) => {
                    const ping = pingMap[agent.machineId] ?? 'idle';
                    const lastSeen = agent.lastSeenMs != null
                      ? `${(agent.lastSeenMs / 1000).toFixed(0)}초 전`
                      : '-';
                    return (
                      <tr key={agent.machineId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-300">
                          {agent.machineId}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                          {agent.machineName}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-500">
                          {agent.ipAddress}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {agent.online ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-xs">
                              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                              {lastSeen}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 rounded text-xs">
                              오프라인
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => pingAgent(agent)}
                            disabled={ping === 'pinging'}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                              ping === 'ok'   ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                              ping === 'fail' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                              ping === 'pinging' ? 'bg-gray-100 text-gray-400' :
                              'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 hover:bg-blue-100'
                            } disabled:cursor-not-allowed`}
                          >
                            {ping === 'pinging' ? '응답 대기...' :
                             ping === 'ok'      ? 'PONG' :
                             ping === 'fail'    ? '타임아웃' :
                             'PING'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400">
            점검 시각: {new Date(diag.timestamp).toLocaleString('ko-KR')}
          </p>
        </div>
      )}

      {!diag && !loading && (
        <div className="p-8 text-center text-gray-500 text-sm">
          "점검 실행" 버튼을 눌러 시스템 상태를 확인하세요
        </div>
      )}
    </div>
  );
}

function ServiceCard({
  label,
  connected,
  detail,
}: {
  label: string;
  connected: boolean;
  detail: string;
}) {
  return (
    <div className={`rounded-lg border p-4 ${
      connected
        ? 'border-green-200 bg-green-50 dark:border-green-700/50 dark:bg-green-900/10'
        : 'border-red-200 bg-red-50 dark:border-red-700/50 dark:bg-red-900/10'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
      </div>
      <p className={`text-xs ${connected ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
        {connected ? (detail || '연결됨') : (detail || '연결 실패')}
      </p>
    </div>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// ── 카메라 등록/편집 모달 ────────────────────────────────────────
function CameraModal({
  camera,
  machines,
  isCreating,
  onChange,
  onSave,
  onCancel,
}: {
  camera: CameraConfig;
  machines: { machineId: string; name: string }[];
  isCreating: boolean;
  onChange: (cam: CameraConfig) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (field: keyof CameraConfig, value: string | number | boolean) => {
    onChange({ ...camera, [field]: value });
  };

  const isValid = camera.name.trim() && camera.ipAddress.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[480px] p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {isCreating ? '카메라 등록' : '카메라 편집'}
        </h3>

        <div className="space-y-4">
          {/* 이름 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">카메라 이름</label>
            <input
              type="text"
              value={camera.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="CAM-1호기"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>

          {/* IP + 포트 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">IP 주소</label>
              <input
                type="text"
                value={camera.ipAddress}
                onChange={(e) => update('ipAddress', e.target.value)}
                placeholder="192.168.2.201"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">RTSP 포트</label>
              <input
                type="number"
                value={camera.rtspPort}
                onChange={(e) => update('rtspPort', parseInt(e.target.value) || 554)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              />
            </div>
          </div>

          {/* 계정 + 비밀번호 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">사용자 ID</label>
              <input
                type="text"
                value={camera.username}
                onChange={(e) => update('username', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                비밀번호 {!isCreating && <span className="text-gray-400">(빈칸=유지)</span>}
              </label>
              <input
                type="password"
                value={camera.password}
                onChange={(e) => update('password', e.target.value)}
                placeholder={isCreating ? '' : '****'}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              />
            </div>
          </div>

          {/* 스트림 경로 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">스트림 경로</label>
            <input
              type="text"
              value={camera.streamPath}
              onChange={(e) => update('streamPath', e.target.value)}
              placeholder="/Streaming/Channels/101"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-mono"
            />
          </div>

          {/* 연결 장비 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">연결 장비</label>
            <select
              value={camera.assignedMachineId || ''}
              onChange={(e) => update('assignedMachineId', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            >
              <option value="">미지정</option>
              {machines.map((m) => (
                <option key={m.machineId} value={m.machineId}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* 활성화 */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700 dark:text-gray-300">카메라 활성화</span>
            <button
              onClick={() => update('enabled', !camera.enabled)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                camera.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  camera.enabled ? 'translate-x-6' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            취소
          </button>
          <button
            onClick={onSave}
            disabled={!isValid}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? '등록' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
