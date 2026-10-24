import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, IdAllocator, idsInUse, resolveSketch, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedGeometry } from '@3db/sketch';
import { extend } from '@3db/sketch/ops';
import { SketchController, type SketchHost } from '../src/sketcher/controller';
let solver:PlaneGcsSolver;beforeAll(async()=>{solver=await PlaneGcsSolver.create();});
type P=[number,number];
const point=(id:string,p:P):SketchEntity=>({id,type:'point',x:p[0],y:p[1]});
const line=(id:string,p1:string,p2:string):SketchEntity=>({id,type:'line',p1,p2});
function fixture(width=20,height=10,gap=10,angle=0,fixed=false) {
 const at=(x:number,y:number):P=>[x*Math.cos(angle)-y*Math.sin(angle)+3,y*Math.cos(angle)+x*Math.sin(angle)-2];
 const points=[point('a',at(0,0)),point('b',at(width,0)),point('c',at(width,height)),point('d',at(0,height)),point('w0',at(width+gap,-height)),point('w1',at(width+gap,height*2)),point('f0',at(width+gap*2,-height)),point('f1',at(width+gap*2,height*2)),point('s0',at(-gap,-height)),point('s1',at(-gap,height*2))];
 const entities=[...points,line('bottom','a','b'),line('right','b','c'),line('top','c','d'),line('left','d','a'),line('wall','w0','w1'),line('far','f0','f1'),line('startWall','s0','s1')];
 const constraints:SketchConstraint[]=fixed?points.map(p=>({id:'fix'+p.id,type:'fix',point:p.id})):[{id:'fixA',type:'fix',point:'a'},{id:'h0',type:'horizontal',a:'bottom'},{id:'v0',type:'vertical',a:'right'},{id:'h1',type:'horizontal',a:'top'},{id:'v1',type:'vertical',a:'left'},{id:'width',type:'distance',a:'bottom',value:String(width)},{id:'height',type:'distance',a:'right',value:String(height)},...points.slice(4).map(p=>({id:'fix'+p.id,type:'fix' as const,point:p.id}))];
 const sketch:SketchFeature={id:'s',type:'sketch',name:'Rectangle',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities,constraints};
 return {doc:applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:sketch}),at};
}
const sketch=(doc:PartDoc)=>doc.features[0] as SketchFeature;
const solve=(doc:PartDoc)=>solver.solve(resolveSketch(sketch(doc),doc),{analyze:true});
function operation(doc:PartDoc,id:string,click:P) {const result=extend(sketch(doc),solve(doc).geometry,new IdAllocator(doc.idCounters,idsInUse(doc)),id,click);if('error'in result)throw Error(result.error);return applyCommand(doc,{type:'editSketch',featureId:'s',...result.edit});}
function host(doc:PartDoc) {
 const history=new DocHistory(doc),notices:string[]=[];
 const payload=(s:SketchFeature,doc:PartDoc)=>({...solver.solve(resolveSketch(s,doc),{analyze:true}),seq:0,ms:0,problems:[]});
 const h:SketchHost={featureId:'s',doc:()=>history.doc,solved:()=>payload(sketch(history.doc),history.doc),execute:command=>{history.execute(command);return true;},dragPreview:()=>{},trial:async(s,d)=>payload(s,d??history.doc),notify:text=>void notices.push(text),editDimension:()=>{}};
 return {history,h,notices};
}
const curve=(geometry:ReadonlyMap<string,SolvedGeometry>,id:string)=>{const g=geometry.get(id);if(g?.type!=='line')throw Error('not a line');return g;};
it('extends a dimensioned closed rectangle to the nearest outer line without moving any original geometry, in one undo',async()=>{
 const {doc,at}=fixture(),{history,h,notices}=host(doc),controller=new SketchController(h),before=solve(doc);expect(before.status).toBe('fully');
 controller.setTool('extend');const input={p:at(19,0),px:0.05,ctrl:false,shift:false};controller.pointerDown(input);controller.pointerUp(input);await controller.settled();
 const after=solve(history.doc);expect(after.status).toBe('fully');expect(after.redundant).toEqual([]);expect(sketch(history.doc).constraints).toEqual(expect.arrayContaining(sketch(doc).constraints));expect(sketch(history.doc).entities).toEqual(expect.arrayContaining(sketch(doc).entities));
 for(const [id,g]of before.geometry)expect(after.geometry.get(id)).toEqual(g);
 const added=sketch(history.doc).entities.find(e=>e.type==='line'&&!sketch(doc).entities.some(old=>old.id===e.id))!;expect(curve(after.geometry,added.id).a).toEqual(at(20,0));expect(curve(after.geometry,added.id).b).toEqual(at(30,0));expect(notices).toEqual([expect.stringContaining('共用端點')]);
 history.undo();expect(history.doc).toEqual(doc);history.redo();expect(solve(history.doc).geometry.get(added.id)).toEqual(after.geometry.get(added.id));
});
it('can extend the start while retaining construction style, and extend a continuation further without duplicating the rectangle edge',()=>{
 const {doc,at}=fixture(),start=operation(doc,'bottom',at(1,0));const old=sketch(doc).entities;
 const added=sketch(start).entities.find(e=>e.type==='line'&&!old.some(p=>p.id===e.id))!,g=curve(solve(start).geometry,added.id);expect(g.a).toEqual(at(-10,0));expect(g.b).toEqual(at(0,0));
 const first=operation(doc,'bottom',at(19,0)),extension=sketch(first).entities.find(e=>e.type==='line'&&!old.some(p=>p.id===e.id))!;
 const duplicate=extend(sketch(first),solve(first).geometry,new IdAllocator(first.idCounters,idsInUse(first)),'bottom',at(19,0));expect(duplicate).toMatchObject({error:expect.stringContaining('重疊')});
 const further=operation(first,extension.id,at(29,0));expect(curve(solve(further).geometry,extension.id).b).toEqual(at(40,0));expect(curve(solve(further).geometry,'bottom').b).toEqual(at(20,0));expect(sketch(further).entities.length).toBe(sketch(first).entities.length);
 const construction=applyCommand(doc,{type:'setConstruction',featureId:'s',ids:['bottom'],value:true});const constructed=operation(construction,'bottom',at(19,0));expect(sketch(constructed).entities.filter(e=>e.type==='line'&&e.construction)).toHaveLength(2);
});
it('extends shared arc ends and starts by same-circle continuations without moving the original arc or neighbor',()=>{
 for(const atEnd of [true,false]) {
  const entities:SketchEntity[]=[point('o',[0,0]),point('arcStart',[5,0]),point('e',[0,5]),{id:'arc',type:'arc',center:'o',start:'arcStart',end:'e'},point('q',atEnd?[-2,5]:[5,-2]),line('neighbor',atEnd?'e':'arcStart','q'),point('w0',atEnd?[-3,-9]:[-9,-3]),point('w1',atEnd?[-3,9]:[9,-3]),line('wall','w0','w1')];
  const constraints:SketchConstraint[]=[{id:'fo',type:'fix',point:'o'},{id:'hs',type:'horizontal',a:'o',b:'arcStart'},{id:'ve',type:'vertical',a:'o',b:'e'},{id:'r',type:'radius',circle:'arc',value:'5'},...['q','w0','w1'].map(point=>({id:'fix'+point,type:'fix' as const,point}))];
  const s:SketchFeature={id:'s',type:'sketch',name:'Arcs',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities,constraints};const doc=applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:s}),before=solve(doc);expect(before.status).toBe('fully');
  const next=operation(doc,'arc',atEnd?[0,5]:[5,0]),after=solve(next);expect(after.status).toBe('fully');expect(after.geometry.get('arc')).toEqual(before.geometry.get('arc'));expect(after.geometry.get('neighbor')).toEqual(before.geometry.get('neighbor'));
  const added=sketch(next).entities.find(e=>e.type==='arc'&&e.id!=='arc')!,g=after.geometry.get(added.id)!;expect(g.type).toBe('arc');if(g.type==='arc'){expect(g.r).toBeCloseTo(5,10);expect(g.c).toEqual([0,0]);expect(Math.abs(g.a1-g.a0)).toBeLessThan(Math.PI);}
 }
});
it('rejects nonfinite clicks and existing collinear overlaps without changing the sketch',()=>{
 const {doc,at}=fixture(),g=solve(doc).geometry,ids=()=>new IdAllocator(doc.idCounters,idsInUse(doc));expect(extend(sketch(doc),g,ids(),'bottom',[NaN,0])).toMatchObject({error:expect.stringContaining('有限')});
 const overlap=applyCommand(doc,{type:'addSketchItems',featureId:'s',entities:[point('z',at(25,0)),line('occupied','b','z')],constraints:[]});
 expect(extend(sketch(overlap),solve(overlap).geometry,new IdAllocator(overlap.idCounters,idsInUse(overlap)),'bottom',at(19,0))).toMatchObject({error:expect.stringContaining('重疊')});
});
it('fuzzes 100 rotated, translated shared rectangles in both directions using the actual solver',()=>{
 let seed=194;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++){
  const width=.5+rand()*80,height=.5+rand()*50,gap=1+rand()*30,angle=(rand()-.5)*Math.PI*2,{doc,at}=fixture(width,height,gap,angle,true),before=solve(doc),end=i%2===0;
  expect(before.status).toBe('fully');const next=operation(doc,'bottom',at(end?width*.95:width*.05,0)),after=solve(next);expect(after.status,`case ${i}`).toBe('fully');
  for(const [id,g]of before.geometry)expect(after.geometry.get(id)).toEqual(g);
  const extra=sketch(next).entities.find(e=>e.type==='line'&&!sketch(doc).entities.some(old=>old.id===e.id))!,line=curve(after.geometry,extra.id),target=at(end?width+gap:-gap,0),actual=end?line.b:line.a;
  expect(Math.hypot(actual[0]-target[0],actual[1]-target[1])).toBeLessThan(1e-7);expect(after.redundant).toEqual([]);
 }
});
it('refuses shared arc continuations that overlap an already drawn arc or full circle',()=>{
 for(const circle of [false,true]) {
  const entities:SketchEntity[]=[point('o',[0,0]),point('arcStart',[5,0]),point('arcEnd',[0,5]),point('q',[-2,5]),point('w0',[-3,-9]),point('w1',[-3,9]),{id:'arc',type:'arc',center:'o',start:'arcStart',end:'arcEnd'},line('neighbor','arcEnd','q'),line('wall','w0','w1'),...(circle?[{id:'cover',type:'circle' as const,center:'o',radius:5}]:[point('opposite',[-5,0]),{id:'cover',type:'arc' as const,center:'o',start:'arcEnd',end:'opposite'}])];
  const constraints:SketchConstraint[]=[{id:'fo',type:'fix',point:'o'},{id:'hs',type:'horizontal',a:'o',b:'arcStart'},{id:'ve',type:'vertical',a:'o',b:'arcEnd'},{id:'radius',type:'radius',circle:'arc',value:'5'},...['q','w0','w1'].map(point=>({id:'fix'+point,type:'fix' as const,point})),...(circle?[{id:'rc',type:'radius' as const,circle:'cover',value:'5'}]:[{id:'oppositeHorizontal',type:'horizontal' as const,a:'o',b:'opposite'}])];
  const feature:SketchFeature={id:'s',type:'sketch',name:'arc overlaps',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities,constraints},doc=applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature}),solved=solve(doc);expect(solved.status).toBe('fully');
  expect(extend(sketch(doc),solved.geometry,new IdAllocator(doc.idCounters,idsInUse(doc)),'arc',[0,5])).toMatchObject({error:expect.stringContaining('重疊')});
 }
});
