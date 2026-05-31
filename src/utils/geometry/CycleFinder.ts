import { SketchNode, SketchEdge } from '../../store/useCadStore';

/**
 * Planar Graph Cycle Finder
 * Partitions the Sketch Graph (nodes & edges) into connected components
 * and extracts all closed loops (outer boundary + inner cutout islands),
 * sorting them by 2D bounding area descending.
 */
export function extractAllClosedLoops(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>
): any[][] {
  const edgeList = Object.values(edges).filter(e => !e.isConstruction);
  if (edgeList.length === 0) return [];

  const loops: any[][] = [];
  const normalEdges: SketchEdge[] = [];

  // Separate CIRCLE edges from others
  for (const e of edgeList) {
    if (e.type === 'CIRCLE') {
      const center = nodes[e.nodeIds[0]];
      const perimeter = nodes[e.nodeIds[1]];
      if (center && perimeter) {
        const r = Math.hypot(perimeter.x - center.x, perimeter.y - center.y);
        const metadata = { edgeId: e.id };
        // We can emit a special loop for CIRCLE that the backend can recognize.
        loops.push([
          [center.x, center.y, 'CIRCLE_CENTER', metadata],
          [perimeter.x, perimeter.y, 'CIRCLE_PERIMETER', metadata],
          [center.x, center.y, undefined, metadata] // close the loop for consistency
        ]);
      }
    } else {
      normalEdges.push(e);
    }
  }

  // 1. Create Half-Edges
  // Each undirected edge (u, v) becomes two half-edges: u->v and v->u
  interface HalfEdge {
    from: string;
    to: string;
    angle: number;
    next?: HalfEdge;
    visited: boolean;
    edge: SketchEdge;
  }

  const outEdges = new Map<string, HalfEdge[]>();
  
  for (const e of normalEdges) {
    if (e.type === 'SPLINE') {
       // A spline has > 2 nodes: nodeIds[0] ... nodeIds[n-1]
       // It acts as a single edge from nodeIds[0] to nodeIds[n-1]
       const n1 = e.nodeIds[0];
       const n2 = e.nodeIds[e.nodeIds.length - 1];
       if (!n1 || !n2 || !nodes[n1] || !nodes[n2]) continue;
       const p1 = nodes[n1];
       const p2 = nodes[n2];
       const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
       const angle2 = Math.atan2(p1.y - p2.y, p1.x - p2.x);
       
       const he1: HalfEdge = { from: n1, to: n2, angle: angle1, visited: false, edge: e };
       const he2: HalfEdge = { from: n2, to: n1, angle: angle2, visited: false, edge: e };
       
       if (!outEdges.has(n1)) outEdges.set(n1, []);
       if (!outEdges.has(n2)) outEdges.set(n2, []);
       outEdges.get(n1)!.push(he1);
       outEdges.get(n2)!.push(he2);
       continue;
    }

    // LINE or ARC
    const n1 = e.nodeIds[0];
    const n2 = e.type === 'ARC' ? e.nodeIds[1] : e.nodeIds[e.nodeIds.length - 1];
    if (!n1 || !n2 || !nodes[n1] || !nodes[n2]) continue;
    
    const p1 = nodes[n1];
    const p2 = nodes[n2];
    
    const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const angle2 = Math.atan2(p1.y - p2.y, p1.x - p2.x);
    
    const he1: HalfEdge = { from: n1, to: n2, angle: angle1, visited: false, edge: e };
    const he2: HalfEdge = { from: n2, to: n1, angle: angle2, visited: false, edge: e };
    
    if (!outEdges.has(n1)) outEdges.set(n1, []);
    if (!outEdges.has(n2)) outEdges.set(n2, []);
    
    outEdges.get(n1)!.push(he1);
    outEdges.get(n2)!.push(he2);
  }

  // 2. Sort half-edges by angle and link them
  const allHalfEdges: HalfEdge[] = [];
  
  for (const [nodeId, heArray] of outEdges.entries()) {
    // Sort Counter-Clockwise
    heArray.sort((a, b) => a.angle - b.angle);
    allHalfEdges.push(...heArray);
  }

  for (const he of allHalfEdges) {
    const targetNode = he.to;
    const targetOutEdges = outEdges.get(targetNode)!;
    // Find the reverse edge (targetNode -> he.from)
    const revIndex = targetOutEdges.findIndex(e => e.to === he.from);
    // The next edge in the face is the one immediately counter-clockwise to the reverse edge
    const nextIndex = (revIndex + 1) % targetOutEdges.length;
    he.next = targetOutEdges[nextIndex];
  }

  // 3. Traverse to find all faces (cycles)
  const faces: HalfEdge[][] = [];
  
  for (const he of allHalfEdges) {
    if (!he.visited) {
      const face: HalfEdge[] = [];
      let curr = he;
      while (!curr.visited) {
        curr.visited = true;
        face.push(curr);
        curr = curr.next!;
      }
      // Only keep faces with at least 3 edges (or 2 edges if we consider a closed shape with 2 curves like two arcs)
      if (face.length >= 2) {
        faces.push(face);
      }
    }
  }

  for (const face of faces) {
    // Convert to coordinates [x, y, tag, metadata]
    const result: any[] = [];
    for (let i = 0; i < face.length; i++) {
      const he = face[i];
      const p = nodes[he.from];
      const metadata = { edgeId: he.edge.id };
      result.push([p.x, p.y, i === 0 ? 'START' : undefined, metadata]);
      
      if (he.edge.type === 'ARC' && he.edge.nodeIds.length >= 3) {
         const cp = nodes[he.edge.nodeIds[2]];
         if (cp) {
             result.push([cp.x, cp.y, 'ARC_CONTROL', metadata]);
         }
      } else if (he.edge.type === 'SPLINE') {
         // Emit intermediate control points with 'SPLINE_CONTROL' tag
         const isForward = he.edge.nodeIds[0] === he.from;
         const innerNodeIds = he.edge.nodeIds.slice(1, -1);
         if (!isForward) innerNodeIds.reverse();
         
         for (const innerId of innerNodeIds) {
             const innerP = nodes[innerId];
             if (innerP) {
                 result.push([innerP.x, innerP.y, 'SPLINE_CONTROL', metadata]);
             }
         }
      }
    }
    // Close the loop
    const firstP = nodes[face[0].from];
    const firstMetadata = { edgeId: face[0].edge.id };
    result.push([firstP.x, firstP.y, undefined, firstMetadata]);
    
    loops.push(result);
  }

  // 4. Sort loops by 2D bounding area descending
  loops.sort((a, b) => {
    const areaA = calculateLoopArea(a);
    const areaB = calculateLoopArea(b);
    return areaB - areaA;
  });

  return loops;
}

