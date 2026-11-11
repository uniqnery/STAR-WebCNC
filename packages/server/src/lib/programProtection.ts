import { v4 as uuidv4 } from 'uuid';
import { commandWaiter } from './commandWaiter';
import { mqttService } from './mqtt';

export type Program9000ProtectionState = 'protected' | 'unprotected' | 'unknown';

const cache = new Map<string, { state: Program9000ProtectionState; expiresAt: number }>();
const pending = new Map<string, Promise<Program9000ProtectionState>>();
const CACHE_MS = 5_000;

export function isProgram9000(programNo: string | number): boolean {
  const value = typeof programNo === 'number'
    ? programNo
    : Number(String(programNo).replace(/\D/g, ''));
  return Number.isInteger(value) && value >= 9000 && value <= 9999;
}

export async function getProgram9000Protection(machineId: string): Promise<Program9000ProtectionState> {
  const cached = cache.get(machineId);
  if (cached && cached.expiresAt > Date.now()) return cached.state;
  const current = pending.get(machineId);
  if (current) return current;

  const request = (async () => {
    const correlationId = `program-protection-${uuidv4()}`;
    try {
      const waiting = commandWaiter.wait(correlationId, 8_000);
      await mqttService.sendCommand(machineId, 'GET_PROGRAM_PROTECTION', correlationId);
      const response = await waiting;
      const result = response.result as { program9000Protection?: Program9000ProtectionState } | undefined;
      const state = response.status === 'success' && result?.program9000Protection
        ? result.program9000Protection
        : 'unknown';
      cache.set(machineId, { state, expiresAt: Date.now() + CACHE_MS });
      return state;
    } catch {
      cache.set(machineId, { state: 'unknown', expiresAt: Date.now() + CACHE_MS });
      return 'unknown';
    } finally {
      pending.delete(machineId);
    }
  })();
  pending.set(machineId, request);
  return request;
}

export async function isProgram9000OperationBlocked(machineId: string, programNo: string | number): Promise<boolean> {
  if (!isProgram9000(programNo)) return false;
  return (await getProgram9000Protection(machineId)) !== 'unprotected';
}
