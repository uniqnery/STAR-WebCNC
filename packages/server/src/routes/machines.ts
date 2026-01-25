// Machine Routes
// CRUD for machines and real-time data access

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redisService, REDIS_KEYS } from '../lib/redis';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ApiResponse, PaginatedResponse } from '../types';
import { UserRole } from '@prisma/client';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /machines
 * Get all machines with current status
 */
router.get('/', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse<PaginatedResponse<unknown>>>
) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const [machines, total] = await Promise.all([
    prisma.machine.findMany({
      where: { isActive: true },
      include: {
        template: {
          select: {
            templateId: true,
            name: true,
            cncType: true,
            seriesName: true,
          },
        },
      },
      skip,
      take: limit,
      orderBy: { machineId: 'asc' },
    }),
    prisma.machine.count({ where: { isActive: true } }),
  ]);

  // Get real-time status from Redis for each machine
  const machinesWithStatus = await Promise.all(
    machines.map(async (machine) => {
      const telemetry = await redisService.get<TelemetryData>(
        REDIS_KEYS.MACHINE_TELEMETRY(machine.machineId)
      );
      const controlLock = await redisService.getControlLock(machine.machineId);

      return {
        ...machine,
        realtime: {
          status: telemetry ? 'online' : 'offline',
          telemetry,
          controlLock: controlLock ? {
            ownerId: controlLock.ownerId,
            ownerUsername: controlLock.ownerUsername,
            acquiredAt: controlLock.acquiredAt,
          } : null,
        },
      };
    })
  );

  return res.json({
    success: true,
    data: {
      items: machinesWithStatus,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

/**
 * GET /machines/:id
 * Get machine by ID with template and current status
 */
router.get('/:id', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;

  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id },
        { machineId: id },
      ],
    },
    include: {
      template: true,
    },
  });

  if (!machine) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '장비를 찾을 수 없습니다.',
      },
    });
  }

  // Get real-time status
  const telemetry = await redisService.get<TelemetryData>(
    REDIS_KEYS.MACHINE_TELEMETRY(machine.machineId)
  );
  const controlLock = await redisService.getControlLock(machine.machineId);

  return res.json({
    success: true,
    data: {
      ...machine,
      realtime: {
        status: telemetry ? 'online' : 'offline',
        telemetry,
        controlLock,
      },
    },
  });
}));

/**
 * GET /machines/:id/template
 * Get template for machine (used by Agent)
 */
router.get('/:id/template', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;

  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id },
        { machineId: id },
      ],
    },
    include: {
      template: true,
    },
  });

  if (!machine) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '장비를 찾을 수 없습니다.',
      },
    });
  }

  return res.json({
    success: true,
    data: machine.template,
  });
}));

/**
 * GET /machines/:id/telemetry
 * Get current telemetry data
 */
router.get('/:id/telemetry', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;

  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id },
        { machineId: id },
      ],
    },
  });

  if (!machine) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '장비를 찾을 수 없습니다.',
      },
    });
  }

  const telemetry = await redisService.get<TelemetryData>(
    REDIS_KEYS.MACHINE_TELEMETRY(machine.machineId)
  );

  return res.json({
    success: true,
    data: {
      machineId: machine.machineId,
      telemetry,
      lastUpdated: telemetry ? new Date().toISOString() : null,
    },
  });
}));

/**
 * GET /machines/:id/alarms
 * Get alarm history
 */
