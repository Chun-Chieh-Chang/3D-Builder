/**
 * ADR 0259 slice 4b: random cups with windows whose rims are rounded (`recognize-window-rounds.kit.ts`: what each case must do), seeds
 * 41 to 44 of 100. Twenty-five files of four, each with a fresh Emscripten heap (AGENTS §3.5): a seed costs about 400 MiB that the heap keeps (its
 * attempts OCCT will not make, and recognition with the rounds left in), and files of ten reached the 4 GiB limit and trapped.
 */
// no-assertions-ok: every assertion is in fuzzFile (recognize-window-rounds.kit.ts), run once per seed
import { fuzzFile } from './recognize-window-rounds.kit';

fuzzFile(41, 44);
