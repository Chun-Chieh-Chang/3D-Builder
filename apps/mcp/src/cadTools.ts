import { z } from 'zod';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Command } from '@3db/model';
import { normalizedViewAxes } from '@3db/model';
import { isTrap } from '@3db/kernel';
import { executeSchema, featureCommands } from './cadFeatures';
import { renderView, type RenderOptions } from './render';
import { messageOf, MIN_MESH_TOLERANCE, type CadSession } from './session';

const vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const cameraSchema = z.strictObject({ camera: z.enum(['isometric', 'top', 'front', 'right', 'custom']).default('isometric'), dir: vec.optional(), up: vec.optional(), size: z.number().int().min(64).max(2048).optional() });
const inspectSchema = z.strictObject({ body: z.string().min(1).optional() });
const exportSchema = z.strictObject({ path: z.string().min(1), format: z.enum(['step', 'stl', '3mf']), meshTolerance: z.number().finite().min(MIN_MESH_TOLERANCE).optional() });
const schemas = { cad_execute_feature: executeSchema, cad_get_viewport_screenshot: cameraSchema, cad_inspect_geometry: inspectSchema, cad_export_manufacturing: exportSchema };
export const CAD_TOOLS: Tool[] = Object.entries(schemas).map(([name, schema]) => ({ name, description: {
  cad_execute_feature: 'Apply a structured parametric feature transaction. Optional bounded repair only shrinks fillet/chamfer values and records each attempt. Returns retained-state diagnostics and PNG.',
  cad_get_viewport_screenshot: 'Render actual geometry without a GUI; return retained-state diagnostics and a PNG image.',
  cad_inspect_geometry: 'Inspect exact mass properties and body bounds, including reference bodies. Cylinder faces are geometric candidates, not certified mounting holes.',
  cad_export_manufacturing: 'Export STEP/STL/3MF. meshTolerance is an absolute distance in mm for mesh formats; STEP remains exact BRep.',
}[name], inputSchema: z.toJSONSchema(schema) as Tool['inputSchema'] }));

async function feedback(session: CadSession, detail: object, error = false, options: RenderOptions = {}, requireImage = false): Promise<CallToolResult> {
  const summary = session.summary(undefined, true);
  const content: CallToolResult['content'] = [];
  let imageError: string | undefined;
  try {
    const image = await renderView(session, options);
    content.push({ type: 'image', mimeType: 'image/png', data: Buffer.from(image.png).toString('base64') });
  } catch (e) { if (isTrap(e)) throw e; imageError = messageOf(e); }
  content.unshift({ type: 'text', text: JSON.stringify({ ...detail, ...(requireImage && imageError ? { status: 'rejected' } : {}), current: summary, warnings: summary.features.flatMap((f) => f.warnings ?? []), ...(imageError ? { imageError } : {}) }) });
  return { content, ...(error || (requireImage && imageError) ? { isError: true } : {}) };
}

export async function callCadTool(session: CadSession, name: string, raw: unknown, gate?: (commands: Command[]) => Promise<void>): Promise<CallToolResult> {
  try {
    if (name === 'cad_get_viewport_screenshot') {
      const a = cameraSchema.parse(raw);
      if (a.camera !== 'custom' && (a.dir || a.up)) throw new Error('dir/up require camera custom');
      if (a.camera === 'custom' && (!a.dir || !a.up)) throw new Error('custom camera requires dir and up');
      if (a.camera === 'custom') normalizedViewAxes({ dir: a.dir!, up: a.up! });
      return feedback(session, { status: 'ok' }, false, a.camera === 'custom' ? { dir: a.dir, up: a.up, size: a.size } : { view: a.camera, size: a.size }, true);
    }
    if (name === 'cad_inspect_geometry') {
      const a = inspectSchema.parse(raw);
      return { content: [{ type: 'text', text: JSON.stringify(session.inspectBodies(a.body)) }] };
    }
    if (name === 'cad_export_manufacturing') {
      const a = exportSchema.parse(raw);
      return { content: [{ type: 'text', text: JSON.stringify(await session.exportFile(a.path, a.format, a.meshTolerance)) }] };
    }
    const a = executeSchema.parse(raw);
    let feature = a.feature;
    const attempts = [];
    const geometryWarnings = [];
    let canRepairSelectedEdges = false;
    if (feature.operation === 'fillet' || feature.operation === 'chamfer') {
      const selected = new Set(feature.edges.map((edge) => edge.name));
      const available = session.elements({ kind: 'edge' });
      // A missing/stale reference or a periodic seam is not a radius problem. Let native resolution try once, without shrinking it.
      canRepairSelectedEdges = [...selected].every((name) => available.some((edge) => edge.ref.name === name && !edge.seam));
      const lengths = available.filter((edge) => selected.has(edge.ref.name) && edge.length !== undefined).map((edge) => edge.length!);
      const value = feature.operation === 'fillet' ? feature.radius : feature.distance;
      if (lengths.length && value >= Math.min(...lengths) / 2) geometryWarnings.push({ code: 'large_relative_to_selected_edges', requested: value, edgeIds: [...selected], shortestEdgeLength: Math.min(...lengths), certifiedLimit: null, message: 'Large relative to selected edge length; this is a scale warning, not a computed fillet/chamfer feasibility limit.' });
    }
    for (let attempt = 0; attempt < (a.repair?.maxAttempts ?? 1); attempt++) {
      const report = await session.apply(featureCommands(session, feature), { gate });
      attempts.push({ feature, committed: report.committed, error: report.error, broken: report.broken });
      if (report.committed) return feedback(session, { status: 'committed', attempts, geometryWarnings });
      // Only geometric rebuild refusals are repairable; command and live-bridge errors are not.
      if (!a.repair || !canRepairSelectedEdges || !report.broken.length || report.broken.some((broken) => broken.id !== feature.id || broken.status !== 'error') || (feature.operation !== 'fillet' && feature.operation !== 'chamfer')) break;
      const value = (feature.operation === 'fillet' ? feature.radius : feature.distance) * a.repair.factor;
      if (value < a.repair.minValue) break;
      feature = feature.operation === 'fillet' ? { ...feature, radius: value } : { ...feature, distance: value };
    }
    return feedback(session, { status: 'rejected', attempts, geometryWarnings }, true);
  } catch (e) {
    if (isTrap(e)) throw e;
    return feedback(session, { status: 'rejected', requested: raw, error: messageOf(e) }, true);
  }
}
