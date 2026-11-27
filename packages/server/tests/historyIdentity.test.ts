import { beforeEach, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({machine:vi.fn(),user:vi.fn(),create:vi.fn(),list:vi.fn()}));
vi.mock('../src/lib/prisma',()=>({prisma:{machine:{findFirst:mock.machine},user:{findUnique:mock.user},userActivityHistory:{create:mock.create,findFirst:vi.fn(),findMany:mock.list},fileOperationHistory:{findFirst:vi.fn()}}}));
vi.mock('../src/lib/websocket',()=>({wsService:{}}));
import { recordUserActivity, listUserActivityHistory } from '../src/lib/userActivityHistory';
import { toFileOperationDto } from '../src/lib/fileOperationHistory';
beforeEach(()=>{vi.clearAllMocks();mock.machine.mockResolvedValue({id:'db-machine',machineId:'MC-2'});mock.user.mockResolvedValue({id:'user-1'});mock.create.mockImplementation(async({data}:any)=>({...data,id:'activity',createdAt:new Date('2026-11-27T00:00:00Z')}))});
it('stores immutable name snapshots alongside stable account identity',async()=>{
 const first=await recordUserActivity({machineId:'MC-2',page:'control',actor:{id:'user-1',username:'hong01',displayName:'홍길동',role:'ADMIN'},action:'오프셋 수정'});
 const stored={...mock.create.mock.calls[0][0].data,id:'old',createdAt:new Date('2026-11-27T00:00:00Z')};
 await recordUserActivity({machineId:'MC-2',page:'control',actor:{id:'user-1',username:'hong01',displayName:'홍길순',role:'ADMIN'},action:'오프셋 수정'});
 mock.list.mockResolvedValue([stored]);
 expect(first?.actor).toMatchObject({username:'hong01',displayName:'홍길동'});
 expect((await listUserActivityHistory('MC-2','control'))[0].actor?.displayName).toBe('홍길동');
 expect(stored).toMatchObject({actorUserId:'user-1',actorUsername:'hong01',actorDisplayName:'홍길동'});
});
it('retains login-ID fallback for historical records without name snapshots',async()=>{
 mock.list.mockResolvedValue([{id:'old',machineCode:'MC-2',page:'control',actorUsername:'legacy',actorRole:'ADMIN',action:'old',createdAt:new Date()}]);
 expect((await listUserActivityHistory('MC-2','control'))[0].actor).toMatchObject({username:'legacy',displayName:'legacy'});
});
it('displays the stored file-operation name without relabeling old records',()=>{
 const row={id:'file',username:'hong01',actorDisplayName:'홍길동',startedAt:new Date(),completedAt:null} as any;
 expect(toFileOperationDto(row).userName).toBe('홍길동');
 expect(toFileOperationDto({...row,actorDisplayName:null}).userName).toBe('hong01');
});
