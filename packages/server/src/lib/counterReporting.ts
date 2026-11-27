import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
export async function counterReport(codes: string[], start: Date, now: Date, db: Prisma.TransactionClient = prisma, includeDetails = true) {
  if (!codes.length) return { events: [], latest: [], states: [], segments: [], reviewQuantity: 0 };
  const [durations, latest, events, reviews] = await Promise.all([
    db.$queryRaw<{ machineCode: string; state: string; startAt: Date; endAt: Date }[]>(Prisma.sql`
      WITH pieces AS (
        SELECT machine_code, interval_state AS state, previous_at AS start_at, LEAST(observed_at, previous_at + interval '30 seconds') AS end_at
        FROM production_counter_events WHERE machine_code IN (${Prisma.join(codes)}) AND observed_at >= (${start}::timestamptz AT TIME ZONE 'UTC')
          AND previous_at <= (${now}::timestamptz AT TIME ZONE 'UTC') AND kind <> 'correction'
      ), clipped AS (
        SELECT machine_code, state, GREATEST(start_at, (${start}::timestamptz AT TIME ZONE 'UTC')) AS start_at,
          LEAST(end_at, (${now}::timestamptz AT TIME ZONE 'UTC')) AS end_at FROM pieces
      ), marked AS (
        SELECT *, CASE WHEN LAG(state) OVER w = state AND LAG(end_at) OVER w = start_at THEN 0 ELSE 1 END AS boundary
        FROM clipped WHERE end_at > start_at WINDOW w AS (PARTITION BY machine_code ORDER BY start_at, end_at)
      ), grouped AS (
        SELECT *, SUM(boundary) OVER(PARTITION BY machine_code ORDER BY start_at, end_at) AS section FROM marked
      ) SELECT machine_code AS "machineCode", state, MIN(start_at) AS "startAt", MAX(end_at) AS "endAt"
        FROM grouped GROUP BY machine_code, state, section ORDER BY machine_code, MIN(start_at)`),
    db.$queryRaw<({ machineCode: string; observedAt: Date; countAfter: number | null; presetAfter: number | null; programNo: string | null; raw: Prisma.JsonValue })[]>(Prisma.sql`
      SELECT DISTINCT ON(machine_code) machine_code AS "machineCode", observed_at AS "observedAt", count_after AS "countAfter", preset_after AS "presetAfter", program_no AS "programNo", raw
      FROM production_counter_events WHERE machine_code IN (${Prisma.join(codes)}) AND observed_at <= (${now}::timestamptz AT TIME ZONE 'UTC') AND kind <> 'correction' ORDER BY machine_code, observed_at DESC, created_at DESC`),
    includeDetails ? db.productionCounterEvent.findMany({ where: { machineCode: { in: codes }, observedAt: { gte: start, lte: now }, kind: { not: 'heartbeat' } }, orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }], take: 100 }) : Promise.resolve([]),
    includeDetails ? db.productionCounterEvent.aggregate({ where: { machineCode: { in: codes }, observedAt: { gte: start, lte: now }, quality: 'review' }, _sum: { quantity: true } }) : Promise.resolve({ _sum: { quantity: null } }),
  ]);
  const segments: { machineCode: string; state: string; startAt: Date; endAt: Date }[] = [];
  const states = codes.map(machineCode => {
    const seconds = { running: 0, idle: 0, alarm_stop: 0, unknown: 0 };
    let cursor = start.getTime();
    const append = (state: string, from: number, to: number) => {
      from = Math.max(from, cursor); to = Math.min(to, now.getTime());
      if (to <= from) return;
      if (!(state in seconds)) state = 'unknown';
      seconds[state as keyof typeof seconds] += (to - from) / 1000;
      const previous = segments[segments.length - 1];
      if (previous?.machineCode === machineCode && previous.state === state && previous.endAt.getTime() === from) previous.endAt = new Date(to);
      else segments.push({ machineCode, state, startAt: new Date(from), endAt: new Date(to) });
      cursor = to;
    };
    for (const row of durations.filter(d => d.machineCode === machineCode)) {
      append('unknown', cursor, row.startAt.getTime()); append(row.state, row.startAt.getTime(), row.endAt.getTime());
    }
    const last = latest.find(r => r.machineCode === machineCode);
    if (last) {
      const state = (last.raw as unknown as { current: { state: string } }).current.state;
      append('unknown', cursor, last.observedAt.getTime());
      append(state, Math.max(start.getTime(), last.observedAt.getTime()), last.observedAt.getTime() + 30000);
    }
    // Before first observation, after stale data, and unobserved gaps are unknown.
    append('unknown', cursor, now.getTime());
    return { machineCode, ...seconds };
  });
  return { states, segments: segments.sort((a,b)=>b.startAt.getTime()-a.startAt.getTime()).slice(0,200), latest: latest.map(e => ({ machineCode: e.machineCode, observedAt: e.observedAt, count: e.countAfter, preset: e.presetAfter, programNo: e.programNo,
    state: now.getTime() - e.observedAt.getTime() > 30000 ? 'unknown' : (e.raw as unknown as { current: { state: string } }).current.state })),
    events: events.map(({ raw, ...event }) => {
      const snapshots = raw as unknown as { current?: { counterSource?: string; operatorMessages?: string | null }; previous?: { operatorMessages?: string | null } };
      return { ...event, counterSource: snapshots.current?.counterSource, messagesBefore: snapshots.previous?.operatorMessages, messagesAfter: snapshots.current?.operatorMessages };
    }), reviewQuantity: reviews._sum.quantity ?? 0 };
}
