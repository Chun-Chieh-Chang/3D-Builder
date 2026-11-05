/** Feasibility probe only. Native section/offset/prism; no product command or UI is added. */
import { beforeAll, afterAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TopoDS_Shape, TopoDS_Wire } from 'libcascade/single/init';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { gearArea } from '../phase3/gear-helpers';

let kernel: Kernel;
const frame: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
// Existing spike tests also expose handles. This experiment must not become a second product API.
const raw = () => kernel as unknown as { get(id: ShapeId): TopoDS_Shape; put(shape: TopoDS_Shape): ShapeId };
const reports: Record<string, unknown>[] = [];
const heap = () => (kernel.oc as unknown as { wasmMemory: WebAssembly.Memory }).wasmMemory.buffer.byteLength;
let initialHeap: number;
beforeAll(async () => { kernel = await Kernel.load(); initialHeap = heap(); expect(initialHeap).toBeGreaterThan(0); });
afterAll(() => {
  const path = resolve('out/section-clearance'); mkdirSync(path, { recursive: true });
  writeFileSync(resolve(path, 'probe.json'), JSON.stringify({ initialHeap, finalHeap: heap(), reports }, null, 2));
});

function probe(id: ShapeId, z: number, gap: number, height = 3) {
  if (![z, gap, height].every(Number.isFinite) || gap < 0 || height <= 0) throw Error('finite z, nonnegative gap and positive height required');
  const arena = new Arena(), { oc } = kernel;
  const made: ShapeId[] = [];
  try {
    const point = arena.own(new oc.gp_Pnt(0, 0, z));
    const plane = arena.own(new oc.gp_Pln(point, arena.own(new oc.gp_Dir(0, 0, 1))));
    const section = arena.own(new oc.BRepAlgoAPI_Section(raw().get(id), plane, true));
    if (!section.IsDone()) throw Error('section not done');
    const shape = arena.own(section.Shape());
    const edges = ShapeIndex.of(oc, shape, 'TopAbs_EDGE', arena);
    try {
      if (!edges.size) throw Error('empty section');
      const sequence = arena.own(new oc.NCollection_HSequence_TopoDS_Shape());
      for (const e of edges.keys) sequence.Append(e);
      const connected = arena.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(sequence, 1e-7, false));
      const wires = arena.own(connected.Sequence());
      const area = (w: TopoDS_Wire) => {
        const face = arena.own(new oc.BRepBuilderAPI_MakeFace(w, true));
        if (!face.IsDone()) throw Error('cannot build planar face');
        const props = arena.own(new oc.GProp_GProps());
        oc.BRepGProp.SurfaceProperties(arena.own(face.Face()), props, 1e-10, false);
        return props.Mass();
      };
      const loops = [];
      let joinedEdges = 0;
      for (let i = 1; i <= wires.Length(); i++) {
        const wire = arena.own(oc.TopoDS.Wire(arena.own(wires.Value(i))));
        if (!oc.BRep_Tool.IsClosed(wire)) throw Error('open section wire');
        const members = ShapeIndex.of(oc, wire, 'TopAbs_EDGE', arena);
        try { joinedEdges += members.size; } finally { members.dispose(); }
        const sourceArea = area(wire);
        let expanded = wire;
        if (gap > 0) {
          const candidates: { wire: TopoDS_Wire; area: number }[] = [];
          const diagnostic: unknown[] = [];
          const support = arena.own(new oc.BRepBuilderAPI_MakeFace(plane, wire, true));
          if (!support.IsDone()) throw Error('offset support face failed');
          const supportFace = arena.own(support.Face());
          for (const sign of [-1, 1]) {
            const offset = arena.own(new oc.BRepOffsetAPI_MakeOffset(supportFace, oc.GeomAbs_JoinType.GeomAbs_Arc, false));
            offset.Perform(sign * gap);
            if (!offset.IsDone()) { diagnostic.push({ sign, done: false }); continue; }
            const offsets = ShapeIndex.of(oc, arena.own(offset.Shape()), 'TopAbs_WIRE', arena);
            try {
              diagnostic.push({ sign, count: offsets.size });
              if (offsets.size === 1) {
                const w = arena.own(oc.TopoDS.Wire(offsets.keys[0]!));
                diagnostic.push({ sign, closed: oc.BRep_Tool.IsClosed(w), area: area(w), sourceArea });
                if (oc.BRep_Tool.IsClosed(w)) candidates.push({ wire: w, area: area(w) });
              }
            } finally { offsets.dispose(); }
          }
          const larger = candidates.filter(c => c.area > sourceArea + 1e-9).sort((a, b) => a.area - b.area)[0];
          if (!larger) throw Error(`no single closed expanding offset: ${JSON.stringify(diagnostic)}`);
          expanded = larger.wire;
        }
        const face = arena.own(new oc.BRepBuilderAPI_MakeFace(expanded, true));
        const prism = arena.own(new oc.BRepPrimAPI_MakePrism(arena.own(face.Face()), arena.own(new oc.gp_Vec(0, 0, height)), false, true));
        const solid = raw().put(prism.Shape()); made.push(solid);
        expect(kernel.isValid(solid)).toBe(true); expect(kernel.solidCount(solid)).toBe(1);
        const offsetArea = area(expanded), volume = kernel.massProps(solid).volume;
        if (Math.abs(volume / height - offsetArea) >= 1e-6) {
          const adaptiveVolume = kernel.massProps(solid, { eps: 1e-9 }).volume;
          const faces = ShapeIndex.of(oc, raw().get(solid), 'TopAbs_FACE', arena);
          const surfaces = new Set<string>();
          try { for (const face of faces.keys) surfaces.add(String(arena.own(new oc.BRepAdaptor_Surface(arena.own(oc.TopoDS.Face(face)), true)).GetType())); }
          finally { faces.dispose(); }
          throw Error(`section prism area/volume disagree: ${JSON.stringify({ z, gap, offsetArea, volume, adaptiveVolume, height, surfaces: [...surfaces] })}`);
        }
        const source = raw().put(wire.Oriented(wire.Orientation())); made.push(source);
        const target = raw().put(expanded.Oriented(expanded.Orientation())); made.push(target);
        const distance = kernel.distance(source, target).distance;
        expect(Math.abs(distance - gap)).toBeLessThan(1e-6);
        // Native curve samples: a valid face and a minimum distance alone cannot prove a constant gap.
        const outEdges = ShapeIndex.of(oc, expanded, 'TopAbs_EDGE', arena);
        let maxGapError = 0, samples = 0;
        try {
          for (const e of outEdges.keys) {
            const curve = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(e))));
            for (const t of [0, 0.25, 0.5, 0.75, 1]) {
              const p = arena.own(curve.Value(curve.FirstParameter() + t * (curve.LastParameter() - curve.FirstParameter())));
              const vertex = kernel.makeVertex([p.X(), p.Y(), p.Z()]);
              try { maxGapError = Math.max(maxGapError, Math.abs(kernel.distance(vertex, source).distance - gap)); samples++; }
              finally { kernel.release(vertex); }
            }
          }
        } finally { outEdges.dispose(); }
        expect(samples).toBeGreaterThan(0); expect(maxGapError).toBeLessThan(1e-5);
        loops.push({ sourceArea, offsetArea, volume, distance, maxGapError, samples });
      }
      if (!loops.length) throw Error('no closed wires');
      expect(joinedEdges).toBe(edges.size);
      return { z, gap, height, edges: edges.size, loops };
    } finally { edges.dispose(); }
  } finally { for (const id of made) kernel.release(id); arena.dispose(); }
}

