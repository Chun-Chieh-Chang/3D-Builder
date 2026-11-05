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
  const visit=(p:H[],depth:number)=>{
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
  const visit=(p:H[],depth:number)=>{
    const first=xyz(p[0]!),last=xyz(p.at(-1)!),bound=Math.max(...p.map(h=>chordDistance(xyz(h),first,last)));
    if(bound<=epsilon){maxBound=Math.max(maxBound,bound);points.push(last);if(++leaves>100000)throw Error('envelope segment budget exceeded');return;}
    if(depth===24)throw Error('envelope subdivision budget exceeded');
    let row=p;const left:H[]=[row[0]!],right:H[]=[row.at(-1)!];
    while(row.length>1){row=row.slice(0,-1).map((h,i)=>h.map((x,j)=>(x+row[i+1]![j]!)/2) as H);left.push(row[0]!);right.push(row.at(-1)!);}
    visit(left,depth+1);visit(right.reverse(),depth+1);
  };
  visit(poles,0);return {points,maxBound,leaves};
}

export function sectionEnvelope(k:Kernel,wire:TopoDS_Wire,epsilon:number,a:Arena,mode:'polygon'|'arc') {
  if(!Number.isFinite(epsilon)||epsilon<=0)throw Error('positive finite envelope tolerance required');
  const oc=k.oc,ex=a.own(new oc.BRepTools_WireExplorer(wire)),mw=a.own(new oc.BRepBuilderAPI_MakeWire());
  let edges=0,sourceEdges=0,maxBound=0,shortPoints=0;
  for(;ex.More();ex.Next()) {
    const edge=a.own(ex.Current()),ad=a.own(new oc.BRepAdaptor_Curve(edge));sourceEdges++;
    const type=String(ad.GetType());
    if(type==='GeomAbs_Line'||type==='GeomAbs_Circle'){mw.Add(edge);edges++;continue;}
    if(type!=='GeomAbs_BSplineCurve')throw Error('unsupported envelope curve type');
    const bs=a.own(ad.BSpline()),beziers=a.own(new oc.GeomConvert_BSplineCurveToBezierCurve(bs,ad.FirstParameter(),ad.LastParameter(),1e-12));
    let pieces:EnvelopePiece[]=[];
    for(let i=1;i<=beziers.NbArcs();i++) {
      const bez=a.own(beziers.Arc(i)),poles:H[]=[];
      for(let j=1;j<=bez.NbPoles();j++){const p=a.own(bez.Pole(j)),w=bez.Weight(j);poles.push([p.X()*w,p.Y()*w,p.Z()*w,w]);}
      if(mode==='arc'){const result=arcEnvelope(poles,epsilon);maxBound=Math.max(maxBound,result.maxBound);pieces.push(...result.pieces);}
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
