// Counter edits stay local until the user explicitly presses Save.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import type { CounterField } from '../../stores/templateStore';
import { ncDataApi } from '../../lib/api';
import { counterInteger, formatCounter, parseCounterInput, formatCountDuration, remainingCountSeconds, formatExpectedFinish } from '../../lib/countDisplay';

interface CountViewProps { machineId?: string }
type ReadField = CounterField & { value: number | null };
const quantityKeys = ['preset', 'count', 'total'];
export function CountView({ machineId }: CountViewProps) {
  return <MachineCountView key={machineId} machineId={machineId} />;
}
function MachineCountView({ machineId }: CountViewProps) {
  const role = useAuthStore(s => s.user?.role);
  const canWrite = role === 'ADMIN' || role === 'HQ_ENGINEER';
  const [fields, setFields] = useState<ReadField[]>([]);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [notice, setNotice] = useState('');
  const [edit, setEdit] = useState<{ field: ReadField; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [cycle, setCycle] = useState<number | null>(null);
  const [presetGuardReady, setPresetGuardReady] = useState(false);
  const [lastReadAt, setLastReadAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true), busy = useRef(false), writing = useRef(false), generation = useRef(0);

  const load = useCallback(async () => {
    if (!machineId || busy.current || writing.current) return;
    busy.current = true;
    const version = generation.current;
    try {
      const response = await ncDataApi.readCount(machineId);
      if (!mounted.current || version !== generation.current || writing.current) return;
      if (!response.success || !response.data || !Array.isArray(response.data.fields)) throw new Error(response.error?.message ?? '카운터 조회 실패');
      const returned = response.data.fields;
      if (returned.some(f => !f || !['macro', 'pcode'].includes(f.varType) || (f.value !== null && !Number.isFinite(f.value)))) throw new Error('카운터 설정 또는 수신값을 확인하세요.');
      setFields(returned.filter(f => f.key !== 'remaining'));
      setCycle(typeof response.data.cycleTimeSeconds === 'number' && Number.isFinite(response.data.cycleTimeSeconds) ? response.data.cycleTimeSeconds : null);
      setPresetGuardReady(response.data.presetMinGap === 2);
      setLastReadAt(Date.now());
      setReadError('');
    } catch (e) {
      if (mounted.current && version === generation.current) setReadError(e instanceof Error ? e.message : '카운터 조회 실패');
    } finally {
      busy.current = false;
    }
  }, [machineId]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const polling = setInterval(() => { void load(); }, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    // StrictMode replays this effect on the same instance. Keep its first read
    // valid; real machine changes remount the keyed panel, and writes alone
    // advance generation to reject pre-write responses.
    return () => { mounted.current = false; clearInterval(polling); clearInterval(clock); };
  }, [load]);
  useEffect(() => { if (!canWrite) { setEdit(null); setNotice(''); } }, [canWrite]);

  const currentCount = fields.find(f => f.key === 'count')?.value;
  const displayFields = quantityKeys.map((key): ReadField => fields.find(f => f.key === key) ?? {
    key, label: key.toUpperCase(), varType: 'macro', varNo: 0, readonly: true, value: null,
  }).concat(fields.filter(f => !quantityKeys.includes(f.key)));
  const preset = fields.find(f => f.key === 'preset')?.value;
  const fresh = lastReadAt > 0 && now - lastReadAt < 15000;
  const remaining = fresh ? remainingCountSeconds(preset, currentCount, cycle) : null;
  const minimum = typeof currentCount === 'number' ? counterInteger(currentCount) + 2 : null;
  const parsed = edit ? parseCounterInput(edit.draft) : null;
  const presetBlocked = edit?.field.key === 'preset' && (!presetGuardReady || minimum === null || !fresh || parsed === null || parsed < minimum);

  const save = async () => {
    if (!edit || !machineId || !canWrite || edit.field.readonly || writing.current) return;
    const target = parseCounterInput(edit.draft);
    if (edit.field.key === 'preset' && !presetGuardReady) { setError('프리셋 저장 조건을 검사할 에이전트 업데이트가 필요합니다.'); return; }
    if (target === null) { setError('수량은 허용 범위의 0 이상 정수로 입력하세요.'); return; }
    if (edit.field.key === 'preset' && (minimum === null || !fresh || target < minimum)) { setError(minimum === null || !fresh ? '현재 카운트를 다시 조회하세요.' : `프리셋은 현재 카운트보다 최소 2 이상인 ${minimum} 이상이어야 합니다.`); return; }
    const live = fields.find(f => f.key === edit.field.key);
    if (!live || live.readonly || live.varNo !== edit.field.varNo || live.varType !== edit.field.varType) { setError('변수 설정이 변경됐습니다. 취소 후 다시 선택하세요.'); return; }
    if (target === counterInteger(live.value ?? NaN)) { setEdit(null); setNotice('변경된 값이 없습니다.'); return; }
    const pending = edit;
    writing.current = true; generation.current++; setSaving(true); setError(''); setNotice('');
    try {
      const response = await ncDataApi.writeCountVar(machineId, pending.field, target);
      if (!mounted.current) return;
      if (!response.success) throw new Error(response.error?.message ?? '카운터 저장 실패');
      const final = (response.data as { value?: number } | undefined)?.value;
      if (typeof final !== 'number' || !Number.isFinite(final)) throw new Error('최종 반영값 확인 불가. 재조회하세요. 자동 재전송하지 마세요.');
      setFields(previous => previous.map(f => f.key === pending.field.key ? { ...f, value: final } : f));
      setEdit(null); setNotice(`${pending.field.label} ${formatCounter(final)} 저장 완료`);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '카운터 저장 실패'); }
    finally {
      writing.current = false; generation.current++;
      if (mounted.current) { setSaving(false); void load(); }
    }
  };
  if (!machineId) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">장비를 선택하면 카운트 데이터가 표시됩니다</div>;
  return <div className="flex flex-col h-full font-mono text-xs overflow-y-auto">
    <div className="flex items-center justify-between gap-2 px-2 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
      <span className="text-cyan-300 text-[10px] font-semibold tracking-widest">COUNTER VARS</span>
    </div>
    {error && <p role="alert" className="px-3 py-2 text-red-400">{error}</p>}
    {readError && <p role="alert" className="px-3 py-2 text-red-400">{readError}</p>}
    {notice && <p role="status" className="px-3 py-2 text-cyan-300">{notice}</p>}
    <div className="p-2 space-y-2">
      {displayFields.map(field => <div key={field.key} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-800 rounded">
        <div className="flex items-center gap-2"><span className="text-gray-300">{field.label}</span></div>
        {edit?.field.key === field.key ? <div className="w-full space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label={`${field.label} 입력값`} type="number" inputMode="numeric" step="1" min={field.key === 'preset' ? minimum ?? 0 : 0} max="2147483647" autoFocus disabled={saving} value={edit.draft}
              onChange={e => { setEdit({ ...edit, draft: e.target.value }); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); if (e.key === 'Escape' && !saving) { setEdit(null); setError(''); } }}
              className="w-32 min-h-10 bg-gray-700 border border-blue-500 text-white text-right text-base px-2 rounded outline-none" />
            <button type="button" disabled={saving || parsed === null || Boolean(presetBlocked)} onClick={() => void save()} className="min-h-10 px-4 rounded bg-blue-600 text-white disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
            <button type="button" disabled={saving} onClick={() => { setEdit(null); setError(''); }} className="min-h-10 px-4 rounded border border-gray-500 text-gray-200 disabled:opacity-40">취소</button>
          </div>
          {field.key === 'preset' && <p className={presetBlocked ? 'text-amber-400' : 'text-gray-400'}>{!presetGuardReady ? '에이전트의 프리셋 저장 조건 지원을 확인해야 합니다.' : minimum === null || !fresh ? '현재 카운트 확인이 필요합니다.' : `현재 카운트 ${formatCounter(currentCount)} · 최소 프리셋 ${minimum} (카운트 + 2)`}</p>}
        </div> : <button type="button" aria-label={`${field.label} 수정`} disabled={!canWrite || field.readonly || field.value === null || Boolean(edit) || saving} onClick={() => { setEdit({ field, draft: quantityKeys.includes(field.key) ? formatCounter(field.value) : String(field.value) }); setError(''); setNotice(''); }} className="min-h-10 text-white text-base font-bold px-2 disabled:cursor-default enabled:border-b enabled:border-dashed enabled:border-blue-500">
          {quantityKeys.includes(field.key) ? formatCounter(field.value) : field.value ?? '—'}{field.unit && <span className="ml-1 text-xs text-gray-400">{field.unit}</span>}
        </button>}
      </div>)}
      <div className="border-t border-gray-700 pt-3 space-y-3 text-sm">
        {[['사이클 타임', !lastReadAt ? '—' : fresh && cycle !== null ? formatCountDuration(cycle) : '계산 불가'], ['잔여 시간', !lastReadAt ? '—' : formatCountDuration(remaining)], ['예상 종료 시각', !lastReadAt ? '—' : formatExpectedFinish(now, remaining)]].map(([label,value]) => <div key={label} className="flex flex-wrap justify-between gap-2 px-2"><span className="text-gray-400">{label}</span><span className="text-white">{value}</span></div>)}
      </div>
    </div>
  </div>;
}
