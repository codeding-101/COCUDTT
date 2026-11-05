import{it,expect}from'vitest';
import{checkBusinessModalTypes}from'../tools/fee-business-modal-types';
it('the actual three transformed modules compile against the actual scoped port',()=>{const result=checkBusinessModalTypes();expect(result.roles).toBe(3);expect(result.diagnostics).toEqual([]);expect(result.production_files_written).toBe(0);});
it('type validation detects missing DOM, close and preference members in adapted output',()=>{const result=checkBusinessModalTypes(true);expect(result.diagnostics).toHaveLength(3);for(const role of['mobile','field','guide'])expect(result.diagnostics.some(d=>d.code===2339&&d.file?.endsWith('__business127_'+role+'.ts'))).toBe(true);});
