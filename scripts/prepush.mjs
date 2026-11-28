/** The fast half of repository-integrity.yml. Every client that pushes through this clone runs it. */
import { spawnSync } from 'node:child_process';

const steps = ['typecheck', 'lint:rules', 'lint:deps', 'lint:i18n', 'lint:repo'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const step of steps) {
  process.stdout.write(`\n=== npm run ${step} ===\n`);
  const result = spawnSync(npm, ['run', step], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`pre-push stopped: cannot run npm (${result.error.message}).`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\npre-push stopped: npm run ${step} failed (exit ${result.status ?? 'unknown'}). The push was not sent.`);
    process.exit(result.status || 1);
  }
}
console.log('\npre-push: typecheck and repository lints passed.');