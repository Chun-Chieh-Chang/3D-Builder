/** Research spike: section offsets with holes, several regions, inward offsets and collisions. No product API. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TopoDS_Shape, TopoDS_Wire } from 'libcascade/single/init';
import { Kernel, type Region, type ShapeId } from '@3db/kernel';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { inradiusBound, OffsetClearanceError } from '@3db/regen';
import { planarSegments } from './section-offset-envelope';
import { classifyLoops, OffsetCostError, regionFace, regionOffset, sideCheck } from './section-regions';

let k:Kernel;let initialHeap=0;const reports:Record<string,unknown>={};
const heap=()=>(k.oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength;
beforeAll(async()=>{k=await Kernel.load();initialHeap=heap();expect(initialHeap).toBeGreaterThan(0);});
afterAll(()=>{const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'offset-regions.json'),JSON.stringify({initialHeap,finalHeap:heap(),reports},null,2));});

const EPS=2e-6;
/** Extruded regions -> STEP round trip -> section loops at z = 2.5. */
function section(regions:Region[],a:Arena) {
  const oc=k.oc,raw=k as unknown as {get(id:ShapeId):TopoDS_Shape},ids:ShapeId[]=[];
  try{
    const src=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},regions,[0,0,5]).shape;ids.push(src);
    const imp=k.importStep(k.exportStep(src)).shape;ids.push(imp);
    const plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,2.5)),a.own(new oc.gp_Dir(0,0,1))));
    const cut=a.own(new oc.BRepAlgoAPI_Section(raw.get(imp),plane,false));cut.Approximation(true);cut.ComputePCurveOn2(true);cut.Build();if(!cut.IsDone())throw Error('section');
    const edges=ShapeIndex.of(oc,a.own(cut.Shape()),'TopAbs_EDGE',a),seq=a.own(new oc.NCollection_HSequence_TopoDS_Shape());try{for(const e of edges.keys)seq.Append(e);}finally{edges.dispose();}
    const ws=a.own(a.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(seq,1e-7,false)).Sequence()),wires:TopoDS_Wire[]=[];
    for(let i=1;i<=ws.Length();i++)wires.push(a.own(oc.TopoDS.Wire(a.own(ws.Value(i)))));
    return {wires,plane};
  }finally{for(const id of ids)k.release(id);}
}
const circle=(c:[number,number],r:number)=>({kind:'circle' as const,c,r,source:'t'});
const disc=(c:[number,number],r:number,holes:number[]=[]):Region=>({outer:[circle(c,r)],holes:holes.map(h=>[circle(c,h)])});
const gear=(bore:number):Region=>toothedProfile({kind:'gear',module:1,teeth:24,pressureAngle:20*Math.PI/180,width:5,bore,backlash:0,baseHeight:0});
/** Two discs r = 3 at x = +-5 joined by a neck 1 mm wide. */
function dumbbell():Region{
  const x=5-Math.sqrt(9-0.25);
  return {outer:[{kind:'arc',c:[5,0],r:3,from:[x,-0.5],to:[x,0.5],ccw:true,source:'t'},{kind:'line',a:[x,0.5],b:[-x,0.5],source:'t'},
    {kind:'arc',c:[-5,0],r:3,from:[-x,0.5],to:[-x,-0.5],ccw:true,source:'t'},{kind:'line',a:[-x,-0.5],b:[x,-0.5],source:'t'}],holes:[]};
}
function run<T>(f:(a:Arena)=>T){const a=new Arena();try{return f(a);}finally{a.dispose();expect(k.liveShapes).toBe(0);}}

it('classifies outer loops, holes and islands inside holes',()=>run(a=>{
  const g=section([gear(6)],a);expect(classifyLoops(k,g.wires,g.plane,a).map(r=>r.holes.length)).toEqual([1]);
  const s=section([disc([0,0],10,[6]),disc([0,0],3),disc([30,0],2)],a),r=classifyLoops(k,s.wires,s.plane,a);
  expect(s.wires.length).toBe(4);expect(r.length).toBe(3);expect(r.map(x=>x.holes.length).sort()).toEqual([0,0,1]);
}),60000);

