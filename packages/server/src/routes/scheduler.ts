// Scheduler Routes

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { mqttService, TOPICS } from '../lib/mqtt';
import { redisService, REDIS_KEYS } from '../lib/redis';

const router = Router();

// All scheduler routes require authentication
router.use(authenticate);

// Get all jobs
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      prisma.schedulerJob.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          machine: { select: { id: true, machineId: true, name: true } },
          createdByUser: { select: { id: true, username: true } },
        },
      }),
      prisma.schedulerJob.count(),
    ]);

    res.json({
      success: true,
      data: jobs.map((job) => ({
        id: job.id,
        machineId: job.machine.machineId,
        machineName: job.machine.name,
        programNo: job.programNo,
        targetCount: job.targetCount,
        completedCount: job.completedCount,
        status: job.status,
        oneCycleStop: job.oneCycleStop,
        createdBy: job.createdByUser.username,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Scheduler] Failed to get jobs:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '작업 목록 조회 실패' },
    });
  }
});

// Get single job
router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = await prisma.schedulerJob.findUnique({
      where: { id: req.params.id },
      include: {
        machine: { select: { id: true, machineId: true, name: true } },
        createdByUser: { select: { id: true, username: true } },
      },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다' },
      });
    }

    res.json({
      success: true,
      data: {
        id: job.id,
        machineId: job.machine.machineId,
        machineName: job.machine.name,
        programNo: job.programNo,
        targetCount: job.targetCount,
        completedCount: job.completedCount,
        status: job.status,
        oneCycleStop: job.oneCycleStop,
        createdBy: job.createdByUser.username,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Scheduler] Failed to get job:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '작업 조회 실패' },
    });
  }
});

// Create new job (Admin/AS only)
router.post('/jobs', requireRole('ADMIN', 'AS'), async (req: Request, res: Response) => {
  try {
    const { machineId, programNo, targetCount, oneCycleStop } = req.body;

    if (!machineId || !programNo || !targetCount) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '필수 항목을 입력해주세요' },
      });
    }

    // Find machine
    const machine = await prisma.machine.findUnique({
      where: { machineId },
    });

    if (!machine) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '장비를 찾을 수 없습니다' },
      });
    }

    // Check for existing active job on this machine
    const existingJob = await prisma.schedulerJob.findFirst({
      where: {
        machineDbId: machine.id,
        status: { in: ['PENDING', 'RUNNING', 'PAUSED'] },
      },
    });

    if (existingJob) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: '이 장비에 이미 진행 중인 작업이 있습니다' },
      });
    }

    // Create job
    const job = await prisma.schedulerJob.create({
      data: {
        machineDbId: machine.id,
        programNo,
        targetCount,
        completedCount: 0,
        status: 'PENDING',
        oneCycleStop: oneCycleStop || false,
        createdById: req.user!.id,
      },
      include: {
        machine: { select: { machineId: true, name: true } },
      },
    });

    // Store in Redis for Agent access
    await redisService.set(
      REDIS_KEYS.SCHEDULER_JOB(machineId),
      {
        jobId: job.id,
        programNo: job.programNo,
        targetCount: job.targetCount,
        completedCount: 0,
        status: 'PENDING',
        oneCycleStop: job.oneCycleStop,
      },
      86400 // 24 hours TTL
    );

    res.status(201).json({
      success: true,
      data: {
        id: job.id,
        machineId: job.machine.machineId,
        programNo: job.programNo,
        targetCount: job.targetCount,
        status: 'PENDING',
      },
    });
  } catch (error) {
    console.error('[Scheduler] Failed to create job:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '작업 생성 실패' },
    });
  }
});

// Start job
router.post('/jobs/:id/start', requireRole('ADMIN', 'AS'), async (req: Request, res: Response) => {
  try {
    const job = await prisma.schedulerJob.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다' },
      });
    }

    if (job.status !== 'PENDING' && job.status !== 'PAUSED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: '시작할 수 없는 상태입니다' },
      });
    }

    // Update job
    const updatedJob = await prisma.schedulerJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        startedAt: job.startedAt || new Date(),
      },
    });

    // Update Redis
    await redisService.set(
      REDIS_KEYS.SCHEDULER_JOB(job.machine.machineId),
      {
        jobId: job.id,
        programNo: job.programNo,
        targetCount: job.targetCount,
        completedCount: job.completedCount,
        status: 'RUNNING',
        oneCycleStop: job.oneCycleStop,
      },
      86400
    );

    // Notify Agent
    await mqttService.publish(
      TOPICS.SERVER_SCHEDULER(job.machine.machineId),
      {
        type: 'JOB_START',
        jobId: job.id,
        programNo: job.programNo,
        targetCount: job.targetCount,
        oneCycleStop: job.oneCycleStop,
      }
    );

    res.json({
      success: true,
      data: { id: updatedJob.id, status: updatedJob.status },
    });
  } catch (error) {
    console.error('[Scheduler] Failed to start job:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '작업 시작 실패' },
    });
  }
});

