import { t } from '@3db/i18n';
import { edgeFingerprint, faceFingerprint, resolveRef, vertexFingerprint, type ElementNames } from '@3db/naming';
import type { Topology } from '@3db/kernel';
import { rightOf, type ElementFacts, type Ref, type ViewAxes, type ViewFeature } from '@3db/model';

/**
 * What a drawing's dimensions need to know of the part a view shows (C16.4): the elements a dimension points at, by persistent name, as numbers; and the
 * elements a view can be dimensioned from. Worked out from the part as built, in its own frame (a part is drawn alone, so that is the view's).
 */

type V3 = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const PARALLEL = 1 - 1e-6;
const parallel = (a: readonly number[], b: readonly number[]) => Math.abs(dot(a, b)) >= PARALLEL;

/** What the element a reference points at is (a face, edge or vertex of the part), or why it cannot be told: it is gone, or the name fits more than one. */
export function elementFacts(topology: Topology, names: ElementNames, ref: Ref): ElementFacts | { error: string } {
  const r = resolveRef(ref, names, topology);
  if (!r.ok) return { error: t(r.reason === 'missing' ? 'drawing.refMissing' : 'drawing.refAmbiguous', { name: ref.name }) };
  if (ref.kind === 'vertex') return { kind: 'vertex', type: 'point', point: topology.vertices[r.index]!.point };
  if (ref.kind === 'edge') {
    const e = topology.edges[r.index]!;
    const g = e.geometry;
    if (g?.type === 'circle') return { kind: 'edge', type: 'circle', point: g.center, dir: g.normal, radius: g.radius };
    if (e.curve === 'line' && e.dir) return { kind: 'edge', type: 'line', point: e.mid, dir: e.dir };
    return { error: t('drawing.refKind', { name: ref.name }) };
  }
  if (ref.kind === 'face') {
    const f = topology.faces[r.index]!;
    const g = f.geometry;
    if (g?.type === 'plane') return { kind: 'face', type: 'plane', point: g.origin, dir: g.normal };
    if (g?.type === 'cylinder') return { kind: 'face', type: 'cylinder', point: g.origin, dir: g.axis, radius: g.radius };
    if (g?.type === 'sphere') return { kind: 'face', type: 'sphere', point: g.center, radius: g.radius };
    return { error: t('drawing.refKind', { name: ref.name }) };
  }
  return { error: t('drawing.refKind', { name: ref.name }) };
}

/**
 * The elements of the part that a view looking from `axes` sees edge-on or as a circle, in the view's coordinates (x to its right, y up): the planes square to the
 * view's x or y, and the cylinders along its direction. `faceAllowed` leaves out faces (those of a workpiece that is only there for reference).
 */
export function viewFeatures(topology: Topology, names: ElementNames, axes: ViewAxes, faceAllowed: (face: number) => boolean = () => true): ViewFeature[] {
  const right = rightOf(axes);
  const up = axes.up;
  const out: ViewFeature[] = [];
  // the longest circular edge of each face tells whether a cylinder is whole or an arc
  const longest = new Map<number, number>();
  for (const e of topology.edges) if (e.geometry?.type === 'circle') for (const f of e.faces) longest.set(f, Math.max(longest.get(f) ?? 0, e.length));
  topology.faces.forEach((f, i) => {
    const g = f.geometry;
    if (!g || !faceAllowed(i)) return;
    const ref = (): Ref => ({ kind: 'face', name: names.faces[i]!, fingerprint: faceFingerprint(topology, i) });
    if (g.type === 'plane' && Math.abs(dot(g.normal, axes.dir)) < 1e-6) {
      if (parallel(g.normal, right)) out.push({ type: 'plane', ref: ref(), axis: 'x', coord: dot(g.origin, right), area: f.area });
      else if (parallel(g.normal, up)) out.push({ type: 'plane', ref: ref(), axis: 'y', coord: dot(g.origin, up), area: f.area });
    } else if (g.type === 'cylinder' && parallel(g.axis, axes.dir)) {
      const centre: [number, number] = [dot(g.origin, right), dot(g.origin, up)];
      const to: V3 = [f.center[0] - g.origin[0], f.center[1] - g.origin[1], f.center[2] - g.origin[2]];
      const full = (longest.get(i) ?? 0) >= 2 * Math.PI * g.radius * (1 - 1e-3);
      out.push({
        type: 'circle',
        ref: ref(),
        centre,
        radius: g.radius,
        convex: g.convex,
        full,
        // a whole circle has no middle of its arc: its leader goes up and to the right
        outward: full ? 45 : (Math.atan2(dot(to, up), dot(to, right)) * 180) / Math.PI,
      });
    }
  });
  return out;
}

/** A reference to an element by its place in the topology (what a picked or listed element is made into). */
export function refOf(topology: Topology, names: ElementNames, kind: 'face' | 'edge' | 'vertex', index: number): Ref {
  return kind === 'face'
    ? { kind, name: names.faces[index]!, fingerprint: faceFingerprint(topology, index) }
    : kind === 'edge'
      ? { kind, name: names.edges[index]!, fingerprint: edgeFingerprint(topology, index) }
      : { kind, name: names.vertices[index]!, fingerprint: vertexFingerprint(topology, index) };
}
