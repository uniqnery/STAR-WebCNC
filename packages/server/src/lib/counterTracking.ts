import { z } from 'zod';
import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { normalizeProgram, recordProduction } from './productionTracking';

const count = z.number().int().min(0).max(2147483647).nullable().default(null);
const text = z.string().max(500).nullable().optional();
const sample = z.object({ at: z.string().datetime(), sessionId: z.string().uuid(), programNo: text, executingProgramNo: text,
  programComment: text, schedulerRowId: text, schedulerComment: text, programSha256: text,
  counterSource: z.string().max(500), count, preset: count, operatorMessages: z.string().max(16000).nullable().optional(),
  state: z.enum(['running', 'idle', 'alarm_stop', 'unknown']), green: z.boolean().nullable(), red: z.boolean().nullable() });
export const counterEventSchema = z.object({ eventId: z.string().uuid(), machineId: z.string().regex(/^MC-\d+$/), runId: z.string().uuid(),
  sequence: z.number().int().positive().safe(), current: sample, previous: sample.nullable().default(null), counterBefore: sample.nullable().default(null),
  gap: z.boolean(), adjustmentId: z.string().max(100).nullable().optional(), adjustmentField: z.enum(['count', 'preset']).nullable().optional() });
export type CounterEvent = z.infer<typeof counterEventSchema>;
const identity = (s: CounterEvent['current']) => JSON.stringify([normalizeProgram(s.programNo), s.programComment || null, s.schedulerRowId || null, s.schedulerComment || null, s.programSha256 || null]);
export function classifyCounter(event: CounterEvent) {
  const { current: now, counterBefore: before, previous } = event;
  const delta = now.count !== null && before?.count !== null && before?.count !== undefined ? now.count - before.count : 0;
  if (now.count === null) return { kind: 'count_unavailable', quality: 'none', quantity: 0 };
  if (!before || before.count === null) return { kind: 'baseline', quality: 'none', quantity: 0 };
  if (before.counterSource !== now.counterSource) return { kind: 'source_changed', quality: 'review', quantity: 0 };
  if (event.adjustmentId && event.adjustmentField === 'count') return { kind: 'manual_adjustment', quality: 'none', quantity: 0 };
  if (delta < 0) return { kind: now.count === 0 ? 'reset' : 'decrease', quality: 'review', quantity: 0 };
  if (delta > 0) {
    if (!normalizeProgram(now.programNo) || identity(before) !== identity(now)) return { kind: 'context_changed', quality: 'review', quantity: delta };
    const gap = event.gap || before.sessionId !== now.sessionId || Date.parse(now.at) - Date.parse(before.at) > 30000;
    return { kind: 'increment', quality: gap ? 'estimated' : 'confirmed', quantity: delta };
  }
  if (previous?.preset !== now.preset) return { kind: event.adjustmentId ? 'manual_adjustment' : 'preset_changed', quality: 'none', quantity: 0 };
  if (previous && identity(previous) !== identity(now)) return { kind: 'context_changed', quality: 'none', quantity: 0 };
  if (previous?.operatorMessages !== now.operatorMessages) return { kind: 'message_changed', quality: 'none', quantity: 0 };
  return { kind: previous?.state !== now.state || previous?.green !== now.green || previous?.red !== now.red ? 'state_changed' : 'heartbeat', quality: 'none', quantity: 0 };
}
export async function recordCounterEvent(payload: unknown) {
  const event = counterEventSchema.parse(payload);
  const at = new Date(event.current.at);
  if (at.getTime() > Date.now() + 60000 || at.getUTCFullYear() < 2020 ||
      [event.previous, event.counterBefore].some(s => s && (Date.parse(s.at) > at.getTime() || new Date(s.at).getUTCFullYear() < 2020))) throw new Error('INVALID_COUNTER_TIME');
  // Do not trust a separately supplied state label over the lamp evidence.
  const expectedState = event.current.green === true ? 'running' : event.current.green === false && event.current.red === true ? 'alarm_stop'
    : event.current.green === false && event.current.red === false ? 'idle' : 'unknown';
  if (event.current.state !== expectedState) throw new Error('INVALID_COUNTER_STATE');
  const result = classifyCounter(event);
  try {
    return await prisma.$transaction(async tx => {
      if (!await tx.machine.findUnique({ where: { machineId: event.machineId } })) throw new Error('COUNTER_MACHINE_NOT_FOUND');
      const previousRecord = await tx.productionCounterEvent.findUnique({ where: { eventId: event.eventId } });
      if (previousRecord) { if (previousRecord.machineCode !== event.machineId) throw new Error('COUNTER_EVENT_COLLISION'); return false; }
      // A quantity crossing an MES policy/order boundary cannot be reliably attributed.
      if (result.quantity > 0 && event.counterBefore && result.quality !== 'review') {
        const from = new Date(event.counterBefore.at);
        const boundary = await tx.productionPolicy.findFirst({ where: { createdAt: { gt: from, lte: at } } });
        const assignmentBoundary = await tx.productionAssignment.findFirst({ where: { machineCode: event.machineId,
          OR: [{ startedAt: { gt: from, lte: at } }, { endedAt: { gt: from, lte: at } }] } });
        if (boundary || assignmentBoundary) { result.quality = 'review'; result.kind = 'context_changed'; }
      }
      const actor = event.adjustmentId ? await tx.auditLog.findFirst({ where: { action: 'command.write_count', params: { path: ['correlationId'], equals: event.adjustmentId } }, select: { user: { select: { username: true } } } }) : null;
      await tx.productionCounterEvent.create({ data: { eventId: event.eventId, machineCode: event.machineId, observedAt: at,
        previousAt: event.previous ? new Date(event.previous.at) : null,
        intervalState: event.previous?.sessionId === event.current.sessionId ? event.previous.state : 'unknown',
        ...result, countBefore: event.counterBefore?.count, countAfter: event.current.count, presetBefore: event.previous?.preset, presetAfter: event.current.preset,
        programNo: normalizeProgram(event.current.programNo), programComment: event.current.programComment, correlationId: event.adjustmentId, actor: actor?.user.username,
        raw: event as unknown as Prisma.InputJsonValue } });
      if (result.quantity > 0 && result.quality !== 'review') await recordProduction(tx, { eventId: event.eventId, machineId: event.machineId,
        occurredAt: event.current.at, runId: event.runId, ...event.current, programNo: event.current.programNo ?? undefined,
        executingProgramNo: event.current.executingProgramNo ?? undefined, programComment: event.current.programComment ?? undefined,
        schedulerRowId: event.current.schedulerRowId ?? undefined, schedulerComment: event.current.schedulerComment ?? undefined,
        programSha256: event.current.programSha256 ?? undefined }, result.quantity, result.quality, 'counter');
      return true;
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002' && (await prisma.productionCounterEvent.findUnique({ where: { eventId: event.eventId } }))?.machineCode === event.machineId) return false;
    throw error;
  }
}
