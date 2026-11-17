/**
 * A drawing of the open part, made and changed by an AI agent with the user (ADR 0256). The agent asks for a plan (which way the main view should look, and
 * why), puts the choice to the user, and makes the drawing in one call: the views, a section where the main view hides too much, the isometric, and every
 * dimension the part needs to be fully determined — checked by the same graph that planned them. The user then asks for tolerances, surface finishes,
 * geometric tolerances and notes in their own words, and the agent adds them; every change answers with the self-check and a picture of the sheet.
 *
 * Everything is a `DrawingCommand` of `@3db/model` on a `DrawingDoc`, the same the app edits: the file saved here opens in the app as any other drawing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, sep } from 'node:path';
import { t } from '@3db/i18n';
import {
  applyDrawingCommand,
  axesOf,
  createEmptyDrawing,
  dimensionRefs,
  drawingIdsInUse,
  IdAllocator,
  isDerived,
  page,
  sectionPlane,
  viewVectors,
  type Annotation,
  type Dimension,
  type DimensionTolerance,
  type DrawingCommand,
  type DrawingDoc,
  type DrawingView,
  type GeometricCharacteristic,
  type Id,
  type Scale,
  type SheetSize,
  type SurfaceFinish,
  type TitleField,
  type ViewAxes,
  type ViewFeature,
  type ViewName,
  type ViewSide,
} from '@3db/model';
import {
  adviseSection,
  arrangeDimensions,
  buildScene,
  chooseProjections,
  clutterOf,
  dimensionCoverage,
  encodeShade,
  fitViews,
  itemsBounds,
  overlappingDimensions,
  planDrawingDimensions,
  rankMainViews,
  rasterizeSheet,
  ratio,
  readTrueType,
  sheetItems,
  sheetMetrics,
  toDxf,
  toPdf,
  toSvg,
  type CoverageReport,
  type DimensionLike,
  type DirectionStats,
  type ElementsResult,
  type MainViewCandidate,
  type PlacedView,
  type Scene,
  type SceneItem,
  type DimensionOutcome,
  type TrueTypeFont,
  type ViewChoice,
  type ViewLines,
  type ViewToDimension,
  type SectionAdvice,
} from '@3db/drawing';
import { readAnyDocumentFile, writeDrawingFile } from '@3db/io';
import { elementFacts, holeFeatures, projectDrawingView, viewFeatures } from '@3db/regen';
import { isTrap } from '@3db/kernel';
import { AgentError, messageOf, type CadSession } from './session';
import { renderView } from './render';

const ORTHO: ViewName[] = ['front', 'back', 'top', 'bottom', 'left', 'right'];
const SIDES: ViewSide[] = ['up', 'down', 'left', 'right'];
const IDENTITY = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };

export interface DrawingPlan {
  main: MainViewCandidate[];
  /** For the best main view: the views to project off it, the section advised, and why. */
  recommended: { main: ViewName; views: ViewChoice[]; section: (SectionAdvice & { replaces: ViewSide | null }) | null };
  /** What the agent asks the user (in their words): usually only which main view, or 「照建議」. */
  question: string;
}

export interface CreateOptions {
  main?: ViewName;
  /** The sides to project views to; absent: as planned. */
  views?: ViewSide[];
  /** 'auto' (the default): a section when the main view hides too much; true: always one; false: none. */
  section?: boolean | 'auto';
  isometric?: boolean;
  sheet?: SheetSize | 'auto';
  orientation?: 'landscape' | 'portrait';
  scale?: Scale;
  projection?: 'first' | 'third';
  title?: Partial<Record<TitleField, string>>;
  ordinateAbove?: number;
  path?: string;
}

export interface DrawingReport {
  path: string | null;
  sheet: { size: SheetSize; orientation: string; scale: string; projection: string };
  views: { id: Id; name: string; kind: string; direction?: ViewName; parent?: Id; side?: string }[];
  dimensions: number;
  annotations: number;
  surfaceFinishes: number;
  checks: Checks;
}

export interface Checks {
  /** Dimensions whose text overlaps another dimension's text. */
  overlaps: number;
  /** Texts that are hard to read: over another text, or crossed by a line that is not their own (`clutterOf`). */
  clutter: { count: number; texts: string[]; crossings?: string[] };
  /** The smallest and largest text height drawn, and the texts outside TEXT_RANGE: must be empty. */
  text: { min: number | null; max: number | null; outOfRange: string[] };
  /** The font the PDF and the pictures write with, and what it cannot write (each would come out as 「?」): must be empty. */
  glyphs: { font: string | null; missing: string[] };
  /** Anything drawn outside the frame's area (mm past it). */
  outside: number;
  /** Dimensions the program could not draw, with why. */
  failed: { id: Id; error: string }[];
  coverage: CoverageReport;
}

/** A TrueType font for the pictures and the PDF: the drawing's own Chinese font on Windows, a common one elsewhere, `DRAWING_FONT` first. */
function findFont(): TrueTypeFont | undefined {
  const candidates = [
    process.env.DRAWING_FONT,
    'C:\\Windows\\Fonts\\msjh.ttc',
    'C:\\Windows\\Fonts\\msjh.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    try {
      if (existsSync(p)) return readTrueType(new Uint8Array(readFileSync(p)));
    } catch {
      /* not a TrueType font this can read: the next */
    }
  }
  return undefined;
}

let fontCache: TrueTypeFont | null | undefined;
const font = () => (fontCache === undefined ? (fontCache = findFont() ?? null) : fontCache) ?? undefined;

interface Built {
  lines: Map<Id, ViewLines | null>;
  features: Map<Id, ViewFeature[]>;
  elements: Map<Id, ElementsResult>;
  scene: Scene;
  placed: Map<Id, PlacedView>;
  outcomes: Map<Id, DimensionOutcome>;
}

export class DrawingSession {
  doc: DrawingDoc | null = null;
  path: string | null = null;
  private readonly undoStack: DrawingDoc[] = [];
  /** Lines and features of the part from a direction (and a cut), kept while the part is the same build. */
  private lineCache = new Map<string, ViewLines>();
  private featureCache = new Map<string, ViewFeature[]>();
  private cacheFor: unknown = null;

  constructor(private readonly part: CadSession) {}

  private source() {
    const s = this.part.drawingSource();
    if (!s) throw new AgentError('the part has no body to draw yet: build it (or open a part with a body) first');
    if (this.cacheFor !== s.built) {
      this.lineCache.clear();
      this.featureCache.clear();
      this.cacheFor = s.built;
    }
    return s;
  }

  private project(axes: ViewAxes, cut?: { origin: [number, number, number]; normal: [number, number, number] }): ViewLines {
    const s = this.source();
    const key = JSON.stringify([axes, cut ?? null]);
    const hit = this.lineCache.get(key);
    if (hit) return hit;
    const lines: ViewLines = projectDrawingView(s.kernel, [{ shape: s.body.shape, pose: IDENTITY, mirrored: false }], axes, cut);
    this.lineCache.set(key, lines);
    return lines;
  }

  private featuresFor(axes: ViewAxes): ViewFeature[] {
    const s = this.source();
    const key = JSON.stringify(axes);
    const hit = this.featureCache.get(key);
    if (hit) return hit;
    const f = viewFeatures(s.body.topology, s.body.names, axes, undefined, holeFeatures(s.doc), s.built.cosmeticThreads);
    this.featureCache.set(key, f);
    return f;
  }

  private stats(direction: ViewName, axes: ViewAxes = viewVectors(direction)): DirectionStats {
    const lines = this.project(axes);
    const length = (ls: number[][]) => ls.reduce((n, l) => { let s = 0; for (let i = 0; i + 3 < l.length; i += 2) s += Math.hypot(l[i + 2]! - l[i]!, l[i + 3]! - l[i + 1]!); return n + s; }, 0);
    const box = lines.box;
    return { direction, axes, width: box ? box.max[0] - box.min[0] : 0, height: box ? box.max[1] - box.min[1] : 0, visible: length(lines.visible), hidden: length(lines.hidden), features: this.featuresFor(axes) };
  }

