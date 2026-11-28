// Settings Routes — 시스템 전역 설정 관리

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { getWindowsStartup, setWindowsStartup, WindowsStartupError } from '../lib/windowsStartup';

const router = Router();

router.get('/windows-startup', authenticate, requireRole(['ADMIN', 'HQ_ENGINEER']), async (_req, res) => {
  try {
    return res.json({ success: true, data: await getWindowsStartup() });
  } catch (error) {
    const failure = error as WindowsStartupError;
    return res.status(503).json({ success: false, error: { code: failure.code, message: failure.message } });
  }
});

router.put('/windows-startup', authenticate, requireRole(['ADMIN', 'HQ_ENGINEER']), async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '자동 시작 활성화 여부를 지정해 주세요.' } });
  }
  try {
    return res.json({ success: true, data: await setWindowsStartup(req.body.enabled) });
  } catch (error) {
    const failure = error as WindowsStartupError;
    const status = failure.code === 'STARTUP_ADMIN_REQUIRED' ? 403 : failure.code === 'STARTUP_BUSY' ? 409 : 503;
    return res.status(status).json({ success: false, error: { code: failure.code, message: failure.message } });
  }
});

/**
 * GET /api/settings/registration-codes
 * 업체 대표/관리자만 조회. 본사 엔지니어에게도 코드 값은 제공하지 않는다.
 */
router.get('/registration-codes', authenticate, requireRole(['ADMIN']), async (
  _req: Request,
  res: Response
) => {
  try {
    if (_req.user?.actualRole === 'HQ_ENGINEER') return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '업체 관리자만 가입 코드를 확인할 수 있습니다.' } });
    const opRow = await prisma.globalSetting.findUnique({ where: { key: 'registration.operatorCode' } });

    return res.json({
      success: true,
      data: {
        operatorCode: (opRow?.value   as string) ?? '',
      },
    });
  } catch (error) {
    console.error('Get registration codes error:', error);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '설정 조회 실패' } });
  }
});

/**
 * PUT /api/settings/registration-codes
 * 일반 사용자 가입 코드만 관리한다. 관리자 권한은 사용자 관리에서 지정한다.
 */
router.put('/registration-codes', authenticate, requireRole(['ADMIN']), async (
  req: Request,
  res: Response
) => {
  try {
    if (req.user?.actualRole === 'HQ_ENGINEER') return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '업체 관리자만 가입 코드를 변경할 수 있습니다.' } });
    const operatorCode = typeof req.body?.operatorCode === 'string' ? req.body.operatorCode.trim() : '';
    const updatedBy = req.user?.username ?? 'unknown';
    if (Object.keys(req.body ?? {}).some(key => key !== 'operatorCode') || operatorCode.length < 4 || operatorCode.length > 128
      || operatorCode === process.env.HQ_REGISTRATION_CODE) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '가입 코드를 4~128자로 입력하세요.' } });
    }
    await prisma.$transaction(async tx => {
      await tx.globalSetting.upsert({ where: { key: 'registration.operatorCode' }, update: { value: operatorCode, updatedBy },
        create: { key: 'registration.operatorCode', value: operatorCode, updatedBy } });
      await tx.auditLog.create({ data: { userId: req.user!.id, actorDisplayName: req.user!.displayName || updatedBy, userRole: req.user!.role,
        action: 'users.registration_code_change', targetType: 'setting', targetId: 'registration.operatorCode', result: 'success', ipAddress: req.ip ?? 'unknown' } });
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Update registration codes error:', error);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '설정 저장 실패' } });
  }
});

/**
 * GET /api/settings/factory-layout
 * 공장 레이아웃 데이터 조회 (로그인 사용자 누구나)
 */
router.get('/factory-layout', authenticate, async (
  _req: Request,
  res: Response
) => {
  try {
    const row = await prisma.globalSetting.findUnique({ where: { key: 'factory.layout' } });
    if (!row) {
      return res.json({ success: true, data: null });
    }
    return res.json({ success: true, data: JSON.parse(row.value as string) });
  } catch (error) {
    console.error('Get factory-layout error:', error);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '레이아웃 조회 실패' } });
  }
});

/**
 * PUT /api/settings/factory-layout
 * 공장 레이아웃 데이터 저장 (ADMIN/HQ_ENGINEER만)
 */
router.put('/factory-layout', authenticate, requireRole(['ADMIN', 'HQ_ENGINEER']), async (
  req: Request,
  res: Response
) => {
  try {
    const layout = req.body;
    if (!layout || typeof layout !== 'object') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '유효하지 않은 레이아웃 데이터' } });
    }
    const updatedBy = req.user?.username ?? 'unknown';
    await prisma.globalSetting.upsert({
      where:  { key: 'factory.layout' },
      update: { value: JSON.stringify(layout), updatedBy },
      create: { key: 'factory.layout', value: JSON.stringify(layout), updatedBy },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Save factory-layout error:', error);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '레이아웃 저장 실패' } });
  }
});

export default router;
