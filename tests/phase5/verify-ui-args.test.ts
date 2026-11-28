/**
 * `verify:ui` starts the dev server on the port of VERIFY_UI_ORIGIN, so two sessions can each use a port of their own (ADR 0147, found setting up its e2e).
 * The default origin changes nothing; a bad origin is refused, not guessed at.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs script, no declarations
import { DEFAULT_RECYCLE_EVERY, devServerArgs, recycleEvery, shouldRecycle } from '../../scripts/verify-ui-args.mjs';
// @ts-expect-error a plain .mjs script, no declarations
import * as verifyUiRuntime from '../../scripts/verify-ui-args.mjs';

const BASE = ['run', 'dev', '-w', '@3db/web'];
const fakeChild = () => Object.assign(new EventEmitter(), {
  exitCode: null as number | null,
  signalCode: null as NodeJS.Signals | null,
});

describe('verify-ui dev server arguments', () => {
  it('adds nothing for the default origin', () => {
    expect(devServerArgs('http://127.0.0.1:5391')).toEqual(BASE);
  });

  it('passes another port on to vite', () => {
    expect(devServerArgs('http://127.0.0.1:5471')).toEqual([...BASE, '--', '--port', '5471']);
    expect(devServerArgs('http://localhost:65535/')).toEqual([...BASE, '--', '--port', '65535']);
  });

  it('refuses an origin without a usable port or that is not http(s)', () => {
    for (const bad of ['', 'not a url', '127.0.0.1:5471', 'ftp://127.0.0.1:5471', 'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:99999']) {
      expect(() => devServerArgs(bad), bad).toThrow(/VERIFY_UI_ORIGIN/);
    }
  });
});

describe('verify-ui browser recycling', () => {
  it('reads VERIFY_UI_RECYCLE_EVERY: default 40, 0 turns it off, anything else that is not a whole number is refused', () => {
    expect(DEFAULT_RECYCLE_EVERY).toBe(40);
    expect(recycleEvery(undefined)).toBe(40);
    expect(recycleEvery('')).toBe(40);
    expect(recycleEvery('0')).toBe(0);
    expect(recycleEvery('25')).toBe(25);
    for (const bad of ['-1', '1.5', 'abc', 'NaN', ' ', '\t']) expect(() => recycleEvery(bad), bad).toThrow(/VERIFY_UI_RECYCLE_EVERY/);
  });

  it('recycles exactly when the jobs since the last launch reach the limit, never when it is 0', () => {
    expect(shouldRecycle(39, 40)).toBe(false);
    expect(shouldRecycle(40, 40)).toBe(true);
    expect(shouldRecycle(47, 40)).toBe(true);
    expect(shouldRecycle(0, 40)).toBe(false);
    expect(shouldRecycle(10_000, 0)).toBe(false);
  });
});

describe('verify-ui browser teardown', () => {
  it('closes the socket, stops and awaits Chrome, frees the port, then removes the profile', async () => {
    expect(verifyUiRuntime.teardownBrowser).toBeTypeOf('function');
    const order: string[] = [];
    await verifyUiRuntime.teardownBrowser({
      socket: {},
      child: {},
      profile: 'profile',
      port: 9333,
      close: async () => { order.push('close'); },
      kill: () => { order.push('kill'); return true; },
      waitExit: async () => { order.push('exit'); },
      waitPort: async () => { order.push('port'); },
      remove: async () => { order.push('remove'); },
    });
    expect(order).toEqual(['close', 'kill', 'exit', 'port', 'remove']);
  });

  it('does not wait for exit or remove the profile when Chrome cannot be stopped', async () => {
    expect(verifyUiRuntime.teardownBrowser).toBeTypeOf('function');
    const order: string[] = [];
    await expect(verifyUiRuntime.teardownBrowser({
      socket: {},
      child: {},
      profile: 'profile',
      port: 9333,
      close: async () => { order.push('close'); },
      kill: () => { order.push('kill'); return false; },
      waitExit: async () => { order.push('exit'); },
      waitPort: async () => { order.push('port'); },
      remove: async () => { order.push('remove'); },
    })).rejects.toThrow(/could not stop Chrome/);
    expect(order).toEqual(['close', 'kill']);
  });

  it('still stops Chrome and removes its profile when the old socket fails to close', async () => {
    const order: string[] = [];
    await expect(verifyUiRuntime.teardownBrowser({
      socket: {},
      child: {},
      profile: 'profile',
      port: 9333,
      close: async () => { order.push('close'); throw new Error('close failed'); },
      kill: () => { order.push('kill'); return true; },
      waitExit: async () => { order.push('exit'); },
      waitPort: async () => { order.push('port'); },
      remove: async () => { order.push('remove'); },
    })).rejects.toThrow(/close failed/);
    expect(order).toEqual(['close', 'kill', 'exit', 'port', 'remove']);
  });

  it('detaches old socket handlers before waiting for the close handshake', async () => {
    expect(verifyUiRuntime.closeSocket).toBeTypeOf('function');
    const socket: {
      readyState: number;
      onopen: (() => void) | null;
      onmessage: (() => void) | null;
      onerror: (() => void) | null;
      onclose: (() => void) | null;
      close: () => void;
    } = {
      readyState: 1,
      onopen: () => {},
      onmessage: () => {},
      onerror: () => {},
      onclose: null,
      close: () => {
        expect(socket.onopen).toBeNull();
        expect(socket.onmessage).toBeNull();
        expect(socket.onerror).toBeNull();
        queueMicrotask(() => { socket.readyState = 3; socket.onclose?.(); });
      },
    };
    await verifyUiRuntime.closeSocket(socket, 100);
    expect(socket.onclose).toBeNull();
  });

  it('rejects when an old socket does not finish closing', async () => {
    expect(verifyUiRuntime.closeSocket).toBeTypeOf('function');
    await expect(verifyUiRuntime.closeSocket({ readyState: 1, close: () => {} }, 5)).rejects.toThrow(/timed out/);
  });

  it('waits for the Chrome process to exit and removes its listeners', async () => {
    expect(verifyUiRuntime.waitForChildExit).toBeTypeOf('function');
    const child = fakeChild();
    const waiting = verifyUiRuntime.waitForChildExit(child, 100);
    queueMicrotask(() => child.emit('exit', 0, null));
    await waiting;
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  it('rejects when Chrome does not exit before the deadline', async () => {
    expect(verifyUiRuntime.waitForChildExit).toBeTypeOf('function');
    const child = fakeChild();
    await expect(verifyUiRuntime.waitForChildExit(child, 5)).rejects.toThrow(/did not exit/);
  });

  it('reports a failed Windows process kill instead of pretending Chrome stopped', () => {
    expect(verifyUiRuntime.killChild).toBeTypeOf('function');
    expect(verifyUiRuntime.killChild({ exitCode: null, signalCode: null }, 'win32', () => ({ status: 1 }))).toBe(false);
    expect(verifyUiRuntime.killChild({ exitCode: 0, signalCode: null }, 'win32', () => ({ status: 1 }))).toBe(true);
    expect(verifyUiRuntime.killChild({ exitCode: null, signalCode: null, kill: () => false }, 'linux')).toBe(false);
  });

  it('passes taskkill the Chrome process tree as one argument vector', () => {
    let received: unknown[] | undefined;
    verifyUiRuntime.killChild({ pid: 10, exitCode: null, signalCode: null }, 'win32', (...args: unknown[]) => {
      received = args;
      return { status: 0 };
    });
    expect(received).toEqual(['taskkill', ['/PID', '10', '/T', '/F']]);
  });

  it('accepts taskkill process-not-found only when the Chrome PID is gone', () => {
    const child = { pid: 10, exitCode: null, signalCode: null };
    expect(verifyUiRuntime.killChild(child, 'win32', () => ({ status: 128 }), () => false)).toBe(true);
    expect(verifyUiRuntime.killChild(child, 'win32', () => ({ status: 128 }), () => true)).toBe(false);
    expect(verifyUiRuntime.killChild(child, 'win32', () => ({ status: 255 }), () => false)).toBe(true);
    expect(verifyUiRuntime.killChild(child, 'win32', () => ({ status: 1 }), () => true)).toBe(false);
  });

  it('waits until the debug port stops accepting connections', async () => {
    expect(verifyUiRuntime.waitForPortFree).toBeTypeOf('function');
    let probes = 0;
    const delays: number[] = [];
    await verifyUiRuntime.waitForPortFree(9333, {
      attempts: 3,
      delayMs: 1,
      probe: async () => ++probes < 3,
      sleep: async (ms: number) => { delays.push(ms); },
    });
    expect(probes).toBe(3);
    expect(delays).toEqual([1, 1]);
    await expect(verifyUiRuntime.waitForPortFree(9333, {
      attempts: 2,
      delayMs: 1,
      probe: async () => true,
      sleep: async () => {},
    })).rejects.toThrow(/did not become free/);
  });

  it('retries a locked profile and fails explicitly when it stays locked', async () => {
    expect(verifyUiRuntime.removeDirectoryWithRetry).toBeTypeOf('function');
    let attempts = 0;
    await verifyUiRuntime.removeDirectoryWithRetry('profile', {
      attempts: 3,
      delayMs: 1,
      remove: () => { if (++attempts < 3) throw new Error('locked'); },
      sleep: async () => {},
    });
    expect(attempts).toBe(3);
    await expect(verifyUiRuntime.removeDirectoryWithRetry('profile', {
      attempts: 2,
      delayMs: 1,
      remove: () => { throw new Error('locked'); },
      sleep: async () => {},
    })).rejects.toThrow(/could not remove Chrome profile/);
  });
});

describe('verify-ui browser startup', () => {
  it('resolves when the debug endpoint is ready and detaches process listeners', async () => {
    expect(verifyUiRuntime.waitForBrowserReady).toBeTypeOf('function');
    const child = fakeChild();
    await verifyUiRuntime.waitForBrowserReady(child, 9333, {
      timeoutMs: 100,
      requestTimeoutMs: 10,
      fetchImpl: async () => ({ ok: true }),
    });
    expect(child.listenerCount('error')).toBe(0);
    expect(child.listenerCount('exit')).toBe(0);
  });

  it('rejects when Chrome exits before its debug endpoint is ready', async () => {
    expect(verifyUiRuntime.waitForBrowserReady).toBeTypeOf('function');
    const child = fakeChild();
    queueMicrotask(() => child.emit('exit', 1, null));
    await expect(verifyUiRuntime.waitForBrowserReady(child, 9333, {
      timeoutMs: 50,
      requestTimeoutMs: 5,
      fetchImpl: () => new Promise(() => {}),
    })).rejects.toThrow(/exited before/);
  });

  it('aborts a hung readiness request instead of leaving its connection open', async () => {
    let signal: AbortSignal | undefined;
    await expect(verifyUiRuntime.waitForBrowserReady(fakeChild(), 9333, {
      timeoutMs: 20,
      requestTimeoutMs: 5,
      fetchImpl: (_url: string, init: { signal: AbortSignal }) => {
        signal = init.signal;
        return new Promise(() => {});
      },
    })).rejects.toThrow(/did not become ready/);
    expect(signal?.aborted).toBe(true);
  });

  it('rejects when the debug endpoint accepts but never answers', async () => {
    expect(verifyUiRuntime.waitForBrowserReady).toBeTypeOf('function');
    const child = fakeChild();
    await expect(verifyUiRuntime.waitForBrowserReady(child, 9333, {
      timeoutMs: 20,
      requestTimeoutMs: 5,
      fetchImpl: () => new Promise(() => {}),
    })).rejects.toThrow(/did not become ready/);
  });
});
