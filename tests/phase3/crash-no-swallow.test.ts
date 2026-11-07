/**
 * A WebAssembly trap must reach the page, which replaces the worker (ADR 0242). Catching one and carrying on means computing in a module whose stack pointer was never put back, so no
 * `catch` in the geometry path may swallow it. There are about a hundred of them, and the next one is written by someone thinking about something else: this reads the source, so a new
 * `catch` that goes on after anything at all turns this red, and says which line.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['packages/kernel/src', 'packages/regen/src', 'apps/web/src/worker/kernel.worker.ts'];

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/** The code with strings, templates and comments blanked (line breaks kept), so that a brace or a `catch` in one of them is not read as code. */
function code(text: string): string {
  const out = text.split('');
  let i = 0;
  const blank = (to: number) => {
    for (; i < to && i < text.length; i++) if (text[i] !== '\n') out[i] = ' ';
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      blank(end < 0 ? text.length : end);
    } else if (c === '/' && text[i + 1] === '*') {
      blank(text.indexOf('*/', i) + 2);
    } else if (c === "'" || c === '"' || c === '`') {
      let end = i + 1;
      while (end < text.length && text[end] !== c) end += text[end] === '\\' ? 2 : 1;
      blank(end + 1);
    } else if (c === '/' && /[(,=:!&|?{};\n]\s*$/.test(text.slice(Math.max(0, i - 20), i))) {
      // a regular expression, which may hold a quote
      let end = i + 1;
      while (end < text.length && text[end] !== '/' && text[end] !== '\n') end += text[end] === '\\' ? 2 : 1;
      blank(end + 1);
    } else i++;
  }
  return out.join('');
}

/** Each catch in the code: its variable, and its body. */
function catches(masked: string): { line: number; name: string | null; body: string }[] {
  const out: { line: number; name: string | null; body: string }[] = [];
  for (const m of masked.matchAll(/\bcatch\s*(?:\(\s*(\w+)\s*\))?\s*\{/g)) {
    let depth = 1;
    let at = m.index + m[0].length;
    const start = at;
    for (; at < masked.length && depth > 0; at++) {
      if (masked[at] === '{') depth++;
      else if (masked[at] === '}') depth--;
    }
    if (depth !== 0) throw new Error(`unbalanced catch at offset ${m.index}: this reader has gone wrong, not the code`);
    out.push({ line: masked.slice(0, m.index).split('\n').length, name: m[1] ?? null, body: masked.slice(start, at - 1).trim() });
  }
  return out;
}

/** Whether a catch goes on after something it did not expect, a crash among it. */
function swallows({ name, body }: { name: string | null; body: string }): boolean {
  if (name === null) return true;
  if (body.startsWith(`rethrowTrap(${name})`) || body.startsWith(`if (isTrap(${name})) throw `)) return false;
  // whatever is not X goes on
  if (new RegExp(`^if \\(!\\(${name} instanceof \\w+\\)\\) throw ${name};`).test(body)) return false;
  // its message is asked of errorText, which does not return for a crash; or of refusalWords, the places that the next test lists
  if (/\b(?:this\.)?(?:errorText|refusalWords)\(/.test(body)) return false;
  // the last thing it does is pass it on, not only when something holds
  const last = new RegExp(`(^|[;{}]\\s*)throw ${name};?$`);
  return !last.test(body);
}

const read = (source: string) => catches(code(source)).map(swallows);

describe('no catch in the geometry path swallows a trap', () => {
  it('every catch passes on what it did not expect', () => {
    const all = ROOTS.flatMap(files).flatMap((f) => catches(code(readFileSync(f, 'utf8'))).map((c) => ({ ...c, file: f })));
    // the control: this really read the catches, or the rest proves nothing
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter(swallows).map((c) => `${c.file}:${c.line} ${c.body.slice(0, 60).replace(/\s+/g, ' ')}`)).toEqual([]);
  });

  it('a trap is taken as a refusal at the two places known for it, and at no other', () => {
    const source = readFileSync('packages/kernel/src/kernel.ts', 'utf8');
    const callers = [...source.matchAll(/this\.refusalWords\(e\)/g)].map((m) => source.slice(Math.max(0, m.index - 60), m.index).match(/t\('([\w.]+)'/)?.[1]);
    expect(callers).toEqual(['surface.bsplineFailed', 'import.igesCannotRead', 'import.igesCannotRead']);
  });

  it('the reader turns red on a catch that goes on, and passes one that does not', () => {
    expect(read('try { f(); } catch { g(); }')).toEqual([true]);
    expect(read('try { f(); } catch (e) { g(e); }')).toEqual([true]);
    expect(read('try { f(); } catch (e) { throw new Error("x"); }')).toEqual([true]);
    expect(read('try { f(); } catch (e) { if (e instanceof A) return 1; return 2; }')).toEqual([true]);
    expect(read('try { f(); } catch (e) { if (x) throw e; }')).toEqual([true]);
    expect(read('try { f(); } catch (e) { if (x) { throw e; } g(); }')).toEqual([true]);
    expect(read('try { f(); } catch (e) { rethrowTrap(e); g(); }')).toEqual([false]);
    expect(read('try { f(); } catch (e) { if (e instanceof A) return 1; throw e; }')).toEqual([false]);
    expect(read('try { f(); } catch (e) { if (!(e instanceof A)) throw e; g(); }')).toEqual([false]);
    expect(read('try { f(); } catch (e) { throw new KernelError(this.errorText(e)); }')).toEqual([false]);
  });

  it('a catch in a string or a comment is not one, and a brace in one does not end one', () => {
    expect(read('// catch { g(); }\nconst a = "catch { g(); }";')).toEqual([]);
    expect(read('try { f(); } catch (e) { /* } */ const a = "}"; const b = /}/; throw e; }')).toEqual([false]);
  });
});
