import {beforeAll,expect,it}from 'vitest';
import {applyCommand,createEmptyPart,DocHistory,resolveSketch,type SketchFeature,type SketchConstraint,type SketchEntity}from '@3db/model';
import {PlaneGcsSolver}from '@3db/sketch';
import {applicableRelations,expandRelation}from '@3db/sketch/interact';
import {SketchController,type SketchHost}from '../src/sketcher/controller';
let solver:PlaneGcsSolver;beforeAll(async()=>{solver=await PlaneGcsSolver.create();});
function host(entities:SketchEntity[],constraints:SketchConstraint[]) {
 const feature:SketchFeature={id:'sketch',type:'sketch',name:'batch',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities,constraints},history=new DocHistory(applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature}));
 const sketch=()=>history.doc.features[0] as SketchFeature;
 const solve=(s=sketch())=>({...solver.solve(resolveSketch(s,history.doc),{analyze:true}),seq:0,ms:0,problems:[]});const notices:string[]=[];
 const h:SketchHost={featureId:feature.id,doc:()=>history.doc,solved:()=>solve(),execute:c=>{history.execute(c);return true;},trial:async s=>solve(s),dragPreview:()=>{},notify:m=>void notices.push(m),editDimension:()=>{}};
 return{h,history,sketch,solve,notices,controller:new SketchController(h)};
}
function lines(length=10) {
 const entities:SketchEntity[]=[],constraints:SketchConstraint[]=[];
 for(let i=0;i<3;i++){entities.push({id:'a'+i,type:'point',x:0,y:i*10},{id:'b'+i,type:'point',x:i===0?length:3+i,y:i*10},{id:'l'+i,type:'line',p1:'a'+i,p2:'b'+i});constraints.push({id:'fa'+i,type:'fix',point:'a'+i});if(i===0)constraints.push({id:'fb0',type:'fix',point:'b0'});else constraints.push({id:'h'+i,type:'horizontal',a:'l'+i});}
 return {entities,constraints};
}
it('adds a minimal equality batch, skips an existing transitive relation and undoes atomically',async()=>{
 const f=lines(),h=host(f.entities,[...f.constraints,{id:'existing',type:'equal',a:'l0',b:'l1'}]),before=h.history.doc;
 h.controller.select(['l0','l1','l2']);const offered=applicableRelations(h.solve().geometry,h.controller.getView().selection,h.sketch()),equal=offered.find(r=>r.type==='equal')!;
 expect(equal).toMatchObject({a:'l0',b:'l2'});expect(await h.controller.addRelation(equal)).toBe(true);
 expect(h.sketch().constraints.filter(c=>c.type==='equal')).toHaveLength(2);expect(h.solve().status).toBe('fully');
 for(const id of ['l0','l1','l2']){const g=h.solve().geometry.get(id)!;if(g.type!=='line')throw Error('line missing');expect(Math.hypot(g.b[0]-g.a[0],g.b[1]-g.a[1])).toBeCloseTo(10,9);}
 h.history.undo();expect(h.history.doc).toEqual(before);
});
it('batch coradial normalizes into nonredundant center and radius relations and follows the driving circle',async()=>{
 const entities:SketchEntity[]=[],constraints:SketchConstraint[]=[];for(let i=0;i<3;i++)entities.push({id:'p'+i,type:'point',x:i*10,y:i*3},{id:'c'+i,type:'circle',center:'p'+i,radius:3+i});constraints.push({id:'fix0',type:'fix',point:'p0'},{id:'radius0',type:'radius',circle:'c0',value:'3'});
 const h=host(entities,constraints);h.controller.select(['c0','c1','c2']);const body=applicableRelations(h.solve().geometry,h.controller.getView().selection,h.sketch()).find(r=>r.type==='coradial')!;
 expect(await h.controller.addRelation(body)).toBe(true);expect(h.solve().status).toBe('fully');expect(h.solve().redundant).toEqual([]);expect(h.sketch().constraints.filter(c=>c.type==='concentric')).toHaveLength(2);expect(h.sketch().constraints.filter(c=>c.type==='equal')).toHaveLength(2);
 h.history.execute({type:'setDimension',featureId:'sketch',constraintId:'radius0',value:'7'});for(const g of h.solve().geometry.values())if(g.type==='circle'){expect(g.c).toEqual([0,0]);expect(g.r).toBeCloseTo(7,9);}
 expect(applicableRelations(h.solve().geometry,['c0','c1','c2'],h.sketch()).some(r=>r.type==='coradial')).toBe(false);
});
it('refuses the entire conflicting batch and does not apply a partial prefix',async()=>{
 const f=lines(),h=host(f.entities,[...f.constraints,{id:'badLength',type:'distance',a:'l2',value:'8'}]),before=h.history.doc;h.controller.select(['l0','l1','l2']);
 expect(await h.controller.addRelation({type:'equal',a:'l0',b:'l1'})).toBe(false);expect(h.history.doc).toBe(before);expect(h.notices.length).toBe(1);
});
it('skips shared centers and indirect equality paths rather than inserting redundant solver rows',()=>{
 const entities:SketchEntity[]=[{id:'p',type:'point',x:0,y:0},...['a','b','c'].map(id=>({id,type:'circle' as const,center:'p',radius:3}))],constraints:SketchConstraint[]=[{id:'ab',type:'equal',a:'a',b:'b'},{id:'bc',type:'equalCurvature',a:'b',b:'c'}],h=host(entities,constraints);
 expect(expandRelation({type:'concentric',a:'a',b:'b'},h.solve().geometry,['a','b','c'],h.sketch())).toEqual([]);expect(expandRelation({type:'equal',a:'a',b:'c'},h.solve().geometry,['a','b','c'],h.sketch())).toEqual([]);
});
it('fuzzes 100 actual equality batches with partial preexisting links',async()=>{
 let seed=195;for(let i=0;i<100;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const length=1+seed/4294967296*100,f=lines(length),h=host(f.entities,[...f.constraints,...(i%2?[{id:'old',type:'equal' as const,a:'l0',b:'l1'}]:[])]);h.controller.select(['l0','l1','l2']);expect(await h.controller.addRelation({type:'equal',a:'l0',b:'l1'})).toBe(true);const result=h.solve();expect(result.status).toBe('fully');expect(result.redundant).toEqual([]);for(const id of ['l1','l2']){const g=result.geometry.get(id)!;if(g.type!=='line')throw Error('not a line');expect(Math.hypot(g.b[0]-g.a[0],g.b[1]-g.a[1])).toBeCloseTo(length,7);}}
});
