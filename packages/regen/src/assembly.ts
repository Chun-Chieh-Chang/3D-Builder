import { composePose, DATUM_PLANES, mateEnds, evalAngle, evalLength, isDatumPlaneName, type AssemblyDoc, type Id, type InnerPoses, type Mate, type PlaneFrame, type Pose, type Ref, type SourceTree, type Vec3 } from '@3db/model';
import { placed, solve, type BodyResult, type MateGeometry, type MateResult, type MateSpec, type MoveGoal, type SolverBody } from '@3db/assembly';
import type { EdgeInfo, FaceInfo, Topology } from '@3db/kernel';
import { resolveRef, type ElementNames } from '@3db/naming';
import { t } from '@3db/i18n';

/** What an assembly's mates need of a part: its rebuilt model's topology and names, and its planes. */
export interface MatePart {
  topology: Topology;
  names: ElementNames;
  /** The part's reference planes (and sketch planes), by feature id. */
  frames: ReadonlyMap<Id, PlaneFrame>;
}

/**
 * What an assembly's mates need of a sub-assembly (C15.4): rigid as the assembly above sees it, so only
 * where each of its components ended up (in its own coordinates, its mates solved) and what each is.
 * Components that are left out (suppressed) are not in it.
 */
export interface SubAssemblyPart {
  kind: 'assembly';
  poses: ReadonlyMap<Id, Pose>;
  parts: ReadonlyMap<Id, MateSource | null>;
  /** Its components that are suppressed (C15.5): not solved, so without a pose or a part; a mate that goes through one is suppressed. */
  leftOut: ReadonlySet<Id>;
}

/** A component's part, or its sub-assembly; null where the file could not be read. */
export type MateSource = MatePart | SubAssemblyPart;

export const isSubAssembly = (s: MateSource): s is SubAssemblyPart => 'kind' in s;

function innerPosesOf(s: SubAssemblyPart): InnerPoses {
  const inner = new Map<Id, InnerPoses>();
  for (const [id, part] of s.parts) if (part && isSubAssembly(part)) inner.set(id, innerPosesOf(part));
  return { poses: s.poses, inner };
}

/** The source a `SourceTree` describes: parts by their keys (`partOfKey` null: not built), sub-assemblies solved on their own. */
export function sourceFromTree(tree: SourceTree | undefined, partOfKey: (key: string) => MatePart | null): MateSource | null {
  if (!tree) return null;
  if (tree.kind === 'part') return partOfKey(tree.key);
  return solveSubAssembly(tree.doc, (id) => sourceFromTree(tree.children[id], partOfKey)).part;
}

/** `solveAssembly` for components described by trees. */
export function solveAssemblyTree(doc: AssemblyDoc, trees: Readonly<Record<Id, SourceTree>>, partOfKey: (key: string) => MatePart | null, options: AssemblySolveOptions = {}): AssemblyResult {
  const sources = new Map<Id, MateSource | null>();
  return solveAssembly(
    doc,
    (id) => {
      if (!sources.has(id)) sources.set(id, sourceFromTree(trees[id], partOfKey));
      return sources.get(id) ?? null;
    },
    options,
  );
}


export type MateState = MateResult | { status: 'suppressed' } | { status: 'missing'; message: string };

