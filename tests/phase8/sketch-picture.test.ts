/**
 * The picture of a sketch (草圖圖片, ADR 0116): an image to trace from, laid in the plane of a sketch. Worked out by hand: the size read from the header of a PNG (3 × 2 pixels) and a JPEG
 * (5 × 4), the corners of a picture 100 × 50 centred at (10, 20) turned 90° on the front plane (turned about its centre: the half-size offsets (±50, ±25) become (∓25, ±50)), and the scale
 * from two points: a picture 100 × 50 at (0, 0) with points (−10, 0) and (30, 0) 40 apart that are really 80 apart grows by 2 about the first point: 200 × 100, its centre at
 * (−10 + 2·10, 0) = (10, 0), so that the first point is under the same place of the picture.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, calibratePicture, createEmptyPart, imageSize, newPicture, pictureCorners, SCHEMA_VERSION, type BlobRef, type PartDoc, type SketchFeature } from '@3db/model';
import { readPartFile, sha256Hex, writePartFile } from '@3db/io';

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, w, 0, 0, 0, h, 8, 6, 0, 0, 0]);
  return b;
};
/** A JPEG that is a start (SOI), an APP0 segment of 16 bytes, and a baseline frame (SOF0) of 17 bytes with the height then the width. */
const jpg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, h, 0, w, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const hash = (n: number) => n.toString(16).padStart(64, '0');
const doc = (): PartDoc =>
  applyCommand(createEmptyPart(), { type: 'insertFeature', feature: { id: 'sk', type: 'sketch', name: 'sk', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] } as SketchFeature, index: 0 });
const blob = (n: number, kind: 'png' | 'jpg' = 'png'): BlobRef => ({ id: `blob${n}`, sha256: hash(n), kind, fileName: `a${n}.${kind}` });
const add = (d: PartDoc, n: number, id = `picture${n}`, kind: 'png' | 'jpg' = 'png') => applyCommand(d, { type: 'addSketchPicture', featureId: 'sk', blob: blob(n, kind), picture: newPicture(id, `blob${n}`, { width: 4, height: 2 }, 100) });
const pictures = (d: PartDoc) => (d.features.find((f) => f.id === 'sk') as SketchFeature).pictures ?? [];

describe('the size of an image', () => {
  it('a PNG says its pixels in the IHDR chunk and a JPEG in its frame header', () => {
    expect(imageSize(png(3, 2))).toEqual({ width: 3, height: 2, type: 'png' });
    expect(imageSize(jpg(5, 4))).toEqual({ width: 5, height: 4, type: 'jpg' });
    expect(imageSize(png(200, 100))).toMatchObject({ width: 200, height: 100 });
  });
  it('anything else, or a header that is cut short, is not an image', () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(imageSize(png(3, 2).slice(0, 20))).toBeNull();
    expect(imageSize(jpg(5, 4).slice(0, 12))).toBeNull();
    expect(imageSize(new TextEncoder().encode('ISO-10303-21;'))).toBeNull();
  });
});

describe('where a picture is', () => {
  it('a new picture is 100 wide and as high as its pixels say (4 × 2 pixels: 50), at the origin, upright, 60 % opaque', () => {
    expect(newPicture('p', 'b', { width: 4, height: 2 })).toEqual({ id: 'p', blob: 'b', x: 0, y: 0, width: 100, height: 50, angle: 0, opacity: 0.6 });
  });
  it('its corners on the front plane: centred at (10, 20), 100 × 50, turned 90°: half the size offsets (±50, ±25) become (∓25, ±50)', () => {
    const frame = { origin: [0, 0, 0] as [number, number, number], xDir: [1, 0, 0] as [number, number, number], yDir: [0, 1, 0] as [number, number, number] };
    const plain = pictureCorners({ x: 10, y: 20, width: 100, height: 50, angle: 0 }, frame);
    expect(plain).toEqual([[-40, -5, 0], [60, -5, 0], [60, 45, 0], [-40, 45, 0]]);
    const turned = pictureCorners({ x: 10, y: 20, width: 100, height: 50, angle: 90 }, frame);
    const expected = [[35, -30, 0], [35, 70, 0], [-15, 70, 0], [-15, -30, 0]];
    turned.forEach((c, i) => c.forEach((v, k) => expect(v).toBeCloseTo(expected[i]![k]!, 9)));
  });
  it('on another plane the same numbers go along that plane: the right plane (x along −z, y along y) with the origin moved 5', () => {
    const frame = { origin: [5, 0, 0] as [number, number, number], xDir: [0, 0, -1] as [number, number, number], yDir: [0, 1, 0] as [number, number, number] };
    expect(pictureCorners({ x: 0, y: 0, width: 10, height: 4, angle: 0 }, frame)).toEqual([[5, -2, 5], [5, -2, -5], [5, 2, -5], [5, 2, 5]]);
  });
});

