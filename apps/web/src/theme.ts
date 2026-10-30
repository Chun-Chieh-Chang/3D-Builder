import { setPalette, type Palette } from '@3db/render';
import { setSketchColors, type SketchColors } from './sketcher/overlay';

/**
 * The stylesheet says what the theme looks like; the graphics areas are drawn by WebGL and by a 2D
 * canvas, which are handed numbers and cannot read `var(--…)`. So the numbers are looked up here,
 * from the same custom properties the panels use, and handed to the renderer.
 *
 * Resolving is done the way a browser resolves: the property is set on a throwaway element so its
 * `var()` chain and `oklch()` are computed, and the computed colour is drawn into a one-pixel
 * canvas to be read back as bytes. Parsing it here instead would mean a second colour engine that
 * can disagree with the first.
 */

/** The names the graphics areas read, and the palette entry each one fills. */
const VIEW: Record<keyof Palette, string> = {
  body: '--view-body',
  edge: '--view-edge',
  ghost: '--view-ghost',
  edgeHover: '--view-hover',
  edgeSelected: '--view-selected',
  background: '--view-bg',
  cap: '--view-cap',
  section: '--view-section',
  snap: '--view-snap',
  componentHover: '--view-component-hover',
  componentSelected: '--view-component-selected',
  componentCollided: '--view-collided',
  highlight: '--view-highlight',
  highlightEdge: '--view-highlight-edge',
};

const SKETCH: Record<keyof SketchColors, string> = {
  fully: '--sketch-fully',
  under: '--sketch-under',
  over: '--sketch-over',
  selected: '--sketch-selected',
  hover: '--sketch-hover',
  preview: '--sketch-preview',
  opAdd: '--sketch-op-add',
  opChange: '--sketch-op-change',
  opRemove: '--sketch-op-remove',
  guide: '--sketch-guide',
  grid: '--sketch-grid',
  gridMajor: '--sketch-grid-major',
  dimension: '--sketch-dimension',
  origin: '--sketch-origin',
  reference: '--sketch-reference',
};

/** A colour no theme would ever name, so a value the canvas could not draw is recognisable. */
const UNDRAWABLE = '#010203';

let canvas: HTMLCanvasElement | undefined;
let ctx: CanvasRenderingContext2D | null | undefined;

function readColour(name: string, declared: CSSStyleDeclaration): number {
  // Ask the stylesheet whether the property exists rather than comparing colours: a token may legitimately
  // hold the same colour the text would fall back to, and then the two are indistinguishable downstream.
  if (!declared.getPropertyValue(name).trim()) throw new Error(`${name} is not declared by the stylesheet`);
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  if (ctx === undefined) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) throw new Error('no 2D context to read the theme with');
  // The sentinel is drawn, not just assigned, so the bytes it leaves are known: a colour that reaches
  // here and does not survive the canvas is then recognisable, rather than quietly handing the graphics
  // area black — which is what a missing fillRect looked like.
  ctx.fillStyle = UNDRAWABLE;
  ctx.fillRect(0, 0, 1, 1);
  const sentinel = ctx.getImageData(0, 0, 1, 1).data;
  ctx.fillStyle = computed;
  // A value the canvas cannot draw leaves the sentinel string in place. Falling back to a default would
  // hand the graphics area a colour the panels do not have, and nothing would say so.
  if (ctx.fillStyle === UNDRAWABLE) throw new Error(`${name} computed to "${computed}", which the canvas cannot draw`);
  ctx.fillRect(0, 0, 1, 1);
  const bytes = ctx.getImageData(0, 0, 1, 1).data;
  if (bytes[0] === sentinel[0] && bytes[1] === sentinel[1] && bytes[2] === sentinel[2])
    throw new Error(`${name} computed to "${computed}", which the canvas drew as nothing`);
  return (bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!;
}

function resolve<T extends string>(names: Record<T, string>, declared: CSSStyleDeclaration): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const key of Object.keys(names) as T[]) out[key] = readColour(names[key], declared);
  return out;
}

/**
 * Copy the theme out of the stylesheet and into the renderer and the sketcher. Call once before the
 * first viewer is built, and again if the theme ever changes.
 */
export function applyTheme(): void {
  const declared = getComputedStyle(document.documentElement);
  setPalette(resolve(VIEW, declared));
  setSketchColors(resolve(SKETCH, declared));
}
