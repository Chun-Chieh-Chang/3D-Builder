/**
 * ADR 0259 slice 2: random cups with a loft window (`recognize-loft-window.kit.ts`: what each case must do), seeds 1 to 50 of 100. Two files of 50,
 * each with a fresh Emscripten heap (AGENTS §3.5).
 */
// no-assertions-ok: every assertion is in fuzzFile (recognize-loft-window.kit.ts), run once per seed
import { fuzzFile } from './recognize-loft-window.kit';

fuzzFile(1, 50);
