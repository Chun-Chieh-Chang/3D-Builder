import { describe, expect, it } from 'vitest';
import {
  ASSEMBLY_SCHEMA_VERSION,
  applyAssemblyCommand,
  AssemblyHistory,
  assemblyIdsInUse,
  axisAngle,
  baseName,
  CommandError,
  createEmptyAssembly,
  dirName,
  documentKind,
  FormatError,
  IDENTITY_ROTATION,
  IdAllocator,
  isFilePath,
  isValidPose,
  joinPath,
  nextInstance,
  normalizePath,
  parseAssembly,
  poseMatrix,
  relativePath,
  relocateAssembly,
  serializeAssembly,
  transformPoint,
  type AssemblyDoc,
  type Component,
  type Mate,
  type Pose,
  type Vec3,
} from '../src/index';

const at = (x: number, y: number, z: number, rotation = IDENTITY_ROTATION): Pose => ({ position: [x, y, z], rotation: [...rotation] });
const comp = (id: string, file: string, instance: number, fixed = false, placement = at(0, 0, 0)): Component => ({ id, file, instance, fixed, placement });

/** 定位板<1> fixed at the origin, 削邊銷<1> and 削邊銷<2> floating. */
function jig(): AssemblyDoc {
  let doc = createEmptyAssembly();
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '定位板.3dbx' }, component: comp('comp1', 'file1', 1, true) });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: '零件/削邊銷.3dbx' }, component: comp('comp2', 'file2', 1, false, at(30, 20, 15)) });
  return applyAssemblyCommand(doc, { type: 'insertComponent', component: comp('comp3', 'file2', 2, false, at(-30, 20, 15)) });
}

const close = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]!, 12);
};

describe('file paths (B9.4)', () => {
  it('normalizes, joins and splits "/" paths', () => {
    expect(normalizePath('./零件//a/../銷.3dbx')).toBe('零件/銷.3dbx');
    expect(normalizePath('../../x.3dbx')).toBe('../../x.3dbx');
    expect(joinPath('', '定位板.3dbx')).toBe('定位板.3dbx');
    expect(joinPath('組合件', '../零件/銷.3dbx')).toBe('零件/銷.3dbx');
    expect(joinPath('', '../銷.3dbx')).toBe('../銷.3dbx'); // outside the project folder: kept, never dropped
    expect(dirName('零件/銷.3dbx')).toBe('零件');
    expect(dirName('銷.3dbx')).toBe('');
    expect(baseName('零件/銷.3dbx')).toBe('銷.3dbx');
  });

  it('finds the path from a folder to a file', () => {
    expect(relativePath('', '零件/銷.3dbx')).toBe('零件/銷.3dbx');
    expect(relativePath('組合件', '零件/銷.3dbx')).toBe('../零件/銷.3dbx');
    expect(relativePath('a/b', 'a/c/銷.3dbx')).toBe('../c/銷.3dbx');
    expect(relativePath('a', 'a/銷.3dbx')).toBe('銷.3dbx');
    expect(relativePath('a', '../銷.3dbx')).toBe('../../銷.3dbx');
    // A folder named like the file is not a shared folder.
    expect(relativePath('銷.3dbx', '銷.3dbx')).toBe('../銷.3dbx');
  });

  it('accepts only relative "/" paths in their shortest form', () => {
    for (const p of ['定位板.3dbx', '零件/銷.3dbx', '../共用/銷.3dbx']) expect(isFilePath(p)).toBe(true);
    for (const p of ['', '/abs.3dbx', 'C:/x.3dbx', 'c:x.3dbx', '零件\\銷.3dbx', 'a//b.3dbx', './a.3dbx', 'a/../b.3dbx', '..', 'a/..', 'a/']) {
      expect(isFilePath(p), p).toBe(false);
    }
  });
});

