import { t } from '@3db/i18n';
import { composePose, STL_UNIT_MM, transformPoint, type Pose, type StlUnit } from '@3db/model';
import { safeFileName } from './names';
import type { StepInstance, StepSub } from './step';

/** Triangles to write: xyz per vertex, three vertex indices per triangle, counter-clockwise seen from outside. */
export interface StlSource {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}


/** Each triangle as its facet normal and corners, in the unit `scale` divides millimetres into. */
function eachFacet(meshes: readonly StlSource[], scale: number, fn: (v: readonly number[]) => void): void {
  for (const m of meshes) {
    const p = m.positions;
    for (let k = 0; k < m.indices.length; k += 3) {
      const [a, b, c] = [m.indices[k]! * 3, m.indices[k + 1]! * 3, m.indices[k + 2]! * 3];
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
      const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      fn([n[0]! / len, n[1]! / len, n[2]! / len, ...[p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, p[c]!, p[c + 1]!, p[c + 2]!].map((x) => x / scale)]);
    }
  }
}

/**
 * Binary STL (F4.1): 80 bytes of header, the number of triangles, then for each its normal, three corners and two bytes of attributes (little-endian).
 * A mesh's triangles already run counter-clockwise seen from outside, so the facet normals come from the corners. The header never starts with
 * "solid" (readers take such a file for ASCII), and a name too long for it is cut on a character, not inside one.
 */
export function binaryStl(meshes: readonly StlSource[], name = '3D-Builder', unit: StlUnit = 'mm'): Uint8Array {
  const triangles = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const out = new Uint8Array(84 + 50 * triangles);
  const view = new DataView(out.buffer);
  const encoder = new TextEncoder();
  let header = `binary STL ${name}`;
  while (encoder.encode(header).length > 80) header = Array.from(header).slice(0, -1).join('');
  out.set(encoder.encode(header));
  view.setUint32(80, triangles, true);
  let at = 84;
  eachFacet(meshes, STL_UNIT_MM[unit], (v) => {
    for (const x of v) {
      view.setFloat32(at, x, true);
      at += 4;
    }
    at += 2;
  });
  return out;
}

/** A name as an ASCII STL may hold it: printable ASCII, every other character `_`. */
export const stlAsciiName = (name: string): string => Array.from(name.trim() || '3D-Builder', (c) => (/^[\x21-\x7e]$/.test(c) ? c : '_')).join('');

/**
 * ASCII STL (F4.1, ADR 0221): `solid <name>`, a `facet normal … outer loop vertex ×3 endloop endfacet` per triangle, `endsolid <name>`. Each number is
 * written with nine significant digits, which gives back the float32 a binary STL would hold exactly.
 */
export function asciiStl(meshes: readonly StlSource[], name = '3D-Builder', unit: StlUnit = 'mm'): string {
  const solid = stlAsciiName(name);
  const num = (x: number) => Math.fround(x).toExponential(8);
  const lines = [`solid ${solid}`];
  eachFacet(meshes, STL_UNIT_MM[unit], (v) => {
    lines.push(`  facet normal ${num(v[0]!)} ${num(v[1]!)} ${num(v[2]!)}`, '    outer loop');
    for (let i = 3; i < 12; i += 3) lines.push(`      vertex ${num(v[i]!)} ${num(v[i + 1]!)} ${num(v[i + 2]!)}`);
    lines.push('    endloop', '  endfacet');
  });
  lines.push(`endsolid ${solid}`, '');
  return lines.join('\n');
}

/** The triangles of a binary STL, for reading back: three corners each. */
export function readBinaryStl(bytes: Uint8Array): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (bytes.byteLength !== 84 + 50 * count) throw new Error('not a binary STL');
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const at = 84 + 50 * i + 12;
    out.push(Float32Array.from({ length: 9 }, (_, k) => view.getFloat32(at + 4 * k, true)));
  }
  return out;
}

/** The volume a closed STL encloses (the signed volumes of the tetrahedra from the origin), and its surface area. */
export function stlMeasure(triangles: readonly Float32Array[]): { volume: number; area: number } {
  let volume = 0;
  let area = 0;
  for (const t of triangles) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t as unknown as number[];
    volume += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6;
    const u = [bx! - ax!, by! - ay!, bz! - az!];
    const v = [cx! - ax!, cy! - ay!, cz! - az!];
    area += Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
  }
  return { volume, area };
}

/** How an STL is written (F4.1, ADR 0221): binary (the default, small) or ASCII, in millimetres (the default) or inches. */
export interface StlWriteOptions {
  format?: 'binary' | 'ascii';
  unit?: StlUnit;
}

/** The bytes of an STL file of these meshes. */
export function writeStl(meshes: readonly StlSource[], name: string, options: StlWriteOptions = {}): Uint8Array {
  const unit = options.unit ?? 'mm';
  if (!STL_UNIT_MM[unit]) throw new Error(t('stl.badUnit', { unit: String(unit) }));
  const format = options.format ?? 'binary';
  if (format !== 'binary' && format !== 'ascii') throw new Error(t('stl.badFormat', { format: String(format) }));
  return format === 'ascii' ? new TextEncoder().encode(asciiStl(meshes, name, unit)) : binaryStl(meshes, name, unit);
}

/** A mesh moved to where a component is (an assembly's STL, ADR 0221). */
export function placeMesh(mesh: StlSource, pose: Pose): StlSource {
  const p = mesh.positions;
  const positions = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 3) positions.set(transformPoint(pose, [p[i]!, p[i + 1]!, p[i + 2]!]), i);
  return { positions, indices: mesh.indices };
}

/** Every part an assembly places, down through its sub-assemblies, with where it is in the assembly and its names from the top ("底座<1>/銷<2>"). */
export function placedParts(instances: readonly StepInstance[], subs: readonly StepSub[], at: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, path: readonly string[] = []): { part: number; pose: Pose; path: string[] }[] {
  return instances.flatMap((i) => {
    const pose = composePose(at, i.pose);
    const here = [...path, i.name];
    if (i.part !== undefined) return [{ part: i.part, pose, path: here }];
    const sub = i.sub !== undefined ? subs[i.sub] : undefined;
    return sub ? placedParts(sub.instances, subs, pose, here) : [];
  });
}

/** File names for several STLs in one archive: made safe, and the second of a name gets " (2)". */
export function stlEntryNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = safeFileName(n).replace(/[<>]/g, '_');
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return `${k === 1 ? base : `${base} (${k})`}.stl`;
  });
}
