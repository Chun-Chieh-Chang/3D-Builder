// T-0 spike: can libcascade 3.0.2 (OCCT 8.0.1) build real screw threads (helical sweep + boolean) reliably enough to become a feature?
// Not part of the product, not in `npm test`. Run: node spikes/occt-gaps/thread.mjs
//
// Method: the profile (a polygon in an axial plane) is swept along a helix drawn on a cylindrical or conical surface (a 2D line in the (angle, height)
// parameter space + BRepLib.BuildCurves3d), with the binormal fixed to the axis so the profile keeps its axial plane. The sweep is longer than the thread
// asked for; a Common with the bounding cylinder trims it to the exact length. Multi-start = the same sweep turned by 360°/N. A tooth is fused to the core,
// a groove is cut from the block.
//
// Acceptance (every case): valid solid without ShapeFix; volume of the result against the closed form (Guldin: dV = A · r_centroid · dθ) within 0.5 %;
// flank positions probed with a solid classifier within 0.003 mm (this also proves the lead, the hand and the offset of every start); boolean time ≤ 5 s;
// STEP round trip with a volume difference < 1e-6; mesh ≤ 3 s and ≤ 200 000 triangles.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createInstance } = await import('libcascade/single/init');
const oc = await createInstance({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const progress = () => new oc.Message_ProgressRange();
const TAU = Math.PI * 2;
const now = () => performance.now();
const PHASE_SIGN = process.env.MUTATE_PHASE ? -1 : 1; // mutation test: with the wrong sign the phase case must FAIL

const volume = (s) => {
  const p = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(s, p, false, false, false);
  return p.Mass();
};
const valid = (s) => new oc.BRepCheck_Analyzer(s, true, false, false).IsValid();
const gpAx3 = (z) => new oc.gp_Ax3(new oc.gp_Pnt(0, 0, z), new oc.gp_Dir(0, 0, 1), new oc.gp_Dir(1, 0, 0));
const bool = (Op, a, b) => {
  const op = new Op(a, b, progress());
  op.Build(progress());
  if (op.HasErrors?.()) throw new Error('boolean reported errors');
  return op.Shape();
};
const cylinder = (r, z0, z1) => new oc.BRepPrimAPI_MakeCylinder(gpAx3(z0).Ax2(), r, z1 - z0).Shape();
const cone = (rAtZ0, alpha, z0, z1) => {
  const r1 = rAtZ0 + (z1 - z0) * Math.tan(alpha);
  return new oc.BRepPrimAPI_MakeCone(gpAx3(z0).Ax2(), rAtZ0, r1, z1 - z0).Shape();
};
const rotateZ = (s, a) => {
  const t = new oc.gp_Trsf();
  t.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1)), a);
  return new oc.BRepBuilderAPI_Transform(s, t, true, false).Shape();
};

// ---- profile: a polygon in the XZ plane. Narrows outward from the radius `rb` (base width wb, height h, flank angles a1/a2 from the radial direction),
// continued `e` inwards (past rb) so the tool overlaps the core or the void and the boolean never meets a coincident face.
function profilePoints({ wb, h, a1, a2, e }) {
  const t1 = Math.tan(a1);
  const t2 = Math.tan(a2);
  return [
    [-e, -wb / 2 - e * t1],
    [-e, wb / 2 + e * t2],
    [h, wb / 2 - h * t2],
    [h, -wb / 2 + h * t1],
  ]; // [radial offset from rb, axial offset]
}
const clipOutward = (pts) => {
  // keeps radial offset >= 0 (Sutherland-Hodgman, one half plane)
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const pin = p[0] >= 0;
    const qin = q[0] >= 0;
    if (pin) out.push(p);
    if (pin !== qin) {
      const k = (0 - p[0]) / (q[0] - p[0]);
      out.push([0, p[1] + k * (q[1] - p[1])]);
    }
  }
  return out;
};
const areaCentroid = (pts) => {
  let a = 0;
  let cx = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    const w = x0 * z1 - x1 * z0;
    a += w;
    cx += (x0 + x1) * w;
  }
  a /= 2;
  return { area: Math.abs(a), cx: cx / (6 * a) };
};

