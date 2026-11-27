// Exercise the real ToolLifeView against fake CNC responses. No live writes.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.cwd();
const runtime = path.join(root, 'agent-runtime/startup/count-ui-check');
const { Window } = await import(pathToFileURL(path.join(runtime, 'node_modules/happy-dom/lib/index.js')));
const window = new Window({ url: 'http://localhost/' });
for (const name of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent','FocusEvent','KeyboardEvent'])
  Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react-dom/test-utils');
const paths = [1, 2].map(pathNo => ({ pathNo, columns: [
  { key:'preset', label:'PRESET', varType:'pcode', readonly:false },
  { key:'count', label:'COUNT', varType:'ddata', dataType:'word', readonly:true },
], entries:[{ id:`tool-${pathNo}`, toolNo:`T${pathNo}`, varNos:{preset:14040,count:97} }] }));
const calls = [], writes = [];
let response = { success:true, data:{ tools:[{toolNo:'T1',values:{preset:100,count:20}},{toolNo:'T2',values:{preset:200,count:40}}] } };
globalThis.__toolTest = { template:{id:'assigned',templateId:'ASSIGNED',toolLifeConfig:{paths}}, auth:{user:{role:'ADMIN'}},
  read:async(...args)=>{calls.push(args); return response}, write:async(...args)=>{writes.push(args);return {success:true,data:{value:300}}} };
const output = path.join(runtime,'ToolLifeView-test.mjs');
await build({entryPoints:[path.join(root,'packages/web/src/components/ncmonitor/ToolLifeView.tsx')],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',plugins:[{name:'fake-cnc',setup(b){
 b.onResolve({filter:/\/stores\/authStore$/},()=>({path:'auth',namespace:'test'}));
 b.onResolve({filter:/\/stores\/templateStore$/},()=>({path:'template',namespace:'test'}));
 b.onResolve({filter:/\/lib\/api$/},()=>({path:'api',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},({path})=>({loader:'js',contents:path==='auth'?'export const useAuthStore=s=>s(globalThis.__toolTest.auth)':path==='template'?'export const useTemplateStore=s=>s(useTemplateStore.getState());useTemplateStore.getState=()=>({templates:[{id:"old",templateId:"OLD",toolLifeConfig:{paths:[]}},globalThis.__toolTest.template],selectedTemplateId:"old",refreshTemplates:async()=>{}})':'export const machineApi={getById:async()=>{if(globalThis.__toolTest.failAssignment)throw new Error("설비 템플릿 조회 실패");return {success:true,data:{template:{templateId:"ASSIGNED"}}}}};export const ncDataApi={readToolLife:(...a)=>globalThis.__toolTest.read(...a),writeToolLifeVar:(...a)=>globalThis.__toolTest.write(...a)}'}));
}}]});
const { ToolLifeView } = await import(pathToFileURL(output));
const host=document.createElement('div');document.body.append(host);const view=createRoot(host);
let checks=0;
const check=(value,message)=>{assert(value,message);checks++};
const flush=()=>new Promise(r=>setImmediate(r));
const render=async(machineId='MC-TEST')=>act(async()=>{view.render(React.createElement(React.StrictMode,null,React.createElement(ToolLifeView,{machineId})));await flush()});
const click=async e=>act(async()=>{assert(e);e.click();await flush()});
try {
 await render();
 check(host.textContent.includes('100')&&host.textContent.includes('20%'),'first response displayed in StrictMode');
 check(host.textContent.includes('(P)')&&host.textContent.includes('(D)'),'variable types labelled distinctly');
 await click([...host.querySelectorAll('button')].find(b=>b.textContent==='PATH1'));
 check(host.textContent.includes('100'),'selecting the active path does not erase loaded data');
 const before=calls.length;
 globalThis.__toolTest.template=structuredClone(globalThis.__toolTest.template);
 globalThis.__toolTest.template.toolLifeConfig.paths[0].entries[0].varNos.preset=14044;
 response={success:true,data:{tools:[{toolNo:'T1',values:{preset:150,count:30}}]}};
 await render();
 check(calls.length===before+1&&host.textContent.includes('150'),'changed variable number triggers fresh read');
 await click([...host.querySelectorAll('button')].find(b=>b.textContent==='PATH2'));
 check(calls.at(-1)[1]===2,'PATH2 selects path 2');
 // Missing and unreadable values must never be represented as measured zeroes.
 check(host.textContent.includes('—')&&!host.textContent.includes('0%'),'missing fields remain unknown');
 response={success:false,error:{message:'읽기 실패 테스트'}};
 await render('MC-ERROR');
 check(host.querySelector('[role="alert"]')?.textContent.includes('읽기 실패'),'read failure is visible');
 check(host.textContent.includes('—')&&!host.querySelector('.cursor-pointer'),'unreadable cells cannot be edited');
 response={success:true,data:{tools:[{toolNo:'T2',values:{preset:200,count:40}}]}};
 await render('MC-OK');
 await click(host.querySelector('.cursor-pointer'));
 const input=host.querySelector('input');
 await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'300');input.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()});
 await act(async()=>{input.dispatchEvent(new window.FocusEvent('focusout',{bubbles:true}));await flush()});
 check(writes.length===1&&JSON.stringify(writes[0])===JSON.stringify(['MC-OK',14040,300,'pcode',undefined,2]),'edit transmits the correct P-code and path exactly once');
 check(host.textContent.includes('300'),'verified write value displayed');
 globalThis.__toolTest.auth.user.role='USER';await render('MC-USER');
 check(!host.querySelector('.cursor-pointer')&&writes.length===1,'USER remains read only');
 let releaseOld;
 globalThis.__toolTest.read=machine=>machine==='MC-OLD'?new Promise(resolve=>{releaseOld=()=>resolve({success:true,data:{tools:[{toolNo:'T2',values:{preset:9999,count:40}}]}})}):Promise.resolve(response);
 await render('MC-OLD');await render('MC-NEW');
 await act(async()=>{releaseOld();await flush()});
 check(!host.textContent.includes('9999')&&host.textContent.includes('200'),'old machine response discarded');
 const readsBeforeFailure=calls.length;globalThis.__toolTest.failAssignment=true;
 await render('MC-UNVERIFIED');
 check(host.textContent.includes('설비 템플릿 조회 실패')&&!host.textContent.includes('T2')&&calls.length===readsBeforeFailure,'unverified assignment cannot fall back to a cached selected template or read CNC values');
 console.log(`Tool-life UI checks passed: ${checks}; no live CNC calls.`);
} finally { await act(async()=>view.unmount()); window.happyDOM.abort(); }
