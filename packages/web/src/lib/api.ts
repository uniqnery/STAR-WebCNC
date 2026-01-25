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
