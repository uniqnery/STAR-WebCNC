// Machine Routes
// CRUD for machines and real-time data access

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { redisService, REDIS_KEYS } from '../lib/redis';
import { mqttService } from '../lib/mqtt';
import { commandWaiter } from '../lib/commandWaiter';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ApiResponse, PaginatedResponse } from '../types';
import { UserRole, CommandStatus } from '@prisma/client';

const router = Router();

// ── NC 데이터 명령 헬퍼 ──────────────────────────────────────────
async function sendNcCommand(
  machineDbId: string,
  machineId: string,
  command: string,
  params: Record<string, unknown> | undefined,
  timeoutMs = 30_000,
): Promise<{ status: string; result?: unknown; errorCode?: string; errorMessage?: string }> {
  const correlationId = uuidv4();
  await prisma.commandLog.create({
    data: {
      correlationId,
      machineId: machineDbId,
      command,
      params: (params as object | undefined) ?? undefined,
      status: CommandStatus.PENDING,
    },
  });
  await mqttService.sendCommand(machineId, command, correlationId, params);
  return commandWaiter.wait(correlationId, timeoutMs);
}

// All routes require authentication
router.use(authenticate);

/**
 * POST /machines
 * Register a new machine (HQ_ENGINEER only)
 */
router.post('/',
  authorize(UserRole.HQ_ENGINEER, UserRole.ADMIN),
  asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
    const { machineId, name, ipAddress, port, serialNumber, location, templateId } = req.body as {
      machineId: string;
      name: string;
      ipAddress: string;
      port: number;
      serialNumber?: string;
      location?: string;
      templateId: string;
    };

    if (!machineId?.trim()) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '설비 번호가 필요합니다.' } });
    if (!name?.trim())      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '설비명이 필요합니다.' } });
    if (!ipAddress?.trim()) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'IP 주소가 필요합니다.' } });
    if (!templateId)        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '템플릿을 선택하세요.' } });

    // machineId 중복 확인
    const existing = await prisma.machine.findUnique({ where: { machineId } });
    if (existing) return res.status(409).json({ success: false, error: { code: 'DUPLICATE_MACHINE_ID', message: '이미 사용 중인 설비 번호입니다.' } });

    // templateId 존재 확인
    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) return res.status(400).json({ success: false, error: { code: 'TEMPLATE_NOT_FOUND', message: '선택한 템플릿을 찾을 수 없습니다.' } });

    const machine = await prisma.machine.create({
      data: {
        machineId: machineId.trim(),
        name: name.trim(),
        ipAddress: ipAddress.trim(),
        port: port ?? 8193,
        serialNumber: serialNumber?.trim() || null,
        location: location?.trim() || null,
        templateId,
      },
      include: {
        template: {
          select: { templateId: true, name: true, cncType: true, seriesName: true },
        },
      },
    });

    return res.status(201).json({ success: true, data: machine });
  })
);

/**
 * PUT /machines/:id
 * Update machine info (HQ_ENGINEER only)
 */
router.put('/:id',
  authorize(UserRole.HQ_ENGINEER, UserRole.ADMIN),
  asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
    const { id } = req.params;
    const { name, ipAddress, port, serialNumber, location, templateId } = req.body as {
      name?: string;
      ipAddress?: string;
      port?: number;
      serialNumber?: string;
      location?: string;
      templateId?: string;
    };

    const machine = await prisma.machine.findFirst({
      where: { OR: [{ id }, { machineId: id }] },
    });
    if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

    if (templateId) {
      const template = await prisma.template.findUnique({ where: { id: templateId } });
      if (!template) return res.status(400).json({ success: false, error: { code: 'TEMPLATE_NOT_FOUND', message: '선택한 템플릿을 찾을 수 없습니다.' } });
    }

    const updated = await prisma.machine.update({
      where: { id: machine.id },
      data: {
        ...(name        !== undefined && { name: name.trim() }),
        ...(ipAddress   !== undefined && { ipAddress: ipAddress.trim() }),
        ...(port        !== undefined && { port }),
        ...(serialNumber !== undefined && { serialNumber: serialNumber?.trim() || null }),
        ...(location    !== undefined && { location: location?.trim() || null }),
        ...(templateId  !== undefined && { templateId }),
      },
      include: {
        template: {
          select: { templateId: true, name: true, cncType: true, seriesName: true },
        },
      },
    });

    return res.json({ success: true, data: updated });
  })
);

/**
 * DELETE /machines/:id
 * Soft-delete machine (isActive = false) — HQ_ENGINEER only
 */
