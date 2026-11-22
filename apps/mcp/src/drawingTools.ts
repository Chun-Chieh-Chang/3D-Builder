/**
 * The drawing tools (ADR 0256): the agent plans a drawing of the open part with the user, makes it in one call, adds what the user asks for (tolerances,
 * surface finishes, geometric tolerances, datums, notes) and checks that the dimensions determine the part. Each change is saved to the drawing's file at
 * once, so the user can open it in the app at any time, and answers with the self-check and a picture of the sheet.
 */
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_DRAWING_STANDARD, DRAWING_STANDARDS, DRAWING_TEXT_WIDTH, GEOMETRIC_CHARACTERISTICS, type DrawingCommand, type DrawingStandard, type Scale } from '@3db/model';
import { AgentError, type CadSession } from './session';
import { DrawingSession, type AnnotateInput, type CreateOptions } from './drawingSession';

const ORTHO = ['front', 'back', 'top', 'bottom', 'left', 'right'] as const;
const SIDE = z.enum(['up', 'down', 'left', 'right']);
const picture = z.boolean().optional().describe('A PNG of the sheet with the answer (default true).');

const schemas = {
  drawing_plan: z.strictObject({
    projection: z.enum(['first', 'third']).optional().describe('First angle (ISO/CNS) or third angle (ANSI). Default third, as the app.'),
    thumbnails: z.boolean().optional().describe('Pictures of the part from the three best main directions, to show the user (default true).'),
  }),
  drawing_create: z.strictObject({
    main: z.enum(ORTHO).optional().describe('The direction the main view looks from; default the best of drawing_plan.'),
    views: z.array(SIDE).max(4).optional().describe('The sides of the main view to project views to; default as planned.'),
    section: z.union([z.boolean(), z.literal('auto')]).optional().describe("'auto' (default): a section A-A when the main view hides too much."),
    isometric: z.boolean().optional().describe('A shaded isometric in a free corner (default true).'),
    sheet: z.enum(['A4', 'A3', 'A2', 'A1', 'A0', 'auto']).optional(),
    orientation: z.enum(['landscape', 'portrait']).optional(),
    scale: z.string().regex(/^\d+:\d+$/).optional().describe('「1:2」, 「2:1」; default: the largest standard scale that fits.'),
    projection: z.enum(['first', 'third']).optional(),
    standard: z.enum(DRAWING_STANDARDS as [DrawingStandard, ...DrawingStandard[]]).optional().describe(`The drafting standard the sheet is drawn to: its line widths, dashes and frame. Default ${DEFAULT_DRAWING_STANDARD}.`),
    title: z.partialRecord(z.enum(['company', 'drawingName', 'drawingNo', 'material', 'drafter', 'date', 'revision', 'generalTolerance']), z.string()).optional(),
    ordinate_above: z.number().int().min(1).max(50).optional().describe('More places than this along one way of a view become one ordinate row. By default, 6 with a visible plane as the datum.'),
    path: z.string().min(1).optional().describe('The .3dbd file, relative to the workspace; default the part file with .3dbd.'),
    picture,
  }),
  drawing_inspect: z.strictObject({}),
  drawing_tolerance: z.strictObject({
    dimension: z.string().min(1).describe('The dimension: its id, or the text it writes (「Ø10」, 「25」) when only one writes it.'),
    tolerance: z.string().nullable().optional().describe('「±0.05」, 「+0.1/-0.05」, 「+0.02/0」, a class 「H7」 「g6」, 「max」 or 「min」; null takes the tolerance away.'),
    reference: z.boolean().optional().describe('A reference dimension, written in parentheses.'),
    precision: z.number().int().min(0).max(4).optional().describe('Decimals of the number.'),
    picture,
  }),
  drawing_annotate: z.strictObject({
    kind: z.enum(['note', 'finish', 'datum', 'fcf', 'revision']).describe('note: text (with a leader when it has a target); finish: surface roughness (ISO 1302); datum: a datum letter (ISO 5459); fcf: a geometric tolerance (ISO 1101); revision: a revision triangle marking a changed location.'),
    target: z.string().optional().describe('The element: a ref name from drawing_inspect, or a dimension (id or text) whose element it goes on. A note or revision triangle without one is placed on the view without a leader.'),
    view: z.string().optional().describe('The view, when the target is seen in several.'),
    text: z.string().max(500).optional(),
    revision: z.string().max(16).optional().describe('Revision code inside a revision triangle (defaults to the current drawing revision).'),
    wrapWidth: z.number().min(DRAWING_TEXT_WIDTH.min).max(DRAWING_TEXT_WIDTH.max).optional().describe('Maximum note text width in paper millimetres.'),
    enclosure: z.enum(['circle', 'rounded']).optional().describe('A note enclosure, such as rounded for an inspection callout.'),
    ra: z.number().optional().describe('Ra in µm (0.008–400).'),
    method: z.string().optional().describe('How the surface is made (「研磨」).'),
    process: z.enum(['machined', 'basic', 'unmachined']).optional().describe('machined: material removed; basic: any process; unmachined: no material removed.'),
    label: z.string().optional().describe('A datum letter.'),
    characteristic: z.enum(GEOMETRIC_CHARACTERISTICS).optional(),
    tolerance: z.number().optional().describe('The geometric tolerance in mm.'),
    diameter: z.boolean().optional(),
    material: z.enum(['M', 'L']).optional(),
    datums: z.array(z.string()).max(3).optional(),
    picture,
  }),
  drawing_complete: z.strictObject({ picture }),
  drawing_text_size: z.strictObject({
    all: z.number().optional().describe('One text height (mm) for the whole drawing: dimensions, notes, finishes, frames, datums (2.5–5); captions follow at 10/7 of it.'),
    reset: z.boolean().optional().describe('With all: the sizes given to single items follow the drawing again.'),
    item: z.string().optional().describe('A dimension (id or text), a note (id) or a view (id or name) to give a size of its own.'),
    size: z.number().nullable().optional().describe('Its height in mm (2.5–5; a caption 3.5–7), or null to follow the drawing again.'),
    picture,
  }),
  drawing_apply: z.strictObject({ commands: z.array(z.record(z.string(), z.unknown())).min(1).describe('DrawingCommand objects (command_reference topic types, names ["DrawingCommand"]).'), pageIndex: z.number().int().min(0).optional().describe('0-based page the commands go to (drawing_inspect gives each item its page); the first by default.'), picture }),
  drawing_undo: z.strictObject({ picture }),
  drawing_picture: z.strictObject({ view: z.string().optional().describe('Only this view, enlarged.'), px: z.number().min(1).max(16).optional().describe('Pixels per mm of the sheet.'), pageIndex: z.number().int().min(0).optional().describe('0-based page index.') }),
  drawing_save: z.strictObject({ path: z.string().min(1).optional() }),
  drawing_export: z.strictObject({
    path: z.string().min(1),
    format: z.enum(['pdf', 'dxf', 'svg']),
    release: z.boolean().optional().describe('When true, refuses export unless every quality gate rule passes (status === "release"). Default false: draft drawings export stamped PRELIMINARY.'),
  }),
  drawing_open: z.strictObject({ path: z.string().min(1) }),
};

