// Manual checklist D1 (docs/manual-verification.html): sub-assemblies. The 定位組 of phase3-subassembly.js (a plate and two pins, in a project folder of the browser) is put into a new
// assembly three times and the three plates are lined up with 「結合」 whose faces are picked with the cursor on the parts INSIDE the sub-assemblies (the step the scripts did not
// do: they made those mates with commands); then 隱藏 / 顯示 / 透明 / 不透明 / 抑制 / 恢復抑制 from the right-hand menu, the move of a suppressed one refused, Ctrl+Z and Ctrl+Y, 「另存新檔」
// and 「開啟舊檔」, and the hint on a part inside a sub-assembly. Replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it).
// Not a Vitest test. (The STEP import of a nested assembly is phase3-step-import.js; 「形成次組合件…」 is phase3-form-sub.js: each runs in a page of its own.)
//
//   await import('/@fs/<checkout>/tests/e2e/manual-d1.js?' + Date.now());   // in a freshly loaded page
//   await __manualD1.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualD1 = {});
const shot = (label) => window.__shot?.(label);

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await shot(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r });
  return r;
};
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
const a = () => store.assembly;
const leaf = (id) => a().leaves().find((l) => l.id === id);
const transformPoint = (pose, [px, py, pz]) => {
  const m = H.poseMatrix(pose);
  return [m[0] * px + m[4] * py + m[8] * pz + m[12], m[1] * px + m[5] * py + m[9] * pz + m[13], m[2] * px + m[6] * py + m[10] * pz + m[14]];
};
/** Picks a face of a part inside a sub-assembly with the cursor, like H.pickOn does for a component of the top (views are tried until the viewer says that face is under the cursor). */
async function pickLeaf(leafId, name) {
  const l = leaf(leafId);
  const build = a().buildOfLeaf(l);
  const index = build.faceNames.indexOf(name);
  if (index < 0) throw new Error(`${leafId} has no face ${name}`);
  const points = H.pointsOn(build, 'face', index);
  const middle = transformPoint(l.pose, [0, 1, 2].map((k) => points.reduce((s, q) => s + q[k], 0) / points.length));
  // the standard views of the cube, one after the other (a face on the far side needs the view from that side)
  const views = ['iso', 'front', 'right', 'left', 'back', 'top', 'bottom'].map((name) => async () => {
    store.viewer.setView(name);
    await H.wait(300);
  });
  const r = H.rect();
  for (const view of views.flatMap((v) => [v, async () => (await v(), await H.zoomAt(middle, 8))])) {
    await view();
    for (const p of points) {
      const c = H.worldToClient(transformPoint(leaf(leafId).pose, p));
      const [x, y] = [Math.round(c.x), Math.round(c.y)];
      if (x < r.left + 4 || x > r.right - 4 || y < r.top + 4 || y > r.bottom - 4) continue;
      H.ptr('pointermove', x, y);
      const h = store.viewer.hoveredElement;
      if (h && h.kind === 'face' && h.index === index && String(h.key).endsWith(leafId.split('/').pop()) && String(h.key).startsWith(leafId.split('/')[0])) {
        H.ptr('pointerdown', x, y);
        H.ptr('pointerup', x, y);
        H.canvas().dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
        await H.wait(120);
        store.viewer.setView('iso');
        await H.wait(300);
        return;
      }
    }
  }
  throw new Error(`could not get the cursor onto ${name} of ${leafId}`);
}
/** The outermost plane of a plate facing the direction n, by name. */
const side = (leafId, n) => {
  const build = a().buildOfLeaf(leaf(leafId));
  let best = null;
  build.faceGeometry.forEach((g, i) => {
    if (!(g?.type === 'plane' || g?.kind === 'plane') || g.normal.some((v, k) => Math.abs(v - n[k]) > 1e-9)) return;
    const d = g.origin[0] * n[0] + g.origin[1] * n[1] + g.origin[2] * n[2];
    if (!best || d > best.d) best = { name: build.faceNames[i], d };
  });
  if (!best) throw new Error(`no plane facing ${n}`);
  return best.name;
};
const contextMenu = async (id, item) => {
  const row = document.querySelector(`[data-component-row="${id}"]`);
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 200 }));
  await H.wait(150);
  const items = [...document.querySelectorAll('.context-menu li')].map((li) => li.textContent);
  const li = [...document.querySelectorAll('.context-menu li')].find((x) => x.textContent === item);
  if (!li) throw new Error(`no menu item ${item} in ${items.join(' | ')}`);
  li.click();
  await H.wait(500);
  return items;
};
const opacity = (top) => [...store.viewer.instances.values()].filter((i) => i.owner === top).map((i) => +i.body.material.opacity.toFixed(2));
const shown = () => store.viewer.instances.size;

