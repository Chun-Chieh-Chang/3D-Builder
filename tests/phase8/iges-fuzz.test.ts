/**
 * IGES import (F2.2), fuzzing (AGENTS.md §3.4): 200 files made from good ones by cutting them short, changing bytes, dropping and repeating lines and
 * breaking numbers. OCCT's IGES reader loops for ever on some of them (an entity whose record ends before its parameters do, such as `108,0.;`), and a
 * loop in WASM cannot be interrupted, so the app reads an IGES file in a worker of its own under a time limit before importing it (`probeIges`). This
 * test does the same with processes: a child imports the files one by one and writes down what each did; one that runs past the limit has its process
 * killed and counts as stopped, and the child is started again after it. Every file must import, be refused with a KernelError, or be stopped — never
 * another error, never a crash. The child then reads a good file to the same volume. In a file of its own.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeId } from '@3db/kernel';
import type { Frame, Region } from '@3db/kernel';

const CASES = 200;
/** A good file of this size imports in well under a second; one still running after this is in OCCT's loop. */
const STALL_MS = 15_000;
const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const loop = (pts: [number, number][], tag: string): Region['outer'] => pts.map((a, i) => ({ kind: 'line' as const, a, b: pts[(i + 1) % pts.length]!, source: `${tag}${i}` }));
/** A 40 × 30 × 10 plate with a 10 × 10 square hole. */
const plateRegion: Region = { outer: loop([[0, 0], [40, 0], [40, 30], [0, 30]], 'o'), holes: [loop([[15, 10], [15, 20], [25, 20], [25, 10]], 'h')] };

/** A seeded generator (mulberry32), so that a failure can be run again. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ways a file is broken, each by name. */
function breakers(rnd: () => number): [string, (s: string) => string][] {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  return [
    ['cut short', (s) => s.slice(0, Math.floor(rnd() * s.length))],
    [
      'bytes changed',
      (s) => {
        const chars = s.split('');
        for (let n = 1 + Math.floor(rnd() * 20); n > 0; n--) chars[Math.floor(rnd() * chars.length)] = String.fromCharCode(32 + Math.floor(rnd() * 95));
        return chars.join('');
      },
    ],
    [
      'lines dropped',
      (s) => {
        const lines = s.split('\n');
        lines.splice(Math.floor(rnd() * lines.length), 1 + Math.floor(rnd() * 5));
        return lines.join('\n');
      },
    ],
    ['numbers broken', (s) => s.replace(/\d+\.\d+(D|E)?-?\d*/g, (m) => (rnd() < 0.05 ? pick(['NaN', '1D999', '-1D999', '0', '', '9'.repeat(40)]) : m))],
    [
      'a line repeated',
      (s) => {
        const lines = s.split('\n');
        lines.splice(Math.floor(rnd() * lines.length), 0, lines[Math.floor(rnd() * lines.length)]!);
        return lines.join('\n');
      },
    ],
  ];
}

const replayDir = process.env.IGES_FUZZ_DIR;

