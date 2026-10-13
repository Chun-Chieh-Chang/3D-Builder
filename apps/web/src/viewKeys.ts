/**
 * The view from the keyboard, as SolidWorks has it (its help and the SOLIDWORKS blog "How do I manipulate my model view"): the arrow keys turn the model
 * by the step of the options (15° at first) about the screen's axes through its middle, Shift+arrows by a quarter turn, Alt+Left/Right roll it by the
 * step, Ctrl+arrows pan it, Z zooms out and Shift+Z in, Ctrl+Shift+Z goes back to the previous view, and the space bar asks for a standard view. Fixed
 * keys, like SolidWorks' own; what each key does is worked out here, from the key alone, so it can be checked without a page.
 */
export type ViewKeyCommand =
  | { kind: 'orbit'; direction: 'horizontal' | 'vertical'; degrees: number }
  | { kind: 'roll'; degrees: number }
  | { kind: 'pan'; fx: number; fy: number }
  | { kind: 'zoom'; factor: number }
  | { kind: 'previous' }
  | { kind: 'orientation' };

/** How far Ctrl+arrow moves the model: this part of the view (SolidWorks does not say; a tenth keeps it in view after several). */
export const PAN_STEP = 0.1;
/** How much Shift+Z makes the model bigger, and Z smaller (SolidWorks does not say; a quarter, as a few turns of the wheel). */
export const ZOOM_STEP = 1.25;
/** Shift+arrow: a quarter turn, whatever the step. */
export const QUARTER = 90;

type Keys = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** What a key does to the view, or null when it is not one of these (and goes on to the shortcuts). `step` is the arrow keys' angle in degrees. */
export function viewKeyCommand(e: Keys, step: number): ViewKeyCommand | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const { shiftKey: shift, altKey: alt } = e;
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key] as [number, number] | undefined;
  if (arrow) {
    const [x, y] = arrow;
    if (!ctrl && !alt) {
      const degrees = shift ? QUARTER : step;
      return x !== 0 ? { kind: 'orbit', direction: 'horizontal', degrees: x * degrees } : { kind: 'orbit', direction: 'vertical', degrees: y * degrees };
    }
    if (ctrl && !alt && !shift) return { kind: 'pan', fx: x * PAN_STEP, fy: y * PAN_STEP };
    if (alt && !ctrl && !shift && x !== 0) return { kind: 'roll', degrees: x * step };
    return null;
  }
  if (e.key === 'z' || e.key === 'Z') {
    if (ctrl && shift && !alt) return { kind: 'previous' };
    if (!ctrl && !alt) return { kind: 'zoom', factor: shift ? ZOOM_STEP : 1 / ZOOM_STEP };
    return null; // Ctrl+Z is undo
  }
  if (e.key === ' ' && !ctrl && !alt && !shift) return { kind: 'orientation' };
  return null;
}
