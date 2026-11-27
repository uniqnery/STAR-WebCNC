// Authentication Middleware
// JWT Access Token verification

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { verifyAccessToken, extractBearerToken } from '../auth/jwt';
import { ApiResponse } from '../types';
import { resolveTestRole } from '../auth/roleTest';
import { prisma } from '../lib/prisma';

/**
 * Authentication middleware
 * Verifies JWT Access Token from Authorization header
 */
export async function authenticate(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
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
    displayName: payload.displayName || payload.username,
    role: payload.role,
  };

  const testRole = req.headers['x-role-test'];
  if (testRole !== undefined) {
    try {
      req.user.role = await resolveTestRole(req.user, testRole);
      req.user.actualRole = payload.role;
      req.user.testRole = req.user.role;
      const actor = req.user;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.originalUrl.startsWith('/api/auth/role-test')) {
        res.once('finish', () => {
          void prisma.auditLog.create({ data: { userId: actor.id, actorDisplayName: actor.displayName || actor.username, userRole: actor.role, action: 'auth.role_test_request',
            targetType: 'api', targetId: req.originalUrl.split('?')[0], params: { actualRole: actor.actualRole, testRole: actor.role, method: req.method, status: res.statusCode },
            result: res.statusCode < 400 ? 'success' : 'failure', ipAddress: req.ip ?? 'unknown' } }).catch(() => console.error('[RoleTest] Request audit failed'));
        });
      }
    } catch {
      res.status(403).json({ success: false, error: { code: 'ROLE_TEST_FORBIDDEN', message: '권한 테스트는 활성 본사 엔지니어 계정만 사용할 수 있습니다.' } });
      return;
    }
  }

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
 * requireRole - alias for authorize, supports both array and rest-param call styles
 * requireRole(['ADMIN', 'HQ_ENGINEER']) or requireRole('ADMIN', 'HQ_ENGINEER')
 */
export function requireRole(
  rolesOrFirst: UserRole | UserRole[],
  ...rest: UserRole[]
) {
  const roles: UserRole[] = Array.isArray(rolesOrFirst)
    ? rolesOrFirst
    : [rolesOrFirst, ...rest];
  return authorize(...roles);
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
        displayName: payload.displayName || payload.username,
        role: payload.role,
      };
    }
  }

  next();
}
