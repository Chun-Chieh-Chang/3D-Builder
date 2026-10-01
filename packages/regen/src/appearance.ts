import { type PartDoc } from '@3db/model';
import { ownerFeatures, resolveRef } from '@3db/naming';
import type { RebuildResult } from './engine';

/**
 * The color of every face of the result's body view (C14.2): "#rrggbb", or null where nothing was chosen. Where several choices reach a face the narrower
 * wins: part < body < feature < face. A body's choice is by its id, a feature's by the faces it made (the first part of a face's name), a face's by its
 * reference (found by name, else by its geometry like any reference). Choices that reach nothing (a body or feature that is gone) do nothing.
 */
export function faceColors(doc: Pick<PartDoc, 'appearances'>, result: Pick<RebuildResult, 'body' | 'bodies'>): (string | null)[] {
  const view = result.body;
  if (!view) return [];
  const colors: (string | null)[] = view.topology.faces.map(() => null);
  const choice = (kind: 'part' | 'body' | 'feature') => doc.appearances.filter((a) => a.target.kind === kind);
  const part = choice('part')[0]?.color ?? null;
  const byBody = new Map(choice('body').map((a) => [(a.target as { id: string }).id, a.color]));
  const byFeature = new Map(choice('feature').map((a) => [(a.target as { id: string }).id, a.color]));
  for (const b of result.bodies) {
    for (let i = b.face0; i < b.face0 + b.faces; i++) {
      const owner = ownerFeatures(view.names.faces[i]!)[0];
      colors[i] = (owner !== undefined ? byFeature.get(owner) : undefined) ?? byBody.get(b.id) ?? part;
    }
  }
  for (const a of doc.appearances) {
    if (a.target.kind !== 'face') continue;
    const found = resolveRef(a.target.ref, view.names, view.topology);
    if (found.ok && found.index >= 0 && found.index < colors.length) colors[found.index] = a.color;
  }
  return colors;
}

/**
 * What goes into the STEP file of a part (F1.1, F1.3): the shapes of the bodies that count (a reference body is a design aid, C7.1) and the color of
 * each of their faces, one after the other in the order a compound of those shapes numbers them.
 */
export function exportFaces(doc: Pick<PartDoc, 'appearances'>, result: Pick<RebuildResult, 'body' | 'bodies'>): { shapes: RebuildResult['bodies'][number]['shape'][]; colors: (string | null)[] } {
  const all = faceColors(doc, result);
  const own = result.bodies.filter((b) => !b.reference);
  return { shapes: own.map((b) => b.shape), colors: own.flatMap((b) => all.slice(b.face0, b.face0 + b.faces)) };
}
