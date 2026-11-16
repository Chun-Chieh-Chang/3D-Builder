import { rethrowTrap, type Kernel, type MeshData, type ShapeId, type SurfaceGeometry } from '@3db/kernel';
import type { PartDoc, Vec3 } from '@3db/model';
import type { RebuildOptions, Regenerator } from './engine';

export interface SubtractionVolume {
  id: string;
  volume: number;
  faces: string[];
  graphics?: { anchor: Vec3; mesh: MeshData };
}

type Rim = { edge: ShapeId; face: ShapeId; geometry: SurfaceGeometry | undefined };
function samePlane(a: SurfaceGeometry | undefined, b: SurfaceGeometry | undefined): boolean {
  if (a?.type !== 'plane' || b?.type !== 'plane') return false;
  const [x, y, z] = a.normal;
  return x * b.normal[0] + y * b.normal[1] + z * b.normal[2] >= 1 - 1e-12 &&
    Math.abs(x * (a.origin[0] - b.origin[0]) + y * (a.origin[1] - b.origin[1]) + z * (a.origin[2] - b.origin[2])) <= 1e-7;
}

/** Replay only for a measurement. With no face filter, return display geometry for each verified cavity. */
export function subtractionVolumes(kernel: Kernel, replay: Regenerator, doc: PartDoc, selected: readonly string[] | null, until?: number): SubtractionVolume[] {
  const retained: ShapeId[] = [];
  const candidates: { id: string; volume: number; body: string; walls: ShapeId[]; rim: Rim[]; graphics?: SubtractionVolume['graphics'] }[] = [];
  const previousWalls = new Map<string, Set<string>>();
  const picked = new Set(selected);
  const inspectSubtract: NonNullable<RebuildOptions['inspectSubtract']> = (feature, before, tool, after, walls) => {
    const names = walls.map((i) => after.names.faces[i]!);
    const previous = previousWalls.get(before.id) ?? new Set<string>();
    const joined = new Set(previous);
    for (const name of names) joined.add(name);
    previousWalls.set(after.id, joined);
    if (!names.length || (selected !== null && !names.some((name) => picked.has(name)))) return;

    try {
      const removed = kernel.boolean('common', before.shape, tool.shape, { mergeFaces: false });
      try {
        // A new cutter that opens through a previous cavity is only a fraction of that cavity.
        if (removed.faceOrigins.some((origins) => origins.some((o) =>
          'kind' in o && o.kind === 'face' && previous.has(before.names.faces[o.index]!)))) return;
        const check = kernel.check(removed.shape);
        if (!check.valid || check.solids !== 1 || check.freeEdges !== 0) return;
        const { volume } = kernel.massPropsExact(removed.shape);
        if (!Number.isFinite(volume) || volume <= 0) return;
        const wallSet = new Set(walls);
        const keep = (kind: 'face' | 'edge', i: number) => {
          const element = kernel.subShape(after.shape, kind, i);
          retained.push(element);
          return element;
        };
        const rim = after.topology.edges.flatMap((edge, i) => edge.faces.some((f) => wallSet.has(f))
          ? edge.faces.filter((f) => !wallSet.has(f)).map((f) => ({
            edge: keep('edge', i), face: keep('face', f), geometry: after.topology.faces[f]?.geometry,
          })) : []);
        const region = selected === null ? kernel.regions(removed.shape)[0] : undefined;
        const graphics = region ? { anchor: region.anchor, mesh: kernel.mesh(removed.shape, { relative: 0.001, angular: 0.25 }) } : undefined;
        candidates.push({ id: feature.id, volume, body: after.id, walls: walls.map((i) => keep('face', i)), rim, graphics });
      } finally {
        kernel.release(removed.shape);
      }
    } catch (error) {
      rethrowTrap(error);
    }
  };
  try {
    const result = replay.rebuild(doc, { until, inspectSubtract });
    const view = result.body;
    if (!view) return [];
    return candidates.flatMap((candidate) => {
      const body = result.bodies.find((b) => b.id === candidate.body && !b.reference && !b.surface);
      if (!body) return [];
      const walls = kernel.subShapeIndices(body.shape, 'face', candidate.walls);
      if (walls.some((i) => i < 0)) return [];
      const outer = kernel.subShapeIndices(body.shape, 'face', candidate.rim.map((r) => r.face));
      const edges = kernel.subShapeIndices(body.shape, 'edge', candidate.rim.map((r) => r.edge));
      const intact = edges.every((edge, i) => edge >= 0 && view.topology.edges[body.edge0 + edge]!.faces.some((f) =>
        !walls.includes(f - body.face0) && (f - body.face0 === outer[i] || samePlane(candidate.rim[i]!.geometry, view.topology.faces[f]?.geometry))));
      if (!intact) return [];
      const faces = walls.map((i) => view.names.faces[body.face0 + i]!);
      return [{ id: candidate.id, volume: candidate.volume, faces, graphics: candidate.graphics }];
    });
  } finally {
    for (const face of retained) kernel.release(face);
    replay.dispose();
  }
}
