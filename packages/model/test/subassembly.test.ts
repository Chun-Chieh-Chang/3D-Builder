import { describe, expect, it } from 'vitest';
import { applyAssemblyCommand, axisAngle, createEmptyAssembly, IDENTITY_ROTATION, isSubAssemblyPath, resolveTree, wouldCycle, type AssemblyDoc, type Pose } from '../src/index';

const at = (x: number, y: number, z: number, rotation = IDENTITY_ROTATION): Pose => ({ position: [x, y, z], rotation: [...rotation] });

/** An assembly of the given files, each as one component (instance 1) placed at the given pose. */
function assembly(parts: [path: string, pose: Pose, fixed?: boolean][]): AssemblyDoc {
  let doc = createEmptyAssembly();
  parts.forEach(([path, placement, fixed], i) => {
    doc = applyAssemblyCommand(doc, { type: 'insertComponent', component: { id: `c${i + 1}`, file: `f${i + 1}`, instance: 1, fixed: fixed ?? false, placement }, file: { id: `f${i + 1}`, path } });
  });
  return doc;
}
const loader = (docs: Record<string, AssemblyDoc>) => (p: string) => docs[p] ?? null;

describe('sub-assemblies', () => {
  it('tells an assembly file from a part file', () => {
    expect(isSubAssemblyPath('夾具.3dba')).toBe(true);
    expect(isSubAssemblyPath('板.3dbx')).toBe(false);
  });

  it('composes the placements down the tree', () => {
    const turn = axisAngle([0, 0, 1], Math.PI / 2);
    const docs = {
      'top.3dba': assembly([['sub.3dba', at(100, 0, 0, turn)]]),
      'sub.3dba': assembly([['pin.3dbx', at(10, 0, 0)]]),
    };
    const tree = resolveTree('top.3dba', loader(docs));
    expect(tree.problems).toEqual([]);
    expect(tree.parts).toHaveLength(1);
    const p = tree.parts[0]!;
    expect(p.chain).toEqual(['c1', 'c1']);
    expect(p.path).toBe('pin.3dbx');
    // (10, 0, 0) turned a quarter about z is (0, 10, 0), then moved by (100, 0, 0)
    expect(p.pose.position[0]).toBeCloseTo(100, 9);
    expect(p.pose.position[1]).toBeCloseTo(10, 9);
    expect(p.pose.position[2]).toBeCloseTo(0, 9);
  });

  it('moving the sub-assembly moves every part in it by the same amount; mates inside are not the parent\'s business', () => {
    const sub = assembly([['a.3dbx', at(0, 0, 0)], ['b.3dbx', at(5, 5, 0)]]);
    const before = resolveTree('top.3dba', loader({ 'top.3dba': assembly([['sub.3dba', at(0, 0, 0)]]), 'sub.3dba': sub }));
    const after = resolveTree('top.3dba', loader({ 'top.3dba': assembly([['sub.3dba', at(30, 0, 0)]]), 'sub.3dba': sub }));
    for (let i = 0; i < 2; i++) expect(after.parts[i]!.pose.position[0] - before.parts[i]!.pose.position[0]).toBeCloseTo(30, 9);
  });

  it('resolves paths relative to the folder of the assembly that holds them', () => {
    const docs = {
      'top.3dba': assembly([['子/sub.3dba', at(0, 0, 0)]]),
      '子/sub.3dba': assembly([['../共用/pin.3dbx', at(0, 0, 0)], ['nut.3dbx', at(0, 0, 0)]]),
    };
    expect(resolveTree('top.3dba', loader(docs)).parts.map((p) => p.path)).toEqual(['共用/pin.3dbx', '子/nut.3dbx']);
  });

  it('reports a cycle instead of opening it, and still returns the other parts', () => {
    const docs = {
      'a.3dba': assembly([['b.3dba', at(0, 0, 0)], ['x.3dbx', at(0, 0, 0)]]),
      'b.3dba': assembly([['a.3dba', at(0, 0, 0)]]),
    };
    const tree = resolveTree('a.3dba', loader(docs));
    expect(tree.problems).toEqual([{ kind: 'cycle', chain: ['a.3dba', 'b.3dba', 'a.3dba'] }]);
    expect(tree.parts.map((p) => p.path)).toEqual(['x.3dbx']);
    expect(resolveTree('self.3dba', loader({ 'self.3dba': assembly([['self.3dba', at(0, 0, 0)]]) })).problems[0]!.kind).toBe('cycle');
  });

  it('reports a missing sub-assembly', () => {
    const tree = resolveTree('top.3dba', loader({ 'top.3dba': assembly([['gone.3dba', at(0, 0, 0)]]) }));
    expect(tree.problems).toEqual([{ kind: 'missing', path: 'gone.3dba', chain: ['c1'] }]);
  });

  it('opens a sub-assembly used twice once per use', () => {
    let top = assembly([['sub.3dba', at(0, 0, 0)]]);
    top = applyAssemblyCommand(top, { type: 'insertComponent', component: { id: 'c2', file: 'f1', instance: 2, fixed: false, placement: at(50, 0, 0) } });
    const docs = { 'top.3dba': top, 'sub.3dba': assembly([['a.3dbx', at(0, 0, 0)]]) };
    expect(top.files).toHaveLength(1);
    expect(resolveTree('top.3dba', loader(docs)).parts.map((p) => [p.chain.join('/'), p.pose.position[0]])).toEqual([['c1/c1', 0], ['c2/c1', 50]]);
  });

  it('asks before an insert whether it would make a cycle', () => {
    const docs = { 'top.3dba': assembly([['mid.3dba', at(0, 0, 0)]]), 'mid.3dba': assembly([['a.3dbx', at(0, 0, 0)]]), 'other.3dba': assembly([]) };
    expect(wouldCycle('mid.3dba', 'top.3dba', loader(docs))).toBe(true); // top contains mid
    expect(wouldCycle('mid.3dba', 'mid.3dba', loader(docs))).toBe(true);
    expect(wouldCycle('mid.3dba', 'other.3dba', loader(docs))).toBe(false);
    expect(wouldCycle('mid.3dba', 'part.3dbx', loader(docs))).toBe(false);
  });
});
