import { t } from '@3db/i18n';
import type { Ref } from '@3db/model';
import type { Kernel } from '@3db/kernel';
import { edgeFingerprint, faceFingerprint, resolveRef } from '@3db/naming';
import type { RebuildResult } from './engine';

export interface EntranceTarget { plane: Ref; center: Ref; diameter: number; opening: number }
/** Only native inner wires qualify: never mistake a shaft's outside rim for a hole. */
export function findEntrance(kernel: Kernel, body: RebuildResult['body'], refs: Ref[]): EntranceTarget {
  const fail = (): never => { throw new Error(t('entrance.pick')); };
  if (!body || !refs.length) return fail();
  const topology = body.topology;
  const faces: number[] = [], edges: number[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'face' && ref.kind !== 'edge') return fail();
    const found = resolveRef(ref, body.names, topology);
    if (!found.ok) throw new Error(t('entrance.lost'));
    (ref.kind === 'face' ? faces : edges).push(found.index);
  }
  const candidates = faces.length ? [...new Set(faces)] : topology.faces.flatMap((f, i) => f.surface === 'plane' && edges.every(e => topology.edges[e]!.faces.includes(i)) ? [i] : []);
  if (candidates.length !== 1) return fail();
  const face = candidates[0]!, normal = topology.faces[face]!.normal;
  if (topology.faces[face]!.surface !== 'plane' || !normal || edges.some(e => !topology.edges[e]!.faces.includes(face))) return fail();
  const loops = kernel.innerFaceLoops(body.shape, face).filter(loop => loop.length && loop.every(i => i >= 0) && edges.every(e => loop.includes(e)));
  if (loops.length !== 1) throw new Error(t('entrance.ambiguous'));
  const loop = loops[0]!;
  const circles = loop.flatMap(edge => {
    const g = topology.edges[edge]!.geometry;
    return g?.type === 'circle' ? [{ edge, g }] : [];
  });
  if (!circles.length) return fail();
  const first = circles[0]!;
  const center = first.g.center, radius = first.g.radius;
  if (!(radius > 0) || circles.some(({ g }) => Math.hypot(...g.center.map((x, i) => x - center[i]!)) > 1e-7 || Math.abs(g.radius - radius) > 1e-7 || Math.abs(Math.abs(g.normal.reduce((s, x, i) => s + x * normal[i]!, 0)) - 1) > 1e-7)) return fail();
  const diameter = 2 * kernel.distanceToEdges(body.shape, loop, center);
  return { plane: { kind: 'face', name: body.names.faces[face]!, fingerprint: faceFingerprint(topology,face) }, center: { kind: 'edge', name: body.names.edges[first.edge]!, fingerprint: edgeFingerprint(topology,first.edge) }, diameter, opening: 2 * radius };
}