const DESCRIPTIONS: Record<keyof typeof schemas, string> = {
  drawing_plan: 'Plans a drawing of the open part: the six directions ranked for the main view with the numbers (hidden lines, holes seen true, steps seen, detail), the views to project, whether a section is advised and where, and the question to put to the user. Pictures of the best directions come with it.',
  drawing_create: 'Makes the drawing of the open (saved) part in one step: the main view, the projected views, a section where the main view hides too much, a shaded isometric, every dimension needed to fully determine the part (each written once, in the view that shows it best), the sheet and the scale. Saves the .3dbd and returns the self-check (coverage: what is determined and what is not) and a picture of the sheet.',
  drawing_inspect: 'What is on the drawing: every dimension (id, text, what it points at, its tolerance), the annotations and finishes, and for each view the elements a tolerance, finish or note can go on (planes with which end of the view they are, holes with their diameter, arcs, fillets, slants), and the self-check.',
  drawing_tolerance: 'Updates a dimension’s tolerance, precision or reference status. Omit tolerance to keep it, or pass null to clear it.',
  drawing_annotate: 'Adds a note, a surface finish, a datum or a geometric tolerance on an element of a view (by its ref name or by a dimension of it), placed beside it with its leader on it.',
  drawing_text_size: 'Text heights: one size for the whole drawing (all), or one dimension, note or view caption on its own (item, size). Sizes outside what reads well (2.5–5 mm, captions 3.5–7) are refused. The rows are laid out again.',
  drawing_complete: 'Adds the dimensions the self-check finds missing (after dimensions were deleted or the part changed), and arranges them again.',
  drawing_apply: 'Applies DrawingCommand objects as one step (move a dimension, change the sheet, the title block, delete, …): all or nothing.',
  drawing_undo: 'Takes back the last change to the drawing.',
  drawing_picture: 'A PNG of the sheet, or of one view enlarged.',
  drawing_save: 'Saves the drawing (it is saved after every change already; a path saves a copy in the same folder).',
  drawing_export: 'Exports the drawing as PDF (one file, every page), DXF or SVG (one file per page: page n of a drawing of several beside the first as name-n.dxf; files lists them).',
  drawing_open: 'Opens a .3dbd drawing of one part (and that part) to go on with it.',
};

