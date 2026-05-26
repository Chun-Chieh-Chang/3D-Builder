import { type SketchNode, type SketchEdge } from '@/store/useCadStore';

export interface TrimCandidate {
  edgeId: string;
  nodeId: string;
  distance: number;
  segmentIndex: number;
  param: number;
}

function getPointOnEdge(
  edge: SketchEdge,
  nodes: Record<string, SketchNode>,
  t: number
): { x: number; y: number } {
  if (edge.nodeIds.length < 2) return { x: 0, y: 0 };
  const startNode = nodes[edge.nodeIds[0]];
  const endNode = nodes[edge.nodeIds[1]];
  if (!startNode || !endNode) return { x: 0, y: 0 };

  if (edge.type === 'LINE' || edge.type === 'CENTER_LINE') {
    return {
      x: startNode.x + (endNode.x - startNode.x) * t,
      y: startNode.y + (endNode.y - startNode.y) * t
    };
  }
  return { x: 0, y: 0 };
}

function distanceToEdge(
  edge: SketchEdge,
  nodes: Record<string, SketchNode>,
  clickPoint: { x: number; y: number },
  tolerance: number = 0.5
): { closestT: number; closestDist: number } | null {
  if (edge.nodeIds.length < 2) return null;
  const startNode = nodes[edge.nodeIds[0]];
  const endNode = nodes[edge.nodeIds[1]];
  if (!startNode || !endNode) return null;

  let bestT = 0;
  let bestDist = Infinity;

  if (edge.type === 'LINE' || edge.type === 'CENTER_LINE') {
    const dx = endNode.x - startNode.x;
    const dy = endNode.y - startNode.y;
    const len2 = dx * dx + dy * dy;

    if (len2 === 0) {
      const dist = Math.hypot(clickPoint.x - startNode.x, clickPoint.y - startNode.y);
      return { closestT: 0, closestDist: dist };
    }

    let t = ((clickPoint.x - startNode.x) * dx + (clickPoint.y - startNode.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const px = startNode.x + t * dx;
    const py = startNode.y + t * dy;
    const dist = Math.hypot(clickPoint.x - px, clickPoint.y - py);

    if (dist < tolerance) {
      return { closestT: t, closestDist: dist };
    }
  }

  for (let t = 0; t <= 1; t += 0.02) {
    const pt = getPointOnEdge(edge, nodes, t);
    const dist = Math.hypot(clickPoint.x - pt.x, clickPoint.y - pt.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }

  if (bestDist < tolerance) {
    return { closestT: bestT, closestDist: bestDist };
  }

  return null;
}

function findIntersections(
  targetEdge: SketchEdge,
  allEdges: Record<string, SketchEdge>,
  allNodes: Record<string, SketchNode>
): Array<{ t: number; edgeId: string }> {
  const intersections: Array<{ t: number; edgeId: string }> = [];
  if (targetEdge.nodeIds.length < 2) return intersections;

  const targetStartId = targetEdge.nodeIds[0];
  const targetEndId = targetEdge.nodeIds[1];

  for (const [edgeId, edge] of Object.entries(allEdges)) {
    if (edgeId === targetEdge.id) continue;
    if (edge.nodeIds.length < 2) continue;

    const edgeStartId = edge.nodeIds[0];
    const edgeEndId = edge.nodeIds[1];

    if (edgeStartId === targetStartId || edgeStartId === targetEndId) {
      intersections.push({ t: edgeStartId === targetStartId ? 0 : 1, edgeId });
    }
    if (edgeEndId === targetStartId || edgeEndId === targetEndId) {
      intersections.push({ t: edgeEndId === targetStartId ? 0 : 1, edgeId });
    }
  }

  return intersections.sort((a, b) => a.t - b.t);
}

export function findTrimCandidates(
  sketchNodes: Record<string, SketchNode>,
  sketchEdges: Record<string, SketchEdge>,
  clickPoint: { x: number; y: number },
  tolerance: number = 0.5
): TrimCandidate[] {
  const candidates: TrimCandidate[] = [];

  for (const [edgeId, edge] of Object.entries(sketchEdges)) {
    const result = distanceToEdge(edge, sketchNodes, clickPoint, tolerance);
    if (result && edge.nodeIds.length >= 2) {
      const intersections = findIntersections(edge, sketchEdges, sketchNodes);

      let bestSegmentIndex = 0;
      for (let i = 0; i < intersections.length - 1; i++) {
        if (result.closestT >= intersections[i].t && result.closestT <= intersections[i + 1].t) {
          bestSegmentIndex = i;
        }
      }

      candidates.push({
        edgeId,
        nodeId: result.closestT < 0.5 ? edge.nodeIds[0] : edge.nodeIds[1],
        distance: result.closestDist,
        segmentIndex: bestSegmentIndex,
        param: result.closestT
      });
    }
  }

  return candidates.sort((a, b) => a.distance - b.distance);
}

export function executeTrim(
  sketchNodes: Record<string, SketchNode>,
  sketchEdges: Record<string, SketchEdge>,
  targetEdgeId: string,
  trimParam: number
): {
  nodes: Record<string, SketchNode>;
  edges: Record<string, SketchEdge>;
} {
  const edge = sketchEdges[targetEdgeId];
  if (!edge || edge.nodeIds.length < 2) {
    return { nodes: sketchNodes, edges: sketchEdges };
  }

  const startNode = sketchNodes[edge.nodeIds[0]];
  const endNode = sketchNodes[edge.nodeIds[1]];
  if (!startNode || !endNode) {
    return { nodes: sketchNodes, edges: sketchEdges };
  }

  const intersections = findIntersections(edge, sketchEdges, sketchNodes);

  let keepStart = trimParam > 0.5;
  let cutT = 0;
  
  if (intersections.length > 0) {
    cutT = keepStart 
      ? Math.max(...intersections.filter(i => i.t <= trimParam).map(i => i.t)) 
      : Math.min(...intersections.filter(i => i.t >= trimParam).map(i => i.t));
  } else {
    cutT = keepStart ? 1 : 0;
  }

  const newNodes = { ...sketchNodes };
  const newEdges = { ...sketchEdges };

  if (cutT <= 0 || cutT >= 1) {
    delete newEdges[targetEdgeId];
    return { nodes: newNodes, edges: newEdges };
  }

  const cutPoint = getPointOnEdge(edge, sketchNodes, cutT);
  const newNodeId = `trim_node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  newNodes[newNodeId] = {
    id: newNodeId,
    x: cutPoint.x,
    y: cutPoint.y,
    isFixed: false
  };

  if (keepStart) {
    newEdges[targetEdgeId] = {
      ...edge,
      nodeIds: [edge.nodeIds[0], newNodeId]
    };
  } else {
    newEdges[targetEdgeId] = {
      ...edge,
      nodeIds: [newNodeId, edge.nodeIds[1]]
    };
  }

  return { nodes: newNodes, edges: newEdges };
}
