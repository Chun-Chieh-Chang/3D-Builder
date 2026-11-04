/**
 * Fuzz (AGENTS.md §3.4, ADR 0237): 200 random batches through the tools, in their own file so that they have a heap of their own (§3.5). Valid plates
 * must build to the volume worked out by hand; corrupt ones (negative, zero, NaN, words, missing fields, unknown commands, edges that do not exist)
 * must be refused with the part left empty. No call may throw, and every kind of batch must turn up and end as expected at least once: a fuzz that
 * tolerates failure would otherwise let a broken kind pass unseen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';

type Kind = 'plate' | 'plateHole' | 'plateFillet' | 'negative' | 'zero' | 'nan' | 'word' | 'missing' | 'unknownType' | 'noSuchEdge';
const VALID: Kind[] = ['plate', 'plateHole', 'plateFillet'];
const KINDS: Kind[] = [...VALID, 'negative', 'zero', 'nan', 'word', 'missing', 'unknownType', 'noSuchEdge'];

let seed = 20261104;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) * 100) / 100;

function rectangle(w: number, h: number, depth: string) {
  return [
    {
      type: 'insertFeature',
      index: 0,
      feature: {
        id: 's1', type: 'sketch', name: 's1', suppressed: false, plane: { kind: 'datum', name: 'plane:top' },
        entities: [
          { id: 'p0', type: 'point', x: 0, y: 0 }, { id: 'p1', type: 'point', x: w, y: 0 }, { id: 'p2', type: 'point', x: w, y: h }, { id: 'p3', type: 'point', x: 0, y: h },
          { id: 'l0', type: 'line', p1: 'p0', p2: 'p1' }, { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'l2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'l3', type: 'line', p1: 'p3', p2: 'p0' },
        ],
        constraints: [
          { id: 'h0', type: 'horizontal', a: 'l0' }, { id: 'v1', type: 'vertical', a: 'l1' }, { id: 'h2', type: 'horizontal', a: 'l2' }, { id: 'v3', type: 'vertical', a: 'l3' },
          { id: 'w', type: 'distance', a: 'l0', value: String(w) }, { id: 'd', type: 'distance', a: 'l1', value: String(h) }, { id: 'o', type: 'coincident', a: 'p0', b: '@origin' },
        ],
      },
    },
    { type: 'insertFeature', index: 1, feature: { id: 'e1', type: 'extrude', name: 'e1', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth } } },
  ];
}

function hole(cx: number, cy: number, r: number) {
  return [
    {
      type: 'insertFeature', index: 2,
      feature: {
        id: 's2', type: 'sketch', name: 's2', suppressed: false, plane: { kind: 'datum', name: 'plane:top' },
        entities: [{ id: 'hc', type: 'point', x: cx, y: cy }, { id: 'c', type: 'circle', center: 'hc', radius: r }],
        constraints: [{ id: 'r', type: 'radius', circle: 'c', value: String(r) }, { id: 'hx', type: 'distanceX', a: '@origin', b: 'hc', value: String(cx) }, { id: 'hy', type: 'distanceY', a: '@origin', b: 'hc', value: String(cy) }],
      },
    },
    { type: 'insertFeature', index: 3, feature: { id: 'c1', type: 'extrude', name: 'c1', suppressed: false, sketch: 's2', op: 'cut', dir1: { type: 'throughAll', reverse: true } } },
  ];
}

/** A batch of the kind, and the volume it must give (null: it must be refused). */
function batch(kind: Kind): { commands: unknown[]; volume: number | null } {
  const w = between(5, 120);
  const h = between(5, 120);
  const d = between(0.5, 40);
  switch (kind) {
    case 'plate':
      return { commands: rectangle(w, h, String(d)), volume: w * h * d };
    case 'plateHole': {
      const r = between(0.5, Math.min(w, h) / 2 - 1.5);
      return { commands: [...rectangle(w, h, String(d)), ...hole(w / 2, h / 2, r)], volume: w * h * d - Math.PI * r * r * d };
    }
    case 'plateFillet': {
      // a round on the four upright edges, smaller than half of every side; each takes away (r² − πr²/4)·d
      const r = between(0.2, Math.min(w, h) / 2 - 0.5);
      const edges = ['{e1:side:s1.l0|e1:side:s1.l1}', '{e1:side:s1.l1|e1:side:s1.l2}', '{e1:side:s1.l2|e1:side:s1.l3}', '{e1:side:s1.l0|e1:side:s1.l3}'].map((name) => ({ kind: 'edge', name }));
      return { commands: [...rectangle(w, h, String(d)), { type: 'insertFeature', index: 2, feature: { id: 'f1', type: 'fillet', name: 'f1', suppressed: false, edges, radius: String(r) } }], volume: w * h * d - 4 * (r * r - (Math.PI * r * r) / 4) * d };
    }
    case 'negative':
      return { commands: rectangle(w, h, String(-d)), volume: null };
    case 'zero':
      return { commands: rectangle(w, h, '0'), volume: null };
    case 'nan':
      return { commands: rectangle(w, h, 'NaN'), volume: null };
    case 'word':
      return { commands: rectangle(w, h, 'deep'), volume: null };
    case 'missing': {
      const c = rectangle(w, h, String(d));
      delete (c[1] as { feature: { sketch?: string } }).feature.sketch;
      return { commands: c, volume: null };
    }
    case 'unknownType':
      return { commands: [...rectangle(w, h, String(d)), { type: ['explode', 'deleteAll', 'eval'][Math.floor(rand() * 3)] }], volume: null };
    case 'noSuchEdge':
      return { commands: [...rectangle(w, h, String(d)), { type: 'insertFeature', index: 2, feature: { id: 'f1', type: 'fillet', name: 'f1', suppressed: false, edges: [{ kind: 'edge', name: '{e1:side:s1.l9|e1:cap:end}' }], radius: '1' } }], volume: null };
  }
}