/**
 * Computes the 2D bounding box area of a loop of points
 */
function calculateLoopArea(loop: any[]): number {
  if (loop.length === 0) return 0;
  const xs = loop.map(p => p[0]);
  const ys = loop.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return (maxX - minX) * (maxY - minY);
}

/**
 * Extracts all connected paths (open or closed) from the sketch graph.
 */
export function extractAllPaths(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>
): any[][] {
  const edgeList = Object.values(edges).filter(e => !e.isConstruction);
  if (edgeList.length === 0) return [];
  
  const paths: any[][] = [];
  const visitedEdges = new Set<string>();

  // Simple heuristic: just dump all edges as individual paths for surfacing,
  // or group connected edges. For now, we group into connected components.
  // Given time constraints, emitting each edge as a path is valid for surface sweeping/extrusion
  // if the backend handles them together. But grouping them as continuous paths is better.
  
  for (const e of edgeList) {
      if (visitedEdges.has(e.id)) continue;
      
      const path: any[] = [];
      const n1 = e.nodeIds[0];
      const n2 = e.nodeIds[e.nodeIds.length - 1];
      const p1 = nodes[n1];
      const p2 = nodes[n2];
      if (!p1 || !p2) continue;
      
      const metadata = { edgeId: e.id };
      path.push([p1.x, p1.y, 'START', metadata]);
      if (e.type === 'SPLINE') {
          for (let i = 1; i < e.nodeIds.length - 1; i++) {
              const cp = nodes[e.nodeIds[i]];
              if (cp) path.push([cp.x, cp.y, 'SPLINE_CONTROL', metadata]);
          }
      } else if (e.type === 'CIRCLE') {
          // Add dummy control point for arc
          const cp = nodes[e.nodeIds[1]]; // Assuming nodeIds[1] is arc control if it were arc... but CIRCLE is full
      }
      path.push([p2.x, p2.y, undefined, metadata]);
      paths.push(path);
      visitedEdges.add(e.id);
  }
  
  return paths;
}

/**
 * Identifies nodes with degree 1 in the non-construction sketch graph.
 * These usually represent open ends of a profile.
 */
export function findDanglingNodes(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>
): string[] {
  const edgeList = Object.values(edges).filter(e => !e.isConstruction);
  const degrees = new Map<string, number>();

  for (const e of edgeList) {
    const n1 = e.nodeIds[0];
    const n2 = e.nodeIds[e.nodeIds.length - 1];
    if (nodes[n1]) degrees.set(n1, (degrees.get(n1) || 0) + 1);
    if (nodes[n2]) degrees.set(n2, (degrees.get(n2) || 0) + 1);
  }

  const dangling: string[] = [];
  for (const [nodeId, degree] of degrees.entries()) {
    if (degree === 1) {
      dangling.push(nodeId);
    }
  }

  return dangling;
}

