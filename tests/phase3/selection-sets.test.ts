/**
 * Phase 3a-9c-2 (D5.6): selecting a loop of edges, the edges that continue one another and the faces that meet smoothly, from the names and the mesh
 * of a real rebuild (ADR 0043).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { faceNamesOf } from '@3db/naming';
import { Topology } from '../../apps/web/src/state/selectionSets';
import { build, circle, edge, extrude, fillet, front, face, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const topology = (r: RebuildResult) => {
  const names = r.body!.names;
  return { names, topo: new Topology({ faceNames: names.faces, edgeNames: names.edges, mesh: kernel.mesh(r.body!.shape) }) };
};
const faceIndex = (names: { faces: string[] }, name: string) => names.faces.indexOf(name);
const sideEdges = (names: { edges: string[] }) => names.edges.filter((n) => faceNamesOf(n).every((f) => f.startsWith('e1:side:')));

/** A plate 60 × 20 × 5 with a hole of radius 3 in its top face. */
const plate = () => [sketch('s1', front, rectangle('p', 0, 0, 60, 20)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }), sketch('s2', face('e1:cap:end'), circle('k', 30, 10, 3)), extrude('c1', 's2', 'cut', { type: 'blind', depth: '5' })];
const rebuild = (...f: ReturnType<typeof plate>) => new Regenerator(kernel, solver, new Map()).rebuild(build(...f));

describe('selecting more than the element under the cursor (D5.6)', () => {
  it('the loop of a face: the outline and the hole are separate loops', () => {
    const r = rebuild(...plate());
    expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const { names, topo } = topology(r);
    const top = faceIndex(names, 'e1:cap:end');
    const edges = topo.faceEdges[top]!;
    expect(edges).toHaveLength(5); // four sides and the circle
    const circleEdge = edges.find((e) => names.edges[e]!.includes('c1:side'))!;
    expect(topo.loop(top, circleEdge)).toEqual([circleEdge]);
    const outline = edges.filter((e) => e !== circleEdge);
    expect(topo.loop(top, outline[0]!).sort()).toEqual([...outline].sort());
  });

  it('the edges that continue one another: the sides of a plate with rounded corners, but not the sides of a plain one', () => {
    const plain = topology(rebuild(...plate()));
    const topEdge = plain.names.edges.findIndex((n) => faceNamesOf(n).includes('e1:cap:end') && faceNamesOf(n).some((f) => f.startsWith('e1:side:')));
    expect(plain.topo.tangentEdges(topEdge)).toEqual([topEdge]); // the corners are right angles

    const rounded = rebuild(...plate(), fillet('f1', sideEdges(topology(rebuild(...plate())).names).map((n) => edge(n)), '3'));
    expect(statuses(rounded).filter((s) => !s.endsWith('=ok'))).toEqual([]);
    const { names, topo } = topology(rounded);
    const top = faceIndex(names, 'e1:cap:end');
    const outline = topo.faceEdges[top]!.filter((e) => !names.edges[e]!.includes('c1:side'));
    expect(outline).toHaveLength(8); // four lines and four arcs
    expect(topo.tangentEdges(outline[0]!).sort()).toEqual([...outline].sort());
    // …and the hole's circle is not part of that chain
    const hole = topo.faceEdges[top]!.find((e) => names.edges[e]!.includes('c1:side'))!;
    expect(topo.tangentEdges(hole)).toEqual([hole]);
  });

  it('the faces that meet smoothly: the rounded sides of a plate, the hole is a face of its own', () => {
    const rounded = rebuild(...plate(), fillet('f1', sideEdges(topology(rebuild(...plate())).names).map((n) => edge(n)), '3'));
    const { names, topo } = topology(rounded);
    const side = names.faces.findIndex((n) => n.startsWith('e1:side:'));
    const smooth = topo.tangentFaces(side).map((i) => names.faces[i]!);
    // four flat sides and four roundings, in one piece; the top and the bottom meet them at right angles, the hole's wall meets the top that way too
    expect(smooth).toHaveLength(8);
    expect(smooth.every((n) => !n.startsWith('c1:') && n !== 'e1:cap:end' && n !== 'e1:cap:start')).toBe(true);
  });

  it('a plain plate has no smooth neighbours', () => {
    const { names, topo } = topology(rebuild(...plate()));
    for (let f = 0; f < names.faces.length; f++) expect(topo.tangentFaces(f)).toEqual([f]);
  });
});
