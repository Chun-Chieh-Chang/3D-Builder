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

  // Build Adjacency List for the whole graph
  const adj = new Map<string, string[]>();
  const allNodes = new Set<string>();

  for (const e of edgeList) {
    const [n1, n2] = e.nodeIds;
    if (!n1 || !n2) continue;
    if (!adj.has(n1)) adj.set(n1, []);
    if (!adj.has(n2)) adj.set(n2, []);
    adj.get(n1)!.push(n2);
    adj.get(n2)!.push(n1);
    allNodes.add(n1);
    allNodes.add(n2);
  }

  // 1. Partition graph into Connected Components
  const visitedComponents = new Set<string>();
  const components: string[][] = [];

  for (const nodeId of allNodes) {
    if (!visitedComponents.has(nodeId)) {
      // Run BFS to collect all nodes in this connected component
      const component: string[] = [];
      const queue: string[] = [nodeId];
      visitedComponents.add(nodeId);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        component.push(curr);
        const neighbors = adj.get(curr) || [];
        for (const nxt of neighbors) {
          if (!visitedComponents.has(nxt)) {
            visitedComponents.add(nxt);
            queue.push(nxt);
          }
        }
      }
      components.push(component);
    }
  }

  const loops: any[][] = [];

  // 2. Extract cycle for each component
  for (const comp of components) {
    if (comp.length < 3) continue;

    // Find cycle within this component using DFS
    const visitedDFS = new Set<string>();
    const path: string[] = [];
    let loopStart: string | null = null;

    function dfs(curr: string, parent: string | null): boolean {
      visitedDFS.add(curr);
      path.push(curr);

      const neighbors = adj.get(curr) || [];
      for (const nxt of neighbors) {
        if (nxt === parent) continue;
        // Check if nxt is in this component (defensive check)
        if (!comp.includes(nxt)) continue;

        if (visitedDFS.has(nxt)) {
          loopStart = nxt;
          return true;
        }
        if (dfs(nxt, curr)) return true;
      }

      path.pop();
      return false;
    }

    // Pick start node with degree >= 2 in this component
    let startNode = comp[0];
    for (const nodeId of comp) {
      if ((adj.get(nodeId) || []).length >= 2) {
        startNode = nodeId;
        break;
      }
    }

    dfs(startNode, null);

    if (loopStart) {
      const startIndex = path.indexOf(loopStart);
      const cycleNodes = path.slice(startIndex);

      if (cycleNodes.length >= 3) {
        // Convert to coordinates [x, y, tag]
        const result: any[] = [];
        for (let i = 0; i < cycleNodes.length; i++) {
          const nodeId = cycleNodes[i];
          const node = nodes[nodeId];
          if (node) {
            result.push([node.x, node.y, i === 0 ? 'START' : undefined]);
          }
        }
        // Close the loop
        const firstNode = nodes[cycleNodes[0]];
        if (firstNode) {
          result.push([firstNode.x, firstNode.y, undefined]);
        }
        loops.push(result);
      }
    }
  }

  // 3. Sort loops by 2D bounding area descending (ensure largest loop is outer boundary at index 0)
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
