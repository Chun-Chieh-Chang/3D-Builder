import { t } from '@3db/i18n';
import type { Id } from './ids';
import { evalAngle, evalLength, evalQuantity, ExprError, parseExpr, referencesOf, rewriteRefs, type Env, type NameRef, type Quantity } from './expr';
import type { Draft, Expr, Feature, PartDoc, PatternDirection, SketchConstraint, SketchFeature, Thin, Variable } from './schema';
import { isDimension } from './schema';

/**
 * Parameters (B5.1–B5.3): the values that drive a part are expressions. Variables and the driving
 * dimensions of sketches can be used in other expressions; file properties can be read with
 * `property('name')`. This file finds them, evaluates them in an order that does not matter (any use of a
 * name evaluates what it needs, and a cycle is reported with its path), and derives who depends on whom.
 * Nothing here is stored: the document holds the expressions only.
 */

/** What a value is: a length, an angle, or a count (a whole number without a unit: how many instances). */
export type ExprKind = 'length' | 'angle' | 'count';

/** What a value must be for the feature to make sense: a size above zero, or an angle in the range its feature allows. */
export type ExprRole = 'positive' | 'unitInterval' | 'nonNegative' | 'nonZero' | 'revolveAngle' | 'chamferAngle' | 'draftAngle' | 'includedAngle' | 'planeAngle' | 'count' | 'any';

/** Why a value is not acceptable for its role (in words), or null. `expr` is what the user wrote. */
export function roleProblem(v: number, role: ExprRole, expr: Expr): string | null {
  const angle = (min: number, max: number, label: string) => (v > min && v <= max + 1e-12 ? null : t('cmd.angleOutOfRange', { label, value: expr }));
  switch (role) {
    case 'positive':
      return v > 0 ? null : t('cmd.mustBePositive', { value: expr });
    case 'unitInterval':
      return v >= 0 && v <= 1 ? null : t('cmd.mustBeUnit', { value: expr });
    case 'nonNegative':
      return v >= 0 ? null : t('cmd.mustNotBeNegative', { value: expr });
    case 'nonZero':
      return Math.abs(v) > 1e-9 ? null : t('cmd.mustNotBeZero', { value: expr });
    case 'revolveAngle':
      return angle(0, 2 * Math.PI, t('cmd.revolveAngleRange'));
    case 'chamferAngle':
      return angle(0, Math.PI / 2 - 1e-9, t('cmd.chamferAngleRange'));
    case 'draftAngle':
      return angle(0, Math.PI / 2 - 1e-9, t('cmd.draftAngleRange'));
    case 'includedAngle':
      return angle(0, Math.PI - 1e-9, t('cmd.includedAngleRange'));
    case 'planeAngle':
      return angle(-1e-12, 2 * Math.PI, t('cmd.planeAngleRange'));
    case 'count':
      return Number.isInteger(Math.round(v)) && Math.abs(v - Math.round(v)) < 1e-9 && v >= 2 && v <= MAX_INSTANCES ? null : t('cmd.countRange', { max: MAX_INSTANCES, value: expr });
    case 'any':
      return null;
  }
}

/** The most instances one direction of a pattern may have: a mistyped 1000 should say so rather than take minutes. */
export const MAX_INSTANCES = 200;

/** The kind of value a dimension holds. */
const dimensionKind = (c: SketchConstraint): ExprKind => (c.type === 'angle' ? 'angle' : 'length');

/**
 * What a dimension is called in an expression (SolidWorks 「D1@草圖1」): its label if the user gave it one,
 * else `D` and the number of its permanent id (`d3` → `D3`). Ids are never reused, so a name never
 * silently points at another dimension.
 */
export function dimensionName(c: SketchConstraint): string {
  if (!isDimension(c)) return c.id;
  if (c.label) return c.label;
  const m = /^d(\d+)$/i.exec(c.id);
  return m ? `D${m[1]}` : c.id;
}

