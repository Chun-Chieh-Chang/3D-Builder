import { Algorithm, make_gcs_wrapper, SolveStatus, type GcsWrapper, type SketchPrimitive } from '@salusoft89/planegcs';
import { evalAngle, evalLength, SKETCH_ORIGIN, type Id, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import type { SketchSolver, SolvedGeometry, SolvedSketch, SketchStatus } from './types';

type Prim = SketchPrimitive;

class MappingError extends Error {}

/** Maps the SSOT sketch onto PlaneGCS primitives. One model constraint may expand to several (suffix "#k"). */
function toPrimitives(sketch: SketchFeature): Prim[] {
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
  const pointXY = (id: Id): [number, number] => {
    if (id === SKETCH_ORIGIN) return [0, 0];
    const e = byId.get(id);
    if (e?.type !== 'point') throw new MappingError(`「${id}」不是點`);
    return [e.x, e.y];
  };
  /** A point, or the center of a circle/arc (SW measures circles from their center). */
  const anchor = (id: Id): Id => {
    const e = byId.get(id);
    if (e?.type === 'circle' || e?.type === 'arc') return e.center;
    return point(id);
  };

  const prims: Prim[] = [{ id: SKETCH_ORIGIN, type: 'point', x: 0, y: 0, fixed: true }];
  for (const e of sketch.entities) {
    switch (e.type) {
      case 'point':
        prims.push({ id: e.id, type: 'point', x: e.x, y: e.y, fixed: false });
        break;
      case 'line':
        prims.push({ id: e.id, type: 'line', p1_id: e.p1, p2_id: e.p2 });
        break;
      case 'circle':
        prims.push({ id: e.id, type: 'circle', c_id: e.center, radius: e.radius });
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

  const add = (c: SketchConstraint, list: Prim[]) => list.forEach((p, k) => prims.push({ ...p, id: list.length === 1 ? c.id : `${c.id}#${k}` } as Prim));
  const radial = (id: Id) => {
    const e = byId.get(id);
    if (e?.type === 'circle' || e?.type === 'arc') return e;
    throw new MappingError(`「${id}」不是圓或圓弧`);
  };

  for (const c of sketch.constraints) {
    if ('driving' in c && c.driving === false) continue; // driven (reference) dimensions are outputs
    const id = c.id;
    switch (c.type) {
      case 'coincident':
        add(c, [{ id, type: 'p2p_coincident', p1_id: point(c.a), p2_id: point(c.b) }]);
        break;
      case 'horizontal':
        add(c, [{ id, type: 'horizontal_l', l_id: line(c.line).id }]);
        break;
      case 'vertical':
        add(c, [{ id, type: 'vertical_l', l_id: line(c.line).id }]);
        break;
      case 'parallel':
        add(c, [{ id, type: 'parallel', l1_id: line(c.a).id, l2_id: line(c.b).id }]);
        break;
      case 'perpendicular':
        add(c, [{ id, type: 'perpendicular_ll', l1_id: line(c.a).id, l2_id: line(c.b).id }]);
        break;
      case 'collinear': {
        const a = line(c.a);
        const b = line(c.b);
        add(c, [
          { id, type: 'parallel', l1_id: a.id, l2_id: b.id },
          { id, type: 'point_on_line_pl', p_id: a.p1, l_id: b.id },
        ]);
        break;
      }
      case 'tangent': {
        const [l, r] = byId.get(c.a)?.type === 'line' ? [c.a, c.b] : [c.b, c.a];
        const rad = radial(r);
        line(l);
        add(c, [rad.type === 'circle' ? { id, type: 'tangent_lc', l_id: l, c_id: r } : { id, type: 'tangent_la', l_id: l, a_id: r }]);
        break;
      }
      case 'concentric':
        add(c, [{ id, type: 'p2p_coincident', p1_id: radial(c.a).center, p2_id: radial(c.b).center }]);
        break;
      case 'equal': {
        const a = byId.get(c.a);
        const b = byId.get(c.b);
        if (a?.type === 'line' && b?.type === 'line') add(c, [{ id, type: 'equal_length', l1_id: a.id, l2_id: b.id }]);
        else if (a?.type === 'circle' && b?.type === 'circle') add(c, [{ id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id }]);
        else if (a?.type === 'arc' && b?.type === 'arc') add(c, [{ id, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id }]);
        else if (a?.type === 'circle' && b?.type === 'arc') add(c, [{ id, type: 'equal_radius_ca', c1_id: a.id, a2_id: b.id }]);
        else if (a?.type === 'arc' && b?.type === 'circle') add(c, [{ id, type: 'equal_radius_ca', c1_id: b.id, a2_id: a.id }]);
        else throw new MappingError('相等只適用於兩條直線或兩個圓/圓弧');
        break;
      }
      case 'midpoint': {
        const l = line(c.line);
        add(c, [{ id, type: 'p2p_symmetric_ppp', p1_id: l.p1, p2_id: l.p2, p_id: point(c.point) }]);
        break;
      }
      case 'pointOnLine':
        add(c, [{ id, type: 'point_on_line_pl', p_id: point(c.point), l_id: line(c.line).id }]);
        break;
      case 'symmetric':
        add(c, [{ id, type: 'p2p_symmetric_ppl', p1_id: point(c.a), p2_id: point(c.b), l_id: line(c.axis).id }]);
        break;
      case 'fix': {
        const [x, y] = pointXY(c.point);
        add(c, [
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
          add(c, [{ id, type: 'p2p_distance', p1_id: l.p1, p2_id: l.p2, distance: value }]);
        } else if (a?.type === 'line' && b?.type === 'line') {
          add(c, [{ id, type: 'p2l_distance', p_id: a.p1, l_id: b.id, distance: value }]);
        } else if (a?.type === 'line') {
          add(c, [{ id, type: 'p2l_distance', p_id: anchor(c.b), l_id: a.id, distance: value }]);
        } else if (b?.type === 'line') {
          add(c, [{ id, type: 'p2l_distance', p_id: anchor(c.a), l_id: b.id, distance: value }]);
        } else {
          add(c, [{ id, type: 'p2p_distance', p1_id: anchor(c.a), p2_id: anchor(c.b), distance: value }]);
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
        add(c, [{ id, type: 'difference', param1: { o_id: pa, prop }, param2: { o_id: pb, prop }, difference: sign * evalLength(c.value) }]);
        break;
      }
      case 'radius':
      case 'diameter': {
        const r = radial(c.circle);
        const v = evalLength(c.value);
        if (c.type === 'radius') {
          add(c, [r.type === 'circle' ? { id, type: 'circle_radius', c_id: r.id, radius: v } : { id, type: 'arc_radius', a_id: r.id, radius: v }]);
        } else {
          add(c, [r.type === 'circle' ? { id, type: 'circle_diameter', c_id: r.id, diameter: v } : { id, type: 'arc_diameter', a_id: r.id, diameter: v }]);
        }
        break;
      }
      case 'angle':
        add(c, [{ id, type: 'l2l_angle_ll', l1_id: line(c.a).id, l2_id: line(c.b).id, angle: evalAngle(c.value) }]);
        break;
    }
  }
  return prims;
}

const baseId = (gcsId: string) => gcsId.split('#')[0]!;
const unique = (ids: string[]) => [...new Set(ids.map(baseId))].filter((id) => id !== SKETCH_ORIGIN);

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

  solve(sketch: SketchFeature): SolvedSketch {
    const w = this.w;
    w.clear_data();
    let prims: Prim[];
    try {
      prims = toPrimitives(sketch);
    } catch (e) {
      return { geometry: new Map(), status: 'failed', dof: 0, conflicting: [], redundant: [], message: (e as Error).message };
    }
    w.push_primitives_and_params(prims);
    let result = w.solve(Algorithm.DogLeg);
    if (result !== SolveStatus.Success && result !== SolveStatus.Converged) {
      result = w.solve(Algorithm.LevenbergMarquardt);
    }
    const ok = result === SolveStatus.Success || result === SolveStatus.Converged;
    if (ok) w.apply_solution();
    const conflicting = unique(w.get_gcs_conflicting_constraints());
    const redundant = unique(w.get_gcs_redundant_constraints());
    const dof = w.gcs.dof();
    let status: SketchStatus;
    if (conflicting.length > 0 || redundant.length > 0) status = 'over';
    else if (!ok) status = 'failed';
    else status = dof === 0 ? 'fully' : 'under';
    return {
      geometry: readGeometry(w, sketch),
      status,
      dof,
      conflicting,
      redundant,
      ...(ok ? {} : { message: '草圖無法求解' }),
    };
  }
}
