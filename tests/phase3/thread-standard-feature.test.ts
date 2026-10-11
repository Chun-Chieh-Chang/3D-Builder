import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyCommand,
  createEmptyPart,
  type Command,
  type Feature,
  type PartDoc,
  type Ref,
  type ThreadFeature,
} from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

describe('Standard Thread Feature Integration (T-8 & D1 Stage 2)', () => {
  it('regenerates ISO Metric M6 external thread cut on cylinder shaft with fade transitions', () => {
    // 1. Shaft cylinder: OD = 6.0mm (r = 3.0), length = 20mm
    const shaftSketch = sketch('sk_shaft', front, circle('c1', 0, 0, 3.0));
    const shaftExtrude = extrude('ex_shaft', 'sk_shaft', 'boss', { type: 'blind', depth: '20' });

    // 2. Standard M6 Thread Feature (external cut, length 12mm, 0.5 turns taper in/out)
    // Note: No profile sketch needed!
    const threadFeat: ThreadFeature = {
      id: 'th_m6',
      type: 'thread',
      name: 'th_m6',
      suppressed: false,
      profileMode: 'standard',
      standardDesignation: 'M6',
      standardTarget: 'external',
      axis: { kind: 'face', name: 'ex_shaft:side:sk_shaft.c1' },
      op: 'cut',
      hand: 'right',
      length: '12',
      fadeTurnsIn: '0.5',
      fadeTurnsOut: '0.5',
    };

    const doc = build(shaftSketch, shaftExtrude, threadFeat);
    const r = rebuild(doc);

    expect(failures(r)).toEqual([]);
    expect(r.bodies.length).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);

    // Initial cylinder volume = pi * 3^2 * 20 ≈ 565.487 mm³
    const initialVol = Math.PI * 9 * 20;
    const finalVol = volume(r);
    // Thread grooves cut away material
    expect(finalVol).toBeLessThan(initialVol);
    // But thread core remains solid
    expect(finalVol).toBeGreaterThan(initialVol * 0.7);

    // Verify face naming propagates stdProfile faces
    const faceNames = r.body!.names.faces;
    const threadFaces = faceNames.filter((n) => n.startsWith('th_m6:'));
    expect(threadFaces.length).toBeGreaterThan(0);
    expect(threadFaces.some((n) => n.includes('stdProfile'))).toBe(true);
  });

  it('supports editing standard thread properties and designations via commands', () => {
    // Base shaft OD = 8.0mm (r = 4.0), length = 25mm
    const shaftSketch = sketch('sk_shaft8', front, circle('c1', 0, 0, 4.0));
    const shaftExtrude = extrude('ex_shaft8', 'sk_shaft8', 'boss', { type: 'blind', depth: '25' });

    const threadFeat: ThreadFeature = {
      id: 'th_m8',
      type: 'thread',
      name: 'th_m8',
      suppressed: false,
      profileMode: 'standard',
      standardDesignation: 'M8',
      standardTarget: 'external',
      axis: { kind: 'face', name: 'ex_shaft8:side:sk_shaft8.c1' },
      op: 'cut',
      hand: 'right',
      length: '15',
    };

    let doc = build(shaftSketch, shaftExtrude, threadFeat);
    let r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    const vol1 = volume(r);

    // Now update feature with fade turns via setThread command
    doc = applyCommand(doc, {
      type: 'setThread',
      featureId: 'th_m8',
      params: {
        fadeTurnsIn: '0.75',
        fadeTurnsOut: '0.75',
        length: '18',
      },
    });

    r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    const vol2 = volume(r);
    // Longer thread cut (18mm vs 15mm) removes slightly more material
    expect(vol2).toBeLessThan(vol1);
  });

  it('cuts American Unified 1/4-20 UNC internal thread into a pre-drilled bore', () => {
    // Block: 16x16mm extruded 14mm
    const blockSketch = sketch('sk_block', front, rectangle('r0', -8, -8, 16, 16));
    const blockExtrude = extrude('ex_block', 'sk_block', 'boss', { type: 'blind', depth: '14' });

    // Tap hole bore: diameter ~5.0mm (r = 2.5mm), standard minor drill diameter for 1/4-20 UNC
    const holeSketch = sketch('sk_hole', front, circle('c0', 0, 0, 2.5));
    const holeCut = extrude('ex_hole', 'sk_hole', 'cut', { type: 'blind', depth: '14', reverse: true });

    // Internal thread cut (1/4-20 UNC)
    const threadFeat: ThreadFeature = {
      id: 'th_unc',
      type: 'thread',
      name: 'th_unc',
      suppressed: false,
      profileMode: 'standard',
      standardDesignation: '1/4-20 UNC',
      standardTarget: 'internal',
      axis: { kind: 'face', name: 'ex_hole:side:sk_hole.c0' },
      op: 'cut',
      hand: 'right',
      length: '10',
      fadeTurnsIn: '0.25',
      fadeTurnsOut: '0.25',
    };

    const doc = build(blockSketch, blockExtrude, holeSketch, holeCut, threadFeat);
    const r = rebuild(doc);

    expect(failures(r)).toEqual([]);
    expect(r.bodies.length).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);

    const faceNames = r.body!.names.faces;
    const threadFaces = faceNames.filter((n) => n.startsWith('th_unc:'));
    expect(threadFaces.length).toBeGreaterThan(0);
  });

  it('grows external thread tooth onto minor-diameter shaft (boss operation)', () => {
    // M6 minor diameter shaft: r = 4.773 / 2 ≈ 2.3865, length = 15mm
    const coreSketch = sketch('sk_core', front, circle('c_core', 0, 0, 2.3865));
    const coreExtrude = extrude('ex_core', 'sk_core', 'boss', { type: 'blind', depth: '15' });

    const threadBoss: ThreadFeature = {
      id: 'th_boss',
      type: 'thread',
      name: 'th_boss',
      suppressed: false,
      profileMode: 'standard',
      standardDesignation: 'M6',
      standardTarget: 'external',
      axis: { kind: 'face', name: 'ex_core:side:sk_core.c_core' },
      op: 'boss',
      hand: 'right',
      length: '10',
      fadeTurnsIn: '0.5',
      fadeTurnsOut: '0.5',
    };

    const doc = build(coreSketch, coreExtrude, threadBoss);
    const r = rebuild(doc);

    expect(failures(r)).toEqual([]);
    expect(r.bodies.length).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);

    const initialCoreVol = Math.PI * (2.3865 ** 2) * 15;
    const finalVol = volume(r);
    // Boss adds helical teeth onto the core
    expect(finalVol).toBeGreaterThan(initialCoreVol);
  });

  describe('Red-Team Adversarial & Defensive Input Audits', () => {
    it('explicitly rejects non-existent or illegal thread standard designations', () => {
      const shaftSketch = sketch('sk_shaft', front, circle('c1', 0, 0, 3.0));
      const shaftExtrude = extrude('ex_shaft', 'sk_shaft', 'boss', { type: 'blind', depth: '20' });

      const invalidThread: ThreadFeature = {
        id: 'th_bad',
        type: 'thread',
        name: 'th_bad',
        suppressed: false,
        profileMode: 'standard',
        standardDesignation: 'M99_NON_EXISTENT',
        standardTarget: 'external',
        axis: { kind: 'face', name: 'ex_shaft:side:sk_shaft.c1' },
        op: 'cut',
        hand: 'right',
        length: '10',
      };

      const doc = build(shaftSketch, shaftExtrude, invalidThread);
      const r = rebuild(doc);
      expect(failures(r).length).toBe(1);
      expect(failures(r)[0]).toContain('th_bad=error');
    });

    it('explicitly rejects negative fade turns or fade transitions exceeding total length', () => {
      const shaftSketch = sketch('sk_shaft', front, circle('c1', 0, 0, 3.0));
      const shaftExtrude = extrude('ex_shaft', 'sk_shaft', 'boss', { type: 'blind', depth: '20' });

      // Negative fade turns
      const negativeFade: ThreadFeature = {
        id: 'th_neg',
        type: 'thread',
        name: 'th_neg',
        suppressed: false,
        profileMode: 'standard',
        standardDesignation: 'M6',
        axis: { kind: 'face', name: 'ex_shaft:side:sk_shaft.c1' },
        op: 'cut',
        hand: 'right',
        length: '10',
        fadeTurnsIn: '-0.5',
      };

      let doc = build(shaftSketch, shaftExtrude, negativeFade);
      let r = rebuild(doc);
      expect(failures(r).length).toBe(1);

      // Fade transitions exceeding total length (fade = 10 * 1mm + 10 * 1mm = 20mm > 5mm length)
      const excessiveFade: ThreadFeature = {
        id: 'th_long_fade',
        type: 'thread',
        name: 'th_long_fade',
        suppressed: false,
        profileMode: 'standard',
        standardDesignation: 'M6', // pitch = 1mm
        axis: { kind: 'face', name: 'ex_shaft:side:sk_shaft.c1' },
        op: 'cut',
        hand: 'right',
        length: '5',
        fadeTurnsIn: '10',
      };

      doc = build(shaftSketch, shaftExtrude, excessiveFade);
      r = rebuild(doc);
      expect(failures(r).length).toBe(1);
    });

    it('performs STEP export and import roundtrip confirming geometric volume conservation', () => {
      const shaftSketch = sketch('sk_shaft', front, circle('c1', 0, 0, 3.0));
      const shaftExtrude = extrude('ex_shaft', 'sk_shaft', 'boss', { type: 'blind', depth: '15' });
      const threadFeat: ThreadFeature = {
        id: 'th_step',
        type: 'thread',
        name: 'th_step',
        suppressed: false,
        profileMode: 'standard',
        standardDesignation: 'M6',
        axis: { kind: 'face', name: 'ex_shaft:side:sk_shaft.c1' },
        op: 'cut',
        hand: 'right',
        length: '8',
        fadeTurnsIn: '0.5',
        fadeTurnsOut: '0.5',
      };

      const doc = build(shaftSketch, shaftExtrude, threadFeat);
      const r = rebuild(doc);
      expect(failures(r)).toEqual([]);

      const origShape = r.body!.shape;
      const vOriginal = kernel.massProps(origShape).volume;

      // STEP export -> import
      const stepData = kernel.exportStep(origShape);
      expect(typeof stepData).toBe('string');
      expect(stepData.length).toBeGreaterThan(100);

      const imported = kernel.importStep(stepData);
      expect(kernel.isValid(imported.shape)).toBe(true);
      const vImported = kernel.massProps(imported.shape).volume;

      // Zero-mock physical precision check: delta < 0.01%
      const relError = Math.abs(vOriginal - vImported) / vOriginal;
      expect(relError).toBeLessThan(1e-4);

      kernel.release(imported.shape);
    });
  });
});