/** Applies `fn` to every expression a feature holds, with the kind of value it stands for; a feature whose expressions are unchanged is returned as it was. */
export function mapExprs(feature: Feature, fn: (expr: Expr, kind: ExprKind, role: ExprRole) => Expr): Feature {
  switch (feature.type) {
    case 'sketch': {
      let changed = false;
      const constraints = feature.constraints.map((c) => {
        if (!isDimension(c)) return c;
        const value = fn(c.value, dimensionKind(c), c.type === 'angle' ? 'any' : 'positive');
        if (value === c.value) return c;
        changed = true;
        return { ...c, value };
      });
      return changed ? { ...feature, constraints } : feature;
    }
    case 'extrude': {
      const cond = <C extends { type: string }>(c: C): C => {
        const d = c as unknown as { type: string; depth?: Expr; offset?: Expr };
        let next = c;
        if (d.depth !== undefined) {
          const depth = fn(d.depth, 'length', 'positive');
          if (depth !== d.depth) next = { ...next, depth } as C;
        }
        if (d.offset !== undefined) {
          const offset = fn(d.offset, 'length', 'positive');
          if (offset !== d.offset) next = { ...next, offset } as C;
        }
        return next;
      };
      const dir1 = cond(feature.dir1);
      const dir2 = feature.dir2 ? cond(feature.dir2) : undefined;
      const draft = (d: Draft | undefined): Draft | undefined => {
        if (!d) return d;
        const angle = fn(d.angle, 'angle', 'draftAngle');
        return angle === d.angle ? d : { ...d, angle };
      };
      const draft1 = draft(feature.draft1);
      const draft2 = draft(feature.draft2);
      const thin = thinExprs(feature.thin, fn);
      if (dir1 === feature.dir1 && dir2 === feature.dir2 && draft1 === feature.draft1 && draft2 === feature.draft2 && thin === feature.thin) return feature;
      return { ...feature, dir1, ...(dir2 ? { dir2 } : {}), ...(draft1 ? { draft1 } : {}), ...(draft2 ? { draft2 } : {}), ...(thin ? { thin } : {}) };
    }
    case 'revolve': {
      const angle = fn(feature.dir1.angle, 'angle', 'revolveAngle');
      const thin = thinExprs(feature.thin, fn);
      if (angle === feature.dir1.angle && thin === feature.thin) return feature;
      return { ...feature, dir1: { ...feature.dir1, angle }, ...(thin ? { thin } : {}) };
    }
    case 'fillet': {
      const radius = fn(feature.radius, 'length', 'positive');
      return radius === feature.radius ? feature : { ...feature, radius };
    }
    case 'chamfer': {
      const distance = fn(feature.distance, 'length', 'positive');
      const angled = feature.mode === 'angleDistance';
      const second = fn(feature.second, angled ? 'angle' : 'length', angled ? 'chamferAngle' : 'positive');
      return distance === feature.distance && second === feature.second ? feature : { ...feature, distance, second };
    }
    case 'refPlane': {
      const d = feature.def;
      if (d.mode === 'offset') {
        const distance = fn(d.distance, 'length', 'positive');
        return distance === d.distance ? feature : { ...feature, def: { ...d, distance } };
      }
      if (d.mode === 'angle') {
        const angle = fn(d.angle, 'angle', 'planeAngle');
        return angle === d.angle ? feature : { ...feature, def: { ...d, angle } };
      }
      return feature;
    }
    case 'refPoint': {
      const d = feature.def;
      if (d.mode !== 'coords') return feature;
      const [x, y, z] = [fn(d.x, 'length', 'any'), fn(d.y, 'length', 'any'), fn(d.z, 'length', 'any')];
      return x === d.x && y === d.y && z === d.z ? feature : { ...feature, def: { ...d, x, y, z } };
    }
    case 'hole': {
      const f = feature;
      const one = (v: string | undefined, kind: ExprKind, role: ExprRole): string | undefined => (v === undefined ? v : fn(v, kind, role));
      const diameter = fn(f.diameter, 'length', 'positive');
      const end = f.end.type === 'blind' ? { ...f.end, depth: fn(f.end.depth, 'length', 'positive') } : f.end;
      const cbDiameter = one(f.cbDiameter, 'length', 'positive');
      const cbDepth = one(f.cbDepth, 'length', 'positive');
      const csDiameter = one(f.csDiameter, 'length', 'positive');
      const csAngle = one(f.csAngle, 'angle', 'includedAngle');
      const chamfer = one(f.chamfer, 'length', 'positive');
      const same = diameter === f.diameter && JSON.stringify(end) === JSON.stringify(f.end) && cbDiameter === f.cbDiameter && cbDepth === f.cbDepth && csDiameter === f.csDiameter && csAngle === f.csAngle && chamfer === f.chamfer;
      if (same) return feature;
      return { ...f, diameter, end, ...(cbDiameter === undefined ? {} : { cbDiameter }), ...(cbDepth === undefined ? {} : { cbDepth }), ...(csDiameter === undefined ? {} : { csDiameter }), ...(csAngle === undefined ? {} : { csAngle }), ...(chamfer === undefined ? {} : { chamfer }) };
    }
    case 'screwBoss': {
      const f = feature;
      const one = (v: string | undefined, kind: ExprKind, role: ExprRole): string | undefined => (v === undefined ? v : fn(v, kind, role));
      const diameter = fn(f.diameter, 'length', 'positive');
      const holeDiameter = fn(f.holeDiameter, 'length', 'positive');
      const height = fn(f.height, 'length', 'positive');
      const holeDepth = one(f.holeDepth, 'length', 'positive');
      const draft = one(f.draft, 'angle', 'draftAngle');
      const ribs = f.ribs && { count: fn(f.ribs.count, 'count', 'positive'), thickness: fn(f.ribs.thickness, 'length', 'positive'), length: fn(f.ribs.length, 'length', 'positive'), height: fn(f.ribs.height, 'length', 'positive'), ...(f.ribs.angle === undefined ? {} : { angle: fn(f.ribs.angle, 'angle', 'any') }) };
      const same = diameter === f.diameter && holeDiameter === f.holeDiameter && height === f.height && holeDepth === f.holeDepth && draft === f.draft && JSON.stringify(ribs) === JSON.stringify(f.ribs);
      if (same) return feature;
      return { ...f, diameter, holeDiameter, height, ...(holeDepth === undefined ? {} : { holeDepth }), ...(draft === undefined ? {} : { draft }), ...(ribs ? { ribs } : {}) };
    }
    case 'baseFlange': {
      const f = feature;
      const thickness = fn(f.thickness, 'length', 'positive');
      const radius = fn(f.radius, 'length', 'positive');
      const kFactor = fn(f.kFactor, 'count', 'unitInterval');
      const depth = f.depth === undefined ? undefined : fn(f.depth, 'length', 'positive');
      const same = thickness === f.thickness && radius === f.radius && kFactor === f.kFactor && depth === f.depth;
      if (same) return feature;
      return { ...f, thickness, radius, kFactor, ...(depth === undefined ? {} : { depth }) };
    }
    case 'edgeFlange': {
      const f = feature;
      const length = fn(f.length, 'length', 'positive');
      const angle = f.angle === undefined ? undefined : fn(f.angle, 'angle', 'includedAngle');
      const radius = f.radius === undefined ? undefined : fn(f.radius, 'length', 'positive');
      if (length === f.length && angle === f.angle && radius === f.radius) return feature;
      return { ...f, length, ...(angle === undefined ? {} : { angle }), ...(radius === undefined ? {} : { radius }) };
    }
    case 'hem': {
      const length = fn(feature.length, 'length', 'positive');
      const gap = fn(feature.gap, 'length', 'positive');
      return length === feature.length && gap === feature.gap ? feature : { ...feature, length, gap };
    }
    case 'snapHook': {
      const f = feature;
      const width = fn(f.width, 'length', 'positive');
      const thickness = fn(f.thickness, 'length', 'positive');
      const length = fn(f.length, 'length', 'positive');
      const hookHeight = fn(f.hookHeight, 'length', 'positive');
      const hookDepth = fn(f.hookDepth, 'length', 'positive');
      const angle = f.angle === undefined ? undefined : fn(f.angle, 'angle', 'any');
      const same = width === f.width && thickness === f.thickness && length === f.length && hookHeight === f.hookHeight && hookDepth === f.hookDepth && angle === f.angle;
      if (same) return feature;
      return { ...f, width, thickness, length, hookHeight, hookDepth, ...(angle === undefined ? {} : { angle }) };
    }
    case 'snapCatch': {
      const f = feature;
      const length = fn(f.length, 'length', 'positive');
      const width = fn(f.width, 'length', 'positive');
      const depth = fn(f.depth, 'length', 'positive');
      const angle = f.angle === undefined ? undefined : fn(f.angle, 'angle', 'any');
      const same = length === f.length && width === f.width && depth === f.depth && angle === f.angle;
      if (same) return feature;
      return { ...f, length, width, depth, ...(angle === undefined ? {} : { angle }) };
    }
    case 'vent': {
      const f = feature;
      const count = fn(f.count, 'count', 'positive');
      const pitch = fn(f.pitch, 'length', 'positive');
      const length = fn(f.length, 'length', 'positive');
      const width = fn(f.width, 'length', 'positive');
      const depth = fn(f.depth, 'length', 'positive');
      const angle = f.angle === undefined ? undefined : fn(f.angle, 'angle', 'any');
      const same = count === f.count && pitch === f.pitch && length === f.length && width === f.width && depth === f.depth && angle === f.angle;
      if (same) return feature;
      return { ...f, count, pitch, length, width, depth, ...(angle === undefined ? {} : { angle }) };
    }
    case 'pattern': {
      const d = feature.def;
      const direction = (x: PatternDirection): PatternDirection => {
        const spacing = fn(x.spacing, 'length', 'positive');
        const count = fn(x.count, 'count', 'count');
        return spacing === x.spacing && count === x.count ? x : { ...x, spacing, count };
      };
      if (d.mode === 'linear') {
        const dir1 = direction(d.dir1);
        const dir2 = d.dir2 ? direction(d.dir2) : undefined;
        return dir1 === d.dir1 && dir2 === d.dir2 ? feature : { ...feature, def: { ...d, dir1, ...(dir2 ? { dir2 } : {}) } };
      }
      const count = fn(d.count, 'count', 'count');
      const angle = fn(d.angle, 'angle', 'revolveAngle');
      return count === d.count && angle === d.angle ? feature : { ...feature, def: { ...d, count, angle } };
    }
    case 'rib': {
      const thickness = fn(feature.thickness, 'length', 'positive');
      return thickness === feature.thickness ? feature : { ...feature, thickness };
    }
    case 'draft': {
      const angle = fn(feature.angle, 'angle', 'draftAngle');
      return angle === feature.angle ? feature : { ...feature, angle };
    }
    case 'shell': {
      const thickness = fn(feature.thickness, 'length', 'positive');
      const each = feature.faceThickness?.map((x) => ({ ...x, thickness: fn(x.thickness, 'length', 'positive') }));
      const same = thickness === feature.thickness && (!each || each.every((x, i) => x.thickness === feature.faceThickness![i]!.thickness));
      return same ? feature : { ...feature, thickness, ...(each ? { faceThickness: each } : {}) };
    }
    case 'lipGroove': {
      const offset = fn(feature.offset, 'length', 'nonNegative');
      const width = fn(feature.width, 'length', 'positive');
      const height = fn(feature.height, 'length', 'positive');
      return offset === feature.offset && width === feature.width && height === feature.height ? feature : { ...feature, offset, width, height };
    }
    case 'thicken': {
      const thickness = fn(feature.thickness, 'length', 'nonZero');
      return thickness === feature.thickness ? feature : { ...feature, thickness };
    }
    case 'extendSurface': {
      const distance = fn(feature.distance, 'length', 'positive');
      return distance === feature.distance ? feature : { ...feature, distance };
    }
    case 'knit': {
      if (feature.tolerance === undefined) return feature;
      const tolerance = fn(feature.tolerance, 'length', 'positive');
      return tolerance === feature.tolerance ? feature : { ...feature, tolerance };
    }
    case 'moveFace':
    case 'offsetSurface': {
      const distance = fn(feature.distance, 'length', 'nonZero');
      return distance === feature.distance ? feature : { ...feature, distance };
    }
    case 'importedBody': {
      if (feature.sewTolerance === undefined) return feature;
      const sewTolerance = fn(feature.sewTolerance, 'length', 'positive');
      return sewTolerance === feature.sewTolerance ? feature : { ...feature, sewTolerance };
    }
    case 'deleteFace':
    case 'sweep':
    case 'loft':
    case 'combine':
    case 'refAxis':
    case 'coordSys':
    case 'mirror':
    case 'derivedBody':
    case 'splitLine':
    case 'fillSurface':
    case 'flatSurface':
    case 'trimSurface':
    case 'cutWithSurface':
      return feature;
  }
}

