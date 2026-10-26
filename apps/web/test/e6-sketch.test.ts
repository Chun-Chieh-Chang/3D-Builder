import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type SketchHost } from '../src/sketcher/controller';
import { DEFAULT_SNAPS } from '@3db/sketch/snaps';
import { parseOptions } from '../src/options';
import { modelDimensionFields } from '../src/state/modelDimensions';
let solver:PlaneGcsSolver;
beforeAll(async()=>{solver=await PlaneGcsSolver.create();});
function host(automaticRelations:boolean):SketchHost {
  const history=new DocHistory(applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:{id:'s',type:'sketch',name:'Sketch',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[],constraints:[]}}));
  const sketch=()=>history.doc.features[0] as SketchFeature;
  const solved=()=>({...solver.solve(resolveSketch(sketch(),history.doc),{analyze:true}),seq:0,ms:0,problems:[]});
  return {featureId:'s',doc:()=>history.doc,solved,automaticRelations:()=>automaticRelations,snapSettings:()=>DEFAULT_SNAPS,execute:cmd=>{history.execute(cmd);return true;},dragPreview:()=>{},trial:async()=>solved(),notify:()=>{},editDimension:()=>{}};
}
function click(c:SketchController,x:number,y:number) {const p={p:[x,y] as [number,number],px:.05,ctrl:false,shift:false};c.pointerMove(p,false);c.pointerDown(p);c.pointerUp(p);}
it('keeps snapping on while automatic relations are independently disabled; explicit chains stay connected',()=>{
 for(const automatic of [false,true]) {
  const h=host(automatic),c=new SketchController(h);c.setTool('line');click(c,0,0);click(c,10,.02);click(c,10,10);
  const sketch=h.doc().features[0] as SketchFeature,lines=sketch.entities.filter(e=>e.type==='line');
  expect(lines).toHaveLength(2);expect(lines[0]!.p2).toBe(lines[1]!.p1);
  expect(sketch.constraints.length>0).toBe(automatic);
  expect(parseOptions({automaticRelations:automatic}).automaticRelations).toBe(automatic);
  expect(parseOptions({automaticRelations:automatic}).snap.enabled).toBe(true);
 }
});
it('selects actual underdefined entities from PlaneGCS rather than guessing from sketch-wide DOF',()=>{
 const h=host(true);h.execute({type:'addSketchItems',featureId:'s',entities:[{id:'fixed',type:'point',x:0,y:0},{id:'free',type:'point',x:10,y:10}],constraints:[{id:'fix',type:'fix',point:'fixed'}]});
 const c=new SketchController(h);c.selectUnderdefined();expect(c.getView().selection).toEqual(['free']);
});
it('model dimension fields create real validated commands and preserve the SSOT',()=>{
 const h=host(true);h.execute({type:'insertFeature',index:1,feature:{id:'ex',type:'extrude',name:'Boss',suppressed:false,sketch:'s',op:'boss',dir1:{type:'blind',depth:'10'}}});
 const doc=h.doc(),f=doc.features[1]!,field=modelDimensionFields(doc,f)[0]!;
 expect(field.value).toBe('10');expect(()=>applyCommand(doc,field.command('-2'))).toThrow();
 const next=applyCommand(doc,field.command('17'));expect(modelDimensionFields(next,next.features[1]!)[0]!.value).toBe('17');expect(field.value).toBe('10');
});
