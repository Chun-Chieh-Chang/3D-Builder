import { normalizedViewAxes, rightOf, type ViewAxes, type ViewFeature, type ViewName, type ViewSide } from '@3db/model';
import type { DimensionDraft } from './autoDimension';
import { holeSignature, threadSignature } from './dimension';

/**
 * A drawing planned for any part (ADR 0256): which way the main view looks, which views go with it, whether one is better as a section, and the dimensions
 * spread over the views so that each is written once, in the view where it is seen best. Only what is planned lives here; what is measured (the lines of
 * each direction, the features each view sees) comes from the caller, so the same plan is made by the agent's tools and by the app.
 *
 * Nothing here decides for the user without saying why: every choice comes back with the numbers it was made on, for the agent to put to the user.
 */

/** The six directions a main view is chosen from (the isometric and the flat pattern are never a main view). */
export const MAIN_CANDIDATES: readonly ViewName[] = ['front', 'top', 'right', 'left', 'bottom', 'back'];

/** What the caller measured of the part seen from one direction. */
export interface DirectionStats {
  direction: ViewName;
  axes: ViewAxes;
  /** The size of the view's box at full size (mm). */
  width: number;
  height: number;
  /** The total length of the visible and of the hidden lines at full size (mm). */
  visible: number;
  hidden: number;
  /** What the view sees, as `viewFeatures` gives it. */
  features: readonly ViewFeature[];
}

export interface MainViewCandidate {
  direction: ViewName;
  /** 0 to 1, the higher the better: what the main view is ranked by. */
  score: number;
  /** The numbers the score was made of, for the agent to explain the choice. */
  metrics: {
    /** The share of the line length that is hidden (0 to 1). */
    hiddenRatio: number;
    /** Round elements (holes, bosses, arcs) seen in their true shape. */
    trueShapes: number;
    /** Planes seen edge-on: each is a step, a face or a shoulder the view shows the place of. */
    planes: number;
    /** The visible line length relative to the most any direction shows (0 to 1). */
    detail: number;
    /** The box is wider than it is high (the long side along the sheet, ISO 128-30). */
    landscape: boolean;
  };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** A feature the drawing can only show its true shape in some views of: a round element seen end-on, a slanted face, a fillet's arc. */
const shapeKey = (f: ViewFeature): string | null => (f.type === 'circle' ? `c:${f.ref.name}` : f.type === 'slant' ? `s:${f.ref.name}` : f.type === 'torus' ? `t:${f.ref.name}` : null);
const trueShapes = (s: DirectionStats) => new Set(s.features.map(shapeKey).filter((k): k is string => k !== null && k.startsWith('c:'))).size;
const planeCount = (s: DirectionStats) => new Set(s.features.flatMap((f) => (f.type === 'plane' ? [`${f.axis}${r3(f.coord)}`] : []))).size;
const hiddenRatio = (s: DirectionStats) => (s.visible + s.hidden > 0 ? s.hidden / (s.visible + s.hidden) : 0);

/**
 * The share of a part's surface area that coaxial surfaces of revolution (cylinders, cones, tori on the same axis line) must reach for the part to be treated
 * as a turned / revolved part when choosing its main view (ISO 128-30, ADR 0261 rule 2-8). Measured on the five reference parts: turned parts are 0.547 to
 * 0.653 (sds-plus-bit 0.547, diamond-pin 0.614, R1-8032 0.653) and prismatic parts with holes/fillets are 0.015 to 0.025 (v-block 0.015, locating-plate 0.025).
 */
export const REVOLVED_PART_SHARE = 0.5;

/**
 * The axis of revolution of a part when coaxial cylinders, cones and tori make up at least `REVOLVED_PART_SHARE` of its surface area (ISO 128-30, ADR 0261
 * rule 2-8), as a unit vector; null when the part is not a turned part or has no surface area.
 */
export function revolutionAxis(
  faces: readonly { area: number; geometry?: { type: string; axis?: readonly [number, number, number]; origin?: readonly [number, number, number]; apex?: readonly [number, number, number]; center?: readonly [number, number, number] } }[],
  minShare = REVOLVED_PART_SHARE,
): [number, number, number] | null {
  const total = faces.reduce((s, f) => s + (Number.isFinite(f.area) && f.area > 0 ? f.area : 0), 0);
  if (!(total > 0)) return null;
  const groups: { axis: [number, number, number]; origin: [number, number, number]; area: number }[] = [];
  for (const f of faces) {
    if (!(Number.isFinite(f.area) && f.area > 0)) continue;
    const g = f.geometry;
    if (!g || (g.type !== 'cylinder' && g.type !== 'cone' && g.type !== 'torus') || !g.axis) continue;
    const pt = g.origin ?? g.apex ?? g.center;
    if (!pt) continue;
    const len = Math.hypot(g.axis[0], g.axis[1], g.axis[2]);
    if (!(len > 1e-9)) continue;
    const ax: [number, number, number] = [g.axis[0] / len, g.axis[1] / len, g.axis[2] / len];
    let hit = groups.find((grp) => {
      const dot = grp.axis[0] * ax[0] + grp.axis[1] * ax[1] + grp.axis[2] * ax[2];
      if (Math.abs(dot) < 1 - 1e-4) return false;
      const dx = pt[0] - grp.origin[0];
      const dy = pt[1] - grp.origin[1];
      const dz = pt[2] - grp.origin[2];
      const cx = dy * grp.axis[2] - dz * grp.axis[1];
      const cy = dz * grp.axis[0] - dx * grp.axis[2];
      const cz = dx * grp.axis[1] - dy * grp.axis[0];
      return Math.hypot(cx, cy, cz) <= 1e-2;
    });
    if (!hit) {
      hit = { axis: ax, origin: [pt[0], pt[1], pt[2]], area: 0 };
      groups.push(hit);
    }
    hit.area += f.area;
  }
  groups.sort((a, b) => b.area - a.area);
  const best = groups[0];
  return best && best.area / total >= minShare ? best.axis : null;
}

/**
 * The directions ranked for the main view. ISO 128-30 and ISO 5456-2 ask for the view that shows the most of the part's shape (here: the visible detail, the
 * round elements seen true, the steps seen edge-on), with the fewest hidden lines, and its long side along the sheet. For a turned part (`axis` from
 * `revolutionAxis`, ADR 0261 rule 2-8), ISO 128-30 puts the side views (the axis across the view, not end-on) ahead of the end views. Opposite directions see
 * the same outline, so it is the hidden lines that tell them apart; on a tie the conventional order (front, top, right, …) decides, so that the ranking never
 * depends on the order the stats came in.
 */
export function rankMainViews(stats: readonly DirectionStats[], axis: readonly [number, number, number] | null = null): MainViewCandidate[] {
  const own = stats.filter((s) => MAIN_CANDIDATES.includes(s.direction) && s.visible > 0);
  if (own.length === 0) return [];
  const maxVisible = Math.max(...own.map((s) => s.visible));
  const maxShapes = Math.max(1, ...own.map(trueShapes));
  const maxPlanes = Math.max(1, ...own.map(planeCount));
  const axLen = axis ? Math.hypot(axis[0], axis[1], axis[2]) : 0;
  const sideOn = (s: DirectionStats): boolean => {
    if (!axis || !(axLen > 1e-9)) return false;
    const d = normalizedViewAxes(s.axes).dir;
    return Math.abs((d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]) / axLen) < 1e-3;
  };
  const anySideOn = axLen > 1e-9 && own.some(sideOn);
  const out = own.map((s): MainViewCandidate => {
    const detail = s.visible / maxVisible;
    const hr = hiddenRatio(s);
    const shapes = trueShapes(s);
    const planes = planeCount(s);
    const landscape = s.width >= s.height * 0.999;
    // the weights: what the view tells (0.75) against what it hides (0.2) and how it lies on the sheet (0.05); a long part standing up is the one bad
    // orientation worth a little, never more than what a view shows
    const score = 0.35 * detail + 0.25 * (shapes / maxShapes) + 0.15 * (planes / maxPlanes) + 0.2 * (1 - hr) + (landscape ? 0.05 : 0.05 * Math.min(1, s.width / Math.max(s.height, 1e-9)));
    return { direction: s.direction, score: r3(score), metrics: { hiddenRatio: r3(hr), trueShapes: shapes, planes, detail: r3(detail), landscape } };
  });
  const byDirection = new Map(own.map((s) => [s.direction, s]));
  return out.sort(
    (a, b) =>
      (anySideOn ? Number(sideOn(byDirection.get(b.direction)!)) - Number(sideOn(byDirection.get(a.direction)!)) : 0) ||
      b.score - a.score ||
      MAIN_CANDIDATES.indexOf(a.direction) - MAIN_CANDIDATES.indexOf(b.direction),
  );
}

