// Real POP page and production board with an in-memory API. No writes to server/CNC.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(), runtime = path.join(root, 'agent-runtime/startup/count-ui-check');
const { Window } = await import(pathToFileURL(path.join(runtime, 'node_modules/happy-dom/lib/index.js')));
const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react'), { act } = React, { createRoot } = await import('react-dom/client');
const timers = new Set(), realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
globalThis.setInterval = fn => { timers.add(fn); return fn; };
globalThis.clearInterval = fn => timers.delete(fn);
const calls = [], writes = [], now = Date.now(), iso = t => new Date(t).toISOString();
const fixture = { mesEnabled: false, stats: [{ machineId: 'MC-1', machineName: '1호기', totalParts: 0, targetParts: 0 }, { machineId: 'MC-2', machineName: '2호기', totalParts: 11, targetParts: 0, estimatedParts: 3, correctedParts: -2 }],
  chart: [{ date: '09시', production: 11 }], products: [{ runKey: 'a', machineId: 'MC-2', productionName: '제품 A', programNo: 'O1000', partsCount: 10, firstAt: iso(now - 10000), lastAt: iso(now), commentSource: 'program', contextStatus: 'identified', countQuality: 'confirmed' }, { runKey: 'b', machineId: 'MC-2', productionName: '제품 A', programNo: 'O1000', partsCount: 3, firstAt: iso(now - 10000), lastAt: iso(now), commentSource: 'program', contextStatus: 'identified', countQuality: 'estimated' }, { runKey: 'c', machineId: 'MC-2', productionName: '제품 A', programNo: 'O1000', partsCount: -2, firstAt: iso(now - 10000), lastAt: iso(now), commentSource: 'program', contextStatus: 'identified', countQuality: 'correction' }], recent: [],
  latest: [{ machineCode: 'MC-2', observedAt: iso(now), state: 'running', programNo: 'O1000', count: 5, preset: 10 }, { machineCode: 'MC-1', observedAt: iso(now - 60000), state: 'running', count: 4, preset: 10 }],
  segments: [{ machineCode: 'MC-2', state: 'running', startAt: iso(now - 60000), endAt: iso(now) }], states: [{ machineCode: 'MC-2', running: 60, idle: 0, alarm_stop: 0, unknown: 0 }],
  events: [{ eventId: 'event1', machineCode: 'MC-2', observedAt: iso(now), kind: 'increment', quality: 'confirmed', quantity: 1, countBefore: 4, countAfter: 5, presetBefore: 10, presetAfter: 10 }], reviewQuantity: 2 };
