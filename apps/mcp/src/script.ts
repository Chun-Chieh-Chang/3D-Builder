/**
 * A modelling script (ADR 0237, headless mode): a JSON file of variables, commands and outputs, run without a window by the CLI (`cli.ts`) through the
 * same session and the same checks as the MCP tools. Variables become document variables (`addVariable`) before the commands, so that a dimension can
 * be the expression `R` and `--set R=40` changes the part without editing the script.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AgentError, EXPORT_FORMATS, type ApplyReport, type CadSession, type ExportFormat } from './session';
import { renderView, type RenderOptions } from './render';

export interface ModelScript {
  /** Name → expression (`"30"`, `"R/2"`). */
  variables?: Record<string, string>;
  commands: unknown[];
  outputs?: {
    /** The figures of the part as JSON. */
    report?: string;
    views?: (RenderOptions & { path: string })[];
    exports?: { format: ExportFormat; path: string }[];
    /** The part as a .3dbx file. */
    save?: string;
  };
}

export interface ScriptResult {
  committed: boolean;
  report: ApplyReport;
  written: string[];
}

/** `name=value` pairs of `--set` as a map; a pair without `=` or a name twice is refused. */
export function parseSets(pairs: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of pairs) {
    const at = p.indexOf('=');
    if (at <= 0 || at === p.length - 1) throw new AgentError(`--set takes name=value, not ${JSON.stringify(p)}`);
    const name = p.slice(0, at).trim();
    if (out.has(name)) throw new AgentError(`--set ${name} is given twice`);
    out.set(name, p.slice(at + 1).trim());
  }
  return out;
}

function checkScript(raw: unknown): ModelScript {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new AgentError('a script is a JSON object with commands');
  const s = raw as ModelScript;
  for (const k of Object.keys(s)) if (!['variables', 'commands', 'outputs'].includes(k)) throw new AgentError(`a script has no field ${k} (it has variables, commands, outputs)`);
  if (!Array.isArray(s.commands) || s.commands.length === 0) throw new AgentError('a script needs commands: a non-empty array');
  if (s.variables !== undefined && (typeof s.variables !== 'object' || s.variables === null || Array.isArray(s.variables) || !Object.values(s.variables).every((v) => typeof v === 'string'))) throw new AgentError('variables must map names to expressions (strings)');
  for (const e of s.outputs?.exports ?? []) if (!EXPORT_FORMATS.includes(e.format)) throw new AgentError(`an export format must be ${EXPORT_FORMATS.join(', ')}, not ${JSON.stringify(e.format)}`);
  return s;
}

/** Runs the script on a new part. `sets` replace variables of the script by name; a name the script does not have is refused (it would change nothing). */
export async function runScript(session: CadSession, raw: unknown, sets: ReadonlyMap<string, string> = new Map()): Promise<ScriptResult> {
  const script = checkScript(raw);
  const variables = { ...(script.variables ?? {}) };
  for (const [name, value] of sets) {
    if (!(name in variables)) throw new AgentError(`--set ${name}: the script has no variable ${name} (it has ${Object.keys(variables).join(', ') || 'none'})`);
    variables[name] = value;
  }
  await session.newPart();
  const commands = [...Object.entries(variables).map(([name, expr], i) => ({ type: 'addVariable', variable: { id: `var${i + 1}`, name, expr } })), ...script.commands];
  const report = await session.apply(commands);
  const written: string[] = [];
  if (!report.committed) return { committed: false, report, written };
  const out = script.outputs ?? {};
  for (const v of out.views ?? []) {
    const { path, ...options } = v;
    const r = await renderView(session, options);
    const full = await session.inside(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, r.png);
    written.push(full);
  }
  for (const e of out.exports ?? []) written.push((await session.exportFile(e.path, e.format)).path);
  if (out.save) written.push((await session.save(out.save)).path);
  if (out.report) {
    const full = await session.inside(out.report);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify({ variables, summary: report.after }, null, 1));
    written.push(full);
  }
  return { committed: true, report, written };
}