/** A view that could be projected off the main view, measured. */
export interface SideCandidate {
  side: ViewSide;
  stats: DirectionStats;
}

export interface ViewChoice {
  side: ViewSide;
  direction: ViewName;
  /** Why it is on the sheet. */
  why: 'depth' | 'shapes';
  /** The true shapes it shows that no view before it shows. */
  adds: number;
}

/**
 * The views to project off the main one: one always, so that the third size of the part is on the sheet (`depth`), and another only when it shows a round
 * or slanted element in its true shape that no view before it shows (`shapes`). Of the two sides that see the part the same way (up and down, left and
 * right), the one with fewer hidden lines is taken; on a tie, the one that shows more, then up before down and right before left (the top and the right
 * views of the conventional three).
 */
export function chooseProjections(main: DirectionStats, sides: readonly SideCandidate[]): ViewChoice[] {
  const seen = new Set(main.features.map(shapeKey).filter((k): k is string => k !== null));
  const novel = (s: DirectionStats) => new Set(s.features.map(shapeKey).filter((k): k is string => k !== null && !seen.has(k))).size;
  const order: ViewSide[] = ['up', 'right', 'down', 'left'];
  const better = (a: SideCandidate, b: SideCandidate) => hiddenRatio(a.stats) - hiddenRatio(b.stats) || novel(b.stats) - novel(a.stats) || order.indexOf(a.side) - order.indexOf(b.side);
  const pick = (pair: readonly ViewSide[]) => sides.filter((s) => pair.includes(s.side) && s.stats.visible > 0).sort(better)[0];
  const pairs = [pick(['up', 'down']), pick(['left', 'right'])].filter((p): p is SideCandidate => !!p);
  if (pairs.length === 0) return [];
  // the first: the one that adds the most true shapes, then the one with fewer hidden lines
  pairs.sort((a, b) => novel(b.stats) - novel(a.stats) || better(a, b));
  const out: ViewChoice[] = [];
  const take = (c: SideCandidate, why: ViewChoice['why']) => {
    const adds = novel(c.stats);
    out.push({ side: c.side, direction: c.stats.direction, why, adds });
    for (const f of c.stats.features) {
      const k = shapeKey(f);
      if (k) seen.add(k);
    }
  };
  take(pairs[0]!, 'depth');
  const second = pairs[1];
  if (second && novel(second.stats) > 0) take(second, 'shapes');
  return out;
}

