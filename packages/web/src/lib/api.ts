// API Client

import { useAuthStore } from '../stores/authStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
        role: 'USER' | 'ADMIN' | 'AS';
      };
    }>('/api/auth/login', { username, password }),

  register: (username: string, email: string, password: string) =>
    api.post<{ id: string; username: string; email: string }>(
      '/api/auth/register',
      { username, email, password }
    ),

  logout: () => api.post('/api/auth/logout'),

  refresh: () =>
    api.post<{ accessToken: string }>('/api/auth/refresh'),

  me: () =>
    api.get<{
      id: string;
      username: string;
      email: string;
      role: 'USER' | 'ADMIN' | 'AS';
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
};

// Command API
export const commandApi = {
  send: (machineId: string, command: string, params?: Record<string, unknown>) =>
    api.post<{ correlationId: string; status: string }>(`/api/commands/${machineId}`, {
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
  getJobs: (page = 1, limit = 50) =>
    api.get(`/api/scheduler/jobs?page=${page}&limit=${limit}`),

  getJob: (jobId: string) =>
    api.get(`/api/scheduler/jobs/${jobId}`),

  createJob: (data: {
    machineId: string;
    programNo: string;
    targetCount: number;
    oneCycleStop: boolean;
  }) =>
    api.post('/api/scheduler/jobs', data),

  startJob: (jobId: string) =>
    api.post(`/api/scheduler/jobs/${jobId}/start`),

  pauseJob: (jobId: string) =>
    api.post(`/api/scheduler/jobs/${jobId}/pause`),

  cancelJob: (jobId: string) =>
    api.post(`/api/scheduler/jobs/${jobId}/cancel`),

  setOneCycleStop: (jobId: string, enabled: boolean) =>
    api.post(`/api/scheduler/jobs/${jobId}/one-cycle-stop`, { enabled }),
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
  saveConfig: (machineId: string, config: { path1: string; path2: string; path3?: string }) =>
    api.put(`/api/machines/${machineId}/dnc-config`, config),
};
