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
export const INSTRUCTIONS = `3D-Builder is a parametric CAD program. Part and headless assembly work each have their own session.

For assemblies, start with assembly_new. Use assembly_query_elements on .3dbx sources to discover persistent face and plane references. Use assembly_apply_commands with dry_run, preview and interference to review component poses, remaining degrees of freedom and overlaps. After confirmation, apply the same batch and save with assembly_save. A successful solve can still report interference. While the live link is connected and the app shows an assembly (live_status), the assembly tools work on that assembly instead: source paths are relative to its folder and read from the app, a kept batch is applied in the app as one undo step, undo takes back your last batch, and the user opens and saves files (assembly_new, assembly_open and assembly_save are refused).

Rules of the model:
- Structured CAD tools: cad_execute_feature accepts a numeric feature object; inspect its published JSON Schema. cad_get_viewport_screenshot returns diagnostics and PNG; cad_inspect_geometry measures bodies and hole rims; cad_export_manufacturing accepts meshTolerance in mm for STL/3MF.
- cad_execute_feature returns current (retained state) and attempts. Optional repair requires maxAttempts (1-8), factor (0-1 exclusive) and minValue; only geometric fillet/chamfer refusals can shrink, each attempt is recorded. Exhausted repair leaves the original model. Inspect the image and measured geometry before proposing another construction; do not repeat indefinitely. Scale warnings are not certified geometric limits.
- Units are mm and degrees. The model's y axis is up. Datum planes: plane:front (normal +z), plane:top (normal +y), plane:right (normal +x).
- A sketch's entities are points, lines, circles, arcs, ... that refer to points by id. Dimensions are expressions (strings) like "60" or "W/2".
- Make every sketch fully defined (dof 0): fix each point with relations and dimensions; '@origin' is the sketch origin.
- Every id in the part must be unique, and so must every feature name: an insertFeature or renameFeature with a name another feature has is refused, and the error offers a free one. Insert a new feature with { type: 'insertFeature', index: <number of features>, feature }.
- Estimates: a value you guessed (from a photo, a common size, a standard you could not read) is an estimate. Put such sizes in variables (addVariable) and mark them { estimate: true } on the variable, or setFeatureNote { featureId, estimate: true } on a feature whose geometry is guessed; the tree shows the mark and the user can list them. Never write 估, est or (估) into a name: clear the mark (estimate: false) when the user gives a measured value.
- Design intent: drive the main sizes from variables; build a repeated feature once and repeat it with a pattern (circular: def { mode: 'circular', axis, count, angle, equal: true }, where axis is a refAxis feature or a straight edge, not the origin's axes: e.g. a refAxis { mode: 'planes', plane: plane:front, plane2: plane:right } is the Y axis; seeds can be extrude, revolve, sweep, loft, hole, fillet, chamfer ...; cuts repeat reliably, a fillet or chamfer seed may fail on a complex body, then build each copy) or a mirror rather than building each copy; group the features of one region (a shank, a head) in a folder with arrange { order, folders: { <featureId>: '<folder name>' } }.
- A cut (extrude op 'cut') on a datum plane goes into the material only with reverse: true; on a model face it goes into the material by default.

How to work:
1. Read command_reference (topic 'commands'), then the types you use (topic 'types'), and the worked example (topic 'example').
2. Send a batch with apply_commands. Use dry_run first when you are not sure. A batch is kept only when every command applies and no feature breaks.
3. Read the answer: 'broken' lists features that fail and why; 'after' has the volume, area and box. Compare them with what you expect.
4. To pick a face, edge or vertex (for fillets, shells, sketch planes), ask query_elements and copy its 'ref' into the command as is.
5. Look at the part with render_view when the numbers alone do not tell you enough.
6. Save with part_save (a .3dbx file), or write STEP/STL with export_file. Files are read and written only inside the workspace folder.
7. A part with an imported body (an importedBody feature, from a STEP or IGES file) can be turned into native features with recognize_features: it either rebuilds the same solid or says why not.

Engineering drawings of the open part, made with the user (ADR 0256). The rule: the drawing must fully determine every size of the part, meet every annotation the user asks for, and you create the views, sections and dimensions yourself.
1. The part must be saved (part_save) first: the drawing refers to its file.
2. drawing_plan: show the user the pictures of the best main directions with one line each on why (the metrics), and ask the one question it gives (usually only which main view, or 「照建議」). Do not ask about anything the plan already settles.
3. drawing_create with the user's choice (or the plan's). Look at the picture and read drawing.checks: coverage.complete must be true; when it is not, coverage lists what is not determined (a place along a way, a round's size, a slant). Add those (drawing_complete, or drawing_apply for a chamfer or angle dimension) and say plainly what still is not determined and why.
4. The user adds tolerances and annotations in words at any time: drawing_tolerance (「Ø10 加 H7」, 「長度 ±0.05」: the dimension by its text or id), drawing_annotate (surface finish Ra, geometric tolerance with datums, datum letters, notes; the element by its ref from drawing_inspect, or by a dimension of it). Use drawing_inspect to find which plane is meant (its 'end' says which side of the view it is).
5. Every change is saved to the .3dbd at once and comes back with the checks and a picture: look at it, and fix overlaps (drawing_apply setDimension offset) before you report.
6. drawing_export writes PDF, DXF or SVG for the user.`;
