/** Research spike: offsets of a planar section with holes and several regions, outward and inward. No product API. */
import type { Kernel, ShapeId } from '@3db/kernel';
import type { gp_Pln, TopoDS_Face, TopoDS_Shape, TopoDS_Wire } from 'libcascade/single/init';
import { Arena } from '../../packages/kernel/src/occt';
import { certifyOffset, nearestField, OffsetClearanceError, planarSegments, sectionEnvelope, violationPlaces, type OffsetCertificate, type Seg2 } from './section-offset-envelope';

type Raw={put(s:TopoDS_Shape):ShapeId};
/** One outer loop with the holes directly inside it; an island inside a hole is a region of its own. */
export type LoopRegion={outer:number;holes:number[]};
export class OffsetCostError extends Error {
  constructor(readonly stage:'source'|'approximation',readonly count:number,readonly limit:number){
    super(stage==='source'?`section has ${count} curve pieces, over the limit of ${limit}`:`offset needs ${count} approximation edges, over the limit of ${limit}`);this.name='OffsetCostError';}
}
/**
 * Default Worker limits, from the measured costs (see the cost test): about 8 to 18 biarc edges per Bezier piece, and
 * 1.5 to 3.5 ms per edge for the whole offset on the reference machine (8,037 edges: 21 to 28 s; the test process heap
 * was 130 to 380 MiB). 1,000 pieces keeps the approximation near 10 s before anything is offset; 10,000 edges keeps the
 * whole run near 35 s.
 * Machine dependent: measured, not proven.
 */
export const DEFAULT_OFFSET_LIMITS={maxSourcePieces:1000,maxEdges:10000};
/** Cheap count before any approximation: native edges, and Bezier pieces of the spline edges. */
export function sourceCost(k:Kernel,wires:TopoDS_Wire[],a:Arena){
  const oc=k.oc;let native=0,pieces=0;
  for(const w of wires){const ex=a.own(new oc.BRepTools_WireExplorer(w));for(;ex.More();ex.Next()){const ad=a.own(new oc.BRepAdaptor_Curve(a.own(ex.Current())));
    if(String(ad.GetType())==='GeomAbs_BSplineCurve')pieces+=a.own(new oc.GeomConvert_BSplineCurveToBezierCurve(a.own(ad.BSpline()),ad.FirstParameter(),ad.LastParameter(),1e-12)).NbArcs();else native++;}}
  return {native,pieces};
}

function area(k:Kernel,s:TopoDS_Shape,a:Arena){const g=a.own(new k.oc.GProp_GProps());k.oc.BRepGProp.SurfaceProperties(s,g,false,false);return Math.abs(g.Mass());}
function face(k:Kernel,plane:gp_Pln,w:TopoDS_Wire,a:Arena){const m=a.own(new k.oc.BRepBuilderAPI_MakeFace(plane,w,true));if(!m.IsDone())throw Error('loop face failed');return a.own(m.Face());}
function minDistance(k:Kernel,s:TopoDS_Shape,t:TopoDS_Shape){
  const raw=k as unknown as Raw,si=raw.put(s.Oriented(s.Orientation())),ti=raw.put(t.Oriented(t.Orientation()));
  try{return k.distance(si,ti) as {distance:number;pointB:[number,number,number]};}finally{k.release(si);k.release(ti);}
}
function compound(k:Kernel,shapes:TopoDS_Shape[],a:Arena){const b=a.own(new k.oc.BRep_Builder()),c=a.own(new k.oc.TopoDS_Compound());b.MakeCompound(c);for(const s of shapes)b.Add(c,s);return c;}
function wiresOf(k:Kernel,s:TopoDS_Shape,a:Arena){const oc=k.oc,ex=a.own(new oc.TopExp_Explorer(s,oc.TopAbs_ShapeEnum.TopAbs_WIRE,oc.TopAbs_ShapeEnum.TopAbs_SHAPE)),out:TopoDS_Wire[]=[];for(;ex.More();ex.Next())out.push(a.own(oc.TopoDS.Wire(a.own(ex.Current()))));return out;}
function facesOf(k:Kernel,s:TopoDS_Shape,a:Arena){const oc=k.oc,ex=a.own(new oc.TopExp_Explorer(s,oc.TopAbs_ShapeEnum.TopAbs_FACE,oc.TopAbs_ShapeEnum.TopAbs_SHAPE)),out:TopoDS_Face[]=[];for(;ex.More();ex.Next())out.push(a.own(oc.TopoDS.Face(a.own(ex.Current()))));return out;}

