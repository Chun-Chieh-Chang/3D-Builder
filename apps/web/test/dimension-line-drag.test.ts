import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { layoutDimension, mid, type Geometry } from '@3db/sketch/interact';
import { SketchController, type PointerInput, type SketchHost } from '../src/sketcher/controller';
let solver: PlaneGcsSolver;
beforeAll(async () => { solver = await PlaneGcsSolver.create(); });
function setup() {
  const sketch: SketchFeature = { id:'s',type:'sketch',name:'s',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[{id:'a',type:'point',x:0,y:0},{id:'b',type:'point',x:20,y:0},{id:'l',type:'line',p1:'a',p2:'b'}],constraints:[{id:'fix',type:'fix',point:'a'},{id:'h',type:'horizontal',a:'l'},{id:'d',type:'distance',a:'l',value:'20'}] };
  const history = new DocHistory(applyCommand(createEmptyPart(),{type:'insertFeature',index:0,feature:sketch}));
  const solved = () => ({...solver.solve(resolveSketch(history.doc.features[0] as SketchFeature,history.doc)),seq:0,ms:0,problems:[]});
  let commands = 0;
  const host: SketchHost = {featureId:'s',doc:()=>history.doc,solved,execute:command=>{commands++;history.execute(command);return true;},dragPreview:()=>{},trial:async()=>solved(),notify:()=>{},editDimension:()=>{}};
  const controller = new SketchController(host);
  return {controller,history,solved,commands:()=>commands,sketch:()=>history.doc.features[0] as SketchFeature};
}
const input=(p:readonly [number,number]):PointerInput=>({p:[...p],px:0.05,ctrl:false,shift:false});
it('drags a real solved dimension line with live preview, unchanged geometry/value, and one undo',()=>{
  const h=setup(), geometry=h.solved().geometry;
  const initial=layoutDimension(h.sketch().constraints[2]!,geometry,0.05,[10,0])!;
  const from=mid(...initial.segments[2]!);
  h.controller.pointerDown(input(from));h.controller.pointerMove(input([from[0]+3,from[1]-5]),true);
  expect(h.commands()).toBe(0);expect(h.controller.getView().dimensionDrag?.position).toEqual([initial.text[0]+3,initial.text[1]-5]);
  h.controller.pointerUp(input([from[0]+3,from[1]-5]));expect(h.commands()).toBe(1);
  const dim=h.sketch().constraints[2]!;expect(dim).toMatchObject({value:'20',labelPosition:[initial.text[0]+3,initial.text[1]-5]});
  const next=layoutDimension(dim,h.solved().geometry,0.05,[10,0])!;
  expect(next.segments[2]![0][1]-initial.segments[2]![0][1]).toBeCloseTo(-5,10);
  expect([...h.solved().geometry]).toEqual([...geometry]);h.history.undo();expect(h.sketch().constraints[2]).not.toHaveProperty('labelPosition');
});
it('click selects a dimension, Esc cancels its preview, and drawing geometry has priority at intersections',()=>{
  const h=setup(),layout=layoutDimension(h.sketch().constraints[2]!,h.solved().geometry,0.05,[10,0])!,from=mid(...layout.segments[2]!);
  h.controller.pointerDown(input(from));h.controller.pointerUp(input(from));expect(h.controller.getView().selection).toEqual(['d']);expect(h.commands()).toBe(0);
  h.controller.pointerDown(input(from));h.controller.pointerMove(input([10,-10]),true);h.controller.escape();h.controller.pointerUp(input([10,-10]));expect(h.commands()).toBe(0);expect(h.controller.getView().dimensionDrag).toBeUndefined();
  h.controller.pointerDown(input([10,0]));h.controller.pointerUp(input([10,0]));expect(h.controller.getView().selection).toEqual(['l']);
});
it('100 dimension placements move lines while preserving the two extension anchors at different zooms',()=>{
  const h=setup(),geometry=h.solved().geometry;
  for(let i=0;i<100;i++) {
    const px=0.01+(i%10)*0.013, position:[number,number]=[i*0.71-30,-3-i*0.13];
    for(const type of ['distance','distanceX','distanceY'] as const) {
      const c=type==='distance'?{id:'d',type,a:'l',value:'20',labelPosition:position}:{id:'d',type,a:'a',b:'b',value:'20',labelPosition:position};
      const layout=layoutDimension(c,geometry,px,[10,0])!;expect(layout.text).toEqual(position);expect(layout.segments[0]![0]).toEqual([0,0]);expect(layout.segments[1]![0]).toEqual([20,0]);
      const level=type==='distanceY'?0:1;expect(layout.segments[2]![0][level]).toBeCloseTo(position[level]!-10*px*(type==='distanceY'?-1:1),10);
    }
  }
});
it('radius, diameter, arc-length and angle graphics follow their label position around fixed geometry',()=>{
  const geometry:Geometry=new Map([
    ['a',{type:'point',p:[0,0],construction:false}],['b',{type:'point',p:[10,0],construction:false}],['c',{type:'point',p:[0,10],construction:false}],
    ['l1',{type:'line',a:[0,0],b:[10,0],p1:'a',p2:'b',construction:false}],['l2',{type:'line',a:[0,0],b:[0,10],p1:'a',p2:'c',construction:false}],
    ['circle',{type:'circle',c:[0,0],r:5,center:'a',construction:false}],['arc',{type:'arc',c:[0,0],r:5,a0:0,a1:Math.PI/2,center:'a',start:'b',end:'c',construction:false}],
  ]);
  for(const type of ['radius','diameter','arcLength'] as const) {
    const layout=layoutDimension({id:'d',type,circle:type==='arcLength'?'arc':'circle',value:'5',labelPosition:[-12,16]},geometry,0.05,[0,0])!;
    expect(layout.text).toEqual([-12,16]);expect(layout.segments.every(segment=>segment.flat().every(Number.isFinite))).toBe(true);
    expect(layout.segments.some(segment=>segment.some(p=>p[0]<-1))).toBe(type!=='arcLength');
  }
  const angle=layoutDimension({id:'d',type:'angle',a:'l1',b:'l2',value:'90',labelPosition:[12,16]},geometry,0.05,[0,0])!;
  expect(Math.hypot(...angle.segments[0]![0])).toBeCloseTo(20,10);
});
