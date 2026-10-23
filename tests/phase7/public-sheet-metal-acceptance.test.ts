/**
 * Automated acceptance probe for the publicly sourced sheet-metal STEP samples.
 * This records importer ground truth and STEP round-trip facts. It does not claim
 * equivalence with SolidWorks; that requires an independently measured baseline.
 * Set SHEET_METAL_ACCEPTANCE_REPORT to an absolute path to write the JSON report.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';

const fixtureDir = new URL('../fixtures/public-cad/osf-sheet-press/', import.meta.url);
const samples = [
  { file: 'upper-sheet-metal-enclosure.step', role: 'folded enclosure', sha256: 'd4867334b5c179ced4129a0333d6c333cf5bfcbd845f994de609c31c2ce9c972' },
  { file: 'upper-sheet-metal-enclosure-flat-pattern.step', role: 'reference flat pattern', sha256: 'e0655d6c1b35e4921cd296b732957bb0e982b8cd562b32883a4a071bfa93db68' },
] as const;

let kernel: Kernel;
const importedVolumes = new Map<string, number>();
const report: {
  scope: string;
  samples: Array<Record<string, unknown>>;
} = {
  scope: 'STEP import and same-kernel round-trip facts; not a SolidWorks equivalence claim',
  samples: [],
};

beforeAll(async () => { kernel = await Kernel.load(); });
afterAll(() => {
  if (process.env.SHEET_METAL_ACCEPTANCE_REPORT) {
    const path = process.env.SHEET_METAL_ACCEPTANCE_REPORT;
    if (!/^(?:[A-Za-z]:\\|\\\\|\/)/.test(path)) throw new Error('SHEET_METAL_ACCEPTANCE_REPORT must be an absolute path');
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
});

describe('public sheet-metal STEP acceptance probe', () => {
  for (const sample of samples) {
    it(`${sample.role}: imports as valid geometry and survives a STEP round trip`, () => {
      const source = readFileSync(new URL(sample.file, fixtureDir));
      expect(createHash('sha256').update(source).digest('hex')).toBe(sample.sha256);
      const imported = kernel.importStep(source);
      try {
        const facts = kernel.massProps(imported.shape);
        const topology = kernel.topology(imported.shape);
        const exported = kernel.exportStep(imported.shape, sample.file.replace(/\.step$/i, ' acceptance probe'));
        const roundTrip = kernel.importStep(exported);
        try {
          const roundFacts = kernel.massProps(roundTrip.shape);
          const record = {
            file: sample.file,
            role: sample.role,
            sha256: createHash('sha256').update(source).digest('hex'),
            inputBytes: source.byteLength,
            import: imported.diagnostics,
            warnings: imported.warnings,
            topology: { solids: imported.diagnostics.solids, faces: topology.faces.length, edges: topology.edges.length, vertices: topology.vertices.length },
            massProperties: { volumeMm3: facts.volume, areaMm2: facts.area, centerMm: facts.center },
            roundTrip: {
              volumeRelativeError: Math.abs(roundFacts.volume - facts.volume) / facts.volume,
              areaRelativeError: Math.abs(roundFacts.area - facts.area) / facts.area,
              valid: roundTrip.diagnostics.validAfter,
              solids: roundTrip.diagnostics.solids,
            },
          };
          expect(imported.diagnostics.validAfter).toBe(true);
          expect(imported.diagnostics.solids).toBeGreaterThan(0);
          expect(facts.volume).toBeGreaterThan(0);
          expect(topology.faces.length).toBeGreaterThan(0);
          expect(roundTrip.diagnostics.validAfter).toBe(true);
          expect(roundFacts.volume).toBeCloseTo(facts.volume, 5);
          expect(roundFacts.area).toBeCloseTo(facts.area, 5);
          importedVolumes.set(sample.file, facts.volume);
          report.samples.push(record);
        } finally {
          kernel.release(roundTrip.shape);
        }
      } finally {
        kernel.release(imported.shape);
      }
    });
  }

  it('the independently exported folded and flat reference files preserve the same material volume', () => {
    const folded = importedVolumes.get('upper-sheet-metal-enclosure.step');
    const flat = importedVolumes.get('upper-sheet-metal-enclosure-flat-pattern.step');
    expect(folded).toBeGreaterThan(0);
    expect(flat).toBeGreaterThan(0);
    expect(flat).toBeCloseTo(folded!, 6);
  });
});
