// Counter values may contain a few floating point ULPs from FOCAS decimal scaling.
export function counterInteger(value: number): number {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) <= Math.max(1, Math.abs(value)) * Number.EPSILON * 8 ? nearest : Math.trunc(value);
}
export const formatCounter = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? String(counterInteger(value)) : '—';
export function parseCounterInput(input: string): number | null {
  if (!/^\d+$/.test(input.trim())) return null;
  const value = Number(input);
  return Number.isSafeInteger(value) && value <= 2147483647 ? value : null;
}
export function formatCountDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '계산 불가';
  const total = Math.floor(seconds);
  const parts = [Math.floor(total / 3600) ? `${Math.floor(total / 3600)}시간` : '', Math.floor(total % 3600 / 60) ? `${Math.floor(total % 3600 / 60)}분` : '', total % 60 ? `${total % 60}초` : ''].filter(Boolean);
  return parts.join(' ') || '0초';
}
export function remainingCountSeconds(preset: number | null | undefined, count: number | null | undefined, cycle: number | null | undefined): number | null {
  if (typeof preset !== 'number' || typeof count !== 'number' || !Number.isFinite(preset) || !Number.isFinite(count) || preset < 0 || count < 0) return null;
  const remaining = Math.max(0, counterInteger(preset) - counterInteger(count));
  if (!remaining) return 0;
  if (typeof cycle !== 'number' || !Number.isFinite(cycle) || cycle <= 0) return null;
  const seconds = Math.ceil(remaining * cycle);
  return Number.isSafeInteger(seconds) ? seconds : null;
}
const finishFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function formatExpectedFinish(now: number, seconds: number | null): string {
  if (seconds === null) return '계산 불가';
  if (seconds === 0) return '목표 수량 도달';
  const date = new Date(now + seconds * 1000);
  return Number.isFinite(date.getTime()) ? finishFormatter.format(date) : '계산 불가';
}