export interface SectionAdvice {
  /** Which way the cutting line runs on the main view. */
  orientation: 'vertical' | 'horizontal';
  /** Where it crosses the view (the view's x for a vertical line, its y for a horizontal one), full size. */
  at: number;
  /** The share of the main view's lines that are hidden, which is why a section is advised. */
  hiddenRatio: number;
  /** The hidden round elements the cut goes through. */
  through: number;
}

/** A main view whose lines are hidden more than this is advised a section (ISO 128-40: hidden lines that make a view hard to read are better cut). */
export const SECTION_HIDDEN_RATIO = 0.2;

/**
 * Whether the main view is better shown cut, and where. A section is for the holes and bores the main view sees side-on as hidden lines: the cutting line
 * runs along their axes (the way most of them run), through as many of them as one line can (ISO 128-40: a section through the axes of the features it is
 * for), so that the section shows each one's diameter, depth and bottom in true outline. With no such cylinder it runs along the view's long way through
 * the middle. `prefer` fixes the way instead.
 */
export function adviseSection(main: DirectionStats, prefer?: 'vertical' | 'horizontal'): SectionAdvice | null {
  const hr = hiddenRatio(main);
  if (hr < SECTION_HIDDEN_RATIO) return null;
  const axesSideOn = main.features.filter((f): f is Extract<ViewFeature, { type: 'axis' }> => f.type === 'axis');
  const runsVertical = (a: Extract<ViewFeature, { type: 'axis' }>) => Math.abs(a.to[1] - a.from[1]) > Math.abs(a.to[0] - a.from[0]);
  const best = (orientation: 'vertical' | 'horizontal'): SectionAdvice => {
    // a vertical line at x goes along every cylinder that runs vertically within its radius of x (and likewise a horizontal one)
    const k = orientation === 'vertical' ? 0 : 1;
    const along = axesSideOn.filter((a) => runsVertical(a) === (orientation === 'vertical'));
    const candidates = along.map((a) => (a.from[k] + a.to[k]) / 2);
    const box = boxOf(main);
    const middle = orientation === 'vertical' ? (box.x0 + box.x1) / 2 : (box.y0 + box.y1) / 2;
    const hits = (at: number) => along.filter((a) => Math.abs(at - (a.from[k] + a.to[k]) / 2) <= a.radius + 1e-9).length;
    let at = middle;
    let through = hits(middle);
    for (const c of candidates) {
      const h = hits(c);
      if (h > through || (h === through && Math.abs(c - middle) < Math.abs(at - middle))) {
        at = c;
        through = h;
      }
    }
    return { orientation, at: r3(at), hiddenRatio: r3(hr), through };
  };
  if (prefer) return best(prefer);
  const vertical = axesSideOn.filter(runsVertical).length;
  const horizontal = axesSideOn.length - vertical;
  if (vertical !== horizontal) return best(vertical > horizontal ? 'vertical' : 'horizontal');
  return best(main.width >= main.height ? 'horizontal' : 'vertical');
}

function boxOf(s: DirectionStats): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of s.features) {
    const pts: (readonly [number, number])[] = f.type === 'circle' ? [[f.centre[0] - f.radius, f.centre[1] - f.radius], [f.centre[0] + f.radius, f.centre[1] + f.radius]] : f.type === 'axis' ? [f.from, f.to] : f.type === 'torus' ? [f.at] : f.type === 'slant' ? [f.at] : [];
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (f.type === 'plane') {
      if (f.axis === 'x') {
        x0 = Math.min(x0, f.coord);
        x1 = Math.max(x1, f.coord);
      } else {
        y0 = Math.min(y0, f.coord);
        y1 = Math.max(y1, f.coord);
      }
    }
  }
  if (!(x0 <= x1)) {
    x0 = -s.width / 2;
    x1 = s.width / 2;
  }
  if (!(y0 <= y1)) {
    y0 = -s.height / 2;
    y1 = s.height / 2;
  }
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------------------------------------------- a fully determined drawing

/**
 * A drawing is complete when it determines the part (ADR 0256, the user's rule: 「fully determine 3D 模型所有的特徵尺寸」). Along each of the model's ways
 * every place where something is — a plane seen edge-on, the axis of a hole or a boss — has to be tied to one datum of that way by a chain of dimensions,
 * and every size that is not a place — the diameter of a hole, the radius of an arc or a fillet, a chamfer — has to be written. That is a graph per way:
 * the places are its nodes, the linear and ordinate dimensions its edges, and the way is determined when the graph is connected. The same graph tells the
 * planner which dimensions to add and the self-check which are missing, so that what the agent says is complete is what the dimensions make complete.
 */

