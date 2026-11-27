import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { UserRole } from '@prisma/client';

// These tests use the real routes and JWT middleware, with no CNC, Docker or DB writes.
const dependencies = vi.hoisted(() => ({
  machineFind: vi.fn(), machineList: vi.fn(), machineCount: vi.fn(),
  templateFind: vi.fn(), templateList: vi.fn(), templateUpdateMany: vi.fn(), templateAfter: vi.fn(),
  lock: vi.fn(), sendCommand: vi.fn(), publish: vi.fn(), setStartup: vi.fn(),
  commandCreate: vi.fn(), auditCreate: vi.fn(), wait: vi.fn(),
  machineTemplate: vi.fn(), templateLookup: vi.fn(), pmcGet: vi.fn(),
  productionPolicy: vi.fn(),
}));
vi.mock('../src/lib/prisma', () => ({ prisma: {
  machine: { findFirst: dependencies.machineFind, findMany: dependencies.machineList, count: dependencies.machineCount, findUnique: dependencies.machineTemplate },
  template: { findFirst: dependencies.templateFind, findMany: dependencies.templateList, findUnique: dependencies.templateLookup, updateMany: dependencies.templateUpdateMany, findUniqueOrThrow: dependencies.templateAfter },
  commandLog: { create: dependencies.commandCreate }, auditLog: { create: dependencies.auditCreate },
  productionPolicy: { findFirst: dependencies.productionPolicy },
  $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
} }));
vi.mock('../src/lib/redis', () => ({ redisService: { getControlLock: dependencies.lock, get: dependencies.pmcGet }, REDIS_KEYS: {} }));
vi.mock('../src/lib/mqtt', () => ({ mqttService: { sendCommand: dependencies.sendCommand, publish: dependencies.publish }, TOPICS: { COMMAND_TO: (id: string) => `test/${id}` } }));
vi.mock('../src/lib/websocket', () => ({ wsService: { broadcast: vi.fn() } }));
vi.mock('../src/lib/commandWaiter', () => ({ commandWaiter: { wait: dependencies.wait } }));
vi.mock('../src/lib/templateSync', () => ({ exportTemplateToFile: vi.fn() }));
vi.mock('../src/lib/windowsStartup', () => ({
  getWindowsStartup: vi.fn(async () => ({ supported: true, enabled: false, serverName: 'test' })),
  setWindowsStartup: dependencies.setStartup,
  WindowsStartupError: class extends Error {},
}));

import machines from '../src/routes/machines';
import templates from '../src/routes/templates';
import settings from '../src/routes/settings';
import commands from '../src/routes/commands';
import production from '../src/routes/production';
import { generateAccessToken } from '../src/auth/jwt';

let server: Server;
let base: string;
type Endpoint = [method: string, path: string, accepted: number];
const hqOnly: Endpoint[] = [
  ['GET', '/api/machines/next-id', 200],
  ['POST', '/api/machines', 400],
  ['PUT', '/api/machines/missing', 404],
  ['DELETE', '/api/machines/missing', 404],
  ['POST', '/api/templates', 400],
  ['PUT', '/api/templates/missing', 404],
  ['DELETE', '/api/templates/missing', 404],
  ['POST', '/api/templates/missing/reload', 404],
];
const control: Endpoint[] = [
  ['POST', '/api/machines/missing/control/acquire', 404],
  ['POST', '/api/machines/missing/control/extend', 404],
  ['PUT', '/api/machines/missing/offsets', 404],
  ['PUT', '/api/machines/missing/count', 404],
  ['PUT', '/api/machines/missing/tool-life', 404],
];

