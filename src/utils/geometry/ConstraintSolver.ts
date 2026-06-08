import { SketchNode, SketchEdge, SketchConstraint } from '../../store/useCadStore';
import { projectPointToLine, getLineProjectionT, pointToLineDistance } from './DistanceUtils';

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
      if (constraint.nodeIds && constraint.nodeIds.length === 2) {
        const n1 = nodes[constraint.nodeIds[0]];
        const n2 = nodes[constraint.nodeIds[1]];
        if (!n1 || !n2) return;

        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;

        const w1 = n1.isFixed ? 0 : (n2.isFixed ? 1 : 0.5);
        const w2 = n2.isFixed ? 0 : (n1.isFixed ? 1 : 0.5);

        if (w1 > 0) { n1.x += dx * w1; n1.y += dy * w1; }
        if (w2 > 0) { n2.x -= dx * w2; n2.y -= dy * w2; }
      } else if (constraint.nodeIds && constraint.nodeIds.length === 1 && constraint.edgeIds && constraint.edgeIds.length === 1) {
        // Point on Edge Coincident
        const node = nodes[constraint.nodeIds[0]];
        const edge = edges[constraint.edgeIds[0]];
        if (!node || !edge || node.isFixed) return;

        if (edge.type === 'LINE' || edge.type === 'CENTER_LINE') {
          const e1 = nodes[edge.nodeIds[0]];
          const e2 = nodes[edge.nodeIds[1]];
          if (!e1 || !e2) return;
          const dx = e2.x - e1.x;
          const dy = e2.y - e1.y;
          const l2 = dx*dx + dy*dy;
          if (l2 < 1e-6) return;
          const t = ((node.x - e1.x) * dx + (node.y - e1.y) * dy) / l2;
          // In SolidWorks, Coincident to line usually means infinite line extension
          node.x = e1.x + t * dx;
          node.y = e1.y + t * dy;
        } else if (edge.type === 'CIRCLE' || edge.type === 'ARC') {
          const center = nodes[edge.nodeIds[0]];
          const perim = nodes[edge.nodeIds[1]];
          if (!center || !perim) return;
          const R = Math.hypot(perim.x - center.x, perim.y - center.y);
          const dist = Math.hypot(node.x - center.x, node.y - center.y);
          if (dist < 1e-6) return;
          const ratio = R / dist;
          node.x = center.x + (node.x - center.x) * ratio;
          node.y = center.y + (node.y - center.y) * ratio;
        }
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
      let n1, n2, e_circle, e_line;
      const targetValue = constraint.value;

      if (constraint.nodeIds && constraint.nodeIds.length === 2) {
        n1 = nodes[constraint.nodeIds[0]];
        n2 = nodes[constraint.nodeIds[1]];
      } else if (constraint.nodeIds && constraint.nodeIds.length === 1 && constraint.edgeIds && constraint.edgeIds.length === 1) {
        n1 = nodes[constraint.nodeIds[0]];
        e_circle = edges[constraint.edgeIds[0]];
        if (e_circle && e_circle.type === 'CIRCLE' && e_circle.nodeIds.length >= 2) {
           n2 = nodes[e_circle.nodeIds[0]];
        }
      } else if (constraint.nodeIds && constraint.nodeIds.length === 1) {
        // Absolute distance from Origin (0,0) or X/Y component
        const node = nodes[constraint.nodeIds[0]];
        if (!node || targetValue === undefined) return;

        if (constraint.label === 'X') {
          if (!node.isFixed) node.x = targetValue;
        } else if (constraint.label === 'Y') {
          if (!node.isFixed) node.y = targetValue;
        } else {
          // Distance from (0,0)
          const curr = Math.hypot(node.x, node.y);
          if (curr < 1e-6) return;
          const ratio = targetValue / curr;
          if (!node.isFixed) {
            node.x *= ratio;
            node.y *= ratio;
          }
        }
        return;
      } else if (constraint.edgeIds && constraint.edgeIds.length === 2) {
        const e1 = edges[constraint.edgeIds[0]];
        const e2 = edges[constraint.edgeIds[1]];
        if (e1 && e2) {
          e_line = e1.type === 'LINE' ? e1 : (e2.type === 'LINE' ? e2 : null);
          e_circle = e1.type === 'CIRCLE' ? e1 : (e2.type === 'CIRCLE' ? e2 : null);
        }
      } else if (constraint.edgeIds && constraint.edgeIds.length === 1) {
        const edge = edges[constraint.edgeIds[0]];
        if (edge && edge.nodeIds.length >= 2) {
          n1 = nodes[edge.nodeIds[0]];
          n2 = nodes[edge.nodeIds[1]];
        }
      }

      if (targetValue === undefined) return;

      if (n1 && n2) {
        // Point-to-Point or Point-to-CircleCenter
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) return;

        let effectiveTarget = targetValue;
        if (e_circle && e_circle.type === 'CIRCLE' && e_circle.nodeIds.length >= 2) {
            const rim = nodes[e_circle.nodeIds[1]];
            const radius = Math.hypot(rim.x - n2.x, rim.y - n2.y);
            if (constraint.arcCondition === 'MIN') effectiveTarget = targetValue + radius;
            else if (constraint.arcCondition === 'MAX') effectiveTarget = targetValue - radius;
        }

        const diff = dist - effectiveTarget;
        const nx = dx / dist;
        const ny = dy / dist;

        const w1 = n1.isFixed ? 0 : (n2.isFixed ? 1 : 0.5);
        const w2 = n2.isFixed ? 0 : (n1.isFixed ? 1 : 0.5);

        if (w1 > 0) { n1.x += nx * diff * w1; n1.y += ny * diff * w1; }
        if (w2 > 0) { n2.x -= nx * diff * w2; n2.y -= ny * diff * w2; }
      } else if (e_line && e_circle) {
        // Line-to-Circle
        const p1 = nodes[e_line.nodeIds[0]];
        const p2 = nodes[e_line.nodeIds[1]];
        const pc = nodes[e_circle.nodeIds[0]];
        const pr = nodes[e_circle.nodeIds[1]];
        if (!p1 || !p2 || !pc || !pr) return;

        const radius = Math.hypot(pr.x - pc.x, pr.y - pc.y);
        const proj = projectPointToLine(pc, p1, p2);
        const t = getLineProjectionT(pc, p1, p2);

        const dx = proj.x - pc.x;
        const dy = proj.y - pc.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) return;

        let effectiveTarget = targetValue;
        if (constraint.arcCondition === 'MIN') effectiveTarget = targetValue + radius;
        else if (constraint.arcCondition === 'MAX') effectiveTarget = targetValue - radius;

        const diff = dist - effectiveTarget;
        const nx = dx / dist;
        const ny = dy / dist;

        const w_circle = pc.isFixed ? 0 : 0.5;
        const w_line = 1.0 - w_circle;

        if (w_circle > 0) {
          pc.x += nx * diff * w_circle;
          pc.y += ny * diff * w_circle;
        }

        if (w_line > 0) {
          const p1_w = p1.isFixed ? 0 : (p2.isFixed ? 1 : 0.5);
          const p2_w = p2.isFixed ? 0 : (p1.isFixed ? 1 : 0.5);
          
          const corrX = -nx * diff * w_line;
          const corrY = -ny * diff * w_line;

          if (p1_w > 0) {
            p1.x += corrX * (1 - t) * p1_w;
            p1.y += corrY * (1 - t) * p1_w;
          }
          if (p2_w > 0) {
            p2.x += corrX * t * p2_w;
            p2.y += corrY * t * p2_w;
          }
        }
      }
      break;
    }

    case 'EQUAL': {
      if (!constraint.edgeIds || constraint.edgeIds.length !== 2) return;
      const e1 = edges[constraint.edgeIds[0]];
      const e2 = edges[constraint.edgeIds[1]];
      if (!e1 || !e2 || e1.nodeIds.length < 2 || e2.nodeIds.length < 2) return;

      if (e1.type === 'CIRCLE' && e2.type === 'CIRCLE') {
        const c1 = nodes[e1.nodeIds[0]];
        const p1 = nodes[e1.nodeIds[1]];
        const c2 = nodes[e2.nodeIds[0]];
        const p2 = nodes[e2.nodeIds[1]];
        if (!c1 || !p1 || !c2 || !p2) return;

        const r1 = Math.hypot(p1.x - c1.x, p1.y - c1.y);
        const r2 = Math.hypot(p2.x - c2.x, p2.y - c2.y);
        const targetR = (r1 + r2) / 2;

        const relaxRadius = (c: any, p: any, target: number) => {
          const curr = Math.hypot(p.x - c.x, p.y - c.y);
          if (curr < 1e-4) return;
          const ratio = target / curr;
          const wc = c.isFixed ? 0 : (p.isFixed ? 1 : 0.5);
          const wp = p.isFixed ? 0 : (c.isFixed ? 1 : 0.5);

          if (wp > 0) {
            p.x = c.x + (p.x - c.x) * ratio;
            p.y = c.y + (p.y - c.y) * ratio;
          } else if (wc > 0) {
            c.x = p.x - (p.x - c.x) * ratio;
            c.y = p.y - (p.y - c.y) * ratio;
          }
        };

        relaxRadius(c1, p1, targetR);
        relaxRadius(c2, p2, targetR);
      } else if ((e1.type === 'LINE' || e1.type === 'CENTER_LINE') && (e2.type === 'LINE' || e2.type === 'CENTER_LINE')) {
        const n1a = nodes[e1.nodeIds[0]];
        const n1b = nodes[e1.nodeIds[1]];
        const n2a = nodes[e2.nodeIds[0]];
        const n2b = nodes[e2.nodeIds[1]];
        if (!n1a || !n1b || !n2a || !n2b) return;

        const l1 = Math.hypot(n1b.x - n1a.x, n1b.y - n1a.y);
        const l2 = Math.hypot(n2b.x - n2a.x, n2b.y - n2a.y);
        if (l1 < 1e-6 || l2 < 1e-6) return;

        const avgLength = (l1 + l2) / 2.0;

        const relaxLine = (na: any, nb: any, target: number) => {
          const curr = Math.hypot(nb.x - na.x, nb.y - na.y);
          const diff = curr - target;
          const ux = (nb.x - na.x) / curr;
          const uy = (nb.y - na.y) / curr;
          const wa = na.isFixed ? 0 : (nb.isFixed ? 1 : 0.5);
          const wb = nb.isFixed ? 0 : (na.isFixed ? 1 : 0.5);
          if (wa > 0) { na.x += ux * diff * wa; na.y += uy * diff * wa; }
          if (wb > 0) { nb.x -= ux * diff * wb; nb.y -= uy * diff * wb; }
        };

        relaxLine(n1a, n1b, avgLength);
        relaxLine(n2a, n2b, avgLength);
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
      
      if (lineEdge && circleEdge && lineEdge.nodeIds.length >= 2 && circleEdge.nodeIds.length >= 2) {
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
      } else {
        const is_c1 = e1.type === 'CIRCLE' || e1.type === 'ARC';
        const is_c2 = e2.type === 'CIRCLE' || e2.type === 'ARC';
        if (is_c1 && is_c2) {
          // Circle-Circle Tangency
          const c1 = nodes[e1.nodeIds[0]];
          const r1_node = nodes[e1.nodeIds[1]];
          const c2 = nodes[e2.nodeIds[0]];
          const r2_node = nodes[e2.nodeIds[1]];
          if (!c1 || !r1_node || !c2 || !r2_node) return;

          const R1 = Math.hypot(r1_node.x - c1.x, r1_node.y - c1.y);
          const R2 = Math.hypot(r2_node.x - c2.x, r2_node.y - c2.y);
          const dx = c2.x - c1.x;
          const dy = c2.y - c1.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1e-6) return;

          // Target is either R1+R2 (External) or |R1-R2| (Internal)
          const target = Math.abs(dist - (R1 + R2)) < Math.abs(dist - Math.abs(R1 - R2)) 
            ? (R1 + R2) 
            : Math.abs(R1 - R2);
          
          const diff = dist - target;
          const nx = dx / dist;
          const ny = dy / dist;

          const w1 = c1.isFixed ? 0 : (c2.isFixed ? 1 : 0.5);
          const w2 = c2.isFixed ? 0 : (c1.isFixed ? 1 : 0.5);

          if (w1 > 0) {
            c1.x += nx * diff * w1;
            c1.y += ny * diff * w1;
          }
          if (w2 > 0) {
            c2.x -= nx * diff * w2;
            c2.y -= ny * diff * w2;
          }
        }
      }
      
      // NEW: Spline Tangency
      const spline = e1.type === 'SPLINE' ? e1 : (e2.type === 'SPLINE' ? e2 : null);
      if (spline) {
        const other = e1 === spline ? e2 : e1;
        const commonId = spline.nodeIds.find(id => other.nodeIds.includes(id));
        if (commonId) {
          const common = nodes[commonId];
          const neighborIdx = spline.nodeIds.indexOf(commonId) === 0 ? 1 : spline.nodeIds.length - 2;
          const neighbor = nodes[spline.nodeIds[neighborIdx]];
          if (!common || !neighbor) return;

          let targetAngle = 0;
          if (other.type === 'LINE' || other.type === 'CENTER_LINE') {
             const p1 = nodes[other.nodeIds[0]];
             const p2 = nodes[other.nodeIds[1]];
             if (!p1 || !p2) return;
             targetAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          } else if (other.type === 'CIRCLE' || other.type === 'ARC') {
             const pc = nodes[other.nodeIds[0]];
             if (!pc) return;
             const radialAngle = Math.atan2(common.y - pc.y, common.x - pc.x);
             targetAngle = radialAngle + Math.PI / 2;
          } else {
             return;
          }

          const sAngle = Math.atan2(neighbor.y - common.y, neighbor.x - common.x);
          let diff = sAngle - targetAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          if (Math.abs(diff) > Math.PI / 2) {
            diff = diff > 0 ? diff - Math.PI : diff + Math.PI;
          }

          if (Math.abs(diff) > 1e-6 && !neighbor.isFixed) {
            const mag = Math.hypot(neighbor.x - common.x, neighbor.y - common.y);
            neighbor.x = common.x + Math.cos(sAngle - diff) * mag;
            neighbor.y = common.y + Math.sin(sAngle - diff) * mag;
          }
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

    case 'COLLINEAR': {
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

      const len1Sq = dx1*dx1 + dy1*dy1;
      const len2Sq = dx2*dx2 + dy2*dy2;
      const len1 = Math.sqrt(len1Sq);
      const len2 = Math.sqrt(len2Sq);
      
      if (len1 < 1e-4 || len2 < 1e-4) return;

      // 1. Parallel enforcement
      const angle1 = Math.atan2(dy1, dx1);
      const angle2 = Math.atan2(dy2, dx2);
      let errAngle = angle2 - angle1;
      errAngle = Math.atan2(Math.sin(errAngle), Math.cos(errAngle));
      if (Math.abs(errAngle) > Math.PI / 2) {
         errAngle = errAngle > 0 ? errAngle - Math.PI : errAngle + Math.PI;
      }

      const rotatePoint = (pt: any, cx: number, cy: number, dTheta: number) => {
        if (pt.isFixed) return;
        const cos = Math.cos(dTheta);
        const sin = Math.sin(dTheta);
        const rx = pt.x - cx;
        const ry = pt.y - cy;
        pt.x = cx + rx * cos - ry * sin;
        pt.y = cy + rx * sin + ry * cos;
      };

      if (Math.abs(errAngle) > 1e-6) {
        const m1x = (p1a.x + p1b.x) / 2;
        const m1y = (p1a.y + p1b.y) / 2;
        const m2x = (p2a.x + p2b.x) / 2;
        const m2y = (p2a.y + p2b.y) / 2;

        rotatePoint(p1a, m1x, m1y, errAngle / 2);
        rotatePoint(p1b, m1x, m1y, errAngle / 2);
        rotatePoint(p2a, m2x, m2y, -errAngle / 2);
        rotatePoint(p2b, m2x, m2y, -errAngle / 2);
      }

      // 2. Coincident to line enforcement
      const nx = -dy1 / len1;
      const ny = dx1 / len1;

      const distA = (p2a.x - p1a.x) * nx + (p2a.y - p1a.y) * ny;
      const distB = (p2b.x - p1a.x) * nx + (p2b.y - p1a.y) * ny;

      const w1 = (p1a.isFixed && p1b.isFixed) ? 0 : 0.5;
      const w2 = (p2a.isFixed && p2b.isFixed) ? 0 : 0.5;

      if (w2 > 0) {
        if (!p2a.isFixed) { p2a.x -= distA * nx * w2; p2a.y -= distA * ny * w2; }
        if (!p2b.isFixed) { p2b.x -= distB * nx * w2; p2b.y -= distB * ny * w2; }
      }
      if (w1 > 0) {
        const avgDist = (distA + distB) / 2;
        if (!p1a.isFixed) { p1a.x += avgDist * nx * w1; p1a.y += avgDist * ny * w1; }
        if (!p1b.isFixed) { p1b.x += avgDist * nx * w1; p1b.y += avgDist * ny * w1; }
      }
      break;
      }

      case 'PIERCE': {
      if (!constraint.nodeIds || constraint.nodeIds.length !== 1) return;
      const node = nodes[constraint.nodeIds[0]];
      if (!node || node.isFixed) return;

      if (constraint.value !== undefined && constraint.offset !== undefined) {
        node.x = constraint.value;
        node.y = constraint.offset;
      }
      break;
      }

      case 'PARALLEL': {
      if (!constraint.nodeIds || constraint.nodeIds.length !== 1) return;
      const node = nodes[constraint.nodeIds[0]];
      if (!node || node.isFixed) return;

      // For Pierce, 'value' and 'offset' in the constraint store the target U and V
      if (constraint.value !== undefined && constraint.offset !== undefined) {
        node.x = constraint.value;
        node.y = constraint.offset;
      }
      break;
    }

    case 'PARALLEL': {
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
      let err = angle2 - angle1;
      
      // Parallel means angle difference is 0 or PI
      err = Math.atan2(Math.sin(err), Math.cos(err));
      if (Math.abs(err) > Math.PI / 2) {
         err = err > 0 ? err - Math.PI : err + Math.PI;
      }

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

      rotatePoint(p1a, m1x, m1y, err / 2);
      rotatePoint(p1b, m1x, m1y, err / 2);
      rotatePoint(p2a, m2x, m2y, -err / 2);
      rotatePoint(p2b, m2x, m2y, -err / 2);
      break;
    }

    case 'PERPENDICULAR': {
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
      let err = angle2 - angle1;
      
      // Perpendicular means angle difference is PI/2 or -PI/2
      err = Math.atan2(Math.sin(err), Math.cos(err));
      if (err > 0) err -= Math.PI / 2;
      else err += Math.PI / 2;

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

      rotatePoint(p1a, m1x, m1y, err / 2);
      rotatePoint(p1b, m1x, m1y, err / 2);
      rotatePoint(p2a, m2x, m2y, -err / 2);
      rotatePoint(p2b, m2x, m2y, -err / 2);
      break;
    }

    case 'MIDPOINT': {
      if (!constraint.nodeIds || constraint.nodeIds.length !== 1 || !constraint.edgeIds || constraint.edgeIds.length !== 1) return;
      const targetNode = nodes[constraint.nodeIds[0]];
      const edge = edges[constraint.edgeIds[0]];
      if (!targetNode || !edge || edge.nodeIds.length < 2) return;
      const n1 = nodes[edge.nodeIds[0]];
      const n2 = nodes[edge.nodeIds[1]];
      if (!n1 || !n2) return;

      const midX = (n1.x + n2.x) / 2;
      const midY = (n1.y + n2.y) / 2;

      const dx = midX - targetNode.x;
      const dy = midY - targetNode.y;

      // targetNode moves towards mid, or mid elements move towards target
      const w_target = targetNode.isFixed ? 0 : 1.0;
      const w_edge = (n1.isFixed && n2.isFixed) ? 0 : 0.5;

      if (w_target > 0) {
        targetNode.x += dx * w_target;
        targetNode.y += dy * w_target;
      } else if (w_edge > 0) {
        const moveX = -dx * w_edge;
        const moveY = -dy * w_edge;
        if (!n1.isFixed) { n1.x += moveX; n1.y += moveY; }
        if (!n2.isFixed) { n2.x += moveX; n2.y += moveY; }
      }
      break;
    }

    case 'SYMMETRIC': {
      if (!constraint.nodeIds || constraint.nodeIds.length !== 2 || !constraint.edgeIds || constraint.edgeIds.length !== 1) return;
      const p1 = nodes[constraint.nodeIds[0]];
      const p2 = nodes[constraint.nodeIds[1]];
      const axis = edges[constraint.edgeIds[0]];
      if (!p1 || !p2 || !axis || axis.nodeIds.length < 2) return;
      const a1 = nodes[axis.nodeIds[0]];
      const a2 = nodes[axis.nodeIds[1]];
      if (!a1 || !a2) return;

      const dx = a2.x - a1.x;
      const dy = a2.y - a1.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-6) return;

      // Project p1 and p2 onto axis
      const getProj = (p: SketchNode) => {
        const t = ((p.x - a1.x) * dx + (p.y - a1.y) * dy) / lenSq;
        return { x: a1.x + t * dx, y: a1.y + t * dy };
      };

      const proj1 = getProj(p1);
      const proj2 = getProj(p2);

      // 1. Force both to share the same projection point (symmetry)
      const avgProjX = (proj1.x + proj2.x) / 2;
      const avgProjY = (proj1.y + proj2.y) / 2;

      // 2. Force distances to projection to be equal
      const dist1 = Math.hypot(p1.x - proj1.x, p1.y - proj1.y);
      const dist2 = Math.hypot(p2.x - proj2.x, p2.y - proj2.y);
      const avgDist = (dist1 + dist2) / 2;

      const relaxPoint = (p: SketchNode, proj: {x: number, y: number}, targetDist: number) => {
        if (p.isFixed) return;
        const vx = p.x - proj.x;
        const vy = p.y - proj.y;
        const curDist = Math.hypot(vx, vy);
        if (curDist < 1e-6) {
          // If point is on axis, push it slightly out based on normal
          const nx = -dy / Math.sqrt(lenSq);
          const ny = dx / Math.sqrt(lenSq);
          p.x = avgProjX + nx * targetDist;
          p.y = avgProjY + ny * targetDist;
        } else {
          const ratio = targetDist / curDist;
          p.x = avgProjX + vx * ratio;
          p.y = avgProjY + vy * ratio;
        }
      };

      relaxPoint(p1, proj1, avgDist);
      relaxPoint(p2, proj2, avgDist);
      break;
    }
  }
}