const circle = (r: number): Region => ({ outer: [{ kind: 'circle', c: [0, 0], r, source: 'circle' }], holes: [] });
it('sections an analytic cylinder and measures rounded clearance and prism volume', () => {
  const id = kernel.extrude(frame, [circle(10)], [0, 0, 8]).shape;
  try {
    for (const gap of [0, 0.05, 0.2, 1]) {
      const result = probe(id, 4, gap); reports.push({ model: 'cylinder', ...result });
      expect(result.loops).toHaveLength(1);
      expect(Math.abs(result.loops[0]!.offsetArea - Math.PI * (10 + gap) ** 2)).toBeLessThan(1e-6);
    }
    expect(() => probe(id, 20, 0.2)).toThrow('empty section');
    for (const gap of [-1, NaN, Infinity]) expect(() => probe(id, 4, gap)).toThrow('finite');
  } finally { kernel.release(id); }
  expect(kernel.liveShapes).toBe(0);
});

it('preserves two native section loops in an annulus, without claiming hole semantics are solved', () => {
  const region = circle(10); region.holes = [[{ kind: 'circle', c: [0, 0], r: 3, source: 'hole' }]];
  const id = kernel.extrude(frame, [region], [0, 0, 8]).shape;
  try {
    const result = probe(id, 4, 0.2); expect(result.loops).toHaveLength(2);
    reports.push({ model: 'annulus-independent-loops', limitation: 'Each loop expanded separately; not a material region with holes.', ...result });
  } finally { kernel.release(id); }
  expect(kernel.liveShapes).toBe(0);
});

