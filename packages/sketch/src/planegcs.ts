import { Algorithm, make_gcs_wrapper, SolveStatus, type GcsWrapper, type SketchPrimitive } from '@salusoft89/planegcs';
import {
  constraintRefs,
  entityPoints,
  evalAngle,
  evalLength,
  SKETCH_ORIGIN,
  type Id,
  type SketchEntity,
  type SketchFeature,
} from '@3db/model';
import type { EntityStatus, SketchSolver, SketchStatus, SolvedGeometry, SolvedSketch, SolveOptions } from './types';

type Prim = SketchPrimitive;

class MappingError extends Error {}

/** End points of an open curve (none for points and circles). */
function endpoints(e: SketchEntity): Id[] {
  return e.type === 'line' ? [e.p1, e.p2] : e.type === 'arc' ? [e.start, e.end] : [];
}

/** Values the solver starts from: stored positions unless overridden (drag frames, analysis). */
interface Start {
  points: Map<Id, [number, number]>;
  radii: Map<Id, number>;
}

function startValues(initial: SolveOptions['initial']): Start {
  return {
    points: new Map((initial?.points ?? []).map((p) => [p.id, [p.x, p.y]])),
    radii: new Map((initial?.radii ?? []).map((r) => [r.id, r.radius])),
  };
}

/**
 * Maps the SSOT sketch onto PlaneGCS primitives. One model constraint may expand to several
 * (suffix "#k"). `pinned` points are fixed in place (used by the definition analysis).
 */
