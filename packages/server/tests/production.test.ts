import { it, expect, vi } from 'vitest';
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/lib/redis', () => ({ redisService: {} }));
import { chooseProductionComment, normalizeProgram } from '../src/lib/productionTracking';
import { productionPeriod } from '../src/routes/production';
it.each([
  ['MES', 'SCHED', 'CNC', 'mes', 'MES'], ['', 'SCHED', 'CNC', 'scheduler', 'SCHED'],
  [null, '', 'CNC', 'program', 'CNC'], [null, null, null, 'unassigned', 'O1001 / 생산 항목 미지정'],
])('chooses the first eligible nonempty comment', (mes, scheduler, cnc, source, name) => {
  expect(chooseProductionComment(mes, scheduler, cnc, 'O1001')).toEqual({ source, name });
});
it.each([['O1', 'O0001'], ['0001', 'O0001'], ['O8100', 'O8100'], ['O0000', null], ['invalid', null]])('normalizes program identity %s', (raw, expected) => expect(normalizeProgram(raw)).toBe(expected));
it('uses Korean day/week/month boundaries regardless of host timezone', () => {
  const now = new Date('2026-11-25T01:00:00Z');
  expect(productionPeriod('today', now).toISOString()).toBe('2026-11-24T15:00:00.000Z');
  expect(productionPeriod('week', now).toISOString()).toBe('2026-11-22T15:00:00.000Z');
  expect(productionPeriod('month', now).toISOString()).toBe('2026-10-31T15:00:00.000Z');
});
