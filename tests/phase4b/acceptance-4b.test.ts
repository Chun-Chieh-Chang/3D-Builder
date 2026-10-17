/**
 * Phase 4b-6 (docs/phase4b-plan.md §驗收), the part of the acceptance that needs no sample of the user's. The blueprint asks for a gauge block made from a stamped or moulded
 * part's STEP, 3 mm from the part, the gap measured to within 0.05 mm. Here the workpieces are made in the program and written as STEP files (as a part from the user would
 * be): ① a freeform one (a loft), whose side is cut by a split line, the region offset 3 and thickened; ② one with a rounded edge (a block with a fillet), whose top, fillet and
 * side are offset 3 and thickened, the block known by hand to the last cubic millimetre; ③ the second one in the jig of 4a (derived parts of a master: the workpiece, a base
 * plate and the gauge block), with interference and clearance, and the workpiece made taller; ④ the gauge block drawn with a section whose area is worked out by hand.
 * Every gap is measured here, apart from the check the offset makes of itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, applyDrawingCommand, axesOf, createEmptyDrawing, createEmptyPart, sectionPlane, type DrawingDoc, type Feature, type PartDoc, type Pose, page } from '@3db/model';
import { derivedAssemblyFiles, readDocumentFile, sha256Hex, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { findClearance, findInterference, projectDrawingView, Regenerator, solveAssembly, type RebuildResult } from '@3db/regen';
import { buildScene, type ViewLines } from '@3db/drawing';
import { build, circle, edge, extrude, fillet, front, rectangle, sketch } from '../phase1/builders';
import { openPart, type OpenedPart } from '../support/derivedProject';
import { componentsAt, shapeOf, type Opened, type Project } from '../support/jigFixture';
import { areaOf } from '../support/sectionArea';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const regen = (blobs = new Map<string, Uint8Array>()) => {
  const r = new Regenerator(kernel, solver, blobs);
  kept.push(r);
  return r;
};
const failures = (r: RebuildResult) => r.features.filter((f) => f.status !== 'ok').map((f) => `${f.id}: ${f.message}`);
const stepOf = (doc: PartDoc): Uint8Array => new TextEncoder().encode(kernel.exportStep(regen().rebuild(doc).body!.shape, 'workpiece'));
const TOLERANCE = 0.05;

/** A part holding the workpiece as the program reads a STEP file: one imported body, a reference body (it is what the gauge is made to, not part of the fixture). */
async function importedPart(step: Uint8Array): Promise<{ doc: PartDoc; blobs: Map<string, Uint8Array> }> {
  const sha256 = await sha256Hex(step);
  let doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256, kind: 'step', fileName: '工件.step' }, feature: { id: 'import1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' }, index: 0 });
  doc = applyCommand(doc, { type: 'setBody', bodyId: 'import1', name: '工件', reference: true });
  return { doc, blobs: new Map([[sha256, step]]) };
}
const add = (doc: PartDoc, ...features: Feature[]): PartDoc => features.reduce((d, feature) => applyCommand(d, { type: 'insertFeature', feature, index: d.features.length }), doc);
const own = (f: Feature): Feature => ({ ...f, merge: false }) as Feature;

/** The faces of the body `id` of a result: name and what the kernel says of each. */
function facesOf(r: RebuildResult, id: string) {
  const b = r.bodies.find((x) => x.id === id)!;
  return r.body!.names.faces.slice(b.face0, b.face0 + b.faces).map((name, i) => ({ name, ...kernel.topology(b.shape).faces[i]!, local: i }));
}
const bodyShape = (r: RebuildResult, id: string): ShapeId => r.bodies.find((b) => b.id === id)!.shape;
const area = (shape: ShapeId) => kernel.topology(shape).faces.reduce((a, f) => a + f.area, 0);

// ================================================================== ① the freeform workpiece

