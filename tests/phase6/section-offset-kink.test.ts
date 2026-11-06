/** Research spike: why BRepOffsetAPI_MakeOffset violates the gap on the explicit arc approximation. No product API. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TopoDS_Shape } from 'libcascade/single/init';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { nearestField, type Seg2 } from '@3db/regen';
import { planarSegments, sectionEnvelope } from './section-offset-envelope';

type P=[number,number];
let k:Kernel;let initialHeap=0;const reports:Record<string,unknown>={};
const heap=()=>(k.oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength;
beforeAll(async()=>{k=await Kernel.load();initialHeap=heap();expect(initialHeap).toBeGreaterThan(0);});
afterAll(()=>{const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'offset-kink.json'),JSON.stringify({initialHeap,finalHeap:heap(),reports},null,2));});

/** A point at fraction u along a line or arc. */
function along(o:Seg2,u:number):P{if(o.kind==='line')return [o.a[0]+u*(o.b[0]-o.a[0]),o.a[1]+u*(o.b[1]-o.a[1])];
  const ang=(p:P)=>Math.atan2(p[1]-o.c[1],p[0]-o.c[0]),a0=ang(o.a),t=(x:number)=>{const r=x%(2*Math.PI);return r<0?r+2*Math.PI:r;};
  const ccw=t(ang(o.m)-a0)<t(ang(o.b)-a0),sw=(t((ccw?1:-1)*(ang(o.b)-a0))||2*Math.PI)*(ccw?1:-1),th=a0+sw*u;return [o.c[0]+o.r*Math.cos(th),o.c[1]+o.r*Math.sin(th)];}
/** Unit tangent at the start or end of an element, in its own direction. */
function tangent(q:Seg2,atEnd:boolean):P{if(q.kind==='line'){const v:P=[q.b[0]-q.a[0],q.b[1]-q.a[1]],n=Math.hypot(...v);return [v[0]/n,v[1]/n];}
  const p=atEnd?q.b:q.a,rx=p[0]-q.c[0],ry=p[1]-q.c[1],cr=(q.m[0]-q.c[0])*(q.a[1]-q.c[1])-(q.m[1]-q.c[1])*(q.a[0]-q.c[0]),s=cr<0?1:-1;return [-s*ry/q.r,s*rx/q.r];}
/** Signed turning angle (rad) from the end of p to the start of q; negative turns right. */
const kinkOf=(p:Seg2,q:Seg2)=>{const u=tangent(p,true),v=tangent(q,false);return Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]);};

/** Builds the closed wire, offsets it outward by g, and returns the smallest distance of the offset to the wire. */
function offsetWorst(segs:Seg2[],g:number) {
  const oc=k.oc,a=new Arena(),raw=k as unknown as {put(s:TopoDS_Shape):ShapeId};
  try{
    const pt=(q:P)=>a.own(new oc.gp_Pnt(q[0],q[1],0)),mw=a.own(new oc.BRepBuilderAPI_MakeWire());
    for(const q of segs){const mk=q.kind==='line'?a.own(new oc.BRepBuilderAPI_MakeEdge(pt(q.a),pt(q.b))):a.own(new oc.BRepBuilderAPI_MakeEdge(a.own(a.own(new oc.GC_MakeArcOfCircle(pt(q.a),pt(q.m),pt(q.b))).Value())));
      if(!mk.IsDone())throw Error('edge failed');mw.Add(a.own(mk.Edge()));if(!mw.IsDone())throw Error('wire disconnected');}
    const w=a.own(mw.Wire()),plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,0)),a.own(new oc.gp_Dir(0,0,1)))),fm=a.own(new oc.BRepBuilderAPI_MakeFace(plane,w,true));
    if(!fm.IsDone())throw Error('face failed');
    const mo=a.own(new oc.BRepOffsetAPI_MakeOffset(a.own(fm.Face()),oc.GeomAbs_JoinType.GeomAbs_Arc,false));mo.Perform(g);if(!mo.IsDone())throw Error('offset failed');
    const out=a.own(mo.Shape()),near=nearestField(planarSegments(k,w,a),g);let sampled=Infinity;
    for(const o of planarSegments(k,out,a))for(let j=0;j<=64;j++)sampled=Math.min(sampled,near(along(o,j/64)));
    // The global minimum (the certificate's lower side) must see the same thing as the dense samples.
    const wi=raw.put(w.Oriented(w.Orientation())),oi=raw.put(out.Oriented(out.Orientation()));let global:number;
    try{global=k.distance(wi,oi).distance;}finally{k.release(wi);k.release(oi);}
    return {sampled,global};
  }finally{a.dispose();}
}

