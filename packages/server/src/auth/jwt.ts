// JWT Token Module
// Access Token + Refresh Token with Rotation

import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AccessTokenPayload, RefreshTokenPayload } from '../types';
import { UserRole } from '@prisma/client';

/**
 * Generate Access Token (short-lived)
 */
export function generateAccessToken(payload: {
  userId: string;
  username: string;
  role: UserRole;
}): string {
  const tokenPayload: AccessTokenPayload = {
    sub: payload.userId,
    username: payload.username,
    role: payload.role,
  };

  return jwt.sign(tokenPayload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
  });
}

/**
 * Generate Refresh Token (long-lived)
 * Returns both the token and the JTI for storage
 */
export function generateRefreshToken(userId: string): {
  token: string;
  jti: string;
  expiresAt: Date;
} {
  const jti = uuidv4();

  // Parse expiration time
  const expiresIn = config.jwt.refreshExpiresIn;
  const expiresAt = new Date();

  // Parse duration string (e.g., "7d", "24h", "60m")
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 'd':
        expiresAt.setDate(expiresAt.getDate() + value);
        break;
      case 'h':
        expiresAt.setHours(expiresAt.getHours() + value);
        break;
      case 'm':
        expiresAt.setMinutes(expiresAt.getMinutes() + value);
        break;
      case 's':
        expiresAt.setSeconds(expiresAt.getSeconds() + value);
        break;
    }
  } else {
    // Default to 7 days
    expiresAt.setDate(expiresAt.getDate() + 7);
  }

  const tokenPayload: RefreshTokenPayload = {
    sub: userId,
    jti,
  };

  const token = jwt.sign(tokenPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });

  return { token, jti, expiresAt };
}

/**
 * Verify Access Token
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify Refresh Token
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}