function toPrimitives(sketch: SketchFeature, start: Start, pinned: ReadonlySet<Id> = new Set()): Prim[] {
  const byId = new Map<Id, SketchEntity>(sketch.entities.map((e) => [e.id, e]));
  const kind = (id: Id) => (id === SKETCH_ORIGIN ? 'point' : byId.get(id)?.type);
  const point = (id: Id) => {
    if (kind(id) !== 'point') throw new MappingError(`「${id}」不是點`);
    return id;
  };
  const line = (id: Id) => {
    const e = byId.get(id);
    if (e?.type !== 'line') throw new MappingError(`「${id}」不是直線`);
    return e;
  };
  const stored = (id: Id): [number, number] => {
    if (id === SKETCH_ORIGIN) return [0, 0];
    const e = byId.get(id);
    if (e?.type !== 'point') throw new MappingError(`「${id}」不是點`);
    return [e.x, e.y];
  };
  const pointXY = (id: Id): [number, number] => start.points.get(id) ?? stored(id);
  /** A point, or the center of a circle/arc (SW measures circles from their center). */
  const anchor = (id: Id): Id => {
    const e = byId.get(id);
    if (e?.type === 'circle' || e?.type === 'arc') return e.center;
    return point(id);
  };
  const radial = (id: Id) => {
    const e = byId.get(id);
    if (e?.type === 'circle' || e?.type === 'arc') return e;
    throw new MappingError(`「${id}」不是圓或圓弧`);
  };

  const prims: Prim[] = [{ id: SKETCH_ORIGIN, type: 'point', x: 0, y: 0, fixed: true }];
  for (const e of sketch.entities) {
    switch (e.type) {
      case 'point': {
        const [x, y] = pointXY(e.id);
        prims.push({ id: e.id, type: 'point', x, y, fixed: pinned.has(e.id) });
        break;
      }
      case 'line':
        prims.push({ id: e.id, type: 'line', p1_id: e.p1, p2_id: e.p2 });
        break;
      case 'circle':
        prims.push({ id: e.id, type: 'circle', c_id: e.center, radius: start.radii.get(e.id) ?? e.radius });
        break;
      case 'arc': {
        const [cx, cy] = pointXY(e.center);
        const [sx, sy] = pointXY(e.start);
        const [ex, ey] = pointXY(e.end);
        prims.push({
          id: e.id,
          type: 'arc',
          c_id: e.center,
          start_id: e.start,
          end_id: e.end,
          start_angle: Math.atan2(sy - cy, sx - cx),
          end_angle: Math.atan2(ey - cy, ex - cx),
          radius: Math.hypot(sx - cx, sy - cy),
        });
        prims.push({ id: `${e.id}#rules`, type: 'arc_rules', a_id: e.id });
        break;
      }
    }
  }

  const add = (id: Id, list: Prim[]) => list.forEach((p, k) => prims.push({ ...p, id: list.length === 1 ? id : `${id}#${k}` } as Prim));

  for (const c of sketch.constraints) {
    if ('driving' in c && c.driving === false) continue; // driven (reference) dimensions are outputs
    const id = c.id;
    switch (c.type) {
      case 'coincident':
        add(id, [{ id, type: 'p2p_coincident', p1_id: point(c.a), p2_id: point(c.b) }]);
        break;
      case 'horizontal':
        add(id, [c.b === undefined ? { id, type: 'horizontal_l', l_id: line(c.a).id } : { id, type: 'horizontal_pp', p1_id: point(c.a), p2_id: point(c.b) }]);
        break;
      case 'vertical':
        add(id, [c.b === undefined ? { id, type: 'vertical_l', l_id: line(c.a).id } : { id, type: 'vertical_pp', p1_id: point(c.a), p2_id: point(c.b) }]);
        break;
      case 'parallel':
        add(id, [{ id, type: 'parallel', l1_id: line(c.a).id, l2_id: line(c.b).id }]);
        break;
      case 'perpendicular':
        add(id, [{ id, type: 'perpendicular_ll', l1_id: line(c.a).id, l2_id: line(c.b).id }]);
        break;
      case 'collinear': {
        const a = line(c.a);
        const b = line(c.b);
        add(id, [
          { id, type: 'parallel', l1_id: a.id, l2_id: b.id },
          { id, type: 'point_on_line_pl', p_id: a.p1, l_id: b.id },
        ]);
        break;
      }
      case 'tangent': {
        const a = byId.get(c.a);
        const b = byId.get(c.b);
        const shared = a && b ? endpoints(a).find((p) => endpoints(b).includes(p)) : undefined;
        if (a && b && shared) {
          // Tangent where the curves meet (e.g. a tangent arc): the curves' normals at the shared end
          // are parallel. "Center at distance r from the line" would be redundant with "the end lies on
          // the circle" exactly at tangency, and the solver would report the sketch over-defined.
          const at = pointXY(shared);
          const normal = (e: SketchEntity): [number, number] => {
            if (e.type === 'line') {
              const [ax, ay] = pointXY(e.p1);
              const [bx, by] = pointXY(e.p2);
              return [-(by - ay), bx - ax]; // PlaneGCS line normal: direction rotated counter-clockwise
            }
            const [cx, cy] = pointXY((e as Extract<SketchEntity, { center: Id }>).center);
            return [cx - at[0], cy - at[1]]; // PlaneGCS circle/arc normal: toward the center
          };
          const [n1, n2] = [normal(a), normal(b)];
          const theta = Math.atan2(n2[1], n2[0]) - Math.atan2(n1[1], n1[0]);
          const angle = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) < Math.PI / 2 ? 0 : Math.PI;
          add(id, [{ id, type: 'angle_via_point', crv1_id: a.id, crv2_id: b.id, p_id: shared, angle }]);
        } else if (a?.type === 'line' || b?.type === 'line') {
          const [l, r] = a?.type === 'line' ? [c.a, c.b] : [c.b, c.a];
          const rad = radial(r);
          line(l);
          add(id, [rad.type === 'circle' ? { id, type: 'tangent_lc', l_id: l, c_id: r } : { id, type: 'tangent_la', l_id: l, a_id: r }]);
        } else {
          const ra = radial(c.a);
          const rb = radial(c.b);
          if (ra.type === 'circle' && rb.type === 'circle') add(id, [{ id, type: 'tangent_cc', c1_id: ra.id, c2_id: rb.id }]);
          else if (ra.type === 'arc' && rb.type === 'arc') add(id, [{ id, type: 'tangent_aa', a1_id: ra.id, a2_id: rb.id }]);
          else {
            const [circle, arc] = ra.type === 'circle' ? [ra, rb] : [rb, ra];
            add(id, [{ id, type: 'tangent_ca', c_id: circle.id, a_id: arc.id }]);
          }
        }
        break;
      }
      case 'concentric':
        add(id, [{ id, type: 'p2p_coincident', p1_id: radial(c.a).center, p2_id: radial(c.b).center }]);
        break;
      case 'equal': {
        const a = byId.get(c.a);
        const b = byId.get(c.b);
        if (a?.type === 'line' && b?.type === 'line') add(id, [{ id, type: 'equal_length', l1_id: a.id, l2_id: b.id }]);
        else if (a?.type === 'circle' && b?.type === 'circle') add(id, [{ id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id }]);
        else if (a?.type === 'arc' && b?.type === 'arc') add(id, [{ id, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id }]);
        else if (a?.type === 'circle' && b?.type === 'arc') add(id, [{ id, type: 'equal_radius_ca', c1_id: a.id, a2_id: b.id }]);
        else if (a?.type === 'arc' && b?.type === 'circle') add(id, [{ id, type: 'equal_radius_ca', c1_id: b.id, a2_id: a.id }]);
        else throw new MappingError('相等只適用於兩條直線或兩個圓/圓弧');
        break;
      }
      case 'midpoint': {
        const l = line(c.line);
        add(id, [{ id, type: 'p2p_symmetric_ppp', p1_id: l.p1, p2_id: l.p2, p_id: point(c.point) }]);
        break;
      }
      case 'pointOnCurve': {
        const curve = byId.get(c.curve);
        const p = point(c.point);
        if (curve?.type === 'line') add(id, [{ id, type: 'point_on_line_pl', p_id: p, l_id: curve.id }]);
        else if (curve?.type === 'circle') add(id, [{ id, type: 'point_on_circle', p_id: p, c_id: curve.id }]);
        else if (curve?.type === 'arc') add(id, [{ id, type: 'point_on_arc', p_id: p, a_id: curve.id }]);
        else throw new MappingError(`「${c.curve}」不是直線、圓或圓弧`);
        break;
      }
      case 'symmetric':
        add(id, [{ id, type: 'p2p_symmetric_ppl', p1_id: point(c.a), p2_id: point(c.b), l_id: line(c.axis).id }]);
        break;
      case 'fix': {
        // Fixed at the stored position: that is the intent, whatever the solver starts from.
        const [x, y] = stored(c.point);
        add(id, [
          { id, type: 'coordinate_x', p_id: point(c.point), x },
          { id, type: 'coordinate_y', p_id: point(c.point), y },
        ]);
        break;
      }
      case 'distance': {
        const value = evalLength(c.value);
        const a = byId.get(c.a);
        const b = c.b === undefined ? undefined : byId.get(c.b);
        if (c.b === undefined) {
          const l = line(c.a);
          add(id, [{ id, type: 'p2p_distance', p1_id: l.p1, p2_id: l.p2, distance: value }]);
        } else if (a?.type === 'line' && b?.type === 'line') {
          add(id, [{ id, type: 'p2l_distance', p_id: a.p1, l_id: b.id, distance: value }]);
        } else if (a?.type === 'line') {
          add(id, [{ id, type: 'p2l_distance', p_id: anchor(c.b), l_id: a.id, distance: value }]);
        } else if (b?.type === 'line') {
          add(id, [{ id, type: 'p2l_distance', p_id: anchor(c.a), l_id: b.id, distance: value }]);
        } else {
          add(id, [{ id, type: 'p2p_distance', p1_id: anchor(c.a), p2_id: anchor(c.b), distance: value }]);
        }
        break;
      }
      case 'distanceX':
      case 'distanceY': {
        const prop = c.type === 'distanceX' ? 'x' : 'y';
        const pa = anchor(c.a);
        const pb = anchor(c.b);
        const axis = prop === 'x' ? 0 : 1;
        const sign = pointXY(pb)[axis] - pointXY(pa)[axis] >= 0 ? 1 : -1;
        add(id, [{ id, type: 'difference', param1: { o_id: pa, prop }, param2: { o_id: pb, prop }, difference: sign * evalLength(c.value) }]);
        break;
      }
      case 'radius':
      case 'diameter': {
        const r = radial(c.circle);
        const v = evalLength(c.value);
        if (c.type === 'radius') {
          add(id, [r.type === 'circle' ? { id, type: 'circle_radius', c_id: r.id, radius: v } : { id, type: 'arc_radius', a_id: r.id, radius: v }]);
        } else {
          add(id, [r.type === 'circle' ? { id, type: 'circle_diameter', c_id: r.id, diameter: v } : { id, type: 'arc_diameter', a_id: r.id, diameter: v }]);
        }
        break;
      }
      case 'angle': {
        // l2l_angle_ll turns a's direction (as drawn) onto b's. With one ray reversed the dimension's
        // sector lies half a turn round, so the lines' own angle is the value less 180°.
        const oneFlipped = c.flip === 'a' || c.flip === 'b';
        add(id, [{ id, type: 'l2l_angle_ll', l1_id: line(c.a).id, l2_id: line(c.b).id, angle: evalAngle(c.value) - (oneFlipped ? Math.PI : 0) }]);
        break;
      }
    }
  }
  return prims;
}

