// Real log components with a reactive fake store. No API or CNC commands.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd(),runtime=path.join(root,'agent-runtime/startup/count-ui-check');
const {Window}=await import(pathToFileURL(path.join(runtime,'node_modules/happy-dom/lib/index.js')));
const window=new Window({url:'http://localhost/'});
for(const name of ['window','document','navigator','HTMLElement','Event','MouseEvent'])Object.defineProperty(globalThis,name,{value:name==='window'?window:window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),{createRoot}=await import('react-dom/client'),{act}=React;
const listeners=new Set(),empty=[],loads=[];
const items=Array.from({length:100},(_,i)=>({id:`history-${i}`,timestamp:'2026-11-27T00:00:00Z',actor:{username:'hong01',displayName:'홍길동',role:'ADMIN'},action:`작업 ${i}`,detail:`최종 ${i}`}));
globalThis.__historyTest={rows:{'MC-1:control':items,'MC-2:control':[{...items[0],id:'other',action:'다른 설비 작업'}]},
 subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},empty,loadUserActivities:(...args)=>loads.push(args),feedRenders:0,eventRenders:0,formats:0};
const output=path.join(runtime,'History-test.mjs');
await build({stdin:{contents:`export {UserActivityFeed} from ${JSON.stringify(path.join(root,'packages/web/src/components/UserActivityFeed.tsx'))};export {FocasEventLog} from ${JSON.stringify(path.join(root,'packages/web/src/components/FocasEventLog.tsx'))};`,resolveDir:root,loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',plugins:[{name:'fake-reactive-store',setup(b){
 b.onResolve({filter:/\/stores\/machineStore$/},()=>({path:'store',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({loader:'js',resolveDir:root,contents:'import {useSyncExternalStore} from "react";export const useMachineStore=s=>s({loadUserActivities:globalThis.__historyTest.loadUserActivities});export const useUserActivities=(machine,page)=>useSyncExternalStore(globalThis.__historyTest.subscribe,()=>globalThis.__historyTest.rows[machine+":"+page]||globalThis.__historyTest.empty);'}));
 b.onLoad({filter:/components[\\/](UserActivityFeed|FocasEventLog)\.tsx$/},async args=>({loader:'tsx',contents:(await readFile(args.path,'utf8')).replace('  const activities = useUserActivities','  globalThis.__historyTest.feedRenders++; const activities = useUserActivities').replace('  const hasUserActivity =','  globalThis.__historyTest.eventRenders++; const hasUserActivity =').replaceAll('timeFormatter.format(date)','(globalThis.__historyTest.formats++, timeFormatter.format(date))')}));
}}]});
const {UserActivityFeed,FocasEventLog}=await import(pathToFileURL(output));
const host=document.createElement('div');document.body.append(host);const view=createRoot(host);
let machine='MC-1',events=[{id:'event',type:'CYCLE_START',timestamp:'2026-11-27T00:00:00Z',message:'가동 시작'}],checks=0;
function App(){const content=React.useMemo(()=>React.createElement(UserActivityFeed,{machineId:machine,page:'control'}),[machine]);return React.createElement(FocasEventLog,{events,userActivityContent:content})}
const flush=()=>new Promise(r=>setImmediate(r));
const render=()=>act(async()=>{view.render(React.createElement(App));await flush()});
const check=(value,message)=>{assert(value,message);checks++};
const button=text=>[...host.querySelectorAll('button')].find(button=>button.textContent===text);
const click=element=>act(async()=>{element.click();await flush()});
try{
 await render();
 check(host.querySelectorAll('.tabular-nums').length===100,'all 100 user records remain visible');
 check(host.textContent.includes('홍길동')&&host.textContent.includes('09:00:00'),'display name and Korean time retained');
 const before={feed:globalThis.__historyTest.feedRenders,event:globalThis.__historyTest.eventRenders,formats:globalThis.__historyTest.formats};
 for(let i=0;i<20;i++)await render();
 check(globalThis.__historyTest.feedRenders===before.feed&&globalThis.__historyTest.eventRenders===before.event&&globalThis.__historyTest.formats===before.formats,'unrelated parent refreshes do not render or reformat either log');
 globalThis.__historyTest.rows['MC-1:control']=[{...items[0],id:'new',action:'새 작업',actor:{username:'hong02',displayName:'새 작업자',role:'ADMIN'}},...items.slice(0,99)];
 await act(async()=>{listeners.forEach(listener=>listener());await flush()});
 check(host.textContent.includes('새 작업')&&host.textContent.includes('새 작업자'),'real store changes update through the memoized parent');
 check(host.querySelectorAll('.tabular-nums').length===100&&!host.textContent.includes('작업 99'),'100-record limit and latest record preserved');
 await click(button('이벤트 로그'));check(host.textContent.includes('가동 시작')&&!host.textContent.includes('새 작업자'),'event tab remains functional');
 events=[...events,{id:'new-event',type:'FEED_HOLD',timestamp:'invalid',message:'새 이벤트'}];await render();
 check(host.textContent.includes('새 이벤트')&&host.textContent.includes('—'),'new events update and invalid timestamps cannot crash the list');
 await click(button('사용자 기록'));machine='MC-2';await render();
 check(host.textContent.includes('다른 설비 작업')&&!host.textContent.includes('새 작업자'),'switching machines replaces user history');
 check(loads.some(args=>args[0]==='MC-1')&&loads.some(args=>args[0]==='MC-2'),'history is still requested for each selected machine');
 console.log(`History UI checks passed: ${checks}; no API/CNC calls.`);
}finally{await act(async()=>view.unmount());window.happyDOM.abort()}
