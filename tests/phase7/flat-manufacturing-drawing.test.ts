import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, applyDrawingCommand, createEmptyDrawing, DrawingHistory, page, parseDrawing, serializeDrawing, viewVectors, type Feature, type ViewFeature } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, flatPattern, flatDrawingGeometry, elementFacts, viewFeatures, viewEdges } from '@3db/regen';
import { buildScene, flatViewLines, toDxf, readDxf, toSvg, toPdf, evaluateDimension, type PlacedView } from '@3db/drawing';
import { rectangle, sketch, front, circle } from '../phase1/builders';
let k:Kernel,solver:PlaneGcsSolver;
beforeAll(async()=>{k=await Kernel.load();solver=await PlaneGcsSolver.create();});
const make=(x=50):Feature[]=>[sketch('s',front,rectangle('r',0,0,100,50),circle('h',20,20,3)),{id:'base',type:'baseFlange',name:'base',suppressed:false,sketch:'s',thickness:'1.5',radius:'2',kFactor:'0.5'},sketch('b',front,{entities:[{id:'p',type:'point',x,y:0},{id:'q',type:'point',x,y:50},{id:'l',type:'line',p1:'p',p2:'q'}],constraints:[]}),{id:'bend',type:'midBend',name:'bend',suppressed:false,sketch:'b',angle:'90'}];
const doc=()=>applyDrawingCommand(createEmptyDrawing(),{type:'insertViews',views:[{id:'v',name:'Flat',source:'plate.3dbx',direction:'flat',flatBends:{notes:true,table:true,at:[280,220]}}]});
it('native normalized flat topology supplies overall, hole and edge dimensions; annotations share true bend data with exports',()=>{
 const reg=new Regenerator(k,solver,new Map());
 try{
  const model=make().reduce((d,feature,index)=>applyCommand(d,{type:'insertFeature',feature,index}),createEmptyPart());
  const r=reg.rebuild(model);expect(r.features.filter(f=>f.status!=='ok')).toEqual([]);
  const p=flatPattern(k,r.sheet!);const flat=flatDrawingGeometry(k,r.sheet!,r.body);
  try{
   const axes=viewVectors('flat');const features=viewFeatures(flat.topology,flat.names,axes);
   const planes=features.filter((f):f is Extract<ViewFeature,{type:'plane'}>=>f.type==='plane'&&f.axis==='x').sort((a,b)=>a.coord-b.coord);
   const a=planes[0]!,b=planes.at(-1)!;expect(a.coord).toBeCloseTo(0,6);expect(b.coord).toBeCloseTo(100,6);
   const placed:PlacedView={id:'v',at:[100,100],centre:[50,25],scale:1,w:100,h:50};
   const facts=[a.ref,b.ref].map(ref=>elementFacts(flat.topology,flat.names,ref));expect(facts.every(f=>!('error'in f))).toBe(true);
   const result=evaluateDimension({id:'dim',kind:'linear',view:'v',a:a.ref,b:b.ref,orientation:'horizontal',offset:15},{elements:facts as never},axes,placed);expect(result).toMatchObject({value:100});
   expect(viewEdges(k,flat.shape,flat.topology,flat.names,axes).edges.length).toBeGreaterThan(4);
   expect(features.some(f=>f.type==='circle'&&Math.abs(f.radius-3)<1e-6&&Math.abs(f.centre[0]-20)<1e-6)).toBe(true);
   const holeFeature=features.find((f):f is Extract<ViewFeature,{type:'circle'}>=>f.type==='circle'&&Math.abs(f.radius-3)<1e-6)!;
   expect(holeFeature.ref.name).toContain('@flat:source:');
   const changed=make().map(f=>f.id==='s'?sketch('s',front,rectangle('r',0,0,140,50),circle('h',20,20,4)):f);
   const updated=reg.rebuild(changed.reduce((d,feature,index)=>applyCommand(d,{type:'insertFeature',feature,index}),createEmptyPart()));
   expect(updated.features.filter(f=>f.status!=='ok')).toEqual([]);
   const next=flatDrawingGeometry(k,updated.sheet!,updated.body);
   try {
     const facts=[a.ref,b.ref].map(ref=>elementFacts(next.topology,next.names,ref));
     expect(evaluateDimension({id:'dim',kind:'linear',view:'v',a:a.ref,b:b.ref,orientation:'horizontal',offset:15},{elements:facts as never},axes,placed)).toMatchObject({value:140});
     const holeFacts=elementFacts(next.topology,next.names,holeFeature.ref);
     expect(holeFacts).toMatchObject({radius:4});
   } finally { k.release(next.shape); }
   const lines=flatViewLines(p);expect(lines.bends?.[0]).toMatchObject({id:'bend:bend',direction:'up',radius:2,allowance:expect.closeTo(Math.PI*2.75/2,8)});
   const scene=buildScene(doc(),new Map([['v',lines]])).scene;
   const texts=scene.items.filter(i=>i.kind==='text').map(i=>i.text);
   expect(texts.some(t=>t.startsWith('B1 ')&&t.includes('90°')&&t.includes('R2'))).toBe(true);
   expect(texts).toContain('4.32');
   const dxf=readDxf(toDxf(scene));expect(dxf.entities.some(e=>e.type==='TEXT'&&'text'in e&&String(e.text).includes('B1'))).toBe(true);
   expect(toSvg(scene)).toContain('B1');expect(new TextDecoder().decode(toPdf(scene).bytes)).toContain('B1');
  }finally{k.release(flat.shape);k.release(p.shape);}
 }finally{reg.dispose();}
});
it('bend annotation controls validate finite placement and persist with undo, reset and legacy migration',()=>{
 const h=new DrawingHistory(doc());const initial=serializeDrawing(h.doc);
 expect(()=>h.execute({type:'setView',viewId:'v',patch:{flatBends:{notes:true,table:true,at:[NaN,0]}}})).toThrow();expect(serializeDrawing(h.doc)).toBe(initial);
 h.execute({type:'setView',viewId:'v',patch:{flatBends:{notes:false,table:true,at:[240,180]}}});expect(page(h.doc).views[0]!.flatBends!.at).toEqual([240,180]);
 h.undo();expect(page(h.doc).views[0]!.flatBends!.at).toEqual([280,220]);h.redo();
 expect(parseDrawing(serializeDrawing(h.doc))).toEqual(h.doc);
 h.execute({type:'setView',viewId:'v',patch:{flatBends:null}});expect(page(h.doc).views[0]!.flatBends).toBeUndefined();
});
it('never lets manufacturing dimensions silently become folded-model dimensions when the view changes',()=>{
 const d=applyDrawingCommand(doc(),{type:'insertDimensions',dimensions:[{id:'d1',view:'v',kind:'linear',orientation:'horizontal',offset:10,a:{kind:'face',name:'@flat:extent:0:min'},b:{kind:'face',name:'@flat:extent:0:max'}}]});
 const before=serializeDrawing(d);expect(()=>applyDrawingCommand(d,{type:'setView',viewId:'v',patch:{direction:'front'}})).toThrow();expect(serializeDrawing(d)).toBe(before);
 expect(()=>applyDrawingCommand(doc(),{type:'insertDimensions',dimensions:[{id:'bad',view:'v',kind:'diameter',ref:{kind:'face',name:'folded:face'},angle:45}]})).toThrow();
 const changed=applyDrawingCommand(doc(),{type:'setView',viewId:'v',patch:{direction:'front'}});expect(page(changed).views[0]!.flatBends).toBeUndefined();
});
