/** Research spike: what a section offset costs, to set Worker limits, and whether the arc-first two-stage pays. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TopoDS_Shape, TopoDS_Wire } from 'libcascade/single/init';
import { Kernel, type Region, type ShapeId } from '@3db/kernel';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { OffsetClearanceError } from '@3db/regen';
import { DEFAULT_OFFSET_LIMITS, OffsetCostError, regionOffset } from './section-regions';

let k:Kernel;let initialHeap=0;const rows:Record<string,unknown>[]=[];
const heap=()=>(k.oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength;
beforeAll(async()=>{k=await Kernel.load();initialHeap=heap();expect(initialHeap).toBeGreaterThan(0);});
afterAll(()=>{const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,`offset-cost-${Date.now()}.json`),JSON.stringify({initialHeap,finalHeap:heap(),rows},null,2));});

type Seg=Region['outer'][number];
const shift=(g:Region,dx:number):Region=>{const m=(p:[number,number]):[number,number]=>[p[0]+dx,p[1]];
  const seg=(x:Seg):Seg=>{const y={...x} as Record<string,unknown>;for(const f of ['a','b','c','from','to'])if(Array.isArray(y[f]))y[f]=m(y[f] as [number,number]);
    for(const f of ['points','bezierPoles'])if(Array.isArray(y[f]))y[f]=(y[f] as [number,number][]).map(m);return y as Seg;};
  return {outer:g.outer.map(seg),holes:g.holes.map(h=>h.map(seg))};};
function section(module:number,teeth:number,bore:number,a:Arena,copies=1){
  const oc=k.oc,raw=k as unknown as {get(id:ShapeId):TopoDS_Shape},ids:ShapeId[]=[];
  try{
    const src=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},Array.from({length:copies},(_,i)=>shift(toothedProfile({kind:'gear',module,teeth,pressureAngle:20*Math.PI/180,width:5,bore,backlash:0,baseHeight:0}),i*module*(teeth+4))),[0,0,5]).shape;ids.push(src);
    const imp=k.importStep(k.exportStep(src)).shape;ids.push(imp);
    const plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,2.5)),a.own(new oc.gp_Dir(0,0,1))));
    const cut=a.own(new oc.BRepAlgoAPI_Section(raw.get(imp),plane,false));cut.Approximation(true);cut.ComputePCurveOn2(true);cut.Build();if(!cut.IsDone())throw Error('section');
    const edges=ShapeIndex.of(oc,a.own(cut.Shape()),'TopAbs_EDGE',a),seq=a.own(new oc.NCollection_HSequence_TopoDS_Shape());try{for(const e of edges.keys)seq.Append(e);}finally{edges.dispose();}
    const ws=a.own(a.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(seq,1e-7,false)).Sequence()),wires:TopoDS_Wire[]=[];
    for(let i=1;i<=ws.Length();i++)wires.push(a.own(oc.TopoDS.Wire(a.own(ws.Value(i)))));
    return {wires,plane};
  }finally{for(const id of ids)k.release(id);}
}

// Both modes on each case. "arc" may be refused (the violation the two-stage exists for) or left uncertified (the
// edge-by-edge upper bound runs out of refinement budget); its time still counts.
it.each([[0.5,18,3,0.05,'ok'],[1,24,6,0.05,'ok'],[1,24,6,0.8,'refused'],[1,60,10,0.2,'refused'],[3,40,20,0.05,'uncertified'],[3,40,20,0.3,'refused']] as [number,number,number,number,string][])(
  'cost of module %s, %s teeth, bore %s, gap %s mm, both modes (arc: %s)',(module,teeth,bore,gap,arcOutcome)=>{
  const a=new Arena();
  try{
    const s=section(module,teeth,bore,a),row:Record<string,unknown>={module,teeth,bore,gap};
    for(const mode of ['arc','biarc'] as const){
      const t=Date.now();
      try{const r=regionOffset(k,s.wires,s.plane,gap,'out',2e-6,a,{mode});row[mode]={outcome:'ok',ms:Date.now()-t,pieces:r.sourcePieces,edges:r.approxEdges,outEdges:r.certificate!.edges,timings:r.timings};}
      catch(e){
        if(e instanceof OffsetClearanceError)row[mode]={outcome:'refused',ms:Date.now()-t,places:e.locations.length};
        else if(e instanceof Error&&e.message==='offset certificate failed')row[mode]={outcome:'uncertified',ms:Date.now()-t};
        else throw e;}
    }
    row.heap=heap();rows.push(row);
    expect((row.biarc as {outcome:string}).outcome).toBe('ok');expect((row.arc as {outcome:string}).outcome).toBe(arcOutcome);
  }finally{a.dispose();}
  expect(k.liveShapes).toBe(0);
},175000);

it('refuses two module 3 gears side by side by default, at the cheap source count, before approximating',()=>{
  const a=new Arena();
  try{
    const s=section(3,40,20,a,2),t=Date.now();let err:unknown;
    try{regionOffset(k,s.wires,s.plane,0.2,'out',2e-6,a,{mode:'biarc'});}catch(e){err=e;}
    expect(err).toBeInstanceOf(OffsetCostError);expect((err as OffsetCostError).stage).toBe('source');
    expect((err as OffsetCostError).count).toBeGreaterThan(DEFAULT_OFFSET_LIMITS.maxSourcePieces);expect(Date.now()-t).toBeLessThan(1000);
    rows.push({module:3,teeth:40,copies:2,refusedAt:(err as OffsetCostError).count,ms:Date.now()-t});
  }finally{a.dispose();}
  expect(k.liveShapes).toBe(0);
},120000);
