/**
 * Measuring as eDrawings shows it: lengths in millimetres, in decimal inches, in fractions of an inch; angles in degrees and radians; what two elements are to each other
 * (parallel, square, at an angle; the total length along the axes); and for round elements the distance from centre to centre and the farthest. Worked out by hand.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MEASURE_OPTIONS, between, components, edgeElement, faceElement, formatAngle, formatLength, measureReport, roundReport, toInches, viewMeasure, type MeasureElement, type MeasureRound } from '@3db/model';

describe('lengths', () => {
  it('millimetres: as many decimals as asked, none that are zero', () => {
    expect(formatLength(43, { unit: 'mm' })).toBe('43mm');
    expect(formatLength(43.104, { unit: 'mm' })).toBe('43.104mm');
    expect(formatLength(43.10449, { unit: 'mm', places: 2 })).toBe('43.1mm');
    expect(formatLength(-0.0001, { unit: 'mm' })).toBe('0mm');
  });

  it('inches: 25.4 mm to the inch, four decimals', () => {
    expect(toInches(25.4)).toBe(1);
    expect(formatLength(25.4, { unit: 'in' })).toBe('1in');
    expect(formatLength(43.104, { unit: 'in' })).toBe('1.697in');
    expect(formatLength(43.104, { unit: 'in', places: 2 })).toBe('1.7in');
  });

  it('fractions of an inch: reduced; a number that is one is written as one, any other as a decimal, unless the nearest is asked for', () => {
    expect(formatLength(42.8625, { unit: 'in', fraction: true })).toBe('1 11/16in'); // 1.6875
    expect(formatLength(12.7, { unit: 'in', fraction: true })).toBe('1/2in');
    expect(formatLength(76.2, { unit: 'in', fraction: true })).toBe('3in');
    expect(formatLength(0, { unit: 'in', fraction: true })).toBe('0in');
    expect(formatLength(38.1, { unit: 'in', fraction: true, denominator: 2 })).toBe('1 1/2in');
    expect(formatLength(-12.7, { unit: 'in', fraction: true })).toBe('-1/2in');
    expect(formatLength(43.104, { unit: 'in', fraction: true })).toBe('1.697in'); // 1.69701 is not a sixteenth
    expect(formatLength(43.104, { unit: 'in', fraction: true, nearest: true })).toBe('1 11/16in');
    expect(formatLength(43.104, { unit: 'in', fraction: true, nearest: true, denominator: 4 })).toBe('1 3/4in');
  });

  it('angles: degrees or radians', () => {
    expect(formatAngle(90, 'deg')).toBe('90°');
    expect(formatAngle(45.12345, 'deg')).toBe('45.123°');
    expect(formatAngle(180, 'rad')).toBe('3.1416rad');
  });
});

describe('two elements', () => {
  const point = (x: number, y: number, z: number, direction: [number, number, number] | null): MeasureElement => ({ kind: 'edge', type: 'line', point: [x, y, z], area: null, length: 10, radius: null, direction, round: null });

  it('the total length is the distances along the axes one after the other: dX 43, dZ 3 is 46, though the distance is 43.104', () => {
    const r = measureReport([point(0, 0, 0, [1, 0, 0]), point(43, 0, 3, [1, 0, 0])], { distance: 43.104, pointA: [0, 0, 0], pointB: [43, 0, 3] });
    expect(r.total).toBe(46);
    expect(r.distance?.delta).toEqual([43, 0, 3]);
    expect(r.relation).toBe('parallel');
  });

  it('parallel, square or at an angle (the acute one, whichever way each points)', () => {
    const rel = (a: [number, number, number], b: [number, number, number]) => measureReport([point(0, 0, 0, a), point(1, 0, 0, b)], null).relation;
    expect(rel([1, 0, 0], [-1, 0, 0])).toBe('parallel');
    expect(rel([1, 0, 0], [0, 1, 0])).toBe('perpendicular');
    expect(rel([1, 0, 0], [1, 1, 0])).toBe('angle');
    expect(measureReport([point(0, 0, 0, null), point(1, 0, 0, [1, 0, 0])], null).relation).toBeNull();
  });

  it('no distance: no total', () => {
    expect(measureReport([point(0, 0, 0, null), point(1, 0, 0, null)], null).total).toBeNull();
  });
});

describe('round elements', () => {
  const circle = (centre: [number, number, number], radius: number, axis: [number, number, number] = [0, 0, 1]): MeasureRound => ({ type: 'circle', centre, axis, radius });
  const cylinder = (centre: [number, number, number], radius: number, axis: [number, number, number] = [0, 0, 1]): MeasureRound => ({ type: 'cylinder', centre, axis, radius });
  const sphere = (centre: [number, number, number], radius: number): MeasureRound => ({ type: 'sphere', centre, axis: null, radius });

  it('two circles in one plane: 30 between the centres, 38 farthest (5 + 30 + 3), the points on the circles', () => {
    const r = roundReport(circle([0, 0, 0], 5), circle([30, 0, 0], 3));
    expect(r.centre.value).toBe(30);
    expect(r.max?.value).toBeCloseTo(38, 9);
    expect(r.max?.a).toEqual([-5, 0, 0]);
    expect(r.max?.b).toEqual([33, 0, 0]);
    expect(r.max?.delta).toEqual([38, 0, 0]);
  });

  it('two circles in planes 40 apart and 30 across: 50 between the centres, √(38² + 40²) farthest', () => {
    const r = roundReport(circle([0, 0, 0], 5), circle([30, 0, 40], 3));
    expect(r.centre.value).toBeCloseTo(50, 9);
    expect(r.max?.value).toBeCloseTo(Math.sqrt(38 * 38 + 40 * 40), 9);
  });

  it('two cylinders with their axes alike: 50 between the axes (30, 40), 60 farthest across them (50 + 4 + 6); the axes at different heights do not count', () => {
    const r = roundReport(cylinder([0, 0, 0], 4), cylinder([30, 40, 100], 6));
    expect(r.centre.value).toBeCloseTo(50, 9);
    expect(r.max?.value).toBeCloseTo(60, 9);
  });

  it('a circle and a cylinder: from the centre of the circle to the axis, across it', () => {
    const r = roundReport(circle([10, 0, 7], 2), cylinder([0, 0, 0], 5));
    expect(r.centre.value).toBeCloseTo(10, 9);
    expect(r.centre.b).toEqual([0, 0, 7]); // the point of the axis nearest the centre of the circle
    expect(r.max?.value).toBeCloseTo(17, 9);
  });

  it('two spheres: along the line of the centres, 20 apart and 5 and 5: 30 farthest', () => {
    const r = roundReport(sphere([0, 0, 0], 5), sphere([20, 0, 0], 5));
    expect(r.centre.value).toBe(20);
    expect(r.max?.value).toBeCloseTo(30, 9);
  });

  it('axes that do not run alike: the centres are measured, the farthest is not defined', () => {
    const r = roundReport(circle([0, 0, 0], 5, [0, 0, 1]), circle([30, 0, 0], 3, [1, 0, 0]));
    expect(r.centre.value).toBe(30);
    expect(r.max).toBeNull();
  });

  it('two lines that cross: the nearest points are where they cross', () => {
    const r = roundReport(cylinder([0, 0, 5], 1, [1, 0, 0]), cylinder([3, -4, 0], 1, [0, 1, 0]));
    expect(r.centre.value).toBeCloseTo(5, 9);
    expect(r.centre.a[0]).toBeCloseTo(3, 9);
    expect(r.centre.b[1]).toBeCloseTo(0, 9);
    expect(r.max).toBeNull();
  });

  it('a pair that is not round has none', () => {
    const e: MeasureElement = { kind: 'vertex', type: 'point', point: [0, 0, 0], area: null, length: null, radius: null, direction: null, round: null };
    expect(measureReport([e, e], null).round).toBeNull();
  });

  it('the kernel\'s facts make round elements: a circle edge with its centre and normal, a cylinder face with a point of its axis, a sphere', () => {
    const edge = edgeElement({ curve: 'circle', length: 31.4, mid: [5, 0, 0], dir: null, geometry: { type: 'circle', center: [0, 0, 2], normal: [0, 0, 1], radius: 5 } });
    expect(edge.round).toEqual({ type: 'circle', centre: [0, 0, 2], axis: [0, 0, 1], radius: 5 });
    const face = faceElement({ surface: 'cylinder', area: 100, center: [0, 0, 5], normal: null, geometry: { type: 'cylinder', origin: [1, 2, 0], axis: [0, 0, 1], radius: 3 } });
    expect(face.round).toEqual({ type: 'cylinder', centre: [1, 2, 0], axis: [0, 0, 1], radius: 3 });
    const ball = faceElement({ surface: 'sphere', area: 100, center: [0, 0, 0], normal: null, geometry: { type: 'sphere', center: [4, 5, 6], radius: 2 } });
    expect(ball.round).toEqual({ type: 'sphere', centre: [4, 5, 6], axis: null, radius: 2 });
    expect(faceElement({ surface: 'plane', area: 1, center: [0, 0, 0], normal: [0, 0, 1], geometry: { type: 'plane', normal: [0, 0, 1] } }).round).toBeNull();
  });

  it('between: the distance with the points and the differences', () => {
    expect(between([0, 0, 0], [3, 4, 0])).toEqual({ value: 5, a: [0, 0, 0], b: [3, 4, 0], delta: [3, 4, 0] });
  });
});

describe('what is drawn and written (the numbers of the eDrawings picture: dX 43, dZ 3, the distance 43.104, the total 46)', () => {
  const line = (x: number): MeasureElement => ({ kind: 'edge', type: 'line', point: [x, 0, 0], area: null, length: 10, radius: null, direction: [0, 1, 0], round: null });
  const report = measureReport([line(0), line(43)], { distance: 43.104, pointA: [0, 0, 0], pointB: [43, 0, 3] });

  it('the result says it in words: parallel, the distance, the differences along the axes, the total length', () => {
    const v = viewMeasure(report, DEFAULT_MEASURE_OPTIONS);
    expect(v.text).toEqual(['所選的兩個項次相互平行。', '距離: 43.104mm', '  Delta X: 43mm', '  Delta Y: 0mm', '  Delta Z: 3mm', '總長度: 46mm']);
    expect(v.modes).toEqual(['min']);
    expect(v.mode).toBe('min');
  });

  it('the drawing: the straight line in black with the distance on it, then the legs along x and z in their colours (y is nothing: not drawn), a dot at both ends', () => {
    const d = viewMeasure(report, DEFAULT_MEASURE_OPTIONS).drawing!;
    expect(d.points).toEqual([[0, 0, 0], [43, 0, 3]]);
    expect(d.lines).toEqual([
      { a: [0, 0, 0], b: [43, 0, 3], color: 0x111111 },
      { a: [0, 0, 0], b: [43, 0, 0], color: 0xe03131 },
      { a: [43, 0, 0], b: [43, 0, 3], color: 0x1c4eca },
    ]);
    expect(d.labels).toEqual([
      { key: 'distance', at: [21.5, 0, 1.5], name: '距離:', value: '43.104mm', color: '#111111', offset: [0, 16] },
      { key: 'dx', at: [21.5, 0, 0], name: 'dX:', value: '43mm', color: '#e03131', offset: [0, -10] },
      { key: 'dz', at: [43, 0, 1.5], name: 'dZ:', value: '3mm', color: '#1c4eca', offset: [0, -10] },
    ]);
  });

  it('in inches, decimal or fractions (the nearest asked for), in radians', () => {
    expect(viewMeasure(report, { ...DEFAULT_MEASURE_OPTIONS, unit: 'in' }).text.slice(1, 3)).toEqual(['距離: 1.697in', '  Delta X: 1.6929in']);
    const nearest = viewMeasure(report, { ...DEFAULT_MEASURE_OPTIONS, unit: 'in', fraction: true, nearest: true });
    expect(nearest.text[1]).toBe('距離: 1 11/16in');
    expect(nearest.drawing?.labels[1]?.value).toBe('1 11/16in');
    const skew = measureReport([line(0), { ...line(43), direction: [1, 1, 0] }], { distance: 5, pointA: [0, 0, 0], pointB: [3, 4, 0] });
    expect(viewMeasure(skew, { ...DEFAULT_MEASURE_OPTIONS, angle: 'rad' }).text[0]).toBe('所選的兩個項次夾角：0.7854rad');
    expect(viewMeasure(skew, DEFAULT_MEASURE_OPTIONS).text[0]).toBe('所選的兩個項次夾角：45°');
  });

  it('two round elements are measured three ways, from centre to centre first; the one asked for is the one drawn; the farthest is not offered where it is not defined', () => {
    const circle = (x: number, r: number, axis: [number, number, number] = [0, 0, 1]): MeasureElement => ({ kind: 'edge', type: 'circle', point: [x, 0, 0], area: null, length: 31, radius: r, direction: axis, round: { type: 'circle', centre: [x, 0, 0], axis, radius: r } });
    const r = measureReport([circle(0, 5), circle(30, 3)], { distance: 22, pointA: [5, 0, 0], pointB: [27, 0, 0] });
    const centre = viewMeasure(r, DEFAULT_MEASURE_OPTIONS);
    expect(centre.modes).toEqual(['centre', 'min', 'max']);
    expect(centre.distance?.value).toBe(30);
    expect(viewMeasure(r, { ...DEFAULT_MEASURE_OPTIONS, round: 'min' }).distance?.value).toBe(22);
    expect(viewMeasure(r, { ...DEFAULT_MEASURE_OPTIONS, round: 'max' }).distance?.value).toBeCloseTo(38, 9);
    const crossed = measureReport([circle(0, 5), circle(30, 3, [1, 0, 0])], { distance: 22, pointA: [5, 0, 0], pointB: [27, 0, 0] });
    const v = viewMeasure(crossed, { ...DEFAULT_MEASURE_OPTIONS, round: 'max' });
    expect(v.modes).toEqual(['centre', 'min']);
    expect(v.mode).toBe('centre'); // what was asked for is not there: the first that is
  });

  it('nothing to say of one element, or of a pair the kernel found no distance for', () => {
    expect(viewMeasure(null, DEFAULT_MEASURE_OPTIONS).drawing).toBeNull();
    expect(viewMeasure(measureReport([line(0)], null), DEFAULT_MEASURE_OPTIONS).text).toEqual([]);
  });

  it('elements that touch: a point, no lines, no differences', () => {
    const d = viewMeasure(measureReport([line(0), line(0)], { distance: 0, pointA: [1, 2, 3], pointB: [1, 2, 3] }), DEFAULT_MEASURE_OPTIONS);
    expect(d.drawing?.lines).toEqual([]);
    expect(d.text).toEqual(['所選的兩個項次相互平行。', '距離: 0mm']);
  });
});

describe('a coordinate system, several measurements, labels moved by the user', () => {
  const line = (x: number): MeasureElement => ({ kind: 'edge', type: 'line', point: [x, 0, 0], area: null, length: 10, radius: null, direction: [0, 1, 0], round: null });
  const report = measureReport([line(0), line(43)], { distance: 43.104, pointA: [0, 0, 0], pointB: [43, 0, 3] });
  // a system turned a quarter round about z: its x is the world's y, its y is the world's −x
  const turned = { origin: [0, 0, 0] as [number, number, number], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]] };

  it('the differences are along its axes: 43 along the world\'s x is 43 along its (negative) y, nothing along its x', () => {
    expect(components([43, 0, 3], turned)).toEqual([0, -43, 3]);
    expect(components([43, 0, 3], null)).toEqual([43, 0, 3]);
    const v = viewMeasure(report, DEFAULT_MEASURE_OPTIONS, { frame: turned });
    expect(v.text.slice(2, 5)).toEqual(['  Delta X: 0mm', '  Delta Y: 43mm', '  Delta Z: 3mm']);
    expect(v.text[5]).toBe('總長度: 46mm');
  });

  it('and the legs are drawn along them: green along the system\'s y (the world\'s x, from 0 to 43), blue up 3; none along its x', () => {
    const d = viewMeasure(report, DEFAULT_MEASURE_OPTIONS, { frame: turned }).drawing!;
    expect(d.lines.slice(1)).toEqual([
      { a: [0, 0, 0], b: [43, 0, 0], color: 0x2f9e44 },
      { a: [43, 0, 0], b: [43, 0, 3], color: 0x1c4eca },
    ]);
    expect(d.labels.map((l) => l.name)).toEqual(['距離:', 'dY:', 'dZ:']);
  });

  it('a prefix makes the keys of the labels of one measurement its own; what the user moved a label by is added to where it is put', () => {
    const v = viewMeasure(report, DEFAULT_MEASURE_OPTIONS, { prefix: 'm2:', offsets: { 'm2:dx': [5, 7], 'dx': [100, 100] } }).drawing!;
    expect(v.labels.map((l) => l.key)).toEqual(['m2:distance', 'm2:dx', 'm2:dz']);
    expect(v.labels[1]!.offset).toEqual([5, -3]); // the usual [0, -10] and the move
    expect(v.labels[0]!.offset).toEqual([0, 16]);
  });
});
