/**
 * ADR 0259 slice 4a: random cups with two to four windows at quarter turns (`recognize-multi-window.kit.ts`: what each case must do), seeds
 * 51 to 100 of 100. Two files of 50, each with a fresh Emscripten heap (AGENTS §3.5).
 */
// no-assertions-ok: every assertion is in fuzzFile (recognize-multi-window.kit.ts), run once per seed
import { fuzzFile } from './recognize-multi-window.kit';

fuzzFile(51, 100);
