/**
 * 3MF (3D Manufacturing Format, core specification 1.3), the format 3D printing slicers read (ADR 0237): a zip of an XML model whose meshes are in
 * millimetres. A kernel mesh repeats a vertex for every face it is on (each face is meshed on its own), and 3MF wants each object to be a closed
 * mesh whose edges each belong to two triangles, so equal vertices are made one. Equal means equal as written (to 1e-6 mm): the faces of a body share
 * the points of their common edges, so their copies are the same numbers.
 *
 * The model's y is up (as in SolidWorks); a slicer's z is up. The vertices are written as they are, and each build item carries the turn that puts
 * the model's y on 3MF's z (x stays, y goes to z, z goes to −y), so the part stands on the bed as it stands in the model.
 */
import type { StlSource } from './stl';
import { writeZip } from './zip';

export interface ThreeMfObject {
  name: string;
  mesh: StlSource;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (x: number) => {
  const r = Math.round(x * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

/** The vertices and triangles of a mesh with equal vertices made one; triangles that lose a corner to the welding (zero area) are left out. */
export function weldMesh(mesh: StlSource): { vertices: string[]; triangles: [number, number, number][] } {
  const index = new Map<string, number>();
  const vertices: string[] = [];
  const of = (i: number) => {
    const p = mesh.positions;
    const key = `${num(p[i * 3]!)} ${num(p[i * 3 + 1]!)} ${num(p[i * 3 + 2]!)}`;
    let at = index.get(key);
    if (at === undefined) {
      at = vertices.length;
      index.set(key, at);
      vertices.push(key);
    }
    return at;
  };
  const triangles: [number, number, number][] = [];
  for (let k = 0; k + 2 < mesh.indices.length; k += 3) {
    const t: [number, number, number] = [of(mesh.indices[k]!), of(mesh.indices[k + 1]!), of(mesh.indices[k + 2]!)];
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) triangles.push(t);
  }
  return { vertices, triangles };
}

/** A 3MF file of the objects, one build item each, in millimetres. */
export async function writeThreeMf(objects: readonly ThreeMfObject[]): Promise<Uint8Array> {
  if (objects.length === 0) throw new Error('3MF: nothing to write');
  const parts: string[] = [];
  objects.forEach((o, i) => {
    const { vertices, triangles } = weldMesh(o.mesh);
    if (triangles.length === 0) throw new Error(`3MF: ${o.name} has no triangles`);
    const vs = vertices.map((v) => {
      const [x, y, z] = v.split(' ');
      return `<vertex x="${x}" y="${y}" z="${z}"/>`;
    });
    const ts = triangles.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    parts.push(`<object id="${i + 1}" type="model" name="${escape(o.name)}"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`);
  });
  // row vectors (3MF 1.3 §3.3): x → (1, 0, 0), y → (0, 0, 1), z → (0, −1, 0)
  const items = objects.map((_, i) => `<item objectid="${i + 1}" transform="1 0 0 0 0 1 0 -1 0 0 0 0"/>`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">3D-Builder</metadata><resources>${parts.join('')}</resources><build>${items}</build></model>`;
  const enc = new TextEncoder();
  return writeZip([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(RELS) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}
