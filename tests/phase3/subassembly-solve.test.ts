/**
 * 3b-1b: a sub-assembly in an assembly (C15.4). It is solved on its own, then it is one rigid body above: the mates of the
 * assembly can use elements of the parts inside it by a path of component ids, and its own mates never show above.
 * The golden jig is the check: 定位組 (a plate with two pins, fully mated) used three times and mated plate to plate must
 * end exactly where the same fifteen mates put the parts in one flat assembly.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, composePose, createEmptyAssembly, leafAt, leavesOf, poseMatrix, relativePose, type AssemblyDoc, type Mate, type MateType, type Pose, type SourceTree, type Vec3 } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { faceMateGeometry, Regenerator, solveAssembly, solveAssemblyTree, solveSubAssembly, type MatePart, type MateSource } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
const rebuilt = {} as Record<'plate' | 'pin', MatePart>;
let plateNames: { right: string; left: string; back: string };

const GOLDEN = { plate: 'locating-plate.3dbx', pin: 'diamond-pin.3dbx' } as const;
const face = (name: string) => ({ kind: 'face' as const, name });
const datum = (name: 'plane:right' | 'plane:front') => ({ kind: 'datum' as const, name });
const TOP = 'extrude1:cap:end';
const HOLE_LEFT = 'cut1:side:sketch2.ci6';
const HOLE_RIGHT = 'cut1:side:sketch2.ci5';
const SHANK = 'revolve1:side:sketch1.l3#1';
const FLANGE_UNDERSIDE = 'revolve1:side:sketch1.l4';
const FLAT = 'cut1:cap:start';
const PLATE_RIGHT_SIDE = 'extrude1:side:sketch1.l4';
const PITCH = 120;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  for (const k of ['plate', 'pin'] as const) {
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${GOLDEN[k]}`, import.meta.url))))).doc;
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    const r = regen.rebuild(doc);
    const body = r.body!;
    rebuilt[k] = { topology: body.topology, names: body.names, frames: r.frames };
  }
  const outermost = (normal: Vec3): string => {
    let best: { name: string; d: number } | null = null;
    rebuilt.plate.topology.faces.forEach((f, i) => {
      const g = faceMateGeometry(f);
      if (g?.kind !== 'plane' || g.normal.some((v, k) => Math.abs(v - normal[k]!) > 1e-9)) return;
      const d = g.origin[0] * normal[0] + g.origin[1] * normal[1] + g.origin[2] * normal[2];
      if (!best || d > best.d) best = { name: rebuilt.plate.names.faces[i]!, d };
    });
    return (best as unknown as { name: string }).name;
  };
  plateNames = { right: outermost([1, 0, 0]), left: outermost([-1, 0, 0]), back: outermost([0, 0, 1]) };
});

const at = (position: Vec3, rotation: Pose['rotation'] = [0, 0, 0, 1]): Pose => ({ position, rotation });
/** Near where a user would drop a part, and not square. */
const drop = (x: number, y: number, z: number, s: number): Pose => at([x + 4 * s, y + 3 * s, z - 5 * s], [0.6 * Math.sin(0.1 + 0.025 * s), 0.8 * Math.sin(0.1 + 0.025 * s), 0, Math.cos(0.1 + 0.025 * s)]);

/** Builds an assembly of files and components by name, with mates by [component, element] pairs. */
function builder() {
  let doc = createEmptyAssembly();
  let n = 0;
  const files = new Map<string, string>();
  const instances = new Map<string, number>();
  const insert = (id: string, path: string, fixed: boolean, placement: Pose) => {
    const fresh = !files.has(path);
    if (fresh) files.set(path, `file${files.size + 1}`);
    const instance = (instances.get(path) ?? 0) + 1;
    instances.set(path, instance);
    doc = applyAssemblyCommand(doc, { type: 'insertComponent', ...(fresh ? { file: { id: files.get(path)!, path } } : {}), component: { id, file: files.get(path)!, instance, fixed, placement } });
  };
  type End = [string, ReturnType<typeof face> | ReturnType<typeof datum>] | [string, ReturnType<typeof face> | ReturnType<typeof datum>, string[]];
  const mate = (type: MateType, a: End, b: End, align?: Mate['align']) => {
    const side = (e: End) => ({ component: e[0] as string | null, ...(e[2] ? { path: e[2] } : {}), ref: e[1] });
    doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: { id: `mate${++n}`, name: `結合${n}`, type, a: side(a), b: side(b), suppressed: false, ...(align ? { align } : {}) } });
  };
  return { insert, mate, doc: () => doc };
}

