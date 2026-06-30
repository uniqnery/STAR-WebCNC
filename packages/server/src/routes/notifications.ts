// Notification Routes — Web Push 구독 관리

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { pushService } from '../lib/pushService';

const router = Router();

// VAPID 공개키 — 인증 불필요 (클라이언트 구독 등록에 필요)
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  const publicKey = pushService.getPublicKey();
  if (!publicKey) {
    return res.status(503).json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Push 미설정' } });
  }
  res.json({ success: true, data: { publicKey } });
});

// 구독 등록
router.post('/subscribe', authenticate, async (req: Request, res: Response) => {
  try {
    const { subscription } = req.body as {
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    };
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_SUBSCRIPTION' } });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      create: { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Subscribe error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  }
});

// 구독 해제
router.post('/unsubscribe', authenticate, async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body as { endpoint: string };
    if (!endpoint) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_ENDPOINT' } });
    }
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Unsubscribe error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  }
});

export default router;
