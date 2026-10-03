/**
 * Phase 1E (handoff §9): the part file. Files written by older versions keep opening and rebuild to
 * the same geometry (B9.2); saving and opening again gives back the same document (B9.1, F7.1).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDemoPart, FormatError, SCHEMA_VERSION, serializePart, settingsOf, type PartDoc } from '@3db/model';
import { partFileName, readPartFile, readZip, sha256Hex, writePartFile, writeZip } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, face, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const utf8 = (s: string) => new TextEncoder().encode(s);
const oldFile = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/old-versions/${name}`, import.meta.url)));

// Volumes worked out by hand.
/** The demo block, less what an R2 fillet removes along a 10 mm edge. */
const DEMO = 20 * 10 * 5 - (4 - Math.PI) * 10;
/** Plate, less an R4 through hole and a 2 × 2 chamfer along 30 mm, plus an R3 × 5 boss. */
const PLATE = 40 * 30 * 10 - Math.PI * 16 * 10 - 2 * 30 + Math.PI * 9 * 5;

/** Everything is read before the next rebuild releases this one's shapes. */
function measure(doc: PartDoc) {
  const r = regen.rebuild(doc);
  return { statuses: statuses(r), volume: kernel.massProps(r.body!.shape).volume, faces: r.body!.names.faces, edges: r.body!.names.edges };
}

/** A part using what schema v4 added: a post from an offset plane down to the plate. */
const withPlane = (): PartDoc =>
  build(
    sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
    { id: 'p1', type: 'refPlane', name: '基準面1', suppressed: false, def: { mode: 'offset', plane: face('e1:cap:end'), distance: '15' } },
    sketch('s2', { kind: 'datum', name: 'p1' }, circle('k', 20, 15, 4)),
    extrude('e2', 's2', 'boss', { type: 'upToFace', face: face('e1:cap:end'), reverse: true }),
  );

describe('files written by older versions (B9.2)', () => {
  it.each([
    ['v1-demo.3db.json', 1, DEMO],
    ['v2-demo.3db.json', 2, DEMO],
    ['v3-demo.3db.json', 3, DEMO],
    ['v3-plate.3db.json', 3, PLATE],
  ])('opens %s (schema %i) and rebuilds it', async (name, version, volume) => {
    const bytes = oldFile(name);
    expect(JSON.parse(new TextDecoder().decode(bytes)).schemaVersion).toBe(version);
    const file = await readPartFile(bytes);
    expect(file.format).toBe('json');
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    const m = measure(file.doc);
    expect(m.statuses.filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(m.volume).toBeCloseTo(volume, 6);
  });
});

describe('part files written by older versions (B9.2)', () => {
  it.each([
    // a post from an offset reference plane down to the plate
    ['v4-refplane.3dbx', 4, 12000 + Math.PI * 16 * 15],
    // the plate-with-hole STEP imported (its data inside the file), an R2 fillet on an imported edge
    ['v5-import.3dbx', 5, 12000 - Math.PI * 16 * 10 - (4 - Math.PI) * 10],
    // the demo block written just before what is shown or hidden was saved with the part (D4.6)
    ['v6-demo.3dbx', 6, 1000 - (1 - Math.PI / 4) * 4 * 10],
    // the same block with what v7 added (its sketch and the origin hidden); values become expressions in v8 (B5.2)
    ['v7-demo.3dbx', 7, 1000 - (1 - Math.PI / 4) * 4 * 10],
  ])('opens %s (schema %i) with its data and rebuilds it', async (name, version, volume) => {
    const file = await readPartFile(oldFile(name));
    expect(file.format).toBe('3dbx');
    expect(file.warnings).toEqual([]);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    // what v7 stored survives; older files have no choices, so everything is at its default
    expect(file.doc.visibility).toEqual(version >= 7 ? { origin: false, sketch1: false } : {});
    expect(file.doc.variables).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile(name)))[0]!.data)).schemaVersion).toBe(version);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(volume, 6);
  });
});

