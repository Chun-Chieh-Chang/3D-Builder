// The worker of tests/e2e/phase3-worker-crash.js: a real kernel in a real worker, wired as the product's is, that traps when asked.
import * as Comlink from '../../../node_modules/comlink/dist/esm/comlink.js';
import occtWasm from 'libcascade/single/wasm?url';
import { isTrap, Kernel, KernelError } from '../../../packages/kernel/src/index.ts';
import { reportingCrashes } from '../../../apps/web/src/worker/crash.ts';

const load = Kernel.load({ wasmUrl: occtWasm });

Comlink.expose(reportingCrashes({
  /** BRepOffsetAPI_MakeOffset shrinking a ring of concentric whole circles (docs/design/section-clearance/regions-and-cost.md). */
  async trap() {
    const oc = (await load).oc;
    const circle = (r, reverse) => {
      const c = new oc.gp_Circ(new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1)), r);
      const w = new oc.BRepBuilderAPI_MakeWire(new oc.BRepBuilderAPI_MakeEdge(c).Edge()).Wire();
      return oc.TopoDS.Wire(reverse ? w.Reversed() : w);
    };
    const face = new oc.BRepBuilderAPI_MakeFace(new oc.gp_Pln(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1)), circle(10, false), true);
    face.Add(circle(6, true));
    const offset = new oc.BRepOffsetAPI_MakeOffset(face.Face(), oc.GeomAbs_JoinType.GeomAbs_Arc, false);
    offset.Perform(-0.5, 0);
    throw new Error('this did not trap');
  },
  async plain() {
    throw new KernelError('cannot');
  },
}, isTrap));
