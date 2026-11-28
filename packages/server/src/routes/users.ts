import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { wsService } from '../lib/websocket';
import { displayNameOf } from '../auth/identity';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/password';
import { accountAttempt, AccountPolicyError } from '../auth/accountPolicy';

const router = Router();
router.use(authenticate, requireRole(['ADMIN', 'HQ_ENGINEER']));
const userFields = { id: true, username: true, displayName: true, email: true, role: true, isRepresentative: true,
  isApproved: true, isActive: true, createdAt: true, lastLoginAt: true } as const;

class UserManagementError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Serialize user administration, including representative replacement and actor checks.
async function lockedActor(tx: Prisma.TransactionClient, actor: NonNullable<Express.Request['user']>) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(72476193)`;
  const current = await tx.user.findUnique({ where: { id: actor.id } });
  if (!current?.isActive || !current.isApproved || current.deletedAt || current.mustChangePassword || !['ADMIN', 'HQ_ENGINEER'].includes(current.role))
    throw new UserManagementError(403, '사용자 관리 권한이 없습니다.');
  // Role testing may reduce permissions, never restore the underlying HQ privileges.
  return { ...current, role: actor.testRole ?? current.role, isRepresentative: actor.testRole ? false : current.isRepresentative };
}

function fail(res: import('express').Response, error: unknown) {
  const known = error instanceof UserManagementError || error instanceof AccountPolicyError;
  if (!known) console.error('[Users] Management failed:', error);
  return res.status(known ? error.status : 503).json({ success: false, error: {
    code: known ? 'USER_MANAGEMENT_REJECTED' : 'USER_MANAGEMENT_FAILED',
    message: known ? error.message : '사용자 정보를 처리하지 못했습니다. 다시 확인하세요.',
  } });
}

router.get('/', async (req, res) => {
  try {
    const items = await prisma.user.findMany({ where: { deletedAt: null, ...(req.user!.role === 'HQ_ENGINEER' ? {} : { role: { not: 'HQ_ENGINEER' as const } }) },
      select: userFields, orderBy: [{ isRepresentative: 'desc' }, { createdAt: 'desc' }] });
    return res.json({ success: true, data: { items } });
  } catch (error) { return fail(res, error); }
});

router.put('/representative', async (req, res) => {
  const userId = req.body?.userId;
  if (userId !== null && (typeof userId !== 'string' || !userId)) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '대표 관리자를 선택하세요.' } });
  try {
    const changed = await prisma.$transaction(async (tx) => {
      const actor = await lockedActor(tx, req.user!);
      if (actor.role !== 'HQ_ENGINEER') throw new UserManagementError(403, '본사 엔지니어만 대표 관리자를 지정할 수 있습니다.');
      const target = userId === null ? null : await tx.user.findUnique({ where: { id: userId } });
      if (userId !== null && (!target || target.deletedAt || target.role === 'HQ_ENGINEER' || !target.isActive || !target.isApproved))
        throw new UserManagementError(400, '승인된 활성 업체 계정을 선택하세요.');
      const previous = await tx.user.findFirst({ where: { isRepresentative: true } });
      if (previous?.id === target?.id) return [];
      await tx.user.updateMany({ where: { isRepresentative: true }, data: { isRepresentative: false } });
      if (target) await tx.user.update({ where: { id: target.id }, data: { role: 'ADMIN', isRepresentative: true } });
      await tx.auditLog.create({ data: { userId: actor.id, actorDisplayName: displayNameOf(actor), userRole: actor.role,
        action: 'users.representative_change', targetType: 'user', targetId: target?.id ?? previous?.id ?? 'company', result: 'success', ipAddress: req.ip ?? 'unknown',
        params: { before: previous ? { id: previous.id, name: displayNameOf(previous) } : null,
          after: target ? { id: target.id, name: displayNameOf(target) } : null, previousTargetRole: target?.role ?? null } } });
      return [...(target ? [target.id] : []), ...(previous ? [previous.id] : [])];
    });
    wsService.notifyAccountsChanged(changed);
    return res.json({ success: true });
  } catch (error) { return fail(res, error); }
});

router.patch('/:id', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length
    || Object.keys(body).some((key) => !['role', 'isApproved', 'isActive'].includes(key))
    || (body.role !== undefined && !['USER', 'ADMIN'].includes(body.role))
    || ['isApproved', 'isActive'].some((key) => body[key] !== undefined && typeof body[key] !== 'boolean'))
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: '변경할 권한 또는 계정 상태를 확인하세요.' } });
  try {
    const disabled = await prisma.$transaction(async (tx) => {
      const actor = await lockedActor(tx, req.user!);
      const target = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!target || target.deletedAt) throw new UserManagementError(404, '사용자를 찾을 수 없습니다.');
      if (target.id === actor.id || target.role === 'HQ_ENGINEER' || target.isRepresentative)
        throw new UserManagementError(403, '본인·본사 엔지니어·대표 관리자 계정은 이 항목에서 변경할 수 없습니다.');
      if (actor.role !== 'HQ_ENGINEER' && !actor.isRepresentative && (body.role !== undefined || target.role !== 'USER'))
        throw new UserManagementError(403, '업체 관리자 권한은 대표 관리자 또는 본사 엔지니어만 변경할 수 있습니다.');
      const next = { role: body.role ?? target.role, isActive: body.isActive ?? target.isActive, isApproved: body.isApproved ?? target.isApproved };
      await tx.user.update({ where: { id: target.id }, data: next });
      if (!next.isActive || !next.isApproved) await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'ACCOUNT_DISABLED' } });
      await tx.auditLog.create({ data: { userId: actor.id, actorDisplayName: displayNameOf(actor), userRole: actor.role,
        action: 'users.permissions_change', targetType: 'user', targetId: target.id, result: 'success', ipAddress: req.ip ?? 'unknown',
        params: { name: displayNameOf(target), before: { role: target.role, isActive: target.isActive, isApproved: target.isApproved }, after: next } } });
      return !next.isActive || !next.isApproved;
    });
    wsService.notifyAccountsChanged([req.params.id], disabled);
    return res.json({ success: true });
  } catch (error) { return fail(res, error); }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    await accountAttempt(req.ip ?? 'unknown', req.user!.id, 'admin-password-reset');
    const temporaryPassword = randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(temporaryPassword);
    await prisma.$transaction(async tx => {
      const actor = await lockedActor(tx, req.user!);
      const target = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!target || target.deletedAt || !target.isActive || !target.isApproved) throw new UserManagementError(400, '승인된 활성 계정만 초기화할 수 있습니다.');
      if (target.id === actor.id || target.role === 'HQ_ENGINEER'
        || (target.isRepresentative && actor.role !== 'HQ_ENGINEER')
        || (target.role === 'ADMIN' && actor.role !== 'HQ_ENGINEER' && !actor.isRepresentative))
        throw new UserManagementError(403, '해당 계정의 비밀번호를 초기화할 권한이 없습니다.');
      await tx.user.update({ where: { id: target.id }, data: { passwordHash, mustChangePassword: true, authVersion: { increment: 1 } } });
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'ADMIN_PASSWORD_RESET' } });
      await tx.auditLog.create({ data: { userId: actor.id, actorDisplayName: displayNameOf(actor), userRole: actor.role, action: 'users.password_reset', targetType: 'user', targetId: target.id, params: { name: displayNameOf(target) }, result: 'success', ipAddress: req.ip ?? 'unknown' } });
    });
    wsService.notifyAccountsChanged([req.params.id], true);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data: { temporaryPassword } });
  } catch (e) { return fail(res, e); }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.$transaction(async tx => {
      const actor = await lockedActor(tx, req.user!);
      if (actor.role !== 'HQ_ENGINEER') throw new UserManagementError(403, '본사 엔지니어만 계정을 삭제할 수 있습니다.');
      const target = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!target || target.deletedAt) throw new UserManagementError(404, '사용자를 찾을 수 없습니다.');
      if (target.id === actor.id || target.role === 'HQ_ENGINEER' || target.isRepresentative)
        throw new UserManagementError(403, '본인·본사 계정은 삭제할 수 없으며 대표 관리자는 먼저 대표 지정을 해제하세요.');
      if (req.body?.confirmUsername !== target.username) throw new UserManagementError(400, '삭제할 로그인 ID를 정확히 입력하세요.');
      await tx.user.update({ where: { id: target.id }, data: { deletedAt: new Date(), isActive: false, isApproved: false, authVersion: { increment: 1 } } });
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'ACCOUNT_DELETED' } });
      await tx.auditLog.create({ data: { userId: actor.id, actorDisplayName: displayNameOf(actor), userRole: actor.role, action: 'users.delete', targetType: 'user', targetId: target.id, params: { name: displayNameOf(target), username: target.username }, result: 'success', ipAddress: req.ip ?? 'unknown' } });
    });
    wsService.notifyAccountsChanged([req.params.id], true);
    return res.json({ success: true });
  } catch (e) { return fail(res, e); }
});

export default router;
