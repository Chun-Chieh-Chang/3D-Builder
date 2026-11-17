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

/** Whether the segment from a to b passes through the inside of the box (x0, y0, x1, y1): Liang–Barsky clipping. */
function crosses(a: readonly [number, number], b: readonly [number, number], box: readonly [number, number, number, number]): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: [number, number][] = [[-dx, a[0] - box[0]], [dx, box[2] - a[0]], [-dy, a[1] - box[1]], [dy, box[3] - a[1]]];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return t1 - t0 > 1e-9;
}

export interface Clutter {
  /** Places where a text is hard to read: two texts over each other, a dimension's text crossed by a line that is not its own, an annotation's text crossed by a dimension's line. */
  count: number;
  /** The texts concerned (each once), for the agent to say which. */
  texts: string[];
  /** Pairs of dimensions (by id) whose lines cross. */
  crossings?: string[];
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
  const tips = new Map<string, [number, number][]>();
  for (const i of items)
    if (i.kind === 'polyline' && i.filled && i.group !== undefined)
      for (let k = 0; k + 1 < i.points.length; k += 2) tips.set(i.group, [...(tips.get(i.group) ?? []), [i.points[k]!, i.points[k + 1]!]]);
  const endsAtArrow = (l: Extract<SceneItem, { kind: 'polyline' }>) => {
    const t = tips.get(l.group!) ?? [];
    const n = l.points.length;
    const ends: [number, number][] = n >= 4 ? [[l.points[0]!, l.points[1]!], [l.points[n - 2]!, l.points[n - 1]!]] : [];
    return ends.some(([x, y]) => t.some(([u, v]) => Math.hypot(x - u, y - v) < 0.3));
  };
  const arrowed = new Set(lines.filter((l) => l.group !== undefined && endsAtArrow(l)));
  // the box of each view's own lines: a caption or a number inside another view's box is in that view, whether a line crosses it or not
  const viewBoxes = new Map<string, [number, number, number, number]>();
  for (const l of lines) {
    if (!l.owner?.startsWith('view:')) continue;
    const b = viewBoxes.get(l.owner) ?? [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k + 1 < l.points.length; k += 2) {
      b[0] = Math.min(b[0], l.points[k]!);
      b[1] = Math.min(b[1], l.points[k + 1]!);
      b[2] = Math.max(b[2], l.points[k]!);
      b[3] = Math.max(b[3], l.points[k + 1]!);
    }
    viewBoxes.set(l.owner, b);
  }
  const bad = new Set<number>();
  let count = 0;
  for (let i = 0; i < texts.length; i++) {
    const a = texts[i]!;
    for (let j = i + 1; j < texts.length; j++) {
      const b = texts[j]!;
      if (a.who !== undefined && a.who === b.who) continue;
      if (a.box[0] < b.box[2] && b.box[0] < a.box[2] && a.box[1] < b.box[3] && b.box[1] < a.box[3]) {
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
        if (owner !== own && a.box[0] < vb[2] && vb[0] < a.box[2] && a.box[1] < vb[3] && vb[1] < a.box[3]) {
          count++;
          bad.add(i);
        }
    }
    for (const l of lines) {
      const who = whose(l);
      if (who === undefined) continue;
      // its own dimension line carries the number; its own extension lines must not cross it (a number slid past them)
      if (who === a.who && (a.t.group === undefined || arrowed.has(l))) continue;
      // an annotation or a caption may sit on the part; a dimension's number may not be crossed by anything
      if (!strict && who.startsWith('view:')) continue;
      const p = l.points;
      let hit = false;
      for (let k = 0; k + 3 < p.length && !hit; k += 2) hit = crosses([p[k]!, p[k + 1]!], [p[k + 2]!, p[k + 3]!], a.box);
      if (!hit && l.closed && p.length >= 4) hit = crosses([p[p.length - 2]!, p[p.length - 1]!], [p[0]!, p[1]!], a.box);
      if (hit) {
        count++;
        bad.add(i);
      }
    }
  }
  // a dimension line or a leader crossed by another dimension's line (ISO 129-1: extension lines may cross each other where it cannot be helped — the
  // places of a pattern of holes — but nothing should cross a dimension line or a leader). A dimension line and a leader are the lines that end at an
  // arrowhead of their own dimension; lines that only meet or run along each other (a shared datum's extension line) do not count.
  const dimLines = lines.filter((l) => l.group !== undefined).map((l) => ({ group: l.group, points: l.points, arrow: arrowed.has(l) }));
  const segs = (l: { points: number[] }) => {
    const out: [number, number, number, number][] = [];
    for (let k = 0; k + 3 < l.points.length; k += 2) out.push([l.points[k]!, l.points[k + 1]!, l.points[k + 2]!, l.points[k + 3]!]);
    return out;
  };
  const pairs = new Set<string>();
  for (let i = 0; i < dimLines.length; i++)
    for (let j = i + 1; j < dimLines.length; j++) {
      const a = dimLines[i]!;
      const b = dimLines[j]!;
      if (a.group === b.group || (!a.arrow && !b.arrow)) continue;
      const key = a.group! < b.group! ? `${a.group}|${b.group}` : `${b.group}|${a.group}`;
      if (pairs.has(key)) continue;
      if (segs(a).some((s) => segs(b).some((t) => properCross(s, t)))) pairs.add(key);
    }
  count += pairs.size;
  // a dimension line or leader through the lines of a view: a row pushed into a neighbouring view. A leader runs into its own view to the hole it points
  // at, so only the views other than the dimension's own are counted, and a line counts once.
  const viewLines = lines.filter((l) => l.owner?.startsWith('view:'));
  for (const d of dimLines) {
    if (!d.arrow) continue;
    if (viewLines.some((v) => v.owner !== `view:${viewOfGroup.get(d.group!) ?? ''}` && segs(d).some((sg) => segs(v).some((t) => properCross(sg, t))))) count++;
  }
  return { count, texts: [...bad].map((i) => texts[i]!.t.text), ...(pairs.size ? { crossings: [...pairs] } : {}) };
}

/** Whether two segments cross each other at a point inside both (not at an end, not along each other). */
function properCross(s: readonly [number, number, number, number], t: readonly [number, number, number, number]): boolean {
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const eps = 1e-6;
  const d1 = o(s[0], s[1], s[2], s[3], t[0], t[1]);
  const d2 = o(s[0], s[1], s[2], s[3], t[2], t[3]);
  const d3 = o(t[0], t[1], t[2], t[3], s[0], s[1]);
  const d4 = o(t[0], t[1], t[2], t[3], s[2], s[3]);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}
