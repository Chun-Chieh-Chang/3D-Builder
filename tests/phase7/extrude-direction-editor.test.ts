import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, serializePart, type Feature } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';
import { sketch, circle, front, extrude } from '../phase1/builders';
let k:Kernel,solver:PlaneGcsSolver;beforeAll(async()=>{k=await Kernel.load();solver=await PlaneGcsSolver.create();});
const doc=(r=3)=>[sketch('s',front,circle('c',0,0,r)),extrude('e','s','boss',{type:'blind',depth:'10'})].reduce((d,feature,index)=>applyCommand(d,{type:'insertFeature',feature,index}),createEmptyPart());
it('changes both directions atomically, retains expressions, cancels and undoes one mode choice',()=>{
 const h=new DocHistory(doc());const before=serializePart(h.doc);h.begin('direction');
 h.execute({type:'setExtrudeDirections',featureId:'e',first:{type:'midPlane',depth:'2*6'},second:null});expect(h.doc.features.at(-1)).toMatchObject({dir1:{type:'midPlane',depth:'2*6'}});h.rollback();expect(serializePart(h.doc)).toBe(before);
 h.execute({type:'setExtrudeDirections',featureId:'e',first:{type:'blind',depth:'7'},second:{type:'blind',depth:'4'}});h.undo();expect(serializePart(h.doc)).toBe(before);h.redo();expect(h.doc.features.at(-1)).toMatchObject({dir2:{depth:'4'}});
 const safe=serializePart(h.doc);expect(()=>h.execute({type:'setExtrudeDirections',featureId:'e',first:{type:'blind',depth:'7'},second:{type:'blind',depth:'missing_name'}})).toThrow();expect(serializePart(h.doc)).toBe(safe);
 expect(()=>h.execute({type:'setExtrudeDirections',featureId:'s',first:{type:'blind',depth:'7'},second:null})).toThrow();expect(serializePart(h.doc)).toBe(safe);
});
it('100 seeded single, symmetric, reversed and two-sided modes give exact native material and bounds',()=>{
 const reg=new Regenerator(k,solver,new Map());let seed=738;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 try{for(let i=0;i<100;i++){
 const radius=1+rand()*4,depth=2+rand()*18,second=1+rand()*5,kind=i%3;const first=kind===1?{type:'midPlane' as const,depth:String(depth)}:{type:'blind' as const,depth:String(depth),...(kind===0&&i%2===0?{reverse:true}:{})};
 const d=applyCommand(doc(radius),{type:'setExtrudeDirections',featureId:'e',first,second:kind===2?{type:'blind',depth:String(second)}:null});const r=reg.rebuild(d);expect(r.features.filter(f=>f.status!=='ok').map(f=>f.message)).toEqual([]);expect(k.isValid(r.body!.shape)).toBe(true);expect(k.solidCount(r.body!.shape)).toBe(1);expect(k.massProps(r.body!.shape).volume).toBeCloseTo(Math.PI*radius**2*(depth+(kind===2?second:0)),5);
 const b=k.bounds(r.body!.shape);expect(b.max[2]-b.min[2]).toBeCloseTo(depth+(kind===2?second:0),5);if(kind===1){expect(b.min[2]).toBeCloseTo(-depth/2,5);expect(b.max[2]).toBeCloseTo(depth/2,5);}
 }}finally{reg.dispose();}
});
