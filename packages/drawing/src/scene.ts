import { bendTableItems } from './bendTable';
import { getLocale, t, withLocale } from '@3db/i18n';
import { axesOf, hatchStyleOf, displayOf, isShaded, page, resolveDimStyle, resolveTitleStyle, sectionEndDirections, type HatchStyle, type CropDrawingView, type DetailDrawingView, type DimStyle, type DrawingDoc, type DrawingView, type Id, type Scale, type LocalSectionDrawingView, type SectionDrawingView, type TitleField, type ViewFeature } from '@3db/model';
import type { ShadeImage } from './shade';
import { centreItems, holeRows, holeTableBox, holeTableItems, threadItems, type HoleRow } from './annotation';
import { annotationItems } from './gdt';
import { balloonSpots, bomTableBox, bomTableItems, spotItems, type BalloonSpot, type ViewBom } from './bomTable';
import { evaluateDimension, type DimensionOutcome, type ElementsResult } from './dimension';
import { circlePolyline, clipToOutline, clipToBand, hatch, outlinePoints, type Polyline } from './geometry';
import { layoutViews, resolveLines, scaleOf, toSheet, type PlacedView, type ViewLines } from './layout';
import { fittedTitleHeight, sheetMetrics, titleCells, type Rect } from './sheet';
import { surfaceFinishItems } from './surfaceFinish';

/**
 * What a drawing is as lines and text on the sheet (C16, F3.1, F3.2): one list of polylines and texts in sheet millimetres (origin at the lower left corner,
 * y up), each line with the style it is drawn in. The SVG of the screen, the DXF and the PDF are all written from it, so they cannot disagree.
 */

export type LineStyle = 'visible' | 'hidden' | 'center' | 'thin' | 'frame' | 'dimension';

/** How each style is drawn (ISO 128): the width of the line in mm and its dashes (on, off, … in mm), and the layer of the DXF. */
export const LINE_STYLES: Record<LineStyle, { width: number; dash: number[] | null; layer: string; linetype: string }> = {
  visible: { width: 0.5, dash: null, layer: 'VISIBLE', linetype: 'CONTINUOUS' },
  hidden: { width: 0.25, dash: [3, 1], layer: 'HIDDEN', linetype: 'DASHED' },
  center: { width: 0.25, dash: [12, 2, 2, 2], layer: 'CENTER', linetype: 'CENTER' },
  thin: { width: 0.25, dash: null, layer: 'THIN', linetype: 'CONTINUOUS' },
  frame: { width: 0.7, dash: null, layer: 'FRAME', linetype: 'CONTINUOUS' },
  dimension: { width: 0.25, dash: null, layer: 'DIMENSION', linetype: 'CONTINUOUS' },
};

export interface ScenePolyline {
  kind: 'polyline';
  /** The dimension (by id) this line is drawn for: a DXF writes it into the dimension's block, the other outputs draw it as it is. */
  group?: string;
  /** x, y, x, y … */
  points: number[];
  style: LineStyle;
  closed?: boolean;
  /** A closed polyline filled in (an arrowhead). */
  filled?: boolean;
  /** Its own line width (mm) instead of its style's (a dimension drawn in a style of its own, ADR 0146). */
  width?: number;
}

/**
 * The shading of a view (ADR 0146): its image put on the sheet, `at` its lower left corner and `w` × `h` its size (mm), under every line; a detail's is cut to
 * its circle (`clip`, on the sheet).
 */
export interface SceneImage {
  view: string;
  at: [number, number];
  w: number;
  h: number;
  image: ShadeImage;
  clip?: { centre: [number, number]; radius: number };
}

export interface SceneText {
  kind: 'text';
  /** The dimension (by id) this text is drawn for. */
  group?: string;
  /** The left end of the text's baseline (or its middle or right end, by `anchor`). */
  at: [number, number];
  text: string;
  /** Height of the capital letters, mm. */
  height: number;
  anchor?: 'left' | 'center' | 'right';
  /** Degrees counter-clockwise. */
  angle?: number;
}

export type SceneItem = ScenePolyline | SceneText;

type P2 = [number, number];

