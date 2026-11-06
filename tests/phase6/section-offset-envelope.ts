/** Explicit polygonal approximation experiment, never an implicit product fallback. */
import type { Kernel } from '@3db/kernel';
import type { TopoDS_Wire } from 'libcascade/single/init';
import { Arena } from '../../packages/kernel/src/occt';
type P=[number,number,number];
type H=[number,number,number,number];
export type EnvelopePiece={kind:'line'|'arc';from:P;to:P;mid:P;bound:number};
const xyz=(h:H):P=>[h[0]/h[3],h[1]/h[3],h[2]/h[3]];
const distance=(a:P,b:P)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
function chordDistance(p:P,a:P,b:P) {
  const v=b.map((x,i)=>x-a[i]!),length=v.reduce((s,x)=>s+x*x,0);
  const t=length===0?0:Math.max(0,Math.min(1,v.reduce((s,x,i)=>s+x*(p[i]!-a[i]!),0)/length));
  return Math.hypot(...p.map((x,i)=>x-a[i]!-t*v[i]!));
}
const choose=(n:number,k:number)=>{let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;};
function split(p:H[]) {
  let row=p;const left:H[]=[row[0]!],right:H[]=[row.at(-1)!];
  while(row.length>1){row=row.slice(0,-1).map((h,i)=>h.map((x,j)=>(x+row[i+1]![j]!)/2) as H);left.push(row[0]!);right.push(row.at(-1)!);}
  return {left,right:right.reverse(),mid:xyz(row[0]!)};
}
/** A circle's implicit polynomial in Bernstein form encloses radial error over
 * the entire rational Bezier span. A convex angular cone supplies the converse
 * arc-to-curve bound; no equally spaced samples are used as a certificate.
 */
export function arcEnvelope(poles:H[],epsilon:number) {
  if(!Number.isFinite(epsilon)||epsilon<=0)throw Error('positive finite envelope tolerance required');
  if(poles.length<2||poles.some(p=>!p.every(Number.isFinite)||p[3]<=0))throw Error('finite poles with positive weights required');
  if(poles.length>27||poles.some(h=>!xyz(h).every(Number.isFinite)))throw Error('unsupported envelope degree or scale');
  if(Math.max(...poles.map(h=>xyz(h)[2]))-Math.min(...poles.map(h=>xyz(h)[2]))>1e-12)throw Error('XY planar envelope required');
  const pieces:EnvelopePiece[]=[];
  const visit=(p:H[],depth:number,o0?:[number,number],o1?:[number,number])=>{
    if(pieces.length>=100000)throw Error('envelope segment budget exceeded');
    const from=xyz(p[0]!),to=xyz(p.at(-1)!),parts=split(p),mid=parts.mid;
    const lineBound=Math.max(...p.map(h=>chordDistance(xyz(h),from,to)));
    if(lineBound<=epsilon){pieces.push({kind:'line',from,to,mid,bound:lineBound});return;}
    const ux=mid[0]-from[0],uy=mid[1]-from[1],vx=to[0]-from[0],vy=to[1]-from[1],det=2*(ux*vy-uy*vx);
    if(det!==0) {
      const uu=ux*ux+uy*uy,vv=vx*vx+vy*vy,cx=from[0]+(uu*vy-vv*uy)/det,cy=from[1]+(ux*vv-vx*uu)/det;
      const ax=from[0]-cx,ay=from[1]-cy,bx=to[0]-cx,by=to[1]-cy,r=Math.hypot(ax,ay),sweep=Math.atan2(ax*by-ay*bx,ax*bx+ay*by),sign=sweep<0?-1:1;
      const angle=(q:P)=>sign*Math.atan2(ax*(q[1]-cy)-ay*(q[0]-cx),ax*(q[0]-cx)+ay*(q[1]-cy));
      const cone=Number.isFinite(r)&&r>0&&Math.abs(sweep)<Math.PI/2&&angle(mid)>0&&angle(mid)<Math.abs(sweep)&&p.every(h=>{const t=angle(xyz(h));return t>=-1e-12&&t<=Math.abs(sweep)+1e-12;});
      if(cone) {
        const n=p.length-1,minW=Math.min(...p.map(h=>h[3])),maxW=Math.max(...p.map(h=>h[3]));let maxF=0,maxTerm=0;
        for(let k=0;k<=2*n;k++) {let f=0;
          for(let i=Math.max(0,k-n);i<=Math.min(n,k);i++) {const j=k-i,pi=p[i]!,pj=p[j]!,factor=choose(n,i)*choose(n,j)/choose(2*n,k),x=(pi[0]-cx*pi[3])*(pj[0]-cx*pj[3]),y=(pi[1]-cy*pi[3])*(pj[1]-cy*pj[3]),z=r*r*pi[3]*pj[3];f+=factor*(x+y-z);maxTerm=Math.max(maxTerm,Math.abs(x)+Math.abs(y)+Math.abs(z));}
          maxF=Math.max(maxF,Math.abs(f));
        }
        const roundoff=128*Number.EPSILON*(n+1)*(maxTerm+r*r*maxW*maxW),bound=(maxF+roundoff)/(minW*minW*r);
        if(bound<=epsilon){pieces.push({kind:'arc',from,to,mid,bound});return;}
      }
    }
    if(depth===24||pieces.length>100000)throw Error('envelope subdivision budget exceeded');
    visit(parts.left,depth+1);visit(parts.right,depth+1);
  };
  visit(poles,0);return {pieces,maxBound:Math.max(...pieces.map(p=>p.bound))};
}
/** Positive rational weights put the entire Bezier arc in its control hull.
 * Distance to a convex segment is convex, so this bounds the whole arc.
 * Continuity and the two endpoints give the converse chord-to-arc bound.
 */