describe('a part file written by version 8 (expressions, B5.2) opens in version 9 (direct editing, C10)', () => {
  it('keeps its variable, its expression-driven dimension and depth, and its file property, and rebuilds the same part', async () => {
    const file = await readPartFile(oldFile('v8-expressions.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v8-expressions.3dbx')))[0]!.data)).schemaVersion).toBe(8);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.variables).toEqual([{ id: 'var1', name: 'plate_w', expr: '10' }]);
    expect(file.doc.properties['板厚']).toBe('5mm');
    const sketch = file.doc.features.find((f) => f.type === 'sketch')!;
    expect(sketch.type === 'sketch' && sketch.constraints.find((c) => c.id === 'd1' && 'value' in c)).toMatchObject({ value: 'plate_w*2' });
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(DEMO, 6); // 20 × 10 × 5 block with its R2 fillet, 20 = plate_w*2, 5 = the property
  });
});

describe('a part file written by version 9 (direct editing, C10) opens in version 10 (bodies, C7)', () => {
  it('keeps its Delete Face and Move Face, has no bodies chosen, and rebuilds the same one body', async () => {
    const file = await readPartFile(oldFile('v9-direct-edit.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v9-direct-edit.3dbx')))[0]!.data)).schemaVersion).toBe(9);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.bodies).toEqual({});
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'fillet', 'deleteFace', 'moveFace']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(r.bodies.map((b) => b.id)).toEqual(['extrude1']);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(20 * 10 * 5 + 3 * 5 * 10, 6); // the block without its fillet, 3 mm longer
  });
});

describe('a part file written by version 10 (bodies, C7) opens in version 11 (sketch relations, C1.26)', () => {
  it('keeps its two bodies and the name of the second, and rebuilds them with the same volumes', async () => {
    const file = await readPartFile(oldFile('v10-bodies.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v10-bodies.3dbx')))[0]!.data)).schemaVersion).toBe(10);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.bodies).toEqual({ extrude2: { name: '工件' } });
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(r.bodies.map((b) => b.id)).toEqual(['extrude1', 'extrude2']);
    expect(r.bodies[1]!.name).toBe('工件');
    expect(kernel.massProps(r.bodies[1]!.shape).volume).toBeCloseTo(10 * 10 * 3, 6);
    expect(kernel.massProps(r.bodies[0]!.shape).volume).toBeCloseTo(DEMO, 6);
  });
});

describe('a part file written by version 11 (sketch relations, C1.26) opens in version 12 (contours, C1.34)', () => {
  it('keeps the coradial, intersection, arc-length and driven dimensions of its sketch, uses all contours, and rebuilds the same volumes', async () => {
    const file = await readPartFile(oldFile('v11-relations.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v11-relations.3dbx')))[0]!.data)).schemaVersion).toBe(11);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    const sketch2 = file.doc.features.find((f) => f.id === 'sketch2')!;
    const types = sketch2.type === 'sketch' ? sketch2.constraints.map((c) => c.type) : [];
    expect(types).toEqual(expect.arrayContaining(['intersection', 'coradial', 'arcLength']));
    expect(sketch2.type === 'sketch' && sketch2.constraints.filter((c) => 'driving' in c && c.driving === false).map((c) => c.id)).toEqual(['n8', 'n11']);
    expect('contours' in file.doc.features.find((f) => f.id === 'extrude2')!).toBe(false);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    // the second sketch's corner is held at the origin: its 10 × 10 × 3 block lies inside the first body, which keeps its volume (and the construction geometry is not extruded)
    expect(r.bodies.map((b) => b.id)).toEqual(['extrude1']);
    expect(kernel.massProps(r.bodies[0]!.shape).volume).toBeCloseTo(DEMO, 6);
  });
});

