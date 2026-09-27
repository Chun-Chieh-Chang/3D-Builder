import { produce, type Draft } from 'immer';
import type { Id } from './ids';
import type { EndCondition, Expr, Feature, PartDoc, Ref } from './schema';
import { isDimension } from './schema';
import { evalAngle, evalLength, ExprError } from './expr';

/**
 * Document commands (B7.1): the only way to change the SSOT.
 * UI, scripts, macro recording and future collaboration all go through this layer.
 */
export type Command =
  | { type: 'setDimension'; featureId: Id; constraintId: Id; value: Expr }
  | { type: 'setEndCondition'; featureId: Id; dir: 'dir1' | 'dir2'; value: EndCondition }
  | { type: 'setFilletRadius'; featureId: Id; value: Expr }
  | { type: 'setFilletEdges'; featureId: Id; edges: Ref[] }
  | { type: 'setSuppressed'; featureId: Id; value: boolean }
  | { type: 'renameFeature'; featureId: Id; name: string }
  | { type: 'setRollback'; index: number | null };

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

function feature(draft: Draft<PartDoc>, id: Id): Draft<Feature> {
  const f = draft.features.find((x) => x.id === id);
  if (!f) throw new CommandError(`找不到特徵：${id}`);
  return f;
}

function positiveLength(value: Expr): void {
  let v: number;
  try {
    v = evalLength(value);
  } catch (e) {
    throw new CommandError(e instanceof ExprError ? e.message : String(e));
  }
  if (!(v > 0)) throw new CommandError(`數值必須大於 0：「${value}」`);
}

/** Immer recipe: mutates the draft or throws CommandError (the document is then left untouched). */
export function mutate(draft: Draft<PartDoc>, cmd: Command): void {
  switch (cmd.type) {
    case 'setDimension': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'sketch') throw new CommandError('只有草圖有尺寸');
      const c = f.constraints.find((x) => x.id === cmd.constraintId);
      if (!c || !isDimension(c)) throw new CommandError(`找不到尺寸：${cmd.constraintId}`);
      if (c.type === 'angle') {
        try {
          evalAngle(cmd.value);
        } catch (e) {
          throw new CommandError(e instanceof ExprError ? e.message : String(e));
        }
      } else {
        positiveLength(cmd.value);
      }
      c.value = cmd.value;
      return;
    }
    case 'setEndCondition': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'extrude') throw new CommandError('只有伸長特徵有終止型態');
      if ('depth' in cmd.value) positiveLength(cmd.value.depth);
      f[cmd.dir] = cmd.value;
      return;
    }
    case 'setFilletRadius': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet') throw new CommandError('只有圓角特徵有半徑');
      positiveLength(cmd.value);
      f.radius = cmd.value;
      return;
    }
    case 'setFilletEdges': {
      const f = feature(draft, cmd.featureId);
      if (f.type !== 'fillet') throw new CommandError('只有圓角特徵可選邊線');
      if (cmd.edges.some((r) => r.kind !== 'edge')) throw new CommandError('圓角只能選邊線');
      f.edges = cmd.edges;
      return;
    }
    case 'setSuppressed': {
      feature(draft, cmd.featureId).suppressed = cmd.value;
      return;
    }
    case 'renameFeature': {
      const name = cmd.name.trim();
      if (!name) throw new CommandError('名稱不可空白');
      feature(draft, cmd.featureId).name = name;
      return;
    }
    case 'setRollback': {
      const n = draft.features.length;
      if (cmd.index !== null && (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index > n)) {
        throw new CommandError(`回溯位置超出範圍：${cmd.index}`);
      }
      draft.rollbackIndex = cmd.index === n ? null : cmd.index;
      return;
    }
  }
}

/** Pure command application: returns a new document, the input is never modified. */
export function applyCommand(doc: PartDoc, cmd: Command): PartDoc {
  return produce(doc, (d) => mutate(d, cmd));
}