/** Temporary (soft) constraints pulling dragged points and radii toward the cursor (A2.6). */
function dragPrimitives(sketch: SketchFeature, drag: SolveOptions['drag']): Prim[] {
  const prims: Prim[] = [];
  for (const p of drag?.points ?? []) {
    prims.push({ id: `@drag.x.${p.id}`, type: 'coordinate_x', p_id: p.id, x: p.x, temporary: true });
    prims.push({ id: `@drag.y.${p.id}`, type: 'coordinate_y', p_id: p.id, y: p.y, temporary: true });
  }
  for (const r of drag?.radii ?? []) {
    const e = sketch.entities.find((x) => x.id === r.id);
    if (e?.type === 'circle') prims.push({ id: `@drag.r.${r.id}`, type: 'circle_radius', c_id: r.id, radius: r.radius, temporary: true });
    else if (e?.type === 'arc') prims.push({ id: `@drag.r.${r.id}`, type: 'arc_radius', a_id: r.id, radius: r.radius, temporary: true });
  }
  return prims;
}

const baseId = (gcsId: string) => gcsId.split('#')[0]!;
const unique = (ids: (string | undefined)[]) =>
  [...new Set(ids.filter((id): id is string => typeof id === 'string').map(baseId))].filter((id) => id !== SKETCH_ORIGIN && !id.startsWith('@'));