describe('a part file written by version 12 (contours, C1.34) opens in version 13 (entities that follow the model, C1.18)', () => {
  it('keeps the contour its boss chose and rebuilds the same volume', async () => {
    const file = await readPartFile(oldFile('v12-contours.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v12-contours.3dbx')))[0]!.data)).schemaVersion).toBe(12);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.find((f) => f.id === 'extrude2')).toMatchObject({ contours: [['m1', 'm2', 'm3', 'm4']] });
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    // only the 10 × 10 contour was extruded (3 high): a second body next to the demo block; the 15 × 10 one was not
    expect(r.bodies.map((b) => b.id)).toEqual(['extrude1', 'extrude2']);
    expect(kernel.massProps(r.bodies[1]!.shape).volume).toBeCloseTo(10 * 10 * 3, 6);
  });
});

describe('a part file written by version 13 (entities that follow the model, C1.18) opens in version 14 (end conditions, draft, thin features, C4.1)', () => {
  it('keeps its projected edge and pierce point, and they still find the model', async () => {
    const file = await readPartFile(oldFile('v13-references.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v13-references.3dbx')))[0]!.data)).schemaVersion).toBe(13);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const g = r.sketches.get('sketch2')!.solved.geometry;
    const line = g.get('r');
    expect(line?.type === 'line' && Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1])).toBeCloseTo(18, 6); // the edge of the block's end face, 20 less the two R2 corners that touch it, projected
    expect(g.get('x')).toMatchObject({ type: 'point' });
    expect(r.sketches.get('sketch2')!.solved.status).toBe('fully');
  });
});

describe('a part file written by version 14 (draft and a second direction, C4.1) opens in version 15 (shell, C5.4)', () => {
  it('keeps its draft and second direction and rebuilds the same body: 10 × 10 with 2° draft over 3 and 2 more the other way', async () => {
    const file = await readPartFile(oldFile('v14-extrude.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v14-extrude.3dbx')))[0]!.data)).schemaVersion).toBe(14);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.find((f) => f.id === 'extrude2')).toMatchObject({ dir2: { type: 'blind', depth: '2' }, draft1: { angle: '2deg' } });
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const t = Math.tan((2 * Math.PI) / 180);
    expect(r.bodies.map((b) => b.id)).toEqual(['extrude1', 'extrude2']);
    expect(kernel.massProps(r.bodies[1]!.shape).volume).toBeCloseTo(300 + 180 * t + 36 * t * t + 200, 6);
  });
});

describe('a part file written by version 15 (shell, C5.4) opens in version 16 (draft feature, C5.5)', () => {
  it('keeps its shell and rebuilds it: the demo block opened at its start face, a wall of 1, valid and every face named', async () => {
    const file = await readPartFile(oldFile('v15-shell.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v15-shell.3dbx')))[0]!.data)).schemaVersion).toBe(15);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'fillet', 'shell']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const volume = kernel.massProps(r.body!.shape).volume;
    expect(volume).toBeGreaterThan(0);
    expect(volume).toBeLessThan(DEMO / 2);
    expect(new Set(r.body!.names.faces).size).toBe(r.body!.names.faces.length);
  });
});

describe('a part file written by version 16 (draft feature, C5.5) opens in version 17 (hole wizard, C4.8)', () => {
  it('keeps its draft and rebuilds it: two walls leaning 2 degrees, the block a little smaller, valid, every face named as before', async () => {
    const file = await readPartFile(oldFile('v16-draft.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v16-draft.3dbx')))[0]!.data)).schemaVersion).toBe(16);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'fillet', 'draft']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const volume = kernel.massProps(r.body!.shape).volume;
    expect(volume).toBeLessThan(DEMO);
    expect(volume).toBeGreaterThan(DEMO - 100);
    expect(r.body!.names.faces).toContain('extrude1:side:sketch1.l1');
  });
});

