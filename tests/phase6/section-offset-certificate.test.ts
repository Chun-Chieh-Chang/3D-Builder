/** Research spike: an edge-by-edge clearance certificate for the explicit arc offset. No product API. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TopoDS_Shape } from 'libcascade/single/init';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { certifyOffset, planarSegments, sectionEnvelope, type Seg2 } from './section-offset-envelope';

type P=[number,number];
const line=(a:P,b:P):Seg2=>({kind:'line',a,b});
const arc=(c:P,r:number,t0:number,t1:number):Seg2=>{const at=(t:number):P=>[c[0]+r*Math.cos(t),c[1]+r*Math.sin(t)];return {kind:'arc',c,r,a:at(t0),m:at((t0+t1)/2),b:at(t1)};};
/** A 10 x 10 square and its exact outward offset: four shifted sides and four corner join arcs. */
function square(g:number) {
  const source=[line([0,0],[10,0]),line([10,0],[10,10]),line([10,10],[0,10]),line([0,10],[0,0])];
  const output=[line([0,-g],[10,-g]),arc([10,0],g,-Math.PI/2,0),line([10+g,0],[10+g,10]),arc([10,10],g,0,Math.PI/2),
    line([10,10+g],[0,10+g]),arc([0,10],g,Math.PI/2,Math.PI),line([-g,10],[-g,0]),arc([0,0],g,Math.PI,1.5*Math.PI)];
  return {source,output};
}

it('rejects invalid gaps, slack, empty and non-finite geometry explicitly',()=>{
  const {source,output}=square(0.1);
  for(const g of [0,-1,NaN,Infinity])expect(()=>certifyOffset(source,output,g,1e-9)).toThrow('positive finite gap');
  for(const s of [0,-1,NaN,0.1,1])expect(()=>certifyOffset(source,output,0.1,s)).toThrow('slack');
  expect(()=>certifyOffset([],output,0.1,1e-9)).toThrow('non-empty');
  expect(()=>certifyOffset(source,[line([NaN,0],[1,0])],0.1,1e-9)).toThrow('finite edge');
});

it('certifies an exact square offset with line and corner-join generators',()=>{
  const {source,output}=square(0.25),c=certifyOffset(source,output,0.25,1e-9);
  expect(c.failures).toEqual([]);expect(c.generators).toEqual({line:4,arc:0,vertex:4,lipschitz:0});
  expect(Math.abs(c.maxUpper-0.25)).toBeLessThan(1e-12);
});

it('certifies concentric arcs only inside the source span',()=>{
  const source=[arc([0,0],5,0,Math.PI),arc([0,0],5,Math.PI,2*Math.PI)],g=0.3;
  const ok=certifyOffset(source,[arc([0,0],5+g,0.1,3),arc([0,0],5+g,3.3,6.1)],g,1e-9);
  expect(ok.failures).toEqual([]);expect(ok.generators.arc).toBe(2);
  // An arc whose centre is off by 0.01 mm has no concentric generator, and no fallback can rescue it.
  const shifted=certifyOffset(source,[arc([0.01,0],5+g,0.1,3)],g,1e-9);
  expect(shifted.failures.length).toBe(1);expect(shifted.failures[0]!.best).toBeGreaterThan(g+1e-9);
});

it('fails on the three mutations it exists to catch',()=>{
  const g=0.25,{source,output}=square(g);
  // 1. Offset drawn at twice the gap.
  expect(certifyOffset(source,square(2*g).output,g,1e-9).failures.length).toBe(8);
  // 2. One corner arc centre moved by 1e-3 mm.
  const moved=output.map((s,i)=>i===1&&s.kind==='arc'?{...s,c:[s.c[0]+1e-3,s.c[1]] as P}:s);
  expect(certifyOffset(source,moved,g,1e-6).failures.map(f=>f.index)).toEqual([1]);
  // 3. A side extended past its source segment: the projection leaves the segment.
  const long=output.map((s,i)=>i===0?line([-1,-g],[10,-g]):s);
  expect(certifyOffset(source,long,g,1e-6).failures.map(f=>f.index)).toEqual([0]);
});

