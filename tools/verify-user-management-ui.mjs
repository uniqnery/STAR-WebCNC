// Real user management component with reactive in-memory accounts. No server/CNC access.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(), runtime = path.join(root, 'agent-runtime/startup/count-ui-check');
const { Window } = await import(pathToFileURL(path.join(runtime, 'node_modules/happy-dom/lib/index.js')));
const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Event']) Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react'), { act } = React, { createRoot } = await import('react-dom/client');
const common = { email: 'test@example.test', isActive: true, isApproved: true, createdAt: '2026-11-27T00:00:00Z', lastLoginAt: null };
const users = [
  { ...common, id: 'owner', username: 'owner01', displayName: '대표 이름', role: 'ADMIN', isRepresentative: true },
  { ...common, id: 'admin', username: 'admin01', displayName: '관리자 이름', role: 'ADMIN' },
  { ...common, id: 'user', username: 'user01', displayName: '작업자 이름', role: 'USER' },
  { ...common, id: 'pending', username: 'pending01', displayName: '대기 이름', role: 'USER', isApproved: false },
];
const subscribers = new Set(), calls = [], messages = new Set();
globalThis.__usersTest = {
  actor: { ...users[0], role: 'HQ_ENGINEER', actualRole: 'HQ_ENGINEER', id: 'hq' },
  subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); },
  usersApi: {
    list: async () => ({ success: true, data: { items: users } }),
    update: async (...args) => { calls.push(['update', ...args]); return { success: true }; },
    setRepresentative: async (...args) => { calls.push(['representative', ...args]); return { success: true }; },
    resetPassword: async (...args) => { calls.push(['reset', ...args]); return { success: true, data: { temporaryPassword: 'test-temporary-only' } }; },
    remove: async (...args) => { calls.push(['remove', ...args]); return { success: true }; },
  },
  settingsApi: {
    getRegistrationCodes: async () => { calls.push(['code-read']); return { success: true, data: { operatorCode: 'test-only-code' } }; },
    updateRegistrationCodes: async (...args) => { calls.push(['code-save', ...args]); return { success: true }; },
  },
  onMessage: fn => { messages.add(fn); return () => messages.delete(fn); },
};
const output = path.join(runtime, 'User-management-test.mjs');
await build({ entryPoints: [path.join(root, 'packages/web/src/components/UserManagement.tsx')], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', plugins: [{ name: 'fake-api-and-auth', setup(b) {
  b.onResolve({ filter: /\/(lib\/api|stores\/authStore|lib\/wsClient)$/ }, args => ({ path: args.path, namespace: 'test' }));
  b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ loader: 'js', resolveDir: root, contents: args.path.endsWith('/api') ? 'export const {usersApi,settingsApi} = globalThis.__usersTest;' : args.path.endsWith('/wsClient') ? 'export const wsClient = {onMessage:globalThis.__usersTest.onMessage};' : 'import {useSyncExternalStore} from "react"; export const useAuthStore = select => select(useSyncExternalStore(globalThis.__usersTest.subscribe,()=>globalThis.__usersTest.actor) && {user:globalThis.__usersTest.actor});' }));
} }] });
const { UserManagement } = await import(pathToFileURL(output));
const host = document.createElement('div'); document.body.append(host); const view = createRoot(host);
const flush = () => new Promise(r => setImmediate(r));
let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
const row = id => host.querySelector(`[aria-label="가입자 ${id}"]`);
const button = (area, label) => [...area.querySelectorAll('button')].find(b => b.textContent === label);
const click = element => act(async () => { element.click(); await flush(); });
const as = async actor => act(async () => { globalThis.__usersTest.actor = actor; subscribers.forEach(fn => fn()); await flush(); });
try {
  await act(async () => { view.render(React.createElement(UserManagement)); await flush(); });
  check(host.textContent.includes('작업자 이름') && host.textContent.includes('user01') && host.textContent.includes('test@example.test'), 'names, login IDs and email displayed separately');
  check(host.textContent.includes('가입') && host.textContent.includes('최근 로그인'), 'registration and last login shown');
  check(!host.querySelector('[aria-label="업체 가입 코드"]') && !calls.some(c => c[0] === 'code-read'), 'HQ never fetches or displays company code');
  check(!!button(row('user01'), '대표 관리자 지정') && !!button(row('user01'), '관리자 지정'), 'HQ can designate representative and administrator');
  check(!!button(row('owner01'), '대표 지정 해제') && !button(row('owner01'), '비활성화'), 'representative protected from ordinary account changes');
  window.confirm = () => false;
  await click(button(row('user01'), '관리자 지정'));
  check(!calls.some(c => c[0] === 'update'), 'canceling confirmation does not change permissions');
  window.confirm = () => true;
  await click(button(row('user01'), '관리자 지정'));
  check(calls.some(c => c[0] === 'update' && c[1] === 'user' && c[2].role === 'ADMIN'), 'confirmed promotion targets selected account');
  check(!!button(row('user01'), '계정 삭제') && !button(row('owner01'), '계정 삭제'), 'HQ can delete ordinary accounts but must unassign representative first');
  await click(button(row('user01'), '비밀번호 초기화'));
  check(!!host.querySelector('[role="dialog"]') && host.textContent.includes('test-temporary-only'), 'temporary password appears once after explicit reset');
  await click(button(host, '확인 · 닫기'));
  check(!host.textContent.includes('test-temporary-only'), 'closing clears temporary password');
  window.prompt=()=> 'wrong-id'; await click(button(row('user01'), '계정 삭제'));
  check(!calls.some(c=>c[0]==='remove'), 'wrong deletion confirmation never submits');
  window.prompt=()=> 'user01'; await click(button(row('user01'), '계정 삭제'));
  check(calls.some(c=>c[0]==='remove'&&c[1]==='user'&&c[2]==='user01'), 'HQ deletion confirms exact login ID');
  await as(users[0]);
  check(!host.textContent.includes('계정 삭제') && !button(row('owner01'), '비밀번호 초기화') && !!button(row('admin01'), '비밀번호 초기화'), 'representative can reset other administrators but cannot delete accounts or reset self');
  check(!!host.querySelector('[aria-label="업체 가입 코드"]') && !host.textContent.includes('대표 관리자 지정'), 'representative sees code but cannot designate another representative');
  check(!button(row('owner01'), '일반 사용자로 변경') && !!button(row('admin01'), '일반 사용자로 변경'), 'representative can change other administrators only');
  await as(users[1]);
  check(!button(row('user01'), '관리자 지정') && !button(row('admin01'), '비활성화'), 'ordinary administrator has no role assignment or self-edit controls');
  check(!!button(row('pending01'), '가입 승인') && !!button(row('user01'), '비활성화'), 'ordinary administrator can approve and manage normal users');
  await as({ ...users[1], actualRole: 'HQ_ENGINEER' });
  check(!host.querySelector('[aria-label="업체 가입 코드"]'), 'HQ role-test mode also hides company code');
  const input = host.querySelector('[aria-label="가입자 검색"]');
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'user01'); input.dispatchEvent(new window.Event('input', { bubbles: true })); await flush(); });
  check(!!row('user01') && !row('pending01'), 'search filters by login ID');
  console.log(`User management UI checks passed: ${checks}; no server/CNC calls.`);
} finally { await act(async () => view.unmount()); window.happyDOM.abort(); }
