/**
 * ADR 0146 (2): a drawing view's display style, and the shading of 「塗彩」 / 「帶邊線塗彩」. The faces are drawn into pixels with a depth buffer: measured here on
 * meshes made by hand (whose pixels are known) and on real parts built by OCCT (whose depths are worked out from the geometry), never on numbers typed in.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, DRAWING_SCHEMA_VERSION, parseDrawing, rightOf, sheetUp, viewVectors, type DrawingDoc, type Feature, type PartDoc, type ViewAxes } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { buildScene, crc32, encodeShade, rasterizeShade, SHADE_MAX_PIXELS, toPdf, toSvg, type ShadeMesh, type ShadeRaster, type ViewLines } from '@3db/drawing';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

/** A flat square from (x0, y0) to (x1, y1) at depth z, facing the viewer: two triangles, wound one way and the other (the depth buffer does not care). */
function square(x0: number, y0: number, x1: number, y1: number, z: number, at = 0): { positions: number[]; normals: number[]; indices: number[] } {
  return {
    positions: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [at, at + 1, at + 2, at, at + 3, at + 2],
  };
}
function join(...parts: ReturnType<typeof square>[]): ShadeMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const p of parts) {
    const base = positions.length / 3;
    positions.push(...p.positions);
    normals.push(...p.normals);
    indices.push(...p.indices.map((i) => i - (p.indices[0] ?? 0) + base));
  }
  return { positions, normals, indices };
}
/** The pixel whose middle is nearest a point of the view (full size). */
const pixelAt = (r: ShadeRaster, x: number, y: number) => {
  const i = Math.floor((x - r.box.min[0]) * r.px);
  const j = Math.floor((r.box.max[1] - y) * r.px);
  return j * r.width + i;
};
/** The middle of pixel p, in the view's coordinates. */
const middleOf = (r: ShadeRaster, p: number): [number, number] => [r.box.min[0] + ((p % r.width) + 0.5) / r.px, r.box.max[1] - (Math.floor(p / r.width) + 0.5) / r.px];