it('rejects open, touching and empty loop sets explicitly',()=>run(a=>{
  const oc=k.oc,P=(x:number,y:number)=>a.own(new oc.gp_Pnt(x,y,0)),plane=a.own(new oc.gp_Pln(P(0,0),a.own(new oc.gp_Dir(0,0,1))));
  const sq=(x:number)=>a.own(a.own(new oc.BRepBuilderAPI_MakePolygon(P(x,0),P(x+1,0),P(x+1,1),P(x,1),true)).Wire());
  const open=a.own(a.own(new oc.BRepBuilderAPI_MakePolygon(P(0,0),P(1,0),P(1,1),false)).Wire());
  expect(()=>classifyLoops(k,[],plane,a)).toThrow('no section loops');
  expect(()=>classifyLoops(k,[open],plane,a)).toThrow('open section loop');
  expect(()=>classifyLoops(k,[sq(0),sq(1)],plane,a)).toThrow('touch or cross');
  expect(()=>classifyLoops(k,[sq(0),sq(2)],plane,a)).not.toThrow();
  const s=section([disc([0,0],3)],a);
  for(const g of [0,-1,NaN])expect(()=>regionOffset(k,s.wires,s.plane,g,'out',EPS,a,{mode:'biarc'})).toThrow('positive finite gap');
  expect(()=>regionOffset(k,s.wires,s.plane,1,'up' as 'out',EPS,a,{mode:'biarc'})).toThrow('side must be');
}),60000);

it('offsets a clockwise full circle to the correct side (OCCT offsets it the wrong way unless rebuilt)',()=>run(a=>{
  const oc=k.oc,P=(x:number,y:number)=>a.own(new oc.gp_Pnt(x,y,0)),plane=a.own(new oc.gp_Pln(P(0,0),a.own(new oc.gp_Dir(0,0,1))));
  for(const z of [1,-1]){
    const c=a.own(new oc.gp_Circ(a.own(new oc.gp_Ax2(P(0,0),a.own(new oc.gp_Dir(0,0,z)))),3)),w=a.own(a.own(new oc.BRepBuilderAPI_MakeWire(a.own(a.own(new oc.BRepBuilderAPI_MakeEdge(c)).Edge()))).Wire());
    expect(regionOffset(k,[w],plane,0.5,'out',EPS,a,{mode:'biarc'}).area.result).toBeCloseTo(Math.PI*3.5**2,9);
    expect(regionOffset(k,[w],plane,0.5,'in',EPS,a,{mode:'biarc'}).area.result).toBeCloseTo(Math.PI*2.5**2,9);
  }
}),60000);

it.each([[0.1,2],[0.5,2],[2.9,2],[3.1,1]] as [number,number][])('grows a gear with a 6 mm bore by %s mm: the bore shrinks, and closes past 3 mm',(gap,loops)=>run(a=>{
  const t0=Date.now(),s=section([gear(6)],a),r=regionOffset(k,s.wires,s.plane,gap,'out',EPS,a,{mode:'biarc'});
  expect(r.regions).toEqual([{holes:1,resultLoops:loops,resultFaces:1,vanished:false}]);
  expect(r.minDistance).toBeGreaterThanOrEqual(gap-1e-6);expect(r.certificate!.maxUpper).toBeLessThanOrEqual(gap+1e-5);
  reports[`gear out ${gap}`]={...r,shape:undefined,certificate:{maxUpper:r.certificate!.maxUpper,edges:r.certificate!.edges},ms:Date.now()-t0};
}),170000);

it('shrinks a gear with a bore by 0.5 mm, and refuses 0.9 mm where the teeth vanish and OCCT leaves stubs',()=>run(a=>{
  const s=section([gear(6)],a),r=regionOffset(k,s.wires,s.plane,0.5,'in',EPS,a,{mode:'biarc'});
  expect(r.regions).toEqual([{holes:1,resultLoops:2,resultFaces:1,vanished:false}]);expect(r.minDistance).toBeGreaterThanOrEqual(0.5-1e-6);
  expect(()=>regionOffset(k,s.wires,s.plane,0.9,'in',EPS,a,{mode:'biarc'})).toThrow(OffsetClearanceError);
  reports['gear in 0.5']={area:r.area,approxEdges:r.approxEdges,maxUpper:r.certificate!.maxUpper};
}),170000);

