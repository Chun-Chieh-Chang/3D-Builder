// The repo's own config with the fillet probe as a setup file; same files, same workers.
import base from '../../vitest.config.ts';
export default { ...base, test: { ...base.test, setupFiles: ['spikes/0265-fillet-c1-joints/fillet-setup.ts'] } };
