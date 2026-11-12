import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { serializePart } from '@3db/model';
import { CadSession } from '../../apps/mcp/src/session';
import { callTool } from '../../apps/mcp/src/server';
import { stepAsPart } from '../../packages/io/src/stepPart';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';

const baseDir = process.env.STEP_DIR ?? 'D:/3DB實機確認';
const outputDir = resolve(process.env.STEP_OUT ?? 'scratch/feature-recognition/real-step-editable');
mkdirSync(outputDir, { recursive: true });

function walkStepFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...walkStepFiles(full));
    } else if (/\.(step|stp)$/i.test(entry) && (!process.env.ONLY || full.includes(process.env.ONLY))) {
      results.push(full);
    }
  }
  return results.sort();
}

interface ProbeRow {
  relPath: string;
  label: string;
  solids: number;
  faces: number;
  surfaceTypes: Record<string, number>;
  volume: number;
  status: 'rebuilt' | 'refused' | 'error';
  approximateUsed?: boolean;
  elapsedMs: number;
  features?: Record<string, number>;
  reason?: string;
  editable?: boolean;
}

async function probeTarget(kernel: Kernel, relPath: string, label: string, bytes: Uint8Array): Promise<ProbeRow> {
  const imported = kernel.importStep(bytes);
  let faces = 0;
  let solids = 0;
  const surfaceTypes: Record<string, number> = {};
  try {
    solids = kernel.solidCount(imported.shape);
    const topo = kernel.topology(imported.shape);
    faces = topo.faces.length;
    for (const f of topo.faces) {
      const st = f.surface?.type ?? 'unknown';
      surfaceTypes[st] = (surfaceTypes[st] ?? 0) + 1;
    }
  } finally {
    kernel.release(imported.shape);
  }

  const s = await CadSession.create({ root: outputDir });
  try {
    const part = await stepAsPart(bytes, relPath);
    const before = await s.load(part.doc, part.blobs);
    const original = serializePart(s.doc);
    const volume = before.mass?.volume ?? 0;

    let lastReason = '';
    let totalMs = 0;
    for (const approximate of [false, true]) {
      const t0 = performance.now();
      const response = await callTool(s, 'recognize_features', { feature: 'import1', approximate_splines: approximate });
      const elapsedMs = Math.round(performance.now() - t0);
      totalMs += elapsedMs;
      const reply = response.content[0];
      const text = reply?.type === 'text' ? reply.text : '';
      if (response.isError) {
        expect(serializePart(s.doc)).toBe(original);
        lastReason = text;
        // If refusal is not about splines/freeform surfaces, no need to retry with approximate=true
        if (!text.includes('自由曲面') && !text.includes('bspline') && !text.includes('樣條')) {
          break;
        }
        continue;
      }
      const result = JSON.parse(text);
      let editable = false;
      if (process.env.SAVE_DOC) { const { writePartFile } = await import('../../packages/io/src/partFile'); require('node:fs').writeFileSync(process.env.SAVE_DOC, await writePartFile(s.doc, s.blobs)); }
      for (const f of (process.env.SKIP_EDIT ? [] : s.doc.features)) {
        if (f.type === 'extrude' && !f.dir2 && f.dir1.type === 'blind') {
          const depth = Number(f.dir1.depth);
          if (depth > 0) {
            const changed = await s.apply(
              [{ type: 'setExtrudeDirections', featureId: f.id, first: { ...f.dir1, depth: String(depth * 1.01) }, second: null }],
              { dryRun: true },
            );
            if (!changed.error && Math.abs(changed.volumeChange) > 1e-8) {
              editable = true;
              break;
            }
          }
        }
      }
      return {
        relPath,
        label,
        solids,
        faces,
        surfaceTypes,
        volume,
        status: 'rebuilt',
        approximateUsed: approximate,
        elapsedMs: totalMs,
        features: result.recognized?.features,
        editable,
      };
    }
    return {
      relPath,
      label,
      solids,
      faces,
      surfaceTypes,
      volume,
      status: 'refused',
      elapsedMs: totalMs,
      reason: lastReason,
    };
  } catch (err) {
    return {
      relPath,
      label,
      solids,
      faces,
      surfaceTypes,
      volume: 0,
      status: 'error',
      elapsedMs: 0,
      reason: String(err),
    };
  } finally {
    s.dispose();
  }
}

it('probes all STEP files in D:/3DB實機確認', async () => {
  const kernel = await Kernel.load();
  const files = walkStepFiles(baseDir);
  const rows: ProbeRow[] = [];
  const seen = new Map<string, string>();

  for (const fullPath of files) {
    const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');
    const bytes = new Uint8Array(readFileSync(fullPath));
    const hash = createHash('sha256').update(bytes).digest('hex');
    const duplicate = seen.get(hash);
    if (duplicate) {
      console.log(`[DUPLICATE] ${relPath} = ${duplicate}`);
      continue;
    }
    seen.set(hash, relPath);
    const imported = kernel.importStep(bytes);
    let solids = 0;
    try {
      solids = kernel.solidCount(imported.shape);
    } finally {
      kernel.release(imported.shape);
    }

    if (solids === 1) {
      const row = await probeTarget(kernel, relPath, 'whole', bytes);
      rows.push(row);
      console.log(`[${row.status.toUpperCase()}] ${relPath} (${row.faces} faces) -> ${row.reason ?? JSON.stringify(row.features)}`);
    } else {
      const plan = stepAssemblyPlan(kernel, bytes);
      const parts = plan.prototypes.filter(p => p.part);
      for (const [j, p] of parts.entries()) {
        const label = `part-${j + 1}(${p.name})`;
        const row = await probeTarget(kernel, relPath, label, p.part!.step);
        rows.push(row);
        console.log(`[${row.status.toUpperCase()}] ${relPath} [${label}] (${row.faces} faces) -> ${row.reason ?? JSON.stringify(row.features)}`);
      }
    }
  }

  writeFileSync(join(outputDir, process.env.STEP_AUDIT_OUTPUT ?? 'all-steps-strict-audit.json'), JSON.stringify(rows, null, 2));
  expect(rows.length).toBeGreaterThan(0);
}, 600_000);
