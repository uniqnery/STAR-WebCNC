// Actual Login component, in-memory authentication only. No server login.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd(),runtime=path.join(root,'agent-runtime/startup/count-ui-check');
const {Window}=await import(pathToFileURL(path.join(runtime,'node_modules/happy-dom/lib/index.js')));
const window=new Window({url:'http://localhost/'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent'])Object.defineProperty(globalThis,name,{value:name==='window'?window:window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const calls=[],saved=[],navigated=[];
globalThis.__loginTest={login:async(...args)=>{calls.push(args);return {success:true,data:{user:{id:'test',username:'test'},accessToken:'fake-test-token'}}},setAuth:(...args)=>saved.push(args),navigate:path=>navigated.push(path)};
const output=path.join(runtime,'Login-test.mjs');
await build({entryPoints:[path.join(root,'packages/web/src/components/Login.tsx')],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',plugins:[{name:'fake-login',setup(b){
 b.onResolve({filter:/react-router-dom|\/stores\/authStore$|\/lib\/api$/},args=>({path:args.path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},args=>({loader:'js',resolveDir:root,contents:args.path==='react-router-dom'?'import React from "react";export const useNavigate=()=>globalThis.__loginTest.navigate;export const Link=({to,children,...props})=>React.createElement("a",{href:to,...props},children);':args.path.endsWith('authStore')?'export const useAuthStore=s=>s({setAuth:globalThis.__loginTest.setAuth});':'export const authApi={login:globalThis.__loginTest.login};'}));
}}]});
const {Login}=await import(pathToFileURL(output));const host=document.createElement('div');document.body.append(host);const view=createRoot(host);
const flush=()=>new Promise(r=>setImmediate(r));let checks=0;const check=(v,m)=>{assert(v,m);checks++};
const input=async(id,value)=>act(async()=>{const el=host.querySelector('#'+id);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()});
try{
 await act(async()=>{view.render(React.createElement(Login));await flush()});
 check(host.textContent.includes('Smart Thinking Pro V2.0'),'product name retained');
 check(!host.textContent.includes('계정이 없으신가요')&&!host.textContent.includes('개발자')&&!host.textContent.includes('아이디 기억'),'obsolete text and mock login removed');
 check(host.querySelector('a[href="/register"]').textContent.trim()==='회원가입','registration action remains a plain standalone link');
 const checkbox=host.querySelector('input[type="checkbox"]');check(!checkbox.checked&&host.textContent.includes('자동 로그인'),'automatic login defaults to unchecked');
 await input('username','test-id');await input('password','test-only');
 await act(async()=>{host.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await flush()});
 check(calls[0][2]===false&&saved[0][2]===false,'unchecked choice reaches both server and session storage');
 await act(async()=>{checkbox.click();await flush();});
 await act(async()=>{host.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await flush()});
 check(calls[1][2]===true&&saved[1][2]===true,'checked choice reaches both server and persistent storage');
 check(navigated.every(p=>p==='/')&&navigated.length===2,'successful login still opens the dashboard');
 console.log(`Login UI checks passed: ${checks}; no server login/CNC calls.`);
}finally{await act(async()=>view.unmount());window.happyDOM.abort()}