describe('a part file written by version 17 (hole wizard, C4.8) opens in version 18 (sweep, C4.4)', () => {
  it('keeps its counterbored hole and rebuilds it: the block loses a Ø3.4 hole and a Ø6.5 counterbore, valid, every face named as before', async () => {
    const file = await readPartFile(oldFile('v17-hole.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v17-hole.3dbx')))[0]!.data)).schemaVersion).toBe(17);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'fillet', 'sketch', 'hole']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const volume = kernel.massProps(r.body!.shape).volume;
    expect(volume).toBeCloseTo(DEMO - Math.PI * (3.25 * 3.25 * 3.4 + 1.7 * 1.7 * (4 - 3.4)), 6);
    expect(r.body!.names.faces).toEqual(expect.arrayContaining(['extrude1:side:sketch1.l1', 'hole1:side:sketch2.hp1.wall', 'hole1:side:sketch2.hp1.cbwall']));
  });
});

describe('a part file written by version 18 (sweep, C4.4) opens in version 19 (loft, C4.5)', () => {
  it('keeps its sweep and rebuilds it: a 4 × 4 profile along 30 as a second body, valid, every face named as before', async () => {
    const file = await readPartFile(oldFile('v18-sweep.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v18-sweep.3dbx')))[0]!.data)).schemaVersion).toBe(18);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'fillet', 'sketch', 'sketch', 'sweep']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies.every((b) => kernel.isValid(b.shape))).toBe(true);
    expect(r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0)).toBeCloseTo(DEMO + 16 * 30, 6);
  });
});

describe('a part file written by version 19 (loft, C4.5) opens in version 20 (rib, C4.7)', () => {
  it('keeps its loft and rebuilds it: a 10 × 10 to 6 × 6 frustum over 20 as a second body, valid, every face named as before', async () => {
    const file = await readPartFile(oldFile('v19-loft.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v19-loft.3dbx')))[0]!.data)).schemaVersion).toBe(19);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'fillet', 'refPlane', 'sketch', 'sketch', 'loft']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies.every((b) => kernel.isValid(b.shape))).toBe(true);
    expect(r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0)).toBeCloseTo(DEMO + (20 / 3) * (100 + 60 + 36), 6);
  });
});

describe('a part file written by version 20 (rib, C4.7) opens in version 21 (reference geometry, C3.2–C3.5)', () => {
  it('keeps its rib and rebuilds it: a plate 40 × 40 × 10 and a wall 4 thick, 20 long and 15 high, valid, every face named as before', async () => {
    const file = await readPartFile(oldFile('v20-rib.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v20-rib.3dbx')))[0]!.data)).schemaVersion).toBe(20);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'sketch', 'rib']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(r.bodies).toHaveLength(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(40 * 40 * 10 + 15 * 20 * 4, 6);
    expect(r.body!.names.faces).toEqual(expect.arrayContaining(['rib1:cap:start', 'rib1:side:sr.l.neg', 'rib1:side:sr.l.pos']));
  });
});

describe('a part file written by version 21 (reference geometry, C3.2–C3.5) opens in version 22 (pattern, C6.1–C6.2)', () => {
  it('keeps its axis, point, plane and coordinate system and rebuilds them: the axis of the post, the centre of its top, the plane square to the axis there', async () => {
    const file = await readPartFile(oldFile('v21-datums.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v21-datums.3dbx')))[0]!.data)).schemaVersion).toBe(21);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'sketch', 'extrude', 'refAxis', 'refPoint', 'refPlane', 'coordSys']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(60 * 20 * 5 + Math.PI * 4 * 5, 6);
    expect(r.axes.get('axis1')!.origin[0]).toBeCloseTo(5, 6);
    expect(r.points.get('point1')![2]).toBeCloseTo(10, 6);
    expect(r.frames.get('plane1')!.normal.map(Math.abs)).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(1, 6)]);
    expect(r.systems.get('csys1')!.origin[2]).toBeCloseTo(10, 6);
  });
});

