/**
 * 4a-2 (docs/phase4a-plan.md): the advanced mates (C15.9) on the faces of the golden parts, from the document to the solver: symmetric (the two pins
 * of a plate), width (a V-block centred on the plate), limits (a V-block that may stand up to 10 mm above the plate).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, createEmptyAssembly, parseAssembly, serializeAssembly, transformPoint, type AssemblyDoc, type Mate, type MateRef, type Pose, type Vec3 } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssembly } from '@3db/regen';
import { FILES, jigNames, loadGoldenParts, outermostPlane, rebuildPart, type Kind, type Rebuilt } from '../support/goldenJig';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
let rebuilt: Rebuilt;
let names: ReturnType<typeof jigNames>;
let vLeft: string;
let vRight: string;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const docs = await loadGoldenParts();
  rebuilt = { plate: rebuildPart(kernel, solver, kept, docs.plate), pin: rebuildPart(kernel, solver, kept, docs.pin), vblock: rebuildPart(kernel, solver, kept, docs.vblock) };
  names = jigNames(rebuilt);
  vLeft = outermostPlane(rebuilt.vblock.mate, [-1, 0, 0]);
  vRight = outermostPlane(rebuilt.vblock.mate, [1, 0, 0]);
});

const face = (component: string, name: string): MateRef => ({ component, ref: { kind: 'face', name } });
const datum = (component: string | null, name: 'plane:right' | 'plane:front' | 'plane:top'): MateRef => ({ component, ref: { kind: 'datum', name } });
const at = (position: Vec3): Pose => ({ position, rotation: [0, 0, 0, 1] });

const SHANK = 'revolve1:side:sketch1.l3#1';
const HOLE_LEFT = 'cut1:side:sketch2.ci6';
const FLANGE_UNDERSIDE = 'revolve1:side:sketch1.l4';
const TOP = 'extrude1:cap:end';

interface Part {
  id: string;
  kind: Kind;
  fixed: boolean;
  placement: Pose;
}

function assembly(parts: Part[], mates: Mate[]): AssemblyDoc {
  let doc = createEmptyAssembly();
  const fileIds = new Map<Kind, string>();
  const instances = new Map<Kind, number>();
  for (const p of parts) {
    if (!fileIds.has(p.kind)) fileIds.set(p.kind, `file${fileIds.size + 1}`);
    const instance = (instances.get(p.kind) ?? 0) + 1;
    instances.set(p.kind, instance);
    doc = applyAssemblyCommand(doc, {
      type: 'insertComponent',
      ...(instance === 1 ? { file: { id: fileIds.get(p.kind)!, path: FILES[p.kind] } } : {}),
      component: { id: p.id, file: fileIds.get(p.kind)!, instance, fixed: p.fixed, placement: p.placement },
    });
  }
  for (const m of mates) doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: m });
  return doc;
}

let n = 0;
const mate = (type: Mate['type'], a: MateRef, b: MateRef, extra: Partial<Mate> = {}): Mate => ({ id: `mate${++n}`, name: `結合${n}`, type, a, b, suppressed: false, ...extra });

const solve = (doc: AssemblyDoc) =>
  solveAssembly(doc, (id) => {
    const c = doc.components.find((x) => x.id === id);
    const kind = (Object.keys(FILES) as Kind[]).find((k) => FILES[k] === doc.files.find((f) => f.id === c!.file)!.path)!;
    return rebuilt[kind].mate;
  });
const position = (r: ReturnType<typeof solve>, id: string, p: Vec3 = [0, 0, 0]) => transformPoint(r.poses.get(id)!, p);
const states = (r: ReturnType<typeof solve>) => [...r.mates.values()].map((m) => m.status);

describe('symmetric: the two pins of a plate (C15.9)', () => {
  // Pin A sits in the left hole (x = −40); pin B is mated to pin A's mirror image in the plate's right plane, so it lands at x = +40.
  const doc = () =>
    assembly(
      [
        { id: 'plate', kind: 'plate', fixed: true, placement: at([0, 0, 0]) },
        { id: 'pinA', kind: 'pin', fixed: false, placement: at([-37, 4, 3]) },
        { id: 'pinB', kind: 'pin', fixed: false, placement: at([33, 6, -4]) },
      ],
      [
        mate('concentric', face('plate', HOLE_LEFT), face('pinA', SHANK), { align: 'aligned' }),
        mate('coincident', face('plate', TOP), face('pinA', FLANGE_UNDERSIDE), { align: 'antiAligned' }),
        mate('symmetric', face('pinA', SHANK), face('pinB', SHANK), { more: [datum('plate', 'plane:right')] }),
        mate('coincident', face('plate', TOP), face('pinB', FLANGE_UNDERSIDE), { align: 'antiAligned' }),
      ],
    );

  it('puts pin B on the axis that mirrors pin A\'s: at x = +40, its flange on the top', () => {
    const r = solve(doc());
    expect(states(r)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(position(r, 'pinA')[0]).toBeCloseTo(-40, 6);
    expect(position(r, 'pinB')[0]).toBeCloseTo(40, 6);
    expect(position(r, 'pinB')[2]).toBeCloseTo(0, 6);
    expect(position(r, 'pinB', [0, 15, 0])[1]).toBeCloseTo(position(r, 'pinA', [0, 15, 0])[1], 6); // both flanges on the same top
  });

  it('is written and read back as the same document (Schema 6)', () => {
    const d = doc();
    const text = serializeAssembly(d);
    expect(JSON.parse(text).schemaVersion).toBe(6);
    expect(parseAssembly(text)).toEqual(d);
  });
});

describe('width: a V-block centred on the plate (C15.9)', () => {
  const doc = (x: number) =>
    assembly(
      [
        { id: 'plate', kind: 'plate', fixed: true, placement: at([0, 0, 0]) },
        { id: 'v', kind: 'vblock', fixed: false, placement: at([x, 15, 2]) },
      ],
      [mate('width', face('plate', names.plateLeft), face('v', vLeft), { more: [face('plate', names.plateRight), face('v', vRight)] })],
    );

  it.each([17, -23, 40])('from %d mm off: the V-block\'s middle is the plate\'s (x = 0)', (x) => {
    const r = solve(doc(x));
    expect(states(r)).toEqual(['ok']);
    expect(position(r, 'v')[0]).toBeCloseTo(0, 6);
    expect(r.components.get('v')!.dof).toBe(3);
  });

  it('follows a plate that is put somewhere else', () => {
    const d = applyAssemblyCommand(doc(10), { type: 'setPlacements', placements: [{ componentId: 'plate', placement: at([60, 0, 0]) }] });
    expect(position(solve(d), 'v')[0]).toBeCloseTo(60, 6);
  });
});

describe('limits: a V-block that may stand up to 10 mm above the plate (C15.9)', () => {
  // The plate's top is y = 15, the V-block's underside y = 0 of its own: the distance is how far the block is lifted.
  const doc = (y: number, extra: Partial<Mate>) =>
    assembly(
      [
        { id: 'plate', kind: 'plate', fixed: true, placement: at([0, 0, 0]) },
        { id: 'v', kind: 'vblock', fixed: false, placement: at([0, y, 0]) },
      ],
      [mate('distance', face('plate', TOP), face('v', names.vBottom), { align: 'antiAligned', value: '5', ...extra })],
    );
  const lift = (r: ReturnType<typeof solve>) => position(r, 'v')[1] - 15;

  it('a lift of 0 to 10: 4 stays, 30 is brought down to 10, a negative one up to 0', () => {
    const limits = { min: '0', max: '10' };
    for (const [from, expected] of [[19, 4], [45, 10], [10, 0]] as const) {
      const r = solve(doc(from, limits));
      expect(states(r)).toEqual(['ok']);
      expect(lift(r)).toBeCloseTo(expected, 6);
    }
  });

  it('is refused when the value is outside its limits or the least is above the greatest', () => {
    expect(() => doc(19, { min: '6', max: '10' })).toThrow();
    expect(() => doc(19, { min: '8', max: '3', value: '5' })).toThrow();
  });
});

describe('what the document checks of the new mates', () => {
  const base = () => assembly([{ id: 'plate', kind: 'plate', fixed: true, placement: at([0, 0, 0]) }, { id: 'plate2', kind: 'plate', fixed: false, placement: at([200, 0, 0]) }, { id: 'v', kind: 'vblock', fixed: false, placement: at([0, 15, 0]) }], []);
  const insert = (m: Mate) => applyAssemblyCommand(base(), { type: 'insertMate', mate: m });

  it('a width mate has four elements, the pairs on one component each', () => {
    expect(() => insert(mate('width', face('plate', 'a'), face('v', 'b')))).toThrow(/四個元素/);
    expect(() => insert(mate('width', face('plate', 'a'), face('v', 'b'), { more: [face('v', 'c'), face('v', 'd')] }))).toThrow(/同一個零組件/);
  });
  it('a symmetric mate has its plane', () => {
    expect(() => insert(mate('symmetric', face('plate', 'a'), face('v', 'b')))).toThrow(/對稱面/);
  });
  it('only width and symmetric mates have more, only distance and angle have limits', () => {
    expect(() => insert(mate('coincident', face('plate', 'a'), face('v', 'b'), { more: [face('v', 'c')] }))).toThrow(/額外/);
    expect(() => insert(mate('coincident', face('plate', 'a'), face('v', 'b'), { min: '1' }))).toThrow(/限制/);
  });
  it('an angle limit is between 0° and 180°', () => {
    expect(() => insert(mate('angle', face('plate', 'a'), face('v', 'b'), { value: '90deg', min: '10deg', max: '200deg' }))).toThrow(/180/);
  });
  it('deleting a component takes the mates that use it as a further element', () => {
    const d = insert(mate('symmetric', face('plate', 'a'), face('plate2', 'b'), { more: [datum('v', 'plane:right')] }));
    expect(applyAssemblyCommand(d, { type: 'deleteComponents', componentIds: ['v'] }).mates).toEqual([]);
  });
});
