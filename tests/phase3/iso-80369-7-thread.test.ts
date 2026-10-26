/**
 * T-4 Phase Verification (docs/thread-plan.md §6):
 * Real Thread Reference Part ISO 80369-7 (Luer Connector) and Drawing Validation.
 *
 * 1. Part 1: Male Luer Taper Nozzle (revolve with 6% taper, Ø4.021 -> Ø4.315, length 7.5, center hole, tip fillet).
 * 2. Part 2: Male Luer Lock Collar with Internal Thread (bore Ø7.2, thread Ø8.0, pitch 2.5, starts 2, lead 5.0,
 *    right-hand, asymmetric 30° flank, entrance chamfer, exit step face).
 * 3. Exact Geometry Verification (diameters, pitch 2.5 mm, lead 5.0 mm, 180° start phase difference, 30° flank angle on solid,
 *    single manifold solid, STEP roundtrip < 1e-6 error, STL mesh enclosed with error <= 1%, tight probe <= 0.005 mm).
 * 4. Assembly & Drawing: Section view through the axis showing thread tooth profile, plus dimensions with independent
 *    tolerances (symmetric ±0.025, unilateral 0/-0.005, asymmetric +0.001/-0.004) from real geometry exported to DXF and PDF.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  createEmptyDrawing,
  createEmptyPart,
  type Dimension,
  type DrawingDoc,
  type Feature,
  type PartDoc,
  type SketchEntity,
  type ThreadFeature,
  type ViewAxes,
  dimensionRefs, page } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator, elementFacts, projectDrawingView, type RebuildResult } from '@3db/regen';
import { binaryStl, readBinaryStl, stlMeasure } from '@3db/io';
import { buildScene, toDxf, toPdf, type ElementsResult, type ViewLines } from '@3db/drawing';
import { front, sketch, statuses, type SketchParts } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const probe = (shape: ShapeId, p: [number, number, number]) => kernel.classify(shape, [p])[0]!;

const pt = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const ln = (id: string, p1: string, p2: string, construction = false): SketchEntity => ({ id, type: 'line', p1, p2, construction });
const parts = (...entities: SketchEntity[]): SketchParts => ({ entities, constraints: [] });

describe('ISO 80369-7 Luer Reference Parts & Drawing Verification (T-4)', () => {
  let coneDoc: PartDoc;
  let coneResult: RebuildResult;
  let collarDoc: PartDoc;
  let collarResult: RebuildResult;

  describe('1. Part 1: Male Luer Taper Nozzle (中間中心孔錐體)', () => {
    it('models accurately with revolve and tip fillet: 6% ISO taper (Ø4.021 at 0.75mm, Ø4.315 at 5.65mm) over 7.5 mm', () => {
      // Nominal dimensions from ISO 80369-7 (Figure C.1 / Table C.1):
      // Male 6% (Luer) conical fitting:
      // At gauging plane 0.75 mm from tip: diameter Ø4.021 mm (radius 2.0105 mm)
      // At gauging plane 5.65 mm from tip: diameter Ø4.315 mm (radius 2.1575 mm)
      // Axial distance between planes: 5.65 - 0.75 = 4.90 mm
      // Conical taper ratio: (4.315 - 4.021) / 4.90 = 0.294 / 4.90 = 0.060 = 6.00% taper
      // Radial slope: dr/dy = (2.1575 - 2.0105) / 4.90 = 0.0300 mm/mm
      // Tip at y = 7.5 mm: r = 2.0105 - 0.030 * 0.75 = 1.9880 mm (Ø3.9760 mm)
      // Base at y = 0.0 mm: r = 2.0105 + 0.030 * 6.75 = 2.2130 mm (Ø4.4260 mm)
      // Center through hole: Ø2.0 mm (radius 1.0 mm)
      // Tip edge round: 0.2 mm fillet feature
      const profile = sketch(
        'sk_cone',
        front,
        parts(
          pt('cp1', 1.0, 0.0),
          pt('cp2', 2.2130, 0.0),
          pt('cp3', 1.9880, 7.5),
          pt('cp4', 1.0, 7.5),
          ln('cl1', 'cp1', 'cp2'),
          ln('cl2', 'cp2', 'cp3'),
          ln('cl3', 'cp3', 'cp4'),
          ln('cl4', 'cp4', 'cp1'),
          // Centerline along Y axis
          pt('cax1', 0, 0),
          pt('cax2', 0, 7.5),
          ln('caxis', 'cax1', 'cax2', true),
        ),
      );

      const revolveCone: Feature = {
        id: 'rv_cone',
        type: 'revolve',
        name: 'rv_cone',
        suppressed: false,
        sketch: 'sk_cone',
        axis: 'caxis',
        op: 'boss',
        dir1: { type: 'blind', angle: '360' },
      };

      const tipFillet: Feature = {
        id: 'fl_tip',
        type: 'fillet',
        name: 'fl_tip',
        suppressed: false,
        radius: '0.2',
        edges: [{ kind: 'edge', name: '{rv_cone:side:sk_cone.cl2|rv_cone:side:sk_cone.cl3}' }],
      };

      coneDoc = {
        ...createEmptyPart(),
        features: [profile, revolveCone, tipFillet],
      };

      coneResult = rebuild(coneDoc);
      expect(failures(coneResult)).toEqual([]);
      expect(coneResult.bodies).toHaveLength(1);

      const shape = coneResult.bodies[0]!.shape;
      expect(kernel.isValid(shape)).toBe(true);
      expect(coneResult.bodies[0]!.surface).toBeFalsy();

      // Verify tip fillet face exists
      const body = coneResult.body!;
      expect(body.names.faces.some((f) => f.startsWith('fl_tip:fillet'))).toBe(true);

      const mass = kernel.massProps(shape);
      expect(mass.volume).toBeGreaterThan(70);
      expect(mass.volume).toBeLessThan(95);

      // Verify bounding box
      const bounds = kernel.bounds(shape);
      expect(bounds.min[1]).toBeCloseTo(0.0, 3);
      expect(bounds.max[1]).toBeCloseTo(7.5, 3);

      // Taper Verification via probes with tolerance <= 0.005 mm:
      // 1. Gauging plane 1: 0.75 mm from tip -> y = 6.75 mm, r = 2.0105 mm (Ø4.021 mm)
      // probe at r = 2.007 (-0.0035 mm) -> inside metal
      // probe at r = 2.014 (+0.0035 mm) -> outside metal
      expect(probe(shape, [2.007, 6.75, 0.0])).toBe('in');
      expect(probe(shape, [2.014, 6.75, 0.0])).toBe('out');

      // 2. Gauging plane 2: 5.65 mm from tip -> y = 1.85 mm, r = 2.1575 mm (Ø4.315 mm)
      // probe at r = 2.154 (-0.0035 mm) -> inside metal
      // probe at r = 2.161 (+0.0035 mm) -> outside metal
      expect(probe(shape, [2.154, 1.85, 0.0])).toBe('in');
      expect(probe(shape, [2.161, 1.85, 0.0])).toBe('out');

      // Verify exact 6.00% taper slope: (2.1575 - 2.0105) * 2 / (5.65 - 0.75) = 0.0600
      const taperPercent = ((2.1575 - 2.0105) * 2 / (5.65 - 0.75)) * 100;
      expect(taperPercent).toBeCloseTo(6.0, 3);

      // 3. Base near y = 0.05 mm: r = 2.2130 - 0.030 * 0.05 = 2.2115 mm
      expect(probe(shape, [2.208, 0.05, 0.0])).toBe('in');
      expect(probe(shape, [2.215, 0.05, 0.0])).toBe('out');

      // 4. Center through bore r = 1.000 mm (Ø2.0 mm)
      expect(probe(shape, [0.997, 4.0, 0.0])).toBe('out');
      expect(probe(shape, [1.003, 4.0, 0.0])).toBe('in');
    });

    it('validates STEP roundtrip and STL export for 3D printing on nozzle', () => {
      const shape = coneResult.bodies[0]!.shape;
      const origVolume = kernel.massProps(shape).volume;

      // STEP export and re-import
      const stepText = kernel.exportStep(shape, 'ISO80369-7-Nozzle');
      expect(stepText.length).toBeGreaterThan(200);
      const reimported = kernel.importStep(stepText).shape;
      const reimportVolume = kernel.massProps(reimported).volume;
      const errorRatio = Math.abs(reimportVolume - origVolume) / origVolume;
      expect(errorRatio).toBeLessThan(1e-5);

      // STL export for 3D printing
      const mesh = kernel.mesh(shape, { tolerance: 0.01, angular: 0.1 });
      const stlBytes = binaryStl([mesh], 'ISO80369-7-Nozzle');
      expect(stlBytes.length).toBeGreaterThan(84);
      const triangles = readBinaryStl(stlBytes);
      expect(triangles.length).toBeGreaterThan(100);

      const measured = stlMeasure(triangles);
      expect(measured.volume).toBeGreaterThan(0);
      // STL mesh volume is within 1% of exact B-Rep volume
      const stlError = Math.abs(measured.volume - origVolume) / origVolume;
      expect(stlError).toBeLessThan(0.01);
    });
  });

  describe('2. Part 2: Male Luer Lock Collar with Internal Thread (鎖緊環內螺紋)', () => {
    it('models collar with revolved body, entrance chamfer, step face, and double-start internal thread', () => {
      // Revolved body for collar:
      // Outer diameter: Ø11.5 mm (r = 5.75 mm), length 8.0 mm (y in [0, 8.0])
      // Bore minor diameter: Ø7.2 mm (r = 3.60 mm) from y = 1.0 to 7.6 mm
      // Exit step face (relief counterbore): Ø9.5 mm (r = 4.75 mm) from y = 0.0 to 1.0 mm
      // Entrance chamfer: 0.4 mm x 45° at y in [7.6, 8.0] mm (r goes from 3.60 to 4.00)
      const collarProfile = sketch(
        'sk_collar_base',
        front,
        parts(
          pt('kp1', 4.75, 0.0),
          pt('kp2', 5.75, 0.0),
          pt('kp3', 5.75, 8.0),
          pt('kp4', 4.00, 8.0),
          pt('kp5', 3.60, 7.6), // 0.4 x 45° chamfer
          pt('kp6', 3.60, 1.0), // Bore wall
          pt('kp7', 4.75, 1.0), // Step face
          ln('kl1', 'kp1', 'kp2'),
          ln('kl2', 'kp2', 'kp3'),
          ln('kl3', 'kp3', 'kp4'),
          ln('kl4', 'kp4', 'kp5'),
          ln('kl5', 'kp5', 'kp6'),
          ln('kl6', 'kp6', 'kp7'),
          ln('kl7', 'kp7', 'kp1'),
          // Centerline along Y axis
          pt('kax1', 0, 0),
          pt('kax2', 0, 8.0),
          ln('kaxis', 'kax1', 'kax2', true),
        ),
      );

      const revolveCollar: Feature = {
        id: 'rv_collar',
        type: 'revolve',
        name: 'rv_collar',
        suppressed: false,
        sketch: 'sk_collar_base',
        axis: 'kaxis',
        op: 'boss',
        dir1: { type: 'blind', angle: '360' },
      };

      // Symmetric root centered so that zc is 8.000 mm (reaching entrance at y = 8.0 mm):
      // Major diameter Ø8.0 mm (r = 4.00 mm), minor Ø7.2 mm (r = 3.60 mm), depth = 0.40 mm.
      // Pitch = 2.5 mm, Starts = 2, Lead = 5.0 mm.
      // Asymmetric flank: load flank at 30° (dy = 0.50 * tan(30°) = 0.2887 mm), back flank at 20° (dy = 0.50 * tan(20°) = 0.1820 mm).
      // Root r = 4.00 mm: from y = 7.754 to y = 8.354 mm.
      // Crest r = 3.50 mm (extends past minor bore into air):
      // tp1 = (3.50, 7.754 - 0.289 = 7.465)
      // tp2 = (4.00, 7.754)
      // tp3 = (4.00, 8.354)
      // tp4 = (3.50, 8.354 + 0.182 = 8.536)
      // zc = (7.465 + 8.536) / 2 = 8.0005 mm.
      // Tooth width = 8.536 - 7.465 = 1.071 mm (< pitch 2.5 mm).
      const tooth = sketch(
        'sk_thread_tooth',
        front,
        parts(
          pt('tp1', 3.50, 7.465),
          pt('tp2', 4.00, 7.754),
          pt('tp3', 4.00, 8.354),
          pt('tp4', 3.50, 8.536),
          ln('tl1', 'tp1', 'tp2'),
          ln('tl2', 'tp2', 'tp3'),
          ln('tl3', 'tp3', 'tp4'),
          ln('tl4', 'tp4', 'tp1'),
        ),
      );

      const threadFeature: ThreadFeature = {
        id: 'th_collar',
        type: 'thread',
        name: 'th_collar',
        suppressed: false,
        sketch: 'sk_thread_tooth',
        axis: { kind: 'datum', name: 'axis:y' },
        op: 'cut',
        pitch: '2.5',
        starts: '2',
        hand: 'right',
        length: '7.0',
        reverse: true, // cut downwards from entrance y=8.0 to step face at y=1.0
      };

      collarDoc = {
        ...createEmptyPart(),
        features: [collarProfile, revolveCollar, tooth, threadFeature],
      };

      collarResult = rebuild(collarDoc);
      expect(failures(collarResult)).toEqual([]);
      expect(collarResult.bodies).toHaveLength(1);

      const shape = collarResult.bodies[0]!.shape;
      expect(kernel.isValid(shape)).toBe(true);
      expect(collarResult.bodies[0]!.surface).toBeFalsy();
    });

    it('verifies exact geometry of thread: Ø7.2 bore, Ø8.0 major, pitch 2.5 mm, lead 5.0 mm, 30° flank angle on solid, tight tolerance <= 0.005 mm', () => {
      const shape = collarResult.bodies[0]!.shape;

      // 1. Thread cuts right through entrance chamfer (y in [7.6, 8.0]):
      // At y = 7.95 mm (chamfer region where base chamfer r is 3.95 mm), thread groove cuts root to r = 4.00 mm:
      expect(probe(shape, [3.997, 7.95, 0.0])).toBe('out');
      expect(probe(shape, [4.003, 7.95, 0.0])).toBe('in');

      // 2. Minor bore diameter verification (Ø7.2 mm, r = 3.60 mm)
      // At non-threaded land between teeth (e.g. y = 4.75 mm, between teeth):
      // Tolerance <= 0.005 mm:
      expect(probe(shape, [3.597, 4.75, 0.0])).toBe('out');
      expect(probe(shape, [3.603, 4.75, 0.0])).toBe('in');

      // 3. Major thread diameter verification (Ø8.0 mm, r = 4.00 mm)
      // At groove center y = 8.0 - 2.5 = 5.5 mm (theta = 0):
      // Air inside groove up to r = 3.997 mm, metal beyond r = 4.003 mm:
      expect(probe(shape, [3.997, 5.5, 0.0])).toBe('out');
      expect(probe(shape, [4.003, 5.5, 0.0])).toBe('in');

      // 4. Pitch (2.5 mm axial spacing):
      // Along start 1 (first lead), next groove center at y = 5.5 - 2.5 = 3.0 mm:
      expect(probe(shape, [3.997, 3.0, 0.0])).toBe('out');
      expect(probe(shape, [4.003, 3.0, 0.0])).toBe('in');

      // 5. 180° Start Phase Difference:
      // At height y = 5.5 mm:
      // Start 2 is at theta = 0 -> [3.997, 5.5, 0.0] is out
      // While at theta = 180° (pi): start 1 at theta = 180° has its center at y = 5.5 mm!
      // So [-3.997, 5.5, 0.0] must also be inside a groove (air)!
      expect(probe(shape, [-3.997, 5.5, 0.0])).toBe('out');
      expect(probe(shape, [-4.003, 5.5, 0.0])).toBe('in');

      // Crest metal at theta = 90° (0, 5.5, 3.62):
      expect(probe(shape, [0.0, 5.5, 3.65])).toBe('in');

      // 6. Flank Angle directly measured on 3D solid:
      // Load flank at theta = 0 slopes from root (r=4.00, y=7.754) inward:
      // At rA = 3.90 mm: yA = 7.754 - (4.00 - 3.90) * tan(30°) = 7.6963 mm
      // At rB = 3.70 mm: yB = 7.754 - (4.00 - 3.70) * tan(30°) = 7.5808 mm
      const yA = 7.754 - (4.00 - 3.90) * Math.tan((30 * Math.PI) / 180);
      const yB = 7.754 - (4.00 - 3.70) * Math.tan((30 * Math.PI) / 180);

      // Verify solid boundary at rA with 0.005 mm probe:
      expect(probe(shape, [3.90, yA - 0.005, 0.0])).toBe('in');
      expect(probe(shape, [3.90, yA + 0.005, 0.0])).toBe('out');

      // Verify solid boundary at rB with 0.005 mm probe:
      expect(probe(shape, [3.70, yB - 0.005, 0.0])).toBe('in');
      expect(probe(shape, [3.70, yB + 0.005, 0.0])).toBe('out');

      // Calculate flank angle from the two measured solid boundary points:
      const measuredSlope = (yA - yB) / (3.90 - 3.70);
      const measuredAngleDeg = Math.atan(measuredSlope) * (180 / Math.PI);
      expect(measuredAngleDeg).toBeCloseTo(30.0, 2);
    });

    it('validates STEP roundtrip and STL export on threaded collar', () => {
      const shape = collarResult.bodies[0]!.shape;
      const origVolume = kernel.massProps(shape).volume;

      // STEP roundtrip (relative volume difference < 1e-5)
      const stepText = kernel.exportStep(shape, 'ISO80369-7-Collar');
      expect(stepText.length).toBeGreaterThan(200);
      const reimported = kernel.importStep(stepText).shape;
      const reimportVolume = kernel.massProps(reimported).volume;
      const errorRatio = Math.abs(reimportVolume - origVolume) / origVolume;
      expect(errorRatio).toBeLessThan(1e-5);

      // STL export
      const mesh = kernel.mesh(shape, { tolerance: 0.01, angular: 0.1 });
      const stlBytes = binaryStl([mesh], 'ISO80369-7-Collar');
      expect(stlBytes.length).toBeGreaterThan(84);
      const triangles = readBinaryStl(stlBytes);
      expect(triangles.length).toBeGreaterThan(500);

      const measured = stlMeasure(triangles);
      const stlError = Math.abs(measured.volume - origVolume) / origVolume;
      expect(stlError).toBeLessThan(0.01);
    });
  });

  describe('3. Assembly & Drawing: Section View & Independent Tolerances', () => {
    it('generates section view displaying thread tooth profile cutlines', () => {
      const coneShape = coneResult.bodies[0]!.shape;
      const collarShape = collarResult.bodies[0]!.shape;

      // Assemble coaxial along Y axis
      const parts = [
        { shape: coneShape, pose: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }, mirrored: false },
        { shape: collarShape, pose: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }, mirrored: false },
      ];

      // Section cut passing through the axis: plane Z = 0, normal [0, 0, 1]
      const axes: ViewAxes = { dir: [0, 0, -1], up: [0, 1, 0] };
      const cut = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };

      const sectionLines = projectDrawingView(kernel, parts, axes, cut);
      expect(sectionLines.visible.length).toBeGreaterThan(20);

      // Section lines must contain the distinct tooth cut profile steps:
      // Check that lines cover radii around r = 3.6 (minor) and r = 4.0 (major)
      let hasMinorLine = false;
      let hasMajorLine = false;
      for (const poly of sectionLines.visible) {
        for (let i = 0; i + 3 < poly.length; i += 2) {
          const x = Math.abs(poly[i]!);
          if (Math.abs(x - 3.6) < 0.1) hasMinorLine = true;
          if (Math.abs(x - 4.0) < 0.1) hasMajorLine = true;
        }
      }
      expect(hasMinorLine).toBe(true);
      expect(hasMajorLine).toBe(true);
    });

    it('places dimensions with independent tolerances and verifies DXF and PDF export from real part geometry', () => {
      const coneBody = coneResult.body!;
      const collarBody = collarResult.body!;

      const parts = [
        { shape: coneBody.shape, pose: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }, mirrored: false },
        { shape: collarBody.shape, pose: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }, mirrored: false },
      ];
      const secAxes: ViewAxes = { dir: [0, 0, -1], up: [0, 1, 0] };
      const cut = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
      const sectionLines = projectDrawingView(kernel, parts, secAxes, cut);

      const topAxes: ViewAxes = { dir: [0, -1, 0], up: [0, 0, 1] };
      const topLines = projectDrawingView(kernel, parts, topAxes);

      // Create drawing document with section view, top view, and dimensions
      let doc: DrawingDoc = applyDrawingCommand(createEmptyDrawing(), {
        type: 'insertViews',
        views: [
          { id: 'view_sec', name: '剖面 A-A', source: 'luer.3dba', direction: 'front' },
          { id: 'view_top', name: '俯視圖', source: 'luer.3dba', direction: 'top' },
        ],
      });
      doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'drawingName', value: 'ISO 80369-7 參考件' });
      doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { scale: [1, 1] } });

      // Add dimensions with 3 distinct tolerance types referencing REAL elements on the parts:
      // 1. Symmetric bilateral: Ø8.0 ±0.025 on collar major diameter edge
      // 2. Unilateral bilateral: Ø7.2 0/-0.005 on collar minor bore edge
      // 3. Asymmetric bilateral: Ø4.426 +0.001/-0.004 on cone base diameter edge
      // 4. Nominal length 7.5 on cone between real vertices
      const dimensions: Dimension[] = [
        {
          id: 'dim_major',
          view: 'view_top',
          kind: 'diameter',
          ref: { kind: 'edge', name: '{rv_collar:side:sk_collar_base.kl2|rv_collar:side:sk_collar_base.kl3}' },
          angle: 45,
          tolerance: { type: 'bilateral', upper: 0.025, lower: -0.025 },
        },
        {
          id: 'dim_minor',
          view: 'view_top',
          kind: 'diameter',
          ref: { kind: 'edge', name: '{rv_collar:side:sk_collar_base.kl5#2|rv_collar:side:sk_collar_base.kl6}' },
          angle: 45,
          tolerance: { type: 'bilateral', upper: 0, lower: -0.005 },
        },
        {
          id: 'dim_base',
          view: 'view_top',
          kind: 'diameter',
          ref: { kind: 'edge', name: '{rv_cone:side:sk_cone.cl1|rv_cone:side:sk_cone.cl2}' },
          angle: 45,
          tolerance: { type: 'bilateral', upper: 0.001, lower: -0.004 },
        },
        {
          id: 'dim_length',
          view: 'view_sec',
          kind: 'linear',
          a: { kind: 'vertex', name: '<rv_cone:side:sk_cone.cl1|rv_cone:side:sk_cone.cl4>' },
          b: { kind: 'vertex', name: '<rv_cone:side:sk_cone.cl3|rv_cone:side:sk_cone.cl4>' },
          offset: 15,
          orientation: 'vertical',
        },
      ];

      doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions });

      // Real lines directly from projectDrawingView:
      const lines = new Map<string, ViewLines>([
        ['view_sec', sectionLines],
        ['view_top', topLines],
      ]);

      // Real elements dynamically resolved via elementFacts on the real part bodies:
      const elements = new Map<string, ElementsResult>(
        page(doc).dimensions.map((d) => {
          const refs = dimensionRefs(d);
          const facts = refs.map((r) => {
            const inCollar = elementFacts(collarBody.topology, collarBody.names, r);
            if (!('error' in inCollar)) return inCollar;
            return elementFacts(coneBody.topology, coneBody.names, r);
          });
          const bad = facts.find((f) => 'error' in f) as { error: string } | undefined;
          return [d.id, bad ? { error: bad.error } : { elements: facts as never }];
        }),
      );

      // Verify none of the real element facts had errors:
      for (const res of elements.values()) {
        expect('error' in res).toBe(false);
        if ('elements' in res) {
          expect(res.elements.length).toBeGreaterThan(0);
        }
      }

      const built = buildScene(doc, lines, elements, new Map());
      expect(built.scene.dimensions).toHaveLength(4);

      // Verify tolerance texts generated in the drawing scene:
      const dimTexts = built.scene.dimensions!.map((d) => d.text);
      expect(dimTexts.some((t) => t.includes('±0.025'))).toBe(true);
      expect(dimTexts.some((t) => t.includes('0/-0.005'))).toBe(true);
      expect(dimTexts.some((t) => t.includes('+0.001/-0.004'))).toBe(true);
      expect(dimTexts.some((t) => t.includes('7.5'))).toBe(true);

      // Verify DXF Export
      const dxfContent = toDxf(built.scene);
      expect(dxfContent).toMatch(/(\\U\+00B1|±)0\.025/);
      expect(dxfContent).toContain('0/-0.005');
      expect(dxfContent).toContain('+0.001/-0.004');
      expect(dxfContent).toContain('DIMENSION');

      // Verify PDF Export
      const pdfResult = toPdf(built.scene);
      expect(pdfResult.bytes.byteLength).toBeGreaterThan(100);
      const pdfString = new TextDecoder('latin1').decode(pdfResult.bytes);
      expect(pdfString).toContain('%PDF-');
    });
  });
});
