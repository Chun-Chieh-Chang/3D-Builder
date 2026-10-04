// Phase 7-7: the gauge table in the PropertyManager of the base flange. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-gauge-ui.js?' + Date.now());
//   await __gaugeUi.run();
//
// A plate 100 × 50 × 1.5 (a base flange) is opened and its base flange edited. The table has no rows; 「把目前的參數加為一列」 makes one; a row of 2 mm (radius 3, K 0.4) is put in the
// table; applied from the list, the base flange takes its numbers (the plate is 2 thick: 10000 mm³), and the table is in the file.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__gaugeUi = {});

const doc = () => build(sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' });
const result = () => store.getState().result;
const flange = () => store.getState().doc.features.find((f) => f.type === 'baseFlange');
const gauges = () => store.getState().doc.sheetGauges ?? [];
const pm = () => document.querySelector('.property-manager');

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('板.3dbx', await io.writePartFile(doc()));
  await H.open('板.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the plate');

  store.beginEdit('bf');
  await H.waitFor(() => store.getState().editing?.featureId === 'bf', 5000, 'editing the base flange');
  await H.settle();
  H.check(pm().querySelector('[data-gauges]') && gauges().length === 0 && !pm().querySelector('select'), 'a gauge table with no rows and nothing to apply');
  pm().querySelector('[data-field="add-gauge"]').click();
  await H.settle();
  H.check(gauges().length === 1 && gauges()[0].thickness === 1.5 && gauges()[0].radius === 2, `the current parameters are a row: ${JSON.stringify(gauges())}`);
  store.execute({ type: 'setSheetGauges', gauges: [...gauges(), { name: '2.0 mm', thickness: 2, radius: 3, kFactor: 0.4 }] });
  await H.settle();
  const select = pm().querySelector('[data-gauges] select');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '1');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await H.settle();
  H.check(flange().thickness === '2' && flange().radius === '3' && flange().kFactor === '0.4', 'the base flange took the numbers of the row');
  H.check(Math.abs(result().bodies[0].volume - 10000) < 1e-3, `the plate is 2 thick: ${result().bodies[0].volume}`);
  store.commitEdit();
  await H.settle();
  await H.save('板.3dbx');
  H.check(gauges().length === 2, 'the table is in the part');

  await H.tidy();
  console.log('phase7-gauge-ui: all checks passed');
  return true;
};
