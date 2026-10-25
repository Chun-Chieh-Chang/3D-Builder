import {beforeAll,expect,it}from 'vitest';
import {applyCommand,createEmptyPart,type SketchFeature,type SketchEntity,type SketchConstraint,SKETCH_AXIS_H,SKETCH_ORIGIN}from '@3db/model';
import {PlaneGcsSolver}from '@3db/sketch';
import {applicableRelations}from '@3db/sketch/interact';
let solver:PlaneGcsSolver;beforeAll(async()=>{solver=await PlaneGcsSolver.create();});
const p=(id:string,x:number,y:number):SketchEntity=>({id,type:'point',x,y});
function fixture(kind:'line'|'circle'|'arc',point=false):SketchFeature{
 const entities:SketchEntity[]=[p('ac',4,6),p('as',7,6),p('ae',4,9),p('bc',5,-6),p('bs',6,-5),p('be',5,-8)];
 if(kind==='line')entities.push({id:'a',type:'line',p1:'ac',p2:'as'},{id:'b',type:'line',p1:'bc',p2:'bs'});
 if(kind==='circle')entities.push({id:'a',type:'circle',center:'ac',radius:3},{id:'b',type:'circle',center:'bc',radius:2});
 if(kind==='arc')entities.push({id:'a',type:'arc',center:'ac',start:'as',end:'ae'},{id:'b',type:'arc',center:'bc',start:'bs',end:'be'});
 const used=kind==='line'?['ac','as','bc','bs']:kind==='circle'?['ac','bc']:['ac','as','ae','bc','bs','be'];
 const constraints:SketchConstraint[]=[{id:'ba',type:'block',entity:'a'},point?{id:'s',type:'symmetricEntityPoint',a:'a',b:'b',point:SKETCH_ORIGIN}:{id:'s',type:'symmetricEntity',a:'a',b:'b',axis:SKETCH_AXIS_H}];
 return {id:'sk',type:'sketch',name:'symmetry',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:entities.filter(e=>e.type!=='point'||used.includes(e.id)),constraints};
}
it('mirrors lines, circles and arcs about an axis and a point with native geometry consistency',()=>{
 for(const kind of ['line','circle','arc'] as const)for(const point of [false,true]){
  const f=fixture(kind,point),doc=applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:f}),r=solver.solve(f);expect(r.status,kind+point+':'+r.message).toBe('fully');expect(r.redundant).toEqual([]);
  const a=r.geometry.get('a')!,b=r.geometry.get('b')!;const mirror=(v:number[])=>[point?-v[0]!:v[0],-v[1]!];
  if(a.type==='line'&&b.type==='line'){expect(b.a).toEqual(mirror(a.a));expect(b.b).toEqual(mirror(a.b));}
  if(a.type==='circle'&&b.type==='circle'){expect(b.c).toEqual(mirror(a.c));expect(b.r).toBe(a.r);}
  if(a.type==='arc'&&b.type==='arc'){
   expect(b.c).toEqual(mirror(a.c));expect(b.r).toBe(a.r);
   const xy=(g:typeof a,angle:number)=>[g.c[0]+g.r*Math.cos(angle),g.c[1]+g.r*Math.sin(angle)];for(const [u,v]of [[point?a.a0:a.a1,b.a0],[point?a.a1:a.a0,b.a1]]){const expected=mirror(xy(a,u!)),actual=xy(b,v!);expect(actual[0]).toBeCloseTo(expected[0]!,8);expect(actual[1]).toBeCloseTo(expected[1]!,8);}
  }
  const changed=applyCommand(doc,{type:'editSketch',featureId:'sk',place:[{id:'ac',x:8,y:7},...(kind!=='circle'?[{id:'as',x:11,y:7}]:[]),...(kind==='arc'?[{id:'ae',x:8,y:10}]:[])]});const rr=solver.solve(changed.features[0] as SketchFeature);expect(rr.status).toBe('fully');const bc=rr.geometry.get('bc')!;expect(bc).toMatchObject({p:[point?-8:8,-7]});
 }
});
it('offers whole-entity symmetry using the last selected reference and rejects shared or mismatched geometry',()=>{
 const f=fixture('line'),r=solver.solve(f);expect(applicableRelations(r.geometry,['a','b',SKETCH_AXIS_H],f).some(c=>c.type==='symmetricEntity')).toBe(true);
 for(const constraint of [{id:'bad',type:'symmetricEntity' as const,a:'a',b:'a',axis:SKETCH_AXIS_H},{id:'bad',type:'symmetricEntityPoint' as const,a:'a',b:'b',point:'ac'}])expect(()=>applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:{...f,constraints:[constraint]}})).toThrow();
});
it('fuzzes 100 reflected arcs using true native arc angles and radii',()=>{
 let seed=196;for(let i=0;i<100;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const scale=0.2+seed/4294967296*10,f=fixture('arc',i%2===1);f.entities=f.entities.map(e=>e.type==='point'?{...e,x:e.x*scale,y:e.y*scale}:e);const r=solver.solve(f);expect(r.status).toBe('fully');expect(r.redundant).toEqual([]);const a=r.geometry.get('a')!,b=r.geometry.get('b')!;if(a.type!=='arc'||b.type!=='arc')throw Error('missing arcs');expect(b.r).toBeCloseTo(a.r,8);const end=r.geometry.get(i%2===1?'as':'ae')!,start=r.geometry.get('bs')!;if(end.type!=='point'||start.type!=='point')throw Error('missing endpoints');expect(start.p[0]).toBeCloseTo(i%2===1?-end.p[0]:end.p[0],8);expect(start.p[1]).toBeCloseTo(-end.p[1],8);}
});
