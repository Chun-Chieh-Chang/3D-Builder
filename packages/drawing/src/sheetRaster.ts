import type { Scene, SceneItem } from './scene';
import type { ShadeRaster } from './shade';
import type { TrueTypeFont } from './ttf';
import { CALLOUT_SYMBOL_FALLBACKS } from './calloutSymbols';

/**
 * A picture of a whole sheet (ADR 0256), made without a browser: the lines of the scene drawn into pixels, the arrowheads filled and the texts drawn from
 * the outlines of a TrueType font when one is given — so that an agent that made a drawing can look at it, read its numbers and see where they crowd, as
 * CADCraft's `render` lets its agent look at what it drew. With no font a text is drawn as the box it takes, which still shows where it is.
 *
 * Only what the picture needs is drawn: the lines' own widths (in tenths of a millimetre at most a few pixels), no dashes (a hidden line is drawn grey
 * instead), no shading. It is for looking at, not for printing: the PDF and the DXF are the drawing.
 */

export interface SheetRasterOptions {
  /** Pixels per millimetre of the sheet. Absent: 4 (an A3 sheet is 1680 × 1188). */
  px?: number;
  font?: TrueTypeFont;
  /** Only this part of the sheet (mm, the sheet's coordinates with y up). */
  window?: { x0: number; y0: number; x1: number; y1: number };
}

type RGB = readonly [number, number, number];
const INK: Record<string, RGB> = { visible: [0, 0, 0], hidden: [140, 140, 150], center: [40, 110, 60], thin: [60, 60, 60], frame: [0, 0, 0], dimension: [20, 70, 170] };
const TEXT: RGB = [20, 70, 170];
const MAX_PIXELS = 12_000_000;

