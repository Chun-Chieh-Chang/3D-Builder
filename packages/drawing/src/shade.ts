/**
 * The shading of a view (ADR 0146, SolidWorks's 「塗彩」 and 「帶邊線塗彩」): the faces of the part seen from the view, drawn into an image with a depth buffer, so
 * that whatever is nearer hides what is behind it at every pixel — not by sorting triangles, which a large face beside a small near one gets wrong. The image
 * lies under the view's lines on the sheet; the screen and the SVG show it as a PNG, the PDF as an image with a soft mask (its transparent pixels are the
 * paper). A DXF has lines only, and leaves it out.
 */

/** The faces of a view: positions and normals in the view's coordinates (x right, y up, z toward the viewer; mm, full size), three indices a triangle. */
export interface ShadeMesh {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** The image of a view's faces: `box` is the rectangle of the view's coordinates (full size) it covers, its pixels `width` × `height`, row 0 at the top. */
export interface ShadeRaster {
  width: number;
  height: number;
  /** Pixels per millimetre of the view at full size. */
  px: number;
  box: { min: [number, number]; max: [number, number] };
  rgba: Uint8ClampedArray;
  /** How near the viewer each pixel's face is (z of the view), -Infinity where there is none. */
  depth: Float32Array;
}

/** The image as files: a PNG (RGBA), and for a PDF its colour and its alpha each as a zlib stream of rows that begin with PNG's filter byte (0). */
export interface ShadeImage {
  width: number;
  height: number;
  box: { min: [number, number]; max: [number, number] };
  png: Uint8Array;
  rgb: Uint8Array;
  alpha: Uint8Array;
}

/** The colour of a shaded face (0..1): a light grey-blue, as SolidWorks's default appearance; the light makes it darker or lighter. */
export const SHADE_COLOR: readonly [number, number, number] = [0.72, 0.76, 0.82];
/** The most pixels one view's image has: past it, the image is made coarser rather than larger. */
export const SHADE_MAX_PIXELS = 4_000_000;
/** How finely a view is shaded on the sheet: pixels per millimetre of paper (8 is about 200 dpi). */
export const SHADE_SHEET_PX = 8;

// the light: from the upper left, in front, as the 3D view's; and the half-way vector to the viewer for the highlight
const L = (() => {
  const v = [-0.35, 0.45, 1];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n] as const;
})();
const H = (() => {
  const v = [L[0], L[1], L[2] + 1];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n] as const;
})();

/**
 * The faces drawn into pixels at `px` per millimetre (made coarser when the image would pass `SHADE_MAX_PIXELS`). Each pixel takes the face nearest the viewer
 * at its middle; its colour is `color` lit by the light (two-sided: a face seen from behind, as inside a cut, is lit as if it faced the viewer). Null when
 * there is nothing to draw. A pixel density that is not a positive number is refused, not put right.
 */
