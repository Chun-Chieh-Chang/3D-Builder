/**
 * ADR 0146 §7 (2026-10-20): the user saw lines across the faces of a shaded view — 「圖彩部份會出現突兀的線條，可能是原本應該被遮蔽的輪廓線」. Measured: the
 * kernel gave a view's tangent edges seen and hidden together (`Rg1LineV` + `Rg1LineH`) and the drawing drew all of them as thin lines, so the fillets at
 * the back of the locating plate were drawn across its top face. Now the hidden ones are apart (`tangentHidden`) and drawn only with the hidden lines.
 *
 * The ground truth is the part itself: each line is matched to the 3D edge it is the projection of (the edges of the part's mesh), and that edge's depth
 * there is compared with the depth buffer of the view's shading — seen when it is the nearest thing at that point, hidden when a face is in front of it.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, rightOf, sheetUp, viewVectors, type DrawingDoc, type ViewDisplay } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ProjectedView, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { buildScene, rasterizeShade, resolveLines, viewItems, type ShadeRaster, type ViewLines } from '@3db/drawing';

let kernel: Kernel;
let plate: ShapeId;
let iso: ProjectedView;
let raster: ShadeRaster;
/** The part's edges in the isometric view's coordinates: x, y and the depth toward the viewer of each point. */
let edges: [number, number, number][][];
const kept: Regenerator[] = [];
const axes = viewVectors('isometric');

beforeAll(async () => {
  kernel = await Kernel.load();
  const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  kept.push(regen);
  const file = await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))));
  plate = regen.rebuild(file.doc).body!.shape;
  iso = kernel.projectView(plate, axes, { mesh: true });
  raster = rasterizeShade(iso.mesh!, 20)!;
  const R = rightOf(axes);
  const U = sheetUp(axes);
  const n = Math.hypot(...axes.dir);
  const Z = axes.dir.map((x) => -x / n);
  const m = kernel.mesh(plate);
  edges = [];
  for (let k = 0; k < m.edgeRanges.length; k += 3) {
    const pts: [number, number, number][] = [];
    for (let i = m.edgeRanges[k]!; i < m.edgeRanges[k]! + m.edgeRanges[k + 1]!; i++) {
      const p = [m.edgePoints[3 * i]!, m.edgePoints[3 * i + 1]!, m.edgePoints[3 * i + 2]!];
      pts.push([p[0]! * R[0] + p[1]! * R[1] + p[2]! * R[2], p[0]! * U[0] + p[1]! * U[1] + p[2]! * U[2], p[0]! * Z[0]! + p[1]! * Z[1]! + p[2]! * Z[2]!]);
    }
    edges.push(pts);
  }
});

/** The middle of a polyline, along its length. */
function middle(l: readonly number[]): [number, number] {
  const seg = (i: number) => Math.hypot(l[i + 2]! - l[i]!, l[i + 3]! - l[i + 1]!);
  let total = 0;
  for (let i = 0; i + 3 < l.length; i += 2) total += seg(i);
  let left = total / 2;
  for (let i = 0; i + 3 < l.length; i += 2) {
    const s = seg(i);
    if (left <= s) return [l[i]! + ((l[i + 2]! - l[i]!) * left) / s, l[i + 1]! + ((l[i + 3]! - l[i + 1]!) * left) / s];
    left -= s;
  }
  return [l[0]!, l[1]!];
}

/** How far behind the nearest face a line's middle is (mm): the depth buffer there less the depth of the 3D edge the line is the projection of. */
function behind(l: readonly number[]): number {
  const [x, y] = middle(l);
  let best: { d: number; z: number } = { d: Infinity, z: 0 };
  for (const e of edges) {
    for (let i = 0; i + 1 < e.length; i++) {
      const [a, b] = [e[i]!, e[i + 1]!];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
      const d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
      if (d < best.d) best = { d, z: a[2] + t * (b[2] - a[2]) };
    }
  }
  // the line is the projection of a real edge of the part, to within the tessellation
  expect(best.d).toBeLessThan(1e-3);
  const i = Math.floor((x - raster.box.min[0]) * raster.px);
  const j = Math.floor((raster.box.max[1] - y) * raster.px);
  return raster.depth[j * raster.width + i]! - best.z;
}

describe('the tangent edges of a view, seen and hidden apart (ADR 0146 §7)', () => {
  it('the isometric of the locating plate: every seen tangent edge is the nearest thing where it is drawn, every hidden one is behind a face', () => {
    const seen = iso.tangent ?? [];
    const hidden = iso.tangentHidden ?? [];
    // both kinds are there: the fillets at the corners facing the viewer and those at the back
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(hidden.length).toBeGreaterThanOrEqual(3);
    for (const l of seen) expect(Math.abs(behind(l)), `seen ${l.slice(0, 4).map((v) => v.toFixed(2))}`).toBeLessThan(0.2);
    for (const l of hidden) expect(behind(l), `hidden ${l.slice(0, 4).map((v) => v.toFixed(2))}`).toBeGreaterThan(0.2);
  });

  it('a hidden tangent edge that lies on a seen line is not given twice', () => {
    const key = (l: readonly number[]) => l.map((v) => v.toFixed(6)).join(',');
    const seen = new Set([...iso.visible, ...(iso.tangent ?? [])].map(key));
    for (const l of iso.tangentHidden ?? []) expect(seen.has(key(l))).toBe(false);
  });
});