/**
 * What a CAD program needs to know of a dimension to keep it a dimension (D-2, ADR 0102): its kind and the definition points of a DXF DIMENSION, in sheet millimetres.
 * The lines and text it is drawn with are the scene's items of the same `group`; the text is the one the model's number made, written over what the CAD would measure.
 */
export type SceneDimensionGeometry =
  /** Linear: where the two extension lines start, a point on the dimension line, and for a horizontal or vertical one the angle of the dimension line (0 or 90). */
  | { kind: 'linear'; a: P2; b: P2; line: P2; rotation?: number }
  /** Diameter: the two ends of the dimension line on the circle, and the length of the leader. */
  | { kind: 'diameter'; far: P2; near: P2; leader: number }
  /** Radius: the centre, a point on the circle and the length of the leader. */
  | { kind: 'radius'; centre: P2; near: P2; leader: number }
  /** Angle between two lines: each as the two points it runs through (from the vertex out), and a point on the arc. */
  | { kind: 'angular'; first: [P2, P2]; second: [P2, P2]; arc: P2 };

export interface SceneDimension {
  id: string;
  text: string;
  /** Where the middle of the text is. */
  textAt: P2;
  geometry: SceneDimensionGeometry;
}

export interface Scene {
  width: number;
  height: number;
  items: SceneItem[];
  /** The dimensions of the drawing as dimensions, for a DXF (the items of each are marked with its id as `group`). */
  dimensions?: SceneDimension[];
  /** The shaded views' images, drawn first, under the items (ADR 0146). A DXF has no images and leaves them out. */
  images?: SceneImage[];
  /** The drawing's dimension style, which a DXF writes as its dimension style. */
  dimStyle?: Required<DimStyle>;
}

const rect = (r: Rect, style: LineStyle): ScenePolyline => ({ kind: 'polyline', points: [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h], style, closed: true });

/** The text of a scale: 「1:2」, 「5:1」. */
export const scaleText = (s: readonly [number, number]) => `${s[0]}:${s[1]}`;

/** The frame and the title block with what the document says in it, written at the heights the drawing's title style gives (ADR 0150). */
export function sheetItems(doc: DrawingDoc): SceneItem[] {
  const pg = page(doc);
  const m = sheetMetrics(pg.sheet);
  const style = resolveTitleStyle(pg.sheet.titleStyle);
  const items: SceneItem[] = [rect(m.frame, 'frame'), rect(m.titleBlock, 'frame')];
  const values: Record<string, string> = {
    ...pg.title,
    scale: scaleText(pg.sheet.scale),
    sheet: pg.sheet.size,
    projection: t(`drawing.projection.${pg.sheet.projection}`),
  };
  for (const c of titleCells()) {
    const x = m.titleBlock.x + c.x;
    const y = m.titleBlock.y + c.y;
    // the lines between cells are the cells' own borders; the block's outer line is already there
    items.push(rect({ x, y, w: c.w, h: c.h }, 'thin'));
    // the name hangs 0.8 mm below the top of the cell at whatever height — at ISO's 2.2 mm that is exactly where it has always stood
    const label = t(`drawing.title.${c.field}`);
    const labelHeight = fittedTitleHeight(label, style.label, c.w, style.fit);
    items.push({ kind: 'text', at: [x + 1, y + c.h - 0.8 - labelHeight], text: label, height: labelHeight });
    const text = values[c.field] ?? '';
    if (text) {
      const height = fittedTitleHeight(text, c.large ? style.title : style.value, c.w, style.fit);
      items.push({ kind: 'text', at: [x + 2, y + (c.large ? 3.5 : 2.2)], text, height });
    }
  }
  return items;
}


/** Whether a view draws its hidden lines: in its display style 「隱藏線可見」 (dashed) or 「線架構」 (as visible lines). */
export const showsHidden = (v: DrawingView): boolean => {
  const d = displayOf(v);
  return d === 'hiddenVisible' || d === 'wireframe';
};

/** The spacing of hatch lines on the sheet (ISO 128-50: 1.5 to 3 mm for small areas, up to 10 for large). */
export const HATCH_SPACING = 3;

/**
 * The break lines of a view (B2.7): a zigzag across it at each end of the band left out, drawn thin as a break line is (ISO 128-30). In drawn coordinates the near
 * line stands at `from` and the far one at `from + gap`: `toSheet` maps the view's own coordinates, so it cannot be used for the far line (it would put both at `from`).
 */
