// E-3: forming a sub-assembly in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720, the tab in front):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-form-sub.js?' + Date.now());
//   await __form.run();
//
// It builds on phase3-subassembly.js: the 夾具 of two 定位組 (the first fixed, the second mated to it) is opened, both are formed into one sub-assembly through the
// PropertyManager; the new file is written beside 夾具.3dba, every part is where it was, the mates hold, one undo gives the two back, and a name that is taken is refused.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const form = (window.__form = {});

const near = (a, b, d = 1e-5) => a.every((v, i) => Math.abs(v - b[i]) < d);

form.run = async () => {
  await __sub.open();
  const a = store.assembly;
  const before = Object.fromEntries(a.leaves().map((l) => [l.id, l.pose.position]));
  H.check(Object.keys(before).length === 6, 'six parts before');

  await H.action('組合件', '形成次組合件…');
  await H.waitFor(() => H.asm().formSub, 5000, 'the panel');
  H.check(H.asm().formSub.name === '次組合件1', `a free name is offered: ${H.asm().formSub.name}`);
  // nothing picked: it cannot be formed, and says why
  const problem = () => document.querySelector('[data-field="formSubProblem"]')?.textContent ?? '';
  H.check(/至少要選兩個/.test(problem()), `one component picked is not enough: ${problem()}`);
  H.check(document.querySelector('[data-action="applyFormSub"]').disabled, 'and ✔ is not available');
  a.setFormSub({ ids: ['s0', 's1'] });
  await H.wait(200);
  H.check(problem() === '' && !document.querySelector('[data-action="applyFormSub"]').disabled, 'two picked: nothing in the way');
  a.setFormSub({ name: '兩個定位組' });
  await H.wait(100);
  document.querySelector('[data-action="applyFormSub"]').click();
  await H.waitFor(() => H.asm().doc.components.length === 1 && !H.asm().formSub, 15000, 'the sub-assembly formed');
  await H.waitFor(() => [...H.asm().files.values()].every((s) => s.status === 'ok') && H.asm().solution, 20000, 'the new file read and solved');
  await H.wait(500);
  const doc = H.asm().doc;
  H.check(doc.components[0].file && doc.files.some((f) => f.path === '兩個定位組.3dba'), `the assembly holds one component for the new file: ${JSON.stringify(doc.files.map((f) => f.path))}`);
  H.check(doc.mates.length === 0, 'the three mates were among the two: they are inside now');
  H.check(doc.components[0].fixed === true, 'it is fixed, as the first 定位組 was');
  const bytes = await H.readAt('兩個定位組.3dba');
  H.check(bytes.length > 100, `the file is written: ${bytes.length} bytes`);
  const sub = (await io.readDocumentFile(bytes)).doc;
  H.check(sub.components.length === 2 && sub.mates.length === 3, `it holds the two components and the three mates: ${sub.components.length}, ${sub.mates.length}`);
  const leaves = a.leaves();
  H.check(leaves.length === 6, `six parts to draw: ${leaves.length}`);
  const prefix = doc.components[0].id;
  const off = Object.entries(before).filter(([id, p]) => {
    const now = leaves.find((l) => l.id === `${prefix}/${id}`);
    return !now || !near(now.pose.position, p);
  });
  H.check(off.length === 0, `every part is where it was: ${JSON.stringify(off.map(([id]) => id))}`);
  H.check([...H.asm().solution.mates.values()].every((m) => m.status === 'ok'), 'the mates hold');

  // one undo: the two components and the mates are back (the file stays where it was written)
  a.undo();
  await H.wait(500);
  H.check(H.asm().doc.components.length === 2 && H.asm().doc.mates.length === 3, 'one undo gives the two components and the three mates back');
  H.check((await H.readAt('兩個定位組.3dba')).length === bytes.length, 'the file written stays');

  // the name is taken now: refused, and nothing changes
  await H.action('組合件', '形成次組合件…');
  await H.waitFor(() => H.asm().formSub, 5000, 'the panel again');
  a.setFormSub({ ids: ['s0', 's1'], name: '兩個定位組' });
  document.querySelector('[data-action="applyFormSub"]')?.click();
  await H.wait(800);
  H.check(H.asm().doc.components.length === 2 && H.asm().formSub, 'a name the folder has is refused: nothing changed and the panel stays');
  a.cancelFormSub();
  H.check(!H.asm().formSub, 'the panel closes');
  return { parts: Object.keys(before).length, file: bytes.length };
};
