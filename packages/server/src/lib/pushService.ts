// Web Push Service — VAPID 기반 푸시 알림 발송

import webpush from 'web-push';
import { config } from '../config';
import { prisma } from './prisma';

let initialized = false;

function ensureInit() {
  if (initialized) return;
  if (!config.vapid.publicKey || !config.vapid.privateKey) {
    console.warn('[Push] VAPID keys not configured — push notifications disabled');
    return;
  }
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  initialized = true;
}

export const pushService = {
  getPublicKey(): string {
    return config.vapid.publicKey;
  },

  async sendAlarmNotification(machineId: string, machineName: string, alarmNo: number, alarmMsg: string): Promise<void> {
    ensureInit();
    if (!initialized) return;

    const subscriptions = await prisma.pushSubscription.findMany();
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({
      title: `🔴 ${machineName} 알람`,
      body: `[${alarmNo}] ${alarmMsg}`,
      machineId,
      timestamp: new Date().toISOString(),
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async (err: { statusCode?: number }) => {
          // 410 Gone: 구독 만료 → 삭제
          if (err.statusCode === 410) {
            await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
          }
          throw err;
        })
      )
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (sent > 0 || failed > 0) {
      console.log(`[Push] Alarm sent: ${sent} ok, ${failed} failed`);
    }
  },
};