describe('a part file written by version 22 (pattern, C6.1–C6.2) opens in version 23 (mirror, C6.3)', () => {
  it('keeps its pattern and rebuilds it: the plate and three posts (the second instance skipped), valid, every instance under its own name', async () => {
    const file = await readPartFile(oldFile('v22-pattern.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v22-pattern.3dbx')))[0]!.data)).schemaVersion).toBe(22);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'sketch', 'extrude', 'pattern']);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(60 * 20 * 5 + 3 * Math.PI * 4 * 5, 6);
    expect(r.body!.names.faces).toEqual(expect.arrayContaining(['pat1:inst1:e2:cap:end', 'pat1:inst3:e2:cap:end']));
    expect(r.body!.names.faces.some((n) => n.startsWith('pat1:inst2:'))).toBe(false);
  });
});

describe('a part file written by version 23 (mirror, C6.3) opens in version 24 (material and settings, C14.1, B8.4)', () => {
  it('keeps its mirror and rebuilds it, with no material and the settings it never had filled in by default', async () => {
    const file = await readPartFile(oldFile('v23-mirror.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v23-mirror.3dbx')))[0]!.data)).schemaVersion).toBe(23);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.material).toBeUndefined();
    expect(settingsOf(file.doc)).toEqual({ draftStandard: 'ISO', dimensionPrecision: 4, meshQuality: 'normal' });
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(60 * 20 * 5 + 2 * Math.PI * 4 * 5, 6);
  });
});

describe('a part file written by version 24 (material, settings, appearance) opens in version 25 (notes, tags and folders on features, D1.7)', () => {
  it('keeps its material, settings and colour and rebuilds; no feature has a note, a tag or a folder', async () => {
    const file = await readPartFile(oldFile('v24-material.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v24-material.3dbx')))[0]!.data)).schemaVersion).toBe(24);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.material).toEqual({ id: 'steel', name: '碳鋼', density: 7.85 });
    expect(settingsOf(file.doc)).toEqual({ draftStandard: 'CNS', dimensionPrecision: 2, meshQuality: 'normal' });
    expect(file.doc.appearances).toEqual([{ target: { kind: 'feature', id: 'e2' }, color: '#3366cc' }]);
    expect(file.doc.features.every((f) => f.comment === undefined && f.tag === undefined && f.folder === undefined)).toBe(true);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
  });
});

describe('a part file written by version 25 (notes, tags and folders on features) opens in version 26 (derived bodies, C7.5)', () => {
  it('keeps the note and the tag and rebuilds; nothing in it is derived', async () => {
    const file = await readPartFile(oldFile('v25-notes.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v25-notes.3dbx')))[0]!.data)).schemaVersion).toBe(25);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features.find((f) => f.id === 'e1')).toMatchObject({ comment: '底板', tag: '主體' });
    expect(file.doc.features.some((f) => f.type === 'derivedBody')).toBe(false);
    const r = new Regenerator(kernel, await PlaneGcsSolver.create(), file.blobs).rebuild(file.doc);
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(40 * 30 * 10, 6); // the post stands inside the plate
  });
});

describe('a part file written by version 26 (derived bodies) opens in version 27 (dowel pin holes, C4.8)', () => {
  it('keeps its derived body, which says where it comes from; no hole has a fit or a chamfer', async () => {
    const file = await readPartFile(oldFile('v26-derived.3dbx'));
    expect(file.warnings).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode((await readZip(oldFile('v26-derived.3dbx')))[0]!.data)).schemaVersion).toBe(26);
    expect(file.doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.doc.features).toEqual([{ id: 'derived1', type: 'derivedBody', name: '基板', suppressed: false, source: '../夾具.3dbx', body: 'eb' }]);
  });
});

