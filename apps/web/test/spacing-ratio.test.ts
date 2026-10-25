import {beforeAll,expect,it} from 'vitest';
import {applyCommand,createEmptyPart,resolveSketch,serializePart,parsePart,SCHEMA_VERSION,removalSet,type SketchFeature,type SketchConstraint,type SketchEntity} from '@3db/model';
import {PlaneGcsSolver} from '@3db/sketch';
import {applicableRelations,sameRelation} from '@3db/sketch/interact';
let solver:PlaneGcsSolver;beforeAll(async()=>{solver=await PlaneGcsSolver.create();});
const sketch=(entities:SketchEntity[],constraints:SketchConstraint[]):SketchFeature=>({id:'sk',type:'sketch',name:'spacing',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities,constraints});
const doc=(f:SketchFeature)=>applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:f});
const lines=(ratio='2')=>sketch([{id:'a',type:'point',x:0,y:0},{id:'b',type:'point',x:10,y:0},{id:'c',type:'point',x:0,y:10},{id:'d',type:'point',x:6,y:10},{id:'l1',type:'line',p1:'a',p2:'b'},{id:'l2',type:'line',p1:'c',p2:'d'}],[{id:'fa',type:'fix',point:'a'},{id:'fb',type:'fix',point:'b'},{id:'fc',type:'fix',point:'c'},{id:'h',type:'horizontal',a:'l2'},{id:'ratio',type:'lengthRatio',a:'l1',b:'l2',ratio}]);
const length=(g:any)=>Math.hypot(g.b[0]-g.a[0],g.b[1]-g.a[1]);
it('solves a ratio with two variable lengths and follows dimension and ratio edits',()=>{
 let f=lines(),d=doc(f);let r=solver.solve(resolveSketch(f,d));expect(r.status).toBe('fully');expect(length(r.geometry.get('l2'))).toBeCloseTo(5,8);
 d=applyCommand(d,{type:'setLengthRatio',featureId:'sk',constraintId:'ratio',ratio:'0.5'});f=d.features[0] as SketchFeature;r=solver.solve(resolveSketch(f,d));expect(r.status).toBe('fully');expect(length(r.geometry.get('l2'))).toBeCloseTo(20,8);
 const base=lines();base.constraints=base.constraints.filter(c=>c.id!=='fb');base.constraints.push({id:'h1',type:'horizontal',a:'l1'},{id:'dim',type:'distance',a:'l2',value:'7'});d=doc(base);r=solver.solve(resolveSketch(base,d));expect(r.status).toBe('fully');expect(length(r.geometry.get('l1'))).toBeCloseTo(14,8);
 d=applyCommand(d,{type:'setDimension',featureId:'sk',constraintId:'dim',value:'11'});r=solver.solve(resolveSketch(d.features[0] as SketchFeature,d));expect(length(r.geometry.get('l1'))).toBeCloseTo(22,8);
});
it('rejects invalid ratios on insert, add and edit; keeps fractions and expressions',()=>{
 for(const ratio of ['0','-2','NaN','Infinity','1e9','0.0001','2mm','2deg','']){expect(()=>doc(lines(ratio))).toThrow();const d=doc(lines());expect(()=>applyCommand(d,{type:'setLengthRatio',featureId:'sk',constraintId:'ratio',ratio})).toThrow();expect((d.features[0] as SketchFeature).constraints.find(c=>c.id==='ratio')).toMatchObject({ratio:'2'});}
 expect(()=>doc(lines('1/2'))).not.toThrow();
});
it('distributes ordered centers in 2D and follows a moved last point',()=>{
 const entities:SketchEntity[]=[],constraints:SketchConstraint[]=[];for(let i=0;i<5;i++){entities.push({id:'p'+i,type:'point',x:i*3,y:i%2*3},{id:'c'+i,type:'circle',center:'p'+i,radius:2});constraints.push({id:'r'+i,type:'radius',circle:'c'+i,value:'2'});}
 constraints.push({id:'fixA',type:'fix',point:'p0'},{id:'fixB',type:'fix',point:'p4'},{id:'spacing',type:'equalSpacing',points:['c0','c1','c2','c3','c4']});let f=sketch(entities,constraints),d=doc(f),r=solver.solve(f);expect(r.status).toBe('fully');for(let i=0;i<5;i++){const g=r.geometry.get('p'+i)!;if(g.type!=='point')throw Error('point absent');expect(g.p[0]).toBeCloseTo(3*i,8);expect(g.p[1]).toBeCloseTo(0,8);}
 d=applyCommand(d,{type:'editSketch',featureId:'sk',place:[{id:'p4',x:20,y:12}]});f=d.features[0] as SketchFeature;r=solver.solve(f);expect(r.status).toBe('fully');for(let i=0;i<5;i++){expect(r.geometry.get('p'+i)).toMatchObject({p:[5*i,3*i]});}
 expect(removalSet(f,['c2']).has('spacing')).toBe(true);
 expect(applicableRelations(r.geometry,['c0','c1','c2'],f).some(c=>c.type==='equalSpacing')).toBe(true);
});
it('validates spacing references, uniqueness, order and budget; saves and loads the new relations',()=>{
 const p=(id:string,x:number):SketchEntity=>({id,type:'point',x,y:0});const base=sketch([p('a',0),p('b',1),p('c',2)],[]);
 for(const points of [[],['a','b'],['a','b','bad'],['a','b','a'],Array.from({length:33},(_,i)=>'p'+i)])expect(()=>doc({...base,constraints:[{id:'s',type:'equalSpacing',points}]})).toThrow();
 expect(sameRelation({type:'equalSpacing',points:['a','b','c']},{type:'equalSpacing',points:['a','c','b']})).toBe(false);
 const d=doc(lines());const loaded=parsePart(serializePart(d));expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);expect((loaded.features[0] as SketchFeature).constraints).toEqual((d.features[0] as SketchFeature).constraints);
});
it('fuzzes 100 variable length ratios and 100 rotated equal-spacing sets against exact geometry',()=>{
 let seed=195;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};for(let i=0;i<100;i++){
  const ratio=0.2+random()*8,f=lines(String(ratio)),r=solver.solve(resolveSketch(f,doc(f)));expect(r.status).toBe('fully');expect(length(r.geometry.get('l2'))).toBeCloseTo(10/ratio,7);
  const n=3+i%6,a=[random()*10,random()*10],b=[a[0]!+random()*40,a[1]!+random()*40],entities:SketchEntity[]=Array.from({length:n},(_,j)=>({id:'p'+j,type:'point',x:a[0]!+(b[0]!-a[0]!)*j/(n-1),y:a[1]!+(b[1]!-a[1]!)*j/(n-1)+(j>0&&j<n-1?random():0)})),constraints:SketchConstraint[]=[{id:'fa',type:'fix',point:'p0'},{id:'fb',type:'fix',point:'p'+(n-1)},{id:'s',type:'equalSpacing',points:entities.map(e=>e.id)}];const sr=solver.solve(sketch(entities,constraints));expect(sr.status).toBe('fully');for(let j=0;j<n;j++){const p=sr.geometry.get('p'+j)!;if(p.type!=='point')throw Error('no point');expect(p.p[0]).toBeCloseTo(a[0]!+(b[0]!-a[0]!)*j/(n-1),7);expect(p.p[1]).toBeCloseTo(a[1]!+(b[1]!-a[1]!)*j/(n-1),7);}
 }
});