router.delete('/:id',
  authorize(UserRole.HQ_ENGINEER, UserRole.ADMIN),
  asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
    const { id } = req.params;

    const machine = await prisma.machine.findFirst({
      where: { OR: [{ id }, { machineId: id }] },
    });
    if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

    await prisma.machine.update({
      where: { id: machine.id },
      data: { isActive: false },
    });

    return res.json({ success: true, data: { deleted: true } });
  })
);

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
  // 같은 사용자가 이미 보유 중이면 TTL 갱신 (setNX는 기존 키를 덮지 않으므로 set으로 처리)
  let acquired: boolean;
  if (existingLock && existingLock.ownerId === req.user!.id) {
    await redisService.set(REDIS_KEYS.CONTROL_LOCK(machine.machineId), {
      ...existingLock,
      sessionId,
      expiresAt: new Date(Date.now() + 300 * 1000).toISOString(),
    }, 300);
    acquired = true;
  } else {
    acquired = await redisService.acquireControlLock(
      machine.machineId,
      req.user!.id,
      req.user!.username,
      sessionId,
      300
    );
  }

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
  authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER),
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

// ── NC 데이터 라우트 ─────────────────────────────────────────────

/**
 * GET /machines/:id/offsets?path=1&count=64
 * 마모 오프셋 읽기 (FOCAS2 READ_OFFSETS 명령)
 */
router.get('/:id/offsets', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const path  = parseInt(req.query.path  as string) || 1;
  const count = Math.min(parseInt(req.query.count as string) || 64, 64);

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  try {
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'READ_OFFSETS', { path, count });
    if (cmdResult.status !== 'success')
      return res.status(502).json({ success: false, error: { code: cmdResult.errorCode ?? 'AGENT_ERROR', message: cmdResult.errorMessage ?? '오프셋 읽기 실패' } });
    return res.json({ success: true, data: cmdResult.result });
  } catch {
    return res.status(504).json({ success: false, error: { code: 'COMMAND_TIMEOUT', message: 'Agent 응답 시간 초과' } });
  }
}));

/**
 * PUT /machines/:id/offsets
 * 마모 오프셋 쓰기 (제어권 필요)
 * body: { path, no, axis, value }  axis: 'X'|'Z'|'Y'|'R'
 */
router.put('/:id/offsets', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const { path, no, axis, value } = req.body as { path: number; no: number; axis: string; value: number };

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  // 제어권 확인
  const lock = await redisService.getControlLock(machine.machineId);
  if (!lock || lock.ownerId !== req.user!.id)
    return res.status(403).json({ success: false, error: { code: 'NO_CONTROL_LOCK', message: '제어권이 없습니다.' } });

  // 축 → axisIdx 변환 (X=0, Y=1, Z=2, R=3) — FocasDataReader.WriteWearOffset 순서와 일치
  const AXIS_MAP: Record<string, number> = { X: 0, Y: 1, Z: 2, R: 3 };
  const axisIdx = AXIS_MAP[axis?.toUpperCase()];
  if (axisIdx === undefined)
    return res.status(400).json({ success: false, error: { code: 'INVALID_AXIS', message: 'axis는 X/Z/Y/R 중 하나입니다.' } });

  try {
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'WRITE_OFFSET',
      { path: path ?? 1, toolNo: no, axisIdx, value });
    if (cmdResult.status !== 'success')
      return res.status(502).json({ success: false, error: { code: cmdResult.errorCode ?? 'AGENT_ERROR', message: cmdResult.errorMessage ?? '오프셋 쓰기 실패' } });
    return res.json({ success: true, data: cmdResult.result });
  } catch {
    return res.status(504).json({ success: false, error: { code: 'COMMAND_TIMEOUT', message: 'Agent 응답 시간 초과' } });
  }
}));

/**
 * GET /machines/:id/count
 * 카운터 데이터 읽기 (템플릿 CounterConfig 기반)
 */
router.get('/:id/count', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  try {
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'READ_COUNT', undefined);
    if (cmdResult.status !== 'success')
      return res.status(502).json({ success: false, error: { code: cmdResult.errorCode ?? 'AGENT_ERROR', message: cmdResult.errorMessage ?? '카운터 읽기 실패' } });
    return res.json({ success: true, data: cmdResult.result });
  } catch {
    return res.status(504).json({ success: false, error: { code: 'COMMAND_TIMEOUT', message: 'Agent 응답 시간 초과' } });
  }
}));

/**
 * PUT /machines/:id/count
 * 카운터 변수 쓰기 (제어권 필요)
 * body: { varNo, value }
 */
