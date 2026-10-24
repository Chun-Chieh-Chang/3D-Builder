import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type SketchHost } from '../src/sketcher/controller';
let solver:PlaneGcsSolver;beforeAll(async()=>{solver=await PlaneGcsSolver.create();});
function host() {
 const s:SketchFeature={id:'s',type:'sketch',name:'s',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[{id:'a',type:'point',x:0,y:0},{id:'b',type:'point',x:10,y:0},{id:'c',type:'point',x:10,y:10},{id:'ab',type:'line',p1:'a',p2:'b'},{id:'bc',type:'line',p1:'b',p2:'c'}],constraints:[{id:'fa',type:'fix',point:'a'},{id:'fc',type:'fix',point:'c'}]};
 const history=new DocHistory(applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:s}));
 const solve=(s:SketchFeature,options={})=>({...solver.solve(resolveSketch(s,history.doc),options),seq:0,ms:0,problems:[]});
 const notices:string[]=[];
 const h:SketchHost={featureId:'s',doc:()=>history.doc,solved:()=>solve(history.doc.features[0] as SketchFeature),execute:cmd=>{history.execute(cmd);return true;},dragPreview:()=>{},trial:async(s,doc,options)=>solve(s,options),notify:text=>void notices.push(text),editDimension:()=>{}};
 return {h,history,notices};
}
it('stretches a shared endpoint while both unselected endpoints stay fixed, in one undo step',async()=>{
 const {h,history,notices}=host(),c=new SketchController(h);c.select(['b']);c.setTool('stretchEntities');c.setOption('moveX',3);c.setOption('moveY',2);c.applyToolValues();await c.settled();
 expect(notices).toEqual([]);const result=h.solved()!;const p=(id:string)=>{const g=result.geometry.get(id)!;if(g.type!=='point')throw new Error('not a point');return g.p;};
 expect(p('a')).toEqual([0,0]);expect(p('b')).toEqual([13,2]);expect(p('c')).toEqual([10,10]);expect(history.doc.features[0]!.type).toBe('sketch');
 history.undo();const before=(history.doc.features[0] as SketchFeature).entities.find(e=>e.id==='b')!;expect(before).toMatchObject({x:10,y:0});
});
it('rejects empty/curve-only stretch selections and non-finite displacement explicitly',async()=>{
 const {h,notices,history}=host(),c=new SketchController(h);c.select(['ab']);c.setTool('stretchEntities');expect(c.getView().tool).toBe('select');expect(notices.length).toBeGreaterThan(0);
 const before=history.doc;c.select(['b']);c.setTool('stretchEntities');c.setOption('moveX',NaN);c.applyToolValues();await c.settled();expect(history.doc).toBe(before);expect(notices.length).toBeGreaterThan(1);
});