export function flatten(poles:H[],epsilon:number) {
  if(!Number.isFinite(epsilon)||epsilon<=0)throw Error('positive finite envelope tolerance required');
  if(poles.length<2||poles.some(p=>!p.every(Number.isFinite)||p[3]<=0))throw Error('finite poles with positive weights required');
  const points:P[]=[xyz(poles[0]!)];let maxBound=0,leaves=0;
  const visit=(p:H[],depth:number,o0?:[number,number],o1?:[number,number])=>{
    const first=xyz(p[0]!),last=xyz(p.at(-1)!),bound=Math.max(...p.map(h=>chordDistance(xyz(h),first,last)));
    if(bound<=epsilon){maxBound=Math.max(maxBound,bound);points.push(last);if(++leaves>100000)throw Error('envelope segment budget exceeded');return;}
    if(depth===24)throw Error('envelope subdivision budget exceeded');
    let row=p;const left:H[]=[row[0]!],right:H[]=[row.at(-1)!];
    while(row.length>1){row=row.slice(0,-1).map((h,i)=>h.map((x,j)=>(x+row[i+1]![j]!)/2) as H);left.push(row[0]!);right.push(row.at(-1)!);}
    visit(left,depth+1);visit(right.reverse(),depth+1);
  };
  visit(poles,0);return {points,maxBound,leaves};
}

/** Below this angle (rad) a junction between a spline and another source edge gets one shared tangent in biarc mode. */
const SNAP=1e-2;
export function sectionEnvelope(k:Kernel,wire:TopoDS_Wire,epsilon:number,a:Arena,mode:'polygon'|'arc'|'biarc') {
  if(!Number.isFinite(epsilon)||epsilon<=0)throw Error('positive finite envelope tolerance required');
  const oc=k.oc,ex=a.own(new oc.BRepTools_WireExplorer(wire)),mw=a.own(new oc.BRepBuilderAPI_MakeWire());
  let edges=0,sourceEdges=0,maxBound=0,shortPoints=0;
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
    if(type==='GeomAbs_Line'||type==='GeomAbs_Circle'){mw.Add(edge);edges++;continue;}
    if(type!=='GeomAbs_BSplineCurve')throw Error('unsupported envelope curve type');
    const bs=a.own(ad.BSpline()),beziers=a.own(new oc.GeomConvert_BSplineCurveToBezierCurve(bs,ad.FirstParameter(),ad.LastParameter(),1e-12));
    let pieces:EnvelopePiece[]=[];
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
  return {wire:out,edges,sourceEdges,maxBound,shortPoints,representationErrorBound:maxBound+2e-7};
}

