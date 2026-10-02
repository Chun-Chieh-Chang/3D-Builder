// Phase 3b-5 spike: do inertia, exact distance, validity of sub-shapes and free edges exist in this binding?
// Run: npx vitest run --config spikes/occt-gaps/vitest.config.ts spikes/occt-gaps/phase3b-evaluate.test.ts --reporter=verbose
import { beforeAll, describe, it } from 'vitest';
import { Kernel } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const say = (...a: unknown[]) => console.log(...a);
const tryIt = (what: string, fn: () => unknown) => {
  try {
    say(what, JSON.stringify(fn()));
  } catch (e) {
    let m = String(e);
    try {
      m = (kernel.oc as any).getExceptionMessage(e).join(' / ');
    } catch {}
    say(what, 'FAILED', m);
  }
};

describe('evaluate', () => {
  it('apis', () => {
    const oc = kernel.oc as any;
    const box = (dx: number, dy: number, dz: number, x = 0) => new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(x, 0, 0), dx, dy, dz).Shape();
    const a = box(10, 20, 30);
    tryIt('inertia', () => {
      const p = new oc.GProp_GProps();
      oc.BRepGProp.VolumeProperties(a, p, false, false, false);
      const m = p.MatrixOfInertia();
      const g = p.CentreOfMass();
      return { mass: p.Mass(), g: [g.X(), g.Y(), g.Z()], I: [m.Value(1, 1), m.Value(2, 2), m.Value(3, 3), m.Value(1, 2)], expectXX: (600 * 0 + 6000 * (20 ** 2 + 30 ** 2)) / 12 };
    });
    tryIt('distance', () => {
      const b = box(5, 5, 5, 30);
      const d = new oc.BRepExtrema_DistShapeShape(a, b, new oc.Message_ProgressRange());
      return { done: d.IsDone(), value: d.Value(), n: d.NbSolution(), p1: (() => { const p = d.PointOnShape1(1); return [p.X(), p.Y(), p.Z()]; })() };
    });
    tryIt('distance3', () => {
      const b = box(5, 5, 5, 30);
      const d = new oc.BRepExtrema_DistShapeShape(a, b);
      return { done: d.IsDone(), value: d.Value() };
    });
    tryIt('analyzer sub', () => {
      const an = new oc.BRepCheck_Analyzer(a, true, false, false);
      return { valid: an.IsValid(), methods: Object.getOwnPropertyNames(Object.getPrototypeOf(an)).join(',') };
    });
    tryIt('free bounds', () => {
      const h = new oc.ShapeAnalysis_FreeBounds(a, false, true, false);
      return { closed: typeof h.GetClosedWires, open: typeof h.GetOpenWires };
    });
    tryIt('free edges', () => {
      const f = new oc.ShapeAnalysis_FreeBounds(a);
      return Object.getOwnPropertyNames(Object.getPrototypeOf(f)).join(',');
    });
    tryIt('shell check', () => {
      const e = new oc.ShapeAnalysis_Shell();
      return Object.getOwnPropertyNames(Object.getPrototypeOf(e)).join(',');
    });
    tryIt('statuses', () => Object.keys(oc.BRepCheck_Status ?? {}).slice(0, 8));
  });
});
