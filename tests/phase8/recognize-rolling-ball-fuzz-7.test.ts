/**
 * Recognition of rolling-ball rounds on freeform faces (C2.8–C2.10), random parts (AGENTS §3.4): seeds 61 to 70 of 100 — a spline-walled boss on a plate, the
 * wall's foot rounded (`recognize-rolling-ball.kit.ts`: what each case must do). A file of its own for a fresh Emscripten heap (AGENTS §3.5): building and
 * rounding spline bodies and comparing each rebuild (ADR 0248) took 221–783 MiB a file of ten, so 100 seeds are ten files of ten.
 */
// no-assertions-ok: every assertion is in fuzzFile (recognize-rolling-ball.kit.ts), run once per seed
import { fuzzFile } from './recognize-rolling-ball.kit';

fuzzFile(61, 70);
