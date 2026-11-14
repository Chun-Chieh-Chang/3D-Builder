/**
 * Feature recognition (F2.4), the document half: the features that build what `recognize` found, put in place of the imported body, and the result
 * checked against the body it replaces. All or nothing: any feature that does not rebuild, a round whose edge is not found, or a result that is not the
 * same solid is a `RecognizeError`, and the document is not changed.
 */
import { t } from '@3db/i18n';
import { type Frame, type Kernel, type ShapeId, type SurfaceGeometry, type Topology, type Vec3 } from '@3db/kernel';
import {
  applyCommand,
  createEmptyPart,
  DATUM_PLANES,
  IdAllocator,
  idsInUse,
  planeFrame,
  type ChamferFeature,
  type Command,
  type DatumPlaneName,
  type Feature,
  type FilletFeature,
  type HoleFeature,
  type Id,
  type PartDoc,
  type Ref,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from '@3db/model';
import { edgeFingerprint, faceFingerprint, ownerFeatures } from '@3db/naming';
import { sketchSystemSize, SOLVER_SAFE_SIZE, type SketchSolver } from '@3db/sketch';
import { RECOGNIZE_LIMITS, startBudget, type BudgetLimits } from '../budget';
import type { Regenerator, RebuildResult } from '../engine';
import { addv, distanceToSharp, dot, len, recognize, RecognizeError, sub, TOL, unit, type BlendRecord, type BaseRecord, type FreeRoundsOption, type HoleRecord, type Recognition, type SharpEdge, type SplineApproximation } from './analyze';
import { compareSections, sectionsClose } from './compareSections';
import type { Loop, P2 } from '../section/loops';

export { RecognizeError } from './analyze';

/** What came out: how many features of each kind, and how near the rebuilt solid is to the imported one. */
export interface ReconstructReport {
  features: Record<'sketch' | 'extrude' | 'revolve' | 'hole' | 'fillet' | 'chamfer' | 'datum', number>;
  /** Faces of the imported body, and of the body rebuilt from the features. */
  faces: [number, number];
  volume: number;
  /** |V' − V| / V, |A' − A| / A, and the volume the two solids do not share, over V. */
  volumeError: number;
  areaError: number;
  /** With `fileTolerance`, only what is past each face's own allowance (ADR 0249); the whole of it is `fileTolerance.difference`. */
  difference: number;
  /**
   * Set when the imported file joins some of its faces only to a tolerance past 1e-7 (ADR 0249): how many faces, the largest tolerance (mm), and over
   * V (A for `area`) what that lets the volume and the area differ by, and the volume between the two before each point's allowance was taken off.
   */
  fileTolerance?: { faces: number; max: number; volume: number; area: number; difference: number };
  /** Set when a spline outline was approximated (ADR 0243): the rebuilt solid is close to the original, not the same. */
  approximation?: {
    /** The largest distance the biarcs were proved to keep from the spline (mm). */
    bound: number;
    /** The largest distance measured between the two boundaries, over the sections compared (mm). */
    distance: number;
    /** Over the sections compared, the largest difference of area and the largest area not shared, each over the section's area. */
    sectionAreaError: number;
    sectionDifference: number;
    /** How many sections were compared. */
    sections: number;
  };
}

/** What recognition may do beyond rebuilding the very same solid. */
export interface ReconstructOptions {
  /** Make a spline outline of biarcs, and say how close that is. Off by default: the user asks for it (ADR 0243). */
  approximateSplines?: boolean;
}

/** What each biarc is built to keep within (mm): the same size as a hundredth, and 16 pieces for a gentle curve of 30 mm. */
export const SPLINE_TOLERANCE = 0.01;

/** The relative error the rebuilt solid may have (volume, area, and the volume not shared). */
export const RECOGNIZE_TOLERANCE = 1e-6;

// ------------------------------------------------------------------ numbers and planes

/** A length or coordinate as an expression: to 1e-10 mm, never in exponent form. */
export function num(x: number): string {
  const r = Math.round(x * 1e10) / 1e10;
  const s = String(Object.is(r, -0) ? 0 : r);
  return s.includes('e') ? r.toFixed(10).replace(/\.?0+$/, '') : s;
}

const DATUMS: [DatumPlaneName, Vec3][] = [['plane:top', [0, 1, 0]], ['plane:front', [0, 0, 1]], ['plane:right', [1, 0, 0]]];

type PlaneSpec =
  | { kind: 'datum'; name: DatumPlaneName; h: number; flipped: boolean }
  | { kind: 'generic'; point: Vec3; normal: Vec3; flipped: false };

function planeSpec(normal: Vec3, point: Vec3): PlaneSpec {
  const n = unit(normal);
  for (const [name, d] of DATUMS) {
    const c = dot(n, d);
    if (Math.abs(Math.abs(c) - 1) <= 1e-12) return { kind: 'datum', name, h: dot(point, d), flipped: c < 0 };
  }
  // the point where the plane is nearest the origin, so that the plane does not depend on which point of it was given
  const k = dot(point, n);
  return { kind: 'generic', point: [n[0] * k, n[1] * k, n[2] * k], normal: n, flipped: false };
}

/** The sketch frame the plane of `planeSpec` gets in the rebuild (the default planes, their offsets, and `planeFrame` for a plane square to an axis). */
export function frameFor(normal: Vec3, point: Vec3): Frame {
  const s = planeSpec(normal, point);
  if (s.kind === 'datum') {
    const f = DATUM_PLANES[s.name];
    return { ...f, origin: addv(f.origin, f.normal, s.h) };
  }
  return planeFrame(s.point, s.normal);
}

// ------------------------------------------------------------------ building features

/** A member of a union without its id, member by member. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

class Builder {
  readonly features: Feature[] = [];
  readonly counts: ReconstructReport['features'] = { sketch: 0, extrude: 0, revolve: 0, hole: 0, fillet: 0, chamfer: 0, datum: 0 };
  private readonly planes = new Map<string, Ref>();
  constructor(
    private readonly ids: IdAllocator,
    private readonly solver?: SketchSolver,
  ) {}

  private feature<F extends Feature>(f: F): F {
    this.features.push(f);
    return f;
  }

  name(kind: keyof ReconstructReport['features']): string {
    this.counts[kind]++;
    return t(`recognize.name.${kind}` as 'recognize.name.sketch', { n: this.counts[kind] });
  }

  /** The plane through `point` square to `normal`: a default plane, its offset, or (any other way) a plane square to an axis through two points. */
  plane(normal: Vec3, point: Vec3): { ref: Ref; flipped: boolean } {
    const s = planeSpec(normal, point);
    const key = s.kind === 'datum' ? `${s.name}@${num(s.h)}` : `${s.normal.map(num).join(',')}@${s.point.map(num).join(',')}`;
    const known = this.planes.get(key);
    if (known) return { ref: known, flipped: s.flipped };
    let ref: Ref;
    if (s.kind === 'datum' && Math.abs(s.h) <= 1e-10) ref = { kind: 'datum', name: s.name };
    else if (s.kind === 'datum') {
      const id = this.ids.take('plane');
      this.feature({ id, type: 'refPlane', name: this.name('datum'), suppressed: false, def: { mode: 'offset', plane: { kind: 'datum', name: s.name }, distance: num(Math.abs(s.h)), ...(s.h < 0 ? { reverse: true } : {}) } });
      ref = { kind: 'datum', name: id };
    } else {
      const [p, q] = [this.ids.take('point'), this.ids.take('point')];
      const far = addv(s.point, s.normal, 10);
      this.feature({ id: p, type: 'refPoint', name: this.name('datum'), suppressed: false, def: { mode: 'coords', x: num(s.point[0]), y: num(s.point[1]), z: num(s.point[2]) } });
      this.feature({ id: q, type: 'refPoint', name: this.name('datum'), suppressed: false, def: { mode: 'coords', x: num(far[0]), y: num(far[1]), z: num(far[2]) } });
      const axis = this.ids.take('axis');
      this.feature({ id: axis, type: 'refAxis', name: this.name('datum'), suppressed: false, def: { mode: 'twoPoints', points: [{ kind: 'datum', name: p }, { kind: 'datum', name: q }] } });
      const id = this.ids.take('plane');
      this.feature({ id, type: 'refPlane', name: this.name('datum'), suppressed: false, def: { mode: 'perpendicular', axis: { kind: 'datum', name: axis }, point: { kind: 'datum', name: p } } });
      ref = { kind: 'datum', name: id };
    }
    this.planes.set(key, ref);
    return { ref, flipped: s.flipped };
  }

  /** A sketch of closed loops (and free points, and a centerline), each corner one shared point. */
  sketch(plane: Ref, loops: Loop[], extra: { points?: P2[]; centerline?: [P2, P2] } = {}): { id: Id; centerline?: Id } {
    const entities: SketchEntity[] = [];
    const constraints: SketchConstraint[] = [];
    const pts: { id: Id; p: P2 }[] = [];
    const point = (p: P2, alone = false): Id => {
      if (!alone) {
        const found = pts.find((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) <= 1e-7);
        if (found) return found.id;
      }
      const id = this.ids.take('p');
      pts.push({ id, p });
      entities.push({ id, type: 'point', x: p[0], y: p[1] });
      return id;
    };
    for (const loop of loops) {
      for (const s of loop.segs) {
        if (s.kind === 'line') {
          entities.push({ id: this.ids.take('l'), type: 'line', p1: point(s.a), p2: point(s.b) });
        } else if (s.kind === 'nurbs') {
          // the poles: the ends shared with the pieces either side, the inner ones points of their own (never merged with another that happens to lie there)
          const poles = s.poles.map((p, i) => (i === 0 ? point(s.a) : i === s.poles.length - 1 ? point(s.b) : point(p, true)));
          entities.push({ id: this.ids.take('sp'), type: 'spline', points: poles, nurbs: { degree: s.degree, knots: [...s.knots], mults: [...s.mults], ...(s.weights ? { weights: [...s.weights] } : {}) } });
        } else if (s.kind === 'arc') {
          const id = this.ids.take('a');
          const [from, to] = s.ccw ? [s.a, s.b] : [s.b, s.a];
          entities.push({ id, type: 'arc', center: point(s.c), start: point(from), end: point(to) });
          constraints.push({ id: this.ids.take('d'), type: 'radius', circle: id, value: num(s.r) });
        } else {
          const id = this.ids.take('c');
          entities.push({ id, type: 'circle', center: point(s.c), radius: s.r });
          constraints.push({ id: this.ids.take('d'), type: 'diameter', circle: id, value: num(2 * s.r) });
        }
      }
    }
    for (const p of extra.points ?? []) point(p, true);
    let centerline: Id | undefined;
    if (extra.centerline) {
      centerline = this.ids.take('l');
      const a = this.ids.take('p');
      const b = this.ids.take('p');
      entities.push({ id: a, type: 'point', x: extra.centerline[0][0], y: extra.centerline[0][1] }, { id: b, type: 'point', x: extra.centerline[1][0], y: extra.centerline[1][1] });
      entities.push({ id: centerline, type: 'line', p1: a, p2: b, construction: true });
    }
    const id = this.ids.take('sketch');
    const sketch: SketchFeature = { id, type: 'sketch', name: this.name('sketch'), suppressed: false, plane, entities, constraints };
    // A sketch larger than the solver is measured to hold is refused here, before it is tried: trying it aborts the solver's module, twice in a rebuild
    // leaves none (nightly #189/#194/#198), and what comes of it is a feature that fails all the same
    const size = sketchSystemSize(sketch);
    if (size > SOLVER_SAFE_SIZE) {
      const arcs = entities.filter((e) => e.type === 'arc').length;
      throw new RecognizeError(t('recognize.sketchTooLarge', { size, limit: SOLVER_SAFE_SIZE, arcs }));
    }
    if (this.solver) this.define(sketch, pts);
    this.feature<SketchFeature>(sketch);
    return { id, ...(centerline ? { centerline } : {}) };
  }

  /**
   * Makes the sketch fully defined, so that every size of what was recognized is a dimension to change: candidate relations and dimensions, in the order
   * a designer gives them (on the origin, horizontal and vertical, the length of each line, then where each point is from the origin), each kept only
   * when the solver says it takes a degree of freedom away without being redundant or in conflict. Every value is what the sketch already has, so nothing
   * moves. A sketch the solver cannot finish is left as it is (under-defined), never over-defined.
   */
  private define(sketch: SketchFeature, pts: { id: Id; p: P2 }[]): void {
    const solver = this.solver!;
    const state = () => solver.solve(sketch);
    let s = state();
    if (s.status === 'over' || s.status === 'failed') return;
    const at = new Map(pts.map((q) => [q.id, q.p]));
    for (const e of sketch.entities) if (e.type === 'point') at.set(e.id, [e.x, e.y]);
    const candidates: SketchConstraint[] = [];
    const take = (c: WithoutId<SketchConstraint>) => candidates.push({ ...c, id: this.ids.take('d') } as SketchConstraint);
    const ZERO = 1e-9;
    for (const [id, p] of at) if (Math.hypot(p[0], p[1]) <= ZERO) take({ type: 'coincident', a: id, b: '@origin' });
    const lines = sketch.entities.filter((e): e is Extract<SketchEntity, { type: 'line' }> => e.type === 'line');
    for (const l of lines) {
      const [a, b] = [at.get(l.p1)!, at.get(l.p2)!];
      if (Math.abs(a[1] - b[1]) <= ZERO) take({ type: 'horizontal', a: l.id });
      else if (Math.abs(a[0] - b[0]) <= ZERO) take({ type: 'vertical', a: l.id });
    }
    for (const l of lines) {
      if (l.construction) continue;
      const [a, b] = [at.get(l.p1)!, at.get(l.p2)!];
      take({ type: 'distance', a: l.id, value: num(Math.hypot(b[0] - a[0], b[1] - a[1])) });
    }
    for (const [id, p] of at) {
      take(Math.abs(p[0]) <= ZERO ? { type: 'vertical', a: id, b: '@origin' } : { type: 'distanceX', a: '@origin', b: id, value: num(Math.abs(p[0])) });
      take(Math.abs(p[1]) <= ZERO ? { type: 'horizontal', a: id, b: '@origin' } : { type: 'distanceY', a: '@origin', b: id, value: num(Math.abs(p[1])) });
    }
    // The sketch's parts that share no point have additive freedoms, and a dimension can only be redundant with its own part, so each part is defined by
    // itself (a sketch of thousands of entities is many small solves, not thousands of whole ones). In a part, a run of candidates is taken whole when the
    // solver says it removes exactly as many freedoms as it has candidates, none redundant: then each would have been kept on its own, in order. Otherwise the
    // run is halved, the first half settled before the second, down to single candidates: the same choice as trying them one at a time.
    const parts = sketchParts(sketch);
    const kept = new Set<SketchConstraint>();
    const byPart = new Map<number, SketchConstraint[]>();
    for (const c of candidates) {
      const part = parts.of(c);
      byPart.set(part, [...(byPart.get(part) ?? []), c]);
    }
    // A system the solver cannot hold ends the defining (the sketch stays as defined so far, as one the solver cannot finish): halving after it would ask
    // with smaller and smaller systems, each of which can abort again, and two aborts in one rebuild leave no solver module (nightly #189/#194/#198).
    let tooLarge = false;
    for (const [part, list] of byPart) {
      if (tooLarge) break;
      const sub: SketchFeature = { ...sketch, entities: sketch.entities.filter((e) => parts.entity(e) === part), constraints: sketch.constraints.filter((c) => parts.of(c) === part) };
      let st = solver.solve(sub);
      if (st.tooLarge) tooLarge = true;
      if (st.status === 'over' || st.status === 'failed') continue;
      const settle = (run: SketchConstraint[]): void => {
        if (run.length === 0 || st.dof === 0 || tooLarge) return;
        // A run longer than the freedoms left cannot take exactly one each, so trying it whole can only fail; it is halved without asking the solver. The
        // choice is the same, and the solver never sees more than the fully defined sketch: asked with all 280 candidates of a 68-arc outline at once it
        // ran out of its fixed heap (903 unknowns and equations; the defined sketch is 762), which C1's batching brought in (nightly #189/#194/#198).
        // Nor is a run that would take the part past what the solver is measured to hold (`SOLVER_SAFE_SIZE`; each candidate is one in its measure): halved
        // the same way, and a single candidate past it is left out (the part stays under-defined), so that the solver is not made to abort
        const over = sketchSystemSize(sub) + run.length > SOLVER_SAFE_SIZE;
        if (over && run.length === 1) return;
        if (run.length > st.dof || over) {
          const half = Math.ceil(run.length / 2);
          settle(run.slice(0, half));
          settle(run.slice(half));
          return;
        }
        sub.constraints.push(...run);
        const next = solver.solve(sub);
        if (next.tooLarge) {
          tooLarge = true;
          sub.constraints.splice(sub.constraints.length - run.length, run.length);
          return;
        }
        if (!(next.status === 'over' || next.status === 'failed' || next.redundant.length || next.conflicting.length) && next.dof === st.dof - run.length) {
          st = next;
          for (const c of run) kept.add(c);
          return;
        }
        sub.constraints.splice(sub.constraints.length - run.length, run.length);
        if (run.length === 1) return;
        const half = Math.ceil(run.length / 2);
        settle(run.slice(0, half));
        settle(run.slice(half));
      };
      settle(list);
    }
    sketch.constraints.push(...candidates.filter((c) => kept.has(c)));
  }

  base(rec: Recognition, merge: boolean | undefined): void {
    const b = rec.base;
    if (b.type === 'revolve') {
      const frame = b.profile.frame;
      const plane = this.plane(frame.normal, b.axis.origin);
      const to = (p: Vec3): P2 => [dot(sub(p, frame.origin), frame.xDir), dot(sub(p, frame.origin), frame.yDir)];
      const { id, centerline } = this.sketch(plane.ref, b.profile.loops, { centerline: [to(b.axis.origin), to(addv(b.axis.origin, b.axis.dir, 10))] });
      this.feature({ id: this.ids.take('revolve'), type: 'revolve', name: this.name('revolve'), suppressed: false, sketch: id, axis: centerline!, op: 'boss', ...(merge === false ? { merge: false } : {}), dir1: { type: 'blind', angle: '360deg' } });
      return;
    }
    if (b.type === 'loft') {
      const sectionIds = b.sections.map((sec, i) => {
        const h = b.levels[i]!;
        const plane = this.plane(b.dir, [b.dir[0] * h, b.dir[1] * h, b.dir[2] * h]);
        return this.sketch(plane.ref, sec.loops).id;
      });
      this.feature({ id: this.ids.take('loft'), type: 'loft', name: this.name('extrude'), suppressed: false, sections: sectionIds, op: 'boss', ...(merge === false ? { merge: false } : {}) });
      return;
    }
    if (b.type === 'composite') {
      this.base({ ...rec, base: b.base }, merge);
      for (const extra of b.extras) this.layers(extra.rec, extra.op, undefined);
      return;
    }
    this.layers(b, 'boss', merge);
  }

  /** Each layer profile gets its own sketch and blind extrusion over the layer's height along `dir`. */
  private layers(b: Extract<Recognition['base'], { type: 'extrude' }>, op: 'boss' | 'cut', merge: boolean | undefined): void {
    let first = true;
    b.layers.forEach((profiles, i) => {
      if (!profiles.length) return;
      const h = b.levels[i]!;
      const plane = this.plane(b.dir, [b.dir[0] * h, b.dir[1] * h, b.dir[2] * h]);
      const depth = b.levels[i + 1]! - h;
      for (const layer of profiles) {
        const layerOp = layer.op ?? op;
        const { id } = this.sketch(plane.ref, layer.loops);
        this.feature({
          id: this.ids.take('extrude'),
          type: 'extrude',
          name: this.name('extrude'),
          suppressed: false,
          sketch: id,
          op: layerOp,
          ...(layerOp === 'boss' && first && merge === false ? { merge: false } : {}),
          // a boss goes along the sketch's normal, a cut against it (into the material): either way the layer runs along `dir`
          dir1: { type: 'blind', depth: num(depth), ...((layerOp === 'boss' ? plane.flipped : !plane.flipped) ? { reverse: true } : {}) },
          ...(layer.draft ? { draft1: { angle: `${num((layer.draft.angle * 180) / Math.PI)}deg`, ...(layer.draft.inward ? { inward: true } : {}) } } : {}),
        });
        first = false;
      }
    });
  }

  holes(holes: HoleRecord[]): void {
    const groups = new Map<string, HoleRecord[]>();
    for (const h of holes) {
      const out: Vec3 = [-h.down[0], -h.down[1], -h.down[2]];
      const s = planeSpec(out, h.entrance);
      const plane = s.kind === 'datum' ? `${s.name}@${num(s.h)}:${s.flipped}` : `${s.normal.map(num).join(',')}@${s.point.map(num).join(',')}`;
      const key = [plane, h.kind, num(h.radius), h.depth === null ? 'through' : num(h.depth), num(h.cbRadius ?? 0), num(h.cbDepth ?? 0), num(h.csRadius ?? 0), num(h.csAngle ?? 0), num(h.tip ?? 0)].join('|');
      groups.set(key, [...(groups.get(key) ?? []), h]);
    }
    for (const group of groups.values()) {
      const h = group[0]!;
      const out: Vec3 = [-h.down[0], -h.down[1], -h.down[2]];
      const frame = frameFor(out, h.entrance);
      const plane = this.plane(out, h.entrance);
      const at = (p: Vec3): P2 => [dot(sub(p, frame.origin), frame.xDir), dot(sub(p, frame.origin), frame.yDir)];
      const { id } = this.sketch(plane.ref, [], { points: group.map((g) => at(g.entrance)) });
      const hole: HoleFeature = {
        id: this.ids.take('hole'),
        type: 'hole',
        name: this.name('hole'),
        suppressed: false,
        sketch: id,
        kind: h.kind,
        diameter: num(2 * h.radius),
        end: h.depth === null ? { type: 'throughAll' } : { type: 'blind', depth: num(h.depth) },
        ...(h.kind === 'counterbore' ? { cbDiameter: num(2 * h.cbRadius!), cbDepth: num(h.cbDepth!) } : {}),
        ...(h.kind === 'countersink' ? { csDiameter: num(2 * h.csRadius!), csAngle: `${num((h.csAngle! * 180) / Math.PI)}deg` } : {}),
        ...(h.tip === undefined ? {} : { drillPointAngle: `${num((h.tip * 180) / Math.PI)}deg` }),
        // the hole goes against the sketch's normal; the plane of the entrance face points out of the material, unless the plane had to be the other way round
        ...(plane.flipped ? { reverse: true } : {}),
      };
      this.feature(hole);
    }
  }
}

