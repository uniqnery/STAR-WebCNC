// Work Order Routes - MES Integration

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { createAuditLog } from './audit';

const router = Router();

// Get all work orders with pagination and filtering
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string | undefined;

    const whereClause: Record<string, unknown> = {};
    if (status) {
      whereClause.status = status;
    }

    const [orders, total] = await Promise.all([
      prisma.workOrder.findMany({
        where: whereClause,
        orderBy: [
          { priority: 'desc' },
          { scheduledStart: 'asc' },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.workOrder.count({ where: whereClause }),
    ]);

    res.json({
      success: true,
      data: {
        items: orders,
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

// Get single work order
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const order = await prisma.workOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: '작업지시를 찾을 수 없습니다' },
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

// Create work order
router.post('/', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      orderNumber,
      productCode,
      productName,
      targetQuantity,
      assignedMachine,
      programNumber,
      priority,
      scheduledStart,
      scheduledEnd,
    } = req.body;

    // Validate required fields
    if (!orderNumber || !productCode || !targetQuantity) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: '필수 항목이 누락되었습니다' },
      });
    }

    // Check for duplicate order number
    const existing = await prisma.workOrder.findUnique({
      where: { orderNumber },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_ORDER', message: '이미 존재하는 작업지시 번호입니다' },
      });
    }

    const order = await prisma.workOrder.create({
      data: {
        orderNumber,
        productCode,
        productName,
        targetQuantity,
        assignedMachine,
        programNumber,
        priority: priority || 0,
        scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
        status: 'PENDING',
      },
    });

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'workOrder.create',
      targetType: 'workOrder',
      targetId: order.id,
      params: { orderNumber, productCode, targetQuantity },
      result: 'success',
      ipAddress: req.ip || 'unknown',
    });

    res.status(201).json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

// Update work order
router.put('/:id', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const {
      assignedMachine,
      programNumber,
      priority,
      scheduledStart,
      scheduledEnd,
    } = req.body;

    const order = await prisma.workOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: '작업지시를 찾을 수 없습니다' },
      });
    }

    // Can only update PENDING orders
    if (order.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: '대기 상태의 작업지시만 수정할 수 있습니다' },
      });
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        assignedMachine,
        programNumber,
        priority,
        scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : undefined,
      },
    });

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'workOrder.update',
      targetType: 'workOrder',
      targetId: id,
      params: { assignedMachine, programNumber, priority },
      result: 'success',
      ipAddress: req.ip || 'unknown',
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// Start work order
router.post('/:id/start', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const order = await prisma.workOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: '작업지시를 찾을 수 없습니다' },
      });
    }

    if (order.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: '대기 상태의 작업지시만 시작할 수 있습니다' },
      });
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        actualStart: new Date(),
      },
    });

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'workOrder.start',
      targetType: 'workOrder',
      targetId: id,
      params: { orderNumber: order.orderNumber },
      result: 'success',
      ipAddress: req.ip || 'unknown',
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// Complete work order
router.post('/:id/complete', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const order = await prisma.workOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: '작업지시를 찾을 수 없습니다' },
      });
    }

    if (order.status !== 'IN_PROGRESS') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: '진행 중인 작업지시만 완료할 수 있습니다' },
      });
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        actualEnd: new Date(),
      },
    });

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'workOrder.complete',
      targetType: 'workOrder',
      targetId: id,
      params: { orderNumber: order.orderNumber, producedQty: order.producedQty },
      result: 'success',
      ipAddress: req.ip || 'unknown',
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// Cancel work order
router.post('/:id/cancel', authenticate, requireRole(['ADMIN', 'AS']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const order = await prisma.workOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: '작업지시를 찾을 수 없습니다' },
      });
    }

    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: '이미 완료/취소된 작업지시입니다' },
      });
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: 'CANCELLED',
      },
    });

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      userRole: req.user!.role,
      action: 'workOrder.cancel',
      targetType: 'workOrder',
      targetId: id,
      params: { orderNumber: order.orderNumber },
      result: 'success',
      ipAddress: req.ip || 'unknown',
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
});

// Update produced quantity (called by scheduler)
export async function updateProducedQty(orderNumber: string, increment: number): Promise<void> {
  try {
    await prisma.workOrder.update({
      where: { orderNumber },
      data: {
        producedQty: { increment },
      },
    });
  } catch (error) {
    console.error('[WorkOrder] Failed to update produced qty:', error);
  }
}

export default router;
