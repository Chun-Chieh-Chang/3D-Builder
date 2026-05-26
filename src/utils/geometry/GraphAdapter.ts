import { SketchNode, SketchEdge } from '../../store/useCadStore';
import { extractAllClosedLoops } from './CycleFinder';

export { extractAllClosedLoops };

/**
 * Traverse the Sketch Graph (Nodes & Edges) and extract the outermost closed loop
 * as a flat array of coordinates to feed into the PythonOCC backend.
 * Kept for backward compatibility.
 */
export function extractClosedLoop(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>
): any[] {
  const loops = extractAllClosedLoops(nodes, edges);
  return loops.length > 0 ? loops[0] : [];
}