describe('IGES import fuzzing', () => {
  // The child: imports the cases from IGES_FUZZ_FROM on, writing "<i> start" before and "<i> <outcome>" after each to progress.txt.
  it.runIf(!!replayDir)('imports the cases of IGES_FUZZ_DIR, writing down what each did', async () => {
    const dir = replayDir!;
    const progress = join(dir, 'progress.txt');
    const k = await Kernel.load();
    const files = readdirSync(dir).filter((f) => /^case-\d+\.igs$/.test(f)).sort();
    const live = k.liveShapes;
    for (const f of files) {
      const i = Number(/\d+/.exec(f)![0]);
      if (i < Number(process.env.IGES_FUZZ_FROM ?? 0)) continue;
      appendFileSync(progress, `${i} start\n`);
      let outcome: string;
      try {
        const r = k.importIges(readFileSync(join(dir, f), 'utf8'));
        outcome = Number.isFinite(k.massProps(r.shape).volume) ? 'imported' : 'error: the volume is not a number';
        k.release(r.shape);
      } catch (e) {
        outcome = e instanceof KernelError ? 'refused' : `error: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
      }
      appendFileSync(progress, `${i} ${outcome}\n`);
    }
    expect(k.liveShapes).toBe(live);
    // the kernel still reads a good file to the same volume
    const r = k.importIges(readFileSync(join(dir, 'good.igs'), 'utf8'));
    appendFileSync(progress, `good ${k.massProps(r.shape).volume}\n`);
    k.release(r.shape);
  });

  it.skipIf(!!replayDir)(`imports, refuses with a KernelError, or stops within ${STALL_MS / 1000} s each of ${CASES} broken files, and never anything else`, async () => {
    const k = await Kernel.load();
    const plate: ShapeId = k.extrude(front, [plateRegion], [0, 0, 10]).shape;
    const volume = k.massProps(plate).volume;
    const good = [k.exportIges(plate, 'P'), k.exportIges(plate, 'P', 'MM', { mode: 'brep' })];
    const dir = mkdtempSync(join(tmpdir(), '3db-iges-fuzz-'));
    try {
      const rnd = random(20261029);
      const ways = breakers(rnd);
      const way: string[] = [];
      for (let i = 0; i < CASES; i++) {
        const [name, broken] = ways[i % ways.length]!;
        way.push(name);
        writeFileSync(join(dir, `case-${String(i).padStart(3, '0')}.igs`), broken(good[i % 2]!));
      }
      writeFileSync(join(dir, 'good.igs'), good[0]!);
      const progress = join(dir, 'progress.txt');
      const vitest = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
      const outcomes = new Map<number, string>();
      let goodVolume: number | null = null;
      let from = 0;
      while (from <= CASES) {
        const child = spawn(process.execPath, [vitest, 'run', 'tests/phase8/iges-fuzz.test.ts'], { env: { ...process.env, IGES_FUZZ_DIR: dir, IGES_FUZZ_FROM: String(from) }, stdio: 'ignore' });
        const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
        let stalledAt: number | null = null;
        let lastLines = -1;
        let since = Date.now();
        for (;;) {
          const done = await Promise.race([exited.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 250))]);
          const lines = existsSync(progress) ? readFileSync(progress, 'utf8').split('\n').filter(Boolean) : [];
          if (lines.length !== lastLines) (lastLines = lines.length), (since = Date.now());
          if (done) break;
          const last = lines.at(-1);
          if (last?.endsWith(' start') && Date.now() - since > STALL_MS) {
            stalledAt = Number(last.split(' ')[0]);
            if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
            else child.kill('SIGKILL');
            await exited;
            break;
          }
        }
        for (const line of readFileSync(progress, 'utf8').split('\n').filter(Boolean)) {
          const [at, ...rest] = line.split(' ');
          if (at === 'good') goodVolume = Number(rest[0]);
          else if (rest.join(' ') !== 'start') outcomes.set(Number(at), rest.join(' '));
        }
        if (stalledAt === null) break;
        outcomes.set(stalledAt, 'stopped');
        appendFileSync(progress, `${stalledAt} stopped\n`);
        from = stalledAt + 1;
      }
      const missing = Array.from({ length: CASES }, (_, i) => i).filter((i) => !outcomes.has(i));
      expect(missing).toEqual([]); // a case with no outcome: the child died on it
      const others = [...outcomes].filter(([, o]) => !['imported', 'refused', 'stopped'].includes(o)).map(([i, o]) => `case ${i} (${way[i]}): ${o}`);
      expect(others).toEqual([]);
      expect(goodVolume).not.toBeNull();
      expect(Math.abs(goodVolume! / volume - 1)).toBeLessThanOrEqual(1e-6);
      const count = (o: string) => [...outcomes.values()].filter((x) => x === o).length;
      const stopped = [...outcomes].filter(([, o]) => o === 'stopped').map(([i]) => `${i} (${way[i]})`);
      console.info(`${CASES} broken IGES files: ${count('imported')} imported, ${count('refused')} refused with a KernelError, ${count('stopped')} stopped after ${STALL_MS / 1000} s${stopped.length ? `: ${stopped.join(', ')}` : ''}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 900_000);
});
