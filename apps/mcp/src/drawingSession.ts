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
  baseDimStyle,
  createEmptyDrawing,
  currentDrawingRevision,
  dimensionRefs,
  drawingIdsInUse,
  drawingPageForOutput,
  IdAllocator,
  isDerived,
  page,
  resolveDimStyle,
  rightOf,
  sectionPlane,
  sheetUp,
  viewVectors,
  type Annotation,
  type Dimension,
  type DimensionTolerance,
  type DrawingCommand,
  type DrawingDoc,
  type DrawingStandard,
  type DrawingPage,
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
  adviseAuxiliary,
  adviseSection,
  arrangeDimensions,
  buildScene,
  chooseProjections,
  clutterOf,
  dimensionCoverage,
  drawingSheetMetrics,
  encodeShade,
  evaluateQualityGate,
  FILL_RANGE,
  findControlledAttachmentRefs,
  fitViews,
  itemsBounds,
  layoutMetrics,
  linearOffsetCandidates,
  MIN_DETAIL_INK,
  minViewClearance,
  nearestFreeSpot,
  overlappingDimensions,
  planDrawingDimensions,
  rankMainViews,
  rasterizeSheet,
  ratio,
  revolutionAxis,
  revisionTableOverlaps,
  STANDARD_SCALES,
  readTrueType,
  sheetItems,
  sheetMetrics,
  slideAxis,
  stampPreliminary,
  toDxf,
  toPdf,
  toSvg,
  type CoverageReport,
  type DimensionLike,
  type DirectionStats,
  type DxfMode,
  type DxfVersion,
  type DrawingLayoutInspection,
  type DrawingReleaseStatus,
  type ElementsResult,
  type MainViewCandidate,
  type PageLayoutInspection,
  type PlacedView,
  type QualityGateReport,
  type QualityRuleCheck,
  type Scene,
  type SceneItem,
  type DimensionOutcome,
  type Clearance,
  type LayoutMetrics,
  type TrueTypeFont,
  type ViewChoice,
  type ViewLines,
  type ViewToDimension,
  type SectionAdvice,
} from '@3db/drawing';
import { readAnyDocumentFile, writeDrawingFile } from '@3db/io';
import { loadControlledAttachment } from './controlledAttachment';
import { drawingSketchFacts, elementFacts, holeFeatures, obliqueHoleAxes, projectDrawingView, sketchTextPrefixes, viewFeatures } from '@3db/regen';
import { isTrap } from '@3db/kernel';
import { AgentError, messageOf, type CadSession } from './session';
import { renderView } from './render';
import { dxfToDwg, dwgToDxf } from './dwg';
import { dxfText, importCadDxf } from '@3db/drawing';

const ORTHO: ViewName[] = ['front', 'back', 'top', 'bottom', 'left', 'right'];
const AUTO_SHEETS: SheetSize[] = ['A4', 'A3'];
const SIDES: ViewSide[] = ['up', 'down', 'left', 'right'];
/** The leader of an angle dimension written with one (ADR 0266), mm on the sheet: a chamfer's. */
const LEADER_ANGLE_LENGTH = 8;
const IDENTITY = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };

function onPage(doc: DrawingDoc, pageIndex: number, fn: (single: DrawingDoc) => DrawingDoc): DrawingDoc {
  if (pageIndex === 0 && doc.pages.length === 1) return fn(doc);
  const single: DrawingDoc = { ...doc, pages: [page(doc, pageIndex)] };
  const next = fn(single);
  return { ...next, pages: doc.pages.map((p, i) => (i === pageIndex ? next.pages[0]! : p)) };
}

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
  /** The drafting standard (ADR 0260); absent: CNS 3, as every new drawing. */
  standard?: DrawingStandard;
  title?: Partial<Record<TitleField, string>>;
  ordinateAbove?: number;
  path?: string;
}

export interface DrawingReport {
  path: string | null;
  pages?: number;
  /** Each page of a drawing of more than one (`sheet`, `views` and the counts below are the first page's). */
  pageSummaries?: { page: number; name: string; sheet: { size: SheetSize; orientation: string; scale: string }; views: { id: Id; name: string; kind: string }[]; dimensions: number; annotations: number }[];
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
  /** The font the PDF and the pictures write with, whether it covers CJK, and what it cannot write (each would come out as 「?」): must be empty when CJK is covered. */
  glyphs: { font: string | null; cjk: boolean; missing: string[] };
  /** Anything drawn outside the frame's area (mm past it). */
  outside: number;
  /** Dimensions the program could not draw, with why. */
  failed: { id: Id; error: string }[];
  coverage: CoverageReport;
  /** Phase 2 view layout rules (ADR 0261, rules 2-1 to 2-9). */
  layout: DrawingLayoutInspection;
  /** Phase 4 quality gate (ADR 0263, rules Q1, Q2, C5, C7, Q3). */
  quality: QualityGateReport;
}

