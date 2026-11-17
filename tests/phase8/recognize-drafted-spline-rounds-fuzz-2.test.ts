/**
 * ADR 0255: recognition of drafted spline extrusions with rounds whose support is the spline wall, random parts (AGENTS §3.4): seeds 11 to 20 of 100
 * (`recognize-drafted-spline.kit.ts`: what each case must do). Ten files of ten, each with a fresh Emscripten heap (AGENTS §3.5), as the rolling-ball fuzz.
 */
// no-assertions-ok: every assertion is in fuzzFile (recognize-drafted-spline.kit.ts), run once per seed
import { fuzzFile } from './recognize-drafted-spline.kit';

fuzzFile(11, 20, true);