/** 定位組: the plate fixed at the origin, a pin in each hole with its flange on the plate and its flat square to the side: nothing is left free. */
function pinsDoc(): AssemblyDoc {
  const b = builder();
  b.insert('p1', '定位板.3dbx', true, at([0, 0, 0]));
  b.insert('pa', '零件/削邊銷.3dbx', false, drop(-40, 30, 0, 1));
  b.insert('pb', '零件/削邊銷.3dbx', false, drop(40, 30, 0, 2));
  for (const [pin, hole] of [['pa', HOLE_LEFT], ['pb', HOLE_RIGHT]] as const) {
    b.mate('concentric', ['p1', face(hole)], [pin, face(SHANK)], 'aligned');
    b.mate('coincident', ['p1', face(TOP)], [pin, face(FLANGE_UNDERSIDE)], 'antiAligned');
    b.mate('parallel', ['p1', face(PLATE_RIGHT_SIDE)], [pin, face(FLAT)], 'aligned');
  }
  return b.doc();
}

const kindOfPath = (path: string) => (path.endsWith('定位板.3dbx') ? rebuilt.plate : rebuilt.pin);

/** The part of each component of `doc`, as the app finds them: a part file by its kind, a sub-assembly by solving its document. */
function sourceOf(doc: AssemblyDoc, subs: Record<string, AssemblyDoc>): (id: string) => MateSource | null {
  const cache = new Map<string, MateSource>();
  return (id) => {
    const c = doc.components.find((x) => x.id === id);
    const path = c && doc.files.find((f) => f.id === c.file)?.path;
    if (!path) return null;
    const sub = subs[path];
    if (!sub) return kindOfPath(path);
    if (!cache.has(path)) cache.set(path, solveSubAssembly(sub, sourceOf(sub, subs)).part);
    return cache.get(path)!;
  };
}

/** 夾具: 定位組 three times; the plates edge to edge, flush at the back and on top. */
function jigDoc(): AssemblyDoc {
  const b = builder();
  const ids = ['s0', 's1', 's2'];
  ids.forEach((id, s) => b.insert(id, '組件/定位組.3dba', s === 0, s === 0 ? at([0, 0, 0]) : drop(s * PITCH, 0, 0, s)));
  for (let s = 1; s < 3; s++) {
    const before = ids[s - 1]!;
    const cur = ids[s]!;
    b.mate('coincident', [before, face(plateNames.right), ['p1']], [cur, face(plateNames.left), ['p1']], 'antiAligned');
    b.mate('coincident', [before, face(plateNames.back), ['p1']], [cur, face(plateNames.back), ['p1']], 'aligned');
    b.mate('coincident', [before, face(TOP), ['p1']], [cur, face(TOP), ['p1']], 'aligned');
  }
  return b.doc();
}

/** The same parts and mates, flat. */
function flatDoc(): AssemblyDoc {
  const b = builder();
  const ids = ['s0', 's1', 's2'];
  ids.forEach((s, i) => {
    const x = i * PITCH;
    b.insert(`${s}.p1`, '定位板.3dbx', i === 0, i === 0 ? at([0, 0, 0]) : drop(x, 0, 0, i));
    b.insert(`${s}.pa`, '零件/削邊銷.3dbx', false, drop(x - 40, 30, 0, i + 1));
    b.insert(`${s}.pb`, '零件/削邊銷.3dbx', false, drop(x + 40, 30, 0, i + 2));
    for (const [pin, hole] of [['pa', HOLE_LEFT], ['pb', HOLE_RIGHT]] as const) {
      b.mate('concentric', [`${s}.p1`, face(hole)], [`${s}.${pin}`, face(SHANK)], 'aligned');
      b.mate('coincident', [`${s}.p1`, face(TOP)], [`${s}.${pin}`, face(FLANGE_UNDERSIDE)], 'antiAligned');
      b.mate('parallel', [`${s}.p1`, face(PLATE_RIGHT_SIDE)], [`${s}.${pin}`, face(FLAT)], 'aligned');
    }
    if (i > 0) {
      const before = ids[i - 1]!;
      b.mate('coincident', [`${before}.p1`, face(plateNames.right)], [`${s}.p1`, face(plateNames.left)], 'antiAligned');
      b.mate('coincident', [`${before}.p1`, face(plateNames.back)], [`${s}.p1`, face(plateNames.back)], 'aligned');
      b.mate('coincident', [`${before}.p1`, face(TOP)], [`${s}.p1`, face(TOP)], 'aligned');
    }
  });
  return b.doc();
}

