import { expect, it, vi } from 'vitest';
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
import { createDailyRunRateReader, dailyPeriodStart, dailyRunSummary } from '../src/lib/dailyRunRates';
const noon = new Date('2026-11-26T03:00:00Z'); // 12:00 KST
const state = { machineCode: 'MC-2', running: 21600, idle: 14400, alarm_stop: 7200, unknown: 0 };
it('uses Korean midnight regardless of server timezone', () => {
  expect(dailyPeriodStart(noon).toISOString()).toBe('2026-11-25T15:00:00.000Z');
  expect(dailyPeriodStart(new Date('2026-11-26T15:00:00Z')).toISOString()).toBe('2026-11-26T15:00:00.000Z');
});
it('divides six running hours by twelve elapsed hours, not twenty four', () => {
  expect(dailyRunSummary(state, dailyPeriodStart(noon), noon)).toMatchObject({ rate: 50, elapsedSeconds: 43200, incomplete: false });
});
it('keeps unobserved time in the denominator and marks a lower bound', () => {
  expect(dailyRunSummary({ ...state, idle: 0, alarm_stop: 0, unknown: 21600 }, dailyPeriodStart(noon), noon)).toMatchObject({ rate: 50, incomplete: true, unknownSeconds: 21600 });
});
it('distinguishes no observations from observed zero running time', () => {
  expect(dailyRunSummary({ ...state, running: 0, idle: 0, alarm_stop: 0, unknown: 43200 }, dailyPeriodStart(noon), noon).rate).toBeNull();
  expect(dailyRunSummary({ ...state, running: 0, idle: 43200, alarm_stop: 0 }, dailyPeriodStart(noon), noon).rate).toBe(0);
});
it('does not divide by zero at midnight', () => {
  const midnight = dailyPeriodStart(noon);
  expect(dailyRunSummary(state, midnight, midnight).rate).toBeNull();
});
it('shares pending calculations and caches results for ten seconds', async () => {
  let finish!: (value: number) => void;
  const load = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
  const read = createDailyRunRateReader(load);
  const first = read(noon), second = read(noon);
  expect(first).toBe(second);
  await Promise.resolve();finish(50);
  expect(await first).toBe(50);
  expect(await read(new Date(noon.getTime() + 9999))).toBe(50);
  expect(load).toHaveBeenCalledTimes(1);
  const next = read(new Date(noon.getTime() + 10000));
  await Promise.resolve();finish(51);expect(await next).toBe(51);
  expect(load).toHaveBeenCalledTimes(2);
});
it('invalidates the cache at midnight and retries failed calculations', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('db unavailable')).mockResolvedValue(1);
  const read = createDailyRunRateReader(load);
  await expect(read(noon)).rejects.toThrow('db unavailable');
  expect(await read(noon)).toBe(1);
  await read(new Date('2026-11-26T14:59:59Z'));
  await read(new Date('2026-11-26T15:00:00Z'));
  expect(load).toHaveBeenCalledTimes(4);
});
