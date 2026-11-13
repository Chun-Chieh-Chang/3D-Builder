// one process per job, killed with its whole process tree after LIMIT ms: a call that does not return is a result, not a hang of the probe.
// usage: node scratch/ff/c5a-run.mjs <test file> <job>[,<job>...]   (each job is passed as JOB; the test reads it)
import { spawn, execFileSync } from 'node:child_process'; import { appendFileSync } from 'node:fs';
const LIMIT = +(process.env.LIMIT ?? 240000);
const [file, jobs] = process.argv.slice(2);
for (const job of jobs.split(',')) {
  const t0 = Date.now();
  const timedOut = await new Promise((done) => {
    const p = spawn('npx.cmd', ['vitest', 'run', '--config', 'scratch/ff/ff.config.mts', file], { env: { ...process.env, JOB: job }, shell: true, stdio: 'ignore' });
    const timer = setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} done(true); }, LIMIT);
    p.on('exit', () => { clearTimeout(timer); done(false); });
  });
  if (timedOut) appendFileSync(process.env.LOG ?? 'scratch/ff/c5.log', `${job}: did not return within ${Math.round((Date.now() - t0) / 1000)} s (process tree killed)\n`);
}