export function rasterizeSheet(scene: Scene, options: SheetRasterOptions = {}): ShadeRaster {
  const win = options.window ?? { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
  if (!(win.x1 > win.x0 && win.y1 > win.y0)) throw new Error('the window of the sheet to draw is empty');
  let px = options.px ?? 4;
  if (!(Number.isFinite(px) && px > 0)) throw new Error(`pixels per millimetre must be a positive number, not ${px}`);
  // never a picture larger than the cap: a large sheet is drawn with fewer pixels to the millimetre rather than refused
  px = Math.min(px, Math.sqrt(MAX_PIXELS / ((win.x1 - win.x0) * (win.y1 - win.y0))));
  const width = Math.max(1, Math.round((win.x1 - win.x0) * px));
  const height = Math.max(1, Math.round((win.y1 - win.y0) * px));
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const image: ShadeRaster = { width, height, rgba, px, box: { min: [win.x0, win.y0], max: [win.x1, win.y1] }, depth: new Float32Array(0) };
  const toPx = (x: number, y: number): [number, number] => [(x - win.x0) * px, (win.y1 - y) * px];
  const put = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = c[0];
    rgba[i + 1] = c[1];
    rgba[i + 2] = c[2];
    rgba[i + 3] = 255;
  };
  const segment = (a: [number, number], b: [number, number], c: RGB, w: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const half = (w - 1) / 2;
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n;
      const y = a[1] + ((b[1] - a[1]) * k) / n;
      for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) put(Math.floor(x - half + dx), Math.floor(y - half + dy), c);
    }
  };
  const fill = (rings: [number, number][][], c: RGB) => {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const r of rings) for (const p of r) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    if (!(y0 <= y1)) return;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(height - 1, Math.ceil(y1)); y++) {
      const sy = y + 0.5;
      const hits: { x: number; w: number }[] = [];
      for (const r of rings)
        for (let i = 0; i < r.length; i++) {
          const a = r[i]!;
          const b = r[(i + 1) % r.length]!;
          if (a[1] === b[1]) continue;
          const up = a[1] < b[1];
          const lo = up ? a : b;
          const hi = up ? b : a;
          if (sy < lo[1] || sy >= hi[1]) continue;
          hits.push({ x: lo[0] + ((sy - lo[1]) * (hi[0] - lo[0])) / (hi[1] - lo[1]), w: up ? 1 : -1 });
        }
      hits.sort((p, q) => p.x - q.x);
      let wind = 0;
      for (let i = 0; i < hits.length; i++) {
        const before = wind;
        wind += hits[i]!.w;
        if (before !== 0 && i > 0) for (let x = Math.max(0, Math.round(hits[i - 1]!.x)); x < Math.min(width, Math.round(hits[i]!.x)); x++) put(x, y, c);
      }
    }
  };

  const drawPolyline = (it: Extract<SceneItem, { kind: 'polyline' }>) => {
    const c = INK[it.style] ?? INK.thin!;
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < it.points.length; i += 2) pts.push(toPx(it.points[i]!, it.points[i + 1]!));
    if (it.filled && pts.length >= 3) return fill([pts], c);
    const w = it.style === 'visible' || it.style === 'frame' ? Math.max(1, Math.round(0.35 * px)) : 1;
    for (let i = 0; i + 1 < pts.length; i++) segment(pts[i]!, pts[i + 1]!, c, w);
    if (it.closed && pts.length > 2) segment(pts[pts.length - 1]!, pts[0]!, c, w);
  };

  const drawText = (it: Extract<SceneItem, { kind: 'text' }>) => {
    const font = options.font;
    const a = ((it.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const chars = [...it.text];
    if (!font) {
      const w = chars.reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 1.4 : 0.62) * it.height, 0);
      const left = it.anchor === 'center' ? -w / 2 : it.anchor === 'right' ? -w : 0;
      const corners = [[left, 0], [left + w, 0], [left + w, it.height], [left, it.height]].map(([u, v]) => toPx(it.at[0] + u! * cos - v! * sin, it.at[1] + u! * sin + v! * cos));
      for (let i = 0; i < 4; i++) segment(corners[i]!, corners[(i + 1) % 4]!, TEXT, 1);
      return;
    }
    const s = it.height / font.capHeight; // font units to mm
    // the characters as the PDF writes them (pdf.ts): a symbol the font lacks as its words, Ø and ⌀ for each other, else 「?」 — so the picture shows what the PDF will
    const written = [...it.text.replace(/[↧⌴⌵]/g, (ch) => (font.glyphOf(ch.codePointAt(0)!) ? ch : CALLOUT_SYMBOL_FALLBACKS[ch]!))];
    const glyphs = written.map((ch) => {
      const c = ch.codePointAt(0)!;
      let g = font.glyphOf(c);
      if (g === 0) g = c === 0x2300 ? font.glyphOf(0xd8) : c === 0xd8 ? font.glyphOf(0x2300) : c === 0x3000 ? font.glyphOf(0x20) : 0;
      return g > 0 ? g : font.glyphOf(0x3f);
    });
    const w = glyphs.reduce((n, g) => n + font.advance(g) * s, 0);
    let u = it.anchor === 'center' ? -w / 2 : it.anchor === 'right' ? -w : 0;
    const rings: [number, number][][] = [];
    for (const g of glyphs) {
      for (const contour of glyphOutline(font, g))
        rings.push(contour.map(([gx, gy]) => {
          const x = u + gx * s;
          const y = gy * s;
          return toPx(it.at[0] + x * cos - y * sin, it.at[1] + x * sin + y * cos);
        }));
      u += font.advance(g) * s;
    }
    fill(rings, TEXT);
  };

  for (const it of scene.items) if (it.kind === 'polyline') drawPolyline(it);
  for (const it of scene.items) if (it.kind === 'text') drawText(it);
  return image;
}

// ------------------------------------------------------------------------------------------------------------- TrueType outlines

const outlineCache = new WeakMap<TrueTypeFont, Map<number, [number, number][][]>>();

/**
 * The outline of a glyph of a TrueType font (the `glyf` table) as closed polygons in font units, the quadratic curves flattened. A composite glyph is its
 * components put together. A font with no `glyf` table (CFF outlines) gives nothing, and a glyph that cannot be read gives nothing: the text is then
 * only missing from the picture, never wrong in the drawing.
 */
export function glyphOutline(font: TrueTypeFont, glyph: number, depth = 0): [number, number][][] {
  let cache = outlineCache.get(font);
  if (!cache) outlineCache.set(font, (cache = new Map()));
  const hit = cache.get(glyph);
  if (hit) return hit;
  let out: [number, number][][] = [];
  try {
    out = readGlyph(font, glyph, depth);
  } catch {
    out = [];
  }
  cache.set(glyph, out);
  return out;
}

