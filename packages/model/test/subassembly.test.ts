import { describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  AssemblyHistory,
  ASSEMBLY_SCHEMA_VERSION,
  CommandError,
  createEmptyAssembly,
  cycleMessage,
  findReferenceCycle,
  parseAssembly,
  serializeAssembly,
  usedFiles,
  type AssemblyDoc,
  type Component,
  type Mate,
} from '../src/index';

const face = (name: string) => ({ kind: 'face' as const, name });
const comp = (id: string, file: string, instance: number, extra: Partial<Component> = {}): Component => ({ id, file, instance, fixed: false, placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, ...extra });

/** A part and a sub-assembly, as an assembly sees them. */
function parent(): AssemblyDoc {
  let doc = createEmptyAssembly();
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '定位板.3dbx' }, component: comp('comp1', 'file1', 1, { fixed: true }) });
  return applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: '組件/定位組.3dba' }, component: comp('comp2', 'file2', 1) });
}

const mate = (a: Mate['a'], b: Mate['b']): Mate => ({ id: 'mate1', name: '重合1', type: 'coincident', a, b, suppressed: false });

describe('assembly Schema 3: sub-assemblies and component flags (C15.4, C15.5)', () => {
  it('is version 3 and reads a version-2 text unchanged', () => {
    expect(ASSEMBLY_SCHEMA_VERSION).toBe(3);
    const text = serializeAssembly(parent());
    const v2 = JSON.stringify({ ...JSON.parse(text), schemaVersion: 2 });
    const doc = parseAssembly(v2);
    expect(doc.schemaVersion).toBe(3);
    expect({ ...doc, schemaVersion: 2 }).toEqual({ ...parent(), schemaVersion: 2 });
  });

  it('keeps the flags of a component and a path on a mate through a round trip', () => {
    let doc = parent();
    doc = applyAssemblyCommand(doc, {
      type: 'insertMate',
      mate: mate({ component: 'comp1', ref: face('extrude1:cap:end') }, { component: 'comp2', path: ['comp1', 'comp3'], ref: face('extrude1:cap:end') }),
    });
    const flagged: AssemblyDoc = { ...doc, components: doc.components.map((c) => (c.id === 'comp2' ? { ...c, hidden: true, suppressed: false, transparent: true } : c)) };
    const back = parseAssembly(serializeAssembly(flagged));
    expect(back).toEqual(flagged);
    expect(back.components[1]).toMatchObject({ hidden: true, suppressed: false, transparent: true });
    expect(back.mates[0]!.b.path).toEqual(['comp1', 'comp3']);
    // a component without flags writes none of them
    expect(JSON.parse(serializeAssembly(parent())).components[0]).not.toHaveProperty('hidden');
  });

  it('checks the shape of a mate element path, not what it leads to', () => {
    const insert = (b: Mate['b']) => () => applyAssemblyCommand(parent(), { type: 'insertMate', mate: mate({ component: 'comp1', ref: face('x') }, b) });
    expect(insert({ component: 'comp2', path: ['comp1'], ref: face('x') })).not.toThrow();
    expect(insert({ component: 'comp2', ref: { kind: 'datum', name: 'plane:front' } })).not.toThrow();
    expect(insert({ component: 'comp2', path: [], ref: face('x') })).toThrow(CommandError);
    expect(insert({ component: 'comp2', path: [''], ref: face('x') })).toThrow(/路徑無效/);
    // the assembly's own planes have no component to go through
    const own = () => applyAssemblyCommand(parent(), { type: 'insertMate', mate: mate({ component: 'comp2', ref: face('x') }, { component: null, path: ['comp1'], ref: { kind: 'datum', name: 'plane:front' } }) });
    expect(own).toThrow(/沒有零組件路徑/);
  });

  it('still refuses to mate a component to itself, whatever the paths', () => {
    const same = () =>
      applyAssemblyCommand(parent(), { type: 'insertMate', mate: mate({ component: 'comp2', path: ['comp1'], ref: face('x') }, { component: 'comp2', path: ['comp2'], ref: face('y') }) });
    expect(same).toThrow(/不同的零組件/);
  });

  it('puts a sub-assembly file in the assembly like any other file', () => {
    const doc = parent();
    expect(doc.files.map((f) => f.path)).toEqual(['定位板.3dbx', '組件/定位組.3dba']);
    expect(usedFiles(doc, '夾具')).toEqual(['夾具/定位板.3dbx', '夾具/組件/定位組.3dba']);
    expect(usedFiles(doc, '')).toEqual(['定位板.3dbx', '組件/定位組.3dba']);
    // the same file reached from folders that name it differently is one string
    expect(usedFiles({ ...doc, files: [{ id: 'file1', path: '../零件/銷.3dbx' }] }, '夾具')).toEqual(['零件/銷.3dbx']);
  });
});

