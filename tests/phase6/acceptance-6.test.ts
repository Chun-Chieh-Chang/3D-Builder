/**
 * Phase 6-8 (docs/phase6-plan.md §驗收), the part of the acceptance that needs no sample of the user's: the golden housing — 60 × 40 × 30, open at the top, walls 2 and a floor
 * of 3, 1° of draft on every wall, a lip on its rim, two screw bosses and a snap hook — and the cover that closes it (a groove for the lip, a window for the hook), made as
 * documents; the three analyses against what is known by hand; the cover posed on the housing in an assembly's frame and the interference checked (none; and 36 mm³ of the
 * hook's beam in a cover without its window).
 *
 * The housing is drafted about its rim (its neutral plane), so its outline at the top is 60 × 40 and it narrows toward the floor by tan 1° per mm: it is wider at the open
 * end, as a part that leaves a mold along +z has to be. The datum plane `pf` stands at the top of the floor (z = 3), where the bosses and the hook are sketched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Pose, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { findInterference, Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const face = (name: string): Ref => ({ kind: 'face', name });
const datum = (name: string): Ref => ({ kind: 'datum', name });
const rad = (deg: number) => (deg * Math.PI) / 180;
const T = Math.tan(rad(1));
const points = (id: string, plane: Ref, ...pts: [string, number, number][]): Feature => ({ ...sketch(id, plane), entities: pts.map(([p, x, y]) => ({ id: p, type: 'point', x, y })) }) as Feature;
const plane = (id: string, z: string): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: z } }) as Feature;
/** A part with the thickness of the floor as a variable, `floorT` (3): the shell, the datum plane the bosses and the hook stand on, and the window under the hook all follow it. */
function make(...features: Feature[]): PartDoc {
  let doc = applyCommand(createEmptyPart(), { type: 'addVariable', variable: { id: 'var1', name: 'floorT', expr: '3' } });
  features.forEach((feature, index) => (doc = applyCommand(doc, { type: 'insertFeature', feature, index })));
  return doc;
}

// ---- the housing

const SIDES = ['rl0', 'rl1', 'rl2', 'rl3'].map((e) => face(`e:side:s.${e}`));
const body = (): Feature[] => [
  sketch('s', front, rectangle('r', -30, -20, 60, 40)),
  extrude('e', 's', 'boss', { type: 'blind', depth: '30' }),
  { id: 'd1', type: 'draft', name: 'd1', suppressed: false, neutral: face('e:cap:end'), faces: SIDES, angle: '1deg' } as Feature,
  { id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [face('e:cap:end')], thickness: '2', faceThickness: [{ face: face('e:cap:start'), thickness: 'floorT' }] } as Feature,
];
/** The name of the rim, the face at the open end, found on the shell. */
function rimName(): string {
  const r = rebuild(make(...body()));
  const i = r.body!.topology.faces.findIndex((f) => f.normal && f.normal[2] > 0.99 && Math.abs(f.center[2] - 30) < 1e-6);
  expect(i).toBeGreaterThanOrEqual(0);
  return r.body!.names.faces[i]!;
}
/**
 * With `floorWindow` the window through the floor under the hook's catch face (the snap catch cut down from the datum plane, 1.3 × 6.4: from the front of the beam to
 * 0.1 past the wedge, across the beam and 0.2 each side): without it the hook is an undercut of its own — see ③.
 */