describe('the depth buffer (pure)', () => {
  it('covers a square: every pixel whose middle is inside is drawn, none whose middle is a pixel or more outside', () => {
    const r = rasterizeShade(join(square(0, 0, 10, 10, 0)), 4)!;
    let inside = 0;
    let drawnInside = 0;
    let drawnOutside = 0;
    for (let p = 0; p < r.width * r.height; p++) {
      const [x, y] = middleOf(r, p);
      const drawn = r.rgba[p * 4 + 3] === 255;
      if (x > 0 && x < 10 && y > 0 && y < 10) {
        inside++;
        if (drawn) drawnInside++;
      } else if (x < -1 / r.px || x > 10 + 1 / r.px || y < -1 / r.px || y > 10 + 1 / r.px) {
        if (drawn) drawnOutside++;
      }
    }
    expect(inside).toBe(1600); // 10 mm × 4 px a side
    expect(drawnInside / inside).toBeGreaterThanOrEqual(0.95);
    expect(drawnInside).toBe(inside);
    expect(drawnOutside).toBe(0);
  });

  it('a nearer face hides a farther one whatever order the triangles come in (the farther, larger one last)', () => {
    for (const order of [0, 1]) {
      const near = square(3, 3, 6, 6, 5);
      const far = square(0, 0, 10, 10, 0);
      const r = rasterizeShade(order === 0 ? join(near, far) : join(far, near), 4)!;
      expect(r.depth[pixelAt(r, 4.5, 4.5)]).toBeCloseTo(5, 6);
      expect(r.depth[pixelAt(r, 8, 8)]).toBeCloseTo(0, 6);
      expect(r.depth[pixelAt(r, 1, 1)]).toBeCloseTo(0, 6);
    }
  });

  it('refuses a pixel density that is not a positive number, and a point that is not a number; nothing to draw is null', () => {
    const m = join(square(0, 0, 1, 1, 0));
    for (const px of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => rasterizeShade(m, px)).toThrow(/positive number/);
    expect(() => rasterizeShade({ positions: [0, 0, 0, Number.NaN, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }, 4)).toThrow(/not a number/);
    expect(() => rasterizeShade({ positions: [0, 0, 0], normals: [0, 0, 1], indices: [0, 0] }, 4)).toThrow(/triangles/);
    expect(rasterizeShade({ positions: [], normals: [], indices: [] }, 4)).toBeNull();
  });

  it('a density that would pass the most pixels is made coarser, not larger', () => {
    const r = rasterizeShade(join(square(0, 0, 1000, 1000, 0)), 100)!;
    expect(r.width * r.height).toBeLessThanOrEqual(SHADE_MAX_PIXELS);
    expect(r.px).toBeLessThan(100);
    expect(r.px).toBeGreaterThan(1.9); // about √(4e6) / 1000
  });

  it('lights a face by its normal: one turned from the light is darker, one seen from behind is lit as if it faced the viewer', () => {
    const lit = (n: [number, number, number]) => {
      const r = rasterizeShade({ positions: [0, 0, 0, 4, 0, 0, 0, 4, 0], normals: [...n, ...n, ...n], indices: [0, 1, 2] }, 4)!;
      return r.rgba[pixelAt(r, 1, 1) * 4]!;
    };
    const facing = lit([0, 0, 1]);
    const away = lit([0.6, -0.5, 0.62]);
    expect(away).toBeLessThan(facing);
    expect(lit([0, 0, -1])).toBe(facing);
  });
});

describe('the image as files', () => {
  it('a PNG that reads back as the pixels, with its chunks checked; the PDF streams are the RGB and the alpha rows', async () => {
    const r = rasterizeShade(join(square(0, 0, 3, 2, 0)), 4)!;
    const img = await encodeShade(r);
    expect([...img.png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(img.png.buffer, img.png.byteOffset);
    const chunks: { type: string; data: Uint8Array }[] = [];
    for (let o = 8; o < img.png.length; ) {
      const len = view.getUint32(o);
      const type = String.fromCharCode(...img.png.subarray(o + 4, o + 8));
      const data = img.png.subarray(o + 8, o + 8 + len);
      expect(view.getUint32(o + 8 + len), `${type} crc`).toBe(crc32(img.png.subarray(o + 4, o + 8 + len)));
      chunks.push({ type, data });
      o += 12 + len;
    }
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4)]).toEqual([r.width, r.height]);
    const inflate = async (b: Uint8Array) => new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    const rows = await inflate(chunks[1]!.data);
    expect(rows.length).toBe(r.height * (1 + 4 * r.width));
    for (let j = 0; j < r.height; j++) {
      expect(rows[j * (1 + 4 * r.width)]).toBe(0);
      expect([...rows.subarray(j * (1 + 4 * r.width) + 1, (j + 1) * (1 + 4 * r.width))]).toEqual([...r.rgba.subarray(j * 4 * r.width, (j + 1) * 4 * r.width)]);
    }
    expect((await inflate(img.rgb)).length).toBe(r.height * (1 + 3 * r.width));
    const alpha = await inflate(img.alpha);
    expect(alpha.length).toBe(r.height * (1 + r.width));
    expect(alpha[1 + Math.floor(r.width / 2) + Math.floor(r.height / 2) * (1 + r.width)]).toBe(255);
  });
});

/** A front view of a 40 × 20 plate, with the image of its faces when asked. */
function plateDrawing(display: 'shadedEdges' | 'shaded' | 'wireframe' | 'hiddenVisible' | 'hiddenRemoved'): DrawingDoc {
  return applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'f', name: 'F', source: 'p.3dbx', direction: 'front', at: [150, 150], display }, { id: 'd', name: 'D', kind: 'detail', parent: 'f', centre: [5, 10], radius: 4, label: 'Z', at: [300, 150], display }] });
}

