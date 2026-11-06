/**
 * What the agent reads to write commands (ADR 0237): the TypeScript source of the command union and of the document types, taken from the source files
 * when the server is built. There is no second description to keep in step with the code: the reference is the code. (A JSON Schema made from the types
 * would need the compiler's API, which TypeScript 7 does not offer to JavaScript.)
 */
import commandsSource from '../../../packages/model/src/commands.ts?raw';
import schemaSource from '../../../packages/model/src/schema.ts?raw';
import { PLATE_WITH_HOLE, PLATE_WITH_HOLE_VOLUME } from './examples';

const SOURCES = [schemaSource, commandsSource];

/** The declaration `export interface name` or `export type name` with the comment above it, or null. */
export function declaration(name: string, source: string): string | null {
  const lines = source.split('\n');
  const head = new RegExp(`^export (interface|type) ${name.replace(/[^A-Za-z0-9_]/g, '')}\\b`);
  const at = lines.findIndex((l) => head.test(l));
  if (at < 0) return null;
  let from = at;
  if (lines[at - 1]?.trim().endsWith('*/')) {
    while (from > 0 && !lines[from - 1]!.trim().startsWith('/**')) from--;
    from--;
  }
  let depth = 0;
  for (let i = at; i < lines.length; i++) {
    // a comment's words do not count: its brackets and its full stops are prose
    const code = lines[i]!.trim().startsWith('*') || lines[i]!.trim().startsWith('/*') ? '' : lines[i]!.replace(/\/\/.*$|\/\*.*?\*\//g, '');
    for (const ch of code) {
      if ('{(['.includes(ch)) depth++;
      else if ('})]'.includes(ch)) depth--;
    }
    const end = code.trimEnd();
    if (depth <= 0 && (end.endsWith(';') || end === '}')) return lines.slice(from, i + 1).join('\n');
  }
  return lines.slice(from).join('\n');
}

/** The names of every type the two files declare: what `typeNames` may ask for. */
export const TYPE_NAMES: string[] = SOURCES.flatMap((s) => [...s.matchAll(/^export (?:interface|type) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]!)).sort();

export function commandReference(): string {
  return declaration('Command', commandsSource) ?? 'Command union not found';
}

export function typeReference(names: readonly string[]): string {
  return names
    .map((n) => {
      for (const s of SOURCES) {
        const d = declaration(n, s);
        if (d) return d;
      }
      return `// ${n}: no such type. Known types: ${TYPE_NAMES.join(', ')}`;
    })
    .join('\n\n');
}

export function exampleReference(): string {
  return [
    '// A 60 x 40 x 10 plate with a 10 mm hole through it. apply_commands with this array builds it;',
    `// its volume is then ${PLATE_WITH_HOLE_VOLUME.toFixed(4)} mm^3 (60*40*10 - pi*5^2*10).`,
    JSON.stringify(PLATE_WITH_HOLE, null, 1),
  ].join('\n');
}

/** How to work with the part, sent to the agent when it connects. */
export const INSTRUCTIONS = `3D-Builder is a parametric CAD program. You build one part at a time with the same commands the app sends.

Rules of the model:
- Units are mm and degrees. The model's y axis is up. Datum planes: plane:front (normal +z), plane:top (normal +y), plane:right (normal +x).
- A sketch's entities are points, lines, circles, arcs, ... that refer to points by id. Dimensions are expressions (strings) like "60" or "W/2".
- Make every sketch fully defined (dof 0): fix each point with relations and dimensions; '@origin' is the sketch origin.
- Every id in the part must be unique. Insert a new feature with { type: 'insertFeature', index: <number of features>, feature }.
- A cut (extrude op 'cut') on a datum plane goes into the material only with reverse: true; on a model face it goes into the material by default.

How to work:
1. Read command_reference (topic 'commands'), then the types you use (topic 'types'), and the worked example (topic 'example').
2. Send a batch with apply_commands. Use dry_run first when you are not sure. A batch is kept only when every command applies and no feature breaks.
3. Read the answer: 'broken' lists features that fail and why; 'after' has the volume, area and box. Compare them with what you expect.
4. To pick a face, edge or vertex (for fillets, shells, sketch planes), ask query_elements and copy its 'ref' into the command as is.
5. Look at the part with render_view when the numbers alone do not tell you enough.
6. Save with part_save (a .3dbx file), or write STEP/STL with export_file. Files are read and written only inside the workspace folder.
7. A part with an imported body (an importedBody feature, from a STEP or IGES file) can be turned into native features with recognize_features: it either rebuilds the same solid or says why not.`;
