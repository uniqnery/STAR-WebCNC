import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/error';
import { mesEnabled, normalizeProgram, recordProduction } from '../lib/productionTracking';
import { counterReport } from '../lib/counterReporting';
import { z } from 'zod';
const router = Router();
router.use(authenticate);
export function productionPeriod(range: unknown, now = new Date()) {
  const local = new Date(now.getTime() + 9 * 3600000);
  if (range === 'week') local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  if (range === 'month') local.setUTCDate(1);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - 9 * 3600000);
}
router.get('/features', asyncHandler(async (_req, res) => res.json({ success: true, data: { mesEnabled: await mesEnabled() } })));
router.put('/features', requireRole('HQ_ENGINEER'), asyncHandler(async (req, res) => {
  if (typeof req.body?.mesEnabled !== 'boolean') throw new AppError(400, 'INVALID_INPUT', 'MES 활성화 여부를 선택하세요.');
  await prisma.$transaction(async tx => {
    const at = new Date(), enabled = req.body.mesEnabled;
    await tx.productionPolicy.create({ data: { enabled, createdAt: at, changedBy: req.user!.username } });
    await tx.productionAssignment.updateMany({ where: { endedAt: null }, data: { endedAt: at } });
    await tx.auditLog.create({ data: { userId: req.user!.id, actorDisplayName: req.user!.displayName || req.user!.username, userRole: req.user!.role, action: 'production.mes_setting', params: { enabled }, result: 'success', ipAddress: req.ip ?? 'unknown' } });
  });
  return res.json({ success: true, data: { mesEnabled: req.body.mesEnabled } });
}));
router.get('/assignments/:machineId', asyncHandler(async (req, res) => {
  if (!await mesEnabled()) return res.json({ success: true, data: { assignment: null, orders: [] } });
  const [assignment, orders] = await Promise.all([
    prisma.productionAssignment.findFirst({ where: { machineCode: req.params.machineId, endedAt: null } }),
    prisma.workOrder.findMany({ where: { assignedMachine: req.params.machineId, status: 'IN_PROGRESS' }, orderBy: { actualStart: 'desc' } }),
  ]);
  return res.json({ success: true, data: { assignment, orders } });
}));
router.put('/assignments/:machineId', requireRole('ADMIN', 'HQ_ENGINEER'), asyncHandler(async (req, res) => {
  if (!await mesEnabled()) throw new AppError(403, 'MES_DISABLED', 'MES가 비활성화되어 있습니다.');
  const machine = await prisma.machine.findUnique({ where: { machineId: req.params.machineId } });
  if (!machine?.isActive) throw new AppError(404, 'NOT_FOUND', '설비를 찾을 수 없습니다.');
  const orderId = req.body?.workOrderId;
  if (orderId !== null && typeof orderId !== 'string') throw new AppError(400, 'INVALID_INPUT', '작업지시를 선택하세요.');
  await prisma.$transaction(async tx => {
    const order = orderId ? await tx.workOrder.findUnique({ where: { id: orderId } }) : null;
    if (orderId && (!order || order.status !== 'IN_PROGRESS' || order.assignedMachine !== machine.machineId || !normalizeProgram(order.programNumber)))
      throw new AppError(409, 'ORDER_NOT_MATCHED', '해당 설비의 진행 중 작업지시와 생산 프로그램을 확인하세요.');
    const at = new Date();
    await tx.productionAssignment.updateMany({ where: { machineCode: machine.machineId, endedAt: null }, data: { endedAt: at } });
    if (order) await tx.productionAssignment.create({ data: { machineCode: machine.machineId, workOrderId: order.id, orderNumber: order.orderNumber,
      productCode: order.productCode, productionComment: order.productionComment?.trim() || order.productName?.trim() || order.productCode,
      programNo: normalizeProgram(order.programNumber)!, startedAt: at } });
    await tx.auditLog.create({ data: { userId: req.user!.id, actorDisplayName: req.user!.displayName || req.user!.username, userRole: req.user!.role, action: 'production.assign_order', targetType: 'machine', targetId: machine.id,
      params: { workOrderId: orderId }, result: 'success', ipAddress: req.ip ?? 'unknown' } });
  });
  return res.json({ success: true });
}));
router.get('/stats', asyncHandler(async (req, res) => {
  const now = new Date(), start = productionPeriod(req.query.timeRange, now);
  const code = typeof req.query.machineId === 'string' ? req.query.machineId : undefined;
  const machines = await prisma.machine.findMany({ where: { isActive: true, ...(code ? { machineId: code } : {}) } });
  const ids = machines.map(m => m.id);
  const where = { machineId: { in: ids }, endTime: { gte: start, lte: now }, status: 'completed' };
  const hourly = req.query.timeRange === 'today' || !req.query.timeRange, step = hourly ? 3600000 : 86400000;
  const [groups, recent, buckets] = await Promise.all([
    prisma.productionLog.groupBy({ by: ['runKey', 'machineId', 'productionName', 'commentSource', 'programNo', 'workOrderNumber', 'contextStatus', 'countQuality'], where,
      _sum: { partsCount: true }, _min: { endTime: true }, _max: { endTime: true }, orderBy: { _max: { endTime: 'desc' } } }),
    prisma.productionLog.findMany({ where, orderBy: { endTime: 'desc' }, take: 50 }),
    ids.length ? prisma.$queryRaw<{ bucket: Date; production: number }[]>(Prisma.sql`
      SELECT date_trunc(${hourly ? 'hour' : 'day'}, end_time + interval '9 hours') AS bucket, SUM(parts_count)::int AS production
      FROM production_logs WHERE machine_id IN (${Prisma.join(ids)}) AND end_time >= (${start}::timestamptz AT TIME ZONE 'UTC') AND end_time <= (${now}::timestamptz AT TIME ZONE 'UTC') AND status = 'completed' GROUP BY 1`) : Promise.resolve([]),
  ]);
  const tracking = await counterReport(machines.map(m => m.machineId), start, now);
  const enabled = await mesEnabled();
  const orders = enabled ? await prisma.workOrder.findMany({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } }) : [];
  const rows = await prisma.schedulerRow.findMany({ where: { machineDbId: { in: machines.map(m => m.id) }, status: { in: ['PENDING', 'RUNNING'] } } });
  const stats = machines.map(machine => ({ machineId: machine.machineId, machineName: machine.name,
    totalParts: groups.filter(l => l.machineId === machine.id).reduce((n, l) => n + (l._sum.partsCount ?? 0), 0),
    confirmedParts: groups.filter(l => l.machineId === machine.id && l.countQuality === 'confirmed').reduce((n, l) => n + (l._sum.partsCount ?? 0), 0),
    estimatedParts: groups.filter(l => l.machineId === machine.id && l.countQuality === 'estimated').reduce((n, l) => n + (l._sum.partsCount ?? 0), 0),
    correctedParts: groups.filter(l => l.machineId === machine.id && l.countQuality === 'correction').reduce((n, l) => n + (l._sum.partsCount ?? 0), 0),
    targetParts: enabled ? orders.filter(o => o.assignedMachine === machine.machineId).reduce((n, o) => n + o.targetQuantity, 0)
      : rows.filter(r => r.machineDbId === machine.id).reduce((n, r) => n + r.preset, 0),
    runTime: null, idleTime: null, downTime: null, availability: null, performance: null, quality: null, oee: null,
  }));
  const chart: { date: string; production: number; target: number }[] = [];
  const chartCounts = new Map(buckets.map(b => [b.bucket.getTime(), b.production]));
  for (let t = start.getTime(); t <= now.getTime(); t += step) {
    const local = new Date(t + 9 * 3600000);
    chart.push({ date: hourly ? `${String(local.getUTCHours()).padStart(2, '0')}시` : local.toISOString().slice(5, 10),
      production: chartCounts.get(local.getTime()) ?? 0, target: 0 });
  }
  const products = groups.map(log => ({ runKey: log.runKey ?? `legacy:${log.machineId}:${log.programNo}`, machineId: machines.find(m => m.id === log.machineId)?.machineId,
    productionName: log.productionName ?? log.programNo, commentSource: log.commentSource ?? 'legacy', programNo: log.programNo, partsCount: log._sum.partsCount ?? 0, countQuality: log.countQuality,
    firstAt: log._min.endTime, lastAt: log._max.endTime, workOrderNumber: log.workOrderNumber, contextStatus: log.contextStatus }));
  return res.json({ success: true, data: { stats, chart, products, recent: recent.map(l => ({ ...l, machineCode: machines.find(m => m.id === l.machineId)?.machineId })),
    ...tracking, mesEnabled: enabled, countMethod: 'COUNTER', metricsMeasured: false } });
}));
const correctionSchema = z.object({ eventId: z.string().uuid(), machineId: z.string().regex(/^MC-\d+$/), referenceEventId: z.string().uuid(),
  quantity: z.number().int().min(-1000000000).max(1000000000).refine(n => n !== 0), reason: z.string().trim().min(1).max(500),
  programNo: z.string().max(40).refine(s => !!normalizeProgram(s)), productionName: z.string().trim().min(1).max(500) });
