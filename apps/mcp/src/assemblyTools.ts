import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { AssemblySession, MAX_ASSEMBLY_COMPONENTS, MAX_ASSEMBLY_MATES } from './assemblySession';
import { RENDER_VIEWS } from './render';
import type { CadSession } from './session';

const name = z.string().min(1).max(256);
const filePath = z.string().min(1);
const number = z.number().finite();
const xyz = z.tuple([number, number, number]);
const pose = z.strictObject({ position: xyz, rotation: z.tuple([number, number, number, number]) });
const source = z.strictObject({ id: name, path: filePath });
const element = z.strictObject({
  kind: z.enum(['face', 'datum']), name,
  fingerprint: z.strictObject({ type: name, size: number, center: xyz, dir: xyz.optional() }).optional(),
});
const end = z.strictObject({ component: name.nullable(), ref: element });
const mateBase = {
  id: name, name, suppressed: z.literal(false).default(false),
  a: end, b: end, align: z.enum(['aligned', 'antiAligned']).optional(),
};
const commands = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('insertComponent'), file: source.optional(),
    component: z.strictObject({ id: name, file: name, instance: z.number().int().positive(), fixed: z.boolean(), placement: pose }) }),
  z.strictObject({ type: z.literal('setFixed'), componentIds: z.array(name).min(1).max(MAX_ASSEMBLY_COMPONENTS), value: z.boolean() }),
  z.strictObject({ type: z.literal('setPlacements'),
    placements: z.array(z.strictObject({ componentId: name, placement: pose })).min(1).max(MAX_ASSEMBLY_COMPONENTS) }),
  z.strictObject({ type: z.literal('insertMate'), mate: z.discriminatedUnion('type', [
    z.strictObject({ ...mateBase, type: z.literal('coincident') }),
    z.strictObject({ ...mateBase, type: z.literal('concentric') }),
    z.strictObject({ ...mateBase, type: z.literal('distance'), value: name, flip: z.boolean().optional() }),
  ]) }),
]);
const preview = z.strictObject({
  view: z.enum(RENDER_VIEWS).optional(), size: z.number().int().min(64).max(2048).optional(),
}).optional();
const options = { preview, interference: z.boolean().optional() };
const schemas = {
  assembly_new: z.strictObject({}),
  assembly_open: z.strictObject({ path: filePath }),
  assembly_query_elements: z.strictObject({ path: filePath.optional(), component: name.optional() }),
  assembly_apply_commands: z.strictObject({
    commands: z.array(commands).min(1).max(MAX_ASSEMBLY_COMPONENTS + MAX_ASSEMBLY_MATES),
    dry_run: z.boolean().optional(), ...options,
  }),
  assembly_inspect: z.strictObject(options),
  assembly_save: z.strictObject({ path: filePath }),
  assembly_export: z.strictObject({ path: filePath, format: z.enum(['step', 'bom_csv']) }),
};
type AssemblyToolName = keyof typeof schemas;
const descriptions: Record<AssemblyToolName, string> = {
  assembly_new: 'Start a separate headless assembly. Save uncommitted work before starting again.',
  assembly_open: 'Reopen and solve a workspace .3dba in the supported headless subset. Save uncommitted work first.',
  assembly_query_elements: 'Discover planar and cylindrical references on a workspace .3dbx source or a component instance. Set exactly one of path or component.',
  assembly_apply_commands: 'Solve an atomic batch of component and mate operations. Set dry_run with preview to inspect the result before committing.',
  assembly_inspect: 'Report assembly poses and mate status, optionally check interference and render the committed assembly.',
  assembly_save: 'Write a new editable .3dba referencing workspace .3dbx files. Existing files are kept.',
  assembly_export: 'Write the committed, fully solved assembly as a delivery file: format step (.step/.stp, each source part once, each component at its solved pose, face colors kept) or bom_csv (.csv, the flat parts list the app writes). Existing files are kept.',
};
export const ASSEMBLY_TOOLS = (Object.keys(schemas) as AssemblyToolName[]).map((name): Tool => ({
  name,
  description: descriptions[name],
  inputSchema: z.toJSONSchema(schemas[name], { io: 'input' }) as Tool['inputSchema'],
}));
export const isAssemblyTool = (name: string): name is AssemblyToolName => Object.hasOwn(schemas, name);

const assemblies = new WeakMap<CadSession, AssemblySession>();
const json = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

export async function callAssemblyTool(session: CadSession, name: AssemblyToolName, raw: unknown): Promise<CallToolResult> {
  let assembly = assemblies.get(session);
  if (!assembly) {
    assembly = new AssemblySession(session);
    assemblies.set(session, assembly);
  }
  const args = raw === undefined ? {} : raw;
  switch (name) {
    case 'assembly_new':
      schemas.assembly_new.parse(args);
      return json(assembly.newAssembly());
    case 'assembly_open': {
      const result = await assembly.open(schemas.assembly_open.parse(args).path);
      return { ...json(result), ...(result.opened ? {} : { isError: true }) };
    }
    case 'assembly_query_elements': {
      const a = schemas.assembly_query_elements.parse(args);
      if ((a.path === undefined) === (a.component === undefined)) throw new Error('specify exactly one of path or component');
      return json(await assembly.queryElements(a.path !== undefined ? { path: a.path } : { component: a.component! }));
    }
    case 'assembly_save':
      return json(await assembly.save(schemas.assembly_save.parse(args).path));
    case 'assembly_export': {
      const a = schemas.assembly_export.parse(args);
      return json(await assembly.export(a.path, a.format));
    }
    case 'assembly_apply_commands':
    case 'assembly_inspect': {
      const result = name === 'assembly_apply_commands'
        ? await runApply(assembly, args)
        : await assembly.inspect(schemas.assembly_inspect.parse(args));
      const reply = json(result.report);
      if (!result.report.valid) reply.isError = true;
      if (result.image) reply.content.push({ type: 'image', mimeType: 'image/png', data: Buffer.from(result.image.png).toString('base64') });
      return reply;
    }
  }
}

function runApply(assembly: AssemblySession, raw: unknown) {
  const { commands, dry_run, ...options } = schemas.assembly_apply_commands.parse(raw);
  return assembly.apply(commands, dry_run === true, options);
}
