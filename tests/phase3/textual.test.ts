/**
 * Phase 3a-9a (B9.6): a part file as text and folders: `cat`, `unpack`, `pack` of scripts/3dbx.mjs, and `git diff` showing what changed inside (ADR 0040).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyCommand, createDemoPart, serializePart } from '@3db/model';
import { readPartFile, sha256Hex, writePartFile } from '@3db/io';

const tool = resolve('scripts/3dbx.mjs');
const run = (...args: string[]) => execFileSync('node', [tool, ...args], { encoding: 'utf8' });
const work = mkdtempSync(join(tmpdir(), '3dbx-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('a part file as text (B9.6)', () => {
  it('cat prints the document of the file: exactly the text the program wrote into it', async () => {
    const doc = createDemoPart();
    const file = join(work, 'demo.3dbx');
    writeFileSync(file, await writePartFile(doc));
    expect(run('cat', file)).toBe(serializePart(doc));
  });

  it('unpack makes document.json (and the imported data under blobs/); pack makes a file the program reads, the same every time', async () => {
    const blob = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const sha = await sha256Hex(blob);
    const doc = { ...createDemoPart(), blobs: [{ id: 'blob1', sha256: sha, kind: 'step' as const }] };
    const file = join(work, 'with-data.3dbx');
    writeFileSync(file, await writePartFile(doc, new Map([[sha, blob]])));
    const dir = join(work, 'with-data');
    run('unpack', file, dir);
    expect(readdirSync(dir).sort()).toEqual(['blobs', 'document.json']);
    expect(readdirSync(join(dir, 'blobs'))).toEqual([`${sha}.step`]);
    expect(readFileSync(join(dir, 'document.json'), 'utf8')).toBe(serializePart(doc));
    const again = join(work, 'again.3dbx');
    run('pack', dir, again);
    const back = await readPartFile(new Uint8Array(readFileSync(again)));
    expect(back.warnings).toEqual([]);
    expect(back.doc.features).toEqual(doc.features);
    expect(back.doc.blobs).toEqual(doc.blobs);
    expect(back.blobs.get(sha)).toEqual(blob);
    // the same folder always gives the same bytes
    const third = join(work, 'third.3dbx');
    run('pack', dir, third);
    expect(readFileSync(third).equals(readFileSync(again))).toBe(true);
  });

  it('a change made in the text of document.json is a change of the part: a dimension edited by hand reaches the program', async () => {
    const file = join(work, 'edit.3dbx');
    writeFileSync(file, await writePartFile(createDemoPart()));
    const dir = join(work, 'edit');
    run('unpack', file, dir);
    const path = join(dir, 'document.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace('"value": "20"', '"value": "35"'));
    run('pack', dir, file);
    const back = (await readPartFile(new Uint8Array(readFileSync(file)))).doc;
    const sketch = back.features.find((f) => f.type === 'sketch');
    expect(sketch?.type === 'sketch' && sketch.constraints.find((c) => c.id === 'd1')).toMatchObject({ value: '35' });
  });

  it('says what is wrong: a file that is not a ZIP, a folder with no document, a document that is not a 3D-Builder one', () => {
    const bad = join(work, 'bad.3dbx');
    writeFileSync(bad, 'not a zip');
    expect(() => run('cat', bad)).toThrow();
    const empty = join(work, 'empty');
    cpSync(join(work, 'edit'), empty, { recursive: true });
    rmSync(join(empty, 'document.json'));
    expect(() => run('pack', empty, join(work, 'x.3dbx'))).toThrow();
    writeFileSync(join(empty, 'document.json'), '{}');
    expect(() => run('pack', empty, join(work, 'y.3dbx'))).toThrow();
    expect(existsSync(join(work, 'y.3dbx'))).toBe(false);
  });

  it('git diff shows the change inside two versions of a part file once the clone has been told how (npm run setup:git)', async () => {
    const repo = join(work, 'repo');
    execFileSync('git', ['init', '-q', repo]);
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
    cpSync(resolve('.gitattributes'), join(repo, '.gitattributes'));
    cpSync(tool, join(repo, 'scripts', '3dbx.mjs'), { recursive: true });
    const a = createDemoPart();
    writeFileSync(join(repo, 'part.3dbx'), await writePartFile(a));
    git('add', '.');
    git('commit', '-q', '-m', 'one');
    const b = applyCommand(a, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: '35' });
    writeFileSync(join(repo, 'part.3dbx'), await writePartFile(b));
    // not told how: Git says it is binary
    expect(git('diff')).toContain('Binary files');
    git('config', 'diff.3dbx.textconv', 'node scripts/3dbx.mjs cat');
    const diff = git('diff');
    expect(diff).toContain('-          "value": "20"');
    expect(diff).toContain('+          "value": "35"');
    expect(diff).not.toContain('Binary files');
  });
});