describe('assemblies that would contain themselves (C15.4)', () => {
  const tree = (edges: Record<string, string[]>) => (path: string) => edges[path] ?? null;

  it('finds none in a tree, or a diamond where one assembly is used twice', () => {
    expect(findReferenceCycle('a.3dba', tree({ 'a.3dba': ['b.3dba', 'c.3dba', 'x.3dbx'], 'b.3dba': ['d.3dba'], 'c.3dba': ['d.3dba'], 'd.3dba': ['y.3dbx'] }))).toBeNull();
    expect(findReferenceCycle('a.3dba', tree({}))).toBeNull(); // nothing readable below it
  });

  it('finds an assembly that uses itself, and says which', () => {
    const cycle = findReferenceCycle('a.3dba', tree({ 'a.3dba': ['a.3dba'] }));
    expect(cycle).toEqual(['a.3dba', 'a.3dba']);
    expect(cycleMessage(cycle!)).toBe('組合件不能把自己當成零組件：a.3dba');
  });

  it('finds a loop of two and of three, with the chain from the root', () => {
    const two = findReferenceCycle('a.3dba', tree({ 'a.3dba': ['b.3dba'], 'b.3dba': ['a.3dba'] }));
    expect(two).toEqual(['a.3dba', 'b.3dba', 'a.3dba']);
    expect(cycleMessage(two!)).toBe('這樣組合件會包含它自己：a.3dba → b.3dba → a.3dba');
    const three = findReferenceCycle('a.3dba', tree({ 'a.3dba': ['b.3dba'], 'b.3dba': ['c.3dba'], 'c.3dba': ['b.3dba'] }));
    expect(three).toEqual(['b.3dba', 'c.3dba', 'b.3dba']); // the loop itself, found below the root
  });

  it('does not stop at a path written another way, and ends on a deep chain without recursing forever', () => {
    expect(findReferenceCycle('組件/a.3dba', tree({ '組件/a.3dba': ['組件/../組件/b.3dba'], '組件/b.3dba': ['./組件/a.3dba'] }))).toEqual(['組件/a.3dba', '組件/b.3dba', '組件/a.3dba']);
    const deep: Record<string, string[]> = {};
    for (let i = 0; i < 500; i++) deep[`f${i}.3dba`] = [`f${i + 1}.3dba`];
    expect(findReferenceCycle('f0.3dba', tree(deep))).toBeNull();
  });
});

describe('component flags as commands (C15.5)', () => {
  it('sets and clears each flag, and a component with none writes none', () => {
    let doc = parent();
    doc = applyAssemblyCommand(doc, { type: 'setComponentState', componentIds: ['comp1', 'comp2'], state: 'hidden', value: true });
    doc = applyAssemblyCommand(doc, { type: 'setComponentState', componentIds: ['comp2'], state: 'suppressed', value: true });
    doc = applyAssemblyCommand(doc, { type: 'setComponentState', componentIds: ['comp1'], state: 'transparent', value: true });
    expect(doc.components.map((c) => [c.hidden, c.suppressed, c.transparent])).toEqual([[true, undefined, true], [true, true, undefined]]);
    doc = applyAssemblyCommand(doc, { type: 'setComponentState', componentIds: ['comp1', 'comp2'], state: 'hidden', value: false });
    doc = applyAssemblyCommand(doc, { type: 'setComponentState', componentIds: ['comp2'], state: 'suppressed', value: false });
    doc = applyAssemblyCommand(doc, { type: 'setComponentState', componentIds: ['comp1'], state: 'transparent', value: false });
    expect(doc).toEqual(parent());
    expect(Object.keys(JSON.parse(serializeAssembly(doc)).components[0]).sort()).toEqual(['file', 'fixed', 'id', 'instance', 'placement']);
  });

  it('changes all or none, and refuses an unknown component or state', () => {
    const doc = parent();
    expect(() => applyAssemblyCommand(doc, { type: 'setComponentState', componentIds: ['comp1', 'nope'], state: 'hidden', value: true })).toThrow(CommandError);
    expect(doc.components.some((c) => c.hidden)).toBe(false);
    expect(() => applyAssemblyCommand(doc, { type: 'setComponentState', componentIds: ['comp1'], state: 'frozen' as never, value: true })).toThrow(/不明的零組件狀態/);
  });

  it('undoes in one step', () => {
    const history = new AssemblyHistory(parent());
    history.execute({ type: 'setComponentState', componentIds: ['comp1', 'comp2'], state: 'suppressed', value: true });
    expect(history.doc.components.every((c) => c.suppressed)).toBe(true);
    history.undo();
    expect(history.doc).toEqual(parent());
  });
});