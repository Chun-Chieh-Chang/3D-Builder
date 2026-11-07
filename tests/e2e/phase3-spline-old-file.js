// ADR 0244, in the page: a part saved before schema 92 opens with the solid of the curve its sketch draws and a notice naming the sketch; the same part saved now opens without one.
// The volume is checked against the curve's own formula, written out here, not read from the product.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-spline-old-file.js?' + Date.now());
//   await __splineOldFile.run();
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(root + 'tests/e2e/phase2-assembly.js?' + Date.now());
const H = window.__ui2;
const { store } = H;
const M = await import(root + 'packages/model/src/index.ts');
const IO = await import(root + 'packages/io/src/index.ts');

const must = (ok, text) => {
  if (!ok) throw new Error(text);
};

// well off round: on the old fitted curve this very shape was not a valid solid (ADR 0243)
const radii = [28, 12, 25, 9, 30, 14, 22, 8, 27, 16, 19, 11];
const xy = radii.map((r, i) => [r * Math.cos((2 * Math.PI * i) / 12), r * Math.sin((2 * Math.PI * i) / 12)]);
const HEIGHT = 10;

function part() {
  let doc = M.createEmptyPart();
  const add = (feature) => {
    doc = M.applyCommand(doc, { type: 'insertFeature', index: doc.features.length, feature });
  };
  const points = xy.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y }));
  add({ id: 's', name: 'wavy outline', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [...points, { id: 'sp', type: 'spline', points: points.map((p) => p.id), closed: true }], constraints: [] });
  add({ id: 'e', name: 'body', type: 'extrude', suppressed: false, sketch: 's', op: 'boss', dir1: { type: 'blind', depth: String(HEIGHT) } });
  add({ id: 's2', name: 'plain circle', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [{ id: 'c', type: 'point', x: 100, y: 0 }, { id: 'circle', type: 'circle', center: 'c', radius: 10 }], constraints: [] });
  add({ id: 'e2', name: 'disc', type: 'extrude', suppressed: false, sketch: 's2', op: 'boss', dir1: { type: 'blind', depth: String(HEIGHT) } });
  return doc;
}

/** The area inside the closed uniform Catmull-Rom through the points, by the shoelace formula on the cubic's own values. */
function drawnArea() {
  const n = xy.length;
  const curve = [];
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = [xy[(i + n - 1) % n], xy[i], xy[(i + 1) % n], xy[(i + 2) % n]];
    for (let k = 0; k < 2000; k++) {
      const t = k / 2000;
      const at = (j) => 0.5 * (2 * b[j] + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t * t * t);
      curve.push([at(0), at(1)]);
    }
  }
  return Math.abs(curve.reduce((s, p, i) => {
    const q = curve[(i + 1) % curve.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

const expected = (drawnArea() + Math.PI * 100) * HEIGHT;

/** Not `H.open`: that one waits for the exact words of an open with nothing to tell. */
async function open(name, bytes) {
  await H.writeAt(name, bytes);
  document.querySelector('.status-bar .notice')?.click();
  H.next.open = name;
  await H.action('檔案', '開啟舊檔');
  await H.waitFor(() => store.getState().notice?.text.includes(name), 20000, `${name} to open`);
  const notice = store.getState().notice.text;
  await H.settle();
  await H.waitFor(() => store.getState().result?.bodies?.length === 2 && store.getState().result.mass, 30000, `${name} to be built`);
  return notice;
}

function checkSolid(label) {
  const { result } = store.getState();
  const off = Math.abs(result.mass.volume - expected) / expected;
  must(off < 1e-4, `${label}: volume ${result.mass.volume} against the drawn curve's ${expected}, ${off} off`);
  return off;
}

window.__splineOldFile = {
  run: async () => {
    H.ready();
    await H.project({});
    const old = JSON.parse(M.serializePart(part()));
    old.schemaVersion = 91;
    const oldNotice = await open('old.3dbx', new TextEncoder().encode(JSON.stringify(old)));
    must(oldNotice.includes('wavy outline'), `the notice names the sketch with the spline: "${oldNotice}"`);
    must(!oldNotice.includes('plain circle'), `and not the other one: "${oldNotice}"`);
    const oldOff = checkSolid('old file');

    const newNotice = await open('new.3dbx', await IO.writePartFile(part()));
    must(!newNotice.includes('wavy outline'), `a file saved now has nothing to tell: "${newNotice}"`);
    const newOff = checkSolid('new file');
    return { pass: true, oldNotice, oldOff, newOff };
  },
};
