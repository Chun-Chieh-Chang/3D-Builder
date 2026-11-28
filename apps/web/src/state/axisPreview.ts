import { SKETCH_AXIS_H, sketchAxisDir, type Feature, type Id, type PlaneFrame, type Ref, type Vec3 } from '@3db/model';
import type { SolvedGeometry } from '@3db/sketch';
import type { RebuildPayload } from '../worker/protocol';

/** Resolved 3D rotation axis to visualize in the graphics area while editing a feature. */
export interface ActiveAxisPreview {
  origin: Vec3;
  dir: Vec3;
  /** Optional signed extents along `dir` from `origin` so the drawn axis spans the defining sketch or edge. */
  span?: [number, number];
  /** Set when the axis is a reference axis feature (`refAxis`) so its datum line is emphasized in-place. */
  datumId?: Id;
  /** Set when the axis lives in a sketch so the source sketch is temporarily shown during editing. */
  sketchId?: Id;
  /** Specific sketch line entity id (absent when using `@axisH` / `@axisV`). */
  sketchLineId?: Id;
}

const toWorld = (frame: PlaneFrame, p: readonly [number, number]): Vec3 => [
  frame.origin[0] + frame.xDir[0] * p[0] + frame.yDir[0] * p[1],
  frame.origin[1] + frame.xDir[1] * p[0] + frame.yDir[1] * p[1],
  frame.origin[2] + frame.xDir[2] * p[0] + frame.yDir[2] * p[1],
];

const unit3 = (v: Vec3): Vec3 | null => {
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) return null;
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-9)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
};

const projectPoint = (origin: Vec3, dir: Vec3, p: Vec3): number =>
  (p[0] - origin[0]) * dir[0] + (p[1] - origin[1]) * dir[1] + (p[2] - origin[2]) * dir[2];

function entityPoints2D(g: SolvedGeometry): [number, number][] {
  switch (g.type) {
    case 'point':
      return [g.p];
    case 'line':
      return [g.a, g.b];
    case 'circle':
      return [
        [g.c[0] - g.r, g.c[1]],
        [g.c[0] + g.r, g.c[1]],
        [g.c[0], g.c[1] - g.r],
        [g.c[0], g.c[1] + g.r],
      ];
    case 'arc': {
      const a0 = [g.c[0] + g.r * Math.cos(g.a0), g.c[1] + g.r * Math.sin(g.a0)] as [number, number];
      const a1 = [g.c[0] + g.r * Math.cos(g.a1), g.c[1] + g.r * Math.sin(g.a1)] as [number, number];
      return [
        g.c,
        a0,
        a1,
        [g.c[0] - g.r, g.c[1]],
        [g.c[0] + g.r, g.c[1]],
        [g.c[0], g.c[1] - g.r],
        [g.c[0], g.c[1] + g.r],
      ];
    }
    case 'ellipse': {
      const c = Math.cos(g.angle);
      const s = Math.sin(g.angle);
      return [
        g.c,
        [g.c[0] + g.majorRadius * c, g.c[1] + g.majorRadius * s],
        [g.c[0] - g.majorRadius * c, g.c[1] - g.majorRadius * s],
        [g.c[0] - g.minorRadius * s, g.c[1] + g.minorRadius * c],
        [g.c[0] + g.minorRadius * s, g.c[1] - g.minorRadius * c],
      ];
    }
    case 'spline':
      return g.points;
    case 'text':
      return [g.at];
  }
}

function sketchSpan(frame: PlaneFrame, geom: Map<Id, SolvedGeometry>, origin: Vec3, dir: Vec3): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const g of geom.values()) {
    for (const p2 of entityPoints2D(g)) {
      const t = projectPoint(origin, dir, toWorld(frame, p2));
      if (!Number.isFinite(t)) continue;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  }
  return lo <= hi ? [lo, hi] : undefined;
}