  /** Which direction a view of `doc` looks from, of the six, or null for a slanted one. */
  private directionOf(axes: ViewAxes): ViewName | null {
    const same = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]!) < 1e-6);
    const unit = (v: readonly number[]) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
    return ORTHO.find((d) => same(unit(viewVectors(d).dir), unit(axes.dir))) ?? null;
  }

  /** The sides of a main view looking from `main`, with what each would see. */
  private sidesOf(main: ViewName, projection: 'first' | 'third') {
    const views: DrawingView[] = [{ id: 'm', name: '', source: 'probe', direction: main }, ...SIDES.map((side): DrawingView => ({ id: `p-${side}`, name: '', kind: 'projected', parent: 'm', side }))];
    return SIDES.map((side) => {
      const axes = axesOf(views, projection, views.find((v) => v.id === `p-${side}`)!)!;
      return { side, stats: this.stats(this.directionOf(axes) ?? main, axes) };
    });
  }

  /** The plan the agent puts to the user (ADR 0256): the main views ranked, with the numbers, and the views, the section and the sheet for the best. */
  plan(projection: 'first' | 'third' = 'third'): DrawingPlan {
    const ranked = rankMainViews(ORTHO.map((d) => this.stats(d)));
    if (ranked.length === 0) throw new AgentError('the part shows nothing from any direction');
    const main = ranked[0]!.direction;
    const rec = this.recommend(main, projection);
    return {
      main: ranked,
      recommended: rec,
      question: `主視圖建議 ${t(`drawing.view.${main}`)}（${main}）。要照建議出圖，還是換成 ${ranked.slice(1, 3).map((c) => `${t(`drawing.view.${c.direction}`)}（${c.direction}）`).join('、')}？`,
    };
  }

  private recommend(main: ViewName, projection: 'first' | 'third') {
    const mainStats = this.stats(main);
    const sides = this.sidesOf(main, projection);
    const views = chooseProjections(mainStats, sides);
    // the section runs along the hidden bores; it looks the way the projected view on that side looks, and takes its place (a vertical line looks sideways)
    const advice = adviseSection(mainStats);
    const replaces = advice ? views.find((v) => (advice.orientation === 'horizontal' ? v.side === 'up' || v.side === 'down' : v.side === 'left' || v.side === 'right'))?.side ?? null : null;
    return { main, views, section: advice ? { ...advice, replaces } : null };
  }

  /** Makes the drawing in one step (ADR 0256): views, section, isometric, the dimensions that determine the part, the sheet and the scale. */
  async create(o: CreateOptions = {}): Promise<{ report: DrawingReport; plan: ReturnType<DrawingSession['recommend']> }> {
    const s = this.source();
    if (!s.path) throw new AgentError('save the part first (part_save with a .3dbx path): the drawing refers to the part file');
    const projection = o.projection ?? 'third';
    const ranked = rankMainViews(ORTHO.map((d) => this.stats(d)));
    const main = o.main ?? ranked[0]?.direction;
    if (!main || !ORTHO.includes(main)) throw new AgentError(`main must be one of ${ORTHO.join(', ')}`);
    if (o.views) for (const v of o.views) if (!SIDES.includes(v)) throw new AgentError(`views are sides of the main view: ${SIDES.join(', ')}, not ${JSON.stringify(v)}`);
    const rec = this.recommend(main, projection);
    const target = o.path ?? s.path.replace(/\.3dbx$/i, '.3dbd');
    if (!target.toLowerCase().endsWith('.3dbd')) throw new AgentError(`a drawing file name ends in .3dbd, not ${target}`);
    const full = await this.part.inside(target);
    const sourceRel = relative(dirname(full), s.path).split(sep).join('/');

    let doc = createEmptyDrawing();
    doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { projection, orientation: o.orientation ?? 'landscape' } });
    const ids = () => new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const mainId = ids().take('view');
    doc = applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: mainId, name: t(`drawing.view.${main}`), source: sourceRel, direction: main }] });
    const sides = o.views ?? rec.views.map((v) => v.side);
    const sideIds = new Map<ViewSide, Id>();
    for (const side of sides) {
      const id = ids().take('view');
      sideIds.set(side, id);
      // named by where it looks from (「右視」), as a drafter names it, not 「投影視圖」
      const probe: DrawingView = { id, name: '', kind: 'projected', parent: mainId, side };
      const axes = axesOf([...page(doc).views, probe], projection, probe);
      const dir = axes ? this.directionOf(axes) : null;
      doc = applyDrawingCommand(doc, { type: 'insertViews', views: [{ ...probe, name: dir ? t(`drawing.view.${dir}`) : t('drawing.view.projected') }] });
    }

    // the section: where the plan advises it (or where asked), in place of the projected view that would show the same side
    const wantSection = o.section === true || ((o.section ?? 'auto') === 'auto' && rec.section !== null);
    if (wantSection) {
      const mainStats = this.stats(main);
      const advice = rec.section ?? adviseSection({ ...mainStats, hidden: Math.max(mainStats.hidden, mainStats.visible) }, mainStats.width >= mainStats.height ? 'horizontal' : 'vertical')!;
      const box = this.project(viewVectors(main)).box!;
      const pad = 2;
      const line: [[number, number], [number, number]] =
        advice.orientation === 'horizontal' ? [[box.min[0] - pad, advice.at], [box.max[0] + pad, advice.at]] : [[advice.at, box.min[1] - pad], [advice.at, box.max[1] + pad]];
      const replaced = rec.section?.replaces && sideIds.get(rec.section.replaces);
      const id = ids().take('view');
      const section: DrawingView = { id, name: t('drawing.view.section', { label: 'A' }), kind: 'section', parent: mainId, line, label: 'A' };
      // look the way the replaced view looked (its side of the main view), turning the arrows if the line's own way looks the other
      let chosen = section;
      if (replaced) {
        const all = page(doc).views;
        const want = axesOf(all, projection, all.find((v) => v.id === replaced)!)!.dir;
        const got = axesOf([...all, section], projection, section)!.dir;
        if (want.some((x, i) => Math.abs(x - got[i]!) > 1e-6)) chosen = { ...section, flip: true };
        doc = applyDrawingCommand(doc, { type: 'deleteViews', viewIds: [replaced] });
      }
      doc = applyDrawingCommand(doc, { type: 'insertViews', views: [chosen] });
    }

    // title
    const title: Partial<Record<TitleField, string>> = { drawingName: basename(s.path, extname(s.path)), date: new Date().toISOString().slice(0, 10), ...o.title };
    for (const [field, value] of Object.entries(title)) if (value) doc = applyDrawingCommand(doc, { type: 'setTitle', field: field as TitleField, value });

    // the dimensions that determine the part, main view first, then the section, then the others
    doc = this.dimensionAll(doc, o.ordinateAbove);

    // the sheet and the scale: the smallest sheet that takes the views at full size or larger, else an A3 at the scale that fits
    // the sheet: the smallest that takes the views at full size; when what is drawn on it cannot be laid out clean there (texts crowded, a caption with
    // nowhere to go), the next size up — a drawing that is legible on a larger sheet is better than a crowded one on a small sheet
    const layOut = (sheet: CreateOptions['sheet']) => {
      let d = this.fitSheet(doc, { ...o, sheet });
      if (o.isometric ?? true) d = this.placeIsometric(d, mainId);
      return this.tidy(d);
    };
    let best = layOut(o.sheet);
    if (!o.sheet || o.sheet === 'auto') {
      let score = this.clutter(best);
      const order: SheetSize[] = ['A4', 'A3', 'A2', 'A1'];
      for (let i = order.indexOf(page(best).sheet.size) + 1; score > 0 && i > 0 && i < order.length; i++) {
        const next = layOut(order[i]);
        const c = this.clutter(next);
        if (c < score) {
          best = next;
          score = c;
        }
      }
    }
    doc = best;

    this.undoStack.length = 0;
    this.doc = doc;
    this.path = full;
    await this.save();
    return { report: this.report(), plan: rec };
  }

  /** The views of `doc` as the dimension graph reads them: the main view first, the sections next (inside is drawn solid there), then the rest. */
  private dimensionViews(doc: DrawingDoc): ViewToDimension[] {
    const pg = page(doc);
    const out: ViewToDimension[] = [];
    for (const v of pg.views) {
      if (v.kind === 'detail' || v.kind === 'crop' || v.kind === 'sectionLocal') continue;
      if (v.kind === 'projected' && (v.side === 'upLeft' || v.side === 'upRight' || v.side === 'downLeft' || v.side === 'downRight')) continue;
      if (!isDerived(v) && v.direction === 'isometric') continue;
      const axes = axesOf(pg.views, pg.sheet.projection, v);
      if (!axes || !this.directionOf(axes)) continue;
      const features = this.featuresFor(axes);
      const lines = v.kind === 'section' ? this.project(axes, sectionPlane(axesOf(pg.views, pg.sheet.projection, pg.views.find((x) => x.id === v.parent)!)!, v)) : this.project(axes);
      out.push({ viewId: v.id, axes, features, hidden: hiddenFeatures(features, lines), ...(v.kind === 'section' ? { section: true } : {}) });
    }
    const rank = (x: ViewToDimension) => (x === out[0] ? 0 : x.section ? 1 : 2);
    return [...out].sort((a, b) => rank(a) - rank(b));
  }

  /** Adds what the dimension graph says is missing, as one step. */
  private dimensionAll(doc: DrawingDoc, ordinateAbove?: number): DrawingDoc {
    const views = this.dimensionViews(doc);
    const existing = page(doc).dimensions as DimensionLike[];
    const planned = planDrawingDimensions(views, existing, { ...(ordinateAbove !== undefined ? { ordinateAbove } : {}) });
    if (planned.length === 0) return doc;
    const alloc = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const dimensions = planned.map((p) => ({ ...p.draft, id: alloc.take('dim'), view: p.view }) as Dimension);
    return applyDrawingCommand(doc, { type: 'insertDimensions', dimensions });
  }

  private fitSheet(doc: DrawingDoc, o: CreateOptions): DrawingDoc {
    const orientation = o.orientation ?? 'landscape';
    const tryOn = (size: SheetSize) => {
      const d = applyDrawingCommand(doc, { type: 'setSheet', sheet: { size, orientation } });
      const b = this.build(d);
      return { d, fit: fitViews(d, b.lines, b.elements, b.features) };
    };
    let chosen: { d: DrawingDoc; fit: ReturnType<typeof fitViews> } | null = null;
    if (o.sheet && o.sheet !== 'auto') chosen = tryOn(o.sheet);
    else {
      for (const size of ['A4', 'A3', 'A2'] as SheetSize[]) {
        const c = tryOn(size);
        if (c.fit && ratio(c.fit.scale) >= 1) {
          chosen = c;
          break;
        }
      }
      chosen ??= tryOn('A3');
    }
    const scale = o.scale ?? chosen.fit?.scale;
    return applyDrawingCommand(chosen.d, { type: 'setSheet', sheet: { ...(scale ? { scale } : {}), shift: o.scale ? null : chosen.fit?.shift ?? null } });
  }

  /**
   * The isometric, shaded with its edges, in the largest free corner of the area beside what the other views draw, at the sheet's scale or the largest
   * standard one that fits there. Left out (and said so in the report) when no corner takes it at a quarter of the sheet's scale.
   */
  private placeIsometric(doc: DrawingDoc, mainId: Id): DrawingDoc {
    const pg = page(doc);
    const b = this.build(doc);
    const used = itemsBounds(b.scene.items.slice(sheetItems(doc).length));
    const area = sheetMetrics(pg.sheet).area;
    if (!used) return doc;
    const free = emptyRectangles(b.scene.items.slice(sheetItems(doc).length), area, 8);
    const corner = pg.views.find((v) => v.id === mainId)!;
    const probe: DrawingView = { id: 'iso-probe', name: '', kind: 'projected', parent: corner.id, side: 'upRight' };
    const axes = axesOf([...pg.views, probe], pg.sheet.projection, probe)!;
    const box = this.project(axes).box;
    if (!box) return doc;
    const w = box.max[0] - box.min[0];
    const h = box.max[1] - box.min[1];
    const sheetRatio = ratio(pg.sheet.scale);
    let best: { r: (typeof free)[number]; k: number } | null = null;
    for (const r of free) {
      const k = Math.min(sheetRatio, (r.x1 - r.x0 - 10) / w, (r.y1 - r.y0 - 14) / h);
      // as large as it fits; of equal fits the one to the upper right, where an isometric is looked for (and clear of the callouts left of the views)
      const further = (q: typeof r, p: typeof r) => q.x0 + q.x1 + 0.5 * (q.y0 + q.y1) > p.x0 + p.x1 + 0.5 * (p.y0 + p.y1);
      if (!best || k > best.k + 1e-9 || (Math.abs(k - best.k) <= 1e-9 && further(r, best.r))) best = { r, k };
    }
    if (!best || best.k < sheetRatio / 4) return doc;
    const at: [number, number] = [Math.round(((best.r.x0 + best.r.x1) / 2) * 10) / 10, Math.round(((best.r.y0 + best.r.y1) / 2) * 10) / 10];
    const id = new IdAllocator(doc.idCounters, drawingIdsInUse(doc)).take('view');
    const scale = STANDARD.find((s) => ratio(s) <= best!.k + 1e-9);
    const view: DrawingView = { id, name: t('drawing.view.isoProjected'), kind: 'projected', parent: mainId, side: 'upRight', at, display: 'shadedEdges', ...(scale && ratio(scale) < sheetRatio - 1e-9 ? { scale } : {}) };
    return applyDrawingCommand(doc, { type: 'insertViews', views: [view] });
  }

  /** Takes out what cannot be drawn, and lays the rows out again (the shortest nearest, as SolidWorks's Auto Arrange). */
  private tidy(doc: DrawingDoc): DrawingDoc {
    let b = this.build(doc);
    const failed = [...b.outcomes].filter(([, o]) => 'error' in o).map(([id]) => id);
    if (failed.length) {
      doc = applyDrawingCommand(doc, { type: 'deleteDimensions', dimensionIds: failed });
      b = this.build(doc);
    }
    const dims = page(doc).dimensions;
    // rows twice the text height apart (7 mm for ISO's 3.5 mm text, ISO 129-1), the first a little further: larger text, wider rows
    const h = page(doc).sheet.dimStyle?.text ?? 3.5;
    const changes = arrangeDimensions(dims, b.outcomes, new Set(dims.map((d) => d.id)), { first: Math.max(10, Math.round(h * (10 / 3.5) * 10) / 10), step: Math.max(7, h * 2) });
    if (changes.length) doc = applyDrawingCommand(doc, { type: 'batch', commands: changes.map((c) => ({ type: 'setDimension', dimensionId: c.id, patch: c.patch }) satisfies DrawingCommand) });
    // room first (views apart, leaders turned), and only then a number slid along its line — a last resort, since it belongs in the middle (ISO 129-1)
    return this.placeCaptions(this.steerLeaders(this.spreadViews(this.steerLeaders(this.spreadViews(doc), false)), true));
  }

  /**
   * Moves a view's caption that something crosses (the extension lines of the dimensions under the view, as a rule) to where nothing does: further down,
   * under the rows of dimensions, or over the view. The caption is only moved, never changed.
   */
  private placeCaptions(doc: DrawingDoc): DrawingDoc {
    let score = this.clutter(doc);
    const b = this.build(doc);
    for (const v of page(doc).views) {
      const own = b.placed.get(v.id);
      if (!own) continue;
      // as drafters do: under everything drawn for the view (its dimensions with it) — kept whenever it makes nothing worse
      const dimIds = new Set(page(doc).dimensions.filter((d) => d.view === v.id).map((d) => d.id));
      const below = itemsBounds(b.scene.items.filter((i) => i.group !== undefined && dimIds.has(i.group) && i.kind === 'polyline'));
      const auto = own.at[1] - own.h / 2 - 8; // where the caption's baseline is by default (viewCaptionItem)
      const first: [number, number] | null = below && below.y0 < auto + 6 ? [0, Math.round((below.y0 - 8 - auto) * 10) / 10] : null;
      const attempt = (offset: [number, number], keepEqual: boolean) => {
        const trial = applyDrawingCommand(doc, { type: 'setView', viewId: v.id, patch: { caption: { ...(v.caption ?? {}), offset } } });
        const c = this.clutter(trial);
        const frame = sheetMetrics(page(trial).sheet).area;
        const capY = auto + offset[1];
        if (capY < frame.y - 2) return false; // never into the title block's row
        if (c < score || (keepEqual && c === score)) {
          doc = trial;
          score = c;
          return true;
        }
        return false;
      };
      if (first && attempt(first, true) && score === 0) continue;
      if (score === 0) continue;
      const tries: [number, number][] = [];
      for (let k = 7; k <= 70; k += 7) tries.push([0, (first?.[1] ?? 0) - k]);
      tries.push([0, own.h + 14], [0, own.h + 24]);
      // the best of them all, not the first that helps: a little lower may help a little where over the view clears it
      let pick: { offset: [number, number]; c: number } | null = null;
      for (const offset of tries) {
        const auto2 = auto + offset[1];
        if (auto2 < sheetMetrics(page(doc).sheet).area.y - 2) continue;
        const c = this.clutter(applyDrawingCommand(doc, { type: 'setView', viewId: v.id, patch: { caption: { ...(v.caption ?? {}), offset } } }));
        if (!pick || c < pick.c) pick = { offset, c };
      }
      if (pick && pick.c < score) attempt(pick.offset, true);
    }
    return doc;
  }

  /** How far `doc` is from a clean sheet: what `clutterOf` counts, and a hundred for anything drawn outside the frame. */
  private clutter(doc: DrawingDoc): number {
    const b = this.build(doc);
    const items = b.scene.items.slice(sheetItems(doc).length);
    const frame = sheetMetrics(page(doc).sheet).frame;
    const drawn = itemsBounds(items);
    const outside = drawn ? Math.max(0, frame.x - drawn.x0, drawn.x1 - (frame.x + frame.w), frame.y - drawn.y0, drawn.y1 - (frame.y + frame.h)) : 0;
    return clutterOf(items, CLEARANCE, viewsOfDimensions(doc)).count + (outside > 0.05 ? 100 : 0);
  }

  /**
   * Slides projected and section views away from their parents (along the line they are in line on) where the rows of dimensions between them do not fit,
   * as a drafter leaves more room between views: by 5 mm steps, the smallest slide that leaves the sheet least cluttered.
   */
  private spreadViews(doc: DrawingDoc): DrawingDoc {
    let score = this.clutter(doc);
    for (let pass = 0; pass < 2 && score > 0; pass++)
      for (const v of page(doc).views) {
        if (score === 0) break;
        if (v.kind !== 'projected' && v.kind !== 'section') continue;
        if (v.kind === 'projected' && (v.side === 'upLeft' || v.side === 'upRight' || v.side === 'downLeft' || v.side === 'downRight')) continue;
        if (v.at) continue;
        let pick: { doc: DrawingDoc; c: number } | null = null;
        for (const step of [5, 10, 15, 20, 25, 30, 40]) for (const sign of [1, -1]) {
          try {
            const trial = applyDrawingCommand(doc, { type: 'setView', viewId: v.id, patch: { slide: (v.slide ?? 0) + sign * step } });
            const c = this.clutter(trial);
            if (c < score && (!pick || c < pick.c)) pick = { doc: trial, c };
          } catch {
            /* a view that does not slide */
          }
        }
        if (pick) {
          doc = pick.doc;
          score = pick.c;
        }
      }
    return doc;
  }

  /**
   * Turns the leader of each diameter and radius dimension (and lengthens it) to where its text crosses nothing, as a drafter swings a callout into free
   * room: the turn that leaves the sheet least cluttered, the one it has when none is better. A linear dimension's text is slid along its line likewise.
   */
  private steerLeaders(doc: DrawingDoc, slideNumbers = true): DrawingDoc {
    let score = this.clutter(doc);
    if (score === 0) return doc;
    const try_ = (patch: Extract<DrawingCommand, { type: 'setDimension' }>['patch'], id: Id) => {
      try {
        const trial = applyDrawingCommand(doc, { type: 'setDimension', dimensionId: id, patch });
        const c = this.clutter(trial);
        if (c < score) {
          doc = trial;
          score = c;
        }
      } catch {
        /* a patch the dimension does not take */
      }
    };
    // passes until one changes nothing: turning one leader can free the way for another
    for (let pass = 0; pass < 4 && score > 0; pass++) {
      const before = score;
      for (const d of page(doc).dimensions) {
        if (score === 0) break;
        if (d.kind === 'diameter' || d.kind === 'radius') {
          for (const leader of [8, 14, 22, 30, 40]) for (const angle of [45, 135, 225, 315, 60, 120, 240, 300, 30, 150, 210, 330, 90, 270, 0, 180]) try_({ angle, leader }, d.id);
        } else if (d.kind === 'linear' && slideNumbers) {
          for (const slide of [-12, 12, -24, 24, -36, 36]) try_({ slide }, d.id);
        }
      }
      if (score >= before) break;
    }
    return doc;
  }

  /** Everything a picture, a check or an export of `doc` needs. */
  build(doc: DrawingDoc = this.need()): Built {
    const s = this.source();
    const pg = page(doc);
    const lines = new Map<Id, ViewLines | null>();
    const features = new Map<Id, ViewFeature[]>();
    for (const v of pg.views) {
      const axes = axesOf(pg.views, pg.sheet.projection, v);
      if (!axes) {
        lines.set(v.id, null);
        continue;
      }
      if (v.kind === 'detail' || v.kind === 'crop') continue; // drawn from the parent's lines by the layout
      if (v.kind === 'section') {
        const parent = pg.views.find((x) => x.id === v.parent)!;
        lines.set(v.id, this.project(axes, sectionPlane(axesOf(pg.views, pg.sheet.projection, parent)!, v)));
      } else lines.set(v.id, this.project(axes));
      features.set(v.id, this.featuresFor(axes));
    }
    const holes = holeFeatures(s.doc);
    const elements = new Map<Id, ElementsResult>(
      pg.dimensions.map((d) => [d.id, { elements: dimensionRefs(d).map((r) => { const f = elementFacts(s.body.topology, s.body.names, r, holes, s.built.cosmeticThreads); return 'error' in f ? null : f; }) }]),
    );
    const built = buildScene(doc, lines, elements, features);
    return { lines, features, elements, scene: built.scene, placed: built.placed, outcomes: built.dimensions };
  }

  private need(): DrawingDoc {
    if (!this.doc) throw new AgentError('there is no drawing yet: drawing_create makes one of the open part, drawing_open opens one');
    return this.doc;
  }

  checks(doc: DrawingDoc = this.need(), b: Built = this.build(doc)): Checks {
    const pg = page(doc);
    const ids = new Set(pg.dimensions.map((d) => d.id));
    const failed = [...b.outcomes].flatMap(([id, o]) => ('error' in o ? [{ id, error: o.error }] : []));
    const area = sheetMetrics(pg.sheet).frame;
    const drawn = itemsBounds(b.scene.items.slice(sheetItems(doc).length));
    const outside = drawn ? Math.max(0, area.x - drawn.x0, drawn.x1 - (area.x + area.w), area.y - drawn.y0, drawn.y1 - (area.y + area.h)) : 0;
    const coverage = dimensionCoverage(this.dimensionViews(doc), pg.dimensions as DimensionLike[]);
    const clutter = clutterOf(b.scene.items.slice(sheetItems(doc).length), CLEARANCE, viewsOfDimensions(doc));
    // every character as the PDF will write it: one the font cannot write comes out as 「?」, which is never acceptable on a drawing
    const f = font();
    const missing = toPdf(b.scene, { ...(f ? { font: f } : {}) }).warnings;
    const heights = b.scene.items.slice(sheetItems(doc).length).flatMap((i) => (i.kind === 'text' && i.text.trim() ? [{ text: i.text, h: Math.round(i.height * 100) / 100, caption: i.owner?.startsWith('caption:') === true }] : []));
    const odd = heights.filter((x) => { const [lo, hi] = x.caption ? TEXT_RANGE.caption : TEXT_RANGE.text; return x.h < lo - 1e-9 || x.h > hi + 1e-9; });
    return {
      overlaps: overlappingDimensions(b.scene.items, ids),
      text: { min: heights.length ? Math.min(...heights.map((x) => x.h)) : null, max: heights.length ? Math.max(...heights.map((x) => x.h)) : null, outOfRange: odd.slice(0, 12).map((x) => `${x.text} (${x.h} mm)`) },
      clutter: { count: clutter.count, texts: clutter.texts.slice(0, 12), ...(clutter.crossings ? { crossings: clutter.crossings.slice(0, 12) } : {}) },
      glyphs: { font: f?.name ?? null, missing },
      outside: Math.round(outside * 10) / 10,
      failed,
      coverage,
    };
  }

  report(): DrawingReport {
    const doc = this.need();
    const pg = page(doc);
    return {
      path: this.path,
      sheet: { size: pg.sheet.size, orientation: pg.sheet.orientation, scale: `${pg.sheet.scale[0]}:${pg.sheet.scale[1]}`, projection: pg.sheet.projection },
      views: pg.views.map((v) => ({ id: v.id, name: v.name, kind: v.kind ?? 'model', ...(!isDerived(v) ? { direction: v.direction } : { parent: v.parent }), ...(v.kind === 'projected' ? { side: v.side } : {}) })),
      dimensions: pg.dimensions.length,
      annotations: (pg.annotations ?? []).length,
      surfaceFinishes: pg.surfaceFinishes.length,
      checks: this.checks(doc),
    };
  }

  /**
   * What is on the drawing, for the agent to find what the user means: every dimension with the text it writes and what it points at, and for each view the
   * elements a tolerance, a finish or a note can go on — the planes seen edge-on (with which end of the view they are), the holes and arcs, with a point
   * on the sheet for each.
   */
  inspect(): unknown {
    const doc = this.need();
    const b = this.build(doc);
    const pg = page(doc);
    const dims = pg.dimensions.map((d) => {
      const o = b.outcomes.get(d.id);
      return { id: d.id, view: d.view, kind: d.kind, text: o && 'text' in o ? o.text : null, ...(o && 'error' in o ? { error: o.error } : {}), refs: dimensionRefs(d).map((r) => r.name), ...(d.tolerance ? { tolerance: d.tolerance } : {}), ...(d.reference ? { reference: true } : {}) };
    });
    const views = pg.views.map((v) => {
      const placed = b.placed.get(v.id);
      const features = b.features.get(v.id) ?? [];
      const planes = features.filter((f): f is Extract<ViewFeature, { type: 'plane' }> => f.type === 'plane');
      const ext = (axis: 'x' | 'y') => { const on = planes.filter((p) => p.axis === axis).map((p) => p.coord); return on.length ? [Math.min(...on), Math.max(...on)] : [NaN, NaN]; };
      const [x0, x1] = ext('x');
      const [y0, y1] = ext('y');
      const toSheet = (p: [number, number]) => (placed ? [r2(placed.at[0] + (p[0] - placed.centre[0]) * placed.scale), r2(placed.at[1] + (p[1] - placed.centre[1]) * placed.scale)] : null);
      const elements = features.flatMap((f): Record<string, unknown>[] => {
        if (f.type === 'plane') {
          const end = f.axis === 'x' ? (f.coord === x0 ? 'left' : f.coord === x1 ? 'right' : null) : f.coord === y0 ? 'bottom' : f.coord === y1 ? 'top' : null;
          return [{ ref: f.ref.name, type: 'plane', seen: f.axis === 'x' ? 'vertical line' : 'horizontal line', at: r2(f.coord), area: r2(f.area), ...(end ? { end } : {}) }];
        }
        if (f.type === 'circle') return [{ ref: f.ref.name, type: f.full ? (f.convex ? 'boss' : 'hole') : 'arc', diameter: r2(f.radius * 2), centre: f.centre.map(r2), sheet: toSheet(f.centre), ...(f.hole ? { hole: f.hole } : {}) }];
        if (f.type === 'torus') return [{ ref: f.ref.name, type: 'fillet', radius: r2(f.radius) }];
        if (f.type === 'slant') return [{ ref: f.ref.name, type: 'slant', at: f.at.map(r2) }];
        if (f.type === 'axis') return [{ ref: f.ref.name, type: 'cylinder side-on', diameter: r2(f.radius * 2) }];
        return [];
      });
      return { id: v.id, name: v.name, kind: v.kind ?? 'model', ...(!isDerived(v) ? { direction: v.direction } : {}), sheetBox: placed ? { at: placed.at.map(r2), w: r2(placed.w), h: r2(placed.h), scale: placed.scale } : null, elements };
    });
    return { report: this.report(), dimensions: dims, annotations: pg.annotations ?? [], surfaceFinishes: pg.surfaceFinishes, views };
  }

  /** Applies drawing commands as one step: all or nothing. */
  apply(commands: DrawingCommand[]): void {
    const doc = this.need();
    let next = doc;
    for (const c of commands) next = applyDrawingCommand(next, c);
    this.undoStack.push(doc);
    this.doc = next;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) throw new AgentError('nothing to undo in the drawing');
    this.doc = prev;
  }

  // ------------------------------------------------------------------------------------------------- what the user asks for in words

  /** A dimension by id, or by the text it writes (「Ø10」, 「25」), when only one writes it. */
  findDimension(which: string): Dimension {
    const doc = this.need();
    const pg = page(doc);
    const byId = pg.dimensions.find((d) => d.id === which);
    if (byId) return byId;
    const b = this.build(doc);
    const norm = (s: string) => s.replace(/\s+/g, '').replace(/^\d+[x×]/i, '').toLowerCase();
    const hits = pg.dimensions.filter((d) => {
      const o = b.outcomes.get(d.id);
      return o && 'text' in o && (norm(o.text) === norm(which) || norm(o.text).startsWith(norm(which)));
    });
    if (hits.length === 1) return hits[0]!;
    if (hits.length === 0) throw new AgentError(`no dimension is ${JSON.stringify(which)}: drawing_inspect lists them with their ids and texts`);
    throw new AgentError(`${hits.length} dimensions write ${JSON.stringify(which)} (${hits.map((d) => d.id).join(', ')}): give the id`);
  }

  setTolerance(which: string, tolerance: string | null, extra: { reference?: boolean; precision?: number } = {}): Id {
    const d = this.findDimension(which);
    const patch: Extract<DrawingCommand, { type: 'setDimension' }>['patch'] = { tolerance: tolerance === null ? null : parseTolerance(tolerance) };
    if (extra.reference !== undefined) patch.reference = extra.reference;
    if (extra.precision !== undefined) patch.precision = extra.precision;
    this.apply([{ type: 'setDimension', dimensionId: d.id, patch }]);
    // a longer text (「Ø10 H7 (+0.015/0)」) may now cross what it did not: swing the leaders again (only where they are, never what they measure)
    this.doc = this.steerLeaders(this.doc!);
    return d.id;
  }

  /**
   * An annotation on an element of a view, placed by itself: beside the element, outward from the view's middle, its leader (if it has one) ending on it.
   * `target` is the element's ref name (as drawing_inspect lists them) or a dimension (by id or text), whose element it goes on.
   */
  annotate(a: AnnotateInput): Id {
    const doc = this.need();
    const pg = page(doc);
    const b = this.build(doc);
    let viewId = a.view;
    let refName = a.target;
    if (a.target) {
      const dim = (() => { try { return this.findDimension(a.target); } catch { return null; } })();
      if (dim) {
        viewId ??= dim.view;
        refName = dimensionRefs(dim).at(-1)?.name;
      }
    }
    viewId ??= refName ? pg.views.find((v) => (b.features.get(v.id) ?? []).some((f) => f.ref.name === refName))?.id : pg.views[0]?.id;
    if (!viewId) throw new AgentError(refName ? `no view shows ${refName}` : 'the drawing has no views');
    const placed = b.placed.get(viewId);
    if (!placed) throw new AgentError(`view ${viewId} is not drawn`);
    const feature = refName ? (b.features.get(viewId) ?? []).find((f) => f.ref.name === refName) : undefined;
    if (refName && !feature) throw new AgentError(`view ${viewId} does not show ${refName}: drawing_inspect lists what each view shows`);
    const lines = b.lines.get(viewId)?.box;
    const mid: [number, number] = lines ? [(lines.min[0] + lines.max[0]) / 2, (lines.min[1] + lines.max[1]) / 2] : [0, 0];
    const halfW = lines ? (lines.max[0] - lines.min[0]) / 2 : 0;
    const halfH = lines ? (lines.max[1] - lines.min[1]) / 2 : 0;
    // where on the element it can go, and which ways out from there: tried in turn, the one that leaves the sheet least cluttered kept
    const spots: { on: [number, number]; out: [number, number] }[] = [];
    const ways = (base: [number, number]): [number, number][] => [base, [base[0] + base[1] * 0.7, base[1] - base[0] * 0.7], [base[0] - base[1] * 0.7, base[1] + base[0] * 0.7]];
    if (feature?.type === 'plane') {
      const sgn = Math.sign(feature.coord - (feature.axis === 'x' ? mid[0] : mid[1])) || 1;
      for (const t of [0.3, 0.5, 0.7, 0.15, 0.85]) {
        const on: [number, number] = feature.axis === 'x' ? [feature.coord, mid[1] - halfH + 2 * halfH * t] : [mid[0] - halfW + 2 * halfW * t, feature.coord];
        for (const out of ways(feature.axis === 'x' ? [sgn, 0.6] : [0.6, sgn])) spots.push({ on, out });
      }
    } else if (feature?.type === 'circle') {
      for (const deg of [feature.outward, 45, 135, 225, 315]) {
        const th = (deg * Math.PI) / 180;
        spots.push({ on: [feature.centre[0] + feature.radius * Math.cos(th), feature.centre[1] + feature.radius * Math.sin(th)], out: [Math.cos(th), Math.sin(th)] });
      }
    } else if (feature?.type === 'torus' || feature?.type === 'slant') {
      const on: [number, number] = [feature.at[0], feature.at[1]];
      for (const out of ways([Math.sign(on[0] - mid[0]) || 1, Math.sign(on[1] - mid[1]) || 1])) spots.push({ on, out });
    } else if (feature?.type === 'axis') {
      for (const t of [0.5, 0.25, 0.75]) {
        const on: [number, number] = [feature.from[0] + (feature.to[0] - feature.from[0]) * t, feature.from[1] + (feature.to[1] - feature.from[1]) * t + feature.radius];
        for (const out of ways([0.6, 1])) spots.push({ on, out });
      }
    }
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const attach = refName && feature ? { attach: { ref: { kind: feature.ref.kind, name: feature.ref.name } as never, u: 0.5 } } : {};
    const angleOf = (out: [number, number]) => Math.round((Math.atan2(out[1], out[0]) * 180) / Math.PI);
    const pt = (p: [number, number]): [number, number] => [r2(p[0]), r2(p[1])];
    let make: (spot: { on: [number, number]; out: [number, number] }, reach: number) => DrawingCommand;
    let id: Id;
    if (a.kind === 'finish') {
      if (a.ra !== undefined && !(Number.isFinite(a.ra) && a.ra >= 0.008 && a.ra <= 400)) throw new AgentError(`Ra is 0.008 to 400 µm, not ${a.ra}`);
      if (!feature) throw new AgentError('a surface finish goes on a surface: give its target (a plane, a hole, … from drawing_inspect)');
      id = ids.take('sf');
      make = ({ on, out }, reach) => ({ type: 'insertSurfaceFinishes', finishes: [{ id, view: viewId, at: pt(on), angle: angleOf(out), ...(reach > 10 ? { leader: reach - 10 } : {}), ...(a.ra !== undefined ? { ra: a.ra } : {}), ...(a.method ? { method: a.method } : {}), ...(a.text ? { note: a.text } : {}), ...(a.process ? { kind: a.process } : {}) } satisfies SurfaceFinish] });
    } else {
      id = ids.take('ann');
      const away = ({ on, out }: { on: [number, number]; out: [number, number] }, reach: number): [number, number] => {
        const n = Math.hypot(out[0], out[1]) || 1;
        return pt([on[0] + (out[0] / n) * (reach / placed.scale), on[1] + (out[1] / n) * (reach / placed.scale)]);
      };
      if (a.kind === 'note') {
        if (!a.text) throw new AgentError('a note needs its text');
        const text = a.text;
        make = (spot, reach) => ({ type: 'insertAnnotations', annotations: [{ id, view: viewId, kind: 'note', at: away(spot, reach), text, leader: pt(spot.on), ...attach } satisfies Annotation] });
      } else if (a.kind === 'datum') {
        if (!a.label) throw new AgentError('a datum needs its letter (A, B, …)');
        if (!feature) throw new AgentError('a datum goes on a feature: give its target');
        const label = a.label;
        make = (spot, reach) => ({ type: 'insertAnnotations', annotations: [{ id, view: viewId, kind: 'datum', at: pt(spot.on), label, angle: angleOf(spot.out), length: Math.max(6, reach - 8), ...attach } satisfies Annotation] });
      } else if (a.kind === 'fcf') {
        if (!a.characteristic) throw new AgentError('a geometric tolerance needs its characteristic (flatness, position, …)');
        if (!(a.tolerance !== undefined && Number.isFinite(a.tolerance) && a.tolerance > 0)) throw new AgentError('a geometric tolerance needs its tolerance, a positive number of mm');
        const base = { id, view: viewId, kind: 'fcf' as const, characteristic: a.characteristic, tolerance: a.tolerance, ...(a.diameter ? { diameter: true } : {}), ...(a.material ? { material: a.material } : {}), datums: (a.datums ?? []).map((label) => ({ label })) };
        make = (spot, reach) => ({ type: 'insertAnnotations', annotations: [{ ...base, at: away(spot, reach), leader: pt(spot.on), ...attach } satisfies Annotation] });
      } else throw new AgentError(`kind must be note, finish, datum or fcf, not ${JSON.stringify(a.kind)}`);
      if (!feature) {
        // a general note: at the lower left of the area, above the title block's row, clear of the views
        if (a.kind !== 'note') throw new AgentError(`a ${a.kind} goes on a feature: give its target`);
        const area = sheetMetrics(pg.sheet).area;
        const text = a.text!;
        const lines = (pg.annotations ?? []).filter((x) => x.kind === 'note' && !x.leader).length;
        const sheetAt: [number, number] = [area.x + 2, area.y + 2 + lines * 6];
        const viewAt = pt([placed.centre[0] + (sheetAt[0] - placed.at[0]) / placed.scale, placed.centre[1] + (sheetAt[1] - placed.at[1]) / placed.scale]);
        this.apply([{ type: 'insertAnnotations', annotations: [{ id, view: viewId, kind: 'note', at: viewAt, text } satisfies Annotation] }]);
        return id;
      }
    }
    let best: { doc: DrawingDoc; score: number } | null = null;
    search: for (const reach of [14, 22, 32])
      for (const spot of spots) {
        let trial: DrawingDoc;
        try {
          trial = applyDrawingCommand(doc, make(spot, reach));
        } catch {
          continue;
        }
        const b2 = this.build(trial);
        const items = b2.scene.items.slice(sheetItems(trial).length);
        const drawn = itemsBounds(items);
        const frame = sheetMetrics(pg.sheet).frame;
        const outside = drawn ? Math.max(0, frame.x - drawn.x0, drawn.x1 - (frame.x + frame.w), frame.y - drawn.y0, drawn.y1 - (frame.y + frame.h)) : 0;
        const score = clutterOf(items, CLEARANCE, viewsOfDimensions(trial)).count + (outside > 0 ? 100 : 0);
        if (!best || score < best.score) best = { doc: trial, score };
        if (best.score === 0) break search;
      }
    if (!best) throw new AgentError('the annotation could not be placed on that element');
    this.undoStack.push(doc);
    this.doc = best.doc;
    return id;
  }

  /**
   * Text sizes (ADR 0256; the user: 字體大小適中，最好能夠統一調整，也允許個別調整). `all` sets the drawing's text height — the dimensions, the finishes, the
   * frames, the datums and the notes without a height of their own follow it, the arrows with it — and the captions to 10/7 of it (ISO 3098's next size up);
   * `reset` takes the sizes items were given one by one back to it. `item` with `size` gives one dimension, note or view caption a size of its own. A size
   * outside what reads well on a drawing (TEXT_RANGE) is refused with the range, never put in range by itself. The rows are laid out again afterwards.
   */
  textSize(o: { all?: number; reset?: boolean; item?: string; size?: number | null }): string[] {
    const doc = this.need();
    const pg = page(doc);
    const changed: string[] = [];
    const commands: DrawingCommand[] = [];
    const within = (size: number, [lo, hi]: readonly [number, number], what: string) => {
      if (!(Number.isFinite(size) && size >= lo && size <= hi)) throw new AgentError(`${what} 的字高以 ${lo}–${hi} mm 為宜（ISO 3098），不是 ${size}`);
    };
    if (o.all !== undefined) {
      within(o.all, TEXT_RANGE.text, '尺寸、註記與符號');
      const caption = Math.min(TEXT_RANGE.caption[1], Math.round(o.all * (10 / 7) * 10) / 10);
      commands.push({ type: 'setSheet', sheet: { dimStyle: { ...(pg.sheet.dimStyle ?? {}), text: o.all, arrow: Math.round(o.all * (3 / 3.5) * 100) / 100 } } });
      for (const v of pg.views) commands.push({ type: 'setView', viewId: v.id, patch: { caption: { ...(v.caption ?? {}), height: o.reset || v.caption?.height === undefined ? caption : v.caption.height } } });
      if (o.reset) {
        for (const d of pg.dimensions) if (d.style?.text !== undefined) { const { text: _t, ...rest } = d.style; commands.push({ type: 'setDimension', dimensionId: d.id, patch: { style: Object.keys(rest).length ? rest : null } as never }); }
        for (const a of pg.annotations ?? []) if (a.kind === 'note' && a.height !== undefined) commands.push({ type: 'setAnnotation', annotationId: a.id, patch: { height: null } as never });
      }
      changed.push(`all ${o.all} mm（視圖標題 ${caption} mm）`);
    }
    if (o.item !== undefined) {
      if (o.size === undefined) throw new AgentError('give the size (mm) for the item, or null to make it follow the drawing again');
      const d = pg.dimensions.find((x) => x.id === o.item) ?? (() => { try { return this.findDimension(o.item!); } catch { return undefined; } })();
      const a = (pg.annotations ?? []).find((x) => x.id === o.item);
      const v = pg.views.find((x) => x.id === o.item || x.name === o.item);
      if (o.size !== null) within(o.size, v && !d && !a ? TEXT_RANGE.caption : TEXT_RANGE.text, v && !d && !a ? '視圖標題' : '尺寸與註記');
      if (d) commands.push({ type: 'setDimension', dimensionId: d.id, patch: { style: o.size === null ? (() => { const { text: _t, ...rest } = d.style ?? {}; return Object.keys(rest).length ? rest : null; })() : { ...(d.style ?? {}), text: o.size } } as never });
      else if (a && a.kind === 'note') commands.push({ type: 'setAnnotation', annotationId: a.id, patch: { height: o.size } as never });
      else if (v) commands.push({ type: 'setView', viewId: v.id, patch: { caption: { ...(v.caption ?? {}), ...(o.size === null ? { height: undefined } : { height: o.size }) } } });
      else throw new AgentError(`${o.item} is not a dimension, a note or a view of the drawing (finishes and frames follow the drawing's size)`);
      changed.push(`${o.item} ${o.size === null ? '跟隨全圖' : `${o.size} mm`}`);
    }
    if (commands.length === 0) throw new AgentError('give all (one size for the whole drawing) or item and size');
    this.apply(commands);
    this.doc = this.tidy(this.doc!);
    return changed;
  }

  /** Adds the dimensions the graph still finds missing (after the user deleted some, or the part changed), arranged again. */
  complete(): number {
    const doc = this.need();
    const before = page(doc).dimensions.length;
    const next = this.tidy(this.dimensionAll(doc));
    this.undoStack.push(doc);
    this.doc = next;
    return page(next).dimensions.length - before;
  }

  async open(path: string): Promise<void> {
    const full = await this.part.inside(path);
    const file = await readAnyDocumentFile(new Uint8Array(await readFile(full)));
    if (file.kind !== 'drawing') throw new AgentError(`${path} is a ${file.kind}, not a drawing`);
    const sources = new Set(file.doc.pages.flatMap((p) => p.views.flatMap((v) => (isDerived(v) ? [] : [v.source]))));
    if (sources.size !== 1) throw new AgentError('only a drawing of one part can be opened here');
    const partPath = relative(this.part.root, `${dirname(full)}${sep}${[...sources][0]!}`);
    await this.part.open(partPath);
    this.doc = file.doc;
    this.path = full;
    this.undoStack.length = 0;
  }

  async save(path?: string): Promise<{ path: string; bytes: number }> {
    const doc = this.need();
    const full = path ? await this.part.inside(path) : this.path;
    if (!full) throw new AgentError('give a path ending in .3dbd');
    if (!full.toLowerCase().endsWith('.3dbd')) throw new AgentError(`a drawing file name ends in .3dbd, not ${full}`);
    if (path && this.path && dirname(full) !== dirname(this.path)) throw new AgentError('save the drawing in the folder it was made in: its views refer to the part from there');
    const bytes = await writeDrawingFile(doc);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    this.path = full;
    return { path: full, bytes: bytes.length };
  }

  async export(path: string, format: 'pdf' | 'dxf' | 'svg'): Promise<{ path: string; bytes: number; warnings: string[] }> {
    const doc = this.need();
    const full = await this.part.inside(path);
    const b = this.build(doc);
    const f = font();
    let warnings: string[] = [];
    let data: Uint8Array | string;
    if (format === 'pdf') {
      const pdf = toPdf(b.scene, { ...(f ? { font: f } : {}), title: page(doc).title.drawingName ?? 'drawing' });
      data = pdf.bytes;
      warnings = pdf.warnings;
    } else data = format === 'dxf' ? toDxf(b.scene) : toSvg(b.scene);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return { path: full, bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.length, warnings };
  }

  /** A PNG of the sheet (or of one view and what is drawn on it), for the agent to look at. */
  async picture(o: { view?: Id; px?: number } = {}): Promise<{ png: Uint8Array; width: number; height: number; font: boolean }> {
    const doc = this.need();
    const b = this.build(doc);
    let window: { x0: number; y0: number; x1: number; y1: number } | undefined;
    if (o.view) {
      const p = b.placed.get(o.view);
      if (!p) throw new AgentError(`no view ${o.view} on the sheet`);
      const pad = 30;
      window = { x0: p.at[0] - p.w / 2 - pad, y0: p.at[1] - p.h / 2 - pad, x1: p.at[0] + p.w / 2 + pad, y1: p.at[1] + p.h / 2 + pad };
    }
    const f = font();
    const raster = rasterizeSheet(b.scene, { px: o.px ?? (o.view ? 8 : 4), ...(f ? { font: f } : {}), ...(window ? { window } : {}) });
    const img = await encodeShade(raster);
    return { png: img.png, width: img.width, height: img.height, font: !!f };
  }

  /** Small pictures of the part from the best main directions, for the user to choose from. */
  async thumbnails(directions: readonly ViewName[], size = 320): Promise<{ direction: ViewName; png: Uint8Array }[]> {
    const out = [];
    for (const d of directions) {
      try {
        out.push({ direction: d, png: (await renderView(this.part, { view: d as never, size, hidden: true })).png });
      } catch (e) {
        if (isTrap(e)) throw e;
        /* a direction that shows nothing has no picture */
      }
    }
    return out;
  }
}