describe('① a freeform workpiece (a loft, as a STEP file): a split line, the region offset 3 mm, thickened 8 mm', () => {
  const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z), reverse: true } }) as Feature;
  const on = (name: string) => ({ kind: 'datum', name }) as const;
  /** A loft Ø50, Ø30 and Ø44 at z = 0, −30, −60: a side that is not a cone or a cylinder. */
  const freeform = (r1 = 15) =>
    build(
      sketch('a0', front, circle('k0', 0, 0, 25)),
      plane('pa', 30),
      sketch('a1', on('pa'), circle('k1', 0, 0, r1)),
      plane('pb', 60),
      sketch('a2', on('pb'), circle('k2', 0, 0, 22)),
      { id: 'lf', type: 'loft', name: 'lf', suppressed: false, sections: ['a0', 'a1', 'a2'], op: 'boss' } as Feature,
    );
  /** The gauge's features on the imported workpiece: a rectangle drawn on a plane beside it (x = 40, its x running along −z) projected onto its side; the region offset 3; thickened 8. */
  const gauge = (side: string): Feature[] => [
    { id: 'rpl', type: 'refPlane', name: 'rpl', suppressed: false, def: { mode: 'offset', plane: on('plane:right'), distance: '40' } } as Feature,
    sketch('sk', on('rpl'), rectangle('r', 10, 2, 40, 12)),
    { id: 'split1', type: 'splitLine', name: '分割線1', suppressed: false, sketch: 'sk', face: { kind: 'face', name: side }, reverse: true } as Feature,
    { id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: 'split1:side:sk.rl0' }], distance: '3' } as Feature,
    { id: 'th1', type: 'thicken', name: 'th1', suppressed: false, body: { kind: 'body', name: 'os1' }, thickness: '8' } as Feature,
  ];
  /** The model: the STEP read, then the gauge features; the name of the side is found on the read workpiece. */
  async function model(step: Uint8Array) {
    const { doc, blobs } = await importedPart(step);
    const read = regen(blobs).rebuild(doc);
    const side = facesOf(read, 'import1').filter((f) => f.surface === 'bsplinesurface').sort((a, b) => b.area - a.area)[0]!.name;
    const full = add(doc, ...gauge(side));
    return { r: regen(blobs).rebuild(full), doc: full, blobs, side };
  }

  it('the gauge is made: a surface cut by the outline, offset, thickened into a solid block, every feature ok', async () => {
    const { r } = await model(stepOf(freeform()));
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.reference, b.surface])).toEqual([['import1', true, false], ['os1', false, false]]);
    expect(kernel.solidCount(bodyShape(r, 'os1'))).toBe(1);
    expect(r.features.find((f) => f.id === 'os1')!.info).toMatch(/量到的間隙/);
  });

  it('the gap, measured here: the face of the block toward the workpiece is 3 mm from it, to within 0.05 mm all over; the nearest the block comes to the workpiece is 3 mm', async () => {
    const { r } = await model(stepOf(freeform()));
    const inner = facesOf(r, 'os1').find((f) => f.name === 'os1:offset:split1:side:sk.rl0')!;
    expect(inner).toBeDefined();
    const face = kernel.subShape(bodyShape(r, 'os1'), 'face', inner.local);
    const gap = kernel.gapReport(face, bodyShape(r, 'import1'), 3, 600);
    expect(gap.samples).toBeGreaterThan(100);
    expect(gap.deviation).toBeLessThan(TOLERANCE);
    expect(gap.min).toBeGreaterThan(3 - TOLERANCE);
    expect(gap.max).toBeLessThan(3 + TOLERANCE);
    // the whole block against the workpiece: no point of it is nearer than 3 mm
    const whole = kernel.gapReport(bodyShape(r, 'os1'), bodyShape(r, 'import1'), 3, 600);
    expect(whole.min).toBeGreaterThan(3 - TOLERANCE);
    expect(whole.max).toBeLessThan(11 + 2 * TOLERANCE);
  });

  it('the block is the volume the normals sweep: Simpson on the area of the region offset 3, 7 and 11 mm (worked out here by offsetting the workpiece, not by thickening)', async () => {
    const { r } = await model(stepOf(freeform()));
    const region = facesOf(r, 'import1').find((f) => f.name === 'split1:side:sk.rl0')!;
    const A = (d: number) => area(kernel.offsetFaces(bodyShape(r, 'import1'), [region.local], d).shape);
    const simpson = (8 / 6) * (A(3) + 4 * A(7) + A(11));
    const volume = kernel.massProps(bodyShape(r, 'os1')).volume;
    expect(Math.abs(volume - simpson) / simpson).toBeLessThan(0.001);
  });

  it('the workpiece changed (the middle section Ø34 instead of Ø30): the gauge follows, with the same names, and the gap is still 3 mm', async () => {
    const a = await model(stepOf(freeform(15)));
    const b = await model(stepOf(freeform(17)));
    expect(failures(b.r)).toEqual([]);
    expect(b.r.body!.names.faces.filter((n) => n.startsWith('os1:') || n.startsWith('split1:')).sort()).toEqual(a.r.body!.names.faces.filter((n) => n.startsWith('os1:') || n.startsWith('split1:')).sort());
    const inner = facesOf(b.r, 'os1').find((f) => f.name === 'os1:offset:split1:side:sk.rl0')!;
    const gap = kernel.gapReport(kernel.subShape(bodyShape(b.r, 'os1'), 'face', inner.local), bodyShape(b.r, 'import1'), 3, 600);
    expect(gap.deviation).toBeLessThan(TOLERANCE);
    expect(kernel.massProps(bodyShape(b.r, 'os1')).volume).not.toBeCloseTo(kernel.massProps(bodyShape(a.r, 'os1')).volume, 0);
  });
});

