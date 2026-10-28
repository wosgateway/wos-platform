import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { understand } from './understanding/understand';
import { runUnderstandingGate } from './understanding/gate';
import { runWosAI } from './core';
import type { Understanding } from './understanding/types';

const io = vi.hoisted(() => ({ model: vi.fn(), complete: vi.fn(), overview: vi.fn(), search: vi.fn(), provinces: vi.fn(), catalog: vi.fn(), log: vi.fn(), forbidden: vi.fn() }));
vi.mock('./understanding/gate', async original => {
  const actual = await original<typeof import('./understanding/gate')>();
  return { ...actual, runUnderstandingGate: vi.fn(actual.runUnderstandingGate) };
});
vi.mock('./understanding/understand', async original => {
  const actual = await original<typeof import('./understanding/understand')>();
  return { ...actual, understand: vi.fn(actual.understand) };
});
vi.mock('./understanding/llm', () => ({ createUnderstandLlm: () => io.model }));
vi.mock('./understanding/state', () => ({ loadProvinces: io.provinces, logAiRequest: io.log, loadState: io.forbidden, saveState: io.forbidden, clearState: io.forbidden }));
vi.mock('./programs', async original => ({ ...await original<typeof import('./programs')>(), searchPrograms: io.search, getCatalogProvinces: io.catalog, getProgramDetails: io.forbidden, searchHealthProgramOverview: io.overview }));
vi.mock('./notion-knowledge', () => ({ searchWosNotionKnowledge: io.forbidden }));
vi.mock('./hotel-availability', () => ({ searchHotelAvailability: io.forbidden }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: io.forbidden }));
vi.mock('@/lib/supabase/server', () => ({ createAnonClient: io.forbidden }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: io.complete } }; } }));

const knee = { id: 'knee', title: 'ตรวจเข่า', special_price: 1500, partner: { name: 'Fixture', province: 'อุดรธานี' } };
const semantic = (intent: Understanding['intent']): Understanding => ({
  intent, confidence: 0.99, language: 'th', uses_context: false,
  entities: { province: null, program_query: intent === 'PROGRAM_SEARCH' ? 'ตรวจเข่า' : null, selection_index: null, detail_field: null },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WOS_AI_UNDERSTANDING', 'on');
  io.provinces.mockResolvedValue([{ id: 'udon', name_th: 'อุดรธานี', name_en: 'Udon Thani', name_lo: null, aliases: ['อุดร'] }]);
  io.catalog.mockResolvedValue(['อุดรธานี']);
  io.search.mockResolvedValue([knee]);
  io.overview.mockResolvedValue([knee]);
  io.complete.mockResolvedValue({ choices: [{ message: { content: 'รับทราบค่ะ' } }] });
  io.log.mockResolvedValue(undefined);
  io.model.mockResolvedValue(JSON.stringify(semantic('GENERAL_QUESTION')));
  io.forbidden.mockImplementation(() => { throw new Error('Forbidden external operation'); });
});
afterEach(() => vi.unstubAllEnvs());