// ---- helix on a cylinder (alpha = 0) or a cone (half angle alpha), starting at (radius, 0, zs). hand = +1 right, -1 left.
function helixWire({ radius, alpha, lead, turns, hand, zs }) {
  const A3 = gpAx3(zs);
  const surface = alpha === 0 ? new oc.Geom_CylindricalSurface(A3, radius) : new oc.Geom_ConicalSurface(A3, alpha, radius);
  const dv = lead / Math.cos(alpha); // along the generatrix per turn
  const speed = Math.hypot(TAU, dv);
  const line = new oc.Geom2d_Line(new oc.gp_Pnt2d(0, 0), new oc.gp_Dir2d(hand * TAU, dv));
  const edge = new oc.BRepBuilderAPI_MakeEdge(line, surface, 0, turns * speed).Edge();
  if (!oc.BRepLib.BuildCurves3d(edge)) throw new Error('BuildCurves3d failed');
  return new oc.BRepBuilderAPI_MakeWire(edge).Wire();
}
function sweepOne({ prof, rbAt, alpha, lead, hand, zFrom, zTo }) {
  const margin = lead;
  const zs = zFrom - margin;
  const turns = (zTo - zFrom + 2 * margin) / lead;
  const rb = rbAt(zs);
  const spine = helixWire({ radius: rb, alpha, lead, turns, hand, zs });
  const poly = new oc.BRepBuilderAPI_MakePolygon();
  for (const [dr, dz] of profilePoints(prof)) poly.Add(new oc.gp_Pnt(rb + dr, 0, zs + dz));
  poly.Close();
  const mk = new oc.BRepOffsetAPI_MakePipeShell(spine);
  mk.SetMode(new oc.gp_Dir(0, 0, 1)); // binormal = the axis
  mk.Add(poly.Wire(), false, false);
  mk.Build(progress());
  if (!mk.IsReady() || !mk.MakeSolid()) throw new Error('pipe shell: no solid');
  let s = mk.Shape();
  if (volume(s) < 0) s = s.Reversed();
  return s;
}

// ---- probes
const state = (shape, [r, th, z]) => {
  const c = new oc.BRepClass3d_SolidClassifier(shape, new oc.gp_Pnt(r * Math.cos(th), r * Math.sin(th), z), 1e-7);
  return String(c.State()).replace('TopAbs_', ''); // IN / OUT / ON
};

