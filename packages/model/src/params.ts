import { t } from '@3db/i18n';
import type { Id } from './ids';
import { evalAngle, evalLength, evalQuantity, ExprError, parseExpr, referencesOf, rewriteRefs, type Env, type NameRef, type Quantity } from './expr';
import type { Expr, Feature, PartDoc, SketchConstraint, SketchFeature, Variable } from './schema';
import { isDimension } from './schema';

/**
 * Parameters (B5.1–B5.3): the values that drive a part are expressions. Variables and the driving
 * dimensions of sketches can be used in other expressions; file properties can be read with
 * `property('name')`. This file finds them, evaluates them in an order that does not matter (any use of a
 * name evaluates what it needs, and a cycle is reported with its path), and derives who depends on whom.
 * Nothing here is stored: the document holds the expressions only.
 */

export type ExprKind = 'length' | 'angle';

/** What a value must be for the feature to make sense: a size above zero, or an angle in the range its feature allows. */
export type ExprRole = 'positive' | 'nonZero' | 'revolveAngle' | 'chamferAngle' | 'planeAngle' | 'any';

/** Why a value is not acceptable for its role (in words), or null. `expr` is what the user wrote. */
export function roleProblem(v: number, role: ExprRole, expr: Expr): string | null {
  const angle = (min: number, max: number, label: string) => (v > min && v <= max + 1e-12 ? null : t('cmd.angleOutOfRange', { label, value: expr }));
  switch (role) {
    case 'positive':
      return v > 0 ? null : t('cmd.mustBePositive', { value: expr });
    case 'nonZero':
      return Math.abs(v) > 1e-9 ? null : t('cmd.mustNotBeZero', { value: expr });
    case 'revolveAngle':
      return angle(0, 2 * Math.PI, t('cmd.revolveAngleRange'));
    case 'chamferAngle':
      return angle(0, Math.PI / 2 - 1e-9, t('cmd.chamferAngleRange'));
    case 'planeAngle':
      return angle(-1e-12, 2 * Math.PI, t('cmd.planeAngleRange'));
    case 'any':
      return null;
  }
}

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
        const d = c as unknown as { type: string; depth?: Expr };
        if (d.depth === undefined) return c;
        const depth = fn(d.depth, 'length', 'positive');
        return depth === d.depth ? c : ({ ...c, depth } as C);
      };
      const dir1 = cond(feature.dir1);
      const dir2 = feature.dir2 ? cond(feature.dir2) : undefined;
      return dir1 === feature.dir1 && dir2 === feature.dir2 ? feature : { ...feature, dir1, ...(dir2 ? { dir2 } : {}) };
    }
    case 'revolve': {
      const angle = fn(feature.dir1.angle, 'angle', 'revolveAngle');
      return angle === feature.dir1.angle ? feature : { ...feature, dir1: { ...feature.dir1, angle } };
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
    case 'moveFace': {
      const distance = fn(feature.distance, 'length', 'nonZero');
      return distance === feature.distance ? feature : { ...feature, distance };
    }
    case 'importedBody': {
      if (feature.sewTolerance === undefined) return feature;
      const sewTolerance = fn(feature.sewTolerance, 'length', 'positive');
      return sewTolerance === feature.sewTolerance ? feature : { ...feature, sewTolerance };
    }
    case 'deleteFace':
      return feature;
  }
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
      const q = kind === 'length' ? { v: evalLength(expr, this), L: 1, A: 0 } : kind === 'angle' ? { v: evalAngle(expr, this), L: 0, A: 1 } : evalQuantity(expr, this);
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
    return kind === 'length' ? evalLength(expr, this) : evalAngle(expr, this);
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
