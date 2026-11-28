// Real transfer store and panel, with API responses supplied in memory. No CNC access.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const runtime = path.join(root, 'agent-runtime/startup/count-ui-check');
const { Window } = await import(pathToFileURL(path.join(runtime, 'node_modules/happy-dom/lib/index.js')));
const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Event']) {
  Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
let request;
let historyResponse = { success: true, data: { items: [] } };
globalThis.__transferApi = {
  transfer: () => request.promise,
  getFileHistory: () => historyResponse.promise ?? Promise.resolve(historyResponse),
};
const output = path.join(runtime, 'Transfer-history-test.mjs');
await build({
  stdin: { contents: `export {useFileStore} from './packages/web/src/stores/fileStore'; export {TransferQueuePanel} from './packages/web/src/components/filemanager/TransferQueuePanel';`, resolveDir: root, loader: 'ts' },
  outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  plugins: [{ name: 'fake-file-api', setup(b) {
    b.onResolve({ filter: /\/lib\/api$/ }, () => ({ path: 'api', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const fileApi = globalThis.__transferApi;', loader: 'js' }));
  } }],
});
const { useFileStore, TransferQueuePanel } = await import(pathToFileURL(output));
const host = document.createElement('div');
document.body.append(host);
const view = createRoot(host);
const flush = () => new Promise((r) => setImmediate(r));
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const item = { id: 'history-1', machineId: 'MC-TEST', operationType: 'TRANSFER_PC_TO_CNC', target: 'CNC_LOCAL', fileName: 'O0001.nc', status: 'PENDING', userName: '테스트', startedAt: new Date().toISOString() };
try {
  await act(async () => { view.render(React.createElement(TransferQueuePanel, { machineId: 'MC-TEST' })); await flush(); });
  for (const terminal of ['DONE', 'ERROR']) {
    request = deferred();
    await act(async () => { useFileStore.getState().startTransfer('PC_TO_CNC', ['O0001.nc'], 'MC-TEST', '테스트'); });
    const job = useFileStore.getState().transferQueue.at(-1);
    check(host.textContent.includes('진행 중'), 'active transfer is shown');
    await act(async () => { useFileStore.setState((s) => ({ transferQueue: s.transferQueue.map((j) => j.id === job.id ? { ...j, status: terminal, progress: 100 } : j) })); });
    check(!host.textContent.includes('진행 중') && !host.textContent.includes('100%'), `${terminal} removed from active progress`);
    await act(async () => { request.resolve({ success: true }); await flush(); });
    check(useFileStore.getState().transferQueue.find((j) => j.id === job.id).status === terminal, `late HTTP response preserves ${terminal}`);
  }
  historyResponse = deferred();
  let loading;
  await act(async () => {
    loading = useFileStore.getState().loadFileHistory('MC-TEST');
    useFileStore.getState().upsertFileHistory({ ...item, status: 'SUCCESS' });
  });
  check(host.textContent.includes('완료'), 'completion history appears without refresh');
  await act(async () => { historyResponse.resolve({ success: true, data: { items: [item] } }); await loading; });
  check(useFileStore.getState().fileHistory[0].status === 'SUCCESS', 'stale HTTP history cannot undo completion');
  await act(async () => { useFileStore.getState().upsertFileHistory(item); });
  check(host.textContent.includes('완료') && !host.textContent.includes('진행 중'), 'late pending event cannot undo completion');
  await act(async () => { useFileStore.getState().upsertFileHistory({ ...item, id: 'history-fail', status: 'FAILURE', errorMessage: '테스트 오류' }); });
  check(host.textContent.includes('실패'), 'failure history remains visible');
  console.log(`Transfer history UI checks passed: ${checks}; no network/CNC calls.`);
} finally {
  await act(async () => view.unmount());
  window.happyDOM.abort();
}