// ================================================================== ② the workpiece with a rounded edge

/** A block 60 × 40 × H standing on z = 0 (x −30…30, y −20…20) with its top edge on the +x side rounded R5. */
const rounded = (height = 30) =>
  build(sketch('s', front, rectangle('w', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: String(height) }), fillet('f1', [edge('{e:cap:end|e:side:s.wl1}')], '5'));
/** The block of the gauge, by hand: the top 55 × 40 offset 3 up and 8 thick, the fillet's quarter ring R8 to R16 over 40, the side (H − 5) × 40 offset 3 out and 8 thick. */
const blockVolume = (height: number) => 55 * 40 * 8 + (Math.PI / 4) * (16 * 16 - 8 * 8) * 40 + (height - 5) * 40 * 8;

/** The three faces of the workpiece the gauge is made to: its top, the rounded edge, and the side beside it, by what they are (the names of a read STEP are the file's). */
function gaugeFaces(r: RebuildResult): string[] {
  const faces = facesOf(r, 'import1');
  const top = faces.find((f) => f.surface === 'plane' && f.normal && f.normal[2] > 0.99)!;
  const round = faces.find((f) => f.surface === 'cylinder')!;
  const side = faces.find((f) => f.surface === 'plane' && f.normal && f.normal[0] > 0.99)!;
  return [top.name, round.name, side.name];
}
const gaugeOf = (faces: string[]): Feature[] => [
  { id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: faces.map((name) => ({ kind: 'face', name })), distance: '3' } as Feature,
  { id: 'th1', type: 'thicken', name: 'th1', suppressed: false, body: { kind: 'body', name: 'os1' }, thickness: '8' } as Feature,
];

describe('② a workpiece with a rounded edge (a block with a fillet, as a STEP file): the top, the fillet and the side offset 3 mm, thickened 8 mm', () => {
  it('the gauge block is 55·40·8 + ¼π(16² − 8²)·40 + 25·40·8 = 31631.86 mm³, 3 mm from the workpiece everywhere', async () => {
    const { doc, blobs } = await importedPart(stepOf(rounded()));
    const r = regen(blobs).rebuild(add(doc, ...gaugeOf(gaugeFaces(regen(blobs).rebuild(doc)))));
    expect(failures(r)).toEqual([]);
    expect(kernel.massProps(bodyShape(r, 'os1')).volume).toBeCloseTo(blockVolume(30), 2);
    expect(blockVolume(30)).toBeCloseTo(31631.86, 2);
    const gap = kernel.gapReport(bodyShape(r, 'os1'), bodyShape(r, 'import1'), 3, 800);
    expect(gap.min).toBeGreaterThan(3 - TOLERANCE);
    // the faces toward the workpiece (the three offset faces) are all 3 mm from it
    for (const f of facesOf(r, 'os1').filter((x) => x.name.startsWith('os1:offset:import1'))) {
      const g = kernel.gapReport(kernel.subShape(bodyShape(r, 'os1'), 'face', f.local), bodyShape(r, 'import1'), 3, 400);
      expect(g.deviation, f.name).toBeLessThan(TOLERANCE);
    }
  });
});

