/**
 * SDS-plus hammer drill bit (3/4"), modelled by an AI agent from a photo through the MCP tools (/photo-to-cad, 2026-11-15; see README.md).
 * Its own file: the two helical flute cuts take Emscripten heap on every rebuild (AGENTS.md §3.5), so it gets a fresh heap.
 *
 * Ground truth that does not come from the kernel:
 * - the revolved body is cones and cylinders;
 * - each shank groove removes ∫∫ (√(R(y)² − z²) − floor) over the slot outline: a one-dimensional integral over z (the length along y is
 *   closed form, and the shank-end chamfer R = 4 + y is integrated analytically), evaluated with Simpson's rule after z = r·sin θ;
 * - the two flutes are the same cut turned 180°, so they remove the same volume. A flute's volume itself has no closed form, so only
 *   the equality is checked.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Command, type PartDoc } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const { PI, sqrt, sin, cos, log } = Math;

const open = async () => {
  const file = await readPartFile(new Uint8Array(readFileSync(new URL('./sds-plus-bit.3dbx', import.meta.url))));
  expect(file.format).toBe('3dbx');
  expect(file.warnings).toEqual([]);
  return file.doc;
};
const ids = (doc: PartDoc) => doc.features.map((f) => f.id);
/** The part as it stood after `last`: everything after it suppressed. */
const upTo = (doc: PartDoc, last: string) => {
  const i = ids(doc).indexOf(last);
  if (i < 0) throw new Error(`no feature ${last}`);
  return applyCommand(doc, { type: 'setSuppressed', featureIds: ids(doc).slice(i + 1), value: true });
};
const setVariables = (doc: PartDoc, values: Record<string, string>) =>
  Object.entries(values).reduce((d, [name, expr]) => {
    const v = d.variables.find((x) => x.name === name);
    if (!v) throw new Error(`no variable ${name}`);
    return applyCommand(d, { type: 'setVariable', id: v.id, expr } as Command);
  }, doc);

/** Everything is read before the next rebuild releases this one's shapes. */
function measure(doc: PartDoc, step = false) {
  const r = regen.rebuild(doc);
  const body = r.body!;
  return {
    problems: r.features.filter((f) => f.status !== 'ok' || f.warnings).map((f) => `${f.id}=${f.status} ${f.message ?? ''} ${f.warnings ?? ''}`),
    underDefined: r.features.filter((f) => f.sketch && f.sketch.status !== 'fully').map((f) => f.id),
    volume: kernel.massProps(body.shape).volume,
    valid: kernel.isValid(body.shape),
    faces: body.names.faces,
    step: step
      ? (() => {
          const back = kernel.importStep(kernel.exportStep(body.shape, 'golden'));
          try {
            return kernel.massProps(back.shape).volume;
          } finally {
            kernel.release(back.shape);
          }
        })()
      : NaN,
  };
}

/** Shank-end chamfer C1 (r 4 → 5), shank r5 to 49, cone to r6.75 at 53.5, neck to 83.5, body r7.5 to L − 8. */
const revolved = (L: number) => PI * ((1 / 3) * (16 + 20 + 25) + 25 * 48 + (4.5 / 3) * (25 + 5 * 6.75 + 6.75 ** 2) + 6.75 ** 2 * 30 + 7.5 ** 2 * (L - 8 - 83.5));