/** Planar line or circular-arc edge read back from an OCCT wire. */
export type Seg2={kind:'line';a:[number,number];b:[number,number]}|{kind:'arc';c:[number,number];r:number;a:[number,number];m:[number,number];b:[number,number]};
export type OffsetCertificate={edges:number;maxUpper:number;generators:{line:number;arc:number;vertex:number;lipschitz:number};refined:{pieces:number;budget:number};sampledMax:number;failures:{index:number;best:number}[]};
/** Largest angular overrun past a source arc end that still uses that arc as generator (rad). */
const OVERRUN=0.2;
/** Total bisection steps allowed across one certificate before it refuses. */
const REFINE_BUDGET=12_000_000;
/** Bisection steps allowed for any single edge. */
const EDGE_BUDGET=400_000;
const d2=(p:[number,number],q:[number,number])=>Math.hypot(p[0]-q[0],p[1]-q[1]);
const turn=(x:number)=>{const t=x%(2*Math.PI);return t<0?t+2*Math.PI:t;};
/** Angle span of an arc measured from its own start, in its own direction. */
function span(c:[number,number],a:[number,number],m:[number,number],b:[number,number]) {
  const ang=(p:[number,number])=>Math.atan2(p[1]-c[1],p[0]-c[0]),a0=ang(a);
  const ccw=turn(ang(m)-a0)<turn(ang(b)-a0),dir=ccw?1:-1;
  const sweep=turn(dir*(ang(b)-a0))||2*Math.PI;
  return {a0,dir,sweep,at:(p:[number,number])=>turn(dir*(ang(p)-a0))};
}

/** Exact distance from a point to one line or arc element. */
function pointTo(p:[number,number],s:Seg2,sp?:ReturnType<typeof span>) {
  if(s.kind==='line'){const vx=s.b[0]-s.a[0],vy=s.b[1]-s.a[1],l2=vx*vx+vy*vy,t=l2===0?0:Math.max(0,Math.min(1,((p[0]-s.a[0])*vx+(p[1]-s.a[1])*vy)/l2));return Math.hypot(p[0]-s.a[0]-t*vx,p[1]-s.a[1]-t*vy);}
  const q=sp??span(s.c,s.a,s.m,s.b),t=q.at(p);
  return t<=q.sweep?Math.abs(d2(p,s.c)-s.r):Math.min(d2(p,s.a),d2(p,s.b));
}
/** Point on an edge at fraction u, and the edge length. */
function along(o:Seg2) {
  if(o.kind==='line')return {len:d2(o.a,o.b),at:(u:number):[number,number]=>[o.a[0]+u*(o.b[0]-o.a[0]),o.a[1]+u*(o.b[1]-o.a[1])]};
  const q=span(o.c,o.a,o.m,o.b);
  return {len:o.r*q.sweep,at:(u:number):[number,number]=>{const t=q.a0+q.dir*q.sweep*u;return [o.c[0]+o.r*Math.cos(t),o.c[1]+o.r*Math.sin(t)];}};
}
/** Exact distance from any point to a set of line/arc elements, through a uniform grid of their boxes. */
export function nearestField(source:Seg2[],minCell:number) {
  const allSpans=source.map(q=>q.kind==='arc'?span(q.c,q.a,q.m,q.b):undefined);
  // Uniform grid over element boxes so the exact point distance only visits nearby elements.
  const box=source.map(q=>{const pts=[q.a,q.b,...(q.kind==='arc'?[q.m]:[])],pad=q.kind==='arc'?d2(q.a,q.b)/2+d2(q.a,q.m):0;
    return [Math.min(...pts.map(p=>p[0]))-pad,Math.min(...pts.map(p=>p[1]))-pad,Math.max(...pts.map(p=>p[0]))+pad,Math.max(...pts.map(p=>p[1]))+pad] as const;});
  const h=Math.max(minCell,...[0.5].map(()=>{const w=box.map(b=>Math.max(b[2]-b[0],b[3]-b[1])).sort((x,y)=>x-y);return 2*w[Math.floor(w.length/2)]!;})),grid=new Map<string,number[]>();
  box.forEach((b,i)=>{for(let x=Math.floor(b[0]/h);x<=Math.floor(b[2]/h);x++)for(let y=Math.floor(b[1]/h);y<=Math.floor(b[3]/h);y++){const key=x+','+y;(grid.get(key)??grid.set(key,[]).get(key)!).push(i);}});
  const nearest=(p:[number,number])=>{const cx=Math.floor(p[0]/h),cy=Math.floor(p[1]/h);let near=Infinity;const seen=new Set<number>();
    for(let ring=0;ring<1e4;ring++){
      if(near<=(ring-1)*h)break;
      for(let x=cx-ring;x<=cx+ring;x++)for(let y=cy-ring;y<=cy+ring;y++){if(Math.max(Math.abs(x-cx),Math.abs(y-cy))!==ring)continue;
        for(const i of grid.get(x+','+y)??[]){if(seen.has(i))continue;seen.add(i);near=Math.min(near,pointTo(p,source[i]!,allSpans[i]));}}
    }
    return near;};
  return nearest;
}
/** Edge-by-edge upper bound on the distance from every point of `output` to `source`.
 * Each output edge must be generated by one source element, with no sampling:
 * a line parallel to a source line whose endpoints project inside it (the distance is
 * linear along the edge, so the endpoints bound it); an arc concentric with a source arc
 * whose angular span lies inside the source span (radial distance is |R-r| plus the
 * centre mismatch); or a join arc around a source vertex (R plus the centre mismatch).
 * The lower bound is NOT certified here: it comes from a global minimum distance.
 */
