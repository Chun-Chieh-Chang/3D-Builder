/**
 * A project of files in memory for the tests of derived bodies (4a): reading a part the way the app does, with the master files it is derived from found by
 * the paths in the files, and rebuilding it for mates.
 */
import { dirName, joinPath } from '@3db/model';
import { readDocumentFile } from '@3db/io';
import type { PlaneGcsSolver } from '@3db/sketch';
import type { Kernel, ShapeId } from '@3db/kernel';
import { holeFeatures, Regenerator, type HoleFeatures, type MatePart, type SourcePart } from '@3db/regen';

/** A file of the project as another part reads it: its document, and a way to find the files it is derived from (paths relative to it). */
export async function sourceAt(files: Map<string, Uint8Array>, path: string): Promise<SourcePart | undefined> {
  const bytes = files.get(path);
  if (!bytes) return undefined;
  const file = await readDocumentFile(bytes);
  if (file.kind !== 'part') return undefined;
  const loaded = new Map<string, SourcePart | undefined>();
  for (const f of file.doc.features) if (f.type === 'derivedBody') loaded.set(f.source, await sourceAt(files, joinPath(dirName(path), f.source)));
  return { key: path, doc: file.doc, blobs: file.blobs, sources: { get: (p) => loaded.get(p) } };
}

export interface OpenedPart {
  mate: MatePart;
  shape: ShapeId;
  volume: number;
  /** One flag per body: whether it is a reference body. */
  reference: boolean[];
  /** The regenerator that owns the shape: keep it alive as long as the shape is used. */
  regen: Regenerator;
  problems: string[];
  /** The hole features of the part: what a drawing writes of its holes (as the worker passes it). */
  holes: HoleFeatures;
}

/** A part file of the project rebuilt, with its masters. */
export async function openPart(kernel: Kernel, solver: PlaneGcsSolver, kept: Regenerator[], files: Map<string, Uint8Array>, path: string): Promise<OpenedPart> {
  const src = (await sourceAt(files, path))!;
  const regen = new Regenerator(kernel, solver, src.blobs, src.sources);
  kept.push(regen);
  const r = regen.rebuild(src.doc);
  const body = r.body!;
  return {
    mate: { topology: body.topology, names: body.names, frames: r.frames },
    shape: body.shape,
    volume: kernel.massProps(body.shape).volume,
    reference: r.bodies.map((b) => b.reference),
    regen,
    problems: r.features.filter((f) => f.status === 'error').map((f) => `${f.id}: ${f.message}`),
    holes: holeFeatures(src.doc, src.sources),
  };
}
