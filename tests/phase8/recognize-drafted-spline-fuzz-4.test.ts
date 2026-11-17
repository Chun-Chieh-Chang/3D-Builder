/**
 * ADR 0255: recognition of drafted spline extrusions, random parts (AGENTS §3.4): seeds 73 to 96 of 120, walls only (`recognize-drafted-spline.kit.ts`:
 * what each case must do). Five files of 24, each with a fresh Emscripten heap (AGENTS §3.5).
 */
// no-assertions-ok: every assertion is in fuzzFile (recognize-drafted-spline.kit.ts), run once per seed
import { fuzzFile } from './recognize-drafted-spline.kit';

fuzzFile(73, 96, false);
