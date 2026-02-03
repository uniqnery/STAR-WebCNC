// Camera Store - Zustand (옵션 기능)

import { create } from 'zustand';

export interface CameraConfig {
  id: string;
  name: string;
  ipAddress: string;
  rtspPort: number;
  username: string;
  password: string;            // base64 encoded in localStorage
  streamPath: string;
  enabled: boolean;
  assignedMachineId?: string;
}

export type StreamStatus = 'connecting' | 'live' | 'error' | 'offline';

interface CameraState {
  cameraEnabled: boolean;
  cameras: CameraConfig[];
  streamStatuses: Record<string, StreamStatus>;

  // Actions
  setCameraEnabled: (enabled: boolean) => void;
  addCamera: (camera: CameraConfig) => void;
  updateCamera: (id: string, updates: Partial<CameraConfig>) => void;
  removeCamera: (id: string) => void;
  setStreamStatus: (cameraId: string, status: StreamStatus) => void;
}

// localStorage
const CAMERA_STORAGE_KEY = 'star-webcnc-camera-config';

interface StoredCameraData {
  cameraEnabled: boolean;
  cameras: CameraConfig[];
}

function loadCameraConfig(): StoredCameraData {
  try {
    const raw = localStorage.getItem(CAMERA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredCameraData;
      return {
        cameraEnabled: parsed.cameraEnabled ?? false,
        cameras: parsed.cameras ?? [],
      };
    }
  } catch {
    // ignore
  }
  return { cameraEnabled: false, cameras: [] };
}

function saveCameraConfig(data: StoredCameraData) {
  try {
    localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable
  }
}

// Mock 데이터
const MOCK_CAMERAS: CameraConfig[] = [
  {
    id: 'cam-001', name: 'CAM-1호기', ipAddress: '192.168.2.201',
    rtspPort: 554, username: 'admin', password: btoa('camera123'),
    streamPath: '/Streaming/Channels/101', enabled: true,
    assignedMachineId: 'MC-001',
  },
  {
    id: 'cam-002', name: 'CAM-2호기', ipAddress: '192.168.2.202',
    rtspPort: 554, username: 'admin', password: btoa('camera123'),
    streamPath: '/Streaming/Channels/101', enabled: true,
    assignedMachineId: 'MC-002',
  },
  {
    id: 'cam-003', name: 'CAM-전체', ipAddress: '192.168.2.203',
    rtspPort: 554, username: 'admin', password: btoa('camera123'),
    streamPath: '/Streaming/Channels/101', enabled: false,
  },
];

const stored = loadCameraConfig();
const initialCameras = stored.cameras.length > 0 ? stored.cameras : MOCK_CAMERAS;
const initialEnabled = stored.cameras.length > 0 ? stored.cameraEnabled : true;

export const useCameraStore = create<CameraState>((set) => ({
  cameraEnabled: initialEnabled,
  cameras: initialCameras,
  streamStatuses: {},

  setCameraEnabled: (enabled) =>
    set((state) => {
      saveCameraConfig({ cameraEnabled: enabled, cameras: state.cameras });
      // OFF 전환 시 모든 스트림 상태를 offline으로 리셋
      const statuses = enabled ? state.streamStatuses : {};
      return { cameraEnabled: enabled, streamStatuses: statuses };
    }),

  addCamera: (camera) =>
    set((state) => {
      const cameras = [...state.cameras, camera];
      saveCameraConfig({ cameraEnabled: state.cameraEnabled, cameras });
      return { cameras };
    }),

  updateCamera: (id, updates) =>
    set((state) => {
      const cameras = state.cameras.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      );
      saveCameraConfig({ cameraEnabled: state.cameraEnabled, cameras });
      return { cameras };
    }),

  removeCamera: (id) =>
    set((state) => {
      const cameras = state.cameras.filter((c) => c.id !== id);
      const { [id]: _, ...streamStatuses } = state.streamStatuses;
      saveCameraConfig({ cameraEnabled: state.cameraEnabled, cameras });
      return { cameras, streamStatuses };
    }),

  setStreamStatus: (cameraId, status) =>
    set((state) => ({
      streamStatuses: { ...state.streamStatuses, [cameraId]: status },
    })),
}));

// Selectors
export const useCameraForMachine = (machineId: string) => {
  return useCameraStore((state) => {
    if (!state.cameraEnabled) return undefined;
    return state.cameras.find(
      (c) => c.assignedMachineId === machineId && c.enabled
    );
  });
};
