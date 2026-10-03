// Phase 4a-1: an assembly from the bodies of a master model, in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase4-derived.js?' + Date.now());
//   await __derived.run();
//
// The project folder is OPFS, as in phase2-assembly.js, whose helpers come with it. The master is written here with the model and io packages
// (tests/support/derivedFixtures.ts: a workpiece 100 × 60 × 20 as a reference body, a base plate 120 × 80 × 15, a clamp 30 × 20 × 10).

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { master } = await import(`${root}tests/support/derivedFixtures.ts`);
const d = (window.__derived = {});

/** The highest point of a part as it is drawn (the mesh of its build), along z. */
const top = (build) => {
  let z = -Infinity;
  for (let i = 2; i < build.mesh.positions.length; i += 3) z = Math.max(z, build.mesh.positions[i]);
  return z;
};

d.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('夾具.3dbx', await io.writePartFile(master()));

  // the master, opened as a part: three bodies, the workpiece a reference body
  await H.open('夾具.3dbx');
  await H.waitFor(() => store.getState().result?.bodies.length === 3, 10000, 'three bodies');
  H.check(JSON.stringify(store.getState().result.bodies.map((b) => [b.name, b.reference])) === JSON.stringify([['工件', true], ['基板', false], ['ec', false]]), `the bodies: ${JSON.stringify(store.getState().result.bodies.map((b) => [b.name, b.reference]))}`);

  // 「從本體產生組合件」: the folder is asked for (the stand-in answers with the project folder), the files are written and the assembly opens
  document.querySelector('.status-bar .notice')?.click();
  await H.action('檔案', '從本體產生組合件');
  await H.wait(300);
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  await H.waitFor(() => store.getState().asm && store.getState().notice?.text.startsWith('已產生含 3 個衍生零件'), 30000, 'the assembly');
  await H.loaded();
  const a = H.asm();
  const files = [...a.files].map(([p, s]) => [p, s.status]);
  H.check(files.length === 3 && files.every(([, s]) => s === 'ok'), `the three derived parts are read and built: ${JSON.stringify(files)}`);
  H.check(a.doc.components.length === 3 && a.doc.components.every((c) => c.fixed), 'three components, all fixed');
  for (const path of ['夾具 組合件.3dba', '零件/工件.3dbx', '零件/基板.3dbx', '零件/ec.3dbx']) await H.readAt(path);
  await H.waitFor(() => store.viewer.instances.size === 3, 5000, 'three instances in the view');
  const baseKey = a.files.get('零件/基板.3dbx').key;
  H.check(Math.abs(top(a.builds.get(baseKey)) - 15) < 1e-6, `the base plate is 15 high: ${top(a.builds.get(baseKey))}`);

  // the parts list leaves the workpiece out
  await H.action('組合件', '零件表…');
  await H.waitFor(() => document.querySelector('[data-bom]'), 5000, 'the parts list');
  const rows = [...document.querySelectorAll('[data-bom] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)[1]);
  H.check(JSON.stringify(rows) === JSON.stringify(['基板', 'ec']), `the parts list: ${JSON.stringify(rows)}`);
  [...document.querySelectorAll('.modal button')].find((b) => b.textContent === '關閉' || b.textContent === '確定')?.click();
  await H.wait(200);

  // the master is changed (the base plate 20 thick) and saved: the assembly, read again, shows the new plate, with the same mates' names
  await H.writeAt('夾具.3dbx', await io.writePartFile(master('20')));
  await store.assembly.refresh();
  await H.loaded();
  await H.waitFor(() => H.asm().files.get('零件/基板.3dbx').key !== baseKey, 10000, 'the base plate to be built again');
  const after = H.asm();
  H.check(Math.abs(top(after.builds.get(after.files.get('零件/基板.3dbx').key)) - 20) < 1e-6, `the base plate is 20 high now: ${top(after.builds.get(after.files.get('零件/基板.3dbx').key))}`);
  H.check(after.files.get('零件/ec.3dbx').key === a.files.get('零件/ec.3dbx').key || after.files.get('零件/ec.3dbx').status === 'ok', 'the clamp is still there');
  console.log('phase4-derived: all checks passed');
  return true;
};