it('refuses a concentric arc that runs far past the end of its source arc',()=>{
  // Concentric with the source but swept 0.6 rad past its end: points there are far from every source point.
  const g=0.2,r=certifyOffset([arc([0,0],5,0,1)],[arc([0,0],5+g,0.2,1.6)],g,1e-6);
  expect(r.failures.map(f=>f.index)).toEqual([0]);
});

it('refuses a concentric arc whose ends lie in the source span but which goes the long way round',()=>{
  // Both ends inside [0, 1] rad, but the arc sweeps through the opposite side of the circle.
  const g=0.2,r=certifyOffset([arc([0,0],5,0,1)],[arc([0,0],5+g,0.9,2*Math.PI+0.1)],g,1e-6);
  expect(r.failures.map(f=>f.index)).toEqual([0]);
});

it('refuses a tilted line that touches the gap only at its midpoint',()=>{
  // The midpoint is exactly at the gap; the ends are about 1 mm away. A bound without the L/2 term would pass it.
  const g=0.1,r=certifyOffset([line([0,0],[10,0])],[line([4,-g-1],[6,-g+1])],g,1e-6);
  expect(r.failures.map(f=>f.index)).toEqual([0]);
});

let k:Kernel;const reports:Record<string,unknown>[]=[];let initialHeap=0;
const heap=()=>(k.oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength;
beforeAll(async()=>{k=await Kernel.load();initialHeap=heap();expect(initialHeap).toBeGreaterThan(0);});
afterAll(()=>{const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'offset-certificate.json'),JSON.stringify({initialHeap,finalHeap:heap(),reports},null,2));});

/** Gear STEP -> section -> explicit arc approximation -> MakeOffset; then certify every output edge. */
function gearCase(module:number,teeth:number,gap:number,bore=0) {
  const t0=Date.now(),oc=k.oc,a=new Arena(),raw=k as unknown as {get(id:ShapeId):TopoDS_Shape;put(s:TopoDS_Shape):ShapeId},ids:ShapeId[]=[];
  try {
    const source=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[toothedProfile({kind:'gear',module,teeth,pressureAngle:20*Math.PI/180,width:5,bore,backlash:0,baseHeight:0})],[0,0,5]).shape;ids.push(source);
    const imported=k.importStep(k.exportStep(source)).shape;ids.push(imported);
    const plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,2.5)),a.own(new oc.gp_Dir(0,0,1))));
    const cut=a.own(new oc.BRepAlgoAPI_Section(raw.get(imported),plane,false));cut.Approximation(true);cut.ComputePCurveOn2(true);cut.Build();if(!cut.IsDone())throw Error('section not done');
    const edges=ShapeIndex.of(oc,a.own(cut.Shape()),'TopAbs_EDGE',a),seq=a.own(new oc.NCollection_HSequence_TopoDS_Shape());
    try{for(const e of edges.keys)seq.Append(e);}finally{edges.dispose();}
    const wires=a.own(a.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(seq,1e-7,false)).Sequence());
    if(wires.Length()!==1)throw Error(`single-loop section required, got ${wires.Length()} loops`);
    const w=a.own(oc.TopoDS.Wire(a.own(wires.Value(1)))),approx=sectionEnvelope(k,w,2e-6,a,'arc');
    const am=a.own(new oc.BRepBuilderAPI_MakeFace(plane,approx.wire,true));if(!am.IsDone())throw Error('approximation face failed');
    const offset=a.own(new oc.BRepOffsetAPI_MakeOffset(a.own(am.Face()),oc.GeomAbs_JoinType.GeomAbs_Arc,false));offset.Perform(gap);if(!offset.IsDone())throw Error('offset failed');
    const out=a.own(offset.Shape()),ow=ShapeIndex.of(oc,out,'TopAbs_WIRE',a),outWires=ow.size;ow.dispose();
    if(outWires!==1)throw Error(`single offset loop required, got ${outWires}`);
    const src=planarSegments(k,approx.wire,a),dst=planarSegments(k,out,a),cert=certifyOffset(src,dst,gap,1e-5);
    const sourceId=raw.put(w.Oriented(w.Orientation())),approxId=raw.put(approx.wire.Oriented(approx.wire.Orientation())),outId=raw.put(out.Oriented(out.Orientation()));ids.push(sourceId,approxId,outId);
    const minToApprox=k.distance(approxId,outId).distance,minToSource=k.distance(sourceId,outId).distance;
    const wrongGap=certifyOffset(src,dst,gap*0.5,gap*0.25).failures.length;
    const report={module,teeth,gap,approxEdges:src.length,offsetEdges:dst.length,generators:cert.generators,failures:cert.failures.length,maxUpper:cert.maxUpper,
      representationErrorBound:approx.representationErrorBound,minToApprox,minToSource,clearance:[minToSource,cert.maxUpper+approx.representationErrorBound],refined:cert.refined,fallbackSampledMax:cert.sampledMax,wrongGapFailures:wrongGap,ms:Date.now()-t0,closest:k.distance(approxId,outId),sample:cert.failures.slice(0,6).map(f=>({...f,seg:dst[f.index]})),failKinds:cert.failures.reduce((m,f)=>{const kk=dst[f.index]!.kind;m[kk]=(m[kk]??0)+1;return m;},{} as Record<string,number>)};
    reports.push(report);return report;
  } finally {for(const id of ids)k.release(id);a.dispose();}
}

