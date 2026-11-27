import { beforeEach, it, expect, vi } from 'vitest';
function storage() {
  const entries = new Map<string, string>();
  return { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => { entries.set(k, v); }, removeItem: (k: string) => { entries.delete(k); }, clear: () => entries.clear() };
}
const local = storage(), session = storage();
const hq = { id: 'hq-test', username: 'engineer', email: 'test@example.test', role: 'HQ_ENGINEER' as const };
beforeEach(() => { vi.resetModules(); local.clear(); session.clear(); vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session); });
async function store() { return (await import('../../web/src/stores/authStore')).useAuthStore; }
it('stores only the real role in shared login storage', async () => {
  const auth = await store(); auth.getState().setAuth(hq, 'signed-token'); auth.getState().setTestRole('USER');
  expect(auth.getState().user?.role).toBe('USER');
  expect(JSON.parse(local.getItem('auth-storage')!).state.user.role).toBe('HQ_ENGINEER');
  expect(JSON.parse(session.getItem('star-webcnc-role-test')!).role).toBe('USER');
});
it('keeps a same-tab test role across reload and token renewal', async () => {
  let auth = await store(); auth.getState().setAuth(hq, 'token'); auth.getState().setTestRole('USER');
  vi.resetModules(); auth = await store();
  expect(auth.getState().user?.role).toBe('USER'); expect(auth.getState().testRole).toBe('USER');
  auth.getState().setAuth(hq, 'renewed-token'); expect(auth.getState().user?.role).toBe('USER');
});
it('new tabs retain the real role', async () => {
  let auth = await store(); auth.getState().setAuth(hq, 'token'); auth.getState().setTestRole('ADMIN');
  session.clear(); vi.resetModules(); auth = await store();
  expect(auth.getState().user?.role).toBe('HQ_ENGINEER'); expect(auth.getState().testRole).toBeNull();
});
it('recovery and logout clear the tab override', async () => {
  const auth = await store(); auth.getState().setAuth(hq, 'token'); auth.getState().setTestRole('ADMIN'); auth.getState().setTestRole('HQ_ENGINEER');
  expect(auth.getState().testRole).toBeNull(); expect(session.getItem('star-webcnc-role-test')).toBeNull();
  auth.getState().setTestRole('USER'); auth.getState().logout(); expect(auth.getState().testRole).toBeNull(); expect(session.getItem('star-webcnc-role-test')).toBeNull();
});
it('ordinary accounts cannot enable the selector override', async () => {
  const auth = await store(); auth.getState().setAuth({ ...hq, role: 'ADMIN' }, 'token');
  expect(() => auth.getState().setTestRole('HQ_ENGINEER')).toThrow();
});
it('normal API calls and refresh retries retain the tested role', async () => {
  const auth = await store(); auth.getState().setAuth(hq, 'token'); auth.getState().setTestRole('USER');
  const fetch = vi.fn().mockResolvedValueOnce({ status: 401, json: async () => ({ success: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { accessToken: 'new-token' } }) })
    .mockResolvedValueOnce({ status: 200, json: async () => ({ success: true, data: {} }) });
  vi.stubGlobal('fetch', fetch);
  const { settingsApi } = await import('../../web/src/lib/api'); await settingsApi.getWindowsStartup();
  expect(fetch.mock.calls[0][1].headers['X-Role-Test']).toBe('USER'); expect(fetch.mock.calls[2][1].headers['X-Role-Test']).toBe('USER');
  expect(auth.getState().user?.role).toBe('USER');
});
it('renders the selector and persistent recovery banner only for real HQ accounts', async () => {
  const auth = await store(); auth.getState().setAuth(hq, 'token');
  auth.getInitialState = auth.getState;
  const { createElement } = await import('react');
  vi.stubGlobal('React', await import('react'));
  const { renderToString } = await import('react-dom/server');
  vi.doMock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
  vi.doMock('../../web/src/stores/authStore', () => ({ useAuthStore: Object.assign(() => auth.getState(), { getState: auth.getState }) }));
  vi.doMock('../../web/src/stores/machineStore', () => ({ useMachineStore: { getState: () => ({}) } }));
  const { RoleTestControl } = await import('../../web/src/components/RoleTestControl');
  expect(renderToString(createElement(RoleTestControl))).toContain('role-test-select');
  auth.getState().setTestRole('USER');
  const banner = renderToString(createElement(RoleTestControl, { banner: true }));
  expect(banner).toContain('일반 사용자'); expect(banner).toContain('본사 권한으로 복귀'); expect(banner).toContain('engineer');
  auth.getState().logout(); auth.getState().setAuth({ ...hq, role: 'USER' }, 'token');
  expect(renderToString(createElement(RoleTestControl))).toBe('');
});