/**
 * The features a view draws only with hidden lines: a plane edge-on, a cylinder side-on or a circle with no visible (or cut) line where it is. A plane is
 * seen when some visible segment lies along its line; a side-on cylinder when one lies along either of its outlines; a circle when visible points lie on it.
 */
export function hiddenFeatures(features: readonly ViewFeature[], lines: ViewLines): Set<string> {
  const seen = [...lines.visible, ...(lines.cut ?? [])];
  const tol = 1e-3;
  const along = (axis: 'x' | 'y', c: number) =>
    seen.some((l) => {
      for (let i = 0; i + 3 < l.length; i += 2) {
        const [x0, y0, x1, y1] = [l[i]!, l[i + 1]!, l[i + 2]!, l[i + 3]!];
        if (axis === 'x' ? Math.abs(x0 - c) < tol && Math.abs(x1 - c) < tol && Math.abs(y1 - y0) > tol : Math.abs(y0 - c) < tol && Math.abs(y1 - y0) < tol && Math.abs(x1 - x0) > tol) return true;
      }
      return false;
    });
  const out = new Set<string>();
  for (const f of features) {
    if (f.type === 'plane') {
      if (!along(f.axis, f.coord)) out.add(f.ref.name);
    } else if (f.type === 'axis') {
      const runsX = Math.abs(f.to[0] - f.from[0]) >= Math.abs(f.to[1] - f.from[1]);
      const c = runsX ? f.from[1] : f.from[0];
      if (!along(runsX ? 'y' : 'x', c + f.radius) && !along(runsX ? 'y' : 'x', c - f.radius)) out.add(f.ref.name);
    } else if (f.type === 'circle') {
      const on = seen.some((l) => {
        for (let i = 0; i + 1 < l.length; i += 2) if (Math.abs(Math.hypot(l[i]! - f.centre[0], l[i + 1]! - f.centre[1]) - f.radius) < Math.max(tol, f.radius * 1e-3)) return true;
        return false;
      });
      if (!on) out.add(f.ref.name);
    }
  }
  return out;
}