M.run = async () => {
  await step('1 a new assembly with 定位組 at the origin (fixed), 插入零組件 twice more: 定位組<1>, <2>, <3> in the tree', async () => {
    await window.__sub.insert();
    await H.insert('組件/定位組.3dba', [0.75, 0.55]);
    await H.insert('組件/定位組.3dba', [0.75, 0.2]);
    await H.loaded();
    await H.waitFor(() => store.viewer.instances.size === 9, 10000, 'nine parts');
    await H.hud('全部顯示');
    const rows = [...document.querySelectorAll('[data-component-row]')].map((r) => r.textContent.replace(/^[▸▾]/, ''));
    return { rows, parts: shown(), pass: rows.length === 3 && /定位組<1>/.test(rows[0]) && /定位組<3>/.test(rows[2]) && shown() === 9 };
  });
  await step('2 結合: the right side of the plate of the first with the left side of the plate of the second, the plates picked inside the sub-assemblies: the suggestion is 重合', async () => {
    await H.action('組合件', '結合');
    const right = side('comp1/p1', [1, 0, 0]);
    const left = side('comp2/p1', [-1, 0, 0]);
    await pickLeaf('comp1/p1', right);
    await pickLeaf('comp2/p1', left);
    const suggested = document.querySelector('.mate-types button.active')?.textContent;
    await H.previewed();
    await shot('2-mate-preview');
    await H.mateOk();
    return { suggested, mates: H.asm().doc.mates.length, pass: suggested === '重合' && H.asm().doc.mates.length === 1 };
  });
  await step('3 the back faces and the top faces made the same: the second plate is lined up with the first, 120 along x; then the third with the second', async () => {
    const pairs = [
      ['comp1/p1', side('comp1/p1', [0, 0, 1]), 'comp2/p1', side('comp2/p1', [0, 0, 1])],
      ['comp1/p1', 'extrude1:cap:end', 'comp2/p1', 'extrude1:cap:end'],
      ['comp2/p1', side('comp2/p1', [1, 0, 0]), 'comp3/p1', side('comp3/p1', [-1, 0, 0])],
      ['comp2/p1', side('comp2/p1', [0, 0, 1]), 'comp3/p1', side('comp3/p1', [0, 0, 1])],
      ['comp2/p1', 'extrude1:cap:end', 'comp3/p1', 'extrude1:cap:end'],
    ];
    for (const [l1, f1, l2, f2] of pairs) {
      await pickLeaf(l1, f1);
      await pickLeaf(l2, f2);
      await H.previewed();
      await H.mateOk();
    }
    document.querySelector('.property-manager .pm-ok')?.click();
    await H.solved();
    await H.wait(800);
    const sol = H.asm().solution;
    const x = (id) => leaf(id).pose.position[0];
    await H.hud('全部顯示');
    return {
      mates: H.asm().doc.mates.length,
      status: [...sol.mates.values()].map((m) => m.status),
      x: [x('comp1/p1'), x('comp2/p1'), x('comp3/p1')],
      pass: H.asm().doc.mates.length === 6 && [...sol.mates.values()].every((m) => m.status === 'ok') && near(x('comp2/p1') - x('comp1/p1'), 120) && near(x('comp3/p1') - x('comp2/p1'), 120) && !document.querySelector('.feature-tree .tree-row.error'),
    };
  });
  await step('4 the menu of 定位組<2>: 隱藏 (still solved), 顯示, 透明 (0.4), 不透明', async () => {
    const items = await contextMenu('comp2', '隱藏');
    const hidden = { parts: shown(), solved: H.asm().solution.poses.has('comp2'), flag: H.asm().doc.components[1].hidden };
    await contextMenu('comp2', '顯示');
    await contextMenu('comp2', '透明');
    const transparent = opacity('comp2');
    await shot('4-transparent');
    await contextMenu('comp2', '不透明');
    return { items, hidden, transparent, after: opacity('comp2'), pass: items.includes('隱藏') && items.includes('透明') && items.includes('抑制') && hidden.parts === 6 && hidden.solved && hidden.flag === true && transparent.every((o) => o === 0.4) && opacity('comp2').every((o) => o === 1) && shown() === 9 };
  });
  await step('5 抑制 the third: left out, its mates 抑制; 「移動零組件」 on it says 已抑制; 恢復抑制 brings it back; Ctrl+Z puts the suppression on, Ctrl+Y takes it off', async () => {
    await contextMenu('comp3', '抑制');
    await H.wait(1200);
    const sol = H.asm().solution;
    const suppressed = { parts: shown(), poses: sol.poses.has('comp3'), mates: [...sol.mates.values()].map((m) => m.status), row: document.querySelector('[data-component-row="comp3"]').className.includes('suppressed') };
    a().select('comp3');
    const why = await new Promise((resolve) => {
      const notify = store.notify.bind(store);
      store.notify = (text) => {
        store.notify = notify;
        resolve(text);
      };
      void a().moveSelected({ kind: 'by', delta: [0, 0, 5] });
      setTimeout(() => resolve('none'), 2000);
    });
    await contextMenu('comp3', '恢復抑制');
    await H.wait(1200);
    const back = shown();
    await H.ctrl('z');
    await H.wait(1200);
    const undone = H.asm().doc.components[2].suppressed === true;
    await H.ctrl('y');
    await H.wait(1200);
    const redone = !H.asm().doc.components[2].suppressed;
    return { suppressed, why, back, undone, redone, pass: suppressed.parts === 6 && !suppressed.poses && suppressed.mates.filter((s) => s === 'suppressed').length >= 3 && suppressed.row && /已抑制/.test(why) && back === 9 && undone && redone };
  });
  await step('6 the second hidden and the third suppressed, 「另存新檔」 and 「開啟舊檔」: the states are still there', async () => {
    await contextMenu('comp2', '隱藏');
    await contextMenu('comp3', '抑制');
    await H.wait(1000);
    H.next.save = '夾具-d1.3dba';
    await H.action('檔案', '另存新檔');
    await H.waitFor(() => !H.asm().dirty, 10000, 'the save');
    await H.action('檔案', '新零件');
    if (store.getState().unsaved) await store.answerUnsaved('discard');
    H.next.open = '夾具-d1.3dba';
    await H.action('檔案', '開啟舊檔');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.waitFor(() => store.getState().notice?.text === '已開啟 夾具-d1.3dba', 20000, 'the assembly to open');
    await H.loaded();
    await H.wait(1500);
    const c = H.asm().doc.components;
    return { hidden: c[1].hidden, suppressed: c[2].suppressed, parts: shown(), pass: c[1].hidden === true && c[2].suppressed === true && shown() === 3 };
  });
  await step('7 the cursor on a part inside a sub-assembly: the hint says it cannot be moved alone, open the sub-assembly', async () => {
    await contextMenu('comp2', '顯示');
    await contextMenu('comp3', '恢復抑制');
    const row = document.querySelector('[data-component-row="comp1"]');
    if (!document.querySelector('.sub-component')) row.querySelector('.twisty').click();
    await H.wait(200);
    const inner = document.querySelector('.sub-component');
    return { title: inner?.title ?? '', pass: /次組合件裡的零件：在這裡不能單獨移動，要改請開啟次組合件/.test(inner?.title ?? '') };
  });
  return { name: 'D1', steps, pass: steps.every((s) => s.pass) };
};
