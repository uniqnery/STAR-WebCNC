// API Client

import { useAuthStore } from '../stores/authStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const token = useAuthStore.getState().accessToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
    const data = await response.json();

    // Handle 401 - try to refresh token
    if (response.status === 401) {
      const refreshed = await this.refreshToken();
      if (!refreshed) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    return data;
  }

  private async refreshToken(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data?.accessToken) {
          useAuthStore.getState().setAccessToken(data.data.accessToken);
          return true;
        }
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
    return false;
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.getHeaders(),
      credentials: 'include',
    });
    return this.handleResponse<T>(response);
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      credentials: 'include',
    });
    return this.handleResponse<T>(response);
  }

  // multipart/form-data 전송 (Content-Type 헤더 제외 — 브라우저가 자동 설정)
  async postForm<T>(path: string, form: FormData): Promise<ApiResponse<T>> {
    const headers: HeadersInit = {};
    const token = useAuthStore.getState().accessToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    });
    return this.handleResponse<T>(response);
  }
}

export const api = new ApiClient(API_BASE_URL);

// Auth API
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{
      accessToken: string;
      user: {
        id: string;
        username: string;
        email: string;
        role: 'USER' | 'ADMIN' | 'HQ_ENGINEER';
      };
    }>('/api/auth/login', { username, password }),

  register: (username: string, email: string, password: string, registrationCode: string) =>
    api.post<{ id: string; username: string; email: string }>(
      '/api/auth/register',
      { username, email, password, registrationCode }
    ),

  logout: () => api.post('/api/auth/logout'),

  refresh: () =>
    api.post<{ accessToken: string }>('/api/auth/refresh'),

  me: () =>
    api.get<{
      id: string;
      username: string;
      email: string;
      role: 'USER' | 'ADMIN' | 'HQ_ENGINEER';
    }>('/api/auth/me'),
};