/** The thicknesses of a thin feature as expressions (a feature that is not thin has none). */
function thinExprs(thin: Thin | undefined, fn: (expr: Expr, kind: ExprKind, role: ExprRole) => Expr): Thin | undefined {
  if (!thin) return thin;
  const thickness = fn(thin.thickness, 'length', 'positive');
  const thickness2 = thin.thickness2 === undefined ? undefined : fn(thin.thickness2, 'length', 'positive');
  return thickness === thin.thickness && thickness2 === thin.thickness2 ? thin : { ...thin, thickness, ...(thickness2 === undefined ? {} : { thickness2 }) };
}

/** Every expression of a feature, in order. */
export function exprsOf(feature: Feature): { expr: Expr; kind: ExprKind }[] {
  const out: { expr: Expr; kind: ExprKind }[] = [];
  mapExprs(feature, (expr, kind) => {
    out.push({ expr, kind });
    return expr;
  });
  return out;
}

type Result = { ok: true; q: Quantity } | { ok: false; error: ExprError };

/** A number in the internal units, written so `evalLength` / `evalAngle` read back exactly the same value. */
const literal = (v: number, kind: ExprKind): Expr => (kind === 'angle' ? `${v}rad` : `${v}`);

/** A count: a number without a unit. */
function evalCount(expr: Expr, env: Env): number {
  const q = evalQuantity(expr, env);
  if (q.L !== 0 || q.A !== 0) throw new ExprError(expr, t('expr.countHasUnit'));
  return q.v;
}

