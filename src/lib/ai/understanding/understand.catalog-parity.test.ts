import {describe,expect,it,vi} from 'vitest';
import {understand} from './understand';
import {decide, type DecideContext} from './orchestrator';
import {normalizeCatalogInput,hasProvinceCoverageWording} from '../catalog-query-normalization';
const provinces=[
 {id:'udon',name_th:'อุดรธานี',name_en:'Udon Thani',name_lo:null,aliases:[]},
 {id:'nongkhai',name_th:'หนองคาย',name_en:'Nong Khai',name_lo:null,aliases:[]},
];
const ctx:DecideContext={recentCatalog:[],catalogOffset:0,catalogQuery:null,selectedProgramId:null,journeyProvinceId:null};
const deps={provinces,coveredProvinceIds:new Set(['udon','nongkhai'])};
describe('common canonical understanding for Thai and Lao',()=>{
 it.each([
  ['มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม','ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ແຂວງອຸດອນທານີບໍ','อุดรธานี','PROGRAM_SEARCH','ตรวจสุขภาพ'],
  ['มีโปรแกรมตรวจสุขภาพไหม','ມີໂປຣແກຣມກວດສຸຂະພາບບໍ',null,'PROGRAM_SEARCH','ตรวจสุขภาพ'],
  ['อุดรธานีมีโปรแกรมอะไรบ้าง','ອຸດອນທານີມີໂປຣແກຣມຫຍັງແດ່','อุดรธานี','PROGRAM_DISCOVERY',null],
  ['มีโปรแกรมตรวจสุขภาพในจังหวัดหนองคายไหม','ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ໜອງຄາຍບໍ','หนองคาย','PROGRAM_SEARCH','ตรวจสุขภาพ'],
  ['มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม','ມີໂປຣແກຣມ ตรวจสุขภาพ ຢູ່ Udon Thani ບໍ','อุดรธานี','PROGRAM_SEARCH','ตรวจสุขภาพ'],
 ])('%s and %s produce the same action',async(th,lo,province,intent,service)=>{
   const llm=vi.fn(async()=>{throw Error('Known catalog requests must not require translation by LLM');});
   const a=await understand(llm,th,[],[],provinces),b=await understand(llm,lo,[],[],provinces);
   expect(llm).not.toHaveBeenCalled();
   for(const r of [a,b])expect(r.understanding).toMatchObject({intent,entities:{province,program_query:service}});
   expect(decide(a.understanding!,th,ctx,deps)).toEqual(decide(b.understanding!,lo,ctx,deps));
   expect(decide(b.understanding!,lo,ctx,deps)).toMatchObject({type:'SEARCH',query:service});
 });
 it('normalizes coverage surfaces without adding a second routing rule',()=>{
   for(const q of ['WOS มีบริการจังหวัดไหนบ้าง','WOS ມີບໍລິການຢູ່ແຂວງໃດແດ່','ຕອນນີ້ມີບໍລິການຈັກແຂວງ'])expect(hasProvinceCoverageWording(q)).toBe(true);
 });
 it('does not collapse a service plus Udon into a province-only query',()=>{
  const text=normalizeCatalogInput('ມີໂປຣແກຣມກວດສຸຂະພາບຢູ່ອຸດອນບໍ');expect(text).toContain('ตรวจสุขภาพ');expect(text).toContain('อุดรธานี');
  expect(normalizeCatalogInput(text)).toBe(text);
 });
 it('does not take explicit selected-program operations away from the model/context',async()=>{
  const llm=vi.fn(async()=>JSON.stringify({intent:'PROGRAM_SELECTION',confidence:.99,entities:{selection_index:0},uses_context:true,language:'th'}));
  const r=await understand(llm,'เลือกตรวจสุขภาพ',[],[{id:'health',title:'ตรวจสุขภาพ'}],provinces);
  expect(r.understanding?.intent).toBe('PROGRAM_SELECTION');
 });
 it('keeps unknown Lao wording unresolved when the existing LLM fallback fails',async()=>{
  const llm=vi.fn(async()=>{throw Error('unavailable');});
  const r=await understand(llm,'ຊ່ວຍຟື້ນຟູພະລັງດາວອັງຄານ',[],[],provinces);
  expect(llm).toHaveBeenCalled();expect(r.understanding).toBeNull();
 });
 it('never turns an unresolved named province into an unscoped understanding',async()=>{
  const r=await understand(vi.fn(),'ມີກວດສຸຂະພາບຢູ່ແຂວງທີ່ບໍ່ຮູ້ຈັກບໍ',[],[],provinces);
  expect(r.understanding).toBeNull();expect(r.error).toBe('unresolved_catalog_province');
 });
 it('leaves an unrecognized specific Lao service to existing LLM understanding',async()=>{
  const llm=vi.fn(async()=>JSON.stringify({intent:'PROGRAM_SEARCH',confidence:.95,entities:{province:'อุดรธานี',program_query:'ตรวจหัวใจ'},uses_context:false,language:'lo'}));
  const r=await understand(llm,'ມີໂປຣແກຣມກວດຫົວໃຈຫຍັງແດ່ຢູ່ອຸດອນ',[],[],provinces);
  expect(llm).toHaveBeenCalled();expect(r.understanding).toMatchObject({intent:'PROGRAM_SEARCH',entities:{province:'อุดรธานี',program_query:'ตรวจหัวใจ'}});
 });

});
