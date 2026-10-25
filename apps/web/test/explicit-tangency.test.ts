import {beforeAll,expect,it}from 'vitest';
import {applyCommand,createEmptyPart,resolveSketch,type SketchFeature,type SketchConstraint,type SketchEntity}from '@3db/model';
import {PlaneGcsSolver}from '@3db/sketch';
import {endpointTangentOffer}from '@3db/sketch/interact';
let solver:PlaneGcsSolver;beforeAll(async()=>{solver=await PlaneGcsSolver.create();});
const p=(id:string,x:number,y:number):SketchEntity=>({id,type:'point',x,y});
const sketch=(entities:SketchEntity[],constraints:SketchConstraint[]):SketchFeature=>({id:'sk',type:'sketch',name:'tangent',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities,constraints});
it('explicitly distinguishes internal/external tangency and follows radius edits including radius-order reversal',()=>{
 for(const internal of [false,true]){
 const f=sketch([p('p1',0,0),p('p2',internal?5:15,0),{id:'a',type:'circle',center:'p1',radius:10},{id:'b',type:'circle',center:'p2',radius:5}],[{id:'fix',type:'fix',point:'p1'},{id:'align',type:'horizontal',a:'p1',b:'p2'},{id:'r1',type:'radius',circle:'a',value:'10'},{id:'r2',type:'radius',circle:'b',value:'5'},{id:'t',type:internal?'tangentInternal':'tangentExternal',a:'a',b:'b'}]);let d=applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:f});
 for(const radius of [10,3,12]){d=applyCommand(d,{type:'setDimension',featureId:'sk',constraintId:'r1',value:String(radius)});const r=solver.solve(resolveSketch(d.features[0] as SketchFeature,d));expect(r.status).toBe('fully');const a=r.geometry.get('a')!,b=r.geometry.get('b')!;if(a.type!=='circle'||b.type!=='circle')throw Error('missing circles');expect(Math.hypot(b.c[0]-a.c[0],b.c[1]-a.c[1])).toBeCloseTo(internal?Math.abs(radius-5):radius+5,8);}
 }
});
it('joins distinct line/arc endpoints and preserves tangent derivatives without redundant point-on-curve equations',()=>{
 const f=sketch([p('p1',-10,0),p('p2',0,0),p('c',0,5),p('s',1,1),p('e',5,5),{id:'line',type:'line',p1:'p1',p2:'p2'},{id:'arc',type:'arc',center:'c',start:'s',end:'e'}],[{id:'bl',type:'block',entity:'line'},{id:'r',type:'radius',circle:'arc',value:'5'},{id:'v',type:'horizontal',a:'c',b:'e'}]);
 const initial=solver.solve(f),offer=endpointTangentOffer(initial.geometry,'line','arc')!;expect(offer).toMatchObject({aEnd:'end',bEnd:'start'});f.constraints.push({id:'t',...offer});let r=solver.solve(f);expect(r.status).not.toBe('over');expect(r.status).not.toBe('failed');const s=r.geometry.get('s')!,c=r.geometry.get('c')!;expect(s).toMatchObject({p:[0,0]});if(c.type!=='point')throw Error('missing center');expect(c.p[0]).toBeCloseTo(0,8);
 f.constraints.push({id:'already',type:'coincident',a:'p2',b:'s'});r=solver.solve(f);expect(r.status).not.toBe('over');expect(r.redundant).toEqual([]);
});
it('fuzzes 100 explicit tangencies and checks actual center distances rather than solver status alone',()=>{
 let seed=197;for(let i=0;i<100;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const a=1+seed/4294967296*20,b=0.5+a/3,internal=i%2===0,distance=internal?a-b:a+b,angle=i*0.31;const f=sketch([p('p1',2,3),p('p2',2+Math.cos(angle)*distance,3+Math.sin(angle)*distance),{id:'a',type:'circle',center:'p1',radius:a},{id:'b',type:'circle',center:'p2',radius:b}],[{id:'ba',type:'block',entity:'a'},{id:'r',type:'radius',circle:'b',value:String(b)},{id:'t',type:internal?'tangentInternal':'tangentExternal',a:'a',b:'b'}]);const r=solver.solve(f);expect(['under','fully']).toContain(r.status);const g=r.geometry.get('b')!;if(g.type!=='circle')throw Error('missing circle');expect(Math.hypot(g.c[0]-2,g.c[1]-3)).toBeCloseTo(distance,8);}
});
