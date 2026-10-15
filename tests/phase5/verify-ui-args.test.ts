/**
 * `verify:ui` starts the dev server on the port of VERIFY_UI_ORIGIN, so two sessions can each use a port of their own (ADR 0147, found setting up its e2e).
 * The default origin changes nothing; a bad origin is refused, not guessed at.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs script, no declarations
import { devServerArgs } from '../../scripts/verify-ui-args.mjs';

const BASE = ['run', 'dev', '-w', '@3db/web'];

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