export interface ViewToDimension {
  viewId: string;
  axes: ViewAxes;
  features: readonly ViewFeature[];
  /** A section: what is inside the part is drawn with solid lines there, so a hole's axis is best dimensioned on it. */
  section?: boolean;
  /** The features (by ref name) the view draws only with hidden lines: a dimension is not put on them where another view shows them (ISO 129-1 §5.1). */
  hidden?: ReadonlySet<string>;
}

/** One way something can be pointed at for a place: a plane edge-on, the centre of a circle seen true, or the axis of a cylinder seen side-on. */
interface Source {
  view: number;
  ref: ViewFeature['ref'];
  kind: 'plane' | 'centre' | 'axis';
  /** Which of the view's own ways the place is measured along. */
  along: 'x' | 'y';
  /** The place in the view's coordinates (full size). */
  coord: number;
  area: number;
  radius: number;
  /** Where it is across the way it is measured (a hole's other coordinate), which says which side of the view its dimension is nearer; absent for a plane. */
  cross?: number;
}

interface Node {
  key: string;
  way: string;
  /** The place along the model's way (the sign the model's, so that nodes of every view compare). */
  at: number;
  sources: Source[];
}

interface Mapper {
  way: (k: 'x' | 'y') => string;
  /** The place along the model's way of a view coordinate along the view's way k. */
  world: (k: 'x' | 'y', c: number) => number;
}

function mapperOf(axes: ViewAxes): Mapper {
  const a = normalizedViewAxes(axes);
  const vec = (k: 'x' | 'y') => (k === 'x' ? rightOf(a) : a.up);
  const main = (w: readonly number[]) => [0, 1, 2].reduce((m, j) => (Math.abs(w[j]!) > Math.abs(w[m]!) ? j : m), 0);
  return {
    way: (k) => {
      const w = vec(k);
      const i = main(w);
      // a slanted view's ways are the model's axes only when they are the same vector
      return Math.abs(Math.abs(w[i]!) - 1) < 1e-6 ? 'XYZ'[i]! : w.map((c) => r3(Math.abs(c))).join(',');
    },
    world: (k, c) => {
      const w = vec(k);
      return r3(c * Math.sign(w[main(w)]!));
    },
  };
}

/** The places a view sees, each with the way it lies along. */
function sourcesOf(v: ViewToDimension, index: number): Source[] {
  const out: Source[] = [];
  for (const f of v.features) {
    if (f.type === 'plane') out.push({ view: index, ref: f.ref, kind: 'plane', along: f.axis, coord: f.coord, area: f.area, radius: 0 });
    else if (f.type === 'circle' && f.full) {
      // a whole circle: a hole or a boss seen true, its centre a place both ways (an arc's centre follows from its radius and what it is tangent to)
      out.push({ view: index, ref: f.ref, kind: 'centre', along: 'x', coord: f.centre[0], area: 0, radius: f.radius, cross: f.centre[1] });
      out.push({ view: index, ref: f.ref, kind: 'centre', along: 'y', coord: f.centre[1], area: 0, radius: f.radius, cross: f.centre[0] });
    } else if (f.type === 'axis') {
      // a cylinder side-on: its axis is a place across the way it runs
      const runsX = Math.abs(f.to[0] - f.from[0]) >= Math.abs(f.to[1] - f.from[1]);
      out.push({ view: index, ref: f.ref, kind: 'axis', along: runsX ? 'y' : 'x', coord: runsX ? f.from[1] : f.from[0], area: 0, radius: f.radius, cross: runsX ? (f.from[0] + f.to[0]) / 2 : (f.from[1] + f.to[1]) / 2 });
    }
  }
  return out;
}

function graphOf(views: readonly ViewToDimension[]): { nodes: Map<string, Node>; mappers: Mapper[] } {
  const mappers = views.map((v) => mapperOf(v.axes));
  const nodes = new Map<string, Node>();
  views.forEach((v, i) => {
    for (const s of sourcesOf(v, i)) {
      const way = mappers[i]!.way(s.along);
      const at = mappers[i]!.world(s.along, s.coord);
      const key = `${way}:${at}`;
      const n = nodes.get(key);
      if (n) n.sources.push(s);
      else nodes.set(key, { key, way, at, sources: [s] });
    }
  });
  return { nodes, mappers };
}

/** The datum of a way: the plane at its low end with the most area (the face the part is measured from); the axis of the biggest round element when no plane bounds that end (a turned part). */
function datumOf(nodes: readonly Node[]): Node {
  const sorted = [...nodes].sort((a, b) => a.at - b.at);
  const low = sorted[0]!;
  const planeArea = (n: Node) => Math.max(0, ...n.sources.filter((s) => s.kind === 'plane').map((s) => s.area));
  if (planeArea(low) > 0) return low;
  const round = (n: Node) => Math.max(0, ...n.sources.filter((s) => s.kind !== 'plane').map((s) => s.radius));
  const best = [...nodes].sort((a, b) => round(b) - round(a) || a.at - b.at)[0]!;
  if (round(best) > 0) return best;
  return [...nodes].sort((a, b) => planeArea(b) - planeArea(a) || a.at - b.at)[0]!;
}

