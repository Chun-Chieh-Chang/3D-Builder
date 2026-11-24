// Probe config: the repo's vitest config with only scratch/prof tests. Not product code.
// mergeConfig concatenates arrays, so `include` would be the repo's tests plus these: replace it instead.
import base from '../../vitest.config.ts';
export default { ...base, test: { ...base.test, include: ['spikes/0265-fillet-c1-joints/**/*.test.ts'] } };
