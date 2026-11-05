/** Native diagnostics only. The original feasibility probe remains unchanged. */
import { beforeAll, afterAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TopoDS_Shape, TopoDS_Wire } from 'libcascade/single/init';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { gearArea } from '../phase3/gear-helpers';

let k: Kernel, initialHeap: number;
const frame: Frame = { origin: [0,0,0], xDir: [1,0,0], yDir: [0,1,0], normal: [0,0,1] };
const parameters = { kind: 'gear' as const, module: 1, teeth: 24, pressureAngle: 20*Math.PI/180, width: 5, bore: 0, backlash: 0, baseHeight: 0 };
const reports: Record<string, unknown>[] = [];
const raw = () => k as unknown as { get(id: ShapeId): TopoDS_Shape; put(s: TopoDS_Shape): ShapeId };
const heap = () => (k.oc as unknown as { wasmMemory: WebAssembly.Memory }).wasmMemory.buffer.byteLength;
beforeAll(async () => { k = await Kernel.load(); initialHeap = heap(); expect(initialHeap).toBeGreaterThan(0); });
afterAll(() => {
  const dir = resolve('out/section-clearance'); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'spline-isolation.json'), JSON.stringify({ initialHeap, finalHeap: heap(), reports }, null, 2));
});

function volume(s: TopoDS_Shape, a: Arena, eps?: number) {
  const p = a.own(new k.oc.GProp_GProps());
  const error = eps === undefined ? k.oc.BRepGProp.VolumeProperties(s,p,false,false,false) : k.oc.BRepGProp.VolumeProperties(s,p,eps,false,false);
  return { volume: p.Mass(), error };
}
function face(w: TopoDS_Wire, a: Arena) {
  const maker = a.own(new k.oc.BRepBuilderAPI_MakeFace(w,true)); expect(maker.IsDone()).toBe(true);
  return a.own(maker.Face());
}
function area(s: TopoDS_Shape, a: Arena) {
  const p = a.own(new k.oc.GProp_GProps()); k.oc.BRepGProp.SurfaceProperties(s,p,1e-10,false); return p.Mass();
}
function section(s: TopoDS_Shape, z: number, smooth: boolean, a: Arena) {
  const oc=k.oc, plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,z)),a.own(new oc.gp_Dir(0,0,1))));
  const cut=a.own(new oc.BRepAlgoAPI_Section(s,plane,false));
  cut.Approximation(smooth); cut.ComputePCurveOn2(true); cut.Build(); expect(cut.IsDone()).toBe(true);
  const edges=ShapeIndex.of(oc,a.own(cut.Shape()),'TopAbs_EDGE',a);
  try {
    const seq=a.own(new oc.NCollection_HSequence_TopoDS_Shape()); for(const e of edges.keys)seq.Append(e);
    const wires=a.own(a.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(seq,1e-7,false)).Sequence());
    expect(wires.Length()).toBe(1);
    const w=a.own(oc.TopoDS.Wire(a.own(wires.Value(1)))); expect(oc.BRep_Tool.IsClosed(w)).toBe(true);
    const joined=ShapeIndex.of(oc,w,'TopAbs_EDGE',a);try{expect(joined.size).toBe(edges.size);}finally{joined.dispose();}
    return w;
  } finally { edges.dispose(); }
}
/** Independent Green integral of native oriented 3D curves, split at EVERY spline knot.
 * Linear spans use exact endpoint cross products; smooth spans use composite Simpson.
 */