/** Finds and evaluates the variables and sketch dimensions of a document, on demand and once each. */
export class Parameters implements Env {
  private readonly memo = new Map<string, Result>();
  private readonly stack: string[] = [];
  /** The sketch whose dimension is being evaluated (null for a variable), innermost last. */
  private readonly owners: (string | null)[] = [];
  private readonly variables = new Map<string, Variable>();
  private readonly duplicateVariables = new Set<string>();

  constructor(readonly doc: PartDoc) {
    for (const v of doc.variables) {
      if (this.variables.has(v.name)) this.duplicateVariables.add(v.name);
      else this.variables.set(v.name, v);
    }
  }

  // ------------------------------------------------------------ Env

  variable(name: string): Quantity | undefined {
    const v = this.variables.get(name);
    if (v) return this.value(`v:${v.id}`, name, v.expr, 'any', null);
    // inside a sketch dimension a bare name may be a dimension of the same sketch: D1*2
    const owner = this.owners[this.owners.length - 1];
    return owner ? this.dimension(name, owner) : undefined;
  }

  dimension(name: string, owner: string): Quantity | undefined {
    const found = this.findDimension(name, owner);
    if (!found) return undefined;
    const label = `${name}@${owner}`;
    if (!found.driving) throw new ExprError(label, t('expr.dimensionNotDriving', { name, owner }));
    return this.value(`d:${found.sketch.id}:${found.c.id}`, label, found.c.value, found.kind, owner);
  }

