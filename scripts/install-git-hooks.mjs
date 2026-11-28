/** Installs the pre-push gate in this clone. Git never tracks .git/hooks, so each clone runs this once. */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
if (configured.status === 0 && configured.stdout.trim()) {
  console.error(`core.hooksPath is set to ${configured.stdout.trim()}; install the hook there or unset it first.`);
  process.exit(1);
}

const hooks = resolve(root, execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' }).trim());
const destination = join(hooks, 'pre-push');
const marker = '# managed by scripts/install-git-hooks.mjs';
const hook = [
  '#!/bin/sh',
  marker,
  '# Any client pushing from this clone (Claude Code, Codex, AntiGravity) passes the same fast CI gate.',
  'cd "$(git rev-parse --show-toplevel)" || exit 1',
  'exec node scripts/prepush.mjs',
  '',
].join('\n');

mkdirSync(hooks, { recursive: true });
if (existsSync(destination) && !readFileSync(destination, 'utf8').includes(marker) && !process.argv.includes('--force')) {
  console.error(`${destination} already exists and is not managed by this script; rerun with --force to replace it.`);
  process.exit(1);
}
writeFileSync(destination, hook);
chmodSync(destination, 0o755);
console.log(`Installed ${destination}`);