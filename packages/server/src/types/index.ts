// Star-WebCNC Type Definitions

import { UserRole } from '@prisma/client';

// JWT Payload
export interface AccessTokenPayload {
  sub: string;        // User ID
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;        // User ID
  jti: string;        // JWT ID for revocation
  iat?: number;
  exp?: number;
}

// Auth Request/Response
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: UserRole;
  };
}

export interface RefreshResponse {
  accessToken: string;
}

// Express Request Extension
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        role: UserRole;
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
