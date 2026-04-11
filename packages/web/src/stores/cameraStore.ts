// Camera Store - Zustand
// [설정 로드 우선순위]
// 1. 서버 DB (single source of truth) — loadFromServer() 호출 후
// 2. localStorage 캐시 — 서버 연결 불가 시 fallback
// 3. 빈 상태 (Mock 제거됨)

import { create } from 'zustand';
import { cameraServerApi } from '../lib/api';

export interface CameraConfig {
  id: string;
  name: string;
  ipAddress: string;
  rtspPort: number;
  username: string;
  password: string;  // localStorage: base64, 서버 전송: 평문
  streamPath: string;
  enabled: boolean;
  assignedMachineId?: string;
  defaultZoom?: number; // 기본 배율 (1.0 ~ 4.0, 기본값 1.0)
}

export type StreamStatus = 'connecting' | 'live' | 'error' | 'offline';

interface CameraState {
  cameraEnabled: boolean;
  cameras: CameraConfig[];
  streamStatuses: Record<string, StreamStatus>;

  setCameraEnabled: (enabled: boolean) => void;
  addCamera: (camera: CameraConfig) => void;
  updateCamera: (id: string, updates: Partial<CameraConfig>) => void;
  removeCamera: (id: string) => void;
  setStreamStatus: (cameraId: string, status: StreamStatus) => void;
  syncToServer: () => Promise<void>;
  loadFromServer: () => Promise<void>;
}

// ── localStorage (캐시/fallback 용도)
const STORAGE_KEY = 'star-webcnc-camera-config';

interface StoredCameraData { cameraEnabled: boolean; cameras: CameraConfig[]; }

function loadLocalCache(): StoredCameraData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredCameraData;
  } catch { /* ignore */ }
  return { cameraEnabled: false, cameras: [] };
}

function saveLocalCache(data: StoredCameraData) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// 초기값: localStorage 캐시 (서버 로드 전 임시 표시용)
const cached = loadLocalCache();

export const useCameraStore = create<CameraState>((set, get) => ({
  cameraEnabled: cached.cameraEnabled,
  cameras: cached.cameras,
  streamStatuses: {},

  setCameraEnabled: (enabled) =>
    set((state) => {
      saveLocalCache({ cameraEnabled: enabled, cameras: state.cameras });
      return { cameraEnabled: enabled, streamStatuses: enabled ? state.streamStatuses : {} };
    }),

  addCamera: (camera) =>
    set((state) => {
      const cameras = [...state.cameras, camera];
      saveLocalCache({ cameraEnabled: state.cameraEnabled, cameras });
      return { cameras };
    }),

  updateCamera: (id, updates) =>
    set((state) => {
      const cameras = state.cameras.map((c) => c.id === id ? { ...c, ...updates } : c);
      saveLocalCache({ cameraEnabled: state.cameraEnabled, cameras });
      return { cameras };
    }),

  removeCamera: (id) =>
    set((state) => {
      const cameras = state.cameras.filter((c) => c.id !== id);
      const { [id]: _, ...streamStatuses } = state.streamStatuses;
      saveLocalCache({ cameraEnabled: state.cameraEnabled, cameras });
      return { cameras, streamStatuses };
    }),

  setStreamStatus: (cameraId, status) =>
    set((state) => ({ streamStatuses: { ...state.streamStatuses, [cameraId]: status } })),

  // 서버 DB → store 동기화 (인증 후 호출)
  loadFromServer: async () => {
    try {
      const res = await cameraServerApi.getConfigs();
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        // 서버는 비밀번호를 마스킹해서 내려줌
        // 기존 로컬 패스워드 유지 (마스킹된 값으로 덮어쓰기 방지)
        const localCameras = get().cameras;
        const serverCameras = (res.data as CameraConfig[]).map((serverCam) => {
          const local = localCameras.find((l) => l.id === serverCam.id);
          return {
            ...serverCam,
            // 서버에서 마스킹 반환 시 로컬 패스워드 유지
            password: serverCam.password.includes('●') ? (local?.password ?? '') : serverCam.password,
          };
        });
        set({ cameras: serverCameras, cameraEnabled: serverCameras.some((c) => c.enabled) });
        saveLocalCache({ cameraEnabled: get().cameraEnabled, cameras: serverCameras });
        console.log(`[CameraStore] Loaded ${serverCameras.length} cameras from server`);
      }
    } catch {
      console.warn('[CameraStore] Server load failed, using local cache');
    }
  },

  // store → 서버 DB 동기화 (설정 저장 시 호출)
  syncToServer: async () => {
    try {
      const { cameras } = get();
      // base64 패스워드 → 평문으로 변환 후 서버 전송
      const toSync = cameras.map((c) => ({
        ...c,
        password: c.password
          ? (() => { try { return atob(c.password); } catch { return c.password; } })()
          : '',
      }));
      await cameraServerApi.saveConfigs(toSync);
    } catch {
      console.warn('[CameraStore] syncToServer failed');
    }
  },
}));

// ── Selectors
export const useCameraForMachine = (machineId: string) =>
  useCameraStore((state) => {
    if (!state.cameraEnabled) return undefined;
    return state.cameras.find((c) => c.assignedMachineId === machineId && c.enabled);
  });
