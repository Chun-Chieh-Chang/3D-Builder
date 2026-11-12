/**
 * C4, random parts (AGENTS §3.4): a round on a drafted support beside a round with no simple surface, seeds 21 to 40 of 100
 * (`recognize-drafted-rounds.kit.ts`: the part and what each case must do). A file of its own for a fresh Emscripten heap (AGENTS §3.5).
 */
// no-assertions-ok: every assertion is in fuzzFile (recognize-drafted-rounds.kit.ts), run once per seed
import { fuzzFile } from './recognize-drafted-rounds.kit';

fuzzFile(21, 40);