const housing = (rim: string, floorWindow = true): Feature[] => [
  ...body(),
  { id: 'lp', type: 'lipGroove', name: 'lp', suppressed: false, face: face(rim), kind: 'lip', offset: '0.5', width: '1', height: '1' } as Feature,
  plane('pf', 'floorT'),
  points('skb', datum('pf'), ['b1', 20, 10], ['b2', -20, -10]),
  { id: 'sb', type: 'screwBoss', name: 'sb', suppressed: false, sketch: 'skb', diameter: '6', holeDiameter: '2.5', height: '10', draft: '1deg' } as Feature,
  points('skh', datum('pf'), ['h1', -15, 10]),
  { id: 'hk', type: 'snapHook', name: 'hk', suppressed: false, sketch: 'skh', width: '6', thickness: '2', length: '33', hookHeight: '3', hookDepth: '1.2' } as Feature,
  ...(floorWindow
    ? [points('skf', datum('pf'), ['f1', -12.35, 10]), { id: 'fw', type: 'snapCatch', name: 'fw', suppressed: false, sketch: 'skf', length: '1.3', width: '6.4', depth: 'floorT + 1' } as Feature]
    : []),
];

// ---- the cover (built at z = 0 to 3, posed 30 up on the housing)

const cover = (window: boolean): Feature[] => [
  sketch('cs', front, rectangle('cr', -30, -20, 60, 40)),
  extrude('c', 'cs', 'boss', { type: 'blind', depth: '3' }),
  { id: 'gv', type: 'lipGroove', name: 'gv', suppressed: false, face: face('c:cap:start'), kind: 'groove', offset: '0.4', width: '1.2', height: '1.2' } as Feature,
  ...(window
    ? [
        plane('pc', '3'),
        // the hook stands out of its beam 1.2, the beam is 2 thick (x −15 to −13): the window runs x −15.1 to −11.7 (3.4 long, centered at −13.4) and y 6.8 to 13.2 (6.4 across)
        points('skw', datum('pc'), ['w1', -13.4, 10]),
        { id: 'wn', type: 'snapCatch', name: 'wn', suppressed: false, sketch: 'skw', length: '3.4', width: '6.4', depth: '4' } as Feature,
      ]
    : []),
];

// ---- by hand

/** The housing's own volume: outer prism less cavity (both leaning by tan 1°), the floor, and what stands in it. */
function byHand() {
  const h = 2 / Math.cos(rad(1)); // the wall is 2 thick square to itself; across the horizontal it is 2/cos 1°
  const outer = 72000 - 90000 * T + 36000 * T * T; // ∫0..30 (60 − 2uT)(40 − 2uT) du, u down from the rim
  const a = 60 - 2 * h;
  const b = 40 - 2 * h;
  const cavity = 27 * a * b - (2 * T * (a + b) * 27 ** 2) / 2 + (4 * T * T * 27 ** 3) / 3; // ∫0..27 (a − 2uT)(b − 2uT) du, from the rim down to the floor at z = 3
  const R = 3;
  const rh = 1.25;
  const top = R - 10 * T;
  const boss = (Math.PI * 10 * (R * R + R * top + top * top)) / 3 - Math.PI * rh * rh * 10;
  const hook = 2 * 6 * 33 + 0.5 * 1.2 * 3 * 6;
  const window = 1.3 * 6.4 * 3; // through the floor of 3
  return { shell: outer - cavity, lip: 192, boss, hook, window, h, outer, cavity };
}

