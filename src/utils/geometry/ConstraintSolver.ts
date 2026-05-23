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

    case 'CONCENTRIC': {
      if (!constraint.edgeIds || constraint.edgeIds.length !== 2) return;
      const c1 = edges[constraint.edgeIds[0]];
      const c2 = edges[constraint.edgeIds[1]];
      if (!c1 || !c2 || c1.nodeIds.length === 0 || c2.nodeIds.length === 0) return;
      const n1 = nodes[c1.nodeIds[0]];
      const n2 = nodes[c2.nodeIds[0]];
      if (!n1 || !n2) return;

      const dx = n2.x - n1.x;
      const dy = n2.y - n1.y;

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

    case 'TANGENT': {
      if (!constraint.edgeIds || constraint.edgeIds.length !== 2) return;
      const e1 = edges[constraint.edgeIds[0]];
      const e2 = edges[constraint.edgeIds[1]];
      if (!e1 || !e2) return;
      const lineEdge = e1.type === 'LINE' ? e1 : (e2.type === 'LINE' ? e2 : null);
      const circleEdge = e1.type === 'CIRCLE' ? e1 : (e2.type === 'CIRCLE' ? e2 : null);
      if (!lineEdge || !circleEdge || lineEdge.nodeIds.length < 2 || circleEdge.nodeIds.length < 2) return;
      
      const p1 = nodes[lineEdge.nodeIds[0]];
      const p2 = nodes[lineEdge.nodeIds[1]];
      const pc = nodes[circleEdge.nodeIds[0]]; 
      const pr = nodes[circleEdge.nodeIds[1]]; 
      if (!p1 || !p2 || !pc || !pr) return;

      const R = Math.hypot(pr.x - pc.x, pr.y - pc.y);
      if (R < 1e-4) return;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-6) return;

      const t = ((pc.x - p1.x) * dx + (pc.y - p1.y) * dy) / lenSq;
      const projX = p1.x + t * dx;
      const projY = p1.y + t * dy;

      const dist = Math.hypot(projX - pc.x, projY - pc.y);
      if (dist < 1e-6) return;

      const err = dist - R;
      const nx = (projX - pc.x) / dist;
      const ny = (projY - pc.y) / dist;

      const w_c = pc.isFixed ? 0 : 0.5;
      const w_line = 1 - w_c;

      if (w_c > 0) {
        pc.x += nx * err * w_c;
        pc.y += ny * err * w_c;
      }

      if (w_line > 0) {
        const p1_w = p1.isFixed ? 0 : (p2.isFixed ? 1 : 0.5);
        const p2_w = p2.isFixed ? 0 : (p1.isFixed ? 1 : 0.5);
        
        const corrX = -nx * err * w_line;
        const corrY = -ny * err * w_line;

        if (p1_w > 0) {
          p1.x += corrX * (1 - t) * p1_w;
          p1.y += corrY * (1 - t) * p1_w;
        }
        if (p2_w > 0) {
          p2.x += corrX * t * p2_w;
          p2.y += corrY * t * p2_w;
        }
      }
      break;
    }

    case 'ANGLE': {
      if (!constraint.edgeIds || constraint.edgeIds.length !== 2) return;
      const e1 = edges[constraint.edgeIds[0]];
      const e2 = edges[constraint.edgeIds[1]];
      if (!e1 || !e2 || e1.nodeIds.length < 2 || e2.nodeIds.length < 2) return;

      const p1a = nodes[e1.nodeIds[0]];
      const p1b = nodes[e1.nodeIds[1]];
      const p2a = nodes[e2.nodeIds[0]];
      const p2b = nodes[e2.nodeIds[1]];
      if (!p1a || !p1b || !p2a || !p2b) return;

      const dx1 = p1b.x - p1a.x;
      const dy1 = p1b.y - p1a.y;
      const dx2 = p2b.x - p2a.x;
      const dy2 = p2b.y - p2a.y;

      const len1 = Math.hypot(dx1, dy1);
      const len2 = Math.hypot(dx2, dy2);
      if (len1 < 1e-4 || len2 < 1e-4) return;

      const angle1 = Math.atan2(dy1, dx1);
      const angle2 = Math.atan2(dy2, dx2);
      const currentAngle = angle2 - angle1;
      
      const targetAngleRad = (constraint.value ?? 45.0) * Math.PI / 180.0;
      let err = targetAngleRad - currentAngle;
      
      err = Math.atan2(Math.sin(err), Math.cos(err));
      if (Math.abs(err) < 1e-6) return;

      const rotatePoint = (pt: any, cx: number, cy: number, dTheta: number) => {
        if (pt.isFixed) return;
        const cos = Math.cos(dTheta);
        const sin = Math.sin(dTheta);
        const rx = pt.x - cx;
        const ry = pt.y - cy;
        pt.x = cx + rx * cos - ry * sin;
        pt.y = cy + rx * sin + ry * cos;
      };

      const m1x = (p1a.x + p1b.x) / 2;
      const m1y = (p1a.y + p1b.y) / 2;
      const m2x = (p2a.x + p2b.x) / 2;
      const m2y = (p2a.y + p2b.y) / 2;

      rotatePoint(p1a, m1x, m1y, -err / 2);
      rotatePoint(p1b, m1x, m1y, -err / 2);

      rotatePoint(p2a, m2x, m2y, err / 2);
      rotatePoint(p2b, m2x, m2y, err / 2);
      break;
    }
  }
}

