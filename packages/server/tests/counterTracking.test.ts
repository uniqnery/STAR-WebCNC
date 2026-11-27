import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
import { classifyCounter, counterEventSchema } from '../src/lib/counterTracking';
const id='10000000-0000-4000-8000-000000000001';
const before={ at:'2026-11-25T01:00:00.000Z',sessionId:id, programNo:'O1001',programComment:'A',counterSource:'path1:macro:900',count:100,preset:200,state:'running',green:true,red:false };
function event(patch: Record<string,unknown>={}) { return counterEventSchema.parse({ eventId:id,machineId:'MC-002',runId:id,sequence:1,previous:before,counterBefore:before,current:{...before,at:'2026-11-25T01:00:01.000Z',count:101},gap:false,...patch }); }
describe('counter evidence classification',()=>{
 it('uses the first read only as a baseline',()=>expect(classifyCounter(event({counterBefore:null}))).toMatchObject({quantity:0,kind:'baseline'}));
 it('counts a normal single increment',()=>expect(classifyCounter(event())).toMatchObject({quantity:1,quality:'confirmed'}));
 it('accepts multi-cycle increases without assuming a manual write',()=>expect(classifyCounter(event({current:{...before,count:110}}))).toMatchObject({quantity:10,quality:'confirmed'}));
 it('marks a preserved-context increase across an outage as estimated',()=>expect(classifyCounter(event({gap:true}))).toMatchObject({quantity:1,quality:'estimated'}));
 it('marks process restart and stale sampling as estimated',()=>{
   expect(classifyCounter(event({current:{...before,count:101,sessionId:'20000000-0000-4000-8000-000000000001'}}))).toMatchObject({quality:'estimated'});
   expect(classifyCounter(event({current:{...before,count:101,at:'2026-11-25T01:01:00Z'}}))).toMatchObject({quality:'estimated'});
 });
 it.each([[0,'reset'],[50,'decrease']])('preserves historical totals on reduction to %s',(count,kind)=>expect(classifyCounter(event({current:{...before,count}}))).toMatchObject({kind,quantity:0,quality:'review'}));
 it('does not count an audited upward manual adjustment',()=>expect(classifyCounter(event({adjustmentId:id,adjustmentField:'count',current:{...before,count:1000}}))).toMatchObject({kind:'manual_adjustment',quantity:0}));
 it('still counts real production when only the preset is edited',()=>expect(classifyCounter(event({adjustmentId:id,adjustmentField:'preset'}))).toMatchObject({quantity:1}));
 it('records preset-only changes without changing quantity',()=>expect(classifyCounter(event({current:{...before,preset:300}}))).toMatchObject({kind:'preset_changed',quantity:0}));
 it('holds positive quantity when the production identity changed',()=>expect(classifyCounter(event({current:{...before,programNo:'O1002',count:105}}))).toMatchObject({quality:'review',quantity:5}));
 it('does not split production on executing subprogram changes',()=>expect(classifyCounter(event({current:{...before,count:101,executingProgramNo:'O9999'}}))).toMatchObject({quantity:1,quality:'confirmed'}));
 it('does not compare different counter addresses',()=>expect(classifyCounter(event({current:{...before,count:500,counterSource:'path1:pcode:10001'}}))).toMatchObject({kind:'source_changed',quantity:0}));
 it('does not turn a failed read into a reset',()=>expect(classifyCounter(event({current:{...before,count:null}}))).toMatchObject({kind:'count_unavailable',quantity:0}));
});
