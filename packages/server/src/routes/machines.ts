// Machine Routes
// CRUD for machines and real-time data access

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { redisService, REDIS_KEYS } from '../lib/redis';
import { mqttService } from '../lib/mqtt';
import { wsService } from '../lib/websocket';
import { commandWaiter } from '../lib/commandWaiter';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ApiResponse, PaginatedResponse } from '../types';
import { UserRole, CommandStatus } from '@prisma/client';
import { remoteInterlockFailure } from '../lib/remoteInterlock';
import { serialDataWrite } from '../lib/serialDataWrite';
import { getDailyRunRates } from '../lib/dailyRunRates';

const router = Router();

// ── NC 데이터 명령 헬퍼 ──────────────────────────────────────────
function sendNcCommand(...args: Parameters<typeof sendNcCommandNow>) {
  return ['WRITE_OFFSET', 'WRITE_COUNT', 'WRITE_TOOL_LIFE_PRESET'].includes(args[2])
    ? serialDataWrite(args[1], () => sendNcCommandNow(...args)) : sendNcCommandNow(...args);
}
async function sendNcCommandNow(
  machineDbId: string,
  machineId: string,
  command: string,
  params: Record<string, unknown> | undefined,
  actor?: NonNullable<Request['user']>,
  ipAddress?: string,
  historyParams = params,
): Promise<{ status: string; result?: unknown; errorCode?: string; errorMessage?: string }> {
  const correlationId = uuidv4();
  const commandLog = prisma.commandLog.create({
    data: {
      correlationId,
      machineId: machineDbId,
      command,
      params: (historyParams as object | undefined) ?? undefined,
      status: CommandStatus.PENDING,
    },
  });
  if (actor) {
    await prisma.$transaction([
      commandLog,
      prisma.auditLog.create({
        data: {
          userId: actor.id,
        actorDisplayName: actor.displayName || actor.username,
          userRole: actor.role,
          action: `command.${command.toLowerCase()}`,
          targetType: 'machine',
          targetId: machineDbId,
          params: { correlationId, params: (historyParams as object | undefined) ?? null,
            ...(actor.testRole ? { roleTest: { actualRole: actor.actualRole!, effectiveRole: actor.role } } : {}) },
          result: 'pending',
          ipAddress: ipAddress || 'unknown',
        },
      }),
    ]);
  } else {
    await commandLog;
  }
  const waiting = commandWaiter.wait(correlationId);
  void waiting.catch(() => undefined);
  try {
    await mqttService.sendCommand(machineId, command, correlationId, params);
    return await waiting;
  } catch (error) {
    if (actor) await prisma.auditLog.updateMany({ where: { params: { path: ['correlationId'], equals: correlationId }, result: 'pending' },
      data: { result: 'unknown', errorMsg: '응답을 확인하지 못했습니다. 자동 재전송하지 말고 실제 값을 재조회하세요.' } });
    throw error;
  }
}

// All routes require authentication
router.use(authenticate);

router.get('/daily-run-rates', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getDailyRunRates() });
}));

/**
 * GET /machines/next-id
 * Returns the next auto-generated machineId (preview before registration)
 */
router.get('/next-id',
  authorize(UserRole.HQ_ENGINEER),
  asyncHandler(async (_req: Request, res: Response<ApiResponse>) => {
    const activeMachines = await prisma.machine.findMany({ where: { isActive: true }, select: { machineId: true } });
    const maxNum = activeMachines.reduce((max, m) => {
      const match = m.machineId.match(/^MC-(\d{3})$/);
      return match ? Math.max(max, parseInt(match[1])) : max;
    }, 0);
    const nextId = `MC-${String(maxNum + 1).padStart(3, '0')}`;
    return res.json({ success: true, data: { nextId } });
  })
);

/**
 * POST /machines
 * Register a new machine (HQ_ENGINEER only)
 */
