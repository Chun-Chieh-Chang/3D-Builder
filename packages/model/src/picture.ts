import type { SketchPicture } from './schema';

/**
 * The picture of a sketch (草圖圖片, ADR 0116): an image laid in the plane of a sketch to be traced from. It is only looked at: it takes no part in the sketch's profiles, relations
 * or dimensions. The placement is plain numbers (the centre, the size in mm, the turn in degrees), not expressions: it is a reference, not a dimension of the part.
 */

type V3 = [number, number, number];
type P2 = [number, number];

/** The pixels of a PNG or a JPEG, read from its header (nothing is decoded); null for anything else. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; type: 'png' | 'jpg' } | null {
  // PNG: the signature, then the IHDR chunk with the width and height as big-endian 32-bit numbers
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && png.every((b, i) => bytes[i] === b) && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52) {
    const u32 = (o: number) => ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
    const [width, height] = [u32(16), u32(20)];
    return width > 0 && height > 0 ? { width, height, type: 'png' } : null;
  }
  // JPEG: markers one after another until a start-of-frame one, which has the height and the width as big-endian 16-bit numbers
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = bytes[o + 1]!;
      if (marker === 0xff) {
        o++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const length = (bytes[o + 2]! << 8) | bytes[o + 3]!;
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) {
        const [height, width] = [(bytes[o + 5]! << 8) | bytes[o + 6]!, (bytes[o + 7]! << 8) | bytes[o + 8]!];
        return width > 0 && height > 0 ? { width, height, type: 'jpg' } : null;
      }
      o += 2 + length;
    }
  }
  return null;
}

/** A picture at the origin of its sketch, `width` mm wide (the height follows the pixels), upright and not see-through at all but a little. */
export function newPicture(id: string, blob: string, pixels: { width: number; height: number }, width = 100): SketchPicture {
  return { id, blob, x: 0, y: 0, width, height: (width * pixels.height) / pixels.width, angle: 0, opacity: 0.6 };
}

/** The four corners of a picture in space, counter-clockwise from the lower left of the picture (before it is turned): the centre moved by half the size, turned by `angle` about the centre in the plane. */
export function pictureCorners(p: Pick<SketchPicture, 'x' | 'y' | 'width' | 'height' | 'angle'>, frame: { origin: V3; xDir: V3; yDir: V3 }): [V3, V3, V3, V3] {
  const a = (p.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const at = (u: number, v: number): V3 => {
    // in the plane of the sketch: the centre, plus the half-size offset turned by the angle
    const x = p.x + u * c - v * s;
    const y = p.y + u * s + v * c;
    return [0, 1, 2].map((i) => frame.origin[i]! + frame.xDir[i]! * x + frame.yDir[i]! * y) as V3;
  };
  const [hw, hh] = [p.width / 2, p.height / 2];
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
}

/**
 * Sets the scale of a picture from two points on it and the real distance between them (the way to scale a picture from a dimension measured elsewhere): the picture grows about the first
 * point, which stays where it is under the cursor, so that the two points are `distance` apart. `a` and `b` are in the plane of the sketch. Null when the points are the same or the distance
 * is not positive.
 */
export function calibratePicture(p: SketchPicture, a: P2, b: P2, distance: number): SketchPicture | null {
  const was = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(was > 1e-9) || !(distance > 0) || !Number.isFinite(distance)) return null;
  const k = distance / was;
  return { ...p, width: p.width * k, height: p.height * k, x: a[0] + (p.x - a[0]) * k, y: a[1] + (p.y - a[1]) * k };
}

/** The ids of the blobs the pictures of a document use (the ones the file has to keep). */
export function pictureBlobs(features: readonly { type: string; pictures?: readonly SketchPicture[] }[]): Set<string> {
  return new Set(features.flatMap((f) => (f.type === 'sketch' ? (f.pictures ?? []).map((p) => p.blob) : [])));
}
