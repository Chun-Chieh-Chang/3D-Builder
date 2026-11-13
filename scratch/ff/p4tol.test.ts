// part-4: its volume; for the round-like faces their area and their edges' tolerances; what 1e-6 of the volume is in mm³; and the deviation integral
// of each face from an exact rolling ball (r from the face, supports = the two analytic neighbours), i.e. what a native exact round would differ by.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
const log = (m: string) => appendFileSync('scratch/ff/p4tol.log', m + String.fromCharCode(10));
it('p4tol', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/tmp/組合圖(R1-10226+R1-10134).STEP'));
  const id = kernel.importStep(stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part)[3]!.part!.step).shape;
  const m = kernel.massProps(id); const topo = kernel.topology(id);
  log(`volume ${m.volume.toFixed(3)} area ${m.area.toFixed(3)} -> 1e-6 of volume = ${(m.volume * 1e-6).toExponential(2)} mm3`);
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  let all = 0;
  for (const [f, s1, s2, r] of [[22, 168, 190, 0.381], [28, 179, 167, 0.381], [41, 170, 213, 0.381], [47, 201, 169, 0.381], [135, 170, 211, 0.635], [136, 203, 169, 0.635], [163, 168, 188, 0.635], [164, 181, 167, 0.635], [66, 282, 244, 1.524]] as const) {
    const tols: number[] = []; for (const ex = new oc.TopExp_Explorer(faces[f], oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) tols.push(oc.BRep_Tool.Tolerance(oc.TopoDS.Edge(ex.Current())));
    // ball deviation sampled over the face (kernel.rollingBall's measure), times the area: an upper bound of the volume an exact round moves
    const b = kernel.rollingBall(id, f, [s1, s2], 1);
    const v = (b?.deviation ?? NaN) * topo.faces[f]!.area;
    all += v;
    log(`f${f} area ${topo.faces[f]!.area.toFixed(3)} edgeTol ${Math.max(...tols).toExponential(1)} ballDev ${b?.deviation.toExponential(2)} r ${b?.radius.toFixed(4)} dev*area ${v.toExponential(2)}`);
  }
  log(`sum dev*area ${all.toExponential(2)} = ${(all / m.volume).toExponential(2)} of the volume`);
}, 600_000);
