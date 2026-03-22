// Settings Routes — 시스템 전역 설정 관리

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

/**
 * GET /api/settings/registration-codes
 * 현재 등록 코드 조회 (ADMIN 이상)
 * HQ 코드는 노출하지 않음 — 마스킹 처리
 */
router.get('/registration-codes', authenticate, requireRole(['ADMIN', 'HQ_ENGINEER']), async (
  _req: Request,
  res: Response
) => {
  try {
    const [adminRow, opRow] = await Promise.all([
      prisma.globalSetting.findUnique({ where: { key: 'registration.adminCode' } }),
      prisma.globalSetting.findUnique({ where: { key: 'registration.operatorCode' } }),
    ]);

    return res.json({
      success: true,
      data: {
        adminCode:    (adminRow?.value as string) ?? '',
        operatorCode: (opRow?.value   as string) ?? '',
        // HQ 코드는 설정 여부만 알려줌 (값 비공개)
        hqCodeSet: !!(process.env.HQ_REGISTRATION_CODE),
      },
    });
  } catch (error) {
    console.error('Get registration codes error:', error);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '설정 조회 실패' } });
  }
});

/**
 * PUT /api/settings/registration-codes
 * 등록 코드 변경 (ADMIN 이상)
 * adminCode, operatorCode 중 전달된 것만 업데이트
 */
router.put('/registration-codes', authenticate, requireRole(['ADMIN', 'HQ_ENGINEER']), async (
  req: Request,
  res: Response
) => {
  try {
    const { adminCode, operatorCode } = req.body as { adminCode?: string; operatorCode?: string };
    const updatedBy = req.user?.username ?? 'unknown';

    const ops: Promise<unknown>[] = [];

    if (adminCode !== undefined) {
      if (adminCode.length < 4) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '관리자 코드는 4자 이상이어야 합니다.' } });
      }
      ops.push(prisma.globalSetting.upsert({
        where:  { key: 'registration.adminCode' },
        update: { value: adminCode, updatedBy },
        create: { key: 'registration.adminCode', value: adminCode, updatedBy },
      }));
    }

    if (operatorCode !== undefined) {
      if (operatorCode.length < 4) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '오퍼레이터 코드는 4자 이상이어야 합니다.' } });
      }
      ops.push(prisma.globalSetting.upsert({
        where:  { key: 'registration.operatorCode' },
        update: { value: operatorCode, updatedBy },
        create: { key: 'registration.operatorCode', value: operatorCode, updatedBy },
      }));
    }

    if (ops.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '변경할 코드를 입력해주세요.' } });
    }

    await Promise.all(ops);

    return res.json({ success: true });
  } catch (error) {
    console.error('Update registration codes error:', error);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '설정 저장 실패' } });
  }
});

export default router;
