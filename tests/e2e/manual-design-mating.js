// ADR 0236 「設計配合件…」: a body locked as the reference, a mating part modelled beside it, and 「產生組合件」. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The project folder is OPFS, as in phase2-assembly.js, whose
// helpers and file-dialog stand-ins come with it. The entry, the tree menu and the 「產生組合件」 button are clicked; the sketch, the conversion of the face
// and the boss go through the store (they have e2e scripts of their own); the results are read from the store and measured by the kernel.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-design-mating.js?' + Date.now());   // in a freshly loaded page
//   await __designMating.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const menus = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/contextMenus.ts')));
const M = (window.__designMating = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r });
  return r;
};
const state = () => store.getState();
const body = (id) => state().result.bodies.find((b) => b.id === id);
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const notice = () => state().notice?.text ?? '';
/** A right click on the body's row of the tree, then the line of its menu that does `action`. */
const treeMenu = async (id, action) => {
  const row = document.querySelector(`[data-body="${id}"]`);
  if (!row) throw new Error(`no tree row for body ${id}`);
  const r = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + r.height / 2, button: 2 }));
  await H.wait(150);
  const li = document.querySelector(`.context-menu li[data-action="${action}"]`);
  return li;
};
const clickTree = async (id, action) => {
  const li = await treeMenu(id, action);
  if (!li) throw new Error(`no menu line ${action}`);
  li.click();
  await H.wait(300);
  await H.settle();
};
/** A W × D × H block made by one sketch and one boss, as a new untitled part. */
const newBlockPart = async () => {
  store.newPart();
  await H.wait(300);
  if ([...document.querySelectorAll('.modal button')].some((b) => b.textContent === '不儲存')) await H.modalButton('不儲存');
  await H.waitFor(() => state().doc.features.length === 0, 10000, 'an empty part');
  const pts = [[0, 0], [30, 0], [30, 20], [0, 20]];
  const sketchFeature = {
    id: 'sk1', type: 'sketch', name: 'sk1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' },
    entities: [...pts.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y })), ...pts.map((_, i) => ({ id: `l${i}`, type: 'line', p1: `p${i}`, p2: `p${(i + 1) % 4}` }))],
    constraints: pts.map((_, i) => ({ id: `f${i}`, type: 'fix', point: `p${i}` })),
  };
  store.execute({ type: 'insertFeature', feature: sketchFeature, index: 0 });
  store.execute({ type: 'insertFeature', feature: { id: 'ex1', type: 'extrude', name: 'ex1', suppressed: false, sketch: 'sk1', op: 'boss', dir1: { type: 'blind', depth: '10' } }, index: 1 });
  await H.settle();
  await H.waitFor(() => body('ex1'), 20000, 'the block');
};

