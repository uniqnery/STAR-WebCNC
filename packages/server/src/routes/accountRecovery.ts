import { Router } from 'express';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { getMailSettings, mailSettingsSchema, readyAccountMail, sealMailSecret, sendAccountMail } from '../lib/accountMail';
import { hashPassword } from '../auth/password';
import { wsService } from '../lib/websocket';
import type { Prisma } from '@prisma/client';

const router = Router();
const emailSchema = z.string().trim().email().max(320).transform(e => e.toLowerCase());
const message = '입력 정보가 일치하면 이메일로 안내했습니다.';
export const challengeHash = (value: string) => createHash('sha256').update(value).digest('hex');
export class RecoveryError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const failure = (res: import('express').Response, error: unknown) => {
  if (error instanceof RecoveryError) return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
  const unconfigured = error instanceof Error && error.message === 'MAIL_NOT_CONFIGURED';
  if (!unconfigured) console.error('[AccountRecovery] Request failed');
  return res.status(503).json({ success: false, error: { code: unconfigured ? 'MAIL_NOT_CONFIGURED' : 'RECOVERY_UNAVAILABLE', message: unconfigured ? '메일 발송 설정이 필요합니다. 본사 엔지니어에게 문의하세요.' : '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.' } });
};

async function rateLimit(ip: string, email: string, purpose: string, send = true) {
  await prisma.$transaction(async tx => {
    // One short DB lock makes limits survive process restarts and concurrent requests.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72476194)`;
    const now = new Date();
    for (const [scope, value, max, cooldown] of [['ip', ip, send ? 100 : 30, 0], ['email', email, send ? 5 : 15, send ? 60000 : 0]] as const) {
      const key = challengeHash(`${purpose}:${scope}:${value}`);
      const row = await tx.accountRateLimit.findUnique({ where: { key } });
      const sameWindow = row && now.getTime() - row.windowAt.getTime() < 3600000;
      if (sameWindow && (row.count >= max || now.getTime() - row.lastAt.getTime() < cooldown))
        throw new RecoveryError(429, 'TRY_LATER', '요청이 많습니다. 잠시 후 다시 시도하세요.');
      await tx.accountRateLimit.upsert({ where: { key }, create: { key, count: 1, windowAt: now, lastAt: now },
        update: { count: sameWindow ? row.count + 1 : 1, windowAt: sameWindow ? row.windowAt : now, lastAt: now } });
    }
  });
}