function pointOn(k:Kernel,w:TopoDS_Wire,a:Arena){const ex=a.own(new k.oc.BRepTools_WireExplorer(w)),ad=a.own(new k.oc.BRepAdaptor_Curve(a.own(ex.Current())));return a.own(ad.Value((ad.FirstParameter()+ad.LastParameter())/2));}
/** Nesting of closed planar loops that neither touch nor cross: even depth is an outer loop, odd depth a hole of its parent. */
export function classifyLoops(k:Kernel,wires:TopoDS_Wire[],plane:gp_Pln,a:Arena):LoopRegion[] {
  const oc=k.oc;if(wires.length===0)throw Error('no section loops');
  for(const w of wires)if(!oc.BRep_Tool.IsClosed(w))throw Error('open section loop');
  const faces=wires.map(w=>face(k,plane,w,a));
  for(let i=0;i<wires.length;i++)for(let j=i+1;j<wires.length;j++)if(minDistance(k,wires[i]!,wires[j]!).distance<1e-7)throw Error('section loops touch or cross');
  const inside=wires.map((_,j)=>wires.map((_,i)=>{if(i===j)return false;const c=a.own(new oc.BRepClass_FaceClassifier(faces[i]!,pointOn(k,wires[j]!,a),1e-7));return c.State()===oc.TopAbs_State.TopAbs_IN;}));
  const depth=inside.map(r=>r.filter(Boolean).length),regions:LoopRegion[]=[],byOuter=new Map<number,LoopRegion>();
  wires.forEach((_,j)=>{if(depth[j]!%2===0){const r:LoopRegion={outer:j,holes:[]};regions.push(r);byOuter.set(j,r);}});
  wires.forEach((_,j)=>{if(depth[j]!%2===0)return;let parent=-1;inside[j]!.forEach((x,i)=>{if(x&&depth[i]===depth[j]!-1)parent=i;});
    byOuter.get(parent)!.holes.push(j);});
  return regions;
}
/** Planar face of one region; orientation fixed so holes are holes. */
export function regionFace(k:Kernel,plane:gp_Pln,outer:TopoDS_Wire,holes:TopoDS_Wire[],a:Arena) {
  const oc=k.oc,m=a.own(new oc.BRepBuilderAPI_MakeFace(plane,outer,true));for(const h of holes)m.Add(h);if(!m.IsDone())throw Error('region face failed');
  const fix=a.own(new oc.ShapeFix_Face(a.own(m.Face())));fix.FixOrientation();return a.own(fix.Face());
}

