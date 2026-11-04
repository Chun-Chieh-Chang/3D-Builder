/**
 * The MCP server (ADR 0237): the tools an AI agent such as Claude Code uses to build, check, look at and save a part. Each tool is a thin layer over
 * `CadSession`, which does the work and the checks. A refusal comes back as a tool error with the reason (`isError`), never as a silent change.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { AgentError, EXPORT_FORMATS, messageOf, type CadSession, type ElementQuery, type ExportFormat } from './session';
import { RENDER_VIEWS, renderView, type RenderOptions } from './render';
import { commandReference, exampleReference, INSTRUCTIONS, typeReference } from './reference';

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } as const;
const path = { type: 'string', description: 'A file path relative to the workspace folder.' } as const;
const viewProps = { view: { type: 'string', enum: [...RENDER_VIEWS] }, dir: vec3, up: vec3, size: { type: 'integer', minimum: 64, maximum: 2048 }, hidden: { type: 'boolean', description: 'Hidden edges as thin grey lines.' } } as const;

export const TOOLS: Tool[] = [
  { name: 'part_new', description: 'Starts a new, empty part (the open part is closed without saving).', inputSchema: { type: 'object', properties: {} } },
  { name: 'part_open', description: 'Opens a .3dbx part file from the workspace folder and rebuilds it.', inputSchema: { type: 'object', properties: { path }, required: ['path'] } },
  { name: 'part_save', description: 'Saves the part as a .3dbx file (to its own file when no path is given).', inputSchema: { type: 'object', properties: { path } } },
  { name: 'part_summary', description: 'The part as built: every feature with its status, the bodies, the volume, area, center of mass and box.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'command_reference',
    description: "The TypeScript source of what commands take. topic 'commands': the Command union; 'types': the named types (Feature, SketchEntity, ExtrudeFeature, ...); 'example': a worked example.",
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: ['commands', 'types', 'example'] }, names: { type: 'array', items: { type: 'string' }, description: "Type names, for topic 'types'." } }, required: ['topic'] },
  },
  {
    name: 'apply_commands',
    description:
      'Applies commands to the part as one transaction and rebuilds it. The batch is kept only when every command applies and no feature breaks; otherwise the part stays as it was. dry_run: never kept, shows the result. preview: a picture of the result too (as render_view takes it), so that the user can see the design before it is kept.',
    inputSchema: { type: 'object', properties: { commands: { type: 'array', items: { type: 'object' }, minItems: 1 }, dry_run: { type: 'boolean' }, preview: { type: 'object', properties: viewProps } }, required: ['commands'] },
  },
  { name: 'undo', description: 'Takes back the last batch that was kept.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'query_elements',
    description: "Faces, edges or vertices of the part as built, with the 'ref' a command takes (copy it as is). Filter by type (plane, cylinder, line, circle, ...), by direction (a planar face's outward normal, or a straight edge's direction, within 1 degree) and by body.",
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['face', 'edge', 'vertex'] }, type: { type: 'string' }, direction: vec3, body: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, required: ['kind'] },
  },
  {
    name: 'render_view',
    description: 'A shaded picture of the part with its visible edges (PNG), from a named view or from a direction of your own.',
    inputSchema: { type: 'object', properties: viewProps },
  },
  {
    name: 'export_file',
    description: "Writes the part's own bodies to the workspace folder: STEP AP214 with colors, binary STL in mm, or 3MF for 3D printing (y up in the model is z up in the file).",
    inputSchema: { type: 'object', properties: { path, format: { type: 'string', enum: [...EXPORT_FORMATS] } }, required: ['path', 'format'] },
  },
  {
    name: 'rebuild_events',
    description: 'The last rebuilds of the part (newest last): what caused each, whether it was kept, which features failed, the volume. Each is also sent as a log notification when it happens.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
  },
  { name: 'session_status', description: 'The kernel heap (bytes), the shapes the session holds, and how many times the kernel was loaded again because its heap grew.', inputSchema: { type: 'object', properties: {} } },
];

const json = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] });
const refused = (message: string): CallToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

/** The arguments as an object, with no keys other than those the tool knows: a misspelt key is refused, not ignored. */
function argsOf(tool: Tool, raw: unknown): Record<string, unknown> {
  const args = raw === undefined ? {} : raw;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new AgentError('the arguments must be an object');
  const known = Object.keys((tool.inputSchema.properties ?? {}) as object);
  for (const k of Object.keys(args)) if (!known.includes(k)) throw new AgentError(`${tool.name} takes no argument ${k}${known.length ? ` (it takes ${known.join(', ')})` : ''}`);
  for (const k of (tool.inputSchema.required ?? []) as string[]) if (!(k in args)) throw new AgentError(`${tool.name} needs ${k}`);
  return args as Record<string, unknown>;
}

