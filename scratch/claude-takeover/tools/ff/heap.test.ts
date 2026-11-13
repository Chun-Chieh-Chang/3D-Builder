import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample } from '../../packages/kernel/test/exact-round-fuzz.kit';
// C2.14d: where the heap goes in one exact round (high-water mark: Emscripten's heap never shrinks)
it('heap', async () => {
  const kernel = await Kernel.load(); const H = () => ((kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20).toFixed(1);
  const kit: any = await import('../../packages/kernel/test/exact-round-fuzz.kit');
  const seed = Number(process.env.SEED ?? 80); const s = sample(seed);
  const out: string[] = [`seed ${seed} ${JSON.stringify(s)} start ${H()}`];
  const made = kit.__body(kernel, s); out.push(`body ${H()}`);
  for (let i = 0; i < Number(process.env.REP ?? 1); i++) {
    kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, false); out.push(`occt ${H()}`);
    kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, true); out.push(`exact ${H()} ${JSON.stringify((kernel as any).exactRoundLog.map((x: any) => x.outcome + (["heap","pre","checked"].includes(x.outcome) ? " " + x.detail : "")))}`);
  }
  console.log('HEAP', out.join(' | ')); console.log('GLOBALS', JSON.stringify((globalThis as any).__G));
}, 170_000);
