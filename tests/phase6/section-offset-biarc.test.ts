/** Research spike: a tangent-continuous (biarc) approximation, and the two-stage offset that never returns a violation. No product API. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TopoDS_Shape } from 'libcascade/single/init';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { biarcEnvelope, certifyOffset, OffsetClearanceError, type EnvelopePiece, type Seg2 } from '@3db/regen';
import { checkedOffset, fallbackOffset, planarSegments, sectionEnvelope } from './section-offset-envelope';

let k:Kernel;let initialHeap=0;const reports:Record<string,unknown>={};
const heap=()=>(k.oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength;
beforeAll(async()=>{k=await Kernel.load();initialHeap=heap();expect(initialHeap).toBeGreaterThan(0);});
afterAll(()=>{const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'offset-biarc.json'),JSON.stringify({initialHeap,finalHeap:heap(),reports},null,2));});

type V=number[];
/** Distance from a point to a line or circular-arc envelope piece (arc through from, mid, to). */
function pieceDistance(p:V,piece:EnvelopePiece){
  const seg=(a:V,b:V)=>{const v=b.map((x,i)=>x-a[i]!),n=v.reduce((s,x)=>s+x*x,0),t=n===0?0:Math.max(0,Math.min(1,v.reduce((s,x,i)=>s+x*(p[i]!-a[i]!),0)/n));return Math.hypot(...p.map((x,i)=>x-a[i]!-t*v[i]!));};
  if(piece.kind==='line')return seg(piece.from,piece.to);
  const [a,m,b]=[piece.from,piece.mid,piece.to],ux=m[0]-a[0],uy=m[1]-a[1],vx=b[0]-a[0],vy=b[1]-a[1],det=2*(ux*vy-uy*vx);
  const uu=ux*ux+uy*uy,vv=vx*vx+vy*vy,cx=a[0]+(uu*vy-vv*uy)/det,cy=a[1]+(ux*vv-vx*uu)/det;
  const ax=a[0]-cx,ay=a[1]-cy,bx=b[0]-cx,by=b[1]-cy,mx=m[0]-cx,my=m[1]-cy,ang=(x:number,y:number)=>Math.atan2(ax*y-ay*x,ax*x+ay*y);
  const tb=ang(bx,by),tm=ang(mx,my),sweep=Math.sign(tm)===Math.sign(tb)&&Math.abs(tm)<Math.abs(tb)?tb:tb-Math.sign(tb)*2*Math.PI,t=ang(p[0]!-cx,p[1]!-cy);
  const inside=sweep>=0?(t>=0&&t<=sweep)||(t+2*Math.PI<=sweep):(t<=0&&t>=sweep)||(t-2*Math.PI>=sweep);
  return inside?Math.abs(Math.hypot(p[0]!-cx,p[1]!-cy)-Math.hypot(ax,ay)):Math.min(Math.hypot(p[0]!-a[0]!,p[1]!-a[1]!),Math.hypot(p[0]!-b[0]!,p[1]!-b[1]!));
}
/** Unit tangent of a piece at its start or end, in its own direction. */
function pieceTangent(piece:EnvelopePiece,atEnd:boolean):[number,number]{
  if(piece.kind==='line'){const v=[piece.to[0]-piece.from[0],piece.to[1]-piece.from[1]],n=Math.hypot(v[0]!,v[1]!);return [v[0]!/n,v[1]!/n];}
  const [a,m,b]=[piece.from,piece.mid,piece.to],ux=m[0]-a[0],uy=m[1]-a[1],vx=b[0]-a[0],vy=b[1]-a[1],det=2*(ux*vy-uy*vx);
  const uu=ux*ux+uy*uy,vv=vx*vx+vy*vy,cx=a[0]+(uu*vy-vv*uy)/det,cy=a[1]+(ux*vv-vx*uu)/det,p=atEnd?b:a,rx=p[0]-cx,ry=p[1]-cy,r=Math.hypot(rx,ry),s=det>0?1:-1;
  return [-s*ry/r,s*rx/r];
}

it('rejects invalid tolerances, weights, planes and degrees explicitly',()=>{
  const poles:[number,number,number,number][]=[[0,0,0,1],[0.5,1,0,1],[1,0,0,1]];
  for(const e of [0,-1,NaN,Infinity])expect(()=>biarcEnvelope(poles,e)).toThrow('positive finite');
  for(const w of [0,-1,NaN,Infinity])expect(()=>biarcEnvelope([[0,0,0,1],[1,1,0,w]],1e-6)).toThrow('positive weights');
  expect(()=>biarcEnvelope([[0,0,0,1],[1,1,1,1]],1e-6)).toThrow('XY planar');
  expect(()=>biarcEnvelope(Array.from({length:28},(_,i)=>[i,i%2,0,1] as [number,number,number,number]),1e-6)).toThrow('unsupported envelope degree');
});

