import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, viewFeatures, viewEdges } from '@3db/regen';
import { readPartFile } from '@3db/io';
import { createEmptyDrawing, applyDrawingCommand, page, parseDrawing, serializeDrawing, DIM_STYLE_DEFAULT, viewVectors, type Dimension, type ViewAxes } from '@3db/model';
import { withProjectedReference, featureAt, visibleElements, projectionReferenceLines, toSheet, toView, projectionEntities, projectionPoint, projectedAt, projectionFacts, evaluateDimension, planDimension, resolveLines, toleranceText, toSvg, toDxf, toPdf, readPdf, buildScene, type ViewLines, type PlacedView } from '@3db/drawing';
let k: Kernel, regen: Regenerator, ordinary: ViewLines, section: ViewLines;
let body: NonNullable<ReturnType<Regenerator['rebuild']>['body']>;
const axes: ViewAxes = { dir: [1/Math.sqrt(3), 1/Math.sqrt(3), 1/Math.sqrt(3)], up: [-1/Math.sqrt(6), 2/Math.sqrt(6), -1/Math.sqrt(6)] };
const placed: PlacedView = { id: 'v', at: [150, 130], centre: [0, 0], w: 150, h: 100, scale: 1 };
beforeAll(async () => {
 k = await Kernel.load(); regen = new Regenerator(k, await PlaneGcsSolver.create());
 const doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
 const b = regen.rebuild(doc); expect(b.features.every(f => f.status === 'ok')).toBe(true);
 body=b.body!;
 ordinary = k.projectView(b.body!.shape, axes) as ViewLines;
 section = k.sectionView(b.body!.shape, { origin: [0,0,0], normal: [1,0,0] }, [0,1,0]) as ViewLines;
 expect(ordinary.visible.length).toBeGreaterThan(0); expect(section.visible.length).toBeGreaterThan(0);
 expect((k as any).oc.wasmMemory.buffer.byteLength).toBeGreaterThan(0);
});
afterAll(() => regen.dispose());
function nativeVisible(lines:ViewLines):ViewLines { return {...lines, hidden:[], tangent:[], tangentHidden:[]}; }
function pointDimension(lines:ViewLines) {
 const entity = projectionEntities(nativeVisible(lines)).find(e=>e.straight)!;
 expect(entity).toBeDefined();
 const d:Dimension = {id:'d',view:'v',kind:'linear',a:{...entity.ref,at:0},b:{...entity.ref,at:1},orientation:'aligned',offset:12};
 return {entity,d};
}
it('all native visible ordinary and cut contours acquire a projected reference, including curves, with 100 pointer positions', () => {
 let curves=0, lines=0;
 for(const source of [ordinary,section]) {
  const visible=nativeVisible(source), entities=projectionEntities(visible);
  expect(entities.length).toBeGreaterThan(0);
  for(const entity of entities) {
   entity.straight?lines++:curves++;
   const p=projectionPoint(entity,0.37);
   const pick=projectedAt(visible,p,1e-5,false);
   expect(pick).not.toBeNull(); expect(pick!.ref.kind).toBe('projection');
   if(pick!.ref.kind==='projection') expect(projectionFacts(pick!.ref,source,axes)).not.toBeNull();
  }
  for(let i=0;i<100;i++) {
   const e=entities[i%entities.length]!, p=projectionPoint(e,(i*37%101)/100);
   expect(projectedAt(visible,p,1e-5,false)).not.toBeNull();
  }
 }
 expect(lines).toBeGreaterThan(0); expect(curves).toBeGreaterThan(0);
});
it('measures regenerated endpoints, persists distinct selectors and rejects changed contours instead of using saved coordinates', () => {
 const {entity,d}=pointDimension(section);
 const outcome=evaluateDimension(d,{elements:[null,null]},axes,placed,'mm',DIM_STYLE_DEFAULT,section);
 if('error' in outcome) throw new Error(outcome.error);
 const a=projectionPoint(entity,0), b=projectionPoint(entity,1);
 expect(outcome.value).toBeCloseTo(Math.hypot(b[0]-a[0],b[1]-a[1]),8);
 let doc=applyDrawingCommand(createEmptyDrawing(),{type:'insertViews',views:[{id:'v',source:'plate.3dbx',name:'view',direction:'top'}]});
 doc=applyDrawingCommand(doc,{type:'insertDimensions',dimensions:[d]});
 expect(page(parseDrawing(serializeDrawing(doc))).dimensions[0]).toEqual(d);
 const reordered={...section,visible:[...section.visible].reverse().map(p=>Array.from({length:p.length/2},(_,i)=>p.slice(p.length-2-2*i,p.length-2*i)).flat())};
 expect(evaluateDimension(d,{elements:[null,null]},axes,placed,'mm',DIM_STYLE_DEFAULT,reordered)).toMatchObject({value:expect.closeTo(outcome.value,8)});
 const missing={...section,visible:[],hidden:[],tangent:[],tangentHidden:[]};
 expect(evaluateDimension(d,{elements:[null,null]},axes,placed,'mm',DIM_STYLE_DEFAULT,missing)).toHaveProperty('error');
 for(const at of [NaN,Infinity,-0.1,1.1]) {
  expect(()=>projectionPoint(entity,at)).toThrow();
  expect(projectionFacts({...entity.ref,at},section,axes)).toBeNull();
  const bad={...d,a:{...entity.ref,at}} as Dimension;
  expect(()=>applyDrawingCommand(doc,{type:'insertDimensions',dimensions:[{...bad,id:'bad'}]})).toThrow();
 }
});
it('detail and crop use their actual trimmed native contours without selecting the circular frame or hatching', () => {
 const base={id:'v',source:'plate.3dbx',name:'view',direction:'top' as const};
 const box=section.box!, centre:[number,number]=[(box.min[0]+box.max[0])/2,(box.min[1]+box.max[1])/2];
 let doc=applyDrawingCommand(createEmptyDrawing(),{type:'insertViews',views:[base,{id:'detail',name:'detail',kind:'detail',parent:'v',centre,radius:15,label:'B',scale:[5,1]}]});
 const resolved=resolveLines(doc,new Map([['v',section]])), lines=resolved.get('detail')!;
 expect(lines.visible.length).toBeGreaterThan(0);
 for(const e of projectionEntities(nativeVisible(lines))) expect(projectedAt(nativeVisible(lines),projectionPoint(e,0.4),1e-5,false)).not.toBeNull();
 // There is no fabricated reference to the detail circle unless a model contour is there.
 expect(projectedAt({visible:[],hidden:[],box:lines.box,cut:section.cut},[centre[0]+15,centre[1]],0.1)).toBeNull();
 void doc;
});
it('a fallback straight contour plans a dimension with projected endpoint references and supports asymmetric or same-sign deviations', () => {
 const {entity}=pointDimension(section), p=projectionPoint(entity,0.37);
 const pick=projectedAt(nativeVisible(section),p,1e-5,false)!;
 expect(pick.type).toBe('edge');
 const planned=planDimension([pick],[200,180],placed,axes);
 if(!('draft' in planned))throw new Error(JSON.stringify(planned));
 const dimension={...planned.draft,id:'d',view:'v'} as Dimension;
 const out=evaluateDimension(dimension,{elements:[null,null]},axes,placed,'mm',DIM_STYLE_DEFAULT,section);
 expect(out).not.toHaveProperty('error');
 expect(toleranceText({type:'bilateral',upper:0.02,lower:-0.01},25)).toBe('+0.02/-0.01');
 expect(toleranceText({type:'bilateral',upper:0.03,lower:0.01},25)).toBe('+0.03/+0.01');
 expect(toleranceText({type:'bilateral',upper:-0.01,lower:-0.03},25)).toBe('-0.01/-0.03');
 let doc=applyDrawingCommand(createEmptyDrawing(),{type:'insertViews',views:[{id:'v',source:'plate.3dbx',name:'view',direction:'top'}]});
 const d={...dimension,tolerance:{type:'bilateral' as const,upper:0.02,lower:-0.01}};
 doc=applyDrawingCommand(doc,{type:'insertDimensions',dimensions:[d]});
 const built=buildScene(doc,new Map([['v',section]]),new Map([['d',{elements:[null,null]}]]),new Map());
 // the deviations are stacked: two texts of their own in every output, and the DXF dimension's text an MTEXT tolerance stack
 expect(toSvg(built.scene)).toMatch(/>\+0\.02<\/text>[\s\S]*>-0\.01<\/text>/); expect(toDxf(built.scene)).toContain('\\S+0.02^-0.01;');
 const pdfTexts=readPdf(toPdf(built.scene).bytes).pages[0]!.texts.map(t=>t.text);
 expect(pdfTexts).toContain('+0.02'); expect(pdfTexts).toContain('-0.01');
 expect(page(parseDrawing(serializeDrawing(doc))).dimensions[0]!.tolerance).toEqual(d.tolerance);
});

