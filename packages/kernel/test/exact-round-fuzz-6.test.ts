import { fuzzFile } from './exact-round-fuzz.kit';

// seeds 101 to 120 of the exact-round fuzz (C2.14; see the kit)
// no-assertions-ok: every assertion is in fuzzFile (exact-round-fuzz.kit.ts), run once per seed
fuzzFile(101, 120);
