/**
 * 2D-to-3D projection back-verification (`part_verify_against_2d`):
 * Projects the open 3D solid onto the requested orthographic views via the real OCCT kernel and verifies each 2D engineering drawing callout
 * (overall width/height, diameters, radii, angles, pairwise feature distances, and optional feature counts) against the actual projected geometry.
 */
import { viewVectors, type ViewFeature } from '@3db/model';
import { holeFeatures, projectDrawingView, sketchTextPrefixes, viewFeatures } from '@3db/regen';
import { AgentError, type CadSession } from './session';

const ORTHO_VIEWS = ['front', 'back', 'top', 'bottom', 'left', 'right'] as const;
const CHECK_KINDS = ['width', 'height', 'diameter', 'radius', 'angle', 'distance'] as const;
const IDENTITY = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };

export type OrthoViewName = (typeof ORTHO_VIEWS)[number];
export type Verify2dKind = (typeof CHECK_KINDS)[number];

export interface Verify2dCheck {
  label: string;
  view: OrthoViewName;
  kind: Verify2dKind;
  nominal: number;
  tolerance?: number;
  count?: number;
  axis?: 'x' | 'y';
}

export interface Verify2dCheckResult {
  label: string;
  view: OrthoViewName;
  kind: Verify2dKind;
  nominal: number;
  tolerance: number;
  measured: number | null;
  error: number | null;
  expectedCount?: number;
  matchedCount?: number;
  pass: boolean;
  reason?: string;
}

/**
 * The edges of a mesh that one triangle alone uses, its vertices welded by position (to 1e-4 mm): the holes of a surface that should be closed. A face
 * that is triangulated but torn (ADR 0214: a fillet face with an edge 18 mm off it, 24 such edges) is not seen by counting the faces that have triangles;
 * this is the oracle tests/phase3/fillet-tolerance.test.ts uses, nothing of the kernel's own judgement.
 */