// ------------------------------------------------------------------ rounds and chamfers on the rebuilt body

/**
 * C2.10: the rebuilt body's edges a sampled sharp edge lies along: each edge on which at least two of its points have a foot inside the edge within TOL,
 * whatever curve the edge is. Every point must be on one of them (a point past every edge, or off them all, means the edge is not there).
 */
function onSampled(kernel: Kernel, body: NonNullable<RebuildResult['body']>, s: Extract<SharpEdge, { kind: 'sampled' }>): number[] {
  const spacing = Math.max(...s.points.slice(1).map((p, k) => len(sub(p, s.points[k]!))));
  const covered = s.points.map(() => false);
  const found = body.topology.edges.flatMap((e, i) => {
    // far from every point: not asked of the kernel
    if (Math.min(...s.points.map((p) => len(sub(p, e.mid)))) > e.length / 2 + spacing + 1e-3) return [];
    const ds = kernel.distancesToEdge(body.shape, i, s.points);
    const on = ds.flatMap((d, k) => (d !== null && d <= TOL ? [k] : []));
    if (on.length < 2) return [];
    for (const k of on) covered[k] = true;
    return [i];
  });
  return covered.every(Boolean) ? found : [];
}

function onSharp(kernel: Kernel, r: RebuildResult, s: SharpEdge): number[] {
  const body = r.body;
  if (!body) return [];
  if (s.kind === 'sampled') return onSampled(kernel, body, s);
  return body.topology.edges.flatMap((e, i) => {
    if (s.kind === 'line') {
      if (e.curve !== 'line' || !e.dir || Math.abs(Math.abs(dot(unit(e.dir), s.dir)) - 1) > 1e-9) return [];
      if (distanceToSharp(e.mid, s) > TOL * 10) return [];
      const k = dot(sub(e.mid, s.ends[0]), s.dir);
      const span = dot(sub(s.ends[1], s.ends[0]), s.dir);
      return k >= Math.min(0, span) - TOL && k <= Math.max(0, span) + TOL ? [i] : [];
    }
    const g = e.geometry;
    if (g?.type !== 'circle' || Math.abs(g.radius - s.radius) > TOL * 10 || len(sub(g.center, s.center)) > TOL * 10 || Math.abs(Math.abs(dot(unit(g.normal), s.normal)) - 1) > 1e-9) return [];
    return [i];
  });
}

