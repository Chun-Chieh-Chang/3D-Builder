// E1 側邊欄比照工程圖（docs/sidebar-parity-plan.md、ADR 0155）：零件與組合件的兩個分頁、切換只隱藏不卸載（計畫 §2.4）、
// 工作階段開啟時自動進屬性頁而 FeatureManager 仍可點、組合件樹的搜尋列（E1-P2 補完），以及 §2.2 的選取切換：圖面點到東西
// 自動進屬性頁、PropertyManager 依選取顯示可收合群組（面的識別與實測面積、邊的長度、特徵的參數與編輯）。Replayed in the app's page
// (http://127.0.0.1:5395, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The part is the master of
// phase4-derived.js (tests/support/derivedFixtures.ts), as manual-e1.js replays it.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-sidebar-tabs.js?' + Date.now());   // in a freshly loaded page
//   await __manualSidebarTabs.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { master } = await import(`${root}tests/support/derivedFixtures.ts`);
const M = (window.__manualSidebarTabs = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, measured: r, detail: r?.pass === true ? undefined : r });
  return r;
};
/** The two tab buttons of the part/assembly sidebar, in the order the panel draws them. */
const tabEls = () => [...document.querySelectorAll('.left-panel .sw-tabs [role="tab"]')];
const tabs = () => tabEls().map((b) => ({ text: b.textContent, selected: b.getAttribute('aria-selected'), disabled: b.disabled }));
/** The two panes of the sidebar: [0] the tree, [1] the properties — with whether the page currently shows them. */
const panes = () => [...document.querySelectorAll('.left-panel .sw-pane')].map((p) => ({ hidden: p.hasAttribute('hidden'), display: getComputedStyle(p).display }));
/** Types into a box the way a person does (the native setter, so React's onChange hears it). */
const typeIn = async (el, text) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(250);
};
/** Opens the master part of manual-e1.js (an extrusion eb on a sketch) and waits for it. */
const openMaster = async () => {
  H.ready();
  // the parameters docked in the sidebar, which is what is checked here; by default they float in a card of their own (ADR 0203)
  store.setOptions({ floatingParameters: false });
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
  await H.writeAt('夾具.3dbx', await io.writePartFile(master()));
  await H.open('夾具.3dbx');
  await H.waitFor(() => store.getState().result?.bodies.length === 3, 20000, 'three bodies');
};

