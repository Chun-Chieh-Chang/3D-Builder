/** Research spike: explicitly requested distance tolerance, no product API. */
import { it, expect } from 'vitest';
import { Kernel } from '@3db/kernel';
import { Arena } from '../../packages/kernel/src/occt';
import { ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import type { ShapeId } from '@3db/kernel';
import type { TopoDS_Shape } from 'libcascade/single/init';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sectionEnvelope } from './section-offset-envelope';

it('isolates native arc approximation result ownership on one quadratic curve',async()=>{
  const k=await Kernel.load(),oc=k.oc,a=new Arena();
  try {
    const poles=a.own(new oc.NCollection_Array1_gp_Pnt2d(1,3));
    [[0,0],[5,4],[10,0]].forEach(([x,y],i)=>poles.SetValue(i+1,a.own(new oc.gp_Pnt2d(x!,y!))));
    const curve=a.own(new oc.Geom2d_BezierCurve(poles)),ad=a.own(new oc.Geom2dAdaptor_Curve(curve));
    const algo=a.own(new oc.Geom2dConvert_ApproxArcsSegments(ad,1e-7,0.01));
    const result=a.own(algo.GetResult());let nonnull=0,nulls=0;
    for(let i=1;i<=result.Length();i++) {
      const c=result.Value(i);if(!c){nulls++;continue;}a.own(c);
      const copy=a.own(c.Copy());
      const type=copy.DynamicType();a.own(type);
      expect(Number.isFinite(c.FirstParameter())).toBe(true);nonnull++;
    }
    expect(nonnull).toBeGreaterThan(0);
    expect(nonnull+nulls).toBe(result.Length());
  }finally{a.dispose();}
});

it.each([0.05,0.2])('rebuilds a gear section with explicit 2e-6 distance tolerance and gap %s',async gap=>{
  const tolerance=2e-6;
  const k=await Kernel.load(),oc=k.oc,a=new Arena(),raw=k as unknown as {get(id:ShapeId):TopoDS_Shape;put(s:TopoDS_Shape):ShapeId};
  const initialHeap=(oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength;expect(initialHeap).toBeGreaterThan(0);
  const source=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[toothedProfile({kind:'gear',module:1,teeth:24,pressureAngle:20*Math.PI/180,width:5,bore:0,backlash:0,baseHeight:0})],[0,0,5]).shape;
  const imported=k.importStep(k.exportStep(source)).shape,reports:unknown[]=[];
  try {
    const z=2.5,plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,z)),a.own(new oc.gp_Dir(0,0,1))));
    const cut=a.own(new oc.BRepAlgoAPI_Section(raw.get(imported),plane,false));cut.Approximation(true);cut.ComputePCurveOn2(true);cut.Build();expect(cut.IsDone()).toBe(true);
    const edges=ShapeIndex.of(oc,a.own(cut.Shape()),'TopAbs_EDGE',a),sourceEdgeCount=edges.size,seq=a.own(new oc.NCollection_HSequence_TopoDS_Shape());
    try{for(const e of edges.keys)seq.Append(e);}finally{edges.dispose();}
    const wires=a.own(a.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(seq,1e-7,false)).Sequence());expect(wires.Length()).toBe(1);
    const w=a.own(oc.TopoDS.Wire(a.own(wires.Value(1)))),fm=a.own(new oc.BRepBuilderAPI_MakeFace(plane,w,true));expect(fm.IsDone()).toBe(true);
    const sourceProps=a.own(new oc.GProp_GProps());oc.BRepGProp.SurfaceProperties(a.own(fm.Face()),sourceProps,1e-10,false);
    const approx=sectionEnvelope(k,w,tolerance,a,'arc');reports.push({tolerance,edges:approx.edges,sourceEdges:approx.sourceEdges,maxBound:approx.maxBound,shortPoints:approx.shortPoints,representationErrorBound:approx.representationErrorBound});
    expect(approx.sourceEdges).toBe(sourceEdgeCount);
    const am=a.own(new oc.BRepBuilderAPI_MakeFace(plane,approx.wire,true));expect(am.IsDone()).toBe(true);
    const af=a.own(am.Face());
    const originalId=raw.put(w.Oriented(w.Orientation()));
    try {
    for(const sign of [1]) {
      const offset=a.own(new oc.BRepOffsetAPI_MakeOffset(af,oc.GeomAbs_JoinType.GeomAbs_Arc,false));offset.Perform(sign*gap);
      expect(offset.IsDone()).toBe(true);
      const out=a.own(offset.Shape()),props=a.own(new oc.GProp_GProps());
      const targetId=raw.put(out.Oriented(out.Orientation()));let minDistance:number;
      try{minDistance=k.distance(originalId,targetId).distance;expect(Math.abs(minDistance-gap)).toBeLessThan(1e-6);}finally{k.release(targetId);}
      const ow=ShapeIndex.of(oc,out,'TopAbs_WIRE',a);expect(ow.size).toBe(1);const wire=a.own(oc.TopoDS.Wire(ow.keys[0]!));ow.dispose();
      const faceMaker=a.own(new oc.BRepBuilderAPI_MakeFace(plane,wire,true));expect(faceMaker.IsDone()).toBe(true);
      const face=a.own(faceMaker.Face());oc.BRepGProp.SurfaceProperties(face,props,1e-10,false);
      expect(props.Mass()).toBeGreaterThan(sourceProps.Mass());
      const prism=a.own(new oc.BRepPrimAPI_MakePrism(face,a.own(new oc.gp_Vec(0,0,3)),false,true)),solid=raw.put(prism.Shape());
      try{expect(k.isValid(solid)).toBe(true);expect(k.solidCount(solid)).toBe(1);expect(Math.abs(k.massProps(solid).volume/3-props.Mass())).toBeLessThan(1e-6);}finally{k.release(solid);}
      const oe=ShapeIndex.of(oc,out,'TopAbs_EDGE',a);let maxError=0,samples=0;
      try{for(const edge of oe.keys){const c=a.own(new oc.BRepAdaptor_Curve(a.own(oc.TopoDS.Edge(edge))));for(let j=0;j<=8;j++){
        const p=a.own(c.Value(c.FirstParameter()+(c.LastParameter()-c.FirstParameter())*j/8));if(Math.abs(Math.atan2(p.Y(),p.X()))>Math.PI/24)continue;
        const v=k.makeVertex([p.X(),p.Y(),p.Z()]);try{maxError=Math.max(maxError,Math.abs(k.distance(v,originalId).distance-gap));samples++;}finally{k.release(v);}
      }}}finally{oe.dispose();}
      reports.push({sign,done:true,area:props.Mass(),minDistance,maxError,samples});expect(maxError).toBeLessThan(1e-5);
    }
    }finally{k.release(originalId);}
  }finally{
    k.release(imported);k.release(source);a.dispose();
    const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,`offset-distance-gap-${gap}.json`),JSON.stringify({initialHeap,finalHeap:(oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength,reports},null,2));
  }
  expect(k.liveShapes).toBe(0);
});
