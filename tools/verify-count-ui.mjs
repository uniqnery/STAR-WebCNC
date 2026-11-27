// Runs the real CountView in an isolated DOM with a fake CNC API. No live writes.
// Setup: npm install --prefix agent-runtime/startup/count-ui-check --no-save happy-dom
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.cwd();
const runtime = path.join(root, 'agent-runtime/startup/count-ui-check');
const { Window } = await import(pathToFileURL(path.join(runtime, 'node_modules/happy-dom/lib/index.js')));
const window = new Window({ url: 'http://localhost/' });
for (const name of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent','FocusEvent','KeyboardEvent','InputEvent']) {
  Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react-dom/test-utils');
let fields = [
 {key:'preset',label:'PRESET',varType:'pcode',varNo:10000,readonly:false,value:2000.0000000000002},
 {key:'count',label:'COUNT',varType:'macro',varNo:900,readonly:false,value:1900},
 {key:'total',label:'TOTAL',varType:'pcode',varNo:10001,readonly:false,value:500},
];
const writes=[];
let releaseInitialRead;
const initialRead = new Promise(resolve => { releaseInitialRead = resolve; });
let firstRead = true;
let readRequests=0;
globalThis.__countTest={auth:{user:{role:'ADMIN'}},read:async()=>{readRequests++;if(firstRead){firstRead=false;await initialRead}return {success:true,data:{fields:structuredClone(fields),cycleTimeSeconds:126,runState:3,presetMinGap:2}}},
 write:async(machine,field,value)=>{writes.push({machine,field,value});fields=fields.map(f=>f.key===field.key?{...f,value}:f);return {success:true,data:{value}}}};
const output=path.join(runtime,'CountView-test.mjs');
await build({entryPoints:[path.join(root,'packages/web/src/components/ncmonitor/CountView.tsx')],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',plugins:[{name:'fake-cnc',setup(b){
 b.onResolve({filter:/\/stores\/authStore$/},()=>({path:'auth',namespace:'test'}));
 b.onResolve({filter:/\/lib\/api$/},()=>({path:'api',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},({path})=>({loader:'js',contents:path==='auth'?'export const useAuthStore=s=>s(globalThis.__countTest.auth)':'export const ncDataApi={readCount:(...a)=>globalThis.__countTest.read(...a),writeCountVar:(...a)=>globalThis.__countTest.write(...a)}'}));
}}]});
const { CountView }=await import(pathToFileURL(output));
const host=document.createElement('div');document.body.append(host);const view=createRoot(host);let checks=0;
const check=(condition,message)=>{assert(condition,message);checks++};
const flush=async()=>{await new Promise(r=>setImmediate(r))};
const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const click=async element=>{assert(element);await act(async()=>{element.click();await flush()})};
const poll=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5100));await flush()})};
const edit=async(key,value)=>{
 await click(host.querySelector(`[aria-label="${key} 수정"]`));
 const input=host.querySelector('input');await type(input,value);return input;
};
async function type(input,value){await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()})}
try {
 const firstLoadStarted=performance.now();
 await act(async()=>{view.render(React.createElement(React.StrictMode,null,React.createElement(CountView,{machineId:'MC-TEST'})));await flush()});
 check(['PRESET','COUNT','TOTAL','사이클 타임','잔여 시간','예상 종료 시각'].every(label=>host.textContent.includes(label)),'all rows present before data loads');
 check(!host.textContent.includes('계산 불가')&&(host.textContent.match(/—/g)||[]).length>=6,'initial loading uses placeholders');
 check([...host.querySelectorAll('button[aria-label$="수정"]')].every(b=>b.disabled),'unloaded values cannot be edited');
 const rowLabels=[...host.querySelectorAll('button[aria-label$="수정"]')].map(b=>b.getAttribute('aria-label'));
 await act(async()=>{releaseInitialRead();await flush()});
 check(host.querySelector('[aria-label="PRESET 수정"]').textContent.trim()==='2000'&&performance.now()-firstLoadStarted<1000,'StrictMode shows the first response without waiting for the next poll');
 check(readRequests===1,'StrictMode does not duplicate the initial CNC read');
 check(JSON.stringify(rowLabels)===JSON.stringify([...host.querySelectorAll('button[aria-label$="수정"]')].map(b=>b.getAttribute('aria-label'))),'counter rows stay in place after loading');
 check(!button('재조회')&&!host.textContent.includes('저장 버튼으로 CNC 반영')&&!host.textContent.includes('연속 가동')&&!host.textContent.includes('5초마다'),'unnecessary controls and guidance removed');
 check(!host.textContent.includes('P10000')&&!host.textContent.includes('P10001')&&!host.textContent.includes('#900'),'variable addresses hidden');
 check(host.textContent.includes('2000')&&!host.textContent.includes('2000.000'),'integer preset display');
 check(host.textContent.includes('2분 6초')&&host.textContent.includes('3시간 30분'),'cycle and remaining time');
 check(!host.textContent.includes('00시간')&&!host.textContent.includes('현재 시각'),'zero units and clock hidden');
 check(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(host.textContent),'completion date to minute precision');
 let input=await edit('PRESET','1901');check(button('저장').disabled,'count + 1 blocked');
 await type(input,'1902');check(!button('저장').disabled,'count + 2 allowed');
 await act(async()=>{input.dispatchEvent(new window.FocusEvent('focusout',{bubbles:true}));input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flush()});
 check(writes.length===0,'blur and Enter do not write');
 await poll();check(host.querySelector('input').value==='1902','automatic refresh preserves draft');
 await click(button('취소'));check(writes.length===0&&!host.querySelector('input'),'cancel does not write');
 await edit('TOTAL','700');await click(button('저장'));
 check(writes.length===1&&writes[0].value===700&&writes[0].field.varType==='pcode'&&writes[0].field.varNo===10001,'save writes correct total variable once');
 check(host.textContent.includes('저장 완료')&&!host.querySelector('input'),'verified value displayed and edit closed');
 await edit('COUNT','1950');await click(button('취소'));check(writes.length===1,'count cancel remains local');
 const normalRead=globalThis.__countTest.read;
 globalThis.__countTest.read=async()=>{const result=await normalRead();delete result.data.presetMinGap;return result};
 await poll();await edit('PRESET','1950');
 check(button('저장').disabled,'old agent without preset guard cannot accept a save');
 await click(button('취소'));globalThis.__countTest.read=normalRead;await poll();
 await edit('PRESET','1902');
 const normalWrite=globalThis.__countTest.write;let rejectedAttempts=0;
 globalThis.__countTest.write=async()=>{rejectedAttempts++;fields=fields.map(f=>f.key==='count'?{...f,value:1901}:f);return {success:false,error:{message:'프리셋은 최신 카운트 + 2 이상이어야 합니다.'}}};
 await click(button('저장'));
 check(rejectedAttempts===1&&writes.length===1,'a rejected save never becomes a successful write');
 check(host.querySelector('input').value==='1902'&&host.textContent.includes('최신 카운트'),'failed save preserves draft and explains rejection');
 check(button('저장').disabled,'fresh higher CNC count disables the now-invalid draft');
 await click(button('취소'));globalThis.__countTest.write=normalWrite;
 let releaseOldRead;
 const oldSnapshot=structuredClone(fields);
 globalThis.__countTest.read=()=>new Promise(resolve=>{releaseOldRead=()=>resolve({success:true,data:{fields:oldSnapshot,cycleTimeSeconds:126,presetMinGap:2}})});
 await poll();await edit('TOTAL','800');await click(button('저장'));
 await act(async()=>{releaseOldRead();await flush()});
 check(host.querySelector('[aria-label="TOTAL 수정"]').textContent.trim()==='800','a pre-save response cannot overwrite the verified saved value');
 globalThis.__countTest.read=normalRead;
 globalThis.__countTest.auth.user.role='USER';await act(async()=>{view.render(React.createElement(CountView,{machineId:'MC-TEST',key:'user'}));await flush()});
 check([...host.querySelectorAll('button[aria-label$="수정"]')].every(b=>b.disabled),'USER cannot edit');
 check(writes.length===2,'no writes from read-only rendering');
 let releaseOldMachine;
 globalThis.__countTest.read=machine=>machine==='MC-OLD'?new Promise(resolve=>{releaseOldMachine=()=>resolve({success:true,data:{fields:fields.map(f=>f.key==='preset'?{...f,value:9999}:f),cycleTimeSeconds:126,presetMinGap:2}})}):Promise.resolve({success:true,data:{fields:fields.map(f=>f.key==='preset'?{...f,value:3000}:f),cycleTimeSeconds:126,presetMinGap:2}});
 await act(async()=>{view.render(React.createElement(React.StrictMode,null,React.createElement(CountView,{machineId:'MC-OLD'})));await flush()});
 await act(async()=>{view.render(React.createElement(React.StrictMode,null,React.createElement(CountView,{machineId:'MC-NEW'})));await flush()});
 await act(async()=>{releaseOldMachine();await flush()});
 check(host.querySelector('[aria-label="PRESET 수정"]').textContent.trim()==='3000'&&!host.textContent.includes('9999'),'a previous machine response cannot overwrite the newly selected machine');
 console.log(JSON.stringify({uiChecks:checks,liveCncWrites:0}));
} finally {await act(async()=>view.unmount());await window.happyDOM.close();delete globalThis.__countTest;}