M.run = async () => {
  await step('0 夾具.3dbx opened: two tabs, the tree is the page shown, the PropertyManager tab is off', async () => {
    await openMaster();
    const t = tabs();
    const p = panes();
    const rows = document.querySelectorAll('.sw-pane:not([hidden]) .tree-row').length;
    return {
      pass:
        t.length === 2 &&
        t[0].text === 'FeatureManager' &&
        t[1].text === 'PropertyManager' &&
        t[0].selected === 'true' &&
        t[1].selected === 'false' &&
        t[1].disabled === true &&
        p.length === 2 &&
        p[0].hidden === false &&
        p[0].display !== 'none' &&
        p[1].hidden === true &&
        p[1].display === 'none' &&
        rows > 0 &&
        !document.querySelector('.sw-pane:not([hidden]) .property-manager'),
      tabs: t,
      panes: p,
      rows,
    };
  });

  await step('1 「eb」 double-clicked: the session opens the PropertyManager page by itself, the FeatureManager page is still there', async () => {
    const row = [...document.querySelectorAll('.feature-tree .tree-row')].filter((r) => H.rowName(r) === 'eb').at(-1);
    if (!row) throw new Error('no eb row in the tree');
    row.click();
    await H.wait(150);
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await H.waitFor(() => store.getState().editing?.featureId && document.querySelector('.property-manager .pm-title')?.textContent.includes('eb'), 10000, 'the session');
    const t = tabs();
    const p = panes();
    const title = document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-title')?.textContent ?? '';
    return {
      pass: t[1].selected === 'true' && t[1].disabled === false && t[0].disabled === false && p[1].hidden === false && p[1].display !== 'none' && p[0].hidden === true && title.includes('eb') && !!document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-ok'),
      tabs: t,
      panes: p,
      title,
    };
  });

  await step('2 the FeatureManager page clicked in the session: the tree is shown, the panel fields stay in the page (§2.4)', async () => {
    tabEls()[0].click();
    await H.wait(250);
    const p = panes();
    const kept = document.querySelector('.sw-pane[hidden] .property-manager'); // still there, only hidden
    const field = kept?.querySelector('[data-field]') ?? kept?.querySelector('.pm-row input');
    return {
      pass: p[0].hidden === false && p[0].display !== 'none' && p[1].hidden === true && p[1].display === 'none' && !!kept && !!field,
      panes: p,
      keptTitle: kept?.querySelector('.pm-title')?.textContent,
      field: field?.getAttribute('data-field') ?? field?.getAttribute('type') ?? null,
    };
  });

  await step('3 back to the PropertyManager page, ✓ commits: the tree page comes back, and the picked feature keeps the properties page reachable', async () => {
    tabEls()[1].click();
    await H.wait(250);
    const shown = panes()[1].display !== 'none';
    document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-ok').click();
    await H.waitFor(() => store.getState().editing === null, 10000, 'the session to end');
    await H.wait(250);
    const t = tabs();
    const p = panes();
    // the tree item is still picked, so the properties page stays reachable for it (§2.2) — the panel behind it is the selection panel's, not the session's
    const sessionGone = !document.querySelector('.pm-ok'); // the session's ✓ is the one thing a selection panel never has
    const hasSel = !!document.querySelector('.sw-pane[hidden] [data-selection-panel]');
    return { pass: shown && t[0].selected === 'true' && t[1].disabled === false && p[0].hidden === false && p[1].hidden === true && sessionGone && hasSel, tabs: t, panes: p, sessionGone, hasSel, selected: store.getState().selected };
  });

  await step('4 a face clicked in the view brings the properties page forward (§2.2): its name, its feature, its measured area', async () => {
    // the model fills the canvas, but which pixel is a face is the viewer's business: a few tries, a click on nothing lets go and is no harm
    for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.42], [0.42, 0.5]]) {
      await H.clickAt(fx, fy);
      if (store.getState().selectedFace) break;
    }
    const st = store.getState();
    if (!st.selectedFace) throw new Error('no face was picked in the view');
    const panel = document.querySelector('.sw-pane:not([hidden]) [data-selection-panel]');
    if (!panel) throw new Error('the selection panel is not the page shown');
    const t = tabs();
    const p = panes();
    const facts = st.selectionFacts;
    const area = Number(panel.querySelector('[data-field="area"]')?.textContent ?? NaN);
    const owner = panel.querySelector('[data-field="owner"]')?.textContent ?? '';
    const known = st.doc.features.some((f) => f.name === owner);
    const title = panel.querySelector('.sw-pm-title strong')?.textContent ?? '';
    const sub = panel.querySelector('.sw-pm-title span')?.textContent ?? '';
    return {
      pass:
        t[1].selected === 'true' && t[1].disabled === false && p[1].hidden === false && p[1].display !== 'none' &&
        title === '面' && sub === st.selectedFace.name &&
        panel.querySelector('[data-field="name"]')?.textContent === st.selectedFace.name &&
        known && facts?.elements.length === 1 && Number.isFinite(area) && area > 0 && Math.abs(area - (facts?.elements[0]?.area ?? NaN)) <= Math.abs(area) * 1e-4 + 1e-4 &&
        !!panel.querySelector('[data-field="kind"]')?.textContent && !!panel.querySelector('[data-field="point"]')?.textContent,
      tabs: t,
      panes: p,
      face: st.selectedFace.name,
      title,
      sub,
      owner,
      area,
      measured: facts?.elements[0]?.area ?? null,
    };
  });

  await step('5 ✓ lets go of the pick: the tree page is back and the tab goes off again', async () => {
    document.querySelector('.sw-pane:not([hidden]) [data-action="clearSelection"]').click();
    await H.waitFor(() => store.getState().selectedFace === null, 5000, 'the pick to be let go');
    await H.wait(250);
    const t = tabs();
    const p = panes();
    return { pass: t[0].selected === 'true' && t[1].disabled === true && p[0].hidden === false && p[1].hidden === true && !document.querySelector('[data-selection-panel]'), tabs: t, panes: p };
  });

  await step('6 a click in the tree stays in the tree; the properties page shows the feature\'s parameters and edits them with no session open, and 「編輯特徵」 starts the session', async () => {
    const row = [...document.querySelectorAll('.feature-tree .tree-row')].filter((r) => H.rowName(r) === 'eb').at(-1);
    if (!row) throw new Error('no eb row in the tree');
    row.click();
    await H.wait(150);
    const afterTreeClick = tabs();
    tabEls()[1].click();
    await H.wait(250);
    const panel = document.querySelector('.sw-pane:not([hidden]) [data-selection-panel]');
    if (!panel) throw new Error('the selection panel is not the page shown');
    const rows = {
      name: panel.querySelector('[data-field="name"]')?.textContent ?? '',
      kind: panel.querySelector('[data-field="kind"]')?.textContent ?? '',
      state: panel.querySelector('[data-field="state"]')?.textContent ?? '',
      title: panel.querySelector('.sw-pm-title strong')?.textContent ?? '',
      sub: panel.querySelector('.sw-pm-title span')?.textContent ?? '',
    };
    // §2.2: the properties page lays out the feature's parameter groups — the very ones a session shows (「方向 1」 with the depth in it)
    const heads = [...panel.querySelectorAll('.pm-group h4')].map((h) => h.textContent);
    const depthRow = [...panel.querySelectorAll('.pm-group .pm-row')].find((r) => r.querySelector('span')?.textContent === '深度');
    const depthInput = depthRow?.querySelector('input');
    if (!depthInput) throw new Error('no depth field in the properties page');
    const depthBefore = depthInput.value;
    const ebFeature = () => store.getState().doc.features.find((f) => f.id === 'eb');
    const plateVolume = () => Math.max(...store.getState().result.bodies.map((b) => b.volume));
    // typing a depth here writes an immediate command (no session, one undo step) and the model is rebuilt from it
    await typeIn(depthInput, '18');
    depthInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await H.waitFor(() => ebFeature()?.dir1.depth === '18', 10000, 'the depth to be written');
    await H.waitFor(() => Math.abs(plateVolume() - 120 * 80 * 18) < 1, 20000, 'the plate to be rebuilt 18 deep');
    const edited = { depth: ebFeature().dir1.depth, volume: plateVolume(), session: !!document.querySelector('.property-manager .pm-ok') };
    await H.ctrl('z');
    await H.waitFor(() => ebFeature()?.dir1.depth === '15', 10000, 'the depth to be undone');
    await H.waitFor(() => Math.abs(plateVolume() - 120 * 80 * 15) < 1, 20000, 'the plate to be back');
    const undone = { depth: ebFeature().dir1.depth, volume: plateVolume() };
    const edit = panel.querySelector('[data-action="editFeature"]');
    edit.click();
    await H.waitFor(() => store.getState().editing?.featureId && document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-title')?.textContent.includes('eb'), 10000, 'the session');
    const inSession = { panel: !!document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-ok'), selectionPanel: !!document.querySelector('[data-selection-panel]') };
    document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-ok').click();
    await H.waitFor(() => store.getState().editing === null, 10000, 'the session to end');
    await H.wait(250);
    return {
      pass:
        afterTreeClick[0].selected === 'true' && afterTreeClick[1].disabled === false &&
        rows.title === '特徵' && rows.sub === 'eb' && rows.name === 'eb' && rows.kind.length > 0 && rows.state === '正常' &&
        heads.includes('方向 1') && depthBefore === '15' &&
        edited.depth === '18' && Math.abs(edited.volume - 172800) < 1 && !edited.session &&
        undone.depth === '15' && Math.abs(undone.volume - 144000) < 1 &&
        inSession.panel && !inSession.selectionPanel &&
        tabs()[0].selected === 'true',
      afterTreeClick,
      rows,
      heads,
      depthBefore,
      edited,
      undone,
      inSession,
    };
  });

  await step('7 two edges with Ctrl: the panel counts them and measures each one', async () => {
    const v = store.viewer;
    v.events.onEdgeClick(0, false);
    await H.settle();
    v.events.onEdgeClick(1, true);
    await H.settle();
    const st = store.getState();
    if (st.selectedElements.length !== 2) throw new Error(`two edges expected, picked ${st.selectedElements.length}`);
    const panel = document.querySelector('.sw-pane:not([hidden]) [data-selection-panel]');
    if (!panel) throw new Error('the selection panel is not the page shown');
    const names = [...panel.querySelectorAll('[data-field="name"]')].map((n) => n.textContent);
    const lengths = [...panel.querySelectorAll('[data-field="length"]')].map((n) => Number(n.textContent));
    const facts = st.selectionFacts;
    const head = panel.querySelector('.sw-pm-title span')?.textContent ?? '';
    const everyLength = lengths.length === 2 && lengths.every((x) => Number.isFinite(x) && x > 0);
    const measured = (facts?.elements ?? []).every((e, i) => Math.abs((e.length ?? NaN) - (lengths[i] ?? NaN)) <= Math.abs(lengths[i] ?? NaN) * 1e-4 + 1e-4);
    return {
      pass:
        tabs()[1].selected === 'true' &&
        head === '已選 2 個元素' &&
        JSON.stringify(names) === JSON.stringify(st.selectedElements.map((r) => r.name)) &&
        everyLength && measured && facts?.elements.length === 2,
      head,
      names,
      lengths,
      measured: facts?.elements.map((e) => e.length) ?? null,
    };
  });

  await step('8 a new assembly: the two tabs work there too, and 「開始組合件」 leaves the tree page when it is done', async () => {
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    await H.waitFor(() => store.getState().asm && document.querySelector('.property-manager .pm-title')?.textContent === '開始組合件', 15000, '開始組合件');
    const during = { tabs: tabs(), panes: panes() };
    const okDuring = !!document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-ok');
    await H.insert('定位板.3dbx');
    await H.wait(250);
    const t = tabs();
    const p = panes();
    const rows = document.querySelectorAll('.sw-pane:not([hidden]) [data-component-row]').length;
    return {
      // the inserted component is the tree's pick, so the properties page stays reachable for it (§2.2) — the page itself is the tree's
      pass: during.tabs[1].selected === 'true' && during.tabs[0].disabled === false && okDuring && t[0].selected === 'true' && t[1].disabled === false && p[0].hidden === false && rows === 1,
      during,
      tabs: t,
      panes: p,
      rows,
    };
  });

  await step('9 the assembly tree search box (E1-P2): a needle keeps the component by name, a blank one keeps every row', async () => {
    await H.waitFor(() => document.querySelectorAll('[data-component-row]').length >= 1, 15000, 'the component row');
    const box = document.querySelector('.sw-pane:not([hidden]) .tree-filter input[type="search"]');
    if (!box) throw new Error('no search box in the assembly tree');
    const all = document.querySelectorAll('[data-component-row]').length;
    const names = [...document.querySelectorAll('[data-component-row] .name')].map((n) => n.textContent);
    await typeIn(box, '定位');
    const kept = document.querySelectorAll('[data-component-row]').length;
    const keptName = document.querySelector('[data-component-row] .name')?.textContent ?? '';
    await typeIn(box, 'zzzz-none');
    const none = document.querySelectorAll('[data-component-row]').length;
    const noneMsg = document.querySelector('.tree-filter .muted')?.textContent ?? '';
    await typeIn(box, '');
    const back = document.querySelectorAll('[data-component-row]').length;
    return {
      pass: all >= 1 && kept === 1 && /定位/.test(keptName) && none === 0 && /沒有符合/.test(noneMsg) && back === all && names.length === all,
      all,
      kept,
      keptName,
      none,
      noneMsg,
      back,
    };
  });

  const pass = steps.every((s) => s.pass);
  return { name: 'manual-sidebar-tabs', steps, pass };
};