describe('the display styles on the sheet', () => {
  let shadeLines: ViewLines;
  beforeAll(async () => {
    const img = await encodeShade(rasterizeShade(join(square(0, 0, 40, 20, 0)), 8)!);
    shadeLines = { visible: [[0, 0, 40, 0]], hidden: [[0, 10, 40, 10]], box: { min: [0, 0], max: [40, 20] }, shade: img };
  });
  const styles = (doc: DrawingDoc) => buildScene(doc, new Map([['f', shadeLines]])).scene;

  it('wireframe draws the hidden edges as visible ones; hidden lines removed leaves them out; shaded leaves the visible ones out too', () => {
    const count = (doc: DrawingDoc, style: string) => styles(doc).items.filter((i) => i.kind === 'polyline' && i.style === style).length;
    // the front view and its detail each draw the line
    expect(count(plateDrawing('hiddenVisible'), 'hidden')).toBe(2);
    expect(count(plateDrawing('wireframe'), 'hidden')).toBe(0);
    expect(count(plateDrawing('wireframe'), 'visible')).toBe(count(plateDrawing('hiddenVisible'), 'visible') + 2);
    expect(count(plateDrawing('hiddenRemoved'), 'hidden')).toBe(0);
    expect(count(plateDrawing('shadedEdges'), 'visible')).toBe(count(plateDrawing('hiddenRemoved'), 'visible'));
    expect(count(plateDrawing('hiddenRemoved'), 'visible')).toBeGreaterThan(0);
    expect(count(plateDrawing('shaded'), 'visible')).toBe(0);
  });

  it('a shaded view puts its image where its box is; a detail its parent\'s, cut to its circle; a view not shaded none', () => {
    const scene = styles(plateDrawing('shadedEdges'));
    expect(scene.images).toHaveLength(2);
    const [fImg, dImg] = scene.images!;
    // the image covers the box the rasterizer drew (a pixel of margin round the faces), at the view's scale (1:1) about the box's middle at (150, 150)
    const img = shadeLines.shade!;
    expect(fImg!.w).toBeCloseTo(img.box.max[0] - img.box.min[0], 9);
    expect(fImg!.h).toBeCloseTo(img.box.max[1] - img.box.min[1], 9);
    expect(fImg!.at[0]).toBeCloseTo(150 - 20 + img.box.min[0], 9);
    expect(fImg!.at[1]).toBeCloseTo(150 - 10 + img.box.min[1], 9);
    expect(dImg!.clip!.radius).toBeCloseTo(4, 9);
    expect(dImg!.clip!.centre).toEqual([expect.closeTo(300, 9), expect.closeTo(150, 9)]); // the detail's middle is its circle's
    expect(styles(plateDrawing('hiddenVisible')).images).toBeUndefined();
    const svg = toSvg(scene);
    expect(svg.match(/<image /g)).toHaveLength(2);
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).toContain('<clipPath id="shade-clip-1"><circle');
    const pdf = new TextDecoder('latin1').decode(toPdf(scene).bytes);
    expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(4); // two images, each with its mask
    expect(pdf).toContain('/SMask');
    expect(pdf).toContain('/Im1 Do');
    expect(pdf).toMatch(/h W n .* cm \/Im2 Do/);
  });

  it('refuses a display style it does not know, and null puts the kind\'s default back', () => {
    const doc = plateDrawing('shaded');
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'f', patch: { display: 'glossy' as never } })).toThrow();
    const back = applyDrawingCommand(doc, { type: 'setView', viewId: 'f', patch: { display: null } });
    expect(back.views[0]).not.toHaveProperty('display');
    expect(() => applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'x', name: 'X', source: 'p.3dbx', direction: 'top', hidden: true } as never] })).toThrow();
  });

  it('a version-18 drawing reads its hidden lines as the display style: shown 「隱藏線可見」, not shown 「移除隱藏線」, unsaid the default', () => {
    const old = JSON.parse(JSON.stringify(createEmptyDrawing())) as Record<string, unknown>;
    old.schemaVersion = 18;
    old.views = [
      { id: 'a', name: 'A', source: 'p.3dbx', direction: 'front', hidden: true },
      { id: 'b', name: 'B', source: 'p.3dbx', direction: 'top', hidden: false },
      { id: 'c', name: 'C', source: 'p.3dbx', direction: 'right' },
    ];
    const doc = parseDrawing(JSON.stringify(old));
    expect(DRAWING_SCHEMA_VERSION).toBe(20);
    expect(doc.schemaVersion).toBe(20);
    expect(doc.views.map((v) => v.display)).toEqual(['hiddenVisible', 'hiddenRemoved', undefined]);
    expect(doc.views.every((v) => !('hidden' in v))).toBe(true);
  });
});

// ---------------------------------------------------------------- real parts (OCCT)

