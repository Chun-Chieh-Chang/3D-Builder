/** The parts of the section-clearance research that need OCCT: wires in, wires out. The pure geometry lives in `@3db/regen` (`section/envelope`). Explicit approximation experiment, never an implicit product fallback. */
import type { HomogeneousPole, Kernel } from '@3db/kernel';
import { arcEnvelope, biarcEnvelope, endTangents, flatten, OffsetClearanceError, violationPlaces, type EnvelopePiece, type Seg2 } from '@3db/regen';
import type { TopoDS_Wire } from 'libcascade/single/init';
import { Arena } from '../../packages/kernel/src/occt';
type P=[number,number,number];
type H=HomogeneousPole;
const distance=(a:P,b:P)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

/** A closed circle whose axis points down (-Z) is offset the wrong way by BRepOffsetAPI_MakeOffset, both on its own and
 * as a hole: +g shrinks a disc and grows a hole. Partial arcs with a -Z axis are offset correctly. Such a loop is
 * rebuilt as the same circle with a +Z axis; that reverses its direction of travel, which MakeFace and ShapeFix_Face
 * settle when the face is built. */
function counterClockwiseLoop(k:Kernel,ad:import('libcascade/single/init').BRepAdaptor_Curve,edge:import('libcascade/single/init').TopoDS_Edge,a:Arena) {
  const oc=k.oc,c=a.own(ad.Circle());
  if(!ad.IsClosed()||a.own(a.own(c.Axis()).Direction()).Z()>0)return edge;
  const ax=a.own(new oc.gp_Ax2(a.own(c.Location()),a.own(new oc.gp_Dir(0,0,1)))),mk=a.own(new oc.BRepBuilderAPI_MakeEdge(a.own(new oc.gp_Circ(ax,c.Radius()))));
  if(!mk.IsDone())throw Error('circle rebuild failed');
  return a.own(mk.Edge());
}
/** Below this angle (rad) a junction between a spline and another source edge gets one shared tangent in biarc mode. */
const SNAP=1e-2;
export function sectionEnvelope(k:Kernel,wire:TopoDS_Wire,epsilon:number,a:Arena,mode:'polygon'|'arc'|'biarc') {
  if(!Number.isFinite(epsilon)||epsilon<=0)throw Error('positive finite envelope tolerance required');
  const oc=k.oc,ex=a.own(new oc.BRepTools_WireExplorer(wire)),mw=a.own(new oc.BRepBuilderAPI_MakeWire());
  let edges=0,sourceEdges=0,maxBound=0,shortPoints=0,bezierPieces=0;
  // Biarc mode, first pass: every edge's tangents at its two ends in the wire's direction. A junction where a spline meets
  // a native line or circle within SNAP rad takes the native tangent on the spline side (spline-to-spline junctions are
  // left alone: none occur in the gear sections tested). OCCT's section curve meets the radial line at the base circle a
  // few milliradians off, a concave kink that makes MakeOffset fail at small gaps; the envelope bound is still measured
  // against the real curve, so snapping costs only extra leaves near the junction, never accuracy.
  const snapped=new Map<number,{t0?:[number,number];t1?:[number,number]}>();
  if(mode==='biarc'){
    const ends:{s:[number,number];e:[number,number];native:boolean}[]=[],ex0=a.own(new oc.BRepTools_WireExplorer(wire));
    const unit=(v:[number,number]):[number,number]=>{const n=Math.hypot(...v);return [v[0]/n,v[1]/n];};
    for(;ex0.More();ex0.Next()){
      const edge=a.own(ex0.Current()),ad=a.own(new oc.BRepAdaptor_Curve(edge)),type=String(ad.GetType()),rev=String(edge.Orientation())==='TopAbs_REVERSED';
      const f=ad.FirstParameter(),l=ad.LastParameter(),pt=(u:number):[number,number]=>{const q=a.own(ad.Value(u));return [q.X(),q.Y()];};
      let ts:[number,number],te:[number,number];
      if(type==='GeomAbs_Line'){const d=a.own(a.own(ad.Line()).Direction());ts=te=[d.X(),d.Y()];}
      else if(type==='GeomAbs_Circle'){const c=a.own(ad.Circle()),o=a.own(c.Location()),z=a.own(a.own(c.Axis()).Direction()).Z(),tan=(q:[number,number]):[number,number]=>unit([-z*(q[1]-o.Y()),z*(q[0]-o.X())]);ts=tan(pt(f));te=tan(pt(l));}
      else if(type==='GeomAbs_BSplineCurve'){const bz=a.own(new oc.GeomConvert_BSplineCurveToBezierCurve(a.own(ad.BSpline()),f,l,1e-12)),polesOf=(i:number)=>{const b=a.own(bz.Arc(i)),q:H[]=[];for(let j=1;j<=b.NbPoles();j++){const P=a.own(b.Pole(j)),w=b.Weight(j);q.push([P.X()*w,P.Y()*w,P.Z()*w,w]);}return q;};
        ts=endTangents(polesOf(1)).t0;te=endTangents(polesOf(bz.NbArcs())).t1;}
      else throw Error('unsupported envelope curve type');
      const native=type!=='GeomAbs_BSplineCurve';ends.push(rev?{s:[-te[0],-te[1]],e:[-ts[0],-ts[1]],native}:{s:ts,e:te,native});
    }
    const n=ends.length;
    for(let i=0;i<n;i++){const A=ends[i]!,B=ends[(i+1)%n]!,ang=Math.atan2(A.e[0]*B.s[1]-A.e[1]*B.s[0],A.e[0]*B.s[0]+A.e[1]*B.s[1]);
      if(Math.abs(ang)>=SNAP||A.native===B.native)continue;
      const shared=A.native?A.e:B.s;
      (snapped.get(i)??snapped.set(i,{}).get(i)!).t1=shared;(snapped.get((i+1)%n)??snapped.set((i+1)%n,{}).get((i+1)%n)!).t0=shared;}
  }
  let index=-1;
  for(;ex.More();ex.Next()) {
    index++;
    const edge=a.own(ex.Current()),ad=a.own(new oc.BRepAdaptor_Curve(edge));sourceEdges++;
    const type=String(ad.GetType());
    if(type==='GeomAbs_Line'||type==='GeomAbs_Circle'){mw.Add(type==='GeomAbs_Circle'?counterClockwiseLoop(k,ad,edge,a):edge);edges++;continue;}
    if(type!=='GeomAbs_BSplineCurve')throw Error('unsupported envelope curve type');
    const bs=a.own(ad.BSpline()),beziers=a.own(new oc.GeomConvert_BSplineCurveToBezierCurve(bs,ad.FirstParameter(),ad.LastParameter(),1e-12));
    let pieces:EnvelopePiece[]=[];bezierPieces+=beziers.NbArcs();
    for(let i=1;i<=beziers.NbArcs();i++) {
      const bez=a.own(beziers.Arc(i)),poles:H[]=[];
      for(let j=1;j<=bez.NbPoles();j++){const p=a.own(bez.Pole(j)),w=bez.Weight(j);poles.push([p.X()*w,p.Y()*w,p.Z()*w,w]);}
      if(mode==='biarc'){
        // overrides are in the wire's direction; a reversed edge runs its Bezier pieces the other way
        const sn=snapped.get(index),rev=String(edge.Orientation())==='TopAbs_REVERSED',neg=(v?:[number,number]):[number,number]|undefined=>v&&[-v[0],-v[1]];
        const first=i===1,last=i===beziers.NbArcs(),ends={t0:first?(rev?neg(sn?.t1):sn?.t0):undefined,t1:last?(rev?neg(sn?.t0):sn?.t1):undefined};
        const result=biarcEnvelope(poles,epsilon,ends);maxBound=Math.max(maxBound,result.maxBound);pieces.push(...result.pieces);}
      else if(mode==='arc'){const result=arcEnvelope(poles,epsilon);maxBound=Math.max(maxBound,result.maxBound);pieces.push(...result.pieces);}
      else {const result=flatten(poles,epsilon);maxBound=Math.max(maxBound,result.maxBound);pieces.push(...result.points.slice(1).map((to,i)=>({kind:'line' as const,from:result.points[i]!,to,mid:to,bound:result.maxBound})));}
    }
    if(String(edge.Orientation())==='TopAbs_REVERSED')pieces=pieces.reverse().map(p=>({...p,from:p.to,to:p.from}));
    for(const piece of pieces) {
      const p=piece.from,q=piece.to;
      if(distance(p,q)<1e-7)throw Error('envelope segment below native resolution');
      const mk=piece.kind==='line'?a.own(new oc.BRepBuilderAPI_MakeEdge(a.own(new oc.gp_Pnt(...p)),a.own(new oc.gp_Pnt(...q)))):
        a.own(new oc.BRepBuilderAPI_MakeEdge(a.own(a.own(new oc.GC_MakeArcOfCircle(a.own(new oc.gp_Pnt(...p)),a.own(new oc.gp_Pnt(...piece.mid)),a.own(new oc.gp_Pnt(...q)))).Value())));
      if(!mk.IsDone())throw Error('envelope edge failed');mw.Add(a.own(mk.Edge()));if(!mw.IsDone())throw Error('envelope wire disconnected');edges++;
    }
  }
  if(!mw.IsDone())throw Error('empty envelope');const out=a.own(mw.Wire());
  if(!oc.BRep_Tool.IsClosed(out))throw Error('open envelope');
  return {wire:out,edges,sourceEdges,bezierPieces,maxBound,shortPoints,representationErrorBound:maxBound+2e-7};
}

