import { useEffect, useState } from 'react';
import { useMachineStore } from '../stores/machineStore';
import { useAuthStore } from '../stores/authStore';
import { useFeatureStore } from '../stores/featureStore';
import { productionApi } from '../lib/api';
import { parsePopData, type PopData, type CounterHistory } from '../lib/popData';

type TimeRange = 'today' | 'week' | 'month';
const sources: Record<string, string> = { mes: 'MES 작업지시', scheduler: '스케줄러', program: '프로그램 코멘트', unassigned: '미지정', legacy: '과거 이력' };
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
const quality: Record<string, string> = { confirmed: '자동 집계', estimated: '단절 구간 추정', review: '확인 필요', correction: '수동 보정', none: '변경 기록' };
const kinds: Record<string, string> = { message_changed: '메시지 변경', baseline: '수집 기준 설정', increment: '카운트 증가', reset: '0 초기화', decrease: '카운트 감소', source_changed: '카운터 설정 변경', context_changed: '생산 항목 전환', preset_changed: '프리셋 변경', manual_adjustment: '웹앱 값 수정', count_unavailable: '카운터 확인 불가', state_changed: '상태 변경', correction: '수량 보정' };
const stateNames: Record<string, string> = { running: '가동', idle: '대기', alarm_stop: '알람 정지', unknown: '확인 불가' };
const duration = (seconds: number) => `${Math.floor(seconds / 3600)}시간 ${Math.floor(seconds % 3600 / 60)}분 ${Math.floor(seconds % 60)}초`;

