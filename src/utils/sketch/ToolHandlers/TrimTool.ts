import { SketchToolHandler, SketchToolContext } from './BaseTool';
import { useCadStore } from '../../../store/useCadStore';
import { sketchActions } from '../../../store/sketchActions';
import { intersectSegments, intersectSegmentCircle, intersectLines } from '../../geometry/Intersection';

export class TrimToolHandler implements SketchToolHandler {
  private lastDragU: number | null = null;
  private lastDragV: number | null = null;
  private isDragging = false;

  onPointerDown(ctx: SketchToolContext): void {
    this.isDragging = true;
    this.lastDragU = ctx.rawU;
    this.lastDragV = ctx.rawV;
  }

  onPointerMove(ctx: SketchToolContext): void {
    if (!this.isDragging || this.lastDragU === null || this.lastDragV === null) return;
    
    const p1 = { x: this.lastDragU, y: this.lastDragV };
    const p2 = { x: ctx.rawU, y: ctx.rawV };
    this.lastDragU = ctx.rawU;
    this.lastDragV = ctx.rawV;
    
    // Check intersection with all edges for Power Trim
    const state = useCadStore.getState();
    const edges = Object.values(state.sketchEdges);
    const nodes = state.sketchNodes;
    
    const brushIntersect = (
      x1: number, y1: number, x2: number, y2: number, 
      x3: number, y3: number, x4: number, y4: number
    ) => {
      const den = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
      if (den === 0) return false;
      const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / den;
      const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / den;
      return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    };

    for (const edge of edges) {
      if (edge.type === 'LINE') {
        const n1 = nodes[edge.nodeIds[0]];
        const n2 = nodes[edge.nodeIds[1]];
        if (!n1 || !n2) continue;
        
        if (brushIntersect(p1.x, p1.y, p2.x, p2.y, n1.x, n1.y, n2.x, n2.y)) {
          this.performIntersectionTrim(edge.id, ctx.rawU, ctx.rawV);
        }
      }
    }
  }

  onPointerUp(ctx: SketchToolContext): void {
    if (this.isDragging && this.lastDragU !== null && this.lastDragV !== null) {
      const dist = Math.hypot(ctx.rawU - this.lastDragU, ctx.rawV - this.lastDragV);
      if (dist < 2) {
        this.performClickTrim(ctx.rawU, ctx.rawV);
      }
    }
    this.isDragging = false;
    this.lastDragU = null;
    this.lastDragV = null;
  }

  private performIntersectionTrim(edgeId: string, brushU: number, brushV: number) {
    const state = useCadStore.getState();
    const targetEdge = state.sketchEdges[edgeId];
    if (!targetEdge || targetEdge.type !== 'LINE') return;

    const nStart = state.sketchNodes[targetEdge.nodeIds[0]];
    const nEnd = state.sketchNodes[targetEdge.nodeIds[1]];
    if (!nStart || !nEnd) return;

    // 1. Find all intersection points with OTHER edges
    let intersectionPoints: { x: number, y: number, dist: number }[] = [];
    
    Object.values(state.sketchEdges).forEach(other => {
      if (other.id === edgeId) return;
      
      if (other.type === 'LINE') {
        const oStart = state.sketchNodes[other.nodeIds[0]];
        const oEnd = state.sketchNodes[other.nodeIds[1]];
        if (oStart && oEnd) {
          const pt = intersectSegments(nStart, nEnd, oStart, oEnd);
          if (pt) {
            const d = Math.hypot(pt.x - nStart.x, pt.y - nStart.y);
            intersectionPoints.push({ ...pt, dist: d });
          }
        }
      } else if (other.type === 'CIRCLE') {
        const center = state.sketchNodes[other.nodeIds[0]];
        const perimeter = state.sketchNodes[other.nodeIds[1]];
        if (center && perimeter) {
          const radius = Math.hypot(perimeter.x - center.x, perimeter.y - center.y);
          const pts = intersectSegmentCircle(nStart, nEnd, center, radius);
          pts.forEach(pt => {
            const d = Math.hypot(pt.x - nStart.x, pt.y - nStart.y);
            intersectionPoints.push({ ...pt, dist: d });
          });
        }
      }
    });

    // 2. Sort intersections by distance from nStart
    intersectionPoints.sort((a, b) => a.dist - b.dist);

    // 3. Define the segments [Start, I1, I2, ..., End]
    const totalDist = Math.hypot(nEnd.x - nStart.x, nEnd.y - nStart.y);
    const boundaryDistances = [0, ...intersectionPoints.map(i => i.dist), totalDist];
    const boundaryPoints = [nStart, ...intersectionPoints, nEnd];

    // 4. Find which segment the brush is closest to
    const brushDistToStart = Math.hypot(brushU - nStart.x, brushV - nStart.y);
    
    // Project brush onto the line to get its "distance" along the line
    const dx = nEnd.x - nStart.x;
    const dy = nEnd.y - nStart.y;
    let t = ((brushU - nStart.x) * dx + (brushV - nStart.y) * dy) / (totalDist * totalDist);
    t = Math.max(0, Math.min(1, t));
    const brushDistAlong = t * totalDist;

    // Identify which interval [boundaryDistances[k], boundaryDistances[k+1]] contains brushDistAlong
    let segmentIndex = -1;
    for (let i = 0; i < boundaryDistances.length - 1; i++) {
      if (brushDistAlong >= boundaryDistances[i] && brushDistAlong <= boundaryDistances[i+1]) {
        segmentIndex = i;
        break;
      }
    }

    if (segmentIndex === -1) {
      sketchActions.deleteEdges([edgeId]);
      return;
    }

    // 5. Perform the split and delete the target segment
    // This is complex for a single action. For simplicity in this iteration:
    // If there are intersections, we only split at the boundaries of the segmentIndex.
    
    const leftPt = boundaryPoints[segmentIndex];
    const rightPt = boundaryPoints[segmentIndex + 1];

    // If the segment is the whole line, just delete
    if (segmentIndex === 0 && segmentIndex === boundaryDistances.length - 2) {
      sketchActions.deleteEdges([edgeId]);
      return;
    }

    // Surgical replacement:
    // Delete the original edge.
    // Create new segments for all other intervals.
    sketchActions.deleteEdges([edgeId]);
    
    for (let i = 0; i < boundaryDistances.length - 1; i++) {
      if (i === segmentIndex) continue; // This is the trimmed part
      
      const pA = boundaryPoints[i];
      const pB = boundaryPoints[i+1];
      
      // Add nodes and edge
      // Note: In a real system we should reuse existing nodes at boundaries
      const nA_id = sketchActions.addNode(pA.x, pA.y);
      const nB_id = sketchActions.addNode(pB.x, pB.y);
      if (nA_id && nB_id) {
        sketchActions.addEdge('LINE', [nA_id, nB_id]);
      }
    }
  }

