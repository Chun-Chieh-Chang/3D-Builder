import { SketchNode, SketchEdge } from '../../store/useCadStore';

/**
 * Traverse the Sketch Graph (Nodes & Edges) and extract the outermost closed loop
 * as a flat array of coordinates to feed into the PythonOCC backend.
 */
export function extractClosedLoop(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>
): any[] {
  const edgeList = Object.values(edges).filter(e => !e.isConstruction);
  if (edgeList.length < 3) return [];

  // Build Adjacency List
  const adj = new Map<string, string[]>();
  for (const e of edgeList) {
    const [n1, n2] = e.nodeIds;
    if (!adj.has(n1)) adj.set(n1, []);
    if (!adj.has(n2)) adj.set(n2, []);
    adj.get(n1)!.push(n2);
    adj.get(n2)!.push(n1);
  }

  // Find a cycle using DFS (assuming a single main loop for now)
  const visited = new Set<string>();
  const path: string[] = [];
  let loopStart: string | null = null;

  function dfs(curr: string, parent: string | null): boolean {
    visited.add(curr);
    path.push(curr);

    const neighbors = adj.get(curr) || [];
    for (const nxt of neighbors) {
      if (nxt === parent) continue;
      if (visited.has(nxt)) {
        loopStart = nxt;
        return true;
      }
      if (dfs(nxt, curr)) return true;
    }

    path.pop();
    return false;
  }

  // Start DFS from any node with degree >= 2
  let startNode = '';
  for (const [nodeId, neighbors] of adj.entries()) {
    if (neighbors.length >= 2) {
      startNode = nodeId;
      break;
    }
  }

  if (!startNode) return [];

  dfs(startNode, null);

  if (!loopStart) return [];

  // Extract the cycle from the path
  const startIndex = path.indexOf(loopStart);
  const cycleNodes = path.slice(startIndex);

  // Convert Node IDs to flat [x, y, tag] array compatible with legacy PythonOCC format
  const result: any[] = [];
  for (let i = 0; i < cycleNodes.length; i++) {
    const nodeId = cycleNodes[i];
    const node = nodes[nodeId];
    if (node) {
      result.push([node.x, node.y, i === 0 ? 'START' : undefined]);
    }
  }

  // Close the loop by repeating the start point
  const firstNode = nodes[cycleNodes[0]];
  if (firstNode) {
    result.push([firstNode.x, firstNode.y, undefined]);
  }

  return result;
}