export function certifyOffset(source:Seg2[],output:Seg2[],gap:number,slack:number):OffsetCertificate {
  if(!Number.isFinite(gap)||gap<=0)throw Error('positive finite gap required');
  if(!Number.isFinite(slack)||slack<=0||slack>=gap)throw Error('positive finite slack below the gap required');
  if(!source.length||!output.length)throw Error('non-empty source and output required');
  const finite=(s:Seg2)=>[s.a,s.b,...(s.kind==='arc'?[s.c,s.m,[s.r,0] as [number,number]]:[])].every(p=>p.every(Number.isFinite));
  if(!source.every(finite)||!output.every(finite))throw Error('finite edge geometry required');
  const vertices=source.flatMap(s=>[s.a,s.b]),lines=source.filter((s):s is Extract<Seg2,{kind:'line'}>=>s.kind==='line'),arcs=source.filter((s):s is Extract<Seg2,{kind:'arc'}>=>s.kind==='arc');
  const sourceSpans=arcs.map(s=>span(s.c,s.a,s.m,s.b));
  const nearest=nearestField(source,gap);
  const limit=gap+slack,result:OffsetCertificate={edges:output.length,maxUpper:0,generators:{line:0,arc:0,vertex:0,lipschitz:0},refined:{pieces:0,budget:0},sampledMax:0,failures:[]};
  output.forEach((o,index)=>{
    let best=Infinity,kind:'line'|'arc'|'vertex'|null=null;
    if(o.kind==='line') {
      // Distance to a convex segment is convex along a line, so the larger endpoint distance bounds the edge.
      for(const s of lines) {
        const vx=s.b[0]-s.a[0],vy=s.b[1]-s.a[1],len2=vx*vx+vy*vy;if(len2===0)continue;
        const dist=(p:[number,number])=>{const t=Math.max(0,Math.min(1,((p[0]-s.a[0])*vx+(p[1]-s.a[1])*vy)/len2));return Math.hypot(p[0]-s.a[0]-t*vx,p[1]-s.a[1]-t*vy);};
        const bound=Math.max(dist(o.a),dist(o.b));if(bound<best){best=bound;kind='line';}
      }
    } else {
      const R=o.r;
      for(const v of vertices){const bound=R+d2(o.c,v);if(bound<best){best=bound;kind='vertex';}}
      arcs.forEach((s,i)=>{
        const e=d2(o.c,s.c);if(e>=R||e>=s.r)return;
        // Angles about the source centre, measured from its start; angles past the far side of the
        // gap in the circle count as "before the start" so a small overrun at either end is one interval.
        const sp=sourceSpans[i]!,eps=1e-12,cut=sp.sweep+(2*Math.PI-sp.sweep)/2,g=(p:[number,number])=>{const t=sp.at(p);return t>cut?t-2*Math.PI:t;};
        const ta=g(o.a),tm=g(o.m),tb=g(o.b),lo=Math.min(ta,tb),hi=Math.max(ta,tb);
        if(tm<lo-eps||tm>hi+eps||lo<-OVERRUN||hi>sp.sweep+OVERRUN)return;
        let bound=Math.abs(R-s.r)+e;
        // Beyond the span the nearest generator point is that end vertex; the distance to it grows
        // with the angle away from it, so the overrunning output endpoint bounds that portion.
        if(lo<-eps)bound=Math.max(bound,d2(ta<tb?o.a:o.b,s.a)+2*e);
        if(hi>sp.sweep+eps)bound=Math.max(bound,d2(ta<tb?o.b:o.a,s.b)+2*e);
        if(bound<best){best=bound;kind='arc';}
      });
    }
    if(kind&&best<=limit){result.generators[kind]++;result.maxUpper=Math.max(result.maxUpper,best);return;}
    // Fallback: the distance to the source is 1-Lipschitz, so on a piece of arc length L its supremum is at
    // most the exact distance at the piece midpoint plus L/2. Bisect until each piece is below the limit.
    const path=along(o),stack:[number,number][]=[[0,1]];let worst=0,pieces=0,ok=true,steps=0;
    while(stack.length){
      const [u0,u1]=stack.pop()!,mid=path.at((u0+u1)/2),half=path.len*(u1-u0)/2;
      const near=nearest(mid);
      const bound=near+half;
      if(bound<=limit){worst=Math.max(worst,bound);pieces++;continue;}
      if(half<1e-9||near>limit||++steps>EDGE_BUDGET||++result.refined.budget>REFINE_BUDGET){ok=false;break;}
      stack.push([u0,(u0+u1)/2],[(u0+u1)/2,u1]);
    }
    if(ok){for(let j=0;j<=64;j++)result.sampledMax=Math.max(result.sampledMax,nearest(path.at(j/64)));result.generators.lipschitz++;result.refined.pieces+=pieces;result.maxUpper=Math.max(result.maxUpper,worst);}
    else result.failures.push({index,best});
  });
  return result;
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

/** Where an offset comes closer to its source than the gap: the closest point of one place, its distance, how many samples. */
export type ClearanceViolation={point:[number,number];distance:number;samples:number};
/** Thrown instead of returning an offset that violates the gap, with every place where it does. */
export class OffsetClearanceError extends Error {
  constructor(readonly gap:number,readonly minDistance:number,readonly locations:ClearanceViolation[]) {
    super(`offset violates the gap ${gap} mm at ${locations.length} place(s); closest ${minDistance.toFixed(6)} mm at (${locations[0]?.point.map(x=>x.toFixed(3)).join(', ')})`);
    this.name='OffsetClearanceError';
  }
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
  const near=nearestField(planarSegments(k,source,a),gap),bad:{p:[number,number];d:number}[]=[];
  for(const o of output){const path=along(o);for(let j=0;j<=samplesPerEdge;j++){const p=path.at(j/samplesPerEdge),d=near(p);if(d<gap-tolerance)bad.push({p,d});}}
  bad.push({p:[global.pointB[0],global.pointB[1]],d:global.distance});
  // Union-find over a grid of cell `gap`: samples closer than `gap` belong to one place.
  const parent=bad.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]!)),cell=new Map<string,number[]>();
  bad.forEach((b,i)=>{const key=Math.floor(b.p[0]/gap)+','+Math.floor(b.p[1]/gap);(cell.get(key)??cell.set(key,[]).get(key)!).push(i);});
  bad.forEach((b,i)=>{const cx=Math.floor(b.p[0]/gap),cy=Math.floor(b.p[1]/gap);
    for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const j of cell.get(x+','+y)??[])if(j<i&&d2(b.p,bad[j]!.p)<gap)parent[find(i)]=find(j);});
  const groups=new Map<number,ClearanceViolation>();
  bad.forEach((b,i)=>{const r=find(i),g=groups.get(r);if(!g)groups.set(r,{point:b.p,distance:b.d,samples:1});else{g.samples++;if(b.d<g.distance){g.distance=b.d;g.point=b.p;}}});
  const locations=[...groups.values()].sort((x,y)=>x.distance-y.distance);
  throw new OffsetClearanceError(gap,global.distance,locations);
}

