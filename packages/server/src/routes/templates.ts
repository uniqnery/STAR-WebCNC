// Template Routes
// CRUD for CNC templates (HQ_ENGINEER only for writes)

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { mqttService, TOPICS } from '../lib/mqtt';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { ApiResponse } from '../types';
import { UserRole, Prisma } from '@prisma/client';
import { exportTemplateToFile } from '../lib/templateSync';

const router = Router();

/**
 * GET /api/templates
 * Get all templates - Agent/공개 접근 가능 (읽기 전용)
 */
router.get('/', asyncHandler(async (
  _req: Request,
  res: Response<ApiResponse<unknown>>
) => {
  const templates = await prisma.template.findMany({
    where: { isActive: true },
    select: {
      id: true,
      templateId: true,
      version: true,
      name: true,
      description: true,
      cncType: true,
      seriesName: true,
      systemInfo: true,
      axisConfig: true,
      pmcMap: true,
      interlockModules: true,
      remoteControlInterlock: true,
      virtualPanel: true,
      panelLayout: true,
      topBarInterlock: true,
      offsetConfig: true,
      counterConfig: true,
      toolLifeConfig: true,
      schedulerConfig: true,
      pmcMessages: true,
      capabilities: true,
      extraPmcAddrs: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      createdBy: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return res.json({ success: true, data: templates });
}));

/**
 * GET /api/templates/:id
 * Get single template by UUID or templateId
 */
router.get('/:id', asyncHandler(async (
  req: Request,
  res: Response<ApiResponse<unknown>>
) => {
  const { id } = req.params;

  // Support both UUID (id) and templateId string
  const template = await prisma.template.findFirst({
    where: {
      OR: [{ id }, { templateId: id }],
      isActive: true,
    },
  });

  if (!template) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.' },
    });
  }

  return res.json({ success: true, data: template });
}));

/**
 * POST /api/templates
 * Create new template (HQ_ENGINEER only)
 */
router.post('/',
  authenticate, authorize(UserRole.HQ_ENGINEER),
  asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const body = req.body as Record<string, unknown>;

    // Validate required fields
    if (!body.templateId || !body.name || !body.cncType || !body.seriesName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'templateId, name, cncType, seriesName은 필수입니다.',
        },
      });
    }

    // Check for duplicate templateId
    const existing = await prisma.template.findUnique({
      where: { templateId: body.templateId as string },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: '이미 존재하는 templateId입니다.' },
      });
    }

    const template = await prisma.template.create({
      data: {
        templateId:            body.templateId as string,
        version:               (body.version as string) || '1.0.0',
        name:                  body.name as string,
        description:           (body.description as string) || '',
        cncType:               body.cncType as string,
        seriesName:            body.seriesName as string,
        systemInfo:            (body.systemInfo ?? {}) as Prisma.InputJsonValue,
        axisConfig:            (body.axisConfig ?? {}) as Prisma.InputJsonValue,
        pmcMap:                (body.pmcMap ?? {}) as Prisma.InputJsonValue,
        interlockConfig:       (body.interlockConfig ?? {}) as Prisma.InputJsonValue,
        interlockModules:      (body.interlockModules ?? {}) as Prisma.InputJsonValue,
        remoteControlInterlock:(body.remoteControlInterlock ?? {}) as Prisma.InputJsonValue,
        virtualPanel:          (body.virtualPanel ?? {}) as Prisma.InputJsonValue,
        panelLayout:           (body.panelLayout ?? []) as Prisma.InputJsonValue,
        topBarInterlock:       (body.topBarInterlock ?? {}) as Prisma.InputJsonValue,
        schedulerConfig:       (body.schedulerConfig ?? {}) as Prisma.InputJsonValue,
        pmcMessages:           (body.pmcMessages ?? []) as Prisma.InputJsonValue,
        capabilities:          (body.capabilities ?? {}) as Prisma.InputJsonValue,
        createdBy:             req.user?.username || '',
      },
    });

    void exportTemplateToFile(template as unknown as Record<string, unknown>);
    return res.status(201).json({ success: true, data: template });
  })
);