export function openMeshEdges(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }): number {
  const ids = new Map<string, number>();
  const vid = (k: number) => {
    const key = `${Math.round(mesh.positions[3 * k]! * 1e4)},${Math.round(mesh.positions[3 * k + 1]! * 1e4)},${Math.round(mesh.positions[3 * k + 2]! * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const use = new Map<string, number>();
  for (let tr = 0; tr < mesh.indices.length / 3; tr++) {
    const v = [vid(mesh.indices[3 * tr]!), vid(mesh.indices[3 * tr + 1]!), vid(mesh.indices[3 * tr + 2]!)];
    for (let k = 0; k < 3; k++) {
      const a = v[k]!, b = v[(k + 1) % 3]!;
      // a triangle squeezed to an edge (a pole, a cone's apex) has no side between two welded corners
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of use.values()) if (n === 1) open++;
  return open;
}

export interface Verify2dReport {
  pass: boolean;
  passed: number;
  failed: number;
  total: number;
  maxAbsError: number;
  meshIntegrity: {
    totalFaces: number;
    triangulatedFaces: number;
    unmeshedFaces: number[];
    /** Edges of the mesh one triangle alone uses (welded to 1e-4 mm): holes in a surface that should be closed. */
    openEdges: number;
    pass: boolean;
  };
  results: Verify2dCheckResult[];
  views: Record<string, { width: number; height: number }>;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Strict input validation (zero silent coercion or rounding). */
export function parseVerify2dChecks(raw: unknown): Verify2dCheck[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new AgentError('checks must be a non-empty array of 2D drawing checks');
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new AgentError(`checks[${idx}] must be an object`);
    const o = item as Record<string, unknown>;
    if (typeof o.label !== 'string' || o.label.trim() === '') throw new AgentError(`checks[${idx}].label must be a non-empty string`);
    if (typeof o.view !== 'string' || !ORTHO_VIEWS.includes(o.view as OrthoViewName)) {
      throw new AgentError(`checks[${idx}].view must be one of ${ORTHO_VIEWS.join(', ')}, not ${JSON.stringify(o.view)}`);
    }
    if (typeof o.kind !== 'string' || !CHECK_KINDS.includes(o.kind as Verify2dKind)) {
      throw new AgentError(`checks[${idx}].kind must be one of ${CHECK_KINDS.join(', ')}, not ${JSON.stringify(o.kind)}`);
    }
    const kind = o.kind as Verify2dKind;
    if (typeof o.nominal !== 'number' || !Number.isFinite(o.nominal) || o.nominal <= 0) {
      throw new AgentError(`checks[${idx}].nominal must be a finite positive number, not ${JSON.stringify(o.nominal)}`);
    }
    if (kind === 'angle' && o.nominal >= 180) {
      throw new AgentError(`checks[${idx}].nominal for angle must be in (0, 180), not ${o.nominal}`);
    }
    let tolerance: number | undefined;
    if (o.tolerance !== undefined) {
      if (typeof o.tolerance !== 'number' || !Number.isFinite(o.tolerance) || o.tolerance <= 0) {
        throw new AgentError(`checks[${idx}].tolerance must be a finite positive number, not ${JSON.stringify(o.tolerance)}`);
      }
      tolerance = o.tolerance;
    }
    let count: number | undefined;
    if (o.count !== undefined) {
      if (typeof o.count !== 'number' || !Number.isInteger(o.count) || o.count < 1) {
        throw new AgentError(`checks[${idx}].count must be a positive integer, not ${JSON.stringify(o.count)}`);
      }
      count = o.count;
    }
    let axis: 'x' | 'y' | undefined;
    if (kind === 'distance') {
      if (o.axis !== 'x' && o.axis !== 'y') {
        throw new AgentError(`checks[${idx}].axis must be 'x' or 'y' for kind='distance', not ${JSON.stringify(o.axis)}`);
      }
      axis = o.axis;
    } else if (o.axis !== undefined) {
      throw new AgentError(`checks[${idx}].axis is only valid for kind='distance'`);
    }
    return {
      label: o.label.trim(),
      view: o.view as OrthoViewName,
      kind,
      nominal: o.nominal,
      ...(tolerance !== undefined ? { tolerance } : {}),
      ...(count !== undefined ? { count } : {}),
      ...(axis !== undefined ? { axis } : {}),
    };
  });
}

function nearestCandidate(values: readonly number[], target: number): number | null {
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const v of values) {
    const d = Math.abs(v - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = v;
    }
  }
  return best;
}

function diameterValues(features: readonly ViewFeature[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const f of features) {
    if (f.type === 'circle' && f.full) {
      const k = f.surface ?? f.ref.name;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(2 * f.radius);
    }
  }
  for (const f of features) {
    if (f.type === 'axis' && !f.cone) {
      const k = f.surface ?? f.ref.name;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(2 * f.radius);
    } else if (f.type === 'centre') {
      // End-on drafted circular bosses/skirts/ports (cones) report their base/max diameter via `type: 'centre'`
      const k = f.ref.name;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(2 * f.radius);
    }
  }
  return out;
}

function radiusValues(features: readonly ViewFeature[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const f of features) {
    if (f.type === 'torus' || (f.type === 'circle' && (!f.full || f.sphere))) {
      const k = f.surface ?? f.ref.name;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f.radius);
    }
  }
  return out;
}

function angleMatches(features: readonly ViewFeature[], nominal: number, tol: number): { nearest: number | null; matched: number } {
  const seen = new Set<string>();
  let nearest: number | null = null;
  let bestDiff = Infinity;
  let matched = 0;
  for (const f of features) {
    if (f.type !== 'slant') continue;
    if (seen.has(f.ref.name)) continue;
    seen.add(f.ref.name);
    const acute = f.cone
      ? (Math.atan2(f.cone.radial, f.cone.axial) * 180) / Math.PI
      : (Math.asin(Math.min(1, Math.min(Math.abs(f.dir[0]), Math.abs(f.dir[1])))) * 180) / Math.PI;
    const comp = 90 - acute;
    const chosen = Math.abs(acute - nominal) <= Math.abs(comp - nominal) ? acute : comp;
    const diff = Math.abs(chosen - nominal);
    if (diff < bestDiff) {
      bestDiff = diff;
      nearest = chosen;
    }
    if (diff <= tol) matched++;
  }
  return { nearest, matched };
}

function distanceValues(features: readonly ViewFeature[], axis: 'x' | 'y'): number[] {
  const coords: number[] = [];
  const pushCoord = (c: number) => {
    if (!coords.some((x) => Math.abs(x - c) <= 1e-4)) coords.push(c);
  };
  for (const f of features) {
    if (f.type === 'plane' && f.axis === axis) pushCoord(f.coord);
    else if (f.type === 'circle') pushCoord(axis === 'x' ? f.centre[0] : f.centre[1]);
    else if (f.type === 'axis') {
      const dx = Math.abs(f.to[0] - f.from[0]);
      const dy = Math.abs(f.to[1] - f.from[1]);
      if (axis === 'x' && dx < 1e-4 && dy > 1e-4) pushCoord((f.from[0] + f.to[0]) / 2);
      else if (axis === 'y' && dy < 1e-4 && dx > 1e-4) pushCoord((f.from[1] + f.to[1]) / 2);
    }
  }
  const dists: number[] = [];
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      dists.push(Math.abs(coords[j]! - coords[i]!));
    }
  }
  return dists;
}

/** Verifies the open 3D part in `session` against a list of 2D engineering drawing checks. */
export function verifyPartAgainst2d(session: CadSession, checks: readonly Verify2dCheck[]): Verify2dReport {
  const src = session.drawingSource();
  if (!src) throw new AgentError('the part has no solid body to verify yet: build or open a part first');
  const holes = holeFeatures(src.doc);
  const textPrefixes = sketchTextPrefixes(src.doc);

  const viewCache = new Map<OrthoViewName, { width: number; height: number; features: ViewFeature[] }>();
  const viewsSummary: Record<string, { width: number; height: number }> = {};

  const getView = (dir: OrthoViewName) => {
    const hit = viewCache.get(dir);
    if (hit) return hit;
    const axes = viewVectors(dir);
    const lines = projectDrawingView(src.kernel, [{ shape: src.body.shape, pose: IDENTITY, mirrored: false }], axes);
    const width = lines.box ? lines.box.max[0] - lines.box.min[0] : 0;
    const height = lines.box ? lines.box.max[1] - lines.box.min[1] : 0;
    const features = viewFeatures(src.body.topology, src.body.names, axes, undefined, holes, src.built.cosmeticThreads, textPrefixes);
    const entry = { width, height, features };
    viewCache.set(dir, entry);
    viewsSummary[dir] = { width: r4(width), height: r4(height) };
    return entry;
  };

  const results: Verify2dCheckResult[] = [];
  let maxAbsError = 0;

  for (const c of checks) {
    const tol = c.tolerance ?? (c.kind === 'angle' ? 0.1 : 0.05);
    const v = getView(c.view);

    if (c.kind === 'width' || c.kind === 'height') {
      const measured = c.kind === 'width' ? v.width : v.height;
      const err = measured - c.nominal;
      const absErr = Math.abs(err);
      if (absErr > maxAbsError) maxAbsError = absErr;
      const pass = absErr <= tol;
      results.push({
        label: c.label, view: c.view, kind: c.kind, nominal: c.nominal, tolerance: tol,
        measured: r4(measured), error: r4(err), pass,
        ...(pass ? {} : { reason: `${c.kind} is ${r4(measured)} mm, off by ${r4(err)} mm (tolerance ±${tol})` }),
      });
      continue;
    }

    if (c.kind === 'angle') {
      const { nearest, matched } = angleMatches(v.features, c.nominal, tol);
      const err = nearest !== null ? nearest - c.nominal : null;
      if (err !== null && Math.abs(err) > maxAbsError) maxAbsError = Math.abs(err);
      const countOk = c.count !== undefined ? matched === c.count : matched >= 1;
      const pass = nearest !== null && Math.abs(nearest - c.nominal) <= tol && countOk;
      results.push({
        label: c.label, view: c.view, kind: c.kind, nominal: c.nominal, tolerance: tol,
        measured: nearest !== null ? r4(nearest) : null,
        error: err !== null ? r4(err) : null,
        ...(c.count !== undefined ? { expectedCount: c.count } : {}),
        matchedCount: matched,
        pass,
        ...(pass ? {} : {
          reason: nearest === null
            ? `no slanted feature found in ${c.view} view`
            : c.count !== undefined && matched !== c.count
              ? `expected ${c.count} slanted feature(s) at ${c.nominal}° ±${tol}°, found ${matched} (nearest ${r4(nearest)}°)`
              : `nearest angle is ${r4(nearest)}°, off by ${r4(err!)}° (tolerance ±${tol}°)`,
        }),
      });
      continue;
    }

    const candidates =
      c.kind === 'diameter' ? diameterValues(v.features)
        : c.kind === 'radius' ? radiusValues(v.features)
          : distanceValues(v.features, c.axis!);
    const nearest = nearestCandidate(candidates, c.nominal);
    const matched = candidates.filter((val) => Math.abs(val - c.nominal) <= tol).length;
    const err = nearest !== null ? nearest - c.nominal : null;
    if (err !== null && Math.abs(err) > maxAbsError) maxAbsError = Math.abs(err);
    const countOk = c.count !== undefined ? matched === c.count : matched >= 1;
    const pass = nearest !== null && Math.abs(nearest - c.nominal) <= tol && countOk;
    results.push({
      label: c.label, view: c.view, kind: c.kind, nominal: c.nominal, tolerance: tol,
      measured: nearest !== null ? r4(nearest) : null,
      error: err !== null ? r4(err) : null,
      ...(c.count !== undefined ? { expectedCount: c.count } : {}),
      matchedCount: matched,
      pass,
      ...(pass ? {} : {
        reason: nearest === null
          ? `no ${c.kind} feature found in ${c.view} view`
          : c.count !== undefined && matched !== c.count
            ? `expected ${c.count} matching ${c.kind}(s) at ${c.nominal} ±${tol}, found ${matched} (nearest ${r4(nearest)})`
            : `nearest ${c.kind} is ${r4(nearest)} mm, off by ${r4(err!)} mm (tolerance ±${tol})`,
      }),
    });
  }

  // Deterministic Layer-1 Mesh Triangulation Completeness Gate:
  // Any OCCT boolean degeneracy that leaves a topological face with 0 triangles in `kernel.mesh` fails verification immediately.
  const mesh = src.kernel.mesh(src.body.shape);
  const totalFaces = src.body.topology.faces.length;
  const meshedSet = new Set<number>();
  for (let t = 0; t < mesh.faceRanges.length; t += 3) {
    if (mesh.faceRanges[t + 1]! > 0) meshedSet.add(mesh.faceRanges[t + 2]!);
  }
  const unmeshedFaces: number[] = [];
  for (let fi = 0; fi < totalFaces; fi++) {
    if (!meshedSet.has(fi) && src.body.topology.faces[fi]!.area > 1e-6) {
      unmeshedFaces.push(fi);
    }
  }
  // A face can have its triangles and still be torn (ADR 0214: a fillet face whose edge lies 18 mm off it, 24 open edges): every edge of a closed
  // surface's mesh is shared by two triangles. Measured 2026-11-26 on 32 sound parts (a sphere's poles, a cone's apex, a torus, a seam, a thread,
  // 20 spline walls with exact rounds, the repository's part files): 0 each (spikes/mesh-open-edges).
  const openEdges = openMeshEdges(mesh);
  const meshIntegrity = {
    totalFaces,
    triangulatedFaces: meshedSet.size,
    unmeshedFaces,
    openEdges,
    pass: unmeshedFaces.length === 0 && openEdges === 0 && totalFaces > 0,
  };

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length && meshIntegrity.pass,
    passed,
    failed: results.length - passed,
    total: results.length,
    maxAbsError: r4(maxAbsError),
    meshIntegrity,
    results,
    views: viewsSummary,
  };
}
