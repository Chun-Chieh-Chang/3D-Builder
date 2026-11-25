/**
 * ADR 0265 §5.1: a fillet made on a wall cut at its spline's joints leaves the names after it as they were. The cut is undone after the fillet: the
 * wall's pieces are put back together (`mergePieces`), and so are the pieces of the edges along it (`mergeEdgePieces`); only the round itself comes out
 * in pieces (`f1:fillet:{…}#k`), one for each piece of the wall it was made on. So every consumer — a sketch on a face, a fillet or chamfer of an edge,
 * a dimension, measurement or mate on one element — finds what it named by its name, as at HEAD. The control: the same part without the fillet.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { baseName, resolveRef } from '@3db/naming';
import type { Feature } from '@3db/model';
import { build, edge, extrude, face, fillet, front, line, sketch, spline, statuses } from '../phase1/builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const TOP: [number, number][] = [[30, 20], [22.5, 26], [15, 17], [7.5, 23], [0, 20]];
const base = (): Feature[] => [
  sketch('s1', front, line('a', 0, 0, 30, 0), line('b', 30, 0, 30, 20), spline('c', TOP), line('d', 0, 20, 0, 0)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' } as never),
];
const rounded = (): Feature[] => [...base(), fillet('f1', [edge('{e1:cap:start|e1:side:s1.c}')], '1.2')];
const chamfer = (id: string, name: string): Feature => ({ id, type: 'chamfer', name: id, suppressed: false, edges: [edge(name)], mode: 'distanceDistance', distance: '0.5', second: '0.5' }) as never;

describe('names after a fillet made on a wall cut at its joints (ADR 0265)', () => {
  it('every face and every edge not rounded keeps its name; the round is in pieces of its name', () => {
    const plain = regen.rebuild(build(...base()));
    expect(statuses(plain)).toEqual(['s1=ok', 'e1=ok']);
    const faces = [...plain.body!.names.faces];
    const edges = plain.body!.names.edges.filter((n) => n !== '{e1:cap:start|e1:side:s1.c}');
    const r = regen.rebuild(build(...rounded()));
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'f1=ok']);
    expect(kernel.lastFilletCut).toBe('cut');
    expect(kernel.lastFilletMerge).toMatch(/^merged, \d+ edges$/);
    for (const n of faces) expect(r.body!.names.faces).toContain(n);
    // the edges along the wall that were not rounded: each one edge by its name (the cut split them; mergeEdgePieces put them back)
    for (const n of edges.filter((x) => x.includes('e1:side:s1.c') && !x.includes('e1:cap:start'))) expect(r.body!.names.edges.filter((x) => x === n), n).toHaveLength(1);
    const round = r.body!.names.faces.filter((n) => baseName(n) === 'f1:fillet:{e1:cap:start|e1:side:s1.c}');
    expect(round.length).toBeGreaterThan(1);
    expect(r.body!.names.faces.every((n) => baseName(n) === n || round.includes(n))).toBe(true);
  });

  it('a sketch on a face beside the cut finds it by name', () => {
    const r = regen.rebuild(build(...rounded(), sketch('s2', face('e1:cap:start'), line('q', 5, 5, 10, 5)), sketch('s3', face('e1:cap:end'), line('p', 5, 5, 10, 5))));
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'f1=ok', 's2=ok', 's3=ok']);
  });

  it('a chamfer of the edge along the wall finds it by name and chamfers all of it', () => {
    const r = regen.rebuild(build(...rounded(), chamfer('ch1', '{e1:cap:end|e1:side:s1.c}')));
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'f1=ok', 'ch1=ok']);
    const v = (x: RebuildResult) => kernel.massProps(x.body!.shape).volume;
    const after = v(r);
    // the solid of the chamfer of the uncut wall's edge made before the fillet, to 1e-5 (measured 8.6e-7 with the edge in pieces: two OCCT
    // approximations in another order; a chamfer of part of the edge would leave 0.125 mm² (0.5 × 0.5 / 2) × its length out). Each rebuild frees the
    // one before.
    const first = regen.rebuild(build(...base(), chamfer('ch1', '{e1:cap:end|e1:side:s1.c}'), fillet('f1', [edge('{e1:cap:start|e1:side:s1.c}')], '1.2')));
    expect(statuses(first).slice(-2)).toEqual(['ch1=ok', 'f1=ok']);
    expect(Math.abs(after - v(first)) / v(first)).toBeLessThan(1e-5);
  });

  it('a fillet of an edge between the wall and a face beside it finds it by name', () => {
    const r = regen.rebuild(build(...rounded(), fillet('f2', [edge('{e1:side:s1.b|e1:side:s1.c}')], '1')));
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 'f1=ok', 'f2=ok']);
  });

  it('one element asked for (dimension, measurement, mate) is found by its name, the wall and the edge along it too', () => {
    const r = regen.rebuild(build(...rounded()));
    for (const ref of [{ kind: 'face' as const, name: 'e1:side:s1.c' }, { kind: 'edge' as const, name: '{e1:cap:end|e1:side:s1.c}' }, { kind: 'face' as const, name: 'e1:cap:start' }]) {
      const found = resolveRef(ref, r.body!.names, r.body!.topology);
      expect(found.ok && found.via, ref.name).toBe('name');
    }
  });
});
