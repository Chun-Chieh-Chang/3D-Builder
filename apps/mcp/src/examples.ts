/**
 * A worked example for the agent (ADR 0237): a 60 × 40 × 10 plate with a Ø10 hole through its middle, as the commands `apply_commands` takes. It is
 * written out in full, with literal ids, so that it reads as what the agent writes. The cut is on a datum plane, so it goes into the material only with
 * `reverse` (AGENTS.md 2026-11-02: on a model face a cut goes into the material by default). The tests build it through the server and check its volume
 * against 60·40·10 − π·5²·10, so the example cannot go stale without a test failing.
 */
import type { Command } from '@3db/model';

export const PLATE_WITH_HOLE: Command[] = [
  {
    type: 'insertFeature',
    index: 0,
    feature: {
      id: 's1',
      type: 'sketch',
      name: 'Plate sketch',
      suppressed: false,
      plane: { kind: 'datum', name: 'plane:top' },
      entities: [
        { id: 'p0', type: 'point', x: -30, y: -20 },
        { id: 'p1', type: 'point', x: 30, y: -20 },
        { id: 'p2', type: 'point', x: 30, y: 20 },
        { id: 'p3', type: 'point', x: -30, y: 20 },
        { id: 'l0', type: 'line', p1: 'p0', p2: 'p1' },
        { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
        { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' },
        { id: 'l3', type: 'line', p1: 'p3', p2: 'p0' },
      ],
      constraints: [
        { id: 'h0', type: 'horizontal', a: 'l0' },
        { id: 'v1', type: 'vertical', a: 'l1' },
        { id: 'h2', type: 'horizontal', a: 'l2' },
        { id: 'v3', type: 'vertical', a: 'l3' },
        { id: 'w', type: 'distance', a: 'l0', value: '60' },
        { id: 'd', type: 'distance', a: 'l1', value: '40' },
        // the rectangle is centred on the origin: its opposite corners are symmetric about it
        { id: 'cx', type: 'distanceX', a: 'p0', b: '@origin', value: '30' },
        { id: 'cy', type: 'distanceY', a: 'p0', b: '@origin', value: '20' },
      ],
    },
  },
  { type: 'insertFeature', index: 1, feature: { id: 'e1', type: 'extrude', name: 'Plate', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: '10' } } },
  {
    type: 'insertFeature',
    index: 2,
    feature: {
      id: 's2',
      type: 'sketch',
      name: 'Hole sketch',
      suppressed: false,
      plane: { kind: 'datum', name: 'plane:top' },
      entities: [
        { id: 'hc', type: 'point', x: 0, y: 0 },
        { id: 'hole', type: 'circle', center: 'hc', radius: 5 },
      ],
      constraints: [
        { id: 'hr', type: 'radius', circle: 'hole', value: '5' },
        { id: 'ho', type: 'coincident', a: 'hc', b: '@origin' },
      ],
    },
  },
  { type: 'insertFeature', index: 3, feature: { id: 'c1', type: 'extrude', name: 'Hole', suppressed: false, sketch: 's2', op: 'cut', dir1: { type: 'throughAll', reverse: true } } },
];

/** What the example's volume must be, worked out by hand. */
export const PLATE_WITH_HOLE_VOLUME = 60 * 40 * 10 - Math.PI * 5 * 5 * 10;