function readGlyph(font: TrueTypeFont, glyph: number, depth: number): [number, number][][] {
  const head = font.tables.get('head');
  const loca = font.tables.get('loca');
  const glyf = font.tables.get('glyf');
  if (!head || !loca || !glyf || depth > 8 || glyph < 0 || glyph >= font.numGlyphs) return [];
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const long = hv.getInt16(50) === 1;
  const lv = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
  const start = long ? lv.getUint32(glyph * 4) : lv.getUint16(glyph * 2) * 2;
  const end = long ? lv.getUint32(glyph * 4 + 4) : lv.getUint16(glyph * 2 + 2) * 2;
  if (end <= start) return [];
  const v = new DataView(glyf.buffer, glyf.byteOffset + start, end - start);
  const contours = v.getInt16(0);
  if (contours < 0) return composite(font, v, depth);
  let o = 10;
  const ends: number[] = [];
  for (let i = 0; i < contours; i++, o += 2) ends.push(v.getUint16(o));
  const n = ends.length ? ends[ends.length - 1]! + 1 : 0;
  o += 2 + v.getUint16(o); // the instructions
  const flags: number[] = [];
  while (flags.length < n) {
    const f = v.getUint8(o++);
    flags.push(f);
    if (f & 8) {
      const r = v.getUint8(o++);
      for (let k = 0; k < r; k++) flags.push(f);
    }
  }
  const xs: number[] = [];
  let x = 0;
  for (const f of flags) {
    if (f & 2) x += (f & 16 ? 1 : -1) * v.getUint8(o++);
    else if (!(f & 16)) {
      x += v.getInt16(o);
      o += 2;
    }
    xs.push(x);
  }
  const ys: number[] = [];
  let y = 0;
  for (const f of flags) {
    if (f & 4) y += (f & 32 ? 1 : -1) * v.getUint8(o++);
    else if (!(f & 32)) {
      y += v.getInt16(o);
      o += 2;
    }
    ys.push(y);
  }
  const out: [number, number][][] = [];
  let first = 0;
  for (const last of ends) {
    const pts = [];
    for (let i = first; i <= last; i++) pts.push({ x: xs[i]!, y: ys[i]!, on: (flags[i]! & 1) === 1 });
    first = last + 1;
    if (pts.length > 1) out.push(flatten(pts));
  }
  return out;
}

/** A contour of on- and off-curve points (two off-curve points in a row have an on-curve point between them) as a polygon. */
function flatten(pts: { x: number; y: number; on: boolean }[]): [number, number][] {
  // start at an on-curve point, the middle of the first two when there is none
  let s = pts.findIndex((p) => p.on);
  const ring = s < 0 ? [{ x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2, on: true }, ...pts] : [...pts.slice(s), ...pts.slice(0, s)];
  s = 0;
  const out: [number, number][] = [[ring[0]!.x, ring[0]!.y]];
  let prev = ring[0]!;
  for (let i = 1; i <= ring.length; i++) {
    const p = ring[i % ring.length]!;
    if (p.on) {
      out.push([p.x, p.y]);
      prev = p;
      continue;
    }
    const nx = ring[(i + 1) % ring.length]!;
    const to = nx.on ? nx : { x: (p.x + nx.x) / 2, y: (p.y + nx.y) / 2, on: true };
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      out.push([a * prev.x + b * p.x + c * to.x, a * prev.y + b * p.y + c * to.y]);
    }
    prev = to;
    if (nx.on) i++;
  }
  return out;
}

function composite(font: TrueTypeFont, v: DataView, depth: number): [number, number][][] {
  const out: [number, number][][] = [];
  let o = 10;
  for (;;) {
    const flags = v.getUint16(o);
    const glyph = v.getUint16(o + 2);
    o += 4;
    let dx = 0;
    let dy = 0;
    if (flags & 1) {
      dx = v.getInt16(o);
      dy = v.getInt16(o + 2);
      o += 4;
    } else {
      dx = v.getInt8(o);
      dy = v.getInt8(o + 1);
      o += 2;
    }
    if (!(flags & 2)) dx = dy = 0; // point matching: not used by the fonts a drawing writes with; the component is put at its own place
    let [a, b, c, d] = [1, 0, 0, 1];
    const f2 = (k: number) => v.getInt16(k) / 16384;
    if (flags & 8) {
      a = d = f2(o);
      o += 2;
    } else if (flags & 0x40) {
      a = f2(o);
      d = f2(o + 2);
      o += 4;
    } else if (flags & 0x80) {
      a = f2(o);
      b = f2(o + 2);
      c = f2(o + 4);
      d = f2(o + 6);
      o += 8;
    }
    for (const ring of glyphOutline(font, glyph, depth + 1)) out.push(ring.map(([x, y]) => [a * x + c * y + dx, b * x + d * y + dy]));
    if (!(flags & 0x20)) break;
  }
  return out;
}
