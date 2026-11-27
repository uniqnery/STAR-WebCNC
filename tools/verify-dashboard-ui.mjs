// Real shared dashboard card in an isolated DOM; no live API/CNC calls.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root=process.cwd(), runtime=path.join(root,'agent-runtime/startup/count-ui-check');
const { Window }=await import(pathToFileURL(path.join(runtime,'node_modules/happy-dom/lib/index.js')));
const window=new Window({url:'http://localhost/'});
for(const name of ['window','document','navigator','HTMLElement','Event']) Object.defineProperty(globalThis,name,{value:name==='window'?window:window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),{createRoot}=await import('react-dom/client');
const {act}=React;
const machine={id:'test',machineId:'MC-TEST',name:'테스트 설비',realtime:{status:'online',telemetry:{runState:3,programNo:'O1001',path1:{programNo:'O1001'},path2:{programNo:'O2001'},productName:'unrelated MES product',dailyRunRate:99,presetCount:200,partsCount:100}}};
globalThis.__dashboardTest={telemetryMap:{},dailyRunRates:{'MC-TEST':{rate:50,incomplete:true,unknownSeconds:3600}}};
const output=path.join(runtime,'DashboardCard-test.mjs');
await build({entryPoints:[path.join(root,'packages/web/src/components/CardView.tsx')],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',plugins:[{name:'fake-store',setup(b){
 b.onResolve({filter:/\/stores\/machineStore$/},()=>({path:'store',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({loader:'js',contents:'export const useMachineStore=s=>s(globalThis.__dashboardTest)'}));
}}]});
const {MachineStatusCard}=await import(pathToFileURL(output));
const host=document.createElement('div');document.body.append(host);const view=createRoot(host);
const render=()=>act(async()=>{view.render(React.createElement(MachineStatusCard,{machine}));await new Promise(r=>setImmediate(r))});
let checks=0;const check=(condition,message)=>{assert(condition,message);checks++};
try {
 await render();
 check(host.textContent.includes('50.0%')&&!host.textContent.includes('99.0%'),'durable daily summary takes precedence over live telemetry placeholder');
 check(host.textContent.includes('집계 불완전'),'unknown time is disclosed');
 const comment1=host.querySelector('[aria-label="Path1 프로그램 코멘트"]'),comment2=host.querySelector('[aria-label="Path2 프로그램 코멘트"]');
 check(comment1&&comment2&&!comment1.textContent&&!comment2.textContent,'both empty comment spaces exist');
 check(!host.textContent.includes('MAIN')&&!host.textContent.includes('SUB')&&!host.textContent.includes('unrelated MES product'),'path names used and unrelated product name not attached');
 check(comment1.previousElementSibling.className===comment2.previousElementSibling.className,'both program numbers share typography');
 globalThis.__dashboardTest.dailyRunRates['MC-TEST']={rate:0,incomplete:false};await render();
 check(host.textContent.includes('0.0%')&&!host.textContent.includes('집계 불완전'),'observed stopped machine displays a real zero');
 globalThis.__dashboardTest.dailyRunRates={};await render();
 check(!host.textContent.includes('0.0%')&&host.textContent.includes('—'),'missing summary is not shown as zero');
 machine.realtime.telemetry.path1.programComment='PART-A';machine.realtime.telemetry.path2.programComment='PART-B';await render();
 check(host.querySelector('[aria-label="Path1 프로그램 코멘트"]').textContent==='PART-A'&&host.querySelector('[aria-label="Path2 프로그램 코멘트"]').textContent==='PART-B','comments matched per path');
 machine.realtime.telemetry.programNo='O1002';await render();
 check(!host.textContent.includes('PART-A')&&host.textContent.includes('O1002'),'old first-path comment disappears after program change');
 console.log(`Dashboard card checks passed: ${checks}; no live CNC calls.`);
} finally {await act(async()=>view.unmount());window.happyDOM.abort()}