class Union {
  private parent = new Map<string, string>();
  find(k: string): string {
    let p = this.parent.get(k) ?? k;
    while (p !== (this.parent.get(p) ?? p)) p = this.parent.get(p)!;
    this.parent.set(k, p);
    return p;
  }
  join(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b));
  }
}

/** A dimension as the graph reads it: where it is drawn and what it points at. */
export type DimensionLike = { view: string } & DimensionDraft;

/** The places a linear or an ordinate dimension ties together, as node keys; the rounds a diameter, radius or chamfer gives the size of, by name. */
function readDimension(d: DimensionLike, views: readonly ViewToDimension[], mappers: readonly Mapper[]): { ties: string[]; sizes: string[] } {
  const i = views.findIndex((v) => v.viewId === d.view);
  if (i < 0) return { ties: [], sizes: [] };
  const v = views[i]!;
  const m = mappers[i]!;
  const place = (name: string, k: 'x' | 'y'): string | null => {
    for (const s of sourcesOf(v, i)) if (s.ref.name === name && s.along === k) return `${m.way(k)}:${m.world(k, s.coord)}`;
    return null;
  };
  if (d.kind === 'linear' && d.a.name === d.b.name && d.aSide !== undefined && d.bSide !== undefined && d.aSide !== d.bSide) {
    return { ties: [], sizes: [d.a.name] };
  }
  if (d.kind === 'linear' && d.orientation !== 'aligned') {
    const k = d.orientation === 'horizontal' ? 'x' : 'y';
    return { ties: [place(d.a.name, k), place(d.b.name, k)].filter((x): x is string => x !== null), sizes: [] };
  }
  if (d.kind === 'ordinate') return { ties: [place(d.origin.name, d.axis), ...d.refs.map((r) => place(r.name, d.axis))].filter((x): x is string => x !== null), sizes: [] };
  if (d.kind === 'diameter' || d.kind === 'radius' || d.kind === 'chamfer') return { ties: [], sizes: [d.ref.name] };
  if (d.kind === 'angle') return { ties: [], sizes: [d.a.name, d.b.name] };
  return { ties: [], sizes: [] };
}

/** What makes two round elements the same size callout: a counterbored Ø6 is not a plain Ø6, and a fillet is not a cylinder's arc. */
function roundKey(f: ViewFeature, callouts: boolean): string | null {
  if (f.type === 'circle') return `c|${f.full}|${f.convex}|${Math.round(f.radius * 1e4)}|${callouts && f.full ? `${holeSignature(f.hole)}|${threadSignature(f.thread)}` : ''}`;
  if (f.type === 'torus') return `t|${f.convex}|${Math.round(f.radius * 1e4)}`;
  return null;
}

/** The surface identity of a round element: faces cut from the same coaxial cylinder or fillet ring share one surface (ADR 0262, rules C1 and C2). */
const roundSurface = (f: Extract<ViewFeature, { type: 'circle' | 'torus' }>): string => f.surface ?? f.ref.name;

export interface CoverageReport {
  /** Every way of the model: how many places it has, how many are tied to its datum, and those that are not. */
  ways: { way: string; datum: number; places: number; determined: number; missing: { at: number; refs: string[] }[] }[];
  /** Round elements (holes, bosses, arcs, fillets): each must have its size written. */
  rounds: { total: number; determined: number; missing: { name: string; radius: number; kind: 'hole' | 'arc' | 'fillet' }[] };
  /** Slanted faces (chamfers, bevels): each needs a chamfer or an angle dimension. */
  slants: { total: number; determined: number; missing: string[] };
  complete: boolean;
}

