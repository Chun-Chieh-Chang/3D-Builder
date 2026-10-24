import { beforeAll, expect, it } from 'vitest';
import { applyCommand, IdAllocator, createEmptyPart, parsePart, serializePart, SCHEMA_VERSION, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, referenceEntities } from '@3db/sketch';
import { Kernel, type Frame } from '@3db/kernel';
import { Regenerator, dependencies, silhouetteProjector, silhouetteItems } from '@3db/regen';
import { build, circle, extrude, front, sketch, statuses } from '../phase1/builders';
let solver:PlaneGcsSolver,kernel:Kernel;
beforeAll(async()=>{solver=await PlaneGcsSolver.create();kernel=await Kernel.load();});
const empty=():SketchFeature=>({id:'s',type:'sketch',name:'s',suppressed:false,plane:front,entities:[],constraints:[]});
it('solves circular curvature and symmetry about a point for 100 seeded configurations',()=>{
 let seed=91273;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++) {
  const r=.1+rand()*100,x=rand()*100-50,y=rand()*100-50,cx=rand()*10,cy=rand()*10;
  const s:SketchFeature={...empty(),entities:[{id:'a',type:'point',x,y},{id:'b',type:'point',x:-x,y:-y},{id:'center',type:'point',x:cx,y:cy},{id:'c1',type:'circle',center:'a',radius:r},{id:'c2',type:'circle',center:'b',radius:r*1.3}],constraints:[{id:'fixA',type:'fix',point:'a'},{id:'fixC',type:'fix',point:'center'},{id:'sym',type:'symmetricPoint',a:'a',b:'b',point:'center'},{id:'rad',type:'radius',circle:'c1',value:String(r)},{id:'curve',type:'equalCurvature',a:'c1',b:'c2'}]};
  const doc=applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:s});const result=solver.solve(s,{analyze:true});
  expect(result.status).toBe('fully');const b=result.geometry.get('b')!;expect(b.type).toBe('point');if(b.type==='point'){expect(b.p[0]).toBeCloseTo(2*cx-x,6);expect(b.p[1]).toBeCloseTo(2*cy-y,6);}
  const c=result.geometry.get('c2')!;expect(c.type).toBe('circle');if(c.type==='circle')expect(c.r).toBeCloseTo(r,6);
  if(i===0)expect(parsePart(serializePart(doc)).schemaVersion).toBe(SCHEMA_VERSION);
 }
 expect(()=>build({...empty(),entities:[{id:'a',type:'point',x:0,y:0}],constraints:[{id:'bad',type:'symmetricPoint',a:'a',b:'a',point:'@origin'}]})).toThrow();
});

it('creates persistent silhouette entities from a real cylinder and follows a changed radius',()=>{
 const regen=new Regenerator(kernel,solver,new Map());
 try {
  const base=build(sketch('base',front,circle('c',0,0,5)),extrude('boss','base','boss',{type:'blind',depth:'10'}));
  const r=regen.rebuild(base),body=r.body!,face=body.topology.faces.findIndex(f=>f.surface==='cylinder');
  const frame:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,0,1],normal:[0,-1,0]};
  const refs=[{kind:'face' as const,name:body.names.faces[face]!}];
  const items=silhouetteItems(silhouetteProjector(kernel,body.shape,body.names,body.topology,frame),refs);
  expect(items).toHaveLength(2);for(const item of items){expect('projected' in item && item.projected.kind).toBe('line');}
  const s:SketchFeature={...empty(),plane:{kind:'datum',name:'plane:top'}};
  const op=referenceEntities(s,new IdAllocator(base.idCounters,new Set(base.features.map(f=>f.id))),items);
  expect('edit' in op).toBe(true);if(!('edit' in op))throw new Error('no reference operation');
  const add=op.edit.add!;s.entities=add.entities;s.constraints=add.constraints;
  let doc=applyCommand(base,{type:'insertFeature',index:2,feature:s});
  expect(dependencies(doc).parents.get('s')).toContain('boss');
  for(const radius of [5,8]) {
    doc=applyCommand(doc,{type:'setDimension',featureId:'base',constraintId:'cr',value:String(radius)});
    const result=regen.rebuild(doc);expect(statuses(result).every(s=>s.endsWith('=ok')),statuses(result).join('\n')).toBe(true);
    const lines=[...result.sketches.get('s')!.solved.geometry.values()].filter(g=>g.type==='line');expect(lines).toHaveLength(2);
    for(const line of lines)if(line.type==='line'){expect(Math.abs(line.a[0])).toBeCloseTo(radius,6);expect(Math.abs(line.b[0])).toBeCloseTo(radius,6);}
  }
 } finally {regen.dispose();}
});

it('extracts actual cylindrical silhouettes for 100 radii/heights and records the real heap',()=>{
 const initial=(kernel.oc as any).wasmMemory?.buffer?.byteLength;expect(initial).toBeGreaterThan(0);
 const frame:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},view:Frame={origin:[0,-30,0],xDir:[1,0,0],yDir:[0,0,1],normal:[0,-1,0]};
 let seed=931;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++) {
  const r=.1+rand()*20,height=.1+rand()*50,shape=kernel.extrude(frame,[{outer:[{kind:'circle',c:[0,0],r,source:'c'}],holes:[]}],[0,0,height]).shape;
  try {const face=kernel.topology(shape).faces.findIndex(f=>f.surface==='cylinder');const curves=kernel.silhouetteCurves(shape,face,view);expect(curves).toHaveLength(2);for(const c of curves){expect(c.kind).toBe('line');if(c.kind==='line'){expect(Math.abs(c.a[0])).toBeCloseTo(r,6);expect(Math.hypot(c.a[0]-c.b[0],c.a[1]-c.b[1])).toBeCloseTo(height,6);}}}finally{kernel.release(shape);}
 }
 console.info('silhouette heap growth bytes',(kernel.oc as any).wasmMemory.buffer.byteLength-initial);
});

it('does not add interior seams when the viewing direction rotates, and keeps planar circles analytic',()=>{
 const frame:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
 const shape=kernel.extrude(frame,[{outer:[{kind:'circle',c:[0,0],r:5,source:'c'}],holes:[]}],[0,0,10]).shape;
 try {
  const topology=kernel.topology(shape),side=topology.faces.findIndex(f=>f.surface==='cylinder'),cap=topology.faces.findIndex(f=>f.surface==='plane');
  for(const angle of [.3,.7,1.2]) {const c=Math.cos(angle),s=Math.sin(angle),view:Frame={origin:[3,2,1],xDir:[c,s,0],yDir:[0,0,1],normal:[s,-c,0]};const curves=kernel.silhouetteCurves(shape,side,view);expect(curves).toHaveLength(2);for(const curve of curves){expect(curve.kind).toBe('line');if(curve.kind==='line')expect(Math.abs(curve.a[0]+3*c+2*s)).toBeCloseTo(5,6);}}
  const curves=kernel.silhouetteCurves(shape,cap,frame);expect(curves).toHaveLength(1);expect(curves[0]!.kind).toBe('circle');
 }finally{kernel.release(shape);}
});
