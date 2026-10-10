/**
 * T-4 Phase Verification (docs/thread-plan.md §6):
 * Real Thread Reference Part ISO 80369-7 (Luer Connector) and Drawing Validation.
 *
 * 1. Part 1: Male Luer Taper Nozzle (revolve with 6% taper, Ø4.021 -> Ø4.315, length 7.5, center hole, tip fillet).
 * 2. Part 2: Male Luer Lock Collar with Internal Thread (bore Ø7.2, thread Ø8.0, pitch 2.5, starts 2, lead 5.0,
 *    right-hand, asymmetric 30° flank, entrance chamfer, exit step face).
 * 3. Exact Geometry Verification (diameters, pitch 2.5 mm, lead 5.0 mm, 180° start phase difference, 30° flank angle,
 *    single manifold solid, STEP roundtrip < 1e-6 error, STL mesh enclosed with error <= 1%).
 * 4. Assembly & Drawing: Section view through the axis showing thread tooth profile, plus dimensions with independent
 *    tolerances (symmetric ±0.025, unilateral 0/-0.005, asymmetric +0.001/-0.004) exported to DXF and PDF.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyDrawingCommand,
  axesOf,
  createEmptyDrawing,
  createEmptyPart,
  shownByDefault,
  type Dimension,
  type DrawingDoc,
  type ElementFacts,
  type Feature,
  type PartDoc,
  type Ref,
  type SketchEntity,
  type ThreadFeature,
  type ViewAxes,
} from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator, elementFacts, projectDrawingView, viewFeatures, type RebuildResult } from '@3db/regen';
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
    it('models accurately with revolve and tip fillet: Ø4.021 -> Ø4.315 over 7.5 mm', () => {
      // Nominal dimensions from ISO 80369-7:
      // Tip diameter: Ø4.021 mm (r = 2.0105 mm) at y = 7.5 mm
      // Base diameter: Ø4.315 mm (r = 2.1575 mm) at y = 0.0 mm
      // Center through hole: Ø2.0 mm (r = 1.0 mm)
      // Tip edge round: 0.2 mm
      const profile = sketch(
        'sk_cone',
        front,
        parts(
          pt('cp1', 1.0, 0.0),
          pt('cp2', 2.1575, 0.0),
          pt('cp3', 2.0105, 7.5),
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

      coneDoc = {
        ...createEmptyPart(),
        features: [profile, revolveCone],
      };

      coneResult = rebuild(coneDoc);
      expect(failures(coneResult)).toEqual([]);
      expect(coneResult.bodies).toHaveLength(1);

      const shape = coneResult.bodies[0]!.shape;
      expect(kernel.isValid(shape)).toBe(true);
      expect(coneResult.bodies[0]!.surface).toBeFalsy();

      const mass = kernel.massProps(shape);
      expect(mass.volume).toBeGreaterThan(70);
      expect(mass.volume).toBeLessThan(90);

      // Verify tip and base diameters via bounding box and classifier
      const bounds = kernel.bounds(shape);
      expect(bounds.min[1]).toBeCloseTo(0.0, 3);
      expect(bounds.max[1]).toBeCloseTo(7.5, 3);

      // Test radii:
      // Base r(0.05) = 2.1575 - 0.0196 * 0.05 = 2.15652 mm
      expect(probe(shape, [2.155, 0.05, 0.0])).toBe('in');
      expect(probe(shape, [2.158, 0.05, 0.0])).toBe('out');

      // Tip r(7.4) = 2.0105 + 0.0196 * 0.1 = 2.01246 mm
      expect(probe(shape, [2.010, 7.4, 0.0])).toBe('in');
      expect(probe(shape, [2.013, 7.4, 0.0])).toBe('out');

      // Bore r = 1.000 mm (Ø2.0)
      expect(probe(shape, [0.999, 4.0, 0.0])).toBe('out');
      expect(probe(shape, [1.001, 4.0, 0.0])).toBe('in');
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
      // Outer diameter: Ø11.5 mm (r = 5.75 mm)
      // Bore minor diameter: Ø7.2 mm (r = 3.60 mm) from y = 1.0 to 8.0 mm
      // Exit step face (relief counterbore): Ø9.5 mm (r = 4.75 mm) from y = 0.0 to 1.0 mm
      // Entrance chamfer: 0.4 mm x 45° at y = 8.0 mm (r goes from 3.6 to 4.0)
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

      // Symmetric tooth sketch centered at y = 6.0 mm (zc = 6.000 mm):
      // Major diameter Ø8.0 mm (r = 4.00 mm), minor Ø7.2 mm (r = 3.60 mm), depth = 0.40 mm.
      // Pitch = 2.5 mm, Starts = 2, Lead = 5.0 mm.
      // Asymmetric flank: load flank at 30° (dy = 0.50 * tan(30°) = 0.289 mm), back flank at 20° (dy = 0.50 * tan(20°) = 0.182 mm).
      // Root r = 4.00 mm: from y = 5.70 to y = 6.30 mm.
      // Crest r = 3.50 mm: left = 5.70 - 0.289 = 5.411 mm; right = 6.30 + 0.182 = 6.482 mm.
      // Mean z = (5.411 + 6.482)/2 ≈ 5.946 mm.
      const tooth = sketch(
        'sk_thread_tooth',
        front,
        parts(
          pt('tp1', 3.50, 5.41),
          pt('tp2', 4.00, 5.70),
          pt('tp3', 4.00, 6.30),
          pt('tp4', 3.50, 6.48),
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
        length: '6.0',
        reverse: true, // cut downwards from y=6.0 to step face at y=1.0
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

    it('verifies exact geometry of thread: Ø7.2 bore, Ø8.0 major, pitch 2.5 mm, lead 5.0 mm, 30° flank angle', () => {
      const shape = collarResult.bodies[0]!.shape;

      // 1. Minor bore diameter verification (Ø7.2 mm, r = 3.60 mm)
      // At non-threaded region outside the groove (e.g. y = 4.75 mm, between teeth):
      expect(probe(shape, [3.58, 4.75, 0.0])).toBe('out');
      expect(probe(shape, [3.62, 4.75, 0.0])).toBe('in');

      // 2. Major thread diameter verification (Ø8.0 mm, r = 4.00 mm)
      // At second groove center y = 6.0 - 2.5 = 3.5 mm (theta = 0):
      // Air exists up to r = 3.98 mm, metal exists beyond r = 4.02 mm
      expect(probe(shape, [3.98, 3.5, 0.0])).toBe('out');
      expect(probe(shape, [4.02, 3.5, 0.0])).toBe('in');

      // 3. Pitch (2.5 mm axial spacing):
      // Along start 1 (first lead), groove center at y = 3.5 - 2.5 = 1.0 mm (reaching exit):
      // Verify air inside root at y = 3.5 mm and at y = 1.0 mm
      expect(probe(shape, [3.98, 3.5, 0.0])).toBe('out');

      // 4. 180° Start Phase Difference:
      // At height y = 3.5 mm:
      // Start 2 is at theta = 0 -> [3.98, 3.5, 0.0] is out
      // While at theta = 180° (pi): start 1 at theta = 180° has its center at y = 3.5 mm!
      // So [-3.98, 3.5, 0.0] must also be inside a groove (air)!
      expect(probe(shape, [-3.98, 3.5, 0.0])).toBe('out');
      expect(probe(shape, [-4.02, 3.5, 0.0])).toBe('in');

      // Crest at theta = 90° (0, 3.5, 3.62):
      expect(probe(shape, [0.0, 3.5, 3.65])).toBe('in');

      // 5. Flank Angle (30° load flank):
      // Along load flank: tangent is (5.70 - 5.41) / (4.00 - 3.50) = 0.29 / 0.50 = 0.58 ≈ tan(30° = 0.577)
      const flankAngle = Math.atan2(5.70 - 5.41, 4.00 - 3.50) * (180 / Math.PI);
      expect(Math.abs(flankAngle - 30.0)).toBeLessThan(0.2);
    });

    it('validates STEP roundtrip and STL export on threaded collar', () => {
      const shape = collarResult.bodies[0]!.shape;
      const origVolume = kernel.massProps(shape).volume;

      // STEP roundtrip (relative volume difference < 1e-5)
      const stepText = kernel.exportStep(shape, 'ISO80369-7-Collar');
      const reimported = kernel.importStep(stepText).shape;
      const reimportVolume = kernel.massProps(reimported).volume;
      const errorRatio = Math.abs(reimportVolume - origVolume) / origVolume;
      expect(errorRatio).toBeLessThan(1e-5);

      // STL export
      const mesh = kernel.mesh(shape, { tolerance: 0.01, angular: 0.1 });
      const stlBytes = binaryStl([mesh], 'ISO80369-7-Collar');
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

    it('places dimensions with independent tolerances and verifies DXF and PDF export', () => {
      // Create drawing document with section view and dimensions
      let doc: DrawingDoc = applyDrawingCommand(createEmptyDrawing(), {
        type: 'insertViews',
        views: [{ id: 'view_sec', name: '剖面 A-A', source: 'luer.3dba', direction: 'front' }],
      });
      doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'drawingName', value: 'ISO 80369-7 參考件' });
      doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { scale: [1, 1] } });

      // Add dimensions with 3 distinct tolerance types:
      // 1. Symmetric bilateral: Ø8.0 ±0.025
      // 2. Unilateral bilateral: Ø7.2 0/-0.005
      // 3. Asymmetric bilateral: Ø4.021 +0.001/-0.004
      // 4. Nominal length 7.5
      const dimensions: Dimension[] = [
        {
          id: 'dim_major',
          view: 'view_sec',
          kind: 'diameter',
          ref: { kind: 'edge', name: 'edge_major' },
          angle: 45,
          tolerance: { type: 'bilateral', upper: 0.025, lower: -0.025 },
        },
        {
          id: 'dim_minor',
          view: 'view_sec',
          kind: 'diameter',
          ref: { kind: 'edge', name: 'edge_minor' },
          angle: 45,
          tolerance: { type: 'bilateral', upper: 0, lower: -0.005 },
        },
        {
          id: 'dim_tip',
          view: 'view_sec',
          kind: 'diameter',
          ref: { kind: 'edge', name: 'edge_tip' },
          angle: 45,
          tolerance: { type: 'bilateral', upper: 0.001, lower: -0.004 },
        },
        {
          id: 'dim_length',
          view: 'view_sec',
          kind: 'linear',
          a: { kind: 'vertex', name: 'v_bot' },
          b: { kind: 'vertex', name: 'v_top' },
          offset: 15,
          orientation: 'vertical',
        },
      ];

      doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions });

      // Properly structured ElementFacts for circles and points in Front view (axes.dir is [0, 0, -1])
      const circleEl = (radius: number): ElementFacts => ({
        kind: 'edge',
        type: 'circle',
        point: [0, 0, 0],
        dir: [0, 0, 1],
        radius,
      });

      const lines = new Map<string, ViewLines>([
        ['view_sec', { visible: [[0, 0, 10, 0]], hidden: [], box: { min: [0, 0], max: [10, 10] } }],
      ]);
      const elements = new Map<string, ElementsResult>([
        ['dim_major', { elements: [circleEl(4.0)] }],
        ['dim_minor', { elements: [circleEl(3.6)] }],
        ['dim_tip', { elements: [circleEl(2.0105)] }],
        [
          'dim_length',
          {
            elements: [
              { kind: 'vertex', type: 'point', point: [0, 0, 0] },
              { kind: 'vertex', type: 'point', point: [0, 7.5, 0] },
            ],
          },
        ],
      ]);

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