/**
 * The largest empty rectangles of the area (sheet mm), clear of everything drawn by `gap`: what is drawn is marked on a 2 mm grid (each line by the cells
 * it passes, each text by its box), and the largest rectangle of free cells found (the histogram method), then the largest beside it, up to four.
 */
export function emptyRectangles(items: readonly SceneItem[], area: { x: number; y: number; w: number; h: number }, gap: number): { x0: number; y0: number; x1: number; y1: number }[] {
  const cell = 2;
  const nx = Math.max(1, Math.floor(area.w / cell));
  const ny = Math.max(1, Math.floor(area.h / cell));
  const used = new Uint8Array(nx * ny);
  const pad = Math.ceil(gap / cell);
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - area.x) / cell) - pad);
    const i1 = Math.min(nx - 1, Math.floor((Math.max(x0, x1) - area.x) / cell) + pad);
    const j0 = Math.max(0, Math.floor((Math.min(y0, y1) - area.y) / cell) - pad);
    const j1 = Math.min(ny - 1, Math.floor((Math.max(y0, y1) - area.y) / cell) + pad);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) used[j * nx + i] = 1;
  };
  for (const it of items) {
    if (it.kind === 'polyline') {
      for (let k = 0; k + 3 < it.points.length; k += 2) {
        const [ax, ay, bx, by] = [it.points[k]!, it.points[k + 1]!, it.points[k + 2]!, it.points[k + 3]!];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / cell));
        for (let t = 0; t <= n; t++) mark(ax + ((bx - ax) * t) / n, ay + ((by - ay) * t) / n, ax + ((bx - ax) * t) / n, ay + ((by - ay) * t) / n);
      }
    } else {
      const bx = itemsBounds([it]);
      if (bx) mark(bx.x0, bx.y0, bx.x1, bx.y1);
    }
  }
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let round = 0; round < 4; round++) {
    const hgt = new Array<number>(nx).fill(0);
    let best = { area: 0, i0: 0, i1: 0, j0: 0, j1: 0 };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) hgt[i] = used[j * nx + i] ? 0 : hgt[i]! + 1;
      const stack: number[] = [];
      for (let i = 0; i <= nx; i++) {
        const h = i === nx ? 0 : hgt[i]!;
        while (stack.length && hgt[stack[stack.length - 1]!]! >= h) {
          const top = stack.pop()!;
          const height = hgt[top]!;
          const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
          const a = height * (i - left);
          if (a > best.area) best = { area: a, i0: left, i1: i - 1, j0: j - height + 1, j1: j };
        }
        stack.push(i);
      }
    }
    if (best.area === 0) break;
    out.push({ x0: area.x + best.i0 * cell, y0: area.y + best.j0 * cell, x1: area.x + (best.i1 + 1) * cell, y1: area.y + (best.j1 + 1) * cell });
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) used[j * nx + i] = 1;
  }
  return out;
}

