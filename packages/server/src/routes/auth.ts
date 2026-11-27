// Authentication Routes
// Login, Logout, Refresh Token

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken
} from '../auth/jwt';
import { authenticate } from '../middleware/auth';
import { resolveTestRole, validTestRole } from '../auth/roleTest';
import { displayNameOf } from '../auth/identity';
import { redisService } from '../lib/redis';
import {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  RefreshResponse
} from '../types';

const router = Router();

router.post('/role-test', authenticate, async (req, res) => {
  if (!validTestRole(req.body?.role)) return res.status(400).json({ success: false, error: { code: 'INVALID_ROLE', message: '테스트할 권한을 선택하세요.' } });
  try {
    const actor = req.user!;
    const originalRole = actor.actualRole ?? actor.role;
    const target = await resolveTestRole({ id: actor.id, role: originalRole }, req.body.role);
    const pending = await prisma.auditLog.count({ where: { userId: actor.id, result: 'pending', createdAt: { gte: new Date(Date.now() - 60000) } } });
    if (pending) return res.status(409).json({ success: false, error: { code: 'ROLE_TEST_BUSY', message: '처리 중인 요청이 끝난 뒤 권한을 전환하세요.' } });
    const released: string[] = [];
    if (target !== 'HQ_ENGINEER') {
      const machines = await prisma.machine.findMany({ where: { isActive: true }, select: { machineId: true } });
      for (const machine of machines) {
        const lock = await redisService.getControlLock(machine.machineId);
        if (lock?.ownerId === actor.id) {
          if (!await redisService.releaseControlLock(machine.machineId, actor.id)) throw new Error('LOCK_RELEASE_FAILED');
          released.push(machine.machineId);
          await prisma.controlLockLog.create({ data: { machineId: machine.machineId, event: 'RELEASED', ownerId: actor.id, sessionId: lock.sessionId } });
        }
      }
    }
    await prisma.auditLog.create({ data: { userId: actor.id, actorDisplayName: displayNameOf(actor), userRole: target, action: 'auth.role_test', targetType: 'user', targetId: actor.id,
      params: { actualRole: originalRole, fromRole: actor.role, testRole: target, releasedMachines: released }, result: 'success', ipAddress: req.ip ?? 'unknown' } });
    return res.json({ success: true, data: { role: target, actualRole: originalRole, releasedMachines: released } });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === 'ROLE_TEST_FORBIDDEN';
    return res.status(forbidden ? 403 : 503).json({ success: false, error: { code: forbidden ? 'ROLE_TEST_FORBIDDEN' : 'ROLE_TEST_FAILED', message: forbidden ? '본사 엔지니어만 권한을 테스트할 수 있습니다.' : '제어권 반환 또는 이력 저장에 실패했습니다. 상태를 재확인하세요.' } });
  }
});

/**
 * POST /auth/register
 * 신규 회원가입 — registrationCode로 역할 결정
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username: rawUsername, displayName: rawDisplayName, email, password, registrationCode = '' } = req.body as {
      username: string; displayName?: string; email: string; password: string; registrationCode?: string;
    };
    const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
    const displayName = typeof rawDisplayName === 'string' ? rawDisplayName.trim() : '';

    if (!username || !displayName || username.length > 80 || displayName.length > 80 || !email || !password) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '필수 항목을 입력해주세요.' } });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '비밀번호는 6자 이상이어야 합니다.' } });
    }

    // 중복 확인
    const existing = await prisma.user.findFirst({ where: { OR: [{ username }, { email }] } });
    if (existing) {
      const field = existing.username === username ? '로그인 ID' : '이메일';
      return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: `이미 사용 중인 ${field}입니다.` } });
    }

    // 등록 코드 → 역할 결정
    let role: 'USER' | 'ADMIN' | 'HQ_ENGINEER' = 'USER';
    let isApproved = false;

    const hqCode = process.env.HQ_REGISTRATION_CODE ?? '';
    if (hqCode && registrationCode === hqCode) {
      role = 'HQ_ENGINEER';
      isApproved = true;
    } else {
      // DB에서 고객사 코드 조회
      const adminCodeRow = await prisma.globalSetting.findUnique({ where: { key: 'registration.adminCode' } });
      const opCodeRow    = await prisma.globalSetting.findUnique({ where: { key: 'registration.operatorCode' } });
      const adminCode = (adminCodeRow?.value as string) ?? '';
      const opCode    = (opCodeRow?.value as string) ?? '';

      if (adminCode && registrationCode === adminCode) {
        role = 'ADMIN';
        isApproved = true;
      } else if (opCode && registrationCode === opCode) {
        role = 'USER';
        isApproved = true;
      }
      // 코드 없음 or 틀림 → USER, 미승인
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, displayName, email, passwordHash, role: role as import('@prisma/client').UserRole, isActive: true, isApproved },
    });

    return res.status(201).json({
      success: true,
      data: { id: user.id, username: user.username, displayName: displayNameOf(user), email: user.email, role: user.role, isApproved: user.isApproved },
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '회원가입 처리 중 오류가 발생했습니다.' } });
  }
});

/**
 * POST /auth/login
 * User login with username/password
 */
