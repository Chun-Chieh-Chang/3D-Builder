import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import type { Verify2dReport } from '../src/verify2d';

const GOLDEN = resolve('tests/golden');

function parseReport(r: Awaited<ReturnType<typeof callTool>>): Verify2dReport {
  expect(r.isError).toBeFalsy();
  const txt = r.content.find((c) => c.type === 'text');
  if (!txt || txt.type !== 'text') throw new Error('expected text report');
  return JSON.parse(txt.text) as Verify2dReport;
}

describe('part_verify_against_2d (2D->3D projection back-verification)', () => {
  it('verifies locating-plate.3dbx width, height, hole diameters+counts, corner radii, distances, and optional PNG pictures', async () => {
    const s = await CadSession.create({ root: GOLDEN, locale: 'zh-TW' });
    try {
      await s.open('locating-plate.3dbx');
      const r = await callTool(s, 'part_verify_against_2d', {
        checks: [
          { label: 'Overall length', view: 'top', kind: 'width', nominal: 120, tolerance: 0.05 },
          { label: 'Overall width', view: 'top', kind: 'height', nominal: 80, tolerance: 0.05 },
          { label: 'Thickness', view: 'front', kind: 'height', nominal: 15, tolerance: 0.05 },
          { label: 'Corner mounting holes', view: 'top', kind: 'diameter', nominal: 9, count: 4, tolerance: 0.05 },
          { label: 'Dowel holes', view: 'top', kind: 'diameter', nominal: 8, count: 2, tolerance: 0.05 },
          { label: 'Corner fillets', view: 'top', kind: 'radius', nominal: 10, count: 4, tolerance: 0.05 },
          { label: 'Hole pitch X', view: 'top', kind: 'distance', axis: 'x', nominal: 100, tolerance: 0.05 },
          { label: 'Hole pitch Y', view: 'top', kind: 'distance', axis: 'y', nominal: 60, tolerance: 0.05 },
        ],
        pictures: true,
      });
      const report = parseReport(r);
      expect(report.pass).toBe(true);
      expect(report.passed).toBe(8);
      const faceCount = s.drawingSource()!.body.topology.faces.length;
      expect(faceCount).toBeGreaterThan(0);
      expect(report.meshIntegrity).toEqual({ totalFaces: faceCount, triangulatedFaces: faceCount, unmeshedFaces: [], pass: true });
      expect(report.failed).toBe(0);
      expect(report.maxAbsError).toBeLessThan(1e-3);
      expect(report.views.top).toEqual({ width: 120, height: 80 });
      expect(report.views.front).toEqual({ width: 120, height: 15 });
      // 2 unique views ('top', 'front') -> 2 PNG images attached
      const images = r.content.filter((c) => c.type === 'image');
      expect(images).toHaveLength(2);
    } finally {
      s.dispose();
    }
  }, 30_000);

  it('verifies v-block.3dbx 45deg V-groove angle and catches deliberate dimensional/count mismatches', async () => {
    const s = await CadSession.create({ root: GOLDEN, locale: 'zh-TW' });
    try {
      await s.open('v-block.3dbx');
      const okRes = await callTool(s, 'part_verify_against_2d', {
        checks: [
          { label: 'V-groove angle', view: 'front', kind: 'angle', nominal: 45, count: 2, tolerance: 0.1 },
        ],
      });
      const ok = parseReport(okRes);
      expect(ok.pass).toBe(true);
      expect(ok.results[0]?.measured).toBeCloseTo(45, 3);

      // Deliberately wrong nominal & wrong count must fail with exact measured deviations
      const badRes = await callTool(s, 'part_verify_against_2d', {
        checks: [
          { label: 'Wrong width', view: 'front', kind: 'width', nominal: 999, tolerance: 0.05 },
          { label: 'Wrong V count', view: 'front', kind: 'angle', nominal: 45, count: 4, tolerance: 0.1 },
        ],
      });
      const bad = parseReport(badRes);
      expect(bad.pass).toBe(false);
      expect(bad.failed).toBe(2);
      expect(bad.results[0]?.pass).toBe(false);
      expect(bad.results[0]?.reason).toContain('off by');
      expect(bad.results[1]?.pass).toBe(false);
      expect(bad.results[1]?.matchedCount).toBe(2);
      expect(bad.results[1]?.expectedCount).toBe(4);
    } finally {
      s.dispose();
    }
  }, 30_000);

  it('fails the overall report when a real face loses its triangles even though the projected dimensions pass', async () => {
    const s = await CadSession.create({ root: GOLDEN, locale: 'zh-TW' });
    try {
      await s.open('locating-plate.3dbx');
      const source = s.drawingSource();
      if (!source) throw new Error('expected the rebuilt locating plate');
      const checks = { checks: [
        { label: 'Overall length', view: 'top', kind: 'width', nominal: 120, tolerance: 0.05 },
        { label: 'Overall width', view: 'top', kind: 'height', nominal: 80, tolerance: 0.05 },
      ] };
      const intact = parseReport(await callTool(s, 'part_verify_against_2d', checks));
      expect(intact.pass).toBe(true);

      // Inject a lost face at the tessellation boundary, preserving the exact shape and projection.
      const mesh = source.kernel.mesh(source.body.shape);
      const [start, count, face] = mesh.faceRanges.slice(-3);
      if (start === undefined || count === undefined || face === undefined) throw new Error('expected a triangulated face');
      expect(count).toBeGreaterThan(0);
      expect(start + count).toBe(mesh.indices.length);
      expect(source.body.topology.faces[face]!.area).toBeGreaterThan(1e-6);

      const meshCall = vi.spyOn(source.kernel, 'mesh').mockReturnValueOnce({
        ...mesh,
        indices: mesh.indices.slice(0, start),
        faceRanges: mesh.faceRanges.slice(0, -3),
      });
      try {
        const missingFace = parseReport(await callTool(s, 'part_verify_against_2d', checks));
        expect(meshCall).toHaveBeenCalledWith(source.body.shape);
        expect(missingFace.results).toEqual(intact.results);
        expect(missingFace.failed).toBe(0);
        expect(missingFace.meshIntegrity).toEqual({
          totalFaces: intact.meshIntegrity.totalFaces,
          triangulatedFaces: intact.meshIntegrity.triangulatedFaces - 1,
          unmeshedFaces: [face],
          pass: false,
        });
        expect(missingFace.pass).toBe(false);
      } finally {
        meshCall.mockRestore();
      }
    } finally {
      s.dispose();
    }
  }, 30_000);

  it('refuses invalid inputs (non-integer count, negative nominal/tolerance, missing axis, empty part) without silent coercion', async () => {
    const s = await CadSession.create({ root: GOLDEN, locale: 'zh-TW' });
    try {
      // Empty part with no solid body must be refused
      const noBody = await callTool(s, 'part_verify_against_2d', {
        checks: [{ label: 'L', view: 'top', kind: 'width', nominal: 10 }],
      });
      expect(noBody.isError).toBe(true);

      await s.open('locating-plate.3dbx');
      const badCases = [
        { checks: [] },
        { checks: [{ label: 'L', view: 'top', kind: 'width', nominal: -5 }] },
        { checks: [{ label: 'L', view: 'top', kind: 'width', nominal: Number.NaN }] },
        { checks: [{ label: 'L', view: 'top', kind: 'width', nominal: 120, tolerance: 0 }] },
        { checks: [{ label: 'H', view: 'top', kind: 'diameter', nominal: 9, count: 1.5 }] },
        { checks: [{ label: 'D', view: 'top', kind: 'distance', nominal: 100 }] },
        { checks: [{ label: 'W', view: 'top', kind: 'width', nominal: 120, axis: 'x' }] },
        { checks: [{ label: 'A', view: 'front', kind: 'angle', nominal: 180 }] },
        { checks: [{ label: 'V', view: 'isometric', kind: 'width', nominal: 10 }] },
      ];
      for (const payload of badCases) {
        const res = await callTool(s, 'part_verify_against_2d', payload);
        expect(res.isError, JSON.stringify(payload)).toBe(true);
      }
    } finally {
      s.dispose();
    }
  }, 30_000);
});