it.each([0, 0.05, 0.2])('records spline limitation at gap %s as unsupported, never as feature success', (gap) => {
  const parameters = { kind: 'gear' as const, module: 1, teeth: 24, pressureAngle: 20 * Math.PI / 180, width: 5, bore: 0, backlash: 0, baseHeight: 0 };
  const region = toothedProfile(parameters);
  const id = kernel.extrude(frame, [region], [0, 0, 5]).shape;
  try {
    const step = kernel.exportStep(id, 'section-probe-gear');
    const path = resolve('out/section-clearance'); mkdirSync(path, { recursive: true });
    writeFileSync(resolve(path, 'involute-gear.step'), step);
    const imported = kernel.importStep(step).shape;
    try {
      let failure = '';
      const z = gap === 0 ? 1.25 : 2.5;
      try { probe(imported, z, gap); } catch (e) { failure = String(e); }
      expect(failure).toContain(gap === 0 ? 'section prism area/volume disagree' : 'no single closed expanding offset');
      reports.push({ model: 'involute-gear-step', z, gap, analyticSourceArea: gearArea(parameters), status: 'unsupported', failure });
    } finally { kernel.release(imported); }
  } finally { kernel.release(id); }
  expect(kernel.liveShapes).toBe(0);
});

it('roundtrips a synthetic rack STEP, then measures three tooth-height sections with clearance', () => {
  const region = toothedProfile({ kind: 'rack', module: 1, teeth: 8, pressureAngle: 20 * Math.PI / 180, width: 5, bore: 0, backlash: 0, baseHeight: 3 });
  const source = kernel.extrude(frame, [region], [0, 0, 5]).shape;
  const step = kernel.exportStep(source, 'section-probe-rack');
  const path = resolve('out/section-clearance'); mkdirSync(path, { recursive: true });
  writeFileSync(resolve(path, 'rack.step'), step);
  const imported = kernel.importStep(step);
  try {
    for (const z of [1.25, 2.5, 3.75]) {
      const result = probe(imported.shape, z, 0.2); expect(result.loops).toHaveLength(1);
      reports.push({ model: 'rack-step', ...result });
    }
  } finally { kernel.release(imported.shape); kernel.release(source); }
  expect(kernel.liveShapes).toBe(0);
});

it('fuzzes 100 analytic STEP cylinders with measured section area, clearance and extrusion', () => {
  let seed = 238;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const startHeap = heap(); expect(startHeap).toBeGreaterThan(0);
  let maxAreaError = 0, maxGapError = 0;
  for (let i = 0; i < 100; i++) {
    const radius = 0.5 + 20 * random(), height = 0.5 + 10 * random(), gap = 0.001 + 0.4 * random();
    const source = kernel.extrude(frame, [circle(radius)], [0, 0, height]).shape;
    let imported: ShapeId | undefined;
    try {
      imported = kernel.importStep(kernel.exportStep(source, `fuzz-${i}`)).shape;
      const result = probe(imported, height * (0.1 + 0.8 * random()), gap, 0.5 + random());
      expect(result.loops).toHaveLength(1);
      const error = Math.abs(result.loops[0]!.offsetArea - Math.PI * (radius + gap) ** 2);
      expect(error, `case ${i}`).toBeLessThan(1e-6);
      maxAreaError = Math.max(maxAreaError, error); maxGapError = Math.max(maxGapError, result.loops[0]!.maxGapError);
    } finally { if (imported !== undefined) kernel.release(imported); kernel.release(source); }
    expect(kernel.liveShapes).toBe(0);
  }
  reports.push({ model: '100-seeded-step-cylinders', maxAreaError, maxGapError, startHeap, endHeap: heap(), note: 'Heap is measured, not claimed leak-free; no spline stress coverage.' });
});
