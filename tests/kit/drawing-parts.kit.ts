/**
 * The two parts of the user's engineering drawing, built with the real toolchain (knurled knob pin T1405002 and the flange bushing), and one drawing
 * sheet each, written out as `.3dbx`, STEP, `.3dbd`, DXF and PDF.
 *
 * Why. `scratch/drawing-feasibility-2026-10-11.md` judged the drawing makeable with this program; that judgement was analysis, not evidence. The user
 * asked for the evidence (decisions B1a, B2b, B3a): build both parts, export STEP, and draw one sheet per part — which is also the only end-to-end check
 * of the two annotations the drawing needs and the program did not have until now (surface roughness, ADR 0125; a one-sided `MAX` tolerance, same ADR).
 *
 * What is taken from the drawing, and what is not. Every dimension below is a printed dimension of the drawing as the feasibility report read it, with
 * the user's four corrections applied (`Ø10(HEX)` is across the flats and its Ø sign is wrong; `Ø7.73` is the lug's outer diameter and `Ø6.25` the short
 * shoulder on that side and the cylinder's outer diameter on the other; `2.71` is an anti-rotation lug/key). Three questions the drawing does not answer
 * are **held, not guessed** (the user's decisions C1c, C2a, C3c) and are listed in `HELD` below; nothing about them is built.
 *
 * Assumptions are named and separated from the drawing's own numbers in `ASSUMED`, and each is asserted in the tests, so a correction is a one-line
 * change here rather than a hunt through the file.
 *
 * Orientation. Both parts are revolved on the **Top** plane, which puts the axis along world Z: the side view (looking along X) then shows the axis across
 * the sheet as a turned part is drawn, and the end view (looking along Z) shows every cylinder as a circle — which is what a diameter dimension needs, since
 * `circle()` refuses a cylinder that is not seen in its true shape. A fillet is the other way round (its axis has to lie *in* the sheet for its tube to be cut
 * through and the arc to be seen), so the two `R… MAX` callouts go on the side view.
 *
 * Not part of `npm test` (it writes files). Run: npm run make:drawing
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyCommand, applyDrawingCommand, axesOf, createEmptyDrawing, createEmptyPart, sectionPlane, type Command, type Dimension, type DrawingDoc, type DrawingView, type ElementFacts, type Feature, type PartDoc, type Pose, type Ref, type SketchConstraint, type SketchEntity, type SurfaceFinish, type ViewAxes } from '@3db/model';
import { readAnyDocumentFile, writeDrawingFile, writePartFile } from '@3db/io';
import { autoDimensions, buildScene, checkDxf, evaluateDimension, factsOf, featureAt, planDimension, readDxf, readTrueType, toDxf, toPdf, type DimensionOutcome, type ElementsResult, type PlacedView, type Scene, type ViewLines } from '@3db/drawing';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { elementFacts, holeFeatures, projectDrawingView, Regenerator, viewFeatures, type RebuildResult } from '@3db/regen';

const OUT = process.env.PARTS_OUT ?? 'scratch/drawing-parts';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => {
  kept.forEach((r) => r.dispose());
  console.log(`\nwritten to ${OUT}:\n${manifest.map((m) => `${m.path}  (${m.bytes} B)  ${m.what}`).join('\n')}`);
});

const manifest: { path: string; bytes: number; what: string }[] = [];
function put(rel: string, data: Uint8Array | string, what: string): void {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  manifest.push({ path: rel, bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.length, what });
}

const regen = (blobs = new Map<string, Uint8Array>()) => {
  const r = new Regenerator(kernel, solver, blobs);
  kept.push(r);
  return r;
};
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const rad = (deg: number) => (deg * Math.PI) / 180;
const face = (name: string): Ref => ({ kind: 'face', name });

// -------------------------------------------------------------------------------------------------------------------------------- the drawing's numbers

/** The drawing of Part 1 (T1405002), axial from the small end: the segments and the diameters it prints. */
const PART1 = {
  total: 60,
  smallEnd: { length: 8, dia: 6.25 },
  body: { length: 32, dia: 18 }, // the plain Ø18 (8–20) and the knurled band Ø18 (20–40) are one cylinder
  head: { length: 20, dia: 11 },
  hole: 3,
  chamfers: { small: 0.3, head: 0.3, end: 1.0 },
  knurlBand: { from: 20, to: 40 }, // 20±0.1 壓花, from the drawing's right end
} as const;

/** The drawing of Part 2 (flange bushing): length 8, a Ø6.25 body, a Ø7.73 flange 1.2 thick, a stepped bore, a 25° cone and a 30° chamfer. */
const PART2 = {
  total: 8,
  body: { length: 5.367, dia: 6.25 },
  flange: { length: 1.2, dia: 7.73 },
  boreSmall: { length: 0.75, dia: 3.97 },
  boreBig: { dia: 4.247 },
  coneAngle: 25,
  endChamfer: 30,
} as const;

