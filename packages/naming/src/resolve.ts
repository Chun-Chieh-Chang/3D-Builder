import type { Fingerprint, Ref } from '@3db/model';
import type { ElementNames } from './names';

/**
 * A name with the "#k" split suffix removed at every level: `{e1:cap:end#2|e1:side:s1.l1}` →
 * `{e1:cap:end|e1:side:s1.l1}`. A reference made before a face was split keeps this base name.
 */
export function baseName(name: string): string {
  return name.replace(/#\d+(?=[|}>]|$)/g, '');
}

type Vec3 = [number, number, number];

export interface FingerprintTopology {
  faces: { surface: string; area: number; center: Vec3; normal: Vec3 | null }[];
  edges: { curve: string; length: number; mid: Vec3; dir: Vec3 | null }[];
  vertices: { point: Vec3 }[];
}

export function vertexFingerprint(topo: FingerprintTopology, i: number): Fingerprint {
  return { type: 'point', size: 0, center: topo.vertices[i]!.point };
}

export function faceFingerprint(topo: FingerprintTopology, i: number): Fingerprint {
  const f = topo.faces[i]!;
  return { type: f.surface, size: f.area, center: f.center, ...(f.normal ? { dir: f.normal } : {}) };
}

export function edgeFingerprint(topo: FingerprintTopology, i: number): Fingerprint {
  const e = topo.edges[i]!;
  return { type: e.curve, size: e.length, center: e.mid, ...(e.dir ? { dir: e.dir } : {}) };
}

/** Lower is closer. Type mismatch dominates, then size, position and direction. */
export function fingerprintDistance(a: Fingerprint, b: Fingerprint): number {
  let d = a.type === b.type ? 0 : 1e6;
  d += Math.abs(a.size - b.size);
  d += Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
  if (a.dir && b.dir) d += 10 * (1 - Math.abs(a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2]));
  return d;
}

export interface Candidate {
  index: number;
  name: string;
  distance: number;
  /** Of the candidate itself: what a reference to it (`replaceRef`, B4.3) stores. */
  fingerprint: Fingerprint;
}

export type Resolution =
  | { ok: true; index: number; via: 'name' | 'base-name' | 'fingerprint' }
  | { ok: false; reason: 'missing' | 'ambiguous'; candidates: Candidate[] };

/**
 * Resolves a persistent reference against a result's names (B4.2):
 * exact name → unique name ignoring "#k" at every level → fingerprint among equal names.
 * A reference that cannot be resolved is reported with ranked candidates (B4.3) — never guessed.
 */
export function resolveRef(ref: Ref, names: ElementNames, topo: FingerprintTopology): Resolution {
  const kind = ref.kind === 'edge' ? 'edges' : ref.kind === 'face' ? 'faces' : ref.kind === 'vertex' ? 'vertices' : null;
  if (!kind) return { ok: false, reason: 'missing', candidates: [] };
  const list = names[kind];
  const fp = (i: number) => (kind === 'edges' ? edgeFingerprint(topo, i) : kind === 'faces' ? faceFingerprint(topo, i) : vertexFingerprint(topo, i));
  const rank = (indices: number[]): Candidate[] =>
    indices
      .map((index) => {
        const fingerprint = fp(index);
        return { index, name: list[index]!, distance: ref.fingerprint ? fingerprintDistance(ref.fingerprint, fingerprint) : Infinity, fingerprint };
      })
      .sort((a, b) => a.distance - b.distance);

  const exact = list.flatMap((n, i) => (n === ref.name ? [i] : []));
  if (exact.length === 1) return { ok: true, index: exact[0]!, via: 'name' };

  const base = baseName(ref.name);
  const sameBase = list.flatMap((n, i) => (baseName(n) === base ? [i] : []));
  if (exact.length === 0 && sameBase.length === 1) return { ok: true, index: sameBase[0]!, via: 'base-name' };

  const pool = exact.length > 0 ? exact : sameBase;
  if (pool.length > 1) {
    const ranked = rank(pool);
    const [best, second] = ranked;
    if (best && ref.fingerprint && (!second || second.distance - best.distance > 1e-3)) {
      return { ok: true, index: best.index, via: 'fingerprint' };
    }
    return { ok: false, reason: 'ambiguous', candidates: ranked.slice(0, 5) };
  }
  return { ok: false, reason: 'missing', candidates: rank(list.map((_, i) => i)).slice(0, 5) };
}