router.post('/login', async (
  req: Request<object, ApiResponse<LoginResponse>, LoginRequest>,
  res: Response<ApiResponse<LoginResponse>>
) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: '로그인 ID와 비밀번호를 입력해주세요.',
        },
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: '로그인 ID 또는 비밀번호가 올바르지 않습니다.',
        },
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DISABLED',
          message: '비활성화된 계정입니다.',
        },
      });
    }

    // Check if user is approved
    if (!user.isApproved) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_NOT_APPROVED',
          message: '승인 대기 중인 계정입니다.',
        },
      });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: '로그인 ID 또는 비밀번호가 올바르지 않습니다.',
        },
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      username: user.username,
      displayName: displayNameOf(user),
      role: user.role,
    });

    const { token: refreshToken, jti, expiresAt } = generateRefreshToken(user.id);

    // Store refresh token in database
    await prisma.refreshToken.create({
      data: {
        jti,
        userId: user.id,
        expiresAt,
      },
    });

    // Update last login time
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Set refresh token in HTTP-only cookie
    res.cookie(config.cookie.refreshTokenName, refreshToken, {
      httpOnly: config.cookie.httpOnly,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      maxAge: config.cookie.maxAge,
    });

    return res.json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          username: user.username,
          displayName: displayNameOf(user),
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '로그인 처리 중 오류가 발생했습니다.',
      },
    });
  }
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token from cookie
 * Implements Refresh Token Rotation
 */
router.post('/refresh', async (
  req: Request,
  res: Response<ApiResponse<RefreshResponse>>
) => {
  try {
    const refreshToken = req.cookies[config.cookie.refreshTokenName];

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NO_REFRESH_TOKEN',
          message: '리프레시 토큰이 없습니다.',
        },
      });
    }

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      // Clear invalid cookie
      res.clearCookie(config.cookie.refreshTokenName);
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: '유효하지 않은 리프레시 토큰입니다.',
        },
      });
    }

    // Check if token exists in database and is not revoked
    const storedToken = await prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
      include: { user: true },
    });

    if (!storedToken || storedToken.revokedAt) {
      // Clear cookie
      res.clearCookie(config.cookie.refreshTokenName);

      // If token was revoked, this might be a token reuse attack
      // Revoke all refresh tokens for this user
      if (storedToken?.revokedAt) {
        await prisma.refreshToken.updateMany({
          where: {
            userId: storedToken.userId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
            revokeReason: 'SECURITY_TOKEN_REUSE',
          },
        });
      }

      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: '유효하지 않은 리프레시 토큰입니다.',
        },
      });
    }

    const user = storedToken.user;

    // Check if user is still active
    if (!user.isActive) {
      res.clearCookie(config.cookie.refreshTokenName);
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DISABLED',
          message: '비활성화된 계정입니다.',
        },
      });
    }

    // Refresh Token Rotation: Revoke old token and issue new one
    await prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: {
        revokedAt: new Date(),
        revokeReason: 'ROTATED',
      },
    });

    // Generate new tokens
    const newAccessToken = generateAccessToken({
      userId: user.id,
      username: user.username,
      displayName: displayNameOf(user),
      role: user.role,
    });

    const { token: newRefreshToken, jti: newJti, expiresAt } = generateRefreshToken(user.id);

    // Store new refresh token
    await prisma.refreshToken.create({
      data: {
        jti: newJti,
        userId: user.id,
        expiresAt,
      },
    });

    // Set new refresh token in cookie
    res.cookie(config.cookie.refreshTokenName, newRefreshToken, {
      httpOnly: config.cookie.httpOnly,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      maxAge: config.cookie.maxAge,
    });

    return res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '토큰 갱신 중 오류가 발생했습니다.',
      },
    });
  }
});