it('fits a rational unit quarter-circle exactly with tangent-continuous arcs',()=>{
  const w=Math.SQRT1_2,r=biarcEnvelope([[1,0,0,1],[w,w,0,w],[0,1,0,1]],2e-6);
  expect(r.maxBound).toBeLessThan(1e-9);
  for(const p of r.pieces)for(const q of [p.from,p.mid,p.to])expect(Math.abs(Math.hypot(q[0]!,q[1]!)-1)).toBeLessThan(1e-9);
});

it('checks 100 random rational Beziers against the native curve both ways, with no kink inside a curve',()=>{
  const oc=k.oc;let seed=241,maxCurve=0,maxArc=0,maxBound=0,maxKink=0,arcs=0,pieces=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let c=0;c<100;c++){
    const a=new Arena(),width=0.5+10*random(),height=0.1+4*random(),count=3+c%4;
    try{
      const P=a.own(new oc.NCollection_Array1_gp_Pnt(1,count)),W=a.own(new oc.NCollection_Array1_double(1,count)),h:[number,number,number,number][]=[];
      for(let i=0;i<count;i++){const x=width*i/(count-1),y=i===0||i===count-1?0:height*random(),w=0.25+2*random();P.SetValue(i+1,a.own(new oc.gp_Pnt(x,y,0)));W.SetValue(i+1,w);h.push([x*w,y*w,0,w]);}
      const curve=a.own(new oc.Geom_BezierCurve(P,W)),r=biarcEnvelope(h,2e-6);
      expect(r.maxBound).toBeLessThanOrEqual(2e-6);maxBound=Math.max(maxBound,r.maxBound);arcs+=r.pieces.filter(p=>p.kind==='arc').length;pieces+=r.pieces.length;
      // curve to envelope
      for(let i=0;i<=100;i++){const q=a.own(curve.Value(i/100)),d=Math.min(...r.pieces.map(p=>pieceDistance([q.X(),q.Y(),q.Z()],p)));expect(d,`curve ${c}, sample ${i}`).toBeLessThanOrEqual(r.maxBound+1e-10);maxCurve=Math.max(maxCurve,d);}
      // envelope to curve, at the midpoint of five random pieces
      for(let i=0;i<5;i++){const p=r.pieces[Math.floor(random()*r.pieces.length)]!,m=a.own(new oc.gp_Pnt(p.mid[0]!,p.mid[1]!,p.mid[2]!)),pr=a.own(new oc.GeomAPI_ProjectPointOnCurve(m,curve));expect(pr.NbPoints()).toBeGreaterThan(0);const d=pr.LowerDistance();expect(d,`piece ${c}`).toBeLessThanOrEqual(r.maxBound+1e-10);maxArc=Math.max(maxArc,d);}
      // tangent continuity at every junction inside the curve: far below the 5e-5 rad where the offset trouble starts (the
      // residue is the round-off of recovering a large-radius arc from three points). Short leaves may be lines.
      for(let i=1;i<r.pieces.length;i++){const u=pieceTangent(r.pieces[i-1]!,true),v=pieceTangent(r.pieces[i]!,false),kink=Math.abs(Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]));
        if(r.pieces[i-1]!.kind==='arc'&&r.pieces[i]!.kind==='arc'){expect(kink,`curve ${c}, junction ${i}`).toBeLessThan(1e-6);maxKink=Math.max(maxKink,kink);}}
    }finally{a.dispose();}
  }
  reports.fuzz={cases:100,pieces,arcs,maxBound,maxCurve,maxArc,maxKink};
  expect(arcs).toBeGreaterThan(200);expect(k.liveShapes).toBe(0);
});

/** Gear STEP -> section wire. */
function section(module:number,teeth:number,a:Arena) {
  const oc=k.oc,raw=k as unknown as {get(id:ShapeId):TopoDS_Shape},ids:ShapeId[]=[];
  try{
    const src=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[toothedProfile({kind:'gear',module,teeth,pressureAngle:20*Math.PI/180,width:5,bore:0,backlash:0,baseHeight:0})],[0,0,5]).shape;ids.push(src);
    const imp=k.importStep(k.exportStep(src)).shape;ids.push(imp);
    const plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,2.5)),a.own(new oc.gp_Dir(0,0,1))));
    const cut=a.own(new oc.BRepAlgoAPI_Section(raw.get(imp),plane,false));cut.Approximation(true);cut.ComputePCurveOn2(true);cut.Build();if(!cut.IsDone())throw Error('section');
    const edges=ShapeIndex.of(oc,a.own(cut.Shape()),'TopAbs_EDGE',a),seq=a.own(new oc.NCollection_HSequence_TopoDS_Shape());try{for(const e of edges.keys)seq.Append(e);}finally{edges.dispose();}
    const wires=a.own(a.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(seq,1e-7,false)).Sequence());if(wires.Length()!==1)throw Error('single loop');
    return {wire:a.own(oc.TopoDS.Wire(a.own(wires.Value(1)))),plane};
  }finally{for(const id of ids)k.release(id);}
}