export interface SketchDefinitionReport {
  nodes: Record<string, 'UNDER' | 'FULLY' | 'CONFLICT'>;
  edges: Record<string, 'UNDER' | 'FULLY' | 'CONFLICT'>;
  hasConflict: boolean;
}

export function analyzeSketchDefinitions(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>,
  constraints: Record<string, SketchConstraint>
): SketchDefinitionReport {
  const nodeIds = Object.keys(nodes);
  const edgeIds = Object.keys(edges);
  const constraintList = Object.values(constraints);

  const nodeStatus: Record<string, 'UNDER' | 'FULLY' | 'CONFLICT'> = {};
  const edgeStatus: Record<string, 'UNDER' | 'FULLY' | 'CONFLICT'> = {};
  let hasConflict = false;

  // 1. Run constraint solver first on original nodes to get the relaxed state
  const relaxedNodes = solveConstraints(nodes, edges, constraints, 10);

  // 2. Measure residual errors to detect CONFLICT
  for (const constraint of constraintList) {
    let err = 0;
    switch (constraint.type) {
      case 'COINCIDENT': {
        if (constraint.nodeIds && constraint.nodeIds.length === 2) {
          const n1 = relaxedNodes[constraint.nodeIds[0]];
          const n2 = relaxedNodes[constraint.nodeIds[1]];
          if (n1 && n2) {
            err = Math.hypot(n2.x - n1.x, n2.y - n1.y);
          }
        }
        break;
      }
      case 'HORIZONTAL': {
        if (constraint.edgeIds && constraint.edgeIds.length === 1) {
          const edge = edges[constraint.edgeIds[0]];
          if (edge && edge.nodeIds.length >= 2) {
            const n1 = relaxedNodes[edge.nodeIds[0]];
            const n2 = relaxedNodes[edge.nodeIds[1]];
            if (n1 && n2) {
              err = Math.abs(n2.y - n1.y);
            }
          }
        }
        break;
      }
      case 'VERTICAL': {
        if (constraint.edgeIds && constraint.edgeIds.length === 1) {
          const edge = edges[constraint.edgeIds[0]];
          if (edge && edge.nodeIds.length >= 2) {
            const n1 = relaxedNodes[edge.nodeIds[0]];
            const n2 = relaxedNodes[edge.nodeIds[1]];
            if (n1 && n2) {
              err = Math.abs(n2.x - n1.x);
            }
          }
        }
        break;
      }
      case 'DISTANCE': {
        if (constraint.nodeIds && constraint.nodeIds.length === 2 && constraint.value !== undefined) {
          const n1 = relaxedNodes[constraint.nodeIds[0]];
          const n2 = relaxedNodes[constraint.nodeIds[1]];
          if (n1 && n2) {
            err = Math.abs(Math.hypot(n2.x - n1.x, n2.y - n1.y) - constraint.value);
          }
        }
        break;
      }
      case 'EQUAL': {
        if (constraint.edgeIds && constraint.edgeIds.length === 2) {
          const e1 = edges[constraint.edgeIds[0]];
          const e2 = edges[constraint.edgeIds[1]];
          if (e1 && e2 && e1.nodeIds.length >= 2 && e2.nodeIds.length >= 2) {
            const n1a = relaxedNodes[e1.nodeIds[0]];
            const n1b = relaxedNodes[e1.nodeIds[1]];
            const n2a = relaxedNodes[e2.nodeIds[0]];
            const n2b = relaxedNodes[e2.nodeIds[1]];
            if (n1a && n1b && n2a && n2b) {
              err = Math.abs(Math.hypot(n1b.x - n1a.x, n1b.y - n1a.y) - Math.hypot(n2b.x - n2a.x, n2b.y - n2a.y));
            }
          }
        }
        break;
      }
      case 'CONCENTRIC': {
        if (constraint.edgeIds && constraint.edgeIds.length === 2) {
          const c1 = edges[constraint.edgeIds[0]];
          const c2 = edges[constraint.edgeIds[1]];
          if (c1 && c2 && c1.nodeIds.length > 0 && c2.nodeIds.length > 0) {
            const n1 = relaxedNodes[c1.nodeIds[0]];
            const n2 = relaxedNodes[c2.nodeIds[0]];
            if (n1 && n2) {
              err = Math.hypot(n2.x - n1.x, n2.y - n1.y);
            }
          }
        }
        break;
      }
      case 'TANGENT': {
        if (constraint.edgeIds && constraint.edgeIds.length === 2) {
          const e1 = edges[constraint.edgeIds[0]];
          const e2 = edges[constraint.edgeIds[1]];
          if (e1 && e2) {
            const line = e1.type === 'LINE' ? e1 : (e2.type === 'LINE' ? e2 : null);
            const circle = e1.type === 'CIRCLE' ? e1 : (e2.type === 'CIRCLE' ? e2 : null);
            if (line && circle && line.nodeIds.length >= 2 && circle.nodeIds.length >= 2) {
              const p1 = relaxedNodes[line.nodeIds[0]];
              const p2 = relaxedNodes[line.nodeIds[1]];
              const pc = relaxedNodes[circle.nodeIds[0]];
              const pr = relaxedNodes[circle.nodeIds[1]];
              if (p1 && p2 && pc && pr) {
                const R = Math.hypot(pr.x - pc.x, pr.y - pc.y);
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const lenSq = dx * dx + dy * dy;
                if (lenSq > 1e-6) {
                  const t = ((pc.x - p1.x) * dx + (pc.y - p1.y) * dy) / lenSq;
                  const projX = p1.x + t * dx;
                  const projY = p1.y + t * dy;
                  const dist = Math.hypot(projX - pc.x, projY - pc.y);
                  err = Math.abs(dist - R);
                }
              }
            }
          }
        }
        break;
      }
      case 'ANGLE': {
        if (constraint.edgeIds && constraint.edgeIds.length === 2) {
          const e1 = edges[constraint.edgeIds[0]];
          const e2 = edges[constraint.edgeIds[1]];
          if (e1 && e2 && e1.nodeIds.length >= 2 && e2.nodeIds.length >= 2) {
            const p1a = relaxedNodes[e1.nodeIds[0]];
            const p1b = relaxedNodes[e1.nodeIds[1]];
            const p2a = relaxedNodes[e2.nodeIds[0]];
            const p2b = relaxedNodes[e2.nodeIds[1]];
            if (p1a && p1b && p2a && p2b) {
              const dx1 = p1b.x - p1a.x;
              const dy1 = p1b.y - p1a.y;
              const dx2 = p2b.x - p2a.x;
              const dy2 = p2b.y - p2a.y;
              const len1 = Math.hypot(dx1, dy1);
              const len2 = Math.hypot(dx2, dy2);
              if (len1 > 1e-4 && len2 > 1e-4) {
                const angle1 = Math.atan2(dy1, dx1);
                const angle2 = Math.atan2(dy2, dx2);
                const currentAngle = angle2 - angle1;
                const targetAngleRad = (constraint.value ?? 45.0) * Math.PI / 180.0;
                let diff = targetAngleRad - currentAngle;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                err = Math.abs(diff);
              }
            }
          }
        }
        break;
      }
    }
    
    if (err > 0.05) { // conflict threshold
      hasConflict = true;
      // Mark nodes and edges of this constraint as CONFLICT
      constraint.nodeIds?.forEach(id => { nodeStatus[id] = 'CONFLICT'; });
      constraint.edgeIds?.forEach(id => {
        edgeStatus[id] = 'CONFLICT';
        const edge = edges[id];
        edge?.nodeIds?.forEach(nId => { nodeStatus[nId] = 'CONFLICT'; });
      });
    }
  }

  // 3. For non-conflict elements, run the Numerical Perturbation analysis
  for (const nId of nodeIds) {
    if (nodeStatus[nId] === 'CONFLICT') continue;
    const originalNode = relaxedNodes[nId];
    if (!originalNode) continue;

    if (originalNode.isFixed) {
      nodeStatus[nId] = 'FULLY';
      continue;
    }

    // Perturb X and Y
    const perturbedNodes = JSON.parse(JSON.stringify(relaxedNodes));
    perturbedNodes[nId].x += 0.2;
    perturbedNodes[nId].y += 0.2;

    // Run constraint solver for 5 iterations on perturbed nodes
    const resolved = solveConstraints(perturbedNodes, edges, constraints, 5);

    // Check distance of nId from original position
    const solvedNode = resolved[nId];
    const dist = Math.hypot(solvedNode.x - originalNode.x, solvedNode.y - originalNode.y);

    if (dist < 0.01) {
      nodeStatus[nId] = 'FULLY';
    } else {
      nodeStatus[nId] = 'UNDER';
    }
  }

  // 4. Resolve edge definition colors based on their endpoints
  for (const eId of edgeIds) {
    if (edgeStatus[eId] === 'CONFLICT') continue;
    const edge = edges[eId];
    if (!edge || edge.nodeIds.length < 2) {
      edgeStatus[eId] = 'UNDER';
      continue;
    }

    // Edge is FULLY if both endpoints are FULLY
    const allEndpointsFully = edge.nodeIds.every(nId => nodeStatus[nId] === 'FULLY');
    if (allEndpointsFully) {
      edgeStatus[eId] = 'FULLY';
    } else {
      edgeStatus[eId] = 'UNDER';
    }
  }

  return { nodes: nodeStatus, edges: edgeStatus, hasConflict };
}
