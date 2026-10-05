// Phase 3b-2c: patterns and mirrors of components in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-component-pattern.js?' + Date.now());
//   await __pat.run();
//
// It builds on phase3-subassembly.js (the project folder in OPFS, the 夾具 with two 定位組).

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const pat = (window.__pat = {});

const near = (a, b, d = 1e-6) => Math.abs(a - b) < d;
const leafOf = (id) => store.assembly.leaves().find((l) => l.id === id);

/** The command-bar button, then the PropertyManager it opens. */
async function start(label) {
  await H.action('組合件', label);
  await H.waitFor(() => H.asm().pattern && document.querySelector('.property-manager .pm-title'), 5000, `the ${label} PropertyManager`);
}
const ok = async () => {
  document.querySelector('.property-manager .pm-ok').click();
  await H.wait(300);
};

/** An assembly of two 定位組 (the first fixed, the second free: it is mated to nothing), so that a seed can move. */
async function twoFree() {
  await __sub.insert(); // a new assembly with 定位組<1> (fixed)
  await H.insert('組件/定位組.3dba', [0.75, 0.5]);
  await H.loaded();
  await H.waitFor(() => store.viewer.instances.size === 6, 8000, 'six parts');
  await H.wait(800);
}

pat.linear = async () => {
  await twoFree();
  const a = store.assembly;
  a.select('comp1');
  await start('線性複製排列');
  H.check(H.asm().pattern.pattern.seed === 'comp1' && H.asm().pattern.pattern.kind === 'linear', 'the selected component is the seed');
  H.check(store.viewer.instances.size === 6 + 6, `the preview shows 2 instances × 3 parts: ${store.viewer.instances.size}`);
  a.setPatternDraft({ count1: 4, spacing1: '40', flip1: false });
  await H.wait(300);
  H.check(store.viewer.instances.size === 6 + 9, `three instances: ${store.viewer.instances.size}`);
  const p3 = leafOf('comp1/p1@pattern-preview#3'); // a pattern being made has the preview id until it is added
  const seed = leafOf('comp1/p1');
  H.check(p3 && near(p3.pose.position[0], seed.pose.position[0] + 80) && near(p3.pose.position[1], seed.pose.position[1]), `the third is 80 along x: ${p3?.pose.position}`);
  // skip the second, then ✓
  a.setPatternDraft({ skip: ['2'] });
  await H.wait(300);
  H.check(store.viewer.instances.size === 6 + 6, 'one skipped');
  await ok();
  H.check(!H.asm().pattern && H.asm().doc.patterns.length === 1, 'the pattern is in the document');
  const row = document.querySelector('[data-pattern-row]');
  H.check(row && row.textContent.includes('線性複製排列1') && row.textContent.includes('定位組<1>'), `a row in the tree: ${row?.textContent}`);
  H.check(store.viewer.instances.size === 12, 'twelve parts drawn');
  return { rows: H.tree().length };
};

pat.circular = async () => {
  await pat.linear();
  const a = store.assembly;
  a.select('comp1');
  await start('環狀複製排列');
  a.setPatternDraft({ count1: 4, spacing1: '90' });
  await H.wait(300);
  const seed = leafOf('comp1/p1');
  const q = leafOf('comp1/p1@pattern-preview#2');
  // 90° about the assembly's z axis through the origin takes (x, y) to (−y, x)
  H.check(near(q.pose.position[0], -seed.pose.position[1]) && near(q.pose.position[1], seed.pose.position[0]), `turned a quarter about z: ${q.pose.position} from ${seed.pose.position}`);
  await ok();
  H.check(H.asm().doc.patterns.length === 2, 'two patterns');
};

pat.mirror = async () => {
  await pat.circular();
  const a = store.assembly;
  a.select('comp2');
  await start('鏡射零組件');
  H.check(H.asm().pattern.pattern.kind === 'mirror' && H.asm().pattern.pattern.seed === 'comp2', 'mirror of the selected component');
  const id = 'pattern-preview';
  await H.waitFor(() => store.assembly.leaves().filter((l) => l.mirrored).length === 3 && [...H.asm().builds.keys()].some((k) => k.endsWith(':mx')), 10000, 'the mirrored parts and their meshes');
  const seed = leafOf('comp2/p1');
  const mirrored = leafOf(`comp2/p1@${id}`);
  H.check(near(mirrored.pose.position[0], -seed.pose.position[0]) && near(mirrored.pose.position[1], seed.pose.position[1]), `reflected in the right plane: ${mirrored.pose.position} from ${seed.pose.position}`);
  await H.waitFor(() => store.viewer.instances.has(`comp2/p1@${id}`), 5000, 'the mirrored plate drawn');
  const inst = store.viewer.instances.get(`comp2/p1@${id}`);
  const m = inst.group.matrix.elements;
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  H.check(near(det, 1, 1e-9), `the pose is a rotation (the mirror is in the mesh): det ${det}`);
  await ok();
  H.check(H.asm().doc.patterns.length === 3, 'three patterns');
  return { mirroredBuilds: [...H.asm().builds.keys()].filter((k) => k.endsWith(':mx')).length };
};

