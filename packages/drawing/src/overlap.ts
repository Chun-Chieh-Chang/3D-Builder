import type { SceneItem, SceneText } from './scene';

/** A text is drawn with a font 1.4 times its height (svg.ts): a Chinese character is as wide as that font is tall, any other about 0.62 of the height. */
const widthOf = (text: string, height: number) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1.4 : 0.62) * height, 0);

/** The box a text covers on the sheet: x0, y0, x1, y1 (the box of the turned box when the text is at an angle). */
function boxOf(t: SceneText): [number, number, number, number] {
  const w = widthOf(t.text, t.height);
  const left = t.anchor === 'center' ? -w / 2 : t.anchor === 'right' ? -w : 0;
  const corners: [number, number][] = [[left, 0], [left + w, 0], [left + w, t.height], [left, t.height]];
  const a = ((t.angle ?? 0) * Math.PI) / 180;
  const pts = corners.map(([x, y]) => [t.at[0] + x * Math.cos(a) - y * Math.sin(a), t.at[1] + x * Math.sin(a) + y * Math.cos(a)]);
  return [Math.min(...pts.map((p) => p[0]!)), Math.min(...pts.map((p) => p[1]!)), Math.max(...pts.map((p) => p[0]!)), Math.max(...pts.map((p) => p[1]!))];
}

/**
 * How many of the dimensions (by id, the `group` of the items drawn for them) have a text that lies over the text of another dimension. Boxes that merely touch
 * do not count; a dimension is counted once however many it overlaps. This is the check behind 「標註互相重疊，建議改用孔表」.
 */
export function overlappingDimensions(items: readonly SceneItem[], ids: ReadonlySet<string>): number {
  const texts = items.filter((i): i is SceneText => i.kind === 'text' && i.group !== undefined && ids.has(i.group)).map((t) => ({ id: t.group!, box: boxOf(t) }));
  const over = new Set<string>();
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!;
      const b = texts[j]!;
      if (a.id === b.id) continue;
      const eps = 1e-6;
      if (a.box[0] < b.box[2] - eps && b.box[0] < a.box[2] - eps && a.box[1] < b.box[3] - eps && b.box[1] < a.box[3] - eps) {
        over.add(a.id);
        over.add(b.id);
      }
    }
  }
  return over.size;
}

/** Whether the segment from (ax, ay) to (bx, by) passes through the inside of the box (bx0, by0, bx1, by1): Liang–Barsky clipping. */
function crossesBox(ax: number, ay: number, bx: number, by: number, bx0: number, by0: number, bx1: number, by1: number): boolean {
  if ((ax < bx0 && bx < bx0) || (ax > bx1 && bx > bx1) || (ay < by0 && by < by0) || (ay > by1 && by > by1)) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) < 1e-12) {
    if (ax < bx0 || ax > bx1) return false;
  } else {
    let r = (ax - bx0) / -dx;
    if (-dx < 0) { if (r > t0) t0 = r; } else { if (r < t1) t1 = r; }
    r = (bx1 - ax) / dx;
    if (dx < 0) { if (r > t0) t0 = r; } else { if (r < t1) t1 = r; }
    if (t0 > t1) return false;
  }
  if (Math.abs(dy) < 1e-12) {
    if (ay < by0 || ay > by1) return false;
  } else {
    let r = (ay - by0) / -dy;
    if (-dy < 0) { if (r > t0) t0 = r; } else { if (r < t1) t1 = r; }
    r = (by1 - ay) / dy;
    if (dy < 0) { if (r > t0) t0 = r; } else { if (r < t1) t1 = r; }
    if (t0 > t1) return false;
  }
  return t1 - t0 > 1e-9;
}

interface LineInfo {
  l: Extract<SceneItem, { kind: 'polyline' }>;
  who: string | undefined;
  arrow: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Whether any segment of polyline `a` properly crosses any segment of polyline `b`. */
function polylinesCross(a: LineInfo, b: LineInfo): boolean {
  if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) return false;
  const ap = a.l.points;
  const bp = b.l.points;
  for (let i = 0; i + 3 < ap.length; i += 2) {
    const ax = ap[i]!, ay = ap[i + 1]!, bx = ap[i + 2]!, by = ap[i + 3]!;
    const ax0 = ax < bx ? ax : bx;
    const ax1 = ax > bx ? ax : bx;
    if (ax1 < b.x0 || ax0 > b.x1) continue;
    const ay0 = ay < by ? ay : by;
    const ay1 = ay > by ? ay : by;
    if (ay1 < b.y0 || ay0 > b.y1) continue;
    for (let j = 0; j + 3 < bp.length; j += 2) {
      if (properCrossRaw(ax, ay, bx, by, bp[j]!, bp[j + 1]!, bp[j + 2]!, bp[j + 3]!)) return true;
    }
  }
  return false;
}

