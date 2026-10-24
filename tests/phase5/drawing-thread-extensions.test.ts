import { afterAll, beforeAll, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, elementFacts, holeFeatures, projectDrawingView, viewFeatures } from '@3db/regen';
import { setLocale } from '@3db/i18n';
import { applyCommand, applyDrawingCommand, axesOf, createEmptyDrawing, DrawingHistory, page, parseDrawing, parsePart,
  serializeDrawing, serializePart, SCHEMA_VERSION, DRAWING_SCHEMA_VERSION, threadToleranceClasses, validThreadTolerance,
  viewVectors, type CosmeticThreadFeature, type DiameterDimension, type Feature } from '@3db/model';
import { autoDimensions, buildScene, toDxf, toPdf, readDxf, readPdf, holeRows } from '@3db/drawing';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let reg: Regenerator;
beforeAll(async () => { kernel = await Kernel.load(); reg = new Regenerator(kernel, await PlaneGcsSolver.create()); setLocale('en'); });
afterAll(() => { reg.dispose(); setLocale('zh-TW'); });
const rod = () => build(sketch('s1', front, { entities: [{ id: 'p', type: 'point', x: 0, y: 0 }, { id: 'c', type: 'circle', center: 'p', radius: 4 }], constraints: [] }),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '30' }), {
    id: 'ct', name: 'Thread', type: 'cosmeticThread', suppressed: false, targetFace: { kind: 'face', name: 'e1:side:s1.c' },
    standardMode: 'standard', standardDesignation: 'M8', threadType: 'external', toleranceClass: '6g',
    majorDiameter: '8', minorDiameter: '6.466', pitch: '1.25', endCondition: 'blind', depth: '12',
  } as Feature);

function setup() {
  const part = rod();
  const result = reg.rebuild(part);
  expect(result.features.every(f => f.status === 'ok')).toBe(true);
  const body = result.body!;
  let doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'v', name: 'Side', source: 'part.3dbx', direction: 'top', at: [100, 130] }] });
  const axes = axesOf(page(doc).views, page(doc).sheet.projection, page(doc).views[0]!)!;
  const features = viewFeatures(body.topology, body.names, axes, undefined, holeFeatures(part), result.cosmeticThreads);
  const axis = features.find(f => f.type === 'axis' && f.thread);
  if (!axis || axis.type !== 'axis') throw new Error('Real side-view thread missing');
  const dim: DiameterDimension = { id: 'd', view: 'v', kind: 'diameter', ref: axis.ref, angle: 45, leader: 15, callout: true, threadLeader: true };
  doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [dim] });
  const facts = elementFacts(body.topology, body.names, axis.ref, holeFeatures(part), result.cosmeticThreads);
  if ('error' in facts) throw new Error(facts.error);
  const projection = projectDrawingView(kernel, [{ shape: body.shape, pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, mirrored: false }], axes);
  const scene = (d = doc, f = facts) => buildScene(d, new Map([['v', projection]]), new Map([['d', { elements: [f] }]]), new Map([['v', features]]));
  return { part, doc, facts, scene, axis };
}

