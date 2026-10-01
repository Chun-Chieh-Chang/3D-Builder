import { t } from '@3db/i18n';
import { SKETCH_ORIGIN, type Id, type SketchFeature } from '@3db/model';
import { hitsOf, isCurve, mergeGroups, SAME, spanOf, type Geometry, type OpResult } from './ops';
import { Nodes, TOL } from './profiles';
import type { P2 } from './types';

/**
 * 「檢查草圖用於特徵」 and 「修復草圖」 (C1.35): what keeps the sketch from making a profile, found in the solved geometry and each with the
 * entities to show; and the fixes that need no decision: stray duplicates and zero-length lines are deleted, and the two ends of a gap
 * not wider than a tolerance are merged.
 */
export type SketchIssue =
  /** One curve ends at a point where no other begins. */
  | { kind: 'openEnd'; ids: Id[]; at: P2 }
  /** Two open ends within the tolerance of each other: `points` are the two end points. */
  | { kind: 'gap'; ids: Id[]; at: P2; size: number; points: [Id, Id] }
  /** Three or more curves meet in one point. */
  | { kind: 'branch'; ids: Id[]; at: P2 }
  | { kind: 'duplicate'; ids: [Id, Id] }
  | { kind: 'zeroLength'; ids: [Id] }
  /** Two curves cross, or one ends on the other, between their ends. */
  | { kind: 'crossing'; ids: [Id, Id]; at: P2 };

const near = (a: P2, b: P2, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

export function checkSketch(sketch: Pick<SketchFeature, 'entities' | 'constraints'>, geometry: Geometry, gapTolerance: number): SketchIssue[] {
  const issues: SketchIssue[] = [];
  const position = (id: Id): P2 => {
    if (id === SKETCH_ORIGIN) return [0, 0];
    const g = geometry.get(id);
    return g?.type === 'point' ? g.p : [0, 0];
  };

  const nodes = new Nodes();
  for (const c of sketch.constraints) if (c.type === 'coincident') nodes.union(c.a, c.b);
  const points = sketch.entities.filter((e) => e.type === 'point').map((e) => e.id);
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) if (near(position(points[i]!), position(points[j]!), TOL)) nodes.union(points[i]!, points[j]!);

  interface End {
    entity: Id;
    point: Id;
  }
  const incident = new Map<Id, End[]>();
  const curves: { id: Id; node: [Id, Id] | null }[] = [];
  for (const e of sketch.entities) {
    const g = geometry.get(e.id);
    if (!g || g.type === 'point' || g.construction) continue;
    if (e.type === 'line' && g.type === 'line') {
      if (near(g.a, g.b, TOL)) {
        issues.push({ kind: 'zeroLength', ids: [e.id] });
        continue;
      }
      curves.push({ id: e.id, node: [nodes.find(e.p1), nodes.find(e.p2)] });
      for (const p of [e.p1, e.p2]) incident.set(nodes.find(p), [...(incident.get(nodes.find(p)) ?? []), { entity: e.id, point: p }]);
    } else if (e.type === 'arc') {
      curves.push({ id: e.id, node: [nodes.find(e.start), nodes.find(e.end)] });
      for (const p of [e.start, e.end]) incident.set(nodes.find(p), [...(incident.get(nodes.find(p)) ?? []), { entity: e.id, point: p }]);
    } else curves.push({ id: e.id, node: null });
  }

  // open ends, gaps and branches
  const open: { node: Id; end: End; at: P2 }[] = [];
  for (const [node, list] of incident) {
    const at = position(list[0]!.point);
    if (list.length === 1) open.push({ node, end: list[0]!, at });
    else if (list.length > 2) issues.push({ kind: 'branch', ids: [...new Set(list.map((x) => x.entity))], at });
  }
  const paired = new Set<Id>();
  const byDistance = open.flatMap((a, i) => open.slice(i + 1).map((b) => ({ a, b, d: Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) }))).filter((x) => x.d <= gapTolerance).sort((x, y) => x.d - y.d);
  for (const { a, b, d } of byDistance) {
    if (paired.has(a.node) || paired.has(b.node)) continue;
    paired.add(a.node);
    paired.add(b.node);
    issues.push({ kind: 'gap', ids: [a.end.entity, b.end.entity], at: [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2], size: d, points: [a.end.point, b.end.point] });
  }
  for (const o of open) if (!paired.has(o.node)) issues.push({ kind: 'openEnd', ids: [o.end.entity], at: o.at });

  // the same curve twice
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const [a, b] = [curves[i]!, curves[j]!];
      const [ga, gb] = [geometry.get(a.id)!, geometry.get(b.id)!];
      if (ga.type !== gb.type) continue;
      let same = false;
      if (ga.type === 'circle' && gb.type === 'circle') same = near(ga.c, gb.c, TOL) && Math.abs(ga.r - gb.r) < TOL;
      else if (a.node && b.node) {
        const ends = a.node[0] === b.node[0] && a.node[1] === b.node[1] ? true : a.node[0] === b.node[1] && a.node[1] === b.node[0];
        same = ends && (ga.type === 'line' || (gb.type === 'arc' && ga.type === 'arc' && near(ga.c, gb.c, TOL) && Math.abs(ga.r - gb.r) < TOL));
      }
      if (same) issues.push({ kind: 'duplicate', ids: [a.id, b.id] });
    }
  }

  // crossings: between the ends of a curve, where it meets another that is not just touching at a shared end
  const seen = new Set<string>();
  for (const { id } of curves) {
    const g = geometry.get(id);
    if (!isCurve(g)) continue;
    const span = spanOf(g);
    for (const hit of hitsOf(geometry, id, g, false)) {
      const other = geometry.get(hit.other);
      if (!isCurve(other) || other.construction || (g.type !== 'circle' && (hit.u <= SAME || hit.u >= span - SAME))) continue;
      const key = [id, hit.other].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ kind: 'crossing', ids: [id, hit.other], at: hit.at });
    }
  }
  return issues;
}

export type Repair = { edit: NonNullable<Extract<OpResult, { edit: unknown }>['edit']>; fixed: number; skipped: number } | { error: string };

/** Deletes the second of each duplicate and each zero-length line, and merges the two ends of every gap; says how many it did and could not. */
export function repairSketch(sketch: Pick<SketchFeature, 'entities' | 'constraints'>, geometry: Geometry, gapTolerance: number): Repair {
  const issues = checkSketch(sketch, geometry, gapTolerance);
  const removing = new Set<Id>();
  for (const i of issues) {
    if (i.kind === 'zeroLength') removing.add(i.ids[0]);
    else if (i.kind === 'duplicate') removing.add(i.ids[1]);
  }
  const groups = issues.flatMap((i) => (i.kind === 'gap' ? [[i.points[0], i.points[1]]] : []));
  if (removing.size === 0 && groups.length === 0) return { error: t('sketch.repairNothing') };
  const m = mergeGroups(sketch, groups, removing);
  return { edit: { ...m.edit, remove: [...(m.edit.remove ?? []), ...removing] }, fixed: removing.size + m.merged, skipped: m.skipped.length };
}