/**
 * PUT /api/templates/:id
 * Update template (HQ_ENGINEER only)
 */
router.put('/:id',
  authenticate, authorize(UserRole.HQ_ENGINEER),
  asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.template.findFirst({
      where: { OR: [{ id }, { templateId: id }], isActive: true },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.' },
      });
    }

    // Build update data (only provided fields)
    type TemplateUpdateInput = {
      version?: string;
      name?: string;
      description?: string;
      cncType?: string;
      seriesName?: string;
      systemInfo?: object;
      axisConfig?: object;
      pmcMap?: object;
      interlockConfig?: object;
      interlockModules?: object;
      remoteControlInterlock?: object;
      virtualPanel?: object;
      panelLayout?: unknown[];
      topBarInterlock?: object;
      schedulerConfig?: object;
      offsetConfig?: object;
      counterConfig?: object;
      toolLifeConfig?: object;
      pmcMessages?: unknown[];
      capabilities?: object;
      extraPmcAddrs?: unknown[];
    };

    const updateData: TemplateUpdateInput = {};
    const jsonFields = [
      'systemInfo', 'axisConfig', 'pmcMap', 'interlockConfig',
      'interlockModules', 'remoteControlInterlock', 'virtualPanel',
      'panelLayout', 'topBarInterlock', 'schedulerConfig',
      'offsetConfig', 'counterConfig', 'toolLifeConfig',
      'pmcMessages', 'capabilities', 'extraPmcAddrs',
    ] as const;
    const strFields = ['version', 'name', 'description', 'cncType', 'seriesName'] as const;

    for (const f of strFields) {
      if (body[f] !== undefined) (updateData as Record<string, unknown>)[f] = body[f];
    }
    for (const f of jsonFields) {
      if (body[f] !== undefined) (updateData as Record<string, unknown>)[f] = body[f];
    }

    const updated = await prisma.template.update({
      where: { id: existing.id },
      data: updateData as Prisma.TemplateUpdateInput,
    });

    void exportTemplateToFile(updated as unknown as Record<string, unknown>);
    return res.json({ success: true, data: updated });
  })
);

/**
 * DELETE /api/templates/:id
 * Soft-delete template (HQ_ENGINEER only)
 * Cannot delete if machines are using this template
 */
router.delete('/:id',
  authenticate, authorize(UserRole.HQ_ENGINEER),
  asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;

    const existing = await prisma.template.findFirst({
      where: { OR: [{ id }, { templateId: id }], isActive: true },
      include: { _count: { select: { machines: true } } },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.' },
      });
    }

    if (existing._count.machines > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'IN_USE',
          message: `이 템플릿을 사용 중인 설비가 ${existing._count.machines}대 있습니다. 설비 연결을 먼저 해제하세요.`,
        },
      });
    }

    await prisma.template.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    return res.json({ success: true, data: { id: existing.id, deleted: true } });
  })
);

/**
 * POST /api/templates/:id/reload
 * Notify all Agents to reload template cache (HQ_ENGINEER only)
 * Sends MQTT command to all machines using this template
 */
router.post('/:id/reload',
  authenticate, authorize(UserRole.HQ_ENGINEER),
  asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;

    const template = await prisma.template.findFirst({
      where: { OR: [{ id }, { templateId: id }], isActive: true },
      include: {
        machines: {
          where: { isActive: true },
          select: { machineId: true },
        },
      },
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.' },
      });
    }

    // Send RELOAD_TEMPLATE command to each machine using this template
    const notified: string[] = [];
    for (const machine of template.machines) {
      try {
        await mqttService.publish(TOPICS.COMMAND_TO(machine.machineId), {
          command: 'RELOAD_TEMPLATE',
          correlationId: `reload-${template.id}-${Date.now()}`,
          machineId: machine.machineId,
          params: { templateId: template.templateId },
          timestamp: new Date().toISOString(),
        });
        notified.push(machine.machineId);
      } catch {
        // Continue even if one machine fails
      }
    }

    return res.json({
      success: true,
      data: {
        templateId: template.templateId,
        notifiedMachines: notified,
        totalMachines: template.machines.length,
      },
    });
  })
);

export default router;