function sameSurface(a: SurfaceGeometry | undefined, b: SurfaceGeometry): boolean {
  if (!a || a.type !== b.type) return false;
  if (a.type === 'plane' && b.type === 'plane') return Math.abs(dot(unit(a.normal), unit(b.normal)) - 1) <= 1e-9 && Math.abs(dot(sub(a.origin, b.origin), unit(b.normal))) <= TOL * 10;
  if (a.type === 'cylinder' && b.type === 'cylinder') {
    const d = unit(b.axis);
    const v = sub(a.origin, b.origin);
    return Math.abs(a.radius - b.radius) <= TOL * 10 && Math.abs(Math.abs(dot(unit(a.axis), d)) - 1) <= 1e-9 && len(sub(v, [d[0] * dot(v, d), d[1] * dot(v, d), d[2] * dot(v, d)])) <= TOL * 10;
  }
  return false;
}

/** A generated triangular cap is redundant when its three chamfer planes already meet at a vertex in the source. */
function extraChamferCaps(body: NonNullable<RebuildResult['body']>, source: Topology, chamfers: Set<Id>): Ref[] {
  const { topology, names } = body;
  const fromChamfer = names.faces.map((name) => ownerFeatures(name).some((id) => chamfers.has(id)));
  return topology.faces.flatMap((face, i) => {
    const cap = face.geometry;
    if (!fromChamfer[i] || cap?.type !== 'plane') return [];
    const boundary = topology.edges.filter((edge) => edge.faces.includes(i));
    if (boundary.length !== 3 || boundary.some((edge) => edge.curve !== 'line' || edge.faces.length !== 2)) return [];
    const neighbors = [...new Set(boundary.map((edge) => edge.faces.find((j) => j !== i)!))];
    if (neighbors.length !== 3 || neighbors.some((j) => !fromChamfer[j])) return [];
    const planes = neighbors.map((j) => topology.faces[j]!.geometry);
    if (planes.some((plane) => plane?.type !== 'plane') || source.faces.some((f) => sameSurface(f.geometry, cap))) return [];
    const meetsInSource = source.vertices.some((vertex) => planes.every((plane) =>
      vertex.faces.some((j) => sameSurface(source.faces[j]!.geometry, plane!)),
    ));
    if (!meetsInSource) return [];
    return [{ kind: 'face', name: names.faces[i]!, fingerprint: faceFingerprint(topology, i) }];
  });
}

