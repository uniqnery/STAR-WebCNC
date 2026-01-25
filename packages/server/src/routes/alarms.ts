// Alarms Routes

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

// All alarm routes require authentication
router.use(authenticate);

// Get alarms with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const skip = (page - 1) * limit;
    const machineId = req.query.machineId as string | undefined;
    const active = req.query.active as string | undefined;

    // Build where clause
    const where: any = {};

    if (machineId) {
      const machine = await prisma.machine.findUnique({
        where: { machineId },
      });
      if (machine) {
        where.machineDbId = machine.id;
      }
    }

    if (active === 'true') {
      where.clearedAt = null;
    } else if (active === 'false') {
      where.clearedAt = { not: null };
    }

    const [alarms, total] = await Promise.all([
      prisma.alarm.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip,
        take: limit,
        include: {
          machine: { select: { machineId: true, name: true } },
          acknowledgedByUser: { select: { id: true, username: true } },
        },
      }),
      prisma.alarm.count({ where }),
    ]);

    res.json({
      success: true,
      data: alarms.map((alarm) => ({
        id: alarm.id,
        machineId: alarm.machine.machineId,
        machineName: alarm.machine.name,
        alarmNo: alarm.alarmNo,
        alarmMsg: alarm.alarmMsg,
        alarmType: alarm.alarmType,
        occurredAt: alarm.occurredAt.toISOString(),
        clearedAt: alarm.clearedAt?.toISOString(),
        acknowledgedBy: alarm.acknowledgedByUser?.username,
        acknowledgedAt: alarm.acknowledgedAt?.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Alarms] Failed to get alarms:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '알람 목록 조회 실패' },
    });
  }
});

// Get alarm stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const machines = await prisma.machine.findMany({
      select: { id: true, machineId: true, name: true },
    });

    const stats = await Promise.all(
      machines.map(async (machine) => {
        const activeCount = await prisma.alarm.count({
          where: {
            machineDbId: machine.id,
            clearedAt: null,
          },
        });

        const todayCount = await prisma.alarm.count({
          where: {
            machineDbId: machine.id,
            occurredAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
        });

        return {
          machineId: machine.machineId,
          machineName: machine.name,
          activeCount,
          todayCount,
        };
      })
    );

    const totalActive = stats.reduce((sum, s) => sum + s.activeCount, 0);
    const totalToday = stats.reduce((sum, s) => sum + s.todayCount, 0);

    res.json({
      success: true,
      data: {
        machines: stats,
        summary: {
          totalActive,
          totalToday,
        },
      },
    });
  } catch (error) {
    console.error('[Alarms] Failed to get stats:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '알람 통계 조회 실패' },
    });
  }
});

// Acknowledge alarm
router.post('/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const alarm = await prisma.alarm.findUnique({
      where: { id: req.params.id },
    });

    if (!alarm) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '알람을 찾을 수 없습니다' },
      });
    }

    if (alarm.acknowledgedAt) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_ACKNOWLEDGED', message: '이미 확인된 알람입니다' },
      });
    }

    const updatedAlarm = await prisma.alarm.update({
      where: { id: alarm.id },
      data: {
        acknowledgedById: req.user!.id,
        acknowledgedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        id: updatedAlarm.id,
        acknowledgedAt: updatedAlarm.acknowledgedAt?.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Alarms] Failed to acknowledge alarm:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '알람 확인 실패' },
    });
  }
});

// Store alarm from Agent (internal use)
export async function storeAlarm(data: {
  machineId: string;
  alarmNo: number;
  alarmMsg: string;
  type: 'occur' | 'clear';
}): Promise<void> {
  try {
    const machine = await prisma.machine.findUnique({
      where: { machineId: data.machineId },
    });

    if (!machine) {
      console.warn(`[Alarms] Machine not found: ${data.machineId}`);
      return;
    }

    if (data.type === 'occur') {
      // Check for existing active alarm
      const existing = await prisma.alarm.findFirst({
        where: {
          machineDbId: machine.id,
          alarmNo: data.alarmNo,
          clearedAt: null,
        },
      });

      if (!existing) {
        await prisma.alarm.create({
          data: {
            machineDbId: machine.id,
            alarmNo: data.alarmNo,
            alarmMsg: data.alarmMsg,
            alarmType: 'ALARM',
            occurredAt: new Date(),
          },
        });
        console.log(`[Alarms] Stored alarm: ${data.machineId} #${data.alarmNo}`);
      }
    } else {
      // Clear alarm
      await prisma.alarm.updateMany({
        where: {
          machineDbId: machine.id,
          alarmNo: data.alarmNo,
          clearedAt: null,
        },
        data: {
          clearedAt: new Date(),
        },
      });
      console.log(`[Alarms] Cleared alarm: ${data.machineId} #${data.alarmNo}`);
    }
  } catch (error) {
    console.error('[Alarms] Failed to store alarm:', error);
  }
}

export default router;