describe('the scale of a picture from two points', () => {
  const p = { id: 'p', blob: 'b', x: 0, y: 0, width: 100, height: 50, angle: 0, opacity: 0.6 };
  it('points 40 apart that are really 80 apart: the picture grows by 2 about the first point (200 × 100, its centre at (10, 0))', () => {
    const q = calibratePicture(p, [-10, 0], [30, 0], 80)!;
    expect(q).toMatchObject({ width: 200, height: 100, x: 10, y: 0 });
    // the first point is under the same place of the picture: its offset from the centre in units of the picture size is as it was
    expect((-10 - q.x) / q.width).toBeCloseTo((-10 - p.x) / p.width, 12);
  });
  it('a slanted pair works the same (3, 4 → 5 apart, really 2.5: it halves), and nothing is made of the same point twice or a distance that is not a distance', () => {
    expect(calibratePicture(p, [0, 0], [3, 4], 2.5)).toMatchObject({ width: 50, height: 25, x: 0, y: 0 });
    expect(calibratePicture(p, [1, 1], [1, 1], 5)).toBeNull();
    expect(calibratePicture(p, [0, 0], [3, 4], 0)).toBeNull();
    expect(calibratePicture(p, [0, 0], [3, 4], Number.NaN)).toBeNull();
  });
});

describe('the commands', () => {
  it('addSketchPicture puts the picture in the sketch and its data in the document; the version is the current one', () => {
    const d = add(doc(), 1);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(pictures(d)).toHaveLength(1);
    expect(d.blobs).toEqual([blob(1)]);
  });
  it('the same image twice is one blob; two images are two', () => {
    let d = add(doc(), 1, 'pictureA');
    d = applyCommand(d, { type: 'addSketchPicture', featureId: 'sk', blob: { ...blob(1), id: 'blobX' }, picture: newPicture('pictureB', 'blobX', { width: 4, height: 2 }) });
    expect(d.blobs).toHaveLength(1);
    expect(pictures(d).map((p) => p.blob)).toEqual(['blob1', 'blob1']);
    d = add(d, 2);
    expect(d.blobs.map((b) => b.id)).toEqual(['blob1', 'blob2']);
  });
  it('setSketchPicture moves and scales it; wrong numbers are refused where they are given', () => {
    let d = add(doc(), 1);
    d = applyCommand(d, { type: 'setSketchPicture', featureId: 'sk', pictureId: 'picture1', picture: { x: 5, y: -3, width: 80, height: 40, angle: 15, opacity: 0.3 } });
    expect(pictures(d)[0]).toMatchObject({ x: 5, y: -3, width: 80, height: 40, angle: 15, opacity: 0.3 });
    for (const bad of [{ width: 0 }, { height: -1 }, { opacity: 1.5 }, { opacity: -0.1 }, { x: Number.NaN }]) expect(() => applyCommand(d, { type: 'setSketchPicture', featureId: 'sk', pictureId: 'picture1', picture: bad })).toThrow();
    expect(() => applyCommand(d, { type: 'setSketchPicture', featureId: 'sk', pictureId: 'nothing', picture: { x: 1 } })).toThrow(/找不到/);
  });
  it('removeSketchPicture takes the picture out and its data with it, unless another picture uses the data', () => {
    let d = add(doc(), 1, 'pictureA');
    d = applyCommand(d, { type: 'addSketchPicture', featureId: 'sk', blob: { ...blob(1), id: 'blobX' }, picture: newPicture('pictureB', 'blobX', { width: 4, height: 2 }) });
    d = applyCommand(d, { type: 'removeSketchPicture', featureId: 'sk', pictureId: 'pictureA' });
    expect(d.blobs).toHaveLength(1);
    d = applyCommand(d, { type: 'removeSketchPicture', featureId: 'sk', pictureId: 'pictureB' });
    expect(d.blobs).toEqual([]);
    expect(pictures(d)).toEqual([]);
    expect(d.features.find((f) => f.id === 'sk')).not.toHaveProperty('pictures');
  });
  it('is refused: not a PNG or a JPEG (a STEP blob), a bad hash, an id in use, a sketch that is not there', () => {
    const d = doc();
    expect(() => applyCommand(d, { type: 'addSketchPicture', featureId: 'sk', blob: { ...blob(1), kind: 'step' }, picture: newPicture('p', 'blob1', { width: 1, height: 1 }) })).toThrow(/PNG/);
    expect(() => applyCommand(d, { type: 'addSketchPicture', featureId: 'sk', blob: { ...blob(1), sha256: 'zz' }, picture: newPicture('p', 'blob1', { width: 1, height: 1 }) })).toThrow();
    expect(() => applyCommand(add(d, 1), { type: 'addSketchPicture', featureId: 'sk', blob: blob(2), picture: newPicture('picture1', 'blob2', { width: 1, height: 1 }) })).toThrow();
    expect(() => applyCommand(d, { type: 'addSketchPicture', featureId: 'nothing', blob: blob(1), picture: newPicture('p', 'blob1', { width: 1, height: 1 }) })).toThrow();
  });
});