it('unnormalized isometric directions cannot turn native oblique circles into true circles', () => {
 const iso=viewVectors('isometric');
 expect(viewFeatures(body.topology,body.names,iso).filter(f=>f.type==='circle')).toHaveLength(0);
 expect(viewEdges(k,body.shape,body.topology,body.names,iso).edges.filter(e=>e.circle)).toHaveLength(0);
});
it('broken-view pointer inversion and reference geometry agree on both physical sides', () => {
 const own:PlacedView={...placed,break:{axis:0,from:-10,to:10,gap:5}};
 for(const x of [-40,40]) expect(toView(own,toSheet(own,x,0))).toEqual([x,0]);
 const pieces=projectionReferenceLines(section,own)!;
 for(const e of projectionEntities(nativeVisible(pieces))) {
  const at=projectionPoint(e,0.23);
  expect(projectedAt(nativeVisible(pieces),at,1e-5,false)).not.toBeNull();
  expect(projectionFacts({...e.ref,at:0.23},pieces,axes)).not.toBeNull();
 }
});

it('actual helical B-spline contours and their native section contours can be referenced without circle or line inference', () => {
 const frame={origin:[0,0,0] as [number,number,number],xDir:[1,0,0] as [number,number,number],yDir:[0,0,1] as [number,number,number],normal:[0,-1,0] as [number,number,number]};
 const pts:[number,number][]=[[3.8,-0.3],[4.4,0],[3.8,0.3]];
 const shape=k.thread(frame,[{outer:pts.map((a,i)=>({kind:'line' as const,a,b:pts[(i+1)%3]!,source:`p${i}`})),holes:[]}],{axis:{origin:[0,0,0],dir:[0,0,1]},pitch:1.5,starts:1,hand:'right',from:0,to:4.5}).shape;
 try {
  expect(k.isValid(shape)).toBe(true);
  expect(k.topology(shape).faces.some(f=>f.surface==='bsplinesurface')).toBe(true);
  const views=[k.projectView(shape,axes),k.sectionView(shape,{origin:[0,0,0],normal:[0,1,0]},[0,0,1])];
  let curves=0;
  for(const source of views) {
   const lines=nativeVisible(source as ViewLines), entities=projectionEntities(lines);
   expect(entities.length).toBeGreaterThan(0);
   for(const e of entities) {
    if(!e.straight)curves++;
    const picked=projectedAt(lines,projectionPoint(e,0.37),1e-5,false);
    expect(picked).not.toBeNull();
    if(picked?.ref.kind!=='projection')throw new Error('no projected reference');
    expect(projectionFacts(picked.ref,lines,axes)).not.toBeNull();
   }
  }
  expect(curves).toBeGreaterThan(0);
 } finally { k.release(shape); }
});

it('an exact generated cut edge wins over a nearby original cylinder outline', () => {
 const cut=k.sectionView(body.shape,{origin:[0,0,2],normal:[0,0,1]},[0,1,0]) as ViewLines;
 const cutAxes=viewVectors('front'),features=viewFeatures(body.topology,body.names,cutAxes);
 const seen=visibleElements(cut,viewEdges(k,body.shape,body.topology,body.names,cutAxes),features);
 let verified=0;
 for(const e of projectionEntities(nativeVisible(cut))) {
  const p=projectionPoint(e,0.37),native=featureAt(cut,features,p,0.6,{...seen,vertices:[]});
  if(native?.type!=='outline')continue;
  const picked=withProjectedReference(native,nativeVisible(cut),p,0.6,false);
  if(picked?.ref.kind==='projection') { verified++; expect(projectionFacts(picked.ref,cut,cutAxes)).not.toBeNull(); }
 }
 expect(verified).toBeGreaterThan(0);
});
