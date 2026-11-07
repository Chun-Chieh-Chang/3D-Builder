/**
 * A WebAssembly trap, the real one (BRepOffsetAPI_MakeOffset shrinking a ring of concentric whole circles, docs/design/section-clearance/regions-and-cost.md), on its way from the module to
 * the page: told apart from an OCCT failure, not swallowed on the way, naming the feature, and still saying what it is after Comlink has carried it across (ADR 0242). What the page then does
 * is in tests/e2e/phase3-worker-crash.js. In a file of its own: this damages its module, so nothing else may use it.
 */
import * as Comlink from 'comlink';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelCrash, KernelError, rethrowTrap } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, front, sketch } from '../phase1/builders';
import { CRASH_NAME, isWorkerCrash, reportingCrashes } from '../../apps/web/src/worker/crash';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterEach(() => vi.restoreAllMocks());

/** Traps, for real. */
function trap(): never {
  const oc = kernel.oc as never as Record<string, any>;
  const circle = (r: number, reverse: boolean) => {
    const c = new oc.gp_Circ(new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1)), r);
    const w = new oc.BRepBuilderAPI_MakeWire(new oc.BRepBuilderAPI_MakeEdge(c).Edge()).Wire();
    return oc.TopoDS.Wire(reverse ? w.Reversed() : w);
  };
  const face = new oc.BRepBuilderAPI_MakeFace(new oc.gp_Pln(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1)), circle(10, false), true);
  face.Add(circle(6, true));
  const offset = new oc.BRepOffsetAPI_MakeOffset(face.Face(), oc.GeomAbs_JoinType.GeomAbs_Arc, false);
  offset.Perform(-0.5, 0);
  throw new Error('this did not trap: everything below would be testing nothing');
}

/** A disc extruded: one sketch, one feature, named. */
const part = () => {
  const doc = build(sketch('s1', front, circle('c', 0, 0, 5)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }));
  return { ...doc, features: doc.features.map((f) => (f.id === 'e1' ? { ...f, name: '伸長九' } : f)) };
};

describe('a trap is told apart', () => {
  it('the real one is one, and an OCCT failure is not', () => {
    let caught: unknown;
    try {
      trap();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WebAssembly.RuntimeError);
    expect(isTrap(caught)).toBe(true);
    expect(isTrap(new KernelError('x'))).toBe(false);
    expect(isTrap(new Error('x'))).toBe(false);
    expect(isTrap(new RangeError('Invalid array length'))).toBe(false);
    expect(isTrap(new KernelCrash('x'))).toBe(true);
    // the real thing again: a stack overrun is one too
    const deep = (n: number): number => deep(n + 1) + 1;
    let overrun: unknown;
    try {
      deep(0);
    } catch (e) {
      overrun = e;
    }
    expect(overrun).toBeInstanceOf(RangeError);
    expect(isTrap(overrun)).toBe(true);
  });

  it('rethrowTrap passes the trap on and nothing else', () => {
    expect(() => rethrowTrap(new KernelError('x'))).not.toThrow();
    expect(() => {
      try {
        trap();
      } catch (e) {
        rethrowTrap(e);
      }
    }).toThrow(WebAssembly.RuntimeError);
  });
});

describe('on its way out', () => {
  it('the kernel does not make it into a KernelError', () => {
    const inner = kernel as never as { build(mk: unknown, label: string, arena: unknown): unknown };
    // the wrapper all the operations go through: what it did before was turn this into "the operation failed"
    const mk = { Build: () => trap(), IsDone: () => false, Shape: () => null };
    expect(() => inner.build(mk, 'x', { own: <T,>(o: T) => o })).toThrow(WebAssembly.RuntimeError);
  });

  it('where a trap is the usual answer it is still that answer, counted so that the module is left behind', () => {
    // the real one: the converter on a shape it is known to trap on is tested in tests/phase4b; here that the refusal counts and an OCCT failure does not
    const inner = kernel as never as { refusalWords(e: unknown): string };
    const before = kernel.trapsAbsorbed;
    expect(inner.refusalWords(new KernelError('cannot'))).toBe('cannot');
    expect(kernel.trapsAbsorbed).toBe(before);
    let caught: unknown;
    try {
      trap();
    } catch (e) {
      caught = e;
    }
    expect(inner.refusalWords(caught)).toContain('function signature mismatch');
    expect(kernel.trapsAbsorbed).toBe(before + 1);
  });

  it('the rebuild stops and names the feature, where an ordinary failure only marks it', () => {
    const regen = new Regenerator(kernel, solver, new Map());
    const doc = part();
    // the control: this part builds, and an OCCT failure in it marks the feature and goes on
    expect(regen.rebuild(doc).features.every((f) => f.status === 'ok')).toBe(true);
    const spy = vi.spyOn(kernel, 'extrude').mockImplementation(() => {
      throw new KernelError('cannot');
    });
    const failed = regen.rebuild(doc);
    expect(spy).toHaveBeenCalled();
    expect(failed.features.find((f) => f.id === 'e1')).toMatchObject({ status: 'error', message: 'cannot' });
    spy.mockImplementation(() => trap());
    let crash: unknown;
    try {
      regen.rebuild(doc);
    } catch (e) {
      crash = e;
    }
    expect(crash).toBeInstanceOf(KernelCrash);
    expect((crash as Error).message).toContain('伸長九');
    expect((crash as Error).message).toContain('function signature mismatch');
  });

  it('across Comlink it is still a crash, and an ordinary failure is still not', async () => {
    expect(new KernelCrash('x').name).toBe(CRASH_NAME);
    const api = {
      mesh: async () => trap(),
      plain: async () => {
        throw new KernelError('cannot');
      },
      rebuild: async () => {
        throw new KernelCrash('in the feature');
      },
      fine: async () => 7,
    };
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(reportingCrashes(api, isTrap), port1 as never);
    const remote = Comlink.wrap<typeof api>(port2 as never);
    try {
      const failure = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
      expect(await remote.fine()).toBe(7);
      const trapped = await failure(remote.mesh());
      expect(isWorkerCrash(trapped)).toBe(true);
      expect((trapped as Error).message).toContain('function signature mismatch');
      const named = await failure(remote.rebuild());
      expect(isWorkerCrash(named)).toBe(true);
      expect((named as Error).message).toBe('in the feature');
      const plain = await failure(remote.plain());
      expect(isWorkerCrash(plain)).toBe(false);
      expect((plain as Error).message).toBe('cannot');
    } finally {
      port1.close();
      port2.close();
    }
  });
});
