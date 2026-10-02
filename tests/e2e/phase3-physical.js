// Phase 3b-5b: the mass properties in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280x720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-physical.js?' + Date.now());
//   await __physical.run();
//
// It builds on phase3-subassembly.js (the fixture of two sub-assemblies in an OPFS project folder). The densities of the parts are set on the
// parts as built (the files have no material); the figures themselves are checked against the kernel in tests/phase3/evaluate-kernel.test.ts.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase3-subassembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const physical = (window.__physical = {});

const field = (name) => document.querySelector(`[data-physical] [data-field="${name}"]`);
const rows = (name) => [...(field(name)?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.children].map((td) => td.textContent));
const close = () => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === '取消').click();

physical.run = async () => {
  await __sub.open();
  await H.action('組合件', '物質特性…');
  await H.waitFor(() => document.querySelector('[data-physical]'), 5000, 'the mass properties');
  // no material: no mass, and the parts say so
  const lines = rows('lines');
  H.check(JSON.stringify(lines.map((r) => [r[0], r[1]])) === JSON.stringify([['定位板', '2'], ['削邊銷', '4']]), `lines: ${JSON.stringify(lines)}`);
  H.check(field('mass').textContent === '–', `no mass without a material: ${field('mass').textContent}`);
  H.check(field('noMaterial')?.textContent.includes('定位板') && field('noMaterial').textContent.includes('削邊銷'), 'the warning names both parts');
  H.check(!field('inertia'), 'no inertia without a mass');
  close();
  await H.wait(200);
  // give the parts a density and read it again
  const builds = store.assembly.state.builds;
  const volumes = {};
  for (const [key, b] of builds) {
    if (b.mass) {
      b.mass.density = 7.85;
      volumes[key] = b.mass.volume;
    }
  }
  await H.action('組合件', '物質特性…');
  await H.waitFor(() => field('inertia'), 5000, 'the inertia');
  const leaves = store.assembly.assembledLeaves();
  const expected = leaves.reduce((n, l) => n + ((volumes[l.mirrored ? l.key.slice(0, -3) : l.key] ?? 0) * 7.85) / 1000, 0);
  const shown = parseFloat(field('mass').textContent) * (field('mass').textContent.trim().endsWith('kg') ? 1000 : 1); // formatMass says kg from 1000 g
  H.check(Math.abs(shown - expected) < expected * 1e-3, `mass ${field('mass').textContent} against ${expected.toFixed(3)} g`);
  const inertia = rows('inertia').map((r) => r.map(Number));
  H.check(inertia.length === 3 && inertia.every((r) => r.length === 3), 'a 3 x 3 inertia');
  H.check(Math.abs(inertia[0][1] - inertia[1][0]) < 1e-3 * Math.abs(inertia[0][0]) && Math.abs(inertia[0][2] - inertia[2][0]) < 1e-3 * Math.abs(inertia[0][0]), 'the inertia is symmetric');
  const principal = rows('principal').map((r) => Number(r[0]));
  H.check(principal.length === 3 && principal[0] > 0 && principal[0] <= principal[1] && principal[1] <= principal[2], `principal moments ${principal}`);
  H.check(!field('noMaterial'), 'no warning once every part has a material');
  const result = { lines, mass: field('mass').textContent, center: field('center').textContent, principal };
  close();
  return result;
};
