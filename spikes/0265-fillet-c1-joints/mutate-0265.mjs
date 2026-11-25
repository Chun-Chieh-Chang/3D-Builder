// ADR 0265 §9.5: each mutation must match exactly once; unmutated, every named test must pass first; each mutation's tests must turn red; the source is restored byte for byte. Usage: node spikes/0265-fillet-c1-joints/mutate-0265.mjs [id]
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LOG = 'out/mutate-0265.log';
const K = 'packages/kernel/src/kernel.ts';
const J = 'tests/phase8/fillet-c1-joints.test.ts';
const N = 'tests/phase8/fillet-c1-names.test.ts';
const RR = 'packages/kernel/src/roundRecognition.ts';

const MUTATIONS = [
  { id: 'no-cut', file: K, from: 'cut = laws && laws.size > 0 ? null : this.cutAtJoints(', to: 'cut = true ? null : this.cutAtJoints(', tests: [`${J} -t "seed 96"`] },
  { id: 'no-fallback', file: K, from: "} else this.lastFilletCut = 'fallback';", to: "} else { this.lastFilletCut = 'fallback'; throw made.err; }", tests: [`${J} -t "seed 39"`] },
  { id: 'raw-origins', file: K, from: 'this.mergePieces(rounded, composeOrigins(raw, cut), cut, faces, arena)', to: 'this.mergePieces(rounded, raw, cut, faces, arena)', tests: [`${J} -t "seed 14"`, N] },
  { id: 'no-merge-faces', file: K, from: 'const kept = () => ({ shape, faceOrigins, edgeFrom: direct });', to: 'const kept = () => ({ shape, faceOrigins, edgeFrom: direct }); if (Date.now() > 0) return kept();', tests: [N] },
  { id: 'no-merge-edges', file: K, from: 'const whole = this.mergeEdgePieces(pieced.shape, pieced.faceOrigins, pieced.edgeFrom, faces, edges, verts, arena);', to: 'const whole = { shape: pieced.shape, faceOrigins: pieced.faceOrigins };', tests: [N] },
  { id: 'no-tolerance-rule', file: K, from: 'if (fromCut.tolerance <= CUT_FILLET_TOLERANCE) return', to: 'if (true) return', tests: [`${J} -t "seed 1:"`] },
  { id: 'no-support-cache', file: K, from: 'if (!s) { s = supportOf(this.oc, face); kept.set(i, s); }', to: 's = supportOf(this.oc, face);', tests: [`${J} -t "seed 42"`] },
  { id: 'no-border-skip', file: RR, from: 'const ds = sup.map((S) => S.distWithin(c));', to: 'const ds = sup.map((S) => S.dist(c));', tests: [`${J} -t "seed 51"`] },
  { id: 'no-end-clamp', file: RR, from: 'const e1 = r1 ?? (r0 ? inward(endNear(p1), r0) : null);', to: 'const e1 = r1;', tests: [`${J} -t "seed 26"`] },
  { id: 'no-analytic-check', file: K, from: ' && !this.valid(f))) return drop();', to: ' && false)) return drop();', tests: [`${J} -t "window"`] },
];

const sha = (b) => createHash('sha256').update(b).digest('hex');
const log = (s) => { appendFileSync(`${ROOT}/${LOG}`, s + '\n'); };
const only = process.argv[2];
mkdirSync(`${ROOT}/out`, { recursive: true });

// the baseline first: every named test must be green unmutated
const all = [...new Set(MUTATIONS.filter((m) => !only || m.id === only).flatMap((m) => m.tests))];
for (const t of all) {
  const t0 = Date.now();
  try { execSync(`npx vitest run ${t}`, { cwd: ROOT, stdio: 'pipe', timeout: 900_000 }); log(`base PASS ${t} ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
  catch (e) { log(`base FAIL ${t} — stop\n${String(e.stdout).slice(-3000)}`); process.exit(1); }
}
for (const m of MUTATIONS) {
  if (only && m.id !== only) continue;
  const path = `${ROOT}/${m.file}`;
  const orig = readFileSync(path);
  const text = orig.toString('utf8');
  const n = text.split(m.from).length - 1;
  if (n !== 1) { log(`${m.id}: matched ${n} times — NOT RUN`); continue; }
  writeFileSync(`${ROOT}/out/mutate-0265-backup-${m.id}`, orig);
  writeFileSync(path, text.replace(m.from, m.to));
  const red = [];
  try {
    for (const t of m.tests) {
      const t0 = Date.now();
      try { execSync(`npx vitest run ${t}`, { cwd: ROOT, stdio: 'pipe', timeout: 900_000 }); red.push(`green ${t}`); }
      catch (e) { const out = String(e.stdout ?? '') + String(e.stderr ?? ''); const why = (out.match(/(AssertionError|Error)[^\n]*/) ?? [''])[0].slice(0, 200); red.push(`RED ${t} (${((Date.now() - t0) / 1000).toFixed(0)}s) ${why}`); }
    }
  } finally {
    writeFileSync(path, orig);
    if (sha(readFileSync(path)) !== sha(orig)) { log(`${m.id}: RESTORE FAILED`); process.exit(2); }
  }
  log(`${m.id}: ${red.some((r) => r.startsWith('RED')) ? 'KILLED' : 'SURVIVED'}\n  ${red.join('\n  ')}`);
}
log('done');