/** Even-odd test against lines and arcs, arcs taken as chords within `sag` of the arc. */
function insideTest(segs:Seg2[],sag:number) {
  const edges:[number,number,number,number][]=[];
  for(const s of segs){
    if(s.kind==='line'){edges.push([s.a[0],s.a[1],s.b[0],s.b[1]]);continue;}
    const ang=(p:[number,number])=>Math.atan2(p[1]-s.c[1],p[0]-s.c[0]),a0=ang(s.a);let am=ang(s.m)-a0,ab=ang(s.b)-a0;
    const norm=(x:number)=>{while(x<0)x+=2*Math.PI;while(x>=2*Math.PI)x-=2*Math.PI;return x;};am=norm(am);ab=norm(ab);if(ab===0)ab=2*Math.PI;
    const sweep=am<ab?ab:ab-2*Math.PI,n=Math.max(2,Math.ceil(Math.abs(sweep)/(2*Math.acos(Math.max(-1,1-sag/s.r)))));
    let px=s.a[0],py=s.a[1];for(let i=1;i<=n;i++){const t=a0+sweep*i/n,qx=i===n?s.b[0]:s.c[0]+s.r*Math.cos(t),qy=i===n?s.b[1]:s.c[1]+s.r*Math.sin(t);edges.push([px,py,qx,qy]);px=qx;py=qy;}
  }
  return (p:[number,number])=>{let c=false;for(const [x1,y1,x2,y2] of edges)if((y1>p[1])!==(y2>p[1])&&p[0]<x1+(p[1]-y1)*(x2-x1)/(y2-y1))c=!c;return c;};
}
/** Centre and radius when the loop is one full circle. */
function fullCircle(k:Kernel,w:TopoDS_Wire,a:Arena):[number,number,number]|null{
  const oc=k.oc,ex=a.own(new oc.BRepTools_WireExplorer(w)),ad=a.own(new oc.BRepAdaptor_Curve(a.own(ex.Current())));ex.Next();
  if(ex.More()||String(ad.GetType())!=='GeomAbs_Circle'||!ad.IsClosed())return null;const c=a.own(ad.Circle()),o=a.own(c.Location());return [o.X(),o.Y(),c.Radius()];
}
/** Two loops that are each one full circle about the same centre. */
function concentricCircles(k:Kernel,wires:TopoDS_Wire[],a:Arena){
  const centres=wires.map(w=>fullCircle(k,w,a)).filter((c):c is [number,number,number]=>c!==null);
  return centres.some((p,i)=>centres.some((q,j)=>j>i&&Math.hypot(p[0]-q[0],p[1]-q[1])<=1e-9*Math.max(1,p[2],q[2])));
}
/** Grid over the bounding box of lines and arcs (arcs padded to their full circle). */
function gridOf(segs:Seg2[],h:number){
  const xs=segs.flatMap(s=>s.kind==='arc'?[s.c[0]-s.r,s.c[0]+s.r]:[s.a[0],s.b[0]]),ys=segs.flatMap(s=>s.kind==='arc'?[s.c[1]-s.r,s.c[1]+s.r]:[s.a[1],s.b[1]]);
  const x0=Math.min(...xs),y0=Math.min(...ys);
  return {x0,y0,nx:Math.ceil((Math.max(...xs)-x0)/h)+1,ny:Math.ceil((Math.max(...ys)-y0)/h)+1};
}
/** Grid points the inradius bound may visit; a finer grid is not tried past this. */
const INRADIUS_POINTS=400_000;
/** Certified upper bound on a region's inradius: grid spacing h gives max over inside grid points + h/sqrt(2).
 * Null when the grid would exceed INRADIUS_POINTS: a thin region with a large box is not worth proving. */
export function inradiusBound(segs:Seg2[],h:number) {
  const {x0,y0,nx,ny}=gridOf(segs,h);if(nx*ny>INRADIUS_POINTS)return null;
  const sag=h/100,inside=insideTest(segs,sag),near=nearestField(segs,h);let best=0;
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){const p:[number,number]=[x0+i*h,y0+j*h];if(inside(p))best=Math.max(best,near(p));}
  return {sampled:best,bound:Math.max(best,sag)+h*Math.SQRT1_2,points:nx*ny};
}

/**
 * Side check, valid once a global distance has shown that no result loop meets a source loop: then every loop lies
 * wholly on one side of the other set, so one point per loop decides containment. Outward, every source loop is inside
 * the result and every result loop outside the source; inward, the reverse. Areas must move the same way. (A boolean
 * Common gives the same answer but took 29 s on a 3,000-edge gear.)
 */
export function sideCheck(k:Kernel,side:'out'|'in',sourceFaces:TopoDS_Face[],sourceLoops:TopoDS_Wire[],result:TopoDS_Shape|null,a:Arena){
  const oc=k.oc,inAny=(faces:TopoDS_Face[],w:TopoDS_Wire)=>{const p=pointOn(k,w,a);return faces.some(f=>a.own(new oc.BRepClass_FaceClassifier(f,p,1e-7)).State()===oc.TopAbs_State.TopAbs_IN);};
  const resultFaces=result?facesOf(k,result,a):[],resultLoops=result?wiresOf(k,result,a):[];
  const sourceArea=sourceFaces.reduce((x,f)=>x+area(k,f,a),0),resultArea=resultFaces.reduce((x,f)=>x+area(k,f,a),0);
  const sourceIn=sourceLoops.map(w=>inAny(resultFaces,w)),resultIn=resultLoops.map(w=>inAny(sourceFaces,w));
  if(side==='out'?(!sourceIn.every(Boolean)||resultIn.some(Boolean)||resultArea<=sourceArea):(sourceIn.some(Boolean)||!resultIn.every(Boolean)||resultArea>=sourceArea))throw Error('offset on the wrong side');
}
export type RegionOffsetResult={
  timings:{classify:number;approximate:number;offset:number;check:number};sourcePieces:number;shape:TopoDS_Shape;faces:number;merged:number;minDistance:number;certificate:OffsetCertificate|null;approxEdges:number;maxBound:number;
  regions:{holes:number;resultLoops:number;resultFaces:number;vanished:boolean;inradius?:{sampled:number;bound:number}}[];
  area:{source:number;result:number};
};
/**
 * Offset every region of a section by `gap`, outward (grow) or inward (shrink). Each loop is approximated on its own,
 * each region offset as one face with its holes, and outward results that collide are fused. The result is checked
 * whole: global distance to every source loop at least the gap, the result on the right side of the source (contains
 * it outward, inside it inward), and the edge-by-edge upper bound. An inward offset that OCCT cannot do counts as a
 * vanished region only when the inradius bound proves it; otherwise it is a failure.
 */
