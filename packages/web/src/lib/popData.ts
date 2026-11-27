export interface ProductRun { runKey: string; machineId: string; productionName: string; commentSource: string; programNo: string; partsCount: number; firstAt: string; lastAt: string; workOrderNumber?: string; contextStatus: string; countQuality?: string }
export interface Completion { id: string; eventId?: string; machineCode: string; programNo: string; executingProgramNo?: string; productionName?: string; commentSource?: string; programComment?: string; schedulerComment?: string; mesComment?: string; endTime: string; partsCount: number; contextStatus: string; workOrderNumber?: string }
export interface CounterHistory { eventId: string; machineCode: string; observedAt: string; kind: string; quality: string; quantity: number; countBefore: number | null; countAfter: number | null; presetBefore: number | null; presetAfter: number | null; programNo?: string; programComment?: string; actor?: string; reason?: string; correlationId?: string; counterSource?: string; messagesBefore?: string | null; messagesAfter?: string | null }
export interface PopData { stats: { machineId: string; machineName: string; totalParts: number; targetParts: number; confirmedParts?: number; estimatedParts?: number; correctedParts?: number }[]; chart: { date: string; production: number }[]; products: ProductRun[]; recent: Completion[]; mesEnabled: boolean;
  states?: { machineCode: string; running: number; idle: number; alarm_stop: number; unknown: number }[];
  segments?: { machineCode: string; state: string; startAt: string; endAt: string }[];
  latest?: { machineCode: string; observedAt: string; count: number | null; preset: number | null; programNo?: string; state: string }[];
  events?: CounterHistory[]; reviewQuantity?: number;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const records = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.every(object);
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

// Validate before replacing the last usable snapshot, including during server upgrades.
export function parsePopData(value: unknown): PopData {
  if (!object(value) || !records(value.stats) || !records(value.chart) || !records(value.products) || !records(value.recent) ||
      typeof value.mesEnabled !== 'boolean' || !value.stats.every(row => number(row.totalParts) && number(row.targetParts)) ||
      !value.chart.every(row => typeof row.date === 'string' && number(row.production)) ||
      !value.products.every(row => number(row.partsCount)) || !value.recent.every(row => number(row.partsCount)) ||
      ['states', 'latest', 'events', 'segments'].some(key => value[key] !== undefined && !records(value[key]))) {
    throw new Error('생산 실적 응답 형식을 확인하지 못했습니다. 5초마다 자동으로 다시 확인합니다.');
  }
  return value as unknown as PopData;
}