function blendFeature(kernel: Kernel, rec: BlendRecord, r: RebuildResult, ids: IdAllocator, b: Builder): Feature[] {
  const body = r.body!;
  const ref = (i: number): Ref => ({ kind: 'edge', name: body.names.edges[i]!, fingerprint: edgeFingerprint(body.topology, i) });
  const find = (s: SharpEdge) => {
    const found = onSharp(kernel, r, s);
    if (found.length === 0) throw new RecognizeError(t('recognize.edgeNotFound', { kind: t(rec.type === 'fillet' ? 'recognize.name.fillet' : 'recognize.name.chamfer', { n: '' }).trim() }));
    return found;
  };
  if (rec.type === 'fillet') {
    const edges = [...new Set(rec.edges.flatMap(find))];
    const f: FilletFeature = { id: ids.take('fillet'), type: 'fillet', name: b.name('fillet'), suppressed: false, edges: edges.map(ref), radius: num(rec.radius), exact: true };
    return [f];
  }
  // a chamfer's first distance is on the face of the edge whose name sorts first (`flip`: the other one); edges are grouped by the distances that gives
  const groups = new Map<string, { first: number; second: number; edges: Set<number> }>();
  for (const e of rec.edges) {
    for (const i of find(e.edge)) {
      const faces = [...new Set(body.topology.edges[i]!.faces)].sort((x, y) => (body.names.faces[x]! < body.names.faces[y]! ? -1 : 1));
      const g = body.topology.faces[faces[0]!]?.geometry;
      const firstIsOne = sameSurface(g, e.supports[0]) ? true : sameSurface(g, e.supports[1]) ? false : null;
      if (firstIsOne === null) throw new RecognizeError(t('recognize.edgeNotFound', { kind: t('recognize.name.chamfer', { n: '' }).trim() }));
      const [first, second] = firstIsOne ? e.distances : [e.distances[1], e.distances[0]];
      const key = `${num(first)}|${num(second)}`;
      const grp = groups.get(key) ?? { first, second, edges: new Set<number>() };
      grp.edges.add(i);
      groups.set(key, grp);
    }
  }
  return [...groups.values()].map(
    (g): ChamferFeature => ({ id: ids.take('chamfer'), type: 'chamfer', name: b.name('chamfer'), suppressed: false, edges: [...g.edges].map(ref), mode: 'distanceDistance', distance: num(g.first), second: num(g.second) }),
  );
}

