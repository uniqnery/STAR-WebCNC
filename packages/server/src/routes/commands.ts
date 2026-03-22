// Command Routes
// Send commands to machines via MQTT

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { mqttService, TOPICS } from '../lib/mqtt';
import { redisService } from '../lib/redis';
import { commandWaiter } from '../lib/commandWaiter';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ApiResponse } from '../types';
import { UserRole, CommandStatus } from '@prisma/client';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /commands/:machineId
 * Send command to machine
 */
router.post('/:machineId',
  authorize(UserRole.ADMIN, UserRole.HQ_ENGINEER),
  asyncHandler(async (
    req: Request,
    res: Response<ApiResponse>
  ) => {
    const { machineId } = req.params;
    const { command, params } = req.body;
    // ?wait=true : Agent 결과를 최대 timeoutMs 동안 대기 후 반환
    const waitForResult = req.query['wait'] === 'true';
    const timeoutMs     = parseInt(req.query['timeout'] as string) || 30_000;

    if (!command) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'command가 필요합니다.',
        },
      });
    }

    // Find machine
    const machine = await prisma.machine.findFirst({
      where: {
        OR: [
          { id: machineId },
          { machineId: machineId },
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

    // Check control lock for control commands
    const controlCommands = ['WRITE_MACRO', 'START', 'STOP', 'RESET', 'CYCLE_START', 'FEED_HOLD'];
    if (controlCommands.includes(command.toUpperCase())) {
      const lock = await redisService.getControlLock(machine.machineId);
      if (!lock || lock.ownerId !== req.user!.id) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'NO_CONTROL_LOCK',
            message: '제어권이 없습니다. 제어권을 먼저 획득하세요.',
          },
        });
      }
    }

    // Generate correlation ID
    const correlationId = uuidv4();

    // Create command log
    const commandLog = await prisma.commandLog.create({
      data: {
        correlationId,
        machineId: machine.id,
        command,
        params: params || null,
        status: CommandStatus.PENDING,
      },
    });

    // Send command via MQTT
    await mqttService.sendCommand(
      machine.machineId,
      command,
      correlationId,
      params
    );

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        userRole: req.user!.role,
        action: `command.${command.toLowerCase()}`,
        targetType: 'machine',
        targetId: machine.id,
        params: { correlationId, params },
        result: 'pending',
        ipAddress: req.ip || 'unknown',
      },
    });

    // ── wait=true: Agent 응답을 동기적으로 대기 ──────────────────
    if (waitForResult) {
      try {
        const cmdResult = await commandWaiter.wait(correlationId, timeoutMs);
        return res.json({
          success: cmdResult.status === 'success',
          data: {
            correlationId,
            status: cmdResult.status === 'success' ? CommandStatus.SUCCESS : CommandStatus.FAILURE,
            result: cmdResult.result ?? null,
            errorCode: cmdResult.errorCode,
            errorMessage: cmdResult.errorMessage,
          },
        });
      } catch {
        // timeout
        return res.status(504).json({
          success: false,
          error: {
            code: 'COMMAND_TIMEOUT',
            message: `명령 응답 대기 시간 초과 (${timeoutMs}ms)`,
          },
        });
      }
    }

    // ── 기본: PENDING 즉시 반환 ──────────────────────────────────
    return res.json({
      success: true,
      data: {
        correlationId,
        status: 'PENDING',
        message: '명령이 전송되었습니다.',
      },
    });
  })
);

/**
 * GET /commands/:machineId/:correlationId
 * Get command status
 */
router.get('/:machineId/:correlationId', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { machineId, correlationId } = req.params;

  // Find machine
  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id: machineId },
        { machineId: machineId },
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

  // Find command log
  const commandLog = await prisma.commandLog.findFirst({
    where: {
      correlationId,
      machineId: machine.id,
    },
  });

  if (!commandLog) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '명령을 찾을 수 없습니다.',
      },
    });
  }

  return res.json({
    success: true,
    data: commandLog,
  });
}));

/**
 * GET /commands/:machineId
 * Get command history for machine
 */
router.get('/:machineId', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse>
) => {
  const { machineId } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  // Find machine
  const machine = await prisma.machine.findFirst({
    where: {
      OR: [
        { id: machineId },
        { machineId: machineId },
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

  const [commands, total] = await Promise.all([
    prisma.commandLog.findMany({
      where: { machineId: machine.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.commandLog.count({ where: { machineId: machine.id } }),
  ]);

  return res.json({
    success: true,
    data: {
      items: commands,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

export default router;
