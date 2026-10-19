// A reference plane normal to a curve (ADR 0174, G5 of the 2026-10-19 sketch-reference review): a helix of radius 10, pitch 5, 4 turns about y from
// (10, 0, 0); 「基準面」 in the mode 「垂直於曲線」, the first turn and its start vertex clicked in the graphics area: the plane goes through (10, 0, 0) with
// its normal along the helix there, (0, 5/2π, ±10) made unit; 「反轉方向」 turns it round. Replayed the way a person does it in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-plane-normal-to-curve.js?' + Date.now());   // in a freshly loaded page
//   await __manualNormalToCurve.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near } = S;
const M = (window.__manualNormalToCurve = {});

const helix = () => state().doc.features.find((f) => f.type === 'helix');
const plane = () => state().doc.features.find((f) => f.type === 'refPlane');
const RISE = 5 / (2 * Math.PI);
const L = Math.hypot(RISE, 10);

M.run = async () => {
  S.steps = [];
  await S.fresh();
  await step('1 a circle Ø20 at the origin of the top plane; 「螺旋曲線與渦捲線」 4 turns of pitch 5', async () => {
    await H.treeClick('上基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 12);
    await H.tool('圓');
    await H.sk(0, 0);
    await H.sk(9, 0.01, { ctrlKey: true });
    await H.solved();
    const id = [...H.geom()].find(([, g]) => g.type === 'circle')[0];
    await H.dim([id], [12, 6], 20);
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(name);
    await H.action('特徵', '螺旋曲線與渦捲線');
    await S.pmType('圈數', '4');
    await H.pmOk();
    await H.settle();
    return { failed: S.failed(), pass: !!helix() && S.failed().length === 0 };
  });
  await step('2 「基準面」, 「垂直於曲線」, the first turn and then its start (10, 0, 0) clicked: the plane is through the start, square to the helix', async () => {
    await H.hud('等角');
    await H.hud('全部顯示');
    await H.settle();
    await H.wait(600); // the view moves to its new place over a moment: the clicks below are made on where it ends up
    await H.action('特徵', '基準面');
    await H.pmSelect('normalToCurve');
    // a place of the first turn that is in sight: the turns seen from the corner overlap, and where one is behind another the click takes the one in front
    // (as it should); so the turn is walked along, C(t) = (10 cos t, 5t/2π, ±10 sin t), until the viewer says the first turn is what is under that place
    const names = state().result.edgeNames;
    const first = names.findIndex((n) => /helix:0$/.test(n));
    let seen = null;
    for (let k = 4; k < 36 && !seen; k++) {
      const t = (k / 40) * 2 * Math.PI;
      for (const s of [1, -1]) {
        const P = [10 * Math.cos(t), (5 * t) / (2 * Math.PI), s * 10 * Math.sin(t)];
        const c = H.worldToClient(P);
        // the viewer is asked where the pointer would be (client pixels); a click near a vertex on screen takes the vertex (which a click prefers), so only a
        // place 20 pixels or more from every vertex as drawn
        const under = store.viewer.elementsAt(c.x, c.y);
        const vp = state().result.vertexPoints;
        let clear = true;
        for (let i = 0; i < vp.length; i += 3) {
          const q = H.worldToClient([vp[i], vp[i + 1], vp[i + 2]]);
          if (Math.hypot(q.x - c.x, q.y - c.y) < 20) clear = false;
        }
        if (under.edge === first && clear) {
          seen = P;
          break;
        }
      }
    }
    if (!seen) return { first, pass: false, why: 'no place of the first turn is in sight' };
    await H.at(seen);
    await H.at([10, 0, 0]); // then its start vertex
    await H.settle();
    const def = plane()?.def;
    const f = state().result.frames.get(plane()?.id);
    const onPlane = f && Math.abs((10 - f.origin[0]) * f.normal[0] + (0 - f.origin[1]) * f.normal[1] + (0 - f.origin[2]) * f.normal[2]);
    return {
      def, frame: f, onPlane,
      pass: def?.mode === 'normalToCurve' && def.curve.kind === 'edge' && def.point.kind === 'vertex' && !!f && onPlane < 1e-6 && Math.abs(f.normal[0]) < 1e-6 && near(Math.abs(f.normal[1]), RISE / L, 1e-6) && near(Math.abs(f.normal[2]), 10 / L, 1e-6),
    };
  });
  await step('3 「反轉方向」 turns the normal round; ✔ keeps the plane, which is a child of the helix', async () => {
    const before = state().result.frames.get(plane().id);
    await H.pmCheck('反轉方向', true);
    const after = state().result.frames.get(plane().id);
    await H.pmOk();
    await H.settle();
    const { parentsOf } = await import('/@fs/' + here.replace(/^.*\/@fs\//, '').replace(/tests\/e2e\/$/, '') + 'packages/regen/src/dag.ts');
    const parents = parentsOf(plane(), state().doc);
    return {
      before: before?.normal, after: after?.normal, parents, failed: S.failed(),
      pass: !!before && !!after && near(after.normal[1], -before.normal[1], 1e-9) && near(after.normal[2], -before.normal[2], 1e-9) && parents.includes(helix().id) && S.failed().length === 0,
    };
  });
  return S.result('manual-plane-normal-to-curve');
};
