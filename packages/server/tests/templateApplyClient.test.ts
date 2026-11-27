import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ update: vi.fn(), reload: vi.fn(), getAll: vi.fn() }));
vi.mock('../../web/src/lib/api', () => ({ templateApi: api }));
import { useTemplateStore } from '../../web/src/stores/templateStore';
const initial = { ...useTemplateStore.getState().templates[0], id: 'server-template', name: 'before', updatedAt: '2026-11-27T00:00:00.000Z' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  useTemplateStore.setState({ templates: [structuredClone(initial)], selectedTemplateId: initial.id });
  api.update.mockImplementation(async (_id, data) => ({ success: true, data: { ...data, updatedAt: '2026-11-27T00:00:01.000Z' } }));
});
it('publishes changed settings only after the apply attempt and retains per-machine pending status', async () => {
  let finish!: (value: unknown) => void;
  api.reload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const saving = useTemplateStore.getState().updateTemplate(initial.id, { name: 'after' });
  await vi.waitFor(() => expect(api.reload).toHaveBeenCalled());
  expect(useTemplateStore.getState().templates[0].name).toBe('before');
  finish({ success: true, data: { notifiedMachines: ['MC-2'], pendingMachines: ['MC-3'] } });
  expect(await saving).toEqual({ notifiedMachines: ['MC-2'], pendingMachines: ['MC-3'] });
  expect(useTemplateStore.getState().templates[0].name).toBe('after');
});
it('retains a successful save when the apply request loses its connection', async () => {
  api.reload.mockRejectedValue(new Error('connection lost'));
  const result = await useTemplateStore.getState().updateTemplate(initial.id, { name: 'saved' });
  expect(result?.pendingMachines.length).toBe(1);
  expect(useTemplateStore.getState().templates[0].name).toBe('saved');
});
it('does not publish or apply an unsuccessful server save', async () => {
  api.update.mockResolvedValue({ success: false, error: { message: 'save failed' } });
  await expect(useTemplateStore.getState().updateTemplate(initial.id, { name: 'unsaved' })).rejects.toThrow('save failed');
  expect(api.reload).not.toHaveBeenCalled();
  expect(useTemplateStore.getState().templates[0].name).toBe('before');
});

it('uses the actual server revision for the next save',async()=>{
  api.reload.mockResolvedValue({success:true,data:{notifiedMachines:[],pendingMachines:[]}});
  await useTemplateStore.getState().updateTemplate(initial.id,{name:'first'});
  expect(useTemplateStore.getState().templates[0].updatedAt).toBe('2026-11-27T00:00:01.000Z');
  await useTemplateStore.getState().updateTemplate(initial.id,{name:'second'});
  expect(api.update.mock.calls[1][1].expectedUpdatedAt).toBe('2026-11-27T00:00:01.000Z');
});

it('preserves the old draft revision even after a background refresh',async()=>{
  useTemplateStore.setState({templates:[{...initial,updatedAt:'2026-11-27T00:00:02.000Z'}]});
  api.update.mockResolvedValue({success:false,error:{message:'conflict'}});
  await expect(useTemplateStore.getState().updateTemplate(initial.id,{name:'draft',updatedAt:initial.updatedAt})).rejects.toThrow('conflict');
  expect(api.update.mock.calls[0][1].expectedUpdatedAt).toBe(initial.updatedAt);
});

it('discards an old in-flight refresh that finishes after saving',async()=>{
  let finish!:(value:unknown)=>void;
  api.getAll.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  const oldRead=useTemplateStore.getState().refreshTemplates();
  api.reload.mockResolvedValue({success:true,data:{notifiedMachines:[],pendingMachines:[]}});
  await useTemplateStore.getState().updateTemplate(initial.id,{name:'saved'});
  finish({success:true,data:[initial]});await oldRead;
  expect(useTemplateStore.getState().templates[0].name).toBe('saved');
});

it('keeps local drafts when the server list refreshes',async()=>{
  useTemplateStore.setState({templates:[{...initial,id:'tpl-draft',name:'unsaved draft'}],selectedTemplateId:'tpl-draft'});
  api.getAll.mockResolvedValue({success:true,data:[]});
  await useTemplateStore.getState().refreshTemplates();
  expect(useTemplateStore.getState().templates[0].name).toBe('unsaved draft');
  expect(useTemplateStore.getState().selectedTemplateId).toBe('tpl-draft');
});