/** Read every edge of a planar shape as a line or circular arc; anything else is refused. */
export function planarSegments(k:Kernel,shape:import('libcascade/single/init').TopoDS_Shape,a:Arena):Seg2[] {
  const oc=k.oc,ex=a.own(new oc.TopExp_Explorer(shape,oc.TopAbs_ShapeEnum.TopAbs_EDGE,oc.TopAbs_ShapeEnum.TopAbs_SHAPE)),out:Seg2[]=[];
  for(;ex.More();ex.Next()) {
    const ad=a.own(new oc.BRepAdaptor_Curve(a.own(oc.TopoDS.Edge(a.own(ex.Current()))))),f=ad.FirstParameter(),l=ad.LastParameter();
    const pt=(u:number):[number,number,number]=>{const p=a.own(ad.Value(u));return [p.X(),p.Y(),p.Z()];};
    const pa=pt(f),pm=pt((f+l)/2),pb=pt(l),type=String(ad.GetType());
    if([pa,pm,pb].some(p=>Math.abs(p[2]-pa[2])>1e-9))throw Error('planar edge required');
    const xy=(p:[number,number,number]):[number,number]=>[p[0],p[1]];
    if(type==='GeomAbs_Line')out.push({kind:'line',a:xy(pa),b:xy(pb)});
    else if(type==='GeomAbs_Circle') {
      const c=a.own(ad.Circle()),loc=a.own(c.Location()),axis=a.own(a.own(c.Axis()).Direction());
      if(Math.abs(Math.abs(axis.Z())-1)>1e-12)throw Error('arc axis must be the plane normal');
      out.push({kind:'arc',c:[loc.X(),loc.Y()],r:c.Radius(),a:xy(pa),m:xy(pm),b:xy(pb)});
    } else throw Error(`unsupported offset edge type ${type}`);
  }
  return out;
}

