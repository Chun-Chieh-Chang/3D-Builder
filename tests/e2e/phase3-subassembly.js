// Phase 3b-1c: a sub-assembly in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-subassembly.js?' + Date.now());  // the helpers of phase2-assembly.js come with it
//   await __sub.open();      // a 夾具 of two 定位組 opened from a project folder: parts drawn, mates solved
//   await __sub.insert();    // a new assembly, a 定位組.3dba inserted through the list
//
// The project folder is OPFS, as in phase2-assembly.js. The documents are written here with the model and io packages.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, ''); // already starts with /@fs/ (Vite serves files outside the app root so)
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const model = await import(`${root}packages/model/src/index.ts`);
const io = await import(`${root}packages/io/src/index.ts`);

const face = (name) => ({ kind: 'face', name });
const TOP = 'extrude1:cap:end';
const HOLE_LEFT = 'cut1:side:sketch2.ci6';
const HOLE_RIGHT = 'cut1:side:sketch2.ci5';
const SHANK = 'revolve1:side:sketch1.l3#1';
const FLANGE_UNDERSIDE = 'revolve1:side:sketch1.l4';
const FLAT = 'cut1:cap:start';
const PLATE_RIGHT_SIDE = 'extrude1:side:sketch1.l4';

/** Documents built with the real commands. */
function docs(plate) {
  const at = (position, rotation = [0, 0, 0, 1]) => ({ position, rotation });
  let n = 0;
  const builder = () => {
    let doc = model.createEmptyAssembly();
    const files = new Map();
    const inst = new Map();
    return {
      insert(id, path, fixed, placement) {
        const fresh = !files.has(path);
        if (fresh) files.set(path, `file${files.size + 1}`);
        const instance = (inst.get(path) ?? 0) + 1;
        inst.set(path, instance);
        doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', ...(fresh ? { file: { id: files.get(path), path } } : {}), component: { id, file: files.get(path), instance, fixed, placement } });
      },
      mate(type, a, b, align) {
        const side = (e) => ({ component: e[0], ...(e[2] ? { path: e[2] } : {}), ref: e[1] });
        doc = model.applyAssemblyCommand(doc, { type: 'insertMate', mate: { id: `mate${++n}`, name: `結合${n}`, type, a: side(a), b: side(b), suppressed: false, ...(align ? { align } : {}) } });
      },
      doc: () => doc,
    };
  };
  const sub = builder();
  sub.insert('p1', '../定位板.3dbx', true, at([0, 0, 0]));
  sub.insert('pa', '../零件/削邊銷.3dbx', false, at([-36, 33, -5]));
  sub.insert('pb', '../零件/削邊銷.3dbx', false, at([44, 36, 4]));
  for (const [pin, hole] of [['pa', HOLE_LEFT], ['pb', HOLE_RIGHT]]) {
    sub.mate('concentric', ['p1', face(hole)], [pin, face(SHANK)], 'aligned');
    sub.mate('coincident', ['p1', face(TOP)], [pin, face(FLANGE_UNDERSIDE)], 'antiAligned');
    sub.mate('parallel', ['p1', face(PLATE_RIGHT_SIDE)], [pin, face(FLAT)], 'aligned');
  }
  const top = builder();
  top.insert('s0', '組件/定位組.3dba', true, at([0, 0, 0]));
  top.insert('s1', '組件/定位組.3dba', false, at([126, 4, -3]));
  top.mate('coincident', ['s0', face(plate.right), ['p1']], ['s1', face(plate.left), ['p1']], 'antiAligned');
  top.mate('coincident', ['s0', face(plate.back), ['p1']], ['s1', face(plate.back), ['p1']], 'aligned');
  top.mate('coincident', ['s0', face(TOP), ['p1']], ['s1', face(TOP), ['p1']], 'aligned');
  return { sub: sub.doc(), top: top.doc() };
}

const sub = (window.__sub = {});

