/**
 * Persistent naming grammar (B4.1). Names are derived from how an element was generated,
 * never from its position in the topology:
 *   face    <featureId>:side:<sketchId>.<entityId> | <featureId>:cap:start|end
 *           <featureId>:<role>:<inputEdgeName>      (e.g. fillet faces)
 *           <featureId>:f<k>                       (k-th face of an imported shape, as its file orders them)
 *           inherited input face name              (faces kept or modified by an operation)
 *   edge    {<faceName>|<faceName>}                (sorted adjacent face names)
 *   vertex  <<faceName>|<faceName>|…>              (sorted adjacent face names)
 *   A "#k" suffix disambiguates elements that would otherwise share a name (ordered geometrically).
 */

type Vec3 = [number, number, number];

/** Structural copy of @3db/kernel FaceOrigin (naming does not depend on the kernel). */
export type Origin =
  | { rel: 'same' | 'modified'; kind: 'face'; index: number }
  | { rel: 'generated'; kind: 'edge' | 'vertex' | 'face'; index: number }
  | { rel: 'generated'; kind: 'profileEdge'; source: string }
  | { rel: 'cap'; which: 'start' | 'end' }
  | { rel: 'imported'; index: number };

export interface NamingTopology {
  faces: { center: Vec3 }[];
  edges: { mid: Vec3; faces: number[] }[];
  vertices: { point: Vec3; faces: number[] }[];
}

export interface ElementNames {
  faces: string[];
  edges: string[];
  vertices: string[];
}

export interface NamingContext {
  featureId: string;
  /** Sketch whose entities generated profile edges (extrude/revolve). */
  sketchId?: string;
  /** Role label for faces generated from input edges/vertices, e.g. "fillet". */
  role?: string;
  /** Names of the operation's input shape. */
  input?: ElementNames;
}

const EPS = 1e-6;

/** Lexicographic order on coordinates with tolerance: deterministic tie-break for "#k" suffixes. */
function compareVec(a: Vec3, b: Vec3): number {
  for (let i = 0; i < 3; i++) {
    const d = a[i]! - b[i]!;
    if (Math.abs(d) > EPS) return d;
  }
  return 0;
}

function disambiguate(base: string[], keyOf: (i: number) => Vec3): string[] {
  const groups = new Map<string, number[]>();
  base.forEach((n, i) => groups.set(n, [...(groups.get(n) ?? []), i]));
  const out = base.slice();
  for (const [name, members] of groups) {
    if (members.length < 2) continue;
    members.sort((a, b) => compareVec(keyOf(a), keyOf(b)));
    members.forEach((m, k) => (out[m] = `${name}#${k + 1}`));
  }
  return out;
}

const PRIORITY: Record<string, number> = { edge: 0, vertex: 1, face: 2, profileEdge: 3, cap: 4, imported: 5 };

function faceBaseName(origins: Origin[], ctx: NamingContext): string {
  const f = ctx.featureId;
  const rank = (o: Origin) => PRIORITY[o.rel === 'cap' || o.rel === 'imported' ? o.rel : o.kind]!;
  const sorted = origins.slice().sort((a, b) => rank(a) - rank(b));
  const o = sorted[0];
  if (!o) return `${f}:face`;
  if (o.rel === 'cap') return `${f}:cap:${o.which}`;
  if (o.rel === 'imported') return `${f}:f${o.index + 1}`;
  if (o.kind === 'profileEdge') return `${f}:side:${ctx.sketchId ?? '?'}.${o.source}`;
  const role = ctx.role ?? 'op';
  if (o.kind === 'edge') return `${f}:${role}:${ctx.input?.edges[o.index] ?? `?e${o.index}`}`;
  if (o.kind === 'vertex') return `${f}:${role}-v:${ctx.input?.vertices[o.index] ?? `?v${o.index}`}`;
  if (o.rel === 'generated' && o.kind === 'face') return `${f}:${role}:${ctx.input?.faces[o.index] ?? `?f${o.index}`}`;
  return ctx.input?.faces[o.index] ?? `${f}:face`;
}

export const edgeName = (faceNames: string[]) => `{${[...faceNames].sort().join('|')}}`;
export const vertexName = (faceNames: string[]) => `<${[...faceNames].sort().join('|')}>`;

/** Names every face, edge and vertex of an operation result. */
export function nameElements(origins: Origin[][], topo: NamingTopology, ctx: NamingContext): ElementNames {
  const faces = disambiguate(
    origins.map((o) => faceBaseName(o, ctx)),
    (i) => topo.faces[i]!.center,
  );
  return nameFromFaces(faces, topo);
}

/**
 * The edges and vertices of a shape, named by the faces round them, given the names of its faces. For a piece of a result
 * that came apart (C7): its faces have the names they got in the whole result, with the #k that told them apart there.
 */
export function nameFromFaces(faces: string[], topo: NamingTopology): ElementNames {
  const edges = disambiguate(
    topo.edges.map((e) => edgeName(e.faces.map((fi) => faces[fi]!))),
    (i) => topo.edges[i]!.mid,
  );
  const vertices = disambiguate(
    topo.vertices.map((v) => vertexName(v.faces.map((fi) => faces[fi]!))),
    (i) => topo.vertices[i]!.point,
  );
  return { faces, edges, vertices };
}

/** Splits "a|b|c" at top level only (names nest braces/angle brackets). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '<') depth++;
    if (ch === '}' || ch === '>') depth--;
    if (ch === '|' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const stripSuffix = (name: string) => name.replace(/#\d+$/, '');

/** Face names an element name is built from (the element itself for faces). */
export function faceNamesOf(name: string): string[] {
  const n = stripSuffix(name);
  if ((n.startsWith('{') && n.endsWith('}')) || (n.startsWith('<') && n.endsWith('>'))) return splitTop(n.slice(1, -1));
  return [n];
}

/** Feature ids that created the faces an element name refers to (parents in the dependency DAG, B2.2). */
export function ownerFeatures(name: string): string[] {
  return [...new Set(faceNamesOf(name).map((f) => f.split(':')[0]!))];
}

export { stripSuffix };