/** Arc from p with unit tangent t turning left with radius r over length len. */
function arcFrom(p:P,t:P,r:number,len:number):{s:Seg2;t:P}{const n:P=[-t[1],t[0]],c:P=[p[0]+r*n[0],p[1]+r*n[1]],th0=Math.atan2(p[1]-c[1],p[0]-c[0]),d=len/r;
  const at=(u:number):P=>[c[0]+r*Math.cos(th0+d*u),c[1]+r*Math.sin(th0+d*u)],te=Math.atan2(t[1],t[0])+d;return {s:{kind:'arc',c,r,a:p,m:at(0.5),b:at(1)},t:[Math.cos(te),Math.sin(te)]};}
const rot=(t:P,rad:number):P=>[t[0]*Math.cos(rad)-t[1]*Math.sin(rad),t[0]*Math.sin(rad)+t[1]*Math.cos(rad)];
/** A root line, a wall of height 0.13 (the gear's root-to-base segment), two short convex arcs with a controlled kink, then a long arc. */
function corner(kink:number,len:number):Seg2[]{
  const s:Seg2[]=[{kind:'line',a:[10,-5],b:[10,0]},{kind:'line',a:[10,0],b:[0,0]},{kind:'line',a:[0,0],b:[0,0.13]}];
  const a1=arcFrom([0,0.13],[0,1],0.78,len);s.push(a1.s);const a2=arcFrom(a1.s.b,rot(a1.t,kink),1.24,len*1.4);s.push(a2.s);
  const a3=arcFrom(a2.s.b,a2.t,3,1.2);s.push(a3.s);const e=a3.s.b;
  s.push({kind:'line',a:e,b:[-10,e[1]]},{kind:'line',a:[-10,e[1]],b:[-10,-5]},{kind:'line',a:[-10,-5],b:[10,-5]});return s;}

const deg=Math.PI/180;
it('a tiny concave kink between two short arcs breaks the offset; no gear involved',()=>{
  const g=0.3,row=(kink:number,len=0.008,gap=g)=>({kink,len,gap,...offsetWorst(corner(kink,len),gap)});
  const bad=[row(-0.0073*deg),row(-0.01*deg),row(-0.0073*deg,0.05)];
  const good=[row(0),row(0.0073*deg),row(-0.003*deg),row(-0.05*deg),row(-1*deg),row(-0.0073*deg,0.3),row(-0.0073*deg,0.008,0.1)];
  reports.synthetic={bad,good};
  for(const r of bad){expect(r.sampled).toBeLessThan(r.gap-0.05);expect(r.global).toBeLessThan(r.gap-0.05);}
  for(const r of good){expect(r.sampled).toBeGreaterThan(r.gap-1e-6);expect(r.global).toBeGreaterThan(r.gap-1e-6);}
  expect(k.liveShapes).toBe(0);
});

/** The approximation of the real gear section, the elements around one root corner, closed through the material. */
async function gearCorner(module:number,teeth:number) {
  const oc=k.oc,a=new Arena(),raw=k as unknown as {get(id:ShapeId):TopoDS_Shape},ids:ShapeId[]=[];
  try{
    const src=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[toothedProfile({kind:'gear',module,teeth,pressureAngle:20*deg,width:5,bore:0,backlash:0,baseHeight:0})],[0,0,5]).shape;ids.push(src);
    const imp=k.importStep(k.exportStep(src)).shape;ids.push(imp);
    const plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,2.5)),a.own(new oc.gp_Dir(0,0,1))));
    const cut=a.own(new oc.BRepAlgoAPI_Section(raw.get(imp),plane,false));cut.Approximation(true);cut.ComputePCurveOn2(true);cut.Build();if(!cut.IsDone())throw Error('section');
    const edges=ShapeIndex.of(oc,a.own(cut.Shape()),'TopAbs_EDGE',a),seq=a.own(new oc.NCollection_HSequence_TopoDS_Shape());try{for(const e of edges.keys)seq.Append(e);}finally{edges.dispose();}
    const w=a.own(oc.TopoDS.Wire(a.own(a.own(a.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(seq,1e-7,false)).Sequence()).Value(1))));
    return planarSegments(k,sectionEnvelope(k,w,2e-6,a,'arc').wire,a);
  }finally{for(const id of ids)k.release(id);a.dispose();}
}