async function issueChallenge(email: string, purpose: string, token: string, userId?: string) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72476195)`;
    await tx.accountChallenge.updateMany({ where: { email, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await tx.accountChallenge.create({ data: { email, purpose, userId, tokenHash: challengeHash(token), expiresAt: new Date(Date.now() + 15 * 60000) } });
  });
}

// Called inside registration's transaction; consumes a successful verification once.
export async function consumeEmailVerification(tx: Prisma.TransactionClient, email: string, code: unknown) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new RecoveryError(400, 'EMAIL_VERIFICATION_REQUIRED', '이메일 인증번호 6자리를 입력하세요.');
  const changed = await tx.accountChallenge.updateMany({ where: { email, purpose: 'verify', tokenHash: challengeHash(`${email}:${code}`),
    usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, data: { usedAt: new Date() } });
  if (changed.count !== 1) throw new RecoveryError(400, 'INVALID_EMAIL_CODE', '인증번호가 올바르지 않거나 만료되었습니다.');
}
export async function registerEmailRate(ip: string, email: string, code: unknown) {
  await rateLimit(ip, email, 'verify-check', false);
  const current = await prisma.accountChallenge.findFirst({ where: { email, purpose: 'verify', usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!current || current.attempts >= 5 || typeof code !== 'string' || !/^\d{6}$/.test(code) || current.tokenHash !== challengeHash(`${email}:${code}`)) {
    if (current) await prisma.accountChallenge.updateMany({ where: { id: current.id, usedAt: null }, data: { attempts: { increment: 1 } } });
    throw new RecoveryError(400, 'INVALID_EMAIL_CODE', '인증번호가 올바르지 않거나 만료되었습니다.');
  }
}

router.get('/mail-settings', authenticate, requireRole('HQ_ENGINEER'), async (_req, res) => {
  try { const s = await getMailSettings(); return res.json({ success: true, data: s ? { host: s.host, port: s.port, username: s.username, from: s.from, publicUrl: s.publicUrl, hasPassword: !!s.encryptedPassword } : null }); }
  catch (error) { return failure(res, error); }
});
router.put('/mail-settings', authenticate, requireRole('HQ_ENGINEER'), async (req, res) => {
  const parsed = mailSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_MAIL_SETTINGS', message: '메일 서버·포트(465/587)·발신 주소·외부 HTTPS 주소를 확인하세요.' } });
  try {
    const previous = await getMailSettings(), { password, ...input } = parsed.data;
    if (!password && (!previous?.encryptedPassword || previous.host !== input.host || previous.username !== input.username))
      throw new RecoveryError(400, 'MAIL_PASSWORD_REQUIRED', '메일 앱 비밀번호를 입력하세요.');
    const value = { ...input, publicUrl: new URL(input.publicUrl).origin, encryptedPassword: password ? sealMailSecret(password) : previous!.encryptedPassword };
    await prisma.$transaction(async tx => {
      await tx.globalSetting.upsert({ where: { key: 'account.mail' }, update: { value, updatedBy: req.user!.username }, create: { key: 'account.mail', value, updatedBy: req.user!.username } });
      await tx.auditLog.create({ data: { userId: req.user!.id, userRole: req.user!.role, actorDisplayName: req.user!.displayName, action: 'auth.mail_settings_update', result: 'success', ipAddress: req.ip ?? 'unknown' } });
    });
    return res.json({ success: true });
  } catch (error) { return failure(res, error); }
});
router.post('/mail-test', authenticate, requireRole('HQ_ENGINEER'), async (req, res) => {
  const parsed = emailSchema.safeParse(req.body?.email);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_EMAIL', message: '수신 이메일을 입력하세요.' } });
  try { await rateLimit(req.ip ?? 'unknown', parsed.data, 'test'); await sendAccountMail(parsed.data, 'Smart Thinking Pro 메일 발송 확인', '메일 발송 설정이 연결되었습니다.'); return res.json({ success: true }); }
  catch (error) { return failure(res, error); }
});

router.post('/:purpose(verify-email|find-id|forgot-password)', async (req, res) => {
  const parsed = emailSchema.safeParse(req.body?.email), purpose = req.params.purpose;
  if (!parsed.success || (purpose === 'forgot-password' && (typeof req.body?.username !== 'string' || !req.body.username.trim() || req.body.username.length > 80)))
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '이메일과 필요한 로그인 ID를 확인하세요.' } });
  try {
    const settings = await readyAccountMail(), email = parsed.data;
    await rateLimit(req.ip ?? 'unknown', email, 'send');
    const users = await prisma.user.findMany({ where: { email: { equals: email, mode: 'insensitive' }, ...(purpose === 'forgot-password' ? { username: req.body.username.trim() } : {}) }, take: 2,
      select: { id: true, username: true } });
    let subject = '', text = '';
    if (purpose === 'verify-email' && !users.length) {
      const code = String(randomInt(100000, 1000000)); await issueChallenge(email, 'verify', `${email}:${code}`);
      subject = 'Smart Thinking Pro 가입 이메일 인증'; text = `인증번호: ${code}\n15분 이내 회원가입 화면에 입력하세요. 본인이 요청하지 않았다면 이 메일을 무시하세요.`;
    } else if (purpose === 'find-id' && users.length === 1) {
      subject = 'Smart Thinking Pro 로그인 ID 안내'; text = `로그인 ID: ${users[0].username}\n접속 주소: ${settings.publicUrl}\n본인이 요청하지 않았다면 이 메일을 무시하세요.`;
    } else if (purpose === 'forgot-password' && users.length === 1) {
      const token = randomBytes(32).toString('hex'); await issueChallenge(email, 'reset', token, users[0].id);
      subject = 'Smart Thinking Pro 비밀번호 재설정'; text = `아래 링크에서 새 비밀번호를 설정하세요. 링크는 15분간 한 번만 사용할 수 있습니다.\n${settings.publicUrl}/account/reset#token=${token}\n본인이 요청하지 않았다면 이 메일을 무시하세요.`;
    }
    // Send after responding, so SMTP latency cannot reveal account existence.
    res.json({ success: true, data: { message, retryAfter: 60 } });
    if (text) void sendAccountMail(email, subject, text).catch(() => console.error('[AccountRecovery] Email delivery failed; check SMTP settings'));
    return;
  } catch (error) { return failure(res, error); }
});

router.post('/reset-password', async (req, res) => {
  const parsed = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(6).max(128).refine(v => Buffer.byteLength(v, 'utf8') <= 72), passwordConfirm: z.string().max(128) }).safeParse(req.body);
  if (!parsed.success || parsed.data.password !== parsed.data.passwordConfirm) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '비밀번호를 6~128자로 입력하고 확인 값을 맞춰주세요.' } });
  try {
    await rateLimit(req.ip ?? 'unknown', challengeHash(parsed.data.token), 'reset-check', false);
    const passwordHash = await hashPassword(parsed.data.password);
    const userId = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72476195)`;
      const challenge = await tx.accountChallenge.findUnique({ where: { tokenHash: challengeHash(parsed.data.token) } });
      if (!challenge || challenge.purpose !== 'reset' || challenge.usedAt || challenge.expiresAt <= new Date() || !challenge.userId)
        throw new RecoveryError(400, 'INVALID_RESET_LINK', '재설정 링크가 만료되었거나 이미 사용되었습니다.');
      const user = await tx.user.findUnique({ where: { id: challenge.userId } });
      if (!user || user.email?.toLowerCase() !== challenge.email) throw new RecoveryError(400, 'INVALID_RESET_LINK', '사용할 수 없는 재설정 링크입니다.');
      await tx.accountChallenge.updateMany({ where: { email: challenge.email, purpose: 'reset', usedAt: null }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, authVersion: { increment: 1 }, emailVerifiedAt: new Date() } });
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'PASSWORD_RESET' } });
      await tx.auditLog.create({ data: { userId: user.id, actorDisplayName: user.displayName || user.username, userRole: user.role,
        action: 'auth.password_reset', targetType: 'user', targetId: user.id, params: { requestId: randomUUID() }, result: 'success', ipAddress: req.ip ?? 'unknown' } });
      return user.id;
    });
    wsService.notifyAccountsChanged([userId], true);
    return res.json({ success: true, data: { message: '비밀번호가 변경되었습니다. 다시 로그인하세요.', userId } });
  } catch (error) { return failure(res, error); }
});

export default router;
