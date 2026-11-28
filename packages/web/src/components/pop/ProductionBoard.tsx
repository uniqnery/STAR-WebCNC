import { useEffect, useMemo, useState } from 'react';
import type { PopData } from '../../lib/popData';
import { compactDuration, freshPopState, popPeriodStart, popRangeName, popStateNames, popTimeline, summarizePopProducts, type PopRange, type TimelinePiece } from '../../lib/popDisplay';

const colors: Record<string, string> = { running: 'bg-emerald-500', idle: 'bg-slate-400', alarm_stop: 'bg-rose-500', unknown: 'bg-amber-400' };
const badges: Record<string, string> = { running: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300', idle: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', alarm_stop: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300', unknown: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' };
const integer = (value: number) => Math.trunc(value).toLocaleString('ko-KR');
const clock = (value: number, dates = false) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', ...(dates ? { month: 'numeric', day: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false });
const panel = 'rounded-2xl border border-slate-200 bg-white dark:border-gray-700 dark:bg-gray-800';

export function ProductionBoard({ data, range, updatedAt, onSelectMachine }: { data: PopData | null; range: PopRange; updatedAt: string; onSelectMachine: (id: string) => void }) {
  const [now, setNow] = useState(Date.now);
  const [selected, setSelected] = useState<{ machine: string; piece: TimelinePiece } | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  useEffect(() => { setSelected(null); }, [range, data?.stats.map(s => s.machineId).join(',')]);
  const products = useMemo(() => summarizePopProducts(data?.products ?? []), [data?.products]);
  const end = Date.parse(updatedAt) || now, start = popPeriodStart(range, end), span = Math.max(1, end - start);
  const latest = data?.latest ?? [], stats = data?.stats ?? [], states = data?.states ?? [];
  const priority: Record<string, number> = { alarm_stop: 0, running: 1, idle: 2, unknown: 3 };
  const orderedStats = [...stats].sort((a, b) => priority[freshPopState(latest.find(l => l.machineCode === a.machineId), now)] - priority[freshPopState(latest.find(l => l.machineCode === b.machineId), now)] || a.machineId.localeCompare(b.machineId, undefined, { numeric: true }));
  const running = stats.filter(s => freshPopState(latest.find(l => l.machineCode === s.machineId), now) === 'running').length;
  const total = stats.reduce((n, s) => n + s.totalParts, 0);
  const runSeconds = states.reduce((n, s) => n + s.running, 0);
  const alarmSeconds = states.reduce((n, s) => n + s.alarm_stop, 0);
  const estimated = stats.reduce((n, s) => n + (s.estimatedParts ?? 0), 0), corrected = stats.reduce((n, s) => n + (s.correctedParts ?? 0), 0);
  const peak = Math.max(1, ...(data?.chart.map(p => p.production) ?? []));
  return <div className="space-y-5 text-slate-900 dark:text-slate-100">
    <section aria-label="생산 요약" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="col-span-2 lg:col-span-1 relative overflow-hidden rounded-2xl bg-slate-900 dark:bg-slate-950 p-5 text-white">
        <div className="absolute -right-7 -top-9 h-36 w-36 rounded-full border-[18px] border-white/5" aria-hidden="true" />
        <p className="text-sm text-slate-300">{popRangeName[range]} 생산량</p>
        <p className="mt-3 font-semibold tracking-tight tabular-nums"><span className="text-5xl">{data ? integer(total) : '—'}</span><span className="ml-2 text-sm text-slate-400">개</span></p>
        <p className="mt-4 text-xs text-slate-400">{data ? `${products.length}개 생산 항목 · 추정·보정 포함` : '실적을 불러오는 중'}</p>
      </div>
      <Metric label="현재 가동 설비" value={data ? `${running}` : '—'} suffix={data ? `/ ${stats.length}대` : ''} detail="최근 수집 상태 기준" color="text-emerald-600 dark:text-emerald-400" />
      <Metric label="누적 가동시간" value={data ? compactDuration(runSeconds) : '—'} detail="선택 설비의 가동시간 합계" />
      <Metric label="알람 정지시간" value={data ? compactDuration(alarmSeconds) : '—'} detail="선택 기간 누적" color="text-rose-600 dark:text-rose-400" wide />
    </section>
    <section className={`${panel} overflow-hidden`} aria-label="설비별 생산 흐름">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5 border-b dark:border-gray-700">
        <div><h2 className="font-semibold text-lg">설비별 생산 흐름</h2><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{popRangeName[range]} · 한국시간 · 최근 200개 구간</p></div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">{Object.keys(colors).map(key => <span key={key} className="inline-flex items-center gap-1.5"><i className={`h-2 w-2 rounded-full ${colors[key]}`} />{popStateNames[key]}</span>)}<span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 bg-slate-200 dark:bg-gray-700" />구간 기록 없음</span></div>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-gray-700">
        {!data && <div className="p-8 text-sm text-slate-400 text-center">생산 흐름을 불러오는 중...</div>}
        {data && !stats.length && <div className="p-8 text-sm text-slate-400 text-center">등록된 설비가 없습니다.</div>}
        {orderedStats.map(machine => {
          const last = latest.find(l => l.machineCode === machine.machineId), state = freshPopState(last, now);
          const recent = [...(data?.products ?? [])].filter(p => p.machineId === machine.machineId).sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))[0];
          const duration = states.find(s => s.machineCode === machine.machineId);
          const hasCount = last?.count != null && last.preset != null && last.count >= 0 && last.preset > 0;
          const progress = hasCount ? Math.min(100, Math.max(0, last.count! / last.preset! * 100)) : null;
          const pieces = popTimeline(data?.segments, machine.machineId, start, end);
          return <article key={machine.machineId} aria-label={`${machine.machineName} 생산 흐름`} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><button onClick={() => onSelectMachine(machine.machineId)} className="text-base font-semibold text-left hover:text-blue-500">{machine.machineName}</button>
                <div className="mt-1 flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${badges[state]}`}><i className={`h-1.5 w-1.5 rounded-full ${colors[state]}`} />{popStateNames[state]}</span><span className="text-xs text-slate-400 font-mono">{last?.programNo || '프로그램 미확인'}</span></div>
              </div>
              <div className="text-right shrink-0"><div className="text-2xl font-semibold tabular-nums tracking-tight">{integer(machine.totalParts)}<span className="ml-1 text-xs font-normal text-slate-400">개</span></div><span className="text-xs text-slate-400">{popRangeName[range]} 실적</span></div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-6">
              <div className="min-w-0"><p className="text-[11px] text-slate-400">최근 생산 항목</p><p className="mt-1 font-medium truncate" title={recent?.productionName}>{recent?.productionName || '생산 실적 없음'}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs"><span className="text-slate-500 dark:text-slate-400">CNC 카운트 / 프리셋</span><span className="tabular-nums">{last?.count == null ? '—' : integer(last.count)} / {last?.preset == null ? '—' : integer(last.preset)}</span></div>
                <div className="mt-1.5 h-1 rounded-full bg-slate-100 dark:bg-gray-700 overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${progress ?? 0}%` }} /></div>
              </div>
              <div className="min-w-0">
                <div className="flex justify-between text-[10px] text-slate-400 mb-1.5"><span>{clock(start, range !== 'today')}</span><span>{clock(start + span / 2, range !== 'today')}</span><span>{clock(end, range !== 'today')}</span></div>
                <div className="relative h-9 rounded-lg overflow-hidden bg-slate-200 dark:bg-gray-700" aria-label={`${machine.machineName} 시간축`}>
                  {pieces.map((piece, i) => <button key={`${piece.start}:${i}`} aria-label={`${machine.machineName} ${piece.recorded ? popStateNames[piece.state] : '구간 기록 없음'} ${clock(piece.start, range !== 'today')}~${clock(piece.end, range !== 'today')}`}
                    title={`${piece.recorded ? popStateNames[piece.state] : '구간 기록 없음'} · ${clock(piece.start, range !== 'today')}~${clock(piece.end, range !== 'today')}`}
                    onClick={() => setSelected({ machine: machine.machineName, piece })}
                    className={`absolute inset-y-0 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 ${piece.recorded ? piece.state === 'unknown' ? 'bg-amber-400/30' : colors[piece.state] : 'bg-slate-200 dark:bg-gray-700'} hover:brightness-110`}
                    style={{ left: `${(piece.start - start) / span * 100}%`, width: `${(piece.end - piece.start) / span * 100}%`, ...(!piece.recorded ? { backgroundImage: 'repeating-linear-gradient(135deg,transparent,transparent 4px,rgba(148,163,184,.15) 4px,rgba(148,163,184,.15) 6px)' } : {}) }} />)}
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500 dark:text-slate-400"><span>가동 <b className="font-medium text-emerald-600 dark:text-emerald-400">{compactDuration(duration?.running ?? 0)}</b></span><span>대기 {compactDuration(duration?.idle ?? 0)}</span><span>알람 {compactDuration(duration?.alarm_stop ?? 0)}</span><span>미확인 {compactDuration(duration?.unknown ?? 0)}</span></p>
              </div>
            </div>
          </article>;
        })}
      </div>
      {selected && <div role="status" className="flex items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-gray-900 text-sm border-t dark:border-gray-700"><div><strong>{selected.machine}</strong> · {selected.piece.recorded ? popStateNames[selected.piece.state] : '구간 기록 없음'}<span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">{clock(selected.piece.start, true)} ~ {clock(selected.piece.end, true)} · {compactDuration((selected.piece.end - selected.piece.start) / 1000)}{!selected.piece.recorded && ' · 수집 상태를 판단하지 않는 구간입니다.'}</span></div><button onClick={() => setSelected(null)} aria-label="구간 상세 닫기" className="p-2 text-slate-400">✕</button></div>}
    </section>
    <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className={`${panel} min-w-0 p-4 sm:p-5`} aria-label="제품별 생산량">
        <h2 className="text-lg font-semibold">무엇을 만들었나요?</h2><p className="text-xs text-slate-400 mt-1">{popRangeName[range]} 제품·프로그램별 생산량</p>
        {!products.length && <p className="py-8 text-center text-sm text-slate-400">{data ? '선택 기간의 생산 실적이 없습니다.' : '생산 실적을 불러오는 중...'}</p>}
        <div className="divide-y divide-slate-100 dark:divide-gray-700">{products.map((product, index) => <div key={product.key} className="py-4">
          <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="text-xs tabular-nums text-slate-300 pt-1">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><h3 className="font-medium break-words">{product.name}</h3><p className="text-xs text-slate-400 mt-1">{product.programNo} · {product.machines.map(id => stats.find(s => s.machineId === id)?.machineName || id).join(', ')}{product.order && ` · ${product.order}`}</p></div></div><p className="text-xl font-semibold tabular-nums shrink-0">{integer(product.quantity)}<span className="ml-1 text-xs font-normal text-slate-400">개</span></p></div>
          <div className="h-1 bg-slate-100 dark:bg-gray-700 rounded-full overflow-hidden mt-3"><div className="bg-blue-500 h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, product.quantity / Math.max(1, total) * 100))}%` }} /></div>
          {(product.estimated !== 0 || product.corrected !== 0 || product.needsReview) && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{[product.estimated !== 0 && `추정 ${integer(product.estimated)}개 포함`, product.corrected !== 0 && `보정 ${integer(product.corrected)}개 포함`, product.needsReview && '작업지시 연결 확인 필요'].filter(Boolean).join(' · ')}</p>}
        </div>)}</div>
      </section>
      <section className={`${panel} min-w-0 p-4 sm:p-5`} aria-label="생산량 추이">
        <h2 className="text-lg font-semibold">생산량 추이</h2><p className="text-xs text-slate-400 mt-1">{range === 'today' ? '시간대별' : '일별'} 생산 실적</p>
        <div className="flex items-end gap-2 overflow-x-auto h-48 mt-4 pb-1">{data?.chart.map((point, index) => <div key={`${point.date}:${index}`} className="flex-1 min-w-[28px] h-full flex flex-col justify-end text-center group">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums mb-1">{point.production ? integer(point.production) : ''}</span>
          <div title={`${point.date} · ${integer(point.production)}개`} className={`mx-auto w-full max-w-7 rounded-t ${point.production ? 'bg-blue-500' : 'bg-slate-100 dark:bg-gray-700'}`} style={{ height: `${point.production > 0 ? Math.max(3, point.production / peak * 125) : 2}px` }} />
          <span className="text-[10px] text-slate-400 mt-2 whitespace-nowrap">{point.date}</span>
        </div>)}</div>
        <div className="mt-5 border-t dark:border-gray-700 pt-4 text-xs text-slate-500 dark:text-slate-400 space-y-2"><div className="flex justify-between"><span>단절 구간 추정 · 실적 포함</span><b className="font-medium">{data ? `${integer(estimated)}개` : '—'}</b></div><div className="flex justify-between"><span>수동 보정 · 실적 포함</span><b className="font-medium">{data ? `${integer(corrected)}개` : '—'}</b></div><div className="flex justify-between"><span>확인 필요 · 실적 제외</span><b className="font-medium text-amber-600">{data ? `${integer(data.reviewQuantity ?? 0)}개` : '—'}</b></div></div>
      </section>
    </div>
  </div>;
}

function Metric({ label, value, suffix, detail, color = 'text-slate-900 dark:text-white', wide = false }: { label: string; value: string; suffix?: string; detail: string; color?: string; wide?: boolean }) {
  return <div className={`${panel} p-4 sm:p-5 ${wide ? 'col-span-2 lg:col-span-1' : ''}`}><p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">{label}</p><p className={`mt-4 font-semibold tracking-tight tabular-nums ${color}`}><span className="text-2xl sm:text-3xl">{value}</span>{suffix && <span className="ml-1 text-sm font-normal text-slate-400">{suffix}</span>}</p><p className="mt-4 text-[11px] text-slate-400">{detail}</p></div>;
}
