import { beforeAll, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { Arena } from '../../packages/kernel/src/occt';
import { flatten, arcEnvelope, type EnvelopePiece } from './section-offset-envelope';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
let k:Kernel;
beforeAll(async()=>{k=await Kernel.load();});
function distance(p:number[],a:number[],b:number[]) {
  const v=b.map((x,i)=>x-a[i]!),n=v.reduce((s,x)=>s+x*x,0),t=n===0?0:Math.max(0,Math.min(1,v.reduce((s,x,i)=>s+x*(p[i]!-a[i]!),0)/n));
  return Math.hypot(...p.map((x,i)=>x-a[i]!-t*v[i]!));
}
function pieceDistance(p:number[],piece:EnvelopePiece) {
  if(piece.kind==='line')return distance(p,piece.from,piece.to);
  const [a,m,b]=[piece.from,piece.mid,piece.to],ux=m[0]-a[0],uy=m[1]-a[1],vx=b[0]-a[0],vy=b[1]-a[1],det=2*(ux*vy-uy*vx);
  const uu=ux*ux+uy*uy,vv=vx*vx+vy*vy,cx=a[0]+(uu*vy-vv*uy)/det,cy=a[1]+(ux*vv-vx*uu)/det;
  const ax=a[0]-cx,ay=a[1]-cy,bx=b[0]-cx,by=b[1]-cy,sweep=Math.atan2(ax*by-ay*bx,ax*bx+ay*by),angle=Math.atan2(ax*(p[1]!-cy)-ay*(p[0]!-cx),ax*(p[0]!-cx)+ay*(p[1]!-cy));
  if((sweep>=0&&angle>=0&&angle<=sweep)||(sweep<0&&angle<=0&&angle>=sweep))return Math.abs(Math.hypot(p[0]!-cx,p[1]!-cy)-Math.hypot(ax,ay));
  return Math.min(Math.hypot(...p.map((x,i)=>x-a[i]!)),Math.hypot(...p.map((x,i)=>x-b[i]!)));
}
it('rejects invalid error budgets, poles and unbounded subdivision explicitly',()=>{
  const poles:[number,number,number,number][]=[[0,0,0,1],[0.5,1,0,1],[1,0,0,1]];
  for(const e of [0,-1,NaN,Infinity])expect(()=>flatten(poles,e)).toThrow('positive finite');
  for(const e of [0,-1,NaN,Infinity])expect(()=>arcEnvelope(poles,e)).toThrow('positive finite');
  for(const w of [0,-1,NaN,Infinity])expect(()=>flatten([[0,0,0,1],[1,1,0,w]],1e-6)).toThrow('positive weights');
  for(const w of [0,-1,NaN,Infinity])expect(()=>arcEnvelope([[0,0,0,1],[1,1,0,w]],1e-6)).toThrow('positive weights');
  expect(()=>flatten(poles,1e-100)).toThrow('subdivision budget');
  expect(()=>arcEnvelope([[0,0,0,1],[1,1,1,1]],1e-6)).toThrow('XY planar');
  const result=flatten(poles,2e-6);expect(result.leaves).toBeGreaterThan(2);expect(result.maxBound).toBeLessThanOrEqual(2e-6);
});

it('encloses a rational unit quarter-circle with an independent analytic radius',()=>{
  const w=Math.SQRT1_2,result=arcEnvelope([[1,0,0,1],[w,w,0,w],[0,1,0,1]],2e-6);
  expect(result.maxBound).toBeLessThan(1e-10);expect(result.pieces.every(p=>p.kind==='arc')).toBe(true);
  for(const p of result.pieces)for(const q of [p.from,p.mid,p.to])expect(Math.abs(Math.hypot(q[0],q[1])-1)).toBeLessThan(1e-12);
});

it('checks 100 rational circular envelopes against native Bezier curves in both directions',()=>{
  const oc=k.oc,heap=()=> (oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength,startHeap=heap();expect(startHeap).toBeGreaterThan(0);
  let seed=240,maxCurveError=0,maxArcError=0,maxCertifiedBound=0,maxPieces=0,arcs=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let c=0;c<100;c++) {
    const a=new Arena(),width=0.5+10*random(),height=0.1+4*random(),count=3+c%4;
    try {
      const poles=a.own(new oc.NCollection_Array1_gp_Pnt(1,count)),weights=a.own(new oc.NCollection_Array1_double(1,count)),homogeneous:[number,number,number,number][]=[];
      for(let i=0;i<count;i++){const x=width*i/(count-1),y=i===0||i===count-1?0:height*random(),w=0.25+2*random();poles.SetValue(i+1,a.own(new oc.gp_Pnt(x,y,0)));weights.SetValue(i+1,w);homogeneous.push([x*w,y*w,0,w]);}
      const curve=a.own(new oc.Geom_BezierCurve(poles,weights)),result=arcEnvelope(homogeneous,2e-6);expect(result.maxBound).toBeLessThanOrEqual(2e-6);maxPieces=Math.max(maxPieces,result.pieces.length);maxCertifiedBound=Math.max(maxCertifiedBound,result.maxBound);arcs+=result.pieces.filter(p=>p.kind==='arc').length;
      for(let i=0;i<=100;i++){const p=a.own(curve.Value(i/100)),xyz=[p.X(),p.Y(),p.Z()],error=Math.min(...result.pieces.map(piece=>pieceDistance(xyz,piece)));expect(error,`curve ${c}, sample ${i}`).toBeLessThanOrEqual(result.maxBound+1e-10);maxCurveError=Math.max(maxCurveError,error);}
      for(let i=0;i<5;i++) {const piece=result.pieces[Math.floor(random()*result.pieces.length)]!;
        const candidate=piece.kind==='arc'?a.own(a.own(new oc.GC_MakeArcOfCircle(a.own(new oc.gp_Pnt(...piece.from)),a.own(new oc.gp_Pnt(...piece.mid)),a.own(new oc.gp_Pnt(...piece.to)))).Value()):a.own(a.own(new oc.GC_MakeSegment(a.own(new oc.gp_Pnt(...piece.from)),a.own(new oc.gp_Pnt(...piece.to)))).Value());
        const p=a.own(candidate.Value((candidate.FirstParameter()+candidate.LastParameter())/2)),projection=a.own(new oc.GeomAPI_ProjectPointOnCurve(p,curve));expect(projection.NbPoints()).toBeGreaterThan(0);const error=projection.LowerDistance();expect(error,`arc ${c}`).toBeLessThanOrEqual(result.maxBound+1e-10);maxArcError=Math.max(maxArcError,error);
      }
    }finally{a.dispose();}
  }
  expect(arcs).toBeGreaterThan(100);const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'arc-envelope-fuzz.json'),JSON.stringify({cases:100,startHeap,endHeap:heap(),maxCurveError,maxArcError,maxCertifiedBound,maxPieces,arcs,note:'Native positive-weight rational Bezier curves; not general offset coverage.'},null,2));
});
it('checks 100 rational Bezier envelopes against actual OCCT curves, including chord-to-curve probes',()=>{
  const oc=k.oc,heap=()=> (oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength,startHeap=heap();expect(startHeap).toBeGreaterThan(0);
  let seed=239,maxCurveError=0,maxChordError=0,maxCertifiedBound=0,maxSegments=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let c=0;c<100;c++) {
    const a=new Arena(),width=0.5+10*random(),height=0.1+4*random(),count=3+c%4;
    try {
      const poles=a.own(new oc.NCollection_Array1_gp_Pnt(1,count)),weights=a.own(new oc.NCollection_Array1_double(1,count)),homogeneous:[number,number,number,number][]=[];
      for(let i=0;i<count;i++) {const x=width*i/(count-1),y=i===0||i===count-1?0:height*random(),w=0.25+2*random();poles.SetValue(i+1,a.own(new oc.gp_Pnt(x,y,0)));weights.SetValue(i+1,w);homogeneous.push([x*w,y*w,0,w]);}
      const curve=a.own(new oc.Geom_BezierCurve(poles,weights)),result=flatten(homogeneous,2e-6);maxSegments=Math.max(maxSegments,result.leaves);maxCertifiedBound=Math.max(maxCertifiedBound,result.maxBound);
      for(let i=0;i<=100;i++) {const p=a.own(curve.Value(i/100)),xyz=[p.X(),p.Y(),p.Z()];let error=Infinity;for(let j=1;j<result.points.length;j++)error=Math.min(error,distance(xyz,result.points[j-1]!,result.points[j]!));expect(error,`curve ${c}, sample ${i}`).toBeLessThanOrEqual(result.maxBound+1e-11);maxCurveError=Math.max(maxCurveError,error);}
      for(let i=0;i<5;i++) {const index=Math.floor(random()*result.leaves),p=result.points[index]!,q=result.points[index+1]!,point=a.own(new oc.gp_Pnt((p[0]+q[0])/2,(p[1]+q[1])/2,(p[2]+q[2])/2));
        const projection=a.own(new oc.GeomAPI_ProjectPointOnCurve(point,curve));expect(projection.NbPoints()).toBeGreaterThan(0);const error=projection.LowerDistance();expect(error).toBeLessThanOrEqual(result.maxBound+1e-11);maxChordError=Math.max(maxChordError,error);
      }
    }finally{a.dispose();}
  }
  expect(k.liveShapes).toBe(0);const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'envelope-fuzz.json'),JSON.stringify({cases:100,startHeap,endHeap:heap(),maxCurveError,maxChordError,maxCertifiedBound,maxSegments,note:'Native rational curves; envelope-only fuzz, not offset or STEP fuzz.'},null,2));
});