let s: CadSession;
let root: string;
let heap0: number;
let shapes0: number;
const seen = new Map<Kind, number>();
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), '3db-fuzz-'));
  s = await CadSession.create({ root });
  heap0 = s.heapBytes()!;
  shapes0 = s.liveShapes();
});
afterAll(() => {
  s.dispose();
  rmSync(root, { recursive: true, force: true });
});

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;

describe('200 random batches', () => {
  it('has a heap to measure (AGENTS.md §3.1)', () => {
    expect(heap0).toBeGreaterThan(0);
  });

  for (let group = 0; group < 4; group++) {
    it(`group ${group + 1} of 4: 50 batches end as they must`, async () => {
      for (let i = 0; i < 50; i++) {
        const kind = KINDS[Math.floor(rand() * KINDS.length)]!;
        const { commands, volume } = batch(kind);
        await callTool(s, 'part_new', {});
        const r = await callTool(s, 'apply_commands', { commands });
        const what = `${kind}: ${text(r).slice(0, 400)}`;
        const summary = JSON.parse(text(await callTool(s, 'part_summary', {})));
        if (volume === null) {
          expect(r.isError, what).toBe(true);
          expect(summary.features, what).toEqual([]);
        } else {
          expect(r.isError, what).toBeFalsy();
          expect(summary.features.every((f: { status: string }) => f.status === 'ok'), what).toBe(true);
          expect(summary.mass.volume / volume, what).toBeCloseTo(1, 6);
        }
        seen.set(kind, (seen.get(kind) ?? 0) + 1);
      }
    });
  }

  it('saw every kind, gave back every shape, and says how much the heap grew', async () => {
    for (const k of KINDS) expect(seen.get(k) ?? 0, `kind ${k} never came up`).toBeGreaterThan(0);
    await callTool(s, 'part_new', {});
    expect(s.liveShapes()).toBe(shapes0);
    // printed, not asserted to be 0: OCCT's booleans keep heap (AGENTS.md §3.5); the session reloads the kernel past its limit (ADR 0126)
    console.log(`fuzz heap: ${(heap0 / 2 ** 20).toFixed(1)} → ${((s.heapBytes() ?? 0) / 2 ** 20).toFixed(1)} MiB, kernel reloads ${s.restarts}, kinds ${JSON.stringify(Object.fromEntries(seen))}`);
  });
});
