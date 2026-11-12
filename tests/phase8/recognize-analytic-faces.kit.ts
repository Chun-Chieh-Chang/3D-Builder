/**
 * C4: parts whose faces a file stores as B-splines though they are planes and cylinders, read back through a real STEP file. Made here with real planes
 * and cylinders and then converted face by face (`Kernel.toBSpline`, exact for these), so what each must come back as is known without the code under
 * test: its volume in closed form, and its features. `moved` changes the weights of the rational B-splines in the STEP text, which moves each round
 * surface off its cylinder by a known amount: the surfaces alone (the file is then sloppy: its edges stay, the faces miss them, ADR 0249) or the
 * surfaces and the edge curves alike (a consistent body that is no cylinder, and must never be read as one).
 */
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import type { PlaneGcsSolver } from '@3db/sketch';
import type { Kernel, ShapeId } from '@3db/kernel';
import { reconstructImported, Regenerator } from '@3db/regen';

export const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
const circle = (c: number[], r: number) => [{ kind: 'circle', c, r, source: 'c' }];

export interface Plate {
  w: number;
  h: number;
  t: number;
  /** Round holes through the plate: centre and radius. */
  holes: { c: [number, number]; r: number }[];
  /** A round boss on top: centre, radius, height. */
  boss?: { c: [number, number]; r: number; h: number };
}

/** The plate with real planes and cylinders, and its volume in closed form. */
export function plate(kernel: Kernel, p: Plate): { shape: ShapeId; volume: number } {
  const outer = [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]].map((a, i, q) => L(a, q[(i + 1) % 4]!, 'q' + i));
  let shape = kernel.extrude(XY as never, [{ outer, holes: p.holes.map((x) => circle(x.c, x.r)) }] as never, [0, 0, p.t]).shape;
  let volume = p.w * p.h * p.t - p.holes.reduce((a, x) => a + Math.PI * x.r * x.r * p.t, 0);
  if (p.boss) {
    const boss = kernel.extrude({ ...XY, origin: [0, 0, p.t - 1] } as never, [{ outer: circle(p.boss.c, p.boss.r), holes: [] }] as never, [0, 0, p.boss.h + 1]).shape;
    const fused = kernel.boolean('fuse', shape, boss).shape;
    kernel.release(shape);
    kernel.release(boss);
    shape = fused;
    volume += Math.PI * p.boss.r * p.boss.r * p.boss.h;
  }
  return { shape, volume };
}

/** The STEP text of `shape` with every face a B-spline. */
export function splineStep(kernel: Kernel, shape: ShapeId): string {
  const spline = kernel.toBSpline(shape);
  try {
    return kernel.exportStep(spline, 'p');
  } finally {
    kernel.release(spline);
  }
}

/** `text` with the weights 0.5 of its rational B-spline surfaces (and, for 'both', curves) raised by `delta`: a 120° arc of radius r then bulges about r·delta·2/3. */
export function moved(text: string, delta: number, what: 'surfaces' | 'both'): string {
  const bump = (m: string) => m.replace(/\b0\.5\b/g, String(0.5 + delta));
  const out = text.replace(/RATIONAL_B_SPLINE_SURFACE\(\([\s\S]*?\)\)/g, bump);
  return what === 'both' ? out.replace(/RATIONAL_B_SPLINE_CURVE\(\([\s\S]*?\)\)/g, bump) : out;
}

/** Recognition of a STEP text, as the app does it. */
export async function recognizeText(kernel: Kernel, solver: PlaneGcsSolver, text: string) {
  const bytes = new TextEncoder().encode(text);
  const sha = await sha256Hex(bytes);
  const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    return reconstructImported(kernel, regen, doc, 'imp1', solver);
  } finally {
    regen.dispose();
  }
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random plate: its size, none to two holes kept apart and off the rim, and sometimes a boss clear of the holes. */
export function sample(seed: number): Plate {
  const r = rng(seed);
  const rd = (v: number) => Math.round(v * 1000) / 1000;
  const [w, h, t] = [rd(40 + 40 * r()), rd(30 + 30 * r()), rd(3 + 12 * r())];
  const holes: Plate['holes'] = [];
  const n = Math.floor(r() * 3);
  // each in its own third of the width, so they never meet
  for (let i = 0; i < n; i++) {
    const rad = rd(1.5 + 2.5 * r());
    holes.push({ c: [rd((w / 3) * (i + 0.5) - w / 12 + (w / 12) * r()), rd(h * 0.2 + h * 0.15 * r())], r: rad });
  }
  const boss = r() < 0.6 ? { c: [rd(w * 0.35 + w * 0.3 * r()), rd(h * 0.72)] as [number, number], r: rd(2 + Math.min(4, h * 0.1) * r()), h: rd(2 + 8 * r()) } : undefined;
  return { w, h, t, holes, ...(boss ? { boss } : {}) };
}