async function request(method: string, path: string, role?: UserRole, body: object = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (role) headers.Authorization = `Bearer ${generateAccessToken({ userId: 'test-user', username: 'tester', role })}`;
  return fetch(base + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/machines', machines);
  app.use('/api/templates', templates);
  app.use('/api/settings', settings);
  app.use('/api/commands', commands);
  app.use('/api/production', production);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
  vi.clearAllMocks();
  dependencies.machineFind.mockResolvedValue(null);
  dependencies.templateFind.mockResolvedValue(null);
  dependencies.publish.mockResolvedValue(undefined);
  dependencies.machineList.mockResolvedValue([]);
  dependencies.machineCount.mockResolvedValue(0);
  dependencies.templateList.mockResolvedValue([]);
  dependencies.lock.mockResolvedValue({ ownerId: 'test-user' });
  dependencies.commandCreate.mockResolvedValue({});
  dependencies.auditCreate.mockResolvedValue({});
  dependencies.wait.mockResolvedValue({ status: 'success', result: { beforeValue: .1, value: .12 } });
  dependencies.machineTemplate.mockResolvedValue({ template: { topBarInterlock: { remote: { interlockEnabled: true, fields: [{ enabled: true, pmcAddr: 'X0.1', contact: 'A' }] } } } });
  dependencies.templateLookup.mockResolvedValue({ panelLayout: [] });
  dependencies.pmcGet.mockResolvedValue({ receivedAt: Date.now(), pmcBits: { 'X0.1': 0 }, signature: '1|X0.1:A' });
  dependencies.productionPolicy.mockResolvedValue(null);
  dependencies.setStartup.mockImplementation(async (enabled: boolean) => ({ supported: true, enabled, serverName: 'test' }));
});

