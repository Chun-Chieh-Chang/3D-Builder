import { SketchToolHandler, SketchToolContext } from './BaseTool';
import { useCadStore } from '../../../store/useCadStore';
import { sketchActions } from '../../../store/sketchActions';

export class SplineToolHandler implements SketchToolHandler {
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
      let activeSplineEdgeId: string | null = null;
      for (const edge of Object.values(state.sketchEdges)) {
        if (edge.type === 'SPLINE' && edge.nodeIds[edge.nodeIds.length - 1] === state.lastClickedNodeId) {
          activeSplineEdgeId = edge.id;
          break;
        }
      }
      if (activeSplineEdgeId) {
        // Splines mutate nodeIds array
        const updatedEdges = { ...state.sketchEdges };
        updatedEdges[activeSplineEdgeId].nodeIds.push(nId);
        useCadStore.setState({ sketchEdges: updatedEdges });
      } else {
        sketchActions.addEdge('SPLINE', [state.lastClickedNodeId, nId]);
      }
      useCadStore.setState({ sketchNewChain: false, lastClickedNodeId: nId });
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