// Machine API
export const machineApi = {
  getAll: (page = 1, limit = 20) =>
    api.get<{
      items: unknown[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/api/machines?page=${page}&limit=${limit}`),

  getById: (id: string) => api.get(`/api/machines/${id}`),

  getTelemetry: (id: string) => api.get(`/api/machines/${id}/telemetry`),

  getAlarms: (id: string, page = 1, limit = 50, activeOnly = false) =>
    api.get(`/api/machines/${id}/alarms?page=${page}&limit=${limit}&active=${activeOnly}`),

  acquireControl: (id: string, sessionId: string) =>
    api.post(`/api/machines/${id}/control/acquire`, { sessionId }),

  releaseControl: (id: string) =>
    api.post(`/api/machines/${id}/control/release`),

  extendControl: (id: string) =>
    api.post(`/api/machines/${id}/control/extend`),

  create: (payload: {
    machineId: string;
    name: string;
    ipAddress: string;
    port: number;
    serialNumber: string;
    location?: string;
    templateId: string;
  }) => api.post<{ id: string; machineId: string }>('/api/machines', payload),

  delete: (id: string) => api.delete(`/api/machines/${id}`),
};

// Command API
export const commandApi = {
  /** 명령 전송 (즉시 PENDING 응답) */
  send: (machineId: string, command: string, params?: Record<string, unknown>) =>
    api.post<{ correlationId: string; status: string }>(`/api/commands/${machineId}`, {
      command,
      params,
    }),

  /**
   * 명령 전송 후 Agent 실행 결과까지 동기 대기 (?wait=true)
   * timeoutMs 초과 시 504 응답 (COMMAND_TIMEOUT)
   */
  sendAndWait: (
    machineId: string,
    command: string,
    params?: Record<string, unknown>,
    timeoutMs = 30_000,
  ) =>
    api.post<{
      correlationId: string;
      status: string;
      result?: unknown;
      errorCode?: string;
      errorMessage?: string;
    }>(`/api/commands/${machineId}?wait=true&timeout=${timeoutMs}`, {
      command,
      params,
    }),

  getStatus: (machineId: string, correlationId: string) =>
    api.get(`/api/commands/${machineId}/${correlationId}`),

  getHistory: (machineId: string, page = 1, limit = 20) =>
    api.get(`/api/commands/${machineId}?page=${page}&limit=${limit}`),
};

// Scheduler API
export const schedulerApi = {
  // ── 큐 CRUD ──────────────────────────────────────────────────
  getRows: (machineId: string) =>
    api.get<{ rows: unknown[]; state: string }>(`/api/scheduler/rows?machineId=${machineId}`),

  addRow: (data: { machineId: string; mainProgramNo: string; subProgramNo?: string; preset: number }) =>
    api.post('/api/scheduler/rows', data),

  updateRow: (rowId: string, data: { mainProgramNo?: string; subProgramNo?: string | null; preset?: number; count?: number }) =>
    api.put(`/api/scheduler/rows/${rowId}`, data),

  deleteRow: (rowId: string) =>
    api.delete(`/api/scheduler/rows/${rowId}`),

  reorderRows: (machineId: string, orderedIds: string[]) =>
    api.post('/api/scheduler/rows/reorder', { machineId, orderedIds }),

  // ── 실행 제어 ─────────────────────────────────────────────────
  start: (machineId: string) =>
    api.post(`/api/scheduler/start?machineId=${machineId}`),

  resume: (machineId: string) =>
    api.post(`/api/scheduler/resume?machineId=${machineId}`),

  pause: (machineId: string) =>
    api.post(`/api/scheduler/pause?machineId=${machineId}`),

  cancel: (machineId: string) =>
    api.post(`/api/scheduler/cancel?machineId=${machineId}`),

  reset: (machineId: string) =>
    api.post(`/api/scheduler/reset?machineId=${machineId}`),

  clearAll: (machineId: string) =>
    api.delete(`/api/scheduler/rows?machineId=${machineId}`),
};

// Alarm API
export const alarmApi = {
  getAlarms: (options?: {
    machineId?: string;
    active?: boolean;
    page?: number;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.machineId) params.append('machineId', options.machineId);
    if (options?.active !== undefined) params.append('active', String(options.active));
    params.append('page', String(options?.page || 1));
    params.append('limit', String(options?.limit || 100));
    return api.get(`/api/alarms?${params.toString()}`);
  },

  acknowledge: (alarmId: string) =>
    api.post(`/api/alarms/${alarmId}/acknowledge`),

  getStats: () =>
    api.get('/api/alarms/stats'),
};

// Transfer API
export const transferApi = {
  listPrograms: (machineId: string) =>
    api.get(`/api/transfer/${machineId}/programs`),

  upload: async (machineId: string, file: File, programNo?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (programNo) formData.append('programNo', programNo);

    const token = useAuthStore.getState().accessToken;
    const response = await fetch(`${API_BASE_URL}/api/transfer/${machineId}/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
      body: formData,
    });
    return response.json();
  },

  download: (machineId: string, programNo: string) =>
    api.get(`/api/transfer/${machineId}/download/${programNo}`),
};