/** Rational de Casteljau split of homogeneous poles at parameter t. */
function splitAt(p:H[],t:number){let row=p;const left:H[]=[row[0]!],right:H[]=[row.at(-1)!];
  while(row.length>1){row=row.slice(0,-1).map((h,i)=>h.map((x,j)=>x*(1-t)+row[i+1]![j]!*t) as H);left.push(row[0]!);right.push(row.at(-1)!);}
  return {left,right:right.reverse(),point:xyz(row[0]!)};}
/** Radial deviation bound of a positive-weight rational Bezier from the circle (cx, cy, r): the Bernstein form of
 * F = (X-cx W)^2 + (Y-cy W)^2 - r^2 W^2 bounds |F|, and |rho - r| = |F| / (W^2 (rho + r)) <= max|F| / (minW^2 r). */
function circleBound(p:H[],cx:number,cy:number,r:number){
  const n=p.length-1,minW=Math.min(...p.map(h=>h[3])),maxW=Math.max(...p.map(h=>h[3]));let maxF=0,maxTerm=0;
  for(let k=0;k<=2*n;k++){let f=0;for(let i=Math.max(0,k-n);i<=Math.min(n,k);i++){const j=k-i,pi=p[i]!,pj=p[j]!,factor=choose(n,i)*choose(n,j)/choose(2*n,k),x=(pi[0]-cx*pi[3])*(pj[0]-cx*pj[3]),y=(pi[1]-cy*pi[3])*(pj[1]-cy*pj[3]),z=r*r*pi[3]*pj[3];f+=factor*(x+y-z);maxTerm=Math.max(maxTerm,Math.abs(x)+Math.abs(y)+Math.abs(z));}maxF=Math.max(maxF,Math.abs(f));}
  return (maxF+128*Number.EPSILON*(n+1)*(maxTerm+r*r*maxW*maxW))/(minW*minW*r);}
