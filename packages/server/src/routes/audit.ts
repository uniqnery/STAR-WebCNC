// Audit Routes - Activity Logging

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

interface AuditLogInput {
  userId: string;
  userRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  params?: Record<string, unknown>;
  result: string;
  errorMsg?: string;
  ipAddress: string;
}

// Get audit logs with filtering and pagination
router.get('/', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const { action, targetId, userId, startDate, endDate } = req.query;

    // Build where clause
    const whereClause: Record<string, unknown> = {};

    if (action && typeof action === 'string') {
      whereClause.action = { contains: action };
    }

    if (targetId && typeof targetId === 'string') {
      whereClause.targetId = targetId;
    }

    if (userId && typeof userId === 'string') {
      whereClause.userId = userId;
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate && typeof startDate === 'string') {
        (whereClause.createdAt as Record<string, unknown>).gte = new Date(startDate);
      }
      if (endDate && typeof endDate === 'string') {
        (whereClause.createdAt as Record<string, unknown>).lte = new Date(endDate);
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where: whereClause }),
    ]);

    res.json({
      success: true,
      data: {
        items: logs,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get audit log detail
router.get('/:id', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        error: { code: 'LOG_NOT_FOUND', message: '로그를 찾을 수 없습니다' },
      });
    }

    res.json({
      success: true,
      data: log,
    });
  } catch (error) {
    next(error);
  }
});

// Get audit statistics
router.get('/stats/summary', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days } = req.query;
    const daysCount = parseInt(days as string) || 7;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysCount);

    // Count by action type
    const actionCounts = await prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        createdAt: { gte: startDate },
      },
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    });

    // Count by user
    const userCounts = await prisma.auditLog.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: startDate },
      },
      _count: { userId: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 10,
    });

    // Count by result
    const resultCounts = await prisma.auditLog.groupBy({
      by: ['result'],
      where: {
        createdAt: { gte: startDate },
      },
      _count: { result: true },
    });

    // Total count
    const totalCount = await prisma.auditLog.count({
      where: {
        createdAt: { gte: startDate },
      },
    });

    // Get user info for userCounts
    const userIds = userCounts.map((u) => u.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    res.json({
      success: true,
      data: {
        period: {
          days: daysCount,
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
        },
        totalCount,
        byAction: actionCounts.map((a) => ({
          action: a.action,
          count: a._count.action,
        })),
        byUser: userCounts.map((u) => ({
          userId: u.userId,
          username: userMap.get(u.userId) || 'Unknown',
          count: u._count.userId,
        })),
        byResult: resultCounts.map((r) => ({
          result: r.result,
          count: r._count.result,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Create audit log (internal helper)
export async function createAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        userRole: input.userRole,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        params: input.params || {},
        result: input.result,
        errorMsg: input.errorMsg,
        ipAddress: input.ipAddress,
      },
    });
  } catch (error) {
    console.error('[Audit] Failed to create audit log:', error);
    // Don't throw - audit logging should not break main flow
  }
}

export default router;