function breakItems(placed: PlacedView, box: ViewLines['box']): ScenePolyline[] {
  const b = placed.break;
  if (!b || !box) return [];
  const across = b.axis === 0 ? 1 : 0;
  const lo = box.min[across] - 3;
  const hi = box.max[across] + 3;
  const n = 8;
  const items: ScenePolyline[] = [];
  for (const edge of [b.from, b.from + b.gap]) {
    const points: number[] = [];
    for (let i = 0; i <= n; i++) {
      const c = lo + ((hi - lo) * i) / n;
      const lean = (i % 2 === 0 ? -1 : 1) * 1.5;
      const p: [number, number] = b.axis === 0 ? [edge + lean, c] : [c, edge + lean];
      points.push(placed.at[0] + (p[0] - placed.centre[0]) * placed.scale, placed.at[1] + (p[1] - placed.centre[1]) * placed.scale);
    }
    items.push({ kind: 'polyline', points, style: 'thin' });
  }
  return items;
}

/** A view's lines moved and scaled to where the view is on the sheet; for a section, the hatching of the faces it cut. */
export function viewItems(view: DrawingView, lines: ViewLines | null | undefined, placed: PlacedView, hatchStyle: Readonly<HatchStyle> = hatchStyleOf(view)): ScenePolyline[] {
  if (!lines) return [];
  const move = (line: readonly number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < line.length; i += 2) out.push(...toSheet(placed, line[i]!, line[i + 1]!));
    return out;
  };
  const items: ScenePolyline[] = [];
  const display = displayOf(view);
  // a broken view (B2.7) leaves its band out, so a line that crosses it is cut at the band's ends rather than drawn across the gap
  const brk = placed.break;
  const cut = (l: readonly number[]): readonly (readonly number[])[] => (brk ? clipToBand(l, brk.axis, brk.from, brk.to) : [l]);
  const draw = (ls: readonly Polyline[] | undefined, style: LineStyle): void => {
    for (const l of ls ?? []) for (const piece of cut(l)) items.push({ kind: 'polyline', points: move(piece), style });
  };
  // the display style (ADR 0146): a wireframe draws the hidden edges as the visible ones; a shaded view without edges, neither
  if (showsHidden(view)) draw(lines.hidden, display === 'wireframe' ? 'visible' : 'hidden');
  if (display !== 'shaded') draw(lines.visible, 'visible');
  draw(lines.center, 'center');
  // the tangent edges (B2.3): the smooth lines where two faces meet, drawn thin. They are drawn as before unless the view leaves them out
  if (display !== 'shaded' && view.showTangentEdges !== false) draw(lines.tangent, 'thin');
  // the hidden ones (ADR 0146 §7) only where the hidden lines are drawn: dashed with them, or thin in a wireframe, which draws every edge alike. Drawn in
  // any other style they would be lines across the faces in front of them — on a shaded view, lines that the shading says are not there
  if (showsHidden(view) && view.showTangentEdges !== false) draw(lines.tangentHidden, display === 'wireframe' ? 'thin' : 'hidden');
  if (lines.cut) {
    let strokes = hatch(lines.cut, hatchStyle.spacing / placed.scale, hatchStyle.angle * Math.PI / 180);
    for (const outline of lines.hatchClip ?? []) strokes = strokes.flatMap(l => clipToOutline(l, outline));
    draw(strokes, 'thin');
  }
  items.push(...breakItems(placed, lines.box));
  return items;
}

/** A shaded view's image where the view is on the sheet (ADR 0146); none when the view is not shaded or its image has not come. */
export function viewImage(view: DrawingView, lines: ViewLines | null | undefined, placed: PlacedView): SceneImage | null {
  const img = lines?.shade;
  if (!img || !isShaded(displayOf(view))) return null;
  // a broken view is not shaded (B2.7): its image is one picture of the whole part and cannot be cut at the band, and drawing it squeezed would be a wrong picture
  if (placed.break) return null;
  // a cropped view is not shaded either (B2.7): its image is one picture of the whole view and the sheet's images can only be cut to a circle, so it would be a wrong picture
  if (view.kind === 'crop') return null;
  const at = toSheet(placed, img.box.min[0], img.box.min[1]);
  const top = toSheet(placed, img.box.max[0], img.box.max[1]);
  const clip = lines.shadeClip ? { centre: toSheet(placed, lines.shadeClip.centre[0], lines.shadeClip.centre[1]), radius: lines.shadeClip.radius * placed.scale } : undefined;
  return { view: view.id, at, w: top[0] - at[0], h: top[1] - at[1], image: img, ...(clip ? { clip } : {}) };
}