// ------------------------------------------------------------------ the whole

/**
 * The check when a spline was made of biarcs (ADR 0243): the solids are not the same, so they are compared for what the approximation promises. In the section at a quarter, the middle and
 * three quarters of each layer: the boundaries no further apart than the bound, and the areas that differ and that are not shared no more than that distance along the boundary. And the
 * volumes, by the same reasoning over the surface. A solid boolean is not asked for: two surfaces crossing each other within a hundredth of a millimetre is what it does worst.
 */
export function approximateReport(kernel: Kernel, whole: ShapeId, rebuilt: ShapeId, rec: Recognition, approx: SplineApproximation, base: Pick<ReconstructReport, 'features' | 'faces'>): ReconstructReport {
  // the flattening of the comparison, far smaller than any bound, and the rounding of the kernel's own section
  const SLACK = 1e-3;
  const limit = approx.bound + SLACK;
  const m0 = kernel.massProps(whole);
  const m1 = kernel.massProps(rebuilt);
  const volumeError = Math.abs(m1.volume - m0.volume) / m0.volume;
  const areaError = Math.abs(m1.area - m0.area) / m0.area;
  let [distance, sectionAreaError, sectionDifference, sections] = [0, 0, 0, 0];
  const box = kernel.bounds(whole);
  const reach = Math.hypot(...sub(box.max, box.min)) + 1;
  const extrusions = (b: BaseRecord): Extract<BaseRecord, { type: 'extrude' }>[] => (b.type === 'extrude' ? [b] : b.type === 'composite' ? [...extrusions(b.base), ...b.extras.map((x) => x.rec)] : []);
  for (const record of extrusions(rec.base)) {
    for (let i = 0; i + 1 < record.levels.length; i++) {
      const layer = record.layers[i]?.[0];
      if (!layer) continue;
      const height = record.levels[i + 1]! - record.levels[i]!;
      for (const f of [0.25, 0.5, 0.75]) {
        const frame = { ...layer.frame, origin: addv(layer.frame.origin, record.dir, height * f) };
        const across = (axis: Vec3) => Math.abs(dot(sub(box.min, frame.origin), axis)) + reach;
        const [u, v] = [across(frame.xDir), across(frame.yDir)];
        const rect = { u0: -u, u1: u, v0: -v, v1: v };
        const c = compareSections(kernel.sectionEdges(whole, frame, rect), kernel.sectionEdges(rebuilt, frame, rect));
        if (!c) throw new RecognizeError(t('recognize.approxCompareFailed'));
        sections += 1;
        distance = Math.max(distance, c.distance);
        const areaOff = Math.abs(c.areaA - c.areaB);
        if (!sectionsClose(c, limit)) {
          throw new RecognizeError(t('recognize.approxNotClose', { distance: c.distance.toExponential(2), bound: approx.bound.toExponential(2), area: areaOff.toExponential(2), notShared: c.notShared.toExponential(2) }));
        }
        if (c.areaA > 0) {
          sectionAreaError = Math.max(sectionAreaError, areaOff / c.areaA);
          sectionDifference = Math.max(sectionDifference, c.notShared / c.areaA);
        }
      }
    }
  }
  // nothing compared would be nothing checked
  if (sections === 0) throw new RecognizeError(t('recognize.approxCompareFailed'));
  if (Math.abs(m1.volume - m0.volume) > limit * m0.area + RECOGNIZE_TOLERANCE * m0.volume) {
    throw new RecognizeError(t('recognize.notSame', { volume: volumeError.toExponential(2), area: areaError.toExponential(2), difference: sectionDifference.toExponential(2) }));
  }
  return { ...base, volume: m0.volume, volumeError, areaError, difference: sectionDifference, approximation: { bound: approx.bound, distance, sectionAreaError, sectionDifference, sections } };
}

