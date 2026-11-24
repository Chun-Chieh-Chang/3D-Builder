// Probe: CPU profile of rolling-ball fuzz seed 46 inside the worker (V8 inspector), written to out/prof46/seed46.cpuprofile. Product code untouched.
import { Session } from 'node:inspector/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, afterAll } from 'vitest';
import { fuzzFile } from '../../tests/phase8/recognize-rolling-ball.kit';

const session = new Session();
beforeAll(async () => {
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 2000 });
  await session.post('Profiler.start');
});
afterAll(async () => {
  const { profile } = await session.post('Profiler.stop');
  mkdirSync('out/prof46', { recursive: true });
  writeFileSync('out/prof46/seed46.cpuprofile', JSON.stringify(profile));
  session.disconnect();
}, 120_000);

fuzzFile(46, 46);