/**
 * Held, not guessed (the user's C1c, C2a, C3c): the drawing does not say enough to build these, so nothing here is built and the drawing sheet says so.
 */
export const HELD: readonly string[] = [
  'Ø10(HEX) 六角孔：對邊 10 → 對角 11.55 > 頭部 Ø11，圖面自相矛盾，未建（C1c）',
  'Part 2 的兩組 Ø6.25 公差（+0.01/0、±0.025）分屬哪一段：圖上未標，幾何依標稱值建，公差未註（C2a）',
  'Part 1 小端（單一 Ø6.25 或 Ø7.73 短肩＋Ø6.25）：圖上僅差約 5 px，該 8 mm 段未建（C3c）',
];

/** Assumed, and said so: what the drawing does not fix, chosen once here and asserted in the tests. */
export const ASSUMED: readonly { what: string; value: string; why: string }[] = [
  {
    what: 'Part 2 的 25° 錐面長度',
    value: '1.433 mm（由 8 − 5.367 − 1.2 得出，錐角成為 27.3°）',
    why: '圖上給了總長 8、本體 5.367、凸緣 1.2；三者相減才是錐面。27.3° 落在圖上標的 25°±5° 之內。',
  },
  { what: 'Part 2 凸緣端面的 30° 導角大小', value: '軸向 0.3 mm', why: '圖上只給了 30°，沒給距離。取與 Part 1 的 C0.3 同級。' },
  { what: 'Part 2 的 R0.2(max)／R0.5(max) 放在哪條邊', value: '兩個孔口（Ø3.97 於左端面、Ø4.247 於右端面）', why: '圖上只說「R0.2(max)、R0.5(max)」，沒指邊。孔口導引圓角是這兩個值最常見的用法，也是這個零件上僅有的「圓柱接平面」直角邊。' },
  { what: 'Part 1 的壓花段', value: '不建幾何，Ø18 光面＋圖面註記「壓花 20±0.1」', why: '使用者選 B2b；這也是業界對滾花的標準做法（滾花是製程，不是加工幾何）。' },
];

// -------------------------------------------------------------------------------------------------------------------------------- builders

/** A closed profile of (radius, axial) points, with a construction centerline on the axis, ready to revolve. */
function profile(id: string, pts: readonly (readonly [number, number])[]): { entities: SketchEntity[]; constraints: SketchConstraint[] } {
  const entities: SketchEntity[] = pts.map(([x, y], i) => ({ id: `${id}p${i}`, type: 'point', x, y }));
  for (let i = 0; i < pts.length; i++) entities.push({ id: `l${i}`, type: 'line', p1: `${id}p${i}`, p2: `${id}p${(i + 1) % pts.length}` });
  const lo = Math.min(...pts.map((p) => p[1]));
  const hi = Math.max(...pts.map((p) => p[1]));
  entities.push({ id: `${id}a0`, type: 'point', x: 0, y: lo - 1 }, { id: `${id}a1`, type: 'point', x: 0, y: hi + 1 });
  entities.push({ id: 'axis', type: 'line', p1: `${id}a0`, p2: `${id}a1`, construction: true });
  return { entities, constraints: [] };
}

const revolve = (id: string, sketch: string): Feature => ({ id, type: 'revolve', name: id, suppressed: false, sketch, axis: 'axis', op: 'boss', dir1: { type: 'blind', angle: '360deg' } });
const sketchOf = (id: string, plane: Ref, parts: { entities: SketchEntity[]; constraints: SketchConstraint[] }): Feature => ({ id, type: 'sketch', name: id, suppressed: false, plane, entities: parts.entities, constraints: parts.constraints });
const build = (...features: Feature[]): PartDoc => features.reduce<PartDoc>((doc, f, i) => applyCommand(doc, { type: 'insertFeature', feature: f, index: i } satisfies Command), createEmptyPart());
/** The Top plane, so the axis of revolution runs along world Z: see the note on orientation at the top of the file. */
const TOP: Ref = { kind: 'datum', name: 'plane:top' };

/**
 * The volume of a closed profile of (radius, axial) points revolved a full turn about the axis: π ∮ x² dy, worked out per edge as the frustum it makes.
 * A hand formula, not the kernel's own number: it is what the built solid is checked against.
 */
function revolvedVolume(pts: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    sum += ((y2 - y1) * (x1 * x1 + x1 * x2 + x2 * x2)) / 3;
  }
  return Math.PI * Math.abs(sum);
}
/** What a 45° chamfer of leg `c` takes off a rim of radius `r`: Pappus on the triangle, A = c²/2, its centroid a third of a leg in from the rim. */
const chamferVolume = (r: number, c: number) => 2 * Math.PI * (r - c / 3) * ((c * c) / 2);
/**
 * What a radius `f` fillet takes off (convex corner, `-`) or adds (concave, `+`) at a corner of a cylinder of radius `r` meeting a plane square to the axis:
 * Pappus on the square f² the corner is, less the quarter disc of the fillet, whose centroid is 4f/3π from each of its straight sides.
 */