function runCase(c) {
  const out = { id: c.id, name: c.name, checks: [] };
  const check = (label, pass, detail) => out.checks.push({ label, pass, detail });
  const alpha = c.alpha ?? 0;
  const tan = Math.tan(alpha);
  const rbAt = (z) => c.rb + z * tan;
  const zFrom = c.z0 ?? c.zBody0;
  const zTo = c.z1 ?? c.zBody1;
  const pitch = c.lead / c.starts;
  let tBool = 0;
  try {
    // tool: all starts, trimmed to [zFrom, zTo]
    const trim = cylinder(c.outer + 5, zFrom, zTo);
    const tools = [];
    const base = sweepOne({ prof: c.prof, rbAt, alpha, lead: c.lead, hand: c.hand, zFrom, zTo });
    const tt = now();
    for (let i = 0; i < c.starts; i++) {
      const phi = (c.phase ?? 0) + (TAU * i) / c.starts;
      tools.push(bool(oc.BRepAlgoAPI_Common, rotateZ(base, phi), trim));
    }
    tBool += now() - tt;
    for (const [i, t] of tools.entries()) check(`start ${i + 1} tool valid`, valid(t), `volume ${volume(t).toFixed(5)}`);
    // core / block
    let body = alpha === 0 ? cylinder(c.rb, c.zBody0, c.zBody1) : cone(rbAt(c.zBody0), alpha, c.zBody0, c.zBody1);
    if (c.mode === 'cut') {
      const solid = cylinder(c.outer, c.zBody0, c.zBody1);
      body = bool(oc.BRepAlgoAPI_Cut, solid, alpha === 0 ? cylinder(c.rb, c.zBody0 - 1, c.zBody1 + 1) : cone(rbAt(c.zBody0 - 1), alpha, c.zBody0 - 1, c.zBody1 + 1));
    }
    const v0 = volume(body);
    const t0 = now();
    let result = body;
    for (const t of tools) result = bool(c.mode === 'cut' ? oc.BRepAlgoAPI_Cut : oc.BRepAlgoAPI_Fuse, result, t);
    tBool += now() - t0;
    out.boolMs = tBool;
    out.result = result;

    check('result valid (BRepCheck)', valid(result), `solids ${(() => { const m = []; const e = new oc.TopExp_Explorer(result, T.TopAbs_SOLID, T.TopAbs_SHAPE); for (; e.More(); e.Next()) m.push(1); return m.length; })()}`);

    // closed form
    const eff = areaCentroid(clipOutward(profilePoints(c.prof)));
    const c0 = c.rb + eff.cx; // centroid radius at z = 0
    const dz = zTo - zFrom;
    const vThread = ((c.starts * eff.area * TAU) / c.lead) * (c0 * dz + (tan * (zTo * zTo - zFrom * zFrom)) / 2);
    // a body wider than [zFrom,zTo] has threads only inside it; a cut thread of a partial length removes only that part (the bore is inside the block)
    const expected = c.mode === 'cut' ? v0 - vThread : v0 + vThread;
    const got = volume(result);
    check('volume vs closed form ≤ 0.5 %', Math.abs(got - expected) / Math.abs(vThread) <= 0.005, `thread ${vThread.toFixed(4)} mm³ expected, got ${(c.mode === 'cut' ? v0 - got : got - v0).toFixed(4)} (error ${(((got - expected) / vThread) * 100).toFixed(4)} % of the thread volume)`);

    // flank positions
    const hand = c.hand;
    const depthPts = [0.25, 0.5, 0.75];
    const wide = c.prof.wb / 2 + c.prof.h * Math.tan(Math.max(c.prof.a1, c.prof.a2)) + 0.01; // the feature never reaches further than this from its centre line
    const lo0 = Math.max(zFrom, c.zBody0) + wide;
    const hi0 = Math.min(zTo, c.zBody1) - wide;
    let bad = 0;
    let done = 0;
    const thetas = [0.3, 1.1, 2.0, 3.0, 4.2, 5.5];
    for (const th of thetas) {
      for (let m = 0; m < c.starts; m++) {
        // centre line of start m at angle th: z = zFrom + hand·lead·(th − phase)/2π + m·lead/N + k·lead. Probe the first and the last turn that lies wholly inside the thread's range.
        const sBase = zFrom + (c.hand * c.lead * (th - (c.phase ?? 0) * PHASE_SIGN)) / TAU + (m * c.lead) / c.starts; // anchored at the start plane zFrom, start angle `phase`
        const kMin = Math.ceil((lo0 - sBase) / c.lead);
        const kMax = Math.floor((hi0 - sBase) / c.lead);
        for (const k of new Set([kMin, kMax])) {
          if (k > kMax || k < kMin) continue;
          const s = sBase + k * c.lead;
          for (const f of depthPts) {
            const dr = c.prof.h * f;
            const r = rbAt(s) + dr;
            const lo = -c.prof.wb / 2 + dr * Math.tan(c.prof.a1);
            const hi = c.prof.wb / 2 - dr * Math.tan(c.prof.a2);
            const inFeature = c.mode === 'cut' ? 'OUT' : 'IN';
            const notFeature = c.mode === 'cut' ? 'IN' : 'OUT';
            const d = 0.003;
            for (const [z, want] of [[s + lo - d, notFeature], [s + lo + d, inFeature], [s + hi - d, inFeature], [s + hi + d, notFeature]]) {
              done++;
              if (state(out.result, [r, th, z]) !== want) bad++;
            }
          }
        }
      }
    }
    check('flank positions within 0.003 mm (every start, 6 angles, 3 depths, first and last turn)', bad === 0 && done > 0, `${bad} of ${done} probes wrong`);

    // STEP round trip
    const w = new oc.STEPControl_Writer();
    w.Transfer(result, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress());
    w.Write(`/${c.id}.step`);
    const r = new oc.STEPControl_Reader();
    r.ReadFile(`/${c.id}.step`);
    r.TransferRoots(progress());
    const back = r.OneShape();
    const rel = Math.abs(volume(back) - got) / got;
    check('STEP round trip (valid, Δvolume < 1e-6)', valid(back) && rel < 1e-6, `Δ ${rel.toExponential(2)}, valid ${valid(back)}`);

    // mesh
    const tm = now();
    new oc.BRepMesh_IncrementalMesh(result, 0.02, false, 0.3, false);
    const meshMs = now() - tm;
    let tris = 0;
    const e = new oc.TopExp_Explorer(result, T.TopAbs_FACE, T.TopAbs_SHAPE);
    for (; e.More(); e.Next()) {
      const loc = new oc.TopLoc_Location();
      const tri = oc.BRep_Tool.Triangulation(oc.TopoDS.Face(e.Current()), loc, 0);
      if (tri && !tri.IsNull?.()) tris += tri.NbTriangles();
    }
    check('mesh ≤ 3 s, ≤ 200 000 triangles', meshMs <= 3000 && tris <= 200000, `${meshMs.toFixed(0)} ms, ${tris} triangles`);
    check('boolean time ≤ 5 s', tBool <= 5000, `${tBool.toFixed(0)} ms`);
  } catch (e) {
    check('no exception', false, String(e?.message ?? e));
  }
  return out;
}