M.run = async () => {
  steps.length = 0;
  await H.project({});

  await step('AC10: an unknown body, a surface body and a locked body are refused with a reason', async () => {
    await newBlockPart();
    const top = state().result.faceFingerprints.findIndex((fp) => fp.type === 'plane' && fp.dir && Math.abs(fp.dir[2] - 1) < 1e-9);
    store.execute({ type: 'insertFeature', feature: { id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: state().result.faceNames[top] }], distance: '2' }, index: 2 });
    await H.settle();
    const surface = state().result.bodies.find((b) => b.surface);
    await store.designMatingPart('nope');
    const unknown = notice();
    await store.designMatingPart(surface?.id ?? 'missing-surface');
    const notSolid = notice();
    const doc = JSON.stringify(state().doc.bodies);
    return { pass: !!surface && unknown.includes('nope') && notSolid.includes('實體') && JSON.stringify(state().doc.bodies) === doc, unknown, notSolid };
  });

  await step('AC1: the entry is on the tree menu of a solid and on a face of it, not on a surface body', async () => {
    const solid = await treeMenu('ex1', 'design-mating');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await H.wait(100);
    const surface = state().result.bodies.find((b) => b.surface);
    const onSurface = await treeMenu(surface.id, 'design-mating');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await H.wait(100);
    const r = state().result;
    const solidFace = r.bodies.find((b) => b.id === 'ex1').face0;
    store.selectFace({ kind: 'face', name: r.faceNames[solidFace] });
    const onFace = menus.menuIds(menus.partMenu(state(), { kind: 'face', index: solidFace })).includes('design-mating');
    store.selectFace({ kind: 'face', name: r.faceNames[surface.face0] });
    const onSurfaceFace = menus.menuIds(menus.partMenu(state(), { kind: 'face', index: surface.face0 })).includes('design-mating');
    store.select(null);
    // the surface was only for the refusals: without it the assembly below has the reference and the mating part
    store.execute({ type: 'deleteFeatures', featureIds: ['os1'] });
    await H.settle();
    return { pass: !!solid && !onSurface && onFace && !onSurfaceFace && state().result.bodies.length === 1, solid: !!solid, onSurface: !!onSurface, onFace, onSurfaceFace };
  });

  await step('AC2: an untitled part is saved first; cancelling the save leaves the document as it was', async () => {
    const before = JSON.stringify(state().doc);
    H.next.save = null; // the save dialog answers 「取消」
    await clickTree('ex1', 'design-mating');
    const cancelled = JSON.stringify(state().doc) === before && !body('ex1').locked;
    H.next.save = '配合件測試.3dbx';
    await clickTree('ex1', 'design-mating');
    const saved = H.dialogs.some((d) => d[0] === 'save' && d[1] === '配合件測試.3dbx');
    return { pass: cancelled && saved && body('ex1').locked === true && state().fileName === '配合件測試.3dbx', cancelled, saved, locked: body('ex1').locked };
  });

  await step('AC3: the lock is one undo step', async () => {
    const after = JSON.stringify(state().doc.bodies.ex1);
    store.undo();
    await H.settle();
    const undone = state().doc.bodies.ex1 === undefined && !body('ex1').locked;
    store.redo();
    await H.settle();
    return { pass: undone && JSON.stringify(state().doc.bodies.ex1) === after && after === JSON.stringify({ reference: true, locked: true }), after, undone };
  });

  await step('AC10: locking it again is refused', async () => {
    await store.designMatingPart('ex1');
    return { pass: notice().includes('已經鎖定'), notice: notice() };
  });

  await step('the mating part: the top face converted in one go and extruded is 「配合件1」; the reference keeps its volume', async () => {
    const v0 = body('ex1');
    const r = state().result;
    const top = r.faceFingerprints.findIndex((fp, i) => fp.type === 'plane' && fp.dir && Math.abs(fp.dir[2] - 1) < 1e-9 && i >= v0.face0 && i < v0.face0 + v0.faces);
    const face = { kind: 'face', name: r.faceNames[top], fingerprint: r.faceFingerprints[top] };
    store.newSketch(face);
    await H.waitFor(() => state().editing, 10000, 'the sketch');
    const id = store.editedSketch().id;
    await H.waitFor(() => state().result.frames.has(id), 20000, 'the sketch plane');
    store.sketcher.setTool('convert');
    await H.wait(200);
    await store.convertPicked(face);
    await H.waitFor(() => store.editedSketch().entities.some((e) => e.ref), 10000, 'the converted outline');
    await H.wait(1500);
    const solve = state().sketchSolve?.status;
    store.commitEdit();
    await H.settle();
    store.execute({ type: 'insertFeature', feature: { id: 'ex2', type: 'extrude', name: 'ex2', suppressed: false, sketch: id, op: 'boss', dir1: { type: 'blind', depth: '5' } }, index: state().doc.features.length });
    await H.settle();
    const bodies = state().result.bodies;
    const mating = bodies.find((b) => b.id === 'ex2');
    const refVolume = bodies.find((b) => b.id === 'ex1')?.volume;
    return { pass: solve === 'fully' && bodies.length === 2 && mating?.name === '配合件1' && near(mating.volume, 30 * 20 * 5) && near(refVolume, 30 * 20 * 10), solve, names: bodies.map((b) => b.name), mating: mating?.volume, refVolume };
  });

  await step('the bar shows the locked reference and 「產生組合件」', async () => {
    const bar = document.querySelector('.mating-bar');
    return { pass: !!bar && bar.textContent.includes('ex1') && !!bar.querySelector('[data-action="generate-mating-assembly"]'), text: bar?.textContent };
  });

  await step('AC8: 「產生組合件」 makes one component per body; the reference is not in the bill of materials', async () => {
    const bodyCount = state().result.bodies.length;
    document.querySelector('[data-action="generate-mating-assembly"]').click();
    await H.wait(500);
    if (state().folderRequest) await H.modalButton('選擇資料夾…');
    await H.waitFor(() => state().asm, 30000, 'the assembly to open');
    await H.loaded();
    const asm = state().asm;
    const components = asm.doc.components.length;
    const rows = store.assembly.bom().flat;
    const quantity = rows.reduce((n, r) => n + r.qty, 0);
    return { pass: components === bodyCount && quantity === bodyCount - 1 && rows.every((r) => r.name !== 'ex1'), components, bodyCount, rows: rows.map((r) => `${r.name}×${r.qty}`) };
  });

  return { name: '設計配合件 (ADR 0236)', steps, pass: steps.length > 0 && steps.every((s) => s.pass) };
};
