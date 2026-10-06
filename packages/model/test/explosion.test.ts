import { describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  ASSEMBLY_SCHEMA_VERSION,
  AssemblyHistory,
  assemblyIdsInUse,
  ASSEMBLY_AXES,
  CommandError,
  createEmptyAssembly,
  activeExplosion,
  explodeLeaves,
  explosionSteps,
  leavesCentre,
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
    expect(explosionOffsets(d, () => null)).toEqual({ offsets: new Map(), paths: new Map(), problems: new Map([['explode1', expect.stringMatching(/找不到爆炸的方向/)]]) });
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
    expect(assemblyIdsInUse(h.doc)).toEqual(expect.arrayContaining(['explosion1', 'explode1', 'explode2']));
    h.execute({ type: 'setExplodeStep', step: step({ distance: '60' }) });
    expect(h.doc.explosions![0]!.steps[0]!.distance).toBe('60');
    h.execute({ type: 'moveExplodeStep', stepId: 'explode2', to: 0 });
    expect(h.doc.explosions![0]!.steps.map((s) => s.id)).toEqual(['explode2', 'explode1']);
    h.execute({ type: 'deleteExplodeSteps', stepIds: ['explode1', 'explode2'] });
    expect(h.doc.explosions![0]!.steps).toEqual([]); // the view stays, empty
    expect(h.doc.idCounters.explode).toBe(2);
    expect(h.doc.idCounters.explosion).toBe(1);
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
    expect(d.explosions).toBeUndefined();
    const one = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step() });
    expect(() => applyAssemblyCommand(one, { type: 'moveExplodeStep', stepId: 'explode1', to: 3 })).toThrow(/位置無效/);
    expect(explodeStepProblem(step(), d)).toBeNull();
  });

  it('deleting a component takes it out of the steps; a step left with nothing, or whose axis is an element of it, goes', () => {
    let d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step({ components: ['c1', 'c2'] }) });
    d = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step({ id: 'explode2', components: ['c2'], axis: { kind: 'ref', ref: { component: 'c1', ref: { kind: 'edge', name: 'e' } } } }) });
    d = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step({ id: 'explode3', components: ['c1'] }) });
    const gone = applyAssemblyCommand(d, { type: 'deleteComponents', componentIds: ['c1'] });
    expect(gone.explosions![0]!.steps.map((s) => [s.id, s.components])).toEqual([['explode1', ['c2']]]); // explode2's axis was c1's, explode3 moved only c1
    expect(gone.idCounters.explode).toBe(3);
  });

  it('writes and reads back; a version-4 text is read unchanged; the counters cover the steps', () => {
    const d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step({ flip: true }) });
    expect(parseAssembly(serializeAssembly(d))).toEqual(d);
    expect(ASSEMBLY_SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
    const plain = JSON.parse(serializeAssembly(doc()));
    expect(plain).not.toHaveProperty('explosions');
    expect(parseAssembly(JSON.stringify({ ...plain, schemaVersion: 4 }))).toEqual(doc());
    const raw = JSON.parse(serializeAssembly(d));
    delete raw.idCounters;
    expect(parseAssembly(JSON.stringify(raw)).idCounters.explode).toBe(1);
  });
});

describe('the way each component goes (explode lines) and how far along it is (animation)', () => {
  const trees = (): Record<string, SourceTree> => ({ c0: { kind: 'part', key: 'plate' }, c1: { kind: 'part', key: 'pin' }, c2: { kind: 'assembly', doc: createEmptyAssembly(), children: {} } });
  const two = (): AssemblyDoc => {
    let d = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step({ distance: '50' }) });
    d = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step({ id: 'explode2', components: ['c1', 'c2'], axis: { kind: 'axis', axis: 'x' }, distance: '30' }) });
    return d;
  };

  it('is the sum so far after each step that names the component: 50 along z, then 30 along x is (0,0,50) then (30,0,50); the last is its offset', () => {
    const { offsets, paths } = explosionOffsets(two(), axisOf);
    expect(paths.get('c1')).toEqual([[0, 0, 50], [30, 0, 50]]);
    expect(paths.get('c2')).toEqual([[30, 0, 0]]);
    expect(paths.has('c0')).toBe(false);
    for (const [id, way] of paths) expect(way.at(-1)).toEqual(offsets.get(id));
  });

  it('leaves out a step whose direction is gone, as the offsets do', () => {
    const d = applyAssemblyCommand(two(), { type: 'insertExplodeStep', step: step({ id: 'explode3', components: ['c1'], axis: { kind: 'ref', ref: { component: 'c0', ref: { kind: 'edge', name: 'gone' } } } }) });
    const { paths, problems } = explosionOffsets(d, axisOf);
    expect(problems.has('explode3')).toBe(true);
    expect(paths.get('c1')).toHaveLength(2);
  });

  it('puts the leaves along the way by the progress: half way, a pin at (10, 0, 5) is at (25, 0, 30); 0 is the assembled leaves and 1 the exploded ones', () => {
    const d = two();
    const base = leavesOf(d, trees(), (id) => d.components.find((c) => c.id === id)!.placement);
    const { offsets } = explosionOffsets(d, axisOf);
    const half = explodeLeaves(base, offsets, 0.5);
    expect(half.find((l) => l.id === 'c1')!.pose.position).toEqual([25, 0, 30]);
    expect(half.find((l) => l.id === 'c0')!.pose.position).toEqual([0, 0, 0]);
    expect(explodeLeaves(base, offsets, 0)).toEqual(base);
    expect(explodeLeaves(base, offsets, 1)).toEqual(explodeLeaves(base, offsets));
    expect(explodeLeaves(base, offsets).find((l) => l.id === 'c1')!.pose.position).toEqual([40, 0, 55]);
  });
});

