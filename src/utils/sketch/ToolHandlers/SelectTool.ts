import { SketchToolHandler, SketchToolContext } from './BaseTool';
import { useCadStore } from '../../../store/useCadStore';

export class SelectToolHandler implements SketchToolHandler {
  onPointerDown(ctx: SketchToolContext): void {
    // Select logic is mostly handled in SketchPreview via onClick, but if they click empty space, deselect all.
    if (!ctx.snappedNodeId) {
      useCadStore.setState({ selectedEntityIds: [] });
    }
  }

  onPointerMove(ctx: SketchToolContext): void {}
  onPointerUp(ctx: SketchToolContext): void {}
  onDoubleClick(ctx: SketchToolContext): void {}
  onContextMenu(ctx: SketchToolContext): void {}
  onCancel(): void {}
}