describe.each([UserRole.USER, UserRole.ADMIN, UserRole.HQ_ENGINEER])('%s permissions', role => {
  it('allows batched daily run-rate reads without sending CNC commands', async () => {
    const response = await request('GET', '/api/machines/daily-run-rates', role);
    expect(response.status).toBe(200);
    expect((await response.json()).data.items).toEqual([]);
    expect(dependencies.sendCommand).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, 2147483648])('rejects invalid count quantity %s before any CNC command', async value => {
    dependencies.machineFind.mockResolvedValue({ id: 'db-test', machineId: 'MC-TEST' });
    const response = await request('PUT', '/api/machines/MC-TEST/count', role, { varNo: 10000, key: 'preset', varType: 'pcode', value });
    expect(response.status).toBe(role === 'USER' ? 403 : 400);
    expect(dependencies.sendCommand).not.toHaveBeenCalled();
  });
  it('allows only ADMIN/HQ to submit production corrections', async () => {
    const response = await request('POST', '/api/production/corrections', role, {});
    expect(response.status).toBe(role === 'USER' ? 403 : 400);
    expect(dependencies.sendCommand).not.toHaveBeenCalled();
  });
  it('restricts MES activation to HQ and exposes standalone mode to all users', async () => {
    const settings = await request('GET', '/api/production/features', role);
    expect(settings.status).toBe(200); expect((await settings.json()).data.mesEnabled).toBe(false);
    const changed = await request('PUT', '/api/production/features', role, {});
    expect(changed.status).toBe(role === 'HQ_ENGINEER' ? 400 : 403);
    const assignment = await request('PUT', '/api/production/assignments/MC-TEST', role, { workOrderId: null });
    expect(assignment.status).toBe(403);
    expect(dependencies.auditCreate).not.toHaveBeenCalled();
  });
  it('blocks acquisition and PMC output when the interlock fails, including an existing owner', async () => {
    dependencies.machineFind.mockResolvedValue({ id: 'db-test', machineId: 'MC-TEST', templateId: 'template-test' });
    const acquire = await request('POST', '/api/machines/MC-TEST/control/acquire', role, { sessionId: 'test' });
    expect(acquire.status).toBe(role === UserRole.USER ? 403 : 409);
    const output = await request('POST', '/api/commands/MC-TEST', role, { command: 'PMC_WRITE', params: { address: 'R1.0', value: 1 } });
    expect(output.status).toBe(role === UserRole.USER ? 403 : 409);
    expect(dependencies.sendCommand).not.toHaveBeenCalled();
    expect(dependencies.commandCreate).not.toHaveBeenCalled();
  });
  it.each(hqOnly)('%s %s requires HQ', async (method, path, accepted) => {
    const response = await request(method, path, role);
    expect(response.status).toBe(role === UserRole.HQ_ENGINEER ? accepted : 403);
    if (role !== UserRole.HQ_ENGINEER) {
      expect((await response.json()).error.code).toBe('FORBIDDEN');
      expect(dependencies.machineFind).not.toHaveBeenCalled();
      expect(dependencies.machineList).not.toHaveBeenCalled();
      expect(dependencies.templateFind).not.toHaveBeenCalled();
    }
  });
  it.each(control)('%s %s blocks USER even with an existing lock', async (method, path, accepted) => {
    const response = await request(method, path, role, { sessionId: 'test-session' });
    expect(response.status).toBe(role === UserRole.USER ? 403 : accepted);
    if (role === UserRole.USER) {
      expect((await response.json()).error.code).toBe('FORBIDDEN');
      expect(dependencies.machineFind).not.toHaveBeenCalled();
      expect(dependencies.lock).not.toHaveBeenCalled();
      expect(dependencies.sendCommand).not.toHaveBeenCalled();
    }
  });
  it.each([true, false])('startup setting %s allows ADMIN and HQ', async enabled => {
    const response = await request('PUT', '/api/settings/windows-startup', role, { enabled });
    expect(response.status).toBe(role === UserRole.USER ? 403 : 200);
    if (role === UserRole.USER) expect(dependencies.setStartup).not.toHaveBeenCalled();
    else {
      expect(dependencies.setStartup).toHaveBeenCalledWith(enabled);
      expect((await response.json()).data.enabled).toBe(enabled);
    }
  });
  it('keeps machine and template reads available', async () => {
    expect((await request('GET', '/api/machines', role)).status).toBe(200);
    expect((await request('GET', '/api/templates', role)).status).toBe(200);
  });
  it.each(['offsets', 'count', 'tool-life'])('audits %s writes without a control lock', async endpoint => {
    dependencies.machineFind.mockResolvedValue({ id: 'db-test', machineId: 'MC-TEST' });
    const body = endpoint === 'offsets' ? { path: 1, no: 3, axis: 'X', value: .12, additiveDelta: .02 } : { varNo: 10001, value: 20, key: 'count', varType: 'pcode' };
    const response = await request('PUT', `/api/machines/MC-TEST/${endpoint}`, role, body);
    expect(response.status).toBe(role === UserRole.USER ? 403 : 200);
    expect(dependencies.lock).not.toHaveBeenCalled();
    if (role !== UserRole.USER) {
      expect(dependencies.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'test-user', userRole: role, result: 'pending' }) }));
      expect(dependencies.sendCommand).toHaveBeenCalledOnce();
      if (endpoint === 'offsets') expect(dependencies.sendCommand.mock.calls[0][3]).toHaveProperty('additiveDelta', .02);
    } else expect(dependencies.sendCommand).not.toHaveBeenCalled();
  });
});

it.each([...hqOnly, ...control])('rejects unauthenticated %s %s', async (method, path) => {
  expect((await request(method, path)).status).toBe(401);
});
it('rejects unauthenticated startup changes', async () => {
  expect((await request('PUT', '/api/settings/windows-startup', undefined, { enabled: true })).status).toBe(401);
  expect(dependencies.setStartup).not.toHaveBeenCalled();
});

it('reports applied and pending machines separately after a partial template reload', async () => {
  dependencies.templateFind.mockResolvedValue({ templateId: 'tool-template', machines: [{ machineId: 'MC-2' }, { machineId: 'MC-3' }] });
  dependencies.wait.mockResolvedValueOnce({ status: 'success', result: { templateId: 'tool-template' } }).mockRejectedValueOnce(new Error('timeout'));
  const response = await request('POST', '/api/templates/tool-template/reload', 'HQ_ENGINEER');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, data: { notifiedMachines: ['MC-2'], pendingMachines: ['MC-3'], totalMachines: 2 } });
});

