import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, flatPattern } from '@3db/regen';
import { rectangle, sketch, front, circle, extrude } from '../phase1/builders';
let k:Kernel,solver:PlaneGcsSolver;
beforeAll(async()=>{k=await Kernel.load();solver=await PlaneGcsSolver.create();});
const build=(fs:Feature[]):PartDoc=>fs.reduce((d,feature,index)=>applyCommand(d,{type:'insertFeature',feature,index}),createEmptyPart());
const base:Feature[]=[sketch('s',front,rectangle('r',0,0,100,50)),{id:'base',name:'base',type:'baseFlange',suppressed:false,sketch:'s',thickness:'1.5',radius:'2',kFactor:'0.5'},sketch('bs',front,{entities:[{id:'a',type:'point',x:50,y:-5},{id:'b',type:'point',x:50,y:55},{id:'l',type:'line',p1:'a',p2:'b'}],constraints:[]}),{id:'bend',name:'bend',type:'midBend',sketch:'bs',angle:'90',suppressed:false}];
const unfold:Feature={id:'u',name:'u',type:'sheetUnfold',suppressed:false};
const refold:Feature={id:'f',name:'f',type:'sheetRefold',unfold:'u',suppressed:false};
const cut=(x:number,r=2):Feature[]=>[sketch('hole',front,circle('c',x,25,r)),extrude('cut','hole','cut',{type:'throughAll',reverse:true})];
it('unfold is editable native material and refold restores both planar panels with correct hole geometry',()=>{
 const reg=new Regenerator(k,solver,new Map());
 try{
  const flat=reg.rebuild(build([...base,unfold,...cut(75)]));expect(flat.features.filter(f=>f.status!=='ok')).toEqual([]);
  expect(k.bounds(flat.body!.shape).max[2]).toBeCloseTo(1.5,6);
  expect(k.massProps(flat.body!.shape).volume).toBeCloseTo((5000-Math.PI*4)*1.5,4);
  const open=flatPattern(k,flat.sheet!);try{expect(open.area).toBeCloseTo(5000-Math.PI*4,4);}finally{k.release(open.shape);}
  const folded=reg.rebuild(build([...base,unfold,...cut(75),refold]));expect(folded.features.filter(f=>f.status!=='ok').map(f=>f.message)).toEqual([]);
  expect(k.isValid(folded.body!.shape)).toBe(true);expect(k.solidCount(folded.body!.shape)).toBe(1);
  expect(k.massProps(folded.body!.shape).volume).toBeCloseTo((5000-Math.PI*4)*1.5,4);
  expect(k.bounds(folded.body!.shape).max[2]).toBeGreaterThan(40);
  const hole = folded.body!.topology.faces.find(f => f.geometry?.type === 'cylinder' && Math.abs(f.geometry.radius - 2) < 1e-6 && Math.abs(f.geometry.axis[0]) > 1 - 1e-8)?.geometry;
  expect(hole?.type).toBe('cylinder');
  if (hole?.type === 'cylinder') { expect(Math.abs(hole.axis[0])).toBeCloseTo(1,8); expect(hole.origin[1]).toBeCloseTo(25,6); expect(hole.origin[2]).toBeCloseTo(3.5 + 25 - Math.PI * 2.75 / 4,6); }

  const blank=flatPattern(k,folded.sheet!);try{expect(blank.area).toBeCloseTo(5000-Math.PI*4,4);expect(blank.outline.some(s=>s.kind==='circle'&&Math.abs(s.c[0]-75)<1e-6&&Math.abs(s.c[1]-25)<1e-6&&s.r===2)).toBe(true);}finally{k.release(blank.shape);}
  expect(folded.body!.names.edges.length).toBe(folded.body!.topology.edges.length);
 }finally{reg.dispose();}
});
it('rejects bend-zone machining, nested unfolds, mismatched refolds and added material explicitly',()=>{
 const reg=new Regenerator(k,solver,new Map());
 try{
  const bad=reg.rebuild(build([...base,unfold,...cut(50),refold]));expect(bad.features.at(-1)).toMatchObject({status:'error',message:expect.stringContaining('折彎帶')});
  const nested=reg.rebuild(build([...base,unfold,{...unfold,id:'u2'}]));expect(nested.features.at(-1)).toMatchObject({status:'error'});
  expect(()=>build([...base,{...refold,unfold:'absent'}])).toThrow();
  const more=reg.rebuild(build([...base,unfold,sketch('boss',front,circle('bc',10,10,3)),extrude('bossE','boss','boss',{type:'blind',depth:'4'}),refold]));expect(more.features.at(-1)).toMatchObject({status:'error',message:expect.stringContaining('除料')});
 }finally{reg.dispose();}
});
it('100 seeded unfolded hole configurations refold to exact native volume and flat hole coordinates',()=>{
 const reg=new Regenerator(k,solver,new Map());
 try{for(let i=0;i<100;i++){
  const x=i%2===0?10+(i*7%25):65+(i*11%25);const radius=0.8+(i*13%20)/10;
  const r=reg.rebuild(build([...base,unfold,...cut(x,radius),refold]));expect(r.features.filter(f=>f.status!=='ok').map(f=>f.message)).toEqual([]);
  expect(k.isValid(r.body!.shape)).toBe(true);expect(k.massProps(r.body!.shape).volume).toBeCloseTo((5000-Math.PI*radius**2)*1.5,3);
  const p=flatPattern(k,r.sheet!);try{expect(p.notIncluded).toEqual([]);expect(p.outline.some(s=>s.kind==='circle'&&Math.abs(s.c[0]-x)<1e-6&&Math.abs(s.r-radius)<1e-6)).toBe(true);}finally{k.release(p.shape);}
 }}finally{reg.dispose();}
});
it('state references survive serialization and undo; dangling refolds fail atomically and dependency order includes machining',async()=>{
 const {DocHistory,serializePart,parsePart,SCHEMA_VERSION,activeSheetUnfold}=await import('@3db/model');
 const {parentsOf}=await import('@3db/regen');
 const h=new DocHistory(build([...base,unfold,...cut(75)]));
 expect(activeSheetUnfold(h.doc.features)?.id).toBe('u');
 h.execute({type:'insertFeature',feature:refold,index:h.doc.features.length});expect(activeSheetUnfold(h.doc.features)).toBeNull();
 expect(parentsOf(refold,h.doc)).toEqual(expect.arrayContaining(['u','hole','cut']));
 expect(parsePart(serializePart(h.doc))).toEqual(h.doc);expect(h.doc.schemaVersion).toBe(SCHEMA_VERSION);expect(h.doc.schemaVersion).toBeGreaterThanOrEqual(83);
 h.undo();expect(activeSheetUnfold(h.doc.features)?.id).toBe('u');h.redo();expect(activeSheetUnfold(h.doc.features)).toBeNull();
 const before=serializePart(h.doc);expect(()=>h.execute({type:'insertFeature',feature:{...refold,id:'bad',unfold:'bend'},index:h.doc.features.length})).toThrow();expect(serializePart(h.doc)).toBe(before);
});
it('a small off-bend through hole is retained in the true blank rather than lost to a relative volume threshold',()=>{
 const reg=new Regenerator(k,solver,new Map());
 try{const fs=[...base,...cut(15,0.01)];const r=reg.rebuild(build(fs));expect(r.features.filter(f=>f.status!=='ok')).toEqual([]);const p=flatPattern(k,r.sheet!);try{expect(p.outline.some(s=>s.kind==='circle'&&Math.abs(s.r-0.01)<1e-7)).toBe(true);}finally{k.release(p.shape);}}finally{reg.dispose();}
});
it('releases rebuild-owned panel and machining shapes; reports the real WASM heap without claiming zero native leakage',()=>{
 const before=k.liveShapes;
 const heap=()=> (k.oc as unknown as {wasmMemory: WebAssembly.Memory}).wasmMemory.buffer.byteLength;
 const initial=heap();expect(initial).toBeGreaterThan(0);
 const reg=new Regenerator(k,solver,new Map());
 try{for(let i=0;i<5;i++){const r=reg.rebuild(build([...base,unfold,...cut(65+i),refold]));expect(r.features.filter(f=>f.status!=='ok')).toEqual([]);}}
 finally{reg.dispose();}
 expect(k.liveShapes).toBe(before);
 console.info('sheet machining WASM heap bytes (not a zero-leak assertion)',{initial,final:heap()});
});
