import { describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  AssemblyHistory,
  ASSEMBLY_SCHEMA_VERSION,
  assemblyIdsInUse,
  axisAngle,
  CommandError,
  componentPatternInstances,
  componentPatternLabels,
  componentPatternProblem,
  createEmptyAssembly,
  mirroredInside,
  mirroredPose,
  parseAssembly,
  quatFromRows,
  rotationRows,
  serializeAssembly,
  transformPoint,
  type AssemblyDoc,
  type ComponentPattern,
  type Pose,
  type Vec3,
} from '../src/index';

const at = (position: Vec3, rotation: Pose['rotation'] = [0, 0, 0, 1]): Pose => ({ position, rotation });
const X = { origin: [0, 0, 0] as Vec3, dir: [1, 0, 0] as Vec3 };
const Z = { origin: [10, 0, 0] as Vec3, dir: [0, 0, 1] as Vec3 };
const linear = (extra: Partial<ComponentPattern> = {}): ComponentPattern => ({ id: 'pattern1', name: '線性複製排列1', kind: 'linear', seed: 'c1', axis1: { kind: 'axis', axis: 'x' }, count1: 4, spacing1: '25', ...extra });
const circular = (extra: Partial<ComponentPattern> = {}): ComponentPattern => ({ id: 'pattern1', name: '環狀複製排列1', kind: 'circular', seed: 'c1', axis1: { kind: 'axis', axis: 'z' }, count1: 4, spacing1: '90', ...extra });
const close = (a: ArrayLike<number>, b: ArrayLike<number>, d = 9) => {
  for (let i = 0; i < a.length; i++) expect(a[i], `[${i}] ${Array.from(a)} vs ${Array.from(b)}`).toBeCloseTo(b[i]!, d);
};
const inst = (p: ComponentPattern, lines: Parameters<typeof componentPatternInstances>[1]) => {
  const r = componentPatternInstances(p, lines);
  if (typeof r === 'string') throw new Error(r);
  return r;
};

function doc(): AssemblyDoc {
  let d = createEmptyAssembly();
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file1', path: '銷.3dbx' }, component: { id: 'c1', file: 'file1', instance: 1, fixed: false, placement: at([5, 0, 0]) } });
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file2', path: '板.3dbx' }, component: { id: 'c2', file: 'file2', instance: 1, fixed: true, placement: at([0, 0, 0]) } });
  return d;
}

describe('linear patterns (C15.13)', () => {
  it('slides the seed 25 along the axis, one instance after another', () => {
    const r = inst(linear(), { axis1: X });
    expect(r.map((i) => i.label)).toEqual(['2', '3', '4']);
    r.forEach((i, k) => close(i.motion.position, [25 * (k + 1), 0, 0]));
    r.forEach((i) => close(i.motion.rotation, [0, 0, 0, 1]));
  });

  it('flips, skips, and makes a grid with a second direction', () => {
    expect(inst(linear({ flip1: true }), { axis1: X }).map((i) => i.motion.position[0])).toEqual([-25, -50, -75]);
    expect(inst(linear({ skip: ['3'] }), { axis1: X }).map((i) => i.label)).toEqual(['2', '4']);
    const grid = linear({ axis2: { kind: 'axis', axis: 'z' }, count2: 3, spacing2: '10' });
    expect(componentPatternLabels(grid)).toEqual(['2x1', '3x1', '4x1', '1x2', '2x2', '3x2', '4x2', '1x3', '2x3', '3x3', '4x3']);
    const r = inst({ ...grid, skip: ['2x2'] }, { axis1: X, axis2: Z });
    expect(r).toHaveLength(10);
    close(r.find((i) => i.label === '3x3')!.motion.position, [50, 0, 20]);
    close(r.find((i) => i.label === '1x2')!.motion.position, [0, 0, 10]);
  });

  it('uses any line, not only the assembly axes', () => {
    const diag = { origin: [0, 0, 0] as Vec3, dir: [0, Math.SQRT1_2, Math.SQRT1_2] as Vec3 };
    close(inst(linear({ count1: 2, spacing1: '10' }), { axis1: diag })[0]!.motion.position, [0, 10 * Math.SQRT1_2, 10 * Math.SQRT1_2]);
  });
});

