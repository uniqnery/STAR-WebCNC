import { prisma } from './prisma';
import { counterReport } from './counterReporting';

export function dailyPeriodStart(now: Date): Date {
  const local = new Date(now.getTime() + 9 * 3600000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - 9 * 3600000);
}

interface StateSeconds { machineCode: string; running: number; idle: number; alarm_stop: number; unknown: number }
export function dailyRunSummary(state: StateSeconds, start: Date, now: Date) {
  const elapsedSeconds = Math.max(0, (now.getTime() - start.getTime()) / 1000);
  const knownSeconds = state.running + state.idle + state.alarm_stop;
  return {
    machineId: state.machineCode,
    periodStart: start.toISOString(), calculatedAt: now.toISOString(),
    runningSeconds: state.running, idleSeconds: state.idle, alarmSeconds: state.alarm_stop,
    unknownSeconds: state.unknown, elapsedSeconds,
    rate: elapsedSeconds > 0 && knownSeconds > 0 ? Math.max(0, Math.min(100, state.running / elapsedSeconds * 100)) : null,
    incomplete: state.unknown > 0.001,
  };
}

async function loadDailyRunRates(now: Date) {
  const start = dailyPeriodStart(now);
  const machines = await prisma.machine.findMany({ where: { isActive: true }, select: { machineId: true } });
  // Reuse POP's interval clipping, overlap handling and 30-second stale limit.
  // No production quantities, event detail queries or CNC commands are needed.
  const report = await counterReport(machines.map(m => m.machineId), start, now, prisma, false);
  return { items: report.states.map(state => dailyRunSummary(state, start, now)) };
}

// Share one in-flight calculation and a ten-second result across all viewers.
export function createDailyRunRateReader<T>(load: (now: Date) => Promise<T>) {
  let cache: { day: number; at: number; pending: boolean; result: Promise<T> } | undefined;
  return (now = new Date()): Promise<T> => {
    const day = dailyPeriodStart(now).getTime();
    if (cache?.day === day && (cache.pending || now.getTime() - cache.at < 10000)) return cache.result;
    const entry = { day, at: now.getTime(), pending: true, result: Promise.resolve().then(() => load(now)) };
    cache = entry;
    entry.result.then(() => { entry.pending = false; }, () => { if (cache === entry) cache = undefined; });
    return entry.result;
  };
}
export const getDailyRunRates = createDailyRunRateReader(loadDailyRunRates);
