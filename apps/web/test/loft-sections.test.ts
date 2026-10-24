import { expect, it } from 'vitest';
import { createEmptyPart, type Feature, type PartDoc } from '@3db/model';
import { initialLoftSections, loftSectionCandidates } from '../src/state/loftSections';
const sketch=(id:string,suppressed=false,construction=false):Feature=>({id,type:'sketch',name:id,suppressed,plane:{kind:'datum',name:'plane:front'},entities:[{id:id+'p',type:'point',x:0,y:0},{id:id+'c',type:'circle',center:id+'p',radius:5,construction}],constraints:[]});
const doc=(features:Feature[]):PartDoc=>({...createEmptyPart(),features});
it('uses the latest two profile sketches without requiring a preselection, retaining explicit last-section selection',()=>{
 const d=doc([sketch('a'),sketch('b'),sketch('c')]);
 expect(initialLoftSections(d,null)).toEqual(['b','c']);expect(initialLoftSections(d,'a')).toEqual(['c','a']);expect(initialLoftSections(d,'not-a-sketch')).toEqual(['b','c']);
});
it('excludes suppressed, construction-only, empty and rolled-back sketches from default sections',()=>{
 const empty:Feature={id:'empty',type:'sketch',name:'empty',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[],constraints:[]};
 const d={...doc([sketch('a'),sketch('off',true),sketch('construction',false,true),empty,sketch('b'),sketch('future')]),rollbackIndex:5};
 expect(loftSectionCandidates(d).map(s=>s.id)).toEqual(['a','b']);expect(initialLoftSections(d,'off')).toEqual(['a','b']);
});
it('does not invent duplicate sections when only one or no profile exists',()=>{
 expect(initialLoftSections(doc([]),null)).toEqual([]);expect(initialLoftSections(doc([sketch('a')]),null)).toEqual(['a']);
});