describe('where a component is, for its explode line', () => {
  const box = { min: [0, 0, 0] as Vec3, max: [10, 4, 2] as Vec3 };
  const leaf = (id: string, pose: Pose) => ({ id, top: 'c1', path: [], key: 'pin', pose, hidden: false, transparent: false });
  const quarter = Math.SQRT1_2;

  it('is the middle of the box of the part, turned and moved with it: a 10 × 4 × 2 box turned 90° about z and put at (10, 0, 5) has its middle at (8, 5, 6)', () => {
    const turned: Pose = { position: [10, 0, 5], rotation: [0, 0, quarter, quarter] };
    const c = leavesCentre([leaf('c1', turned)], () => box)!;
    expect(c[0]).toBeCloseTo(8, 12);
    expect(c[1]).toBeCloseTo(5, 12);
    expect(c[2]).toBeCloseTo(6, 12);
  });

  it('is the middle of the box round all the leaves: that one and the same part left at the origin make the box (0..10, 0..10, 0..7), middle (5, 5, 3.5)', () => {
    const turned: Pose = { position: [10, 0, 5], rotation: [0, 0, quarter, quarter] };
    const c = leavesCentre([leaf('c1', turned), leaf('c1b', at([0, 0, 0]))], () => box)!;
    expect(c[0]).toBeCloseTo(5, 12);
    expect(c[1]).toBeCloseTo(5, 12);
    expect(c[2]).toBeCloseTo(3.5, 12);
  });

  it('is nothing for leaves that have no box', () => {
    expect(leavesCentre([leaf('c1', at([1, 2, 3]))], () => null)).toBeNull();
    expect(leavesCentre([], () => box)).toBeNull();
  });
});