function green(w: TopoDS_Wire, a: Arena) {
  const oc=k.oc, ex=a.own(new oc.BRepTools_WireExplorer(w)); let sum=0, count=0;
  const splines: { degree: number; knots: number; poles: number }[]=[];
  for(;ex.More();ex.Next()) {
    const e=a.own(ex.Current()),c=a.own(new oc.BRepAdaptor_Curve(e)); count++;
    const first=c.FirstParameter(),last=c.LastParameter(); let breaks=[first,last],linear=String(c.GetType())==='GeomAbs_Line';
    if(String(c.GetType())==='GeomAbs_BSplineCurve') {
      const b=a.own(c.BSpline()); linear=b.Degree()===1;
      splines.push({degree:b.Degree(),knots:b.NbKnots(),poles:b.NbPoles()});
      breaks=[first,...Array.from({length:b.NbKnots()},(_,i)=>b.Knot(i+1)).filter(t=>t>first&&t<last),last];
    }
    let integral=0;
    const p=a.own(new oc.gp_Pnt()),d=a.own(new oc.gp_Vec());
    for(let i=0;i<breaks.length-1;i++) {
      const lo=breaks[i]!,hi=breaks[i+1]!;
      if(linear) {const p0=a.own(c.Value(lo)),p1=a.own(c.Value(hi));integral+=(p0.X()*p1.Y()-p0.Y()*p1.X())/2;}
      else {let v=0;const n=32;for(let j=0;j<=n;j++){c.D1(lo+(hi-lo)*j/n,p,d);v+=(j===0||j===n?1:j%2?4:2)*(p.X()*d.Y()-p.Y()*d.X());}integral+=v*(hi-lo)/(6*n);}
    }
    sum+=integral*(String(e.Orientation())==='TopAbs_REVERSED'?-1:1);
  }
  expect(count).toBeGreaterThan(0); return { area:Math.abs(sum),edges:count,splines };
}
function prism(f: TopoDS_Shape, height: number, a: Arena) {
  const maker=a.own(new k.oc.BRepPrimAPI_MakePrism(f,a.own(new k.oc.gp_Vec(0,0,height)),false,true));
  expect(maker.IsDone()).toBe(true);return a.own(maker.Shape());
}
function converted(s: TopoDS_Shape, a: Arena) {return a.own(a.own(new k.oc.BRepBuilderAPI_NurbsConvert(s,true)).Shape());}
function valid(s: TopoDS_Shape) {
  const id=raw().put(s.Oriented(s.Orientation()));
  try {expect(k.isValid(id)).toBe(true);expect(k.solidCount(id)).toBe(1);}finally{k.release(id);}
}

it('reproduces integration error with one C0 spline edge, without STEP or section', () => {
  const a=new Arena(),oc=k.oc;
  try {
    const points: [number,number][]=[[10,0],[8,3],[5,4],[2,3],[0,0]];
    const poles=a.own(new oc.NCollection_Array1_gp_Pnt(1,5)),knots=a.own(new oc.NCollection_Array1_double(1,5)),mult=a.own(new oc.NCollection_Array1_int(1,5));
    points.forEach(([x,y],i)=>{poles.SetValue(i+1,a.own(new oc.gp_Pnt(x,y,0)));knots.SetValue(i+1,i);mult.SetValue(i+1,i===0||i===4?2:1);});
    const curve=a.own(new oc.Geom_BSplineCurve(poles,knots,mult,1,false)),mw=a.own(new oc.BRepBuilderAPI_MakeWire());
    mw.Add(a.own(a.own(new oc.BRepBuilderAPI_MakeEdge(curve)).Edge()));
    mw.Add(a.own(a.own(new oc.BRepBuilderAPI_MakeEdge(a.own(new oc.gp_Pnt(0,0,0)),a.own(new oc.gp_Pnt(10,0,0)))).Edge()));
    const w=a.own(mw.Wire()),f=face(w,a),s=prism(f,3,a),n=converted(s,a),g=green(w,a);
    expect(Math.abs(g.area-27)).toBeLessThan(1e-10);expect(Math.abs(area(f,a)-27)).toBeLessThan(1e-10);
    const fixed=volume(s,a),adaptive=volume(s,a,1e-9),nurbs=volume(n,a,1e-9);
    expect(Math.abs(fixed.volume-81)).toBeGreaterThan(1e-3);
    expect(Math.abs(nurbs.volume-81)).toBeLessThan(1e-8);valid(s);valid(n);
    // Identical geometry expressed as individual lines is the non-spline control.
    const polygon: Region={outer:points.map((p,i)=>({kind:'line',a:p,b:points[(i+1)%points.length]!,source:String(i)})),holes:[]};
    const control=k.extrude(frame,[polygon],[0,0,3]).shape;
    try{expect(Math.abs(k.massProps(control).volume-81)).toBeLessThan(1e-8);}finally{k.release(control);}
    reports.push({model:'five-pole-degree-one',analyticArea:27,green:g.area,fixed,adaptive,nurbs});
  } finally {a.dispose();}
  expect(k.liveShapes).toBe(0);
});

