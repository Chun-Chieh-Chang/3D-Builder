import { spawnSync } from 'node:child_process';

const files = [
  'tests/phase3/thread.test.ts',
  'tests/phase6/undercut-analysis.test.ts',
  'tests/phase3/thread-fuzz.test.ts',
];

console.log('[check:perf] 啟動專用效能與計時斷言檢驗（PERF_CHECK=1）...');
console.log('[check:perf] 目標測試檔案：\n  ' + files.join('\n  '));

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const res = spawnSync(cmd, ['vitest', 'run', ...files], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PERF_CHECK: '1',
  },
});

process.exit(res.status || 0);
