import { expect, it, vi } from 'vitest';
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
import { counterReport } from '../src/lib/counterReporting';
const start = new Date('2026-11-25T15:00:00Z');
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
it('reuses state intervals without loading production event details', async () => {
  const db = { $queryRaw: vi.fn().mockResolvedValueOnce([
    { machineCode:'MC-2',state:'running',startAt:at(-5),endAt:at(10) },
    { machineCode:'MC-2',state:'running',startAt:at(8),endAt:at(20) },
    { machineCode:'MC-2',state:'idle',startAt:at(25),endAt:at(30) },
  ]).mockResolvedValueOnce([{machineCode:'MC-2',observedAt:at(30),raw:{current:{state:'alarm_stop'}}}]),
    productionCounterEvent: { findMany:vi.fn(), aggregate:vi.fn() } };
  const result = await counterReport(['MC-2','MC-3'],start,at(70),db as any,false);
  expect(result.states).toEqual([
    {machineCode:'MC-2',running:20,idle:5,alarm_stop:30,unknown:15},
    {machineCode:'MC-3',running:0,idle:0,alarm_stop:0,unknown:70},
  ]);
  expect(db.productionCounterEvent.findMany).not.toHaveBeenCalled();
  expect(db.productionCounterEvent.aggregate).not.toHaveBeenCalled();
});
it('returns no data without querying when no machines are configured', async () => {
  const db = { $queryRaw:vi.fn() };
  expect((await counterReport([],start,at(70),db as any,false)).states).toEqual([]);
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
