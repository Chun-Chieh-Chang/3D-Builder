import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
it('area by surface type', async () => {
  const kernel = await Kernel.load();
  const out: any = {};
  for (const [n, p] of [['A', process.env.A!], ['B', process.env.B!]] as const) {
    const s = kernel.importStep(new Uint8Array(readFileSync(p))).shape;
    const t = kernel.topology(s); const by: Record<string, [number, number]> = {};
    for (const f of t.faces) { const k = f.surface === 'bsplinesurface' || f.surface === 'surfaceofextrusion' ? 'wall' : f.surface; by[k] = [(by[k]?.[0] ?? 0) + 1, (by[k]?.[1] ?? 0) + f.area]; }
    out[n] = by;
    // planes grouped by normal and height
    const planes: Record<string, [number, number]> = {};
    for (const f of t.faces) if (f.geometry?.type === 'plane') { const g = f.geometry; const key = `${g.normal.map((x) => x.toFixed(3)).join(',')}@${(g.normal[0] * g.origin[0] + g.normal[1] * g.origin[1] + g.normal[2] * g.origin[2]).toFixed(4)}`; planes[key] = [(planes[key]?.[0] ?? 0) + 1, (planes[key]?.[1] ?? 0) + f.area]; }
    out[n + 'planes'] = planes;
  }
  writeFileSync(process.env.OUT!, JSON.stringify(out));
}, 600000);
