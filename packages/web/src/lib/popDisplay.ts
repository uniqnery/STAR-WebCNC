import type { PopData, ProductRun } from './popData';

export type PopRange = 'today' | 'week' | 'month';
export const popRangeName = { today: '오늘', week: '이번 주', month: '이번 달' };
export const popStateNames: Record<string, string> = { running: '가동 중', idle: '대기', alarm_stop: '알람 정지', unknown: '확인 불가' };
const KST = 9 * 3600000;
export function popPeriodStart(range: PopRange, end: number): number {
  const local = new Date(end + KST);
  if (range === 'week') local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  if (range === 'month') local.setUTCDate(1);
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() - KST;
}
export function compactDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}` : minutes ? `${minutes}분` : seconds > 0 ? '1분 미만' : '0분';
}
export function freshPopState(latest: NonNullable<PopData['latest']>[number] | undefined, now: number): string {
  const age = now - Date.parse(latest?.observedAt ?? '');
  return Number.isFinite(age) && age >= -60000 && age <= 30000 && latest && latest.state in popStateNames ? latest.state : 'unknown';
}
export interface TimelinePiece { start: number; end: number; state: string; recorded: boolean }
export function popTimeline(segments: PopData['segments'], machineCode: string, start: number, end: number): TimelinePiece[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const result: TimelinePiece[] = [];
  let cursor = start;
  const rows = (segments ?? []).filter(s => s.machineCode === machineCode)
    .map(s => ({ start: Date.parse(s.startAt), end: Date.parse(s.endAt), state: s.state in popStateNames ? s.state : 'unknown' }))
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  for (const row of rows) {
    const from = Math.max(start, cursor, row.start), to = Math.min(end, row.end);
    if (to <= from) continue;
    if (from > cursor) result.push({ start: cursor, end: from, state: 'unknown', recorded: false });
    result.push({ start: from, end: to, state: row.state, recorded: true }); cursor = to;
  }
  if (cursor < end) result.push({ start: cursor, end, state: 'unknown', recorded: false });
  return result;
}
export interface ProductSummary {
  key: string; name: string; programNo: string; order?: string; quantity: number;
  estimated: number; corrected: number; machines: string[]; firstAt: string; lastAt: string; needsReview: boolean;
}
export function summarizePopProducts(products: ProductRun[]): ProductSummary[] {
  const grouped = new Map<string, ProductSummary>();
  for (const p of products) {
    const key = JSON.stringify([p.productionName, p.programNo, p.workOrderNumber ?? '']);
    let row = grouped.get(key);
    if (!row) {
      row = { key, name: p.productionName || '생산 항목 미지정', programNo: p.programNo, order: p.workOrderNumber, quantity: 0, estimated: 0, corrected: 0,
        machines: [], firstAt: p.firstAt, lastAt: p.lastAt, needsReview: false };
      grouped.set(key, row);
    }
    row.quantity += p.partsCount;
    if (p.countQuality === 'estimated') row.estimated += p.partsCount;
    if (p.countQuality === 'correction') row.corrected += p.partsCount;
    if (!row.machines.includes(p.machineId)) row.machines.push(p.machineId);
    if (Date.parse(p.firstAt) < Date.parse(row.firstAt)) row.firstAt = p.firstAt;
    if (Date.parse(p.lastAt) > Date.parse(row.lastAt)) row.lastAt = p.lastAt;
    row.needsReview ||= p.contextStatus === 'conflict' || p.contextStatus === 'mes_unlinked';
  }
  return [...grouped.values()].sort((a, b) => b.quantity - a.quantity || Date.parse(b.lastAt) - Date.parse(a.lastAt));
}