it('does not confirm a reload with a mismatched template acknowledgement', async () => {
  dependencies.templateFind.mockResolvedValue({ templateId: 'tool-template', machines: [{ machineId: 'MC-2' }] });
  dependencies.wait.mockResolvedValue({ status: 'success', result: { templateId: 'old-template' } });
  const response = await request('POST', '/api/templates/tool-template/reload', 'HQ_ENGINEER');
  expect(await response.json()).toMatchObject({ success: true, data: { notifiedMachines: [], pendingMachines: ['MC-2'] } });
});

it('preserves path and P-code type in tool-life writes and their audit intent', async () => {
  dependencies.machineFind.mockResolvedValue({ id: 'db-test', machineId: 'MC-TEST' });
  const response = await request('PUT', '/api/machines/MC-TEST/tool-life', 'ADMIN', { path: 2, varType: 'pcode', varNo: 14040, value: 200 });
  expect(response.status).toBe(200);
  expect(dependencies.sendCommand.mock.calls[0][3]).toMatchObject({ path: 2, varType: 'pcode', varNo: 14040, value: 200 });
  expect(dependencies.auditCreate.mock.calls[0][0].data.params.params).toMatchObject({ path: 2, varType: 'pcode', varNo: 14040, value: 200 });
});

it('rejects unsupported tool-life paths before sending a write', async () => {
  dependencies.machineFind.mockResolvedValue({ id: 'db-test', machineId: 'MC-TEST' });
  expect((await request('PUT', '/api/machines/MC-TEST/tool-life', 'ADMIN', { path: 3, varType: 'pcode', varNo: 14040, value: 200 })).status).toBe(400);
  expect(dependencies.sendCommand).not.toHaveBeenCalled();
});

it('requires an editing version before writing a template', async () => {
  dependencies.templateFind.mockResolvedValue({ id: 'template-id', updatedAt: new Date('2026-11-27T00:00:00Z') });
  const response = await request('PUT','/api/templates/template-id','HQ_ENGINEER',{name:'changed'});
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe('TEMPLATE_VERSION_REQUIRED');
  expect(dependencies.templateUpdateMany).not.toHaveBeenCalled();
});

it('atomically rejects a stale editor and keeps the newest tool-life configuration', async () => {
  const latest = {id:'template-id',updatedAt:new Date('2026-11-27T00:00:01Z'),toolLifeConfig:{value:'new'}};
  dependencies.templateFind.mockResolvedValue(latest);
  dependencies.templateUpdateMany.mockResolvedValue({count:0});
  const response = await request('PUT','/api/templates/template-id','HQ_ENGINEER',{updatedAt:'2026-11-27T00:00:00Z',toolLifeConfig:{value:'old'}});
  expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('TEMPLATE_CONFLICT');
  expect(latest.toolLifeConfig).toEqual({value:'new'});
  expect(dependencies.templateAfter).not.toHaveBeenCalled();
});

it('allows only one of two concurrent editors with the same base version to save', async () => {
  let current = {id:'template-id',name:'before',updatedAt:new Date('2026-11-27T00:00:00Z')};
  dependencies.templateFind.mockImplementation(async()=>current);
  dependencies.templateUpdateMany.mockImplementation(async ({where,data})=>{
    if(where.updatedAt.getTime()!==current.updatedAt.getTime()) return {count:0};
    current={...current,...data};return {count:1};
  });
  dependencies.templateAfter.mockImplementation(async()=>current);
  const responses = await Promise.all(['first','second'].map(name=>request('PUT','/api/templates/template-id','HQ_ENGINEER',{name,expectedUpdatedAt:'2026-11-27T00:00:00Z'})));
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  expect(dependencies.templateAfter).toHaveBeenCalledTimes(1);
  expect(['first','second']).toContain(current.name);
});