/** How far a drawing's dimensions determine the part its views see (ADR 0256): the self-check the agent reports, and what the planner closes. */
export function dimensionCoverage(views: readonly ViewToDimension[], dimensions: readonly DimensionLike[], callouts = true): CoverageReport {
  const { nodes, mappers } = graphOf(views);
  const u = new Union();
  const sized = new Set<string>();
  for (const d of dimensions) {
    const r = readDimension(d, views, mappers);
    for (let k = 1; k < r.ties.length; k++) u.join(r.ties[0]!, r.ties[k]!);
    for (const s of r.sizes) sized.add(s);
  }
  const ways: CoverageReport['ways'] = [];
  const byWay = new Map<string, Node[]>();
  for (const n of nodes.values()) byWay.set(n.way, [...(byWay.get(n.way) ?? []), n]);
  for (const [way, list] of [...byWay].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const datum = datumOf(list);
    const missing = list.filter((n) => n !== datum && u.find(n.key) !== u.find(datum.key)).sort((a, b) => a.at - b.at);
    ways.push({ way, datum: datum.at, places: list.length, determined: list.length - missing.length, missing: missing.map((n) => ({ at: n.at, refs: [...new Set(n.sources.map((s) => s.ref.name))] })) });
  }
  // a size written for one of several equal rounds (「4×Ø6」) or for one face of a split coaxial surface (including a side-on Ø linear dimension) gives all of them
  const keysGiven = new Set<string>();
  const surfacesSized = new Set<string>();
  for (const v of views) {
    for (const x of v.features) {
      if ((x.type === 'circle' || x.type === 'torus') && sized.has(x.ref.name)) surfacesSized.add(roundSurface(x));
    }
  }
  for (const d of dimensions) {
    if (d.kind !== 'diameter' && d.kind !== 'radius') continue;
    const f = views.find((v) => v.viewId === d.view)?.features.find((x) => x.ref.name === d.ref.name);
    const key = f && roundKey(f, callouts);
    if (key && (d.count ?? 1) > 1) keysGiven.add(`${d.view}|${key}`);
  }
  const rounds = new Map<string, { name: string; radius: number; kind: 'hole' | 'arc' | 'fillet'; ok: boolean }>();
  for (const v of views)
    for (const f of v.features) {
      if (f.type !== 'circle' && f.type !== 'torus') continue;
      const key = roundKey(f, callouts)!;
      const ok = sized.has(f.ref.name) || surfacesSized.has(roundSurface(f)) || keysGiven.has(`${v.viewId}|${key}`);
      const had = rounds.get(f.ref.name);
      if (had) had.ok ||= ok;
      else rounds.set(f.ref.name, { name: f.ref.name, radius: r3(f.radius), kind: f.type === 'torus' ? 'fillet' : f.full ? 'hole' : 'arc', ok });
    }
  const slants = new Map<string, boolean>();
  for (const v of views) for (const f of v.features) if (f.type === 'slant') slants.set(f.ref.name, (slants.get(f.ref.name) ?? false) || sized.has(f.ref.name));
  const roundList = [...rounds.values()];
  const report: CoverageReport = {
    ways,
    rounds: { total: roundList.length, determined: roundList.filter((r) => r.ok).length, missing: roundList.filter((r) => !r.ok).map(({ ok: _ok, ...r }) => r) },
    slants: { total: slants.size, determined: [...slants.values()].filter(Boolean).length, missing: [...slants].filter(([, ok]) => !ok).map(([n]) => n) },
    complete: false,
  };
  report.complete = ways.every((w) => w.missing.length === 0) && report.rounds.missing.length === 0 && report.slants.missing.length === 0;
  return report;
}

export interface PlannedDimension {
  view: string;
  draft: DimensionDraft;
  /** What it determines, for the agent's list. */
  role: 'place' | 'size' | 'ordinate';
}

export interface PlanDimensionOptions {
  /** Hole callouts (through, depth, counterbore, thread) after a hole's diameter. Absent: true. */
  callouts?: boolean;
  /** More places than this along one way of one view are written as one ordinate dimension from the datum (AutoCAD's QDIM Ordinate). Absent: 6. */
  ordinateAbove?: number;
}

const FIRST = 10;
const STEP = 7;

/**
 * The dimensions that make a drawing complete (ADR 0256), on top of those it has: along each way of the model, every place not yet tied to the datum is
 * tied to it — from the datum when one view sees both, through a place already tied otherwise — in the view that shows that place best (a hole where it
 * is a circle, an inside place on a section, a step edge-on on the main view); and every round element whose size is not written gets it, once for equal
 * ones, in the first view that sees it true. Places from one datum are a baseline row (QDIM Baseline), or an ordinate row when they are many.
 */