it('reports a region that an inward offset removes, only with a proven inradius bound',()=>run(a=>{
  const s=section([disc([0,0],2),disc([10,0],4)],a),r=regionOffset(k,s.wires,s.plane,2.5,'in',EPS,a,{mode:'biarc'});
  const gone=r.regions.find(x=>x.vanished)!;expect(r.regions.filter(x=>x.vanished).length).toBe(1);
  expect(gone.inradius!.bound).toBeLessThan(2.5);expect(gone.inradius!.sampled).toBeLessThanOrEqual(2+1e-9);
  expect(r.faces).toBe(1);expect(r.area.result).toBeCloseTo(Math.PI*1.5**2,6);
  reports['vanish']=r.regions;
}),120000);

it('does not claim a region vanished when the inradius bound cannot prove it',()=>run(a=>{
  // Inradius 2. At 2.01 the finest grid bound (sampled + h/sqrt 2, h = gap/64) is 2.008, so the vanish is proven; at
  // 2.001 it is not, and the offset is refused rather than guessed.
  const s=section([disc([0,0],2)],a),r=regionOffset(k,s.wires,s.plane,2.01,'in',EPS,a,{mode:'biarc'});
  expect(r.regions[0]!.vanished).toBe(true);expect(r.faces).toBe(0);expect(r.certificate).toBeNull();expect(r.regions[0]!.inradius!.bound).toBeLessThan(2.01);
  expect(()=>regionOffset(k,s.wires,s.plane,2.001,'in',EPS,a,{mode:'biarc'})).toThrow('offset failed');
  // A thin region with a large box: the grid that would prove anything is past the point budget, so no bound at all.
  const ring=section([disc([0,0],10,[9.98])],a),segs=ring.wires.flatMap(w=>planarSegments(k,w,a));
  expect(inradiusBound(segs,0.0101/4)).toBeNull();expect(inradiusBound(segs,0.5)).not.toBeNull();
}),120000);

it('side check rejects a result on the wrong side of the source, both ways',()=>run(a=>{
  const oc=k.oc,P=(x:number,y:number)=>a.own(new oc.gp_Pnt(x,y,0)),plane=a.own(new oc.gp_Pln(P(0,0),a.own(new oc.gp_Dir(0,0,1))));
  const loop=(r:number)=>a.own(a.own(new oc.BRepBuilderAPI_MakeWire(a.own(a.own(new oc.BRepBuilderAPI_MakeEdge(a.own(new oc.gp_Circ(a.own(new oc.gp_Ax2(P(0,0),a.own(new oc.gp_Dir(0,0,1)))),r)))).Edge()))).Wire());
  const src=loop(3),srcFace=regionFace(k,plane,src,[],a),big=regionFace(k,plane,loop(3.5),[],a),small=regionFace(k,plane,loop(2.5),[],a);
  expect(()=>sideCheck(k,'out',[srcFace],[src],big,a)).not.toThrow();expect(()=>sideCheck(k,'out',[srcFace],[src],small,a)).toThrow('wrong side');
  expect(()=>sideCheck(k,'in',[srcFace],[src],small,a)).not.toThrow();expect(()=>sideCheck(k,'in',[srcFace],[src],big,a)).toThrow('wrong side');
  // a ring the size of the source shell: area grows, but the source loop is not inside it
  const ring=regionFace(k,plane,loop(4),[loop(3.2)],a);expect(()=>sideCheck(k,'out',[srcFace],[src],ring,a)).toThrow('wrong side');
  expect(()=>sideCheck(k,'in',[srcFace],[src],null,a)).not.toThrow();expect(()=>sideCheck(k,'out',[srcFace],[src],null,a)).toThrow('wrong side');
}),60000);