function readGeometry(w: GcsWrapper, sketch: SketchFeature): Map<Id, SolvedGeometry> {
  const out = new Map<Id, SolvedGeometry>();
  const pt = (id: Id): [number, number] => {
    const p = w.sketch_index.get_sketch_point(id);
    return [p.x, p.y];
  };
  for (const e of sketch.entities) {
    const construction = e.construction ?? false;
    switch (e.type) {
      case 'point':
        out.set(e.id, { type: 'point', p: pt(e.id) });
        break;
      case 'line':
        out.set(e.id, { type: 'line', a: pt(e.p1), b: pt(e.p2), p1: e.p1, p2: e.p2, construction });
        break;
      case 'circle': {
        const c = w.sketch_index.get_sketch_circle(e.id);
        out.set(e.id, { type: 'circle', c: pt(e.center), r: c.radius, center: e.center, construction });
        break;
      }
      case 'arc': {
        const a = w.sketch_index.get_sketch_arc(e.id);
        out.set(e.id, { type: 'arc', c: pt(e.center), r: a.radius, a0: a.start_angle, a1: a.end_angle, center: e.center, start: e.start, end: e.end, construction });
        break;
      }
    }
  }
  return out;
}

/** Sketch solver backed by FreeCAD's PlaneGCS (LGPL) compiled to WASM. */
export class PlaneGcsSolver implements SketchSolver {
  private constructor(private readonly w: GcsWrapper) {}