  private performClickTrim(u: number, v: number) {
    const state = useCadStore.getState();
    let closestEdgeId: string | null = null;
    let minDist = Infinity;
    const SNAP_DIST = 3.5;

    const pointToSegmentDistance = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
      if (l2 === 0) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
    };

    Object.values(state.sketchEdges).forEach(edge => {
      const n1 = state.sketchNodes[edge.nodeIds[0]];
      const n2 = state.sketchNodes[edge.nodeIds[1]];
      if (n1 && n2) {
        const d = pointToSegmentDistance(u, v, n1.x, n1.y, n2.x, n2.y);
        if (d < SNAP_DIST && d < minDist) {
          minDist = d;
          closestEdgeId = edge.id;
        }
      }
    });

    if (closestEdgeId) {
      this.performIntersectionTrim(closestEdgeId, u, v);
    }
  }

  private performCornerTrim(edge1Id: string, edge2Id: string) {
    const state = useCadStore.getState();
    const e1 = state.sketchEdges[edge1Id];
    const e2 = state.sketchEdges[edge2Id];

    if (!e1 || !e2 || e1.type !== 'LINE' || e2.type !== 'LINE') return;

    const n1 = state.sketchNodes[e1.nodeIds[0]];
    const n2 = state.sketchNodes[e1.nodeIds[1]];
    const n3 = state.sketchNodes[e2.nodeIds[0]];
    const n4 = state.sketchNodes[e2.nodeIds[1]];

    if (!n1 || !n2 || !n3 || !n4) return;

    const intersect = intersectLines(n1, n2, n3, n4);
    if (!intersect) return;

    // Determine which endpoints to move (the ones closest to the intersection)
    const d1 = Math.hypot(n1.x - intersect.x, n1.y - intersect.y);
    const d2 = Math.hypot(n2.x - intersect.x, n2.y - intersect.y);
    const d3 = Math.hypot(n3.x - intersect.x, n3.y - intersect.y);
    const d4 = Math.hypot(n4.x - intersect.x, n4.y - intersect.y);

    const nodeToMove1 = d1 < d2 ? e1.nodeIds[0] : e1.nodeIds[1];
    const nodeToMove2 = d3 < d4 ? e2.nodeIds[0] : e2.nodeIds[1];

    // Surgical Update
    sketchActions.updateNodePosition(nodeToMove1, intersect.x, intersect.y);
    sketchActions.updateNodePosition(nodeToMove2, intersect.x, intersect.y);
    
    // Add Coincident constraint between the two endpoints
    sketchActions.addConstraint('COINCIDENT', [], [nodeToMove1, nodeToMove2]);
  }

  onDoubleClick(ctx: SketchToolContext): void {}
  onContextMenu(ctx: SketchToolContext): void {}
  onCancel(): void {
    this.isDragging = false;
  }
}
