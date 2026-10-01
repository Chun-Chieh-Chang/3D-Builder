// Phase 3a-6c: what ThruSections tells us about a loft (C4.5): volumes, what the section edges generated, whether it forgives a different start corner,
// the other direction round, a different number of edges. Run: node spikes/occt-gaps/phase3-loft.mjs
import { createInstance } from 'libcascade/single/init';

const oc = await createInstance({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const progress = () => new oc.Message_ProgressRange();
const volume = (s) => { const p = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(s, p, false, false, false); return p.Mass(); };
const valid = (s) => new oc.BRepCheck_Analyzer(s, true, false, false).IsValid();
const indexOf = (s, type) => { const m = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes(s, type, m); return m; };
const keysOf = (s, type) => { const m = indexOf(s, type); const out = []; for (let i = 1; i <= m.Extent(); i++) out.push(m.FindKey(i)); return out; };
const list = (l) => { const out = []; const c = new oc.NCollection_List_TopoDS_Shape(l); while (!c.IsEmpty()) { out.push(c.First()); c.RemoveFirst(); } return out; };
const P = (x, y, z = 0) => new oc.gp_Pnt(x, y, z);
const D = (x, y, z) => new oc.gp_Dir(new oc.gp_Vec(x, y, z));
const wireOf = (edges) => { const mw = new oc.BRepBuilderAPI_MakeWire(); for (const e of edges) mw.Add(e); return mw.Wire(); };
/** A rectangle at height z, w × h about the origin; `start` rotates which corner the wire starts at, `reversed` walks it clockwise. */
const rect = (w, h, z, start = 0, reversed = false) => {
  let c = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  c = c.slice(start).concat(c.slice(0, start));
  if (reversed) c = [c[0], ...c.slice(1).reverse()];
  return wireOf(c.map((p, i) => { const q = c[(i + 1) % 4]; return new oc.BRepBuilderAPI_MakeEdge(P(p[0], p[1], z), P(q[0], q[1], z)).Edge(); }));
};
const circle = (r, z) => wireOf([new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(new oc.gp_Ax2(P(0, 0, z), D(0, 0, 1), D(1, 0, 0)), r)).Edge()]);

function loft(wires, ruled) {
  const mk = new oc.BRepOffsetAPI_ThruSections(true, ruled, 1e-6);
  for (const w of wires) mk.AddWire(w);
  mk.Build(progress());
  const out = mk.Shape();
  return { mk, out };
}
const show = (name, wires, ruled, expected) => {
  try {
    const { mk, out } = loft(wires, ruled);
    const v = volume(out);
    const gen = wires.map((w) => keysOf(w, T.TopAbs_EDGE).map((e) => list(mk.Generated(e)).length));
    console.log(`${name}: volume ${v.toFixed(4)}${expected === undefined ? '' : ` (expected ${expected})`}; valid ${valid(out)}; ${keysOf(out, T.TopAbs_FACE).length} faces; Generated per edge of each section ${JSON.stringify(gen)}; first/last null ${mk.FirstShape().IsNull()}/${mk.LastShape().IsNull()}`);
  } catch (e) {
    let m = String(e); try { m = oc.getExceptionMessage(e).join(' / '); } catch {}
    console.log(`${name}: EXCEPTION ${m}`);
  }
};

show('A1 two equal rects', [rect(10, 6, 0), rect(10, 6, 20)], false, 1200);
show('A2 second starts at another corner', [rect(10, 6, 0), rect(10, 6, 20, 2)], false, 1200);
show('A3 second walked the other way round', [rect(10, 6, 0), rect(10, 6, 20, 0, true)], false, 1200);
show('A4 other corner and other way', [rect(10, 6, 0), rect(10, 6, 20, 3, true)], false, 1200);
show('B1 three equal rects, smooth', [rect(10, 6, 0), rect(10, 6, 20), rect(10, 6, 40)], false, 2400);
show('B2 three equal rects, ruled', [rect(10, 6, 0), rect(10, 6, 20), rect(10, 6, 40)], true, 2400);
show('B3 rect 20x10 -> 10x10 ruled', [rect(20, 10, 0), rect(10, 10, 20)], true, 3000);
show('B4 rect 20x10 -> 10x10 smooth', [rect(20, 10, 0), rect(10, 10, 20)], false, 3000);
show('B5 three: 10x10, 20x20, 10x10 ruled (two frusta)', [rect(10, 10, 0), rect(20, 20, 10), rect(10, 10, 20)], true, 2 * (10 / 3) * (100 + 200 + 400));
show('C1 circle r5 -> circle r2 (cone frustum)', [circle(5, 0), circle(2, 20)], false, (Math.PI * 20 / 3) * (25 + 10 + 4));
show('C2 square 10 -> circle r5', [rect(10, 10, 0), circle(5, 20)], false);
show('C3 circle r5 -> square 10', [circle(5, 0), rect(10, 10, 20)], false);
show('C4 square 10 -> circle r5 ruled', [rect(10, 10, 0), circle(5, 20)], true);
