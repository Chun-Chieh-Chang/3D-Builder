// Phase 3a-6b: what MakePipeShell tells us about a sweep along a path of lines and arcs (C4.4), before the feature is built on it.
// Questions: (1) is there one face per profile edge per path edge, in path order? (2) what does Generated(path edge) say?
// (3) are the caps the first and last shapes? (4) do the volumes match Pappus for S-curves, offset and tilted profiles, closed paths?
// Run: node spikes/occt-gaps/phase3-sweep.mjs
import { createInstance } from 'libcascade/single/init';

const oc = await createInstance({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const progress = () => new oc.Message_ProgressRange();
const volume = (s) => {
  const p = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(s, p, false, false, false);
  return p.Mass();
};
const valid = (s) => new oc.BRepCheck_Analyzer(s, true, false, false).IsValid();
const indexOf = (s, type) => {
  const m = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  oc.TopExp.MapShapes(s, type, m);
  return m;
};
const keysOf = (s, type) => {
  const m = indexOf(s, type);
  const out = [];
  for (let i = 1; i <= m.Extent(); i++) out.push(m.FindKey(i));
  return out;
};
const list = (l) => {
  const out = [];
  const copy = new oc.NCollection_List_TopoDS_Shape(l);
  while (!copy.IsEmpty()) {
    out.push(copy.First());
    copy.RemoveFirst();
  }
  return out;
};
const centroid = (s) => {
  const p = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(s, p, false, false);
  const c = p.CentreOfMass();
  return [c.X(), c.Y(), c.Z()];
};
const P = (x, y, z = 0) => new oc.gp_Pnt(x, y, z);
const D = (x, y, z) => new oc.gp_Dir(new oc.gp_Vec(x, y, z));
const results = [];
const report = (id, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} — ${detail}`);
};
const guarded = (id, fn) => {
  try {
    fn();
  } catch (e) {
    let msg = String(e);
    try {
      msg = oc.getExceptionMessage(e).join(' / ');
    } catch {}
    report(id, false, `exception: ${msg}`);
  }
};

const lineEdge = (a, b) => new oc.BRepBuilderAPI_MakeEdge(P(...a), P(...b)).Edge();
/** An arc in the XY plane about `c`, from angle a0 to a1 (radians, counter-clockwise). */
const arcEdge = (c, r, a0, a1) => new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(new oc.gp_Ax2(P(c[0], c[1], 0), D(0, 0, 1), D(1, 0, 0)), r), a0, a1).Edge();
const wireOf = (edges) => {
  const mw = new oc.BRepBuilderAPI_MakeWire();
  for (const e of edges) {
    mw.Add(e);
    if (!mw.IsDone()) throw new Error('wire');
  }
  return mw.Wire();
};
/** A closed polygon in a plane through `o` spanned by unit vectors u and v. */
const polygon = (o, u, v, pts) => {
  const at = (p) => [o[0] + u[0] * p[0] + v[0] * p[1], o[1] + u[1] * p[0] + v[1] * p[1], o[2] + u[2] * p[0] + v[2] * p[1]];
  return wireOf(pts.map((p, i) => lineEdge(at(p), at(pts[(i + 1) % pts.length]))));
};

function sweep(spine, profile, mode = 'corrected') {
  const mk = new oc.BRepOffsetAPI_MakePipeShell(spine);
  if (mode === 'corrected') mk.SetMode(false);
  else if (mode === 'frenet') mk.SetMode(true);
  mk.Add(profile, false, false);
  mk.Build(progress());
  const ok = mk.IsReady() && mk.MakeSolid();
  return { mk, ok, out: mk.Shape() };
}

// ---------------------------------------------------------------- W1: rectangle along line(30) + quarter arc (R=10, turns left) + line(20)
// path in XY: (0,0)->(30,0), arc centre (30,10) from -90deg to 0deg, (40,10)->(40,30). Profile in the YZ plane at x=0: y in [-3,3], z in [-2,2]
guarded('W1', () => {
  const e1 = lineEdge([0, 0, 0], [30, 0, 0]);
  const e2 = arcEdge([30, 10], 10, -Math.PI / 2, 0);
  const e3 = lineEdge([40, 10, 0], [40, 30, 0]);
  const spine = wireOf([e1, e2, e3]);
  const spineEdges = keysOf(spine, T.TopAbs_EDGE);
  const profile = polygon([0, 0, 0], [0, 1, 0], [0, 0, 1], [[-3, -2], [3, -2], [3, 2], [-3, 2]]);
  const profEdges = keysOf(profile, T.TopAbs_EDGE);
  const { mk, ok, out } = sweep(spine, profile);
  // the profile is centred on the path: Pappus = area * path length
  const expected = 24 * (30 + (Math.PI / 2) * 10 + 20);
  const gens = profEdges.map((e) => list(mk.Generated(e)));
  const faces = keysOf(out, T.TopAbs_FACE);
  // which path edge does each generated face lie along? the nearest spine edge to the face's centroid is ambiguous; use the face's centroid x/y
  const where = gens.map((l) => l.map((f) => centroid(f).map((v) => +v.toFixed(2))));
  const bySpine = spineEdges.map((e) => list(mk.Generated(e)).length);
  const first = mk.FirstShape(), last = mk.LastShape();
  report('W1', ok && valid(out) && Math.abs(volume(out) - expected) / expected < 1e-6, `volume ${volume(out).toFixed(4)} (Pappus ${expected.toFixed(4)}); ${faces.length} faces; generated per profile edge ${gens.map((l) => l.length)}; Generated(path edge) counts ${bySpine}; caps ${first.IsNull() ? 'none' : 'start'}/${last.IsNull() ? 'none' : 'end'}`);
  console.log('      centroids per profile edge (path order expected: along +x, round the arc, up +y):');
  where.forEach((w, i) => console.log(`        edge ${i}: ${JSON.stringify(w)}`));
});

// ---------------------------------------------------------------- W2: S-curve (left arc then right arc), profile offset from the path
// arc A: centre (0,10) from -90deg to 0deg: (0,0)->(10,10), turns left. arc B: centre (20,10) from 180deg to 90deg (clockwise): (10,10)->(20,20), turns right.
guarded('W2', () => {
  const a = arcEdge([0, 10], 10, -Math.PI / 2, 0);
  const b = new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(new oc.gp_Ax2(P(20, 10, 0), D(0, 0, -1), D(-1, 0, 0)), 10), 0, Math.PI / 2).Edge();
  const spine = wireOf([a, b]);
  // profile in the plane x=0 (normal +x at the start: the path starts going +x). y in [-1, 3] (centroid y=+1: towards the centre of A), z in [-2, 2]
  const profile = polygon([0, 0, 0], [0, 1, 0], [0, 0, 1], [[-1, -2], [3, -2], [3, 2], [-1, 2]]);
  const { ok, out } = sweep(spine, profile);
  // centroid is d = 1 towards the centre of curvature on A (left), so on B (turning right) it is on the outside: radius 10 + 1
  const area = 16;
  const expected = area * ((Math.PI / 2) * (10 - 1) + (Math.PI / 2) * (10 + 1));
  report('W2', ok && valid(out) && Math.abs(volume(out) - expected) / expected < 1e-4, `volume ${volume(out).toFixed(4)} (Pappus ${expected.toFixed(4)}); valid ${valid(out)}`);
});

// ---------------------------------------------------------------- W3: profile tilted 30 degrees from the plane normal to the path (follow path keeps the angle)
guarded('W3', () => {
  const spine = wireOf([lineEdge([0, 0, 0], [40, 0, 0])]);
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  // the plane through the origin tilted about z: its normal is (c, s, 0); spanned by u=(-s,c,0) and v=(0,0,1)
  const profile = polygon([0, 0, 0], [-s, c, 0], [0, 0, 1], [[-2, -2], [2, -2], [2, 2], [-2, 2]]);
  const { ok, out } = sweep(spine, profile);
  // a tilted profile swept along a straight line: the prism's volume is the profile's projection onto the plane normal to the path times the length
  const area = 16 * c;
  const expected = area * 40;
  report('W3', ok && valid(out) && Math.abs(volume(out) - expected) / expected < 1e-6, `volume ${volume(out).toFixed(4)} (expected ${expected.toFixed(4)})`);
});

// ---------------------------------------------------------------- W4: closed path (a circle R=15), profile a square at its start point
guarded('W4', () => {
  const e = new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(new oc.gp_Ax2(P(0, 0, 0), D(0, 0, 1), D(1, 0, 0)), 15)).Edge();
  const spine = wireOf([e]);
  // start (15,0,0), going +y; profile plane x=15 spanned by y and z: y in [-2,2], z in [-2,2]
  const profile = polygon([15, 0, 0], [0, 1, 0], [0, 0, 1], [[-2, -2], [2, -2], [2, 2], [-2, 2]]);
  const { mk, ok, out } = sweep(spine, profile);
  const expected = 16 * 2 * Math.PI * 15;
  const first = mk.FirstShape(), last = mk.LastShape();
  const gens = keysOf(profile, T.TopAbs_EDGE).map((pe) => list(mk.Generated(pe)).length);
  report('W4', ok && valid(out) && Math.abs(volume(out) - expected) / expected < 1e-6, `volume ${volume(out).toFixed(4)} (Pappus ${expected.toFixed(4)}); ${keysOf(out, T.TopAbs_FACE).length} faces; generated per profile edge ${gens}; first/last shape null: ${first.IsNull()}/${last.IsNull()}`);
});

// ---------------------------------------------------------------- W5: a U-shaped path whose far end comes back near the profile: does the profile stay at the start?
guarded('W5', () => {
  const e1 = lineEdge([0, 0, 0], [30, 0, 0]);
  const e2 = new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(new oc.gp_Ax2(P(30, 10, 0), D(0, 0, 1), D(0, -1, 0)), 10), 0, Math.PI).Edge();
  const e3 = lineEdge([30, 20, 0], [0.5, 20, 0]);
  const spine = wireOf([e1, e2, e3]);
  const profile = polygon([0, 0, 0], [0, 1, 0], [0, 0, 1], [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  const { mk, ok, out } = sweep(spine, profile);
  const first = mk.FirstShape();
  const c0 = centroid(first);
  report('W5', ok && valid(out) && Math.abs(c0[0]) < 1e-6, `volume ${volume(out).toFixed(4)} (4*(30+10*pi+29.5) = ${(4 * (30 + 10 * Math.PI + 29.5)).toFixed(4)}); first cap centroid ${c0.map((v) => v.toFixed(3))}; valid ${valid(out)}`);
});

// ---------------------------------------------------------------- W6: profile with an arc edge (a "D" shape) along a straight path: faces per edge
guarded('W6', () => {
  const spine = wireOf([lineEdge([0, 0, 0], [25, 0, 0]), lineEdge([25, 0, 0], [25, 25, 0])]);
  // D: a line along y from (-2,-3) to (-2,3) in (y,z) plane, then a half circle (radius 3, centre (-2,0)) bulging to +y... build as edges in the plane x=0
  const l = lineEdge([0, -2, -3], [0, -2, 3]);
  const arc = new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(new oc.gp_Ax2(P(0, -2, 0), D(1, 0, 0), D(0, 0, 1)), 3), 0, Math.PI).Edge();
  // arc from angle 0 (point (0,-2,3) given xDir=(0,0,1)) to pi (point (0,-2,-3)) passing angle pi/2 = ydir = normal x xDir = (1,0,0)x(0,0,1) = (0,-1,0)... check below
  const profile = wireOf([l, arc]);
  const { mk, ok, out } = sweep(spine, profile);
  const gens = keysOf(profile, T.TopAbs_EDGE).map((pe) => list(mk.Generated(pe)).length);
  report('W6', ok && valid(out), `volume ${volume(out).toFixed(4)}; ${keysOf(out, T.TopAbs_FACE).length} faces; generated per profile edge ${gens}`);
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
