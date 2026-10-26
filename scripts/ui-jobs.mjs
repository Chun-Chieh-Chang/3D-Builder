import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Shared by the browser runner and repository inventory. Helpers are not runnable acceptance cases. */
const HELPERS = new Set(['phase1-demo-parts.js', 'phase3-subassembly.js', 'desktop-probe.mjs', 'manual-support.js']);
export function uiJobs(directory, only = null) {
  return readdirSync(directory).sort().flatMap(file => {
    if (!file.endsWith('.js') || HELPERS.has(file) || (only && !only.test(file))) return [];
    const header = readFileSync(join(directory, file), 'utf8').split('\n').slice(0, 40).filter(line => line.startsWith('//')).join('\n');
    const calls = [...new Set([...header.matchAll(/await\s+(__\w+\.\w+)\(/g)].map(match => match[1]))].filter(call => !call.startsWith('__sub.'));
    return [{ file, calls }];
  });
}
