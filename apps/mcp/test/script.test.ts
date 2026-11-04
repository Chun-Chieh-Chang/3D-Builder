/**
 * The headless mode and the 3MF file (ADR 0237): the disc script is run in the process (`runScript`; the CLI binary is run in e2e.test.ts), and its outputs are
 * checked against the geometry worked out by hand — the volume of a disc with a hole and a 45° chamfer on its top rim, and a 3MF mesh that is closed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipEntries } from '@3db/io';
import { CadSession } from '../src/session';
import { parseSets, runScript } from '../src/script';

const here = resolve(__dirname, '..');
const disc = JSON.parse(readFileSync(join(here, 'examples', 'disc.json'), 'utf8'));
/** A disc of radius r and thickness t, a hole of radius h through it, an equal-distance chamfer c on the top rim: the chamfer takes a triangle c²/2 turned round at r − c/3 (Pappus). */
const discVolume = (r: number, t: number, h: number, c: number) => Math.PI * r * r * t - Math.PI * h * h * t - Math.PI * (r - c / 3) * c * c;

let root: string;
let s: CadSession;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), '3db-script-'));
  s = await CadSession.create({ root });
});
afterAll(() => {
  s.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('a modelling script', () => {
  it('builds the disc to the volume worked out by hand, and writes every output', async () => {
    const r = await runScript(s, disc);
    expect(r.committed).toBe(true);
    expect(r.report.after.features.every((f) => f.status === 'ok')).toBe(true);
    expect(r.report.after.mass!.volume).toBeCloseTo(discVolume(30, 10, 5, 1), 3);
    expect(r.written.map((p) => p.slice(root.length + 1)).sort()).toEqual(['disc-iso.png', 'disc-report.json', 'disc-top.png', 'disc.3dbx', 'disc.3mf', 'disc.step', 'disc.stl']);
  });

  it('takes other values for its variables, and the part follows', async () => {
    const r = await runScript(s, disc, parseSets(['R=40', 'C=2']));
    expect(r.report.after.mass!.volume).toBeCloseTo(discVolume(40, 10, 5, 2), 3);
    expect(r.report.after.box!.size[0]).toBeCloseTo(80, 2);
  });

  it('refuses what it cannot do, and says why', async () => {
    await expect(runScript(s, disc, parseSets(['RADIUS=40']))).rejects.toThrow(/no variable RADIUS/);
    expect(() => parseSets(['R'])).toThrow(/name=value/);
    expect(() => parseSets(['R=1', 'R=2'])).toThrow(/twice/);
    await expect(runScript(s, { ...disc, extra: 1 })).rejects.toThrow(/no field extra/);
    await expect(runScript(s, { commands: [] })).rejects.toThrow(/non-empty array/);
    await expect(runScript(s, { ...disc, variables: { R: 30 } })).rejects.toThrow(/expressions/);
    await expect(runScript(s, { ...disc, outputs: { exports: [{ format: 'obj', path: 'x.obj' }] } })).rejects.toThrow(/export format/);
    // a chamfer as large as the disc is thick cannot be made: the script is refused, nothing is written
    const r = await runScript(s, { ...disc, outputs: { save: 'never.3dbx' } }, parseSets(['C=11']));
    expect(r.committed).toBe(false);
    expect(r.report.broken.map((b) => b.id)).toEqual(['ch1']);
    expect(existsSync(join(root, 'never.3dbx'))).toBe(false);
  });
});

describe('the 3MF file', () => {
  it('is a closed mesh of the disc, in mm, turned so that the model’s y is up on the bed', async () => {
    await runScript(s, disc);
    const files = await zipEntries(new Uint8Array(readFileSync(join(root, 'disc.3mf'))));
    expect([...files.keys()].sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const xml = new TextDecoder().decode(files.get('3D/3dmodel.model')!);
    expect(xml).toMatch(/<model unit="millimeter"/);
    expect(xml).toMatch(/<item objectid="1" transform="1 0 0 0 0 1 0 -1 0 0 0 0"\/>/);
    const v = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]);
    const t = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]);
    expect(t.length).toBeGreaterThan(100);
    // closed and consistently turned: every edge is in exactly two triangles, once each way
    const directed = new Map<string, number>();
    for (const [a, b, c] of t) for (const [p, q] of [[a, b], [b, c], [c, a]] as const) directed.set(`${p}>${q}`, (directed.get(`${p}>${q}`) ?? 0) + 1);
    for (const [k, n] of directed) {
      expect(n, k).toBe(1);
      const [p, q] = k.split('>');
      expect(directed.get(`${q}>${p}`), `the other side of ${k}`).toBe(1);
    }
    // the volume by the divergence theorem: positive (outward triangles) and within the mesh's chord error of the true one
    let vol = 0;
    for (const [a, b, c] of t) {
      const [p, q, r] = [v[a]!, v[b]!, v[c]!];
      vol += (p[0]! * (q[1]! * r[2]! - q[2]! * r[1]!) - p[1]! * (q[0]! * r[2]! - q[2]! * r[0]!) + p[2]! * (q[0]! * r[1]! - q[1]! * r[0]!)) / 6;
    }
    expect(Math.abs(vol / discVolume(30, 10, 5, 1) - 1)).toBeLessThan(2e-3);
  });
});
