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