it.each([[3,40,0.3,'biarc'],[1,24,0.8,'biarc'],[1,24,0.05,'arc'],[1,24,0.2,'arc'],[0.5,18,0.01,'arc'],[3,40,0.1,'arc']] as [number,number,number,'arc'|'biarc'][])(
  'two-stage offset never returns a violation: module %s, %s teeth, gap %s mm uses %s',(module,teeth,gap,expected)=>{
  const a=new Arena(),t0=Date.now();
  try{
    const {wire,plane}=section(module,teeth,a),r=fallbackOffset(k,wire,plane,gap,2e-6,a);
    expect(r.mode).toBe(expected);
    expect(r.result.minDistance).toBeGreaterThanOrEqual(gap-1e-6);
    // The approximation that was used, certified edge by edge against the offset, and its kinks.
    const src=planarSegments(k,r.approx.wire,a),dst=r.result.segments,cert=certifyOffset(src,dst,gap,1e-5);
    let window=0;for(let i=1;i<src.length;i++){const p=src[i-1]!,q=src[i]!;if(p.kind!=='arc'||q.kind!=='arc')continue;
      const tan=(s:Extract<Seg2,{kind:'arc'}>,end:boolean)=>{const pt=end?s.b:s.a,rx=pt[0]-s.c[0],ry=pt[1]-s.c[1],cr=(s.m[0]-s.c[0])*(s.a[1]-s.c[1])-(s.m[1]-s.c[1])*(s.a[0]-s.c[0]),sg=cr<0?1:-1;return [-sg*ry/s.r,sg*rx/s.r];};
      const u=tan(p,true),v=tan(q,false),kk=Math.atan2(u[0]!*v[1]!-u[1]!*v[0]!,u[0]!*v[0]!+u[1]!*v[1]!);if(kk<=-5e-5&&kk>-3.5e-4)window++;}
    reports[`${module}/${teeth}/${gap}`]={mode:r.mode,attempts:r.attempts,approxEdges:r.approx.edges,maxBound:r.approx.maxBound,offsetEdges:dst.length,certFailures:cert.failures.length,maxUpper:cert.maxUpper,kinksInWindow:window,ms:Date.now()-t0};
    expect(cert.failures).toEqual([]);
    expect(cert.maxUpper).toBeLessThanOrEqual(gap+1e-5);
    if(expected==='biarc'){expect(r.attempts.map(x=>x.outcome)).toEqual(['refused','ok']);expect(window).toBe(0);}
    else expect(r.attempts.map(x=>x.outcome)).toEqual(['ok']);
  }finally{a.dispose();}
  expect(k.liveShapes).toBe(0);
},170000);

it('the arc form alone is refused at large gaps where the biarc form is not',()=>{
  const a=new Arena();
  try{
    const {wire,plane}=section(1,24,a),approx=sectionEnvelope(k,wire,2e-6,a,'biarc'),face=a.own(a.own(new k.oc.BRepBuilderAPI_MakeFace(plane,approx.wire,true)).Face());
    const arc=sectionEnvelope(k,wire,2e-6,a,'arc'),arcFace=a.own(a.own(new k.oc.BRepBuilderAPI_MakeFace(plane,arc.wire,true)).Face());
    expect(()=>checkedOffset(k,arc.wire,arcFace,0.8,a)).toThrow(OffsetClearanceError);
    expect(()=>checkedOffset(k,approx.wire,face,0.8,a)).not.toThrow();
  }finally{a.dispose();}
  expect(k.liveShapes).toBe(0);
},120000);

// With spline ends snapped to a native neighbour's tangent (SNAP 1e-2 rad), the biarc form alone offsets at every gap.
// Without the snap, the involute flank meets the native radial line at the base circle with a 5.4e-3 rad concave kink,
// and MakeOffset returns not-done for gaps up to 0.06 mm (module 1).
it.each([[1,24,0.01],[1,24,0.02],[1,24,0.05],[1,24,0.06],[1,24,0.2],[3,40,0.02],[3,40,0.05],[0.5,18,0.01]] as [number,number,number][])(
  'biarc alone offsets small gaps: module %s, %s teeth, gap %s mm',(module,teeth,gap)=>{
  const a=new Arena(),t0=Date.now();
  try{
    const {wire,plane}=section(module,teeth,a),approx=sectionEnvelope(k,wire,2e-6,a,'biarc'),face=a.own(a.own(new k.oc.BRepBuilderAPI_MakeFace(plane,approx.wire,true)).Face());
    expect(approx.maxBound).toBeLessThanOrEqual(2e-6);
    const r=checkedOffset(k,approx.wire,face,gap,a);
    expect(r.minDistance).toBeGreaterThanOrEqual(gap-1e-6);
    reports[`biarc ${module}/${teeth}/${gap}`]={approxEdges:approx.edges,maxBound:approx.maxBound,minDistance:r.minDistance,ms:Date.now()-t0};
  }finally{a.dispose();}
  expect(k.liveShapes).toBe(0);
},170000);
