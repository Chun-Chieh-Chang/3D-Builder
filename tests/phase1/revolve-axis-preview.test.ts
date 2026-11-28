import { describe, expect, it } from 'vitest';
import {
  SKETCH_AXIS_H,
  SKETCH_AXIS_V,
  type Axis3,
  type Feature,
  type Id,
  type PlaneFrame,
  type Ref,
} from '@3db/model';
import type { SolvedGeometry } from '@3db/sketch';
import { resolveActiveRotationAxis } from '../../apps/web/src/state/axisPreview';
import type { RebuildPayload } from '../../apps/web/src/worker/protocol';

const FRONT: PlaneFrame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const TILTED: PlaneFrame = {
  origin: [10, -5, 20],
  xDir: [0, 0, -1],
  yDir: [0, 1, 0],
  normal: [1, 0, 0],
};

function makePayload(opts: {
  frames?: [Id, PlaneFrame][];
  sketches?: [Id, [Id, SolvedGeometry][]][];
  axes?: [Id, Axis3][];
  edges?: { name: string; fp: Ref['fingerprint'] }[];
} = {}): RebuildPayload {
  return {
    seq: 1,
    features: [],
    bodies: [],
    mesh: null,
    faceNames: [],
    faceFingerprints: [],
    edgeNames: (opts.edges ?? []).map((e) => e.name),
    edgeFingerprints: (opts.edges ?? []).map((e) => e.fp!),
    vertexNames: [],
    vertexPoints: new Float32Array(0),
    vertexFingerprints: [],
    faceColors: [],
    frames: new Map(opts.frames ?? []),
    axes: new Map(opts.axes ?? []),
    points: new Map(),
    systems: new Map(),
    sketchGeometry: new Map((opts.sketches ?? []).map(([id, entries]) => [id, new Map(entries)])),
    cosmeticThreads: [],
    meshes: [],
    mass: null,
    totalMs: 0,
    heapBytes: null,
    trapsAbsorbed: 0,
    heapBase: null,
  };
}

