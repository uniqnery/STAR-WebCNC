import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export interface ProductionCompletion {
  eventId: string; machineId: string; occurredAt: string; runId?: string;
  programNo?: string; executingProgramNo?: string; programComment?: string;
  schedulerRowId?: string; schedulerComment?: string; programSha256?: string;
}
export const normalizeProgram = (value?: string | null) => {
  const match = value?.trim().match(/^O?0*(\d+)$/i);
  return match && Number(match[1]) > 0 ? `O${Number(match[1]).toString().padStart(4, '0')}` : null;
};
export function chooseProductionComment(mes: string | null, scheduler: string | null, program: string | null, programNo: string | null) {
  if (mes?.trim()) return { name: mes.trim(), source: 'mes' };
  if (scheduler?.trim()) return { name: scheduler.trim(), source: 'scheduler' };
  if (program?.trim()) return { name: program.trim(), source: 'program' };
  return { name: `${programNo ?? '프로그램 미확인'} / 생산 항목 미지정`, source: 'unassigned' };
}
export async function mesEnabled(at = new Date(), db: Pick<Prisma.TransactionClient, 'productionPolicy'> = prisma) {
  return (await db.productionPolicy.findFirst({ where: { createdAt: { lte: at } }, orderBy: { createdAt: 'desc' } }))?.enabled ?? false;
}

export async function recordCompletion(event: ProductionCompletion): Promise<boolean> {
  const at = new Date(event.occurredAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.eventId ?? '') || !/^MC-\d+$/.test(event.machineId ?? '') ||
      !Number.isFinite(at.getTime()) || at.getTime() > Date.now() + 60000 || at.getFullYear() < 2020) throw new Error('INVALID_PRODUCTION_EVENT');
  const programNo = normalizeProgram(event.programNo);
  const clean = (value?: string | null) => typeof value === 'string' ? value.trim().slice(0, 500) || null : null;
  try {
    return await prisma.$transaction(async tx => {
      const cutover = await tx.productionCounterEvent.findFirst({ where: { machineCode: event.machineId, kind: { not: 'correction' } }, orderBy: { observedAt: 'asc' } });
      if (cutover && at >= cutover.observedAt) return false;
      return recordProduction(tx, event, 1, 'confirmed', 'm20');
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      const existing = await prisma.productionLog.findUnique({ where: { eventId: event.eventId }, include: { machine: true } });
      if (existing?.machine.machineId === event.machineId) return false;
    }
    throw error;
  }
}

export async function recordProduction(tx: Prisma.TransactionClient, event: ProductionCompletion, quantity: number, quality: string, source: string) {
      const at = new Date(event.occurredAt);
      const programNo = normalizeProgram(event.programNo);
      const clean = (value?: string | null) => typeof value === 'string' ? value.trim().slice(0, 500) || null : null;
      const machine = await tx.machine.findUnique({ where: { machineId: event.machineId }, select: { id: true } });
      if (!machine) throw new Error('PRODUCTION_MACHINE_NOT_FOUND');
      const previous = await tx.productionLog.findUnique({ where: { eventId: event.eventId } });
      if (previous) {
        if (previous.machineId !== machine.id) throw new Error('PRODUCTION_EVENT_COLLISION');
        return false;
      }
      const policy = await tx.productionPolicy.findFirst({ where: { createdAt: { lte: at } }, orderBy: { createdAt: 'desc' } });
      const assignment = policy?.enabled ? await tx.productionAssignment.findFirst({
        where: { machineCode: event.machineId, startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] }, orderBy: { startedAt: 'desc' },
      }) : null;
      const order = assignment ? await tx.workOrder.findUnique({ where: { id: assignment.workOrderId } }) : null;
      const orderEnd = order?.actualEnd ?? (order?.status === 'CANCELLED' ? order.updatedAt : null);
      const matched = !!assignment && !!order && normalizeProgram(assignment.programNo) === programNo &&
        !!order.actualStart && order.actualStart <= at && (!orderEnd || at <= orderEnd);
      const mesComment = assignment?.productionComment ?? null;
      const schedulerComment = clean(event.schedulerComment);
      const programComment = clean(event.programComment);
      const selected = chooseProductionComment(matched ? mesComment : null, schedulerComment, programComment, programNo);
      const contextStatus = assignment && !matched ? 'conflict' : policy?.enabled && !matched ? 'mes_unlinked' : selected.source === 'unassigned' ? 'unassigned' : 'identified';
      const runKey = createHash('sha256').update(JSON.stringify([event.machineId, event.runId ?? event.eventId,
        policy?.id ?? 'standalone', matched ? assignment!.id : null, event.schedulerRowId, programNo,
        event.programSha256, selected.source, selected.name])).digest('hex');
      await tx.productionLog.create({ data: {
        eventId: event.eventId, machineId: machine.id, programNo: programNo ?? 'UNKNOWN', executingProgramNo: normalizeProgram(event.executingProgramNo),
        startTime: at, endTime: at, cycleTime: 0, partsCount: quantity, status: 'completed', countSource: source, countQuality: quality,
        productionName: selected.name, commentSource: selected.source, contextStatus, runKey,
        programComment, schedulerComment, mesComment, schedulerRowId: clean(event.schedulerRowId), programSha256: clean(event.programSha256),
        workOrderId: matched ? assignment!.workOrderId : null, workOrderNumber: matched ? assignment!.orderNumber : null,
        productCode: matched ? assignment!.productCode : null,
      } });
      if (matched && quality === 'confirmed') await tx.workOrder.update({ where: { id: assignment!.workOrderId }, data: { producedQty: { increment: quantity } } });
      return true;
}
