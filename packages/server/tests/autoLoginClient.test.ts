import { beforeEach, expect, it, vi } from 'vitest';
function storage() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), clear: () => data.clear() }; }
const local = storage(), session = storage();
const user = { id: 'test-user', username: 'test', email: 'test@example.test', role: 'USER' as const };
const store = async () => (await import('../../web/src/stores/authStore')).useAuthStore;
beforeEach(() => { vi.resetModules(); local.clear(); session.clear(); vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session); });
it('unchecked login survives same-tab reload but not a closed tab', async () => {
  let auth = await store(); auth.getState().setAuth(user, 'signed', false);
  expect(local.getItem('auth-storage')).toBeNull(); expect(session.getItem('auth-storage')).toBeTruthy();
  vi.resetModules(); auth = await store(); expect(auth.getState().isAuthenticated).toBe(true);
  session.clear(); vi.resetModules(); auth = await store(); expect(auth.getState().isAuthenticated).toBe(false);
});
it('checked login persists when session storage is cleared', async () => {
  let auth = await store(); auth.getState().setAuth(user, 'signed', true); session.clear(); vi.resetModules(); auth = await store();
  expect(auth.getState().isAuthenticated).toBe(true); expect(auth.getState().rememberMe).toBe(true);
});
it('switching to unchecked removes older persistent credentials', async () => {
  const auth = await store(); auth.getState().setAuth(user, 'old', true); auth.getState().setAuth(user, 'new', false);
  expect(local.getItem('auth-storage')).toBeNull(); expect(JSON.parse(session.getItem('auth-storage')!).state.accessToken).toBe('new');
});
it('profile synchronization and token renewal preserve the unchecked choice', async () => {
  const auth = await store(); auth.getState().setAuth(user, 'old', false); auth.getState().setAuth(user, 'new'); auth.getState().setAccessToken('renewed');
  expect(auth.getState().rememberMe).toBe(false); expect(local.getItem('auth-storage')).toBeNull();
});
it('logout removes remembered credentials', async () => {
  const auth = await store(); auth.getState().setAuth(user, 'signed', true); auth.getState().logout();
  expect(local.getItem('auth-storage')).toBeNull(); expect(JSON.parse(session.getItem('auth-storage')!).state.accessToken).toBeNull();
});
it('retains existing real sessions without the new flag', async () => {
  local.setItem('auth-storage', JSON.stringify({ state: { user, accessToken: 'legacy', isAuthenticated: true }, version: 0 }));
  expect((await store()).getState().isAuthenticated).toBe(true);
});
it('deduplicates concurrent startup restores and asks the server for persistent-only restoration', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { accessToken: 'restored', rememberMe: true } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: user }) });
  vi.stubGlobal('fetch', fetch);
  const { restorePersistentSession } = await import('../../web/src/lib/restoreSession');
  const [a, b] = await Promise.all([restorePersistentSession(), restorePersistentSession()]);
  expect(a).toEqual({ user, accessToken: 'restored' }); expect(b).toEqual(a); expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ restoreSession: true });
});
it('does not turn a refused restore into a logged-in app', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  const { restorePersistentSession } = await import('../../web/src/lib/restoreSession');
  expect(await restorePersistentSession()).toBeNull();
});