let kernel: Kernel;
let plate: ShapeId;
let bossed: ShapeId;
const kept: Regenerator[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  kept.push(regen);
  // a plate of 40 × 30 × 20 on the front plane (x 0..40, y 0..30, z 0..20), and the same with a boss of 10 × 10 × 10 on its top (z 20..30)
  plate = regen.rebuild(build(sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }))).body!.shape;
  const withBoss: PartDoc = build(
    sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
    sketch('s2', face('e1:cap:end'), rectangle('b', 15, 10, 10, 10)) as Feature,
    extrude('e2', 's2', 'boss', { type: 'blind', depth: '10' }),
  );
  bossed = new Regenerator(kernel, await PlaneGcsSolver.create()).rebuild(withBoss).body!.shape;
});

describe('shading a part built by OCCT', () => {
  it('the front view of the plate: its faces cover the box of its lines, and nothing outside it', () => {
    const v = kernel.projectView(plate, viewVectors('front'), { mesh: true });
    expect(v.mesh).toBeDefined();
    const r = rasterizeShade(v.mesh!, 4)!;
    const box = v.box!;
    let inside = 0;
    let covered = 0;
    let outside = 0;
    for (let p = 0; p < r.width * r.height; p++) {
      const [x, y] = middleOf(r, p);
      const drawn = r.rgba[p * 4 + 3] === 255;
      if (x > box.min[0] && x < box.max[0] && y > box.min[1] && y < box.max[1]) {
        inside++;
        if (drawn) covered++;
      } else if ((x < box.min[0] - 1 / r.px || x > box.max[0] + 1 / r.px || y < box.min[1] - 1 / r.px || y > box.max[1] + 1 / r.px) && drawn) outside++;
    }
    expect(inside).toBeGreaterThan(0);
    expect(covered / inside).toBeGreaterThanOrEqual(0.95);
    expect(outside).toBe(0);
    // the front face is nearest: z = 20 toward the viewer of the front view
    expect(r.depth[pixelAt(r, 20, 15)]).toBeCloseTo(20, 4);
  });

  it('the isometric of the plate with a boss: at the boss\'s top the boss is seen, not the plate behind it', () => {
    const axes: ViewAxes = viewVectors('isometric');
    const v = kernel.projectView(bossed, axes, { mesh: true });
    const r = rasterizeShade(v.mesh!, 8)!;
    const right = rightOf(axes);
    const up = sheetUp(axes);
    const toward = axes.dir.map((x) => -x / Math.hypot(...axes.dir)) as [number, number, number];
    const seen = (p: [number, number, number]) => ({ x: p[0] * right[0] + p[1] * right[1] + p[2] * right[2], y: p[0] * up[0] + p[1] * up[1] + p[2] * up[2], z: p[0] * toward[0] + p[1] * toward[1] + p[2] * toward[2] });
    const bossTop = seen([20, 15, 30]);
    const at = r.depth[pixelAt(r, bossTop.x, bossTop.y)]!;
    // the depth changes across a pixel by its slope; an eighth of a millimetre a pixel, well under a millimetre
    expect(Math.abs(at - bossTop.z)).toBeLessThan(0.2);
    // what is behind it there is the plate's top, as far again as the boss is tall (10 mm along z, seen at 1/√3)
    const plateBehind = seen([20 - 10, 15 - 10, 20]);
    expect(Math.abs(plateBehind.x - bossTop.x)).toBeLessThan(1e-9);
    expect(bossTop.z - plateBehind.z).toBeGreaterThan(10);
    // and away from the boss the plate's top is what is seen
    const plateTop = seen([5, 25, 20]);
    expect(Math.abs(r.depth[pixelAt(r, plateTop.x, plateTop.y)]! - plateTop.z)).toBeLessThan(0.2);
  });

  it('a section gives the faces of what is left, the cut face among them; the shapes made are all released', () => {
    const live = kernel.liveShapes;
    const axes = viewVectors('front');
    const v = kernel.sectionView(bossed, { origin: [0, 0, 10], normal: [0, 0, 1] }, axes.up, { mesh: true });
    expect(v.cut!.length).toBeGreaterThan(0);
    const r = rasterizeShade(v.mesh!, 4)!;
    // the cut face lies on z = 10 and faces the viewer
    expect(r.depth[pixelAt(r, 20, 15)]).toBeCloseTo(10, 4);
    expect(kernel.liveShapes).toBe(live);
    // the lines are the same with or without the faces
    const plain = kernel.sectionView(bossed, { origin: [0, 0, 10], normal: [0, 0, 1] }, axes.up);
    expect(plain.visible.length).toBe(v.visible.length);
    expect(plain.mesh).toBeUndefined();
  });
});