/**
 * The line of a section or the fold line of an auxiliary view on its parent view, with the arrows at its ends and the letter beside each; and the view's own
 * title. A section's line is where it cuts the part (C16.3); an auxiliary view's (B2.7) is the fold it is turned about, drawn the same way (ISO 128-30).
 */
function sectionItems(v: Pick<SectionDrawingView, 'line' | 'label' | 'flip'>, parent: PlacedView, own: PlacedView): SceneItem[] {
  // the whole line (a stepped or aligned one bends, D-I5), an arrow at each end square to its own segment
  const pts = v.line.map(([x, y]) => toSheet(parent, x, y));
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const ends = sectionEndDirections(v);
  const shaft = 8;
  const head = 3;
  const items: SceneItem[] = [{ kind: 'polyline', points: pts.flat(), style: 'center' }];
  for (const [end, dir] of [[a, ends[0]], [b, ends[1]]] as const) {
    const tip: [number, number] = [end[0] + dir[0] * shaft, end[1] + dir[1] * shaft];
    // the arrow: a shaft from the end of the line, and a V head turned 20 degrees either way
    const back = (turn: number): [number, number] => [tip[0] - head * (dir[0] * Math.cos(turn) - dir[1] * Math.sin(turn)), tip[1] - head * (dir[0] * Math.sin(turn) + dir[1] * Math.cos(turn))];
    items.push({ kind: 'polyline', points: [...end, ...tip], style: 'visible' });
    items.push({ kind: 'polyline', points: [...back(0.35), ...tip, ...back(-0.35)], style: 'visible' });
    items.push({ kind: 'text', at: [tip[0] + dir[0] * 2 - (dir[0] < 0 ? 3 : 0), tip[1] + dir[1] * 2 - (dir[1] < 0 ? 5 : 0)], text: v.label, height: 5 });
  }
  items.push({ kind: 'text', at: [own.at[0], own.at[1] - own.h / 2 - 8], text: `${v.label}-${v.label}`, height: 5, anchor: 'center' });
  return items;
}

