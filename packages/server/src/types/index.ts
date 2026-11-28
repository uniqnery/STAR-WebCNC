// Star-WebCNC Type Definitions

import { UserRole } from '@prisma/client';

// JWT Payload
export interface AccessTokenPayload {
  authVersion?: number;
  displayName?: string;
  sub: string;        // User ID
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  authVersion?: number;
  rememberMe?: boolean;
  sub: string;        // User ID
  jti: string;        // JWT ID for revocation
  iat?: number;
  exp?: number;
}

// Auth Request/Response
export interface LoginRequest {
  rememberMe?: boolean;
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    username: string;
    displayName?: string;
    email: string | null;
    mustChangePassword?: boolean;
    role: UserRole;
    isRepresentative?: boolean;
  };
}

export interface RefreshResponse {
  rememberMe?: boolean;
  accessToken: string;
}

// Express Request Extension
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        displayName?: string;
        role: UserRole;
        isRepresentative?: boolean;
        actualRole?: UserRole;
        testRole?: UserRole;
      };
    }
  }
}

// API Response
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
