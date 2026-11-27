import base from '../../vitest.config.ts';
export default { ...base, test: { ...base.test, include: ['spikes/mesh-open-edges/**/*.test.ts'] } };