export function POP() {
  const machines = useMachineStore(s => s.machines);
  const [machineId, setMachineId] = useState(useMachineStore.getState().selectedMachineId ?? '');
  const [range, setRange] = useState<TimeRange>('today');
  const [data, setData] = useState<PopData | null>(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [correction, setCorrection] = useState<CounterHistory | null>(null);
  const user = useAuthStore(s => s.user);
  useEffect(() => {
    let active = true, busy = false;
    setData(null); setError(''); setUpdatedAt('');
    const load = async () => {
      if (busy) return; busy = true;
      try {
        const response = await productionApi.getStats(range, machineId || undefined);
        if (!response.success) throw new Error(response.error?.message ?? '생산 실적 조회 실패');
        const value = parsePopData(response.data);
        if (active) {
          setData(value); setUpdatedAt(new Date().toISOString()); setError('');
          useFeatureStore.setState({ mesEnabled: value.mesEnabled, loaded: true });
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '조회 실패'); }
      finally { busy = false; }
    };
    void load(); const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [machineId, range, refresh]);
  const count = data?.stats.reduce((n, s) => n + s.totalParts, 0);
  return <div className="p-4 lg:p-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold dark:text-white">생산 실적 (POP)</h1><p className="text-sm text-gray-500">카운터 증가량 기준 · 5초 자동 갱신 · 한국시간</p></div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="설비" value={machineId} onChange={e => setMachineId(e.target.value)} className="border rounded p-2 dark:bg-gray-800 dark:text-white"><option value="">전체 설비</option>{machines.map(m => <option key={m.machineId} value={m.machineId}>{m.name}</option>)}</select>
        <select aria-label="집계 기간" value={range} onChange={e => setRange(e.target.value as TimeRange)} className="border rounded p-2 dark:bg-gray-800 dark:text-white"><option value="today">오늘</option><option value="week">이번 주</option><option value="month">이번 달</option></select>
        <button onClick={() => setRefresh(n => n + 1)} className="border rounded p-2 dark:text-white">새로고침</button>
      </div>
    </div>
    {error && <p role="alert" className="text-red-500">{error}{data ? ' · 마지막 조회 결과를 표시합니다.' : ''}</p>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[['집계 수량 (추정·보정 포함)', count === undefined ? '—' : `${count.toLocaleString()}개`], ['단절 구간 추정', data ? `${data.stats.reduce((n,s) => n + (s.estimatedParts ?? 0),0)}개` : '—'], ['확인 필요 (집계 제외)', data ? `${data.reviewQuantity ?? 0}개` : '—'], ['수동 보정', data ? `${data.stats.reduce((n,s) => n + (s.correctedParts ?? 0),0)}개` : '—']].map(([label, value]) => <div key={label} className="p-4 rounded shadow bg-white dark:bg-gray-800"><div className="text-sm text-gray-500">{label}</div><div className="text-xl font-semibold mt-2 dark:text-white">{value}</div></div>)}
    </div>
    <p className="text-xs text-gray-500">프리셋·카운터 초기화는 기존 생산 실적을 지우지 않습니다. 추정·보정 수량은 작업지시에 자동 반영하지 않습니다. 양품·불량 및 OEE는 아직 계산하지 않습니다. 적용 전 생산량을 소급 생성하지 않습니다.{updatedAt && ` 마지막 확인: ${time(updatedAt)}`}</p>
    <section className="bg-white dark:bg-gray-800 rounded shadow p-4 space-y-3">
      <h2 className="font-semibold dark:text-white">최근 카운터 및 상태별 시간</h2>
      <p className="text-xs text-gray-500">상단 표시와 동일한 가동·알람 정보 사용 · 초록 우선 · 수집 중단 시간은 확인 불가</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm dark:text-gray-200"><thead><tr>{['설비', '프로그램 / 프리셋 / 카운트', '최근 상태', '가동', '대기', '알람 정지', '확인 불가'].map(x=><th key={x} className="p-2 text-left">{x}</th>)}</tr></thead><tbody>{(data?.states ?? []).map(s=>{ const latest=data?.latest?.find(l=>l.machineCode===s.machineCode); return <tr key={s.machineCode} className="border-t dark:border-gray-700"><td className="p-2">{s.machineCode}</td><td className="p-2">{latest?.programNo ?? '—'} / {latest?.preset ?? '—'} / {latest?.count ?? '—'}{latest && <p className="text-xs text-gray-500">{time(latest.observedAt)}</p>}</td><td className="p-2">{stateNames[latest?.state ?? 'unknown']}</td>{[s.running,s.idle,s.alarm_stop,s.unknown].map((v,i)=><td key={i} className="p-2 whitespace-nowrap">{duration(v)}</td>)}</tr>})}</tbody></table></div>
    </section>
    <section className="bg-white dark:bg-gray-800 rounded shadow p-4">
      <h2 className="font-semibold mb-3 dark:text-white">가동 상태 구간 (최근 200건)</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-sm dark:text-gray-200"><thead><tr>{['설비','상태','시작','종료 / 최근 확인'].map(x=><th key={x} className="p-2 text-left">{x}</th>)}</tr></thead><tbody>{(data?.segments ?? []).map((s,i)=><tr key={`${s.machineCode}:${s.startAt}:${i}`} className="border-t dark:border-gray-700"><td className="p-2">{s.machineCode}</td><td className="p-2">{stateNames[s.state] ?? s.state}</td><td className="p-2">{time(s.startAt)}</td><td className="p-2">{time(s.endAt)}</td></tr>)}</tbody></table></div>
    </section>
    {data?.mesEnabled && machineId && <OrderAssignment machineId={machineId} />}
    <section className="bg-white dark:bg-gray-800 rounded shadow p-4">
      <h2 className="font-semibold dark:text-white mb-3">생산량 추이</h2>
      <div className="flex items-end gap-2 overflow-x-auto h-36">
        {data?.chart.map(point => <div key={point.date} className="min-w-10 flex-1 text-center text-xs text-gray-500"><div>{point.production}</div><div className="mx-auto bg-blue-500 rounded-t w-6" style={{ height: `${Math.max(2, point.production / Math.max(1, ...data.chart.map(c => c.production)) * 90)}px` }} /><span>{point.date}</span></div>)}
      </div>
    </section>
    <section className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
      <h2 className="font-semibold p-4 dark:text-white">생산 항목·구간별 실적</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm dark:text-gray-200"><thead className="bg-gray-100 dark:bg-gray-700"><tr>{['설비', '생산 항목', '출처 / 프로그램', '작업지시', '최초·최근 완료', '수량'].map(x => <th key={x} className="p-3 text-left">{x}</th>)}</tr></thead><tbody>
        {data?.products.map(p => <tr key={p.runKey + ':' + p.countQuality} className="border-t dark:border-gray-700"><td className="p-3">{p.machineId}</td><td className="p-3">{p.productionName}{p.contextStatus === 'conflict' && <p className="text-amber-600 text-xs">작업지시·프로그램 불일치</p>}{p.contextStatus === 'mes_unlinked' && <p className="text-amber-600 text-xs">작업지시 미연결</p>}</td><td className="p-3">{sources[p.commentSource]}<br />{p.programNo}</td><td className="p-3">{p.workOrderNumber ?? '—'}</td><td className="p-3 text-xs">{time(p.firstAt)}<br />{time(p.lastAt)}</td><td className="p-3 font-bold">{p.partsCount}<p className="text-xs text-gray-500">{quality[p.countQuality ?? 'confirmed']}</p></td></tr>)}
        {!data?.products.length && <tr><td colSpan={6} className="p-8 text-center text-gray-500">{data ? '선택 기간의 생산 완료 기록이 없습니다.' : '생산 실적 확인 중…'}</td></tr>}
      </tbody></table></div>
    </section>
    <section className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
      <h2 className="font-semibold p-4 dark:text-white">카운터·프리셋 변경 및 보정 이력 (최근 100건)</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm dark:text-gray-200"><thead><tr>{['시각 / 설비', '변경 내용', '프로그램 / 코멘트', '카운트', '프리셋', '집계 / 구분', '작업자 / 사유'].map(x=><th key={x} className="p-3 text-left">{x}</th>)}</tr></thead><tbody>{(data?.events ?? []).map(e=><tr key={e.eventId} className="border-t dark:border-gray-700"><td className="p-3">{time(e.observedAt)}<br/>{e.machineCode}</td><td className="p-3">{kinds[e.kind] ?? e.kind}{e.messagesBefore !== e.messagesAfter && <details className="mt-1 text-xs text-gray-500"><summary>메시지 발생·해제</summary><p className="whitespace-pre-wrap">이전: {e.messagesBefore ?? '조회 불가'}</p><p className="whitespace-pre-wrap">현재: {e.messagesAfter ?? '조회 불가'}</p></details>}</td><td className="p-3">{e.programNo ?? '—'}<br/>{e.programComment || '—'}</td><td className="p-3">{e.countBefore ?? '—'} → {e.countAfter ?? '—'}</td><td className="p-3">{e.presetBefore ?? '—'} → {e.presetAfter ?? '—'}</td><td className="p-3">{e.quantity}개 / {quality[e.quality] ?? e.quality}</td><td className="p-3">{e.actor || '—'}{e.reason && <p>{e.reason}</p>}{e.correlationId && <p className="text-xs text-gray-500 break-all">수정 번호: {e.correlationId}</p>}{(user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER') && e.kind !== 'correction' && <button className="block mt-2 border rounded px-2 py-1" onClick={()=>setCorrection(e)}>실적 보정</button>}</td></tr>)}</tbody></table></div>
      {!data?.events?.length && <p className="p-4 text-gray-500">변경 이력이 없습니다.</p>}
    </section>
    {correction && (user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER') && <CorrectionForm key={correction.eventId} event={correction} onClose={()=>setCorrection(null)} onSaved={()=>{setCorrection(null);setRefresh(n=>n+1)}} />}
    <section className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
      <h2 className="font-semibold p-4 dark:text-white">최근 생산 실적 (최대 50건)</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm dark:text-gray-200"><thead className="bg-gray-100 dark:bg-gray-700"><tr>{['완료 시각', '설비', '생산 항목 / 원본', '원본·실행 프로그램', '수량'].map(x => <th key={x} className="p-3 text-left">{x}</th>)}</tr></thead><tbody>{data?.recent.map(log => <tr key={log.id} className="border-t dark:border-gray-700"><td className="p-3">{time(log.endTime)}</td><td className="p-3">{log.machineCode}</td><td className="p-3">{log.productionName ?? log.programNo}<details className="text-xs text-gray-500 mt-1"><summary>코멘트 원본 · {sources[log.commentSource ?? 'legacy']}</summary><p>MES: {log.mesComment || '—'}</p><p>스케줄러: {log.schedulerComment || '—'}</p><p>프로그램: {log.programComment || '—'}</p></details></td><td className="p-3">{log.programNo} / {log.executingProgramNo ?? '—'}</td><td className="p-3">{log.partsCount}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}

function CorrectionForm({ event, onClose, onSaved }: { event: CounterHistory; onClose: () => void; onSaved: () => void }) {
  const [quantity,setQuantity]=useState(''); const [reason,setReason]=useState('');
  const [programNo,setProgramNo]=useState(event.programNo ?? ''); const [name,setName]=useState(event.programComment || event.programNo || '');
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  return <form className="bg-white dark:bg-gray-800 rounded shadow p-4 space-y-3 dark:text-white" onSubmit={async e=>{
    e.preventDefault(); if(busy)return; const amount=Number(quantity);
    if(!Number.isSafeInteger(amount) || !amount){setMessage('추가 또는 차감할 정수 수량을 입력하세요.');return;}
    setBusy(true);setMessage('');
    try { const response=await productionApi.correct({ eventId:requestId,machineId:event.machineCode,referenceEventId:event.eventId,quantity:amount,reason,programNo,productionName:name });
      if(!response.success)throw new Error(response.error?.message ?? '보정 실패');onSaved();
    }catch(error){setMessage(error instanceof Error?error.message:'보정 실패');}finally{setBusy(false);}
  }}>
    <h2 className="font-semibold">{event.machineCode} 생산 실적 보정</h2>
    <p className="text-sm text-gray-500">{time(event.observedAt)} 이력에 추가하거나 차감할 수량입니다. 원본 카운터는 변경하지 않습니다. 이미 포함된 추정 수량을 다시 더하지 않도록 확인하세요.</p>
    <fieldset disabled={busy} className="flex flex-wrap gap-3" onChange={()=>setRequestId(crypto.randomUUID())}>
      <input aria-label="보정 수량" required type="number" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="추가 +10 / 차감 -5" className="border rounded p-2 dark:bg-gray-700" />
      <input aria-label="보정 프로그램" required value={programNo} onChange={e=>setProgramNo(e.target.value)} placeholder="O1001" className="border rounded p-2 dark:bg-gray-700" />
      <input aria-label="보정 생산 항목" required maxLength={500} value={name} onChange={e=>setName(e.target.value)} placeholder="생산 항목" className="border rounded p-2 dark:bg-gray-700" />
      <input aria-label="보정 사유" required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="보정 사유" className="border rounded p-2 dark:bg-gray-700" />
      <button type="submit" className="border rounded p-2">보정 저장</button><button type="button" onClick={onClose} className="border rounded p-2">닫기</button>
    </fieldset>
    {message && <p role="alert" className="text-red-500">{message}</p>}
  </form>;
}

function OrderAssignment({ machineId }: { machineId: string }) {
  const user = useAuthStore(s => s.user);
  const [orders, setOrders] = useState<{ id: string; orderNumber: string; productName?: string; programNumber?: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setMessage(''); setOrders([]); setSelected(''); setBusy(true);
    void productionApi.getAssignment(machineId).then(response => {
      if (!response.success || !Array.isArray(response.data?.orders) || response.data.orders.some(order => !order || typeof order.id !== 'string')) throw new Error('Invalid assignment response');
      if (active) { setOrders(response.data.orders); setSelected(response.data.assignment?.workOrderId ?? ''); }
    })
      .catch(() => { if (active) setMessage('작업지시 연결 상태를 확인하지 못했습니다.'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [machineId]);
  return <section className="p-4 bg-white dark:bg-gray-800 rounded shadow flex flex-wrap items-center gap-3">
    <span className="text-sm dark:text-white">현재 설비의 MES 작업지시</span>
    <select aria-label="연결할 작업지시" disabled={busy || user?.role === 'USER'} value={selected} onChange={e => setSelected(e.target.value)} className="p-2 border rounded dark:bg-gray-700 dark:text-white"><option value="">미연결</option>{orders.map(o => <option key={o.id} value={o.id}>{o.orderNumber} / {o.productName} / {o.programNumber}</option>)}</select>
    <button disabled={busy || user?.role === 'USER'} className="border rounded p-2 dark:text-white disabled:opacity-40" onClick={async () => { setBusy(true); try { const response = await productionApi.setAssignment(machineId, selected || null); setMessage(response.success ? '이 시점 이후 생산부터 적용됩니다. 실제 프로그램이 일치해야 작업지시 실적으로 집계됩니다.' : response.error?.message ?? '연결 실패'); } catch { setMessage('연결 요청 실패'); } finally { setBusy(false); } }}>연결 적용 / 해제</button>
    {message && <p role="status" className="text-sm text-gray-500">{message}</p>}
  </section>;
}