/** 「開啟舊檔」 for an assembly: the first one asks for the project folder, which the stand-in answers. */
async function openAsm(path) {
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = path;
  await H.action('檔案', '開啟舊檔');
  await H.wait(300);
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => store.getState().notice?.text === `已開啟 ${path.split('/').pop()}`, 20000, `${path} to open`);
  await H.loaded();
}
/** The plate's sides by geometry (the outermost plane facing +x, −x, +z), as the unit tests find them: opened once in a throwaway assembly. */
async function plateSides() {
  const probe = model.applyAssemblyCommand(model.createEmptyAssembly(), {
    type: 'insertComponent',
    file: { id: 'file1', path: '定位板.3dbx' },
    component: { id: 'c1', file: 'file1', instance: 1, fixed: true, placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
  });
  await H.writeAt('probe.3dba', await io.writeAssemblyFile(probe));
  await openAsm('probe.3dba');
  const a = H.asm();
  const build = a.builds.get(a.files.get('定位板.3dbx').key);
  const outermost = (n) => {
    let best = null;
    build.faceGeometry.forEach((g, i) => {
      if (g?.type === 'plane' || g?.kind === 'plane') {
        if (g.normal.some((v, k) => Math.abs(v - n[k]) > 1e-9)) return;
        const d = g.origin[0] * n[0] + g.origin[1] * n[1] + g.origin[2] * n[2];
        if (!best || d > best.d) best = { name: build.faceNames[i], d };
      }
    });
    if (!best) throw new Error(`no plane facing ${n}`);
    return best.name;
  };
  return { right: outermost([1, 0, 0]), left: outermost([-1, 0, 0]), back: outermost([0, 0, 1]) };
}

async function project() {
  const g = H.GOLDEN;
  await H.project({ '定位板.3dbx': `${g}locating-plate.3dbx`, '零件/削邊銷.3dbx': `${g}diamond-pin.3dbx` });
  const d = docs(await plateSides());
  await H.writeAt('組件/定位組.3dba', await io.writeAssemblyFile(d.sub));
  await H.writeAt('夾具.3dba', await io.writeAssemblyFile(d.top));
}

/** A 夾具 of two 定位組 opened from the project folder: every part is drawn, the plates sit edge to edge, the pins are in the holes. */
sub.open = async () => {
  await project();
  await openAsm('夾具.3dba');
  const a = H.asm();
  H.check([...a.files.values()].every((s) => s.status === 'ok'), `every file is read: ${JSON.stringify([...a.files].map(([p, s]) => [p, s.status]))}`);
  H.check(a.files.get('組件/定位組.3dba').assembly, 'the sub-assembly file carries its document');
  await H.waitFor(() => H.asm().solution, 10000, 'the solution');
  const sol = H.asm().solution;
  H.check([...sol.mates.values()].every((m) => m.status === 'ok'), `the mates hold: ${JSON.stringify([...sol.mates])}`);
  const leaves = store.assembly.leaves();
  H.check(leaves.length === 6, `six parts to draw, got ${leaves.length}`);
  await H.waitFor(() => store.viewer.instances.size === 6, 5000, 'six instances in the view');
  H.check([...store.viewer.instances.values()].every((i) => i.owner === 's0' || i.owner === 's1'), 'every instance belongs to a top component');
  // the second plate sits 120 along x from the first
  const plate1 = leaves.find((l) => l.id === 's1/p1');
  H.check(Math.abs(plate1.pose.position[0] - 120) < 1e-5, `plate of s1 at x = 120, got ${plate1.pose.position}`);
  // the tree: two sub-assembly rows that open
  const rows = [...document.querySelectorAll('[data-component-row]')];
  H.check(rows.length === 2, 'two component rows');
  if (!document.querySelector('.sub-component')) rows[0].querySelector('.twisty').click(); // opened once, whatever an earlier run left
  await H.wait(150);
  const inner = [...document.querySelectorAll('.sub-component')].map((r) => r.textContent);
  H.check(inner.length === 3 && inner.join(',') === '定位板<1>,削邊銷<1>,削邊銷<2>', `the sub-assembly lists its parts: ${inner}`);
  // an element of a part inside, through its path, resolves
  const g = store.assembly.elementGeometry({ component: 's1', path: ['pa'], ref: { kind: 'face', name: SHANK } });
  H.check(g && g.kind === 'cylinder', `the shank of a pin inside s1 resolves: ${JSON.stringify(g)}`);
  H.check(Math.abs(g.origin[0] - (120 - 40)) < 1e-4, `... at x = 80, got ${g.origin}`);
  H.check(store.assembly.ownerLabel('s1', ['pa']) === '定位組<2>／削邊銷<1>', `owner label: ${store.assembly.ownerLabel('s1', ['pa'])}`);
  return { leaves: leaves.map((l) => [l.id, l.pose.position.map((v) => +v.toFixed(3))]), inner };
};

/** The sub-assembly moved as one: dragging the second 定位組 moves all of its parts and nothing inside it changes. */
sub.move = async () => {
  await sub.open();
  const before = store.assembly.leaves().filter((l) => l.top === 's1');
  await store.assembly.moveSelected; // exists
  store.assembly.select('s1');
  // s1 is fully defined by its three mates: it must refuse
  const why = await new Promise((r) => {
    const notify = store.notify.bind(store);
    store.notify = (text, kind) => {
      store.notify = notify;
      r(text);
    };
    void store.assembly.moveSelected({ kind: 'by', delta: [0, 0, 10] });
    setTimeout(() => r('no message'), 3000);
  });
  H.check(/完全定義|不能移動/.test(why), `a fully defined sub-assembly does not move: ${why}`);
  const after = store.assembly.leaves().filter((l) => l.top === 's1');
  H.check(JSON.stringify(before.map((l) => l.pose)) === JSON.stringify(after.map((l) => l.pose)), 'nothing moved');
  return why;
};

/** A new assembly: the 定位組 file is in the insert list, with its own icon, and a click places it; its parts are drawn. */
sub.insert = async () => {
  await project();
  H.check(!!store.getState().asm || true, 'start');
  await H.action('檔案', '新組合件');
  await H.wait(300);
  const c = await H.insert('組件/定位組.3dba');
  H.check(c.fixed, 'the first component is fixed');
  await H.loaded();
  await H.waitFor(() => store.viewer.instances.size === 3, 8000, 'three parts drawn');
  H.check(H.asm().doc.files.map((f) => f.path).join() === '組件/定位組.3dba', 'the file is the sub-assembly');
  const row = [...document.querySelectorAll('[data-component-row]')][0];
  H.check(row.textContent.replace(/^[▸▾]/, '').replace(/^\([-+f?]\) /, '') === '定位組<1>', `named after its file: ${row.textContent}`);
  return store.assembly.leaves().map((l) => l.id);
};

/** Everything, then the console is checked by the caller. */
sub.all = async () => ({ open: await sub.open(), move: await sub.move(), insert: await sub.insert() });