const deg = Math.PI / 180;
const cases = [
  { id: 'A', name: '外螺紋，圓柱，單線，右旋（螺距 2，對稱 30°）', mode: 'fuse', rb: 4, outer: 6, zBody0: 0, zBody1: 20, starts: 1, lead: 2, hand: 1, prof: { wb: 1.4, h: 0.9, a1: 30 * deg, a2: 30 * deg, e: 0.2 } },
  { id: 'B', name: '內螺紋，圓柱，雙線，右旋（螺距 2.5，導程 5）', mode: 'cut', rb: 3.6, outer: 6, zBody0: 0, zBody1: 9, starts: 2, lead: 5, hand: 1, prof: { wb: 1.6, h: 0.4, a1: 30 * deg, a2: 30 * deg, e: 0.2 } },
  { id: 'C', name: '外螺紋，圓錐 6 %（半角 1.718°），雙線，右旋', mode: 'fuse', rb: 4, outer: 7, zBody0: 0, zBody1: 12, alpha: Math.atan(0.03), starts: 2, lead: 5, hand: 1, prof: { wb: 1.6, h: 0.4, a1: 30 * deg, a2: 30 * deg, e: 0.2 } },
  { id: 'D', name: '鎖緊環類：內螺紋，雙線，非對稱牙型（30°／20°）', mode: 'cut', rb: 3.6, outer: 7, zBody0: 0, zBody1: 8, starts: 2, lead: 5, hand: 1, prof: { wb: 1.7, h: 0.4, a1: 30 * deg, a2: 20 * deg, e: 0.2 } },
  { id: 'E', name: '內螺紋，左旋，起始角 60°，雙線', mode: 'cut', rb: 3.6, outer: 6, zBody0: 0, zBody1: 9, starts: 2, lead: 5, hand: -1, phase: Math.PI / 3, prof: { wb: 1.6, h: 0.4, a1: 30 * deg, a2: 30 * deg, e: 0.2 } },
  { id: 'F', name: '內螺紋，只做中段（長度參數），雙線', mode: 'cut', rb: 3.6, outer: 6, zBody0: 0, zBody1: 12, z0: 3, z1: 9, starts: 2, lead: 5, hand: 1, prof: { wb: 1.6, h: 0.4, a1: 30 * deg, a2: 30 * deg, e: 0.2 } },
];

let fails = 0;
for (const c of cases) {
  const r = runCase(c);
  console.log(`\n[${r.id}] ${r.name}`);
  for (const k of r.checks) {
    console.log(`  ${k.pass ? 'PASS' : 'FAIL'}  ${k.label} — ${k.detail}`);
    if (!k.pass) fails++;
  }
}
console.log(`\n${fails === 0 ? '全部通過' : `${fails} 項未通過`}`);
