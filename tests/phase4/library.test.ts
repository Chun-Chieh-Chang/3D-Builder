/**
 * 4a-4 (docs/phase4a-plan.md): the standard parts library (F6.1). Every size of the screw, the dowel pin and the washer rebuilds without a problem and its
 * volume is the hand-worked one; a size is edited through its variables; the faces are the ones the names say and mates on them hold; the STEP file of a
 * part reads back to the same volume.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, applyCommand, createEmptyAssembly, parsePart, serializePart, transformPoint, type AssemblyDoc, type Mate, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssembly, type MatePart } from '@3db/regen';
import { DOWEL_PINS, SET_SCREWS, SOCKET_SCREWS, STANDARD_FACES, standardLengths, standardName, standardPartDoc, standardProblem, standardSizes, WASHERS, type StandardSpec } from '@3db/library';
import { statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

function rebuild(doc: PartDoc) {
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  const r = regen.rebuild(doc);
  return r;
}
const volumeOf = (doc: PartDoc) => kernel.massProps(rebuild(doc).body!.shape).volume;
const problems = (doc: PartDoc) => statuses(rebuild(doc)).filter((s) => !s.endsWith('=ok'));

const screwVolume = (size: string, L: number) => {
  const { d, dk, k, s, t } = SOCKET_SCREWS[size]!;
  return Math.PI * (dk / 2) ** 2 * k + Math.PI * (d / 2) ** 2 * L - (Math.sqrt(3) / 2) * s * s * t;
};
const pinVolume = (size: string, L: number) => {
  const { d, c } = DOWEL_PINS[size]!;
  const R = d / 2;
  const frustum = (Math.PI * c * (R * R + R * (R - c) + (R - c) ** 2)) / 3;
  return Math.PI * R * R * L - 2 * (Math.PI * R * R * c - frustum);
};
const washerVolume = (size: string) => {
  const { d1, d2, h } = WASHERS[size]!;
  return Math.PI * ((d2 / 2) ** 2 - (d1 / 2) ** 2) * h;
};

describe('the cup point set screw', () => {
  it.each(standardSizes('setScrew'))('%s rebuilds with the actual cup and socket volume', (size) => {
    const { d, s, t, cup } = SET_SCREWS[size]!;
    const doc = standardPartDoc({ kind: 'setScrew', size, length: 20 });
    expect(problems(doc)).toEqual([]);
    const body = rebuild(doc).body!;
    for (const name of Object.values(STANDARD_FACES.setScrew)) expect(body.names.faces).toContain(name);
    const expected = Math.PI * d * d / 4 * 20 - Math.sqrt(3) / 2 * s * s * t - Math.PI * (cup / 2) ** 2 * (cup / (2 * Math.sqrt(3))) / 3;
    expect(volumeOf(doc)).toBeCloseTo(expected, 5);
    expect(standardName({ kind: 'setScrew', size, length: 20 })).toBe(`ISO 4029 ${size}x20`);
  });
  it('rebuilds 100 seeded size and length combinations without failure', () => {
    let seed = 4029;
    const sizes = standardSizes('setScrew');
    const lengths = standardLengths('setScrew');
    for (let i = 0; i < 100; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const size = sizes[seed % sizes.length]!;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const length = lengths[seed % lengths.length]!;
      const regen = new Regenerator(kernel, solver);
      const result = regen.rebuild(standardPartDoc({ kind: 'setScrew', size, length }));
      expect(statuses(result).filter((status) => !status.endsWith('=ok'))).toEqual([]);
      expect(kernel.massProps(result.body!.shape).volume).toBeGreaterThan(0);
      regen.dispose();
    }
  });
  it('rejects invalid and intersecting lengths', () => {
    for (const length of [0, -1, NaN, Infinity, 1, 5]) expect(standardProblem({ kind: 'setScrew', size: 'M8', length })).not.toBeNull();
  });
});

describe('the socket head cap screw, ISO 4762', () => {
  it.each(standardSizes('socketScrew'))('%s x 20: no problem, valid, the volume of head + shank less the hex socket', (size) => {
    const doc = standardPartDoc({ kind: 'socketScrew', size, length: 20 });
    expect(problems(doc)).toEqual([]);
    const r = rebuild(doc);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(screwVolume(size, 20), 6);
  });

  it('is as long as asked: M6 from 10 to 80', () => {
    for (const L of [10, 35, 80]) expect(volumeOf(standardPartDoc({ kind: 'socketScrew', size: 'M6', length: L }))).toBeCloseTo(screwVolume('M6', L), 6);
  });

  it('stands with its head underside at the origin, the shank below it and the head above, as high as the table says', () => {
    const r = rebuild(standardPartDoc({ kind: 'socketScrew', size: 'M8', length: 30 }));
    const b = kernel.bounds(r.body!.shape);
    expect([b.min[1], b.max[1]]).toEqual([expect.closeTo(-30, 6), expect.closeTo(8, 6)]);
    expect(b.max[0]).toBeCloseTo(6.5, 6); // the head, Ø13
  });
});

describe('the dowel pin, ISO 8734', () => {
  it.each(standardSizes('dowelPin'))('Ø%s x 24: no problem, valid, a cylinder with a chamfer at each end', (size) => {
    const doc = standardPartDoc({ kind: 'dowelPin', size, length: 24 });
    expect(problems(doc)).toEqual([]);
    const r = rebuild(doc);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(pinVolume(size, 24), 6);
  });

  it('hangs from its top: the origin is the middle of the top face, the pin below it', () => {
    const b = kernel.bounds(rebuild(standardPartDoc({ kind: 'dowelPin', size: '6', length: 20 })).body!.shape);
    expect([b.min[1], b.max[1]]).toEqual([expect.closeTo(-20, 6), expect.closeTo(0, 6)]);
    expect(b.max[0]).toBeCloseTo(3, 6);
  });
});

describe('the plain washer, ISO 7089', () => {
  it.each(standardSizes('washer'))('%s: no problem, valid, a ring', (size) => {
    const doc = standardPartDoc({ kind: 'washer', size });
    expect(problems(doc)).toEqual([]);
    const r = rebuild(doc);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(washerVolume(size), 6);
  });
});

describe('what the library hands over', () => {
  const specs: StandardSpec[] = [{ kind: 'socketScrew', size: 'M6', length: 20 }, { kind: 'dowelPin', size: '6', length: 20 }, { kind: 'washer', size: 'M6' }];

  it('names the parts as the standards write them, and says the same in the part number', () => {
    expect(specs.map(standardName)).toEqual(['ISO 4762 M6x20', 'ISO 8734 6m6x20', 'ISO 7089 M6']);
    const doc = standardPartDoc(specs[0]!);
    expect(doc.properties['料號']).toBe('ISO 4762 M6x20');
    expect(doc.properties.Standard).toBe('ISO 4762');
    expect(doc.material).toMatchObject({ id: 'steel', density: 7.85 });
  });

  it('has the dimensions as variables, so a size is edited like any part: a screw 5 mm longer, a washer thicker', () => {
    const doc = standardPartDoc(specs[0]!);
    expect(doc.variables.map((v) => [v.name, v.expr])).toEqual([['d', '6'], ['dk', '10'], ['k', '6'], ['L', '20'], ['s', '5'], ['t', '3']]);
    const longer = applyCommand(doc, { type: 'setVariable', id: 'var_L', expr: '25' });
    expect(problems(longer)).toEqual([]);
    expect(volumeOf(longer)).toBeCloseTo(screwVolume('M6', 25), 6);
    const thick = applyCommand(standardPartDoc(specs[2]!), { type: 'setVariable', id: 'var_h', expr: '3' });
    expect(volumeOf(thick)).toBeCloseTo(Math.PI * (36 - 10.24) * 3, 6);
  });

  it('is saved and read back as the same part', () => {
    for (const spec of specs) {
      const doc = standardPartDoc(spec);
      expect(parsePart(serializePart(doc))).toEqual(doc);
    }
  });

  it('says why a size or a length is refused', () => {
    expect(standardProblem({ kind: 'socketScrew', size: 'M7', length: 20 })).toContain('M7');
    expect(standardProblem({ kind: 'dowelPin', size: '7', length: 20 })).toContain('7');
    expect(standardProblem({ kind: 'dowelPin', size: '6' })).toContain('長度');
    expect(standardProblem({ kind: 'socketScrew', size: 'M6', length: -1 })).toContain('長度');
    expect(standardProblem({ kind: 'washer', size: 'M6' })).toBeNull();
    expect(() => standardPartDoc({ kind: 'washer', size: 'M7' })).toThrow(/M7/);
  });

  it('offers the sizes and lengths of each kind', () => {
    expect(standardSizes('socketScrew')).toEqual(['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12']);
    expect(standardSizes('dowelPin')).toEqual(['2', '3', '4', '5', '6', '8', '10']);
    expect(standardLengths('washer')).toEqual([]);
    expect(standardLengths('socketScrew')).toContain(20);
  });

  it('writes a STEP file that reads back to the same volume, for every kind', () => {
    for (const spec of specs) {
      const r = rebuild(standardPartDoc(spec));
      const back = kernel.importStep(kernel.exportStep(r.body!.shape, standardName(spec)));
      try {
        expect(kernel.massProps(back.shape).volume).toBeCloseTo(kernel.massProps(r.body!.shape).volume, 6);
      } finally {
        kernel.release(back.shape);
      }
    }
  });
});

describe('the faces by name, in mates', () => {
  const part = (spec: StandardSpec) => {
    const r = rebuild(standardPartDoc(spec));
    return { mate: { topology: r.body!.topology, names: r.body!.names, frames: r.frames } as MatePart, names: r.body!.names.faces };
  };
  let screw: ReturnType<typeof part>;
  let washer: ReturnType<typeof part>;
  let pin: ReturnType<typeof part>;
  beforeAll(() => {
    screw = part({ kind: 'socketScrew', size: 'M6', length: 20 });
    washer = part({ kind: 'washer', size: 'M6' });
    pin = part({ kind: 'dowelPin', size: '6', length: 20 });
  });

  it('every named face is there', () => {
    for (const name of Object.values(STANDARD_FACES.socketScrew)) expect(screw.names).toContain(name);
    for (const name of Object.values(STANDARD_FACES.washer)) expect(washer.names).toContain(name);
    for (const name of Object.values(STANDARD_FACES.dowelPin)) expect(pin.names).toContain(name);
    // the hex socket has faces of its own, named after the cut
    expect(screw.names.filter((n) => n.startsWith('cut1:'))).toHaveLength(7);
  });

  it('a screw through a washer: the shank in the bore, the head underside on the washer\'s top; the screw ends up 1.6 above the washer\'s underside', () => {
    const mates: Mate[] = [
      { id: 'm1', name: '同軸心', type: 'concentric', a: { component: 'w', ref: { kind: 'face', name: STANDARD_FACES.washer.bore } }, b: { component: 's', ref: { kind: 'face', name: STANDARD_FACES.socketScrew.shank } }, suppressed: false },
      { id: 'm2', name: '重合', type: 'coincident', a: { component: 'w', ref: { kind: 'face', name: STANDARD_FACES.washer.top } }, b: { component: 's', ref: { kind: 'face', name: STANDARD_FACES.socketScrew.under } }, align: 'antiAligned', suppressed: false },
    ];
    let doc: AssemblyDoc = createEmptyAssembly();
    doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'f1', path: 'w.3dbx' }, component: { id: 'w', file: 'f1', instance: 1, fixed: true, placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } } });
    doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'f2', path: 's.3dbx' }, component: { id: 's', file: 'f2', instance: 1, fixed: false, placement: { position: [1.5, 7, -2], rotation: [0, 0, 0, 1] } } });
    for (const m of mates) doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: m });
    const solved = solveAssembly(doc, (id) => (id === 'w' ? washer.mate : screw.mate));
    expect([...solved.mates.values()].map((m) => m.status)).toEqual(['ok', 'ok']);
    const at = transformPoint(solved.poses.get('s')!, [0, 0, 0]);
    expect(at[0]).toBeCloseTo(0, 6);
    expect(at[1]).toBeCloseTo(1.6, 6);
    expect(at[2]).toBeCloseTo(0, 6);
  });
});
