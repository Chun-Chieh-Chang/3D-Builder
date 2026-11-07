// The geometry code stopping (a WebAssembly trap, ADR 0242), in the page: the worker is replaced whatever it was doing, the model computed again in the new one, the part stays on the screen,
// and a second crash in a row stops and says what happened. No part is known that traps in a real rebuild (that is the point of the guards in the kernel), so the crash is handed to the page
// at the one place it arrives, the answer of a call to the worker: the replacing, the rebuild after it and the second worker are all real. The real trap, through a real worker and a real
// Comlink, is the first thing checked here; through the rebuild it is tests/phase3/crash-real-trap.test.ts.
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-worker-crash.js?' + Date.now());
//   await __workerCrash.run();
const root = new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/, '');
await import(root + 'tests/e2e/phase2-assembly.js?' + Date.now());
const H = window.__ui2;
const { store } = H;
const M = await import(root + 'packages/model/src/index.ts');
const IO = await import(root + 'packages/io/src/index.ts');
const Comlink = await import(root + 'node_modules/comlink/dist/esm/comlink.js');
const { isWorkerCrash, CRASH_NAME } = await import(root + 'apps/web/src/worker/crash.ts');

const must = (ok, text) => {
  if (!ok) throw new Error(text);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function part() {
  let doc = M.createEmptyPart();
  const add = (feature) => {
    doc = M.applyCommand(doc, { type: 'insertFeature', index: doc.features.length, feature });
  };
  add({ id: 's', name: 'disc', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'o', type: 'circle', center: 'c', radius: 10 }], constraints: [], dimensions: [] });
  add({ id: 'e', name: 'disc body', type: 'extrude', suppressed: false, sketch: 's', op: 'boss', dir1: { type: 'blind', depth: '10' } });
  return doc;
}

/** A real worker, a real trap in it, across a real Comlink. */
async function realTrap() {
  const worker = new Worker(new URL(root + 'tests/e2e/workers/trap.worker.js', location.origin), { type: 'module' });
  try {
    const remote = Comlink.wrap(worker);
    // a worker that did not load never answers: that is said, not waited for
    const broken = new Promise((_, reject) => (worker.onerror = (e) => reject(new Error(`the worker did not load: ${e.message}`))));
    const failure = (p) => Promise.race([p.then(() => null, (e) => e), broken]);
    const crash = await failure(remote.trap());
    must(isWorkerCrash(crash), `the trap arrives as a crash: ${crash?.name} ${crash?.message}`);
    must(crash.name === CRASH_NAME && /null function|signature mismatch/.test(crash.message), `what it was: ${crash.message}`);
    const plain = await failure(remote.plain());
    must(plain && !isWorkerCrash(plain), `an OCCT failure is not a crash: ${plain?.name}`);
    return crash.message;
  } finally {
    worker.terminate();
  }
}

/** Every worker the page starts from here on answers `faults[name]` calls of `name` with what `error()` makes. */
function fail() {
  const faults = {};
  const calls = {};
  const answers = {};
  const wrap = () => {
    const real = store.remote;
    store.remote = new Proxy(real, {
      get: (target, name) => {
        if (typeof name === 'symbol' || name === 'then') return target[name];
        return (...args) => {
          calls[name] = (calls[name] ?? 0) + 1;
          const fault = faults[name]?.shift();
          if (fault) return Promise.reject(fault());
          const answer = target[name](...args);
          return answers[name] ? answer.then(answers[name]) : answer;
        };
      },
    });
  };
  const start = store.startWorker;
  store.startWorker = function () {
    start.call(store);
    wrap();
  };
  wrap();
  return { faults, calls, answers, restore: () => (store.startWorker = start) };
}

const crash = (why) => () => Object.assign(new Error(why), { name: CRASH_NAME });