/** Which view each dimension is drawn on, by its id. */
const viewsOfDimensions = (doc: DrawingDoc) => new Map(page(doc).dimensions.map((d) => [d.id, d.view]));

/** Text heights that read well on a drawing (mm, ISO 3098): 2.5 to 5 for numbers, notes and symbols, 3.5 to 7 for the views' captions. */
export const TEXT_RANGE = { text: [2.5, 5], caption: [3.5, 7] } as const;

/** How clear of other lines and texts a text must stay (mm on the sheet): a box 0.6 mm larger than the text is checked, so that nothing touches it either. */
const CLEARANCE = -0.6;

const STANDARD: readonly Scale[] = [[2, 1], [1, 1], [1, 2], [1, 5], [1, 10], [1, 20], [1, 50], [1, 100]];
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface AnnotateInput {
  kind: 'note' | 'finish' | 'datum' | 'fcf';
  view?: Id;
  target?: string;
  text?: string;
  ra?: number;
  method?: string;
  process?: SurfaceFinish['kind'];
  label?: string;
  characteristic?: GeometricCharacteristic;
  tolerance?: number;
  diameter?: boolean;
  material?: 'M' | 'L';
  datums?: string[];
}

/**
 * A tolerance as people write it: 「±0.05」, 「+0.1/-0.05」 (or 「+0.1 -0.05」, 「+0.1/0」), 「H7」/「h6」/「H7/g6」's own class, 「max」/「min」 (「最大」/「最小」).
 * Anything else is refused with what is taken, never guessed.
 */