const history = [
 {role:'user' as const,content:'เลือกตรวจเข่า'},
 {role:'assistant' as const,content:'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ'},
 {role:'user' as const,content:'สมชาย'},
 {role:'assistant' as const,content:'รับทราบค่ะ 😊 สนใจรถรับส่งด้วยไหมคะ?'},
];
describe('real-core semantic authorization',()=>{
 it('authorizes Lao explicit selection through the real semantic gate',async()=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING','on');
  io.model.mockResolvedValue(JSON.stringify({...semantic('PROGRAM_SEARCH'),language:'lo'}));
  const reply=await runWosAI('ເລືອກກວດເຂົ່າ',[]);
  expect(runUnderstandingGate).toHaveBeenCalledOnce();
  expect(understand).toHaveBeenCalledOnce();
  const classified=await vi.mocked(understand).mock.results[0].value;
  expect(classified.understanding?.entities.program_query).toBe('ตรวจเข่า');
  await vi.mocked(runUnderstandingGate).mock.results[0].value;
  expect(io.search).toHaveBeenCalledOnce();
  expect(io.search).toHaveBeenCalledWith('ตรวจเข่า', 5);
  expect(reply).toContain('ตรวจเข่า');
 });
 it.each(['off','shadow','on'])('hostile non-request never searches in %s',async mode=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING',mode);
  const reply=await runWosAI('ไม่ได้ถามเรื่องตรวจเข่า',[]);
  console.log(JSON.stringify({mode,search:io.search.mock.calls,reply}));
  expect(io.search).not.toHaveBeenCalled();expect(reply).not.toContain('1. ตรวจเข่า');
  expect(understand).toHaveBeenCalledTimes(mode==='off'?0:1);
  expect(io.model).toHaveBeenCalledTimes(mode==='off'?0:1);
 });
 it.each(['off','shadow','on'].flatMap(mode=>['อยากตรวจเข่า','มีตรวจเข่าไหม','ช่วงนี้ปวดเข่าเวลาเดินขึ้นบันได มีโปรแกรมอะไรที่เกี่ยวข้องไหม'].map(message=>({mode,message}))))('positive $mode $message',async({mode,message})=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING',mode);io.model.mockResolvedValue(JSON.stringify(semantic('PROGRAM_SEARCH')));
  expect(await runWosAI(message,[])).toContain('ตรวจเข่า');
  expect(io.search).toHaveBeenCalledWith('ตรวจเข่า',5);expect(io.search).toHaveBeenCalledOnce();
  expect(understand).toHaveBeenCalledTimes(mode==='off'?0:1);
 });
 it('ON authoritative non-search defeats deterministic positive',async()=>{
  expect(await runWosAI('อยากตรวจเข่า',[])).not.toContain('1. ตรวจเข่า');
  expect(io.search).not.toHaveBeenCalled();expect(understand).toHaveBeenCalledOnce();expect(io.model).toHaveBeenCalledOnce();
 });
 it('SHADOW non-search remains observational',async()=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING','shadow');
  expect(await runWosAI('อยากตรวจเข่า',[])).toContain('ตรวจเข่า');
  expect(io.search).toHaveBeenCalledWith('ตรวจเข่า',5);expect(io.model).toHaveBeenCalledOnce();
  const gateResult = await vi.mocked(runUnderstandingGate).mock.results[0].value;
  const classified = await vi.mocked(understand).mock.results[0].value;
  expect(gateResult.semantic.understanding).toBe(classified.understanding);
 });
 it.each(['ไม่เอาตรวจเข่า','ไม่ ขอบคุณครับ','ขอบคุณ'])('preserves early owner for %s',async message=>{
  const reply=await runWosAI(message,history);
  expect(reply).not.toContain('1. ตรวจเข่า');expect(io.search).not.toHaveBeenCalled();expect(understand).not.toHaveBeenCalled();
 });
 it('stale confirmation cannot revive a rejected selection',async()=>{
  const refusal=await runWosAI('ไม่เอาตรวจเข่า',history);
  await runWosAI('ยืนยัน',[...history,{role:'user',content:'ไม่เอาตรวจเข่า'},{role:'assistant',content:refusal}]);
  expect(io.search).not.toHaveBeenCalled();expect(understand).not.toHaveBeenCalled();
 });
 it.each(['ตรวจเข่า','เรื่องอื่นที่ไม่เกี่ยวข้อง'])('unclaimed non-request %s cannot search',async message=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING','off');
  await runWosAI(message,[]);expect(io.search).not.toHaveBeenCalled();
 });
 it('preserves exact replacement validation and intake',async()=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING','off');
  io.search.mockResolvedValue([{...knee,title:'ตรวจสุขภาพ'}]);
  expect(await runWosAI('เลือกตรวจสุขภาพ',history.slice(0,2))).toContain('ขอชื่อ');
  expect(io.search).toHaveBeenCalledWith('ตรวจสุขภาพ',3);
 });
 it('freezes province-only catalog continuation',async()=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING','off');
  await runWosAI('อุดร',[{role:'user',content:'ขอข้อมูลตรวจเข่า'},{role:'assistant',content:'สนใจโปรแกรมจังหวัดไหนคะ?'}]);
  expect(io.overview).toHaveBeenCalledWith(5,'อุดรธานี');expect(io.search).not.toHaveBeenCalled();
 });
 it('denies an unsolicited model search even when tools were not offered',async()=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING','off');
  io.complete.mockResolvedValueOnce({choices:[{message:{tool_calls:[{id:'call_test',type:'function',function:{name:'searchPrograms',arguments:JSON.stringify({query:'ตรวจเข่า',province:null,limit:5})}}]}}]});
  await runWosAI('สภาพอากาศวันนี้',[]);
  expect(io.complete.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(io.complete.mock.calls[0][0].tools).toBeUndefined();expect(io.search).not.toHaveBeenCalled();
 });
 it('does not fall back to catalog when a non-request mentions program vocabulary',async()=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING','off');
  await runWosAI('ไม่ได้ถามเรื่องโปรแกรม',[]);expect(io.search).not.toHaveBeenCalled();expect(io.complete).not.toHaveBeenCalled();
 });
 it('freezes current service/province route',async()=>{
  vi.stubEnv('WOS_AI_UNDERSTANDING','off');
  const message='มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม';
  io.search.mockResolvedValue([{...knee,title:'ตรวจสุขภาพ'}]);
  expect(await runWosAI(message,[])).toContain('ตรวจสุขภาพ');
  expect(io.search).toHaveBeenCalledWith(message,5);
 });
});
