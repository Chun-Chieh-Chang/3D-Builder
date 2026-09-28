import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crc32, readZip, writeZip, ZipError } from '../src/zip';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const utf8 = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

/** Deterministic noise that DEFLATE cannot shrink. */
function noise(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = 12345;
  for (let i = 0; i < n; i++) out[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  return out;
}

describe('CRC-32', () => {
  it('matches the standard check value', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('writeZip / readZip', () => {
  const entries = [
    { name: 'document.json', data: utf8('{\n  "kind": "part"\n}\n'.repeat(40)) },
    { name: 'blobs/草圖.step', data: utf8('ISO-10303-21;') },
    { name: 'empty.txt', data: new Uint8Array(0) },
    { name: 'noise.bin', data: noise(4096) },
  ];

  it('reads back what it wrote: names, contents and order', async () => {
    const back = await readZip(await writeZip(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    back.forEach((e, i) => expect(e.data).toEqual(entries[i]!.data));
  });

  it('deflates text and stores what does not compress', async () => {
    const zip = await writeZip(entries);
    const view = new DataView(zip.buffer);
    expect(view.getUint16(8, true)).toBe(8); // document.json: DEFLATE
    expect(zip.length).toBeLessThan(entries.reduce((n, e) => n + e.data.length, 0));
    const noiseAt = zip.findLastIndex((_, i) => i + 39 <= zip.length && view.getUint32(i, true) === 0x04034b50 && str(zip.subarray(i + 30, i + 39)) === 'noise.bin');
    expect(view.getUint16(noiseAt + 8, true)).toBe(0); // stored
  });

  it('writes the same bytes for the same entries', async () => {
    expect(await writeZip(entries)).toEqual(await writeZip(entries));
  });

  it('reads archives written by CPython zipfile: comment, directory, stored, UTF-8 name', async () => {
    const back = await readZip(fixture('python-zipfile.zip'));
    expect(back.map((e) => e.name)).toEqual(['docs/readme.txt', 'stored.bin', '基準面.txt']);
    expect(str(back[0]!.data)).toBe('hello 3D-Builder\n'.repeat(50));
    expect(back[1]!.data).toEqual(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(str(back[2]!.data)).toBe('偏移、角度、三點');
  });

  it('reads streamed entries whose sizes are only in data descriptors', async () => {
    const back = await readZip(fixture('python-streamed.zip'));
    expect(back.map((e) => [e.name, str(e.data)])).toEqual([
      ['streamed.txt', 'streamed '.repeat(100)],
      ['second.txt', 'after a streamed entry'],
    ]);
  });
});

describe('damaged or unsupported archives', () => {
  const one = () => writeZip([{ name: 'a.bin', data: noise(64) }]); // stored: its bytes sit right after the header

  it('reports a changed byte as a CRC mismatch', async () => {
    const zip = await one();
    zip[30 + 'a.bin'.length + 10]! ^= 0xff;
    await expect(readZip(zip)).rejects.toThrow('CRC 不符');
  });

  it('rejects files that are not ZIP archives, or cut short', async () => {
    await expect(readZip(utf8('{"kind":"part"}'))).rejects.toThrow(ZipError);
    const zip = await one();
    await expect(readZip(zip.subarray(0, zip.length - 30))).rejects.toThrow(ZipError);
  });

  it('rejects encryption and compression methods it does not implement', async () => {
    const zip = await one();
    const view = new DataView(zip.buffer);
    const central = zip.findIndex((_, i) => i + 4 <= zip.length && view.getUint32(i, true) === 0x02014b50);
    const encrypted = zip.slice();
    new DataView(encrypted.buffer).setUint16(central + 8, 0x0801, true);
    await expect(readZip(encrypted)).rejects.toThrow('加密');
    const bzip2 = zip.slice();
    new DataView(bzip2.buffer).setUint16(central + 10, 12, true);
    await expect(readZip(bzip2)).rejects.toThrow('不支援的壓縮方式（12）');
  });
});
