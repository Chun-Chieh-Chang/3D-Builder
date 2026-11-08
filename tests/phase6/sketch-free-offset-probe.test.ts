import { expect, it } from 'vitest';
import { Arena, loadOcct } from '../../packages/kernel/src/occt';

type Point = [number, number];
const FIT_TOLERANCE = 1e-6;
const CHECKS = 512;

it('measures native planar offsets, B-spline fits and singular cases (G09 probe)', async () => {
  const oc = await loadOcct();
  const arena = new Arena();
  const own = <T extends { delete(): void }>(object: T) => arena.own(object);
  const array = (points: Point[]) => {
    const result = own(new oc.NCollection_Array1_gp_Pnt2d(1, points.length));
    points.forEach(([x, y], index) => result.SetValue(index + 1, own(new oc.gp_Pnt2d(x, y))));
    return result;
  };
  const fit = (points: Point[], parameters: number[]) => {
    const values = own(new oc.NCollection_Array1_double(1, parameters.length));
    parameters.forEach((value, index) => values.SetValue(index + 1, value));
    const fitter = own(new oc.Geom2dAPI_PointsToBSpline(array(points), values, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, FIT_TOLERANCE));
    expect(fitter.IsDone()).toBe(true);
    return own(fitter.Curve());
  };
  const bezier = (points: Point[]) => own(new oc.Geom2d_BezierCurve(array(points)));
  try {
    const waveParameters = Array.from({ length: 21 }, (_, i) => i / 20);
    const wave = fit(waveParameters.map(t => [40 * t, 3 * Math.sin(2 * Math.PI * t)]), waveParameters);
    expect(wave.NbKnots()).toBeGreaterThan(2);
    const line = bezier([[0, 0], [10, 0], [20, 0], [30, 0]]);
    const bend = bezier([[-10, 10], [0, -10], [10, 10]]);
    const cases = [
      { name: 'straight control', basis: line, distance: 2, regular: true },
      { name: 'quadratic outward', basis: bend, distance: 2, regular: true },
      { name: 'quadratic inward', basis: bend, distance: -2, regular: true },
      { name: 'quadratic cusp', basis: bend, distance: -5, regular: false },
      { name: 'quadratic loop', basis: bend, distance: -6, regular: false },
      { name: 'wave positive', basis: wave, distance: 2, regular: true },
      { name: 'wave negative', basis: wave, distance: -2, regular: true },
    ];
    const report = [];
    for (const { name, basis, distance, regular } of cases) {
      console.log('G09 measuring', name);
      const offset = own(new oc.Geom2d_OffsetCurve(basis, distance));
      const basePoint = own(new oc.gp_Pnt2d());
      const derivative = own(new oc.gp_Vec2d());
      const acceleration = own(new oc.gp_Vec2d());
      const point = own(new oc.gp_Pnt2d());
      const start = basis.FirstParameter(), end = basis.LastParameter();
      const value = (curve: typeof offset | typeof wave, t: number): Point => {
        curve.D0(t, point);
        return [point.X(), point.Y()];
      };
      const length = (curve: typeof offset | typeof wave, tolerance: number) =>
        oc.GCPnts_AbscissaPoint.Length(own(new oc.Geom2dAdaptor_Curve(curve)), tolerance);
      let normalError = 0;
      let minimumJacobian = Infinity;
      for (let i = 0; i <= CHECKS; i++) {
        const t = start + (end - start) * i / CHECKS;
        basis.D2(t, basePoint, derivative, acceleration);
        const dx = derivative.X(), dy = derivative.Y();
        const speed = Math.hypot(dx, dy);
        expect(speed).toBeGreaterThan(0);
        const curvature = (dx * acceleration.Y() - dy * acceleration.X()) / speed ** 3;
        minimumJacobian = Math.min(minimumJacobian, 1 + distance * curvature);
        const [x, y] = value(offset, t);
        normalError = Math.max(normalError, Math.hypot(x - basePoint.X() - distance * dy / speed, y - basePoint.Y() + distance * dx / speed));
      }
      expect(normalError).toBeLessThan(1e-12);
      expect(minimumJacobian > 1e-8).toBe(regular);
      const self = own(new oc.Geom2dAPI_InterCurveCurve(offset, 1e-7));
      if (name === 'quadratic loop') {
        expect(self.NbPoints()).toBeGreaterThan(0);
        // For the symmetric quadratic, the loop crosses x=0 at two distinct source parameters.
        const u = Math.sqrt((4 * distance) ** 2 - 20 ** 2) / 80;
        const a = value(offset, 0.5 - u), b = value(offset, 0.5 + u);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-12);
      }
      if (regular) expect(self.NbPoints() + self.NbSegments()).toBe(0);
      const approximations = [];
      if (regular) {
        const exactLength = length(offset, 1e-11);
        expect(Math.abs(exactLength - length(offset, 1e-9))).toBeLessThan(1e-7);
        if (name === 'straight control') expect(exactLength).toBeCloseTo(30, 10);
        for (const count of [17, 65]) {
          const parameters = Array.from({ length: count }, (_, i) => start + (end - start) * i / (count - 1));
          const spline = fit(parameters.map(t => value(offset, t)), parameters);
          let deviation = 0;
          for (let i = 0; i < CHECKS; i++) {
            const t = start + (end - start) * (i + 0.5) / CHECKS;
            const a = value(offset, t), b = value(spline, t);
            deviation = Math.max(deviation, Math.hypot(a[0] - b[0], a[1] - b[1]));
          }
          const lengthError = Math.abs(length(spline, 1e-11) - exactLength);
          expect(Number.isFinite(deviation + lengthError)).toBe(true);
          approximations.push({ count, deviation, lengthError, poles: spline.NbPoles() });
        }
      }
      report.push({ name, distance, normalError, minimumJacobian, crossings: self.NbPoints(), overlapSegments: self.NbSegments(), approximations });
    }
    console.log('G09 results', JSON.stringify(report));
  } finally {
    arena.dispose();
  }
});
