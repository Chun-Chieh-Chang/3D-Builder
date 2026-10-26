// Native component hatches, derived details and independent view captions.
// await __assemblySectionCaptions.run();
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(root + 'tests/e2e/phase2-assembly.js?' + Date.now());
const H = window.__ui2, { store } = H;
const M = await import(root + 'packages/model/src/index.ts');
const IO = await import(root + 'packages/io/src/index.ts');
const D = await import(root + 'packages/drawing/src/index.ts');
const state = () => store.getState().drw, pg = () => H.page(state().doc), d = () => store.drawingStore;
const check = (ok, why) => { if (!ok) throw new Error(why); };
const near = (a, b) => Math.abs(a - b) < 0.03;
const view = id => pg().views.find(v => v.id === id);
const caption = id => d().scene().scene.items.find(i => i.kind === 'text' && i.viewCaption === id);
const captionNode = id => document.querySelector(`[data-svg] [data-view-caption="${id}"]`);
const send = (type, x, y, extra = {}) => document.querySelector('[data-drawing-canvas]').dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 31, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, ...extra }));
async function dragCaption(id, delta, cancel = false) {
  const node = captionNode(id); check(node, 'actual caption SVG text exists');
  const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const pixels = document.querySelector('[data-svg] svg').getBoundingClientRect().width / 420;
  send('pointerdown', x, y); await H.wait(50);
  for (let i = 1; i <= 4; i++) { send('pointermove', x + delta[0] * pixels * i / 4, y - delta[1] * pixels * i / 4); await H.wait(30); }
  check(!view(id).caption?.offset, 'drag is a preview before release');
  if (cancel) await H.key('Escape');
  send('pointerup', x + delta[0] * pixels, y - delta[1] * pixels); await H.wait(150);
}
async function edit(field, value) {
  const el = document.querySelector(`[data-field="${field}"]`); check(el, `editable ${field}`);
  el.scrollIntoView({ block: 'nearest' });
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true })); await H.wait(60);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await H.wait(120);
}
const regionBox = region => { const pts = region.cut.flatMap(l => Array.from({ length: l.length / 2 }, (_, i) => [l[2 * i], l[2 * i + 1]])); return { min: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1]))], max: [Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))] }; };
window.__assemblySectionCaptions = { run: async () => {
  const steps = [];
  const step = async (name, fn) => { try { await fn(); steps.push({ name, pass: true }); await window.__shot?.(name); } catch (error) { steps.push({ name, pass: false, error: String(error?.stack ?? error) }); throw error; } };
  try {
    let top;
    await step('1 native two-component assembly and a section through both parts', async () => {
      H.ready(); await H.project({ 'plate.3dbx': H.GOLDEN + 'locating-plate.3dbx' });
      let asm = M.createEmptyAssembly();
      for (let i = 0; i < 2; i++) asm = M.applyAssemblyCommand(asm, { type: 'insertComponent', ...(i === 0 ? { file: { id: 'file1', path: 'plate.3dbx' } } : {}), component: { id: `part${i + 1}`, file: 'file1', instance: i + 1, fixed: true, placement: { position: [120 * i, 0, 0], rotation: [0, 0, 0, 1] } } });
      await H.writeAt('assembly.3dba', await IO.writeAssemblyFile(asm)); await H.open('assembly.3dba'); await H.loaded();
      await H.newDrawing(['top']); await H.waitFor(() => pg().views.length === 1 && state().lines.get(pg().views[0].id), 30000, 'top projection');
      top = pg().views[0]; d().setView(top.id, { at: [150, 230] });
      const box = state().lines.get(top.id).box, y = (box.min[1] + box.max[1]) / 2;
      check(d().execute({ type: 'insertViews', views: [{ id: 'cut', name: 'section', kind: 'section', parent: top.id, line: [[box.min[0] - 5, y], [box.max[0] + 5, y]], label: 'A', at: [150, 130] }] }), 'create section');
      await H.waitFor(() => state().lines.get('cut')?.cutRegions?.length === 2, 30000, 'component-owned native cuts');
      const regions = state().lines.get('cut').cutRegions;
      check(regions.every(r => r.cut.length > 0), 'both components are really cut');
      check(new Set(regions.map(r => r.component)).size === 2, 'distinct leaf identities survive worker transfer');
    });
    await step('2 section and detail use different component hatch directions', async () => {
      const regions = state().lines.get('cut').cutRegions, a = regionBox(regions[0]), b = regionBox(regions[1]);
      const pairs = [a.min[0], a.max[0]].flatMap(x => [b.min[0], b.max[0]].map(y => [Math.abs(x - y), (x + y) / 2])).sort((a, b) => a[0] - b[0]);
      const centre = [pairs[0][1], (Math.max(a.min[1], b.min[1]) + Math.min(a.max[1], b.max[1])) / 2];
      check(d().execute({ type: 'insertViews', views: [{ id: 'detail', name: 'detail', kind: 'detail', parent: 'cut', centre, radius: 12, label: 'B', scale: [3, 1], at: [330, 130] }] }), 'create detail');
      await H.wait(150);
      const resolved = D.resolveLines(state().doc, state().lines);
      for (const id of ['cut', 'detail']) {
        const l = resolved.get(id); check(l.cutRegions.length === 2, 'detail retains both native component regions');
        const items = D.viewItems(view(id), { ...l, visible: [], hidden: [], tangent: [], tangentHidden: [] }, d().scene().placed.get(id), M.hatchStyleOf(view(id), pg().views));
        const angles = items.filter(i => i.points.length === 4).map(i => { const p = i.points; return Math.round((Math.atan2(p[3] - p[1], p[2] - p[0]) * 180 / Math.PI + 180) % 180); });
        check(angles.includes(45) && angles.includes(135), `${id} visibly distinguishes both components`);
      }
    });
    await step('3 drag caption independently with preview, cancellation and one-step undo', async () => {
      const original = { at: [...d().scene().placed.get('cut').at], caption: [...caption('cut').at], shift: JSON.stringify(pg().sheet.shift) };
      await dragCaption('cut', [13, -9], true); check(!view('cut').caption, 'Escape cancels caption placement');
      await dragCaption('cut', [13, -9]);
      check(near(view('cut').caption.offset[0], 13) && near(view('cut').caption.offset[1], -9), 'paper-space offset stored');
      check(JSON.stringify(d().scene().placed.get('cut').at) === JSON.stringify(original.at), 'view body stays put');
      check(JSON.stringify(pg().sheet.shift) === original.shift, 'sheet arrangement stays put');
      check(near(caption('cut').at[0] - original.caption[0], 13), 'actual rendered text follows');
      d().undo(); await H.wait(100); check(!view('cut').caption, 'one undo resets caption'); d().redo(); await H.wait(100);
    });
    await step('4 double-click and edit names, section letters, custom captions and live scale tokens', async () => {
      const node = captionNode('cut'), r = node.getBoundingClientRect();
      document.querySelector('[data-drawing-canvas]').dispatchEvent(new MouseEvent('dblclick', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
      await H.wait(100); check(document.activeElement?.dataset.field === 'viewCaptionText', 'double-click focuses caption editor');
      await edit('viewLabel', 'C'); await edit('viewCaptionText', '剖面 <LABEL>-<LABEL>');
      check(caption('cut').text === '剖面 C-C', 'section caption is editable');
      check(d().scene().scene.items.filter(i => i.kind === 'text' && i.text === 'C').length >= 2, 'cutting-line letters follow the same label');
      d().select(top.id); await H.wait(100); await edit('viewName', '裝配上視'); check(caption(top.id).text === '裝配上視', 'ordinary view caption follows its editable name');
      d().select('detail'); await H.wait(100); await edit('viewCaptionText', '細部 <LABEL> (<SCALE>)'); await edit('viewLabel', 'D'); d().setView('detail', { scale: [4, 1] }); await H.wait(150);
      check(caption('detail').text === '細部 D (4:1)', 'detail caption follows true scale');
      document.querySelector('[data-action="resetViewCaption"]').click(); await H.wait(100); check(caption('detail').text === 'D (4:1)', 'reset restores automatic caption');
      const topLabel = captionNode(top.id).getBoundingClientRect();
      send('pointerdown', topLabel.left + topLabel.width / 2, topLabel.top + topLabel.height / 2, { ctrlKey: true });
      send('pointerup', topLabel.left + topLabel.width / 2, topLabel.top + topLabel.height / 2, { ctrlKey: true }); await H.wait(100);
      check(state().selection.filter(x => x.kind === 'view').length === 2, 'Ctrl-caption toggles view selection without dragging');
      d().select('detail');
    });
    await step('5 saved drawing restores component hatches and edited caption positions', async () => {
      H.next.save = 'sections.3dbd'; await H.action('檔案', '儲存檔案'); await H.waitFor(() => !state().dirty, 10000, 'save drawing'); await H.open('sections.3dbd');
      await H.waitFor(() => state()?.lines.get('cut')?.cutRegions?.length === 2, 30000, 'reopened native assembly cuts');
      check(caption('cut').text === '剖面 C-C', 'caption text survives reopen');
      check(near(view('cut').caption.offset[0], 13), 'caption offset survives reopen');
      check(caption('detail').text === 'D (4:1)', 'scale stays associative after reopen');
    });
    await step('6 dimension selection, placement and numeric editing win over overlapping view captions', async () => {
      const native = D.visibleElements(state().lines.get(top.id), state().edges.get(top.id), state().features.get(top.id) ?? []);
      const edge = native.edges.find(e => Math.abs(e.a[1] - e.b[1]) < 1e-7 && Math.abs(e.a[0] - e.b[0]) > 5);
      check(edge, 'a real horizontal projected edge is required');
      const placed = d().scene().placed.get(top.id);
      const at = D.toSheet(placed, (edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2);
      const original = caption(top.id);
      d().setView(top.id, { caption: { offset: [at[0] - original.at[0], at[1] - original.at[1]] } });
      await H.wait(120);
      const client = point => { const r = document.querySelector('[data-svg] svg').getBoundingClientRect(); return [r.left + point[0] / 420 * r.width, r.top + (297 - point[1]) / 297 * r.height]; };
      const click = async point => { const [x, y] = client(point); send('pointermove', x, y, { buttons: 0 }); await H.wait(60); send('pointerdown', x, y); send('pointerup', x, y); await H.wait(150); };
      d().setTool({ kind: 'dimension', picks: [], mode: 'horizontal' }); await H.wait(100);
      await click(at);
      check(state().tool?.kind === 'dimension' && state().tool.picks.length === 1, 'overlapping caption must not steal the first geometry click');
      const count = pg().dimensions.length;
      await click(at);
      check(pg().dimensions.length === count + 1 && state().tool?.kind === 'dimension', 'caption must not cancel dimension placement');
      const dim = pg().dimensions.at(-1);
      await H.waitFor(() => d().scene().dimensions.get(dim.id)?.value > 0, 10000, 'native dimension value');
      const outcome = d().scene().dimensions.get(dim.id);
      check(near(outcome.value, Math.abs(edge.b[0] - edge.a[0])), 'true native edge length is preserved');
      const text = outcome.items.find(i => i.kind === 'text');
      d().setTool(null);
      const current = caption(top.id), offset = view(top.id).caption.offset;
      d().setView(top.id, { caption: { offset: [offset[0] + text.at[0] - current.at[0], offset[1] + text.at[1] - current.at[1]] } });
      await H.wait(100);
      const labelOffset = JSON.stringify(view(top.id).caption.offset);
      const point = [text.at[0], text.at[1] + text.height / 2], [x, y] = client(point);
      document.querySelector('[data-drawing-canvas]').dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
      await H.wait(100); check(document.activeElement?.dataset.field === 'dimText', 'numeric text above a caption remains editable');
      document.activeElement?.blur();
      const pixels = document.querySelector('[data-svg] svg').getBoundingClientRect().width / 420;
      send('pointerdown', x, y); for (let i = 1; i <= 4; i++) { send('pointermove', x + 7 * pixels * i / 4, y); await H.wait(30); } send('pointerup', x + 7 * pixels, y); await H.wait(150);
      const moved = d().scene().dimensions.get(dim.id), movedText = moved.items.find(i => i.kind === 'text');
      check(near(movedText.at[0] - text.at[0], 7) && near(movedText.at[1], text.at[1]), 'numeric drag moves the rendered text 7 mm regardless of edge orientation');
      check(near(moved.value, outcome.value), 'numeric dragging preserves the native measured value');
      check(JSON.stringify(view(top.id).caption.offset) === labelOffset, 'overlapping caption stays put');
    });
    return { pass: true, steps };
  } catch (error) { return { pass: false, steps, error: String(error?.message ?? error) }; }
}};
