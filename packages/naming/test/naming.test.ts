import { describe, expect, it } from 'vitest';
import { edgeName, faceNamesOf, nameElements, ownerFeatures, resolveRef, type NamingTopology, type Origin } from '../src/index';

type V = [number, number, number];

/** Unit box topology: faces 0..5 = -x, +x, -y, +y, -z, +z. */
function box(): NamingTopology & { faces: { center: V; surface: string; area: number; normal: V | null }[]; edges: { mid: V; faces: number[]; curve: string; length: number; dir: V | null }[] } {
  const fc: V[] = [[0, 0.5, 0.5], [1, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [0.5, 0.5, 0], [0.5, 0.5, 1]];
  const faces = fc.map((center) => ({ center, surface: 'plane', area: 1, normal: null }));
  const edges: { mid: V; faces: number[]; curve: string; length: number; dir: V | null }[] = [];
  const pairs = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [2, 5], [3, 4], [3, 5]];
  for (const [a, b] of pairs) {
    const mid = fc[a!]!.map((v, k) => (v + fc[b!]![k]!) / 2) as V;
    edges.push({ mid, faces: [a!, b!], curve: 'line', length: 1, dir: null });
  }
  return { faces, edges, vertices: [] };
}

const extrudeOrigins: Origin[][] = [
  [{ rel: 'generated', kind: 'profileEdge', source: 'l4' }],
  [{ rel: 'generated', kind: 'profileEdge', source: 'l2' }],
  [{ rel: 'generated', kind: 'profileEdge', source: 'l1' }],
  [{ rel: 'generated', kind: 'profileEdge', source: 'l3' }],
  [{ rel: 'cap', which: 'start' }],
  [{ rel: 'cap', which: 'end' }],
];

describe('naming', () => {
  it('names faces by generation and edges by adjacent faces', () => {
    const names = nameElements(extrudeOrigins, box(), { featureId: 'e1', sketchId: 's1' });
    expect(names.faces).toEqual(['e1:side:s1.l4', 'e1:side:s1.l2', 'e1:side:s1.l1', 'e1:side:s1.l3', 'e1:cap:start', 'e1:cap:end']);
    expect(names.edges).toContain('{e1:cap:end|e1:side:s1.l2}');
    expect(new Set(names.edges).size).toBe(12);
  });

  it('inherits names through modification and disambiguates splits geometrically', () => {
    const topo = { faces: [{ center: [2, 0, 0] as V }, { center: [-2, 0, 0] as V }, { center: [0, 0, 1] as V }], edges: [], vertices: [] };
    const origins: Origin[][] = [
      [{ rel: 'modified', kind: 'face', index: 0 }],
      [{ rel: 'modified', kind: 'face', index: 0 }],
      [{ rel: 'generated', kind: 'edge', index: 3 }],
    ];
    const names = nameElements(origins, topo, {
      featureId: 'f1',
      role: 'fillet',
      input: { faces: ['e1:cap:end'], edges: ['a', 'b', 'c', '{e1:cap:end|e1:side:s1.l2}'], vertices: [] },
    });
    expect(names.faces).toEqual(['e1:cap:end#2', 'e1:cap:end#1', 'f1:fillet:{e1:cap:end|e1:side:s1.l2}']);
  });

  it('parses owners and component faces of nested names', () => {
    const n = edgeName(['f1:fillet:{e1:cap:end|e1:side:s1.l2}', 'e1:side:s1.l3']);
    expect(faceNamesOf(n)).toEqual(['e1:side:s1.l3', 'f1:fillet:{e1:cap:end|e1:side:s1.l2}']);
    expect(ownerFeatures(n).sort()).toEqual(['e1', 'f1']);
  });
});

describe('resolution', () => {
  const topo = box();
  const names = nameElements(extrudeOrigins, topo, { featureId: 'e1', sketchId: 's1' });

  it('resolves by exact name', () => {
    const r = resolveRef({ kind: 'edge', name: '{e1:cap:end|e1:side:s1.l2}' }, names, topo);
    expect(r).toMatchObject({ ok: true, via: 'name' });
  });

  it('accepts a unique base name when a split disappeared', () => {
    const r = resolveRef({ kind: 'edge', name: '{e1:cap:end|e1:side:s1.l2}#1' }, names, topo);
    expect(r).toMatchObject({ ok: true, via: 'base-name' });
  });

  it('reports a missing reference with candidates ranked by fingerprint', () => {
    const r = resolveRef(
      { kind: 'edge', name: '{e1:cap:end|e1:side:s1.l9}', fingerprint: { type: 'line', size: 1, center: [1, 0.5, 1] } },
      names,
      topo,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('missing');
      expect(r.candidates[0]!.name).toBe('{e1:cap:end|e1:side:s1.l2}');
    }
  });
});
