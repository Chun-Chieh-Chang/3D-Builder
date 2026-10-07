/** The decoded images of the pictures of sketches (ADR 0116), kept by the hash of their bytes: an image is decoded once however often the sketch is drawn. */
const decoded = new Map<string, Promise<ImageBitmap | null>>();

/** The image of `bytes` (a PNG or a JPEG) for drawing; null when the browser cannot decode it. */
export function imageBitmapOf(sha256: string, bytes: Uint8Array, mime: 'image/png' | 'image/jpeg'): Promise<ImageBitmap | null> {
  let image = decoded.get(sha256);
  if (!image) {
    image = createImageBitmap(new Blob([bytes as BlobPart], { type: mime })).catch(() => null);
    decoded.set(sha256, image);
  }
  return image;
}