export function regionOffset(k:Kernel,wires:TopoDS_Wire[],plane:gp_Pln,gap:number,side:'out'|'in',epsilon:number,a:Arena,
  opt:{mode:'arc'|'biarc';tolerance?:number;slack?:number;maxSourcePieces?:number;maxEdges?:number}):RegionOffsetResult {
  if(!Number.isFinite(gap)||gap<=0)throw Error('positive finite gap required');
  if(side!=='out'&&side!=='in')throw Error('offset side must be out or in');
  const tolerance=opt.tolerance??1e-6,slack=opt.slack??1e-5,oc=k.oc;
  // The source count comes first: it is the cheapest step, and it bounds every later one.
  const t0=Date.now(),cost=sourceCost(k,wires,a);
  const maxSourcePieces=opt.maxSourcePieces??DEFAULT_OFFSET_LIMITS.maxSourcePieces,maxEdges=opt.maxEdges??DEFAULT_OFFSET_LIMITS.maxEdges;
  if(cost.pieces>maxSourcePieces)throw new OffsetCostError('source',cost.pieces,maxSourcePieces);
  const loops=classifyLoops(k,wires,plane,a),t1=Date.now();
  const approx=wires.map(w=>sectionEnvelope(k,w,epsilon,a,opt.mode)),t2=Date.now();
  const approxEdges=approx.reduce((s,x)=>s+x.edges,0),maxBound=Math.max(...approx.map(x=>x.maxBound));
  if(approxEdges>maxEdges)throw new OffsetCostError('approximation',approxEdges,maxEdges);
  const sourceFaces=loops.map(r=>regionFace(k,plane,approx[r.outer]!.wire,r.holes.map(h=>approx[h]!.wire),a));
  const source=compound(k,approx.map(x=>x.wire),a),sourceSegs=approx.flatMap(x=>planarSegments(k,x.wire,a));
  // Distance check on each raw offset against its own region's loops, before they are turned into faces: an untrimmed
  // self-intersecting loop (the arc-form violation) can make a face that hides it, which then shows up only as a
  // wrong-side result. Other regions are checked after the fuse, since colliding offsets are merged there.
  const guard=(shape:TopoDS_Shape,against=source)=>{const g=minDistance(k,against,shape);
    if(g.distance<gap-tolerance)throw new OffsetClearanceError(gap,g.distance,violationPlaces(sourceSegs,planarSegments(k,shape,a),gap,tolerance,32,{p:[g.pointB[0],g.pointB[1]],d:g.distance}));
    return g.distance;};
  const resultFaces:TopoDS_Face[]=[],regions:RegionOffsetResult['regions']=[];
  loops.forEach((r,ri)=>{
    if(side==='in'&&concentricCircles(k,[r.outer,...r.holes].map(i=>approx[i]!.wire),a)){
      // OCCT aborts the WebAssembly module (a null-function trap) when it shrinks a face whose loops include two
      // concentric full circles, at any gap. Such a region is shrunk loop by loop instead: the outer loop shrunk, minus
      // every hole grown, which is the same set (points at least `gap` from the outside of the region).
      const one=(w:TopoDS_Wire,d:number)=>{const m=a.own(new oc.BRepOffsetAPI_MakeOffset(face(k,plane,w,a),oc.GeomAbs_JoinType.GeomAbs_Arc,false));m.Perform(d);return m.IsDone()?wiresOf(k,a.own(m.Shape()),a):[];};
      // Holes cannot be concentric with each other (they would nest), so one of the two circles is the outer loop: it
      // shrinks to one circle, or to nothing exactly when its radius is at most the gap.
      const outer=one(approx[r.outer]!.wire,-gap);
      const kept=outer.length?r.holes.reduce<TopoDS_Shape|null>((acc,h)=>{if(!acc)return null;const grown=one(approx[h]!.wire,gap);if(grown.length!==1)throw Error('offset failed');
        const c=a.own(new oc.BRepAlgoAPI_Cut(acc,face(k,plane,grown[0]!,a)));if(!c.IsDone())throw Error('offset failed');const f=facesOf(k,a.own(c.Shape()),a);return f.length?compound(k,f,a):null;},
        face(k,plane,outer[0]!,a)):null;
      const fs=kept?facesOf(k,kept,a):[];
      if(fs.length)guard(compound(k,wiresOf(k,compound(k,fs,a),a),a),compound(k,[r.outer,...r.holes].map(i=>approx[i]!.wire),a));
      resultFaces.push(...fs);regions.push({holes:r.holes.length,resultLoops:fs.reduce((n,f)=>n+wiresOf(k,f,a).length,0),resultFaces:fs.length,vanished:fs.length===0});return;
    }
    const f=sourceFaces[ri]!,mo=a.own(new oc.BRepOffsetAPI_MakeOffset(f,oc.GeomAbs_JoinType.GeomAbs_Arc,false));mo.Perform(side==='out'?gap:-gap);
    const out=mo.IsDone()?wiresOf(k,a.own(mo.Shape()),a):[];
    if(out.length===0){
      if(side==='out')throw Error('offset failed');
      const segs=[r.outer,...r.holes].flatMap(i=>planarSegments(k,approx[i]!.wire,a));let h=gap/4,ir=inradiusBound(segs,h);
      while(ir&&ir.bound>=gap-tolerance&&ir.sampled<=gap&&h>gap/64){const finer=inradiusBound(segs,h/2);if(!finer)break;h/=2;ir=finer;}
      if(!ir||ir.bound>=gap-tolerance)throw Error('offset failed');
      regions.push({holes:r.holes.length,resultLoops:0,resultFaces:0,vanished:true,inradius:{sampled:ir.sampled,bound:ir.bound}});return;
    }
    guard(compound(k,out,a),compound(k,[r.outer,...r.holes].map(i=>approx[i]!.wire),a));
    const nested=classifyLoops(k,out,plane,a),fs=nested.map(n=>regionFace(k,plane,out[n.outer]!,n.holes.map(h=>out[h]!),a));
    resultFaces.push(...fs);regions.push({holes:r.holes.length,resultLoops:out.length,resultFaces:fs.length,vanished:false});
  });
  let shape:TopoDS_Shape=compound(k,resultFaces,a),merged=0;
  if(side==='out'&&resultFaces.length>1){
    let acc:TopoDS_Shape=resultFaces[0]!;
    for(const f of resultFaces.slice(1)){const fu=a.own(new oc.BRepAlgoAPI_Fuse(acc,f));if(!fu.IsDone())throw Error('region fuse failed');acc=a.own(fu.Shape());}
    const u=a.own(new oc.ShapeUpgrade_UnifySameDomain(acc,true,true,false));u.Build();shape=a.own(u.Shape());merged=resultFaces.length-facesOf(k,shape,a).length;
  }
  const t3=Date.now(),sourceRegion=compound(k,sourceFaces,a);
  const sourceArea=area(k,sourceRegion,a),resultArea=resultFaces.length?area(k,shape,a):0;
  const segments=resultFaces.length?planarSegments(k,shape,a):[];
  let minD=Infinity;
  if(resultFaces.length)minD=guard(compound(k,wiresOf(k,shape,a),a));
  sideCheck(k,side,sourceFaces,approx.map(x=>x.wire),resultFaces.length?shape:null,a);
  const certificate=segments.length?certifyOffset(sourceSegs,segments,gap,slack):null;
  if(certificate?.failures.length)throw Error('offset certificate failed');
  const t4=Date.now();
  return {timings:{classify:t1-t0,approximate:t2-t1,offset:t3-t2,check:t4-t3},sourcePieces:cost.pieces,shape,faces:resultFaces.length?facesOf(k,shape,a).length:0,merged,minDistance:minD,certificate,approxEdges,maxBound,regions,area:{source:sourceArea,result:resultArea}};
}