describe('the .3dbx file (B9.1, F7.1)', () => {
  const docs = async (): Promise<[string, PartDoc][]> => [
    ['the demo part', createDemoPart()],
    ['the v3 plate', (await readPartFile(oldFile('v3-plate.3db.json'))).doc],
    ['a part with a reference plane', withPlane()],
  ];

  it('saves the document text as it is and opens it back unchanged', async () => {
    for (const [what, doc] of await docs()) {
      const bytes = await writePartFile(doc);
      const entries = await readZip(bytes);
      expect(entries.map((e) => e.name), what).toEqual(['document.json']);
      expect(new TextDecoder().decode(entries[0]!.data), what).toBe(serializePart(doc));
      const file = await readPartFile(bytes);
      expect(file.format).toBe('3dbx');
      expect(file.doc, what).toEqual(doc);
      expect(file.warnings).toEqual([]);
      // The same document always makes the same file.
      expect(await writePartFile(file.doc), what).toEqual(bytes);
    }
  });

  it('rebuilds an opened part to the same model, names included', async () => {
    for (const [what, doc] of await docs()) {
      const before = measure(doc);
      const after = measure((await readPartFile(await writePartFile(doc))).doc);
      expect(after.statuses, what).toEqual(before.statuses);
      expect(after.faces, what).toEqual(before.faces);
      expect(after.edges, what).toEqual(before.edges);
      expect(after.volume, what).toBe(before.volume);
    }
    expect(measure(withPlane()).volume).toBeCloseTo(12000 + Math.PI * 16 * 15, 6);
  });

  it('keeps imported data with the document, once per content, and checks it', async () => {
    const step = utf8('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
    const sha256 = await sha256Hex(step);
    const doc: PartDoc = { ...createDemoPart(), blobs: [{ id: 'blob1', sha256, kind: 'step' }, { id: 'blob2', sha256, kind: 'step' }] };
    const bytes = await writePartFile(doc, new Map([[sha256, step], ['0'.repeat(64), utf8('not referenced')]]));
    expect((await readZip(bytes)).map((e) => e.name)).toEqual(['document.json', `blobs/${sha256}.step`]);
    const file = await readPartFile(bytes);
    expect(file.blobs).toEqual(new Map([[sha256, step]]));
    expect(file.warnings).toEqual([]);

    // Missing data opens with a warning; the document still says what it imported.
    const missing = await readPartFile(await writePartFile(doc));
    expect(missing.blobs.size).toBe(0);
    expect(missing.warnings).toEqual([expect.stringContaining('缺少輸入的資料 blob1')]);

    // Data that no longer matches its hash is not used.
    const tampered = await writeZip([
      { name: 'document.json', data: utf8(serializePart(doc)) },
      { name: `blobs/${sha256}.step`, data: utf8('ISO-10303-21; changed') },
    ]);
    const checked = await readPartFile(tampered);
    expect(checked.blobs.size).toBe(0);
    expect(checked.warnings).toEqual([expect.stringContaining('雜湊值不符')]);
  });

  it('refuses what it cannot open, and says why', async () => {
    const newer = { ...JSON.parse(serializePart(createDemoPart())), schemaVersion: SCHEMA_VERSION + 1 };
    const cases: [Uint8Array, string][] = [
      [await writeZip([{ name: 'readme.txt', data: utf8('hello') }]), '缺少 document.json'],
      [await writeZip([{ name: 'document.json', data: utf8(JSON.stringify(newer)) }]), `比本程式支援的 ${SCHEMA_VERSION} 新`],
      [Uint8Array.from([0xff, 0xfe, 0x00, 0x81]), '不是 3D-Builder 零件檔'],
      [utf8('{"kind": "assembly"}'), '不是零件文件'],
    ];
    const damaged = await writePartFile(createDemoPart());
    damaged[30 + 'document.json'.length + 20]! ^= 0xff; // inside the compressed document
    cases.push([damaged, '已損毀']);
    for (const [bytes, reason] of cases) {
      const error = await readPartFile(bytes).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FormatError);
      expect((error as Error).message).toContain(reason);
    }
  });

  it('names a new file after the part', () => {
    expect(partFileName('夾具/底板:A')).toBe('夾具_底板_A.3dbx');
    expect(partFileName('零件1')).toBe('零件1.3dbx');
  });
});