pat.follow = async () => {
  await pat.mirror();
  const a = store.assembly;
  const before = a.leaves().filter((l) => l.top === 'comp2').map((l) => [l.id, l.pose.position.slice()]);
  a.select('comp2');
  await a.moveSelected({ kind: 'by', delta: [0, 0, 25] });
  await H.wait(800);
  const after = a.leaves().filter((l) => l.top === 'comp2');
  H.check(after.length === before.length && after.length === 6, `the seed's three parts and the mirrored three: ${after.length}`);
  const moved = after.map((l) => +(l.pose.position[2] - before.find(([id]) => id === l.id)[1][2]).toFixed(6));
  H.check(moved.every((d) => near(d, 25, 1e-4)), `the instances moved with the seed: ${moved}`);
  // hiding and suppressing the seed take the instances with it
  a.setComponentState(['comp2'], 'hidden', true);
  await H.wait(400);
  H.check(![...store.viewer.instances.values()].some((i) => i.owner === 'comp2'), 'hidden: seed and mirror are gone from the view');
  a.setComponentState(['comp2'], 'hidden', false);
  a.setComponentState(['comp2'], 'suppressed', true);
  await H.wait(800);
  H.check(a.leaves().filter((l) => l.top === 'comp2').length === 0, 'suppressed: no instances');
  a.undo();
  await H.wait(800);
  H.check(a.leaves().filter((l) => l.top === 'comp2').length === 6, 'unsuppressed: back');
};

pat.edit = async () => {
  await pat.follow();
  const a = store.assembly;
  a.editPattern('pattern1');
  await H.waitFor(() => H.asm().pattern?.editing === 'pattern1', 3000, 'edit');
  a.setPatternDraft({ count1: 2, skip: [] });
  await H.wait(400);
  await ok();
  H.check(H.asm().doc.patterns[0].count1 === 2 && a.leaves().filter((l) => l.instanceOf === 'pattern1').length === 3, 'edited: one instance of three parts');
  // an axis that is an element of a component: the edge picked from the view stands in for a drag of the picking
  await start('線性複製排列');
  const id = H.asm().pattern.pattern.id;
  const plate = a.buildOfLeaf(leafOf('comp2/p1'));
  const i = plate.edgeGeometry.findIndex((g) => g?.kind === 'line');
  H.check(i >= 0, 'the plate has a straight edge');
  a.pickPatternAxis('axis1');
  a.pickElement({ component: 'comp2', path: ['p1'], ref: { kind: 'edge', name: plate.edgeNames[i], fingerprint: plate.edgeFingerprints[i] } });
  await H.wait(400);
  H.check(H.asm().pattern.pattern.axis1.kind === 'ref' && !H.asm().pattern.picking, 'the axis is the edge');
  H.check(document.querySelector('.property-manager select option[value="ref"]'), 'the panel names it');
  await ok();
  H.check(H.asm().doc.patterns.length === 4, 'four');
  // delete one with Delete
  a.select('pattern1');
  await H.key('Delete');
  await H.wait(400);
  H.check(!H.asm().doc.patterns.some((p) => p.id === 'pattern1') && H.asm().doc.patterns.length === 3, 'deleted with the Delete key');
  // deleting the component that gives an axis takes the pattern with it, and the seed's instances
  return { patterns: H.asm().doc.patterns.map((p) => [p.id, p.kind, p.seed]) };
};

pat.saveReopen = async () => {
  await pat.edit();
  H.next.save = '夾具-排列.3dba';
  await H.action('檔案', '另存新檔');
  await H.waitFor(() => !H.asm().dirty, 10000, 'the save');
  const before = store.assembly.leaves().length;
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = '夾具-排列.3dba';
  await H.action('檔案', '開啟舊檔');
  await H.waitFor(() => store.getState().notice?.text === '已開啟 夾具-排列.3dba', 20000, 'open');
  await H.loaded();
  await H.wait(1500);
  H.check(H.asm().doc.patterns.length === 3, 'the patterns are back');
  H.check(store.assembly.leaves().length === before, `the same parts are drawn: ${store.assembly.leaves().length} vs ${before}`);
  H.check(store.assembly.patternProblems().size === 0, `no problems: ${JSON.stringify([...store.assembly.patternProblems()])}`);
};

/** STEP of the assembly with patterns and a mirror: the worker writes the instances and the mirrored products. */
pat.step = async () => {
  await pat.saveReopen();
  const req = store.assembly.stepRequest();
  const text = H.decodeStep((await store.api.exportAssemblyStep(req)).text);
  const products = [...new Set([...text.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => m[1]))];
  const usages = (text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g) ?? []).length;
  H.check(products.some((p) => p.includes('鏡射')), `a mirrored product: ${products}`);
  H.check(req.instances.length > req.subs.length, `the pattern instances are components: ${req.instances.length}`);
  H.check(usages >= req.instances.length, `usages ${usages}`);
  return { products, usages, instances: req.instances.map((i) => i.name) };
};

pat.run = async () => {
  await pat.saveReopen();
  return 'ok';
};
