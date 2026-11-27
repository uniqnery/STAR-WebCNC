import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../web/src/stores/authStore',()=>({useAuthStore:{getState:()=>({testRole:null})}}));
let sockets:FakeSocket[]=[];
class FakeSocket {
 static OPEN=1;static CONNECTING=0;static CLOSED=3;
 readyState=0;sent:string[]=[];
 onopen?:()=>void;onclose?:(event:any)=>void;onmessage?:(event:any)=>void;
 constructor(public url:string){sockets.push(this)}
 send(message:string){this.sent.push(message)}
 open(){this.readyState=1;this.onopen?.()}
 close(code=1000,reason=''){this.readyState=3;this.onclose?.({code,reason})}
}
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();sockets=[];vi.stubEnv('VITE_API_URL','');vi.stubEnv('VITE_WS_URL','');vi.stubGlobal('window',{location:{protocol:'https:',host:'cnc.example.com',hostname:'cnc.example.com'}});vi.stubGlobal('WebSocket',FakeSocket)});
afterEach(()=>{(globalThis as any).__wsClientInstance?.disconnect();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs()});
it('uses WSS and restores queued subscriptions after a network interruption',async()=>{
 const {wsClient}=await import('../../web/src/lib/wsClient');let token='first';
 wsClient.subscribe(['MC-2']);wsClient.connect(()=>token);sockets[0].open();
 expect(sockets[0].url).toBe('wss://cnc.example.com/ws?token=first');
 expect(JSON.parse(sockets[0].sent.at(-1)!)).toMatchObject({type:'subscribe',payload:{machineIds:['MC-2']}});
 token='renewed';sockets[0].close(1006,'network interrupted');await vi.advanceTimersByTimeAsync(5000);sockets[1].open();
 expect(sockets[1].url).toContain('token=renewed');
 expect(JSON.parse(sockets[1].sent.at(-1)!)).toMatchObject({type:'subscribe',payload:{machineIds:['MC-2']}});
});
it('does not carry the previous account subscriptions across logout',async()=>{
 const {wsClient}=await import('../../web/src/lib/wsClient');wsClient.connect('first');sockets[0].open();wsClient.subscribe(['MC-2']);wsClient.disconnect();
 wsClient.connect('second');sockets[1].open();expect(sockets[1].sent).toEqual([]);
});
