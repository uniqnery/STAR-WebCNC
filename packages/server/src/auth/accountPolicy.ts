import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';

export const validPassword = (value: unknown): value is string => typeof value === 'string' && value.length >= 6 && value.length <= 128 && Buffer.byteLength(value, 'utf8') <= 72;
export class AccountPolicyError extends Error { constructor(public status: number, message: string) { super(message); } }

// Persistent per-IP and per-account limits; do not store submitted passwords or codes.
export async function accountAttempt(ip: string, identity: string, purpose: string) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72476194)`;
    const now = new Date();
    for (const [scope, value, maximum] of [['ip', ip, 30], ['account', identity.toLowerCase(), 15]] as const) {
      const key = createHash('sha256').update(`policy:${purpose}:${scope}:${value}`).digest('hex');
      const row = await tx.accountRateLimit.findUnique({ where: { key } });
      const same = row && now.getTime() - row.windowAt.getTime() < 3600000;
      if (same && row.count >= maximum) throw new AccountPolicyError(429, '시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.');
      await tx.accountRateLimit.upsert({ where: { key }, create: { key, count: 1, windowAt: now, lastAt: now }, update: { count: same ? row.count + 1 : 1, windowAt: same ? row.windowAt : now, lastAt: now } });
    }
  });
}
