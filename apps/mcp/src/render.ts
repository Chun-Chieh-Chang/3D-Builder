/**
 * A picture of the part for the agent (ADR 0237, S2), made without a browser or WebGL: the exact hidden-line projection of the drawings
 * (`projectDrawingView`) gives the visible edges, and the shading of ADR 0146 (`rasterizeShade`, a depth buffer) gives the faces. The edges are drawn
 * over the faces, on a white ground, and the whole is a PNG. The same projection makes a drawing's views, so what the agent sees is what a drawing shows.
 */
import { encodeShade, rasterizeShade, type ShadeRaster } from '@3db/drawing';
import { normalizedViewAxes, viewVectors, type ViewAxes, type ViewName } from '@3db/model';
import { projectDrawingView } from '@3db/regen';
import { AgentError, type CadSession } from './session';

export const RENDER_VIEWS = ['isometric', 'front', 'back', 'top', 'bottom', 'left', 'right'] as const satisfies readonly ViewName[];

export interface RenderOptions {
  view?: (typeof RENDER_VIEWS)[number];
  /** A direction of one's own, instead of a named view: the direction looked along, and which way is up. */
  dir?: [number, number, number];
  up?: [number, number, number];
  /** The longer side of the image in pixels (64–2048). */
  size?: number;
  /** Hidden edges as thin grey lines too. */
  hidden?: boolean;
}

export interface RenderResult {
  png: Uint8Array;
  width: number;
  height: number;
  /** The view's own axes: what the picture's right and up are in the model. */
  axes: ViewAxes;
}

const MARGIN = 16;
const EDGE: [number, number, number] = [20, 24, 32];
const HIDDEN: [number, number, number] = [150, 155, 165];

export async function renderView(session: CadSession, options: RenderOptions = {}): Promise<RenderResult> {
  const size = options.size ?? 800;
  if (!(Number.isInteger(size) && size >= 64 && size <= 2048)) throw new AgentError(`size must be a whole number of pixels from 64 to 2048, not ${size}`);
  let axes: ViewAxes;
  if (options.dir !== undefined || options.up !== undefined) {
    if (options.view !== undefined) throw new AgentError('give either a named view or dir and up, not both');
    const ok = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    if (!ok(options.dir) || !ok(options.up)) throw new AgentError('dir and up must each be three finite numbers');
    try {
      axes = normalizedViewAxes({ dir: options.dir!, up: options.up! });
    } catch {
      throw new AgentError('dir must not be zero and up must not be parallel to dir');
    }
  } else {
    const view = options.view ?? 'isometric';
    if (!(RENDER_VIEWS as readonly string[]).includes(view)) throw new AgentError(`view must be one of ${RENDER_VIEWS.join(', ')}, not ${JSON.stringify(view)}`);
    axes = normalizedViewAxes(viewVectors(view));
  }

  const target = session.shapeForView();
  if (!target) throw new AgentError('the part has no body to show yet');
  const kernel = session.kernelForView;
  try {
    const projection = projectDrawingView(kernel, [{ shape: target.shape, pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, mirrored: false }], axes, undefined, true);
    const box = projection.box;
    if (!box || !projection.mesh) throw new AgentError('the part shows nothing from this direction');
    const span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], 1e-6);
    const raster = rasterizeShade(projection.mesh, (size - 2 * MARGIN) / span);
    if (!raster) throw new AgentError('the part shows no faces from this direction');
    const image = onWhite(raster, MARGIN);
    if (options.hidden) for (const line of projection.hidden) stroke(image, line, HIDDEN, 1);
    for (const line of projection.visible) stroke(image, line, EDGE, 2);
    const shade = await encodeShade(image);
    return { png: shade.png, width: shade.width, height: shade.height, axes };
  } finally {
    for (const id of target.made) kernel.release(id);
  }
}

/** The raster on a white ground with `m` pixels of margin; the same pixel scale, so the lines map onto it with `raster`'s box and `m`. */
function onWhite(r: ShadeRaster, m: number): ShadeRaster {
  const width = r.width + 2 * m;
  const height = r.height + 2 * m;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const s = (y * r.width + x) * 4;
      const a = r.rgba[s + 3]! / 255;
      if (a === 0) continue;
      const d = ((y + m) * width + x + m) * 4;
      for (let k = 0; k < 3; k++) rgba[d + k] = Math.round(r.rgba[s + k]! * a + 255 * (1 - a));
    }
  }
  const mm = m / r.px;
  return { width, height, px: r.px, box: { min: [r.box.min[0] - mm, r.box.min[1] - mm], max: [r.box.max[0] + mm, r.box.max[1] + mm] }, rgba, depth: new Float32Array(0) };
}

/** A polyline of the view (x, y in mm, flat pairs) drawn into `image`. */
function stroke(image: ShadeRaster, line: number[], color: [number, number, number], width: number): void {
  const step = 2;
  const toPx = (x: number, y: number): [number, number] => [(x - image.box.min[0]) * image.px, (image.box.max[1] - y) * image.px];
  for (let i = 0; i + step < line.length; i += step) {
    const [x0, y0] = toPx(line[i]!, line[i + 1]!);
    const [x1, y1] = toPx(line[i + step]!, line[i + step + 1]!);
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const y = y0 + ((y1 - y0) * k) / n;
      for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++) put(image, Math.floor(x - width / 2 + dx + 0.5), Math.floor(y - width / 2 + dy + 0.5), color);
    }
  }
}

function put(image: ShadeRaster, x: number, y: number, c: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = (y * image.width + x) * 4;
  image.rgba[i] = c[0];
  image.rgba[i + 1] = c[1];
  image.rgba[i + 2] = c[2];
  image.rgba[i + 3] = 255;
}
