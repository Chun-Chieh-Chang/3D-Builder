import { describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  ASSEMBLY_SCHEMA_VERSION,
  AssemblyHistory,
  assemblyIdsInUse,
  ASSEMBLY_AXES,
  CommandError,
  createEmptyAssembly,
  explodeLeaves,
  explodeStepProblem,
  explosionOffsets,
  leavesOf,
  parseAssembly,
  patternLeavesOf,
  serializeAssembly,
  type AssemblyDoc,
  type ExplodeStep,
  type PatternAxis,
  type PatternLine,
  type Pose,
  type SourceTree,
  type Vec3,
} from '../src/index';

const at = (position: Vec3): Pose => ({ position, rotation: [0, 0, 0, 1] });
const step = (extra: Partial<ExplodeStep> = {}): ExplodeStep => ({ id: 'explode1', name: '爆炸步驟1', components: ['c1'], axis: { kind: 'axis', axis: 'z' }, distance: '40', ...extra });
const axisOf = (a: PatternAxis): PatternLine | null => (a.kind === 'axis' ? ASSEMBLY_AXES[a.axis] : null);

/** 板 fixed, 銷 and 定位組 (a sub-assembly) above it. */
function doc(): AssemblyDoc {
  let d = createEmptyAssembly();
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file1', path: '板.3dbx' }, component: { id: 'c0', file: 'file1', instance: 1, fixed: true, placement: at([0, 0, 0]) } });
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file2', path: '銷.3dbx' }, component: { id: 'c1', file: 'file2', instance: 1, fixed: false, placement: at([10, 0, 5]) } });
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file3', path: '組件/定位組.3dba' }, component: { id: 'c2', file: 'file3', instance: 1, fixed: false, placement: at([0, 30, 5]) } });
  return d;
}

describe('where the steps move the components (C15.14)', () => {
  it('moves a component by the distance along the axis, and the others not at all', () => {
    const d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step() });
    const { offsets, problems } = explosionOffsets(d, axisOf);
    expect(problems.size).toBe(0);
    expect([...offsets]).toEqual([['c1', [0, 0, 40]]]);
  });

  it('adds the steps that name a component, each along its own direction, and flips', () => {
    let d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step() });
    d = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step({ id: 'explode2', components: ['c1', 'c2'], axis: { kind: 'axis', axis: 'x' }, distance: '25', flip: true }) });
    const { offsets } = explosionOffsets(d, axisOf);
    expect(offsets.get('c1')).toEqual([-25, 0, 40]);
    expect(offsets.get('c2')).toEqual([-25, 0, 0]);
    expect(offsets.has('c0')).toBe(false);
  });

  it('follows any line, scaled by its length being one', () => {
    const d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step({ distance: '10 * 2' }) });
    const slanted = explosionOffsets(d, () => ({ origin: [0, 0, 0], dir: [0, 3, 4] })).offsets.get('c1')!; // not a unit direction: the distance is still 20
    expect(Math.hypot(...slanted)).toBeCloseTo(20, 12);
    expect(slanted[1]! / slanted[2]!).toBeCloseTo(0.75, 12);
  });

  it('reports a step whose axis is gone, and moves nothing for it; a suppressed component is not moved', () => {
    let d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step() });
    expect(explosionOffsets(d, () => null)).toEqual({ offsets: new Map(), problems: new Map([['explode1', expect.stringMatching(/找不到爆炸的方向/)]]) });
    d = applyAssemblyCommand(d, { type: 'setComponentState', componentIds: ['c1'], state: 'suppressed', value: true });
    expect(explosionOffsets(d, axisOf).offsets.size).toBe(0);
  });

  it('does not touch the document: the poses are the same bytes before and after', () => {
    const d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step() });
    const before = serializeAssembly(d);
    explosionOffsets(d, axisOf);
    expect(serializeAssembly(d)).toBe(before);
    expect(d.components.map((c) => c.placement.position)).toEqual([[0, 0, 0], [10, 0, 5], [0, 30, 5]]);
  });
});

describe('the leaves of the exploded view', () => {
  const trees = (): Record<string, SourceTree> => ({
    c0: { kind: 'part', key: 'plate' },
    c1: { kind: 'part', key: 'pin' },
    c2: { kind: 'assembly', doc: createEmptyAssembly(), children: {} },
  });

  it('moves a component with its parts and the instances of its patterns, rigidly; what no step names stays', () => {
    let d = applyAssemblyCommand(doc(), { type: 'insertPattern', pattern: { id: 'pattern1', name: '線性複製排列1', kind: 'linear', seed: 'c1', axis1: { kind: 'axis', axis: 'x' }, count1: 3, spacing1: '20' } });
    d = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step() });
    const base = leavesOf(d, trees(), (id) => d.components.find((c) => c.id === id)!.placement);
    const withInstances = [...base, ...patternLeavesOf(d, base, axisOf).leaves];
    const { offsets } = explosionOffsets(d, axisOf);
    const exploded = explodeLeaves(withInstances, offsets);
    expect(exploded.map((l) => [l.id, l.pose.position])).toEqual([
      ['c0', [0, 0, 0]],
      ['c1', [10, 0, 45]],
      ['c1@pattern1#2', [30, 0, 45]],
      ['c1@pattern1#3', [50, 0, 45]],
    ]);
    // collapsed: nothing moved, and the input leaves were not changed
    expect(withInstances.map((l) => l.pose.position)).toEqual([[0, 0, 0], [10, 0, 5], [30, 0, 5], [50, 0, 5]]);
    expect(explodeLeaves(withInstances, new Map())).toEqual(withInstances);
  });
});

