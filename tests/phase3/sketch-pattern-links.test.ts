import { beforeAll, expect, it } from 'vitest';
import { PlaneGcsSolver, patternEntities, patternTransforms, patternProblem, applyTransform } from '@3db/sketch';
import { applyCommand, createEmptyPart, IdAllocator, parsePart, serializePart, SCHEMA_VERSION, type SketchFeature } from '@3db/model';
let solver:PlaneGcsSolver;beforeAll(async()=>{solver=await PlaneGcsSolver.create();});
const base=():SketchFeature=>({id:'s',type:'sketch',name:'s',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[],constraints:[]});
it('uses native linear equations for 100 rigid transforms including zero-radius circular seeds',()=>{
 let seed=98194;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++) {
  const x=rand()*30-15,y=rand()*30-15,center:[number,number]=i%5===0?[x,y]:[rand()*5,rand()*5],angle=i%4===0?90:i%4===1?0:rand()*360-180,dx=rand()*10-5,dy=rand()*10-5;
  const s:SketchFeature={...base(),entities:[{id:'a',type:'point',x,y},{id:'b',type:'point',x:0,y:0}],constraints:[{id:'fix',type:'fix',point:'a'},{id:'pattern',type:'patternPoint',a:'a',b:'b',dx:String(dx),dy:String(dy),angle:String(angle)+'deg',center}]};
  const doc=applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:s}),result=solver.solve(s,{analyze:true});
  expect(result.status,JSON.stringify({i,x,y,center,angle,conflicting:result.conflicting,redundant:result.redundant,message:result.message})).toBe('fully');const b=result.geometry.get('b')!;expect(b.type).toBe('point');
  const rotated=applyTransform({kind:'rotate',angle,c:center},[x,y]);if(b.type==='point'){expect(b.p[0],JSON.stringify({i,x,y,center,angle,dx,dy,actual:b.p,rotated})).toBeCloseTo(rotated[0]+dx,6);expect(b.p[1],JSON.stringify({i,x,y,center,angle,dx,dy,actual:b.p,rotated})).toBeCloseTo(rotated[1]+dy,6);}
  if(i===0)expect(parsePart(serializePart(doc)).schemaVersion).toBe(SCHEMA_VERSION);
 }
});
it('creates linked two-direction pattern circles that follow center and radius changes',()=>{
 let s:SketchFeature={...base(),entities:[{id:'center',type:'point',x:2,y:3},{id:'circle',type:'circle',center:'center',radius:2}],constraints:[{id:'fix',type:'fix',point:'center'},{id:'radius',type:'radius',circle:'circle',value:'2'}]};
 const solved=solver.solve(s),spec={kind:'linear' as const,step:[10,0] as [number,number],count:1,second:{step:[0,8] as [number,number],count:1}};
 const op=patternEntities(s,solved.geometry,new IdAllocator({},new Set(s.entities.map(e=>e.id).concat(s.constraints.map(c=>c.id)))),['circle'],spec,false,true);
 expect('error' in op).toBe(false);if('error' in op)throw new Error(op.error);
 let doc=applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:s});doc=applyCommand(doc,{type:'editSketch',featureId:'s',...op.edit});s=doc.features[0] as SketchFeature;
 expect(s.entities.filter(e=>e.type==='circle')).toHaveLength(4);expect(s.constraints.filter(c=>c.type==='patternPoint')).toHaveLength(3);
 doc=applyCommand(doc,{type:'setDimension',featureId:'s',constraintId:'radius',value:'4'});
 doc=applyCommand(doc,{type:'editSketch',featureId:'s',place:[{id:'center',x:5,y:7}]});s=doc.features[0] as SketchFeature;
 const result=solver.solve(s);expect(result.status).toBe('fully');
 const circles=[...result.geometry.values()].filter(g=>g.type==='circle');expect(circles.map(g=>g.r)).toEqual([4,4,4,4]);expect(circles.map(g=>g.c).sort()).toEqual([[5,7],[15,7],[5,15],[15,15]].sort());
});
it('rejects fractional/excessive grid counts, parallel second directions and non-finite input before creating copies',()=>{
 expect(patternProblem({kind:'linear',step:[1,0],count:1.5})).not.toBeNull();
 expect(patternProblem({kind:'linear',step:[1,0],count:20,second:{step:[0,1],count:20}})).not.toBeNull();
 expect(patternProblem({kind:'linear',step:[1,0],count:1,second:{step:[2,0],count:1}})).not.toBeNull();
 expect(()=>patternTransforms({kind:'linear',step:[NaN,0],count:1})).toThrow();
});

it('fuzzes 100 linked circular and grid patterns against their rigid transforms',()=>{
 let seed=8923;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++) {
  const center:[number,number]=[rand()*20-10,rand()*20-10],radius=.1+rand()*4;
  const s:SketchFeature={...base(),entities:[{id:'p',type:'point',x:center[0],y:center[1]},{id:'circle',type:'circle',center:'p',radius}],constraints:[{id:'f',type:'fix',point:'p'},{id:'r',type:'radius',circle:'circle',value:String(radius)}]};
  const spec=i%2?{kind:'circular' as const,c:i%5===0?center:[0,0] as [number,number],angle:i%3===0?-360:270,count:3}:{kind:'linear' as const,step:[5+rand()*10,rand()] as [number,number],count:1,second:{step:[rand(),5+rand()*10] as [number,number],count:1}};
  const op=patternEntities(s,solver.solve(s).geometry,new IdAllocator({},new Set(s.entities.map(e=>e.id).concat(s.constraints.map(c=>c.id)))),['circle'],spec,false,true);
  if('error' in op)throw new Error(op.error);
  const doc=applyCommand(applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:s}),{type:'editSketch',featureId:'s',...op.edit});
  const result=solver.solve(doc.features[0] as SketchFeature);expect(result.status).toBe('fully');
  const copies=[...result.geometry.values()].filter(g=>g.type==='circle').slice(1),transforms=patternTransforms(spec);expect(copies).toHaveLength(transforms.length);
  copies.forEach((copy,j)=>{const expected=applyTransform(transforms[j]!,center);expect(copy.c[0]).toBeCloseTo(expected[0],6);expect(copy.c[1]).toBeCloseTo(expected[1],6);expect(copy.r).toBeCloseTo(radius,6);});
 }
});

it('rejects an oversized linked solve before allocation while preserving independent-copy mode',()=>{
 const s:SketchFeature={...base(),entities:[{id:'p',type:'point',x:1,y:2},{id:'c',type:'circle',center:'p',radius:2}],constraints:[]},geometry=solver.solve(s).geometry;
 const ids=()=>new IdAllocator({},new Set(['s','p','c']));
 const spec={kind:'linear' as const,step:[10,0] as [number,number],count:200};
 const linked=patternEntities(s,geometry,ids(),['c'],spec,false,true);expect('error' in linked).toBe(true);
 const free=patternEntities(s,geometry,ids(),['c'],spec,false,false);expect('edit' in free).toBe(true);if('edit' in free)expect(free.edit.add!.entities.filter(e=>e.type==='circle')).toHaveLength(200);
 const invalid={...s,constraints:[{id:'bad',type:'patternPoint' as const,a:'p',b:'@origin',dx:'0',dy:'0',angle:'90deg',center:[NaN,0] as [number,number]}]};
 expect(()=>applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:invalid})).toThrow();
});
