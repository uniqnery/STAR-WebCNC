import nodemailer from 'nodemailer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { prisma } from './prisma';
import { config } from '../config';
import { z } from 'zod';

export const mailSettingsSchema = z.object({ host: z.string().trim().min(1).max(255), port: z.union([z.literal(465), z.literal(587)]),
  username: z.string().trim().min(1).max(320), from: z.string().trim().email().max(320), password: z.string().max(1000).optional(),
  publicUrl: z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash; }, '외부 접속 HTTPS 기본 주소를 입력하세요.') });
type MailSettings = z.infer<typeof mailSettingsSchema> & { encryptedPassword: string };
const key = () => createHash('sha256').update('star-webcnc/account-mail/v1\0' + config.jwt.refreshSecret).digest();
export function sealMailSecret(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function openSecret(value: string) {
  const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
export async function getMailSettings(): Promise<MailSettings | null> {
  const row = await prisma.globalSetting.findUnique({ where: { key: 'account.mail' } });
  return row ? row.value as unknown as MailSettings : null;
}
export async function readyAccountMail() {
  const settings = await getMailSettings();
  if (!settings?.host || !settings.encryptedPassword || !settings.publicUrl) throw new Error('MAIL_NOT_CONFIGURED');
  return settings;
}
export async function sendAccountMail(to: string, subject: string, text: string) {
  const settings = await readyAccountMail();
  const transport = nodemailer.createTransport({ host: settings.host, port: settings.port, secure: settings.port === 465, requireTLS: true,
    auth: { user: settings.username, pass: openSecret(settings.encryptedPassword) }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true });
  try { await transport.sendMail({ from: { name: 'Smart Thinking Pro V2.0', address: settings.from }, to, subject, text }); }
  finally { transport.close(); }
}