router.post('/corrections', requireRole('ADMIN', 'HQ_ENGINEER'), asyncHandler(async (req, res) => {
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'INVALID_INPUT', '설비·대상 이력·프로그램·보정 수량·사유를 확인하세요.');
  const input = parsed.data;
  const result = await prisma.$transaction(async tx => {
    const reference = await tx.productionCounterEvent.findUnique({ where: { eventId: input.referenceEventId } });
    if (!reference || reference.machineCode !== input.machineId || reference.kind === 'correction') throw new AppError(404, 'NOT_FOUND', '대상 원본 이력이 없습니다.');
    const existing = await tx.productionCounterEvent.findUnique({ where: { eventId: input.eventId } });
    if (existing) {
      const saved = existing.raw as Record<string, unknown>;
      if (existing.machineCode !== input.machineId || existing.actor !== req.user!.username || Object.entries(input).some(([key, value]) => saved[key] !== value)) throw new AppError(409, 'CONFLICT', '다른 보정 요청과 번호가 겹칩니다.');
      return existing;
    }
    const correction = await tx.productionCounterEvent.create({ data: { eventId: input.eventId, machineCode: input.machineId, observedAt: reference.observedAt,
      intervalState: 'unknown', kind: 'correction', quality: 'correction', quantity: input.quantity, programNo: normalizeProgram(input.programNo), programComment: input.productionName,
      actor: req.user!.username, reason: input.reason, raw: input } });
    await recordProduction(tx, { eventId: input.eventId, machineId: input.machineId, occurredAt: reference.observedAt.toISOString(), runId: input.referenceEventId,
      programNo: input.programNo, programComment: input.productionName }, input.quantity, 'correction', 'correction');
    await tx.auditLog.create({ data: { userId: req.user!.id, actorDisplayName: req.user!.displayName || req.user!.username, userRole: req.user!.role, action: 'production.correct', targetType: 'machine', targetId: input.machineId,
      params: input, result: 'success', ipAddress: req.ip ?? 'unknown' } });
    return correction;
  }).catch(async error => {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const existing = await prisma.productionCounterEvent.findUnique({ where: { eventId: input.eventId } });
    const saved = existing?.raw as Record<string, unknown> | undefined;
    if (!existing || existing.machineCode !== input.machineId || existing.actor !== req.user!.username || !saved || Object.entries(input).some(([key, value]) => saved[key] !== value)) throw new AppError(409, 'CONFLICT', '다른 보정 요청과 번호가 겹칩니다.');
    return existing;
  });
  return res.json({ success: true, data: { eventId: result.eventId } });
}));
router.get('/:machineId/logs', asyncHandler(async (req, res) => {
  const machine = await prisma.machine.findUnique({ where: { machineId: req.params.machineId } });
  if (!machine) throw new AppError(404, 'NOT_FOUND', '설비를 찾을 수 없습니다.');
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const [items, total] = await Promise.all([prisma.productionLog.findMany({ where: { machineId: machine.id }, orderBy: { endTime: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.productionLog.count({ where: { machineId: machine.id } })]);
  return res.json({ success: true, data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } });
}));
export default router;