export function parseTolerance(text: string): DimensionTolerance {
  const s = text.trim().replace(/\s+/g, ' ');
  const num = (x: string) => {
    const n = Number(x);
    if (!Number.isFinite(n)) throw new AgentError(`${x} is not a number`);
    return n;
  };
  if (/^(max|最大)$/i.test(s)) return { type: 'max' };
  if (/^(min|最小)$/i.test(s)) return { type: 'min' };
  let m = /^(?:±|\+\/-|\+-)\s*(\d*\.?\d+)$/.exec(s);
  if (m) {
    const v = num(m[1]!);
    if (v <= 0) throw new AgentError('a ± tolerance is a positive number');
    return { type: 'bilateral', upper: v, lower: -v };
  }
  m = /^([+-]?\d*\.?\d+)\s*[/ ,]\s*([+-]?\d*\.?\d+)$/.exec(s);
  if (m) {
    const a = num(m[1]!);
    const b = num(m[2]!);
    const upper = Math.max(a, b);
    const lower = Math.min(a, b);
    if (upper === lower) throw new AgentError('the two limits of a tolerance must differ');
    return { type: 'bilateral', upper, lower };
  }
  if (/^[A-Za-z]{1,2}\d{1,2}$/.test(s)) return { type: 'fit', fit: s };
  throw new AgentError(`a tolerance is written ±0.05, +0.1/-0.05, a class such as H7 or g6, max or min — not ${JSON.stringify(text)}`);
}

export { messageOf };