export function rasterizeShade(mesh: ShadeMesh, px: number, color: readonly [number, number, number] = SHADE_COLOR): ShadeRaster | null {
  if (!(typeof px === 'number' && Number.isFinite(px) && px > 0)) throw new Error(`rasterizeShade: pixels per mm must be a positive number, not ${String(px)}`);
  const P = mesh.positions;
  const N = mesh.normals;
  const I = mesh.indices;
  if (I.length % 3 !== 0 || P.length % 3 !== 0 || N.length !== P.length) throw new Error('rasterizeShade: a mesh is triangles of points with a normal each');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < I.length; k++) {
    const i = I[k]! * 3;
    const x = P[i]!;
    const y = P[i + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(P[i + 2]!)) throw new Error('rasterizeShade: a point of the mesh is not a number');
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(maxX >= minX && maxY >= minY)) return null;
  // one pixel of margin round the faces; coarser when it would be too many
  const sizeAt = (d: number) => [Math.ceil((maxX - minX) * d) + 2, Math.ceil((maxY - minY) * d) + 2] as const;
  let d = px;
  let [w, h] = sizeAt(d);
  if (w * h > SHADE_MAX_PIXELS) {
    d *= Math.sqrt(SHADE_MAX_PIXELS / (w * h));
    [w, h] = sizeAt(d);
    while (w * h > SHADE_MAX_PIXELS) {
      d *= 0.99;
      [w, h] = sizeAt(d);
    }
  }
  const x0 = minX - 1 / d;
  const y1 = minY - 1 / d + h / d;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const depth = new Float32Array(w * h).fill(-Infinity);
  const sx = new Float64Array(3);
  const sy = new Float64Array(3);
  const sz = new Float64Array(3);
  const vi = [0, 0, 0];
  for (let t = 0; t + 2 < I.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = I[t + k]! * 3;
      vi[k] = i;
      sx[k] = (P[i]! - x0) * d;
      sy[k] = (y1 - P[i + 1]!) * d;
      sz[k] = P[i + 2]!;
    }
    // twice the area, in pixels: an edge-on triangle covers nothing
    const area = (sx[1]! - sx[0]!) * (sy[2]! - sy[0]!) - (sx[2]! - sx[0]!) * (sy[1]! - sy[0]!);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor(Math.min(sx[0]!, sx[1]!, sx[2]!)));
    const i1 = Math.min(w - 1, Math.ceil(Math.max(sx[0]!, sx[1]!, sx[2]!)));
    const j0 = Math.max(0, Math.floor(Math.min(sy[0]!, sy[1]!, sy[2]!)));
    const j1 = Math.min(h - 1, Math.ceil(Math.max(sy[0]!, sy[1]!, sy[2]!)));
    const inv = 1 / area;
    for (let j = j0; j <= j1; j++) {
      const py = j + 0.5;
      for (let i = i0; i <= i1; i++) {
        const pxc = i + 0.5;
        // barycentric weights of the pixel's middle; a little past the edges, so that two triangles that share one leave no gap between them
        const b0 = ((sx[1]! - pxc) * (sy[2]! - py) - (sx[2]! - pxc) * (sy[1]! - py)) * inv;
        const b1 = ((sx[2]! - pxc) * (sy[0]! - py) - (sx[0]! - pxc) * (sy[2]! - py)) * inv;
        const b2 = 1 - b0 - b1;
        if (b0 < -1e-6 || b1 < -1e-6 || b2 < -1e-6) continue;
        const z = b0 * sz[0]! + b1 * sz[1]! + b2 * sz[2]!;
        const p = j * w + i;
        if (!(z > depth[p]!)) continue;
        depth[p] = z;
        let nx = b0 * N[vi[0]!]! + b1 * N[vi[1]!]! + b2 * N[vi[2]!]!;
        let ny = b0 * N[vi[0]! + 1]! + b1 * N[vi[1]! + 1]! + b2 * N[vi[2]! + 1]!;
        let nz = b0 * N[vi[0]! + 2]! + b1 * N[vi[1]! + 2]! + b2 * N[vi[2]! + 2]!;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        if (nz < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const diffuse = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const spec = Math.pow(Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]), 24) * 0.18;
        const lit = 0.38 + 0.62 * diffuse;
        rgba[p * 4] = Math.round((color[0] * lit + spec) * 255);
        rgba[p * 4 + 1] = Math.round((color[1] * lit + spec) * 255);
        rgba[p * 4 + 2] = Math.round((color[2] * lit + spec) * 255);
        rgba[p * 4 + 3] = 255;
      }
    }
  }
  return { width: w, height: h, px: d, box: { min: [x0, y1 - h / d], max: [x0 + w / d, y1] }, rgba, depth };
}

// ---------------------------------------------------------------- PNG and the PDF's streams

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of PNG's chunks (ISO 3309), as ZIP has it. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** zlib (RFC 1950) of the bytes, by the CompressionStream browsers and Node both have. */
async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The pixels as rows of `channels` (taken from RGBA in order: 3 is RGB, 1 is the alpha alone, 4 all), each row after a filter byte of 0. */
function rows(r: Pick<ShadeRaster, 'width' | 'height' | 'rgba'>, channels: 1 | 3 | 4): Uint8Array {
  const out = new Uint8Array(r.height * (1 + r.width * channels));
  let o = 0;
  for (let j = 0; j < r.height; j++) {
    out[o++] = 0;
    for (let i = 0; i < r.width; i++) {
      const p = (j * r.width + i) * 4;
      if (channels === 1) out[o++] = r.rgba[p + 3]!;
      else for (let c = 0; c < channels; c++) out[o++] = r.rgba[p + c]!;
    }
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The raster as a PNG and as the PDF's two streams. */
export async function encodeShade(r: ShadeRaster): Promise<ShadeImage> {
  const [idat, rgb, alpha] = await Promise.all([zlib(rows(r, 4)), zlib(rows(r, 3)), zlib(rows(r, 1))]);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, r.width);
  v.setUint32(4, r.height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, adaptive filtering, no interlace
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return { width: r.width, height: r.height, box: r.box, png, rgb, alpha };
}

/** Base64 of bytes, for a data URL. */
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const hrefs = new WeakMap<Uint8Array, string>();

/** The PNG of an image as a data URL (the screen's and the SVG's), made once per image: the screen writes the sheet again at every move of the pointer. */
export function shadeHref(img: Pick<ShadeImage, 'png'>): string {
  let href = hrefs.get(img.png);
  if (!href) {
    href = `data:image/png;base64,${base64(img.png)}`;
    hrefs.set(img.png, href);
  }
  return href;
}
