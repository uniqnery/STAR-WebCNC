const pending = new Map<string, Promise<unknown>>();
export async function serialDataWrite<T>(machineId: string, operation: () => Promise<T>): Promise<T> {
  const work = (pending.get(machineId) ?? Promise.resolve()).catch(() => undefined).then(operation);
  pending.set(machineId, work);
  try { return await work; }
  finally { if (pending.get(machineId) === work) pending.delete(machineId); }
}