describe('the file', () => {
  /** A document with one picture of the image `bytes`, named by its real hash (the file is checked against it when it is read). */
  const withImage = async (bytes: Uint8Array, kind: 'png' | 'jpg') => {
    const sha256 = await sha256Hex(bytes);
    const d = applyCommand(doc(), { type: 'addSketchPicture', featureId: 'sk', blob: { id: 'blob1', sha256, kind, fileName: `a.${kind}` }, picture: newPicture('picture1', 'blob1', { width: 4, height: 2 }) });
    return { d, sha256 };
  };
  it('writes the image as blobs/<sha256>.png and reads it back with the document: the pictures, the blob and its bytes', async () => {
    const bytes = png(4, 2);
    const { d, sha256 } = await withImage(bytes, 'png');
    const back = await readPartFile(await writePartFile(d, new Map([[sha256, bytes]])));
    expect(pictures(back.doc)).toEqual(pictures(d));
    expect(back.doc.blobs).toEqual(d.blobs);
    expect([...back.blobs.get(sha256)!]).toEqual([...bytes]);
    expect(back.warnings).toEqual([]);
  });
  it('an image the document no longer uses is not kept in the file', async () => {
    const bytes = png(4, 2);
    const { d, sha256 } = await withImage(bytes, 'png');
    const gone = applyCommand(d, { type: 'removeSketchPicture', featureId: 'sk', pictureId: 'picture1' });
    expect((await readPartFile(await writePartFile(gone, new Map([[sha256, bytes]])))).blobs.size).toBe(0);
  });
  it('a JPEG is kept and read back the same', async () => {
    const bytes = jpg(5, 4);
    const { d, sha256 } = await withImage(bytes, 'jpg');
    const back = await readPartFile(await writePartFile(d, new Map([[sha256, bytes]])));
    expect(back.blobs.has(sha256)).toBe(true);
    expect(back.warnings).toEqual([]);
  });
  it('an image that was changed in the file is said, not used', async () => {
    const bytes = png(4, 2);
    const { d, sha256 } = await withImage(bytes, 'png');
    const back = await readPartFile(await writePartFile(d, new Map([[sha256, png(9, 9)]])));
    expect(back.blobs.size).toBe(0);
    expect(back.warnings).toHaveLength(1);
  });
});
