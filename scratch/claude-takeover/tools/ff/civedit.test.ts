import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { CadSession } from '../../apps/mcp/src/session';
import { readPartFile } from '../../packages/io/src/partFile';
it('civ edit', async () => {
  const s = await CadSession.create({ root: '/tmp' });
  const out: any = {};
  try {
    const f = await readPartFile(new Uint8Array(readFileSync('/tmp/civ.3dbx')));
    const t0 = performance.now();
    const r = await s.load(f.doc, f.blobs);
    out.loadMs = Math.round(performance.now() - t0);
    out.features = (r as any).features?.map((x: any) => ({ id: x.id, type: x.type, status: x.status, sketch: x.sketch ? { status: x.sketch.status, dof: x.sketch.dof } : undefined }));
    out.volume = r.mass?.volume;
    const ext = s.doc.features.filter((x: any) => x.type === 'extrude') as any[];
    out.extrudes = ext.map((e) => ({ id: e.id, dir1: e.dir1, op: e.op }));
    const last = ext[ext.length - 1];
    if (last?.dir1?.type === 'blind') {
      const t1 = performance.now();
      const ch = await s.apply([{ type: 'setExtrudeDirections', featureId: last.id, first: { ...last.dir1, depth: String(Number(last.dir1.depth) * 1.5) }, second: null } as any], { dryRun: true });
      out.edit = { ms: Math.round(performance.now() - t1), error: ch.error, volumeChange: ch.volumeChange };
    }
    const sk = s.doc.features.filter((x: any) => x.type === 'sketch') as any[];
    out.splines = sk.map((k) => k.entities.filter((e: any) => e.type === 'spline' && e.nurbs).length);
  } finally { s.dispose(); }
  writeFileSync('/tmp/civedit.json', JSON.stringify(out, null, 1));
}, 600000);