it.each([false,true])('separates source, STEP, section and NURBS integration (smooth=%s)', smooth => {
  const source=k.extrude(frame,[toothedProfile(parameters)],[0,0,5]).shape;
  const imported=k.importStep(k.exportStep(source,'spline-isolation')).shape;
  const a=new Arena();
  try {
    const analytic=gearArea(parameters),sourceArea=k.massProps(source).volume/5,stepArea=k.massProps(imported).volume/5;
    expect(Math.abs(sourceArea-analytic)).toBeLessThan(1e-6);expect(Math.abs(stepArea-sourceArea)).toBeLessThan(1e-6);
    reports.push({model:'gear-source-step',analytic,sourceArea,stepArea});
    {
      const w=section(raw().get(imported),1.25,smooth,a),f=face(w,a),g=green(w,a),s=prism(f,3,a);
      const surfaceArea=area(f,a),fixed=volume(s,a),adaptive=volume(s,a,1e-9);
      expect(g.splines.length).toBe(48);
      expect(g.splines.every(b=>smooth?b.degree>1:b.degree===1)).toBe(true);
      expect(Math.abs(surfaceArea-g.area)).toBeLessThan(1e-6);
      expect(Math.abs(fixed.volume/3-g.area)).toBeGreaterThan(1e-3);
      expect(Math.abs(adaptive.volume/3-g.area)).toBeGreaterThan(1e-3);
      valid(s);
      if(!smooth) {
        reports.push({model:'gear-section',smooth,surfaceArea,green:g,fixed,adaptive,note:'Reject dense C0 representation before downstream conversion/offset.'});
        return;
      }
      const n=converted(s,a),nurbs=volume(n,a,1e-9);
      expect(Math.abs(nurbs.volume/3-g.area)).toBeLessThan(1e-6);valid(n);
      expect(Math.abs(g.area-analytic)).toBeLessThan(1e-6);
      // Physical point classification is independent of volume integration.
      const before=raw().put(s.Oriented(s.Orientation())),after=raw().put(n.Oriented(n.Orientation()));
      let states: string[]=[];
      try {
        const points: [number,number,number][]=Array.from({length:121},(_,i)=>[(i%11-5)*2.7,(Math.floor(i/11)-5)*2.7,2.75]);
        states=k.classify(before,points);expect(k.classify(after,points)).toEqual(states);
        expect(states).toContain('in');expect(states).toContain('out');
      }finally{k.release(before);k.release(after);}
      reports.push({model:'gear-section',smooth,surfaceArea,green:g,fixed,adaptive,nurbs,matchingClassifications:states.length});
    }
  } finally {a.dispose();k.release(imported);k.release(source);expect(k.liveShapes).toBe(0);}
  expect(k.liveShapes).toBe(0);
});