/** The arc leaving point s with unit tangent t that ends at e; null when s, t, e are collinear (a line). */
function arcLeaving(s:P,t:[number,number],e:P){const n:[number,number]=[-t[1],t[0]],dx=e[0]-s[0],dy=e[1]-s[1],den=2*(dx*n[0]+dy*n[1]);
  if(Math.abs(den)<=1e-14*Math.hypot(dx,dy))return null;
  const sN=(dx*dx+dy*dy)/den,cx=s[0]+sN*n[0],cy=s[1]+sN*n[1],r=Math.abs(sN),a0=Math.atan2(s[1]-cy,s[0]-cx),a1=Math.atan2(e[1]-cy,e[0]-cx),turn=sN>0?1:-1;
  let sweep=turn*(a1-a0);while(sweep<0)sweep+=2*Math.PI;while(sweep>=2*Math.PI)sweep-=2*Math.PI;
  const mid:P=[cx+r*Math.cos(a0+turn*sweep/2),cy+r*Math.sin(a0+turn*sweep/2),s[2]];
  return {cx,cy,r,a0,turn,sweep,mid,endTangent:[-turn*Math.sin(a0+turn*sweep),turn*Math.cos(a0+turn*sweep)] as [number,number]};}
/**
 * G1 envelope of one rational Bezier: each leaf is a biarc whose two ends take the curve's own tangents there, so
 * consecutive leaves (and consecutive Bezier pieces of a C1 spline) meet without a kink. The bound of each arc is the
 * Bernstein radial bound against the matching half of the curve, split at the parameter nearest the biarc's junction,
 * plus the distance from that junction to the curve; each half must also stay inside its arc's angular cone.
 */
