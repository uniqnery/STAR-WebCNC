import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
const mock=vi.hoisted(()=>({find:vi.fn(),unique:vi.fn(),create:vi.fn(),update:vi.fn(),audit:vi.fn(),refresh:vi.fn()}));
vi.mock('../src/lib/prisma',()=>({prisma:{user:{findFirst:mock.find,findUnique:mock.unique,create:mock.create,update:mock.update},
 globalSetting:{findUnique:vi.fn(async()=>null)},refreshToken:{create:mock.refresh},auditLog:{create:mock.audit},
 $transaction:async(fn:any)=>fn({user:{update:mock.update},auditLog:{create:mock.audit}})}}));
vi.mock('../src/lib/redis',()=>({redisService:{}}));
vi.mock('../src/auth/password',()=>({hashPassword:async()=> 'hash',verifyPassword:async(p:string)=>p==='correct'}));
import auth from '../src/routes/auth';
import { generateAccessToken } from '../src/auth/jwt';
let server:Server,base:string;
const account={id:'existing-id',username:'hong01',displayName:'홍길동',email:'hong@example.test',passwordHash:'hash',role:'USER' as const,isActive:true,isApproved:true};
const request=(path:string,body:unknown,token?:string,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
beforeAll(async()=>{const app=express();app.use(express.json());app.use('/auth',auth);server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`});
afterAll(async()=>{server.closeIdleConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))});
beforeEach(()=>{vi.clearAllMocks();mock.find.mockResolvedValue(null);mock.unique.mockImplementation(async(q:any)=>q.where.id===account.id||q.where.username===account.username?account:null);mock.create.mockImplementation(async(q:any)=>({...q.data,id:'new-id'}));mock.update.mockImplementation(async(q:any)=>({...account,...q.data}));mock.audit.mockResolvedValue({});mock.refresh.mockResolvedValue({})});
it('requires login ID, and does not authenticate with a display name',async()=>{
 expect((await request('/auth/login',{username:'홍길동',password:'correct'})).status).toBe(401);
 const response=await request('/auth/login',{username:'hong01',password:'correct'});
 expect(response.status).toBe(200);expect((await response.json()).data.user).toMatchObject({username:'hong01',displayName:'홍길동'});
});
it('registers separate login ID and name without a unique-name restriction',async()=>{
 const response=await request('/auth/register',{username:'hong02',displayName:'홍길동',email:'second@example.test',password:'correct'});
 expect(response.status).toBe(201);expect(mock.create.mock.calls[0][0].data).toMatchObject({username:'hong02',displayName:'홍길동',role:'USER',isApproved:false});
});
it('requires a name for new registrations',async()=>{
 expect((await request('/auth/register',{username:'hong02',email:'second@example.test',password:'correct'})).status).toBe(400);
 expect(mock.create).not.toHaveBeenCalled();
});
it('changes only the authenticated user name and snapshots its previous value',async()=>{
 const token=generateAccessToken({userId:account.id,username:account.username,displayName:account.displayName,role:account.role});
 const response=await request('/auth/profile',{id:'someone-else',username:'new-login',role:'HQ_ENGINEER',displayName:'홍길순'},token,'PUT');
 expect(response.status).toBe(200);expect(mock.update).toHaveBeenCalledWith({where:{id:account.id},data:{displayName:'홍길순'}});
 expect(mock.audit.mock.calls[0][0].data).toMatchObject({userId:account.id,actorDisplayName:'홍길동',params:{before:'홍길동',after:'홍길순'}});
 expect((await response.json()).data.user).toMatchObject({username:'hong01',displayName:'홍길순',role:'USER'});
});
it('rejects unauthenticated and blank-name profile updates',async()=>{
 expect((await request('/auth/profile',{displayName:'test'},undefined,'PUT')).status).toBe(401);
 const token=generateAccessToken({userId:account.id,username:account.username,role:account.role});
 expect((await request('/auth/profile',{displayName:' '},token,'PUT')).status).toBe(400);
 expect(mock.update).not.toHaveBeenCalled();
});
