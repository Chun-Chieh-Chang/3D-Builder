// Maps byte offsets inside the wasm module (from V8 stack traces) to function names through the Emscripten symbol map.
import { readFileSync } from 'node:fs';
const wasm = readFileSync('node_modules/libcascade/dist/opencascade_single.wasm');
const symbols = new Map(readFileSync('node_modules/libcascade/dist/opencascade_single.js.symbols', 'utf8').split('\n').map((l) => { const i = l.indexOf(':'); return [Number(l.slice(0, i)), l.slice(i + 1)]; }));
let p = 8;
const leb = () => { let r = 0, s = 0, b; do { b = wasm[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
let imported = 0; const bodies = [];
while (p < wasm.length) {
  const id = wasm[p++]; const size = leb(); const end = p + size;
  if (id === 2) { const n = leb(); for (let i = 0; i < n; i++) { p += leb(); p += leb(); const kind = wasm[p++]; if (kind === 0) { leb(); imported++; } else if (kind === 1) { p++; const f = wasm[p++]; leb(); if (f & 1) leb(); } else if (kind === 2) { const f = wasm[p++]; leb(); if (f & 1) leb(); } else if (kind === 3) { p += 2; } else if (kind === 4) { p++; leb(); } } }
  if (id === 10) { const n = leb(); for (let i = 0; i < n; i++) { const sz = leb(); bodies.push([p, p + sz]); p += sz; } }
  p = end;
}
for (const o of process.argv.slice(2).map(Number)) {
  const i = bodies.findIndex(([a, b]) => o >= a && o < b);
  console.log(o, i < 0 ? '?' : `func ${imported + i}: ${symbols.get(imported + i) ?? '(no symbol)'}`);
}
