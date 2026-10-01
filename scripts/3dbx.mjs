#!/usr/bin/env node
// Reads and writes the files of 3D-Builder as text and folders (B9.6), so that git, scripts and people can see inside them.
//
//   node scripts/3dbx.mjs cat <file.3dbx>            prints document.json (what `git diff` shows with `npm run setup:git`)
//   node scripts/3dbx.mjs unpack <file.3dbx> [dir]    writes document.json and blobs/ into dir (default: the file's name without the extension)
//   node scripts/3dbx.mjs pack <dir> <file.3dbx>      the other way; the same folder always gives the same bytes
//
// A .3dbx is a ZIP file (ADR 0008) with `document.json` first and the imported data under `blobs/`. This tool needs nothing but Node.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DOCUMENT = 'document.json';

/** The entries of a ZIP file: name → bytes. */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END) end--;
  if (end < 0) throw new Error('not a ZIP file (no end of directory)');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error('damaged ZIP directory');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(local, true) !== LOCAL) throw new Error(`damaged ZIP entry ${name}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`entry ${name} is compressed in a way this tool does not read`);
    entries.set(name, new Uint8Array(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** A ZIP file of the entries in the order given; the same entries always give the same bytes (the DOS date is fixed at 1980-01-01). */
export function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const packed = deflateRawSync(data);
    const [method, body] = packed.length < data.length ? [8, packed] : [0, Buffer.from(data)];
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE((1 << 5) | 1, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(CENTRAL, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE((1 << 5) | 1, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

function files(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
}

/** The folder form of a part file. */
export function unpack(file, dir = join(dirname(file), basename(file, extname(file)))) {
  const entries = readZip(readFileSync(file));
  if (!entries.has(DOCUMENT)) throw new Error(`${file} has no ${DOCUMENT}`);
  for (const [name, data] of entries) {
    if (name.includes('..') || name.startsWith('/')) throw new Error(`entry name ${name} leaves the folder`);
    const target = join(dir, ...name.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return dir;
}

/** The part file of a folder: document.json first, then everything else in name order. */
export function pack(dir, file) {
  const names = files(dir).map((p) => relative(dir, p).split(sep).join('/'));
  if (!names.includes(DOCUMENT)) throw new Error(`${dir} has no ${DOCUMENT}`);
  const doc = JSON.parse(readFileSync(join(dir, DOCUMENT), 'utf8'));
  if (typeof doc.schemaVersion !== 'number') throw new Error(`${DOCUMENT} has no schemaVersion: not a 3D-Builder document`);
  const entries = [DOCUMENT, ...names.filter((n) => n !== DOCUMENT)].map((name) => ({ name, data: new Uint8Array(readFileSync(join(dir, ...name.split('/')))) }));
  writeFileSync(file, writeZip(entries));
  return file;
}

/** document.json of a part file as text. */
export function cat(file) {
  const entries = readZip(readFileSync(file));
  const doc = entries.get(DOCUMENT);
  if (!doc) throw new Error(`${file} has no ${DOCUMENT}`);
  return new TextDecoder().decode(doc);
}

const [command, a, b] = process.argv.slice(2);
if (process.argv[1] && basename(process.argv[1]) === '3dbx.mjs') {
  try {
    if (command === 'cat' && a) process.stdout.write(cat(a));
    else if (command === 'unpack' && a) console.log(`unpacked into ${unpack(a, b)}`);
    else if (command === 'pack' && a && b) console.log(`wrote ${pack(a, b)}`);
    else {
      console.error('usage: 3dbx.mjs cat <file> | unpack <file> [dir] | pack <dir> <file>');
      process.exit(2);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