router.put('/:id/count', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const { varNo, value } = req.body as { varNo: number; value: number };

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  const lock = await redisService.getControlLock(machine.machineId);
  if (!lock || lock.ownerId !== req.user!.id)
    return res.status(403).json({ success: false, error: { code: 'NO_CONTROL_LOCK', message: '제어권이 없습니다.' } });

  try {
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'WRITE_COUNT', { varNo, value });
    if (cmdResult.status !== 'success')
      return res.status(502).json({ success: false, error: { code: cmdResult.errorCode ?? 'AGENT_ERROR', message: cmdResult.errorMessage ?? '카운터 쓰기 실패' } });
    return res.json({ success: true, data: cmdResult.result });
  } catch {
    return res.status(504).json({ success: false, error: { code: 'COMMAND_TIMEOUT', message: 'Agent 응답 시간 초과' } });
  }
}));

/**
 * GET /machines/:id/tool-life?path=1
 * 공구 수명 데이터 읽기 (템플릿 ToolLifeConfig 기반)
 */
router.get('/:id/tool-life', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const path = parseInt(req.query.path as string) || 1;

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  try {
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'READ_TOOL_LIFE', { path });
    if (cmdResult.status !== 'success')
      return res.status(502).json({ success: false, error: { code: cmdResult.errorCode ?? 'AGENT_ERROR', message: cmdResult.errorMessage ?? '공구 수명 읽기 실패' } });
    return res.json({ success: true, data: cmdResult.result });
  } catch {
    return res.status(504).json({ success: false, error: { code: 'COMMAND_TIMEOUT', message: 'Agent 응답 시간 초과' } });
  }
}));

/**
 * PUT /machines/:id/tool-life
 * 공구 수명 변수 쓰기 (제어권 필요)
 * body: { varNo, value, varType?, dataType? }
 */
router.put('/:id/tool-life', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const { varNo, value, varType, dataType } = req.body as { varNo: number; value: number; varType?: string; dataType?: string };

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  const lock = await redisService.getControlLock(machine.machineId);
  if (!lock || lock.ownerId !== req.user!.id)
    return res.status(403).json({ success: false, error: { code: 'NO_CONTROL_LOCK', message: '제어권이 없습니다.' } });

  try {
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'WRITE_TOOL_LIFE_PRESET', { varNo, value, varType, dataType });
    if (cmdResult.status !== 'success')
      return res.status(502).json({ success: false, error: { code: cmdResult.errorCode ?? 'AGENT_ERROR', message: cmdResult.errorMessage ?? '공구 수명 쓰기 실패' } });
    return res.json({ success: true, data: cmdResult.result });
  } catch {
    return res.status(504).json({ success: false, error: { code: 'COMMAND_TIMEOUT', message: 'Agent 응답 시간 초과' } });
  }
}));

// ── DNC Config 라우트 ─────────────────────────────────────────────

/**
 * GET /machines/:id/dnc-config
 * DNC 경로 설정 조회
 */
router.get('/:id/dnc-config', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
    select: { id: true, machineId: true, dncConfig: true },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  return res.json({ success: true, data: { machineId: machine.machineId, dncConfig: machine.dncConfig } });
}));

/**
 * PUT /machines/:id/dnc-config
 * DNC 경로 설정 저장 (Admin/HQ_ENGINEER)
 * body: { path1: string, path2: string, path3?: string }
 */
router.put('/:id/dnc-config',
  authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER),
  asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
    const { id } = req.params;
    const { path1, path2, path3, mainMode, subMode } = req.body as {
      path1: string;
      path2: string;
      path3?: string;
      mainMode?: 'memory' | 'dnc';
      subMode?: 'memory' | 'dnc';
    };

    const machine = await prisma.machine.findFirst({
      where: { OR: [{ id }, { machineId: id }] },
    });
    if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

    const existing = (machine.dncConfig ?? {}) as Record<string, unknown>;
    const dncConfig = {
      ...existing,
      path1: path1 || '',
      path2: path2 || '',
      ...(path3 !== undefined && { path3 }),
      mainMode: mainMode ?? (existing.mainMode as string) ?? (existing.executionMode as string) ?? 'memory',
      subMode:  subMode  ?? (existing.subMode  as string) ?? 'memory',
    };

    const updated = await prisma.machine.update({
      where: { id: machine.id },
      data: { dncConfig },
      select: { machineId: true, dncConfig: true },
    });

    return res.json({ success: true, data: { machineId: updated.machineId, dncConfig: updated.dncConfig } });
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