function filletVolume(r: number, f: number, convex: boolean): number {
  const square = f * f;
  const quarter = (Math.PI * f * f) / 4;
  const area = square - quarter;
  const u = (square * (f / 2) - quarter * (f - (4 * f) / (3 * Math.PI))) / area;
  const x = convex ? r + u : r - u; // a convex corner is rounded away (the material is inside r), a concave one is filled outwards
  return (convex ? -1 : 1) * 2 * Math.PI * x * area;
}

// -------------------------------------------------------------------------------------------------------------------------------- Part 2: the flange bushing

const PART2_CONE = PART2.total - PART2.body.length - PART2.flange.length; // 1.433
const PART2_CHAMFER_AXIAL = 0.3;
/** The two radii the drawing writes as a maximum, at the bore mouths — the corner a lead-in radius is for, and this part's only cylinder-and-plane corners. */
const PART2_LEAD = { small: 0.2, big: 0.5 } as const;
const part2Points = (): [number, number][] => {
  const rb = PART2.body.dia / 2;
  const rf = PART2.flange.dia / 2;
  const rs = PART2.boreSmall.dia / 2;
  const rl = PART2.boreBig.dia / 2;
  const drop = PART2_CHAMFER_AXIAL * Math.tan(rad(PART2.endChamfer));
  return [
    [rb, 0], // p0
    [rb, PART2.body.length], // p1 — l0 the Ø6.25 body
    [rf, PART2.body.length + PART2_CONE], // p2 — l1 the 25° cone
    [rf, PART2.total - PART2_CHAMFER_AXIAL], // p3 — l2 the Ø7.73 land
    [rf - drop, PART2.total], // p4 — l3 the 30° chamfer
    [rl, PART2.total], // p5 — l4 the end face
    [rl, PART2.boreSmall.length], // p6 — l5 the Ø4.247 bore
    [rs, PART2.boreSmall.length], // p7 — l6 the bore step
    [rs, 0], // p8 — l7 the Ø3.97 bore
  ]; // l8 closes p8 → p0 as the left face
};
const P2 = {
  body: 'rv1:side:sk.l0',
  cone: 'rv1:side:sk.l1',
  land: 'rv1:side:sk.l2',
  endFace: 'rv1:side:sk.l4',
  bigBore: 'rv1:side:sk.l5',
  step: 'rv1:side:sk.l6',
  smallBore: 'rv1:side:sk.l7',
  leftFace: 'rv1:side:sk.l8',
  smallLead: 'f1:fillet:{rv1:side:sk.l7|rv1:side:sk.l8}',
  bigLead: 'f2:fillet:{rv1:side:sk.l4|rv1:side:sk.l5}',
} as const;

function buildPart2(): { doc: PartDoc; r: RebuildResult } {
  const doc = build(
    sketchOf('sk', TOP, profile('sk', part2Points())),
    revolve('rv1', 'sk'),
    { id: 'f1', type: 'fillet', name: 'f1', suppressed: false, edges: [{ kind: 'edge', name: '{rv1:side:sk.l7|rv1:side:sk.l8}' }], radius: String(PART2_LEAD.small) },
    { id: 'f2', type: 'fillet', name: 'f2', suppressed: false, edges: [{ kind: 'edge', name: '{rv1:side:sk.l4|rv1:side:sk.l5}' }], radius: String(PART2_LEAD.big) },
  );
  return { doc, r: regen().rebuild(doc) };
}

