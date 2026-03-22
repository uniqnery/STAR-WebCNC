// Production Routes - POP (Point of Production)

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();

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
    const logWhere: Record<string, unknown> = {
      startTime: { gte: startDate },
    };

    let filteredMachineId: string | undefined;
    if (machineId && typeof machineId === 'string') {
      const machine = await prisma.machine.findUnique({ where: { machineId } });
      if (machine) {
        logWhere.machineId = machine.id;
        filteredMachineId = machine.id;
      }
    }

    // All active machines
    const machines = await prisma.machine.findMany({
      where: filteredMachineId ? { id: filteredMachineId } : { isActive: true },
    });

    // Production logs in range
    const logs = await prisma.productionLog.findMany({
      where: logWhere,
      include: { machine: true },
      orderBy: { startTime: 'asc' },
    });

    // Today's WorkOrders for target qty per machine
    // machineId 필터 시 해당 machine의 machineId 문자열로 조회
    let assignedMachineFilter: string | undefined;
    if (filteredMachineId) {
      const fm = machines.find((m) => m.id === filteredMachineId);
      assignedMachineFilter = fm?.machineId;
    }
    const workOrders = await prisma.workOrder.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        ...(assignedMachineFilter ? { assignedMachine: assignedMachineFilter } : {}),
      },
    });

    // assignedMachine은 machineId 문자열 (machine.machineId)
    const targetByMachineId = new Map<string, number>();
    for (const wo of workOrders) {
      if (!wo.assignedMachine) continue;
      const prev = targetByMachineId.get(wo.assignedMachine) ?? 0;
      targetByMachineId.set(wo.assignedMachine, prev + wo.targetQuantity);
    }

    // ── per-machine stats ──────────────────────────────────────
    const plannedMinutes = (now.getTime() - startDate.getTime()) / 60000;

    const stats = machines.map((m) => {
      const machineLogs = logs.filter((l) => l.machineId === m.id);
      const totalParts = machineLogs.reduce((s, l) => s + l.partsCount, 0);
      const runTimeMin  = machineLogs.reduce((s, l) => s + l.cycleTime, 0) / 60; // cycleTime은 seconds
      const targetParts = targetByMachineId.get(m.machineId) ?? 0;

      const availability  = plannedMinutes > 0 ? Math.min((runTimeMin / plannedMinutes) * 100, 100) : 0;
      const idealCycleMin = 0.5; // 30초/개 가정
      const performance   = runTimeMin > 0 ? Math.min((idealCycleMin * totalParts) / runTimeMin * 100, 100) : 0;
      const quality       = 98; // 기본 98%
      const oee           = (availability * performance * quality) / 10000;
      const downTimeMin   = Math.max(0, plannedMinutes - runTimeMin);
      const idleTimeMin   = 0;

      return {
        machineId:    m.machineId,
        machineName:  m.name,
        totalParts,
        targetParts,
        runTime:      Math.round(runTimeMin),
        idleTime:     Math.round(idleTimeMin),
        downTime:     Math.round(downTimeMin),
        availability: Math.round(availability * 10) / 10,
        performance:  Math.round(performance * 10) / 10,
        quality,
        oee:          Math.round(oee * 10) / 10,
      };
    });

    // ── chart data: 날짜/시간별 집계 ──────────────────────────
    const chart: { date: string; production: number; target: number }[] = [];
    const totalTargetParts = stats.reduce((s, st) => s + st.targetParts, 0);

    if (timeRange === 'today') {
      // 시간별 (0~현재시)
      const currentHour = now.getHours();
      for (let h = 0; h <= currentHour; h++) {
        const from = new Date(startDate.getTime() + h * 3600000);
        const to   = new Date(from.getTime() + 3600000);
        const prod = logs
          .filter((l) => l.startTime >= from && l.startTime < to)
          .reduce((s, l) => s + l.partsCount, 0);
        chart.push({
          date:       `${String(h).padStart(2, '0')}시`,
          production: prod,
          target:     Math.round(totalTargetParts / 24),
        });
      }
    } else {
      // 날짜별
      const days = timeRange === 'week' ? 7 : 30;
      for (let d = days - 1; d >= 0; d--) {
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
        const dayEnd   = new Date(dayStart.getTime() + 86400000);
        const prod = logs
          .filter((l) => l.startTime >= dayStart && l.startTime < dayEnd)
          .reduce((s, l) => s + l.partsCount, 0);
        const label = `${String(dayStart.getMonth() + 1).padStart(2, '0')}/${String(dayStart.getDate()).padStart(2, '0')}`;
        chart.push({
          date:       label,
          production: prod,
          target:     Math.round(totalTargetParts / days),
        });
      }
    }

    res.json({
      success: true,
      data: { stats, chart },
    });
  } catch (error) {
    next(error);
  }
});

// Get production logs for a machine
router.get('/:machineId/logs', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { machineId } = req.params;
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const machine = await prisma.machine.findUnique({ where: { machineId } });
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
      prisma.productionLog.count({ where: { machineId: machine.id } }),
    ]);

    res.json({
      success: true,
      data: { items: logs, total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// Record production (called by scheduler or agent via M20 event)
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
    const machine = await prisma.machine.findUnique({ where: { machineId: data.machineId } });
    if (!machine) {
      console.error(`[Production] Machine not found: ${data.machineId}`);
      return;
    }

    const cycleTime = Math.round((data.endTime.getTime() - data.startTime.getTime()) / 1000);

    await prisma.productionLog.create({
      data: {
        machineId:  machine.id,
        programNo:  data.programNo,
        startTime:  data.startTime,
        endTime:    data.endTime,
        cycleTime,
        partsCount: data.partsCount,
        status:     data.status,
        errorCode:  data.errorCode,
      },
    });
  } catch (error) {
    console.error('[Production] Failed to record production:', error);
  }
}

export default router;
