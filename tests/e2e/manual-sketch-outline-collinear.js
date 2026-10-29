// await __outlineCollinear.run();
// ADR 0217, the report: on 右基準面, a 水平 sketch line just above a cylinder could not be made collinear with the cylinder's outline — there is no edge
// along it, and only edges could be picked. Now a click on the outline in the select tool makes an entity that follows it, 「共線」 is offered for the two,
// and adding it replaces the line's own 水平 (which it makes redundant) in one step. Real worker, kernel and solver; every number is the part as drawn.
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui, { store } = H;
const must = (ok, message) => { if (!ok) throw new Error(message); };
/** A point of the model in the edited sketch's coordinates. */
const local = (P) => {
  const f = H.frame(), d = [P[0] - f.origin[0], P[1] - f.origin[1], P[2] - f.origin[2]];
  return [d[0] * f.xDir[0] + d[1] * f.xDir[1] + d[2] * f.xDir[2], d[0] * f.yDir[0] + d[1] * f.yDir[1] + d[2] * f.yDir[2]];
};
const buttons = () => [...document.querySelectorAll('.relation-buttons button')].map((b) => b.textContent);
window.__outlineCollinear = { run: async () => {
  H.ready();
  await H.action('檔案', '新零件');
  // a cylinder of radius 5 along +Z, 20 long
  await H.treeClick('前基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 10);
  await H.tool('圓');
  await H.sk(0, 0);
  await H.sk(5, 0);
  await H.solved();
  const circle = H.sketch().entities.find((e) => e.type === 'circle').id;
  await H.selectTool();
  await H.dim([circle], [8, 8], 10);
  const g = H.geom().get(circle);
  must(Math.abs(g.r - 5) < 1e-9, `radius 5, got ${g.r}`);
  const base = H.sketch().name;
  await H.selectTool();
  await H.exitSketch();
  await H.treeClick(base);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '20');
  await H.pmOk();
  must(Math.abs(store.getState().result.mass.volume - Math.PI * 25 * 20) < 1e-6, `volume ${store.getState().result.mass.volume}`);
  // the sketch of the report: on the right plane, a horizontal line 1 above the top outline
  await H.treeClick('右基準面');
  await H.action('草圖', '草圖');
  const [ua, va] = local([0, 6, 4]), [ub] = local([0, 6, 14]);
  await H.frameSketch((ua + ub) / 2, va - 1, 25);
  await H.tool('直線');
  await H.sk(ua, va);
  await H.sk(ub, va);
  await H.solved();
  await H.selectTool();
  const line = H.sketch().entities.find((e) => e.type === 'line').id;
  if (!H.sketch().constraints.some((c) => c.type === 'horizontal' && c.a === line && c.b === undefined)) {
    store.sketcher.select([line]);
    await H.wait(80);
    await H.rel([line], '水平');
  }
  must(H.sketch().constraints.some((c) => c.type === 'horizontal' && c.a === line), 'the line is 水平, as in the report');
  // the line, then (Ctrl) the outline, where nothing but the outline is: the middle of the cylinder's top, 1 below the line
  const [uo, vo] = local([0, 5, 9]);
  await H.sk(...H.onEntity(line));
  await H.wait(300); // the snap items arrive after the rebuild
  await H.sk(uo, vo, { ctrlKey: true });
  await H.solved();
  const selection = H.view().selection;
  must(selection.length === 2 && selection[0] === line, `the line and the outline are selected: ${selection.join(',')}`);
  const outline = H.sketch().entities.find((e) => e.id === selection[1]);
  must(outline?.type === 'line' && outline.construction === true && outline.ref?.kind === 'face' && Number.isInteger(outline.ref.silhouette), `an entity that follows the outline: ${JSON.stringify(outline)}`);
  await H.wait(80);
  const offered = buttons();
  must(offered.includes('共線'), `共線 offered for the line and the outline: ${offered.join(' ')}`);
  const b = [...document.querySelectorAll('.relation-buttons button')].find((x) => x.textContent === '共線');
  b.click();
  await H.waitFor(() => H.sketch().constraints.some((c) => c.type === 'collinear'), 5000, '共線 added');
  await H.solved();
  const s = store.getState().sketchSolve;
  must(!['over', 'failed'].includes(s.status), `the sketch solves: ${s.status}`);
  must(!H.sketch().constraints.some((c) => c.type === 'horizontal' && c.a === line && c.b === undefined), 'its 水平, now redundant, was replaced');
  const l = s.geometry.get(line), o = s.geometry.get(outline.id), top = local([0, 5, 0])[1];
  for (const p of [l.a, l.b, o.a, o.b]) must(Math.abs(p[1] - top) < 1e-7, `on the outline at ${top}: ${p}`);
  const notice = [...document.querySelectorAll('.toast, .notice, [role="status"]')].map((n) => n.textContent).join(' ');
  return { pass: true, offered, status: s.status, line: [l.a, l.b], outline: [o.a, o.b], ref: outline.ref, notice };
} };
