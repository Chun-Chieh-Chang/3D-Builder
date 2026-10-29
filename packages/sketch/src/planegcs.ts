import { t } from '@3db/i18n';
import { Algorithm, make_gcs_wrapper, SolveStatus, type GcsWrapper, type SketchPrimitive } from '@salusoft89/planegcs';
import { relationCrossings } from './ops';
import {
  constraintRefs,
  entityPoints,
  evalAngle,
  evalLength,
  evalQuantity,
  isSketchAxis,
  modelRefOf,
  sketchAxisDir,
  SKETCH_ORIGIN,
  type Id,
  type SketchEntity,
  type SketchFeature,
} from '@3db/model';
import type { EntityFreedom, EntityStatus, SketchSolver, SketchStatus, SolvedGeometry, SolvedSketch, SolveOptions } from './types';

type Prim = SketchPrimitive;

class MappingError extends Error {}

/** End points of an open curve (none for points and circles). */
function endpoints(e: SketchEntity): Id[] {
  return e.type === 'line' ? [e.p1, e.p2] : e.type === 'arc' ? [e.start, e.end] : e.type==='spline'&&e.bezier?[e.points[0]!,e.points[e.points.length-1]!]:[];
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
 * What a relation may not do (ADR 0211): parallel, perpendicular, collinear, a midpoint and the like are met just as well by a line of no length, and the
 * solver, taking the shortest way, shrank a line to a point and called the sketch solved. A line that had a length and has none at the end was lost.
 */
const HAD_LENGTH = 1e-2;
const NO_LENGTH = 1e-4;
/** How far the first held line is turned off where it is, in radians (about a degree); the next more, to start the held solve away from a singular direction. */
const NUDGE = 0.02;

/** The length of each line at the start of a solve: where it is stored, or where `initial` puts it. */
function lineLengths(sketch: SketchFeature, start: Start): Map<Id, number> {
  const points = new Map(sketch.entities.flatMap((e): [Id, [number, number]][] => (e.type === 'point' ? [[e.id, start.points.get(e.id) ?? [e.x, e.y]]] : [])));
  const out = new Map<Id, number>();
  for (const e of sketch.entities) {
    if (e.type !== 'line') continue;
    const [a, b] = [points.get(e.p1), points.get(e.p2)];
    if (a && b) out.set(e.id, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
}

/** The lines that had a length at the start and have none now. */
function lostLines(geometry: Map<Id, SolvedGeometry>, before: Map<Id, number>): Id[] {
  const lost: Id[] = [];
  for (const [id, was] of before) {
    const g = geometry.get(id);
    if (g?.type === 'line' && was > HAD_LENGTH && Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < NO_LENGTH) lost.push(id);
  }
  return lost;
}

/** Where a solution put the points and the circles, as the start of the next solve. */
function startOf(geometry: Map<Id, SolvedGeometry>): Start {
  const out: Start = { points: new Map(), radii: new Map() };
  for (const [id, g] of geometry) {
    if (g.type === 'point') out.points.set(id, g.p);
    else if (g.type === 'circle') out.radii.set(id, g.r);
  }
  return out;
}

type CurveShape = Extract<SolvedGeometry, { type: 'line' | 'circle' | 'arc' }>;

/**
 * Where a 「交錯」 point starts: the crossing of the two curves that define it (C6.2). Seeded here, in the
 * mapping, so every solve does it. Without it the point starts where it was drawn, and in an under-defined
 * sketch the solver pulls the whole sketch onto that point instead of leaving the two curves where they are.
 */
function intersectionSeeds(sketch: SketchFeature, pointXY: (id: Id) => [number, number], radiusAt: (id: Id) => number): Map<Id, [number, number]> {
  const byId = new Map<Id, SketchEntity>(sketch.entities.map((e) => [e.id, e]));
  const curve = (id: Id): CurveShape | undefined => {
    const axis = sketchAxisDir(id);
    if (axis) return { type: 'line', a: [0, 0], b: axis, p1: SKETCH_ORIGIN, p2: `${id}.end`, construction: true };
    const e = byId.get(id);
    if (e?.type === 'line') return { type: 'line', a: pointXY(e.p1), b: pointXY(e.p2), p1: e.p1, p2: e.p2, construction: false };
    if (e?.type === 'circle') return { type: 'circle', c: pointXY(e.center), r: radiusAt(e.id), center: e.center, construction: false };
    if (e?.type !== 'arc') return undefined;
    const c = pointXY(e.center);
    const [sx, sy] = pointXY(e.start);
    const [ex, ey] = pointXY(e.end);
    const r = radiusAt(e.id);
    return { type: 'arc', c, r, a0: Math.atan2(sy - c[1], sx - c[0]), a1: Math.atan2(ey - c[1], ex - c[0]), center: e.center, start: e.start, end: e.end, construction: false };
  };
  const out = new Map<Id, [number, number]>();
  for (const c of sketch.constraints) {
    if (c.type !== 'intersection') continue;
    const [ga, gb] = [curve(c.a), curve(c.b)];
    if (!ga || !gb || byId.get(c.point)?.type !== 'point') continue;
    const meets = relationCrossings(ga, gb);
    if (meets.length === 0) continue;
    const here = pointXY(c.point);
    // two circles meet twice: the branch nearest where the point is keeps the seed on the side it was drawn
    out.set(c.point, meets.reduce((u, v) => (Math.hypot(v[0] - here[0], v[1] - here[1]) < Math.hypot(u[0] - here[0], u[1] - here[1]) ? v : u)));
  }
  return out;
}

/**
 * Maps the SSOT sketch onto PlaneGCS primitives. One model constraint may expand to several
 * (suffix "#k"). `pinned` points are fixed in place (used by the definition analysis).
 */
function toPrimitives(sketch: SketchFeature, start: Start, pinned: ReadonlySet<Id> = new Set()): Prim[] {
  const byId = new Map<Id, SketchEntity>(sketch.entities.map((e) => [e.id, e]));
  // the sketch's axes (ADR 0170), only when a relation refers to one: a sketch without them gives the solver exactly what it did before (B3.1)
  const axes = [...new Set(sketch.constraints.flatMap(constraintRefs).filter(isSketchAxis))];
  for (const axis of axes) byId.set(axis, { id: axis, type: 'line', p1: SKETCH_ORIGIN, p2: `${axis}.end`, construction: true });
  const kind = (id: Id) => (id === SKETCH_ORIGIN ? 'point' : byId.get(id)?.type);
  const point = (id: Id) => {
    if (kind(id) !== 'point') throw new MappingError(t('map.notPoint', { id }));
    return id;
  };
  const line = (id: Id) => {
    const e = byId.get(id);
    if (e?.type !== 'line') throw new MappingError(t('map.notLine', { id }));
    return e;
  };
  const stored = (id: Id): [number, number] => {
    if (id === SKETCH_ORIGIN) return [0, 0];
    const e = byId.get(id);
    if (e?.type !== 'point') throw new MappingError(t('map.notPoint', { id }));
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
    throw new MappingError(t('map.notCircleOrArc', { id }));
  };
  const radiusAt = (id: Id): number => {
    const e = byId.get(id);
    if (e?.type === 'circle') return start.radii.get(id) ?? e.radius;
    if (e?.type === 'arc') {
      const [cx, cy] = pointXY(e.center);
      const [sx, sy] = pointXY(e.start);
      return Math.hypot(sx - cx, sy - cy);
    }
    return 0;
  };
  const seeds = intersectionSeeds(sketch, pointXY, radiusAt);
  // Seed an axis dimension on the intended ellipse. Inside the focal segment the native
  // point-on-ellipse residual has zero derivative in the major-point direction; starting
  // there can prevent a valid size increase from converging. These are guesses, not edits.
  for(const c of sketch.constraints)if(c.type==='ellipseAxes'){
    const e=byId.get(c.entity);if(e?.type!=='ellipse')continue;
    const center=pointXY(e.center),major=pointXY(e.major),dx=major[0]-center[0],dy=major[1]-center[1],length=Math.hypot(dx,dy),r=evalLength(c.majorRadius);
    seeds.set(e.major,[center[0]+r*(length>1e-9?dx/length:1),center[1]+r*(length>1e-9?dy/length:0)]);
  }

  // Rigidly linked arc points already preserve the source arc's radial consistency. Adding the
  // fourth arc rule again would be redundant. Keep radius and both angle parameters connected.
  const links=new Map<Id,Extract<SketchFeature['constraints'][number],{type:'patternPoint'}>[]>();
  for(const c of sketch.constraints)if(c.type==='patternPoint')links.set(c.b,[...(links.get(c.b)??[]),c]);
  const linkedArcs=new Map<Id,Id>();
  for(const e of sketch.entities)if(e.type==='arc') {
    const all=[e.center,e.start,e.end].map(p=>links.get(p));
    if(all.some(a=>a?.length!==1))continue;
    const [c,s,t]=all.map(a=>a![0]!);
    if(![s!,t!].every(v=>v.dx===c!.dx&&v.dy===c!.dy&&v.angle===c!.angle&&v.center[0]===c!.center[0]&&v.center[1]===c!.center[1]))continue;
    const source=sketch.entities.find(a=>a.type==='arc'&&a.center===c!.a&&a.start===s!.a&&a.end===t!.a);
    if(source)linkedArcs.set(e.id,source.id);
  }
  for(const c of sketch.constraints)if(c.type==='symmetricEntity'||c.type==='symmetricEntityPoint'){
    if(byId.get(c.a)?.type==='arc'&&byId.get(c.b)?.type==='arc'&&!linkedArcs.has(c.b))linkedArcs.set(c.b,c.a);
  }
  for(const id of [...linkedArcs.keys()]) {const seen=new Set<Id>();let at=id;while(linkedArcs.has(at)&&!seen.has(at)){seen.add(at);at=linkedArcs.get(at)!;}if(seen.has(at))linkedArcs.delete(id);}
  const prims: Prim[] = [{ id: SKETCH_ORIGIN, type: 'point', x: 0, y: 0, fixed: true }];
  for (const axis of axes) {
    const [x, y] = sketchAxisDir(axis)!;
    prims.push({ id: `${axis}.end`, type: 'point', x, y, fixed: true }, { id: axis, type: 'line', p1_id: SKETCH_ORIGIN, p2_id: `${axis}.end` });
  }
  // Points first: PlaneGCS needs what a curve refers to defined before it, and an edit can make a line point at a later point.
  for (const e of sketch.entities) {
    if (e.type !== 'point') continue;
    const [x, y] = seeds.get(e.id) ?? pointXY(e.id);
    prims.push({ id: e.id, type: 'point', x, y, fixed: pinned.has(e.id) });
  }
  for (const e of sketch.entities) {
    switch (e.type) {
      case 'point':
        break;
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
        if(!linkedArcs.has(e.id))prims.push({ id: `${e.id}#rules`, type: 'arc_rules', a_id: e.id });
        break;
      }
      case 'ellipse': {
        const center=pointXY(e.center),major=pointXY(e.major),dx=major[0]-center[0],dy=major[1]-center[1],seedLength=Math.hypot(dx,dy),axes=sketch.constraints.find(c=>c.type==='ellipseAxes'&&c.entity===e.id),b=axes?.type==='ellipseAxes'?evalLength(axes.minorRadius):e.minorRadius,a=axes?.type==='ellipseAxes'?evalLength(axes.majorRadius):seedLength;
        // Old files may use the endpoint on the shorter axis. Preserve their representation until converted explicitly.
        if(a<=b+1e-6){if(sketch.constraints.some(c=>constraintRefs(c).includes(e.id)))throw new MappingError(t('sketch.ellipseAxesInvalid'));break;}
        const focus=`${e.id}:focus`,f=Math.sqrt(a*a-b*b);
        prims.push({id:focus,type:'point',x:center[0]+(seedLength>1e-9?dx/seedLength:1)*f,y:center[1]+(seedLength>1e-9?dy/seedLength:0)*f,fixed:false},{id:e.id,type:'ellipse',c_id:e.center,focus1_id:focus,radmin:b},
          {id:`${e.id}:axis`,type:'line',p1_id:e.center,p2_id:focus},
          {id:`${e.id}#majorOn`,type:'point_on_ellipse',p_id:e.major,e_id:e.id},
          {id:`${e.id}#majorAxis`,type:'point_on_line_pl',p_id:e.major,l_id:`${e.id}:axis`});
        if(!axes)prims.push({id:`${e.id}#minor`,type:'equal',param1:{o_id:e.id,prop:'radmin'},param2:b});break;
      }
      case 'spline':
        if(e.bezier)prims.push({id:e.id,type:'bspline',pole_ids:e.points,weights:e.points.map(()=>1),knots:[0,1],mult:[e.points.length,e.points.length],degree:e.points.length-1,periodic:false});
        break;
    }
  }

  for(const [copy,source] of linkedArcs) {
    const arc=byId.get(copy) as Extract<SketchEntity,{type:'arc'}>;
    prims.push({id:`${copy}#radius`,type:'equal_radius_aa',a1_id:source,a2_id:copy},
      {id:`${copy}#start`,type:'p2p_angle',p1_id:arc.center,p2_id:arc.start,angle:{o_id:copy,prop:'start_angle'}},
      {id:`${copy}#end`,type:'p2p_angle',p1_id:arc.center,p2_id:arc.end,angle:{o_id:copy,prop:'end_angle'}});
  }
  /** "The point lies on this line, circle or arc". */
  const onCurve = (p: Id, curveId: Id, id: Id): Prim => {
    const curve = byId.get(curveId);
    if (curve?.type === 'line') return { id, type: 'point_on_line_pl', p_id: p, l_id: curve.id };
    if (curve?.type === 'circle') return { id, type: 'point_on_circle', p_id: p, c_id: curve.id };
    if(curve?.type==='ellipse')return {id,type:'point_on_ellipse',p_id:p,e_id:curve.id};
    if (curve?.type === 'arc') return { id, type: 'point_on_arc', p_id: p, a_id: curve.id };
    throw new MappingError(t('map.notCurve', { id: curveId }));
  };
  const equalRadius = (a: Extract<SketchEntity, { type: 'circle' | 'arc' }>, b: Extract<SketchEntity, { type: 'circle' | 'arc' }>, id: Id): Prim => {
    if (a.type === 'circle' && b.type === 'circle') return { id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id };
    if (a.type === 'arc' && b.type === 'arc') return { id, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id };
    const [circle, arc] = a.type === 'circle' ? [a, b] : [b, a];
    return { id, type: 'equal_radius_ca', c1_id: circle.id, a2_id: arc.id };
  };

  const add = (id: Id, list: Prim[]) => list.forEach((p, k) => prims.push({ ...p, id: list.length === 1 ? id : `${id}#${k}` } as Prim));

  /**
   * A distance measured to the nearest or farthest points (ADR 0183): `a` and `b` are a circle or an arc and a point, a line, or another circle or arc.
   * The nearest the solver has its own relation for (circle to circle, point to circle, circle to line), with the radii as unknowns like everything else.
   * The farthest it has none: it is made of a helper point on the circle at the far side (on the line through the centers, or through the center and the
   * point, or on the perpendicular from the center to the line), and the distance of that point. Each helper point has exactly the freedoms its two
   * relations take away, so none is added; it starts where the circle is farthest now, and the solver keeps it near there.
   */
  const conditioned = (id: Id, aId: Id, bId: Id, condition: 'min' | 'max', value: number) => {
    const isRadial = (e: SketchEntity | undefined): e is Extract<SketchEntity, { type: 'circle' | 'arc' }> => e?.type === 'circle' || e?.type === 'arc';
    const [a, b] = [byId.get(aId), byId.get(bId)];
    const [r, otherId] = isRadial(a) ? [a, bId] : [b as Extract<SketchEntity, { type: 'circle' | 'arc' }>, aId];
    if (!isRadial(r)) throw new MappingError(t('map.notCircleOrArc', { id: aId }));
    const other = byId.get(otherId);
    if (condition === 'min') {
      if (isRadial(other)) add(id, [{ id, type: 'c2cdistance', c1_id: r.id, c2_id: other.id, dist: value }]);
      else if (other?.type === 'line') add(id, [{ id, type: 'c2ldistance', c_id: r.id, l_id: other.id, dist: value }]);
      else add(id, [{ id, type: 'p2cdistance', p_id: point(otherId), c_id: r.id, distance: value }]);
      return;
    }
    const centerOf = (e: Extract<SketchEntity, { type: 'circle' | 'arc' }>) => pointXY(e.center);
    /** The helper point on `e`'s circle, `from` the center in the direction `u`, with the two relations that keep it there. */
    const helper = (name: string, e: Extract<SketchEntity, { type: 'circle' | 'arc' }>, u: [number, number], along: Prim[]): Id => {
      const hid = `${id}.${name}`;
      const [cx, cy] = centerOf(e);
      const rad = radiusAt(e.id);
      prims.push({ id: hid, type: 'point', x: cx + u[0] * rad, y: cy + u[1] * rad, fixed: false });
      along.push(onCurve(hid, e.id, id));
      return hid;
    };
    const unitOf = (from: [number, number], to: [number, number]): [number, number] => {
      const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (d < 1e-9) throw new MappingError(t('map.conditionNoDirection', { id }));
      return [(to[0] - from[0]) / d, (to[1] - from[1]) / d];
    };
    const cons: Prim[] = [];
    if (isRadial(other)) {
      const [c1, c2] = [centerOf(r), centerOf(other)];
      const u = unitOf(c1, c2);
      const q1 = helper('q1', r, [-u[0], -u[1]], cons);
      const q2 = helper('q2', other, u, cons);
      cons.push({ id, type: 'point_on_line_ppp', p_id: q1, lp1_id: r.center, lp2_id: other.center }, { id, type: 'point_on_line_ppp', p_id: q2, lp1_id: r.center, lp2_id: other.center }, { id, type: 'p2p_distance', p1_id: q1, p2_id: q2, distance: value });
    } else if (other?.type === 'line') {
      const [p1, p2] = [pointXY(other.p1), pointXY(other.p2)];
      const dir = unitOf(p1, p2);
      const n: [number, number] = [-dir[1], dir[0]];
      const [cx, cy] = centerOf(r);
      // the far side of the circle is the side of the center away from the line (the center on the line: either)
      const side = (cx - p1[0]) * n[0] + (cy - p1[1]) * n[1] >= 0 ? 1 : -1;
      const q = helper('q', r, [n[0] * side, n[1] * side], cons);
      cons.push({ id, type: 'perpendicular_pppp', l1p1_id: r.center, l1p2_id: q, l2p1_id: other.p1, l2p2_id: other.p2 }, { id, type: 'p2l_distance', p_id: q, l_id: other.id, distance: value });
    } else {
      const p = point(otherId);
      const u = unitOf(pointXY(otherId), centerOf(r));
      const q = helper('q', r, u, cons);
      cons.push({ id, type: 'point_on_line_ppp', p_id: q, lp1_id: r.center, lp2_id: p }, { id, type: 'p2p_distance', p1_id: p, p2_id: q, distance: value });
    }
    add(id, cons);
  };

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
        // Parallel and one end on the other line. Lines that share an end are collinear by being parallel: asking an end to lie on the line as well would be redundant.
        const shares = a.p1 === b.p1 || a.p1 === b.p2 || a.p2 === b.p1 || a.p2 === b.p2;
        add(id, [{ id, type: 'parallel', l1_id: a.id, l2_id: b.id }, ...(shares ? [] : [{ id, type: 'point_on_line_pl' as const, p_id: a.p1, l_id: b.id }])]);
        break;
      }
      case 'tangentExternal':
      case 'tangentInternal': {
        const a=radial(c.a),b=radial(c.b);
        add(id,[{id,type:'tangent_circumf',p1_id:a.center,p2_id:b.center,rd1:{o_id:a.id,prop:'radius'},rd2:{o_id:b.id,prop:'radius'},internal:c.type==='tangentInternal'}]);break;
      }
      case 'endpointTangent': {
        const a=byId.get(c.a)!,b=byId.get(c.b)!,pa=endpoints(a)[c.aEnd==='start'?0:1]!,pb=endpoints(b)[c.bEnd==='start'?0:1]!;
        const connected=new Set([pa]);for(let changed=true;changed;){changed=false;for(const k of sketch.constraints)if(k.type==='coincident'&&(connected.has(k.a)||connected.has(k.b)))for(const p of [k.a,k.b])if(!connected.has(p)){connected.add(p);changed=true;}}
        const rows:Prim[]=[];
        if(!connected.has(pb))rows.push({id,type:'p2p_coincident',p1_id:pa,p2_id:pb});
        if(a.type==='spline'||b.type==='spline'){
          // A Bezier endpoint derivative is degree * (P1-P0), or degree * (Pn-Pn-1).
          const direction=(e:SketchEntity,end:'start'|'end',at:string):string=>{
            if(e.type==='line')return e.id;
            const l=`${id}:${e.id}:tangent`;
            if(e.type==='spline'){const pts=e.points;prims.push({id:l,type:'line',p1_id:end==='start'?pts[0]!:pts[pts.length-2]!,p2_id:end==='start'?pts[1]!:pts[pts.length-1]!});}
            else if(e.type==='arc'){prims.push({id:l,type:'line',p1_id:e.center,p2_id:at});}
            else throw new MappingError(t('sketch.bezierRequired'));return l;
          };
          const la=direction(a,c.aEnd,pa),lb=direction(b,c.bEnd,pb),arc=a.type==='arc'||b.type==='arc';
          rows.push(arc?{id,type:'perpendicular_ll',l1_id:la,l2_id:lb}:{id,type:'parallel',l1_id:la,l2_id:lb});
        }else rows.push({id,type:'angle_via_point',crv1_id:a.id,crv2_id:b.id,p_id:pa,angle:c.opposed?Math.PI:0});
        add(id,rows);break;
      }
      case 'ellipseAxes': {
        const e=byId.get(c.entity);if(e?.type!=='ellipse')throw new MappingError(t('sketch.ellipseAxesInvalid'));
        add(id,[{id,type:'p2p_distance',p1_id:e.center,p2_id:e.major,distance:evalLength(c.majorRadius)},{id,type:'equal',param1:{o_id:e.id,prop:'radmin'},param2:evalLength(c.minorRadius)}]);break;
      }
      case 'tangent': {
        const a = byId.get(c.a);
        const b = byId.get(c.b);
        if(a?.type==='ellipse'||b?.type==='ellipse'){const e=a?.type==='ellipse'?a:b,l=a?.type==='line'?a:b;if(e?.type!=='ellipse'||l?.type!=='line')throw new MappingError(t('sketch.ellipseTangentLine'));add(id,[{id,type:'tangent_le',l_id:l.id,e_id:e.id}]);break;}
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
      case 'coradial': {
        // the same center and the same radius: concentric plus equal
        const [ra, rb] = [radial(c.a), radial(c.b)];
        add(id, [{ id, type: 'p2p_coincident', p1_id: ra.center, p2_id: rb.center }, equalRadius(ra, rb, id)]);
        break;
      }
      case 'patternPoint': {
        const a=point(c.a),b=point(c.b),angle=evalAngle(c.angle),dx=evalLength(c.dx),dy=evalLength(c.dy);
        const param=(o_id:string,prop:'x'|'y')=>({o_id,prop});
        if(angle===0) {
          add(id,[{id,type:'difference',param1:param(a,'x'),param2:param(b,'x'),difference:dx},{id,type:'difference',param1:param(a,'y'),param2:param(b,'y'),difference:dy}]);break;
        }
        // Bounded half-angle equations avoid proportional-constraint reduction and zero-radius
        // singularities. U=(ay+by,bx-ax), V=(ax+bx,by-ay), each on a fixed line.
        const half=angle/2,ch=Math.cos(half),sh=Math.sin(half),co=Math.cos(angle),si=Math.sin(angle),[cx,cy]=c.center,[ax,ay]=pointXY(a);
        const bx=cx+co*(ax-cx)-si*(ay-cy)+dx,by=cy+si*(ax-cx)+co*(ay-cy)+dy;
        const u=`${id}:u`,v=`${id}:v`,u0=`${id}:u0`,u1=`${id}:u1`,v0=`${id}:v0`,v1=`${id}:v1`,lu=`${id}:lu`,lv=`${id}:lv`;
        prims.push({id:u0,type:'point',x:2*cy+dy,y:dx,fixed:true},{id:u1,type:'point',x:2*cy+dy+ch,y:dx-sh,fixed:true},
          {id:v0,type:'point',x:2*cx+dx,y:dy,fixed:true},{id:v1,type:'point',x:2*cx+dx+ch,y:dy+sh,fixed:true},
          {id:lu,type:'line',p1_id:u0,p2_id:u1},{id:lv,type:'line',p1_id:v0,p2_id:v1},
          {id:u,type:'point',x:ay+by,y:bx-ax,fixed:false},{id:v,type:'point',x:ax+bx,y:by-ay,fixed:false});
        add(id,[
          {id,type:'difference',param1:param(a,'y'),param2:param(u,'x'),difference:param(b,'y')},
          {id,type:'difference',param1:param(a,'x'),param2:param(b,'x'),difference:param(u,'y')},
          {id,type:'difference',param1:param(a,'x'),param2:param(v,'x'),difference:param(b,'x')},
          {id,type:'difference',param1:param(a,'y'),param2:param(b,'y'),difference:param(v,'y')},
          {id,type:'point_on_line_pl',p_id:u,l_id:lu},{id,type:'point_on_line_pl',p_id:v,l_id:lv},
        ]);break;
      }
      case 'lengthRatio': {
        const a=line(c.a),b=line(c.b),q=evalQuantity(c.ratio),ratio=q.v;
        if(q.L!==0||q.A!==0||!Number.isFinite(ratio)||ratio<0.001||ratio>1000)throw new MappingError(t('sketch.ratioInvalid'));
        const u=`${id}:ratio`,o=`${id}:o`,e=`${id}:e`,l=`${id}:ratioLine`,norm=Math.hypot(1,ratio);
        const length=(a:ReturnType<typeof line>)=>Math.hypot(...pointXY(a.p2).map((v,i)=>v-pointXY(a.p1)[i]!) as [number,number]);
        prims.push({id:u,type:'point',x:length(b),y:length(a),fixed:false},{id:o,type:'point',x:0,y:0,fixed:true},{id:e,type:'point',x:1/norm,y:ratio/norm,fixed:true},{id:l,type:'line',p1_id:o,p2_id:e});
        add(id,[{id,type:'p2p_distance',p1_id:a.p1,p2_id:a.p2,distance:{o_id:u,prop:'y'}},{id,type:'p2p_distance',p1_id:b.p1,p2_id:b.p2,distance:{o_id:u,prop:'x'}},{id,type:'point_on_line_pl',p_id:u,l_id:l}]);break;
      }
      case 'equalSpacing': {
        const ids=c.points.map(anchor),a=ids[0]!,b=ids[ids.length-1]!,rows:Prim[]=[];
        for(let i=1;i<ids.length-1;i++)for(const prop of ['x','y'] as const){
          const at=prop==='x'?0:1,t=i/(ids.length-1),u=`${id}:${i}:${prop}`,o=`${u}:o`,e=`${u}:e`,l=`${u}:line`,param=(o_id:string,prop:'x'|'y')=>({o_id,prop});
          prims.push({id:u,type:'point',x:pointXY(ids[i]!)[at]-pointXY(a)[at],y:pointXY(b)[at]-pointXY(a)[at],fixed:false},{id:o,type:'point',x:0,y:0,fixed:true},{id:e,type:'point',x:t,y:1,fixed:true},{id:l,type:'line',p1_id:o,p2_id:e});
          rows.push({id,type:'difference',param1:param(a,prop),param2:param(ids[i]!,prop),difference:param(u,'x')},{id,type:'difference',param1:param(a,prop),param2:param(b,prop),difference:param(u,'y')},{id,type:'point_on_line_pl',p_id:u,l_id:l});
        }
        add(id,rows);break;
      }
      case 'equalCurvature':
        add(id, [equalRadius(radial(c.a), radial(c.b), id)]);
        break;
      case 'symmetricEntity':
      case 'symmetricEntityPoint': {
        const a=byId.get(c.a)!,b=byId.get(c.b)!,rows:Prim[]=[];
        const mirror=(a:string,b:string):Prim=>c.type==='symmetricEntity'?{id,type:'p2p_symmetric_ppl',p1_id:a,p2_id:b,l_id:c.axis}:{id,type:'p2p_symmetric_ppp',p1_id:a,p2_id:b,p_id:c.point};
        if(a.type==='line'&&b.type==='line')rows.push(mirror(a.p1,c.reverse?b.p2:b.p1),mirror(a.p2,c.reverse?b.p1:b.p2));
        else if(a.type==='circle'&&b.type==='circle')rows.push(mirror(a.center,b.center),equalRadius(a,b,id));
        else if(a.type==='arc'&&b.type==='arc')rows.push(mirror(a.center,b.center),mirror(a.start,c.type==='symmetricEntity'?b.end:b.start),mirror(a.end,c.type==='symmetricEntity'?b.start:b.end));
        else throw new MappingError(t('sketch.symmetryKinds'));
        add(id,rows);break;
      }
      case 'symmetricPoint':
        add(id, [{ id, type: 'p2p_symmetric_ppp', p1_id: point(c.a), p2_id: point(c.b), p_id: point(c.point) }]);
        break;
      case 'equal': {
        const a = byId.get(c.a);
        const b = byId.get(c.b);
        if (a?.type === 'line' && b?.type === 'line') add(id, [{ id, type: 'equal_length', l1_id: a.id, l2_id: b.id }]);
        else if ((a?.type === 'circle' || a?.type === 'arc') && (b?.type === 'circle' || b?.type === 'arc')) add(id, [equalRadius(a, b, id)]);
        else throw new MappingError(t('rules.equalKinds'));
        break;
      }
      case 'intersection': {
        const p = point(c.point);
        add(id, [onCurve(p, c.a, id), onCurve(p, c.b, id)]);
        break;
      }
      case 'midpoint': {
        const host = byId.get(c.line);
        if (host?.type === 'arc') {
          // the middle of the sweep: on the arc's circle, where the arc runs (counterclockwise) the way of its chord, start to end: the direction from the
          // center to the point, turned a quarter counterclockwise, is the chord's. As far from both ends is not enough: that place has a twin across the
          // circle (the middle of the rest of it), and a fuzz of large changes to the arc took the point there 3 times in 200; the signed angle has none
          const p = point(c.point);
          add(id, [onCurve(p, c.line, id), { id, type: 'l2l_angle_pppp', l1p1_id: host.center, l1p2_id: p, l2p1_id: host.start, l2p2_id: host.end, angle: Math.PI / 2 }]);
          break;
        }
        const l = line(c.line);
        add(id, [{ id, type: 'p2p_symmetric_ppp', p1_id: l.p1, p2_id: l.p2, p_id: point(c.point) }]);
        break;
      }
      case 'pointOnCurve':
        add(id, [onCurve(point(c.point), c.curve, id)]);
        break;
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
      case 'block': {
        // every freedom of the entity, no more (a constraint too many would be called redundant): a line's two ends; a circle's center and radius; an arc's
        // center, its start, and the direction of its end from the center (the end is on the circle already, the arc's own rule)
        const e = byId.get(c.entity);
        const hold = (pid: Id): Prim[] => {
          const [x, y] = stored(pid);
          return [
            { id, type: 'coordinate_x', p_id: point(pid), x },
            { id, type: 'coordinate_y', p_id: point(pid), y },
          ];
        };
        if (e?.type === 'line') add(id, [...hold(e.p1), ...hold(e.p2)]);
        else if (e?.type === 'circle') add(id, [...hold(e.center), { id, type: 'circle_radius', c_id: e.id, radius: radiusAt(e.id) }]);
        else if (e?.type === 'arc') {
          const [cx, cy] = stored(e.center);
          const [ex, ey] = stored(e.end);
          add(id, [...hold(e.center), ...hold(e.start), { id, type: 'p2p_angle', p1_id: point(e.center), p2_id: point(e.end), angle: Math.atan2(ey - cy, ex - cx) }]);
        } else throw new MappingError(t('map.notCurve', { id: c.entity }));
        break;
      }
      case 'distance': {
        const value = evalLength(c.value);
        const a = byId.get(c.a);
        const b = c.b === undefined ? undefined : byId.get(c.b);
        if (c.condition !== undefined && c.b !== undefined) {
          conditioned(id, c.a, c.b, c.condition, value);
          break;
        }
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
      case 'arcLength': {
        const arc = radial(c.circle);
        if (arc.type !== 'arc') throw new MappingError(t('sketch.notArc', { id: c.circle }));
        add(id, [{ id, type: 'arc_length', a_id: arc.id, dist: evalLength(c.value) }]);
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

/**
 * The solver's numbers put on a fine binary grid (B3.1): planegcs orders its parameters by where they are in memory, so the same sketch comes out
 * differing in the last digits from one solve to the next — enough to change whether OCCT takes two faces for one, and so their names (B1 of
 * 2026-10-14); a rebuild also starts from a fresh solver (`PlaneGcsSolver.fresh`). On the grid what is equal is equal: lengths to 1e-10 mm (a thousandth of the kernel's tolerance), angles to 1e-12 rad; a decimal grid,
 * so what was typed (12.4) comes back as typed, and −0 is 0. A value near a grid line can still fall either side.
 */
const LENGTH_GRID = 1e10;
const ANGLE_GRID = 1e12;
const canon = (v: number, grid: number) => Math.round(v * grid) / grid + 0;

function readGeometry(w: GcsWrapper, sketch: SketchFeature): Map<Id, SolvedGeometry> {
  const out = new Map<Id, SolvedGeometry>();
  const pt = (id: Id): [number, number] => {
    const p = w.sketch_index.get_sketch_point(id);
    return [canon(p.x, LENGTH_GRID), canon(p.y, LENGTH_GRID)];
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
        out.set(e.id, { type: 'circle', c: pt(e.center), r: canon(c.radius, LENGTH_GRID), center: e.center, construction });
        break;
      }
      case 'arc': {
        const a = w.sketch_index.get_sketch_arc(e.id);
        out.set(e.id, { type: 'arc', c: pt(e.center), r: canon(a.radius, LENGTH_GRID), a0: canon(a.start_angle, ANGLE_GRID), a1: canon(a.end_angle, ANGLE_GRID), center: e.center, start: e.start, end: e.end, construction });
        break;
      }
      case 'ellipse': {
        const c = pt(e.center);
        const major = pt(e.major);
        const dx = major[0] - c[0];
        const dy = major[1] - c[1];
        const a = Math.hypot(dx, dy);
        const primitive=w.sketch_index.get_primitive(e.id);
        const b = canon(primitive?.type==='ellipse'?primitive.radmin:e.minorRadius, LENGTH_GRID);
        const angle = canon(Math.atan2(dy, dx), ANGLE_GRID);
        out.set(e.id, {
          type: 'ellipse',
          c,
          major,
          majorRadius: canon(a, LENGTH_GRID),
          minorRadius: b,
          angle,
          center: e.center,
          majorId: e.major,
          construction,
        });
        break;
      }
      case 'spline': {
        const pts = e.points.map((pid) => pt(pid));
        out.set(e.id, {
          type: 'spline',
          ...(e.bezier?{bezier:true}:{}),
          points: pts,
          closed: e.closed ?? false,
          pointIds: e.points,
          construction,
        });
        break;
      }
      case 'text': {
        const at = pt(e.at);
        out.set(e.id, {
          type: 'text',
          at,
          atId: e.at,
          text: e.text,
          size: canon(e.size, LENGTH_GRID),
          angle: canon(e.angle ?? 0, ANGLE_GRID),
          align: e.align ?? 'left',
          bold: e.bold ?? false,
          italic: e.italic ?? false,
          font: e.font,
          construction,
        });
        break;
      }
    }
  }
  return out;
}

/** Sketch solver backed by FreeCAD's PlaneGCS (LGPL) compiled to WASM. */
export class PlaneGcsSolver implements SketchSolver {
  private constructor(
    private w: GcsWrapper,
    private readonly wasmUrl?: string,
  ) {}

  static async create(wasmUrl?: string): Promise<PlaneGcsSolver> {
    return new PlaneGcsSolver(await make_gcs_wrapper(wasmUrl), wasmUrl);
  }

  /**
   * Starts again from a solver just loaded (B3.1). planegcs orders its parameters by where they are in its memory, so what it has solved before
   * moves the last digits of the next answer by up to its convergence threshold (1e-10) — more than the grid of `canon` can hide. A rebuild that
   * begins with this solves every sketch from the same memory, and so gets the same numbers for the same document every time. About 4 ms.
   */
  async fresh(): Promise<void> {
    const next = await make_gcs_wrapper(this.wasmUrl);
    const old = this.w;
    this.w = next;
    old.destroy_gcs_module();
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
    const begin = startValues(options.initial);
    let prims: Prim[];
    try {
      prims = toPrimitives(sketch, begin);
    } catch (e) {
      return { geometry: new Map(), status: 'failed', dof: 0, conflicting: [], redundant: [], message: (e as Error).message };
    }
    const pull = dragPrimitives(sketch, options.drag);
    let ok = this.run([...prims, ...pull]);
    // a line the relations shrank to a point is not a solution (ADR 0211): the solve is made again with each such line held at the length it had, which
    // makes the relations turn it or move it; then the sketch is solved once more as it is, from where that left it, for its own freedoms and conflicts
    const before = lineLengths(sketch, begin);
    let lost = ok ? lostLines(readGeometry(w, sketch), before) : [];
    let answer: Map<Id, SolvedGeometry> | null = null;
    if (lost.length > 0) {
      const lines = new Map(sketch.entities.flatMap((e): [Id, Extract<SketchEntity, { type: 'line' }>][] => (e.type === 'line' ? [[e.id, e]] : [])));
      // every line that has a length is held at it: held only the lost one, the relation is met by shrinking another instead. A line whose length the
      // sketch itself decides (a dimension) refuses the hold, and the hold is let go of for that one
      let holds = [...before].filter(([, length]) => length > HAD_LENGTH).map(([id]) => id);
      // a line that is horizontal and is to be made vertical, or two that are parallel and are to be made perpendicular, have, where they are, one direction
      // for the held length and for the relation: the solver takes the two for a conflict. Each held line is turned a little about its first end (its length
      // is the same) so that the start is not that point
      const nudged: Start = { points: new Map(begin.points), radii: new Map(begin.radii) };
      const stored = new Map(sketch.entities.flatMap((e): [Id, [number, number]][] => (e.type === 'point' ? [[e.id, begin.points.get(e.id) ?? [e.x, e.y]]] : [])));
      holds.forEach((id, i) => {
        const line = lines.get(id)!;
        const a = nudged.points.get(line.p1) ?? stored.get(line.p1)!;
        const b = nudged.points.get(line.p2) ?? stored.get(line.p2)!;
        // not by the same angle for every line: two that were parallel would still be
        const turn = NUDGE * (1 + (i % 7));
        const [c, s] = [Math.cos(turn), Math.sin(turn)];
        nudged.points.set(line.p2, [a[0] + (b[0] - a[0]) * c - (b[1] - a[1]) * s, a[1] + (b[0] - a[0]) * s + (b[1] - a[1]) * c]);
      });
      const start = toPrimitives(sketch, nudged);
      let placed: Map<Id, SolvedGeometry> | null = null;
      for (let round = 0, rounds = holds.length + 1; round < rounds && holds.length > 0 && !placed; round++) {
        const keep: Prim[] = holds.map((id) => ({ id: `@keep:${id}`, type: 'p2p_distance', p1_id: lines.get(id)!.p1, p2_id: lines.get(id)!.p2, distance: before.get(id)! }));
        const held = this.run([...start, ...pull, ...keep]);
        const refused = [...w.get_gcs_conflicting_constraints(), ...w.get_gcs_redundant_constraints()].filter((id) => id.startsWith('@keep:')).map((id) => id.slice('@keep:'.length));
        if (held && refused.length === 0) placed = readGeometry(w, sketch);
        else if (refused.length === 0) break; // not the holds: the solver did not get there
        else {
          // one at a time: the solver names every hold that is in the conflict, and letting go of all of them leaves nothing held. The line that was lost is
          // the last to be let go of
          const let_go = refused.find((id) => !lost.includes(id)) ?? refused[0]!;
          holds = holds.filter((id) => id !== let_go);
        }
      }
      if (placed && lostLines(placed, before).length === 0) {
        // the freedoms and conflicts are those of the sketch as it is, without the holds; the answer is the held one, which meets all of it: solved again
        // from there, a sketch that leaves the length free (two lines made one) slides along it
        this.run(toPrimitives(sketch, startOf(placed)));
        ok = true;
        answer = placed;
        lost = [];
      }
      if (lost.length > 0) {
        // refused: the sketch is shown where it was stored (as for any solve that does not get there), not as solved and not as nothing
        w.clear_data();
        w.push_primitives_and_params(prims);
        const names = lost.join(', ');
        return { geometry: readGeometry(w, sketch), status: 'failed', dof: 0, conflicting: [], redundant: [], message: t('regen.sketchCollapsed', { names }), collapsed: lost };
      }
    }
    const conflicting = unique(w.get_gcs_conflicting_constraints());
    const redundant = unique(w.get_gcs_redundant_constraints());
    const dof = w.gcs.dof();
    let status: SketchStatus;
    if (conflicting.length > 0 || redundant.length > 0) status = 'over';
    else if (!ok) status = 'failed';
    else status = dof === 0 ? 'fully' : 'under';
    const result: SolvedSketch = {
      geometry: answer ?? readGeometry(w, sketch),
      status,
      dof,
      conflicting,
      redundant,
      ...(ok ? {} : { message: t('regen.sketchUnsolved') }),
    };
    for(const g of result.geometry.values())if(g.type==='spline'&&g.bezier&&(!(Math.hypot(g.points[1]![0]-g.points[0]![0],g.points[1]![1]-g.points[0]![1])>1e-8)||!(Math.hypot(g.points[g.points.length-1]![0]-g.points[g.points.length-2]![0],g.points[g.points.length-1]![1]-g.points[g.points.length-2]![1])>1e-8))){result.status='failed';result.message=t('sketch.bezierInvalid');}
    if (options.analyze) Object.assign(result, this.analyze(sketch, result, ok));
    return result;
  }

  /**
   * Per-entity definition (C1.31). A point is fully defined when pinning it where it is does not
   * change the sketch's degrees of freedom: then no remaining freedom can move it. This is an exact
   * rank computation by the solver, one extra solve per point, not a heuristic. How many it takes away is how many directions the
   * point can still move in (EntityFreedom).
   */
  private analyze(sketch: SketchFeature, base: SolvedSketch, ok: boolean): { entityStatus: Map<Id, EntityStatus>; entityFreedom: Map<Id, EntityFreedom> } {
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
    const pointCount = sketch.entities.filter((e) => e.type === 'point').length;
    const circleCount = sketch.entities.filter((e) => e.type === 'circle').length;
    const allFree =
      ok &&
      base.conflicting.length === 0 &&
      base.redundant.length === 0 &&
      sketch.constraints.every((c) => 'driving' in c && c.driving === false) &&
      sketch.entities.every((e) => (e.type === 'point' || e.type === 'line' || e.type === 'circle') && !modelRefOf(e)) &&
      base.dof === 2 * pointCount + circleCount;
    /** Degrees of freedom the pin takes away; null when the pinned system did not converge. */
    const probe = (prims: Prim[]): number | null => (this.run(prims) ? base.dof - this.w.gcs.dof() : null);
    const points = new Map<Id, number | null>();
    const pointFreedom = (id: Id): number | null => {
      if (allFixed) return 0;
      if (allFree) return 2;
      if (!ok) return null;
      let v = points.get(id);
      if (v === undefined) {
        v = probe(toPrimitives(sketch, solved, new Set([id])));
        points.set(id, v);
      }
      return v;
    };
    const radiusFixed = (id: Id): boolean => {
      if (allFixed) return true;
      if (allFree) return false;
      if (!ok) return false;
      return probe([...toPrimitives(sketch, solved), { id: '@probe.r', type: 'circle_radius', c_id: id, radius: solved.radii.get(id) ?? 1 }]) === 0;
    };

    const status = new Map<Id, EntityStatus>();
    const freedom = new Map<Id, EntityFreedom>();
    for (const e of sketch.entities) {
      const pts = e.type === 'point' ? [e.id] : entityPoints(e);
      if (over.has(e.id) || pts.some((p) => over.has(p))) {
        status.set(e.id, 'over');
        continue;
      }
      const free = pts.map((id) => ({ id, dof: pointFreedom(id) })).filter((p) => p.dof !== 0);
      const radius = e.type === 'circle' && !radiusFixed(e.id);
      const fully = free.length === 0 && !radius;
      status.set(e.id, fully ? 'fully' : 'under');
      if (!fully) freedom.set(e.id, { points: free, radius });
    }
    return { entityStatus: status, entityFreedom: freedom };
  }
}
