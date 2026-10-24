/** Fresh model -> drawing -> external-consumer samples. Opt-in: writes only to out/. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { applyDrawingCommand, axesOf, createEmptyDrawing, page, type Feature, type PartDoc, type CalloutStyle, type LengthUnit } from '@3db/model';
import { setLocale } from '@3db/i18n';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, elementFacts, holeFeatures, projectDrawingView, viewFeatures } from '@3db/regen';
import { buildScene, readTrueType, toDxf, toPdf, toSvg, type SceneText } from '@3db/drawing';
import { writeDrawingFile, writePartFile } from '@3db/io';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

const out = resolve(process.env.CALLOUT_ACCEPTANCE_OUT ?? 'out/callout-acceptance');
const cjkPath = process.env.CALLOUT_CJK_FONT ?? '/workspace/.cloud-setup/fonts/NotoSansTC-Regular.ttf';
const symbolPath = process.env.CALLOUT_SYMBOL_FONT ?? '/usr/share/fonts/truetype/osifont/osifont.ttf';
const manifest: { id: string; language: string; style: CalloutStyle; unit: LengthUnit; expected: string; actual: string; semanticPass: boolean; diameterMm: number; threadLeader: boolean; pdfExpected: string; fallbackPdfExpected?: string; facts: unknown; textAt: number[] }[] = [];
const portable = (s: string) => s.replace(/[↧⌴⌵]/g, c => ({ '↧': 'DEPTH', '⌴': 'CBORE', '⌵': 'CSINK' })[c]!);
const point = (id: string, x: number, y: number) => ({ id, type: 'point', x, y }) as const;
const holeSketch = () => ({ ...sketch('s2', face('e1:cap:end')), entities: [point('p', 20, 15)] }) as Feature;
const plate = (patch: Record<string, unknown>, ...rest: Feature[]): PartDoc => build(
  sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), holeSketch(),
  { id: 'h1', name: 'h1', type: 'hole', suppressed: false, sketch: 's2', kind: 'straight', diameter: '6', end: { type: 'blind', depth: '12' }, ...patch } as Feature, ...rest,
);
const thread = (external = false, through = false, toleranceClass?: string): Feature => ({ id: 'ct1', name: 'ct1', type: 'cosmeticThread', suppressed: false, toleranceClass,
  targetFace: face(external ? 'e1:side:s1.c' : 'h1:side:s2.p.wall'), threadType: external ? 'external' : 'internal',
  standardMode: 'standard', standardDesignation: 'M8', majorDiameter: '8', minorDiameter: '6.466', pitch: '1.25', endCondition: through ? 'through' : 'blind', depth: external ? '18' : '12' });
const rod = () => build(sketch('s1', front, { entities: [point('p',0,0), { id:'c', type:'circle', center:'p', radius:4 }], constraints:[] }), extrude('e1','s1','boss',{ type:'blind',depth:'30' }), thread(true));
const cases = [
  { id:'blind', doc:()=>plate({}), diameter:6, en:['Ø6 DEEP 12','Ø6 ↧ 12'], zh:['Ø6 深 12','Ø6 ↧ 12'] },
  { id:'counterbore', doc:()=>plate({kind:'counterbore', diameter:'9', cbDiameter:'15', cbDepth:'8', end:{type:'blind',depth:'15'}}), diameter:9, en:["Ø9 DEEP 15 C'BORE Ø15 DEEP 8",'Ø9 ↧ 15 ⌴ Ø15 ↧ 8'], zh:['Ø9 深 15 沉頭 Ø15 深 8','Ø9 ↧ 15 ⌴ Ø15 ↧ 8'] },
  { id:'countersink', doc:()=>plate({kind:'countersink',csDiameter:'12',csAngle:'90deg',end:{type:'throughAll'}}),diameter:6,en:['Ø6 THRU CSK Ø12 90°','Ø6 THRU ⌵ Ø12 × 90°'],zh:['Ø6 貫穿 錐孔 Ø12 90°','Ø6 THRU ⌵ Ø12 × 90°'] },
  { id:'blind-countersink', doc:()=>plate({kind:'countersink',csDiameter:'12',csAngle:'90deg'}),diameter:6,en:['Ø6 DEEP 12 CSK Ø12 90°','Ø6 ↧ 12 ⌵ Ø12 × 90°'],zh:['Ø6 深 12 錐孔 Ø12 90°','Ø6 ↧ 12 ⌵ Ø12 × 90°'] },
  { id:'tapped',doc:()=>plate({kind:'tapped',size:'M6',diameter:'5'}),diameter:5,en:['M6 DEEP 12 (TAP DRILL Ø5)','M6×1 ↧ 12 (TAP DRILL Ø5)'],zh:['M6 深 12（底孔 Ø5）','M6×1 ↧ 12（底孔 Ø5）'] },
  { id:'internal',doc:()=>plate({diameter:'6.8',end:{type:'throughAll'}},thread()),diameter:6.8,en:['M8×1.25 DEEP 12 (DRILL Ø6.8 THRU)','M8×1.25 ↧ 12 (DRILL Ø6.8 THRU)'],zh:['M8×1.25 深 12（底孔 Ø6.8 貫穿）','M8×1.25 ↧ 12（底孔 Ø6.8 THRU）'] },
  { id:'full-thread-blind-hole',doc:()=>plate({diameter:'6.8'},thread(false,true)),diameter:6.8,en:['M8×1.25 DEEP 12 (DRILL Ø6.8 DEEP 12)','M8×1.25 ↧ 12 (DRILL Ø6.8 ↧ 12)'],zh:['M8×1.25 深 12（底孔 Ø6.8 深 12）','M8×1.25 ↧ 12（底孔 Ø6.8 ↧ 12）'] },
  { id:'external',doc:rod,diameter:8,en:['M8×1.25 DEEP 18','M8×1.25 ↧ 18'],zh:['M8×1.25 深 18','M8×1.25 ↧ 18'] },
];
const extensions = [
  { id:'side-external', side:true, doc:()=> { const p=rod(); return { ...p, features:p.features.map(f=>f.type==='cosmeticThread'?{...f,toleranceClass:'6g'}:f) }; }, diameter:8,
    en:['M8×1.25 - 6g DEEP 18','M8×1.25 - 6g ↧ 18'], zh:['M8×1.25 - 6g 深 18','M8×1.25 - 6g ↧ 18'] },
  { id:'side-internal', side:true, doc:()=>plate({diameter:'6.8',end:{type:'throughAll'}},thread(false,false,'6H')), diameter:6.8,
    en:['M8×1.25 - 6H DEEP 12 (DRILL Ø6.8 THRU)','M8×1.25 - 6H ↧ 12 (DRILL Ø6.8 THRU)'], zh:['M8×1.25 - 6H 深 12（底孔 Ø6.8 貫穿）','M8×1.25 - 6H ↧ 12（底孔 Ø6.8 THRU）'] },
  { id:'side-tapped', side:true, doc:()=>plate({kind:'tapped',size:'M6',diameter:'5',toleranceClass:'6H'}), diameter:5,
    en:['M6 - 6H DEEP 12 (TAP DRILL Ø5)','M6×1 - 6H ↧ 12 (TAP DRILL Ø5)'], zh:['M6 - 6H 深 12（底孔 Ø5）','M6×1 - 6H ↧ 12（底孔 Ø5）'] },
  { id:'sheet-default', side:false, doc:()=>plate({kind:'counterbore',diameter:'9',cbDiameter:'15',cbDepth:'8',end:{type:'blind',depth:'15'}}),diameter:9,
    en:["Ø9 DEEP 15 C'BORE Ø15 DEEP 8",'Ø9 ↧ 15 ⌴ Ø15 ↧ 8'],zh:['Ø9 深 15 沉頭 Ø15 深 8','Ø9 ↧ 15 ⌴ Ø15 ↧ 8'] },
];
const extensionMode = process.env.CALLOUT_EXTENSIONS === '1';
let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async()=> { mkdirSync(out,{recursive:true}); kernel=await Kernel.load(); solver=await PlaneGcsSolver.create(); });
afterAll(()=> { writeFileSync(join(out,'manifest.json'),JSON.stringify({ fonts:{cjk:cjkPath,symbol:symbolPath}, samples:manifest },null,2)); setLocale('zh-TW'); });

it.each(extensionMode ? extensions : cases)('$id: model-derived manufacturing values and fresh export files',async c=> {
  const reg=new Regenerator(kernel,solver);
  const results: boolean[]=[];
  try {
    const part=c.doc(); const result=reg.rebuild(part);
    expect(result.features.filter(f=>f.status!=='ok').map(f=>[f.id,f.message])).toEqual([]);
    const body=result.body!;
    for(const language of ['en','zh-TW'] as const) for(const style of ['text','symbols'] as const) {
      setLocale(language);
      const side = 'side' in c && c.side === true;
      const doc0=applyDrawingCommand(createEmptyDrawing(),{type:'setSheet',sheet:{language,unit:'mm',...(extensionMode ? {calloutStyle:style} : {})}});
      const doc1=applyDrawingCommand(doc0,{type:'insertViews',views:[{id:'view1',name:'V1',source:'part.3dbx',direction:side?'top':'front',at:[85,160]}]});
      const axes=axesOf(page(doc1).views,page(doc1).sheet.projection,page(doc1).views[0]!)!;
      const features=viewFeatures(body.topology,body.names,axes,undefined,holeFeatures(part),result.cosmeticThreads);
      const f=features.find(f=> {
        if(f.type!=='circle' && f.type!=='axis') return false;
        if(side ? f.type!=='axis' : f.type!=='circle' || !f.full) return false;
        return Math.abs(2*f.radius-c.diameter)<1e-6 && !!(f.hole||f.thread);
      });
      if(!f) throw new Error('Model callout feature missing: '+c.id);
      const fact=elementFacts(body.topology,body.names,f.ref,holeFeatures(part),result.cosmeticThreads);
      if('error' in fact) throw new Error(fact.error);
      const doc=applyDrawingCommand(doc1,{type:'insertDimensions',dimensions:[{id:'d1',view:'view1',kind:'diameter',ref:f.ref,angle:45,leader:35,callout:true,...(side?{threadLeader:true}:{}),...(extensionMode?{}:{calloutStyle:style})}]});
      const projection=projectDrawingView(kernel,[{shape:body.shape,pose:{position:[0,0,0],rotation:[0,0,0,1]},mirrored:false}],axes);
      const built=buildScene(doc,new Map([['view1',projection]]),new Map([['d1',{elements:[fact]}]]),new Map([['view1',features]]));
      const d=built.dimensions.get('d1')!;
      if('error' in d) throw new Error(d.error);
      const expected=(language==='en'?c.en:c.zh)[style==='text'?0:1]!;
      const id=`${c.id}-${language}-${style}`;
      const font=readTrueType(new Uint8Array(readFileSync(language==='en'?symbolPath:cjkPath)));
      if(language==='en') for(const ch of '↧⌴⌵') expect(font.glyphOf(ch.codePointAt(0)!)).toBeGreaterThan(0);
      const pdf=toPdf(built.scene,{font}); expect(pdf.warnings).toEqual([]);
      writeFileSync(join(out,id+'.dxf'),toDxf(built.scene)); writeFileSync(join(out,id+'.pdf'),pdf.bytes); writeFileSync(join(out,id+'.svg'),toSvg(built.scene));
      writeFileSync(join(out,id+'.3dbd'),await writeDrawingFile(doc));
      writeFileSync(join(out,id+'.3dbx'),await writePartFile(part));
      let fallbackPdfExpected: string|undefined;
      if(language==='en' && style==='symbols') {
        const fallback=toPdf(built.scene); expect(fallback.warnings).toEqual([]); writeFileSync(join(out,id+'-fallback.pdf'),fallback.bytes); fallbackPdfExpected=portable(d.text);
      }
      const text=d.items.find((i): i is SceneText=>i.kind==='text')!;
      manifest.push({id,language,style,unit:'mm',expected,actual:d.text,semanticPass:d.text===expected,diameterMm:c.diameter,threadLeader:side,pdfExpected:language==='en'?d.text:portable(d.text),fallbackPdfExpected,facts:fact,textAt:text.at});
      results.push(d.text===expected);
    }
  } finally { reg.dispose(); }
  expect(results).toEqual([true,true,true,true]);
});