let fail = false, pending;
globalThis.__popTest = { auth: { user: { role: 'USER' } }, machines: fixture.stats.map(s => ({ machineId: s.machineId, name: s.machineName })), api: {
  getStats: async (...args) => { calls.push(args); if (pending) return pending.promise; if (fail) throw new Error('시험용 연결 실패'); const data = structuredClone(fixture); if (args[1]) for (const key of ['stats', 'products', 'latest', 'states', 'segments', 'events']) data[key] = data[key].filter(r => (r.machineCode ?? r.machineId) === args[1]); return { success: true, data }; },
  correct: async body => { writes.push(body); return { success: true }; },
} };
const output = path.join(runtime, 'POP-test.mjs');
await build({ entryPoints: [path.join(root, 'packages/web/src/pages/POP.tsx')], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', plugins: [{ name: 'fake-pop-api', setup(b) {
  b.onResolve({ filter: /\/(stores\/(machineStore|authStore|featureStore)|lib\/api)$/ }, args => ({ path: args.path, namespace: 'test' }));
  b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ loader: 'js', contents: args.path.endsWith('machineStore') ? 'export const useMachineStore=s=>s({machines:globalThis.__popTest.machines});useMachineStore.getState=()=>({selectedMachineId:"MC-1"});' : args.path.endsWith('authStore') ? 'export const useAuthStore=s=>s(globalThis.__popTest.auth);' : args.path.endsWith('featureStore') ? 'export const useFeatureStore={setState:()=>{}};' : 'export const productionApi=globalThis.__popTest.api;' }));
} }] });
const { POP } = await import(pathToFileURL(output));
const host = document.createElement('div'); document.body.append(host); const view = createRoot(host);
const flush = () => new Promise(r => setImmediate(r));
let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
const click = node => act(async () => { node.click(); await flush(); });
const select = (label, value) => act(async () => { const node = host.querySelector(`[aria-label="${label}"]`); node.value = value; node.dispatchEvent(new window.Event('change', { bubbles: true })); await flush(); });
const render = () => act(async () => { view.render(React.createElement(POP)); await flush(); });
try {
  await render();
  check(calls[0][1] === undefined, 'overview starts with all machines');
  check(host.querySelector('[aria-label="생산 요약"]').textContent.includes('11'), 'headline uses cumulative production, including signed corrections');
  check(host.querySelector('[aria-label="생산 요약"]').textContent.includes('/ 2대'), 'running denominator includes all selected machines');
  check(host.querySelector('article').getAttribute('aria-label') === '2호기 생산 흐름', 'fresh connected machine appears before stale ones');
  check(host.querySelector('[aria-label="1호기 생산 흐름"]').textContent.includes('확인 불가'), 'old running observation is not displayed as live running');
  check(host.querySelector('[aria-label="제품별 생산량"]').querySelectorAll('h3').length === 1, 'product rows are grouped across count qualities');
  check(host.querySelector('[aria-label="제품별 생산량"]').textContent.includes('추정 3개 포함') && host.textContent.includes('보정 -2개 포함'), 'estimate and correction labels stay visible');
  check([...host.querySelectorAll('details')].every(n => !n.open), 'history panels start collapsed');
  check(![...host.querySelectorAll('button')].some(n => n.textContent === '실적 보정'), 'normal users cannot open correction controls');
  await click([...host.querySelectorAll('button')].find(n => n.getAttribute('aria-label')?.startsWith('2호기 가동 중')));
  check(host.querySelector('[role="status"]')?.textContent.includes('가동 중'), 'timeline segments open readable details');
  await click([...host.querySelectorAll('button')].find(n => n.textContent === '2호기'));
  check(calls.at(-1)[1] === 'MC-2' && host.querySelectorAll('article').length === 1, 'machine selection requests and displays only that machine');
  await select('집계 기간', 'week');
  check(calls.at(-1)[0] === 'week' && host.querySelector('[aria-label="생산 요약"]').textContent.includes('이번 주'), 'period filter updates labels and API query together');
  globalThis.__popTest.auth.user.role = 'ADMIN'; await render();
  await click([...host.querySelectorAll('button')].find(n => n.textContent === '실적 보정'));
  check(host.querySelector('[aria-label="보정 수량"]') && writes.length === 0, 'admin can open original correction form without submitting a write');
  fail = true;
  await act(async () => { await Promise.all([...timers].map(fn => fn())); await flush(); });
  check(host.querySelector('[role="alert"]')?.textContent.includes('마지막 조회 결과') && host.querySelectorAll('article').length === 1, 'connection failure keeps last usable snapshot and reports it');
  fail = false;
  await select('설비', '');
  check(host.querySelectorAll('article').length === 2, 'all-machine view can be restored');
  pending = {}; pending.promise = new Promise(resolve => { pending.resolve = resolve; });
  await select('집계 기간', 'month');
  check(host.querySelector('[aria-label="생산 요약"]').textContent.includes('—'), 'loading period shows placeholders, not a false zero');
  pending.resolve({ success: true, data: structuredClone(fixture) }); pending = null;
  await act(async () => { await flush(); });
  check(host.querySelectorAll('article').length === 2, 'delayed response completes the new period');
  check(writes.length === 0, 'UI checks never submitted production/CNC writes');
  console.log(`POP UI checks passed: ${checks}; no server/CNC calls.`);
} finally { await act(async () => view.unmount()); globalThis.setInterval = realSet; globalThis.clearInterval = realClear; window.happyDOM.abort(); }
