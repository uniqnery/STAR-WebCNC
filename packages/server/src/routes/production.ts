// Production Routes - POP (Point of Production)

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

interface ProductionStats {
  totalParts: number;
  totalRunTime: number; // minutes
  totalDownTime: number; // minutes
  availability: number; // percentage
  performance: number; // percentage
  quality: number; // percentage
  oee: number; // percentage
  machineStats: MachineProductionStats[];
}

interface MachineProductionStats {
  machineId: string;
  machineName: string;
  partsProduced: number;
  runTime: number;
  downTime: number;
  cycleTime: number;
  oee: number;
}

// Get production statistics
router.get('/stats', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { timeRange, machineId } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (timeRange) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'today':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
    }

    // Build where clause
    const whereClause: Record<string, unknown> = {
      startTime: { gte: startDate },
    };

    if (machineId && typeof machineId === 'string') {
      const machine = await prisma.machine.findUnique({
        where: { machineId },
      });
      if (machine) {
        whereClause.machineId = machine.id;
      }
    }

    // Get production logs
    const logs = await prisma.productionLog.findMany({
      where: whereClause,
      include: {
        machine: true,
      },
      orderBy: { startTime: 'desc' },
    });

    // Get all machines for complete stats
    const machines = await prisma.machine.findMany({
      where: { isActive: true },
    });

    // Calculate overall stats
    let totalParts = 0;
    let totalRunTime = 0;
    let totalCycleTime = 0;
    const machineStatsMap = new Map<string, MachineProductionStats>();

    // Initialize machine stats
    for (const machine of machines) {
      machineStatsMap.set(machine.id, {
        machineId: machine.machineId,
        machineName: machine.name,
        partsProduced: 0,
        runTime: 0,
        downTime: 0,
        cycleTime: 0,
        oee: 0,
      });
    }

    // Aggregate production logs
    for (const log of logs) {
      totalParts += log.partsCount;
      totalRunTime += log.cycleTime;
      totalCycleTime += log.cycleTime;

      const stats = machineStatsMap.get(log.machineId);
      if (stats) {
        stats.partsProduced += log.partsCount;
        stats.runTime += log.cycleTime;
        stats.cycleTime = log.cycleTime; // Latest cycle time
      }
    }

    // Calculate OEE components
    // Availability = Run Time / Planned Production Time
    // Performance = (Ideal Cycle Time × Total Count) / Run Time
    // Quality = Good Count / Total Count
    // OEE = Availability × Performance × Quality

    const plannedTime = (now.getTime() - startDate.getTime()) / 60000; // minutes
    const availability = plannedTime > 0 ? Math.min((totalRunTime / 60) / plannedTime * 100, 100) : 0;

    // Assume ideal cycle time of 30 seconds per part for demo
    const idealCycleTime = 0.5; // minutes
    const performance = totalRunTime > 0 ? Math.min((idealCycleTime * totalParts) / (totalRunTime / 60) * 100, 100) : 0;

    // Assume 98% quality for demo
    const quality = 98;

    const oee = (availability * performance * quality) / 10000;

    // Calculate downtime
    const totalDownTime = Math.max(0, plannedTime - (totalRunTime / 60));

    // Calculate per-machine OEE
    const machineStats: MachineProductionStats[] = [];
    for (const [, stats] of machineStatsMap) {
      const machineAvailability = plannedTime > 0 ? Math.min((stats.runTime / 60) / plannedTime * 100, 100) : 0;
      const machinePerformance = stats.runTime > 0 ? Math.min((idealCycleTime * stats.partsProduced) / (stats.runTime / 60) * 100, 100) : 0;
      stats.oee = (machineAvailability * machinePerformance * quality) / 10000;
      stats.downTime = Math.max(0, plannedTime - (stats.runTime / 60));
      machineStats.push(stats);
    }

    const result: ProductionStats = {
      totalParts,
      totalRunTime: Math.round(totalRunTime / 60),
      totalDownTime: Math.round(totalDownTime),
      availability: Math.round(availability * 10) / 10,
      performance: Math.round(performance * 10) / 10,
      quality,
      oee: Math.round(oee * 10) / 10,
      machineStats,
    };

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// Get production logs for a machine
router.get('/:machineId/logs', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    // Find machine
    const machine = await prisma.machine.findUnique({
      where: { machineId },
    });

    if (!machine) {
      return res.status(404).json({
        success: false,
        error: { code: 'MACHINE_NOT_FOUND', message: '장비를 찾을 수 없습니다' },
      });
    }

    const [logs, total] = await Promise.all([
      prisma.productionLog.findMany({
        where: { machineId: machine.id },
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.productionLog.count({
        where: { machineId: machine.id },
      }),
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

// Record production (called by scheduler or agent)
export async function recordProduction(data: {
  machineId: string;
  programNo: string;
  startTime: Date;
  endTime: Date;
  partsCount: number;
  status: string;
  errorCode?: string;
}): Promise<void> {
  try {
    const machine = await prisma.machine.findUnique({
      where: { machineId: data.machineId },
    });

    if (!machine) {
      console.error(`[Production] Machine not found: ${data.machineId}`);
      return;
    }

    const cycleTime = Math.round((data.endTime.getTime() - data.startTime.getTime()) / 1000);

    await prisma.productionLog.create({
      data: {
        machineId: machine.id,
        programNo: data.programNo,
        startTime: data.startTime,
        endTime: data.endTime,
        cycleTime,
        partsCount: data.partsCount,
        status: data.status,
        errorCode: data.errorCode,
      },
    });
  } catch (error) {
    console.error('[Production] Failed to record production:', error);
  }
}

export default router;
