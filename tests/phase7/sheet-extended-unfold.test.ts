import {beforeAll,expect,it}from 'vitest';
import {applyCommand,createEmptyPart,type Feature}from '@3db/model';
import {Kernel}from '@3db/kernel';import {PlaneGcsSolver}from '@3db/sketch';
import {Regenerator,flatPattern}from '@3db/regen';
import {sketch,rectangle,front,circle,extrude}from '../phase1/builders';
let k:Kernel,solver:PlaneGcsSolver;beforeAll(async()=>{k=await Kernel.load();solver=await PlaneGcsSolver.create();});
const base:Feature[]=[sketch('s',front,rectangle('r',0,0,120,50)),{id:'base',name:'base',type:'baseFlange',sketch:'s',thickness:'1.5',radius:'2',kFactor:'0.5',suppressed:false}];
const bend=(id:string,x:number):Feature[]=>[sketch('s'+id,front,{entities:[{id:id+'p',type:'point',x,y:-5},{id:id+'q',type:'point',x,y:55},{id:id+'l',type:'line',p1:id+'p',p2:id+'q'}],constraints:[]}),{id,name:id,type:'midBend',sketch:'s'+id,angle:'90',suppressed:false}];
const build=(f:Feature[])=>f.reduce((d,feature,index)=>applyCommand(d,{type:'insertFeature',feature,index}),createEmptyPart());
const u=(bends?:string[]):Feature=>({id:'u',name:'u',type:'sheetUnfold',bends,suppressed:false});
const refold:Feature={id:'f',name:'f',type:'sheetRefold',unfold:'u',suppressed:false};
const hole=(x:number,r=3):Feature[]=>[sketch('h',front,circle('c',x,25,r)),extrude('cut','h','cut',{type:'throughAll',reverse:true})];
const ok=(r:ReturnType<Regenerator['rebuild']>)=>expect(r.features.filter(f=>f.status!=='ok').map(f=>f.message)).toEqual([]);
it('refolds a round normal hole across both bend boundaries and preserves the exact developed contour',()=>{
 const reg=new Regenerator(k,solver,new Map());try{
 const r=reg.rebuild(build([...base,...bend('b',60),u(),...hole(60),refold]));ok(r);expect(k.isValid(r.body!.shape)).toBe(true);expect(k.solidCount(r.body!.shape)).toBe(1);expect(k.massProps(r.body!.shape).volume).toBeCloseTo((6000-Math.PI*9)*1.5,4);
 const a=60-Math.PI*2.75/4;const probe:[number,number,number]=[a+2.75/Math.sqrt(2),25,3.5-2.75/Math.sqrt(2)];expect(k.classify(r.body!.shape,[probe])[0]).toBe('out');
 const p=flatPattern(k,r.sheet!);try{expect(p.area).toBeCloseTo(6000-Math.PI*9,4);expect(p.notIncluded).toEqual([]);}finally{k.release(p.shape);}
 }finally{reg.dispose();}
});
it('partially unfolds one of two sequential bends, then maps planar machining back to both folded bends',()=>{
 const reg=new Regenerator(k,solver,new Map());try{
 const fs=[...base,...bend('b1',85),...bend('b2',30),u(['b2'])];const partial=reg.rebuild(build(fs));ok(partial);expect(partial.body!.topology.faces.filter(f=>f.surface==='cylinder')).toHaveLength(2);expect(k.bounds(partial.body!.shape).max[2]).toBeGreaterThan(20);
 const r=reg.rebuild(build([...fs,...hole(60,2),refold]));ok(r);expect(r.body!.topology.faces.filter(f=>f.surface==='cylinder').length).toBeGreaterThanOrEqual(5);
 const p=flatPattern(k,r.sheet!);try{expect(p.area).toBeCloseTo(6000-Math.PI*4,4);}finally{k.release(p.shape);}
 }finally{reg.dispose();}
});
it('selecting the earlier fold preserves the later curved bend and survives explicit all-selection',()=>{
 const reg=new Regenerator(k,solver,new Map());try{const fs=[...base,...bend('b1',85),...bend('b2',30)];
 for(const selection of [['b1'],['b1','b2']]){const r=reg.rebuild(build([...fs,u(selection),refold]));ok(r);expect(k.massProps(r.body!.shape).volume).toBeCloseTo(9000,4);expect(k.isValid(r.body!.shape)).toBe(true);}
 }finally{reg.dispose();}
});
it('jog bend zones and web refold normal holes for both directions',()=>{
 const reg=new Regenerator(k,solver,new Map());try{for(const reverse of [false,true]){
 const fs=[...base,...bend('j',60).map(f=>f.type==='midBend'?{...f,type:'jog' as const,offset:'12',angle:'60',reverse}:f)];
 const r=reg.rebuild(build([...fs,u(),...hole(60,4),refold]));ok(r);expect(k.isValid(r.body!.shape)).toBe(true);const p=flatPattern(k,r.sheet!);try{expect(p.area).toBeCloseTo(6000-Math.PI*16,4);}finally{k.release(p.shape);}
 }}finally{reg.dispose();}
});
it('partial selections validate references atomically, persist and participate in dependency/undo',async()=>{
 const {DocHistory,serializePart,parsePart,SCHEMA_VERSION}=await import('@3db/model');const {parentsOf}=await import('@3db/regen');
 const h=new DocHistory(build([...base,...bend('b1',85),...bend('b2',30),u(['b1'])]));
 for(const bends of [[],['b1','b1'],['absent'],['s']]){const old=serializePart(h.doc);expect(()=>h.execute({type:'setSheetUnfold',featureId:'u',bends})).toThrow();expect(serializePart(h.doc)).toBe(old);}
 h.execute({type:'setSheetUnfold',featureId:'u',bends:['b2']});expect(parsePart(serializePart(h.doc))).toEqual(h.doc);expect(h.doc.schemaVersion).toBe(SCHEMA_VERSION);expect(h.doc.schemaVersion).toBeGreaterThanOrEqual(84);expect(parentsOf(h.doc.features.at(-1)!,h.doc)).toContain('b2');h.undo();expect(h.doc.features.at(-1)).toMatchObject({bends:['b1']});h.redo();expect(h.doc.features.at(-1)).toMatchObject({bends:['b2']});
});
it('mitred and closed corners mix with later bends and editable unfolding',async()=>{
 const {edgeFingerprint}=await import('@3db/naming');const reg=new Regenerator(k,solver,new Map());
 const edge=(r:ReturnType<Regenerator['rebuild']>,mid:number[])=>{const i=r.body!.topology.edges.findIndex(e=>e.curve==='line'&&Math.hypot(...e.mid.map((x,j)=>x-mid[j]!))<1e-6);expect(i).toBeGreaterThanOrEqual(0);return{kind:'edge' as const,name:r.body!.names.edges[i]!,fingerprint:edgeFingerprint(r.body!.topology,i)};};
 try{for(const corner of [false,true]){
 const plate=[sketch('s',front,rectangle('r',0,0,100,60)),base[1]!];const first=reg.rebuild(build(plate));ok(first);
 const fa:Feature={id:'fa',name:'fa',type:'edgeFlange',edge:edge(first,[100,30,1.5]),length:'40',suppressed:false};const a=reg.rebuild(build([...plate,fa]));ok(a);
 const fb:Feature={id:'fb',name:'fb',type:'edgeFlange',edge:edge(a,[48.25,60,1.5]),length:'30',suppressed:false,...(corner?{inset:{start:'0.5',end:'0'},corner:{start:'0.5'}}:{miter:{start:'0.5'}})};
 const fs=[...plate,fa,fb];const original=reg.rebuild(build(fs));ok(original);const vol=k.massProps(original.body!.shape).volume;const reference=flatPattern(k,original.sheet!);let area:number,blankVolume:number;try{area=reference.area;blankVolume=reference.volume;}finally{k.release(reference.shape);}
 for(const selection of [undefined,['fa'],['fb']]){const folded=reg.rebuild(build([...fs,u(selection),...hole(20,2),refold]));ok(folded);const flat=flatPattern(k,folded.sheet!);try{// The legacy mitre uses the neutral contour extruded through T. Native panels retain the 45° bevel.
 // On the upper surface each straight wall loses T/2: (36.5+26.5)*0.75 = 47.25 mm².
 expect(flat.area).toBeCloseTo(area-(corner?0:(36.5+26.5)*0.75)-Math.PI*4,4);expect(flat.volume).toBeCloseTo(blankVolume-Math.PI*4*1.5,4);}finally{k.release(flat.shape);}expect(k.massProps(folded.body!.shape).volume).toBeCloseTo(vol-Math.PI*4*1.5,4);expect(k.isValid(folded.body!.shape)).toBe(true);}
 // Re-bending through an existing perpendicular flange is deliberately rejected.
 const crossed=reg.rebuild(build([...fs,...bend('mb',30)]));expect(crossed.features.at(-1)!.status).toBe('error');
 const bs=sketch('ms',front,{entities:[{id:'mp',type:'point',x:30,y:65},{id:'mq',type:'point',x:30,y:-5},{id:'ml',type:'line',p1:'mp',p2:'mq'}],constraints:[]});
 const mb:Feature={id:'mb',name:'mb',type:'midBend',sketch:'ms',angle:'60',suppressed:false};
 const prior=[...plate,bs,mb];const bent=reg.rebuild(build(prior));ok(bent);
 const ma:Feature={...fa,edge:edge(bent,[100,30,1.5])};const withA=reg.rebuild(build([...prior,ma]));ok(withA);
 const top=withA.body!.topology.edges.find(e=>e.curve==='line'&&Math.abs(e.mid[1]-60)<1e-6&&Math.abs(e.mid[2]-1.5)<1e-6&&e.mid[0]>40)!;expect(top).toBeDefined();
 const mf:Feature={...fb,edge:edge(withA,top.mid)};const mixed=reg.rebuild(build([...prior,ma,mf,u(),...hole(70,2),refold]));ok(mixed);expect(k.isValid(mixed.body!.shape)).toBe(true);
 }}finally{reg.dispose();}
});
it('hem 180-degree material and non-midpoint K factors support cross-zone machining',()=>{
 const reg=new Regenerator(k,solver,new Map());try{
 const plate=reg.rebuild(build(base));ok(plate);const i=plate.body!.topology.edges.findIndex(e=>Math.hypot(e.mid[0],e.mid[1]-25,e.mid[2]-1.5)<1e-6);expect(i).toBeGreaterThanOrEqual(0);
 const hem:Feature={id:'hem',name:'hem',type:'hem',edge:{kind:'edge',name:plate.body!.names.edges[i]!},length:'8',gap:'0.5',suppressed:false};
 const fs=[...base,hem];const opened=reg.rebuild(build([...fs,u()]));ok(opened);const flat=flatPattern(k,opened.sheet!);try{expect(flat.bends[0]!.angle).toBeCloseTo(Math.PI,8);}finally{k.release(flat.shape);}
 const r=reg.rebuild(build([...fs,u(),...hole(-1,2),refold]));ok(r);expect(k.isValid(r.body!.shape)).toBe(true);
 for(const K of ['0.3','0.7']){const fsK=base.map(f=>f.type==='baseFlange'?{...f,kFactor:K}:f);const r=reg.rebuild(build([...fsK,...bend('b',60),u(),...hole(60),refold]));ok(r);const p=flatPattern(k,r.sheet!);try{expect(p.area).toBeCloseTo(6000-Math.PI*9,4);}finally{k.release(p.shape);}}
 }finally{reg.dispose();}
});
it('partial preview keeps a complete manufacturing blank and unselected curved machining is refused',()=>{
 const reg=new Regenerator(k,solver,new Map());try{
 const fs=[...base,...bend('b1',85),...bend('b2',30),u(['b2'])];const r=reg.rebuild(build([...fs,...hole(60,2)]));ok(r);
 const p=flatPattern(k,r.sheet!);try{expect(p.area).toBeCloseTo(6000-Math.PI*4,4);expect(p.bends).toHaveLength(2);}finally{k.release(p.shape);}
 const bad=reg.rebuild(build([...fs,...hole(83,4),refold]));expect(bad.features.at(-1)!.status).toBe('error');
 }finally{reg.dispose();}
});
it('cross-bend holes supply native flat drawing facts after refolding',async()=>{
 const {flatDrawingGeometry,viewFeatures,elementFacts}=await import('@3db/regen');const {viewVectors}=await import('@3db/model');const reg=new Regenerator(k,solver,new Map());
 try{const r=reg.rebuild(build([...base,...bend('b',60),u(),...hole(60),refold]));ok(r);const flat=flatDrawingGeometry(k,r.sheet!,r.body);
 try{const fs=viewFeatures(flat.topology,flat.names,viewVectors('flat'));const circle=fs.find(f=>f.type==='circle'&&Math.abs(f.radius-3)<1e-6);expect(circle).toBeDefined();if(circle?.type==='circle'){expect(circle.centre[0]).toBeCloseTo(60,6);expect(circle.centre[1]).toBeCloseTo(25,6);expect(elementFacts(flat.topology,flat.names,circle.ref)).toMatchObject({radius:3});}}finally{k.release(flat.shape);}
 }finally{reg.dispose();}
});
it('a rectangular cross-bend slot follows source angle edits and releases owned material maps',()=>{
 const count=k.liveShapes,reg=new Regenerator(k,solver,new Map());try{
 for(const angle of ['45','120']){
 const folds=bend('b',60).map(f=>f.type==='midBend'?{...f,angle}:f);const slot=[sketch('h',front,rectangle('slot',56,21,8,8)),extrude('cut','h','cut',{type:'throughAll',reverse:true})];const r=reg.rebuild(build([...base,...folds,u(['b']),...slot,refold]));ok(r);expect(k.isValid(r.body!.shape)).toBe(true);expect(k.massProps(r.body!.shape).volume).toBeCloseTo((6000-64)*1.5,4);const p=flatPattern(k,r.sheet!);try{expect(p.area).toBeCloseTo(6000-64,4);}finally{k.release(p.shape);}
 }
 }finally{reg.dispose();}expect(k.liveShapes).toBe(count);
});