describe('Part 2：凸緣襯套（B1a）', () => {
  it('the 25° cone closes the length exactly: 5.367 + cone + 1.2 = 8', () => {
    expect(PART2_CONE).toBeCloseTo(1.433, 9);
    expect(PART2.body.length + PART2_CONE + PART2.flange.length).toBeCloseTo(PART2.total, 9);
    const angle = (Math.atan((PART2.flange.dia - PART2.body.dia) / 2 / PART2_CONE) * 180) / Math.PI;
    expect(angle, 'the cone angle the three lengths force').toBeCloseTo(27.3, 1);
    expect(Math.abs(angle - PART2.coneAngle), "inside the drawing's 25°±5°").toBeLessThan(5);
  });

  it('revolves into one valid solid, of the volume the hand formula gives, and the two lead-in radii move it by their own Pappus value', async () => {
    const rs = PART2.boreSmall.dia / 2;
    const rl = PART2.boreBig.dia / 2;
    const { doc, r } = buildPart2();
    expect(r.features.map((f) => `${f.id}=${f.status}`)).toEqual(['sk=ok', 'rv1=ok', 'f1=ok', 'f2=ok']);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    console.log(`  Part 2 faces: ${r.body!.names.faces.join(', ')}`);

    const solid = revolvedVolume(part2Points());
    const hand = solid + filletVolume(rs, PART2_LEAD.small, true) + filletVolume(rl, PART2_LEAD.big, true);
    const built = volume(r);
    console.log(`  Part 2 volume: built ${built.toFixed(4)} mm³, hand formula ${hand.toFixed(4)} mm³ (rel. err ${(Math.abs(built - hand) / hand).toExponential(2)})`);
    console.log(`  Part 2 radii take off ${(solid - built).toFixed(4)} mm³, Pappus says ${(solid - hand).toFixed(4)} mm³`);
    expect(built).toBeCloseTo(hand, 3);

    put('凸緣襯套.3dbx', await writePartFile(doc), 'Part 2 凸緣襯套：Ø6.25 本體、Ø7.73 凸緣、25° 錐面、階梯內孔 Ø3.97／Ø4.247、30° 端面導角、兩處孔口圓角');
    expect((await readAnyDocumentFile(await writePartFile(doc))).kind).toBe('part');
  });
});

// -------------------------------------------------------------------------------------------------------------------------------- Part 1: the knurled knob pin

const part1Points = (): [number, number][] => {
  const rb = PART1.body.dia / 2;
  const rh = PART1.head.dia / 2;
  return [
    [rb, 0], // p0
    [rb, PART1.body.length], // p1 — l0 the Ø18 body (the plain part and the knurled band)
    [rh, PART1.body.length], // p2 — l1 the shoulder
    [rh, PART1.body.length + PART1.head.length], // p3 — l2 the Ø11 head
    [0, PART1.body.length + PART1.head.length], // p4 — l3 the head's end face
    [0, 0], // p5 — l4 the axis, l5 the left face
  ];
};
const P1 = {
  body: 'rv1:side:sk.l0',
  shoulder: 'rv1:side:sk.l1',
  head: 'rv1:side:sk.l2',
  headFace: 'rv1:side:sk.l3',
  leftFace: 'rv1:side:sk.l5',
  headChamfer: 'c1:chamfer:{rv1:side:sk.l2|rv1:side:sk.l3}',
  holeWall: 'h1:side:sh.ph.wall',
} as const;

function buildPart1(): { doc: PartDoc; r: RebuildResult } {
  const doc = build(
    sketchOf('sk', TOP, profile('sk', part1Points())),
    revolve('rv1', 'sk'),
    { id: 'c1', type: 'chamfer', name: 'c1', suppressed: false, edges: [{ kind: 'edge', name: '{rv1:side:sk.l2|rv1:side:sk.l3}' }], mode: 'distanceDistance', distance: String(PART1.chamfers.head), second: String(PART1.chamfers.head) },
    sketchOf('sh', { kind: 'face', name: P1.headFace }, { entities: [{ id: 'ph', type: 'point', x: 0, y: 0 }], constraints: [] }),
    { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 'sh', kind: 'straight', diameter: String(PART1.hole), end: { type: 'throughAll' } },
  );
  return { doc, r: regen().rebuild(doc) };
}

describe('Part 1：壓花旋鈕銷（B2b）', () => {
  it('is built without the held small end, and says so', () => {
    // the drawing's 60 mm is 8 (held) + 32 (Ø18) + 20 (Ø11); the built part is the 52 mm that is not held
    expect(PART1.smallEnd.length + PART1.body.length + PART1.head.length).toBe(PART1.total);
    expect(PART1.total - PART1.smallEnd.length).toBe(52);
  });

  it('revolves, takes its C0.3 off the head, and drills the Ø3 through — each against its own hand value', async () => {
    const rh = PART1.head.dia / 2;
    const { doc, r } = buildPart1();
    expect(r.features.map((f) => `${f.id}=${f.status}`)).toEqual(['sk=ok', 'rv1=ok', 'c1=ok', 'sh=ok', 'h1=ok']);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    console.log(`  Part 1 faces: ${r.body!.names.faces.join(', ')}`);

    // each feature on its own, so the hand value is checked feature by feature and not only at the end
    const at = (n: number) => volume(regen().rebuild(doc, { until: n }));
    const solid = at(2);
    const afterChamfer = at(3);
    const afterHole = at(5);
    console.log(`  Part 1 stages: revolve ${solid.toFixed(4)}, +C0.3 ${afterChamfer.toFixed(4)} (−${(solid - afterChamfer).toFixed(4)}), +Ø3 ${afterHole.toFixed(4)} (−${(afterChamfer - afterHole).toFixed(4)})`);
    console.log(`  hand:          revolve ${revolvedVolume(part1Points()).toFixed(4)}, +C0.3 −${chamferVolume(rh, PART1.chamfers.head).toFixed(4)}, +Ø3 −${(Math.PI * (PART1.hole / 2) ** 2 * 52).toFixed(4)}`);

    const hand = revolvedVolume(part1Points()) - chamferVolume(rh, PART1.chamfers.head) - Math.PI * (PART1.hole / 2) ** 2 * (PART1.body.length + PART1.head.length);
    const built = volume(r);
    console.log(`  Part 1 volume: built ${built.toFixed(4)} mm³, hand formula ${hand.toFixed(4)} mm³ (rel. err ${(Math.abs(built - hand) / hand).toExponential(2)})`);
    expect(built).toBeCloseTo(hand, 3);

    put('壓花旋鈕銷.3dbx', await writePartFile(doc), 'Part 1 壓花旋鈕銷：Ø18 本體（含壓花段，光面）＋Ø11 頭部＋Ø3 貫穿孔＋頭部 C0.3；小端 8 mm 未建（C3c）');
    expect((await readAnyDocumentFile(await writePartFile(doc))).kind).toBe('part');
  });
});