  property(name: string): string | undefined {
    return this.doc.properties[name];
  }

  // ------------------------------------------------------------ lookups

  private findDimension(name: string, owner: string) {
    const sketches = this.doc.features.filter((f): f is SketchFeature => f.type === 'sketch' && f.name === owner);
    if (sketches.length > 1) throw new ExprError(`${name}@${owner}`, t('expr.ambiguousOwner', { name, owner }));
    const sketch = sketches[0];
    const c = sketch?.constraints.find((x) => isDimension(x) && dimensionName(x) === name);
    if (!sketch || !c || !isDimension(c)) return undefined;
    return { sketch, c, kind: dimensionKind(c), driving: c.driving !== false };
  }

  /** One node of the graph: evaluated at most once; meeting a node that is being evaluated is a cycle. */
  private value(key: string, label: string, expr: Expr, kind: ExprKind | 'any', owner: string | null): Quantity {
    const done = this.memo.get(key);
    if (done) {
      if (done.ok) return done.q;
      throw done.error;
    }
    const at = this.stack.indexOf(key);
    if (at >= 0) {
      const names = [...this.stack.slice(at).map((k) => this.labelOf(k)), label];
      throw new ExprError(expr, t('expr.cycle', { path: names.join(' → ') }));
    }
    this.stack.push(key);
    this.owners.push(owner);
    this.labels.set(key, label);
    try {
      const q = kind === 'length' ? { v: evalLength(expr, this), L: 1, A: 0 } : kind === 'angle' ? { v: evalAngle(expr, this), L: 0, A: 1 } : kind === 'count' ? { v: evalCount(expr, this), L: 0, A: 0 } : evalQuantity(expr, this);
      this.memo.set(key, { ok: true, q });
      return q;
    } catch (e) {
      const error = e instanceof ExprError ? e : new ExprError(expr, String(e));
      this.memo.set(key, { ok: false, error });
      throw error;
    } finally {
      this.stack.pop();
      this.owners.pop();
    }
  }