  static async create(wasmUrl?: string): Promise<PlaneGcsSolver> {
    return new PlaneGcsSolver(await make_gcs_wrapper(wasmUrl));
  }

  /** Loads a system and solves it; true when it converged (the solution is then applied). */
  private run(prims: Prim[]): boolean {
    const w = this.w;
    w.clear_data();
    w.push_primitives_and_params(prims);
    let result = w.solve(Algorithm.DogLeg);
    if (result !== SolveStatus.Success && result !== SolveStatus.Converged) {
      result = w.solve(Algorithm.LevenbergMarquardt);
    }
    const ok = result === SolveStatus.Success || result === SolveStatus.Converged;
    if (ok) w.apply_solution();
    return ok;
  }

  solve(sketch: SketchFeature, options: SolveOptions = {}): SolvedSketch {
    const w = this.w;
    let prims: Prim[];
    try {
      prims = toPrimitives(sketch, startValues(options.initial));
    } catch (e) {
      return { geometry: new Map(), status: 'failed', dof: 0, conflicting: [], redundant: [], message: (e as Error).message };
    }
    const ok = this.run([...prims, ...dragPrimitives(sketch, options.drag)]);
    const conflicting = unique(w.get_gcs_conflicting_constraints());
    const redundant = unique(w.get_gcs_redundant_constraints());
    const dof = w.gcs.dof();
    let status: SketchStatus;
    if (conflicting.length > 0 || redundant.length > 0) status = 'over';
    else if (!ok) status = 'failed';
    else status = dof === 0 ? 'fully' : 'under';
    const result: SolvedSketch = {
      geometry: readGeometry(w, sketch),
      status,
      dof,
      conflicting,
      redundant,
      ...(ok ? {} : { message: '草圖無法求解' }),
    };
    if (options.analyze) result.entityStatus = this.analyze(sketch, result, ok);
    return result;
  }

  /**
   * Per-entity definition (C1.31). A point is fully defined when pinning it where it is does not
   * change the sketch's degrees of freedom: then no remaining freedom can move it. This is an exact
   * rank computation by the solver, one extra solve per point, not a heuristic.
   */
  private analyze(sketch: SketchFeature, base: SolvedSketch, ok: boolean): Map<Id, EntityStatus> {
    const over = new Set<Id>();
    for (const c of sketch.constraints) {
      if (base.conflicting.includes(c.id) || base.redundant.includes(c.id)) for (const r of constraintRefs(c)) over.add(r);
    }

    const solved: Start = { points: new Map(), radii: new Map() };
    for (const [id, g] of base.geometry) {
      if (g.type === 'point') solved.points.set(id, g.p);
      else if (g.type === 'circle') solved.radii.set(id, g.r);
    }
    const allFixed = ok && base.dof === 0;
    const probe = (prims: Prim[]) => this.run(prims) && this.w.gcs.dof() === base.dof;
    const points = new Map<Id, boolean>();
    const pointFixed = (id: Id): boolean => {
      if (allFixed) return true;
      if (!ok) return false;
      let v = points.get(id);
      if (v === undefined) {
        v = probe(toPrimitives(sketch, solved, new Set([id])));
        points.set(id, v);
      }
      return v;
    };
    const radiusFixed = (id: Id): boolean => {
      if (allFixed) return true;
      if (!ok) return false;
      return probe([...toPrimitives(sketch, solved), { id: '@probe.r', type: 'circle_radius', c_id: id, radius: solved.radii.get(id) ?? 1 }]);
    };

    const status = new Map<Id, EntityStatus>();
    for (const e of sketch.entities) {
      const pts = e.type === 'point' ? [e.id] : entityPoints(e);
      if (over.has(e.id) || pts.some((p) => over.has(p))) {
        status.set(e.id, 'over');
        continue;
      }
      const fully = pts.every(pointFixed) && (e.type !== 'circle' || radiusFixed(e.id));
      status.set(e.id, fully ? 'fully' : 'under');
    }
    return status;
  }
}
