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
import {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  RefreshResponse
} from '../types';

const router = Router();

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
          message: '사용자명과 비밀번호를 입력해주세요.',
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
          message: '사용자명 또는 비밀번호가 올바르지 않습니다.',
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
          message: '사용자명 또는 비밀번호가 올바르지 않습니다.',
        },
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      username: user.username,
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
      data: user,
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

export default router;