it('shrinks rings of concentric circles loop by loop (OCCT aborts on them), and reports a ring that closes',()=>run(a=>{
  const ring=section([disc([0,0],10,[9.98])],a),washer=section([disc([0,0],10,[6])],a);
  const thin=regionOffset(k,ring.wires,ring.plane,0.0099,'in',EPS,a,{mode:'biarc'});
  expect(thin.faces).toBe(1);expect(thin.area.result).toBeCloseTo(Math.PI*(9.9901**2-9.9899**2),7);expect(thin.minDistance).toBeGreaterThanOrEqual(0.0099-1e-6);
  const gone=regionOffset(k,ring.wires,ring.plane,0.0101,'in',EPS,a,{mode:'biarc'});expect([gone.faces,gone.regions[0]!.vanished]).toEqual([0,true]);
  // past the outer radius the outer circle itself cannot be shrunk; a circle no larger than the gap is gone exactly
  expect(regionOffset(k,washer.wires,washer.plane,10.5,'in',EPS,a,{mode:'biarc'}).regions[0]!.vanished).toBe(true);
  const w=regionOffset(k,washer.wires,washer.plane,0.5,'in',EPS,a,{mode:'biarc'});
  expect(w.regions).toEqual([{holes:1,resultLoops:2,resultFaces:1,vanished:false}]);expect(w.area.result).toBeCloseTo(Math.PI*(9.5**2-6.5**2),7);
  expect(w.certificate!.maxUpper).toBeLessThanOrEqual(0.5+1e-5);
  // outward OCCT handles them as one face
  expect(regionOffset(k,washer.wires,washer.plane,0.5,'out',EPS,a,{mode:'biarc'}).area.result).toBeCloseTo(Math.PI*(10.5**2-5.5**2),7);
}),120000);

it('splits a dumbbell at its 1 mm neck when shrunk by 0.6 mm',()=>run(a=>{
  const s=section([dumbbell()],a),thin=regionOffset(k,s.wires,s.plane,0.4,'in',EPS,a,{mode:'biarc'}),cut=regionOffset(k,s.wires,s.plane,0.6,'in',EPS,a,{mode:'biarc'});
  expect(thin.faces).toBe(1);expect(cut.faces).toBe(2);expect(cut.regions[0]!.resultLoops).toBe(2);expect(cut.minDistance).toBeGreaterThanOrEqual(0.6-1e-6);
}),120000);

it('fuses two regions whose outward offsets collide, and keeps the gap to both',()=>run(a=>{
  const s=section([disc([-3,0],2),disc([3,0],2)],a);
  const apart=regionOffset(k,s.wires,s.plane,0.6,'out',EPS,a,{mode:'biarc'}),joined=regionOffset(k,s.wires,s.plane,1.2,'out',EPS,a,{mode:'biarc'});
  expect([apart.faces,apart.merged]).toEqual([2,0]);expect([joined.faces,joined.merged]).toEqual([1,1]);
  expect(joined.minDistance).toBeGreaterThanOrEqual(1.2-1e-6);expect(joined.certificate!.maxUpper).toBeLessThanOrEqual(1.2+1e-5);
  expect(joined.area.result).toBeLessThan(2*Math.PI*3.2**2);expect(joined.area.result).toBeGreaterThan(Math.PI*3.2**2);
}),120000);

it('refuses before offsetting when the approximation needs more edges than the limit',()=>run(a=>{
  const s=section([gear(6)],a),ok=regionOffset(k,s.wires,s.plane,0.1,'out',EPS,a,{mode:'biarc'});
  expect(()=>regionOffset(k,s.wires,s.plane,0.1,'out',EPS,a,{mode:'biarc',maxEdges:ok.approxEdges-1})).toThrow(OffsetCostError);
  expect(()=>regionOffset(k,s.wires,s.plane,0.1,'out',EPS,a,{mode:'biarc',maxEdges:ok.approxEdges})).not.toThrow();
  // the source check comes before any approximation, so it is cheap
  const t=Date.now();let err:unknown;try{regionOffset(k,s.wires,s.plane,0.1,'out',EPS,a,{mode:'biarc',maxSourcePieces:ok.sourcePieces-1});}catch(e){err=e;}
  expect(err).toBeInstanceOf(OffsetCostError);expect((err as OffsetCostError).stage).toBe('source');expect(Date.now()-t).toBeLessThan(ok.timings.approximate);
}),170000);