it('on the real gear the same corner fails with the kinked arcs and passes once they are tangent-continuous',async()=>{
  const S=await gearCorner(3,40),rootR=3*40/2-1.25*3,g=0.3;
  // Every arc-to-arc junction of the approximation, and how many fall in the window measured above.
  const kinks:number[]=[];for(let i=1;i<S.length;i++){const p=S[i-1]!,q=S[i]!;if(p.kind==='arc'&&q.kind==='arc'&&Math.hypot(p.b[0]-q.a[0],p.b[1]-q.a[1])<1e-9)kinks.push(kinkOf(p,q));}
  const window=kinks.filter(x=>x<-5e-5&&x>-3.5e-4).length;
  const i0=S.findIndex((q,i)=>q.kind==='arc'&&Math.abs(q.r-rootR)<1e-6&&S[i+1]?.kind==='line');expect(i0).toBeGreaterThanOrEqual(0);
  const chain=S.slice(i0,i0+12),from=chain.findIndex((q,i)=>i>0&&q.kind==='arc'),A1=chain[from] as Extract<Seg2,{kind:'arc'}>,A2=chain[from+1] as Extract<Seg2,{kind:'arc'}>;
  // A2 rebuilt tangent to A1 at their junction, ending at the same point.
  const t=tangent(A1,true),J=A1.b,E=A2.b,n:P=[-t[1],t[0]],dx=E[0]-J[0],dy=E[1]-J[1],sN=(dx*dx+dy*dy)/(2*(dx*n[0]+dy*n[1])),c:P=[J[0]+sN*n[0],J[1]+sN*n[1]],r=Math.abs(sN);
  const an=(q:P)=>Math.atan2(q[1]-c[1],q[0]-c[0]);let d=an(E)-an(J);while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
  const G1:Seg2={kind:'arc',c,r,a:J,m:[c[0]+r*Math.cos(an(J)+d/2),c[1]+r*Math.sin(an(J)+d/2)],b:E};
  // The root arc runs from the corner (a) to its far end (b): close from the last arc down through the material to that far end.
  const close=(segs:Seg2[]):Seg2[]=>{const first=segs[0]!,last=segs.at(-1)!,inward=(p:P):P=>{const th=Math.atan2(p[1],p[0]);return [50*Math.cos(th),50*Math.sin(th)];};
    return [...segs,{kind:'line',a:last.b,b:inward(last.b)},{kind:'line',a:inward(last.b),b:inward(first.b)},{kind:'line',a:inward(first.b),b:first.b}];};
  const head=chain.slice(0,from),kinked=offsetWorst(close([...head,A1,A2]),g),smooth=offsetWorst(close([...head,A1,G1]),g),one=offsetWorst(close([...head,A1]),g);
  reports.gear={junctions:kinks.length,concave:kinks.filter(x=>x<0).length,inWindow:window,maxAbsDeg:Math.max(...kinks.map(Math.abs))/deg,firstKinkDeg:kinkOf(A1,A2)/deg,g1Radius:r,originalRadius:A2.r,kinked,smooth,one};
  expect(window).toBeGreaterThan(0);
  expect(kinkOf(A1,A2)).toBeLessThan(-5e-5);
  expect(kinked.global).toBeLessThan(g-0.1);
  expect(smooth.global).toBeGreaterThan(g-1e-6);expect(one.global).toBeGreaterThan(g-1e-6);
  expect(k.liveShapes).toBe(0);
},120000);