/**
 * POST /auth/logout
 * Logout user and revoke refresh token
 */
router.post('/logout', authenticate, async (
  req: Request,
  res: Response<ApiResponse>
) => {
  try {
    const refreshToken = req.cookies[config.cookie.refreshTokenName];

    if (refreshToken) {
      // Verify and revoke the refresh token
      const payload = verifyRefreshToken(refreshToken);
      if (payload) {
        await prisma.refreshToken.update({
          where: { jti: payload.jti },
          data: {
            revokedAt: new Date(),
            revokeReason: 'LOGOUT',
          },
        });
      }
    }

    // Clear cookie
    res.clearCookie(config.cookie.refreshTokenName);

    return res.json({
      success: true,
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '로그아웃 처리 중 오류가 발생했습니다.',
      },
    });
  }
});

/**
 * POST /auth/logout-all
 * Logout from all devices (revoke all refresh tokens)
 */
router.post('/logout-all', authenticate, async (
  req: Request,
  res: Response<ApiResponse>
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: '인증이 필요합니다.',
        },
      });
    }

    // Revoke all refresh tokens for this user
    await prisma.refreshToken.updateMany({
      where: {
        userId: req.user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokeReason: 'LOGOUT_ALL',
      },
    });

    // Clear cookie
    res.clearCookie(config.cookie.refreshTokenName);

    return res.json({
      success: true,
    });
  } catch (error) {
    console.error('Logout all error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '전체 로그아웃 처리 중 오류가 발생했습니다.',
      },
    });
  }
});

/**
 * GET /auth/me
 * Get current user info
 */
router.get('/me', authenticate, async (
  req: Request,
  res: Response<ApiResponse>
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: '인증이 필요합니다.',
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        role: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: '사용자를 찾을 수 없습니다.',
        },
      });
    }

    return res.json({
      success: true,
      data: { ...user, role: req.user.role, actualRole: req.user.actualRole ?? user.role },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '사용자 정보 조회 중 오류가 발생했습니다.',
      },
    });
  }
});

router.put('/profile', authenticate, async (req, res) => {
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  if (!displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName))
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '사용자명(이름)을 1~80자로 입력하세요.' } });
  try {
    const previous = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!previous?.isActive || !previous.isApproved) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '계정을 확인하세요.' } });
    const user = await prisma.$transaction(async tx => {
      const saved = await tx.user.update({ where: { id: previous.id }, data: { displayName } });
      await tx.auditLog.create({ data: { userId: previous.id, actorDisplayName: displayNameOf(previous), userRole: previous.role,
        action: 'auth.profile_update', targetType: 'user', targetId: previous.id, params: { before: displayNameOf(previous), after: displayName }, result: 'success', ipAddress: req.ip ?? 'unknown' } });
      return saved;
    });
    const accessToken = generateAccessToken({ userId: user.id, username: user.username, displayName: displayNameOf(user), role: user.role });
    return res.json({ success: true, data: { accessToken, user: { id: user.id, username: user.username, displayName: displayNameOf(user), email: user.email, role: user.role } } });
  } catch {
    return res.status(500).json({ success: false, error: { code: 'PROFILE_FAILED', message: '사용자명을 저장하지 못했습니다.' } });
  }
});

export default router;
