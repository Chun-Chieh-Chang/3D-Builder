import { describe, expect, it } from 'vitest';
import { accepts, pickable, put, treePick } from '../../apps/web/src/state/datumSlots';
import type { Feature, HelixFeature, PartDoc, Ref, SketchFeature } from '@3db/model';

// The selection boxes (datumSlots) that the PropertyManager, the clicks in the graphics area and in the tree all go through. A plain module, so it is
// exercised here in `node`. The graphics area once spread `chosen()` (arrays) over `pickable()` (booleans) under the same keys, and an empty array is
// truthy, so every box picked everything and `pickable` was never read; that hid a curve path that did not open edges at all.
const sketch = (id: string): SketchFeature => ({ id, type: 'sketch', name: id, suppressed: false, plane: { kind: 'datum', name: 'plane:top' }, entities: [], constraints: [] }) as unknown as SketchFeature;
const helix = (circle: Ref): HelixFeature => ({ id: 'hx', type: 'helix', name: 'hx', suppressed: false, definedBy: 'pitchAndRev', circle, pitch: '5', revolutions: '4' });
const doc = (...features: Feature[]): PartDoc => ({ features }) as unknown as PartDoc;
const edge = (type: string, name = 'e1'): Ref => ({ kind: 'edge', name, fingerprint: { type, size: 1, center: [0, 0, 0] } });
const empty: Ref = { kind: 'edge', name: '' };

describe('the selection boxes (datumSlots)', () => {
  it('opens edges, and only edges, for the boxes that take a curve or a circle', () => {
    const curvePattern = { id: 'p', type: 'pattern', name: 'p', suppressed: false, seeds: [], def: { mode: 'curve', path: empty, count: '4', spacing: '10', equal: true, alignment: 'tangent' } } as unknown as Feature;
    expect(pickable(curvePattern)).toEqual({ edges: true, faces: false, vertices: false, planes: false });
    expect(pickable(helix(empty))).toEqual({ edges: true, faces: false, vertices: false, planes: false });
    const mirror = { id: 'm', type: 'mirror', name: 'm', suppressed: false, plane: { kind: 'face', name: '' }, seeds: [] } as unknown as Feature;
    expect(pickable(mirror)).toEqual({ edges: false, faces: true, vertices: false, planes: true });
  });

  it("takes a circular edge or a sketch into a helix's circle box, and nothing else", () => {
    const d = doc(sketch('sk1'), helix(empty));
    expect(accepts('circle', edge('circle'), d)).toBe(true);
    expect(accepts('circle', edge('line'), d)).toBe(false);
    expect(accepts('circle', { kind: 'datum', name: 'sk1' }, d)).toBe(true);
    expect(accepts('circle', { kind: 'datum', name: 'plane:top' }, d)).toBe(false);
    expect(accepts('circle', { kind: 'face', name: 'f1', fingerprint: { type: 'cylinder', size: 1, center: [0, 0, 0] } }, d)).toBe(false);
  });

  it('puts a click into the helix box, replacing what is there, through setHelix', () => {
    const d = doc(sketch('sk1'), helix({ kind: 'datum', name: 'sk1' }));
    const r = put(d.features[1]!, d, edge('circle', 'top'));
    expect(r && 'command' in r ? r.command : r).toEqual({ type: 'setHelix', featureId: 'hx', params: { circle: edge('circle', 'top') } });
    expect(put(d.features[1]!, d, edge('line'))).toBeNull();
  });

  it('gives a tree click on a sketch to a box that takes sketches, and not to one that does not', () => {
    const d = doc(sketch('sk1'), helix(empty));
    expect(treePick(d.features[1]!, d, 'sk1')).toEqual({ kind: 'datum', name: 'sk1' });
    const mirror = { id: 'm', type: 'mirror', name: 'm', suppressed: false, plane: { kind: 'face', name: '' }, seeds: [] } as unknown as Feature;
    expect(treePick(mirror, doc(sketch('sk1'), mirror), 'sk1')).toBeNull();
    expect(treePick(mirror, doc(sketch('sk1'), mirror), 'plane:top')).toEqual({ kind: 'datum', name: 'plane:top' });
  });
});
