// Manual checklist C24 (docs/manual-verification.html): 「圓角」 of the kind 「面圓角」: the top face in 面組 1 and a side face in 面組 2 (14374.25 mm³), a second side face added, the
// opposite face put in the second set (an error), and the inside corner of an L (the bead is added), replayed the way a person does it in the app's page (http://127.0.0.1:5391,
// 1280×720; `npm run verify:ui` does it). Not a Vitest test. The faces are picked with a click at their screen position, after the radio button of the set.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c24.js?' + Date.now());   // in a freshly loaded page
//   await __manualC24.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC24 = {});

const last = (type) => state().doc.features.filter((f) => f.type === type).at(-1);
const group = async (g, P) => {
  document.querySelector(`[data-group="${g}"] input[type=radio]`).click();
  await H.settle();
  await H.at(P);
  await H.wait(200);
};
const sets = () => {
  const f = last('fillet');
  return [f.faces?.length ?? 0, f.faces2?.length ?? 0];
};

M.run = async () => {
  let top;
  let right;
  let back;
  await step('1 a 40 × 30 × 12 block; 「圓角」 with 圓角種類 = 面圓角: two sets of faces, no edge list', async () => {
    await S.box(40, 30, 12);
    await S.iso();
    await H.action('特徵', '圓角');
    await S.pmChoose('圓角種類', 'face');
    const text = S.pmText();
    top = S.planeFace(1, 12);
    right = S.planeFace(0, 40);
    back = S.faceCentres().find((f) => f.type === 'plane' && f.dir && Math.abs(f.dir[2]) > 0.99 && Math.abs(f.center[2] + 30) < 1e-6);
    return { groups: !!document.querySelector('[data-group="faces"]') && !!document.querySelector('[data-group="faces2"]'), edgeBox: /要產生圓角的邊線/.test(text), pass: !!document.querySelector('[data-group="faces"]') && !!document.querySelector('[data-group="faces2"]') && !/要產生圓角的邊線/.test(text) };
  });
  await step('2 the top face in 面組 1 and the right side in 面組 2, 半徑 2, ✔: one edge of 30 rounds, 14374.25 mm³', async () => {
    await group('faces', top.center);
    await group('faces2', right.center);
    const picked = sets();
    await shot('2-two-sets');
    await H.pmInput('半徑', '2');
    await H.pmOk();
    await S.iso();
    await shot('2-one-edge-rounded');
    return { picked, volume: S.volume(), pass: picked.join() === '1,1' && near(S.volume(), 14374.25, 1e-5) && S.failed().length === 0 };
  });
  await step('3 圓角1 edited, a second side face added to 面組 2: two edges round; clicking the face again takes it out', async () => {
    await S.treeEdit('圓角1');
    await S.view('back');
    await group('faces2', back.center);
    const two = sets();
    const volume2 = S.volume();
    await group('faces2', back.center); // the same face again
    const one = sets();
    await group('faces2', back.center);
    await H.pmOk();
    await S.iso();
    await shot('3-two-edges-rounded');
    // two edges, of 30 and of 40: (1 − π/4)·4·(30 + 40) = 60.1 taken away, less what the two roundings share at the corner they meet in
    const removed = 14400 - S.volume();
    return { two, one, volume2, volume: S.volume(), removed, pass: two.join() === '1,2' && one.join() === '1,1' && removed > 58 && removed < 60.1 && S.failed().length === 0 };
  });
  await step('4 面組 2 changed to the bottom face (it does not meet the top): the feature has an error that says so, the rest of the part is well', async () => {
    await S.treeEdit('圓角1');
    await S.view('right');
    await group('faces2', right.center); // the faces of the second set clicked off, one by one
    await S.view('back');
    await group('faces2', back.center);
    await S.view('bottom');
    await group('faces2', S.planeFace(1, 0).center);
    await H.pmOk();
    const f = last('fillet');
    const r = state().result.features.find((x) => x.id === f.id);
    await S.iso();
    await shot('4-not-adjacent');
    return { status: r?.status, message: r?.message, pass: r?.status === 'error' && /兩組面沒有共同的邊/.test(r.message ?? '') && state().result.features.filter((x) => x.status === 'error').length === 1 };
  });
  await step('5 (選做) the inside of an L: a plate 40 × 30 × 10 and a wall 40 × 10 × 30 along one edge, a fillet of 3 between the wall and the plate adds (1 − π/4)·9·40 = 77.26 mm³', async () => {
    await S.box(40, 30, 10);
    // the wall: a rectangle on the front plane at the back edge of the plate, 40 wide and 30 high, 10 thick
    await S.iso();
    await H.treeClick('右基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(15, 15, 10);
    await H.tool('邊角矩形');
    await H.sk(0, 0);
    await H.sk(10, 30);
    await H.solved();
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await H.treeClick(name);
    await H.action('特徵', '伸長填料/基材');
    await H.pmInput('深度', '40');
    await H.pmOk();
    const bodies = state().result.bodies.length;
    const before = S.volume();
    await S.iso();
    await H.action('特徵', '圓角');
    await S.pmChoose('圓角種類', 'face');
    const r = state().result;
    // the plate's top face and the inside face of the wall (the one facing +z... found by name: the wall's side facing the plate)
    // the top of the plate beside the wall (y = 10, 800 mm²) and the wall's face towards it (facing −z at z = −10, 800 mm²)
    const find = (axis, sign, at, along) => r.faceFingerprints.map((fp, i) => ({ fp, i })).find(({ fp }) => fp.type === 'plane' && fp.dir && Math.abs(fp.dir[axis]) > 0.99 && Math.abs(fp.center[axis] - at) < 1e-6 && Math.abs(fp.size - 800) < 1e-6);
    const plateTop = find(1, 1, 10);
    const inner = find(2, -1, -10);
    if (!plateTop || !inner) return { bodies, before, pass: false, why: 'faces of the L not found' };
    await S.view('top'); // the wall hides the plate from the isometric view: from above the plate beside it shows
    await group('faces', plateTop.fp.center);
    await S.view('back'); // the face of the wall looks towards −z: seen from behind
    await group('faces2', inner.fp.center);
    await H.pmInput('半徑', '3');
    await H.pmOk(); // while the panel is open the part is shown as it was before the fillet
    const added = S.volume() - before;
    await S.iso();
    await shot('5-inside-corner');
    return { bodies, before, added, pass: bodies === 1 && near(added, (1 - Math.PI / 4) * 9 * 40, 2e-3) && S.failed().length === 0 };
  });
  return S.result('C24');
};
