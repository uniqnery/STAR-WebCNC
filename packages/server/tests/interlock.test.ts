import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/lib/redis', () => ({ redisService: {} }));
import { evaluateInterlock, interlockSignature, isPanelSafetyAction } from '../src/lib/remoteInterlock';
import { serialDataWrite } from '../src/lib/serialDataWrite';
import { dataWriteActivity } from '../src/lib/dataWriteHistory';

const page = { interlockEnabled: true, fields: [{ enabled: true, pmcAddr: 'X0.1', contact: 'A', label: '허가' }] };
const sample = { receivedAt: 10000, pmcBits: { 'X0.1': 1 }, signature: interlockSignature(page) };
describe('remote interlock', () => {
  it('accepts only the matching fresh condition', () => expect(evaluateInterlock(page, sample, 10001)).toBeNull());
  it.each([null, { ...sample, receivedAt: 1 }, { ...sample, signature: 'old' }, { ...sample, pmcBits: {} }, { ...sample, pmcBits: { 'X0.1': 0 } }])('rejects unavailable, stale, mismatched and false conditions', value => {
    expect(evaluateInterlock(page, value, 10001)).not.toBeNull();
  });
  it('requires all enabled fields', () => expect(evaluateInterlock({ ...page, fields: [...page.fields, { ...page.fields[0], pmcAddr: 'X0.2' }] }, sample, 10001)).not.toBeNull());
  it('treats a missing B contact as unknown, not zero', () => {
    const b = { ...page, fields: [{ ...page.fields[0], contact: 'B' }] };
    expect(evaluateInterlock(b, { ...sample, signature: interlockSignature(b), pmcBits: {} }, 10001)).not.toBeNull();
    expect(evaluateInterlock(b, { ...sample, signature: interlockSignature(b), pmcBits: { 'X0.1': 0 } }, 10001)).toBeNull();
  });
  it('honors an explicit interlock disable', () => expect(evaluateInterlock({ ...page, interlockEnabled: false }, null)).toBeNull());
  it('does not trust a supplied stop label', () => {
    const layout = [{ keys: [{ id: 'FEED_HOLD', reqAddr: 'R1.0' }, { id: 'CYCLE_START', reqAddr: 'R1.1' }] }];
    expect(isPanelSafetyAction({ value: 1, address: 'R1.0' }, layout)).toBe(true);
    expect(isPanelSafetyAction({ value: 1, address: 'R1.1', panelKeyId: 'FEED_HOLD' }, layout)).toBe(false);
    expect(isPanelSafetyAction({ value: 0, address: 'R1.1' }, layout)).toBe(true);
    expect(isPanelSafetyAction({ value: 0, address: 'R9.0' }, layout)).toBe(false);
  });
});
it('serializes data writes and continues after an error', async () => {
  const order: number[] = [];
  const first = serialDataWrite('test', async () => { await new Promise(r => setTimeout(r, 10)); order.push(1); throw new Error('test'); });
  const caught = first.catch(() => undefined);
  const second = serialDataWrite('test', async () => { order.push(2); });
  await Promise.all([caught, second]);
  expect(order).toEqual([1, 2]);
});
it('records delta, actual final and previous value together', () => {
  const activity = dataWriteActivity('WRITE_OFFSET', { path: 1, toolNo: 3, axisIdx: 0, value: 9, additiveDelta: .02 }, { beforeValue: .1, value: .12 });
  expect(activity?.detail).toContain('X / +0.02 → 최종 0.12 (이전 0.1)');
  expect(dataWriteActivity('WRITE_COUNT', { varNo: 10001, value: 20 }, { beforeValue: 10, value: 20 })?.action).toBe('카운터 수정');
});
