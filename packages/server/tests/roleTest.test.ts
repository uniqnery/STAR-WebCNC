import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { UserRole } from '@prisma/client';
const mocks = vi.hoisted(() => ({ account: vi.fn(), count: vi.fn(), audit: vi.fn(), machines: vi.fn(), lock: vi.fn(), release: vi.fn(), lockLog: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({ prisma: {
  user: { findUnique: mocks.account }, auditLog: { count: mocks.count, create: mocks.audit },
  machine: { findMany: mocks.machines }, controlLockLog: { create: mocks.lockLog },
} }));
vi.mock('../src/lib/redis', () => ({ redisService: { getControlLock: mocks.lock, releaseControlLock: mocks.release } }));
import { authenticate, requireRole } from '../src/middleware/auth';
import auth from '../src/routes/auth';
import { generateAccessToken } from '../src/auth/jwt';
let server: Server, base: string;
async function request(path: string, signedRole: UserRole, testRole?: string, role?: string) {
  const token = generateAccessToken({ userId: 'hq-test', username: 'engineer', role: signedRole });
  return fetch(base + path, { method: role ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(testRole === undefined ? {} : { 'X-Role-Test': testRole }) },
    body: role ? JSON.stringify({ role }) : undefined });
}
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/auth', auth);
  app.get('/probe', authenticate, (req, res) => res.json(req.user));
  app.get('/hq', authenticate, requireRole('HQ_ENGINEER'), (_req, res) => res.json({ ok: true }));
  app.post('/hq', authenticate, requireRole('HQ_ENGINEER'), (_req, res) => res.json({ ok: true }));
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeIdleConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  vi.clearAllMocks(); mocks.account.mockResolvedValue({ id: 'hq-test', username: 'engineer', role: 'HQ_ENGINEER', isActive: true, isApproved: true });
  mocks.count.mockResolvedValue(0); mocks.audit.mockResolvedValue({}); mocks.machines.mockResolvedValue([{ machineId: 'MC-TEST' }]);
  mocks.lock.mockResolvedValue({ ownerId: 'hq-test', sessionId: 'lease-test' }); mocks.release.mockResolvedValue(true); mocks.lockLog.mockResolvedValue({});
});
it.each(['USER', 'ADMIN', 'HQ_ENGINEER'])('HQ can test %s while retaining actual identity', async role => {
  const response = await request('/probe', 'HQ_ENGINEER', role);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: 'hq-test', username: 'engineer', actualRole: 'HQ_ENGINEER', role, testRole: role });
});
it('normal requests retain their original role without DB test checks', async () => {
  expect((await (await request('/probe', 'HQ_ENGINEER')).json()).role).toBe('HQ_ENGINEER');
  expect(mocks.account).not.toHaveBeenCalled();
});
it.each(['USER', 'ADMIN'] as UserRole[])('ordinary %s cannot forge a test header', async role => {
  expect((await request('/probe', role, 'HQ_ENGINEER')).status).toBe(403);
  expect(mocks.account).not.toHaveBeenCalled();
});
it.each([{ role: 'USER', isActive: true, isApproved: true }, { role: 'HQ_ENGINEER', isActive: false, isApproved: true }, { role: 'HQ_ENGINEER', isActive: true, isApproved: false }, null])('checks current HQ DB membership', async account => {
  mocks.account.mockResolvedValue(account);
  expect((await request('/probe', 'HQ_ENGINEER', 'USER')).status).toBe(403);
});
it('rejects invalid test roles', async () => expect((await request('/probe', 'HQ_ENGINEER', 'OWNER')).status).toBe(403));
it.each(['USER', 'ADMIN'])('applies %s to server role guards', async role => {
  expect((await request('/hq', 'HQ_ENGINEER', role)).status).toBe(403);
});
it('returns held leases and records the real and effective roles on entry', async () => {
  const response = await request('/api/auth/role-test', 'HQ_ENGINEER', undefined, 'USER');
  expect(response.status).toBe(200); expect((await response.json()).data.releasedMachines).toEqual(['MC-TEST']);
  expect(mocks.release).toHaveBeenCalledWith('MC-TEST', 'hq-test');
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'hq-test', userRole: 'USER', params: expect.objectContaining({ actualRole: 'HQ_ENGINEER', testRole: 'USER' }) }) }));
});
it('allows HQ recovery from USER test mode', async () => {
  expect((await request('/api/auth/role-test', 'HQ_ENGINEER', 'USER', 'HQ_ENGINEER')).status).toBe(200);
  expect(mocks.release).not.toHaveBeenCalled();
});
it('never releases another account lease', async () => {
  mocks.lock.mockResolvedValue({ ownerId: 'other' });
  expect((await request('/api/auth/role-test', 'HQ_ENGINEER', undefined, 'ADMIN')).status).toBe(200);
  expect(mocks.release).not.toHaveBeenCalled();
});
it('blocks a transition when an operation is pending', async () => {
  mocks.count.mockResolvedValue(1);
  expect((await request('/api/auth/role-test', 'HQ_ENGINEER', undefined, 'USER')).status).toBe(409);
  expect(mocks.release).not.toHaveBeenCalled();
});
it('does not report success when lease release fails', async () => {
  mocks.release.mockResolvedValue(false);
  expect((await request('/api/auth/role-test', 'HQ_ENGINEER', undefined, 'USER')).status).toBe(503);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it('ordinary administrators cannot start a test session', async () => {
  expect((await request('/api/auth/role-test', 'ADMIN', undefined, 'USER')).status).toBe(403);
});
it('audits denied test mutations with both identities', async () => {
  expect((await request('/hq', 'HQ_ENGINEER', 'USER', 'USER')).status).toBe(403);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'auth.role_test_request', userRole: 'USER', params: expect.objectContaining({ actualRole: 'HQ_ENGINEER', testRole: 'USER', status: 403 }) }) }));
});