function arcsOf(b: BaseRecord): number {
  if (b.type === 'composite') return arcsOf(b.base) + b.extras.reduce((n, x) => n + arcsOf(x.rec), 0);
  const profiles = b.type === 'revolve' ? [b.profile] : b.type === 'loft' ? b.sections : b.layers.flat();
  return profiles.reduce((n, p) => n + p.loops.reduce((m, l) => m + l.segs.filter((s) => s.kind === 'arc').length, 0), 0);
}

function failedOf(r: RebuildResult, ids: Iterable<Id>): string | null {
  for (const id of ids) {
    const f = r.features.find((x) => x.id === id);
    if (!f || f.status !== 'ok') return f?.message ?? `${id}: ${f?.status ?? 'missing'}`;
  }
  return null;
}

/**
 * Replaces imported body `featureId` of `doc` by the features that build it (F2.4). `regen` is the regenerator of the document (its kernel and the
 * document's blobs); with `solver`, every sketch made is fully defined (`Builder.define`). Returns the new document; throws `RecognizeError` and leaves nothing changed when the body cannot be rebuilt the same.
 */
export function reconstructImported(kernel: Kernel, regen: Regenerator, doc: PartDoc, featureId: Id, solver?: SketchSolver, limits: BudgetLimits = RECOGNIZE_LIMITS, options: ReconstructOptions = {}): { doc: PartDoc; commands: Command[]; report: ReconstructReport } {
  const index = doc.features.findIndex((f) => f.id === featureId);
  const imported = doc.features[index];
  if (!imported || imported.type !== 'importedBody') throw new RecognizeError(t('recognize.notImported'));
  if (imported.suppressed) throw new RecognizeError(t('recognize.suppressed'));
  const blob = doc.blobs.find((b) => b.id === imported.blob);
  if (!blob) throw new RecognizeError(t('recognize.notImported'));
  const budget = startBudget(kernel, limits);
  const keep: ShapeId[] = [];
  try {
    const before = regen.rebuild(doc);
    const okBefore = before.features.filter((f) => f.status === 'ok').map((f) => f.id);
    if (!okBefore.includes(featureId) || !before.body) throw new RecognizeError(t('recognize.importFailed'));
    const whole = kernel.copy(before.body.shape);
    keep.push(whole);
    // the imported body by itself
    const alone = applyCommand(createEmptyPart(), { type: 'importBody', blob, feature: { ...imported, merge: undefined }, index: 0 });
    budget.check();
    const solo = regen.rebuild(alone);
    if (!solo.body || failedOf(solo, [featureId])) throw new RecognizeError(t('recognize.importFailed'));
    const shape = kernel.copy(solo.body.shape);
    keep.push(shape);
    const facesBefore = solo.body.topology.faces.length;
    budget.check();
    const attempt = (rounds: FreeRoundsOption): { doc: PartDoc; commands: Command[]; report: ReconstructReport } => {
      const approx: SplineApproximation | undefined = options.approximateSplines ? { tolerance: SPLINE_TOLERANCE, bound: 0, used: false } : undefined;
      const rec = recognize(kernel, shape, frameFor, budget, approx, rounds);
      // a solver that cannot take the sketch is what an approximation runs into first: say how many arcs it came to
      const whyFailed = (why: string): string => t('recognize.featureFailed', { why }) + (approx?.used ? ` ${t('recognize.approxArcs', { arcs: arcsOf(rec.base) })}` : '');

      const ids = new IdAllocator(doc.idCounters, idsInUse(doc));
      const b = new Builder(ids, solver);
      b.base(rec, imported.merge);
      b.holes(rec.holes);
      // the commands, as the app applies them in one undoable step
      const commands: Command[] = [];
      let next = doc;
      const run = (cmd: Command) => {
        commands.push(cmd);
        next = applyCommand(next, cmd);
      };
      b.features.forEach((f, k) => run({ type: 'insertFeature', feature: f, index: index + 1 + k }));
      run({ type: 'deleteFeatures', featureIds: [featureId] });
      let end = index + b.features.length;
      const made = b.features.map((f) => f.id);
      for (const blend of rec.blends) {
        budget.check();
        const r = regen.rebuild(next, { until: end });
        const failed = failedOf(r, made);
        if (failed) throw new RecognizeError(whyFailed(failed));
        for (const f of blendFeature(kernel, blend, r, ids, b)) {
          run({ type: 'insertFeature', feature: f, index: end });
          made.push(f.id);
          end++;
        }
      }
      budget.check();
      const after = regen.rebuild(next);
      const failed = failedOf(after, [...made, ...okBefore.filter((id) => id !== featureId)]);
      if (failed) throw new RecognizeError(whyFailed(failed));
      if (!after.body) throw new RecognizeError(t('recognize.featureFailed', { why: '—' }));
      budget.check();
      if (approx?.used) {
        const report = approximateReport(kernel, whole, after.body.shape, rec, approx, { features: { ...b.counts }, faces: [facesBefore, after.body.topology.faces.length] });
        return { doc: next, commands, report };
      }
      // a body some of whose spline faces were read as simple surfaces (C4) is rebuilt with those surfaces themselves, and OCCT's usual volume of the
      // spline original is then the coarser figure (measured: a disc of B-spline faces 1.97e-6 off its true volume, 1.0e-8 integrated to 1e-10): both
      // volumes are integrated that finely, so the check compares the bodies and not the rule
      const fine = rounds.substituted ? { eps: 1e-10 } : {};
      const m0 = kernel.massProps(whole, fine);
      const area0 = kernel.surfaceArea(whole);
      // a file whose faces meet only to a tolerance past 1e-7: a solid whose faces really meet may differ from it by that much, face by face (ADR 0249,
      // the user's ruling of 2026-11-11); a file joined to working precision has no allowance and is held to RECOGNIZE_TOLERANCE as before
      const own = kernel.fileTolerance(whole);
      const allow = own.count > 0 ? own : null;
      const compare = (body: NonNullable<RebuildResult['body']>): ReconstructReport => {
        budget.check();
        const m1 = kernel.massProps(body.shape, fine);
        const volumeError = Math.abs(m1.volume - m0.volume) / m0.volume;
        // the area to a set precision: the fixed rule is off by more than the tolerance on faces with many B-spline holes (C1)
        const areaError = Math.abs(kernel.surfaceArea(body.shape) - area0) / area0;
        // the volume between the two, as each boundary's distance to the other integrated over it, the larger way (ADR 0248): a boolean of two near-equal
        // solids with B-spline faces traps or runs for minutes (an imported round against the exact one that rebuilt it), and could not see a 2e-6 mm
        // difference (it gave 0); the volume less twice the shared one keeps the integration error of near-equal figures (7e-6 of a plate)
        budget.check();
        const ab = kernel.surfaceDeviation(whole, body.shape, undefined, allow ? { a: allow.faces } : undefined);
        const ba = kernel.surfaceDeviation(body.shape, whole, undefined, allow ? { b: allow.faces } : undefined);
        const difference = Math.max(ab.excess, ba.excess) / m0.volume;
        const fileTolerance = allow
          ? { faces: allow.count, max: allow.max, volume: allow.volume / m0.volume, area: allow.area / area0, difference: Math.max(ab.integral, ba.integral) / m0.volume }
          : undefined;
        return { features: { ...b.counts }, faces: [facesBefore, body.topology.faces.length], volume: m0.volume, volumeError, areaError, difference, ...(fileTolerance ? { fileTolerance } : {}) };
      };
      const matches = (r: ReconstructReport) =>
        r.volumeError <= RECOGNIZE_TOLERANCE + (r.fileTolerance?.volume ?? 0) &&
        r.areaError <= RECOGNIZE_TOLERANCE + (r.fileTolerance?.area ?? 0) &&
        r.difference <= RECOGNIZE_TOLERANCE;
      const report = compare(after.body);
      if (matches(report)) return { doc: next, commands, report };
      if (end === next.features.length && b.counts.chamfer > 0) {
        const chamfers = new Set(next.features.filter((f) => f.type === 'chamfer' && made.includes(f.id)).map((f) => f.id));
        const faces = extraChamferCaps(after.body, kernel.topology(whole), chamfers);
        if (faces.length) {
          const id = ids.take('deleteFace');
          const cmd: Command = { type: 'insertFeature', index: end, feature: { id, type: 'deleteFace', name: t('feature.deleteFace'), suppressed: false, faces } };
          const candidate = applyCommand(next, cmd);
          const rebuilt = regen.rebuild(candidate);
          if (rebuilt.body && !failedOf(rebuilt, [...made, id, ...okBefore.filter((f) => f !== featureId)])) {
            const repaired = compare(rebuilt.body);
            if (matches(repaired)) return { doc: candidate, commands: [...commands, cmd], report: repaired };
          }
        }
      }
      throw new RecognizeError(t('recognize.notSame', { volume: report.volumeError.toExponential(2), area: report.areaError.toExponential(2), difference: report.difference.toExponential(2) }));
    };
    // A face read as the simple surface it is within tolerance is nominated the same way (C4): an attempt refused with such faces is asked once more
    // with every face as the file has it, which is what was done before. Only an attempt that read some face so is asked again: one that read none
    // would be the same computation twice (rolling-ball fuzz seed 46 takes 264 s of its 300 s limit at the previous HEAD).
    type Outcome = { done: ReturnType<typeof attempt> } | { refused: RecognizeError; nominated: number };
    const tried = (free: boolean): Outcome => {
      const opt: FreeRoundsOption = { ...(free ? {} : { free: false }), analytic: true };
      try {
        return { done: attempt(opt) };
      } catch (e) {
        if (!(e instanceof RecognizeError)) throw e;
        const refused = { refused: e, nominated: opt.nominated ?? 0 };
        // refused at the freeform-face check, the same body with fewer faces read as simple ones has those faces and more to pass it: it cannot
        if (!opt.substituted || e.freeform) return refused;
        try {
          return { done: attempt({ ...opt, analytic: false }) };
        } catch (again) {
          if (!(again instanceof RecognizeError)) throw again;
          return refused;
        }
      }
    };
    // a face read as a rolling-ball round is only nominated (ADR 0249): refused with the rounds, the body is asked again without them, as it was before
    // C2.8 (an elliptical corner of an extrusion is near a ball, and an extrusion without it); refused again, the first answer says more
    const first = tried(true);
    if ('done' in first) return first.done;
    if (!first.nominated) throw first.refused;
    const second = tried(false);
    if ('done' in second) return second.done;
    throw first.refused;
  } finally {
    for (const id of keep) kernel.release(id);
  }
}

