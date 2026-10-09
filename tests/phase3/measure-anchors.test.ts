import { describe, expect, it } from 'vitest';
import { captureVertexAnchor, resolveVertexAnchor } from '../../apps/web/src/state/measureAnchors';

describe('measurement point topology anchors', () => {
  it('captures a picked vertex by persistent name and follows it when its point moves', () => {
    const names = ['featureA:vertex:0', 'featureB:vertex:0'];
    const points = [0, 0, 0, 10, 0, 0];
    const anchor = captureVertexAnchor(names, points, [0, 0, 0]);
    expect(anchor).toEqual({ name: 'featureA:vertex:0', point: [0, 0, 0] });
    expect(resolveVertexAnchor(names, [3, 0, 0, 10, 0, 0], anchor!.name)).toEqual([3, 0, 0]);
  });

  it('does not attach a free point or silently rebind a removed vertex', () => {
    expect(captureVertexAnchor(['v'], [0, 0, 0], [1, 0, 0])).toBeNull();
    expect(resolveVertexAnchor([], [], 'removed')).toBeNull();
  });
});
