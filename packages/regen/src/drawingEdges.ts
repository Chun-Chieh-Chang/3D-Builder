import type { Kernel, MeshData, ShapeId, Topology } from '@3db/kernel';
import type { ElementNames } from '@3db/naming';
import { rightOf, sheetUp, type ViewAxes, type ViewEdge, type ViewEdgeSet, type ViewVertex } from '@3db/model';
import { refOf } from './drawingDimensions';

type V3 = readonly [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The edges and vertices of a part as a view looking from `axes` sees them, each by its persistent name (D-I2, ADR 0138): the projection of every edge (the
 * polyline of the mesh's edges, which is in the topology's order) and of every vertex, with how near the viewer each point is. Which of them are seen is
 * decided against the view's own lines (`visibleElements` in @3db/drawing), so that hidden-line removal stays the only judge of what is drawn.
 *
 * `faceAllowed` leaves out the edges and vertices of faces that are not the part's (a workpiece kept for reference). `mesh` is the part's mesh, when the caller
 * has one for the part; otherwise one is made.
 */
export function viewEdges(
  kernel: Kernel,
  shape: ShapeId,
  topology: Topology,
  names: ElementNames,
  axes: ViewAxes,
  faceAllowed: (face: number) => boolean = () => true,
  mesh?: MeshData,
  /** A part of an assembly (D-I2): where the assembly puts it (row-major 3 × 4, `placementRows`) and the leaf's id its references carry. */
  place?: { rows: readonly number[]; in: string },
): ViewEdgeSet {
  const m = mesh ?? kernel.mesh(shape, { tolerance: 0.01, angular: 0.1 });
  const R = place?.rows;
  const put = (p: V3): V3 => (R ? [R[0]! * p[0] + R[1]! * p[1] + R[2]! * p[2] + R[3]!, R[4]! * p[0] + R[5]! * p[1] + R[6]! * p[2] + R[7]!, R[8]! * p[0] + R[9]! * p[1] + R[10]! * p[2] + R[11]!] : p);
  const turn = (v: V3): V3 => (R ? [R[0]! * v[0] + R[1]! * v[1] + R[2]! * v[2], R[4]! * v[0] + R[5]! * v[1] + R[6]! * v[2], R[8]! * v[0] + R[9]! * v[1] + R[10]! * v[2]] : v);
  const named = <T extends object>(r: T): T => (place ? { ...r, in: place.in } : r);
  const right = rightOf(axes);
  const up = sheetUp(axes);
  const toward: V3 = [-axes.dir[0], -axes.dir[1], -axes.dir[2]];
  const owned = (faces: readonly number[]) => faces.length === 0 || faces.some(faceAllowed);
  const vertexRef = (i: number | undefined) => (i === undefined || !names.vertices[i] ? null : named(refOf(topology, names, 'vertex', i)));
  // A seam — the edge where a closed surface (a cylinder, a cone) meets itself — is a mark of how the surface is made, not a corner anyone sees: it has only that
  // one face, and it is not planar. Nor is the vertex where a whole circle starts and ends: a point of the B-rep, not of the shape. Neither is offered, so that
  // pointing at a hole's outline picks the hole and not the point its circle happens to start at (SolidWorks offers neither).
  const seam = (ei: number) => {
    const fs = topology.edges[ei]!.faces;
    return fs.length === 1 && topology.faces[fs[0]!]?.surface !== 'plane';
  };
  const closed = (ei: number) => {
    const vs = topology.edges[ei]!.vertices;
    return vs.length < 2 || vs[0] === vs[1];
  };
  /** A vertex worth pointing at: an end of an edge that runs between two different vertices and is not a seam. */
  const corner = new Set<number>();
  topology.edges.forEach((e, ei) => {
    if (!seam(ei) && !closed(ei)) for (const v of e.vertices) corner.add(v);
  });
  const edges: ViewEdge[] = [];
  for (let r = 0; r + 2 < m.edgeRanges.length; r += 3) {
    const start = m.edgeRanges[r]!;
    const count = m.edgeRanges[r + 1]!;
    const ei = m.edgeRanges[r + 2]!;
    const info = topology.edges[ei];
    if (!info || !names.edges[ei] || !owned(info.faces) || seam(ei)) continue;
    const points: number[] = [];
    const depth: number[] = [];
    for (let i = 0; i < count; i++) {
      const p: V3 = put([m.edgePoints[3 * (start + i)]!, m.edgePoints[3 * (start + i) + 1]!, m.edgePoints[3 * (start + i) + 2]!]);
      points.push(dot(p, right), dot(p, up));
      depth.push(dot(p, toward));
    }
    const g = info.geometry;
    const kind: ViewEdge['kind'] = info.curve === 'line' ? 'line' : g?.type === 'circle' ? 'circle' : 'curve';
    // a circle is dimensioned as one only where it is seen in its true shape: its plane square to the view
    const circle = g?.type === 'circle' && Math.abs(Math.abs(dot(turn(g.normal), axes.dir)) - 1) < 1e-6 ? { centre: [dot(put(g.center), right), dot(put(g.center), up)] as [number, number], radius: g.radius } : undefined;
    // the ends in the order the points run (ADR 0175): the mesh walks an edge either way round, and an end named for the other end is a dimension of 0 when it
    // is taken as it stands (a line measured alone between its two ends)
    let vs = info.vertices;
    if (vs.length > 1 && vs[1] !== vs[0] && points.length >= 4) {
      const off = (v: number, k: number) => {
        const p = put(topology.vertices[v]!.point);
        return Math.hypot(dot(p, right) - points[k]!, dot(p, up) - points[k + 1]!);
      };
      const last = points.length - 2;
      if (off(vs[0]!, 0) + off(vs[1]!, last) > off(vs[1]!, 0) + off(vs[0]!, last)) vs = [vs[1]!, vs[0]!];
    }
    const inPlane = kind === 'line' && !!info.dir && Math.abs(dot(turn(info.dir), axes.dir)) < 1e-6;
    edges.push({ ref: named(refOf(topology, names, 'edge', ei)), kind, points, depth, ends: [vertexRef(vs[0]), vs.length > 1 && vs[1] !== vs[0] ? vertexRef(vs[1]) : null], ...(circle ? { circle } : {}), ...(inPlane ? { inPlane } : {}) });
  }
  const vertices: ViewVertex[] = [];
  topology.vertices.forEach((v, i) => {
    if (!names.vertices[i] || !owned(v.faces) || !corner.has(i)) return;
    const at = put(v.point);
    vertices.push({ ref: named(refOf(topology, names, 'vertex', i)), at: [dot(at, right), dot(at, up)], depth: dot(at, toward) });
  });
  return { edges, vertices };
}