const cases:[number,number,number][]=[[1,24,0.05],[1,24,0.2],[0.5,18,0.01],[3,40,0.1]];
it.each(cases)('certifies every offset edge: module %s, %s teeth, gap %s mm',(module,teeth,gap)=>{
  const r=gearCase(module,teeth,gap);
  expect(r.failures).toBe(0);
  expect(r.offsetEdges).toBe(r.generators.line+r.generators.arc+r.generators.vertex+r.generators.lipschitz);
  expect(r.maxUpper).toBeLessThanOrEqual(gap+1e-5);
  expect(Math.abs(r.minToApprox-gap)).toBeLessThan(1e-6);
  // Two-sided clearance against the smooth section, over every tooth: [global minimum, certified maximum].
  // Lower side: the offset step against its own input, then the triangle inequality to the section.
  expect(r.clearance[0]).toBeGreaterThanOrEqual(gap-1e-6-r.representationErrorBound);expect(r.clearance[1]).toBeLessThanOrEqual(gap+1e-5+r.representationErrorBound);
  // The certificate must reject the same geometry when asked about the wrong gap.
  expect(r.wrongGapFailures).toBe(r.offsetEdges);
  expect(k.liveShapes).toBe(0);
},170000);

/** MakeOffset returned one closed, valid-looking wire in these cases, yet parts of it sit far inside the gap.
 * Only the global minimum catches it; a one-tooth sample, a valid solid and a volume check all pass. */
it.each([[3,40,0.3],[1,24,0.8]] as [number,number,number][])('detects a native offset that violates clearance: module %s, %s teeth, gap %s mm',(module,teeth,gap)=>{
  const r=gearCase(module,teeth,gap);
  expect(r.minToApprox).toBeLessThan(gap*0.6);
  expect(r.clearance[0]).toBeLessThan(gap-1e-3);
  expect(k.liveShapes).toBe(0);
},170000);

it('refuses a section with a bore hole explicitly instead of certifying one loop',()=>{
  expect(()=>gearCase(1,24,0.05,6)).toThrow('single-loop section required, got 2 loops');
  expect(k.liveShapes).toBe(0);
});
