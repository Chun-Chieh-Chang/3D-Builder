export interface SketchToolContext {
  rawU: number;
  rawV: number;
  snappedU: number;
  snappedV: number;
  snappedNodeId: string | null;
  shiftKey: boolean;
  activeSnapType?: string;
}

export interface SketchToolHandler {
  onPointerDown(ctx: SketchToolContext): void;
  onPointerMove(ctx: SketchToolContext): void;
  onPointerUp(ctx: SketchToolContext): void;
  onDoubleClick(ctx: SketchToolContext): void;
  onContextMenu(ctx: SketchToolContext): void; // Right click
  onCancel(): void; // Esc or tool change
}
