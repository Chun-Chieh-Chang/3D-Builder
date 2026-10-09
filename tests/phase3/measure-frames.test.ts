import { describe, expect, it } from 'vitest';
import type { CoordSystem, Pose } from '@3db/model';
import { placeMeasureFrame } from '../../apps/web/src/state/measureFrames';

describe('measurement frames in an assembly', () => {
  it('places a component coordinate system through its translated, rotated, and mirrored pose', () => {
    const system: CoordSystem = { origin: [2, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    const pose: Pose = { position: [10, 3, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
    expect(placeMeasureFrame(system, pose, false)).toEqual({ origin: [10, 5, 0], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] });
    expect(placeMeasureFrame(system, pose, true)).toEqual({ origin: [10, 1, 0], axes: [[0, -1, 0], [-1, 0, 0], [0, 0, 1]] });
  });
});
