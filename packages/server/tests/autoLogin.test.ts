import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
const mocks = vi.hoisted(() => ({ account: vi.fn(), create: vi.fn(), find: vi.fn(), update: vi.fn(), revoke: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.account, update: vi.fn() }, refreshToken: { create: mocks.create, findUnique: mocks.find, update: mocks.update, updateMany: mocks.revoke } } }));
vi.mock('../src/lib/redis', () => ({ redisService: {} }));
vi.mock('../src/lib/websocket', () => ({ wsService: {} }));
vi.mock('../src/auth/password', () => ({ verifyPassword: async () => true }));
import auth from '../src/routes/auth';
import { generateRefreshToken, verifyRefreshToken } from '../src/auth/jwt';
import { config } from '../src/config';
const account = { id: 'test-user', username: 'test', displayName: '테스트', email: 'test@example.test', passwordHash: 'fake', role: 'USER', isActive: true, isApproved: true };
let server: Server, base: string;
const cookieToken = (res: Response) => decodeURIComponent(res.headers.get('set-cookie')!.split(';')[0].split('=').slice(1).join('='));
const request = (path: string, body: object, token?: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `${config.cookie.refreshTokenName}=${encodeURIComponent(token)}` } : {}) }, body: JSON.stringify(body) });
beforeAll(async () => { const app = express(); app.use(express.json(), cookieParser()); app.use('/auth', auth); server = createServer(app); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterAll(async () => { server.closeIdleConnections(); await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { vi.clearAllMocks(); mocks.account.mockResolvedValue(account); mocks.create.mockResolvedValue({}); mocks.find.mockResolvedValue({ user: account, userId: account.id, revokedAt: null }); mocks.update.mockResolvedValue({}); });
it.each([false, true])('login signs rememberMe=%s and sets the matching cookie lifetime', async rememberMe => {
  const response = await request('/auth/login', { username: 'test', password: 'test-only', rememberMe });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly'); expect(cookie.includes('Max-Age=')).toBe(rememberMe);
  expect(verifyRefreshToken(cookieToken(response))?.rememberMe).toBe(rememberMe);
});
it('does not default a new password login to persistent', async () => {
  const response = await request('/auth/login', { username: 'test', password: 'test-only' });
  expect(verifyRefreshToken(cookieToken(response))?.rememberMe).toBe(false);
});
it('new app startup cannot restore an unchecked session or rotate its cookie', async () => {
  const response = await request('/auth/refresh', { restoreSession: true }, generateRefreshToken(account.id, false).token);
  expect(response.status).toBe(401); expect((await response.json()).error.code).toBe('AUTO_LOGIN_DISABLED');
  expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(response.headers.get('set-cookie')).toBeNull();
});
it.each([false, true])('normal renewal preserves rememberMe=%s', async rememberMe => {
  const response = await request('/auth/refresh', {}, generateRefreshToken(account.id, rememberMe).token);
  expect(response.status).toBe(200); expect((await response.json()).data.rememberMe).toBe(rememberMe);
  expect(verifyRefreshToken(cookieToken(response))?.rememberMe).toBe(rememberMe);
  expect(response.headers.get('set-cookie')!.includes('Max-Age=')).toBe(rememberMe);
});
it('persistent startup restores a valid account', async () => {
  const response = await request('/auth/refresh', { restoreSession: true }, generateRefreshToken(account.id, true).token);
  expect(response.status).toBe(200); expect((await response.json()).data.accessToken).toBeTruthy();
});
it('persistent login still respects account disabling', async () => {
  mocks.find.mockResolvedValue({ user: { ...account, isActive: false }, revokedAt: null });
  expect((await request('/auth/refresh', { restoreSession: true }, generateRefreshToken(account.id, true).token)).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('revoked persistent sessions cannot restore', async () => {
  mocks.find.mockResolvedValue({ user: account, userId: account.id, revokedAt: new Date() });
  expect((await request('/auth/refresh', { restoreSession: true }, generateRefreshToken(account.id, true).token)).status).toBe(401);
});
