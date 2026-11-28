import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { connect as netConnect } from 'node:net';

// The arguments `npm` is given to start the dev server for `verify:ui` at `origin` (VERIFY_UI_ORIGIN). The default origin is the port
// vite is configured for, so nothing is added; any other port is passed on (`vite --port`), or a second session using its own port
// would find nothing to talk to. An origin that is not a plain http(s) URL with a port is refused, not guessed at.
export const DEFAULT_DEV_PORT = 5391;

/**
 * A long run in one Chrome gets slower (Blink IPC and GPU process leftovers; 9 s a script at first, 18-24 s two hours in, which is when the fixed
 * 30 s waits of the scripts start to fail at random). So the browser is replaced by a fresh one every `every` jobs; no wait or threshold is changed.
 * `VERIFY_UI_RECYCLE_EVERY` sets it (0 turns it off); the default is 40.
 */
export const DEFAULT_RECYCLE_EVERY = 40;

export function recycleEvery(value) {
  if (value === undefined || value === '') return DEFAULT_RECYCLE_EVERY;
  if (typeof value === 'string' && value.trim() === '') throw new Error(`VERIFY_UI_RECYCLE_EVERY must be a whole number of jobs, 0 or more: ${value}`);
  const every = Number(value);
  if (!Number.isInteger(every) || every < 0) throw new Error(`VERIFY_UI_RECYCLE_EVERY must be a whole number of jobs, 0 or more: ${value}`);
  return every;
}

export function shouldRecycle(jobsSinceLaunch, every) {
  return every > 0 && jobsSinceLaunch >= every;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function closeSocket(socket, timeoutMs = 2000) {
  if (!socket || socket.readyState === 3) return;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.onclose = null;
      reject(new Error(`old browser socket timed out while closing after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.onclose = () => {
      clearTimeout(timer);
      socket.onclose = null;
      resolve();
    };
    try {
      socket.close();
    } catch (error) {
      clearTimeout(timer);
      socket.onclose = null;
      reject(error);
    }
  });
}

export async function waitForChildExit(child, timeoutMs = 10000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      child.off('error', onError);
      reject(new Error(`Chrome did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      resolve();
    };
    const onError = error => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      reject(error);
    };
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function killChild(child, platform, taskkill = spawnSync, isProcessRunning = processExists) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  try {
    if (platform === 'win32') {
      const result = taskkill('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      if (!result.error && result.status === 0) return true;
      return !isProcessRunning(child.pid);
    }
    return child.kill();
  } catch {
    return false;
  }
}

function probePort(port) {
  return new Promise(resolve => {
    const socket = netConnect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

export async function waitForPortFree(port, { attempts = 50, delayMs = 100, probe = probePort, sleep = delay } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!await probe(port)) return;
    if (attempt + 1 < attempts) await sleep(delayMs);
  }
  throw new Error(`Chrome debug port ${port} did not become free after ${attempts} attempt(s)`);
}

export async function removeDirectoryWithRetry(path, { attempts = 20, delayMs = 100, remove = rmSync, sleep = delay } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      remove(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(delayMs);
    }
  }
  throw new Error(`could not remove Chrome profile ${path}: ${lastError?.message ?? 'unknown error'}`);
}

export async function waitForBrowserReady(child, port, { timeoutMs = 15000, requestTimeoutMs = 1000, fetchImpl = fetch, sleep = delay } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`Chrome exited before its debug endpoint was ready (code ${child.exitCode}, signal ${child.signalCode})`);
  }
  let failure = null;
  const onError = error => { failure = error; };
  const onExit = (code, signal) => {
    failure = new Error(`Chrome exited before its debug endpoint was ready (code ${code}, signal ${signal})`);
  };
  child.once('error', onError);
  child.once('exit', onExit);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (failure) throw failure;
      const controller = new AbortController();
      try {
        const response = await withTimeout(
          fetchImpl(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal }),
          Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now())),
          `debug endpoint request timed out after ${requestTimeoutMs}ms`,
        );
        if (response.ok) return;
      } catch {
        if (failure) throw failure;
      } finally {
        controller.abort();
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await sleep(Math.min(200, remaining));
    }
    if (failure) throw failure;
    throw new Error(`Chrome debug endpoint on port ${port} did not become ready within ${timeoutMs}ms`);
  } finally {
    child.off('error', onError);
    child.off('exit', onExit);
  }
}

export async function teardownBrowser({ socket, child, profile, port, close, kill, waitExit, waitPort, remove }) {
  let closeError;
  try {
    await close(socket);
  } catch (error) {
    closeError = error;
  }
  if (!kill(child)) throw new Error('could not stop Chrome before starting its replacement');
  await waitExit(child);
  await waitPort(port);
  await remove(profile);
  if (closeError) throw closeError;
}

export function devServerArgs(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`VERIFY_UI_ORIGIN is not a URL: ${origin}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`VERIFY_UI_ORIGIN must be http(s): ${origin}`);
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`VERIFY_UI_ORIGIN needs a port (1-65535): ${origin}`);
  const base = ['run', 'dev', '-w', '@3db/web'];
  return port === DEFAULT_DEV_PORT ? base : [...base, '--', '--port', String(port)];
}