it('inherits sheet defaults, supports per-label overrides, undo/redo and storage', () => {
  const { doc, scene } = setup();
  const history = new DrawingHistory(doc);
  const text = (d = history.doc) => scene(d).dimensions.get('d');
  expect(text()).toMatchObject({ text: 'M8×1.25 - 6g DEEP 12' });
  history.execute({ type: 'setSheet', sheet: { calloutStyle: 'symbols' } }, 'sheet symbols');
  expect(text()).toMatchObject({ text: 'M8×1.25 - 6g ↧ 12' });
  expect(page(history.doc).dimensions[0]).not.toHaveProperty('calloutStyle');
  history.execute({ type: 'setDimension', dimensionId: 'd', patch: { calloutStyle: 'text' } }, 'local text');
  expect(text()).toMatchObject({ text: 'M8×1.25 - 6g DEEP 12' });
  history.undo(); expect(text()).toMatchObject({ text: 'M8×1.25 - 6g ↧ 12' });
  history.redo(); expect(text()).toMatchObject({ text: 'M8×1.25 - 6g DEEP 12' });
  const parsed = parseDrawing(serializeDrawing(history.doc));
  expect(parsed.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
  expect(text(parsed)).toMatchObject({ text: 'M8×1.25 - 6g DEEP 12' });
  const cleared = applyDrawingCommand(parsed, { type: 'setDimension', dimensionId: 'd', patch: { calloutStyle: null } });
  expect(text(cleared)).toMatchObject({ text: 'M8×1.25 - 6g ↧ 12' });
  for (const invalid of ['bad', '', null, 4]) expect(() => applyDrawingCommand(doc, { type: 'setSheet', sheet: { calloutStyle: invalid as never } })).toThrow();
});

it('keeps independent side leaders linked after model edits and refuses missing thread data', () => {
  const { part, doc, facts, scene, axis } = setup();
  expect(axis.thread).toMatchObject({ designation: 'M8', toleranceClass: '6g', depth: 12 });
  const changed = applyCommand(part, { type: 'setCosmeticThread', featureId: 'ct', params: { depth: '18', toleranceClass: '6h' } });
  const r = reg.rebuild(changed);
  const updated = elementFacts(r.body!.topology, r.body!.names, axis.ref, holeFeatures(changed), r.cosmeticThreads);
  if ('error' in updated) throw new Error(updated.error);
  expect(scene(doc, updated).dimensions.get('d')).toMatchObject({ text: 'M8×1.25 - 6h DEEP 18' });
  expect(scene(doc, { ...facts, thread: undefined }).dimensions.get('d')).toHaveProperty('error');
  const out = scene().dimensions.get('d')!;
  if ('error' in out) throw new Error(out.error);
  expect(out.handle).toMatchObject({ kind: 'round', radius: 0 });
  expect(out).not.toHaveProperty('dxf'); // A leader is not a fabricated diameter measurement.
  const dxf = readDxf(toDxf(scene().scene));
  expect(dxf.entities.filter(e => e.type === 'DIMENSION')).toHaveLength(0);
  expect(JSON.stringify(dxf)).toContain('6g');
  expect(readPdf(toPdf(scene().scene).bytes).pages[0]!.texts.some(t => t.text.includes('6g'))).toBe(true);
  expect(() => applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd', patch: { callout: false } })).toThrow();
  expect(() => applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd', patch: { kind: 'radius' } })).toThrow();
});

it('validates tolerance families and persists explicit classes without inventing legacy defaults', () => {
  const part = rod();
  for (const value of ['6H', '2A', '', 'bogus', '6G', null, 5]) expect(() => applyCommand(part, { type: 'setCosmeticThread', featureId: 'ct', params: { toleranceClass: value as never } })).toThrow();
  expect(() => applyCommand(part, { type: 'setCosmeticThread', featureId: 'ct', params: { threadType: 'internal' } })).toThrow();
  expect(threadToleranceClasses('1/4-20 UNC', 'internal')).toContain('2B');
  expect(threadToleranceClasses('1/4-20 UNC', 'external')).toContain('2A');
  expect(validThreadTolerance('6H', 'M8', 'internal')).toBe(true);
  expect(validThreadTolerance('6g', 'M8', 'internal')).toBe(false);
  const current = parsePart(serializePart(part));
  expect(current.schemaVersion).toBe(SCHEMA_VERSION);
  expect(current.features.find(f => f.type === 'cosmeticThread')).toHaveProperty('toleranceClass', '6g');
  const old = { ...part, schemaVersion: 75, features: part.features.map(f => { const { toleranceClass: _unused, ...rest } = f as CosmeticThreadFeature; return rest; }) };
  expect(parsePart(JSON.stringify(old)).features.find(f => f.type === 'cosmeticThread')).not.toHaveProperty('toleranceClass');
  const legacy = { ...createEmptyDrawing(), schemaVersion: 27 };
  expect(page(parseDrawing(JSON.stringify(legacy))).sheet).not.toHaveProperty('calloutStyle');
});

it('carries tapped-hole classes to side views and keeps different classes separate in symbol-style hole tables', () => {
  const hole = (id: string, s: string, toleranceClass: string): Feature => ({ id, name: id, type: 'hole', suppressed: false,
    sketch: s, kind: 'tapped', size: 'M6', toleranceClass, diameter: '5', end: { type: 'blind', depth: '12' } });
  const pointSketch = (id: string, x: number): Feature => ({ ...sketch(id, face('e1:cap:end')), entities: [{ id: `${id}p`, type: 'point', x, y: 15 }] }) as Feature;
  const part = build(sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
    pointSketch('s2', 10), hole('h1', 's2', '6H'), pointSketch('s3', 30), hole('h2', 's3', '5H'));
  const r = reg.rebuild(part);
  expect(r.features.every(f => f.status === 'ok')).toBe(true);
  const body = r.body!;
  const features = viewFeatures(body.topology, body.names, viewVectors('front'), undefined, holeFeatures(part), r.cosmeticThreads);
  const rows = holeRows(features, {}, 'mm', 'symbols');
  expect(rows.map(row => row.size).sort()).toEqual(['M6×1 - 5H ↧ 12 (TAP DRILL Ø5)', 'M6×1 - 6H ↧ 12 (TAP DRILL Ø5)']);
  expect(viewFeatures(body.topology, body.names, viewVectors('top'), undefined, holeFeatures(part)).filter(f => f.type === 'axis' && f.hole?.thread)).toHaveLength(2);
  const h = part.features.find(f => f.id === 'h1')!;
  if (h.type !== 'hole') throw new Error('hole missing');
  expect(() => applyCommand(part, { type: 'setHole', featureId: 'h1', hole: { ...h, toleranceClass: '6g' } })).toThrow();
});

it('rejects replacing a model-linked thread leader with manually fabricated specification text', () => {
  const { doc } = setup();
  expect(() => applyDrawingCommand(doc, { type: 'setDimension', dimensionId: 'd', patch: { text: 'M99 - 6g DEPTH 999' } })).toThrow();
});

it('groups equal cosmetic specifications across positions but separates tolerance classes', () => {
  for (const secondClass of ['6H', '5H']) {
    const holes: Feature[] = [10, 30].flatMap((x, i): Feature[] => [
      { ...sketch(`s${i+2}`, { kind:'face',name:'e1:cap:end' }), entities:[{ id:`p${i}`,type:'point',x,y:15 }] } as Feature,
      { id:`h${i}`,name:`h${i}`,type:'hole',suppressed:false,sketch:`s${i+2}`,kind:'straight',diameter:'5',end:{type:'blind',depth:'12'} },
      { id:`ct${i}`,name:`ct${i}`,type:'cosmeticThread',suppressed:false,targetFace:{kind:'face',name:`h${i}:side:s${i+2}.p${i}.wall`},
        threadType:'internal',standardMode:'standard',standardDesignation:'M6',toleranceClass:i===0?'6H':secondClass,
        majorDiameter:'6',minorDiameter:'4.917',pitch:'1',depth:'12',endCondition:'blind' },
    ]);
    const part = build(sketch('s1',front,rectangle('r',0,0,40,30)),extrude('e1','s1','boss',{type:'blind',depth:'20'}),...holes);
    const r = reg.rebuild(part);
    expect(r.features.every(f=>f.status==='ok')).toBe(true);
    const body = r.body!;
    const features = viewFeatures(body.topology,body.names,viewVectors('front'),undefined,holeFeatures(part),r.cosmeticThreads);
    const dimensions = autoDimensions(features,{overall:false,holes:true,positions:false,callouts:true});
    expect(dimensions).toHaveLength(secondClass==='6H'?1:2);
    if(secondClass==='6H') expect(dimensions[0]).toHaveProperty('count',2);
    const rows = holeRows(features, {}, 'mm', 'symbols');
    expect(rows.map(row => row.tag)).toEqual(secondClass==='6H'?['A1','A2']:['A1','B1']);
    expect(rows[0]!.size).toBe('M6×1 - 6H ↧ 12 (DRILL Ø5 ↧ 12)');
  }
});