describe('explode step commands', () => {
  it('adds, changes, reorders and deletes steps, one undo step each, and keeps their ids', () => {
    const h = new AssemblyHistory(doc());
    h.execute({ type: 'insertExplodeStep', step: step() });
    h.execute({ type: 'insertExplodeStep', step: step({ id: 'explode2', components: ['c2'] }) });
    expect(assemblyIdsInUse(h.doc)).toEqual(expect.arrayContaining(['explode1', 'explode2']));
    h.execute({ type: 'setExplodeStep', step: step({ distance: '60' }) });
    expect(h.doc.explosion![0]!.distance).toBe('60');
    h.execute({ type: 'moveExplodeStep', stepId: 'explode2', to: 0 });
    expect(h.doc.explosion!.map((s) => s.id)).toEqual(['explode2', 'explode1']);
    h.execute({ type: 'deleteExplodeSteps', stepIds: ['explode1', 'explode2'] });
    expect(h.doc.explosion).toBeUndefined();
    expect(h.doc.idCounters.explode).toBe(2);
    for (let i = 0; i < 5; i++) h.undo();
    expect(h.doc).toEqual(doc());
  });

  it('refuses what cannot be a step, and changes nothing', () => {
    const d = doc();
    const insert = (s: ExplodeStep) => () => applyAssemblyCommand(d, { type: 'insertExplodeStep', step: s });
    expect(insert(step({ components: [] }))).toThrow(/選擇要移動的零組件/);
    expect(insert(step({ components: ['nope'] }))).toThrow(/找不到零組件/);
    expect(insert(step({ distance: '0' }))).toThrow(/大於 0/);
    expect(insert(step({ distance: '-5' }))).toThrow(/大於 0/);
    expect(insert(step({ distance: 'abc' }))).toThrow(CommandError);
    expect(insert(step({ name: ' ' }))).toThrow(/名稱不可空白/);
    expect(insert(step({ axis: { kind: 'ref', ref: { component: 'nope', ref: { kind: 'edge', name: 'e' } } } }))).toThrow(/方向/);
    expect(insert(step({ id: 'c1' }))).toThrow(/ID 已被使用/);
    expect(() => applyAssemblyCommand(d, { type: 'setExplodeStep', step: step() })).toThrow(/找不到爆炸步驟/);
    expect(() => applyAssemblyCommand(d, { type: 'deleteExplodeSteps', stepIds: ['x'] })).toThrow(/找不到爆炸步驟/);
    expect(d.explosion).toBeUndefined();
    const one = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step() });
    expect(() => applyAssemblyCommand(one, { type: 'moveExplodeStep', stepId: 'explode1', to: 3 })).toThrow(/位置無效/);
    expect(explodeStepProblem(step(), d)).toBeNull();
  });

  it('deleting a component takes it out of the steps; a step left with nothing, or whose axis is an element of it, goes', () => {
    let d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step({ components: ['c1', 'c2'] }) });
    d = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step({ id: 'explode2', components: ['c2'], axis: { kind: 'ref', ref: { component: 'c1', ref: { kind: 'edge', name: 'e' } } } }) });
    d = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step({ id: 'explode3', components: ['c1'] }) });
    const gone = applyAssemblyCommand(d, { type: 'deleteComponents', componentIds: ['c1'] });
    expect(gone.explosion!.map((s) => [s.id, s.components])).toEqual([['explode1', ['c2']]]); // explode2's axis was c1's, explode3 moved only c1
    expect(gone.idCounters.explode).toBe(3);
  });

  it('writes and reads back; a version-4 text is read unchanged; the counters cover the steps', () => {
    const d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step({ flip: true }) });
    expect(parseAssembly(serializeAssembly(d))).toEqual(d);
    expect(ASSEMBLY_SCHEMA_VERSION).toBe(5);
    const plain = JSON.parse(serializeAssembly(doc()));
    expect(plain).not.toHaveProperty('explosion');
    expect(parseAssembly(JSON.stringify({ ...plain, schemaVersion: 4 }))).toEqual(doc());
    const raw = JSON.parse(serializeAssembly(d));
    delete raw.idCounters;
    expect(parseAssembly(JSON.stringify(raw)).idCounters.explode).toBe(1);
  });
});