router.post('/',
  authorize(UserRole.HQ_ENGINEER),
  asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
    const { name, ipAddress, port, modelName, serialNumber, location, templateId } = req.body as {
      name: string;
      ipAddress: string;
      port: number;
      modelName?: string;
      serialNumber?: string;
      location?: string;
      templateId: string;
    };

    if (!name?.trim())      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '설비명이 필요합니다.' } });
    if (!ipAddress?.trim()) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'IP 주소가 필요합니다.' } });
    if (!templateId)        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '템플릿을 선택하세요.' } });

    // templateId 존재 확인
    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) return res.status(400).json({ success: false, error: { code: 'TEMPLATE_NOT_FOUND', message: '선택한 템플릿을 찾을 수 없습니다.' } });

    // machineId 서버 채번 — 활성 레코드 기준 MAX+1 (삭제된 번호 재사용)
    const activeMachines = await prisma.machine.findMany({ where: { isActive: true }, select: { machineId: true } });
    const maxNum = activeMachines.reduce((max, m) => {
      const match = m.machineId.match(/^MC-(\d{3})$/);
      return match ? Math.max(max, parseInt(match[1])) : max;
    }, 0);
    const machineId = `MC-${String(maxNum + 1).padStart(3, '0')}`;

    // unique 제약 충돌 방지 — 동일 machineId의 soft-deleted 레코드 선제 삭제
    await prisma.machine.deleteMany({ where: { machineId, isActive: false } });

    const machine = await prisma.machine.create({
      data: {
        machineId,
        name: name.trim(),
        ipAddress: ipAddress.trim(),
        port: port ?? 8193,
        modelName: modelName?.trim() || null,
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
  authorize(UserRole.HQ_ENGINEER),
  asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
    const { id } = req.params;
    const { name, ipAddress, port, modelName, serialNumber, location, templateId } = req.body as {
      name?: string;
      ipAddress?: string;
      port?: number;
      modelName?: string;
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
        ...(modelName   !== undefined && { modelName: modelName?.trim() || null }),
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
  authorize(UserRole.HQ_ENGINEER),
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
router.post('/:id/control/acquire', authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER), asyncHandler(async (
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

  const interlockError = await remoteInterlockFailure(machine.machineId);
  if (interlockError) return res.status(409).json({ success: false, error: { code: 'INTERLOCK_FAILED', message: interlockError } });

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

  wsService.sendUserActivity(machine.machineId, 'control', { username: req.user!.username, displayName: req.user!.displayName || req.user!.username, role: req.user!.role }, '제어권 획득');

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
    wsService.sendUserActivity(machine.machineId, 'control', { username: req.user!.username, displayName: req.user!.displayName || req.user!.username, role: req.user!.role }, '제어권 해제');
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
router.post('/:id/control/extend', authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER), asyncHandler(async (
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

router.get('/:id/remote-interlock', asyncHandler(async (req, res) => {
  const machine = await prisma.machine.findFirst({ where: { OR: [{ id: req.params.id }, { machineId: req.params.id }] } });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });
  const reason = await remoteInterlockFailure(machine.machineId);
  return res.json({ success: true, data: { allowed: reason === null, reason } });
}));

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
 * 마모 오프셋 쓰기 (수정 권한 필요)
 * body: { path, no, axis, value, additiveDelta? }  axis: 'X'|'Z'|'Y'|'R'
 */
router.put('/:id/offsets', authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER), asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const { path, no, axis, value, additiveDelta } = req.body as {
    path: number; no: number; axis: string; value: number; additiveDelta?: unknown;
  };

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  // 축 → axisIdx 변환 (X=0, Y=1, Z=2, R=3) — FocasDataReader.WriteWearOffset 순서와 일치
  const AXIS_MAP: Record<string, number> = { X: 0, Y: 1, Z: 2, R: 3 };
  const axisIdx = AXIS_MAP[axis?.toUpperCase()];
  if (axisIdx === undefined)
    return res.status(400).json({ success: false, error: { code: 'INVALID_AXIS', message: 'axis는 X/Z/Y/R 중 하나입니다.' } });

  if (additiveDelta !== undefined && (typeof additiveDelta !== 'number' || !Number.isFinite(additiveDelta))) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_DELTA', message: '+INPUT 값은 유효한 숫자여야 합니다.' } });
  }

  if (!Number.isFinite(value) || !Number.isInteger(no) || no < 1 || no > 64 || ![1, 2].includes(path ?? 1))
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Path, 공구 번호와 유효한 값을 확인하세요.' } });
  const params = { path: path ?? 1, toolNo: no, axisIdx, value, additiveDelta };
  const historyParams = additiveDelta === undefined ? params : { ...params, additiveDelta };
  try {
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'WRITE_OFFSET',
      params, req.user, req.ip, historyParams);
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
 * 카운터 변수 쓰기 (수정 권한 필요)
 * body: { varNo, value, key?, varType? }
 */
router.put('/:id/count', authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER), asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const { varNo, value, key, varType } = req.body as { varNo: number; value: number; key?: string; varType?: string };

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  try {
    if (!Number.isFinite(value) || !Number.isInteger(varNo) || varNo < 0 || (['preset', 'count', 'total'].includes(key ?? '') && (!Number.isInteger(value) || value < 0 || value > 2147483647)))
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '변수 번호와 값을 확인하세요.' } });
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'WRITE_COUNT', { varNo, value, key, varType }, req.user, req.ip);
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
 * 공구 수명 변수 쓰기 (수정 권한 필요)
 * body: { varNo, value, varType?, dataType?, path? }
 */
router.put('/:id/tool-life', authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER), asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;
  const { varNo, value, varType, dataType, path = 1 } = req.body as { varNo: number; value: number; varType?: string; dataType?: string; path?: number };

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  try {
    if (!Number.isFinite(value) || !Number.isInteger(varNo) || varNo < 0 || ![1, 2].includes(path))
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '변수 번호와 값을 확인하세요.' } });
    const cmdResult = await sendNcCommand(machine.id, machine.machineId, 'WRITE_TOOL_LIFE_PRESET', { varNo, value, varType, dataType, path }, req.user, req.ip);
    if (cmdResult.status !== 'success')
      return res.status(502).json({ success: false, error: { code: cmdResult.errorCode ?? 'AGENT_ERROR', message: cmdResult.errorMessage ?? '공구 수명 쓰기 실패' } });
    return res.json({ success: true, data: cmdResult.result });
  } catch {
    return res.status(504).json({ success: false, error: { code: 'COMMAND_TIMEOUT', message: 'Agent 응답 시간 초과' } });
  }
}));