// Backup API
export const backupApi = {
  getHistory: (machineId: string, page = 1, limit = 20) =>
    api.get(`/api/backup/${machineId}?page=${page}&limit=${limit}`),

  create: (machineId: string, type: 'SRAM' | 'PARAMETER' | 'PROGRAM' | 'FULL') =>
    api.post(`/api/backup/${machineId}`, { type }),

  download: async (backupId: string) => {
    const token = useAuthStore.getState().accessToken;
    const response = await fetch(`${API_BASE_URL}/api/backup/download/${backupId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (response.ok) {
      return { success: true, data: await response.arrayBuffer() };
    }
    return { success: false, error: { code: 'DOWNLOAD_FAILED', message: '다운로드 실패' } };
  },
};

// Production API
export const productionApi = {
  getStats: (timeRange: 'today' | 'week' | 'month', machineId?: string) => {
    const params = new URLSearchParams({ timeRange });
    if (machineId) params.append('machineId', machineId);
    return api.get(`/api/production/stats?${params.toString()}`);
  },

  getLogs: (machineId: string, page = 1, limit = 50) =>
    api.get(`/api/production/${machineId}/logs?page=${page}&limit=${limit}`),
};

// Work Order API
export const workOrderApi = {
  getAll: (status?: string, page = 1, limit = 50) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) params.append('status', status);
    return api.get(`/api/work-orders?${params.toString()}`);
  },

  getById: (id: string) =>
    api.get(`/api/work-orders/${id}`),

  create: (data: Partial<{
    orderNumber: string;
    productCode: string;
    productName: string;
    targetQuantity: number;
    assignedMachine: string;
    programNumber: string;
    priority: number;
    scheduledStart: string;
    scheduledEnd: string;
  }>) =>
    api.post('/api/work-orders', data),

  update: (id: string, data: Partial<{
    assignedMachine: string;
    programNumber: string;
    priority: number;
    scheduledStart: string;
    scheduledEnd: string;
  }>) =>
    api.put(`/api/work-orders/${id}`, data),

  start: (id: string) =>
    api.post(`/api/work-orders/${id}/start`),

  complete: (id: string) =>
    api.post(`/api/work-orders/${id}/complete`),

  cancel: (id: string) =>
    api.post(`/api/work-orders/${id}/cancel`),
};

// Audit API
export const auditApi = {
  getLogs: (options?: {
    page?: number;
    limit?: number;
    action?: string;
    targetId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const params = new URLSearchParams();
    params.append('page', String(options?.page || 1));
    params.append('limit', String(options?.limit || 50));
    if (options?.action) params.append('action', options.action);
    if (options?.targetId) params.append('targetId', options.targetId);
    if (options?.userId) params.append('userId', options.userId);
    if (options?.startDate) params.append('startDate', options.startDate);
    if (options?.endDate) params.append('endDate', options.endDate);
    return api.get(`/api/audit?${params.toString()}`);
  },
};

// Camera API
export const cameraApi = {
  getAll: () =>
    api.get('/api/cameras'),

  create: (config: Record<string, unknown>) =>
    api.post('/api/cameras', config),

  update: (id: string, config: Record<string, unknown>) =>
    api.put(`/api/cameras/${id}`, config),

  delete: (id: string) =>
    api.delete(`/api/cameras/${id}`),

  getWebRTCOffer: (id: string) =>
    api.post(`/api/cameras/${id}/webrtc/offer`),

  getStatus: (id: string) =>
    api.get(`/api/cameras/${id}/status`),
};

// DNC Config API
export const dncApi = {
  // 서버 파일시스템 폴더 목록 조회
  listFolders: (basePath: string) =>
    api.get(`/api/filesystem/list?path=${encodeURIComponent(basePath)}`),

  // 장비 DNC 경로 설정 조회
  getConfig: (machineId: string) =>
    api.get(`/api/machines/${machineId}/dnc-config`),

  // 장비 DNC 경로 설정 저장 (관리자 전용)
  saveConfig: (machineId: string, config: { path1: string; path2: string; path3?: string; mainMode?: 'memory' | 'dnc'; subMode?: 'memory' | 'dnc' }) =>
    api.put(`/api/machines/${machineId}/dnc-config`, config),
};

// NC Data API (Offset / Count / Tool-Life)
export const ncDataApi = {
  // 오프셋 읽기 (마모만, path=1|2)
  readOffsets: (machineId: string, path: number) =>
    api.get(`/api/machines/${machineId}/offsets?path=${path}&count=64`),

  // 오프셋 쓰기 (단일 항목, 제어권 필요)
  // no: 공구 번호 (1-based), axis: 'X'|'Z'|'Y'|'R', value: mm 단위
  writeOffset: (machineId: string, path: number, no: number, axis: string, value: number) =>
    api.put(`/api/machines/${machineId}/offsets`, { path, no, axis, value }),

  // 카운터 데이터 읽기 (템플릿 CounterConfig 기반)
  readCount: (machineId: string) =>
    api.get(`/api/machines/${machineId}/count`),

  // 카운터 변수 쓰기 (제어권 필요)
  writeCountVar: (machineId: string, varNo: number, value: number) =>
    api.put(`/api/machines/${machineId}/count`, { varNo, value }),

  // 공구 수명 데이터 읽기 (path=1|2)
  readToolLife: (machineId: string, path = 1) =>
    api.get(`/api/machines/${machineId}/tool-life?path=${path}`),

  // 공구 수명 변수 쓰기 (제어권 필요)
  writeToolLifeVar: (machineId: string, varNo: number, value: number, varType?: string, dataType?: string) =>
    api.put(`/api/machines/${machineId}/tool-life`, { varNo, value, varType, dataType }),
};

// File Management API (저장소/트랜스퍼/뷰어)
export const fileApi = {
  // DNC 저장소 파일 목록
  listRepoFiles: (machineId: string, pathKey: string) =>
    api.get(`/api/files/repo/${machineId}/${pathKey}`),

  // PC 공용 저장소 파일 목록
  listShareFiles: () =>
    api.get('/api/files/share'),

  // 외부 PC → share 폴더 파일 업로드 (multipart)
  uploadShareFile: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return api.postForm('/api/files/share/upload', form);
  },

  // CNC 프로그램 목록 (기존 transferApi.listPrograms 래핑)
  listCncFiles: (machineId: string) =>
    api.get(`/api/transfer/${machineId}/programs`),

  // 파일 내용 읽기
  readFile: (root: string, machineId: string, fileName: string) =>
    api.get(`/api/files/read?root=${root}&machineId=${machineId}&name=${encodeURIComponent(fileName)}`),

  // 파일 저장
  writeFile: (root: string, machineId: string, fileName: string, content: string) =>
    api.put('/api/files/write', { root, machineId, fileName, content }),

  // 파일 삭제
  deleteFiles: (root: string, machineId: string, fileNames: string[]) =>
    api.post('/api/files/delete', { root, machineId, fileNames }),

  // 파일 전송 (PC ↔ CNC)
  transfer: (machineId: string, direction: string, fileNames: string[], conflictPolicy: string) =>
    api.post('/api/files/transfer', { machineId, direction, fileNames, conflictPolicy }),
};

// Template API (HQ_ENGINEER/ADMIN 전용 - 장비 템플릿 관리)
export const templateApi = {
  getAll: () =>
    api.get('/api/templates'),

  getById: (id: string) =>
    api.get(`/api/templates/${id}`),

  create: (template: Record<string, unknown>) =>
    api.post('/api/templates', template),

  update: (id: string, template: Record<string, unknown>) =>
    api.put(`/api/templates/${id}`, template),

  remove: (id: string) =>
    api.delete(`/api/templates/${id}`),

  reload: (id: string) =>
    api.post(`/api/templates/${id}/reload`),
};

// Diagnostics API
export interface AgentDiagStatus {
  machineId: string;
  machineName: string;
  online: boolean;
  lastSeenMs?: number;
  ipAddress: string;
}

export interface DiagnosticsData {
  timestamp: string;
  services: {
    database: { connected: boolean; latencyMs?: number; error?: string };
    redis: { connected: boolean; error?: string };
    mqtt: { connected: boolean; error?: string };
    websocket: { clientCount: number };
  };
  agents: AgentDiagStatus[];
}

export const settingsApi = {
  getRegistrationCodes: () =>
    api.get<{ adminCode: string; operatorCode: string; hqCodeSet: boolean }>(
      '/api/settings/registration-codes'
    ),
  updateRegistrationCodes: (codes: { adminCode?: string; operatorCode?: string }) =>
    api.put('/api/settings/registration-codes', codes),
};

export const layoutApi = {
  getFactoryLayout: () =>
    api.get<unknown>('/api/settings/factory-layout'),
  saveFactoryLayout: (layout: unknown) =>
    api.put('/api/settings/factory-layout', layout),
};

export const cameraServerApi = {
  /** 서버에 저장된 카메라 설정 목록 조회 */
  getConfigs: () =>
    api.get<unknown[]>('/api/camera/configs'),

  /** 카메라 설정 전체를 서버에 저장 */
  saveConfigs: (cameras: unknown[]) =>
    api.put('/api/camera/configs', cameras),

  /** 특정 카메라 스트림 활성 여부 */
  getStatus: (cameraId: string) =>
    api.get<{ id: string; streaming: boolean }>(`/api/camera/${cameraId}/status`),

  /** MJPEG 스트림 URL 생성 (token 포함) — <img src> 에 직접 사용 */
  getStreamUrl: (cameraId: string): string => {
    const token = useAuthStore.getState().accessToken ?? '';
    return `/api/camera/${cameraId}/stream?token=${encodeURIComponent(token)}`;
  },
};

export const diagnosticsApi = {
  /** 시스템 전체 연결 상태 조회 */
  getStatus: () =>
    api.get<DiagnosticsData>('/api/diagnostics'),

  /** 특정 장비 Agent에 PING 명령 전송 후 응답 대기 (5초) */
  pingAgent: (machineId: string) =>
    api.post<{
      correlationId: string;
      status: string;
      result?: { pong: boolean; timestamp: string };
      errorCode?: string;
      errorMessage?: string;
    }>(`/api/commands/${machineId}?wait=true&timeout=5000`, {
      command: 'PING',
    }),
};
