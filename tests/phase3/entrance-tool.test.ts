import { beforeAll, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { applyCommand, DocHistory, parsePart, serializePart, type Ref } from '@3db/model';
import { findEntrance, Regenerator } from '@3db/regen';
import { entranceFeatures } from '../../apps/web/src/entrance';
import { build, circle, ellipse, extrude, front, sketch, statuses } from '../phase1/builders';
let kernel: Kernel, solver: PlaneGcsSolver;
beforeAll(async () => { kernel = await Kernel.load(); solver = await PlaneGcsSolver.create(); });
const baseDoc = (r = 3, x = 2, y = 1, plane: Ref = front) => build(sketch('s', plane, circle('outer', x, y, r + 4), circle('inner', x, y, r)), extrude('e', 's', 'boss', { type: 'blind', depth: '6' }));
it('creates persistent, editable features, follows a moved hole, and cancels or undoes all three atomically', () => {
 const regen = new Regenerator(kernel, solver);
 try {
  const doc = baseDoc(), base = regen.rebuild(doc), target = findEntrance(kernel, base.body, [{kind:'face',name:'e:cap:end'}]);
  expect(target.diameter).toBeCloseTo(6, 9);
  const made = entranceFeatures(doc, target), history = new DocHistory(doc);
  const insert = () => made.forEach((feature,i) => history.execute({type:'insertFeature',feature,index:doc.features.length+i}));
  history.begin('entry');insert();history.markSessionBase();history.rollback();expect(serializePart(history.doc)).toBe(serializePart(doc));
  history.begin('entry');insert();history.commit();history.undo();expect(serializePart(history.doc)).toBe(serializePart(doc));history.redo();
  const round = parsePart(serializePart(history.doc));
  const result = regen.rebuild(round);expect(result.features.every(f=>f.status==='ok'),statuses(result).join()).toBe(true);
  expect(kernel.isValid(result.body!.shape)).toBe(true);
  const moved = regen.rebuild({...baseDoc(3,5,4),features:[...baseDoc(3,5,4).features,...made]});
  expect(moved.features.every(f=>f.status==='ok'),statuses(moved).join()).toBe(true);
  expect(moved.points.get(made[0]!.id)).toEqual([5,4,6]);
  const broken = regen.rebuild({...round,features:round.features.map(f=>f.type==='refPoint'?{...f,def:{mode:'center',element:{kind:'edge',name:'missing'}}}:f)});
  expect(broken.features.some(f=>f.status==='error')).toBe(true);
 } finally { regen.dispose(); }
});
it('refuses outside rims, missing references and ambiguous multiple-hole faces; explicit inner edges select one hole', () => {
 const regen = new Regenerator(kernel, solver);
 try {
  const doc = build(sketch('s',front,circle('outer',0,0,12),circle('a',-4,0,2),circle('b',4,0,2)),extrude('e','s','boss',{type:'blind',depth:'5'}));
  const result=regen.rebuild(doc),body=result.body!,face=body.names.faces.indexOf('e:cap:end');
  expect(()=>findEntrance(kernel,body,[{kind:'face',name:'e:cap:end'}])).toThrow();
  const loops=kernel.innerFaceLoops(body.shape,face);expect(loops).toHaveLength(2);
  const inner=loops[0]![0]!, target=findEntrance(kernel,body,[{kind:'edge',name:body.names.edges[inner]!}]);expect(target.diameter).toBeCloseTo(4,9);
  const outside=body.topology.edges.findIndex((e,i)=>e.faces.includes(face)&&!loops.flat().includes(i));
  expect(()=>findEntrance(kernel,body,[{kind:'edge',name:body.names.edges[outside]!}])).toThrow();
  expect(()=>findEntrance(kernel,body,[{kind:'edge',name:'missing'}])).toThrow();
  expect(()=>findEntrance(kernel,body,[])).toThrow();
  for(const bad of [NaN,Infinity,0,-1])expect(()=>entranceFeatures(doc,{...target,diameter:bad})).toThrow();
  const made=entranceFeatures(doc,target);const hole=made.at(-1)!;
  if(hole.type!=='hole')throw new Error('Expected countersink');
  const prepared=made.slice(0,-1).reduce((d,feature)=>applyCommand(d,{type:'insertFeature',feature,index:d.features.length}),doc);
  expect(()=>applyCommand(prepared,{type:'insertFeature',feature:{...hole,diameter:'-1'},index:prepared.features.length})).toThrow();
 } finally {regen.dispose();}
});
it('rejects a circular center reference that changes into an ellipse instead of using its midpoint',()=>{
 const regen=new Regenerator(kernel,solver);
 try{
  const doc=baseDoc(),base=regen.rebuild(doc),target=findEntrance(kernel,base.body,[{kind:'face',name:'e:cap:end'}]);
  const made=entranceFeatures(doc,target);
  const edited=build(sketch('s',front,circle('outer',2,1,7),ellipse('inner',2,1,5,1,2)),extrude('e','s','boss',{type:'blind',depth:'6'}));
  const result=regen.rebuild({...edited,features:[...edited.features,...made]});
  expect(result.features.slice(0,2).every(f=>f.status==='ok'),statuses(result).join()).toBe(true);
  const failed=result.features.find(f=>f.id===made[0]!.id)!;expect(failed.status).toBe('error');
  expect(failed.message).toMatch(/圓形|circular/i);
 }finally{regen.dispose();}
});
it('100 seeded native cases: three plane orientations, translated centers, radii; analytic cone removal and one valid solid',()=>{
 const heap=(kernel.oc as any).wasmMemory.buffer.byteLength;expect(heap).toBeGreaterThan(0);
 let seed=1967;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 for(let i=0;i<100;i++){
  const r=1+4*random(), x=-7+14*random(), y=-7+14*random(), plane:Ref={kind:'datum',name:['plane:front','plane:top','plane:right'][i%3]!};
  const regen=new Regenerator(kernel,solver);
  try{
   const doc=baseDoc(r,x,y,plane),base=regen.rebuild(doc),volume=kernel.massProps(base.body!.shape).volume;
   const face={kind:'face',name:'e:cap:end'} as Ref;
   const target=findEntrance(kernel,base.body,[face]);expect(target.diameter).toBeCloseTo(2*r,8);
   const made=entranceFeatures(doc,target);const result=regen.rebuild({...doc,features:[...doc.features,...made]});
   expect(result.features.every(f=>f.status==='ok'),`case ${i}: ${statuses(result).join()}`).toBe(true);
   expect(kernel.isValid(result.body!.shape)).toBe(true);expect(kernel.solidCount(result.body!.shape)).toBe(1);
   expect(volume-kernel.massProps(result.body!.shape).volume).toBeCloseTo(Math.PI*(r*0.2**2+0.2**3/3),6);
  }finally{regen.dispose();}
 }
 // Bound this batch, without claiming that allocation growth is a leak measurement.
 expect((kernel.oc as any).wasmMemory.buffer.byteLength-heap).toBeLessThan(512*1024*1024);
});