describe('resolveActiveRotationAxis', () => {
  it('resolves a revolve sketch line on the front plane and on an offset/rotated frame', () => {
    const geom: [Id, SolvedGeometry][] = [
      ['p0', { type: 'point', p: [5, -10] }],
      ['p1', { type: 'point', p: [5, 25] }],
      ['p2', { type: 'point', p: [20, 25] }],
      ['l1', { type: 'line', a: [5, -10], b: [5, 25], p1: 'p0', p2: 'p1', construction: true }],
      ['l2', { type: 'line', a: [5, 25], b: [20, 25], p1: 'p1', p2: 'p2', construction: false }],
    ];
    const revolve: Feature = {
      id: 'rev1',
      type: 'revolve',
      name: '旋轉1',
      suppressed: false,
      sketch: 'sk1',
      axis: 'l1',
      op: 'boss',
      dir1: { type: 'blind', angle: '360' },
    };

    const frontRes = resolveActiveRotationAxis(revolve, makePayload({ frames: [['sk1', FRONT]], sketches: [['sk1', geom]] }));
    expect(frontRes).toEqual({
      origin: [5, -10, 0],
      dir: [0, 1, 0],
      span: [0, 35],
      sketchId: 'sk1',
      sketchLineId: 'l1',
    });

    const tiltedRes = resolveActiveRotationAxis(revolve, makePayload({ frames: [['sk1', TILTED]], sketches: [['sk1', geom]] }));
    // TILTED: origin=(10,-5,20), xDir=(0,0,-1), yDir=(0,1,0) -> (5,-10) maps to (10, -15, 15), dir=(0,1,0)
    expect(tiltedRes).toEqual({
      origin: [10, -15, 15],
      dir: [0, 1, 0],
      span: [0, 35],
      sketchId: 'sk1',
      sketchLineId: 'l1',
    });
  });

  it('resolves revolve using SKETCH_AXIS_H and SKETCH_AXIS_V with sketch span', () => {
    const geom: [Id, SolvedGeometry][] = [
      ['c1', { type: 'circle', c: [15, 10], r: 4, center: 'pc', construction: false }],
    ];
    const payload = makePayload({ frames: [['sk1', TILTED]], sketches: [['sk1', geom]] });

    const h = resolveActiveRotationAxis(
      { id: 'revH', type: 'revolve', name: 'r', suppressed: false, sketch: 'sk1', axis: SKETCH_AXIS_H, op: 'boss', dir1: { type: 'blind', angle: '360' } },
      payload,
    );
    expect(h).toEqual({ origin: [10, -5, 20], dir: [0, 0, -1], span: [11, 19], sketchId: 'sk1' });
    expect(h?.sketchLineId).toBeUndefined();

    const v = resolveActiveRotationAxis(
      { id: 'revV', type: 'revolve', name: 'r', suppressed: false, sketch: 'sk1', axis: SKETCH_AXIS_V, op: 'boss', dir1: { type: 'blind', angle: '360' } },
      payload,
    );
    expect(v).toEqual({ origin: [10, -5, 20], dir: [0, 1, 0], span: [6, 14], sketchId: 'sk1' });
    expect(v?.sketchLineId).toBeUndefined();
  });

  it('returns null without NaN for degenerate zero-length or missing sketch line', () => {
    const geom: [Id, SolvedGeometry][] = [
      ['l0', { type: 'line', a: [3, 4], b: [3, 4], p1: 'p1', p2: 'p2', construction: true }],
    ];
    const payload = makePayload({ frames: [['sk1', FRONT]], sketches: [['sk1', geom]] });
    expect(resolveActiveRotationAxis(
      { id: 'r1', type: 'revolve', name: 'r1', suppressed: false, sketch: 'sk1', axis: 'l0', op: 'boss', dir1: { type: 'blind', angle: '360' } },
      payload,
    )).toBeNull();
    expect(resolveActiveRotationAxis(
      { id: 'r2', type: 'revolve', name: 'r2', suppressed: false, sketch: 'sk1', axis: 'missing', op: 'boss', dir1: { type: 'blind', angle: '360' } },
      payload,
    )).toBeNull();
  });

  it('resolves thread axes across sketch line, principal datum, refAxis datum, straight edge, and face', () => {
    const geom: [Id, SolvedGeometry][] = [
      ['l1', { type: 'line', a: [0, 0], b: [0, 20], p1: 'p1', p2: 'p2', construction: true }],
    ];
    const payload = makePayload({
      frames: [['sk1', FRONT]],
      sketches: [['sk1', geom]],
      axes: [['ax1', { origin: [2, 3, 4], dir: [0, 3, 4] }]],
      edges: [{ name: 'e1:side', fp: { type: 'line', size: 24, center: [10, 0, 0], dir: [0, 0, 2] } }],
    });

    const base = { id: 'th1', type: 'thread' as const, name: '螺紋1', suppressed: false, sketch: 'sk1', pitch: '2', op: 'cut' as const, hand: 'right' as const, length: '10' };
    expect(resolveActiveRotationAxis({ ...base, axis: 'l1' }, payload)).toEqual({
      origin: [0, 0, 0],
      dir: [0, 1, 0],
      span: [0, 20],
      sketchId: 'sk1',
      sketchLineId: 'l1',
    });
    expect(resolveActiveRotationAxis({ ...base, axis: 'axis:z' }, payload)).toEqual({
      origin: [0, 0, 0],
      dir: [0, 0, 1],
    });
    expect(resolveActiveRotationAxis({ ...base, axis: { kind: 'datum', name: 'ax1' } }, payload)).toEqual({
      origin: [2, 3, 4],
      dir: [0, 0.6, 0.8],
      datumId: 'ax1',
    });
    expect(resolveActiveRotationAxis({ ...base, axis: { kind: 'edge', name: 'e1:side' } }, payload)).toEqual({
      origin: [10, 0, 0],
      dir: [0, 0, 1],
      span: [-12, 12],
    });
    expect(resolveActiveRotationAxis({ ...base, axis: { kind: 'face', name: 'f1:cyl', fingerprint: { type: 'cylinder', size: 100, center: [0, 0, 0] } } }, payload)).toBeNull();
  });

  it('resolves knurl axes across principal datum, refAxis datum, and straight edge', () => {
    const payload = makePayload({
      axes: [['ax1', { origin: [0, 0, 5], dir: [1, 0, 0] }]],
      edges: [{ name: 'e1', fp: { type: 'line', size: 16, center: [1, 2, 3], dir: [0, 1, 0] } }],
    });
    const base = {
      id: 'kn1',
      type: 'knurl' as const,
      name: '壓花1',
      suppressed: false,
      pattern: 'straight' as const,
      diameter: '20',
      length: '10',
      count: '24',
      depth: '0.5',
    };
    expect(resolveActiveRotationAxis({ ...base, axis: { kind: 'datum', name: 'axis:y' } }, payload)).toEqual({ origin: [0, 0, 0], dir: [0, 1, 0] });
    expect(resolveActiveRotationAxis({ ...base, axis: { kind: 'datum', name: 'ax1' } }, payload)).toEqual({ origin: [0, 0, 5], dir: [1, 0, 0], datumId: 'ax1' });
    expect(resolveActiveRotationAxis({ ...base, axis: { kind: 'edge', name: 'e1' } }, payload)).toEqual({ origin: [1, 2, 3], dir: [0, 1, 0], span: [-8, 8] });
  });

  it('resolves moveCopyBody only when rotation axis or non-zero rotation angle is set', () => {
    const payload = makePayload();
    const base = { id: 'mc1', type: 'moveCopyBody' as const, name: '移動1', suppressed: false, targets: [{ kind: 'body' as const, name: 'b1' }] };
    expect(resolveActiveRotationAxis({ ...base, dx: '10', rotationAngle: '0' }, payload)).toBeNull();
    expect(resolveActiveRotationAxis({ ...base, rotationAxis: 'x' }, payload)).toEqual({ origin: [0, 0, 0], dir: [1, 0, 0] });
    expect(resolveActiveRotationAxis({ ...base, rotationAngle: '45deg' }, payload)).toEqual({ origin: [0, 0, 0], dir: [0, 0, 1] });
  });

  it('resolves circular pattern and angle reference plane axes', () => {
    const payload = makePayload({
      axes: [['ax1', { origin: [4, 0, 0], dir: [0, 0, 1] }]],
      edges: [{ name: 'e1', fp: { type: 'line', size: 10, center: [0, 0, 0], dir: [1, 0, 0] } }],
    });

    const circular: Feature = {
      id: 'pat1',
      type: 'pattern',
      name: '陣列1',
      suppressed: false,
      seeds: ['f1'],
      def: { mode: 'circular', axis: { kind: 'datum', name: 'ax1' }, count: '6', angle: '360', equal: true },
    };
    expect(resolveActiveRotationAxis(circular, payload)).toEqual({ origin: [4, 0, 0], dir: [0, 0, 1], datumId: 'ax1' });

    const anglePlane: Feature = {
      id: 'pl1',
      type: 'refPlane',
      name: '基準面1',
      suppressed: false,
      def: { mode: 'angle', plane: { kind: 'datum', name: 'plane:front' }, axis: { kind: 'edge', name: 'e1' }, angle: '45' },
    };
    expect(resolveActiveRotationAxis(anglePlane, payload)).toEqual({ origin: [0, 0, 0], dir: [1, 0, 0], span: [-5, 5] });
  });

  it('returns null for non-axis features or undefined', () => {
    const payload = makePayload();
    expect(resolveActiveRotationAxis(undefined, payload)).toBeNull();
    expect(resolveActiveRotationAxis(
      { id: 'ex1', type: 'extrude', name: '伸長1', suppressed: false, sketch: 'sk1', op: 'boss', dir1: { type: 'blind', depth: '10' } },
      payload,
    )).toBeNull();
  });
});
