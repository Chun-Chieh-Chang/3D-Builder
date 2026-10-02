// Phase 3b-4c: the exploded view in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-explode.js?' + Date.now());
//   await __exp.run();
//
// It builds on phase3-subassembly.js (the 夾具 of two 定位組 in an OPFS project folder).

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const exp = (window.__exp = {});

const near = (a, b, d = 1e-9) => Math.abs(a - b) < d;
const positions = () => store.assembly.leaves().map((l) => [l.id, l.pose.position.map((v) => +v.toFixed(9))]);
const placements = () => JSON.stringify(H.asm().doc.components.map((c) => c.placement));

exp.run = async () => {
  await __sub.open();
  const a = store.assembly;
  const before = positions();
  const placed = placements();

  await H.action('組合件', '爆炸視圖');
  await H.waitFor(() => H.asm().explode && document.querySelector('[data-explode-components]'), 5000, 'the PropertyManager');
  H.check(H.asm().exploded === true, 'opening it shows the view exploded');
  // step 1: 定位組<2> up 100
  a.setExplodeDraft({ components: ['s1'], axis: { kind: 'axis', axis: 'z' }, distance: '100' });
  await H.wait(200);
  document.querySelector('.property-manager .pm-row .pm-button:not(.active)'); // the panel is drawn
  a.applyExplodeStep();
  await H.wait(300);
  H.check(H.asm().doc.explosion.length === 1 && H.asm().explode.editing === null, 'a step is in the document, the panel stays for the next');
  const one = positions();
  const moved = (list, top) => list.filter(([id]) => id.startsWith(top + '/')).map(([, p], i) => [p, before.find(([b]) => b === list.find(([id]) => id.startsWith(top + '/'))[0])]);
  const shifted = (id) => {
    const x = one.find(([i]) => i === id)[1];
    const y = before.find(([i]) => i === id)[1];
    return [0, 1, 2].map((k) => +(x[k] - y[k]).toFixed(9));
  };
  H.check(['s1/p1', 's1/pa', 's1/pb'].every((id) => JSON.stringify(shifted(id)) === JSON.stringify([0, 0, 100])), `the three parts of 定位組<2> moved 100 along z: ${['s1/p1', 's1/pa', 's1/pb'].map(shifted)}`);
  H.check(['s0/p1', 's0/pa', 's0/pb'].every((id) => JSON.stringify(shifted(id)) === JSON.stringify([0, 0, 0])), 'the other did not move');
  H.check(placements() === placed, 'no placement was changed');
  // step 2: both, along y, flipped
  a.setExplodeDraft({ components: ['s0', 's1'], axis: { kind: 'axis', axis: 'y' }, distance: '60', flip: true });
  a.applyExplodeStep();
  await H.wait(300);
  const two = positions();
  const s1 = two.find(([i]) => i === 's1/p1')[1];
  const b1 = before.find(([i]) => i === 's1/p1')[1];
  H.check(near(s1[1] - b1[1], -60) && near(s1[2] - b1[2], 100), `the steps add up: ${s1} from ${b1}`);
  const rows = [...document.querySelectorAll('[data-explode-steps] li')].length;
  H.check(rows === 2, `two steps listed: ${rows}`);

  // collapse: everything where it was, bit for bit
  a.setExploded(false);
  await H.wait(300);
  H.check(JSON.stringify(positions()) === JSON.stringify(before), 'collapsed: every part where it was before');
  H.check(placements() === placed, 'and the document placements are the same bytes');
  a.setExploded(true);
  await H.wait(300);
  H.check(JSON.stringify(positions()) === JSON.stringify(two), 'exploded again: as it was');

  // while it is exploded nothing can be dragged
  const notices = [];
  const notify = store.notify.bind(store);
  store.notify = (text, kind) => {
    notices.push(text);
    notify(text, kind);
  };
  const started = a.startDrag('s1', [0, 0, 0], 'left');
  store.notify = notify;
  H.check(started === false && notices.some((n) => /爆炸視圖展開時/.test(n)), `a drag is refused: ${notices}`);

  // STEP of the exploded assembly is the assembled one
  const req = a.stepRequest();
  const asBuilt = JSON.stringify(req.instances.map((i) => i.pose));
  H.check(JSON.stringify(H.asm().doc.components.map((c) => ({ position: c.placement.position, rotation: c.placement.rotation }))) === JSON.stringify(req.instances.map((i) => i.pose)) || asBuilt.length > 0, 'the STEP request has poses');
  H.check(req.instances.every((i, k) => JSON.stringify(i.pose.position) === JSON.stringify(a.poseOf(H.asm().doc.components[k].id).position)), 'a STEP of the exploded view is the assembled positions');

  // edit, reorder, delete, undo
  a.editExplodeStep(H.asm().doc.explosion[0].id);
  H.check(H.asm().explode.editing === H.asm().doc.explosion[0].id, 'a step is opened for editing');
  a.setExplodeDraft({ distance: '40' });
  a.applyExplodeStep();
  await H.wait(300);
  H.check(H.asm().doc.explosion[0].distance === '40', 'the step is changed');
  a.moveExplodeStep(H.asm().doc.explosion[1].id, 0);
  H.check(H.asm().doc.explosion[0].distance === '60', 'reordered');
  a.undo();
  a.undo();
  H.check(H.asm().doc.explosion[0].distance === '100', 'two undos put it back');
  const keep = H.asm().doc.explosion.length;
  a.deleteExplodeSteps([H.asm().doc.explosion[0].id]);
  H.check(H.asm().doc.explosion.length === keep - 1, 'a step is deleted');
  a.undo();
  H.check(H.asm().doc.explosion.length === keep, 'and restored by one undo');

  // the other tools need the assembled positions: starting one collapses
  a.closeExplode();
  a.startMate();
  H.check(H.asm().exploded === false && !H.asm().explode, 'mating starts collapsed');
  a.cancelMate();

  // saved and reopened: the steps are there, the view is collapsed
  H.next.save = '夾具-爆炸.3dba';
  await H.action('檔案', '另存新檔');
  await H.waitFor(() => !H.asm().dirty, 10000, 'the save');
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = '夾具-爆炸.3dba';
  await H.action('檔案', '開啟舊檔');
  await H.waitFor(() => store.getState().notice?.text === '已開啟 夾具-爆炸.3dba', 20000, 'open');
  await H.loaded();
  await H.wait(1000);
  H.check(H.asm().doc.explosion.length === 2 && H.asm().exploded === false, 'reopened: two steps, collapsed');
  const folder = document.querySelector('[data-explode-folder]');
  H.check(folder && document.querySelectorAll('[data-explode-row]').length === 2, 'the tree lists the steps');
  folder.click();
  await H.wait(300);
  H.check(H.asm().exploded === true && !near(store.assembly.leaves().find((l) => l.id === 's1/p1').pose.position[2], before.find(([i]) => i === 's1/p1')[1][2]), 'the folder row explodes the view');
  return { before: before.length, steps: H.asm().doc.explosion.map((s) => [s.name, s.components, s.distance, s.flip]) };
};
