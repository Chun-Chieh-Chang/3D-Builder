// ADR 0254: the feature tree as a person sees it, on the SDS-plus drill bit an agent modelled from a photo (tests/golden/sds-plus-bit.3dbx): curves in their own folder,
// the helix of a sweep shown once, no ↳ hint that repeats the sketch unfolded under the row, the parameters node, the estimate mark (context menu, badge, the quick filter),
// a name that is taken refused with a free one offered, the eye of a hidden sketch out of the way until the row is pointed at, and a variable marked in 方程式. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-feature-tree-0254.js?' + Date.now());   // in a freshly loaded page
//   await __featureTree0254.run();   // -> { name, steps: [{ name, pass }], pass }

const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2, { store } = H;
const M = (window.__featureTree0254 = {});
const state = () => store.getState();
const steps = [];
const step = async (name, fn) => {
  try {
    const r = await fn();
    steps.push({ name, ...r, pass: !!r.pass });
  } catch (e) {
    steps.push({ name, pass: false, error: String(e?.stack ?? e) });
  }
};
const rows = () => [...document.querySelectorAll('.feature-tree .tree-row')];
const nameOf = (r) => (r.querySelector('.name')?.textContent ?? '').replace(/^\([-+f?]\) /, '');
const rowsNamed = (n) => rows().filter((r) => nameOf(r) === n);
const menu = async (row, item) => {
  const b = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 8, button: 2 }));
  await H.wait(150);
  const li = [...document.querySelectorAll('.context-menu li')].find((x) => x.textContent === item);
  if (!li) throw new Error(`no menu item ${item}: ${[...document.querySelectorAll('.context-menu li')].map((x) => x.textContent).join(' | ')}`);
  li.click();
  await H.settle();
};
const ready = async () => {
  await H.wait(100);
  await H.waitFor(() => !state().rebuilding && state().result, 60000, 'the drill bit rebuilt');
};

