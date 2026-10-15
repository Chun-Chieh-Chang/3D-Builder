/**
 * Mates on a component's own origin and planes, picked in the assembly's FeatureManager (ADR 0144): the golden plate is fixed at a
 * pose that is neither at the origin nor square to it, the pin floats from a tilted start, and each mate is checked on where the
 * solver really puts the pin — the planes' origins and normals carried out by the solved poses — never on a pose written in the test.
 * Also: the command layer refuses elements a mate cannot have, and the worker's list of a part's features is the part's own.
 */
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  axisAngle,
  CommandError,
  createEmptyAssembly,
  DATUM_PLANES,
  transformPoint,
  type AssemblyDoc,
  type DatumPlaneName,
  type Mate,
  type MateRef,
  type MateType,
  type PartDoc,
  type Pose,
  type Vec3,
} from '@3db/model';
import { readDocumentFile, readPartFile, writeAssemblyFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssembly, type MatePart } from '@3db/regen';
import { partFeatures } from '../../apps/web/src/worker/partOutline';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let plateDoc: PartDoc;
let pinDoc: PartDoc;
let plate: MatePart;
let pin: MatePart;

function part(doc: PartDoc): MatePart {
  const r = new Regenerator(kernel, solver).rebuild(doc);
  return { topology: r.body!.topology, names: r.body!.names, frames: r.frames };
}

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const read = async (name: string) => (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${name}`, import.meta.url))))).doc;
  plateDoc = await read('locating-plate.3dbx');
  pinDoc = await read('diamond-pin.3dbx');
  plate = part(plateDoc);
  pin = part(pinDoc);
});

/** The plate, fixed off the origin and turned; the pin, floating, tilted and away from it. */
const PLATE_AT: Pose = { position: [12, -7, 4], rotation: axisAngle([0.36, 0.48, 0.8], 0.5) };
const PIN_AT: Pose = { position: [-30, 40, 12], rotation: axisAngle([0.6, 0, 0.8], 0.4) };
const datum = (component: string | null, name: string): MateRef => ({ component, ref: { kind: 'datum', name } });
let ids = 0;
const mate = (type: MateType, a: MateRef, b: MateRef, extra: Partial<Mate> = {}): Mate => ({ id: `m${++ids}`, name: `結合${ids}`, type, a, b, suppressed: false, ...extra });

function jig(mates: Mate[]): AssemblyDoc {
  let doc = applyAssemblyCommand(createEmptyAssembly(), { type: 'insertComponent', file: { id: 'f1', path: '定位板.3dbx' }, component: { id: 'plate', file: 'f1', instance: 1, fixed: true, placement: PLATE_AT } });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'f2', path: '削邊銷.3dbx' }, component: { id: 'pin', file: 'f2', instance: 1, fixed: false, placement: PIN_AT } });
  for (const m of mates) doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: m });
  return doc;
}
const solve = (doc: AssemblyDoc) => solveAssembly(doc, (id) => (id === 'plate' ? plate : id === 'pin' ? pin : null));

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A plane of a part (its origin and normal, in the part) where a pose puts it in the assembly. */
function placedPlane(pose: Pose, origin: Vec3, normal: Vec3): { o: Vec3; n: Vec3 } {
  const o = transformPoint(pose, origin);
  return { o, n: sub(transformPoint(pose, [origin[0] + normal[0], origin[1] + normal[1], origin[2] + normal[2]]), o) };
}
const defaultPlane = (pose: Pose, name: DatumPlaneName) => placedPlane(pose, DATUM_PLANES[name].origin, DATUM_PLANES[name].normal);
const near = (a: Vec3, b: Vec3, what: string, digits = 6) => a.forEach((v, i) => expect(v, `${what}: ${a} vs ${b}`).toBeCloseTo(b[i]!, digits));
const allOk = (r: ReturnType<typeof solve>) => expect([...r.mates.values()].map((m) => m.status)).toEqual([...r.mates.values()].map(() => 'ok'));

describe('mates on the planes and origin of a component (ADR 0144)', () => {
  it('the start does not satisfy any of them: what follows is the solver\'s doing', () => {
    const r = solve(jig([]));
    const pl = defaultPlane(PLATE_AT, 'plane:front');
    const pn = defaultPlane(r.poses.get('pin')!, 'plane:front');
    expect(Math.abs(Math.abs(dot(pl.n, pn.n)) - 1)).toBeGreaterThan(1e-2); // not parallel
    expect(Math.abs(dot(defaultPlane(PLATE_AT, 'plane:top').n, defaultPlane(r.poses.get('pin')!, 'plane:right').n))).toBeGreaterThan(1e-2); // not square
    expect(Math.hypot(...sub(r.poses.get('pin')!.position, PLATE_AT.position))).toBeGreaterThan(10); // origins apart
  });

  it('重合: the pin\'s front plane on the plate\'s, with or against its normal', () => {
    for (const align of ['aligned', 'antiAligned'] as const) {
      const r = solve(jig([mate('coincident', datum('plate', 'plane:front'), datum('pin', 'plane:front'), { align })]));
      allOk(r);
      const pl = defaultPlane(PLATE_AT, 'plane:front');
      const pn = defaultPlane(r.poses.get('pin')!, 'plane:front');
      near(pn.n, align === 'aligned' ? pl.n : (pl.n.map((v) => -v) as Vec3), `${align} normal`);
      expect(dot(sub(pn.o, pl.o), pl.n), `${align}: the pin's front plane lies in the plate's`).toBeCloseTo(0, 6);
      expect(r.components.get('pin')).toEqual({ status: 'under', dof: 3 });
    }
  });

  it('平行: the pin\'s top plane parallel to the plate\'s, wherever it is along it', () => {
    const r = solve(jig([mate('parallel', datum('plate', 'plane:top'), datum('pin', 'plane:top'), { align: 'aligned' })]));
    allOk(r);
    near(defaultPlane(r.poses.get('pin')!, 'plane:top').n, defaultPlane(PLATE_AT, 'plane:top').n, 'normals');
    expect(r.components.get('pin')).toEqual({ status: 'under', dof: 4 });
  });

  it('垂直: the pin\'s right plane square to the plate\'s top plane', () => {
    const r = solve(jig([mate('perpendicular', datum('plate', 'plane:top'), datum('pin', 'plane:right'))]));
    allOk(r);
    expect(dot(defaultPlane(r.poses.get('pin')!, 'plane:right').n, defaultPlane(PLATE_AT, 'plane:top').n)).toBeCloseTo(0, 6);
    expect(r.components.get('pin')).toEqual({ status: 'under', dof: 5 });
  });

  it('距離: the pin\'s front plane 25 mm from the plate\'s, on the side 反轉尺寸 says', () => {
    const pl = defaultPlane(PLATE_AT, 'plane:front');
    const gaps = [false, true].map((flip) => {
      const r = solve(jig([mate('distance', datum('plate', 'plane:front'), datum('pin', 'plane:front'), { value: '25', align: 'aligned', ...(flip ? { flip } : {}) })]));
      allOk(r);
      const pn = defaultPlane(r.poses.get('pin')!, 'plane:front');
      near(pn.n, pl.n, `flip ${flip}: normals`);
      return dot(sub(pn.o, pl.o), pl.n);
    });
    for (const g of gaps) expect(Math.abs(g)).toBeCloseTo(25, 6);
    expect(Math.sign(gaps[0]!)).toBe(-Math.sign(gaps[1]!)); // the other side of the plate's front plane
  });

  it('原點 on 原點, and the part\'s own reference plane on the plate\'s right plane', () => {
    const r = solve(jig([mate('coincident', datum('plate', 'origin'), datum('pin', 'origin'))]));
    allOk(r);
    near(transformPoint(r.poses.get('pin')!, [0, 0, 0]), transformPoint(PLATE_AT, [0, 0, 0]), 'origins');
    expect(r.components.get('pin')).toEqual({ status: 'under', dof: 3 });

    // 基準面1 of the pin: 3 mm off its right plane (a feature of the part, named by its id)
    const ref = pinDoc.features.find((f) => f.type === 'refPlane' && f.name === '基準面1')!;
    const frame = pin.frames.get(ref.id)!;
    expect(frame.origin[0]).toBeCloseTo(3, 9);
    const r2 = solve(jig([mate('coincident', datum('plate', 'plane:right'), datum('pin', ref.id), { align: 'aligned' })]));
    allOk(r2);
    const pr = defaultPlane(PLATE_AT, 'plane:right');
    const p1 = placedPlane(r2.poses.get('pin')!, frame.origin, frame.normal);
    near(p1.n, pr.n, 'normals');
    expect(dot(sub(p1.o, pr.o), pr.n)).toBeCloseTo(0, 6);
    // the pin's own right plane is then 3 mm behind the plate's: the offset of its reference plane, measured
    expect(dot(sub(defaultPlane(r2.poses.get('pin')!, 'plane:right').o, pr.o), pr.n)).toBeCloseTo(-3, 6);
  });

  it('three planes on three planes: fully defined, and the pin is where the plate is', () => {
    const three = (['plane:front', 'plane:top', 'plane:right'] as const).map((p) => mate('coincident', datum('plate', p), datum('pin', p), { align: 'aligned' }));
    const r = solve(jig(three));
    allOk(r);
    expect(r.components.get('pin')).toEqual({ status: 'full', dof: 0 });
    for (const p of [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]] as Vec3[]) near(transformPoint(r.poses.get('pin')!, p), transformPoint(PLATE_AT, p), `point ${p}`);
  });

  it('a component\'s plane to the assembly\'s own: the pin\'s top plane on the assembly\'s top plane', () => {
    const r = solve(jig([mate('coincident', datum(null, 'plane:top'), datum('pin', 'plane:top'), { align: 'aligned' })]));
    allOk(r);
    const pn = defaultPlane(r.poses.get('pin')!, 'plane:top');
    near(pn.n, DATUM_PLANES['plane:top'].normal, 'normal');
    expect(dot(pn.o, DATUM_PLANES['plane:top'].normal)).toBeCloseTo(0, 6);
  });

  it('is saved with the assembly and solves the same after reopening', async () => {
    const doc = jig((['plane:front', 'plane:top', 'plane:right'] as const).map((p) => mate('coincident', datum('plate', p), datum('pin', p), { align: 'aligned' })));
    const file = await readDocumentFile(await writeAssemblyFile(doc));
    expect(file.kind).toBe('assembly');
    if (file.kind !== 'assembly') return;
    expect(file.doc).toEqual(doc);
    expect(solve(file.doc).poses.get('pin')).toEqual(solve(doc).poses.get('pin'));
  });
});

describe('the command layer refuses what a mate cannot be made of', () => {
  const good = () => mate('coincident', datum('plate', 'plane:front'), datum('pin', 'plane:front'), { align: 'aligned' });
  it('takes a component\'s origin, default planes and reference planes', () => {
    for (const name of ['origin', 'plane:front', 'plane:top', 'plane:right', 'plane1']) expect(jig([{ ...good(), b: datum('pin', name) }]).mates).toHaveLength(1);
  });

  it('refuses a body, an unknown kind, a default plane there is not, and an empty name; the document is left as it was', () => {
    const doc = jig([]);
    const before = JSON.stringify(doc);
    const bad: [string, MateRef, RegExp][] = [
      ['a body', { component: 'pin', ref: { kind: 'body', name: 'body:extrude1' } }, /不能是「body」/],
      ['an unknown kind', { component: 'pin', ref: { kind: 'axis' as 'face', name: 'axis1' } }, /不能是「axis」/],
      ['plane:back of a component', datum('pin', 'plane:back'), /沒有這個預設基準面：「plane:back」/],
      ['plane:back of the assembly', datum(null, 'plane:back'), /組合件本身只能選基準面或原點/],
      ['a face of the assembly', { component: null, ref: { kind: 'face', name: 'x' } }, /組合件本身只能選基準面或原點/],
      ['an empty name', datum('pin', ''), /請選擇兩個要結合的元素/],
      ['a component that is not there', datum('nope', 'plane:front'), /找不到零組件：nope/],
    ];
    for (const [what, b, message] of bad) {
      expect(() => applyAssemblyCommand(doc, { type: 'insertMate', mate: { ...good(), b } }), what).toThrow(CommandError);
      expect(() => applyAssemblyCommand(doc, { type: 'insertMate', mate: { ...good(), b } }), what).toThrow(message);
    }
    // editing a mate goes through the same checks
    const withOne = applyAssemblyCommand(doc, { type: 'insertMate', mate: good() });
    expect(() => applyAssemblyCommand(withOne, { type: 'setMate', mate: { ...withOne.mates[0]!, a: datum('plate', 'plane:back') } })).toThrow(/plane:back/);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('the features a component lists under it (the worker\'s partFeatures)', () => {
  it('are the part\'s own, in history order, each with its status', () => {
    const rebuilt = new Regenerator(kernel, solver).rebuild(pinDoc);
    const list = partFeatures(pinDoc, rebuilt);
    expect(list.map((f) => [f.id, f.name, f.type])).toEqual(pinDoc.features.map((f) => [f.id, f.name, f.type]));
    expect(list.every((f) => f.status === 'ok')).toBe(true);
  });

  it('says which are suppressed and which fail', () => {
    // 基準面2 made on a face the part does not have: it fails, and what is built on it with it
    const broken = produce(pinDoc, (d) => {
      const p2 = d.features.find((f) => f.id === 'plane2')!;
      if (p2.type !== 'refPlane' || p2.def.mode !== 'offset') throw new Error('the golden pin changed');
      p2.def.plane = { kind: 'face', name: 'nothing:here' };
      d.features.find((f) => f.id === 'chamfer1')!.suppressed = true;
    });
    const rebuilt = new Regenerator(kernel, solver).rebuild(broken);
    const status = new Map(partFeatures(broken, rebuilt).map((f) => [f.id, f.status]));
    expect(status.get('plane2')).toBe('error');
    expect(status.get('chamfer1')).toBe('suppressed');
    expect(status.get('plane1')).toBe('ok');
    expect(status.get('revolve1')).toBe('ok');
    // what the regenerator says, feature by feature: the list adds nothing of its own
    for (const f of rebuilt.features) expect(status.get(f.id), f.id).toBe(f.status === 'error' ? 'error' : f.status === 'suppressed' ? 'suppressed' : 'ok');
  });
});