// -------------------------------------------------------------------------------------------------------------------------------- STEP, and the drawings (B3a)

/** A part written as STEP into the output, read back, and the volume checked both ways: what a drawing or another CAD opens. */
function stepOut(name: string, title: string, shape: ShapeId, look: string): void {
  const text = kernel.exportStep(shape, name);
  const before = kernel.massProps(shape);
  const after = kernel.massProps(kernel.importStep(text).shape);
  expect(after.volume, name).toBeCloseTo(before.volume, 2);
  const b = kernel.bounds(shape);
  const size = [0, 1, 2].map((i) => (b.max[i]! - b.min[i]!).toFixed(2)).join(' × ');
  put(`${name}.step`, text, `STEP：${title}（外框 ${size} mm、體積 ${before.volume.toFixed(2)} mm³；讀回體積 ${after.volume.toFixed(2)} mm³）`);
  console.log(`  ${name}.step: 外框 ${size} mm, 體積 ${before.volume.toFixed(4)} → 讀回 ${after.volume.toFixed(4)} mm³`);
  console.log(`  ${name}: ${look}`);
}

const IDENTITY: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const VIEWS = { side: 'view1', section: 'view2', end: 'view3' } as const;

/**
 * One sheet: the part seen from the side (its axis across the sheet), the same part cut along its axis (A–A), and the part seen down its axis. A diameter goes in
 * the end view, where a cylinder is seen as the circle it is; a fillet's radius goes in the side view instead, because that is where its tube is cut through and the
 * arc is seen true. This program only dimensions a round element that is seen in its true shape.
 */