export interface SketchDefinitionReport {
  nodes: Record<string, 'UNDER' | 'FULLY' | 'CONFLICT'>;
  edges: Record<string, 'UNDER' | 'FULLY' | 'CONFLICT'>;
  hasConflict: boolean;
  dof: number;
}

export function calculateDOF(
  nodes: Record<string, SketchNode>,
  constraints: Record<string, SketchConstraint>
): number {
  let nonFixedCount = 0;
  for (const n of Object.values(nodes)) {
    if (!n.isFixed) nonFixedCount++;
  }
  let dof = nonFixedCount * 2;

  for (const c of Object.values(constraints)) {
    if (c.type === 'COINCIDENT') {
      if (c.nodeIds?.length === 2) dof -= 2;
      else if (c.nodeIds?.length === 1 && c.edgeIds?.length === 1) dof -= 1;
    } else if (c.type === 'CONCENTRIC' || c.type === 'PIERCE') {
      dof -= 2;
    } else {
      dof -= 1; 
    }
  }
  return dof;
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
        } else if (constraint.nodeIds && constraint.nodeIds.length === 1 && constraint.edgeIds && constraint.edgeIds.length === 1) {
          const node = relaxedNodes[constraint.nodeIds[0]];
          const edge = edges[constraint.edgeIds[0]];
          if (node && edge) {
            const e1 = relaxedNodes[edge.nodeIds[0]];
            const e2 = relaxedNodes[edge.nodeIds[1]];
            if (e1 && e2) {
              if (edge.type === 'LINE' || edge.type === 'CENTER_LINE') {
                const dx = e2.x - e1.x;
                const dy = e2.y - e1.y;
                const l = Math.hypot(dx, dy);
                if (l > 1e-6) {
                  err = Math.abs((node.x - e1.x) * (-dy / l) + (node.y - e1.y) * (dx / l));
                }
              } else if (edge.type === 'CIRCLE' || edge.type === 'ARC') {
                const R = Math.hypot(e2.x - e1.x, e2.y - e1.y);
                err = Math.abs(Math.hypot(node.x - e1.x, node.y - e1.y) - R);
              }
            }
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
        if (constraint.value === undefined) break;
        let d = -1;
        if (constraint.nodeIds && constraint.nodeIds.length === 2) {
          const n1 = relaxedNodes[constraint.nodeIds[0]];
          const n2 = relaxedNodes[constraint.nodeIds[1]];
          if (n1 && n2) d = Math.hypot(n2.x - n1.x, n2.y - n1.y);
        } else if (constraint.nodeIds && constraint.nodeIds.length === 1 && constraint.edgeIds && constraint.edgeIds.length === 1) {
          const n1 = relaxedNodes[constraint.nodeIds[0]];
          const e = edges[constraint.edgeIds[0]];
          if (n1 && e && e.type === 'CIRCLE' && e.nodeIds.length >= 2) {
            const pc = relaxedNodes[e.nodeIds[0]];
            const pr = relaxedNodes[e.nodeIds[1]];
            const radius = Math.hypot(pr.x - pc.x, pr.y - pc.y);
            const distCenter = Math.hypot(n1.x - pc.x, n1.y - pc.y);
            if (constraint.arcCondition === 'MIN') d = Math.abs(distCenter - radius);
            else if (constraint.arcCondition === 'MAX') d = distCenter + radius;
            else d = distCenter;
          }
        } else if (constraint.edgeIds && constraint.edgeIds.length === 2) {
          const e1 = edges[constraint.edgeIds[0]];
          const e2 = edges[constraint.edgeIds[1]];
          const el = e1.type === 'LINE' ? e1 : (e2.type === 'LINE' ? e2 : null);
          const ec = e1.type === 'CIRCLE' ? e1 : (e2.type === 'CIRCLE' ? e2 : null);
          if (el && ec && el.nodeIds.length >= 2 && ec.nodeIds.length >= 2) {
            const p1 = relaxedNodes[el.nodeIds[0]];
            const p2 = relaxedNodes[el.nodeIds[1]];
            const pc = relaxedNodes[ec.nodeIds[0]];
            const pr = relaxedNodes[ec.nodeIds[1]];
            const radius = Math.hypot(pr.x - pc.x, pr.y - pc.y);
            const distCenter = pointToLineDistance(pc, p1, p2);
            if (constraint.arcCondition === 'MIN') d = Math.abs(distCenter - radius);
            else if (constraint.arcCondition === 'MAX') d = distCenter + radius;
            else d = distCenter;
          }
        }
        if (d >= 0) err = Math.abs(d - constraint.value);
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
      case 'PARALLEL': {
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
              if (Math.hypot(dx1, dy1) > 1e-4 && Math.hypot(dx2, dy2) > 1e-4) {
                const angle1 = Math.atan2(dy1, dx1);
                const angle2 = Math.atan2(dy2, dx2);
                let diff = angle2 - angle1;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                if (Math.abs(diff) > Math.PI / 2) {
                   diff = diff > 0 ? diff - Math.PI : diff + Math.PI;
                }
                err = Math.abs(diff);
              }
            }
          }
        }
        break;
      }
      case 'PERPENDICULAR': {
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
              if (Math.hypot(dx1, dy1) > 1e-4 && Math.hypot(dx2, dy2) > 1e-4) {
                const angle1 = Math.atan2(dy1, dx1);
                const angle2 = Math.atan2(dy2, dx2);
                let diff = angle2 - angle1;
                diff = Math.atan2(Math.sin(diff), Math.cos(diff));
                if (diff > 0) diff -= Math.PI / 2;
                else diff += Math.PI / 2;
                err = Math.abs(diff);
              }
            }
          }
        }
        break;
      }
      case 'COLLINEAR': {
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
              const len1 = Math.hypot(dx1, dy1);
              if (len1 > 1e-4) {
                const nx = -dy1 / len1;
                const ny = dx1 / len1;
                const distA = Math.abs((p2a.x - p1a.x) * nx + (p2a.y - p1a.y) * ny);
                const distB = Math.abs((p2b.x - p1a.x) * nx + (p2b.y - p1a.y) * ny);
                err = distA + distB;
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

  const dof = calculateDOF(nodes, constraints);
  return { nodes: nodeStatus, edges: edgeStatus, hasConflict, dof };
}