// Pause job
router.post('/jobs/:id/pause', requireRole('ADMIN', 'AS'), async (req: Request, res: Response) => {
  try {
    const job = await prisma.schedulerJob.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다' },
      });
    }

    if (job.status !== 'RUNNING') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: '일시정지할 수 없는 상태입니다' },
      });
    }

    // Update job
    const updatedJob = await prisma.schedulerJob.update({
      where: { id: job.id },
      data: { status: 'PAUSED' },
    });

    // Update Redis
    await redisService.set(
      REDIS_KEYS.SCHEDULER_JOB(job.machine.machineId),
      {
        jobId: job.id,
        programNo: job.programNo,
        targetCount: job.targetCount,
        completedCount: job.completedCount,
        status: 'PAUSED',
        oneCycleStop: job.oneCycleStop,
      },
      86400
    );

    // Notify Agent
    await mqttService.publish(
      TOPICS.SERVER_SCHEDULER(job.machine.machineId),
      {
        type: 'JOB_PAUSE',
        jobId: job.id,
      }
    );

    res.json({
      success: true,
      data: { id: updatedJob.id, status: updatedJob.status },
    });
  } catch (error) {
    console.error('[Scheduler] Failed to pause job:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '작업 일시정지 실패' },
    });
  }
});

// Cancel job
router.post('/jobs/:id/cancel', requireRole('ADMIN', 'AS'), async (req: Request, res: Response) => {
  try {
    const job = await prisma.schedulerJob.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다' },
      });
    }

    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: '취소할 수 없는 상태입니다' },
      });
    }

    // Update job
    const updatedJob = await prisma.schedulerJob.update({
      where: { id: job.id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });

    // Delete from Redis
    await redisService.delete(REDIS_KEYS.SCHEDULER_JOB(job.machine.machineId));

    // Notify Agent
    await mqttService.publish(
      TOPICS.SERVER_SCHEDULER(job.machine.machineId),
      {
        type: 'JOB_CANCEL',
        jobId: job.id,
      }
    );

    res.json({
      success: true,
      data: { id: updatedJob.id, status: updatedJob.status },
    });
  } catch (error) {
    console.error('[Scheduler] Failed to cancel job:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '작업 취소 실패' },
    });
  }
});

// Set one-cycle stop
router.post('/jobs/:id/one-cycle-stop', requireRole('ADMIN', 'AS'), async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;

    const job = await prisma.schedulerJob.findUnique({
      where: { id: req.params.id },
      include: { machine: true },
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다' },
      });
    }

    if (job.status !== 'RUNNING') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: '실행 중인 작업만 설정할 수 있습니다' },
      });
    }

    // Update job
    const updatedJob = await prisma.schedulerJob.update({
      where: { id: job.id },
      data: { oneCycleStop: enabled },
    });

    // Update Redis
    await redisService.set(
      REDIS_KEYS.SCHEDULER_JOB(job.machine.machineId),
      {
        jobId: job.id,
        programNo: job.programNo,
        targetCount: job.targetCount,
        completedCount: job.completedCount,
        status: job.status,
        oneCycleStop: enabled,
      },
      86400
    );

    // Notify Agent
    await mqttService.publish(
      TOPICS.SERVER_SCHEDULER(job.machine.machineId),
      {
        type: 'ONE_CYCLE_STOP',
        jobId: job.id,
        enabled,
      }
    );

    res.json({
      success: true,
      data: { id: updatedJob.id, oneCycleStop: updatedJob.oneCycleStop },
    });
  } catch (error) {
    console.error('[Scheduler] Failed to set one-cycle stop:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '1사이클 정지 설정 실패' },
    });
  }
});

// Handle M20 event (called from MQTT handler)
export async function handleM20Event(machineId: string, programNo: string): Promise<void> {
  try {
    // Find active job for this machine
    const machine = await prisma.machine.findUnique({
      where: { machineId },
    });

    if (!machine) return;

    const job = await prisma.schedulerJob.findFirst({
      where: {
        machineDbId: machine.id,
        status: 'RUNNING',
      },
    });

    if (!job) return;

    // Increment completed count
    const newCount = job.completedCount + 1;
    const isCompleted = newCount >= job.targetCount;

    // Update job
    await prisma.schedulerJob.update({
      where: { id: job.id },
      data: {
        completedCount: newCount,
        status: isCompleted ? 'COMPLETED' : 'RUNNING',
        completedAt: isCompleted ? new Date() : undefined,
      },
    });

    // Update Redis
    if (isCompleted) {
      await redisService.delete(REDIS_KEYS.SCHEDULER_JOB(machineId));
    } else {
      await redisService.set(
        REDIS_KEYS.SCHEDULER_JOB(machineId),
        {
          jobId: job.id,
          programNo: job.programNo,
          targetCount: job.targetCount,
          completedCount: newCount,
          status: 'RUNNING',
          oneCycleStop: job.oneCycleStop,
        },
        86400
      );
    }

    console.log(`[Scheduler] M20 event: ${machineId} - ${newCount}/${job.targetCount}`);
  } catch (error) {
    console.error('[Scheduler] Failed to handle M20 event:', error);
  }
}

export default router;
