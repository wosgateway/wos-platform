import { describe, it, expect } from 'vitest';
import { normalizeCatalogInput as n, canonicalCatalogService as c, CATALOG_PROVINCE_ALIASES as provinces, hasProvinceCoverageWording as coverage, hasCatalogLocationWording as location, hasCatalogDiscoveryWording as discovery } from './catalog-query-normalization';
describe('full existing lexical normalization prerequisite', () => {
  it.each([
    ['e\u0301\u200b\u200c\u200d\ufeff', 'é'],
    ['ตรวจสุขภาพ ตรวจเข่า','ตรวจสุขภาพ ตรวจเข่า'],
    ['ກວດສຸຂະພາບ ກວດເຂົ່າ','ตรวจสุขภาพ ตรวจเข่า'],
    ['ເລືອກກວດເຂົ່າ','เลือกตรวจเข่า'],
    ['ວຽງຈັນ','เวียงจันทน์'], ['ລົດ','รถ'], ['ໂຮງແຮມ','โรงแรม'], ['ທ່ຽວ','ทริป'],
    ['ໂປຣແກຣມ ໂຄງການ ບໍລິການ ຮັກສາ ໂຮງໝໍ','โปรแกรม โปรแกรม บริการ รักษา โรงพยาบาล'],
    ['ຫຍັງແດ່ ໃດແດ່ ຕອນນີ້ ຈັງຫວັດ ແຂວງ ຈັກ','อะไรบ้าง ไหนบ้าง ตอนนี้ จังหวัด จังหวัด กี่'],
    ['ຫຍັງ ໃດ ແດ່ ຢູ່ ໃນ ມີ ບໍ','อะไร ไหน บ้าง ใน ใน มี ไหม'],
    ['  unknown 😀  ','  unknown 😀  '], ['อุดร','อุดร'], ['xUdon Thani','xUdon Thani'],
  ])('normalizes and is idempotent: %s', (input, expected) => { expect(n(input)).toBe(expected); expect(n(n(input))).toBe(n(input)); });
  it('freezes every current province alias', () => {
    expect(provinces).toEqual({ 'อุดรธานี':['อุดร','อຸດອນ','ອຸດອນ','ອຸດອນທານີ','ອຸດອນທານິ','ອຸດຮ','ອຸດຣ','Udon Thani'], 'หนองคาย':['ໜອງຄາຍ','ຫນອງຄາຍ','ໜອງຄາຽ','ຫນອງຄາຽ','Nong Khai'] });
    for (const [canonical, aliases] of Object.entries(provinces)) for (const alias of aliases) {
      expect(n(alias)).toBe(alias === 'อุดร' ? 'อุดร' : canonical); expect(n(n(alias))).toBe(n(alias));
    }
    expect(n('uDoN tHaNi NONG KHAI')).toBe('อุดรธานี หนองคาย');
  });
  it.each([['ตรวจเข่า','ตรวจเข่า'],['ກວດສຸຂະພາບ','ตรวจสุขภาพ'],['ปวดเข่า','ตรวจเข่า'],['xตรวจเข่า','ตรวจเข่า'],['ตรวจเข่าx','ตรวจเข่า'],['ตรวจเข่',''+null],['unknown',null]])('freezes canonical service boundary: %s',(input,expected)=>expect(c(input)).toBe(expected === 'null' ? null : expected));
  it.each([['จังหวัดไหน',true],['ຈັກແຂວງ',true],['which provinces',true],['what provinces',true],['how many provinces',true],['จังหวัดอุดรธานี',false],['unknown',false]])('coverage wording %s',(input,expected)=>expect(coverage(input)).toBe(expected));
  it.each([['ແຂວງທີ່ບໍ່ຮູ້',true],['ຢູ່ສະຫວັນ',true],['ในกรุงเทพ',false],['unknown',false]])('location wording %s',(input,expected)=>expect(location(input)).toBe(expected));
  it.each([['มีโปรแกรมอะไรบ้าง',true],['ມີໂປຣແກຣມຫຍັງແດ່',true],['อุดรมีบริการอะไรบ้าง',true],['มีโปรแกรมตรวจเข่าอะไรบ้าง',false],['มีโปรแกรมลึกลับอะไรบ้าง',false],['unknown',false]])('discovery wording %s',(input,expected)=>expect(discovery(input)).toBe(expected));
});
