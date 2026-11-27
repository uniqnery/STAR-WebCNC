// Real template editor and sync hook against fake server/events; no live writes.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd(),runtime=path.join(root,'agent-runtime/startup/count-ui-check');
const {Window}=await import(pathToFileURL(path.join(runtime,'node_modules/happy-dom/lib/index.js')));
const window=new Window({url:'http://localhost/'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent'])Object.defineProperty(globalThis,name,{value:name==='window'?window:window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.alert=()=>{};
const React=await import('react'),{createRoot}=await import('react-dom/client'),{act}=React;
const template=JSON.parse(await readFile(path.join(root,'templates/SB-20R2_FANUC_0i-TF Plus_V1-copy-748606.json'),'utf8'));
Object.assign(template,{id:'template-test',updatedAt:'2026-11-27T00:00:00.000Z',name:'before'});
let refreshes=0,messageListener,connectListener;const saves=[];
globalThis.__templateTest={template,load:()=>{},refresh:async()=>{refreshes++},save:async(id,body)=>{saves.push(body);throw new Error('conflict')}};
const plugin={name:'fake-template',setup(b){
 b.onResolve({filter:/\/stores\/authStore$/},()=>({path:'auth',namespace:'test'}));
 b.onResolve({filter:/\/stores\/templateStore$/},()=>({path:'template',namespace:'test'}));
 b.onResolve({filter:/\/lib\/wsClient$/},()=>({path:'ws',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},({path:p})=>({loader:'js',contents:p==='auth'?'export const useAuthStore=s=>s({user:{role:"HQ_ENGINEER"}})':p==='ws'?'export const wsClient={onMessage:cb=>globalThis.__templateTest.onMessage(cb),onConnect:cb=>globalThis.__templateTest.onConnect(cb)}':'export const useTemplateStore=s=>s?s(useTemplateStore.getState()):useTemplateStore.getState();useTemplateStore.getState=()=>({templates:[globalThis.__templateTest.template],selectedTemplateId:"template-test",loadTemplates:globalThis.__templateTest.load,refreshTemplates:globalThis.__templateTest.refresh,updateTemplate:globalThis.__templateTest.save});export const useSelectedTemplate=()=>globalThis.__templateTest.template;'}));
}};
globalThis.__templateTest.onMessage=cb=>{messageListener=cb;return()=>{messageListener=undefined}};
globalThis.__templateTest.onConnect=cb=>{connectListener=cb;return()=>{connectListener=undefined}};
const output=path.join(runtime,'TemplateSync-test.mjs');
await build({stdin:{contents:`export {TemplateEditor} from ${JSON.stringify(path.join(root,'packages/web/src/pages/TemplateEditor.tsx'))};export {useTemplateSync} from ${JSON.stringify(path.join(root,'packages/web/src/hooks/useTemplateSync.ts'))};`,resolveDir:root,loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',plugins:[plugin]});
const {TemplateEditor,useTemplateSync}=await import(pathToFileURL(output));
const host=document.createElement('div');document.body.append(host);let view=createRoot(host),checks=0;
const flush=()=>new Promise(r=>setImmediate(r));const check=(condition,message)=>{assert(condition,message);checks++};
const render=()=>act(async()=>{view.render(React.createElement(TemplateEditor));await flush()});
try{
 await render();let input=[...host.querySelectorAll('input')].find(input=>input.value==='before');check(!!input,'editor loads original server snapshot');
 await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'local draft');input.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()});
 globalThis.__templateTest.template={...template,name:'remote change',updatedAt:'2026-11-27T00:00:01.000Z'};await render();
 check(input.value==='local draft','background update does not destroy an unsaved draft');
 const save=[...host.querySelectorAll('button')].find(button=>button.textContent.trim()==='저장');
 await act(async()=>{save.click();await flush()});
 check(saves.length===1&&saves[0].updatedAt==='2026-11-27T00:00:00.000Z','save retains the draft base revision');
 check(input.value==='local draft','conflict keeps the unsaved input');
 await act(async()=>view.unmount());view=createRoot(host);
 function Sync({enabled}){useTemplateSync(enabled);return null}
 await act(async()=>{view.render(React.createElement(Sync,{enabled:true}));await flush()});
 check(refreshes===1,'sync reads the server on login');
 await act(async()=>{messageListener({type:'template_changed'});await flush()});check(refreshes===2,'remote save notification refreshes templates');
 await act(async()=>{connectListener();await flush()});check(refreshes===3,'reconnect refreshes missed changes');
 await act(async()=>{window.dispatchEvent(new window.Event('focus'));await flush()});check(refreshes===4,'returning to the browser refreshes templates');
 await act(async()=>{view.render(React.createElement(Sync,{enabled:false}));await flush()});
 check(!messageListener&&!connectListener,'logout removes sync listeners');
 console.log(`Template editor/sync checks passed: ${checks}; no live writes.`);
}finally{await act(async()=>view.unmount());window.happyDOM.abort()}
