import { prisma } from './prisma';
import { redisService } from './redis';

export const pmcSnapshotKey = (machineId: string) => `machine:${machineId}:interlock-pmc`;
export interface InterlockPage { interlockEnabled?: boolean; fields?: { enabled?: boolean; pmcAddr?: string; contact?: string; label?: string }[] }
export function interlockSignature(page: InterlockPage): string {
  return [page.interlockEnabled === false ? '0' : '1', ...(page.fields ?? []).filter(f => f.enabled !== false)
    .map(f => `${(f.pmcAddr ?? '').toUpperCase()}:${(f.contact ?? 'A').toUpperCase()}`).sort()].join('|');
}
export function evaluateInterlock(page: InterlockPage, sample: { receivedAt: number; pmcBits: Record<string, number>; signature?: string } | null, now = Date.now()): string | null {
  if (page.interlockEnabled === false) return null;
  if (!sample || now - sample.receivedAt > 3500 || sample.receivedAt > now) return '인터록 신호가 없거나 오래되었습니다.';
  if (sample.signature !== interlockSignature(page)) return 'Agent에 최신 인터록 설정이 적용되지 않았습니다.';
  for (const field of (page.fields ?? []).filter(f => f.enabled !== false)) {
    const address = (field.pmcAddr ?? '').toUpperCase();
    const value = sample.pmcBits[address];
    if (!/^[A-Z]\d+\.[0-7]$/.test(address) || (value !== 0 && value !== 1) || !['A', 'B'].includes(field.contact ?? 'A')) return `${field.label || address}: 신호 확인 불가`;
    if (value !== (field.contact === 'B' ? 0 : 1)) return `${field.label || address}: 인터록 조건 불만족`;
  }
  return null;
}
export async function remoteInterlockFailure(machineId: string): Promise<string | null> {
  const machine = await prisma.machine.findUnique({ where: { machineId }, select: { template: { select: { topBarInterlock: true } } } });
  const page = (machine?.template?.topBarInterlock as { remote?: InterlockPage } | null)?.remote;
  if (!page) return '설비의 인터록 설정을 확인할 수 없습니다.';
  return evaluateInterlock(page, await redisService.get(pmcSnapshotKey(machineId)));
}

// Exceptions depend on the installed template address, never on a client-supplied label.
export function isPanelSafetyAction(params: Record<string, unknown>, layout: unknown): boolean {
  if (!Array.isArray(layout)) return false;
  const keys = layout.flatMap(g => Array.isArray(g.keys) ? g.keys : []) as { id?: string; reqAddr?: string }[];
  const matches = keys.filter(k => k.reqAddr && k.reqAddr.toUpperCase() === String(params.address ?? '').toUpperCase());
  return matches.length === 1 && (params.value === 0 || (params.value === 1 && ['STOP', 'FEED_HOLD', 'CYCLE_STOP'].includes(matches[0].id ?? '')));
}
