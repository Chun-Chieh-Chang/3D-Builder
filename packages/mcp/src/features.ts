import { z } from 'zod';
import type { Command, Feature, Ref, SketchEntity, PartDoc } from '@3db/model';

// mm budget for the public numeric adapter; native expression commands remain separately available.
const positive = z.number().finite().positive().max(100000);
const id = z.string().min(1).max(128);
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const ref = z.strictObject({ kind: z.enum(['edge', 'face', 'body', 'datum', 'vertex', 'sketch']), name: z.string().min(1), fingerprint: z.strictObject({ type: z.string(), size: z.number().finite(), center: vector, dir: vector.optional() }).optional() });
const edgeRef = ref.extend({ kind: z.literal('edge') });
const bodyRef = ref.extend({ kind: z.literal('body') });
const base = { id, name: id.optional() };
export const featureSchema = z.union([
  z.strictObject({ ...base, operation: z.literal('create_primitive'), shape: z.literal('box'), width: positive, depth: positive, height: positive }),
  z.strictObject({ ...base, operation: z.literal('create_primitive'), shape: z.literal('cylinder'), radius: positive, height: positive }),
  z.strictObject({ ...base, operation: z.literal('extrude'), sketch: id, depth: positive, mode: z.enum(['boss', 'cut']).default('boss'), reverse: z.boolean().default(false) }),
  z.strictObject({ ...base, operation: z.literal('fillet'), edges: z.array(edgeRef).min(1), radius: positive }),
  z.strictObject({ ...base, operation: z.literal('chamfer'), edges: z.array(edgeRef).min(1), distance: positive }),
  z.strictObject({ ...base, operation: z.literal('hole'), sketch: id, diameter: positive, depth: positive.optional(), reverse: z.boolean().default(false) }),
  z.strictObject({ ...base, operation: z.literal('boolean'), mode: z.enum(['add', 'subtract', 'common']), main: bodyRef, tools: z.array(bodyRef).min(1) }),
  z.strictObject({ ...base, operation: z.literal('pattern'), seeds: z.array(id).min(1), direction: ref, count: z.number().int().min(2).max(200), spacing: positive }),
]);
export const executeSchema = z.strictObject({
  feature: featureSchema,
  repair: z.strictObject({ maxAttempts: z.number().int().min(1).max(8), factor: z.number().positive().lt(1), minValue: positive }).optional(),
});
export type CadFeature = z.infer<typeof featureSchema>;

export function featureCommands(session: { doc: PartDoc }, input: CadFeature): Command[] {
  const f = featureSchema.parse(input);
  const features: Feature[] = [];
  const common = { id: f.id, name: f.name ?? f.id, suppressed: false };
  if (session.doc.features.some((old) => old.id === f.id || old.id === `${f.id}:profile`)) throw new Error(`feature ID already exists: ${f.id}`);
  switch (f.operation) {
    case 'create_primitive': {
      const entities: SketchEntity[] = f.shape === 'cylinder'
        ? [{ id: 'c', type: 'point', x: 0, y: 0 }, { id: 'circle', type: 'circle', center: 'c', radius: f.radius }]
        : [
          ...[[-f.width / 2, -f.depth / 2], [f.width / 2, -f.depth / 2], [f.width / 2, f.depth / 2], [-f.width / 2, f.depth / 2]].map(([x, y], i) => ({ id: `p${i}`, type: 'point' as const, x: x!, y: y! })),
          ...[0, 1, 2, 3].map((i) => ({ id: `l${i}`, type: 'line' as const, p1: `p${i}`, p2: `p${(i + 1) % 4}` })),
        ];
      features.push({ ...common, id: `${f.id}:profile`, type: 'sketch', plane: { kind: 'datum', name: 'plane:top' }, entities, constraints: entities.filter((e) => e.type === 'point' || e.type === 'circle').map((e) => e.type === 'point' ? { id: `fix:${e.id}`, type: 'fix', point: e.id } : { id: `radius:${e.id}`, type: 'radius', circle: e.id, value: String(e.radius) }) });
      features.push({ ...common, type: 'extrude', sketch: `${f.id}:profile`, op: 'boss', merge: false, dir1: { type: 'blind', depth: String(f.height) } });
      break;
    }
    case 'extrude': features.push({ ...common, type: 'extrude', sketch: f.sketch, op: f.mode, dir1: { type: 'blind', depth: String(f.depth), reverse: f.reverse } }); break;
    case 'fillet': features.push({ ...common, type: 'fillet', edges: f.edges as Ref[], radius: String(f.radius) }); break;
    case 'chamfer': features.push({ ...common, type: 'chamfer', edges: f.edges as Ref[], mode: 'distanceDistance', distance: String(f.distance), second: String(f.distance) }); break;
    case 'hole': features.push({ ...common, type: 'hole', sketch: f.sketch, kind: 'straight', diameter: String(f.diameter), end: f.depth === undefined ? { type: 'throughAll' } : { type: 'blind', depth: String(f.depth) }, reverse: f.reverse }); break;
    case 'boolean': features.push({ ...common, type: 'combine', op: f.mode, main: f.main as Ref, tools: f.tools as Ref[] }); break;
    case 'pattern': features.push({ ...common, type: 'pattern', seeds: f.seeds, def: { mode: 'linear', dir1: { ref: f.direction as Ref, count: String(f.count), spacing: String(f.spacing) } } }); break;
  }
  return features.map((feature, i) => ({ type: 'insertFeature', index: session.doc.features.length + i, feature }));
}
