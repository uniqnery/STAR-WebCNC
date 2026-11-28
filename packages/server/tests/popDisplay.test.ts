import { expect, it } from 'vitest';
import { compactDuration, freshPopState, popPeriodStart, popTimeline, summarizePopProducts } from '../../web/src/lib/popDisplay';
import type { ProductRun } from '../../web/src/lib/popData';

it('uses Korean midnight across a UTC date boundary', () => {
  expect(new Date(popPeriodStart('today', Date.parse('2026-11-26T16:00:00Z'))).toISOString()).toBe('2026-11-26T15:00:00.000Z');
});
it('starts the Korean week on Monday and the month on its first day', () => {
  const end = Date.parse('2026-11-28T16:00:00Z');
  expect(new Date(popPeriodStart('week', end)).toISOString()).toBe('2026-11-22T15:00:00.000Z');
  expect(new Date(popPeriodStart('month', end)).toISOString()).toBe('2026-10-31T15:00:00.000Z');
});
it.each([undefined, { observedAt: 'invalid', state: 'running' }, { observedAt: '2026-11-27T00:00:00Z', state: 'running' }])('does not count missing or stale observations as running', (latest) => {
  expect(freshPopState(latest as Parameters<typeof freshPopState>[0], Date.parse('2026-11-27T00:01:00Z'))).toBe('unknown');
});
it('retains fresh states only within the collection deadline', () => {
  const latest = { machineCode: 'MC-2', observedAt: '2026-11-27T00:00:00Z', state: 'running', count: 2, preset: 10 };
  expect(freshPopState(latest, Date.parse(latest.observedAt) + 30000)).toBe('running');
  expect(freshPopState(latest, Date.parse(latest.observedAt) + 30001)).toBe('unknown');
});
const iso = (n: number) => new Date(n).toISOString();
it('distinguishes omitted history from recorded unknown intervals', () => {
  expect(popTimeline([{ machineCode: 'MC-2', state: 'unknown', startAt: iso(20), endAt: iso(40) }], 'MC-2', 0, 60)).toEqual([
    { start: 0, end: 20, state: 'unknown', recorded: false }, { start: 20, end: 40, state: 'unknown', recorded: true }, { start: 40, end: 60, state: 'unknown', recorded: false },
  ]);
});
it('clips, sorts and removes overlap without extending state into gaps', () => {
  const rows = [{ machineCode: 'MC-2', state: 'idle', startAt: iso(30), endAt: iso(100) }, { machineCode: 'MC-2', state: 'running', startAt: iso(-10), endAt: iso(40) }, { machineCode: 'MC-1', state: 'running', startAt: iso(0), endAt: iso(60) }];
  const original = structuredClone(rows);
  expect(popTimeline(rows, 'MC-2', 0, 60)).toEqual([{ start: 0, end: 40, state: 'running', recorded: true }, { start: 40, end: 60, state: 'idle', recorded: true }]);
  expect(rows).toEqual(original);
});
it('handles missing, malformed or zero-length intervals safely', () => {
  expect(popTimeline(undefined, 'MC-2', 0, 0)).toEqual([]);
  expect(popTimeline([{ machineCode: 'MC-2', state: 'running', startAt: 'invalid', endAt: iso(40) }], 'MC-2', 0, 60)).toEqual([{ start: 0, end: 60, state: 'unknown', recorded: false }]);
});
const product: ProductRun = { runKey: 'a', machineId: 'MC-2', productionName: '제품 A', commentSource: 'program', programNo: 'O1000', partsCount: 10, firstAt: iso(0), lastAt: iso(20), contextStatus: 'identified', countQuality: 'confirmed' };
it('groups products across runs and machines while retaining estimates and negative corrections', () => {
  const result = summarizePopProducts([product, { ...product, machineId: 'MC-1', countQuality: 'estimated', partsCount: 3 }, { ...product, countQuality: 'correction', partsCount: -2, contextStatus: 'conflict' }]);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ quantity: 11, estimated: 3, corrected: -2, machines: ['MC-2', 'MC-1'], needsReview: true });
});
it('keeps different programs and work orders separate', () => {
  expect(summarizePopProducts([product, { ...product, programNo: 'O1001' }, { ...product, workOrderNumber: 'ORDER2' }])).toHaveLength(3);
});
it('formats durations without inventing seconds or dropping long totals', () => {
  expect([0, 15, 120, 3600, 90000].map(compactDuration)).toEqual(['0분', '1분 미만', '2분', '1시간', '25시간']);
});
