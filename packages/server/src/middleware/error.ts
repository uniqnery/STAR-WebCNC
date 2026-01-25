// Error Handling Middleware

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiResponse } from '../types';

// Custom error class
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Common errors
export const errors = {
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.'),
  forbidden: () => new AppError(403, 'FORBIDDEN', '접근 권한이 없습니다.'),
  notFound: (resource: string) =>
    new AppError(404, 'NOT_FOUND', `${resource}을(를) 찾을 수 없습니다.`),
  badRequest: (message: string) =>
    new AppError(400, 'BAD_REQUEST', message),
  conflict: (message: string) =>
    new AppError(409, 'CONFLICT', message),
  internal: () =>
    new AppError(500, 'INTERNAL_ERROR', '서버 내부 오류가 발생했습니다.'),
};

// Error handler middleware
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response<ApiResponse>,
  _next: NextFunction
): void {
  console.error('Error:', err);

  // Zod validation error
  if (err instanceof ZodError) {
    const messages = err.errors.map(e => e.message).join(', ');
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: messages,
      },
    });
    return;
  }

  // Custom app error
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as { code?: string };
    if (prismaError.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: '이미 존재하는 데이터입니다.',
        },
      });
      return;
    }
    if (prismaError.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '요청한 데이터를 찾을 수 없습니다.',
        },
      });
      return;
    }
  }

  // Default error
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
    },
  });
}

// Async handler wrapper
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
