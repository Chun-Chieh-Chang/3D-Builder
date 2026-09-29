import { DATUM_PLANES, evalAngle, evalLength, isDatumPlaneName, type AssemblyDoc, type Id, type Mate, type PlaneFrame, type Pose, type Ref, type Vec3 } from '@3db/model';
import { solve, type BodyResult, type MateGeometry, type MateResult, type MateSpec, type MoveGoal, type SolverBody } from '@3db/assembly';
import type { EdgeInfo, FaceInfo, Topology } from '@3db/kernel';
import { resolveRef, type ElementNames } from '@3db/naming';

/** What an assembly's mates need of a part: its rebuilt model's topology and names, and its planes. */
export interface MatePart {
  topology: Topology;
  names: ElementNames;
  /** The part's reference planes (and sketch planes), by feature id. */
  frames: ReadonlyMap<Id, PlaneFrame>;
}

export type MateState = MateResult | { status: 'suppressed' } | { status: 'missing'; message: string };

/** The solved assembly (A3.2, A3.4): derived from the document and its parts, never stored. */
export interface AssemblyResult {
  poses: Map<Id, Pose>;
  components: Map<Id, BodyResult>;
  mates: Map<Id, MateState>;
  /** With a goal: the floating components solved together with the one moved (it included). */
  group?: Id[];
  ms: number;
}

export interface AssemblySolveOptions {
  /** Where the components start instead of their placements: where they are shown now (a drag goes on from there). */
  start?: ReadonlyMap<Id, Pose>;
  /** A move of one component (C15.3, A3.5): `body` is its id. */
  goal?: MoveGoal;
}

/**
 * Solves an assembly's mates. Every mate's elements are found in the parts by persistent name (B4)
 * and turned into the geometry the solver needs (A5.2); a mate whose element is gone is reported,
 * never bound to something else. Components whose part is not there keep their placement.
 */
export function solveAssembly(doc: AssemblyDoc, partOf: (componentId: Id) => MatePart | null, options: AssemblySolveOptions = {}): AssemblyResult {
  const parts = new Map(doc.components.map((c) => [c.id, partOf(c.id)] as const));
  const bodies: SolverBody[] = doc.components.map((c) => {
    const part = parts.get(c.id);
    const extent = part ? extentOf(part.topology) : null;
    return { id: c.id, fixed: c.fixed, pose: options.start?.get(c.id) ?? c.placement, ...(extent ? { pivot: extent.center, size: extent.size } : {}) };
  });
  const mates = new Map<Id, MateState>();
  const specs: MateSpec[] = [];
  for (const m of doc.mates) {
    if (m.suppressed) {
      mates.set(m.id, { status: 'suppressed' });
      continue;
    }
    const spec = specOf(m, parts);
    if (typeof spec === 'string') mates.set(m.id, { status: 'missing', message: spec });
    else specs.push(spec);
  }
  const s = solve(bodies, specs, options.goal ? { goal: options.goal } : {});
  for (const [id, r] of s.mates) mates.set(id, r);
  // FeatureManager order.
  const ordered = new Map(doc.mates.map((m) => [m.id, mates.get(m.id)!] as const));
  return { poses: s.poses, components: s.bodies, mates: ordered, ...(s.group ? { group: s.group } : {}), ms: s.ms };
}

function specOf(m: Mate, parts: ReadonlyMap<Id, MatePart | null>): MateSpec | string {
  const end = (side: Mate['a'], what: string) => {
    if (side.component !== null && !parts.get(side.component)) return `${what}的零件沒有載入`;
    return mateGeometry(side.ref, side.component === null ? null : parts.get(side.component)!, what);
  };
  const a = end(m.a, '第一個元素');
  if (typeof a === 'string') return a;
  const b = end(m.b, '第二個元素');
  if (typeof b === 'string') return b;
  let value: number | undefined;
  if (m.value !== undefined) {
    try {
      value = m.type === 'angle' ? evalAngle(m.value) : evalLength(m.value);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  return {
    id: m.id,
    type: m.type,
    a: { body: m.a.component, geom: a },
    b: { body: m.b.component, geom: b },
    ...(m.align ? { align: m.align } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(m.flip ? { flip: true } : {}),
    ...(m.relative ? { relative: m.relative } : {}),
  };
}

/**
 * The geometry of one element (A5.2): a default or reference plane, the origin, or a face, edge or
 * vertex found by persistent name. `part` null is the assembly itself (its planes and origin).
 */
export function mateGeometry(ref: Ref, part: MatePart | null, what = '元素'): MateGeometry | string {
  if (ref.kind === 'datum') {
    if (ref.name === 'origin') return { kind: 'point', point: [0, 0, 0] };
    const frame = isDatumPlaneName(ref.name) ? DATUM_PLANES[ref.name] : part?.frames.get(ref.name);
    return frame ? { kind: 'plane', origin: frame.origin, normal: frame.normal } : `${what}：找不到基準面 ${ref.name}`;
  }
  if (!part) return `${what}：組合件本身只能選基準面或原點`;
  const r = resolveRef(ref, part.names, part.topology);
  if (!r.ok) return `遺失參考：${what}「${ref.name}」找不到`;
  if (ref.kind === 'vertex') return { kind: 'point', point: part.topology.vertices[r.index]!.point };
  if (ref.kind === 'edge') return edgeMateGeometry(part.topology.edges[r.index]!) ?? `${what}：這條邊線不是直線或圓，不能用於結合`;
  const face = part.topology.faces[r.index]!;
  return faceMateGeometry(face) ?? `${what}：這種面（${face.surface}）不能用於結合`;
}

/** What a mate can use of a face: its plane, cylinder, cone or sphere; null for other surfaces. */
export function faceMateGeometry(face: FaceInfo): MateGeometry | null {
  const g = face.geometry;
  switch (g?.type) {
    case 'plane':
      return { kind: 'plane', origin: g.origin, normal: g.normal };
    case 'cylinder':
      return { kind: 'cylinder', origin: g.origin, axis: g.axis, radius: g.radius, convex: g.convex };
    case 'cone':
      return { kind: 'cone', apex: g.apex, axis: g.axis, halfAngle: g.halfAngle, convex: g.convex };
    case 'sphere':
      return { kind: 'sphere', center: g.center, radius: g.radius, convex: g.convex };
  }
  return null;
}

/** What a mate can use of an edge: its line or circle; null for other curves. */
export function edgeMateGeometry(edge: EdgeInfo): MateGeometry | null {
  const g = edge.geometry;
  if (g?.type === 'line') return { kind: 'line', origin: g.origin, dir: g.dir };
  if (g?.type === 'circle') return { kind: 'circle', center: g.center, normal: g.normal, radius: g.radius };
  return null;
}

/** The middle of a part and about its radius: where it turns about and how far its points travel. */
function extentOf(t: Topology): { center: Vec3; size: number } | null {
  const points = [...t.vertices.map((v) => v.point), ...t.faces.map((f) => f.center)];
  if (points.length === 0) return null;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]!);
      hi[k] = Math.max(hi[k]!, p[k]!);
    }
  }
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return { center, size: Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) };
}