describe('several exploded views (v7)', () => {
  const view = (id: string, name: string, steps: ExplodeStep[] = []) => ({ id, name, steps });
  const withViews = (): AssemblyDoc => {
    let d = applyAssemblyCommand(doc(), { type: 'insertExplosion', explosion: view('explosion1', '裝配', [step({ distance: '50' })]) });
    d = applyAssemblyCommand(d, { type: 'insertExplosion', explosion: view('explosion2', '拆卸', [step({ id: 'explode2', components: ['c2'], axis: { kind: 'axis', axis: 'x' }, distance: '30' })]) });
    return d;
  };

  it('a new view becomes the active one; the offsets are those of the active view only: 50 along z for the first, 30 along x for the second', () => {
    let d = withViews();
    expect(d.activeExplosion).toBe('explosion2');
    expect(activeExplosion(d)!.name).toBe('拆卸');
    expect([...explosionOffsets(d, axisOf).offsets]).toEqual([['c2', [30, 0, 0]]]);
    d = applyAssemblyCommand(d, { type: 'setActiveExplosion', explosionId: 'explosion1' });
    expect([...explosionOffsets(d, axisOf).offsets]).toEqual([['c1', [0, 0, 50]]]);
    expect(explosionSteps(d).map((s) => s.id)).toEqual(['explode1']);
  });

  it('the steps are made in the active view; with no view the first step makes one, named 爆炸視圖1', () => {
    const made = applyAssemblyCommand(doc(), { type: 'insertExplodeStep', step: step() });
    expect(made.explosions).toEqual([{ id: 'explosion1', name: '爆炸視圖1', steps: [step()] }]);
    expect(made.activeExplosion).toBe('explosion1');
    let d = withViews();
    d = applyAssemblyCommand(d, { type: 'insertExplodeStep', step: step({ id: 'explode3', components: ['c1'], distance: '10' }) });
    expect(d.explosions![1]!.steps.map((s) => s.id)).toEqual(['explode2', 'explode3']);
    expect(d.explosions![0]!.steps.map((s) => s.id)).toEqual(['explode1']);
  });

  it('renames, and refuses an empty name; deletes the active view and shows the next; deleting the last takes the fields away; ids are not reused', () => {
    let d = withViews();
    d = applyAssemblyCommand(d, { type: 'renameExplosion', explosionId: 'explosion1', name: ' 組裝 ' });
    expect(d.explosions![0]!.name).toBe('組裝');
    expect(() => applyAssemblyCommand(d, { type: 'renameExplosion', explosionId: 'explosion1', name: ' ' })).toThrow(/名稱不可空白/);
    expect(() => applyAssemblyCommand(d, { type: 'renameExplosion', explosionId: 'nope', name: 'x' })).toThrow(/找不到爆炸視圖/);
    d = applyAssemblyCommand(d, { type: 'deleteExplosion', explosionId: 'explosion2' }); // the active one
    expect(d.activeExplosion).toBe('explosion1');
    expect(d.explosions!.map((v) => v.id)).toEqual(['explosion1']);
    d = applyAssemblyCommand(d, { type: 'deleteExplosion', explosionId: 'explosion1' });
    expect(d.explosions).toBeUndefined();
    expect(d.activeExplosion).toBeUndefined();
    expect(d.idCounters.explosion).toBe(2);
    expect(d.idCounters.explode).toBe(2);
    expect(() => applyAssemblyCommand(d, { type: 'deleteExplosion', explosionId: 'explosion1' })).toThrow(/找不到爆炸視圖/);
    expect(() => applyAssemblyCommand(withViews(), { type: 'insertExplosion', explosion: view('explosion1', 'again') })).toThrow(/ID 已被使用/);
    expect(() => applyAssemblyCommand(withViews(), { type: 'insertExplosion', explosion: view('explosion3', 'x', [step({ id: 'explode1' })]) })).toThrow(/ID 已被使用/);
  });

  it('deleting a component takes it out of the steps of every view, and the views stay', () => {
    const gone = applyAssemblyCommand(withViews(), { type: 'deleteComponents', componentIds: ['c2'] });
    expect(gone.explosions!.map((v) => [v.id, v.steps.map((s) => s.id)])).toEqual([['explosion1', ['explode1']], ['explosion2', []]]);
  });

  it('a version-6 file with one list of steps is the first view, and the active one; a file without steps has none; the counters cover the views', () => {
    const v6 = JSON.parse(serializeAssembly(doc()));
    v6.schemaVersion = 6;
    v6.explosion = [step({ distance: '30' })];
    v6.idCounters = {};
    const d = parseAssembly(JSON.stringify(v6));
    expect(d.schemaVersion).toBe(ASSEMBLY_SCHEMA_VERSION);
    expect(d.explosions).toEqual([{ id: 'explosion1', name: '爆炸視圖1', steps: [step({ distance: '30' })] }]);
    expect(d.activeExplosion).toBe('explosion1');
    expect(d).not.toHaveProperty('explosion');
    expect(d.idCounters.explosion).toBe(1);
    expect(d.idCounters.explode).toBe(1);
    expect([...explosionOffsets(d, axisOf).offsets]).toEqual([['c1', [0, 0, 30]]]);
    const none = JSON.parse(serializeAssembly(doc()));
    none.schemaVersion = 6;
    expect(parseAssembly(JSON.stringify(none))).toEqual(doc());
  });

  it('is written and read back with its views, the active one, and every undo step', () => {
    const d = withViews();
    expect(parseAssembly(serializeAssembly(d))).toEqual(d);
    const h = new AssemblyHistory(doc());
    h.execute({ type: 'insertExplosion', explosion: view('explosion1', 'a') });
    h.execute({ type: 'insertExplosion', explosion: view('explosion2', 'b') });
    h.execute({ type: 'setActiveExplosion', explosionId: 'explosion1' });
    h.execute({ type: 'renameExplosion', explosionId: 'explosion1', name: 'c' });
    h.execute({ type: 'deleteExplosion', explosionId: 'explosion1' });
    expect(h.doc.activeExplosion).toBe('explosion2');
    for (let i = 0; i < 5; i++) h.undo();
    expect(h.doc).toEqual(doc());
  });
});