/** Calls one tool. Exported so that tests drive it the same way the transport does. */
export async function callTool(session: CadSession, name: string, raw: unknown): Promise<CallToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return refused(`no tool ${name}`);
  try {
    const a = argsOf(tool, raw);
    switch (name) {
      case 'part_new':
        return json(await session.newPart());
      case 'part_open':
        return json(await session.open(a.path as string));
      case 'part_save':
        return json(await session.save(a.path as string | undefined));
      case 'part_summary':
        return json(session.summary());
      case 'command_reference': {
        if (a.topic === 'commands') return { content: [{ type: 'text', text: commandReference() }] };
        if (a.topic === 'example') return { content: [{ type: 'text', text: exampleReference() }] };
        if (a.topic === 'types') {
          const names = a.names;
          if (!Array.isArray(names) || names.length === 0 || !names.every((n) => typeof n === 'string')) throw new AgentError("topic 'types' needs names: a list of type names");
          return { content: [{ type: 'text', text: typeReference(names as string[]) }] };
        }
        throw new AgentError(`topic must be commands, types or example, not ${JSON.stringify(a.topic)}`);
      }
      case 'apply_commands': {
        if (a.dry_run !== undefined && typeof a.dry_run !== 'boolean') throw new AgentError('dry_run must be true or false');
        if (a.preview !== undefined && (typeof a.preview !== 'object' || a.preview === null || Array.isArray(a.preview))) throw new AgentError('preview must be an object of render_view options ({} for the isometric view)');
        const options = a.preview as RenderOptions | undefined;
        const report = await session.apply(a.commands, { dryRun: a.dry_run === true, ...(options ? { preview: () => renderView(session, options) } : {}) });
        const { preview, ...rest } = report;
        const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(preview && 'error' in preview ? { ...rest, preview } : rest, null, 1) }];
        if (preview && !('error' in preview)) content.push({ type: 'image', data: Buffer.from(preview.png).toString('base64'), mimeType: 'image/png' });
        return { content, ...(report.error && !report.dryRun ? { isError: true } : {}) };
      }
      case 'undo':
        return json(await session.undo());
      case 'query_elements':
        return json(session.elements(a as unknown as ElementQuery));
      case 'render_view': {
        const r = await renderView(session, a as RenderOptions);
        return {
          content: [
            { type: 'image', data: Buffer.from(r.png).toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: JSON.stringify({ width: r.width, height: r.height, lookingAlong: r.axes.dir, up: r.axes.up }) },
          ],
        };
      }
      case 'export_file': {
        return json(await session.exportFile(a.path as string, a.format as ExportFormat));
      }
      case 'rebuild_events': {
        const limit = a.limit ?? 10;
        if (!(Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= 50)) throw new AgentError(`limit must be a whole number from 1 to 50, not ${String(limit)}`);
        return json(session.events.slice(-(limit as number)));
      }
      case 'session_status':
        return json({ heapBytes: session.heapBytes(), liveShapes: session.liveShapes(), kernelRestarts: session.restarts });
    }
    return refused(`no tool ${name}`);
  } catch (e) {
    return refused(messageOf(e));
  }
}

export function createServer(session: CadSession, version: string): Server {
  const server = new Server({ name: '3d-builder', version }, { capabilities: { tools: {}, logging: {} }, instructions: INSTRUCTIONS });
  // every rebuild as it happens (a notification; the client may show it or not): rebuild_events has the same, to ask for
  session.onEvent = (event) => {
    server.sendLoggingMessage({ level: event.failed.length && event.committed ? 'warning' : 'info', logger: 'rebuild', data: event }).catch(() => undefined);
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  // one call at a time: the session has one part and one kernel, and a batch must not see another half done
  let queue: Promise<unknown> = Promise.resolve();
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const run = queue.then(() => callTool(session, request.params.name, request.params.arguments));
    queue = run.catch(() => undefined);
    return run;
  });
  return server;
}