const simpson = (f: (x: number) => number, a: number, b: number, n = 20000) => {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
};
/** ∫_{−r}^{r} g(z) dz through z = r·sin θ, which keeps √(r² − z²) at the slot's round end smooth. */
const acrossSlot = (r: number, g: (z: number) => number) => simpson((t) => g(r * sin(t)) * r * cos(t), -PI / 2, PI / 2);
/** Material of the r5 shank above a floor plane, at lateral offset z. */
const cap = (z: number, floor: number) => sqrt(25 - z * z) - floor;
const half = (r: number, z: number) => sqrt(Math.max(0, r * r - z * z));
/** ∫ √(u² − a²) du. */
const F = (u: number, a: number) => (u * sqrt(u * u - a * a) - a * a * log(u + sqrt(u * u - a * a))) / 2;
/** Open groove: from past the shank end to L, round at the top, floor 5 − depth; over y 0–1 the shank is the chamfer r = 4 + y. */
const openGroove = (W: number, L: number, depth: number) => {
  const r = W / 2;
  const floor = 5 - depth;
  return acrossSlot(r, (z) => F(5, z) - F(4, z) - floor + (L - r - 1 + half(r, z)) * cap(z, floor));
};
/** Closed groove: a slot W wide and L long, round at both ends, on the r5 shank. */
const closedGroove = (W: number, L: number, depth: number) => {
  const r = W / 2;
  return acrossSlot(r, (z) => (L - W + 2 * half(r, z)) * cap(z, 5 - depth));
};

describe('SDS-plus 3/4" bit: revolved body, two helical flutes, carbide tip, four shank grooves, engraved size', () => {
  it('rebuilds fully defined and valid, names made from how faces were made, and keeps its volume through STEP', async () => {
    const m = measure(await open(), true);
    expect(m.problems).toEqual([]);
    expect(m.underDefined).toEqual([]);
    expect(m.valid).toBe(true);
    expect(m.faces).toHaveLength(101);
    expect(m.faces.filter((n) => /:face(#|$)/.test(n))).toEqual([]);
    expect(m.step).toBeCloseTo(m.volume, 5);
  });

  it('the body is the revolved profile, the flutes are equal, and each groove takes what its outline says', async () => {
    const doc = await open();
    const v = Object.fromEntries(['rvBody', 'swFlute', 'swFlute2', 'chRelief', 'cuOpen', 'cuClosed', 'cuOpen2', 'cuClosed2', 'cuText'].map((id) => [id, measure(upTo(doc, id)).volume]));
    expect(v.rvBody).toBeCloseTo(revolved(210), 6);
    const flute1 = v.rvBody! - v.swFlute!;
    const flute2 = v.swFlute! - v.swFlute2!;
    expect(flute1).toBeGreaterThan(3000); // a real cut, not an empty one: 2 × 3677 of 29560
    expect(flute2).toBeCloseTo(flute1, 5);
    expect(v.chRelief! - v.cuOpen!).toBeCloseTo(openGroove(3, 26, 2), 5);
    expect(v.cuOpen! - v.cuClosed!).toBeCloseTo(closedGroove(4, 20, 2), 5);
    expect(v.cuClosed! - v.cuOpen2!).toBeCloseTo(openGroove(3, 26, 2), 5);
    expect(v.cuOpen2! - v.cuClosed2!).toBeCloseTo(closedGroove(4, 20, 2), 5);
    // the engraving is font outlines: no closed form, only that it cuts a little
    expect(v.cuClosed2! - v.cuText!).toBeGreaterThan(1);
    expect(v.cuClosed2! - v.cuText!).toBeLessThan(10);
  });

  it('the grooves follow their estimated sizes, and the bit follows its length', async () => {
    const doc = setVariables(await open(), { est_open_W: '4', est_open_L: '30', est_closed_W: '5', est_closed_L: '24', L: '200' });
    const full = measure(doc);
    expect(full.problems).toEqual([]);
    expect(full.valid).toBe(true);
    const v = Object.fromEntries(['rvBody', 'chRelief', 'cuOpen', 'cuClosed2'].map((id) => [id, measure(upTo(doc, id)).volume]));
    expect(v.rvBody).toBeCloseTo(revolved(200), 6);
    expect(v.chRelief! - v.cuOpen!).toBeCloseTo(openGroove(4, 30, 2), 5);
    expect(v.chRelief! - v.cuClosed2!).toBeCloseTo(2 * openGroove(4, 30, 2) + 2 * closedGroove(5, 24, 2), 5);
  });
});