export function planDrawingDimensions(views: readonly ViewToDimension[], existing: readonly DimensionLike[] = [], options: PlanDimensionOptions = {}): PlannedDimension[] {
  const callouts = options.callouts ?? true;
  const { nodes, mappers } = graphOf(views);
  const u = new Union();
  const sized = new Set<string>();
  for (const d of existing) {
    const r = readDimension(d, views, mappers);
    for (let k = 1; k < r.ties.length; k++) u.join(r.ties[0]!, r.ties[k]!);
    for (const s of r.sizes) sized.add(s);
    // 「4×Ø6」 gives the size of every equal round of its view, not only the one it points at
    if ((d.kind === 'diameter' || d.kind === 'radius') && (d.count ?? 1) > 1) {
      const v = views.find((x) => x.viewId === d.view);
      const f = v?.features.find((x) => x.ref.name === d.ref.name);
      const key = f && roundKey(f, callouts);
      if (v && key) for (const g of v.features) if (roundKey(g, callouts) === key) sized.add(g.ref.name);
    }
  }
  const placeDrafts: { view: number; along: 'x' | 'y'; datum: Source; to: Source; span: number }[] = [];
  /** How well a view shows a place: true shape first, then edge-on on an unsectioned view (so extension lines do not cross hatching, rule D1), then inside a section. */
  // a section helps only what is inside: a hole's axis is drawn solid there, while a plane edge-on is better dimensioned on a regular view so its extension lines do not cross hatching
  const merit = (s: Source) => (s.kind === 'centre' ? 3 : 0) + (s.kind === 'plane' ? (views[s.view]!.section ? 1.2 : 2) : 0) + (s.kind === 'axis' ? (views[s.view]!.section ? 2.5 : 0.5) : 0) + (s.view === 0 ? 0.5 : 0) - (views[s.view]!.hidden?.has(s.ref.name) ? 4 : 0);
  const byWay = new Map<string, Node[]>();
  for (const n of nodes.values()) byWay.set(n.way, [...(byWay.get(n.way) ?? []), n]);
  for (const list of byWay.values()) {
    const datum = datumOf(list);
    const tied = () => list.filter((n) => u.find(n.key) === u.find(datum.key));
    const pending = list.filter((n) => u.find(n.key) !== u.find(datum.key)).sort((a, b) => Math.abs(a.at - datum.at) - Math.abs(b.at - datum.at));
    for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
      for (let i = 0; i < pending.length; ) {
        const n = pending[i]!;
        // from the datum if a view sees both, else from the nearest place already tied
        const anchors = [datum, ...tied().filter((t) => t !== datum).sort((a, b) => Math.abs(a.at - n.at) - Math.abs(b.at - n.at))];
        let best = null as { to: Source; from: Source; score: number } | null;
        for (const anchor of anchors) {
          for (const to of n.sources)
            for (const from of anchor.sources) {
              if (from.view !== to.view || from.along !== to.along) continue;
              const score = merit(to) + (from.kind === 'plane' ? 1 : 0) + (from.area > 0 ? Math.min(1, from.area / 1e4) : 0) - (views[from.view]!.hidden?.has(from.ref.name) ? 4 : 0);
              if (!best || score > best.score) best = { to, from, score };
            }
          if (best) break;
        }
        if (!best) {
          i++;
          continue;
        }
        placeDrafts.push({ view: best.to.view, along: best.to.along, datum: best.from, to: best.to, span: Math.abs(best.to.coord - best.from.coord) });
        u.join(n.key, datum.key);
        pending.splice(i, 1);
      }
    }
  }

  const out: PlannedDimension[] = [];
  const sizedSurfaces = new Set<string>();
  for (const v of views) {
    for (const f of v.features) {
      if ((f.type === 'circle' || f.type === 'torus') && sized.has(f.ref.name)) sizedSurfaces.add(roundSurface(f));
    }
  }
  // sizes: one dimension for the equal rounds of a view that still lack theirs.
  // Pass 1: visible end-on circles & torus fillets.
  // Pass 2: hidden circles whose cylinder is visibly seen side-on (`axis`) in another view (e.g. a section) get a side-on Ø dimension there (rule C2 / D6).
  // Pass 3: any remaining rounds.
  const placeVisibleRoundSizes = (visibleOnly: boolean) => {
    views.forEach((v) => {
      const groups = new Map<string, ViewFeature[]>();
      const surfacesInView = new Set<string>();
      for (const f of v.features) {
        if (f.type !== 'circle' && f.type !== 'torus') continue;
        if (visibleOnly && v.hidden?.has(f.ref.name)) continue;
        const surf = roundSurface(f);
        if (sized.has(f.ref.name) || sizedSurfaces.has(surf) || surfacesInView.has(surf)) continue;
        surfacesInView.add(surf); // a fillet's tube is cut twice in a view, and a cylinder cut by slots has several faces: one surface, one count
        const key = roundKey(f, callouts)!;
        groups.set(key, [...(groups.get(key) ?? []), f]);
      }
      for (const g of groups.values()) {
        const first = g[0]!;
        const count = g.length > 1 ? { count: g.length } : {};
        let draft: DimensionDraft;
        if (first.type === 'circle' && first.full) draft = { kind: 'diameter', ref: first.ref, angle: first.outward, ...count, ...(callouts && (first.hole || first.thread) ? { callout: true } : {}) };
        else if (first.type === 'circle' || first.type === 'torus') draft = { kind: 'radius', ref: first.ref, angle: first.outward, ...count };
        else continue;
        out.push({ view: v.viewId, draft, role: 'size' });
        for (const f of g) {
          if (f.type === 'circle' || f.type === 'torus') {
            const surf = roundSurface(f);
            sizedSurfaces.add(surf);
            for (const vw of views) for (const x of vw.features) if ((x.type === 'circle' || x.type === 'torus') && roundSurface(x) === surf) sized.add(x.ref.name);
          }
          sized.add(f.ref.name);
        }
      }
    });
  };
  placeVisibleRoundSizes(true);
  // Pass 2: any unsized full circle that is hidden where seen end-on, but seen side-on as an axis in another view, gets a side-on Ø dimension there
  // (preferring unhidden axes in sections first, then sections, then unhidden axes in regular views).
  const sideViews = [...views].sort(
    (a, b) => Number(Boolean(b.section)) - Number(Boolean(a.section)) || views.indexOf(a) - views.indexOf(b),
  );
  for (const allowHiddenSide of [false, true]) {
    for (const vSide of sideViews) {
      let sideIdx = 0;
      for (const f of vSide.features) {
        if (f.type !== 'axis' || (!allowHiddenSide && vSide.hidden?.has(f.ref.name)) || sized.has(f.ref.name)) continue;
        // Only use side-on Ø when another view had it as a circle (so it counts in rounds)
        const circleFeat = views.flatMap((vw) => vw.features).find((x): x is Extract<ViewFeature, { type: 'circle' }> => x.type === 'circle' && x.ref.name === f.ref.name);
        if (!circleFeat) continue;
        const surf = roundSurface(circleFeat);
        if (sizedSurfaces.has(surf)) continue;
        const runsX = Math.abs(f.to[0] - f.from[0]) >= Math.abs(f.to[1] - f.from[1]);
        out.push({
          view: vSide.viewId,
          draft: { kind: 'linear', a: f.ref, b: f.ref, aSide: 1, bSide: -1, orientation: runsX ? 'vertical' : 'horizontal', offset: (runsX ? 1 : -1) * (FIRST + sideIdx * STEP), prefix: 'Ø' },
          role: 'size',
        });
        sideIdx++;
        sizedSurfaces.add(surf);
        for (const vw of views) for (const x of vw.features) if ((x.type === 'circle' || x.type === 'torus') && roundSurface(x) === surf) sized.add(x.ref.name);
        sized.add(f.ref.name);
      }
    }
  }
  placeVisibleRoundSizes(false);

  // slants: every slanted plane or conical chamfer not yet sized gets one chamfer (for cones) or angle (against a datum plane in the same view)
  for (const allowHiddenSlant of [false, true]) {
    for (const v of views) {
      const box = boxOf({ features: v.features, width: 0, height: 0 } as unknown as DirectionStats);
      const midX = (box.x0 + box.x1) / 2;
      const midY = (box.y0 + box.y1) / 2;
      const planes = v.features.filter((x): x is Extract<ViewFeature, { type: 'plane' }> => x.type === 'plane');
      for (const f of v.features) {
        if (f.type !== 'slant' || sized.has(f.ref.name)) continue;
        if (!allowHiddenSlant && v.hidden?.has(f.ref.name)) continue;
        if (f.cone) {
          const dx = f.at[0] - midX;
          const dy = f.at[1] - midY;
          const angle = Math.hypot(dx, dy) > 1e-6 ? Math.round((Math.atan2(dy, dx) * 180) / Math.PI) : 45;
          out.push({
            view: v.viewId,
            draft: { kind: 'chamfer', ref: f.ref, angle, size: f.cone.setback ?? f.cone.axial, coneSide: f.cone.side },
            role: 'size',
          });
          sized.add(f.ref.name);
        } else if (planes.length > 0) {
          const distToPlane = (p: Extract<ViewFeature, { type: 'plane' }>) =>
            Math.abs(p.coord - (p.axis === 'x' ? f.at[0] : f.at[1]));
          const anchor = [...planes].sort(
            (a, b) =>
              Number(Boolean(v.hidden?.has(a.ref.name))) - Number(Boolean(v.hidden?.has(b.ref.name))) ||
              distToPlane(a) - distToPlane(b) ||
              b.area - a.area,
          )[0]!;
          out.push({ view: v.viewId, draft: { kind: 'angle', a: f.ref, b: anchor.ref, arc: 6 }, role: 'size' });
          sized.add(f.ref.name);
        }
      }
    }
  }

  // places: by view and way, a baseline row from each datum, the shortest nearest; many from one datum become an ordinate row
  const ordinateAbove = options.ordinateAbove ?? 6;
  const rows = new Map<string, typeof placeDrafts>();
  for (const p of placeDrafts) {
    const key = `${p.view}|${p.along}`;
    rows.set(key, [...(rows.get(key) ?? []), p]);
  }
  for (const [key, all] of rows) {
    const [vi, along] = key.split('|') as [string, 'x' | 'y'];
    const view = views[Number(vi)]!.viewId;
    // each place is dimensioned from the side of the view it is nearer (ISO 129-1: short extension lines that do not cross the view): a hole in the upper
    // half has its horizontal place written above the view, one in the left half its vertical place to the left; a plane, from the usual side
    const box = boxOf({ features: views[Number(vi)]!.features, width: 0, height: 0 } as unknown as DirectionStats);
    const middle = along === 'x' ? (box.y0 + box.y1) / 2 : (box.x0 + box.x1) / 2;
    const usual = along === 'x' ? -1 : 1;
    const sideOf = (p: (typeof all)[number]) => (p.to.cross === undefined ? usual : p.to.cross > middle + 1e-6 ? 1 : p.to.cross < middle - 1e-6 ? -1 : usual);
    for (const sign of [usual, -usual]) {
    const row = all.filter((p) => sideOf(p) === sign);
    if (row.length === 0) continue;
    const fromSame = new Map<string, typeof row>();
    for (const p of row) fromSame.set(p.datum.ref.name, [...(fromSame.get(p.datum.ref.name) ?? []), p]);
    const linear: typeof row = [];
    let stacked = 0;
    for (const [, same] of fromSame) {
      if (same.length > ordinateAbove) {
        same.sort((a, b) => a.to.coord - b.to.coord);
        const uniqueRefs: ViewFeature['ref'][] = [];
        let lastCoord = -Infinity;
        for (const p of same) {
          if (Math.abs(p.to.coord - lastCoord) > 1e-4) {
            uniqueRefs.push(p.to.ref);
            lastCoord = p.to.coord;
          }
        }
        out.push({ view, draft: { kind: 'ordinate', axis: along, origin: same[0]!.datum.ref, refs: uniqueRefs, offset: sign * (FIRST + stacked * STEP) }, role: 'ordinate' });
        stacked++;
      } else linear.push(...same);
    }
    linear.sort((a, b) => a.span - b.span);
    for (const p of linear) {
      out.push({ view, draft: { kind: 'linear', a: p.datum.ref, b: p.to.ref, orientation: along === 'x' ? 'horizontal' : 'vertical', offset: sign * (FIRST + stacked * STEP) }, role: 'place' });
      stacked++;
    }
    }
  }
  return out;
}
