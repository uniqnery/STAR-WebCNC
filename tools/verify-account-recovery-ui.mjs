// Current code-only signup, administrator recovery guidance, and password-change UI.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd(),runtime=path.join(root,'agent-runtime/startup/count-ui-check');
const {Window}=await import(pathToFileURL(path.join(runtime,'node_modules/happy-dom/lib/index.js')));
const window=new Window({url:'http://localhost/'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','Event'])Object.defineProperty(globalThis,name,{value:name==='window'?window:window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const calls=[],state={user:{id:'worker'},logout:()=>calls.push(['logout'])};
globalThis.__policyUi={state,findId:async(...a)=>{calls.push(['find-id',...a]);return{success:true,data:{maskedId:'wor***'}}},register:async(...a)=>{calls.push(['register',...a]);return{success:true}},changePassword:async(...a)=>{calls.push(['change',...a]);return{success:true}},navigate:(...a)=>calls.push(['navigate',...a])};
window.alert=()=>{};
const output=path.join(runtime,'AccountPolicy-ui-test.mjs');
await build({stdin:{contents:`export {AccountRecovery} from './packages/web/src/pages/AccountRecovery';export {Register} from './packages/web/src/components/Register';export {PasswordChange} from './packages/web/src/components/PasswordChange';`,resolveDir:root,loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',plugins:[{name:'fake-account-api',setup(b){
 b.onResolve({filter:/react-router-dom|\/lib\/api$|\/stores\/authStore$/},a=>({path:a.path,namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({loader:'js',resolveDir:root,contents:a.path==='react-router-dom'?'import React from "react";export const useNavigate=()=>globalThis.__policyUi.navigate;export const Link=({to,children,...p})=>React.createElement("a",{href:to,...p},children);':a.path.endsWith('authStore')?'export const useAuthStore={getState:()=>globalThis.__policyUi.state};':'export const authApi={findId:globalThis.__policyUi.findId,register:globalThis.__policyUi.register,changePassword:globalThis.__policyUi.changePassword};'}));
}}]});
const {AccountRecovery,Register,PasswordChange}=await import(pathToFileURL(output));
const host=document.createElement('div');document.body.append(host);const view=createRoot(host);let key=0,checks=0;
const flush=()=>new Promise(r=>setImmediate(r));const check=(v,m)=>{assert(v,m);checks++};
const render=(Component,props={})=>act(async()=>{view.render(React.createElement(Component,{key:++key,...props}));await flush()});
const input=(el,value)=>act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()});
const submit=()=>act(async()=>{host.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await flush()});
try{
 for(const mode of ['forgot-password','reset']){await render(AccountRecovery,{mode});check(!host.querySelector('input')&&host.textContent.includes('관리자'),'recovery uses administrator guidance without requesting email');check(!!host.querySelector('a[href="/login"]'),'return to login remains available');}
 await render(AccountRecovery,{mode:'find-id'});check(host.querySelectorAll('input').length===2,'ID lookup asks for name and email');
 let identityFields=host.querySelectorAll('input');await input(identityFields[0],'작업자');await input(identityFields[1],'worker@example.test');await submit();
 check(calls.some(c=>c[0]==='find-id'&&c[1]==='작업자'&&c[2]==='worker@example.test'),'lookup sends both identity fields');
 check(host.querySelector('[role="status"]')?.textContent.includes('wor***'),'masked ID displayed');
 await input(identityFields[0],'다른 이름');check(!host.querySelector('[role="status"]'),'editing identity clears old result');
 await render(Register);check(!host.querySelector('[aria-label="이메일 인증번호"]')&&!host.textContent.includes('인증번호 받기'),'email verification removed');
 check(host.querySelector('#registrationCode').required,'registration code mandatory');check(!host.querySelector('#email').required,'email optional');
 await input(host.querySelector('#username'),'worker2');await input(host.querySelector('#displayName'),'작업자');await input(host.querySelector('#password'),'new-password');await input(host.querySelector('#passwordConfirm'),'new-password');await input(host.querySelector('#registrationCode'),'test-code');await submit();
 check(calls.some(c=>c[0]==='register'&&c[1]==='worker2'&&c[2]===''&&c[4]==='test-code'),'signup sends code without email or verification');
 await render(PasswordChange,{required:true});check(host.textContent.includes('임시 비밀번호 변경')&&host.querySelectorAll('input[type="password"]').length===3,'forced change has current temporary password and new confirmation');
 let fields=host.querySelectorAll('input');await input(fields[0],'temporary-pass');await input(fields[1],'changed-pass');await input(fields[2],'wrong-pass');await submit();
 check(!calls.some(c=>c[0]==='change')&&!!host.querySelector('[role="alert"]'),'mismatch blocks submit');await input(fields[2],'changed-pass');await submit();
 check(calls.some(c=>c[0]==='change'&&c[1]==='temporary-pass'&&c[2]==='changed-pass'),'explicit submit changes password');check(calls.some(c=>c[0]==='logout')&&calls.some(c=>c[0]==='navigate'&&c[1]==='/login'),'change ends current login');
 await render(PasswordChange);check(host.textContent.includes('현재 비밀번호')&&!host.textContent.includes('임시 비밀번호変更'),'regular change available');
 console.log(`Account policy UI checks passed: ${checks}; no email/server/CNC calls.`);
}finally{await act(async()=>view.unmount());window.happyDOM.abort()}