router.get('/:id/alarms', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const skip = (page - 1) * limit;
  const activeOnly = req.query.active === 'true';

  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id },
        { machineId: id },
      ],
    },
  });

  if (!machine) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '장비를 찾을 수 없습니다.',
      },
    });
  }

  const whereCondition = {
    machineId: machine.id,
    ...(activeOnly && { clearedAt: null }),
  };

  const [alarms, total] = await Promise.all([
    prisma.alarm.findMany({
      where: whereCondition,
      orderBy: { occurredAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.alarm.count({ where: whereCondition }),
  ]);

  return res.json({
    success: true,
    data: {
      items: alarms,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

/**
 * POST /machines/:id/control/acquire
 * Acquire control lock
 */
router.post('/:id/control/acquire', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'sessionId가 필요합니다.',
      },
    });
  }

  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id },
        { machineId: id },
      ],
    },
  });

  if (!machine) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '장비를 찾을 수 없습니다.',
      },
    });
  }

  // Check existing lock
  const existingLock = await redisService.getControlLock(machine.machineId);
  if (existingLock && existingLock.ownerId !== req.user!.id) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'LOCK_CONFLICT',
        message: `${existingLock.ownerUsername}님이 제어권을 보유 중입니다.`,
      },
    });
  }

  // Acquire lock (5 minutes TTL)
  const acquired = await redisService.acquireControlLock(
    machine.machineId,
    req.user!.id,
    req.user!.username,
    sessionId,
    300
  );

  if (!acquired) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'LOCK_FAILED',
        message: '제어권 획득에 실패했습니다.',
      },
    });
  }

  // Log the acquisition
  await prisma.controlLockLog.create({
    data: {
      machineId: machine.machineId,
      event: 'ACQUIRED',
      ownerId: req.user!.id,
      sessionId,
    },
  });

  return res.json({
    success: true,
    data: {
      acquired: true,
      expiresIn: 300,
    },
  });
}));

/**
 * POST /machines/:id/control/release
 * Release control lock
 */
router.post('/:id/control/release', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;

  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id },
        { machineId: id },
      ],
    },
  });

  if (!machine) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '장비를 찾을 수 없습니다.',
      },
    });
  }

  const released = await redisService.releaseControlLock(machine.machineId, req.user!.id);

  if (released) {
    await prisma.controlLockLog.create({
      data: {
        machineId: machine.machineId,
        event: 'RELEASED',
        ownerId: req.user!.id,
        sessionId: '',
      },
    });
  }

  return res.json({
    success: true,
    data: { released },
  });
}));

/**
 * POST /machines/:id/control/extend
 * Extend control lock TTL (heartbeat)
 */
router.post('/:id/control/extend', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;

  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id },
        { machineId: id },
      ],
    },
  });

  if (!machine) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '장비를 찾을 수 없습니다.',
      },
    });
  }

  const extended = await redisService.extendControlLock(machine.machineId, req.user!.id, 300);

  return res.json({
    success: true,
    data: { extended },
  });
}));

/**
 * POST /machines/:id/control/force-release
 * Force release control lock (Admin only)
 */
router.post('/:id/control/force-release',
  authorize(UserRole.ADMIN, UserRole.AS),
  asyncHandler(async (
    req: Request,
    res: Response<ApiResponse>
  ) => {
    const { id } = req.params;
    const { reason } = req.body;

    const machine = await prisma.machine.findFirst({
      where: {
        OR: [
          { id },
          { machineId: id },
        ],
      },
    });

    if (!machine) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '장비를 찾을 수 없습니다.',
        },
      });
    }

    const existingLock = await redisService.getControlLock(machine.machineId);

    await redisService.forceReleaseControlLock(machine.machineId);

    if (existingLock) {
      await prisma.controlLockLog.create({
        data: {
          machineId: machine.machineId,
          event: 'FORCED_RELEASE',
          ownerId: existingLock.ownerId,
          sessionId: existingLock.sessionId,
          reason,
          releasedBy: req.user!.id,
        },
      });
    }

    return res.json({
      success: true,
      data: { released: true },
    });
  })
);

export default router;

// Type definitions
interface TelemetryData {
  runState: number;
  mode: string;
  programNo: string;
  feedrate: number;
  spindleSpeed: number;
  partsCount: number;
  alarmActive: boolean;
  absolutePosition?: number[];
  machinePosition?: number[];
}
