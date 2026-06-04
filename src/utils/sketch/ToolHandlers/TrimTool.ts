import { SketchToolHandler, SketchToolContext } from './BaseTool';
import { useCadStore } from '../../../store/useCadStore';
import { sketchActions } from '../../../store/sketchActions';

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
    
    const intersect = (
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
        
        if (intersect(p1.x, p1.y, p2.x, p2.y, n1.x, n1.y, n2.x, n2.y)) {
          sketchActions.deleteEdges([edge.id]);
        }
      }
    }
  }

  onPointerUp(ctx: SketchToolContext): void {
    if (this.isDragging && this.lastDragU !== null && this.lastDragV !== null) {
      // Click-to-trim logic
      const dist = Math.hypot(ctx.rawU - this.lastDragU, ctx.rawV - this.lastDragV);
      if (dist < 2) { // Just a click, not a drag
        this.performClickTrim(ctx.rawU, ctx.rawV);
      }
    }
    this.isDragging = false;
    this.lastDragU = null;
    this.lastDragV = null;
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
      sketchActions.deleteEdges([closestEdgeId]);
    }
  }

  onDoubleClick(ctx: SketchToolContext): void {}
  onContextMenu(ctx: SketchToolContext): void {}
  onCancel(): void {
    this.isDragging = false;
  }
}
