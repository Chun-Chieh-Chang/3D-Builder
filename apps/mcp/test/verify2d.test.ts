import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { openMeshEdges, type Verify2dReport } from '../src/verify2d';

const GOLDEN = resolve('tests/golden');

function parseReport(r: Awaited<ReturnType<typeof callTool>>): Verify2dReport {
  expect(r.isError).toBeFalsy();
  const txt = r.content.find((c) => c.type === 'text');
  if (!txt || txt.type !== 'text') throw new Error('expected text report');
  return JSON.parse(txt.text) as Verify2dReport;
}

describe('openMeshEdges: the edges one triangle alone uses, vertices welded by position', () => {
  // a tetrahedron, its corners repeated per face as a mesher writes them (welded, they are 4)
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const faces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]];
  const mesh = (fs: number[][]) => ({ positions: fs.flatMap((f) => f.flatMap((k) => corners[k]!)), indices: fs.flatMap((_, i) => [3 * i, 3 * i + 1, 3 * i + 2]) });
  it('a closed surface has none; one triangle taken away leaves its three sides open', () => {
    expect(openMeshEdges(mesh(faces))).toBe(0);
    expect(openMeshEdges(mesh(faces.slice(1)))).toBe(3);
  });
  it('a triangle squeezed to a line (a pole, an apex) opens nothing: its two welded corners make no side', () => {
    expect(openMeshEdges(mesh([...faces, [0, 0, 1]]))).toBe(0);
  });
  it('corners off by less than 1e-4 mm are one vertex; farther apart they are two (a crack)', () => {
    const near = mesh(faces);
    near.positions[0] = 4e-5;
    expect(openMeshEdges(near)).toBe(0);
    const far = mesh(faces);
    far.positions[0] = 1e-3;
    expect(openMeshEdges(far)).toBeGreaterThan(0);
  });
});

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
      expect(report.meshIntegrity).toEqual({ totalFaces: faceCount, triangulatedFaces: faceCount, unmeshedFaces: [], openEdges: 0, pass: true });
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
        expect(missingFace.meshIntegrity).toMatchObject({
          totalFaces: intact.meshIntegrity.totalFaces,
          triangulatedFaces: intact.meshIntegrity.triangulatedFaces - 1,
          unmeshedFaces: [face],
          pass: false,
        });
        // the face that lost its triangles leaves its boundary open on the faces around it
        expect(intact.meshIntegrity.openEdges).toBe(0);
        expect(missingFace.meshIntegrity.openEdges).toBeGreaterThan(0);
        expect(missingFace.pass).toBe(false);
      } finally {
        meshCall.mockRestore();
      }
    } finally {
      s.dispose();
    }
  }, 30_000);

  it('fails a part whose faces all have triangles but one is torn: ADR 0214\'s fillet, its open edges, the dimensions right', async () => {
    // The user's part of ADR 0214 (tests/fixtures/fillet-chamfer-equals-wall.3dbx). Its fillet is refused today for its 18 mm tolerance, so the torn
    // fillet is made as OCCT makes it with that gate let through (the tolerance read as 0): every face triangulated, the fillet face torn along its edge.
    const s = await CadSession.create({ root: resolve('tests/fixtures'), locale: 'zh-TW' });
    const kernel = (s as unknown as { kernel: { maxTolerance(...a: unknown[]): number } }).kernel;
    const gate = vi.spyOn(kernel, 'maxTolerance').mockReturnValue(0);
    try {
      await s.open('fillet-chamfer-equals-wall.3dbx');
      const r = await callTool(s, 'part_verify_against_2d', { checks: [{ label: 'Diameter (sketch1: Ø20, seen along its axis)', view: 'front', kind: 'diameter', nominal: 20, tolerance: 0.05 }] });
      const report = parseReport(r);
      expect(gate).toHaveBeenCalled();
      expect(report.results.every((x) => x.pass), JSON.stringify(report.results)).toBe(true);
      expect(report.meshIntegrity.unmeshedFaces).toEqual([]);
      expect(report.meshIntegrity.triangulatedFaces).toBe(report.meshIntegrity.totalFaces);
      // how many depends on how the mesh is cut (ADR 0214: 22 to 48 over the mesh parameters; 23 here, 24 in spikes/mesh-open-edges): there are some
      expect(report.meshIntegrity.openEdges).toBeGreaterThan(0);
      expect(report.meshIntegrity.pass).toBe(false);
      expect(report.pass).toBe(false);
    } finally {
      gate.mockRestore();
      s.dispose();
    }
  }, 60_000);

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
