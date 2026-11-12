import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
it('areas with a set precision', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const out: any = {};
  for (const [n, p] of [['A', process.env.A!], ['B', process.env.B!]] as const) {
    const id = kernel.importStep(new Uint8Array(readFileSync(p))).shape; const sh = k.get(id);
    const s1 = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(sh, s1, false, false);
    const s2 = new oc.GProp_GProps(); const err = oc.BRepGProp.SurfaceProperties(sh, s2, 1e-9, false);
    const v2 = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(sh, v2, 1e-9, false, false);
    out[n] = { areaFixed: s1.Mass(), areaEps: s2.Mass(), epsErr: err, volEps: v2.Mass(), massProps: kernel.massProps(id) };
  }
  out.relAreaFixed = (out.B.areaFixed - out.A.areaFixed) / out.A.areaFixed;
  out.relAreaEps = (out.B.areaEps - out.A.areaEps) / out.A.areaEps;
  out.relVolEps = (out.B.volEps - out.A.volEps) / out.A.volEps;
  writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
}, 900000);
