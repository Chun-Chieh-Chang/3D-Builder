// Manual checklist E1 (docs/manual-verification.html): 「從本體產生組合件」 of a master part of three bodies (the workpiece a reference body, the base plate, the clamp); the parts list without the
// workpiece; the master edited in the application (the extrusion 「eb」, the base plate, from 15 to 20 deep) and saved; the assembly opened again: the plate is 20 thick; the command given
// a second time: a second assembly, the first not overwritten. Replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it).
// Not a Vitest test. The master is the one of phase4-derived.js (tests/support/derivedFixtures.ts).
//
//   await import('/@fs/<checkout>/tests/e2e/manual-e1.js?' + Date.now());   // in a freshly loaded page
//   await __manualE1.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { master } = await import(`${root}tests/support/derivedFixtures.ts`);
const M = (window.__manualE1 = {});

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
const top = (build) => {
  let z = -Infinity;
  for (let i = 2; i < build.mesh.positions.length; i += 3) z = Math.max(z, build.mesh.positions[i]);
  return z;
};
const listFiles = async () => {
  const names = [];
  for await (const [name, h] of H.root.entries()) if (h.kind === 'file') names.push(name);
  return names.sort();
};

M.run = async () => {
  await step('1 夾具.3dbx opened: 實體(3) with 工件（參考）, 基板, ec; nothing unsaved', async () => {
    H.ready();
    await H.project({});
    await H.writeAt('夾具.3dbx', await io.writePartFile(master()));
    await H.open('夾具.3dbx');
    await H.waitFor(() => store.getState().result?.bodies.length === 3, 10000, 'three bodies');
    const rows = [...document.querySelectorAll('.tree-row')].map((r) => r.textContent);
    return { rows, bodies: store.getState().result.bodies.map((b) => [b.name, b.reference]), dirty: store.getState().dirty, pass: rows.some((r) => /實體\(3\)/.test(r)) && !store.getState().dirty && store.getState().result.bodies.filter((b) => b.reference).length === 1 };
  });
  await step('2 「檔案」→「從本體產生組合件」, the folder chosen: the assembly opens with 3 derived parts, one for each body; the parts list has 基板 and ec only', async () => {
    document.querySelector('.status-bar .notice')?.click();
    await H.action('檔案', '從本體產生組合件');
    await H.wait(300);
    const asked = store.getState().folderRequest ?? '';
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.waitFor(() => store.getState().asm && store.getState().notice?.text.startsWith('已產生含 3 個衍生零件'), 30000, 'the assembly');
    await H.loaded();
    await H.waitFor(() => store.viewer.instances.size === 3, 5000, 'three instances');
    await H.action('組合件', '零件表…');
    await H.waitFor(() => document.querySelector('[data-bom]'), 5000, 'the parts list');
    const rows = [...document.querySelectorAll('[data-bom] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)[1]);
    document.querySelector('.modal button:last-child').click();
    await H.wait(200);
    return { asked, notice: store.getState().notice?.text, rows, components: H.asm().doc.components.length, pass: /3 個本體/.test(asked) && H.asm().doc.components.length === 3 && JSON.stringify(rows) === JSON.stringify(['基板', 'ec']) };
  });
  await step('3 the master opened again, the extrusion eb made 20 deep with ✔ and saved: the base plate is thicker', async () => {
    await H.action('檔案', '新零件');
    if (document.querySelector('.modal')) await H.modalButton('不儲存');
    await H.open('夾具.3dbx');
    await H.waitFor(() => store.getState().result?.bodies.length === 3, 10000, 'three bodies');
    const before = store.getState().result.bodies.find((b) => b.name === '基板').volume;
    const row = [...document.querySelectorAll('.tree-row')].filter((r) => H.rowName(r) === 'eb').at(-1);
    row.click();
    await H.wait(150);
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await H.settle();
    await H.pmInput('深度', '20');
    document.querySelector('.property-manager .pm-ok').click();
    await H.settle();
    await H.save('夾具.3dbx');
    const after = store.getState().result.bodies.find((b) => b.name === '基板').volume;
    return { before, after, pass: Math.abs(after / before - 20 / 15) < 1e-6 };
  });
  await step('4 the assembly opened again: the base plate is 20 thick, no component red', async () => {
    await H.open('夾具 組合件.3dba');
    await H.waitFor(() => H.asm() && H.asm().files.get('零件/基板.3dbx')?.status === 'ok', 20000, 'the files');
    await H.wait(1500);
    const plate = H.asm().builds.get(H.asm().files.get('零件/基板.3dbx').key);
    return { height: top(plate), red: document.querySelectorAll('.feature-tree .tree-row.error').length, pass: Math.abs(top(plate) - 20) < 1e-6 && document.querySelectorAll('.feature-tree .tree-row.error').length === 0 };
  });
  await step('5 「從本體產生組合件」 once more from the master: a second assembly, the first one is not overwritten', async () => {
    await H.action('檔案', '新零件');
    if (document.querySelector('.modal')) await H.modalButton('不儲存');
    await H.open('夾具.3dbx');
    await H.waitFor(() => store.getState().result?.bodies.length === 3, 10000, 'three bodies');
    document.querySelector('.status-bar .notice')?.click();
    await H.action('檔案', '從本體產生組合件');
    await H.wait(300);
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.waitFor(() => store.getState().asm && store.getState().notice?.text.startsWith('已產生含 3 個衍生零件'), 30000, 'the second assembly');
    await H.loaded();
    const names = (await listFiles()).filter((n) => n.endsWith('.3dba'));
    return { names, name: H.asm().fileName, pass: names.length === 2 && names.includes('夾具 組合件.3dba') && names.every((n, i, all) => all.indexOf(n) === i) };
  });
  return { name: 'E1', steps, pass: steps.every((s) => s.pass) };
};