/** Unit tangents at both ends of a rational Bezier, skipping control points within 1e-3 of the chord scale of an end
 * (a vanishing end derivative, such as the tiny hook OCCT leaves where a section curve meets a line). */
function endTangents(p:H[]){const pts=p.map(xyz),tol=1e-3*Math.max(...pts.map(q=>distance(q,pts[0]!)));let i=1;while(i<pts.length-1&&distance(pts[i]!,pts[0]!)<=tol)i++;let j=pts.length-2;while(j>0&&distance(pts[j]!,pts.at(-1)!)<=tol)j--;
  const u=(v:[number,number]):[number,number]=>{const l=Math.hypot(...v);return [v[0]/l,v[1]/l];};
  return {t0:u([pts[i]![0]-pts[0]![0],pts[i]![1]-pts[0]![1]]),t1:u([pts.at(-1)![0]-pts[j]![0],pts.at(-1)![1]-pts[j]![1]])};}
/** Leaves shorter than this (mm) become lines in biarc mode when their chord is within the tolerance. */
const BIARC_MIN_LEAF=1e-4;
export function biarcEnvelope(poles:H[],epsilon:number,ends:{t0?:[number,number];t1?:[number,number]}={}){
  if(!Number.isFinite(epsilon)||epsilon<=0)throw Error('positive finite envelope tolerance required');
  if(poles.length<2||poles.some(p=>!p.every(Number.isFinite)||p[3]<=0))throw Error('finite poles with positive weights required');
  if(poles.length>27||poles.some(h=>!xyz(h).every(Number.isFinite)))throw Error('unsupported envelope degree or scale');
  if(Math.max(...poles.map(h=>xyz(h)[2]))-Math.min(...poles.map(h=>xyz(h)[2]))>1e-12)throw Error('XY planar envelope required');
  const pieces:EnvelopePiece[]=[];
  const unit=(v:[number,number]):[number,number]=>{const l=Math.hypot(...v);return [v[0]/l,v[1]/l];};
  const inCone=(p:H[],arc:NonNullable<ReturnType<typeof arcLeaving>>,slack:number)=>p.every(h=>{const q=xyz(h);let t=arc.turn*(Math.atan2(q[1]-arc.cy,q[0]-arc.cx)-arc.a0);while(t<-Math.PI)t+=2*Math.PI;while(t>Math.PI)t-=2*Math.PI;return t>=-slack&&t<=arc.sweep+slack;});
  const visit=(p:H[],depth:number,o0?:[number,number],o1?:[number,number])=>{
    if(pieces.length>=100000)throw Error('envelope segment budget exceeded');
    const from=xyz(p[0]!),to=xyz(p.at(-1)!),own=endTangents(p),t0=o0??own.t0,t1=o1??own.t1;
    const lineBound=Math.max(...p.map(h=>chordDistance(xyz(h),from,to)));
    const chordDir=unit([to[0]-from[0],to[1]-from[1]]),straight=Math.abs(chordDir[0]*t0[1]-chordDir[1]*t0[0])<1e-12&&Math.abs(chordDir[0]*t1[1]-chordDir[1]*t1[0])<1e-12;
    if(straight&&lineBound<=epsilon){pieces.push({kind:'line',from,to,mid:splitAt(p,0.5).point,bound:lineBound});return;}
    // A leaf shorter than BIARC_MIN_LEAF is taken as a line when its chord is within the tolerance, even though its end
    // tangents differ from the chord: such leaves only appear where the section curve has a tiny end hook, and a biarc there
    // would follow the hook with micro arcs.
    if(distance(from,to)<BIARC_MIN_LEAF&&lineBound<=epsilon){pieces.push({kind:'line',from,to,mid:splitAt(p,0.5).point,bound:lineBound});return;}
    const vx=to[0]-from[0],vy=to[1]-from[1],dot=t0[0]*t1[0]+t0[1]*t1[1],den=2*(1-dot),vt=vx*(t0[0]+t1[0])+vy*(t0[1]+t1[1]),vv=vx*vx+vy*vy;
    const d=den<1e-14?vv/(2*(vx*t0[0]+vy*t0[1])):(-vt+Math.sqrt(vt*vt+den*vv))/den;
    if(Number.isFinite(d)&&d>0){
      const q0:[number,number]=[from[0]+d*t0[0],from[1]+d*t0[1]],q1:[number,number]=[to[0]-d*t1[0],to[1]-d*t1[1]],J:P=[(q0[0]+q1[0])/2,(q0[1]+q1[1])/2,from[2]];
      const a1=arcLeaving(from,t0,J),a2=arcLeaving(J,unit([q1[0]-q0[0],q1[1]-q0[1]]),to);
      if(a1&&a2&&a1.sweep<Math.PI/2&&a2.sweep<Math.PI/2&&distance(from,J)>=1e-6&&distance(J,to)>=1e-6){
        // the curve parameter nearest the junction: coarse samples, then golden-section refinement
        let tau=0,best=Infinity;for(let i=0;i<=32;i++){const q=splitAt(p,i/32).point,dd=distance(q,J);if(dd<best){best=dd;tau=i/32;}}
        let lo=Math.max(0,tau-1/32),hi=Math.min(1,tau+1/32);for(let it=0;it<60;it++){const m1=lo+(hi-lo)*0.382,m2=lo+(hi-lo)*0.618;if(distance(splitAt(p,m1).point,J)<distance(splitAt(p,m2).point,J))hi=m2;else lo=m1;}
        tau=(lo+hi)/2;const s=splitAt(p,tau),e=distance(s.point,J);
        if(tau>0&&tau<1){
          const slack=(e+epsilon)/Math.min(a1.r,a2.r)+1e-12;
          // Two bounds for each half, the smaller one kept. (a) Bernstein radial bound, valid when the half stays in the
          // arc's cone. (b) Chord route, free of the r^2 round-off that grows with the radius: the half is within its
          // control-hull distance of its own chord, that chord is within e of the arc's chord, and a minor arc is within its
          // sagitta of its chord, both ways.
          const sag=(arc:NonNullable<typeof a1>,c0:P,c1:P)=>{const h=distance(c0,c1)/2;return arc.r-Math.sqrt(Math.max(0,arc.r*arc.r-h*h));};
          const hull=(q:H[])=>{const f=xyz(q[0]!),l=xyz(q.at(-1)!);return Math.max(...q.map(h=>chordDistance(xyz(h),f,l)));};
          const alt1=hull(s.left)+sag(a1,from,J)+e,alt2=hull(s.right)+sag(a2,J,to)+e;
          const cone=inCone(s.left,a1,slack)&&inCone(s.right,a2,slack);
          {
            const b1=Math.min(cone?circleBound(s.left,a1.cx,a1.cy,a1.r)+e:Infinity,alt1),b2=Math.min(cone?circleBound(s.right,a2.cx,a2.cy,a2.r)+e:Infinity,alt2);
            if(b1<=epsilon&&b2<=epsilon){pieces.push({kind:'arc',from,to:J,mid:a1.mid,bound:b1},{kind:'arc',from:J,to,mid:a2.mid,bound:b2});return;}
          }
        }
      }
    }
    if(depth===24)throw Error('envelope subdivision budget exceeded');
    const half=splitAt(p,0.5);visit(half.left,depth+1,o0,undefined);visit(half.right,depth+1,undefined,o1);
  };
  visit(poles,0,ends.t0,ends.t1);
  return {pieces,maxBound:Math.max(...pieces.map(p=>p.bound))};
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
