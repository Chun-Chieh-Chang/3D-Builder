import { SketchNode, SketchEdge, SketchConstraint } from '../../store/useCadStore';

/**
 * PBD (Position-Based Dynamics) 2D Constraint Solver
 * iteratively relaxes nodes to satisfy constraints.
 */
export function solveConstraints(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>,
  constraints: Record<string, SketchConstraint>,
  iterations: number = 10
): Record<string, SketchNode> {
  // Create a deep copy of nodes to avoid mutating the original state during intermediate steps
  const nextNodes: Record<string, SketchNode> = JSON.parse(JSON.stringify(nodes));
  const constraintList = Object.values(constraints);

  for (let i = 0; i < iterations; i++) {
    for (const constraint of constraintList) {
      applyConstraint(constraint, nextNodes, edges);
    }
  }

  return nextNodes;
}

function applyConstraint(
  constraint: SketchConstraint,
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>
) {
  switch (constraint.type) {
    case 'COINCIDENT': {
      if (!constraint.nodeIds || constraint.nodeIds.length !== 2) return;
      const n1 = nodes[constraint.nodeIds[0]];
      const n2 = nodes[constraint.nodeIds[1]];
      if (!n1 || !n2) return;

      const dx = n2.x - n1.x;
      const dy = n2.y - n1.y;

      // Determine weights based on fixed status
      const w1 = n1.isFixed ? 0 : (n2.isFixed ? 1 : 0.5);
      const w2 = n2.isFixed ? 0 : (n1.isFixed ? 1 : 0.5);

      if (w1 > 0) {
        n1.x += dx * w1;
        n1.y += dy * w1;
      }
      if (w2 > 0) {
        n2.x -= dx * w2;
        n2.y -= dy * w2;
      }
      break;
    }

    case 'HORIZONTAL': {
      if (!constraint.edgeIds || constraint.edgeIds.length !== 1) return;
      const edge = edges[constraint.edgeIds[0]];
      if (!edge || edge.nodeIds.length < 2) return;
      const n1 = nodes[edge.nodeIds[0]];
      const n2 = nodes[edge.nodeIds[1]]; // Assuming line edge
      if (!n1 || !n2) return;

      const dy = n2.y - n1.y;
      
      const w1 = n1.isFixed ? 0 : (n2.isFixed ? 1 : 0.5);
      const w2 = n2.isFixed ? 0 : (n1.isFixed ? 1 : 0.5);

      if (w1 > 0) n1.y += dy * w1;
      if (w2 > 0) n2.y -= dy * w2;
      break;
    }

    case 'VERTICAL': {
      if (!constraint.edgeIds || constraint.edgeIds.length !== 1) return;
      const edge = edges[constraint.edgeIds[0]];
      if (!edge || edge.nodeIds.length < 2) return;
      const n1 = nodes[edge.nodeIds[0]];
      const n2 = nodes[edge.nodeIds[1]];
      if (!n1 || !n2) return;

      const dx = n2.x - n1.x;
      
      const w1 = n1.isFixed ? 0 : (n2.isFixed ? 1 : 0.5);
      const w2 = n2.isFixed ? 0 : (n1.isFixed ? 1 : 0.5);

      if (w1 > 0) n1.x += dx * w1;
      if (w2 > 0) n2.x -= dx * w2;
      break;
    }

    case 'DISTANCE': {
      if (!constraint.nodeIds || constraint.nodeIds.length !== 2 || constraint.value === undefined) return;
      const n1 = nodes[constraint.nodeIds[0]];
      const n2 = nodes[constraint.nodeIds[1]];
      if (!n1 || !n2) return;

      const dx = n2.x - n1.x;
      const dy = n2.y - n1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // Prevent division by zero
      if (dist < 1e-6) return;

      const diff = dist - constraint.value;
      const nx = dx / dist;
      const ny = dy / dist;

      const w1 = n1.isFixed ? 0 : (n2.isFixed ? 1 : 0.5);
      const w2 = n2.isFixed ? 0 : (n1.isFixed ? 1 : 0.5);

      if (w1 > 0) {
        n1.x += nx * diff * w1;
        n1.y += ny * diff * w1;
      }
      if (w2 > 0) {
        n2.x -= nx * diff * w2;
        n2.y -= ny * diff * w2;
      }
      break;
    }

    case 'EQUAL': {
      // Equal length constraint between two edges
      if (!constraint.edgeIds || constraint.edgeIds.length !== 2) return;
      const e1 = edges[constraint.edgeIds[0]];
      const e2 = edges[constraint.edgeIds[1]];
      if (!e1 || !e2 || e1.nodeIds.length < 2 || e2.nodeIds.length < 2) return;
      
      const n1a = nodes[e1.nodeIds[0]];
      const n1b = nodes[e1.nodeIds[1]];
      const n2a = nodes[e2.nodeIds[0]];
      const n2b = nodes[e2.nodeIds[1]];
      if (!n1a || !n1b || !n2a || !n2b) return;

      const l1 = Math.hypot(n1b.x - n1a.x, n1b.y - n1a.y);
      const l2 = Math.hypot(n2b.x - n2a.x, n2b.y - n2a.y);
      
      if (l1 < 1e-6 || l2 < 1e-6) return;

      const avgLength = (l1 + l2) / 2.0;

      // Relax Edge 1 towards avgLength
      const diff1 = l1 - avgLength;
      const ux1 = (n1b.x - n1a.x) / l1;
      const uy1 = (n1b.y - n1a.y) / l1;
      
      const w1a = n1a.isFixed ? 0 : (n1b.isFixed ? 1 : 0.5);
      const w1b = n1b.isFixed ? 0 : (n1a.isFixed ? 1 : 0.5);
      
      if (w1a > 0) {
        n1a.x += ux1 * diff1 * w1a;
        n1a.y += uy1 * diff1 * w1a;
      }
      if (w1b > 0) {
        n1b.x -= ux1 * diff1 * w1b;
        n1b.y -= uy1 * diff1 * w1b;
      }

      // Relax Edge 2 towards avgLength
      const diff2 = l2 - avgLength;
      const ux2 = (n2b.x - n2a.x) / l2;
      const uy2 = (n2b.y - n2a.y) / l2;

      const w2a = n2a.isFixed ? 0 : (n2b.isFixed ? 1 : 0.5);
      const w2b = n2b.isFixed ? 0 : (n2a.isFixed ? 1 : 0.5);

      if (w2a > 0) {
        n2a.x += ux2 * diff2 * w2a;
        n2a.y += uy2 * diff2 * w2a;
      }
      if (w2b > 0) {
        n2b.x -= ux2 * diff2 * w2b;
        n2b.y -= uy2 * diff2 * w2b;
      }

      break;
    }
  }
}