// ── Program Transfer Config 라우트 ────────────────────────────────

/**
 * GET /machines/:id/program-transfer-config
 * 프로그램 파일전송 설정 조회
 */
router.get(['/:id/program-transfer-config', '/:id/dnc-config'], asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { id } = req.params;

  const machine = await prisma.machine.findFirst({
    where: { OR: [{ id }, { machineId: id }] },
    select: { id: true, machineId: true, programTransferConfig: true },
  });
  if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

  return res.json({ success: true, data: { machineId: machine.machineId, programTransferConfig: machine.programTransferConfig, dncConfig: machine.programTransferConfig } });
}));

/**
 * PUT /machines/:id/program-transfer-config
 * 프로그램 파일전송 설정 저장 (Admin/HQ_ENGINEER)
 * body: { path1: string, path2: string, path3?: string }
 */
router.put(['/:id/program-transfer-config', '/:id/dnc-config'],
  authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER),
  asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
    const { id } = req.params;
    const { path1, path2, path3, mainMode, subMode, mainTempProgramNo, mainParkingProgramNo, subTempProgramNo, subParkingProgramNo } = req.body as {
      path1: string;
      path2: string;
      path3?: string;
      mainMode?: 'memory' | 'transfer' | 'dnc';
      subMode?: 'memory' | 'transfer' | 'dnc';
      mainTempProgramNo?: number;
      mainParkingProgramNo?: number;
      subTempProgramNo?: number;
      subParkingProgramNo?: number;
    };

    const machine = await prisma.machine.findFirst({
      where: { OR: [{ id }, { machineId: id }] },
    });
    if (!machine) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다.' } });

    const existing = (machine.programTransferConfig ?? {}) as Record<string, unknown>;
    const programTransferConfig = {
      ...existing,
      path1: path1 || '',
      path2: path2 || '',
      ...(path3 !== undefined && { path3 }),
      mainMode: (mainMode === 'dnc' ? 'transfer' : mainMode) ?? ((existing.mainMode as string) === 'dnc' ? 'transfer' : existing.mainMode as string) ?? ((existing.executionMode as string) === 'dnc' ? 'transfer' : existing.executionMode as string) ?? 'memory',
      subMode:  (subMode === 'dnc' ? 'transfer' : subMode) ?? ((existing.subMode as string) === 'dnc' ? 'transfer' : existing.subMode as string) ?? 'memory',
      mainTempProgramNo: mainTempProgramNo ?? Number(existing.mainTempProgramNo ?? 7777),
      mainParkingProgramNo: mainParkingProgramNo ?? Number(existing.mainParkingProgramNo ?? 7776),
      subTempProgramNo: subTempProgramNo ?? Number(existing.subTempProgramNo ?? 7775),
      subParkingProgramNo: subParkingProgramNo ?? Number(existing.subParkingProgramNo ?? 7774),
    };

    const updated = await prisma.machine.update({
      where: { id: machine.id },
      data: { programTransferConfig },
      select: { machineId: true, programTransferConfig: true },
    });

    return res.json({ success: true, data: { machineId: updated.machineId, programTransferConfig: updated.programTransferConfig, dncConfig: updated.programTransferConfig } });
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