/** The cutting outline of a local section on its parent view with its letter beside it, and the section's own title. */
function localSectionItems(v: LocalSectionDrawingView, parent: PlacedView, own: PlacedView): SceneItem[] {
  const pts = outlinePoints(v.outline);
  const sheetPts = pts.map(([x, y]) => toSheet(parent, x, y));
  const items: SceneItem[] = [{ kind: 'polyline', points: sheetPts.flat(), style: 'center', closed: true }];
  // the letter beside the outline: off its first corner, away from the middle of it
  const corner = sheetPts[0];
  if (corner) {
    let cx = 0; let cy = 0;
    for (const p of sheetPts) { cx += p[0]; cy += p[1]; }
    cx /= sheetPts.length; cy /= sheetPts.length;
    const dx = corner[0] - cx; const dy = corner[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    items.push({ kind: 'text', at: [corner[0] + (dx / len) * 3, corner[1] + (dy / len) * 3], text: v.label, height: 5 });
  }
  items.push({ kind: 'text', at: [own.at[0], own.at[1] - own.h / 2 - 8], text: `${v.label}-${v.label}`, height: 5, anchor: 'center' });
  return items;
}

/** The outline of a cropped view on its parent view (B2.7): which region the crop shows, drawn thin as the boundary it is. */
function cropItems(v: CropDrawingView, parent: PlacedView): SceneItem[] {
  const pts = outlinePoints(v.outline).map(([x, y]) => toSheet(parent, x, y));
  return pts.length >= 2 ? [{ kind: 'polyline', points: pts.flat(), style: 'thin', closed: true }] : [];
}

/** The circle of a detail on its parent view with its letter, and the detail's own title (the letter and its scale). */
function detailItems(v: DetailDrawingView, parent: PlacedView, own: PlacedView, scale: Scale): SceneItem[] {
  const centre = toSheet(parent, v.centre[0], v.centre[1]);
  const r = v.radius * parent.scale;
  const ring = circlePolyline(centre, r);
  return [
    { kind: 'polyline', points: ring, style: 'thin', closed: true },
    { kind: 'text', at: [centre[0] + r * 0.72 + 1, centre[1] + r * 0.72 + 1], text: v.label, height: 5 },
    { kind: 'text', at: [own.at[0], own.at[1] - own.h / 2 - 8], text: `${v.label} (${scaleText(scale)})`, height: 5, anchor: 'center' },
  ];
}

/**
 * The whole drawing as a scene: the sheet, then each view's lines where the layout puts it, the cutting lines of the sections and the circles of the details on
 * their parents, and the titles of those views. `lines` is what the views look like from their directions at full size (a view not in it, or null, is not
 * drawn: its model could not be read); detail views are made from their parents' lines. The dimensions are drawn on their views from what `elements` says their
 * elements are (by the dimension's id); what each came to, its text or why it could not be drawn, is in `dimensions`. `features` is what each view can be dimensioned
 * from (by view id): the centre marks and lines are drawn from it, and the hole tables are made from it (their rows are in `tables`). `boms` is what the views of
 * assemblies say of what they show (by view id): the parts lists and their balloons are drawn from it.
 */
export function buildScene(
  doc: DrawingDoc,
  lines: ReadonlyMap<Id, ViewLines | null>,
  elements: ReadonlyMap<Id, ElementsResult> = new Map(),
  features: ReadonlyMap<Id, readonly ViewFeature[]> = new Map(),
  boms: ReadonlyMap<Id, ViewBom> = new Map(),
): { scene: Scene; placed: Map<Id, PlacedView>; dimensions: Map<Id, DimensionOutcome>; tables: Map<Id, HoleRow[]>; tableBoxes: Map<Id, Rect>; balloons: Map<Id, BalloonSpot[]> } {
  // Every text on the sheet is the sheet's own language, not the reader's (ADR 0128): a drawing leaves the program and goes to whoever machines the part.
  // The build is synchronous from here down, so scoping the language over it is safe.
  const pg = page(doc);
  return withLocale(pg.sheet.language ?? getLocale(), () => buildSceneIn(doc, lines, elements, features, boms));
}

function buildSceneIn(
  doc: DrawingDoc,
  lines: ReadonlyMap<Id, ViewLines | null>,
  elements: ReadonlyMap<Id, ElementsResult>,
  features: ReadonlyMap<Id, readonly ViewFeature[]>,
  boms: ReadonlyMap<Id, ViewBom>,
): { scene: Scene; placed: Map<Id, PlacedView>; dimensions: Map<Id, DimensionOutcome>; tables: Map<Id, HoleRow[]>; tableBoxes: Map<Id, Rect>; balloons: Map<Id, BalloonSpot[]> } {
  const pg = page(doc);
  const m = sheetMetrics(pg.sheet);
  const placed = layoutViews(doc, lines);
  const resolved = resolveLines(doc, lines);
  const items: SceneItem[] = [...sheetItems(doc)];
  const images: SceneImage[] = [];
  // what a note's $PRP:key stands for: a field of the title block, else a property of the drawing
  const lookup = (key: string): string | undefined => (pg.title as Record<string, string | undefined>)[key] ?? doc.properties?.[key];
  for (const v of pg.views) {
    const own = placed.get(v.id)!;
    const image = viewImage(v, resolved.get(v.id), own);
    if (image) images.push(image);
    items.push(...viewItems(v, resolved.get(v.id), own, hatchStyleOf(v, pg.views)));
    if (!resolved.get(v.id)) continue;
    // The view's name under it. A section, a local section, a detail and an auxiliary view are named by the letter they carry (ISO 128-30: 「A–A」, 「L」), which
    // their own items already write, so only the rest are named here; without it a reader has the lines and no way to tell which view is which.
    if (v.kind !== 'section' && v.kind !== 'sectionLocal' && v.kind !== 'detail' && v.kind !== 'auxiliary') items.push({ kind: 'text', at: [own.at[0], own.at[1] - own.h / 2 - 8], text: v.name, height: 5, anchor: 'center' });
    items.push(...bendTableItems(v, resolved.get(v.id), own));
    items.push(...centreItems(v, features.get(v.id) ?? [], own));
    items.push(...surfaceFinishItems(pg.surfaceFinishes.filter((f) => f.view === v.id), own));
    items.push(...threadItems(v, features.get(v.id) ?? [], own));
    items.push(...annotationItems((pg.annotations ?? []).filter((a) => a.view === v.id), own, lookup, pg.sheet.unit ?? 'mm'));
    const parent = v.kind === 'section' || v.kind === 'sectionLocal' || v.kind === 'detail' || v.kind === 'crop' || v.kind === 'auxiliary' ? placed.get(v.parent) : undefined;
    if ((v.kind === 'section' || v.kind === 'auxiliary') && parent) items.push(...sectionItems(v, parent, own));
    if (v.kind === 'sectionLocal' && parent) items.push(...localSectionItems(v, parent, own));
    if (v.kind === 'detail' && parent) items.push(...detailItems(v, parent, own, scaleOf(doc, v)));
    if (v.kind === 'crop' && parent) items.push(...cropItems(v, parent));
  }
  const dimensions = new Map<Id, DimensionOutcome>();
  const sceneDimensions: SceneDimension[] = [];
  for (const d of pg.dimensions ?? []) {
    const view = pg.views.find((v) => v.id === d.view);
    const own = view && resolved.get(view.id) ? placed.get(view.id) : undefined;
    const axes = view ? axesOf(pg.views, pg.sheet.projection, view) : null;
    if (!view || !own || !axes) continue; // nothing to draw it on yet
    const effective = d.kind === 'diameter' ? { ...d, calloutStyle: d.calloutStyle ?? pg.sheet.calloutStyle ?? 'text' } : d;
    const outcome = evaluateDimension(effective, elements.get(d.id), axes, own, pg.sheet.unit ?? 'mm', resolveDimStyle(pg.sheet.dimStyle, d.style));
    dimensions.set(d.id, outcome);
    if (!('error' in outcome)) {
      items.push(...outcome.items.map((i) => ({ ...i, group: d.id })));
      if (outcome.dxf) sceneDimensions.push({ id: d.id, text: outcome.text, textAt: outcome.dxf.textAt, geometry: outcome.dxf.geometry });
    }
  }
  const tables = new Map<Id, HoleRow[]>();
  const tableBoxes = new Map<Id, Rect>();
  const balloons = new Map<Id, BalloonSpot[]>();
  for (const table of pg.tables ?? []) {
    const own = resolved.get(table.view) ? placed.get(table.view) : undefined;
    if (!own) continue;
    if (table.kind === 'bom') {
      const bom = boms.get(table.view);
      if (!bom) continue;
      items.push(...bomTableItems(table, bom.rows, pg.sheet));
      tableBoxes.set(table.id, bomTableBox(table, bom.rows, pg.sheet));
      if (table.balloons) {
        const spots = balloonSpots(bom, resolved.get(table.view)?.anchors, own, table.balloonAt);
        balloons.set(table.id, spots);
        items.push(...spotItems(spots));
      }
      continue;
    }
    const rows = holeRows(features.get(table.view) ?? [], table.fits, pg.sheet.unit ?? 'mm', pg.sheet.calloutStyle ?? 'text');
    tables.set(table.id, rows);
    items.push(...holeTableItems(table, rows, own, pg.sheet, pg.sheet.unit ?? 'mm'));
    tableBoxes.set(table.id, holeTableBox(table, rows, pg.sheet, pg.sheet.unit ?? 'mm'));
  }
  const scene: Scene = { width: m.width, height: m.height, items, ...(sceneDimensions.length > 0 ? { dimensions: sceneDimensions } : {}), ...(images.length > 0 ? { images } : {}), ...(pg.sheet.dimStyle ? { dimStyle: resolveDimStyle(pg.sheet.dimStyle) } : {}) };
  return { scene, placed, dimensions, tables, tableBoxes, balloons };
}

export type { TitleField };