// ================================================================== ③ the jig

describe('③ the gauge block in the fixture of 4a: derived parts of a master, an assembly, interference and clearance', () => {
  /** The master: the workpiece (a reference body), a base plate 100 × 80 × 10 under it (z −10…0), and the gauge block made to the workpiece. */
  async function jig(height = 30) {
    const { doc, blobs } = await importedPart(stepOf(rounded(height)));
    const faces = gaugeFaces(regen(blobs).rebuild(doc));
    let master = add(doc, sketch('sp', front, rectangle('a', -50, -40, 100, 80)), own(extrude('eb', 'sp', 'boss', { type: 'blind', depth: '10', reverse: true })), ...gaugeOf(faces));
    master = applyCommand(master, { type: 'setBody', bodyId: 'eb', name: '基板' });
    master = applyCommand(master, { type: 'setBody', bodyId: 'os1', name: '型面塊' });
    const made = await derivedAssemblyFiles({ masterFile: '檢具.3dbx', stem: '檢具', bodies: [{ id: 'import1', name: '工件' }, { id: 'eb', name: '基板' }, { id: 'os1', name: '型面塊' }] });
    const files = new Map<string, Uint8Array>([['檢具.3dbx', await writePartFile(master, blobs)], ...made.files.map((f) => [f.path, f.bytes] as const)]);
    const main = await readDocumentFile(files.get(made.main)!);
    if (main.kind !== 'assembly') throw new Error('main');
    const parts = new Map<string, OpenedPart>();
    for (const f of main.doc.files) parts.set(f.path, await openPart(kernel, solver, kept, files, f.path));
    const pathOf = (id: string) => main.doc.files.find((f) => f.id === main.doc.components.find((c) => c.id === id)!.file)!.path;
    const solved = solveAssembly(main.doc, (id) => parts.get(pathOf(id))!.mate);
    const p: Project = { files, doc: main.doc };
    const o: Opened = { parts, pathOf, solved };
    return { p, o, master: await openPart(kernel, solver, kept, files, '檢具.3dbx') };
  }

  it('the master has the workpiece (a reference body), the base plate and the block; the assembly of derived parts has the three, the block a solid of the volume worked out by hand', async () => {
    const { p, o, master } = await jig();
    expect(master.problems).toEqual([]);
    expect(master.reference).toEqual([true, false, false]);
    expect([...o.parts].map(([path, part]) => part.problems)).toEqual([[], [], []]);
    expect(p.doc.components).toHaveLength(3);
    const block = [...o.parts].find(([path]) => path.includes('型面塊'))![1];
    expect(block.volume).toBeCloseTo(blockVolume(30), 2);
  });

  it('interference: none; clearance: the block is 3 mm from the workpiece (within 0.05), and it stands on the base plate (0)', async () => {
    const { p, o } = await jig();
    const found = findInterference(kernel, componentsAt(p, o), shapeOf(o));
    expect(found.failed).toEqual([]);
    expect(found.overlaps.map((x) => [x.a, x.b])).toEqual([]);
    const rows = findClearance(kernel, componentsAt(p, o), shapeOf(o), 30).rows;
    expect(rows.every((r) => !r.interferes)).toBe(true);
    const [work, plate, block] = p.doc.components.map((c) => c.id);
    const between = (a: string, b: string) => rows.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))!;
    expect(Math.abs(between(work!, block!).distance - 3)).toBeLessThan(TOLERANCE);
    expect(between(plate!, block!).distance).toBeCloseTo(0, 6);
    expect(between(work!, plate!).distance).toBeCloseTo(0, 9);
  });

  it('the workpiece made 40 tall (read again from a new STEP): the block is the one worked out for it (the side 35 long), and the gap is 3 mm still', async () => {
    const { p, o } = await jig(40);
    const block = [...o.parts].find(([path]) => path.includes('型面塊'))![1];
    expect(block.volume).toBeCloseTo(blockVolume(40), 2);
    const found = findInterference(kernel, componentsAt(p, o), shapeOf(o));
    expect(found.overlaps).toEqual([]);
    const [work, , blockId] = p.doc.components.map((c) => c.id);
    const rows = findClearance(kernel, componentsAt(p, o), shapeOf(o), 30).rows;
    const row = rows.find((r) => (r.a === work && r.b === blockId) || (r.a === blockId && r.b === work))!;
    expect(Math.abs(row.distance - 3)).toBeLessThan(TOLERANCE);
  });
});

