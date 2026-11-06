/**
 * AGENTS §3.4: 120 random closed splines, each on its own rigid placement. Truth does not pass through the conversion or a boolean: the area of the curve the kernel
 * fits, evaluated by OCCT. The section, and the two halves of it added, must close into loops and match. On its own file for a fresh Heap (§3.5); growth goes to the
 * report, not claimed as 0.
 *
 * - Only profiles that do not cross themselves count. A closed spline is fitted without periodicity, so some curl at their seam; their solids are invalid and a boolean
 *   on one drops a lobe (a measured case: 54.73 against the 52.92 the curve encloses on that side), so no truth has a meaning there. The rate goes to the report.
 * - `massProps` is not the truth (see `fitted`). How far off it was goes to the report; it is not asserted.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { Kernel, type Frame, type Segment, type Vec3 } from '@3db/kernel';
import { enclosedArea, fitted, polygonArea, selfCrossing, type Pt } from './section-edges-helpers';

let k: Kernel;
const heap = () => (k.oc as unknown as { wasmMemory: WebAssembly.Memory }).wasmMemory.buffer.byteLength;
beforeAll(async () => {
  k = await Kernel.load();
});

/** A small repeatable generator: the seed of a failure is its case number. */
function random(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

it('120 random spline sections close, and match the area of the curve they came from', () => {
  const start = heap();
  expect(start).toBeGreaterThan(0);
  const live = k.liveShapes;
  let spans = 0;
  let worst = 0;
  let simple = 0;
  let crossing = 0;
  let massError = 0;
  for (let n = 1; simple < 120; n++) {
    expect(n, `only ${simple} simple profiles in ${n} tries`).toBeLessThan(400);
    const rnd = random(n);
    const count = 4 + Math.floor(rnd() * 7);
    const size = 10 ** (rnd() * 2 - 1) * 10; // 1 to 100 mm
    const turn = rnd() * Math.PI;
    const points: Pt[] = [];
    for (let i = 0; i < count; i++) {
      const r = size * (0.6 + 0.4 * rnd());
      const t = turn + (2 * Math.PI * i) / count;
      points.push([r * Math.cos(t), r * Math.sin(t)]);
    }
    // Asked of the input, not of a section: a boolean that drops the lobe leaves a section that no longer crosses itself
    if (selfCrossing(fitted(k, points, 1500))) {
      crossing++;
      continue;
    }
    const xDir = unit([rnd() - 0.5 + 1e-3, rnd() - 0.5, rnd() - 0.5]);
    const normal = unit(cross(xDir, unit([rnd() - 0.5, rnd() - 0.5 + 1e-3, rnd() - 0.5])));
    const yDir = cross(normal, xDir);
    const origin: Vec3 = [(rnd() - 0.5) * 200, (rnd() - 0.5) * 200, (rnd() - 0.5) * 200];
    const base: Frame = { origin, xDir, yDir, normal };
    const h = size * (0.2 + rnd());
    const at = (d: number): Frame => ({ ...base, origin: [origin[0] + d * normal[0], origin[1] + d * normal[1], origin[2] + d * normal[2]] });
    const s = k.extrude(base, [{ outer: [{ kind: 'spline', points, closed: true, source: 's' } as Segment], holes: [] }], [h * normal[0], h * normal[1], h * normal[2]]).shape;
    try {
      const truth = Math.abs(polygonArea(fitted(k, points, 20000)));
      expect(truth, `case ${n}`).toBeGreaterThan(0);
      massError = Math.max(massError, Math.abs(k.massProps(s).volume / h - truth) / truth);
      const cut = (rnd() - 0.5) * 0.4 * size;
      const box = { u0: -3 * size, u1: 3 * size, v0: -3 * size, v1: 3 * size };
      const frame = at(rnd() * h);
      const edges = k.sectionEdges(s, frame, box);
      const beziers = edges.flatMap((e) => (e.kind === 'bezier' ? [e] : []));
      expect(beziers.length, `case ${n}`).toBeGreaterThan(0);
      for (const e of beziers) {
        spans += e.spans.length;
        for (const span of e.spans) for (const p of span) expect(p.every(Number.isFinite) && p[3] > 0 && p[2] === 0, `case ${n}`).toBe(true);
      }
      simple++;
      const whole = enclosedArea(edges);
      const left = enclosedArea(k.sectionEdges(s, frame, { ...box, u1: cut }));
      const right = enclosedArea(k.sectionEdges(s, frame, { ...box, u0: cut }));
      const error = Math.max(Math.abs(whole - truth), Math.abs(left + right - truth)) / truth;
      worst = Math.max(worst, error);
      expect(error, `case ${n}: whole ${whole}, halves ${left} + ${right}, truth ${truth}`).toBeLessThan(1e-5);
    } finally {
      k.release(s);
    }
  }
  expect(spans).toBeGreaterThan(120);
  expect(k.liveShapes).toBe(live);
  const growth = heap() - start;
  const dir = resolve('out/section-clearance');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'section-edges-fuzz.json'), JSON.stringify({ simple, crossing, spans, worstRelativeError: worst, massPropsWorstRelativeError: massError, startHeap: start, growth }, null, 2));
  // Each section is a boolean (§3.5), so some growth is known. The product's restart limit (ADR 0126): running past it here is a blow-up.
  expect(growth).toBeLessThan(512 * 1024 * 1024);
}, 300_000);