function fromSketchAxis(sketchId: Id, axisId: Id, result: RebuildPayload | null): ActiveAxisPreview | null {
  const frame = result?.frames.get(sketchId);
  if (!frame) return null;
  const geom = result?.sketchGeometry.get(sketchId);
  if (sketchAxisDir(axisId)) {
    const dir = unit3(axisId === SKETCH_AXIS_H ? frame.xDir : frame.yDir);
    if (!dir) return null;
    const span = geom ? sketchSpan(frame, geom, frame.origin, dir) : undefined;
    return { origin: frame.origin, dir, ...(span ? { span } : {}), sketchId };
  }
  const g = geom?.get(axisId);
  if (g?.type !== 'line') return null;
  const a3 = toWorld(frame, g.a);
  const b3 = toWorld(frame, g.b);
  const dir = unit3([b3[0] - a3[0], b3[1] - a3[1], b3[2] - a3[2]]);
  if (!dir) return null;
  const lineLen = Math.hypot(b3[0] - a3[0], b3[1] - a3[1], b3[2] - a3[2]);
  const span = geom ? sketchSpan(frame, geom, a3, dir) : ([0, lineLen] as [number, number]);
  return { origin: a3, dir, ...(span ? { span } : {}), sketchId, sketchLineId: axisId };
}

const PRINCIPAL_AXES: Record<'axis:x' | 'axis:y' | 'axis:z', Vec3> = {
  'axis:x': [1, 0, 0],
  'axis:y': [0, 1, 0],
  'axis:z': [0, 0, 1],
};

function fromRef(ref: Ref, result: RebuildPayload | null): ActiveAxisPreview | null {
  if (!ref.name) return null;
  if (ref.kind === 'datum') {
    if (ref.name in PRINCIPAL_AXES) {
      return { origin: [0, 0, 0], dir: PRINCIPAL_AXES[ref.name as keyof typeof PRINCIPAL_AXES] };
    }
    const axis = result?.axes.get(ref.name);
    if (!axis) return null;
    const dir = unit3(axis.dir);
    return dir ? { origin: axis.origin, dir, datumId: ref.name } : null;
  }
  if (ref.kind === 'edge') {
    const idx = result?.edgeNames.indexOf(ref.name) ?? -1;
    const fp = idx >= 0 ? result?.edgeFingerprints[idx] : ref.fingerprint;
    if (fp?.type === 'line' && fp.dir) {
      const dir = unit3(fp.dir);
      if (!dir) return null;
      const half = Number.isFinite(fp.size) && fp.size > 0 ? fp.size / 2 : 0;
      return { origin: fp.center, dir, ...(half > 0 ? { span: [-half, half] as [number, number] } : {}) };
    }
  }
  return null;
}

/**
 * Resolves the 3D rotation axis of the feature currently being edited, so the viewport can render it clearly over
 * any solid geometry (even when embedded inside a revolved body or when its source sketch is absorbed).
 */
export function resolveActiveRotationAxis(feature: Feature | undefined, result: RebuildPayload | null): ActiveAxisPreview | null {
  if (!feature) return null;
  switch (feature.type) {
    case 'revolve':
      return fromSketchAxis(feature.sketch, feature.axis, result);
    case 'thread':
      if (typeof feature.axis === 'string') {
        if (feature.axis in PRINCIPAL_AXES) return fromRef({ kind: 'datum', name: feature.axis }, result);
        return feature.sketch ? fromSketchAxis(feature.sketch, feature.axis, result) : null;
      }
      return fromRef(feature.axis, result);
    case 'knurl':
      return fromRef(feature.axis, result);
    case 'moveCopyBody': {
      const hasAngle = feature.rotationAngle !== undefined && feature.rotationAngle.trim() !== '' && feature.rotationAngle.trim() !== '0';
      if (feature.rotationAxis === undefined && !hasAngle) return null;
      if (typeof feature.rotationAxis === 'object') return fromRef(feature.rotationAxis, result);
      const axisKey = feature.rotationAxis ?? 'z';
      return fromRef({ kind: 'datum', name: `axis:${axisKey}` }, result);
    }
    case 'pattern':
      return feature.def.mode === 'circular' ? fromRef(feature.def.axis, result) : null;
    case 'refPlane':
      return feature.def.mode === 'angle' ? fromRef(feature.def.axis, result) : null;
    default:
      return null;
  }
}