// ================================================================== ④ the drawing

describe('④ the gauge block drawn: three views and a section through the fillet', () => {
  const IDENTITY: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

  it('the section along y = 0 is the bent plate: 55·8 + ¼π(16² − 8²) + 25·8 = 790.80 mm² (the drawing draws the arcs as polylines, so a little short), hatched, and the views have the extents worked out by hand', async () => {
    const { doc, blobs } = await importedPart(stepOf(rounded()));
    const full = applyCommand(add(doc, ...gaugeOf(gaugeFaces(regen(blobs).rebuild(doc)))), { type: 'setBody', bodyId: 'os1', name: '型面塊' });
    const r = regen(blobs).rebuild(full);
    const shape = bodyShape(r, 'os1');
    let drawing: DrawingDoc = applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [
        { id: 'view1', name: '前視', source: 'block', direction: 'front' },
        { id: 'view2', name: '右視', source: 'block', direction: 'right' },
        { id: 'view3', name: 'A-A', kind: 'section', parent: 'view1', line: [[-60, 0], [60, 0]], label: 'A' },
      ],
    });
    drawing = applyDrawingCommand(drawing, { type: 'setSheet', sheet: { scale: [1, 1] } });
    const lines = new Map<string, ViewLines>();
    const parts = [{ shape, pose: IDENTITY, mirrored: false }];
    for (const v of page(drawing).views) {
      const axes = axesOf(page(drawing).views, page(drawing).sheet.projection, v)!;
      if (v.kind === 'section') {
        const parent = page(drawing).views.find((x) => x.id === v.parent)!;
        lines.set(v.id, projectDrawingView(kernel, parts, axes, sectionPlane(axesOf(page(drawing).views, page(drawing).sheet.projection, parent)!, v)));
      } else lines.set(v.id, projectDrawingView(kernel, parts, axes));
    }
    // the front view looks along z: the block is 8 + … wide in x (−30 … 41) and 40 deep in y
    const front1 = lines.get('view1')!.box!;
    expect(front1.min[0]).toBeCloseTo(-30, 4);
    expect(front1.max[0]).toBeCloseTo(41, 4);
    expect(front1.max[1] - front1.min[1]).toBeCloseTo(40, 4);
    const cut = lines.get('view3')!.cut!;
    // the arcs of the cut are polylines (16 segments a quarter): their chords leave a little out (about 0.24 mm², what 16 segments a quarter would leave: 96·16·(θ − sin θ))
    expect(Math.abs(areaOf(cut) - (55 * 8 + (Math.PI / 4) * (16 * 16 - 8 * 8) + 25 * 8))).toBeLessThan(0.3);
    const scene = buildScene(drawing, lines, new Map(), new Map()).scene;
    expect(scene.items.filter((i) => i.kind === 'polyline' && i.style === 'thin').length).toBeGreaterThan(10); // the hatching
    expect(scene.items.some((i) => i.kind === 'text' && i.text === 'A-A')).toBe(true);
  });
});
