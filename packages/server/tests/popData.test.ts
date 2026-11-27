import { expect, it } from 'vitest';
import { parsePopData } from '../../web/src/lib/popData';

const empty = () => ({ stats: [], chart: [], products: [], recent: [], mesEnabled: false });
it.each([undefined, null, {}, { stats: [], chart: [] }, { ...empty(), products: undefined }, { ...empty(), recent: null },
  { ...empty(), stats: {} }, { ...empty(), products: [null] }, { ...empty(), stats: [{ totalParts: '1', targetParts: 2 }] },
  { ...empty(), chart: [{ date: '10시', production: NaN }] }])('rejects incomplete responses before rendering: %j', response => {
  expect(() => parsePopData(response)).toThrow('5초마다 자동으로 다시 확인');
});
it('accepts an empty result without treating it as missing data', () => {
  const data = empty();
  expect(parsePopData(data)).toBe(data);
  expect(parsePopData(data).products.length).toBe(0);
});
it('preserves the previous snapshot on a bad response and accepts the next valid response', () => {
  let snapshot = parsePopData(empty());
  const previous = snapshot;
  try { snapshot = parsePopData({ stats: [], chart: [] }); } catch { /* UI keeps its last snapshot. */ }
  expect(snapshot).toBe(previous);
  const next = { ...empty(), stats: [{ machineId: 'MC-002', machineName: '2호기', totalParts: 1, targetParts: 10 }] };
  snapshot = parsePopData(next);
  expect(snapshot.stats[0].totalParts).toBe(1);
});
