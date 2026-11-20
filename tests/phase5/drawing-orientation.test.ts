import { describe, expect, it } from 'vitest';
import {
  VIEW_ORIENTATION_PRESETS,
  applyDrawingCommand,
  axesOf,
  axesToOrientation,
  createEmptyDrawing,
  orientationAxes,
  parseDrawing,
  serializeDrawing,
  viewVectors,
} from '@3db/model';

describe('custom 3D view orientation (方案 A)', () => {
  it('orientationAxes matches standard isometric and round-trips through axesToOrientation', () => {
    const isoDeg = (Math.asin(1 / Math.sqrt(3)) * 180) / Math.PI;
    const ax = orientationAxes({ azimuth: 45, elevation: isoDeg, roll: 0 });
    const std = viewVectors('isometric');
    const norm = Math.hypot(...std.dir);
    expect(ax.dir[0]).toBeCloseTo(std.dir[0] / norm, 9);
    expect(ax.dir[1]).toBeCloseTo(std.dir[1] / norm, 9);
    expect(ax.dir[2]).toBeCloseTo(std.dir[2] / norm, 9);

    const cases = [
      { azimuth: 45, elevation: 35.3, roll: 0 },
      { azimuth: -120, elevation: 25, roll: 15 },
      { azimuth: 165, elevation: -30, roll: -45 },
      VIEW_ORIENTATION_PRESETS.dimetric,
      VIEW_ORIENTATION_PRESETS.trimetric,
    ];
    for (const c of cases) {
      const back = axesToOrientation(orientationAxes(c));
      expect(back.azimuth).toBeCloseTo(c.azimuth, 0);
      expect(back.elevation).toBeCloseTo(c.elevation, 0);
      expect(back.roll ?? 0).toBeCloseTo(c.roll ?? 0, 0);
    }
  });

  it('applies custom orientation to both ModelDrawingView and corner ProjectedDrawingView, serializes and resets', () => {
    let doc = createEmptyDrawing('ISO');
    doc = applyDrawingCommand(doc, {
      type: 'insertViews',
      views: [
        { id: 'v_front', name: '前視', source: 'part.3dbx', direction: 'front' },
        { id: 'v_iso_model', name: '等角', source: 'part.3dbx', direction: 'isometric' },
        { id: 'v_iso_proj', kind: 'projected', name: '等角投影', parent: 'v_front', side: 'upRight', at: [300, 180] },
      ],
    });

    const custom = { azimuth: -60, elevation: 22.5, roll: 12 };
    doc = applyDrawingCommand(doc, { type: 'setView', viewId: 'v_iso_model', patch: { orientation: custom } });
    doc = applyDrawingCommand(doc, { type: 'setView', viewId: 'v_iso_proj', patch: { orientation: VIEW_ORIENTATION_PRESETS.trimetric } });

    const pg = doc.pages[0]!;
    const expectedCustom = orientationAxes(custom);
    const gotModel = axesOf(pg.views, pg.sheet.projection, pg.views[1]!)!;
    expect(gotModel.dir[0]).toBeCloseTo(expectedCustom.dir[0], 9);
    expect(gotModel.dir[1]).toBeCloseTo(expectedCustom.dir[1], 9);
    expect(gotModel.dir[2]).toBeCloseTo(expectedCustom.dir[2], 9);
    expect(gotModel.up[0]).toBeCloseTo(expectedCustom.up[0], 9);

    const expectedTri = orientationAxes(VIEW_ORIENTATION_PRESETS.trimetric);
    const gotProj = axesOf(pg.views, pg.sheet.projection, pg.views[2]!)!;
    expect(gotProj.dir[0]).toBeCloseTo(expectedTri.dir[0], 9);
    expect(gotProj.dir[1]).toBeCloseTo(expectedTri.dir[1], 9);
    expect(gotProj.dir[2]).toBeCloseTo(expectedTri.dir[2], 9);

    // Serialize / parse round-trip
    const parsed = parseDrawing(serializeDrawing(doc));
    const parsedProj = parsed.pages[0]!.views.find((v) => v.id === 'v_iso_proj');
    expect(parsedProj && parsedProj.kind === 'projected' ? parsedProj.orientation : null).toEqual(VIEW_ORIENTATION_PRESETS.trimetric);

    // Reset with null restores default corner isometric
    const reset = applyDrawingCommand(doc, { type: 'setView', viewId: 'v_iso_proj', patch: { orientation: null } });
    const resetProj = reset.pages[0]!.views.find((v) => v.id === 'v_iso_proj')!;
    const stdIso = viewVectors('isometric');
    const resetAxes = axesOf(reset.pages[0]!.views, reset.pages[0]!.sheet.projection, resetProj)!;
    const n = Math.hypot(...stdIso.dir);
    expect(resetAxes.dir[0]).toBeCloseTo(stdIso.dir[0] / n, 6);
    expect(resetAxes.dir[1]).toBeCloseTo(stdIso.dir[1] / n, 6);
    expect(resetAxes.dir[2]).toBeCloseTo(stdIso.dir[2] / n, 6);
  });

  it('rejects invalid angles and rejects orientation on disallowed view kinds', () => {
    let doc = createEmptyDrawing('ISO');
    doc = applyDrawingCommand(doc, {
      type: 'insertViews',
      views: [
        { id: 'v_front', name: '前視', source: 'part.3dbx', direction: 'front' },
        { id: 'v_flat', name: '展開', source: 'part.3dbx', direction: 'flat' },
        { id: 'v_right', kind: 'projected', name: '右視', parent: 'v_front', side: 'right' },
        { id: 'v_detail', kind: 'detail', name: '局部 B', parent: 'v_front', centre: [0, 0], radius: 5, label: 'B' },
      ],
    });

    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v_front', patch: { orientation: { azimuth: Number.NaN, elevation: 30 } } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v_front', patch: { orientation: { azimuth: 45, elevation: 90 } } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v_front', patch: { orientation: { azimuth: 45, elevation: -90 } } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v_front', patch: { orientation: { azimuth: 45, elevation: 30, roll: Number.POSITIVE_INFINITY } } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v_flat', patch: { orientation: { azimuth: 45, elevation: 30 } } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v_right', patch: { orientation: { azimuth: 45, elevation: 30 } } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v_detail', patch: { orientation: { azimuth: 45, elevation: 30 } } })).toThrow();
  });
});
