export function dataWriteActivity(command: string, params: unknown, result: unknown) {
  if (!['WRITE_OFFSET', 'WRITE_COUNT', 'WRITE_TOOL_LIFE_PRESET'].includes(command)) return null;
  const p = (params ?? {}) as Record<string, unknown>;
  const r = (result ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const delta = n(r.additiveDelta) ?? n(p.additiveDelta);
  const before = n(r.beforeValue);
  const final = n(r.value);
  const input = delta === undefined ? `직접 입력 ${p.value}` : `${delta >= 0 ? '+' : ''}${delta}`;
  const target = command === 'WRITE_OFFSET' ? `PATH${r.path ?? p.path} / 공구 ${r.toolNo ?? p.toolNo} / ${['X', 'Y', 'Z', 'R'][Number(r.axisIdx ?? p.axisIdx)]}`
    : `${r.varType ?? p.varType ?? 'macro'} ${r.varNo ?? p.varNo}`;
  return { action: command === 'WRITE_OFFSET' ? '오프셋 수정' : command === 'WRITE_COUNT' ? '카운터 수정' : '공구수명 수정',
    detail: `${target} / ${input} → 최종 ${final ?? '확인 불가'}${before === undefined ? '' : ` (이전 ${before})`}` };
}