it.each([0.05,0.2])('rejects built-in arc approximation that exceeds the measured gap tolerance (%s)', gap => {
  const source=k.extrude(frame,[toothedProfile(parameters)],[0,0,5]).shape;
  const imported=k.importStep(k.exportStep(source)).shape,a=new Arena(),oc=k.oc;
  try {
    const w=section(raw().get(imported),2.5,true,a),f=face(w,a),sourceArea=area(f,a),wireId=raw().put(w.Oriented(w.Orientation()));
    try {
      for(const angle of [0.1,0.01]) {
        const approximation=a.own(oc.BRepOffsetAPI_MakeOffset.ConvertFace(f,angle));
        let expanding=0;
        for(const sign of [-1,1]) {
          const offset=a.own(new oc.BRepOffsetAPI_MakeOffset(approximation,oc.GeomAbs_JoinType.GeomAbs_Arc,false));offset.Perform(sign*gap);
          if(!offset.IsDone()){reports.push({model:'gear-built-in-approximation',gap,angle,sign,status:'rejected: native offset not done'});continue;}
          const wires=ShapeIndex.of(oc,a.own(offset.Shape()),'TopAbs_WIRE',a);
          try {
            expect(wires.size).toBe(1);const out=a.own(oc.TopoDS.Wire(wires.keys[0]!));expect(oc.BRep_Tool.IsClosed(out)).toBe(true);
            const offsetArea=area(face(out,a),a);if(offsetArea<=sourceArea)continue;expanding++;
            const edges=ShapeIndex.of(oc,out,'TopAbs_EDGE',a);let maxGapError=0,samples=0;
            try{for(const e of edges.keys){const c=a.own(new oc.BRepAdaptor_Curve(a.own(oc.TopoDS.Edge(e))));for(let j=0;j<=8;j++){
              const p=a.own(c.Value(c.FirstParameter()+(c.LastParameter()-c.FirstParameter())*j/8));
              // A counterexample needs one tooth, not 24 rotational copies of costly extrema calls.
              // This restricted sample cannot certify a global maximum.
              if(Math.abs(Math.atan2(p.Y(),p.X()))>Math.PI/24)continue;
              const v=k.makeVertex([p.X(),p.Y(),p.Z()]);
              try{maxGapError=Math.max(maxGapError,Math.abs(k.distance(v,wireId).distance-gap));samples++;}finally{k.release(v);}
            }}}finally{edges.dispose();}
            expect(samples).toBeGreaterThan(0);expect(maxGapError).toBeGreaterThan(1e-5);
            reports.push({model:'gear-built-in-approximation',gap,angle,offsetArea,samples,maxGapError,sampleDomain:'one tooth sector +/- pi/24',status:'rejected: exceeds unchanged 1e-5 mm gap criterion'});
          } finally {wires.dispose();}
        }
        expect(expanding).toBe(1);
      }
    }finally{k.release(wireId);}
  } finally {a.dispose();k.release(imported);k.release(source);}
  expect(k.liveShapes).toBe(0);
});

it('fuzzes 100 minimal quadratic STEP sections with independent analytic area and converted volume', () => {
  let seed=238;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const startHeap=heap();expect(startHeap).toBeGreaterThan(0);let maxAreaError=0,maxVolumeError=0;
  for(let i=0;i<100;i++) {
    const width=1+9*random(),rise=1+4*random(),height=0.5+4*random(),z=height*(0.1+0.8*random());
    const poles: [number,number][]=[[width,0],[width/2,rise],[0,0]];
    const region: Region={outer:[{kind:'line',a:[0,0],b:[width,0],source:'base'},{kind:'spline',points:poles,bezierPoles:poles,closed:false,source:'quadratic'}],holes:[]};
    const source=k.extrude(frame,[region],[0,0,height]).shape,imported=k.importStep(k.exportStep(source)).shape,a=new Arena();
    try {
      const expected=width*rise/3,w=section(raw().get(imported),z,true,a),g=green(w,a),s=converted(prism(face(w,a),3,a),a);
      const areaError=Math.abs(g.area-expected),volumeError=Math.abs(volume(s,a,1e-9).volume/3-expected);
      expect(areaError,`case ${i}`).toBeLessThan(1e-6);expect(volumeError,`case ${i}`).toBeLessThan(1e-6);valid(s);
      maxAreaError=Math.max(maxAreaError,areaError);maxVolumeError=Math.max(maxVolumeError,volumeError);
    }finally{a.dispose();k.release(imported);k.release(source);}
    expect(k.liveShapes).toBe(0);
  }
  reports.push({model:'100-quadratic-step-sections',maxAreaError,maxVolumeError,startHeap,endHeap:heap(),note:'No gear/offset fuzz coverage; no leak-free claim.'});
});