export interface Clutter {
  /** Places where a text is hard to read: two texts over each other, a dimension's text crossed by a line that is not its own, an annotation's text crossed by a dimension's line. */
  count: number;
  /** The texts concerned (each once), for the agent to say which. */
  texts: string[];
  /** Pairs of dimensions (by id) whose lines cross. */
  crossings?: string[];
  /** Dimension/annotation group ids involved in any clutter (for fast targeted steering). */
  groups?: string[];
}

/**
 * How cluttered a sheet's texts are (ADR 0256), beyond `overlappingDimensions`: any text over any other (a note over a dimension, a hole callout over a
 * caption), a dimension's text crossed by another dimension's line or by the part's lines, and an annotation's or a caption's text crossed by a dimension's
 * line. A text and its own lines (its leader, its frame, its symbol) are never counted against each other; the part's lines are counted only against
 * dimension texts, since a note or a symbol is often meant to sit on the part. Each text's box is shrunk by `slack` mm so that touching is not crossing.
 * `items` are what the views draw (without the sheet's frame and title block); `viewOfGroup` says which view each dimension is on, so that a dimension line
 * through another view's lines is counted (a leader into its own view to the hole it marks is not).
 */
export function clutterOf(items: readonly SceneItem[], slack = 0.3, viewOfGroup: ReadonlyMap<string, string> = new Map()): Clutter {
  /** Who drew an item: a dimension (its group), a view's own lines, a caption, an annotation; nothing for what no one owns. */
  const whose = (i: SceneItem) => i.group ?? i.owner;
  const texts = items.filter((i): i is SceneText => i.kind === 'text' && i.text.trim() !== '').map((t) => {
    const b = boxOf(t);
    // a view's caption is a title: it keeps 2 mm more clear of everything than a number does
    const k = whose(t)?.startsWith('caption:') ? slack - 2 : slack;
    return { t, who: whose(t), box: [b[0] + k, b[1] + k, b[2] - k, b[3] - k] as [number, number, number, number] };
  });
  const lines = items.filter((i): i is Extract<SceneItem, { kind: 'polyline' }> => i.kind === 'polyline' && !i.filled);
  // a dimension line and a leader are the lines that end at an arrowhead of their own dimension; the others of a dimension are its extension lines
  const tips = new Map<string, number[]>();
  for (const i of items) {
    if (i.kind === 'polyline' && i.filled && i.group !== undefined) {
      let arr = tips.get(i.group);
      if (!arr) {
        arr = [];
        tips.set(i.group, arr);
      }
      for (let k = 0; k + 1 < i.points.length; k += 2) arr.push(i.points[k]!, i.points[k + 1]!);
    }
  }
  const endsAtArrow = (l: Extract<SceneItem, { kind: 'polyline' }>) => {
    const t = tips.get(l.group!);
    if (!t || t.length === 0) return false;
    const p = l.points;
    const n = p.length;
    if (n < 4) return false;
    const x0 = p[0]!, y0 = p[1]!, x1 = p[n - 2]!, y1 = p[n - 1]!;
    for (let k = 0; k + 1 < t.length; k += 2) {
      const u = t[k]!, v = t[k + 1]!;
      if (Math.hypot(x0 - u, y0 - v) < 0.3 || Math.hypot(x1 - u, y1 - v) < 0.3) return true;
    }
    return false;
  };
  // precompute polyline AABBs, view boxes, dimLines and viewLinesByOwner in one pass
  const viewBoxes = new Map<string, [number, number, number, number]>();
  const viewLinesByOwner = new Map<string, LineInfo[]>();
  const dimLines: LineInfo[] = [];
  const ownedLines: LineInfo[] = [];
  for (const l of lines) {
    const p = l.points;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k + 1 < p.length; k += 2) {
      const x = p[k]!, y = p[k + 1]!;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    const who = whose(l);
    const arrow = l.group !== undefined && endsAtArrow(l);
    const info: LineInfo = { l, who, arrow, x0, y0, x1, y1 };
    if (who !== undefined) ownedLines.push(info);
    if (l.group !== undefined) dimLines.push(info);
    if (l.owner?.startsWith('view:')) {
      let vb = viewBoxes.get(l.owner);
      if (!vb) {
        vb = [x0, y0, x1, y1];
        viewBoxes.set(l.owner, vb);
      } else {
        if (x0 < vb[0]) vb[0] = x0;
        if (y0 < vb[1]) vb[1] = y0;
        if (x1 > vb[2]) vb[2] = x1;
        if (y1 > vb[3]) vb[3] = y1;
      }
      let vl = viewLinesByOwner.get(l.owner);
      if (!vl) {
        vl = [];
        viewLinesByOwner.set(l.owner, vl);
      }
      vl.push(info);
    }
  }
  const bad = new Set<number>();
  let count = 0;
  for (let i = 0; i < texts.length; i++) {
    const a = texts[i]!;
    const [bx0, by0, bx1, by1] = a.box;
    for (let j = i + 1; j < texts.length; j++) {
      const b = texts[j]!;
      if (a.who !== undefined && a.who === b.who) continue;
      if (bx0 < b.box[2] && b.box[0] < bx1 && by0 < b.box[3] && b.box[1] < by1) {
        count++;
        bad.add(i);
        bad.add(j);
      }
    }
    // a dimension's number and a view's caption must stay off every line; an annotation (a note, a symbol) may sit on the part it marks
    const strict = a.t.group !== undefined || a.who?.startsWith('caption:') === true;
    if (a.who?.startsWith('caption:')) {
      const own = `view:${a.who.slice('caption:'.length)}`;
      for (const [owner, vb] of viewBoxes)
        if (owner !== own && bx0 < vb[2] && vb[0] < bx1 && by0 < vb[3] && vb[1] < by1) {
          count++;
          bad.add(i);
        }
    }
    for (const li of ownedLines) {
      if (li.x1 < bx0 || li.x0 > bx1 || li.y1 < by0 || li.y0 > by1) continue;
      const who = li.who!;
      // its own dimension line carries the number; its own extension lines must not cross it (a number slid past them)
      if (who === a.who && (a.t.group === undefined || li.arrow)) continue;
      // an annotation or a caption may sit on the part; a dimension's number may not be crossed by anything
      if (!strict && who.startsWith('view:')) continue;
      const p = li.l.points;
      let hit = false;
      for (let k = 0; k + 3 < p.length && !hit; k += 2) hit = crossesBox(p[k]!, p[k + 1]!, p[k + 2]!, p[k + 3]!, bx0, by0, bx1, by1);
      if (!hit && li.l.closed && p.length >= 4) hit = crossesBox(p[p.length - 2]!, p[p.length - 1]!, p[0]!, p[1]!, bx0, by0, bx1, by1);
      if (hit) {
        count++;
        bad.add(i);
      }
    }
  }
  // a dimension line or a leader crossed by another dimension's line (ISO 129-1: extension lines may cross each other where it cannot be helped — the
  // places of a pattern of holes — but nothing should cross a dimension line or a leader). A dimension line and a leader are the lines that end at an
  // arrowhead of their own dimension; lines that only meet or run along each other (a shared datum's extension line) do not count.
  const pairs = new Set<string>();
  for (let i = 0; i < dimLines.length; i++)
    for (let j = i + 1; j < dimLines.length; j++) {
      const a = dimLines[i]!;
      const b = dimLines[j]!;
      if (a.l.group === b.l.group || (!a.arrow && !b.arrow)) continue;
      const ag = a.l.group!;
      const bg = b.l.group!;
      const key = ag < bg ? `${ag}|${bg}` : `${bg}|${ag}`;
      if (pairs.has(key)) continue;
      if (polylinesCross(a, b)) pairs.add(key);
    }
  count += pairs.size;
  // a dimension line or leader through the lines of a view: a row pushed into a neighbouring view. A leader runs into its own view to the hole it points
  // at, so only the views other than the dimension's own are counted, and a line counts once.
  const badGroups = new Set<string>();
  for (const i of bad) {
    const g = texts[i]!.t.group;
    if (g !== undefined) badGroups.add(g);
  }
  for (const pair of pairs) {
    const [g1, g2] = pair.split('|');
    if (g1) badGroups.add(g1);
    if (g2) badGroups.add(g2);
  }
  for (const d of dimLines) {
    if (!d.arrow) continue;
    const ownView = `view:${viewOfGroup.get(d.l.group!) ?? ''}`;
    let hit = false;
    for (const [owner, vLines] of viewLinesByOwner) {
      if (owner === ownView) continue;
      const vb = viewBoxes.get(owner);
      if (vb && (d.x1 < vb[0] || vb[2] < d.x0 || d.y1 < vb[1] || vb[3] < d.y0)) continue;
      for (const v of vLines) {
        if (polylinesCross(d, v)) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      count++;
      if (d.l.group !== undefined) badGroups.add(d.l.group);
    }
  }
  return { count, texts: [...bad].map((i) => texts[i]!.t.text), ...(pairs.size ? { crossings: [...pairs] } : {}), ...(badGroups.size ? { groups: [...badGroups] } : {}) };
}

/** Whether two segments cross each other at a point inside both (not at an end, not along each other). */
function properCrossRaw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  if ((ax < cx && ax < dx && bx < cx && bx < dx) || (ax > cx && ax > dx && bx > cx && bx > dx) || (ay < cy && ay < dy && by < cy && by < dy) || (ay > cy && ay > dy && by > cy && by > dy)) return false;
  const eps = 1e-6;
  const abx = bx - ax;
  const aby = by - ay;
  const d1 = abx * (cy - ay) - aby * (cx - ax);
  const d2 = abx * (dy - ay) - aby * (dx - ax);
  if (!((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps))) return false;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const d3 = cdx * (ay - cy) - cdy * (ax - cx);
  const d4 = cdx * (by - cy) - cdy * (bx - cx);
  return (d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps);
}