export const DRAWING_TOOLS: Tool[] = (Object.keys(schemas) as (keyof typeof schemas)[]).map((name) => ({ name, description: DESCRIPTIONS[name], inputSchema: z.toJSONSchema(schemas[name]) as Tool['inputSchema'] }));
export const isDrawingTool = (name: string): boolean => name in schemas;

const sessions = new WeakMap<CadSession, DrawingSession>();
export const drawingOf = (s: CadSession): DrawingSession => {
  let d = sessions.get(s);
  if (!d) sessions.set(s, (d = new DrawingSession(s)));
  return d;
};

const png = (bytes: Uint8Array) => ({ type: 'image' as const, data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' });

async function answer(d: DrawingSession, detail: object, withPicture = true): Promise<CallToolResult> {
  const report = d.report();
  const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify({ ...detail, drawing: report }, null, 1) }];
  if (withPicture) {
    const pages = report.pages ?? 1;
    for (let i = 0; i < pages; i++) {
      const p = await d.picture({ pageIndex: i });
      content.push(png(p.png));
    }
  }
  return { content };
}

export async function callDrawingTool(session: CadSession, name: string, raw: unknown): Promise<CallToolResult> {
  const d = drawingOf(session);
  const parse = <K extends keyof typeof schemas>(k: K) => {
    const r = schemas[k].safeParse(raw ?? {});
    if (!r.success) throw new AgentError(`${k}: ${r.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}`);
    return r.data as z.infer<(typeof schemas)[K]>;
  };
  switch (name) {
    case 'drawing_plan': {
      const a = parse('drawing_plan');
      const plan = d.plan(a.projection);
      const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(plan, null, 1) }];
      if (a.thumbnails ?? true) for (const t of await d.thumbnails(plan.main.slice(0, 3).map((c) => c.direction))) content.push({ type: 'text', text: `${t.direction}:` }, png(t.png));
      return { content };
    }
    case 'drawing_create': {
      const a = parse('drawing_create');
      const options: CreateOptions = {
        ...(a.main ? { main: a.main } : {}),
        ...(a.views ? { views: a.views } : {}),
        ...(a.section !== undefined ? { section: a.section } : {}),
        ...(a.isometric !== undefined ? { isometric: a.isometric } : {}),
        ...(a.sheet ? { sheet: a.sheet as CreateOptions['sheet'] } : {}),
        ...(a.orientation ? { orientation: a.orientation } : {}),
        ...(a.scale ? { scale: a.scale.split(':').map(Number) as Scale } : {}),
        ...(a.projection ? { projection: a.projection } : {}),
        ...(a.standard ? { standard: a.standard } : {}),
        ...(a.title ? { title: a.title } : {}),
        ...(a.ordinate_above ? { ordinateAbove: a.ordinate_above } : {}),
        ...(a.path ? { path: a.path } : {}),
      };
      if (options.scale && !(options.scale[0]! > 0 && options.scale[1]! > 0)) throw new AgentError('a scale is two positive whole numbers, 「1:2」');
      const r = await d.create(options);
      return answer(d, { created: true, plan: r.plan }, a.picture ?? true);
    }
    case 'drawing_inspect':
      parse('drawing_inspect');
      return { content: [{ type: 'text', text: JSON.stringify(d.inspect(), null, 1) }] };
    case 'drawing_tolerance': {
      const a = parse('drawing_tolerance');
      const id = d.setTolerance(a.dimension, a.tolerance, { ...(a.reference !== undefined ? { reference: a.reference } : {}), ...(a.precision !== undefined ? { precision: a.precision } : {}) });
      await d.save();
      return answer(d, { changed: id }, a.picture ?? true);
    }
    case 'drawing_annotate': {
      const { picture: pic, ...a } = parse('drawing_annotate');
      const id = d.annotate(a as AnnotateInput);
      await d.save();
      return answer(d, { added: id }, pic ?? true);
    }
    case 'drawing_complete': {
      const a = parse('drawing_complete');
      const n = d.complete();
      await d.save();
      return answer(d, { added: n }, a.picture ?? true);
    }
    case 'drawing_text_size': {
      const { picture: pic, ...a } = parse('drawing_text_size');
      const changed = d.textSize({ ...(a.all !== undefined ? { all: a.all } : {}), ...(a.reset ? { reset: true } : {}), ...(a.item !== undefined ? { item: a.item } : {}), ...(a.size !== undefined ? { size: a.size } : {}) });
      await d.save();
      return answer(d, { changed }, pic ?? true);
    }
    case 'drawing_apply': {
      const a = parse('drawing_apply');
      d.apply(a.commands as unknown as DrawingCommand[], a.pageIndex ?? 0);
      await d.save();
      return answer(d, { applied: a.commands.length }, a.picture ?? true);
    }
    case 'drawing_undo': {
      const a = parse('drawing_undo');
      d.undo();
      await d.save();
      return answer(d, { undone: true }, a.picture ?? true);
    }
    case 'drawing_picture': {
      const a = parse('drawing_picture');
      const p = await d.picture({ ...(a.view ? { view: a.view } : {}), ...(a.px ? { px: a.px } : {}), ...(a.pageIndex !== undefined ? { pageIndex: a.pageIndex } : {}) });
      return { content: [png(p.png), { type: 'text', text: JSON.stringify({ width: p.width, height: p.height, ...(p.font ? {} : { note: 'no TrueType font was found: texts are drawn as their boxes (set DRAWING_FONT to a .ttf)' }) }) }] };
    }
    case 'drawing_save': {
      const a = parse('drawing_save');
      return { content: [{ type: 'text', text: JSON.stringify(await d.save(a.path)) }] };
    }
    case 'drawing_export': {
      const a = parse('drawing_export');
      return { content: [{ type: 'text', text: JSON.stringify(await d.export(a.path, a.format, a.release ? { release: true } : undefined)) }] };
    }
    case 'drawing_open': {
      const a = parse('drawing_open');
      await d.open(a.path);
      return answer(d, { opened: true });
    }
  }
  throw new AgentError(`no tool ${name}`);
}