describe('the golden housing, made as a document (6-8)', () => {
  let r: RebuildResult;
  let shape: ShapeId;
  let rim: string;
  const hand = byHand();
  beforeAll(() => {
    rim = rimName();
    r = rebuild(make(...housing(rim)));
    shape = r.body!.shape;
  });

  it('① every feature is ok, one valid solid; its volume is the shell of the drafted box with a floor of 3, plus the lip (192), two bosses and the hook (406.8), less the window in the floor (24.96), by hand', () => {
    expect(failures(r)).toEqual([]);
    expect(kernel.solidCount(shape)).toBe(1);
    expect(kernel.isValid(shape)).toBe(true);
    const shellOnly = rebuild(make(...body()));
    expect(kernel.massProps(shellOnly.body!.shape).volume).toBeCloseTo(hand.shell, 2);
    expect(kernel.massProps(shape).volume).toBeCloseTo(hand.shell + hand.lip + 2 * hand.boss + hand.hook - hand.window, 2);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
  });

  it('② draft (pull +z, 0.5° required): the outer walls lean −1.000°, the inner walls and the boss walls +1.000°; the floor, the rim and the lip top ±90°; what is square to the pull needs draft — the lip\'s walls and the hook\'s', () => {
    const report = kernel.draftAnalysis(shape, [0, 0, 1], rad(0.5));
    const topo = r.body!.topology;
    const names = r.body!.names.faces;
    const deg = (x: number) => (x * 180) / Math.PI;
    const wall = (f: { face: number }) => topo.faces[f.face]!;
    // planar walls (normal nearly horizontal) of the drafted box itself, not of the lip, the hook or the bosses
    const own = (f: { face: number }) => !/^(lp|hk|sb|fw):/.test(names[f.face]!);
    const boxWalls = report.faces.filter((f) => own(f) && wall(f).surface === 'plane' && Math.abs(wall(f).normal![2]) < 0.1);
    expect(boxWalls).toHaveLength(8); // four outside, four inside
    for (const f of boxWalls) {
      expect(f.kind === 'negative' || f.kind === 'positive').toBe(true);
      expect(Math.abs(deg(f.min))).toBeCloseTo(1, 6);
      expect(Math.abs(deg(f.max))).toBeCloseTo(1, 6);
    }
    expect(boxWalls.filter((f) => f.kind === 'negative')).toHaveLength(4);
    expect(boxWalls.filter((f) => f.kind === 'positive')).toHaveLength(4);
    // the faces of the bosses' walls are cones at +1°
    const cones = report.faces.filter((f) => names[f.face]!.startsWith('sb:') && wall(f).surface === 'cone');
    expect(cones).toHaveLength(2);
    for (const f of cones) expect(deg(f.min)).toBeCloseTo(1, 6);
    // what is square to the pull needs draft, and these are the only faces that do: the lip's walls (two on each of its four sides), the hook's and the floor window's, and the
    // pilot holes of the bosses (the boss draws its outside wall with draft, not its hole: a finding of this acceptance, ADR 0082)
    const required = report.faces.filter((f) => f.kind === 'required');
    for (const f of required) expect(/^(lp|hk|fw):|^sb:.*\.hole$/.test(names[f.face]!), `${names[f.face]} needs draft`).toBe(true);
    for (const f of required) expect(Math.abs(deg(f.min))).toBeLessThan(0.5);
    expect(required.filter((f) => names[f.face]!.startsWith('lp:'))).toHaveLength(8);
    expect(required.filter((f) => names[f.face]!.startsWith('sb:'))).toHaveLength(2);
    expect(required.some((f) => names[f.face]!.startsWith('hk:'))).toBe(true);
    // the classes add up to the whole surface
    const total = Object.values(report.totals).reduce((a, x) => a + x.area, 0);
    expect(total).toBeCloseTo(topo.faces.reduce((a, f) => a + f.area, 0), 4);
    // pulled the other way the signs of the walls turn over
    const down = kernel.draftAnalysis(shape, [0, 0, -1], rad(0.5));
    expect(down.faces.filter((f) => own(f) && wall(f).surface === 'plane' && Math.abs(wall(f).normal![2]) < 0.1).map((f) => f.kind).sort()).toEqual(['negative', 'negative', 'negative', 'negative', 'positive', 'positive', 'positive', 'positive']);
  });

  it('②b the pilot holes of the bosses with a draft of 1° (the hardening decision H-4) no longer need one: they lean +1.000° like the other inside walls, and nothing of the bosses is asked for draft', () => {
    const drafted = rebuild(make(...housing(rim).map((f) => (f.type === 'screwBoss' ? ({ ...f, holeDraft: '1deg' } as Feature) : f))));
    expect(failures(drafted)).toEqual([]);
    const names = drafted.body!.names.faces;
    const report = kernel.draftAnalysis(drafted.body!.shape, [0, 0, 1], rad(0.5));
    expect(report.faces.filter((f) => f.kind === 'required' && names[f.face]!.startsWith('sb:'))).toEqual([]);
    const holes = report.faces.filter((f) => /^sb:.*\.hole$/.test(names[f.face]!));
    expect(holes).toHaveLength(2);
    for (const f of holes) {
      expect(f.kind).toBe('positive');
      expect((f.min * 180) / Math.PI).toBeCloseTo(1, 6);
    }
  });

  it('③ undercut (along z): the hook on a floor shuts itself in — its front face (6 × 30) and its catch face (6 × 1.2) are seen from neither end, 187.2 mm²; a window through the floor under the catch face opens them, and then nothing is an undercut', () => {
    const bare = rebuild(make(...housing(rim, false)));
    const report = kernel.undercutAnalysis(bare.body!.shape, [0, 0, 1]);
    const names = bare.body!.names.faces;
    const shut = report.faces.filter((f) => f.kind === 'undercut');
    expect(shut.map((f) => names[f.face]).sort()).toEqual(['hk:side:skh.h1.catch', 'hk:side:skh.h1.front']);
    expect(report.undercutArea).toBeCloseTo(6 * 30 + 6 * 1.2, 3);
    const open = kernel.undercutAnalysis(shape, [0, 0, 1]);
    expect(open.undercutArea).toBeCloseTo(0, 6);
    expect(open.faces.some((f) => f.kind === 'undercut' || f.kind === 'unknown')).toBe(false);
  });

  it('④ thickness: the walls 2.000, the floor 3.000 (median of each outside face, by hand: 2 square to the wall; 3 through the floor), the hook\'s beam is 2 thick', () => {
    const report = kernel.thicknessAnalysis(shape, { min: 1.5, max: 4 });
    const topo = r.body!.topology;
    const names = r.body!.names.faces;
    const planes = report.faces.filter((f) => !/^(lp|hk|sb):/.test(names[f.face]!) && topo.faces[f.face]!.surface === 'plane' && topo.faces[f.face]!.normal);
    const outerWalls = planes.filter((f) => Math.abs(topo.faces[f.face]!.normal![2]) < 0.1 && /^e:side:/.test(names[f.face]!));
    expect(outerWalls).toHaveLength(4);
    for (const f of outerWalls) expect(f.median).toBeCloseTo(2, 3);
    const floor = planes.find((f) => /^e:cap:start$/.test(names[f.face]!))!;
    expect(floor.median).toBeCloseTo(3, 3);
    expect(floor.kind).toBe('ok');
    for (const f of outerWalls) expect(f.kind).toBe('ok');
  });

  it('⑤ it follows the model: the floor made 4 thick (one variable) lifts the bosses, the hook and its window with it — the same names, the tip of the hook at 37; the box made 10 wider keeps every feature ok', () => {
    const base = r.body!.names.faces.filter((n) => /^(lp|sb|hk|fw):/.test(n)).sort();
    const thick = rebuild(applyCommand(make(...housing(rim)), { type: 'setVariable', id: 'var1', expr: '4' }));
    expect(failures(thick)).toEqual([]);
    const names = thick.body!.names.faces;
    expect(names.filter((n) => /^(lp|sb|hk|fw):/.test(n)).sort()).toEqual(base);
    expect(thick.body!.topology.faces[names.indexOf('hk:side:skh.h1.tip')]!.center[2]).toBeCloseTo(37, 6);
    expect(kernel.isValid(thick.body!.shape)).toBe(true);
    // the window is through a floor of 4 now: its volume is 1.3 × 6.4 × 4
    const without = rebuild(applyCommand(make(...housing(rim, false)), { type: 'setVariable', id: 'var1', expr: '4' }));
    expect(kernel.massProps(without.body!.shape).volume - kernel.massProps(thick.body!.shape).volume).toBeCloseTo(1.3 * 6.4 * 4, 3);
    // the hook is still not an undercut
    expect(kernel.undercutAnalysis(thick.body!.shape, [0, 0, 1]).undercutArea).toBeCloseTo(0, 6);
    const wide = rebuild(applyCommand(make(...housing(rim)), { type: 'setDimension', featureId: 's', constraintId: 'rw', value: '70' }));
    expect(failures(wide)).toEqual([]);
    expect(kernel.massProps(wide.body!.shape).volume).toBeGreaterThan(kernel.massProps(r.body!.shape).volume);
    expect(wide.body!.names.faces.filter((n) => /^(lp|sb|hk|fw):/.test(n)).sort()).toEqual(base);
  });
});

