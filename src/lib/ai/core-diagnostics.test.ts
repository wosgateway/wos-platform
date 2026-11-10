import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import * as core from './core';
import * as programs from './programs';
import {POST} from '@/app/api/ai/chat/route';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),browse:vi.fn(),rate:vi.fn(),gate:vi.fn(),notion:vi.fn(),llm:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createAnonClient:()=>({rpc:mocks.rpc,from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:mocks.browse};return q;}})}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>{throw Error('Unexpected service database');}}));
vi.mock('@/lib/rate-limit',()=>({simpleRateLimit:mocks.rate}));
vi.mock('./understanding/gate',()=>({runUnderstandingGate:mocks.gate}));
vi.mock('./notion-knowledge',()=>({searchWosNotionKnowledge:mocks.notion}));
vi.mock('openai',()=>({default:class {chat={completions:{create:mocks.llm}};}}));
const message='มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม';
const history=[{role:'user' as const,content:'เลือกตรวจเข่า'},{role:'assistant' as const,content:'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ'},{role:'user' as const,content:'ขอบคุณ'},{role:'assistant' as const,content:'ยินดีมากค่ะ 😊'}];
const row={id:'health',title:'ตรวจสุขภาพ',special_price:1900,partner_name:'Fixture Clinic',partner_province:'อุดรธานี',partners:{name:'Fixture Clinic',province:'อุดรธานี'}};
const completion={choices:[{message:{role:'assistant',content:'ต้องการข้อมูลเรื่องใดในเชียงใหม่คะ'}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}};
let log:ReturnType<typeof vi.spyOn>;
function events(){return log.mock.calls.filter(c=>c[0]==='[WOS_AI_TRACE]').map(c=>JSON.parse(c[1] as string));}
function request(body:unknown={message,history:[]},signal?:AbortSignal){return new Request('http://localhost/api/ai/chat',{method:'POST',headers:{'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body),signal});}
beforeEach(()=>{
 vi.restoreAllMocks();mocks.rpc.mockReset().mockResolvedValue({data:[row],error:null});mocks.browse.mockReset().mockResolvedValue({data:[row],error:null});
 mocks.rate.mockReset().mockResolvedValue({allowed:true});mocks.gate.mockReset().mockResolvedValue({handled:false});mocks.notion.mockReset().mockResolvedValue([]);mocks.llm.mockReset().mockResolvedValue(completion);
 // Capture structured traces for assertions; existing behavior tests are unchanged.
 log=vi.spyOn(console,'log').mockImplementation(()=>{});
});
afterEach(()=>vi.restoreAllMocks());
describe('request-local diagnostics without behavior changes',()=>{
 it('keeps the response identical and logs correlated private-free boundaries',async()=>{
  const expected=await core.runWosAI(message,[]);const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({answer:expected});
  const e=events(),names=e.map(x=>x.event);for(const name of ['request.start','rate_limit.start','rate_limit.end','body_read.start','body_read.end','ai.start','gate.start','gate.end','catalog.start','catalog.end','ai.end','response.return'])expect(names).toContain(name);
  expect(names).not.toContain('llm.start');expect(new Set(e.map(x=>x.requestId)).size).toBe(1);
  for(const x of e){expect(Number.isFinite(Date.parse(x.timestamp))).toBe(true);expect(x.elapsedMs).toBeGreaterThanOrEqual(0);if(x.durationMs!==undefined)expect(x.durationMs).toBeGreaterThanOrEqual(0);}
  const serialized=JSON.stringify(e);expect(serialized).not.toContain(message);expect(serialized).not.toContain('Fixture Clinic');expect(serialized).not.toContain('content');expect(e.at(-1).status).toBe(200);
 });
 it('keeps simultaneous requests in distinct request-local IDs',async()=>{
  await Promise.all([POST(request()),POST(request({message:'WOS มีบริการจังหวัดไหนบ้าง',history:[]}))]);const e=events();const ids=e.filter(x=>x.event==='request.start').map(x=>x.requestId);expect(new Set(ids).size).toBe(2);
  for(const id of ids){const own=e.filter(x=>x.requestId===id);expect(own.filter(x=>x.event==='response.return')).toHaveLength(1);expect(own.filter(x=>x.event==='catalog.start')).toHaveLength(1);}
 });
 it('records rate denial without entering AI',async()=>{
  mocks.rate.mockResolvedValueOnce({allowed:false});const res=await POST(request());expect(res.status).toBe(429);expect(events().map(x=>x.event)).not.toContain('ai.start');expect(events().at(-1).status).toBe(429);
 });
 it('records rate errors while preserving fail-open validation',async()=>{
  mocks.rate.mockRejectedValueOnce(Error('private-rate-detail'));const res=await POST(request({}));expect(res.status).toBe(400);expect(events().some(x=>x.event==='rate_limit.error')).toBe(true);expect(JSON.stringify(events())).not.toContain('private-rate-detail');
 });
 it('records malformed body errors and the existing 400 response',async()=>{
  const res=await POST(request('{'));expect(res.status).toBe(400);expect(await res.json()).toEqual({error:'Invalid JSON body'});expect(events().some(x=>x.event==='body_read.error')).toBe(true);expect(events().at(-1).status).toBe(400);
 });
 it('records AI errors without changing upstream-429 mapping',async()=>{
  vi.spyOn(core,'runWosAI').mockRejectedValueOnce(Object.assign(Error('private-ai-detail'),{status:429}));const res=await POST(request());expect(res.status).toBe(503);expect(events().find(x=>x.event==='ai.error').status).toBe(429);expect(JSON.stringify(events())).not.toContain('private-ai-detail');
 });
 it('ignores a failing diagnostic callback',async()=>{
  const expected=await core.runWosAI(message,[]);const actual=await core.runWosAI(message,[],{diagnostic:()=>{throw Error('diagnostics unavailable');}});expect(actual).toBe(expected);
 });
 it('ignores trace-output failures',async()=>{
  const expected=await core.runWosAI(message,[]);log.mockImplementation((prefix)=>{if(prefix==='[WOS_AI_TRACE]')throw Error('stdout unavailable');});const res=await POST(request());expect(res.status).toBe(200);expect(await res.json()).toEqual({answer:expected});
 });
 it('records gate errors and preserves existing catalog fallback',async()=>{
  mocks.gate.mockRejectedValueOnce(Error('private-gate-detail'));const res=await POST(request());expect(res.status).toBe(200);expect((await res.json()).answer).toContain('ตรวจสุขภาพ');expect(events().some(x=>x.event==='gate.error')).toBe(true);expect(JSON.stringify(events())).not.toContain('private-gate-detail');
 });
 it('records knowledge errors while the existing catch continues',async()=>{
  mocks.notion.mockRejectedValueOnce(Error('private-knowledge-detail'));const res=await POST(request({message:'เชียงใหม่',history}));expect(res.status).toBe(200);expect(events().some(x=>x.event==='knowledge.error')).toBe(true);expect(events().some(x=>x.event==='llm.end')).toBe(true);expect(JSON.stringify(events())).not.toContain('private-knowledge-detail');
 });
 it('records catalog errors while preserving the existing outer fallback',async()=>{
  vi.spyOn(programs,'searchPrograms').mockRejectedValueOnce(Error('private-catalog-detail'));const res=await POST(request());expect(res.status).toBe(200);expect((await res.json()).answer).toContain('ตรวจสุขภาพ');expect(events().some(x=>x.event==='catalog.error')).toBe(true);expect(JSON.stringify(events())).not.toContain('private-catalog-detail');
 });
 it('times each unchanged 503 retry attempt without logging prompts',async()=>{
  mocks.llm.mockRejectedValueOnce(Object.assign(Error('private-llm-detail'),{status:503})).mockResolvedValueOnce(completion);
  const res=await POST(request({message:'เชียงใหม่',history}));expect(res.status).toBe(200);expect(mocks.llm).toHaveBeenCalledTimes(2);
  expect(events().filter(x=>x.event==='llm.start').map(x=>x.attempt)).toEqual([1,2]);expect(events().find(x=>x.event==='llm.error')).toMatchObject({attempt:1,status:503,errorType:'upstream_http_error'});
  expect(events().find(x=>x.event==='llm.end')).toMatchObject({attempt:2});expect(mocks.llm.mock.calls[0][0]).toEqual(mocks.llm.mock.calls[1][0]);expect(JSON.stringify(events())).not.toContain('private-llm-detail');expect(JSON.stringify(events())).not.toContain('messages');
 });
 it('does not introduce retries for 524',async()=>{
  mocks.llm.mockRejectedValueOnce(Object.assign(Error('private-gateway-detail'),{status:524}));const res=await POST(request({message:'เชียงใหม่',history}));expect(res.status).toBe(200);expect(mocks.llm).toHaveBeenCalledTimes(1);expect(events().find(x=>x.event==='llm.error')).toMatchObject({attempt:1,status:524});
 });
 it('observes a Request signal without adding cancellation',async()=>{
  const controller=new AbortController();const req=request(undefined,controller.signal);const pending=POST(req);controller.abort();const res=await pending;expect(res.status).toBe(200);expect(events().some(x=>x.event==='request.abort')).toBe(true);expect(events().some(x=>x.event==='ai.end')).toBe(true);
 });
});
