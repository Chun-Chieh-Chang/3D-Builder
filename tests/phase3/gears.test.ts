import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, gearDimensions, gearParameters, mapRefs, Parameters, parsePart, SCHEMA_VERSION, serializePart, type Feature, type GearParameters, type PartDoc, type SpurGearFeature, type RackFeature } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { dependencies, Regenerator } from '@3db/regen';
import { toothedProfile } from '../../packages/regen/src/gears';
let kernel:Kernel,solver:PlaneGcsSolver;
beforeAll(async()=>{kernel=await Kernel.load();solver=await PlaneGcsSolver.create();});
import { gear, rack, gearArea, rackArea } from './gear-helpers';
const insert=(doc:PartDoc,feature:Feature)=>applyCommand(doc,{type:'insertFeature',index:doc.features.length,feature});
const build=(feature:Feature)=>new Regenerator(kernel,solver,new Map()).rebuild(insert(createEmptyPart(),feature));
it('builds a true involute spur-gear solid with bore, analytic volume and persistent tooth faces',()=>{
 const f=gear(),p=gearParameters(f),result=build(f);expect(result.features.every(f=>f.status==='ok')).toBe(true);const body=result.body!;
 expect(kernel.isValid(body.shape)).toBe(true);expect(kernel.solidCount(body.shape)).toBe(1);
 const actual=kernel.massProps(body.shape).volume,expected=gearArea(p)*p.width;expect(Math.abs(actual/expected-1)).toBeLessThan(2e-6);
 expect(body.names.faces.length).toBe(body.topology.faces.length);expect(body.names.edges.length).toBe(body.topology.edges.length);expect(new Set(body.names.faces).size).toBe(body.names.faces.length);
 expect(body.names.faces.some(name=>name.includes('tooth:0:left'))).toBe(true);expect(body.topology.faces.some(face=>face.geometry?.type==='cylinder'&&Math.abs(face.geometry.radius-2.5)<1e-7)).toBe(true);
 // Probe actual native spline edges, not only the profile's input points.
 const d=gearDimensions(p),index=body.names.edges.findIndex((name,i)=>name.includes('tooth:0:left')&&body.topology.edges[i]!.geometry?.type==='bspline');expect(index).toBeGreaterThanOrEqual(0);
 const geometry=body.topology.edges[index]!.geometry!;if(geometry.type!=='bspline')throw Error('missing involute edge');
 for(const point of geometry.samples){const radius=Math.hypot(point[0],point[1]),t=Math.sqrt(Math.max(0,(radius/d.baseRadius)**2-1)),expectedAngle=-d.half+t-Math.atan(t);expect(Math.abs(Math.atan2(point[1],point[0])-expectedAngle)*radius).toBeLessThan(p.module*1e-4);}
});
it('builds a straight rack with exact pitch, straight pressure-angle flanks and analytic volume',()=>{
 const f=rack(),p=gearParameters(f),result=build(f);expect(result.features.every(f=>f.status==='ok')).toBe(true);expect(kernel.isValid(result.body!.shape)).toBe(true);
 expect(kernel.massProps(result.body!.shape).volume).toBeCloseTo(rackArea(p)*p.width,6);
 const profile=toothedProfile(p),flank=profile.outer.find(s=>s.source==='tooth:0:1')!;expect(flank.kind).toBe('line');if(flank.kind==='line')expect(Math.abs((flank.b[0]-flank.a[0])/(flank.b[1]-flank.a[1]))).toBeCloseTo(Math.tan(p.pressureAngle),12);
 const xs=result.body!.topology.vertices.map(v=>v.point[0]);expect(Math.max(...xs)-Math.min(...xs)).toBeCloseTo(Math.PI*p.module*p.teeth,7);
});
it('keeps expressions, plane DAG, edits, undo and schema migration connected',()=>{
 const plane:Feature={id:'plane1',type:'refPlane',name:'plane1',suppressed:false,def:{mode:'offset',plane:{kind:'datum',name:'plane:front'},distance:'12'}};
 const doc=insert(insert(createEmptyPart(),plane),gear({plane:{kind:'datum',name:'plane1'}})),history=new DocHistory(doc);
 expect(dependencies(doc).parents.get('gear1')).toEqual(['plane1']);expect(mapRefs(doc.features[1]!,r=>({...r,name:'changed'})).feature).toMatchObject({plane:{name:'changed'}});
 history.execute({type:'setGear',featureId:'gear1',params:{module:'1mm + 2mm',bore:'0'}});const resolved=new Parameters(history.doc).resolve(history.doc.features[1]!);expect(resolved.problem).toBeNull();expect(resolved.feature).toMatchObject({module:'3',bore:'0'});
 const result=new Regenerator(kernel,solver,new Map()).rebuild(history.doc);expect(result.features.every(f=>f.status==='ok')).toBe(true);history.undo();expect(history.doc).toEqual(doc);
 const restored=parsePart(serializePart(history.doc));expect(restored.schemaVersion).toBe(SCHEMA_VERSION);expect(restored.features).toEqual(doc.features);
 const old=parsePart(JSON.stringify({...createEmptyPart(),schemaVersion:80}));expect(old.schemaVersion).toBe(SCHEMA_VERSION);
});
it('rejects fractional, nonfinite, undercut, oversized, overlapping and perforated inputs before geometry',()=>{
 const doc=insert(createEmptyPart(),gear());
 for(const params of [{teeth:'20.5'},{teeth:'NaN'},{teeth:'201'},{teeth:'10'},{pressureAngle:'0deg'},{pressureAngle:'31deg'},{module:'-1'},{module:'1e9'},{width:'0'},{bore:'44'},{backlash:'-1'},{backlash:'3'},{teeth:'20mm'}])expect(()=>applyCommand(doc,{type:'setGear',featureId:'gear1',params})).toThrow();
 const rackDoc=insert(createEmptyPart(),rack());expect(()=>applyCommand(rackDoc,{type:'setGear',featureId:'rack1',params:{baseHeight:'0'}})).toThrow();expect(()=>applyCommand(rackDoc,{type:'setGear',featureId:'rack1',params:{bore:'2'}})).toThrow();
});
it('builds boundary tooth-count, module and pressure-angle combinations as valid measured solids',()=>{
 for(const params of [{teeth:'8',pressureAngle:'30deg',module:'0.1'},{teeth:'8',pressureAngle:'30deg',module:'100'},{teeth:'30',pressureAngle:'15deg',module:'0.1'},{teeth:'200',pressureAngle:'20deg',module:'1'}]) {
  const feature=gear({...params,width:'1',bore:'0'}),p=gearParameters(feature),result=build(feature);
  expect(result.features.every(f=>f.status==='ok'),JSON.stringify(params)).toBe(true);expect(kernel.isValid(result.body!.shape)).toBe(true);
  expect(Math.abs(kernel.massProps(result.body!.shape).volume/gearArea(p)-1),JSON.stringify(params)).toBeLessThan(2e-6);
 }
});
it('probes actual gear and rack flanks at pitch to verify standard tooth thickness, backlash and matching pressure angle',()=>{
 const g=gear({backlash:'0.1'}),gp=gearParameters(g),result=build(g),body=result.body!,radius=gp.module*gp.teeth/2,half=(Math.PI*gp.module/2-gp.backlash)/(2*radius);
 for(const [side,sign] of [['left',-1],['right',1]] as const) {
  const angle=sign*half,index=body.names.edges.findIndex((name,i)=>name.includes(`tooth:0:${side}`)&&body.topology.edges[i]!.geometry?.type==='bspline'&&Math.abs(body.topology.edges[i]!.mid[2])<1e-7);
  expect(index).toBeGreaterThanOrEqual(0);const point=kernel.edgeNearest(body.shape,index,[radius*Math.cos(angle),radius*Math.sin(angle),0]);
  expect(point.distance).toBeLessThan(gp.module*1e-6);expect(Math.abs(point.tangent[0]*Math.cos(angle)+point.tangent[1]*Math.sin(angle))).toBeCloseTo(Math.cos(20*Math.PI/180),7);
 }
 const r=rack({backlash:'0.1'}),rp=gearParameters(r),rackResult=build(r),rb=rackResult.body!,pitch=Math.PI*rp.module,center=-(rp.teeth-1)*pitch/2;
 expect(pitch).toBeCloseTo(2*Math.PI*radius/gp.teeth,12);
 const index=rb.names.edges.findIndex((name,i)=>name.includes('tooth:0:1')&&Math.abs(rb.topology.edges[i]!.mid[2])<1e-7);expect(index).toBeGreaterThanOrEqual(0);
 const onPitch=kernel.edgeNearest(rb.shape,index,[center+(pitch/2-rp.backlash)/2,0,0]);expect(onPitch.distance).toBeLessThan(1e-7);expect(Math.abs(onPitch.tangent[0]/onPitch.tangent[1])).toBeCloseTo(Math.tan(gp.pressureAngle),10);
});
it('uses exact tooth counts including a one-tooth rack, and never rounds nearly integral values',()=>{
 const one=insert(createEmptyPart(),rack({teeth:'1'})),result=new Regenerator(kernel,solver,new Map()).rebuild(one);expect(result.features.every(f=>f.status==='ok')).toBe(true);expect(kernel.isValid(result.body!.shape)).toBe(true);
 expect(()=>applyCommand(one,{type:'setGear',featureId:'rack1',params:{teeth:'1.00000000001'}})).toThrow();expect(()=>applyCommand(one,{type:'setGear',featureId:'rack1',params:{teeth:'0'}})).toThrow();
 const expression=applyCommand(one,{type:'setGear',featureId:'rack1',params:{teeth:'5+5'}});expect(new Parameters(expression).resolve(expression.features[0]!).feature).toMatchObject({teeth:'10'});
});