/** A TrueType font for the pictures and the PDF: `DRAWING_FONT` first, then a CJK-capable system font, then a Latin fallback. */
function findFont(): TrueTypeFont | undefined {
  const candidates = [
    process.env.DRAWING_FONT,
    'C:\\Windows\\Fonts\\msjh.ttc',
    'C:\\Windows\\Fonts\\msjh.ttf',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ].filter((p): p is string => !!p);
  let fallback: TrueTypeFont | undefined;
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const loaded = readTrueType(new Uint8Array(readFileSync(p)));
      if (loaded.glyphOf(0x8cab) !== 0) return loaded;
      fallback ??= loaded;
    } catch {
      /* not a TrueType font this can read: the next */
    }
  }
  return fallback;
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
  /** The dimensions each detail view was made for and the view they were on before (ADR 0261): given back when the detail is not made. */
  private detailSources = new Map<Id, { dims: Dimension[]; page: number; view: Id }>();
  path: string | null = null;
  private readonly undoStack: DrawingDoc[] = [];
  /** Lines and features of the part from a direction (and a cut), kept while the part is the same build. */
  private lineCache = new Map<string, ViewLines>();
  private featureCache = new Map<string, ViewFeature[]>();
  private elementCache = new Map<string, Exclude<ReturnType<typeof elementFacts>, { error: string }> | null>();
  private cacheFor: unknown = null;

  constructor(private readonly part: CadSession) {}

  private source() {
    const s = this.part.drawingSource();
    if (!s) throw new AgentError('the part has no body to draw yet: build it (or open a part with a body) first');
    if (this.cacheFor !== s.built) {
      this.lineCache.clear();
      this.featureCache.clear();
      this.elementCache.clear();
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
    const f = viewFeatures(s.body.topology, s.body.names, axes, undefined, holeFeatures(s.doc), s.built.cosmeticThreads, sketchTextPrefixes(s.doc));
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
    const axis = revolutionAxis(this.source().body.topology.faces);
    const ranked = rankMainViews(ORTHO.map((d) => this.stats(d)), axis);
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
    const axis = revolutionAxis(s.body.topology.faces);
    const ranked = rankMainViews(ORTHO.map((d) => this.stats(d)), axis);
    const main = o.main ?? ranked[0]?.direction;
    if (!main || !ORTHO.includes(main)) throw new AgentError(`main must be one of ${ORTHO.join(', ')}`);
    if (o.views) for (const v of o.views) if (!SIDES.includes(v)) throw new AgentError(`views are sides of the main view: ${SIDES.join(', ')}, not ${JSON.stringify(v)}`);
    const rec = this.recommend(main, projection);
    const target = o.path ?? s.path.replace(/\.3dbx$/i, '.3dbd');
    if (!target.toLowerCase().endsWith('.3dbd')) throw new AgentError(`a drawing file name ends in .3dbd, not ${target}`);
    const full = await this.part.inside(target);
    const sourceRel = relative(dirname(full), s.path).split(sep).join('/');

    let doc = createEmptyDrawing();
    doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { projection, orientation: o.orientation ?? 'landscape', dimStyle: { text: 3 }, ...(o.standard ? { standard: o.standard } : {}) } });
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
    const sectionIds: Id[] = [];
    if (wantSection) {
      const mainStats = this.stats(main);
      const advice = rec.section ?? adviseSection({ ...mainStats, hidden: Math.max(mainStats.hidden, mainStats.visible) }, mainStats.width >= mainStats.height ? 'horizontal' : 'vertical')!;
      const box = this.project(viewVectors(main)).box!;
      const pad = 2;
      const makeSection = (label: string, orientation: 'horizontal' | 'vertical', at: number, replaced?: Id) => {
        const line: [[number, number], [number, number]] =
          orientation === 'horizontal' ? [[box.min[0] - pad, at], [box.max[0] + pad, at]] : [[at, box.min[1] - pad], [at, box.max[1] + pad]];
        const id = ids().take('view');
        const section: DrawingView = { id, name: t('drawing.view.section', { label }), kind: 'section', parent: mainId, line, label, centreMarks: true };
        let chosen = section;
        if (replaced) {
          const all = page(doc).views;
          const want = axesOf(all, projection, all.find((v) => v.id === replaced)!)!.dir;
          const got = axesOf([...all, section], projection, section)!.dir;
          if (want.some((x, i) => Math.abs(x - got[i]!) > 1e-6)) chosen = { ...section, flip: true };
          doc = applyDrawingCommand(doc, { type: 'deleteViews', viewIds: [replaced] });
        }
        doc = applyDrawingCommand(doc, { type: 'insertViews', views: [chosen] });
        sectionIds.push(id);
      };
      const replacedA = rec.section?.replaces && sideIds.get(rec.section.replaces);
      makeSection('A', advice.orientation, advice.at, replacedA || undefined);
      // When an orthogonal projected view also hides internal detail (>= 25% hidden lines), turn it into orthogonal section B-B
      if ((o.section ?? 'auto') === 'auto' && replacedA) {
        const otherSide = [...sideIds.entries()].find(([side]) => side !== rec.section!.replaces);
        if (otherSide) {
          const [sideB, idB] = otherSide;
          const stB = this.sidesOf(main, projection).find((x) => x.side === sideB)?.stats;
          const hrB = stB && stB.visible + stB.hidden > 0 ? stB.hidden / (stB.visible + stB.hidden) : 0;
          if (hrB >= 0.25) {
            const orthOrient = advice.orientation === 'vertical' ? 'horizontal' : 'vertical';
            // only where the plan finds a place to cut: without one the cut would be anywhere (0 may be off the part), and the projected view stays
            const orthAdv = adviseSection(mainStats, orthOrient);
            if (orthAdv) makeSection('B', orthOrient, orthAdv.at, idB);
          }
        }
      }
    }

    // Auxiliary view: when an oblique cylindrical hole/boss lies in an orthogonal view's plane, fold an auxiliary view to show it true-shape (#5)
    const obliques = obliqueHoleAxes(s.body.topology);
    if (obliques.length > 0) {
      const usedLabels = new Set(page(doc).views.flatMap((v) => ('label' in v && v.label ? [v.label] : [])));
      const nextLabel = ['A', 'B', 'C', 'D', 'E', 'F'].find((l) => !usedLabels.has(l));
      if (nextLabel) {
        const candidates = page(doc).views.filter((v) => !isDerived(v) || v.kind === 'projected');
        for (const parentView of candidates) {
          const pAxes = axesOf(page(doc).views, projection, parentView);
          const pBox = pAxes ? this.project(pAxes).box : null;
          if (!pAxes || !pBox) continue;
          const adv = adviseAuxiliary(obliques, pAxes, pBox);
          if (!adv) continue;
          const auxId = ids().take('view');
          const aux: DrawingView = { id: auxId, name: t('drawing.view.section', { label: nextLabel }), kind: 'auxiliary', parent: parentView.id, line: adv.line, label: nextLabel, centreMarks: true };
          doc = applyDrawingCommand(doc, { type: 'insertViews', views: [aux] });
          break;
        }
      }
    }

    // title
    const title: Partial<Record<TitleField, string>> = { drawingName: basename(s.path, extname(s.path)), date: new Date().toISOString().slice(0, 10), ...o.title };
    for (const [field, value] of Object.entries(title)) if (field !== 'revision' && value) doc = applyDrawingCommand(doc, { type: 'setTitle', field: field as TitleField, value });
    if (title.revision) doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'revision', value: title.revision });

    // the dimensions that determine the part, main view first, then the sections, then the others
    doc = this.dimensionAll(doc, o.ordinateAbove);

    // Hide interfering dashed hidden lines on views whose internal geometry is already exposed by sections (or when hiddenRatio >= 0.35)
    if (sectionIds.length > 0) {
      const mainSt = this.stats(main);
      const mainHr = mainSt.visible + mainSt.hidden > 0 ? mainSt.hidden / (mainSt.visible + mainSt.hidden) : 0;
      if (mainHr >= 0.35) {
        doc = applyDrawingCommand(doc, { type: 'setView', viewId: mainId, patch: { display: 'hiddenRemoved' } });
      }
      for (const v of page(doc).views) {
        if (v.kind === 'projected') {
          const stV = this.sidesOf(main, projection).find((x) => x.side === v.side)?.stats;
          const hrV = stV && stV.visible + stV.hidden > 0 ? stV.hidden / (stV.visible + stV.hidden) : 0;
          if (hrV >= 0.35) doc = applyDrawingCommand(doc, { type: 'setView', viewId: v.id, patch: { display: 'hiddenRemoved' } });
        }
      }
    }

    // Move micro-fillet/micro-radius dimensions (R < 0.8 mm) into enlarged Detail Views on Page 2 when dense,
    // keeping Page 1 clean and readable while preserving 100% dimension coverage.
    doc = this.offloadMicroDetails(doc, mainId, o);

    // the sheet and the scale: lay out each page cleanly
    const layOutPage = (d0: DrawingDoc, pageIndex: number, sheetOpt: CreateOptions['sheet']) => {
      let d = this.fitWithRoom(d0, { ...o, sheet: sheetOpt }, pageIndex);
      if (pageIndex === 0 && (o.isometric ?? true)) d = this.placeIsometric(d, mainId);
      return this.tidyFitted(d, { ...o, sheet: sheetOpt }, pageIndex);
    };
    let best = layOutPage(doc, 0, o.sheet);
    if (!o.sheet || o.sheet === 'auto') {
      // The fit above found the sheet by way of a smaller one (the views are slid apart for their dimensions, and a sheet that held them before may not now), and what
      // it slid then is not what the views need on the sheet it ended on. Lay the page out again on that sheet, as if it had been asked for (ADR 0261): one layout per sheet.
      best = layOutPage(doc, 0, page(best, 0).sheet.size);
      let score = this.clutter(best, 0);
      const hasIso = (d: DrawingDoc) => page(d, 0).views.some((v) => v.display === 'shadedEdges');
      let isoOk = !(o.isometric ?? true) || hasIso(best);
      const order = AUTO_SHEETS;
      const overfull = (d: DrawingDoc) => {
        const m = this.layout(d, 0);
        return Math.max(m.fillW, m.fillH) > FILL_RANGE[1] + 1e-9;
      };
      for (let i = order.indexOf(page(best, 0).sheet.size) + 1; (score > 0 || !isoOk || overfull(best)) && i > 0 && i < order.length; i++) {
        const next = layOutPage(doc, 0, order[i]);
        const c = this.clutter(next, 0);
        const nextIso = !(o.isometric ?? true) || hasIso(next);
        if (overfull(best) && !overfull(next)) {
          best = next;
          score = c;
          isoOk = nextIso;
        } else if (c < score || (!isoOk && nextIso && c <= score + 5) || (page(best, 0).sheet.size === 'A4' && score > 25 && order[i] === 'A3' && c <= score)) {
          best = next;
          score = c;
          isoOk = nextIso;
        }
      }
    }
    doc = best;
    for (let pi = 1; pi < doc.pages.length; pi++) {
      const hasDetails = page(doc, pi).views.some((v) => v.kind === 'detail');
      const layOut = (sheet: CreateOptions['sheet']): DrawingDoc => {
        let d = this.fitWithRoom(doc, { ...o, sheet }, pi);
        d = enlargeDetails(d, pi);
        // a detail with nothing in it is not made (its dimensions go back), the others go beside the view they enlarge (ADR 0261, rules V4 and V6)
        d = this.dropEmptyDetails(d, pi);
        d = this.placeDetails(d, pi);
        d = this.tidyFitted(d, { ...o, sheet }, pi);
        // the leaders and numbers of the details are only final after tidy and may reach further than the room kept for them: place the details once more with that known
        if (this.layoutFaults(d, pi) > 0) d = this.tidy(this.placeDetails(d, pi), pi, 'keep');
        return d;
      };
      // every page of a drawing is on the same sheet (rule P3, ADR 0261): the first page is laid out already, so the others start from its size
      const allSheets: SheetSize[] = ['A4', 'A3', 'A2', 'A1', 'A0'];
      const autoPaper = !o.sheet || o.sheet === 'auto';
      const autoMaxIdx = autoPaper ? allSheets.indexOf('A3') : allSheets.indexOf(o.sheet as SheetSize);
      const same = page(doc, 0).sheet.size;
      const preferredMaxIdx = Math.max(allSheets.indexOf(same), autoMaxIdx);
      if (!hasDetails) doc = layOut(same);
      else {
        // A page of detail views takes the smallest sheet on which none is crowded — from the first page's size (and not below A3): the views clear of each other,
        // every detail beside its parent with nothing between them, everything inside the area. When no sheet is clean, the one with the fewest faults (the smaller
        // on a tie).
        let pick: { doc: DrawingDoc; faults: number } | null = null;
        let expand = false;
        const firstIndex = Math.min(preferredMaxIdx, Math.max(allSheets.indexOf(same), allSheets.indexOf('A3')));
        for (let index = firstIndex; index < allSheets.length; index++) {
          if (index > preferredMaxIdx && !expand) break;
          const sheet = allSheets[index]!;
          const trial = layOut(sheet);
          const faults = this.layoutFaults(trial, pi);
          if (!pick || faults < pick.faults) pick = { doc: trial, faults };
          if (faults === 0) break;
          // A 1:100 fallback that still fails layout has exhausted the preferred paper size. Auto may use larger paper to fit the geometry and labels.
          if (autoPaper && index === preferredMaxIdx && pick.faults > 0) {
            const [n, d] = page(pick.doc, pi).sheet.scale;
            expand = n === 1 && d === 100;
          }
        }
        doc = pick!.doc;
      }
      // Remove any detail views whose dimensions were all pruned by tidy
      const pgAfter = page(doc, pi);
      const emptyDetails = pgAfter.views
        .filter((v) => v.kind === 'detail' && !pgAfter.dimensions.some((d) => d.view === v.id))
        .map((v) => v.id);
      if (emptyDetails.length) {
        doc = onPage(doc, pi, (st) => applyDrawingCommand(st, { type: 'deleteViews', viewIds: emptyDetails }));
      }
    }

    // Every page on the largest sheet any page took (rule 2-6, ADR 0261). The pages after the first start from its size, so only the first can be the smaller one: when
    // a section was moved to page 2 it is left with the main view and the isometric. It is laid out again on that sheet, its isometric put in place again.
    const bySize: SheetSize[] = ['A4', 'A3', 'A2', 'A1', 'A0'];
    const biggest = bySize[Math.max(...doc.pages.map((_, i) => bySize.indexOf(page(doc, i).sheet.size)))]!;
    if (page(doc, 0).sheet.size !== biggest) {
      const iso = page(doc, 0).views.filter((v) => isDerived(v) && v.display === 'shadedEdges').map((v) => v.id);
      const bare = iso.length ? onPage(doc, 0, (st) => applyDrawingCommand(st, { type: 'deleteViews', viewIds: iso })) : doc;
      doc = layOutPage(bare, 0, biggest);
    }

    for (let i = 0; i < doc.pages.length; i++) doc = this.keepInsideSheet(doc, i);

    this.undoStack.length = 0;
    this.doc = doc;
    this.path = full;
    await this.save();
    return { report: this.report(), plan: rec };
  }

  /** The views of `doc` as the dimension graph reads them: the main view first, the sections next (inside is drawn solid there), then the rest. */
  private dimensionViews(doc: DrawingDoc, allPages = false): ViewToDimension[] {
    const out: ViewToDimension[] = [];
    const pages = allPages ? doc.pages : [page(doc)];
    for (const pg of pages) {
      for (const v of pg.views) {
        if (v.kind === 'crop' || v.kind === 'sectionLocal') continue;
        if (!allPages && v.kind === 'detail') continue;
        if (v.kind === 'projected' && (v.side === 'upLeft' || v.side === 'upRight' || v.side === 'downLeft' || v.side === 'downRight')) continue;
        if (!isDerived(v) && v.direction === 'isometric') continue;
        const targetView = v.kind === 'detail' ? pg.views.find((x) => x.id === v.parent) : v;
        if (!targetView) continue;
        const axes = axesOf(pg.views, pg.sheet.projection, targetView);
        if (!axes || (targetView.kind !== 'auxiliary' && !this.directionOf(axes))) continue;
        const features = this.featuresFor(axes);
        const lines = targetView.kind === 'section'
          ? this.project(axes, sectionPlane(axesOf(pg.views, pg.sheet.projection, pg.views.find((x) => x.id === targetView.parent)!)!, targetView))
          : this.project(axes);
        out.push({ viewId: v.id, axes, features, lines, hidden: hiddenFeatures(features, lines), ...(targetView.kind === 'section' ? { section: true } : {}) });
      }
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
    const draft = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions });
    const { placed, outcomes } = this.build(draft);
    const commands: DrawingCommand[] = [];
    const detached: Id[] = [];
    const leadered: Id[] = [];
    for (const d of dimensions) {
      if (d.kind !== 'angle') continue;
      const view = placed.get(d.view);
      const result = outcomes.get(d.id);
      if (!view || !result || 'error' in result || result.handle?.kind !== 'angle') continue;
      const [x, y] = result.handle.centre;
      // An intersection of extended lines can lie far from either real feature.
      const outsideX = Math.max(0, Math.abs(x - view.at[0]) - view.w / 2);
      const outsideY = Math.max(0, Math.abs(y - view.at[1]) - view.h / 2);
      const acute = Math.min(result.value, 180 - result.value);
      const supplementary = result.value > 120 ? { supplementary: true } : {};
      if (acute >= 87) {
        detached.push(d.id);
      } else if (Math.hypot(outsideX, outsideY) > 8 * view.scale) {
        // a small slant meets its plane far off the view (1°–8° drafts of R1-10226: 12–279 mm): written with a leader from the slant, not dropped (ADR 0266)
        commands.push({ type: 'setDimension', dimensionId: d.id, patch: { leader: LEADER_ANGLE_LENGTH, angle: 45, ...supplementary } });
        leadered.push(d.id);
      } else if (result.value > 120) {
        commands.push({ type: 'setDimension', dimensionId: d.id, patch: { supplementary: true } });
      }
    }
    if (detached.length) commands.push({ type: 'deleteDimensions', dimensionIds: detached });
    if (!commands.length) return draft;
    const done = applyDrawingCommand(draft, { type: 'batch', commands });
    if (!leadered.length) return done;
    // each leader points away from the middle of its view, where the slant is, so that its text is off the part
    const again = this.build(done);
    const turns: DrawingCommand[] = [];
    for (const id of leadered) {
      const d = page(done).dimensions.find((x) => x.id === id);
      const view = d && again.placed.get(d.view);
      const result = again.outcomes.get(id);
      if (!view || !result || 'error' in result || result.handle?.kind !== 'round') continue;
      const [tx, ty] = result.handle.centre;
      const away = Math.atan2(ty - view.at[1], tx - view.at[0]);
      // the nearer of the four diagonals: a leader at 45° off the axes clears the view's lines
      const angle = ((Math.floor((away * 180) / Math.PI / 90) * 90 + 45) % 360 + 360) % 360;
      if (angle !== 45) turns.push({ type: 'setDimension', dimensionId: id, patch: { angle } });
    }
    return turns.length ? applyDrawingCommand(done, { type: 'batch', commands: turns }) : done;
  }

  /**
   * The sheet and the scale of a page, with room between its views: fitted, the views slid apart for the dimensions between them (`clearViews`), and fitted again,
   * since the slides widen the arrangement and a sheet or scale that held it before may not hold it now (ADR 0261).
   */
  private fitWithRoom(doc: DrawingDoc, o: CreateOptions, pageIndex = 0): DrawingDoc {
    const fitted = this.fitSheet(doc, o, pageIndex);
    const cleared = this.clearViews(fitted, pageIndex);
    return cleared === fitted ? fitted : this.fitSheet(cleared, o, pageIndex);
  }

  private fitSheet(doc: DrawingDoc, o: CreateOptions, pageIndex = 0): DrawingDoc {
    const orientation = o.orientation ?? 'landscape';
    const tryOn = (size: SheetSize) => {
      const d = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setSheet', sheet: { size, orientation } }));
      const b = this.build(d, pageIndex);
      const single = drawingPageForOutput(d, pageIndex);
      // Keep the base views of ordinary parts at 2:1 or below. Detail views have their own scale.
      const spans = [...b.lines.values()].flatMap((lines) => {
        const box = lines?.box;
        return box ? [box.max[0] - box.min[0], box.max[1] - box.min[1]] : [];
      });
      const maxRatio = spans.some((span) => span >= 35) ? 2 : Infinity;
      return { d, fit: fitViews(single, b.lines, b.elements, b.features, undefined, maxRatio) };
    };
    let chosen: { d: DrawingDoc; fit: ReturnType<typeof fitViews> } | null = null;
    if (o.sheet && o.sheet !== 'auto') chosen = tryOn(o.sheet);
    else {
      for (const size of AUTO_SHEETS) {
        const c = tryOn(size);
        if (c.fit && ratio(c.fit.scale) >= 1) {
          chosen = c;
          break;
        }
      }
      chosen ??= tryOn('A3');
    }
    const scale = o.scale ?? chosen.fit?.scale;
    return onPage(chosen.d, pageIndex, (s) => applyDrawingCommand(s, { type: 'setSheet', sheet: { ...(scale ? { scale } : {}), shift: o.scale ? null : chosen.fit?.shift ?? null } }));
  }

  /**
   * The isometric, shaded with its edges, in the largest free corner of the area beside what the other views draw, at the sheet's scale or the largest
   * standard one that fits there. Left out (and said so in the report) when no corner takes it at a quarter of the sheet's scale.
   */
  private placeIsometric(doc: DrawingDoc, mainId: Id): DrawingDoc {
    const pg = page(doc);
    const b = this.build(doc);
    const used = itemsBounds(b.scene.items.slice(sheetItems(doc).length));
    const area = drawingSheetMetrics(doc).area;
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

  /**
   * `tidy`, and the page fitted again where it left the drawing beyond the area of the sheet: what tidy does after the fit (a caption moved under the rows of
   * dimensions, a view slid for them) can widen the arrangement, and a scale that held it before may not hold it now (ADR 0261). At most twice.
   */
  private tidyFitted(doc: DrawingDoc, o: CreateOptions, pageIndex = 0): DrawingDoc {
    let d = this.tidy(doc, pageIndex);
    for (let i = 0; i < 2; i++) {
      const m = this.layout(d, pageIndex);
      if (m.fillW <= 1 + 1e-9 && m.fillH <= 1 + 1e-9) break;
      d = this.tidy(this.fitSheet(d, o, pageIndex), pageIndex);
    }
    return d;
  }

  /** Tidy can move the final arrangement past a sheet edge, even if its total span still fits. */
  private keepInsideSheet(doc: DrawingDoc, pageIndex: number): DrawingDoc {
    const pg = page(doc, pageIndex);
    const single = drawingPageForOutput(doc, pageIndex);
    const bounds = itemsBounds(this.build(doc, pageIndex).scene.items.slice(sheetItems(single).length));
    if (!bounds) return doc;
    const { area } = drawingSheetMetrics(single);
    const pushInside = (low: number, high: number, start: number, span: number) => {
      if (high - low > span) return 0;
      return Math.max(start - low, Math.min(0, start + span - high));
    };
    const dx = pushInside(bounds.x0, bounds.x1, area.x, area.w);
    const dy = pushInside(bounds.y0, bounds.y1, area.y, area.h);
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return doc;
    const [sx, sy] = pg.sheet.shift ?? [0, 0];
    const commands: DrawingCommand[] = [{ type: 'setSheet', sheet: { shift: [sx + dx, sy + dy] } }];
    for (const v of pg.views) {
      if (v.at) commands.push({ type: 'setView', viewId: v.id, patch: { at: [v.at[0] + dx, v.at[1] + dy] } });
    }
    return onPage(doc, pageIndex, (st) => applyDrawingCommand(st, { type: 'batch', commands }));
  }

  /** Takes out what cannot be drawn, and lays the rows out again (the shortest nearest, as SolidWorks's Auto Arrange). */
  private tidy(doc: DrawingDoc, pageIndex = 0, room: 'refit' | 'keep' = 'refit'): DrawingDoc {
    let b = this.build(doc, pageIndex);
    // A manually placed intersection can recover after its model is repaired. Keep its references and report the failure.
    const intersections = new Set(page(doc, pageIndex).dimensions.filter(d => dimensionRefs(d).some(ref => ref.crossing)).map(d => d.id));
    const failed = [...b.outcomes].filter(([id, o]) => 'error' in o && !intersections.has(id)).map(([id]) => id);
    if (failed.length) {
      doc = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'deleteDimensions', dimensionIds: failed }));
      b = this.build(doc, pageIndex);
    }
    const dims = page(doc, pageIndex).dimensions;
    // rows twice the text height apart (7 mm for ISO's 3.5 mm text, ISO 129-1), the first a little further: larger text, wider rows
    const h = page(doc, pageIndex).sheet.dimStyle?.text ?? 3.5;
    const changes = arrangeDimensions(dims, b.outcomes, new Set(dims.map((d) => d.id)), { first: Math.max(10, Math.round(h * (10 / 3.5) * 10) / 10), step: Math.max(7, h * 2) });
    if (changes.length) doc = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'batch', commands: changes.map((c) => ({ type: 'setDimension', dimensionId: c.id, patch: c.patch }) satisfies DrawingCommand) }));
    // room first (views apart, leaders turned), and only then a number slid along its line — a last resort, since it belongs in the middle (ISO 129-1)
    doc = this.placeCaptions(this.steerLeaders(this.spreadViews(this.steerLeaders(this.spreadViews(doc, pageIndex), false, pageIndex), pageIndex), true, pageIndex), pageIndex);
    const afterFailed = [...this.build(doc, pageIndex).outcomes].filter(([id, o]) => 'error' in o && !intersections.has(id)).map(([id]) => id);
    if (afterFailed.length) doc = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'deleteDimensions', dimensionIds: afterFailed }));
    // and last, whatever the clutter steps did: the views are as far apart as the dimensions between them need (measured, not guessed), then any dirty caption is cleared
    return this.placeCaptions(this.clearViews(doc, pageIndex, room === 'keep'), pageIndex, true);
  }

  /**
   * Moves a view's caption that something crosses (the extension lines of the dimensions under the view, as a rule) to where nothing does: further down,
   * under the rows of dimensions, or over the view. The caption is only moved, never changed.
   */
  private placeCaptions(doc: DrawingDoc, pageIndex = 0, onlyDirty = false): DrawingDoc {
    let score = this.clutter(doc, pageIndex);
    const captionTexts = (d: DrawingDoc) => {
      const b0 = this.build(d, pageIndex);
      const single0 = drawingPageForOutput(d, pageIndex);
      const items0 = b0.scene.items.slice(sheetItems(single0).length);
      const cl0 = clutterOf(items0, CLEARANCE, viewsOfDimensions(single0));
      const caps = new Set(b0.scene.items.flatMap((i) => (i.kind === 'text' && i.viewCaption ? [i.text] : [])));
      return { b0, capClutter: new Set(cl0.texts.filter((x) => caps.has(x))) };
    };
    let { b0: b, capClutter } = captionTexts(doc);
    for (const v of page(doc, pageIndex).views) {
      const own = b.placed.get(v.id);
      if (!own) continue;
      // as drafters do: under everything drawn for the view (its dimensions with it) — kept whenever it makes nothing worse
      const dimIds = new Set(page(doc, pageIndex).dimensions.filter((d) => d.view === v.id).map((d) => d.id));
      const below = itemsBounds(b.scene.items.filter((i) => i.group !== undefined && dimIds.has(i.group) && i.kind === 'polyline'));
      const auto = own.at[1] - own.h / 2 - 8; // where the caption's baseline is by default (viewCaptionItem)
      const first: [number, number] | null = below && below.y0 < auto + 6 ? [0, Math.round((below.y0 - 8 - auto) * 10) / 10] : null;
      const ownCapText = b.scene.items.find((i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text' && i.viewCaption === v.id)?.text;
      const attempt = (offset: [number, number], keepEqual: boolean) => {
        const trial = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setView', viewId: v.id, patch: { caption: { ...(v.caption ?? {}), offset } } }));
        const c = this.clutter(trial, pageIndex);
        const frame = sheetMetrics(page(trial, pageIndex).sheet).area;
        const capY = auto + offset[1];
        if (capY < frame.y - 2) return false; // never into the title block's row
        const nextCaps = captionTexts(trial).capClutter;
        const clearsCap = ownCapText !== undefined && capClutter.has(ownCapText) && !nextCaps.has(ownCapText);
        if (c < score || (keepEqual && c === score) || (clearsCap && c <= score + 1)) {
          doc = trial;
          score = c;
          capClutter = nextCaps;
          return true;
        }
        return false;
      };
      const ownDirty = ownCapText !== undefined && capClutter.has(ownCapText);
      if (onlyDirty && !ownDirty) continue;
      if (first && attempt(first, true) && score === 0) continue;
      if (score === 0 && !ownDirty) continue;
      const tries: [number, number][] = [];
      for (let k = 7; k <= 70; k += 7) tries.push([0, (first?.[1] ?? 0) - k]);
      tries.push([0, own.h + 14], [0, own.h + 24], [-24, 0], [24, 0], [-24, own.h + 14], [24, own.h + 14], [-40, 0], [40, 0]);
      if (onlyDirty && ownDirty && v.caption?.offset) {
        const [x, y] = v.caption.offset;
        for (const dy of [-14, -7, 7, 14]) tries.push([x, y + dy]);
      }
      // the best of them all, not the first that helps: a little lower may help a little where over the view clears it
      let pick: { offset: [number, number]; c: number; clears: boolean } | null = null;
      for (const offset of tries) {
        const auto2 = auto + offset[1];
        if (auto2 < sheetMetrics(page(doc, pageIndex).sheet).area.y - 2) continue;
        const trial = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setView', viewId: v.id, patch: { caption: { ...(v.caption ?? {}), offset } } }));
        const c = this.clutter(trial, pageIndex);
        const clears = ownCapText !== undefined && capClutter.has(ownCapText) && !captionTexts(trial).capClutter.has(ownCapText);
        if (!pick || (clears && !pick.clears) || (clears === pick.clears && c < pick.c)) pick = { offset, c, clears };
      }
      if (pick && (pick.c < score || pick.clears)) attempt(pick.offset, true);
    }
    return doc;
  }

  /** How far `doc` is from a clean sheet: what `clutterOf` counts, plus a penalty for out-of-frame items or broken dimensions. */
  private clutterInfo(doc: DrawingDoc, pageIndex = 0, built?: Built): { score: number; groups: Set<string>; failed: number } {
    const b = built ?? this.build(doc, pageIndex);
    const failed = [...b.outcomes.values()].filter((o) => 'error' in o).length;
    const pg = page(doc, pageIndex);
    const single = drawingPageForOutput(doc, pageIndex);
    const items = b.scene.items.slice(sheetItems(single).length);
    const frame = sheetMetrics(pg.sheet).frame;
    const drawn = itemsBounds(items);
    const outside = drawn ? Math.max(0, frame.x - drawn.x0, drawn.x1 - (frame.x + frame.w), frame.y - drawn.y0, drawn.y1 - (frame.y + frame.h)) : 0;
    const c = clutterOf(items, CLEARANCE, viewsOfDimensions(single));
    const dimIds = new Set(pg.dimensions.map((d) => d.id));
    const overlaps = overlappingDimensions(items, dimIds);
    return { score: c.count + overlaps * 10 + (outside > 0.05 ? 100 : 0), groups: new Set(c.groups ?? []), failed };
  }

  private clutter(doc: DrawingDoc, pageIndex = 0): number {
    return this.clutterInfo(doc, pageIndex).score;
  }

  /**
   * Slides projected and section views away from their parents (along the line they are in line on) where the rows of dimensions between them do not fit,
   * as a drafter leaves more room between views: by 5 mm steps, the smallest slide that leaves the sheet least cluttered.
   */
  private spreadViews(doc: DrawingDoc, pageIndex = 0): DrawingDoc {
    let score = this.clutter(doc, pageIndex);
    for (let pass = 0; pass < 2 && score > 0; pass++)
      for (const v of page(doc, pageIndex).views) {
        if (score === 0) break;
        if (v.kind !== 'projected' && v.kind !== 'section') continue;
        if (v.kind === 'projected' && (v.side === 'upLeft' || v.side === 'upRight' || v.side === 'downLeft' || v.side === 'downRight')) continue;
        if (v.at) continue;
        let pick: { doc: DrawingDoc; c: number } | null = null;
        for (const step of [5, 10, 15, 20, 25, 30, 40]) for (const sign of [1, -1]) {
          try {
            const trial = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setView', viewId: v.id, patch: { slide: (v.slide ?? 0) + sign * step } }));
            const c = this.clutter(trial, pageIndex);
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
   * Slides views apart until the clear space between every two of them, counting the dimensions and the caption drawn for each, is at least twice the dimension
   * text (`minViewClearance`, drawing rule V1, ADR 0261). Unlike `spreadViews` it works from the measured space (`layout`), not from a clutter score: the worst pair
   * first, the view that can slide (a projected or section view without a place of its own) along the axis the two are side by side on, away from the other, by
   * just what is missing. Slides are the document's own (`DrawingView.slide`), so the user can change them afterwards. A pair with no view that can slide that
   * way is left as it is. With `keepInside` (the edits of a drawing that is made) a slide that would take the drawing beyond the sheet is not made.
   */
  private clearViews(doc: DrawingDoc, pageIndex = 0, keepInside = false): DrawingDoc {
    const need = minViewClearance(resolveDimStyle(baseDimStyle(page(doc, pageIndex).sheet)).text);
    const short = (m: LayoutMetrics) => m.clearances.filter((c) => c.gap < need - 1e-6);
    for (let i = 0; i < 24; i++) {
      const m = this.layout(doc, pageIndex);
      let next: DrawingDoc | null = null;
      for (const c of short(m)) {
        next = this.slideApart(doc, pageIndex, m, c, need);
        if (next) break;
      }
      if (!next) break;
      // an edit of a drawing that is made does not change its sheet or its scale: the views are parted only as far as the sheet still holds them
      if (keepInside) {
        const after = this.layout(next, pageIndex);
        if ((after.fillW > 1 + 1e-9 && after.fillW > m.fillW + 1e-9) || (after.fillH > 1 + 1e-9 && after.fillH > m.fillH + 1e-9)) break;
      }
      doc = next;
    }
    return doc;
  }

  /** `doc` with one view of the pair `c` slid away from the other by what is missing, or null when neither can slide along the axis the pair needs. */
  private slideApart(doc: DrawingDoc, pageIndex: number, m: LayoutMetrics, c: Clearance, need: number): DrawingDoc | null {
    const pg = page(doc, pageIndex);
    const single: DrawingDoc = { ...doc, pages: [pg] };
    const box = (id: Id) => m.views.find((x) => x.id === id)!.drawn;
    const centre = (id: Id, axis: 0 | 1) => (axis === 0 ? (box(id).x0 + box(id).x1) / 2 : (box(id).y0 + box(id).y1) / 2);
    // the child first: a view slid off its parent keeps what hangs on it, and the parent keeps the arrangement still
    const pair = [c.a, c.b].map((id) => pg.views.find((v) => v.id === id)!).sort((p, q) => Number(isDerived(q)) - Number(isDerived(p)));
    for (const v of pair) {
      const other = v.id === c.a ? c.b : c.a;
      if (v.at || (v.kind !== 'projected' && v.kind !== 'section')) continue;
      if (v.kind === 'projected' && (v.side === 'upLeft' || v.side === 'upRight' || v.side === 'downLeft' || v.side === 'downRight')) continue;
      const axis = slideAxis(single, v);
      if (axis === null) continue;
      // a pair side by side is parted along x, one above the other along y; boxes that overlap either way, along the axis this view slides on
      if ((c.axis === 'x' && axis !== 0) || (c.axis === 'y' && axis !== 1)) continue;
      const missing = need - (axis === 0 ? c.gx : c.gy);
      if (missing <= 1e-6) continue;
      const dir = centre(v.id, axis) >= centre(other, axis) ? 1 : -1;
      const slide = Math.round(((v.slide ?? 0) + dir * (missing + 0.5)) * 10) / 10;
      try {
        return onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setView', viewId: v.id, patch: { slide } }));
      } catch {
        /* a view that does not slide */
      }
    }
    return null;
  }

  /**
   * Whether every arrowhead of dimension `dimId` on page `pageIndex` lands within `tol` mm of its view's drawn geometry (and inside the detail circle when the view
   * is a detail view, ADR 0262 rules D6 and D7).
   */
  private arrowHitsView(built: Built, pg: DrawingPage, dimId: Id, tol?: number, allowHidden = false): boolean {
    const dim = pg.dimensions.find((x) => x.id === dimId);
    if (!dim) return false;
    const outcome = built.outcomes.get(dimId);
    if (!outcome || 'error' in outcome) return false;
    const v = pg.views.find((x) => x.id === dim.view);
    const placed = built.placed.get(dim.view);
    if (!v || !placed) return false;
    const effTol = tol ?? Math.max(0.2, Math.min(0.6, 0.03 * ratio(v.scale ?? pg.sheet.scale)));
    const tips: [number, number][] = [];
    const polys: number[][] = [];
    for (const item of built.scene.items) {
      if (item.kind !== 'polyline') continue;
      if (item.filled && item.group === dimId && item.points.length >= 2) tips.push([item.points[0]!, item.points[1]!]);
      else if (!item.filled && item.owner === `view:${dim.view}` && (item.style === 'visible' || item.style === 'thin' || (allowHidden && item.style === 'hidden'))) polys.push(item.points);
    }
    if (tips.length === 0) return false;
    if (polys.length === 0) return true;
    const rSheet = placed.w / 2;
    const effTol2 = effTol * effTol;
    for (const [tx, ty] of tips) {
      if (v.kind === 'detail' && Math.hypot(tx - placed.at[0], ty - placed.at[1]) > rSheet + 0.5) return false;
      let hit = false;
      for (const poly of polys) {
        for (let k = 0; k + 3 < poly.length; k += 2) {
          const ax = poly[k]!, ay = poly[k + 1]!, bx = poly[k + 2]!, by = poly[k + 3]!;
          if (tx < (ax < bx ? ax : bx) - effTol || tx > (ax > bx ? ax : bx) + effTol || ty < (ay < by ? ay : by) - effTol || ty > (ay > by ? ay : by) + effTol) continue;
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
          const t = l2 > 1e-18 ? Math.max(0, Math.min(1, ((tx - ax) * dx + (ty - ay) * dy) / l2)) : 0;
          const ex = tx - (ax + t * dx), ey = ty - (ay + t * dy);
          if (ex * ex + ey * ey <= effTol2) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) return false;
    }
    return true;
  }

  /**
   * Turns the leader of each diameter and radius dimension (and lengthens it) to where its text crosses nothing and its arrow lands on the drawn geometry
   * (ADR 0262 rules D5, D6, D7), as a drafter swings a callout into free room: the turn that leaves the sheet least cluttered, the one it has when none is
   * better. A linear dimension's text is slid along its line likewise.
   */
  private steerLeaders(doc: DrawingDoc, slideNumbers = true, pageIndex = 0): DrawingDoc {
    // First snap any round dimension whose initial leader angle misses the drawn arc (e.g. a split or trimmed cylinder) onto an angle that hits the geometry,
    // snap any obtuse angle dimension (> 90°) to its acute supplementary angle, and ensure concentric round leaders clear the outermost concentric circle.
    let b0 = this.build(doc, pageIndex);
    let pg0 = page(doc, pageIndex);
    const candidateAngles = [45, 135, 225, 315, 30, 60, 120, 150, 210, 240, 300, 330, 15, 75, 105, 165, 195, 255, 285, 345, 0, 90, 180, 270];
    const fineAngles = Array.from({ length: 72 }, (_, i) => i * 5).filter((a) => a % 15 !== 0);
    for (const d of pg0.dimensions) {
      if (d.kind === 'angle') {
        const out = b0.outcomes.get(d.id);
        if (out && !('error' in out) && out.value > 90 + 1e-6) {
          try {
            const trial = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setDimension', dimensionId: d.id, patch: { supplementary: !d.supplementary } }));
            const bt = this.build(trial, pageIndex);
            const tout = bt.outcomes.get(d.id);
            if (tout && !('error' in tout) && tout.value <= 90 + 1e-6) {
              doc = trial;
              b0 = bt;
              pg0 = page(doc, pageIndex);
            }
          } catch {
            /* ignore */
          }
        }
      }
    }
    // Fan concentric round dimensions across distinct radial angles and extend inner circle leaders outside the outer concentric boundary
    const roundGroups = new Map<string, { id: Id; r: number }[]>();
    for (const d of pg0.dimensions) {
      if (d.kind !== 'diameter' && d.kind !== 'radius' && d.kind !== 'chamfer') continue;
      const out = b0.outcomes.get(d.id);
      if (!out || 'error' in out || out.handle?.kind !== 'round') continue;
      const key = `${d.view}|${Math.round(out.handle.centre[0])}|${Math.round(out.handle.centre[1])}`;
      roundGroups.set(key, [...(roundGroups.get(key) ?? []), { id: d.id, r: out.handle.radius }]);
    }
    for (const grp of roundGroups.values()) {
      if (grp.length <= 1) continue;
      const maxR = Math.max(...grp.map((g) => g.r));
      grp.sort((a, b) => a.r - b.r);
      grp.forEach((g, idx) => {
        const minLeader = Math.max(8, Math.ceil(maxR - g.r + 8));
        const fanAngle = candidateAngles[idx % candidateAngles.length]!;
        try {
          const trial = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setDimension', dimensionId: g.id, patch: { angle: fanAngle, leader: minLeader } }));
          const bt = this.build(trial, pageIndex);
          if (this.arrowHitsView(bt, page(trial, pageIndex), g.id)) {
            doc = trial;
            b0 = bt;
            pg0 = page(doc, pageIndex);
          }
        } catch {
          /* ignore */
        }
      });
    }
    for (const d of pg0.dimensions) {
      if (d.kind !== 'diameter' && d.kind !== 'radius' && d.kind !== 'chamfer') continue;
      if (this.arrowHitsView(b0, pg0, d.id)) continue;
      const v0 = pg0.views.find((x) => x.id === d.view);
      const placed0 = b0.placed.get(d.view);
      const out0 = b0.outcomes.get(d.id);
      if (v0?.kind === 'detail' && placed0 && out0 && !('error' in out0) && out0.handle?.kind === 'round') {
        const dist = Math.hypot(out0.handle.centre[0] - placed0.at[0], out0.handle.centre[1] - placed0.at[1]);
        if (Math.abs(dist - out0.handle.radius) > placed0.w / 2 + 0.5) continue;
      }
      for (const angle of [d.angle, ...candidateAngles, ...fineAngles]) {
        try {
          const trial = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setDimension', dimensionId: d.id, patch: { angle } }));
          const bt = this.build(trial, pageIndex);
          if (this.arrowHitsView(bt, page(trial, pageIndex), d.id)) {
            doc = trial;
            b0 = bt;
            pg0 = page(doc, pageIndex);
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }

    let info = this.clutterInfo(doc, pageIndex, this.build(doc, pageIndex));
    if (info.score === 0) return doc;
    const baseFailed = info.failed;
    const try_ = (patch: Extract<DrawingCommand, { type: 'setDimension' }>['patch'], id: Id, requireHit: boolean, onMiss?: () => void): boolean => {
      try {
        const trial = onPage(doc, pageIndex, (s) => applyDrawingCommand(s, { type: 'setDimension', dimensionId: id, patch }));
        const bt = this.build(trial, pageIndex);
        if (requireHit && !this.arrowHitsView(bt, page(trial, pageIndex), id)) {
          onMiss?.();
          return false;
        }
        const next = this.clutterInfo(trial, pageIndex, bt);
        if (next.failed > baseFailed) return false;
        if (next.score < info.score) {
          doc = trial;
          info = next;
          return true;
        }
      } catch {
        /* a patch the dimension does not take */
      }
      return false;
    };
    // passes until one changes nothing: only steer dimensions actually involved in clutter
    for (let pass = 0; pass < 3 && info.score > 0; pass++) {
      const before = info.score;
      const targets = new Set(info.groups);
      for (const d of page(doc, pageIndex).dimensions) {
        if (info.score === 0) break;
        if (!targets.has(d.id)) continue;
        // an angle written with a leader (ADR 0266) is steered as a chamfer is: its leader's direction and length
        if (d.kind === 'diameter' || d.kind === 'radius' || d.kind === 'chamfer' || (d.kind === 'angle' && d.angle !== undefined)) {
          const dAngle = d.angle!;
          const hitsNow = this.arrowHitsView(this.build(doc, pageIndex), page(doc, pageIndex), d.id);
          // longer leaders last: at a large scale (or with large text) the part is wider on the sheet than the first four reach across (ADR 0261)
          // Always allow rotating to candidateAngles even when !hitsNow (requireHit=hitsNow prevents degrading a hitting arrow while letting chamfers/rounds uncross).
          const angles = [dAngle, ...candidateAngles.filter((a) => Math.abs(a - dAngle) > 1e-3)];
          const missedAngles = new Set<number>();
          outer: for (const leader of [8, 14, 22, 32, 46, 64]) {
            for (const angle of angles) {
              if (missedAngles.has(angle)) continue;
              if (try_({ angle, leader }, d.id, hitsNow, () => missedAngles.add(angle)) && !info.groups.has(d.id)) break outer;
            }
          }
        } else if (d.kind === 'angle') {
          const baseArc = d.arc || 12;
          const baseSupp = Boolean(d.supplementary);
          const curOut = this.build(doc, pageIndex).outcomes.get(d.id);
          const canFlip = curOut && !('error' in curOut) && curOut.value > 90 + 1e-6;
          const suppCandidates = canFlip ? [baseSupp, !baseSupp] : [baseSupp];
          outerAngle: for (const supplementary of suppCandidates) {
            for (const arc of [baseArc, 4, 8, 14, 22]) {
              const slides = slideNumbers ? [0, -6, 6] : [0];
              for (const slide of slides) {
                if (supplementary === baseSupp && arc === baseArc && slide === (d.slide ?? 0)) continue;
                if (try_({ supplementary, arc, ...(slide === 0 ? { slide: null } : { slide }) }, d.id, false) && !info.groups.has(d.id)) break outerAngle;
              }
            }
          }
        } else if (d.kind === 'linear') {
          const h = page(doc, pageIndex).sheet.dimStyle?.text ?? 3.5;
          const spacing = { first: Math.max(10, Math.round(h * (10 / 3.5) * 10) / 10), step: Math.max(7, h * 2) };
          const offsets = linearOffsetCandidates(d.offset, spacing);
          outerLinear: for (const offset of offsets) {
            const slides = slideNumbers ? [0, -6, 6, -12, 12, -20, 20, -32, 32] : [0];
            for (const slide of slides) {
              if (Math.abs(offset - d.offset) < 1e-6 && slide === (d.slide ?? 0)) continue;
              if (try_({ offset, ...(slide === 0 ? { slide: null } : { slide }) }, d.id, false) && !info.groups.has(d.id)) break outerLinear;
            }
          }
        } else if (d.kind === 'ordinate') {
          const h = page(doc, pageIndex).sheet.dimStyle?.text ?? 3.5;
          const spacing = { first: Math.max(10, Math.round(h * (10 / 3.5) * 10) / 10), step: Math.max(7, h * 2) };
          for (const offset of linearOffsetCandidates(d.offset, spacing)) {
            if (Math.abs(offset - d.offset) < 1e-6) continue;
            if (try_({ offset }, d.id, false) && !info.groups.has(d.id)) break;
          }
        }
      }
      if (info.score >= before) break;
    }
    return doc;
  }

  /**
   * Moves micro-fillet/micro-radius dimensions (R < 0.8 mm) and secondary section B-B onto Page 2 with enlarged Detail Views
   * so Page 1 remains uncluttered and readable while preserving 100% dimension coverage.
   */
  private offloadMicroDetails(doc: DrawingDoc, mainId: Id, o: CreateOptions): DrawingDoc {
    this.detailSources.clear();
    const s = this.source();
    const pg0 = page(doc, 0);
    const getFacts = (r: Parameters<typeof elementFacts>[2]) => {
      const key = JSON.stringify(r);
      if (this.elementCache.has(key)) return this.elementCache.get(key)!;
      const f = r.kind === 'sketch' ? drawingSketchFacts(s.built.sketches, r) : elementFacts(s.body.topology, s.body.names, r, holeFeatures(s.doc), s.built.cosmeticThreads);
      const val = 'error' in f ? null : f;
      this.elementCache.set(key, val);
      return val;
    };
    const microDims = pg0.dimensions.filter((d) => {
      if (d.kind !== 'radius' && d.kind !== 'diameter') return false;
      const els = dimensionRefs(d).map(getFacts);
      const e = els[0];
      return e && 'radius' in e && typeof e.radius === 'number' && e.radius < 0.8;
    });
    const secB = pg0.views.find((v) => v.kind === 'section' && v.label === 'B');
    if (microDims.length < 4 && !secB) return doc;

    const mainView = pg0.views.find((v) => v.id === mainId);
    if (!mainView || isDerived(mainView)) return doc;

    // Add Page 2
    doc = applyDrawingCommand(doc, { type: 'insertPage', page: { name: t('drawing.page.sectionsAndDetails') } });
    const alloc = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const base2Id = alloc.take('view');
    // the main view drawn again as the parent of what was moved here: its caption says it is the first page's view (ADR 0261, rule 2-6)
    const base2: DrawingView = { id: base2Id, name: t('drawing.view.reference', { name: mainView.name }), source: mainView.source, direction: mainView.direction, ...(mainView.display ? { display: mainView.display } : {}) };
    doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'insertViews', views: [base2] }));

    // Move B-B to Page 2 (re-parented to base2Id)
    let secB2Id: Id | null = null;
    if (secB && secB.kind === 'section') {
      secB2Id = alloc.take('view');
      const secB2: DrawingView = { ...secB, id: secB2Id, parent: base2Id };
      const secBDims = pg0.dimensions.filter((d) => d.view === secB.id);
      doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'insertViews', views: [secB2] }));
      if (secBDims.length) {
        doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'insertDimensions', dimensions: secBDims.map((d) => ({ ...d, view: secB2Id! })) }));
        doc = onPage(doc, 0, (st) => applyDrawingCommand(st, { type: 'deleteDimensions', dimensionIds: secBDims.map((d) => d.id) }));
      }
      doc = onPage(doc, 0, (st) => applyDrawingCommand(st, { type: 'deleteViews', viewIds: [secB.id] }));
    }

    // Move A-A to Page 2 too (not a copy: a section letter is used once in a drawing, ADR 0261 rule 2-6) if A-A has >= 2 micro-radii, so its Detail Views live beside it
    const secA = pg0.views.find((v) => v.kind === 'section' && v.label === 'A');
    const secAMicroCount = secA ? pg0.dimensions.filter((d) => {
      if (d.view !== secA.id || (d.kind !== 'radius' && d.kind !== 'diameter')) return false;
      const e = dimensionRefs(d).map(getFacts)[0];
      return e && 'radius' in e && typeof e.radius === 'number' && e.radius < 0.8;
    }).length : 0;
    let secA2Id: Id | null = null;
    if (secA && secA.kind === 'section' && secAMicroCount >= 2) {
      secA2Id = alloc.take('view');
      const secA2: DrawingView = { ...secA, id: secA2Id, parent: base2Id };
      const secADims = pg0.dimensions.filter((d) => d.view === secA.id);
      doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'insertViews', views: [secA2] }));
      if (secADims.length) {
        doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'insertDimensions', dimensions: secADims.map((d) => ({ ...d, view: secA2Id! })) }));
        doc = onPage(doc, 0, (st) => applyDrawingCommand(st, { type: 'deleteDimensions', dimensionIds: secADims.map((d) => d.id) }));
      }
      doc = onPage(doc, 0, (st) => applyDrawingCommand(st, { type: 'deleteViews', viewIds: [secA.id] }));
    }

    // Create enlarged Detail Views on Page 2 for spatial clusters of micro-radius features on secA2Id, secB2Id and base2Id.
    // Keep dimensions of the same feature together in one view (feature cohesion).
    const pg1After = page(doc, 1);
    const parentCandidates = [
      ...(secA2Id && secA ? [{ id: secA2Id, srcViewId: secA2Id, onPage0: false }] : []),
      ...(secB2Id ? [{ id: secB2Id, srcViewId: secB2Id, onPage0: false }] : []),
      { id: base2Id, srcViewId: mainId, onPage0: true },
    ];
    const labels = ['C', 'D', 'E', 'F', 'G', 'H'];
    let labelIdx = 0;
    const featKey = (d: Dimension) => dimensionRefs(d)[0]?.name.split('.')[0] ?? '';

    for (const cand of parentCandidates) {
      if (labelIdx >= labels.length) break;
      const pv = pg1After.views.find((v) => v.id === cand.id);
      if (!pv) continue;
      const axes = axesOf(pg1After.views, pg1After.sheet.projection, pv);
      if (!axes) continue;
      const allParentDims = cand.onPage0
        ? page(doc, 0).dimensions.filter((d) => d.view === cand.srcViewId)
        : page(doc, 1).dimensions.filter((d) => d.view === cand.srcViewId);
      const microDims = allParentDims.filter((d) => {
        if (d.kind !== 'radius' && d.kind !== 'diameter') return false;
        const e = dimensionRefs(d).map(getFacts)[0];
        return e && 'radius' in e && typeof e.radius === 'number' && e.radius < 0.8;
      });
      if (microDims.length === 0) continue;

      const r = rightOf(axes);
      const u = sheetUp(axes);
      const projectPt = (d: Dimension): [number, number] | null => {
        const e = dimensionRefs(d).map(getFacts)[0];
        if (!e) return null;
        const p = e.point;
        const at: [number, number] = [p[0] * r[0] + p[1] * r[1] + p[2] * r[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2]];
        if ((d.kind === 'radius' || d.kind === 'diameter') && e.radius !== undefined) {
          const th = (d.angle * Math.PI) / 180;
          const dir: [number, number] = [Math.cos(th), Math.sin(th)];
          if (e.type === 'torus' && e.dir && e.major !== undefined) {
            const ax: [number, number] = [e.dir[0] * r[0] + e.dir[1] * r[1] + e.dir[2] * r[2], e.dir[0] * u[0] + e.dir[1] * u[1] + e.dir[2] * u[2]];
            const l = Math.hypot(ax[0], ax[1]);
            if (l > 1e-9) {
              const across: [number, number] = [ax[1] / l, -ax[0] / l];
              const side = dir[0] * across[0] + dir[1] * across[1] >= 0 ? 1 : -1;
              return [at[0] + side * across[0] * e.major + dir[0] * e.radius, at[1] + side * across[1] * e.major + dir[1] * e.radius];
            }
          }
          return [at[0] + dir[0] * e.radius, at[1] + dir[1] * e.radius];
        }
        return at;
      };

      // Greedy spatial clustering within 2.5 mm radius so nearby micro-radii fit cleanly inside a <= 3.5 mm Detail View
      const clusters: { dims: Dimension[]; pts: [number, number][]; cx: number; cy: number }[] = [];
      for (const d of microDims) {
        const pt = projectPt(d);
        if (!pt) continue;
        let hit = clusters.find((c) => Math.hypot(pt[0] - c.cx, pt[1] - c.cy) <= 2.5);
        if (!hit) {
          hit = { dims: [], pts: [], cx: pt[0], cy: pt[1] };
          clusters.push(hit);
        }
        hit.dims.push(d);
        hit.pts.push(pt);
        hit.cx = hit.pts.reduce((a, p) => a + p[0], 0) / hit.pts.length;
        hit.cy = hit.pts.reduce((a, p) => a + p[1], 0) / hit.pts.length;
      }

      // Prefer clusters with >= 2 dimensions so we don't spawn tiny single-callout views
      clusters.sort((a, b) => b.dims.length - a.dims.length);
      const multiClusters = clusters.filter((c) => c.dims.length >= 2);
      const chosenClusters = (multiClusters.length ? multiClusters : clusters).slice(0, cand.id === secA2Id ? 3 : 2);
      const movedIds = new Set<Id>();

      for (const cl of chosenClusters) {
        if (labelIdx >= labels.length) break;
        const label = labels[labelIdx++]!;
        let maxDist = Math.max(0.8, ...cl.pts.map((p) => Math.hypot(p[0] - cl.cx, p[1] - cl.cy)));
        let maxR = Math.max(2.0, Math.min(3.5, maxDist + 0.9));

        // Feature cohesion: pull in other dimensions of the same feature whose attachment point lies inside the detail circle
        const clFeats = new Set(cl.dims.map(featKey).filter(Boolean));
        const clusterDims = [...cl.dims];
        for (const d of allParentDims) {
          if (movedIds.has(d.id) || clusterDims.some((x) => x.id === d.id)) continue;
          const fk = featKey(d);
          if (!fk || !clFeats.has(fk)) continue;
          const pt = projectPt(d);
          if (pt && Math.hypot(pt[0] - cl.cx, pt[1] - cl.cy) <= maxR - 0.2) {
            clusterDims.push(d);
            cl.pts.push(pt);
          }
        }
        for (const d of clusterDims) movedIds.add(d.id);
        maxDist = Math.max(0.6, ...cl.pts.map((p) => Math.hypot(p[0] - cl.cx, p[1] - cl.cy)));
        maxR = Math.max(1.4, Math.min(3.5, maxDist + 0.8));

        // the largest scale (up to 20:1) at which the circle is at most 52 mm across on the sheet; that it is larger than its page's scale is
        // made sure once page 2 has its scale (create), since the pages are fitted only after this
        const viewScale: Scale = DETAIL_SCALES.find((sc) => maxR * ratio(sc) <= DETAIL_MAX_RADIUS + 1e-9) ?? [1, 1];

        const detailId = alloc.take('view');
        const detailView: DrawingView = {
          id: detailId,
          name: t('drawing.view.detail', { label }),
          kind: 'detail',
          parent: cand.id,
          centre: [Math.round(cl.cx * 100) / 100, Math.round(cl.cy * 100) / 100],
          radius: Math.round(maxR * 100) / 100,
          label,
          at: [280, 150],
          scale: viewScale,
        };
        doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'insertViews', views: [detailView] }));
        // where its dimensions came from, so that a detail that turns out to show nothing gives them back (`dropEmptyDetails`)
        this.detailSources.set(detailId, { dims: clusterDims, page: cand.onPage0 ? 0 : 1, view: cand.srcViewId });
        if (!cand.onPage0) {
          doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'deleteDimensions', dimensionIds: clusterDims.map((d) => d.id) }));
          doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'insertDimensions', dimensions: clusterDims.map((d) => ({ ...d, view: detailId })) }));
        } else {
          doc = onPage(doc, 1, (st) => applyDrawingCommand(st, { type: 'insertDimensions', dimensions: clusterDims.map((d) => ({ ...d, view: detailId })) }));
          doc = onPage(doc, 0, (st) => applyDrawingCommand(st, { type: 'deleteDimensions', dimensionIds: clusterDims.map((d) => d.id) }));
        }
      }
    }
    return doc;
  }

  /**
   * How many things are wrong with the layout of a page (ADR 0261): the nearest two views closer than `minViewClearance`, each detail with a view between it and its
   * parent or further from it than `maxDistance`, a page drawn beyond its area. 0 is a clean page.
   */
  private layoutFaults(doc: DrawingDoc, pageIndex: number): number {
    const m = this.layout(doc, pageIndex);
    const need = minViewClearance(resolveDimStyle(baseDimStyle(page(doc, pageIndex).sheet)).text);
    return (m.minClearance !== null && m.minClearance < need - 1e-6 ? 1 : 0) + m.details.filter((d) => d.blocked || d.distance > d.maxDistance + 1e-6).length + (m.fillW > 1 + 1e-9 || m.fillH > 1 + 1e-9 ? 1 : 0);
  }

  /**
   * Takes out the detail views that show next to nothing — the lines drawn in one shorter than its circle is round (`MIN_DETAIL_INK`) — and gives their dimensions
   * back to the views they came from; the details that are left are lettered C, D, E … again with no gap (ADR 0261, rule V6). A detail is made from where a
   * dimension is anchored, and that is not always where something is drawn.
   */
  private dropEmptyDetails(doc: DrawingDoc, pageIndex: number): DrawingDoc {
    const empty = this.layout(doc, pageIndex).details.filter((d) => d.inkRatio < MIN_DETAIL_INK).map((d) => d.id);
    if (empty.length === 0) return doc;
    for (const id of empty) {
      const own = page(doc, pageIndex).dimensions.filter((d) => d.view === id).map((d) => d.id);
      if (own.length) doc = onPage(doc, pageIndex, (st) => applyDrawingCommand(st, { type: 'deleteDimensions', dimensionIds: own }));
      doc = onPage(doc, pageIndex, (st) => applyDrawingCommand(st, { type: 'deleteViews', viewIds: [id] }));
      const src = this.detailSources.get(id);
      if (src && src.dims.length) doc = onPage(doc, src.page, (st) => applyDrawingCommand(st, { type: 'insertDimensions', dimensions: src.dims }));
    }
    const labels = ['C', 'D', 'E', 'F', 'G', 'H'];
    page(doc, pageIndex)
      .views.filter((v) => v.kind === 'detail')
      .forEach((v, i) => {
        const label = labels[i];
        if (!label || (v.kind === 'detail' && v.label === label)) return;
        doc = onPage(doc, pageIndex, (st) => applyDrawingCommand(st, { type: 'setView', viewId: v.id, patch: { label, name: t('drawing.view.detail', { label }) } }));
      });
    return doc;
  }

  /**
   * Puts each detail view of a page in the free spot nearest the view it enlarges, with no other view between them (`nearestFreeSpot`), one after another, each
   * kept clear of the views and of what is drawn for them, the details already placed included. The room it asks for is its circle and the dimensions drawn for it,
   * less where the page is crowded (30 mm each side, then 20, 10, none).
   */
  private placeDetails(doc: DrawingDoc, pageIndex: number): DrawingDoc {
    const details = page(doc, pageIndex).views.filter((v) => v.kind === 'detail');
    const placedIds = new Set<Id>();
    for (const dv of details) {
      const pg = page(doc, pageIndex);
      const single = drawingPageForOutput(doc, pageIndex);
      const b = this.build(doc, pageIndex);
      const m = this.layout(doc, pageIndex, b);
      const unplaced = new Set(details.filter((v) => !placedIds.has(v.id)).map((v) => v.id));
      const unplacedDims = new Set(pg.dimensions.filter((d) => unplaced.has(d.view)).map((d) => d.id));
      const items = b.scene.items
        .slice(sheetItems(single).length)
        .filter((i) => !([...unplaced].some((id) => i.owner === `view:${id}` || i.owner === `caption:${id}`)) && !(i.group !== undefined && unplacedDims.has(i.group)));
      const parent = m.views.find((v) => v.id === dv.parent);
      const placed = b.placed.get(dv.id);
      if (!parent || !placed) continue;
      const area = drawingSheetMetrics(single).area;
      const occupied = m.views.filter((v) => !unplaced.has(v.id)).map((v) => v.drawn);
      const sightObstacles = m.views.filter((v) => v.id !== dv.id && v.id !== parent.id && v.kind !== 'detail').map((v) => v.box);
      const diagonal = Math.hypot(parent.box.x1 - parent.box.x0, parent.box.y1 - parent.box.y0);
      const maxDist = Math.max(diagonal, 2 * placed.w);
      let spot = null as ReturnType<typeof nearestFreeSpot>;
      for (const margin of [30, 20, 10, 0]) {
        const side = placed.w + 2 * margin;
        const cand = nearestFreeSpot({ items, occupied, sightObstacles, parent: parent.drawn, parentBox: parent.box, area, footprint: { w: side, h: side }, gap: 8 });
        if (cand) {
          spot ??= cand;
          const boxDist = Math.max(0, cand.distance - margin * Math.SQRT2);
          if (!cand.blocked && boxDist <= maxDist + 1e-6) {
            spot = cand;
            break;
          }
        }
      }
      if (!spot) continue;
      const at: [number, number] = [Math.round(spot.at[0] * 10) / 10, Math.round(spot.at[1] * 10) / 10];
      doc = onPage(doc, pageIndex, (st) => applyDrawingCommand(st, { type: 'setView', viewId: dv.id, patch: { at } }));
      placedIds.add(dv.id);
    }
    return doc;
  }

  /** Everything a picture, a check or an export of `doc` needs for `pageIndex`. */
  build(doc: DrawingDoc = this.need(), pageIndex = 0): Built {
    const pg = page(doc, pageIndex);
    const single = drawingPageForOutput(doc, pageIndex);
    if (pg.cad) {
      const built = buildScene(single, new Map(), new Map());
      return { lines: new Map(), features: new Map(), elements: new Map(), scene: built.scene, placed: built.placed, outcomes: built.dimensions };
    }
    const s = this.source();
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
    const getFacts = (r: Parameters<typeof elementFacts>[2]): Exclude<ReturnType<typeof elementFacts>, { error: string }> | null => {
      const key = JSON.stringify(r);
      if (this.elementCache.has(key)) return this.elementCache.get(key)!;
      const f = r.kind === 'sketch' ? drawingSketchFacts(s.built.sketches, r) : elementFacts(s.body.topology, s.body.names, r, holes, s.built.cosmeticThreads);
      const val = 'error' in f ? null : f;
      this.elementCache.set(key, val);
      return val;
    };
    const elements = new Map<Id, ElementsResult>(pg.dimensions.map((d) => {
      const refs = dimensionRefs(d);
      const elements = refs.map(getFacts);
      return [d.id, refs.some((ref, i) => ref.crossing && !elements[i]) ? { error: t('drawing.dimPointLost') } : { elements }];
    }));
    const built = buildScene(single, lines, elements, features);
    return { lines, features, elements, scene: built.scene, placed: built.placed, outcomes: built.dimensions };
  }

  /**
   * How page `pageIndex` is laid out, measured on what is drawn (`layoutMetrics`): the fill of the area, the clear space between views counting their dimensions,
   * how far each detail is from its parent. The same measurement the layout steps work from and the self-check reports.
   */
  layout(doc: DrawingDoc = this.need(), pageIndex = 0, built?: Built): LayoutMetrics {
    const pg = page(doc, pageIndex);
    const single = drawingPageForOutput(doc, pageIndex);
    const b = built ?? this.build(doc, pageIndex);
    return layoutMetrics({
      items: b.scene.items.slice(sheetItems(single).length),
      views: pg.views,
      placed: b.placed,
      dimensionView: new Map(pg.dimensions.map((d) => [d.id, d.view])),
      area: drawingSheetMetrics(single).area,
    });
  }

  private need(): DrawingDoc {
    if (!this.doc) throw new AgentError('there is no drawing yet: drawing_create makes one of the open part, drawing_open opens one');
    return this.doc;
  }

  checks(doc: DrawingDoc = this.need(), b?: Built): Checks {
    const f = font();
    let overlaps = 0;
    let outside = 0;
    const failed: { id: Id; error: string }[] = [];
    const clutterTexts: string[] = [];
    const clutterCrossings: string[] = [];
    let clutterCount = 0;
    const heights: { text: string; h: number; caption: boolean }[] = [];
    const missingSet = new Set<string>();
    const allDims: DimensionLike[] = [];

    const pageLayouts: PageLayoutInspection[] = [];
    for (let pi = 0; pi < doc.pages.length; pi++) {
      const pg = page(doc, pi);
      const single = drawingPageForOutput(doc, pi);
      const built = pi === 0 && b ? b : this.build(doc, pi);
      const ids = new Set(pg.dimensions.map((d) => d.id));
      allDims.push(...(pg.dimensions as DimensionLike[]));
      for (const [id, o] of built.outcomes) if ('error' in o) failed.push({ id, error: o.error });
      const area = sheetMetrics(pg.sheet).frame;
      const slice = built.scene.items.slice(sheetItems(single).length);
      const drawn = itemsBounds(slice);
      const out = drawn ? Math.max(0, area.x - drawn.x0, drawn.x1 - (area.x + area.w), area.y - drawn.y0, drawn.y1 - (area.y + area.h)) : 0;
      outside = Math.max(outside, out);
      const cl = clutterOf(slice, CLEARANCE, viewsOfDimensions(single));
      clutterCount += cl.count;
      clutterTexts.push(...cl.texts);
      if (cl.crossings) clutterCrossings.push(...cl.crossings);
      overlaps += overlappingDimensions(slice, ids);
      for (const w of toPdf(built.scene, { ...(f ? { font: f } : {}) }).warnings) missingSet.add(w);
      for (const i of slice) if (i.kind === 'text' && i.text.trim()) heights.push({ text: i.text, h: Math.round(i.height * 100) / 100, caption: i.owner?.startsWith('caption:') === true });

      const m = this.layout(doc, pi, built);
      const needClearance = minViewClearance(resolveDimStyle(baseDimStyle(pg.sheet)).text);
      const captions = new Set(built.scene.items.flatMap((i) => (i.kind === 'text' && i.viewCaption ? [i.text] : [])));
      const captionClutter = cl.texts.filter((txt) => captions.has(txt));
      const maxFill = Math.round(Math.max(m.fillW, m.fillH) * 1000) / 1000;
      const clearanceOk = m.minClearance === null || m.minClearance >= needClearance - 1e-6;
      const detailPlacementOk = m.details.every((d) => !d.blocked && d.distance <= d.maxDistance + 1e-6);
      const detailContentOk = m.details.every((d) => d.inkRatio >= MIN_DETAIL_INK - 1e-9);
      const standardScalesOk = m.nonStandardScales.length === 0;
      const captionsClearOk = captionClutter.length === 0;
      pageLayouts.push({
        page: pi,
        sheet: pg.sheet.size,
        scale: `${pg.sheet.scale[0]}:${pg.sheet.scale[1]}`,
        fillW: m.fillW,
        fillH: m.fillH,
        maxFill,
        viewAreaFill: m.viewAreaFill,
        minClearance: m.minClearance,
        needClearance,
        clearances: m.clearances,
        details: m.details.map((d) => ({ ...d, pass: !d.blocked && d.distance <= d.maxDistance + 1e-6 && d.inkRatio >= MIN_DETAIL_INK - 1e-9 })),
        nonStandardScales: m.nonStandardScales,
        captionClutter,
        checks: {
          clearance: clearanceOk,
          fill: maxFill <= 1 + 1e-9,
          detailPlacement: detailPlacementOk,
          detailContent: detailContentOk,
          standardScales: standardScalesOk,
          captionsClear: captionsClearOk,
        },
        pass: true,
      });
    }
    // Rule 2-2: the page that sets the sheet size (or a single page) has maxFill in FILL_RANGE [0.60, 0.95], and no page exceeds 1.00
    const greatestFill = pageLayouts.length ? Math.max(...pageLayouts.map((p) => p.maxFill)) : 0;
    const dominantFillOk = pageLayouts.length === 0 || (greatestFill >= FILL_RANGE[0] - 1e-9 && greatestFill <= FILL_RANGE[1] + 1e-9);
    for (const p of pageLayouts) {
      if (p.maxFill === greatestFill) p.checks.fill = p.maxFill >= FILL_RANGE[0] - 1e-9 && p.maxFill <= FILL_RANGE[1] + 1e-9;
      p.pass = p.checks.clearance && p.checks.fill && p.checks.detailPlacement && p.checks.detailContent && p.checks.standardScales && p.checks.captionsClear;
    }

    // Rule 2-6: multi-page consistency
    const sameSheet = new Set(doc.pages.map((p) => p.sheet.size)).size <= 1;
    const letters = doc.pages.flatMap((p) => p.views.flatMap((v) => (v.kind === 'section' || v.kind === 'detail' ? [v.label] : [])));
    const uniqueLetters = new Set(letters).size === letters.length;
    const main0 = page(doc, 0).views.find((v): v is Extract<DrawingView, { kind?: 'model' }> => !isDerived(v) && v.direction !== 'isometric');
    const refViews = doc.pages.slice(1).flatMap((p) => p.views.filter((v): v is Extract<DrawingView, { kind?: 'model' }> => !isDerived(v) && main0 !== undefined && v.direction === main0.direction));
    const referenceMarked = refViews.every((v) => main0 !== undefined && v.name !== main0.name && (/參考|reference/i.test(v.name) || v.name === t('drawing.view.reference', { name: main0.name })));
    const multiPage = { sameSheet, uniqueLetters, referenceMarked, pass: sameSheet && uniqueLetters && referenceMarked };

    // Rule 2-8: turned part main view shows axis side-on
    const revAxis = revolutionAxis(this.source().body.topology.faces);
    const mainDir = main0 ? main0.direction : null;
    const mainSideOn = !revAxis || !main0
      ? true
      : (() => {
          const ax = axesOf(page(doc, 0).views, page(doc, 0).sheet.projection, main0);
          if (!ax) return false;
          const d = ax.dir;
          const dLen = Math.hypot(d[0], d[1], d[2]) || 1;
          const aLen = Math.hypot(revAxis[0], revAxis[1], revAxis[2]) || 1;
          return Math.abs((d[0] * revAxis[0] + d[1] * revAxis[1] + d[2] * revAxis[2]) / (dLen * aLen)) < 1e-3;
        })();
    const mainView = {
      revolved: revAxis !== null,
      axis: revAxis ? (revAxis.map((x) => Math.round(x * 1000) / 1000) as [number, number, number]) : null,
      direction: mainDir,
      sideOn: mainSideOn,
      pass: mainSideOn,
    };
    const layout: DrawingLayoutInspection = {
      pages: pageLayouts,
      multiPage,
      mainView,
      pass: pageLayouts.every((p) => p.pass) && dominantFillOk && multiPage.pass && mainView.pass,
    };
    const coverage = dimensionCoverage(this.dimensionViews(doc, true), allDims);
    const odd = heights.filter((x) => { const [lo, hi] = x.caption ? TEXT_RANGE.caption : TEXT_RANGE.text; return x.h < lo - 1e-9 || x.h > hi + 1e-9; });
    const textOutOfRange = odd.slice(0, 12).map((x) => `${x.text} (${x.h} mm)`);
    const outsideRounded = Math.round(outside * 10) / 10;
    const attachmentRefs = coverage.complete ? [] : findControlledAttachmentRefs(doc);
    const partStepSha256s = (this.source().doc.blobs ?? []).filter((b) => b.kind === 'step' && typeof b.sha256 === 'string').map((b) => b.sha256);
    const controlledAttachment =
      attachmentRefs.length > 0 && this.path ? loadControlledAttachment(this.path, attachmentRefs[0]!, partStepSha256s) : null;
    const quality = evaluateQualityGate({
      doc,
      overlaps,
      textOutOfRange,
      clutterCount,
      clutterTexts,
      clutterCrossings,
      outside: outsideRounded,
      failedDims: failed,
      coverage,
      layout,
      controlledAttachment,
    });
    return {
      overlaps,
      text: { min: heights.length ? Math.min(...heights.map((x) => x.h)) : null, max: heights.length ? Math.max(...heights.map((x) => x.h)) : null, outOfRange: textOutOfRange },
      clutter: { count: clutterCount, texts: clutterTexts.slice(0, 12), ...(clutterCrossings.length ? { crossings: clutterCrossings.slice(0, 12) } : {}) },
      glyphs: { font: f?.name ?? null, cjk: f ? f.glyphOf(0x8cab) !== 0 : false, missing: [...missingSet] },
      outside: outsideRounded,
      failed,
      coverage,
      layout,
      quality,
    };
  }

  report(): DrawingReport {
    const doc = this.need();
    const pg = page(doc);
    return {
      path: this.path,
      ...(doc.pages.length > 1
        ? {
            pages: doc.pages.length,
            pageSummaries: doc.pages.map((p, i) => ({
              page: i,
              name: p.name ?? '',
              sheet: { size: p.sheet.size, orientation: p.sheet.orientation, scale: `${p.sheet.scale[0]}:${p.sheet.scale[1]}` },
              views: p.views.map((v) => ({ id: v.id, name: v.name, kind: v.kind ?? 'model' })),
              dimensions: p.dimensions.length,
              annotations: (p.annotations ?? []).length,
            })),
          }
        : {}),
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
    if (doc.pages.some((p) => p.cad)) return { imported2D: true, modelAssociative: false, pages: doc.pages.map((p, i) => ({ page: i, name: p.name, cad: p.cad })), note: 'Detached 2D CAD entities; edit with drawing_apply setCadEntity/setCadDrawing. Model-based manufacturing quality is not certified.' };
    const pages = doc.pages.map((_, pi) => this.inspectPage(doc, pi));
    const report = this.report();
    return {
      report,
      layout: report.checks.layout,
      quality: report.checks.quality,
      dimensions: pages.flatMap((p) => p.dimensions),
      annotations: pages.flatMap((p) => p.annotations),
      surfaceFinishes: pages.flatMap((p) => p.surfaceFinishes),
      views: pages.flatMap((p) => p.views),
    };
  }

  imported2D(): boolean { return !!this.doc?.pages.some((p) => p.cad); }

  async saveIfNamed(): Promise<void> { if (this.path) await this.save(); }

  /** What `inspect` lists of one page, each item with its page (0-based, as drawing_picture's pageIndex). */
  private inspectPage(doc: DrawingDoc, pageIndex: number) {
    const b = this.build(doc, pageIndex);
    const pg = page(doc, pageIndex);
    const dims = pg.dimensions.map((d) => {
      const o = b.outcomes.get(d.id);
      return { id: d.id, page: pageIndex, view: d.view, kind: d.kind, text: o && 'text' in o ? o.text : null, ...(o && 'error' in o ? { error: o.error } : {}), refs: dimensionRefs(d).map((r) => r.name), ...(d.tolerance ? { tolerance: d.tolerance } : {}), ...(d.reference ? { reference: true } : {}) };
    });
    const views = pg.views.map((v) => {
      const placed = b.placed.get(v.id);
      const features = this.shownBy(b, pg, v.id).features;
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
      return { id: v.id, page: pageIndex, name: v.name, kind: v.kind ?? 'model', ...(!isDerived(v) ? { direction: v.direction } : {}), sheetBox: placed ? { at: placed.at.map(r2), w: r2(placed.w), h: r2(placed.h), scale: placed.scale } : null, elements };
    });
    return {
      dimensions: dims,
      annotations: (pg.annotations ?? []).map((a) => ({ ...a, page: pageIndex })),
      surfaceFinishes: pg.surfaceFinishes.map((f) => ({ ...f, page: pageIndex })),
      views,
    };
  }

  /**
   * What a view shows, in its own coordinates: its features and the box of its lines. A detail view is drawn from its parent's lines (same axes, same page),
   * so it shows the parent's features inside its circle, and its box is the circle's.
   */
  private shownBy(b: Built, pg: DrawingPage, viewId: Id): { features: ViewFeature[]; box: { min: [number, number]; max: [number, number] } | undefined } {
    const v = pg.views.find((x) => x.id === viewId);
    if (v?.kind === 'detail') {
      const [cx, cy] = v.centre;
      const inside = (p: readonly number[]) => Math.hypot(p[0]! - cx, p[1]! - cy) <= v.radius + 1e-6;
      const features = (b.features.get(v.parent) ?? []).filter((f) =>
        f.type === 'circle' ? Math.hypot(f.centre[0] - cx, f.centre[1] - cy) <= v.radius + f.radius : f.type === 'torus' || f.type === 'slant' ? inside(f.at) : true,
      );
      return { features, box: { min: [cx - v.radius, cy - v.radius], max: [cx + v.radius, cy + v.radius] } };
    }
    const box = b.lines.get(viewId)?.box;
    return { features: b.features.get(viewId) ?? [], box: box ? { min: [box.min[0], box.min[1]], max: [box.max[0], box.max[1]] } : undefined };
  }

  /** The page (0-based) a view is on, or null. */
  private pageOfView(doc: DrawingDoc, viewId: Id): number | null {
    const i = doc.pages.findIndex((p) => p.views.some((v) => v.id === viewId));
    return i < 0 ? null : i;
  }

  /** Applies drawing commands to a page (the first by default) as one step: all or nothing. */
  apply(commands: DrawingCommand[], pageIndex = 0): void {
    const doc = this.need();
    if (!(Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < doc.pages.length)) throw new AgentError(`the drawing has pages 0 to ${doc.pages.length - 1}, not ${pageIndex}`);
    const next = onPage(doc, pageIndex, (single) => commands.reduce((d, c) => applyDrawingCommand(d, c), single));
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
    return this.locateDimension(which).dimension;
  }

  /** A dimension on any page, by id, or by the text it writes when only one on the whole drawing writes it; with the page it is on. */
  private locateDimension(which: string): { dimension: Dimension; pageIndex: number } {
    const doc = this.need();
    for (const [pageIndex, pg] of doc.pages.entries()) {
      const byId = pg.dimensions.find((d) => d.id === which);
      if (byId) return { dimension: byId, pageIndex };
    }
    const norm = (s: string) => s.replace(/\s+/g, '').replace(/^\d+[x×]/i, '').toLowerCase();
    const hits = doc.pages.flatMap((pg, pageIndex) => {
      const b = this.build(doc, pageIndex);
      return pg.dimensions
        .filter((d) => {
          const o = b.outcomes.get(d.id);
          return o && 'text' in o && (norm(o.text) === norm(which) || norm(o.text).startsWith(norm(which)));
        })
        .map((dimension) => ({ dimension, pageIndex }));
    });
    if (hits.length === 1) return hits[0]!;
    if (hits.length === 0) throw new AgentError(`no dimension is ${JSON.stringify(which)}: drawing_inspect lists them with their ids and texts`);
    throw new AgentError(`${hits.length} dimensions write ${JSON.stringify(which)} (${hits.map((h) => h.dimension.id).join(', ')}): give the id`);
  }

  setTolerance(which: string, tolerance: string | null | undefined, extra: { reference?: boolean; precision?: number } = {}): Id {
    const { dimension: d, pageIndex } = this.locateDimension(which);
    const patch: Extract<DrawingCommand, { type: 'setDimension' }>['patch'] = {};
    if (tolerance !== undefined) patch.tolerance = tolerance === null ? null : parseTolerance(tolerance);
    if (extra.reference !== undefined) patch.reference = extra.reference;
    if (extra.precision !== undefined) patch.precision = extra.precision;
    if (Object.keys(patch).length === 0) throw new AgentError('give a tolerance, precision or reference status');
    this.apply([{ type: 'setDimension', dimensionId: d.id, patch }], pageIndex);
    // a longer text (「Ø10 H7 (+0.015/0)」) may now cross what it did not: swing the leaders again (only where they are, never what they measure)
    this.doc = this.steerLeaders(this.doc!, true, pageIndex);
    return d.id;
  }

  /**
   * An annotation on an element of a view, placed by itself: beside the element, outward from the view's middle, its leader (if it has one) ending on it.
   * `target` is the element's ref name (as drawing_inspect lists them) or a dimension (by id or text), whose element it goes on.
   */
  annotate(a: AnnotateInput): Id {
    if (a.enclosure !== undefined && a.kind !== 'note') throw new AgentError('an enclosure applies to notes');
    if (a.wrapWidth !== undefined && a.kind !== 'note') throw new AgentError('a note text width applies to notes');
    const doc = this.need();
    let viewId = a.view;
    let refName = a.target;
    if (a.target) {
      const dim = (() => { try { return this.findDimension(a.target); } catch { return null; } })();
      if (dim) {
        viewId ??= dim.view;
        refName = dimensionRefs(dim).at(-1)?.name;
      }
    }
    // the page: the view's when it is known, else the first page with a view that shows the element (page 0 first)
    let pageIndex = viewId !== undefined ? this.pageOfView(doc, viewId) : 0;
    if (viewId !== undefined && pageIndex === null) throw new AgentError(`no view ${viewId} on the drawing`);
    if (viewId === undefined && refName) {
      for (let pi = 0; pi < doc.pages.length && viewId === undefined; pi++) {
        const bp = this.build(doc, pi);
        const pgi = page(doc, pi);
        viewId = pgi.views.find((v) => this.shownBy(bp, pgi, v.id).features.some((f) => f.ref.name === refName))?.id;
        if (viewId !== undefined) pageIndex = pi;
      }
    }
    const pi = pageIndex ?? 0;
    const pg = page(doc, pi);
    const b = this.build(doc, pi);
    viewId ??= refName ? undefined : pg.views[0]?.id;
    if (!viewId) throw new AgentError(refName ? `no view shows ${refName}` : 'the drawing has no views');
    const placed = b.placed.get(viewId);
    if (!placed) throw new AgentError(`view ${viewId} is not drawn`);
    const shown = this.shownBy(b, pg, viewId);
    const feature = refName ? shown.features.find((f) => f.ref.name === refName) : undefined;
    if (refName && !feature) throw new AgentError(`view ${viewId} does not show ${refName}: drawing_inspect lists what each view shows`);
    const lines = shown.box;
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
        make = (spot, reach) => ({ type: 'insertAnnotations', annotations: [{ id, view: viewId, kind: 'note', at: away(spot, reach), text, wrapWidth: a.wrapWidth, ...(a.enclosure ? { enclosure: a.enclosure } : {}), leader: pt(spot.on), ...attach } satisfies Annotation] });
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
      } else if (a.kind === 'revision') {
        const rev = (a.revision ?? currentDrawingRevision(doc) ?? pg.title?.revision ?? 'A').trim();
        if (!rev) throw new AgentError('a revision triangle needs a revision code');
        make = (spot, reach) => ({ type: 'insertAnnotations', annotations: [{ id, view: viewId, kind: 'revision', at: away(spot, reach), revision: rev, leader: pt(spot.on), ...attach } satisfies Annotation] });
      } else throw new AgentError(`kind must be note, finish, datum, fcf or revision, not ${JSON.stringify(a.kind)}`);
      if (!feature) {
        if (a.kind === 'revision') {
          const rev = (a.revision ?? currentDrawingRevision(doc) ?? pg.title?.revision ?? 'A').trim();
          const at = pt([mid[0] + halfW + 10 / placed.scale, mid[1] + halfH + 6 / placed.scale]);
          this.apply([{ type: 'insertAnnotations', annotations: [{ id, view: viewId, kind: 'revision', at, revision: rev } satisfies Annotation] }], pi);
          return id;
        }
        // a general note: at the lower left of the area, above the title block's row, clear of the views
        if (a.kind !== 'note') throw new AgentError(`a ${a.kind} goes on a feature: give its target`);
        const area = sheetMetrics(pg.sheet).area;
        const text = a.text!;
        const lines = (pg.annotations ?? []).filter((x) => x.kind === 'note' && !x.leader).length;
        const sheetAt: [number, number] = [area.x + 2, area.y + 2 + lines * 6];
        const viewAt = pt([placed.centre[0] + (sheetAt[0] - placed.at[0]) / placed.scale, placed.centre[1] + (sheetAt[1] - placed.at[1]) / placed.scale]);
        this.apply([{ type: 'insertAnnotations', annotations: [{ id, view: viewId, kind: 'note', at: viewAt, text, wrapWidth: a.wrapWidth, ...(a.enclosure ? { enclosure: a.enclosure } : {}) } satisfies Annotation] }], pi);
        return id;
      }
    }
    let best: { doc: DrawingDoc; score: number } | null = null;
    search: for (const reach of [14, 22, 32])
      for (const spot of spots) {
        let trial: DrawingDoc;
        try {
          trial = onPage(doc, pi, (single) => applyDrawingCommand(single, make(spot, reach)));
        } catch {
          continue;
        }
        const b2 = this.build(trial, pi);
        const trialPage = drawingPageForOutput(trial, pi);
        const items = b2.scene.items.slice(sheetItems(trialPage).length);
        const drawn = itemsBounds(items);
        const frame = sheetMetrics(pg.sheet).frame;
        const outside = drawn ? Math.max(0, frame.x - drawn.x0, drawn.x1 - (frame.x + frame.w), frame.y - drawn.y0, drawn.y1 - (frame.y + frame.h)) : 0;
        const score = clutterOf(items, CLEARANCE, viewsOfDimensions(trialPage)).count + (outside > 0 ? 100 : 0);
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
    const changed: string[] = [];
    // the commands for each page they go to
    const commandsOn = new Map<number, DrawingCommand[]>();
    const push = (pageIndex: number, c: DrawingCommand) => commandsOn.set(pageIndex, [...(commandsOn.get(pageIndex) ?? []), c]);
    const within = (size: number, [lo, hi]: readonly [number, number], what: string) => {
      if (!(Number.isFinite(size) && size >= lo && size <= hi)) throw new AgentError(`${what} 的字高以 ${lo}–${hi} mm 為宜（ISO 3098），不是 ${size}`);
    };
    if (o.all !== undefined) {
      within(o.all, TEXT_RANGE.text, '尺寸、註記與符號');
      const caption = Math.min(TEXT_RANGE.caption[1], Math.round(o.all * (10 / 7) * 10) / 10);
      // the whole drawing: every page
      for (const [pi, pg] of doc.pages.entries()) {
        push(pi, { type: 'setSheet', sheet: { dimStyle: { ...(pg.sheet.dimStyle ?? {}), text: o.all, arrow: Math.round(o.all * (3 / 3.5) * 100) / 100 } } });
        for (const v of pg.views) push(pi, { type: 'setView', viewId: v.id, patch: { caption: { ...(v.caption ?? {}), height: o.reset || v.caption?.height === undefined ? caption : v.caption.height } } });
        if (o.reset) {
          for (const d of pg.dimensions) if (d.style?.text !== undefined) { const { text: _t, ...rest } = d.style; push(pi, { type: 'setDimension', dimensionId: d.id, patch: { style: Object.keys(rest).length ? rest : null } as never }); }
          for (const a of pg.annotations ?? []) if ((a.kind === 'note' || a.kind === 'revision') && a.height !== undefined) push(pi, { type: 'setAnnotation', annotationId: a.id, patch: { height: null } as never });
        }
      }
      changed.push(`all ${o.all} mm（視圖標題 ${caption} mm）`);
    }
    if (o.item !== undefined) {
      if (o.size === undefined) throw new AgentError('give the size (mm) for the item, or null to make it follow the drawing again');
      const item = o.item;
      const located = (() => { try { return this.locateDimension(item); } catch { return undefined; } })();
      const d = located?.dimension;
      const aPage = doc.pages.findIndex((p) => (p.annotations ?? []).some((x) => x.id === item));
      const a = aPage < 0 ? undefined : (page(doc, aPage).annotations ?? []).find((x) => x.id === item);
      const vPage = doc.pages.findIndex((p) => p.views.some((x) => x.id === item || x.name === item));
      const v = vPage < 0 ? undefined : page(doc, vPage).views.find((x) => x.id === item || x.name === item);
      const itemPage = d ? located!.pageIndex : a ? aPage : vPage;
      if (o.size !== null) within(o.size, v && !d && !a ? TEXT_RANGE.caption : TEXT_RANGE.text, v && !d && !a ? '視圖標題' : '尺寸與註記');
      if (d) push(itemPage, { type: 'setDimension', dimensionId: d.id, patch: { style: o.size === null ? (() => { const { text: _t, ...rest } = d.style ?? {}; return Object.keys(rest).length ? rest : null; })() : { ...(d.style ?? {}), text: o.size } } as never });
      else if (a && (a.kind === 'note' || a.kind === 'revision')) push(itemPage, { type: 'setAnnotation', annotationId: a.id, patch: { height: o.size } as never });
      else if (v) push(itemPage, { type: 'setView', viewId: v.id, patch: { caption: { ...(v.caption ?? {}), ...(o.size === null ? { height: undefined } : { height: o.size }) } } });
      else throw new AgentError(`${o.item} is not a dimension, a note or a view of the drawing (finishes and frames follow the drawing's size)`);
      changed.push(`${o.item} ${o.size === null ? '跟隨全圖' : `${o.size} mm`}`);
    }
    if (commandsOn.size === 0) throw new AgentError('give all (one size for the whole drawing) or item and size');
    // one step for undo: every page changed, then laid out again
    let next = doc;
    for (const [pi, commands] of commandsOn) next = onPage(next, pi, (single) => commands.reduce((x, c) => applyDrawingCommand(x, c), single));
    for (const pi of commandsOn.keys()) next = this.tidy(next, pi, 'keep');
    this.undoStack.push(doc);
    this.doc = next;
    return changed;
  }

  /** Adds the dimensions the graph still finds missing (after the user deleted some, or the part changed), arranged again. */
  complete(): number {
    const doc = this.need();
    const count = (d: DrawingDoc) => d.pages.reduce((n, p) => n + p.dimensions.length, 0);
    // every page: what was moved to page 2 (a section, a detail view) is there, not missing
    const views = this.dimensionViews(doc, true);
    const existing = doc.pages.flatMap((p) => p.dimensions) as DimensionLike[];
    const planned = planDrawingDimensions(views, existing, {});
    let next = doc;
    if (planned.length) {
      const alloc = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
      const byPage = new Map<number, Dimension[]>();
      for (const p of planned) {
        const pi = this.pageOfView(doc, p.view);
        if (pi === null) throw new AgentError(`the dimension planner chose view ${p.view}, which is on no page`);
        byPage.set(pi, [...(byPage.get(pi) ?? []), { ...p.draft, id: alloc.take('dim'), view: p.view } as Dimension]);
      }
      for (const [pi, dimensions] of byPage) next = onPage(next, pi, (single) => applyDrawingCommand(single, { type: 'insertDimensions', dimensions }));
      for (const pi of byPage.keys()) if (pi !== 0) next = this.tidy(next, pi, 'keep');
    }
    next = this.tidy(next, 0, 'keep'); // as before: the first page is always arranged again
    this.undoStack.push(doc);
    this.doc = next;
    return count(next) - count(doc);
  }

  async open(path: string): Promise<void> {
    const full = await this.part.inside(path);
    if (/\.(dwg|dxf)$/i.test(path)) {
      const bytes = new Uint8Array(await readFile(full));
      const text = /\.dwg$/i.test(path) ? await dwgToDxf(bytes) : dxfText(bytes);
      const imported = importCadDxf(text, basename(path));
      this.doc = imported.doc;
      this.path = null;
      this.undoStack.length = 0;
      return;
    }
    const file = await readAnyDocumentFile(new Uint8Array(await readFile(full)));
    if (file.kind !== 'drawing') throw new AgentError(`${path} is a ${file.kind}, not a drawing`);
    const sources = new Set(file.doc.pages.flatMap((p) => p.views.flatMap((v) => (isDerived(v) ? [] : [v.source]))));
    if (sources.size === 0 && file.doc.pages.every((p) => !!p.cad)) {
      this.doc = file.doc; this.path = full; this.undoStack.length = 0; return;
    }
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

  /**
   * PDF: one file with every page. DXF and SVG hold one sheet each, so a drawing of several pages is written as one file per page: the first at `path`,
   * page n (n ≥ 2) beside it as 「name-n.dxf」. `files` lists them all; `path` and `bytes` are the first's.
   */
  async export(
    path: string,
    format: 'pdf' | 'dxf' | 'svg' | 'dwg',
    options?: { release?: boolean; dxfVersion?: DxfVersion; dxfMode?: DxfMode },
  ): Promise<{
    path: string;
    bytes: number;
    warnings: string[];
    files: { page: number; path: string; bytes: number }[];
    status: DrawingReleaseStatus;
    preliminary: boolean;
    failed: QualityRuleCheck[];
  }> {
    const doc = this.need();
    const full = await this.part.inside(path);
    const imported = doc.pages.some((p) => p.cad);
    if (format === 'dwg' && extname(full).toLowerCase() !== '.dwg') throw new AgentError('DWG export requires a .dwg filename.');
    if (imported && options?.release) throw new AgentError('Imported 2D drawings have no model-based manufacturing quality certification; release export refused.');
    if (format === 'dwg' && (options?.dxfMode || options?.dxfVersion)) throw new AgentError('DWG uses native dimensions and R2018 true color; DXF-specific options are not accepted.');
    const quality = imported ? { pass: false, status: 'draft' as const, failed: [] } : this.checks(doc).quality;
    if (options?.release && !quality.pass) {
      const reasons = quality.failed.map((r) => `${r.rule} (${r.name}${r.detail ? `: ${r.detail}` : ''})`).join('; ');
      throw new AgentError(`drawing_export refused (release): drawing is draft — failed rules: ${reasons}`);
    }
    const preliminary = !quality.pass;
    const f = font();
    const warnings: string[] = [];
    if (imported) warnings.push('Imported 2D drawing: no associative 3D model; manufacturing quality is unverified.');
    const outputs: { page: number; full: string; data: Uint8Array | string }[] = [];
    const exportScene = (i: number) => {
      const scene = this.build(doc, i).scene;
      if (revisionTableOverlaps(drawingPageForOutput(doc, i), scene.items)) warnings.push(t('drawing.revisions.overlap'));
      return preliminary ? stampPreliminary(scene, page(doc, i).sheet) : scene;
    };
    if (format === 'pdf') {
      const scenes = doc.pages.map((_, i) => exportScene(i));
      const pdf = toPdf(scenes.length === 1 ? scenes[0]! : scenes, { ...(f ? { font: f } : {}), title: page(doc).title.drawingName ?? 'drawing' });
      outputs.push({ page: 0, full, data: pdf.bytes });
      warnings.push(...pdf.warnings);
    } else {
      const ext = extname(full);
      const stem = full.slice(0, full.length - ext.length);
      for (let pi = 0; pi < doc.pages.length; pi++) {
        const scene = exportScene(pi);
        const at = pi === 0 ? full : await this.part.inside(relative(this.part.root, `${stem}-${pi + 1}${ext}`));
        outputs.push({
          page: pi,
          full: at,
            data: format === 'dwg' ? await dxfToDwg(toDxf(scene)) : format === 'dxf'
            ? toDxf(scene, {
                ...(options?.dxfVersion ? { version: options.dxfVersion } : {}),
                ...(options?.dxfMode ? { mode: options.dxfMode } : {}),
              })
            : toSvg(scene),
        });
      }
    }
    await mkdir(dirname(full), { recursive: true });
    const files: { page: number; path: string; bytes: number }[] = [];
    for (const o of outputs) {
      await writeFile(o.full, o.data);
      files.push({ page: o.page, path: o.full, bytes: typeof o.data === 'string' ? Buffer.byteLength(o.data) : o.data.length });
    }
    return { path: files[0]!.path, bytes: files[0]!.bytes, warnings, files, status: quality.status, preliminary, failed: quality.failed };
  }

  /** A PNG of the sheet (or of one view and what is drawn on it), for the agent to look at. */
  async picture(o: { view?: Id; px?: number; pageIndex?: number } = {}): Promise<{ png: Uint8Array; width: number; height: number; font: boolean }> {
    const doc = this.need();
    const pi = o.pageIndex ?? 0;
    const b = this.build(doc, pi);
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
      const rTol = Math.max(tol, f.radius * 1e-3);
      // Chord sagitta of a tessellated arc (up to ~36 deg per segment) is R*(1 - cos(theta/2)) <= 0.05*R, while a secant across the circle is much deeper.
      const midTol = Math.max(rTol, f.radius * 0.05);
      const on = seen.some((l) => {
        for (let i = 0; i + 3 < l.length; i += 2) {
          if (Math.hypot(l[i + 2]! - l[i]!, l[i + 3]! - l[i + 1]!) <= tol) continue;
          const d0 = Math.abs(Math.hypot(l[i]! - f.centre[0], l[i + 1]! - f.centre[1]) - f.radius);
          const d1 = Math.abs(Math.hypot(l[i + 2]! - f.centre[0], l[i + 3]! - f.centre[1]) - f.radius);
          const mx = (l[i]! + l[i + 2]!) / 2;
          const my = (l[i + 1]! + l[i + 3]!) / 2;
          const dm = Math.abs(Math.hypot(mx - f.centre[0], my - f.centre[1]) - f.radius);
          if (d0 < rTol && d1 < rTol && dm < midTol) return true;
        }
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

/** A detail view's scales, largest first: the standard ones only (ISO 5455, ADR 0261), and the largest radius its circle may have on the sheet (52 mm across). */
const DETAIL_SCALES: readonly Scale[] = [[20, 1], [10, 1], [5, 1], [2, 1], [1, 1]];
const DETAIL_MAX_RADIUS = 26;

/**
 * A detail view enlarges: when a page's own scale is not smaller than every detail view's on it, the page takes the largest standard scale below the
 * smallest of theirs (smaller than what was fitted, so the views still fit).
 */
export function enlargeDetails(doc: DrawingDoc, pageIndex: number): DrawingDoc {
  const pg = page(doc, pageIndex);
  const details = pg.views.filter((v) => v.kind === 'detail');
  if (!details.length) return doc;
  const least = Math.min(...details.map((v) => ratio(v.scale ?? pg.sheet.scale)));
  if (ratio(pg.sheet.scale) < least - 1e-9) return doc;
  const scale = STANDARD_SCALES.find((sc) => ratio(sc) < least - 1e-9);
  if (!scale) throw new AgentError(`no standard scale is smaller than the detail views' ${least}:1`);
  return onPage(doc, pageIndex, (single) => applyDrawingCommand(single, { type: 'setSheet', sheet: { scale } }));
}

const STANDARD: readonly Scale[] = [[2, 1], [1, 1], [1, 2], [1, 5], [1, 10], [1, 20], [1, 50], [1, 100]];
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface AnnotateInput {
  kind: 'note' | 'finish' | 'datum' | 'fcf' | 'revision';
  view?: Id;
  target?: string;
  text?: string;
  revision?: string;
  enclosure?: Extract<Annotation, { kind: 'note' }>['enclosure'];
  wrapWidth?: number;
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