describe('the cover, and the two in an assembly (6-8)', () => {
  let h: RebuildResult;
  let withWindow: RebuildResult;
  let without: RebuildResult;
  beforeAll(() => {
    h = rebuild(make(...housing(rimName())));
    withWindow = rebuild(build(...cover(true)));
    without = rebuild(build(...cover(false)));
  });
  const at = (z: number, x = 0): Pose => ({ position: [x, 0, z], rotation: [0, 0, 0, 1] });
  const shapes = (): Record<string, ShapeId> => ({ housing: h.body!.shape, window: withWindow.body!.shape, plain: without.body!.shape });
  const check = (cover: string, pose: Pose) => {
    const s = shapes();
    return findInterference(kernel, [{ id: 'h', parts: [{ part: 'housing', mirrored: false, pose: at(0) }] }, { id: 'c', parts: [{ part: cover, mirrored: false, pose }] }], (k) => s[k] ?? null);
  };
  const release = (x: ReturnType<typeof check>) => x.overlaps.forEach((o) => kernel.release(o.shape));

  it('① the cover is the plate 60 × 40 × 3 less the groove (1.2 × 1.2 ring, 230.4 mm² × 1.2) and the window (3.4 × 6.4 × 3), valid', () => {
    expect(failures(withWindow)).toEqual([]);
    expect(failures(without)).toEqual([]);
    expect(kernel.massProps(without.body!.shape).volume).toBeCloseTo(60 * 40 * 3 - 230.4 * 1.2, 4);
    expect(kernel.massProps(withWindow.body!.shape).volume).toBeCloseTo(60 * 40 * 3 - 230.4 * 1.2 - 3.4 * 6.4 * 3, 4);
    expect(kernel.isValid(withWindow.body!.shape)).toBe(true);
  });

  it('② cover on the rim, 30 up: the lip is in the groove and the hook through the window — no interference; the faces that meet (the rim and the plate, the catch face and the top of the cover) are touching, not interference', () => {
    const x = check('window', at(30));
    expect(x.overlaps).toHaveLength(0);
    release(x);
  });

  it('③ without the window the beam of the hook stands in the cover: 2 × 6 × 3 = 36 mm³, one overlap, the hook\'s wedge above the cover is not in it', () => {
    const x = check('plain', at(30));
    expect(x.overlaps).toHaveLength(1);
    expect(x.overlaps[0]!.volume).toBeCloseTo(36, 4);
    release(x);
  });

  it('④ the cover set 0.5 down on the rim: it overlaps (the rim, the lip), and no overlap when it is 0.5 above it', () => {
    const down = check('window', at(29.5));
    expect(down.overlaps).toHaveLength(1);
    // the rim under the cover (its width less the groove) for 0.5, and the lip's top 0.3 in the groove's ceiling: more than the lip's 192 × 0.3 and less than the rim's whole area over 0.5
    expect(down.overlaps[0]!.volume).toBeGreaterThan(192 * 0.3);
    expect(down.overlaps[0]!.volume).toBeLessThan(2400 * 0.5);
    release(down);
    const up = check('window', at(30.5));
    expect(up.overlaps).toHaveLength(0);
    release(up);
  });

  it('⑤ the cover shifted 1 along x: the lip runs into the wall of the groove and the beam into the window\'s edge — interference', () => {
    const x = check('window', at(30, 1));
    expect(x.overlaps.length).toBeGreaterThan(0);
    release(x);
  });
});