const closeMatrix = (a: Pose, b: Pose, digits: number) => poseMatrix(a).forEach((v, i) => expect(v, `entry ${i}`).toBeCloseTo(poseMatrix(b)[i]!, digits));

describe('a sub-assembly in an assembly (3b-1b)', () => {
  it('solves on its own: every mate holds and nothing is left free', () => {
    const sub = solveSubAssembly(pinsDoc(), sourceOf(pinsDoc(), {}));
    expect([...sub.result.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
    expect(sub.result.mates.size).toBe(6);
    expect([...sub.result.components.entries()].map(([id, c]) => [id, c.status, c.dof])).toEqual([['p1', 'fixed', 0], ['pa', 'full', 0], ['pb', 'full', 0]]);
    expect([...sub.part.poses.keys()]).toEqual(['p1', 'pa', 'pb']);
  });

  it('puts every part where the same mates put it in one flat assembly (< 1e-6)', () => {
    const jig = jigDoc();
    const subs = { '組件/定位組.3dba': pinsDoc() };
    const nested = solveAssembly(jig, sourceOf(jig, subs));
    expect([...nested.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
    const flat = flatDoc();
    const solvedFlat = solveAssembly(flat, sourceOf(flat, {}));
    expect([...solvedFlat.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
    const inner = solveSubAssembly(pinsDoc(), sourceOf(pinsDoc(), {})).part;
    for (const s of ['s0', 's1', 's2']) {
      for (const leaf of ['p1', 'pa', 'pb']) {
        const world = composePose(nested.poses.get(s)!, inner.poses.get(leaf)!);
        closeMatrix(world, solvedFlat.poses.get(`${s}.${leaf}`)!, 6);
      }
    }
  });

  it('is rigid: the parts inside keep their relative poses (< 1e-9) however the assembly above moves it', () => {
    const jig = jigDoc();
    const nested = solveAssembly(jig, sourceOf(jig, { '組件/定位組.3dba': pinsDoc() }));
    const inner = solveSubAssembly(pinsDoc(), sourceOf(pinsDoc(), {})).part;
    for (const s of ['s0', 's1', 's2']) {
      for (const leaf of ['pa', 'pb']) {
        const worldPlate = composePose(nested.poses.get(s)!, inner.poses.get('p1')!);
        const worldPin = composePose(nested.poses.get(s)!, inner.poses.get(leaf)!);
        closeMatrix(relativePose(worldPlate, worldPin), relativePose(inner.poses.get('p1')!, inner.poses.get(leaf)!), 9);
      }
    }
  });

  it("keeps the sub-assembly's own mates out of the assembly above, and counts it as one body of six freedoms", () => {
    const jig = jigDoc();
    const nested = solveAssembly(jig, sourceOf(jig, { '組件/定位組.3dba': pinsDoc() }));
    expect([...nested.mates.keys()]).toEqual(jig.mates.map((m) => m.id)); // the six above, none of the six inside
    expect(nested.mates.size).toBe(6);
    expect(nested.components.get('s0')).toEqual({ status: 'fixed', dof: 0 });
    expect(nested.components.get('s1')).toEqual({ status: 'full', dof: 0 });
    // free: a floating sub-assembly with no mate has the six of any body, whatever is mated inside it
    const b = builder();
    b.insert('s0', '組件/定位組.3dba', true, at([0, 0, 0]));
    b.insert('s1', '組件/定位組.3dba', false, at([200, 0, 0]));
    const loose = b.doc();
    expect(solveAssembly(loose, sourceOf(loose, { '組件/定位組.3dba': pinsDoc() })).components.get('s1')).toEqual({ status: 'under', dof: 6 });
  });

  it('uses the sub-assembly\'s own planes and origin when a mate has no path', () => {
    const b = builder();
    b.insert('s0', '組件/定位組.3dba', false, at([30, 20, 10]));
    b.mate('coincident', ['s0', datum('plane:right')], [null as never, datum('plane:right')] as never, 'aligned');
    const doc = b.doc();
    // component null is the assembly itself: its right plane is x = 0, so the sub-assembly's own right plane is brought to it
    const solved = solveAssembly(doc, sourceOf(doc, { '組件/定位組.3dba': pinsDoc() }));
    expect(solved.mates.get('mate1')).toEqual({ status: 'ok' });
    expect(solved.poses.get('s0')!.position[0]).toBeCloseTo(0, 6);
  });

  it('says what is wrong, and never binds to another element', () => {
    const states = (a: [string, ReturnType<typeof face>, string[]?], b: [string, ReturnType<typeof face>, string[]?]) => {
      const bld = builder();
      bld.insert('s0', '組件/定位組.3dba', true, at([0, 0, 0]));
      bld.insert('s1', '組件/定位組.3dba', false, at([200, 0, 0]));
      bld.insert('pin', '零件/削邊銷.3dbx', false, at([-100, 0, 0]));
      bld.mate('coincident', [a[0], a[1], ...(a[2] ? [a[2]] : [])] as never, [b[0], b[1], ...(b[2] ? [b[2]] : [])] as never, 'aligned');
      const doc = bld.doc();
      return solveAssembly(doc, sourceOf(doc, { '組件/定位組.3dba': pinsDoc() })).mates.get('mate1');
    };
    expect(states(['s0', face(TOP), ['p1']], ['s1', face(TOP), ['p1']])).toEqual({ status: 'ok' });
    // a component that is not in the sub-assembly
    expect(states(['s0', face(TOP), ['nope']], ['s1', face(TOP), ['p1']])).toEqual({ status: 'missing', message: '第一個元素：次組合件裡找不到零組件 nope' });
    // an element that is not on the part it leads to
    expect(states(['s0', face('extrude9:cap:end'), ['p1']], ['s1', face(TOP), ['p1']])).toEqual({ status: 'missing', message: '遺失參考：第一個元素「extrude9:cap:end」找不到' });
    // a path on a part, and a face of a sub-assembly without a path
    expect(states(['pin', face(TOP), ['p1']], ['s1', face(TOP), ['p1']])).toEqual({ status: 'missing', message: '第一個元素：這個零組件是零件，不是次組合件，沒有路徑可走' });
    expect(states(['s0', face(TOP)], ['s1', face(TOP), ['p1']])).toEqual({ status: 'missing', message: '第一個元素：組合件本身只能選基準面或原點' });
  });
});

describe('trees and leaves (3b-1c): what the worker solves and the viewer draws', () => {
  const partOfKey = (key: string) => (key === 'plate' ? rebuilt.plate : key === 'pin' ? rebuilt.pin : null);
  /** The trees the store builds for 夾具: three 定位組, each with its three parts read. */
  const trees = (): Record<string, SourceTree> => {
    const sub = pinsDoc();
    const one = (): SourceTree => ({ kind: 'assembly', doc: sub, children: { p1: { kind: 'part', key: 'plate' }, pa: { kind: 'part', key: 'pin' }, pb: { kind: 'part', key: 'pin' } } });
    return { s0: one(), s1: one(), s2: one() };
  };

  it('solves as solveAssembly does with the same sources, and reports where the parts of each sub-assembly are', () => {
    const jig = jigDoc();
    const direct = solveAssembly(jig, sourceOf(jig, { '組件/定位組.3dba': pinsDoc() }));
    const viaTrees = solveAssemblyTree(jig, trees(), partOfKey);
    for (const id of ['s0', 's1', 's2']) closeMatrix(viaTrees.poses.get(id)!, direct.poses.get(id)!, 9);
    expect([...viaTrees.inner!.keys()]).toEqual(['s0', 's1', 's2']);
    expect([...viaTrees.inner!.get('s1')!.poses.keys()]).toEqual(['p1', 'pa', 'pb']);
    expect(solveAssembly(builder().doc(), () => null).inner).toBeUndefined(); // nothing to report without a sub-assembly
  });

  it("draws every part: the sub-assembly's pose carries its parts, by the poses its own mates gave them", () => {
    const jig = jigDoc();
    const solved = solveAssemblyTree(jig, trees(), partOfKey);
    const leaves = leavesOf(jig, trees(), (id) => solved.poses.get(id) ?? null, solved.inner);
    expect(leaves.map((l) => l.id)).toEqual(['s0/p1', 's0/pa', 's0/pb', 's1/p1', 's1/pa', 's1/pb', 's2/p1', 's2/pa', 's2/pb']);
    expect(leaves.map((l) => l.key)).toEqual(['plate', 'pin', 'pin', 'plate', 'pin', 'pin', 'plate', 'pin', 'pin']);
    const inner = solved.inner!.get('s2')!;
    closeMatrix(leafAt(leaves, 's2', ['pb'])!.pose, composePose(solved.poses.get('s2')!, inner.poses.get('pb')!), 12);
    // and the flat assembly puts that pin where the sub-assembly's part is drawn
    const flat = flatDoc();
    closeMatrix(leafAt(leaves, 's2', ['pb'])!.pose, solveAssembly(flat, sourceOf(flat, {})).poses.get('s2.pb')!, 6);
    expect(leafAt(leaves, 's2', ['nope'])).toBeNull();
    expect(leafAt(leaves, 's2', undefined)).toBeNull(); // the sub-assembly itself is not a part to draw
  });

  it('draws a part of the assembly itself as one leaf, and a sub-assembly not solved yet at its own placements', () => {
    const b = builder();
    b.insert('plate', '定位板.3dbx', true, at([5, 0, 0]));
    b.insert('s0', '組件/定位組.3dba', false, at([100, 0, 0]));
    const doc = b.doc();
    const some: Record<string, SourceTree> = { plate: { kind: 'part', key: 'plate' }, s0: trees().s0! };
    const leaves = leavesOf(doc, some, (id) => doc.components.find((c) => c.id === id)!.placement);
    expect(leaves.map((l) => [l.id, l.top, l.path])).toEqual([['plate', 'plate', []], ['s0/p1', 's0', ['p1']], ['s0/pa', 's0', ['pa']], ['s0/pb', 's0', ['pb']]]);
    // unsolved: a part of the sub-assembly is where the sub-assembly's own document placed it, carried by the sub-assembly's pose
    const own = pinsDoc().components.find((c) => c.id === 'pa')!.placement;
    closeMatrix(leaves[2]!.pose, composePose(at([100, 0, 0]), own), 12);
    // a component whose file has not been read has no tree and no leaf; a suppressed one is left out
    expect(leavesOf(doc, { plate: some.plate! }, (id) => doc.components.find((c) => c.id === id)!.placement).map((l) => l.id)).toEqual(['plate']);
    const suppressed = { ...doc, components: doc.components.map((c) => (c.id === 's0' ? { ...c, suppressed: true } : c)) };
    expect(leavesOf(suppressed, some, (id) => doc.components.find((c) => c.id === id)!.placement).map((l) => l.id)).toEqual(['plate']);
  });
});

describe('hide, suppress and make transparent (3b-1d, C15.5)', () => {
  const partOfKey = (key: string) => (key === 'plate' ? rebuilt.plate : key === 'pin' ? rebuilt.pin : null);
  const flagged = (doc: AssemblyDoc, id: string, flags: Partial<Pick<AssemblyDoc['components'][number], 'hidden' | 'suppressed' | 'transparent'>>): AssemblyDoc => ({
    ...doc,
    components: doc.components.map((c) => (c.id === id ? { ...c, ...flags } : c)),
  });

  it('a suppressed component is not solved, its mates are suppressed, and the others come out as they did', () => {
    const doc = pinsDoc();
    const base = solveAssembly(doc, sourceOf(doc, {}));
    const off = flagged(doc, 'pb', { suppressed: true });
    const solved = solveAssembly(off, sourceOf(off, {}));
    expect([...solved.poses.keys()]).toEqual(['p1', 'pa']); // no pose for what is left out
    expect(solved.components.has('pb')).toBe(false);
    // pb's three mates are the last three: suppressed with it, the first three still hold
    expect([...solved.mates.values()].map((m) => m.status)).toEqual(['ok', 'ok', 'ok', 'suppressed', 'suppressed', 'suppressed']);
    closeMatrix(solved.poses.get('pa')!, base.poses.get('pa')!, 9);
    // nobody asked for its part
    const asked: string[] = [];
    solveAssembly(off, (id) => {
      asked.push(id);
      return sourceOf(off, {})(id);
    });
    expect(asked).toEqual(['p1', 'pa']);
  });

  it('a mate that goes through a suppressed component of a sub-assembly is suppressed, not missing', () => {
    const inner = flagged(pinsDoc(), 'pa', { suppressed: true });
    const jig = jigDoc();
    const withPin = applyAssemblyCommand(jig, {
      type: 'insertMate',
      mate: { id: 'mateX', name: '重合X', type: 'coincident', a: { component: 's0', path: ['pa'], ref: face(FLANGE_UNDERSIDE) }, b: { component: 's1', path: ['pb'], ref: face(FLANGE_UNDERSIDE) }, align: 'aligned', suppressed: false },
    });
    const solved = solveAssembly(withPin, sourceOf(withPin, { '組件/定位組.3dba': inner }));
    expect(solved.mates.get('mateX')).toEqual({ status: 'suppressed' });
    // the plate-to-plate mates above it still hold, and the sub-assembly is rigid without the pin
    expect([...solved.mates.entries()].filter(([id]) => id !== 'mateX').every(([, m]) => m.status === 'ok')).toBe(true);
    const part = solveSubAssembly(inner, sourceOf(inner, {})).part;
    expect([...part.leftOut]).toEqual(['pa']);
    expect([...part.parts.keys()]).toEqual(['p1', 'pb']);
  });

  it('a suppressed sub-assembly takes all of its parts with it', () => {
    const jig = flagged(jigDoc(), 's1', { suppressed: true });
    const solved = solveAssemblyTree(jig, trees(), partOfKey);
    expect([...solved.poses.keys()]).toEqual(['s0', 's2']);
    expect([...solved.inner!.keys()]).toEqual(['s0', 's2']);
    // the mates of s1 (s0—s1 and s1—s2) are suppressed; the s2 ones have no other component to hold to
    expect([...solved.mates.values()].every((m) => m.status === 'suppressed')).toBe(true);
    const leaves = leavesOf(jig, trees(), (id) => solved.poses.get(id) ?? null, solved.inner);
    expect(leaves.map((l) => l.top)).toEqual(['s0', 's0', 's0', 's2', 's2', 's2']);
  });

  function trees(): Record<string, SourceTree> {
    const sub = pinsDoc();
    const one = (): SourceTree => ({ kind: 'assembly', doc: sub, children: { p1: { kind: 'part', key: 'plate' }, pa: { kind: 'part', key: 'pin' }, pb: { kind: 'part', key: 'pin' } } });
    return { s0: one(), s1: one(), s2: one() };
  }

  it('hidden and transparent reach every part of the component, and what a sub-assembly holds adds its own', () => {
    const jig = flagged(flagged(jigDoc(), 's1', { hidden: true }), 's2', { transparent: true });
    const solved = solveAssemblyTree(jig, trees(), partOfKey);
    expect(solved.poses.has('s1')).toBe(true); // hidden is still solved
    const leaves = leavesOf(jig, trees(), (id) => solved.poses.get(id) ?? null, solved.inner);
    const of = (top: string) => leaves.filter((l) => l.top === top).map((l) => [l.hidden, l.transparent]);
    expect(of('s0')).toEqual([[false, false], [false, false], [false, false]]);
    expect(of('s1')).toEqual([[true, false], [true, false], [true, false]]);
    expect(of('s2')).toEqual([[false, true], [false, true], [false, true]]);
    // a hidden part inside the sub-assembly hides that part only
    const t = trees();
    t.s0 = { kind: 'assembly', doc: flagged(pinsDoc(), 'pa', { hidden: true }), children: (t.s0 as { children: Record<string, SourceTree> }).children };
    const inside = leavesOf(jig, t, (id) => solved.poses.get(id) ?? null, solved.inner).filter((l) => l.top === 's0');
    expect(inside.map((l) => [l.id, l.hidden])).toEqual([['s0/p1', false], ['s0/pa', true], ['s0/pb', false]]);
  });
});