describe('circular patterns (C15.13)', () => {
  it('turns the seed about the axis, so a point on it goes round', () => {
    const r = inst(circular(), { axis1: Z });
    expect(r.map((i) => i.label)).toEqual(['2', '3', '4']);
    // about the line through (10, 0, 0) along z: the point (15, 0, 0) is 5 from it
    const on = (i: number) => transformPoint(r[i]!.motion, [15, 0, 0]);
    close(on(0), [10, 5, 0]);
    close(on(1), [5, 0, 0]);
    close(on(2), [10, -5, 0]);
  });

  it('spreads equally: 360° over n, less than that over n − 1', () => {
    const full = inst(circular({ count1: 6, spacing1: '360', equal: true }), { axis1: Z });
    close(Array.from(full[0]!.motion.rotation), Array.from(axisAngle([0, 0, 1], Math.PI / 3)));
    const half = inst(circular({ count1: 3, spacing1: '180', equal: true }), { axis1: Z });
    close(Array.from(half[1]!.motion.rotation), Array.from(axisAngle([0, 0, 1], Math.PI)));
  });

  it('skips and flips', () => {
    expect(inst(circular({ skip: ['2', '4'] }), { axis1: Z }).map((i) => i.label)).toEqual(['3']);
    close(Array.from(inst(circular({ flip1: true }), { axis1: Z })[0]!.motion.rotation), Array.from(axisAngle([0, 0, 1], -Math.PI / 2)));
  });
});

describe('what a definition must be', () => {
  it('says why it cannot be used', () => {
    expect(componentPatternProblem(linear())).toBeNull();
    expect(componentPatternProblem(linear({ count1: 1 }))).toMatch(/2 以上/);
    expect(componentPatternProblem(linear({ count1: 2.5 }))).toMatch(/整數/);
    expect(componentPatternProblem(linear({ axis1: undefined }))).toMatch(/方向或旋轉軸/);
    expect(componentPatternProblem(linear({ spacing1: '0' }))).toMatch(/大於 0/);
    expect(componentPatternProblem(linear({ spacing1: '' }))).not.toBeNull();
    expect(componentPatternProblem(linear({ count1: 501 }))).toMatch(/最多 500/);
    expect(componentPatternProblem(linear({ axis2: { kind: 'axis', axis: 'z' }, count2: 200, spacing2: '1', count1: 3 }))).toMatch(/最多 500/);
    expect(componentPatternProblem(linear({ skip: ['1'] }))).toMatch(/沒有這個實例/);
    expect(componentPatternProblem(circular({ axis2: { kind: 'axis', axis: 'x' } }))).toMatch(/一個旋轉軸/);
    expect(componentPatternProblem({ id: 'p', name: 'm', kind: 'mirror', seed: 'c1' })).toMatch(/鏡射面/);
    expect(componentPatternProblem({ id: 'p', name: 'm', kind: 'mirror', seed: 'c1', plane: 'plane:right' })).toBeNull();
  });
});

describe('a mirrored component is placed by a rigid pose (C15.13)', () => {
  const reflect = (plane: 'plane:front' | 'plane:top' | 'plane:right', p: Vec3): Vec3 => (plane === 'plane:right' ? [-p[0], p[1], p[2]] : plane === 'plane:top' ? [p[0], -p[1], p[2]] : [p[0], p[1], -p[2]]);
  const poses: Pose[] = [at([0, 0, 0]), at([10, 20, 30], axisAngle([0.6, 0.8, 0], 1.1)), at([-5, 7, 2], axisAngle([0, 0, 1], 2.5)), at([1, 2, 3], [0.5, 0.5, 0.5, 0.5])];

  it('puts the part mirrored in its own x = 0 plane where the reflection of the original is, for every plane and pose', () => {
    for (const plane of ['plane:front', 'plane:top', 'plane:right'] as const) {
      for (const pose of poses) {
        const mirrored = mirroredPose(plane, pose);
        expect(Math.hypot(...mirrored.rotation)).toBeCloseTo(1, 12);
        for (const q of [[1, 2, 3], [-4, 0.5, 9], [0, 0, 0]] as Vec3[]) {
          const want = reflect(plane, transformPoint(pose, q));
          const got = transformPoint(mirrored, [-q[0], q[1], q[2]]); // the mirrored part's point
          close(got, want, 9);
        }
        // a rotation, not a reflection
        const r = rotationRows(mirrored.rotation);
        const det = r[0]! * (r[4]! * r[8]! - r[5]! * r[7]!) - r[1]! * (r[3]! * r[8]! - r[5]! * r[6]!) + r[2]! * (r[3]! * r[7]! - r[4]! * r[6]!);
        expect(det).toBeCloseTo(1, 12);
      }
    }
  });

  it('puts a part of a mirrored sub-assembly where the mirror of the whole puts it', () => {
    // a point of a part in a sub-assembly, at pose I inside it: the mirrored sub-assembly has the part mirrored, at M I M
    for (const inside of poses) {
      const m = mirroredInside(inside);
      for (const q of [[1, 2, 3], [-4, 0.5, 9]] as Vec3[]) {
        const original = transformPoint(inside, q);
        const want: Vec3 = [-original[0], original[1], original[2]];
        close(transformPoint(m, [-q[0], q[1], q[2]]), want, 9);
      }
    }
  });

  it('turns a rotation matrix into the quaternion it came from', () => {
    for (const q of [axisAngle([0, 0, 1], 3), axisAngle([1, 0, 0], 3.1), axisAngle([0, 1, 0], 3), axisAngle([0.6, 0.8, 0], 0.4), [0, 0, 0, 1], [1, 0, 0, 0]] as Pose['rotation'][]) {
      const back = quatFromRows(rotationRows(q));
      const sign = back[3] < 0 ? -1 : 1;
      close(back.map((v) => v * sign), q.map((v) => v * (q[3] < 0 ? -1 : 1)), 12);
    }
  });
});

