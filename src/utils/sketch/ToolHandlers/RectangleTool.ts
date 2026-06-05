import { SketchToolHandler, SketchToolContext } from './BaseTool';
import { useCadStore } from '../../../store/useCadStore';
import { sketchActions } from '../../../store/sketchActions';
import { v4 as uuidv4 } from 'uuid';
import { requireValidPoint } from '../DataIntegrity';

export class RectangleToolHandler implements SketchToolHandler {
  onPointerDown(ctx: SketchToolContext): void {
    const state = useCadStore.getState();
    let nId = ctx.snappedNodeId;
    if (!nId) {
      const isOrigin = Math.abs(ctx.snappedU) < 1e-5 && Math.abs(ctx.snappedV) < 1e-5;
      nId = sketchActions.addNode(ctx.snappedU, ctx.snappedV, isOrigin);
      if (!nId) return;
    }

    if (state.sketchNewChain || !state.lastClickedNodeId) {
      useCadStore.setState({ sketchNewChain: false, lastClickedNodeId: nId, firstChainNodeId: nId });
    } else {
      const n1 = state.lastClickedNodeId;
      const n3 = nId; // Diagonal corner
      
      const node1 = state.sketchNodes[n1];
      if (!requireValidPoint(ctx.snappedU, node1.y) || !requireValidPoint(node1.x, ctx.snappedV)) return;

      const n2 = uuidv4();
      const n4 = uuidv4();
      
      const newNodes = {
        ...state.sketchNodes,
        [n2]: { id: n2, x: ctx.snappedU, y: node1.y },
        [n4]: { id: n4, x: node1.x, y: ctx.snappedV }
      };

      const e1 = uuidv4(); const e2 = uuidv4(); const e3 = uuidv4(); const e4 = uuidv4();
      const newEdges = {
        ...state.sketchEdges,
        [e1]: { id: e1, type: 'LINE', nodeIds: [n1, n2] },
        [e2]: { id: e2, type: 'LINE', nodeIds: [n2, n3] },
        [e3]: { id: e3, type: 'LINE', nodeIds: [n3, n4] },
        [e4]: { id: e4, type: 'LINE', nodeIds: [n4, n1] }
      } as Record<string, any>;

      const c1 = uuidv4(); const c2 = uuidv4();
      const newConstraints = {
        ...state.sketchConstraints,
        [c1]: { id: c1, type: 'HORIZONTAL' as const, edgeIds: [e1, e3] },
        [c2]: { id: c2, type: 'VERTICAL' as const, edgeIds: [e2, e4] }
      };

      sketchActions.commitBatch(newNodes, newEdges, newConstraints);
      useCadStore.setState({ sketchNewChain: true, lastClickedNodeId: null, firstChainNodeId: null });
    }
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
  onDoubleClick(): void {
    useCadStore.setState({ sketchNewChain: true, lastClickedNodeId: null, firstChainNodeId: null });
  }
  onContextMenu(): void { this.onDoubleClick(); }
  onCancel(): void { this.onDoubleClick(); }
}

/**
 * CenterRectangleToolHandler:
 * First click sets the CENTER of the rectangle.
 * Second click sets a CORNER. The rectangle is created symmetrically around the center.
 */
export class CenterRectangleToolHandler implements SketchToolHandler {
  onPointerDown(ctx: SketchToolContext): void {
    const state = useCadStore.getState();

    if (state.sketchNewChain || !state.lastClickedNodeId) {
      // First click: store center point as a temporary reference node
      let centerId = ctx.snappedNodeId;
      if (!centerId) {
        const isOrigin = Math.abs(ctx.snappedU) < 1e-5 && Math.abs(ctx.snappedV) < 1e-5;
        centerId = sketchActions.addNode(ctx.snappedU, ctx.snappedV, isOrigin);
        if (!centerId) return;
      }
      useCadStore.setState({ sketchNewChain: false, lastClickedNodeId: centerId, firstChainNodeId: centerId });
    } else {
      // Second click: corner is the current point; expand symmetrically from center
      const centerNode = state.sketchNodes[state.lastClickedNodeId!];
      if (!centerNode) return;

      const cx = centerNode.x;
      const cy = centerNode.y;
      const fx = ctx.snappedU;
      const fy = ctx.snappedV;

      const dx = fx - cx;
      const dy = fy - cy;

      if (!requireValidPoint(dx, dy)) return;

      // 4 corners: center ± dx/dy
      const id1 = uuidv4(); const id2 = uuidv4();
      const id3 = uuidv4(); const id4 = uuidv4();

      const newNodes = {
        ...state.sketchNodes,
        [id1]: { id: id1, x: cx + dx, y: cy + dy },  // corner (fx, fy)
        [id2]: { id: id2, x: cx - dx, y: cy + dy },
        [id3]: { id: id3, x: cx - dx, y: cy - dy },
        [id4]: { id: id4, x: cx + dx, y: cy - dy },
      };

      // Remove temporary center node if it's not fixed (like the origin)
      const centerId = state.lastClickedNodeId!;
      if (newNodes[centerId] && !newNodes[centerId].isFixed) {
        delete newNodes[centerId];
      }

      const e1 = uuidv4(); const e2 = uuidv4();
      const e3 = uuidv4(); const e4 = uuidv4();
      const newEdges = {
        ...state.sketchEdges,
        [e1]: { id: e1, type: 'LINE', nodeIds: [id1, id2] },
        [e2]: { id: e2, type: 'LINE', nodeIds: [id2, id3] },
        [e3]: { id: e3, type: 'LINE', nodeIds: [id3, id4] },
        [e4]: { id: e4, type: 'LINE', nodeIds: [id4, id1] },
      } as Record<string, any>;

      const c1 = uuidv4(); const c2 = uuidv4();
      const newConstraints = {
        ...state.sketchConstraints,
        [c1]: { id: c1, type: 'HORIZONTAL' as const, edgeIds: [e1, e3] },
        [c2]: { id: c2, type: 'VERTICAL' as const, edgeIds: [e2, e4] },
      };

      sketchActions.commitBatch(newNodes, newEdges, newConstraints);
      useCadStore.setState({ sketchNewChain: true, lastClickedNodeId: null, firstChainNodeId: null });
    }
  }

  onPointerMove(): void {}
  onPointerUp(): void {}
  onDoubleClick(): void {
    useCadStore.setState({ sketchNewChain: true, lastClickedNodeId: null, firstChainNodeId: null });
  }
  onContextMenu(): void { this.onDoubleClick(); }
  onCancel(): void { this.onDoubleClick(); }
}
