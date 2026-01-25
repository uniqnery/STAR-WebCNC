// Authentication Middleware
// JWT Access Token verification

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { verifyAccessToken, extractBearerToken } from '../auth/jwt';
import { ApiResponse } from '../types';

/**
 * Authentication middleware
 * Verifies JWT Access Token from Authorization header
 */
export function authenticate(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): void {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: '인증 토큰이 필요합니다.',
      },
    });
    return;
  }

  const payload = verifyAccessToken(token);

  if (!payload) {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: '유효하지 않거나 만료된 토큰입니다.',
      },
    });
    return;
  }

  // Attach user info to request
  req.user = {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
  };

  next();
}

/**
 * Role-based authorization middleware
 * Must be used after authenticate middleware
 */
export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response<ApiResponse>, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: '인증이 필요합니다.',
        },
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: '접근 권한이 없습니다.',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Optional authentication middleware
 * Attaches user info if token is valid, but doesn't reject if missing
 */
export function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const token = extractBearerToken(req.headers.authorization);

  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      req.user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
      };
    }
  }

  next();
}