describe('pattern commands', () => {
  it('adds, changes and deletes a pattern, one undo step each, and keeps its ids', () => {
    const h = new AssemblyHistory(doc());
    h.execute({ type: 'insertPattern', pattern: linear() });
    expect(h.doc.patterns).toHaveLength(1);
    expect(assemblyIdsInUse(h.doc)).toContain('pattern1');
    h.execute({ type: 'setPattern', pattern: linear({ count1: 6 }) });
    expect(h.doc.patterns![0]!.count1).toBe(6);
    h.execute({ type: 'deletePatterns', patternIds: ['pattern1'] });
    expect(h.doc.patterns).toBeUndefined();
    expect(h.doc.idCounters.pattern).toBe(1); // never handed out again
    h.undo();
    h.undo();
    expect(h.doc.patterns![0]!.count1).toBe(4);
    h.undo();
    expect(h.doc).toEqual(doc());
  });

  it('refuses what cannot be a pattern, and changes nothing', () => {
    const d = doc();
    expect(() => applyAssemblyCommand(d, { type: 'insertPattern', pattern: linear({ seed: 'nope' }) })).toThrow(/找不到排列的種子/);
    expect(() => applyAssemblyCommand(d, { type: 'insertPattern', pattern: linear({ name: ' ' }) })).toThrow(CommandError);
    expect(() => applyAssemblyCommand(d, { type: 'insertPattern', pattern: linear({ count1: 1 }) })).toThrow(/2 以上/);
    expect(() => applyAssemblyCommand(d, { type: 'insertPattern', pattern: linear({ axis1: { kind: 'ref', ref: { component: 'nope', ref: { kind: 'face', name: 'x' } } } }) })).toThrow(CommandError);
    expect(() => applyAssemblyCommand(d, { type: 'insertPattern', pattern: linear({ id: 'c1' }) })).toThrow(/ID 已被使用/);
    expect(() => applyAssemblyCommand(d, { type: 'setPattern', pattern: linear() })).toThrow(/找不到排列/);
    expect(() => applyAssemblyCommand(d, { type: 'deletePatterns', patternIds: ['pattern9'] })).toThrow(/找不到排列/);
    expect(d.patterns).toBeUndefined();
  });

  it('deleting the seed, or the component that gives the axis, deletes the pattern with it', () => {
    let d = applyAssemblyCommand(doc(), { type: 'insertPattern', pattern: linear() });
    d = applyAssemblyCommand(d, { type: 'insertPattern', pattern: circular({ id: 'pattern2', seed: 'c2', axis1: { kind: 'ref', ref: { component: 'c1', ref: { kind: 'edge', name: 'e' } } } }) });
    const noSeed = applyAssemblyCommand(d, { type: 'deleteComponents', componentIds: ['c1'] });
    expect(noSeed.patterns).toBeUndefined(); // pattern1 had c1 as its seed, pattern2 has c1's edge as its axis
    const other = applyAssemblyCommand(d, { type: 'deleteComponents', componentIds: ['c2'] });
    expect(other.patterns!.map((p) => p.id)).toEqual(['pattern1']);
  });

  it('writes and reads back, and a version-3 text is read unchanged', () => {
    const d = applyAssemblyCommand(applyAssemblyCommand(doc(), { type: 'insertPattern', pattern: linear({ skip: ['3'] }) }), {
      type: 'insertPattern',
      pattern: { id: 'pattern2', name: '鏡射零組件1', kind: 'mirror', seed: 'c1', plane: 'plane:right' },
    });
    expect(parseAssembly(serializeAssembly(d))).toEqual(d);
    expect(ASSEMBLY_SCHEMA_VERSION).toBe(4);
    // a file with no patterns has no such key, so a version-3 file is the same text with another version
    const plain = JSON.parse(serializeAssembly(doc()));
    expect(plain).not.toHaveProperty('patterns');
    expect(parseAssembly(JSON.stringify({ ...plain, schemaVersion: 3 }))).toEqual(doc());
    // the counters cover the ids of patterns even when a file is edited by hand
    const raw = JSON.parse(serializeAssembly(d));
    delete raw.idCounters;
    expect(parseAssembly(JSON.stringify(raw)).idCounters.pattern).toBe(2);
  });
});