/**
 * Offsets a planar face whose boundary is the line/arc wire `source` outward by `gap`, and refuses the result when any part
 * of it comes closer than `gap - tolerance` to the source. Detection is the global minimum distance (OCCT extrema over the
 * whole wires); the places are found by sampling every output edge at `samplesPerEdge` points with the exact point distance,
 * grouped when closer than `gap` to each other. The global closest point always appears in the places.
 */
export function checkedOffset(k:Kernel,source:TopoDS_Wire,face:import('libcascade/single/init').TopoDS_Face,gap:number,a:Arena,tolerance=1e-6,samplesPerEdge=32) {
  if(!Number.isFinite(gap)||gap<=0)throw Error('positive finite gap required');
  if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>=gap)throw Error('positive finite tolerance below the gap required');
  if(!Number.isInteger(samplesPerEdge)||samplesPerEdge<1)throw Error('a positive whole number of samples per edge required');
  const oc=k.oc,raw=k as unknown as {put(s:import('libcascade/single/init').TopoDS_Shape):import('@3db/kernel').ShapeId};
  const mo=a.own(new oc.BRepOffsetAPI_MakeOffset(face,oc.GeomAbs_JoinType.GeomAbs_Arc,false));mo.Perform(gap);
  if(!mo.IsDone())throw Error('offset failed');
  const out=a.own(mo.Shape());
  const si=raw.put(source.Oriented(source.Orientation())),oi=raw.put(out.Oriented(out.Orientation()));let global:{distance:number;pointB:[number,number,number]};
  try{global=k.distance(si,oi) as typeof global;}finally{k.release(si);k.release(oi);}
  const output=planarSegments(k,out,a);
  if(global.distance>=gap-tolerance)return {shape:out,segments:output,minDistance:global.distance};
  throw new OffsetClearanceError(gap,global.distance,violationPlaces(planarSegments(k,source,a),output,gap,tolerance,samplesPerEdge,{p:[global.pointB[0],global.pointB[1]],d:global.distance}));
}

/**
 * Two-stage offset of a section wire that never returns a result violating the gap. The arc approximation goes first
 * (it works at every gap measured so far); only when its offset is refused is the biarc (G1) approximation tried, since
 * MakeOffset can fail outright on the biarc form at small gaps. When neither gives a result, the first clearance error is
 * thrown with its places; when neither even offsets, the failure says so.
 */
export function fallbackOffset(k:Kernel,section:TopoDS_Wire,plane:import('libcascade/single/init').gp_Pln,gap:number,epsilon:number,a:Arena) {
  const oc=k.oc,attempts:{mode:'arc'|'biarc';outcome:'ok'|'refused'|'failed';minDistance?:number;places?:number}[]=[];let firstRefusal:OffsetClearanceError|null=null;
  for(const mode of ['arc','biarc'] as const){
    const approx=sectionEnvelope(k,section,epsilon,a,mode),fm=a.own(new oc.BRepBuilderAPI_MakeFace(plane,approx.wire,true));
    if(!fm.IsDone())throw Error(`${mode} approximation face failed`);
    try{const result=checkedOffset(k,approx.wire,a.own(fm.Face()),gap,a);attempts.push({mode,outcome:'ok',minDistance:result.minDistance});return {mode,approx,result,attempts};}
    catch(e){
      if(e instanceof OffsetClearanceError){attempts.push({mode,outcome:'refused',minDistance:e.minDistance,places:e.locations.length});firstRefusal??=e;continue;}
      if(e instanceof Error&&e.message==='offset failed'){attempts.push({mode,outcome:'failed'});continue;}
      throw e;
    }
  }
  if(firstRefusal)throw firstRefusal;
  throw Error('offset failed in every approximation mode');
}