/** The plate's isometric on a sheet, in a display style, with its tangent edges shown or not. */
function drawing(display: ViewDisplay, showTangentEdges?: boolean): DrawingDoc {
  return applyDrawingCommand(createEmptyDrawing(), {
    type: 'insertViews',
    views: [{ id: 'i', name: 'I', source: 'p.3dbx', direction: 'isometric', at: [210, 150], display, ...(showTangentEdges === undefined ? {} : { showTangentEdges }) }],
  });
}
const linesOf = (): ViewLines => {
  const { mesh, ...lines } = iso;
  void mesh;
  return lines;
};
/** The view's polylines by style, and the set of all of them. */
function drawn(doc: DrawingDoc) {
  // the view's own lines, where the layout puts it (not the title block's, which are thin too)
  const placed = buildScene(doc, new Map([['i', linesOf()]])).placed.get('i')!;
  const items = viewItems(doc.pages[0]!.views[0]!, linesOf(), placed);
  const count = (style: string) => items.filter((x) => x.style === style).length;
  return { visible: count('visible'), hidden: count('hidden'), thin: count('thin'), all: new Set(items.map((x) => `${x.style}:${x.points.map((v) => v.toFixed(4)).join(',')}`)) };
}

describe('the drawing draws a hidden tangent edge only with the hidden lines (ADR 0146 §7)', () => {
  it('shaded with edges draws exactly what hidden lines removed draws: the seen edges and the seen tangent edges, nothing behind', () => {
    const t = iso.tangent!.length;
    const shadedEdges = drawn(drawing('shadedEdges'));
    const removed = drawn(drawing('hiddenRemoved'));
    expect(shadedEdges.all).toEqual(removed.all);
    expect(shadedEdges.thin).toBe(t);
    expect(shadedEdges.hidden).toBe(0);
    expect(shadedEdges.visible).toBe(iso.visible.length);
    // shaded without edges draws none of them
    const shaded = drawn(drawing('shaded'));
    expect(shaded.thin + shaded.hidden + shaded.visible).toBe(0);
  });

  it('hidden lines visible draws the hidden tangent edges dashed; a wireframe thin; with tangent edges off, none of either', () => {
    const t = iso.tangent!.length;
    const th = iso.tangentHidden!.length;
    const hv = drawn(drawing('hiddenVisible'));
    expect(hv.hidden).toBe(iso.hidden.length + th);
    expect(hv.thin).toBe(t);
    const wf = drawn(drawing('wireframe'));
    expect(wf.thin).toBe(t + th);
    expect(wf.visible).toBe(iso.visible.length + iso.hidden.length);
    const off = drawn(drawing('hiddenVisible', false));
    expect(off.hidden).toBe(iso.hidden.length);
    expect(off.thin).toBe(0);
  });

  it("a detail keeps its parent's hidden tangent edges apart, cut to its circle", () => {
    const doc = applyDrawingCommand(drawing('hiddenVisible'), { type: 'insertViews', views: [{ id: 'd', name: 'D', kind: 'detail', parent: 'i', centre: middle(iso.tangentHidden![0]!), radius: 5, label: 'Z' }] });
    const d = resolveLines(doc, new Map([['i', linesOf()]])).get('d')!;
    expect(d.tangentHidden!.length).toBeGreaterThan(0);
    const c = middle(iso.tangentHidden![0]!);
    for (const l of d.tangentHidden!) for (let k = 0; k < l.length; k += 2) expect(Math.hypot(l[k]! - c[0], l[k + 1]! - c[1])).toBeLessThanOrEqual(5 + 1e-9);
    // and its seen tangent edges are pieces of its parent's seen ones, never of the hidden ones: a point of each lies on a seen tangent edge of the parent
    const onAny = (x: number, y: number, ls: readonly number[][]) => ls.some((l) => { for (let k = 0; k + 3 < l.length; k += 2) { const dx = l[k + 2]! - l[k]!, dy = l[k + 3]! - l[k + 1]!; const s = Math.max(0, Math.min(1, ((x - l[k]!) * dx + (y - l[k + 1]!) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(l[k]! + s * dx - x, l[k + 1]! + s * dy - y) < 1e-9) return true; } return false; });
    for (const l of d.tangent ?? []) expect(onAny(...middle(l), iso.tangent!)).toBe(true);
    for (const l of d.tangentHidden!) expect(onAny(...middle(l), iso.tangentHidden!)).toBe(true);
  });
});