M.run = async () => {
  steps.length = 0;
  H.ready?.();
  const at = async (what, fn) => {
    try {
      return await fn();
    } catch (e) {
      throw new Error(`${what}: ${e?.message ?? e}`);
    }
  };
  // read the way 開啟舊檔 reads it and handed to the store, without a project folder (no file dialog is needed for what is checked here)
  await at('open', async () => {
    const io = await import(`${root}packages/io/src/index.ts`);
    const file = await io.readPartFile(new Uint8Array(await (await fetch(`${H.GOLDEN}sds-plus-bit.3dbx`)).arrayBuffer()));
    store.load(file.doc, null, '鑽頭.3dbx', file.blobs);
  });
  await at('rebuild', ready);
  const doc = () => state().doc;

  await step('1 curves have their own folder; the bodies folder counts the solid only', async () => {
    const bodies = rows().find((r) => /^實體\(\d+\)$/.test(nameOf(r)));
    const curves = document.querySelector('[data-tree-curves]');
    const solids = state().result.bodies.filter((b) => !b.curve).length;
    const curveCount = state().result.bodies.filter((b) => b.curve).length;
    return { bodies: bodies && nameOf(bodies), curves: curves && nameOf(curves), pass: !!bodies && nameOf(bodies) === `實體(${solids})` && curveCount > 0 && nameOf(curves) === `曲線(${curveCount})` };
  });

  await step('2 every helix a sweep runs along is one row, not also under the sweep', async () => {
    const helices = doc().features.filter((f) => f.type === 'helix');
    // history rows only: the curve the helix makes is listed once more, as a body, in the curves folder
    const counts = helices.map((h) => rowsNamed(h.name).filter((r) => r.matches('[data-feature-row]')).length);
    return { helices: helices.map((h) => h.name), counts, pass: helices.length > 0 && counts.every((n) => n === 1) };
  });

  await step('3 a ↳ hint never names the sketch unfolded right under its row', async () => {
    const repeats = [];
    const list = rows();
    list.forEach((r, i) => {
      const hint = r.querySelector('.tree-parent-hint')?.textContent.replace(/^↳ /, '');
      if (!hint) return;
      for (let j = i + 1; j < list.length && list[j].classList.contains('absorbed-sketch'); j++) if (nameOf(list[j]) === hint) repeats.push(nameOf(r));
    });
    return { repeats, pass: repeats.length === 0 };
  });

  await step('4 the parameters node lists the variables with their values when unfolded', async () => {
    const node = document.querySelector('[data-tree-parameters]');
    const n = doc().variables.length;
    if (!node) return { pass: false, variables: n };
    const folded = document.querySelectorAll('[data-variable]').length;
    node.click();
    await H.wait(100);
    const shown = [...document.querySelectorAll('[data-variable]')].map((x) => x.textContent);
    await window.__shot?.('tree-0254-parameters');
    return { label: nameOf(node), folded, shown, pass: n > 0 && nameOf(node) === `參數(${n})` && folded === 0 && shown.length === n && shown.every((x) => /=\s*-?\d/.test(x)) };
  });

  await step('5 標為估計值: the mark is saved on the feature, the badge shows, the quick filter keeps only it', async () => {
    const sweep = doc().features.find((f) => f.type === 'sweep');
    const unmarked = doc().features.find((f) => f.type === 'helix');
    store.execute({ type: 'setFeatureNote', featureId: unmarked.id, comment: '估計值' });
    await H.settle();
    await menu(rowsNamed(sweep.name)[0], '標為估計值');
    const marked = doc().features.find((f) => f.id === sweep.id)?.estimate === true;
    const badge = !!rowsNamed(sweep.name)[0]?.querySelector('[data-estimate]');
    const filter = document.querySelector('[data-action="filter-estimates"]');
    const label = filter?.textContent;
    filter?.click();
    await H.wait(100);
    const left = rows().filter((r) => r.matches('[data-feature-row]')).map(nameOf);
    await window.__shot?.('tree-0254-estimate-filter');
    document.querySelector('[data-action="filter-estimates"]')?.click();
    await H.wait(100);
    await menu(rowsNamed(sweep.name)[0], '取消估計值標記');
    const cleared = doc().features.find((f) => f.id === sweep.id)?.estimate === undefined;
    return { marked, badge, label, left, cleared, pass: marked && badge && label === '估計值 1' && left.length === 1 && left[0] === sweep.name && cleared };
  });

  await step('6 a name another feature has is refused, with a free one offered, and nothing changes', async () => {
    const [a, b] = doc().features.filter((f) => f.type === 'sketch');
    const before = doc();
    await menu(rowsNamed(b.name).find((r) => r.matches('[data-feature-row]')), '重新命名…');
    const input = document.querySelector('.feature-tree input.rename');
    input.value = a.name;
    input.blur();
    await H.settle();
    const notice = state().notice?.text ?? '';
    return { notice, pass: doc() === before && notice.includes(`已經有名稱是「${a.name}」的特徵`) && notice.includes('例如「') };
  });

  await step('7 the eye of a hidden sketch is out of the way until its row is pointed at', async () => {
    const hidden = rows().find((r) => r.querySelector('.vis-toggle:not(.shown)') && !r.classList.contains('selected'));
    if (!hidden) return { pass: false, why: 'no hidden sketch row' };
    const eye = hidden.querySelector('.vis-toggle');
    const idle = getComputedStyle(eye).opacity;
    return { idle, pass: idle === '0' };
  });

  await step('8 方程式: the estimate box marks a variable; the tree badges it and the quick filter lists it among the parameters', async () => {
    const v = doc().variables[0];
    store.openDialog('equations');
    await H.wait(150);
    const box = document.querySelector(`[data-estimate-var="${v.name}"]`);
    if (!box) return { pass: false, why: 'no estimate box in the equations dialog' };
    box.click();
    await H.settle();
    const marked = doc().variables.find((x) => x.id === v.id)?.estimate === true;
    store.openDialog(null);
    await H.wait(100);
    document.querySelector('[data-action="filter-estimates"]')?.click();
    await H.wait(150);
    const listed = [...document.querySelectorAll('[data-variable]')].map((x) => x.dataset.variable);
    const badged = !!document.querySelector(`[data-variable="${v.name}"] [data-estimate]`);
    await window.__shot?.('tree-0254-estimate-variable');
    document.querySelector('[data-action="filter-estimates"]')?.click();
    await H.wait(100);
    return { marked, listed, badged, pass: marked && badged && listed.length === 1 && listed[0] === v.name };
  });

  await window.__shot?.('tree-0254');
  return { name: 'feature tree (ADR 0254)', steps, pass: steps.length === 8 && steps.every((s) => s.pass) };
};
