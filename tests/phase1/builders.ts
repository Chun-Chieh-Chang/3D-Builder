/** Document builders shared by the Phase 1 tests: fully defined sketches and features, all by name. */
import { expect } from 'vitest';
import { applyCommand, createEmptyPart, type Command, type Feature, type PartDoc, type Ref, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import type { RebuildResult } from '@3db/regen';

export type SketchParts = Pick<SketchFeature, 'entities' | 'constraints'>;

export const front: Ref = { kind: 'datum', name: 'plane:front' };
export const face = (name: string): Ref => ({ kind: 'face', name });
export const edge = (name: string, fingerprint?: Ref['fingerprint']): Ref => ({ kind: 'edge', name, ...(fingerprint ? { fingerprint } : {}) });

/** Pins a sketch point like SolidWorks: coincident with the origin, aligned with it, or a (positive) distance. */
export function pin(id: string, point: string, x: number, y: number): SketchParts['constraints'] {
  if (x === 0 && y === 0) return [{ id: `${id}o`, type: 'coincident', a: point, b: '@origin' }];
  return [
    x === 0 ? { id: `${id}x`, type: 'vertical', a: point, b: '@origin' } : { id: `${id}x`, type: 'distanceX', a: '@origin', b: point, value: String(Math.abs(x)) },
    y === 0 ? { id: `${id}y`, type: 'horizontal', a: point, b: '@origin' } : { id: `${id}y`, type: 'distanceY', a: '@origin', b: point, value: String(Math.abs(y)) },
  ];
}

/** A fully defined line between two points. */
export function line(id: string, x1: number, y1: number, x2: number, y2: number, construction = false): SketchParts {
  return {
    entities: [
      { id: `${id}p1`, type: 'point', x: x1, y: y1 },
      { id: `${id}p2`, type: 'point', x: x2, y: y2 },
      { id, type: 'line', p1: `${id}p1`, p2: `${id}p2`, construction },
    ],
    constraints: [
      ...pin(`${id}p1`, `${id}p1`, x1, y1),
      ...pin(`${id}p2`, `${id}p2`, x2, y2),
    ],
  };
}

/** A fully defined w × h rectangle with its lower-left corner at (x, y); lines `${id}l0` bottom, l1 right, l2 top, l3 left. */
export function rectangle(id: string, x: number, y: number, w: number, h: number): SketchParts {
  const c: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return {
    entities: [
      ...c.map(([px, py], i) => ({ id: `${id}p${i}`, type: 'point', x: px, y: py }) as const),
      ...[0, 1, 2, 3].map((i) => ({ id: `${id}l${i}`, type: 'line', p1: `${id}p${i}`, p2: `${id}p${(i + 1) % 4}` }) as const),
    ],
    constraints: [
      { id: `${id}h0`, type: 'horizontal', a: `${id}l0` },
      { id: `${id}v1`, type: 'vertical', a: `${id}l1` },
      { id: `${id}h2`, type: 'horizontal', a: `${id}l2` },
      { id: `${id}v3`, type: 'vertical', a: `${id}l3` },
      { id: `${id}w`, type: 'distance', a: `${id}l0`, value: String(w) },
      { id: `${id}d`, type: 'distance', a: `${id}l1`, value: String(h) },
      ...pin(id, `${id}p0`, x, y),
    ],
  };
}

/** A fully defined circle `id` with center `${id}c`. */
export function circle(id: string, cx: number, cy: number, r: number): SketchParts {
  return {
    entities: [
      { id: `${id}c`, type: 'point', x: cx, y: cy },
      { id, type: 'circle', center: `${id}c`, radius: r },
    ],
    constraints: [{ id: `${id}r`, type: 'radius', circle: id, value: String(r) }, ...pin(id, `${id}c`, cx, cy)],
  };
}

/** A fully defined ellipse `id` with center `${id}c`, major axis point `${id}m`, and minor radius `minorR`. */
export function ellipse(id: string, cx: number, cy: number, majorX: number, majorY: number, minorR: number): SketchParts {
  return {
    entities: [
      { id: `${id}c`, type: 'point', x: cx, y: cy },
      { id: `${id}m`, type: 'point', x: majorX, y: majorY },
      { id, type: 'ellipse', center: `${id}c`, major: `${id}m`, minorRadius: minorR },
    ],
    constraints: [
      ...pin(id, `${id}c`, cx, cy),
      ...pin(`${id}m`, `${id}m`, majorX, majorY),
    ],
  };
}

/** A fully defined spline `id` passing through point coordinates `coords: [x, y][]`. */
export function spline(id: string, coords: [number, number][], closed = false): SketchParts {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const pointIds: string[] = [];
  coords.forEach(([x, y], i) => {
    const pid = `${id}p${i}`;
    pointIds.push(pid);
    entities.push({ id: pid, type: 'point', x, y });
    constraints.push(...pin(pid, pid, x, y));
  });
  entities.push({ id, type: 'spline', points: pointIds, closed });
  return { entities, constraints };
}

/** A fully defined sketch text `id` at (x, y). */
export function sketchText(id: string, x: number, y: number, text: string, size = 10, angle = 0, align: 'left' | 'center' | 'right' = 'left', construction = false): SketchParts {
  const atId = `${id}at`;
  return {
    entities: [
      { id: atId, type: 'point', x, y },
      { id, type: 'text', at: atId, text, size, angle, align, construction },
    ],
    constraints: [...pin(atId, atId, x, y)],
  };
}

export const sketch = (id: string, plane: Ref, ...parts: SketchParts[]): Feature => ({
  id,
  type: 'sketch',
  name: id,
  suppressed: false,
  plane,
  entities: parts.flatMap((p) => p.entities),
  constraints: parts.flatMap((p) => p.constraints),
});

export const extrude = (id: string, sketchId: string, op: 'boss' | 'cut', dir1: Extract<Feature, { type: 'extrude' }>['dir1']): Feature => ({ id, type: 'extrude', name: id, suppressed: false, sketch: sketchId, op, dir1 });

export const revolve = (id: string, sketchId: string, axis: string, op: 'boss' | 'cut' = 'boss', angle = '360'): Feature => ({
  id,
  type: 'revolve',
  name: id,
  suppressed: false,
  sketch: sketchId,
  axis,
  op,
  dir1: { type: 'blind', angle },
});

export const fillet = (id: string, edges: Ref[], radius = '2'): Feature => ({ id, type: 'fillet', name: id, suppressed: false, edges, radius });

export function build(...features: Feature[]): PartDoc {
  return features.reduce<PartDoc>((doc, feature, index) => applyCommand(doc, { type: 'insertFeature', feature, index } satisfies Command), createEmptyPart());
}

export const statuses = (r: RebuildResult) => r.features.map((f) => `${f.id}=${f.status}${f.message ? `(${f.message})` : ''}`);

export function faceNamed(r: RebuildResult, name: string) {
  const i = r.body!.names.faces.indexOf(name);
  expect(i, `face ${name} in ${r.body!.names.faces.join(', ')}`).toBeGreaterThanOrEqual(0);
  return r.body!.topology.faces[i]!;
}