/** The solved assembly (A3.2, A3.4): derived from the document and its parts, never stored. */
export interface AssemblyResult {
  poses: Map<Id, Pose>;
  components: Map<Id, BodyResult>;
  mates: Map<Id, MateState>;
  /** With a goal: the floating components solved together with the one moved (it included). */
  group?: Id[];
  /** For each component that is a sub-assembly: where its own components are inside it (derived; shown, never stored). */
  inner?: Map<Id, InnerPoses>;
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
export function solveAssembly(doc: AssemblyDoc, partOf: (componentId: Id) => MateSource | null, options: AssemblySolveOptions = {}): AssemblyResult {
  // A suppressed component (C15.5) is left out: nobody asks for its part, it is not solved, and its mates are suppressed with it.
  const active = doc.components.filter((c) => !c.suppressed);
  const leftOut = new Set(doc.components.filter((c) => c.suppressed).map((c) => c.id));
  const parts = new Map(active.map((c) => [c.id, partOf(c.id)] as const));
  const bodies: SolverBody[] = active.map((c) => {
    const part = parts.get(c.id);
    const extent = part ? extentOfSource(part) : null;
    return { id: c.id, fixed: c.fixed, pose: options.start?.get(c.id) ?? c.placement, ...(extent ? { pivot: extent.center, size: extent.size } : {}) };
  });
  const mates = new Map<Id, MateState>();
  const specs: MateSpec[] = [];
  const goesThroughLeftOut = (side: Mate['a']) =>
    side.component !== null && (leftOut.has(side.component) || pathLeftOut(parts.get(side.component) ?? null, side.path));
  for (const m of doc.mates) {
    if (m.suppressed || mateEnds(m).some(goesThroughLeftOut)) {
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
  const inner = new Map<Id, InnerPoses>();
  for (const [id, part] of parts) if (part && isSubAssembly(part)) inner.set(id, innerPosesOf(part));
  return { poses: s.poses, components: s.bodies, mates: ordered, ...(s.group ? { group: s.group } : {}), ...(inner.size > 0 ? { inner } : {}), ms: s.ms };
}

/**
 * A sub-assembly solved on its own and what a parent needs of it: the mates of its file hold inside it, then it is
 * rigid. `partOf` gives the part or sub-assembly of each of its components, as for `solveAssembly`.
 */
export function solveSubAssembly(doc: AssemblyDoc, partOf: (componentId: Id) => MateSource | null): { part: SubAssemblyPart; result: AssemblyResult } {
  const parts = new Map<Id, MateSource | null>();
  for (const c of doc.components) if (!c.suppressed) parts.set(c.id, partOf(c.id)); // once each: a sub-assembly's own parts are built when it is asked for
  const result = solveAssembly(doc, (id) => parts.get(id) ?? null);
  const leftOut = new Set(doc.components.filter((c) => c.suppressed).map((c) => c.id));
  return { part: { kind: 'assembly', poses: result.poses, parts, leftOut }, result };
}

/** Whether a mate element's path goes through a component that is suppressed somewhere down the sub-assemblies. */
function pathLeftOut(source: MateSource | null, path: readonly Id[] | undefined): boolean {
  let s = source;
  for (const id of path ?? []) {
    if (!s || !isSubAssembly(s)) return false;
    if (s.leftOut.has(id)) return true;
    s = s.parts.get(id) ?? null;
  }
  return false;
}

function specOf(m: Mate, parts: ReadonlyMap<Id, MateSource | null>): MateSpec | string {
  const end = (side: Mate['a'], what: string) => {
    if (side.component === null) return mateGeometry(side.ref, null, what); // the assembly itself: its planes and origin
    return mateGeometryIn(side.ref, side.path, parts.get(side.component) ?? null, what);
  };
  const a = end(m.a, '第一個元素');
  if (typeof a === 'string') return a;
  const b = end(m.b, '第二個元素');
  if (typeof b === 'string') return b;
  // the further elements of a width or symmetric mate (C15.9)
  const more: MateSpec['more'] = [];
  for (const [i, ref] of (m.more ?? []).entries()) {
    const g = end(ref, t('mate.moreElement', { n: i + 3 }));
    if (typeof g === 'string') return g;
    more.push({ body: ref.component, geom: g });
  }
  let value: number | undefined;
  let min: number | undefined;
  let max: number | undefined;
  try {
    const read = m.type === 'angle' ? evalAngle : evalLength;
    if (m.value !== undefined) value = read(m.value);
    if (m.min !== undefined) min = read(m.min);
    if (m.max !== undefined) max = read(m.max);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
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
    ...(more.length > 0 ? { more } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
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

/**
 * The geometry of an element of a component, in the component's own coordinates. A part is as for `mateGeometry`. For a
 * sub-assembly the `path` leads through its components to the part the element is on, and the geometry is carried
 * out by the poses on the way (C15.4); without a path the element is the sub-assembly's own plane or origin.
 */
export function mateGeometryIn(ref: Ref, path: readonly Id[] | undefined, source: MateSource | null, what = '元素'): MateGeometry | string {
  if (!source) return t('subassembly.notLoaded', { what });
  if (!isSubAssembly(source)) return path && path.length > 0 ? t('subassembly.pathOnPart', { what }) : mateGeometry(ref, source, what);
  if (!path || path.length === 0) return mateGeometry(ref, null, what);
  const [first, ...rest] = path as [Id, ...Id[]];
  const pose = source.poses.get(first);
  if (!pose || !source.parts.has(first)) return t('subassembly.noComponent', { what, id: first });
  const inner = mateGeometryIn(ref, rest, source.parts.get(first) ?? null, what);
  return typeof inner === 'string' ? inner : placed(inner, pose);
}

/** The middle of a part or a sub-assembly and about its radius (see `extentOf`). */
function extentOfSource(s: MateSource): { center: Vec3; size: number } | null {
  if (!isSubAssembly(s)) return extentOf(s.topology);
  const spheres: { center: Vec3; size: number }[] = [];
  for (const [id, part] of s.parts) {
    const pose = s.poses.get(id);
    const extent = part && pose ? extentOfSource(part) : null;
    if (extent && pose) spheres.push({ center: composePose(pose, { position: extent.center, rotation: [0, 0, 0, 1] }).position, size: extent.size });
  }
  if (spheres.length === 0) return null;
  const center = spheres.reduce<Vec3>((c, p) => [c[0] + p.center[0] / spheres.length, c[1] + p.center[1] / spheres.length, c[2] + p.center[2] / spheres.length], [0, 0, 0]);
  return { center, size: Math.max(1, ...spheres.map((p) => Math.hypot(p.center[0] - center[0], p.center[1] - center[1], p.center[2] - center[2]) + p.size)) };
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
