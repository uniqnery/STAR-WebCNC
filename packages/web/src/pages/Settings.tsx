// Settings Page - 시스템 설정

import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMachineStore } from '../stores/machineStore';
import { useCameraStore, CameraConfig } from '../stores/cameraStore';

export function Settings() {
  const user = useAuthStore((state) => state.user);
  const machines = useMachineStore((state) => state.machines);
  const {
    cameraEnabled, cameras,
    setCameraEnabled, addCamera, updateCamera, removeCamera,
  } = useCameraStore();

  const [editingCamera, setEditingCamera] = useState<CameraConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

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
  };

  const handleDelete = (id: string) => {
    removeCamera(id);
  };

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">시스템 설정</h1>
        <p className="text-gray-500">카메라 연동 및 시스템 옵션 관리</p>
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
    </div>
  );
}

// 카메라 등록/편집 모달
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