async function sheet(o: {
  file: string;
  drawingName: string;
  source: string;
  doc: PartDoc;
  r: RebuildResult;
  dims: (v: typeof VIEWS) => Dimension[];
  finishes?: (v: typeof VIEWS) => SurfaceFinish[];
  notes: readonly string[];
}): Promise<{
  scene: Scene;
  texts: string[];
  sceneTexts: string[];
  errors: string[];
  dimensions: Map<string, DimensionOutcome>;
  axisSheetY: number;
  features: Map<string, ReturnType<typeof viewFeatures>>;
  axes: Map<string, ViewAxes>;
  lines: Map<string, ViewLines>;
  placed: Map<string, PlacedView>;
}> {
  const shape = o.r.body!.shape;
  const shapes = [{ shape, pose: IDENTITY, mirrored: false }];
  const views = (): DrawingView[] => [
    { id: VIEWS.side, name: '前視（側面）', source: o.source, direction: 'right' },
    { id: VIEWS.end, name: '端視', source: o.source, direction: 'front' },
  ];
  let drawing: DrawingDoc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: views() });
  drawing = applyDrawingCommand(drawing, { type: 'setTitle', field: 'drawingName', value: o.drawingName });
  drawing = applyDrawingCommand(drawing, { type: 'setTitle', field: 'drawingNo', value: o.source.replace('.3dbx', '') });
  drawing = applyDrawingCommand(drawing, { type: 'setTitle', field: 'generalTolerance', value: '未註公差依一般公差' });
  drawing = applyDrawingCommand(drawing, { type: 'setSheet', sheet: { scale: [1, 1] } });

  const project = (doc: DrawingDoc, extra?: DrawingView): Map<string, ViewLines> => {
    const all = extra ? [...doc.views, extra] : doc.views;
    const lines = new Map<string, ViewLines>();
    for (const v of all) {
      const axes = axesOf(all, doc.sheet.projection, v)!;
      if (v.kind === 'section') {
        const parent = all.find((x) => x.id === v.parent)!;
        lines.set(v.id, projectDrawingView(kernel, shapes, axes, sectionPlane(axesOf(all, doc.sheet.projection, parent)!, v)));
      } else {
        lines.set(v.id, projectDrawingView(kernel, shapes, axes));
      }
    }
    return lines;
  };

  // the A–A cut runs along the axis, which is the middle of the side view's box
  const first = project(drawing);
  const box = first.get(VIEWS.side)!.box!;
  const cut = Math.round((box.min[1] + box.max[1]) / 2);
  const section: DrawingView = { id: VIEWS.section, name: 'A-A', kind: 'section', parent: VIEWS.side, line: [[box.min[0] - 1, cut], [box.max[0] + 1, cut]], label: 'A' };
  drawing = applyDrawingCommand(drawing, { type: 'insertViews', views: [section] });
  const lines = project(drawing, section);

  const holes = holeFeatures(o.doc);
  const features = new Map<string, ReturnType<typeof viewFeatures>>();
  const axesById = new Map<string, ViewAxes>();
  for (const v of drawing.views)
    if (v.kind !== 'section') {
      const ax = axesOf(drawing.views, drawing.sheet.projection, v)!;
      axesById.set(v.id, ax);
      features.set(v.id, viewFeatures(o.r.body!.topology, o.r.body!.names, ax, undefined, holes));
    }
  drawing = applyDrawingCommand(drawing, { type: 'insertDimensions', dimensions: o.dims(VIEWS) });
  if (o.finishes) drawing = applyDrawingCommand(drawing, { type: 'insertSurfaceFinishes', finishes: o.finishes(VIEWS) });

  const elements = new Map<string, ElementsResult>(
    drawing.dimensions.map((d) => {
      const refs: Ref[] = d.kind === 'linear' || d.kind === 'angle' ? [d.a, d.b] : [d.ref];
      return [d.id, { elements: refs.map((r) => elementFacts(o.r.body!.topology, o.r.body!.names, r, holes)) as never }];
    }),
  );
  const built = buildScene(drawing, lines, elements, features);
  const texts = [...built.dimensions.values()].map((x) => ('text' in x ? x.text : `ERROR ${x.error}`)).sort();
  const errors = texts.filter((x) => x.startsWith('ERROR'));
  // everything written on the sheet, not only the dimensions: the notes under a surface-finish symbol are here and nowhere else
  const sceneTexts = built.scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
  // where the part's axis runs across the side view, on the sheet: the A–A cut was taken along it, so it is the middle of that view's box
  const side = built.placed.get(VIEWS.side)!;
  const axisSheetY = side.at[1] + (cut - side.centre[1]) * side.scale;

  put(`${o.file}.3dbd`, await writeDrawingFile(drawing), `${o.drawingName}：前視、A-A 剖面、端視、尺寸與標註（${o.notes.join('；')}）`);
  const dxf = toDxf(built.scene);
  expect(checkDxf(readDxf(dxf))).toEqual([]);
  put(join('輸出', `${o.file}.dxf`), dxf, `${o.drawingName} DXF`);
  const fontFile = 'C:\\Windows\\Fonts\\msjh.ttc';
  const font = existsSync(fontFile) ? readTrueType(new Uint8Array(readFileSync(fontFile))) : undefined;
  const pdf = toPdf(built.scene, { ...(font ? { font } : {}), title: o.drawingName });
  put(join('輸出', `${o.file}.pdf`), pdf.bytes, `${o.drawingName} PDF${font ? '（內嵌微軟正黑體）' : '（無字型）'}`);
  console.log(`  ${o.file}: 圖面文字 ${texts.join('、')}`);
  return { scene: built.scene, texts, sceneTexts, errors, dimensions: built.dimensions, axisSheetY, features, axes: axesById, lines, placed: built.placed };
}