  private readonly labels = new Map<string, string>();
  private labelOf(key: string): string {
    return this.labels.get(key) ?? key;
  }

  // ------------------------------------------------------------ what the rest of the program asks

  /** The value of an expression in this document, in the internal units; throws `ExprError`. */
  evaluate(expr: Expr, kind: ExprKind): number {
    return kind === 'length' ? evalLength(expr, this) : kind === 'angle' ? evalAngle(expr, this) : evalCount(expr, this);
  }

  /** The value of a variable, or the reason it has none. */
  variableValue(v: Variable): { value: Quantity } | { error: string } {
    if (this.duplicateVariables.has(v.name) && this.variables.get(v.name) !== v) return { error: t('expr.duplicateVariable', { name: v.name }) };
    try {
      return { value: this.value(`v:${v.id}`, v.name, v.expr, 'any', null) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** A driving dimension's value, or the reason it has none. */
  dimensionValue(sketch: SketchFeature, c: SketchConstraint): { value: number } | { error: string } {
    if (!isDimension(c)) return { error: '' };
    try {
      return { value: this.value(`d:${sketch.id}:${c.id}`, `${dimensionName(c)}@${sketch.name}`, c.value, dimensionKind(c), sketch.name).v };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * The feature with every expression replaced by the number it stands for (`resolve`), so the solver and
   * the kernel never see a name. An expression that cannot be evaluated is left as it is, and the first such
   * problem is returned: the feature reports it instead of building.
   */
  resolve<F extends Feature>(feature: F): { feature: F; problem: string | null } {
    let problem: string | null = null;
    const next = mapExprs(feature, (expr, kind, role) => {
      try {
        const v = this.evaluate(expr, kind);
        const bad = roleProblem(v, role, expr);
        if (bad) throw new ExprError(expr, bad);
        return PLAIN.test(expr) ? expr : literal(v, kind);
      } catch (e) {
        problem ??= e instanceof Error ? e.message : String(e);
        return expr;
      }
    });
    return { feature: next as F, problem };
  }
}

/** A bare number or a number with one unit: nothing to look up, and it stays as the user typed it. */
export const isPlain = (expr: Expr): boolean => PLAIN.test(expr);
const PLAIN = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*(?:mm|cm|m|in|deg|rad|"|°)?\s*$/i;


/** The whole document with its expressions resolved (see `Parameters.resolve`), and the problem of each feature that has one. */
export function resolveDoc(doc: PartDoc, params: Parameters = new Parameters(doc)): { doc: PartDoc; problems: Map<Id, string> } {
  const problems = new Map<Id, string>();
  let changed = false;
  const features = doc.features.map((f) => {
    const r = params.resolve(f);
    if (r.problem) problems.set(f.id, r.problem);
    if (r.feature !== f) changed = true;
    return r.feature;
  });
  return { doc: changed ? { ...doc, features } : doc, problems };
}

/** A sketch with its dimensions resolved, for solving it and drawing it (the sketch being edited). */
export function resolveSketch(sketch: SketchFeature, doc: PartDoc): SketchFeature {
  return new Parameters(doc).resolve(sketch).feature;
}

// ---------------------------------------------------------------- who depends on what

/** The features whose dimensions an expression uses, through variables too (`w = D1@草圖1`, `D2@草圖2 = w*2`). */
export function expressionParents(doc: PartDoc, feature: Feature): Id[] {
  const byName = new Map<string, Id[]>();
  for (const f of doc.features) if (f.type === 'sketch') byName.set(f.name, [...(byName.get(f.name) ?? []), f.id]);
  const variables = new Map(doc.variables.map((v) => [v.name, v]));
  const parents = new Set<Id>();
  const seen = new Set<string>();
  const visit = (expr: Expr) => {
    let refs: NameRef[];
    try {
      refs = referencesOf(parseExpr(expr));
    } catch {
      return;
    }
    for (const r of refs) {
      if (r.kind === 'dimension') for (const id of byName.get(r.owner) ?? []) parents.add(id);
      else if (!seen.has(r.name)) {
        seen.add(r.name);
        const v = variables.get(r.name);
        if (v) visit(v.expr);
      }
    }
  };
  for (const { expr } of exprsOf(feature)) visit(expr);
  parents.delete(feature.id);
  return [...parents];
}

/** What uses a variable: the expressions (of other variables and of features) that mention its name. */
export function variableUsers(doc: PartDoc, name: string): { variables: string[]; features: Id[] } {
  const uses = (expr: Expr) => {
    try {
      return referencesOf(parseExpr(expr)).some((r) => r.kind === 'variable' && r.name === name);
    } catch {
      return false;
    }
  };
  return {
    variables: doc.variables.filter((v) => v.name !== name && uses(v.expr)).map((v) => v.name),
    features: doc.features.filter((f) => exprsOf(f).some((e) => uses(e.expr))).map((f) => f.id),
  };
}

/** Rewrites every name in every expression of the document (variables' and features'); used when something is renamed. */
export function renameInDoc(doc: PartDoc, map: (ref: NameRef) => NameRef | null): PartDoc {
  const variables = doc.variables.map((v) => {
    const expr = rewriteRefs(v.expr, map);
    return expr === v.expr ? v : { ...v, expr };
  });
  const features = doc.features.map((f) => mapExprs(f, (expr) => rewriteRefs(expr, map)));
  return { ...doc, variables, features };
}