export { recognize };
export type { Recognition };

/**
 * The parts of a sketch that share no point: each entity's points (and each relation or dimension's) in one part; `@origin` and the axes, fixed, join none.
 * A relation or dimension of nothing in the sketch but those is a part of its own (-1).
 */
function sketchParts(sketch: SketchFeature): { entity: (e: SketchEntity) => number; of: (c: SketchConstraint) => number } {
  const parent = new Map<Id, Id>();
  const find = (x: Id): Id => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) {
      const n = parent.get(y)!;
      parent.set(y, r);
      y = n;
    }
    return r;
  };
  const ids = new Set(sketch.entities.map((e) => e.id));
  for (const id of ids) parent.set(id, id);
  const join = (xs: Id[]) => {
    const own = xs.filter((x) => ids.has(x));
    for (let i = 1; i < own.length; i++) parent.set(find(own[i]!), find(own[0]!));
  };
  const refs = (o: object): Id[] => Object.entries(o).flatMap(([k, v]) => (k === 'id' || k === 'type' || k === 'value' ? [] : typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []));
  for (const e of sketch.entities) join([e.id, ...refs(e)]);
  for (const c of sketch.constraints) join(refs(c));
  const roots = new Map<Id, number>();
  const number = (id: Id) => {
    const r = find(id);
    if (!roots.has(r)) roots.set(r, roots.size);
    return roots.get(r)!;
  };
  return {
    entity: (e) => number(e.id),
    of: (c) => {
      const own = refs(c).filter((x) => ids.has(x));
      return own.length ? number(own[0]!) : -1;
    },
  };
}