describe('poses (A3.1)', () => {
  it('maps part coordinates to assembly coordinates', () => {
    close(poseMatrix(at(0, 0, 0)), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const turned: Pose = { position: [10, 20, 30], rotation: axisAngle([0, 0, 1], Math.PI / 2) };
    // Column-major: the first column is where the part's x axis goes (here +y).
    close(poseMatrix(turned).slice(0, 4), [0, 1, 0, 0]);
    close(transformPoint(turned, [1, 0, 0]), [10, 21, 30]);
    close(transformPoint(turned, [0, 1, 0]), [9, 20, 30]);
    const tilted: Pose = { position: [0, 0, 0], rotation: axisAngle([1, 0, 0], Math.PI / 2) };
    close(transformPoint(tilted, [0, 1, 0]), [0, 0, 1]);
  });

  it('accepts finite positions and unit quaternions only', () => {
    expect(isValidPose(at(1, 2, 3))).toBe(true);
    expect(isValidPose({ position: [0, 0, 0], rotation: [0, 0, 0, 2] })).toBe(false);
    expect(isValidPose({ position: [0, Number.NaN, 0], rotation: [0, 0, 0, 1] })).toBe(false);
    expect(isValidPose({ position: [0, 0] as unknown as Vec3, rotation: [0, 0, 0, 1] })).toBe(false);
  });
});

describe('assembly commands (C15.1, C15.2)', () => {
  it('inserts components; instances of one file share its entry', () => {
    const doc = jig();
    expect(doc.files).toEqual([
      { id: 'file1', path: '定位板.3dbx' },
      { id: 'file2', path: '零件/削邊銷.3dbx' },
    ]);
    expect(doc.components.map((c) => [c.id, c.file, c.instance, c.fixed])).toEqual([
      ['comp1', 'file1', 1, true],
      ['comp2', 'file2', 1, false],
      ['comp3', 'file2', 2, false],
    ]);
    expect(nextInstance(doc, 'file2')).toBe(3);
    expect(doc.idCounters).toEqual({ file: 2, comp: 3 });
  });

  it('refuses invalid insertions and leaves the document as it was', () => {
    const doc = jig();
    const bad: [string, Parameters<typeof applyAssemblyCommand>[1]][] = [
      ['reused component id', { type: 'insertComponent', component: comp('comp2', 'file1', 2) }],
      ['reused file id', { type: 'insertComponent', file: { id: 'file1', path: 'x.3dbx' }, component: comp('comp9', 'file1', 1) }],
      ['a second entry for a path', { type: 'insertComponent', file: { id: 'file9', path: '定位板.3dbx' }, component: comp('comp9', 'file9', 1) }],
      ['a component of another file', { type: 'insertComponent', file: { id: 'file9', path: 'x.3dbx' }, component: comp('comp9', 'file1', 2) }],
      ['an unknown file', { type: 'insertComponent', component: comp('comp9', 'file7', 1) }],
      ['an absolute path', { type: 'insertComponent', file: { id: 'file9', path: 'C:/x.3dbx' }, component: comp('comp9', 'file9', 1) }],
      ['a path not in its shortest form', { type: 'insertComponent', file: { id: 'file9', path: 'a/../x.3dbx' }, component: comp('comp9', 'file9', 1) }],
      ['an instance number in use', { type: 'insertComponent', component: comp('comp9', 'file2', 2) }],
      ['instance 0', { type: 'insertComponent', component: comp('comp9', 'file2', 0) }],
      ['a rotation that is not a unit quaternion', { type: 'insertComponent', component: comp('comp9', 'file2', 3, false, { position: [0, 0, 0], rotation: [0, 0, 0, 3] }) }],
    ];
    for (const [what, cmd] of bad) expect(() => applyAssemblyCommand(doc, cmd), what).toThrow(CommandError);
  });

  it('fixes, floats and places components', () => {
    let doc = jig();
    doc = applyAssemblyCommand(doc, { type: 'setFixed', componentIds: ['comp1', 'comp2'], value: false });
    expect(doc.components.map((c) => c.fixed)).toEqual([false, false, false]);
    doc = applyAssemblyCommand(doc, { type: 'setPlacement', componentId: 'comp3', placement: at(1, 2, 3) });
    expect(doc.components[2]!.placement).toEqual(at(1, 2, 3));
    expect(() => applyAssemblyCommand(doc, { type: 'setFixed', componentIds: ['comp1', 'comp8'], value: true })).toThrow(CommandError);
    expect(() => applyAssemblyCommand(doc, { type: 'setPlacement', componentId: 'comp1', placement: { position: [0, 0, Infinity], rotation: [0, 0, 0, 1] } })).toThrow(CommandError);
  });

  it('deletes components, drops files left unused, and never reissues their ids', () => {
    const doc = jig();
    const once = applyAssemblyCommand(doc, { type: 'deleteComponents', componentIds: ['comp2'] });
    expect(once.files.map((f) => f.id)).toEqual(['file1', 'file2']); // comp3 still uses it
    const both = applyAssemblyCommand(once, { type: 'deleteComponents', componentIds: ['comp3'] });
    expect(both.files.map((f) => f.id)).toEqual(['file1']);
    const ids = new IdAllocator(both.idCounters, assemblyIdsInUse(both));
    expect([ids.take('comp'), ids.take('file')]).toEqual(['comp4', 'file3']);
    expect(doc.components).toHaveLength(3); // the input document is never modified
  });
});

describe('moving the assembly to another folder (B9.4)', () => {
  it('rewrites the paths so they still reach the same files', () => {
    const doc = jig();
    const moved = relocateAssembly(doc, '', '組合件');
    expect(moved.files.map((f) => f.path)).toEqual(['../定位板.3dbx', '../零件/削邊銷.3dbx']);
    expect(relocateAssembly(moved, '組合件', '零件').files.map((f) => f.path)).toEqual(['../定位板.3dbx', '削邊銷.3dbx']);
    expect(relocateAssembly(moved, '組合件', '')).toEqual(doc);
    expect(relocateAssembly(doc, '', '')).toBe(doc);
    // A file outside the project folder stays where it is.
    const outside = applyAssemblyCommand(createEmptyAssembly(), { type: 'insertComponent', file: { id: 'file1', path: '../外部/x.3dbx' }, component: comp('comp1', 'file1', 1) });
    expect(relocateAssembly(outside, '', 'a/b').files[0]!.path).toBe('../../../外部/x.3dbx');
    expect(relocateAssembly(relocateAssembly(outside, '', 'a/b'), 'a/b', '')).toEqual(outside);
  });

  it('rewrites every state undo and redo can reach, keeping the steps', () => {
    const h = new AssemblyHistory(createEmptyAssembly());
    h.execute({ type: 'insertComponent', file: { id: 'file1', path: '定位板.3dbx' }, component: comp('comp1', 'file1', 1, true) }, '插入定位板');
    h.execute({ type: 'insertComponent', file: { id: 'file2', path: '零件/削邊銷.3dbx' }, component: comp('comp2', 'file2', 1) }, '插入削邊銷');
    h.execute({ type: 'setPlacement', componentId: 'comp2', placement: at(5, 0, 0) });
    h.undo(); // the placement waits on the redo stack
    const events: AssemblyDoc[] = [];
    h.subscribe((d) => events.push(d));
    h.rebase((d) => relocateAssembly(d, '', '組合件'));
    expect(events).toHaveLength(1);
    const paths = () => h.doc.files.map((f) => f.path);
    expect(paths()).toEqual(['../定位板.3dbx', '../零件/削邊銷.3dbx']);
    h.redo();
    expect(h.doc.components[1]!.placement).toEqual(at(5, 0, 0));
    expect(paths()).toEqual(['../定位板.3dbx', '../零件/削邊銷.3dbx']);
    h.undo();
    h.undo();
    expect(paths()).toEqual(['../定位板.3dbx']);
    h.undo();
    expect(h.doc.components).toEqual([]);
    expect(h.canUndo).toBe(false);
    h.redo();
    h.redo();
    h.redo();
    expect(paths()).toEqual(['../定位板.3dbx', '../零件/削邊銷.3dbx']);
    expect(h.doc.components[1]!.placement).toEqual(at(5, 0, 0));
    expect(h.canRedo).toBe(false);
  });

  it('is refused inside an edit session', () => {
    const h = new AssemblyHistory(jig());
    h.begin('編輯');
    expect(() => h.rebase((d) => d)).toThrow();
  });
});

describe('assembly text format (B9.1, B9.6)', () => {
  it('serializes canonically and parses back the same document', () => {
    const doc = jig();
    const text = serializeAssembly(doc);
    expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(['components', 'files', 'idCounters', 'kind', 'mates', 'properties', 'schemaVersion']);
    expect(parseAssembly(text)).toEqual(doc);
    expect(serializeAssembly(parseAssembly(text))).toBe(text);
    expect(documentKind(text)).toBe('assembly');
    expect(doc.schemaVersion).toBe(ASSEMBLY_SCHEMA_VERSION);
  });

  it('covers every id with the counters, even when the file has none', () => {
    const raw = JSON.parse(serializeAssembly(jig()));
    delete raw.idCounters;
    delete raw.properties;
    const doc = parseAssembly(JSON.stringify(raw));
    expect(doc.idCounters).toEqual({ file: 2, comp: 3 });
    expect(doc.properties).toEqual({});
  });

  it('refuses what it cannot read', () => {
    const text = serializeAssembly(jig());
    const newer = JSON.stringify({ ...JSON.parse(text), schemaVersion: ASSEMBLY_SCHEMA_VERSION + 1 });
    expect(() => parseAssembly(newer)).toThrow(/比本程式支援的 2 新/);
    expect(() => parseAssembly('{"kind":"part","schemaVersion":6,"features":[]}')).toThrow(FormatError);
    expect(() => parseAssembly('{"kind":"assembly","schemaVersion":1}')).toThrow(/缺少零組件清單/);
    expect(() => parseAssembly('{"kind":"assembly","schemaVersion":2,"files":[],"components":[]}')).toThrow(/缺少結合清單/);
    expect(() => parseAssembly('[]')).toThrow(FormatError);
    expect(() => documentKind('{"kind":"drawing"}')).toThrow(FormatError);
  });
});

// ---------------------------------------------------------------- mates (2B)

const face = (name: string) => ({ kind: 'face' as const, name });
/** 削邊銷<1> in 定位板<1>'s hole, flush on its top face. */
const concentric = (): Mate => ({ id: 'mate1', name: '同軸心1', type: 'concentric', a: { component: 'comp1', ref: face('cut1:side:sketch2.c1') }, b: { component: 'comp2', ref: face('revolve1:side:sketch1.l3') }, align: 'aligned', suppressed: false });
const flush = (): Mate => ({ id: 'mate2', name: '重合1', type: 'coincident', a: { component: 'comp1', ref: face('extrude1:cap:end') }, b: { component: 'comp2', ref: face('revolve1:side:sketch1.l2') }, align: 'antiAligned', suppressed: false });

describe('mates in the document (C15.8, C15.12)', () => {
  const mated = () => applyAssemblyCommand(applyAssemblyCommand(jig(), { type: 'insertMate', mate: concentric() }), { type: 'insertMate', mate: flush() });

  it('adds, changes, suppresses and deletes mates', () => {
    let doc = mated();
    expect(doc.mates.map((m) => m.name)).toEqual(['同軸心1', '重合1']);
    expect(doc.idCounters.mate).toBe(2);
    doc = applyAssemblyCommand(doc, { type: 'setMate', mate: { ...flush(), type: 'distance', name: '距離1', value: '5' } });
    expect(doc.mates[1]).toMatchObject({ type: 'distance', value: '5' });
    doc = applyAssemblyCommand(doc, { type: 'setMatesSuppressed', mateIds: ['mate1'], value: true });
    expect(doc.mates[0]!.suppressed).toBe(true);
    doc = applyAssemblyCommand(doc, { type: 'deleteMates', mateIds: ['mate1'] });
    expect(doc.mates.map((m) => m.id)).toEqual(['mate2']);
    const ids = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc));
    expect(ids.take('mate')).toBe('mate3');
  });

  it('deleting a component deletes the mates on it, as SolidWorks does', () => {
    const doc = applyAssemblyCommand(mated(), { type: 'deleteComponents', componentIds: ['comp2'] });
    expect(doc.mates).toEqual([]);
    expect(applyAssemblyCommand(mated(), { type: 'deleteComponents', componentIds: ['comp3'] }).mates).toHaveLength(2);
  });

  it('mates to the planes and origin of the assembly itself, and to nothing else of it', () => {
    const toFront: Mate = { ...flush(), id: 'mate9', a: { component: null, ref: { kind: 'datum', name: 'plane:front' } } };
    expect(applyAssemblyCommand(jig(), { type: 'insertMate', mate: toFront }).mates).toHaveLength(1);
    expect(() => applyAssemblyCommand(jig(), { type: 'insertMate', mate: { ...toFront, a: { component: null, ref: face('x') } } })).toThrow(/只能選基準面或原點/);
  });

  it('refuses mates that are not well formed, and leaves the document as it was', () => {
    const doc = mated();
    const bad: [string, Mate][] = [
      ['a reused id', { ...flush(), id: 'comp1' }],
      ['an unknown component', { ...flush(), id: 'mate7', b: { component: 'comp9', ref: face('x') } }],
      ['both ends on one component', { ...flush(), id: 'mate7', b: { component: 'comp1', ref: face('x') } }],
      ['an empty selection', { ...flush(), id: 'mate7', b: { component: 'comp2', ref: face('') } }],
      ['a distance without a value', { ...flush(), id: 'mate7', type: 'distance' }],
      ['a negative distance', { ...flush(), id: 'mate7', type: 'distance', value: '-2' }],
      ['an angle over 180°', { ...flush(), id: 'mate7', type: 'angle', value: '190' }],
      ['a value on a coincident mate', { ...flush(), id: 'mate7', value: '3' }],
      ['a lock without its relative pose', { ...flush(), id: 'mate7', type: 'lock' }],
      ['an empty name', { ...flush(), id: 'mate7', name: ' ' }],
    ];
    for (const [what, mate] of bad) expect(() => applyAssemblyCommand(doc, { type: 'insertMate', mate }), what).toThrow(CommandError);
    expect(() => applyAssemblyCommand(doc, { type: 'setMate', mate: { ...flush(), id: 'mate8' } })).toThrow(CommandError);
    expect(doc.mates).toHaveLength(2);
  });

  it('round-trips through the text format', () => {
    const doc = mated();
    expect(parseAssembly(serializeAssembly(doc))).toEqual(doc);
  });
});

describe('assemblies written by older versions (B9.2)', () => {
  it('upgrades a version-1 document', () => {
    const v1 = JSON.parse(serializeAssembly(jig()));
    delete v1.mates;
    v1.schemaVersion = 1;
    const doc = parseAssembly(JSON.stringify(v1));
    expect(doc.schemaVersion).toBe(ASSEMBLY_SCHEMA_VERSION);
    expect(doc.mates).toEqual([]);
    expect(doc.components).toEqual(jig().components);
  });
});