window.__workerCrash = {
  run: async () => {
    const trapped = await realTrap();

    H.ready();
    await H.project({});
    await H.writeAt('disc.3dbx', await IO.writePartFile(part()));
    await H.open('disc.3dbx');
    await H.waitFor(() => store.getState().result?.mass, 30000, 'the part');
    const volume = store.getState().result.mass.volume;
    must(Math.abs(volume - Math.PI * 1000) < 1, `the part: ${volume}`);
    const doc = store.getState().doc;
    const { faults, calls, answers, restore } = fail();
    const settled = async (what) => {
      await H.waitFor(() => !store.getState().rebuilding && store.getState().bootMs !== null, 30000, what);
      await sleep(300);
      await H.waitFor(() => !store.getState().rebuilding, 30000, what);
    };
    try {
      // once: replaced, computed again, and the part on the screen
      await store.rebuild();
      await settled('the plain rebuild');
      let worker = store.worker;
      const before = store.getState().result;
      faults.rebuild = [crash('特徵「disc body」使幾何核心中斷')];
      calls.rebuild = 0;
      store.rebuild();
      await H.waitFor(() => store.worker !== worker, 10000, 'the worker replaced');
      must(store.getState().result, 'the part stays while the new worker starts');
      await H.waitFor(() => store.getState().result !== before, 30000, 'the model computed again');
      must(calls.rebuild === 2, `computed again once: ${calls.rebuild}`);
      must(Math.abs(store.getState().result.mass.volume - volume) < 1e-9, 'the same part');
      must(store.getState().doc === doc, 'the document is not touched');
      must(store.getState().notice?.kind === 'error' && store.getState().notice.text.includes('disc body'), `it says what: ${store.getState().notice?.text}`);
      must(store.getState().notice.text.includes('已換新並重新計算'), `and that it went on: ${store.getState().notice.text}`);
      await settled('after the first');

      // an ordinary failure is no crash: the worker stays
      worker = store.worker;
      faults.rebuild = [() => new Error('not a crash')];
      store.rebuild();
      await H.waitFor(() => store.getState().notice?.text.includes('not a crash'), 10000, 'the plain failure');
      must(store.worker === worker, 'the worker stays after an ordinary failure');
      await settled('after the plain failure');

      // twice: stopped, and the last result still there; nothing goes on trying
      const shown = store.getState().result;
      worker = store.worker;
      faults.rebuild = [crash('特徵「disc body」使幾何核心中斷'), crash('特徵「disc body」使幾何核心中斷')];
      calls.rebuild = 0;
      store.rebuild();
      await H.waitFor(() => store.getState().notice?.text.includes('連續中斷'), 30000, 'the second crash said');
      must(store.getState().notice.text.includes('disc body'), `it names the feature: ${store.getState().notice.text}`);
      must(store.worker !== worker, 'the worker replaced again');
      await sleep(1500);
      must(calls.rebuild === 2, `it stopped trying: ${calls.rebuild}`);
      must(store.getState().result === shown, 'the last result is still shown');
      must(store.getState().rebuilding === false, 'nothing says it is still computing');

      // the next thing asked tries again, in the new worker, and all is as it was
      store.rebuild();
      await H.waitFor(() => store.getState().result !== shown, 30000, 'the next rebuild');
      must(Math.abs(store.getState().result.mass.volume - volume) < 1e-9, 'computed again in the new worker');
      await settled('after the second');

      // and that was a rebuild finished: one crash is one crash again
      const fresh = store.getState().result;
      faults.rebuild = [crash('again')];
      calls.rebuild = 0;
      store.rebuild();
      await H.waitFor(() => store.getState().result !== fresh, 30000, 'computed again after one more');
      must(calls.rebuild === 2 && store.getState().notice.text.includes('已換新並重新計算'), `the count started over: ${calls.rebuild} ${store.getState().notice.text}`);
      await settled('after one more');

      // a crash in anything else: the caller is told, and the worker replaced and the model computed again all the same
      const last = store.getState().result;
      worker = store.worker;
      faults.exactMass = [crash('function signature mismatch')];
      calls.rebuild = 0;
      const answer = await store.exactMass(null).then(() => null, (e) => e);
      must(answer && answer.name === CRASH_NAME, `the caller is told: ${answer}`);
      must(store.worker !== worker, 'replaced after a crash elsewhere');
      await H.waitFor(() => store.getState().result !== last, 30000, 'computed again after a crash elsewhere');
      must(calls.rebuild === 1, `once: ${calls.rebuild}`);
      must(store.getState().result.bodies.length === 1, 'the part is there to ask about');
      await settled('after a crash elsewhere');
      const mass = await store.exactMass(null);
      must(Math.abs(mass.volume - volume) < 1e-6, `and the new worker answers: ${mass?.volume}`);

      // a trap taken as a refusal (a STEP file written as it is): the answer stands, the next rebuild is in a new module, and it does not go round if the document itself does that
      const clean = store.getState().result;
      worker = store.worker;
      answers.rebuild = (r) => ({ ...r, trapsAbsorbed: 1 });
      calls.rebuild = 0;
      store.rebuild();
      await H.waitFor(() => store.worker !== worker && store.getState().result !== clean && !store.getState().rebuilding, 30000, 'replaced after a refusal');
      const replaced = store.worker;
      await sleep(1500);
      must(store.worker === replaced, 'it does not go round');
      must(calls.rebuild === 2, `computed once more, and only that: ${calls.rebuild}`);
      must(store.getState().doc === doc, 'the document is not touched');
      // another rebuild of the same document that says the same stays where it is, and one that does not clears it
      store.rebuild();
      await sleep(1500);
      must(store.worker === replaced, 'still the same document');
      delete answers.rebuild;
      store.rebuild();
      await settled('a clean rebuild');
      answers.rebuild = (r) => ({ ...r, trapsAbsorbed: 1 });
      worker = store.worker;
      store.rebuild();
      await H.waitFor(() => store.worker !== worker, 30000, 'replaced again after a clean result');
      delete answers.rebuild;
      await settled('after the refusals');

      // an assembly: its parts stay on the screen and are built again in the new worker, whose shapes they then are
      let asm = M.createEmptyAssembly();
      asm = M.applyAssemblyCommand(asm, { type: 'insertComponent', file: { id: 'f1', path: 'disc.3dbx' }, component: { id: 'a', file: 'f1', instance: 1, fixed: true, placement: { position: [0, 0, 0], rotation: [1, 0, 0, 0] } } });
      await H.writeAt('two.3dba', await IO.writeAssemblyFile(asm));
      await H.open('two.3dba');
      const builds = () => H.asm().builds;
      await H.waitFor(() => builds().size === 1 && H.asm().solution, 30000, 'the assembly');
      const first = [...builds().values()][0];

      // a build that crashes once: the worker is replaced, the part is built again in it, and all is there
      worker = store.worker;
      faults.buildPart = [crash('in the part')];
      calls.buildPart = 0;
      store.assembly.workerReplaced(); // a part the worker has is not built again, so nothing would be asked of it
      store.rebuild();
      await H.waitFor(() => store.worker !== worker, 20000, 'the worker replaced in the assembly');
      must(store.getState().notice.text.includes('已換新並重新計算'), `it says so: ${store.getState().notice.text}`);
      must(builds().get(first.key), 'the part stays on the screen');
      await H.waitFor(() => calls.buildPart >= 2 && [...H.asm().files.values()].every((f) => f.status === 'ok'), 30000, 'built again in the new worker');
      must(calls.buildPart === 2, `built once more: ${calls.buildPart}`);
      await sleep(500);

      // even with nothing crashing in it, a replaced worker has none of the parts: the next read builds them
      worker = store.worker;
      faults.exactMass = [crash('elsewhere')];
      calls.buildPart = 0;
      await store.exactMass(first.key).catch(() => null);
      must(store.worker !== worker, 'replaced from the assembly');
      await H.waitFor(() => calls.buildPart === 1 && [...H.asm().files.values()].every((f) => f.status === 'ok'), 30000, 'the part in the newer worker');
      const exact = await store.exactMass(first.key);
      must(exact && Math.abs(exact.volume - volume) < 1e-6, `and it is really there: ${exact?.volume}`);
      await sleep(500);

      // twice in a row: stops, and does not go round for ever (every part read is a call that would crash again)
      faults.buildPart = [crash('in the part'), crash('in the part')];
      calls.buildPart = 0;
      store.assembly.workerReplaced();
      store.rebuild();
      await H.waitFor(() => store.getState().notice?.text.includes('連續中斷'), 30000, 'the second crash said in the assembly');
      await sleep(1500);
      must(calls.buildPart === 2, `it stopped trying: ${calls.buildPart}`);
      must(builds().get(first.key), 'the part is still shown after it stopped');

      // and the next time, it is built
      store.rebuild();
      await H.waitFor(() => calls.buildPart === 3 && [...H.asm().files.values()].every((f) => f.status === 'ok'), 30000, 'built after it stopped');
      must(Math.abs((await store.exactMass(first.key)).volume - volume) < 1e-6, 'and there again');
    } finally {
      restore();
    }
    return { pass: true, trapped };
  },
};