describe('工程圖：兩件各一張（B3a）', () => {
  it('Part 1: the side view, the A–A section, the end view, the Ø3 hole callout, the Ra symbol and the knurl note', async () => {
    const { doc, r } = buildPart1();
    stepOut('壓花旋鈕銷', 'Part 1 壓花旋鈕銷（Ø18 本體、Ø11 頭部、Ø3 貫穿；小端 8 mm 未建）', r.body!.shape, '一個旋轉體；Ø18 段與 Ø11 段的交界清楚；Ø3 貫穿孔在中心；頭部外緣有一圈 C0.3；沒有壓花幾何（依 B2b，滾花以圖面註記表示）');

    const { texts, sceneTexts, errors } = await sheet({
      file: '壓花旋鈕銷加工圖',
      drawingName: '壓花旋鈕銷',
      source: '壓花旋鈕銷.3dbx',
      doc,
      r,
      dims: (v) => [
        { id: 'd1', kind: 'linear', view: v.side, a: face(P1.leftFace), b: face(P1.headFace), orientation: 'horizontal', offset: 12 },
        { id: 'd2', kind: 'linear', view: v.side, a: face(P1.shoulder), b: face(P1.headFace), orientation: 'horizontal', offset: 24 },
        { id: 'd3', kind: 'diameter', view: v.end, ref: face(P1.body), angle: 30, leader: 10 },
        { id: 'd4', kind: 'diameter', view: v.end, ref: face(P1.head), angle: 150, leader: 10 },
        { id: 'd5', kind: 'diameter', view: v.end, ref: face(P1.holeWall), angle: 270, leader: 6, callout: true },
      ],
      finishes: (v) => [
        { id: 'sf1', view: v.side, at: [-8, 9], angle: 90, kind: 'machined', ra: 0.8, leader: 5 },
        { id: 'sf2', view: v.side, at: [-22, 9], angle: 90, kind: 'basic', note: `壓花 ${PART1.knurlBand.to - PART1.knurlBand.from}±0.1`, leader: 7 },
      ],
      notes: ['Ø18、Ø11、Ø3 貫穿', 'Ra 0.8（ISO 1302，Ra 為上限，即圖上的 Ra<0.8）', '壓花 20±0.1（註記，不建幾何）', 'A–A 剖面'],
    });
    expect(errors).toEqual([]);
    expect(texts).toContain('Ø3 貫穿');
    // the knurl is a note under its surface-finish symbol (B2b: no geometry), so it is on the sheet but not among the dimensions
    expect(sceneTexts.some((x) => x.includes('壓花 20±0.1')), sceneTexts.join('、')).toBe(true);
  });

  it('Part 2: the side view, the A–A section, the end view, the two MAX radii, and the Ø6.25 without its held tolerance', async () => {
    const { doc, r } = buildPart2();
    stepOut('凸緣襯套', 'Part 2 凸緣襯套（Ø6.25 本體、Ø7.73 凸緣、25° 錐面、階梯內孔、30° 端面導角）', r.body!.shape, '一個旋轉體；凸緣比本體大一圈，之間是 25° 錐面；內孔兩段（Ø3.97 短、Ø4.247 長）中間有段差；兩處孔口有小圓角');

    const { texts, errors, dimensions, axisSheetY, features, axes, lines, placed } = await sheet({
      file: '凸緣襯套加工圖',
      drawingName: '凸緣襯套',
      source: '凸緣襯套.3dbx',
      doc,
      r,
      dims: (v) => [
        { id: 'd1', kind: 'linear', view: v.side, a: face(P2.leftFace), b: face(P2.endFace), orientation: 'horizontal', offset: 10 },
        { id: 'd2', kind: 'linear', view: v.side, a: face(P2.leftFace), b: face(P2.step), orientation: 'horizontal', offset: 20 },
        { id: 'd3', kind: 'diameter', view: v.end, ref: face(P2.land), angle: 20, leader: 10 },
        // Ø6.25 carries two tolerance sets on the source drawing that cannot be read off it. They are parked, not guessed (C2a): a wrong tolerance is
        // made to, a blank one is asked about. The dimension says so on the sheet rather than leaving a bare number the reader would take as exact.
        { id: 'd4', kind: 'diameter', view: v.end, ref: face(P2.body), angle: 200, leader: 8, suffix: '（原圖未載明）' },
        { id: 'd5', kind: 'diameter', view: v.end, ref: face(P2.bigBore), angle: 300, leader: 6 },
        { id: 'd6', kind: 'diameter', view: v.end, ref: face(P2.smallBore), angle: 120, leader: 6 },
        // the two fillets are dimensioned in the side view, where the axis lies across the sheet and each is seen as the quarter arc it is — down the axis it is only a ring
        { id: 'd7', kind: 'radius', view: v.side, ref: face(P2.smallLead), angle: 90, leader: 6, tolerance: { type: 'max' } },
        { id: 'd8', kind: 'radius', view: v.side, ref: face(P2.bigLead), angle: 270, leader: 6, tolerance: { type: 'max' } },
      ],
      finishes: (v) => [{ id: 'sf1', view: v.side, at: [-4, 3.2], angle: 90, kind: 'machined', ra: 1.6, leader: 5 }],
      notes: ['Ø7.73、Ø6.25、Ø4.247、Ø3.97', 'R0.2 與 R0.5（單向極限，zh-TW 作「最大」）', 'A–A 剖面', 'Ø6.25 的兩組公差依 C2a 未註'],
    });
    expect(errors).toEqual([]);
    // the one-sided limit is a word, and the word is the drawing's language's (zh-TW 「最大」, en 「MAX」) — ADR 0125
    expect(texts).toContain('R0.2 最大');
    expect(texts).toContain('R0.5 最大');
    expect(texts).toContain('Ø6.25（原圖未載明）');
    // the text being right is not enough: each leader has to land on the fillet's arc, not in the middle of the bore. The arc's middle is `major` off the part's
    // axis, its arrow touches at major + minor, and it is above the axis for d7 and below it for d8 — which is what the two leader angles asked for.
    for (const [id, ref, sign] of [['d7', P2.smallLead, 1], ['d8', P2.bigLead, -1]] as const) {
      const facts = elementFacts(r.body!.topology, r.body!.names, face(ref)) as ElementFacts;
      expect(facts, id).toMatchObject({ type: 'torus' });
      const g = (dimensions.get(id) as { dxf: { geometry: { centre: number[]; near: number[] } } }).dxf.geometry;
      expect(g.centre[1]! - axisSheetY, `${id} 弧心在軸的哪一側`).toBeCloseTo(sign * facts.major!, 6);
      expect(g.near[1]! - axisSheetY, `${id} 箭頭觸點到軸的距離`).toBeCloseTo(sign * (facts.major! + facts.radius!), 6);
      console.log(`  ${id}: R${facts.radius}，弧心距軸 ${facts.major!.toFixed(4)}、箭頭觸點 ${(facts.major! + facts.radius!).toFixed(4)} mm`);
    }

    // E1a: the same two fillets are reachable from the sheet itself — pointed at, not named. Each is offered as **two** arcs, because the view cuts its tube once
    // either side of the axis, and the two cuts are two features of one face.
    const side = features.get(VIEWS.side)!;
    const fillets = side.filter((f) => f.type === 'torus');
    expect(fillets).toHaveLength(4);
    expect([...new Set(fillets.map((f) => f.radius))].sort((a, b) => a - b)).toEqual([PART2_LEAD.small, PART2_LEAD.big]);
    for (const name of new Set(fillets.map((f) => f.ref.name))) {
      const pair = fillets.filter((f) => f.ref.name === name);
      expect(pair, `${name} 的兩個切口`).toHaveLength(2);
      // the two arcs are the tube cut either side of the axis: their middles are `2 × major` apart, about the axis
      expect(Math.abs(pair[0]!.at[1] - pair[1]!.at[1]), `${name} 兩弧的距離`).toBeCloseTo(2 * pair[0]!.major, 6);
      expect(pair[0]!.radius).toBe(pair[1]!.radius);
    }
    // pointing at a drawn arc picks the fillet, and the pick says of the face exactly what the face's own name says of it: same R, same major. Which part of the
    // tube the projection draws is the projection's business (the arc is a quarter of the tube, and hidden-line removal decides the rest), so the claim is that
    // the arc is reachable at all, and that wherever it is reachable it is the right face.
    const sideLines = lines.get(VIEWS.side)!;
    const sideAxes = axes.get(VIEWS.side)!;
    const sidePlaced = placed.get(VIEWS.side)!;
    for (const f of fillets) {
      const hits = Array.from({ length: 48 }, (_, i) => {
        const a = (i / 48) * 2 * Math.PI;
        return featureAt(sideLines, side, [f.at[0] + f.radius * Math.cos(a), f.at[1] + f.radius * Math.sin(a)], 0.05);
      }).filter((p) => p?.type === 'torus' && p.ref.name === f.ref.name);
      expect(hits.length, `${f.ref.name}（R${f.radius}）的弧在圖上點得到`).toBeGreaterThan(0);
      const named = elementFacts(r.body!.topology, r.body!.names, face(f.ref.name)) as ElementFacts;
      for (const picked of hits) {
        expect(factsOf(picked!, sideAxes)).toMatchObject({ kind: 'face', type: 'torus', radius: named.radius, major: named.major });
        const plan = planDimension([picked!], [sidePlaced.at[0] + 40, sidePlaced.at[1] + 40], sidePlaced, sideAxes);
        if (!('draft' in plan)) throw new Error(`沒有草稿：${JSON.stringify(plan)}`);
        expect(plan.draft).toMatchObject({ kind: 'radius', ref: picked!.ref });
        const out = evaluateDimension({ id: 'p', view: VIEWS.side, ...plan.draft } as Dimension, { elements: plan.facts }, sideAxes, sidePlaced);
        expect('error' in out ? out.error : out.text).toBe(`R${named.radius}`);
      }
    }
    // the step E1a kept out: pointing at a fillet is one thing, and drafting every fillet's R into the automatic dimensions is another. That button is unchanged.
    const drafted = autoDimensions(side, { overall: true, holes: true, positions: true });
    const filletNames = new Set(fillets.map((f) => f.ref.name));
    const names = (d: (typeof drafted)[number]) => (d.kind === 'linear' || d.kind === 'angle' ? [d.a.name, d.b.name] : [d.ref.name]);
    expect(drafted.flatMap(names).filter((n) => filletNames.has(n)), '自動尺寸不應冒出圓角半徑').toEqual([]);
    console.log(`  E1a：側視圖 ${fillets.length} 條圓角弧，點選可得 R${PART2_LEAD.small}／R${PART2_LEAD.big}；自動尺寸 ${drafted.length} 項，其中 0 項是圓角`);
  });
});

