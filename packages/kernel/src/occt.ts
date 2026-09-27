import init, { type OpenCascadeInstance, type TopoDS_Shape } from 'replicad-opencascadejs';

export type OC = OpenCascadeInstance;

export interface LoadOptions {
  /** URL of replicad_single.wasm (browser builds pass the bundler URL; Node resolves it itself). */
  wasmUrl?: string;
}

export async function loadOcct(options: LoadOptions = {}): Promise<OC> {
  const quiet = () => {};
  return init({
    print: quiet,
    printErr: quiet,
    ...(options.wasmUrl ? { locateFile: () => options.wasmUrl } : {}),
  });
}

/** Owns temporary WASM objects and deletes them together (embind objects are not garbage collected). */
export class Arena {
  private items: { delete(): void }[] = [];

  own<T extends { delete(): void }>(obj: T): T {
    this.items.push(obj);
    return obj;
  }

  dispose(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      try {
        this.items[i]!.delete();
      } catch {
        // already deleted
      }
    }
    this.items = [];
  }
}

const HASH_BOUND = 2147483647;

/**
 * Indexed set of sub-shapes with TopTools_ShapeMapHasher semantics (same TShape and location,
 * orientation ignored). Substitutes NCollection_IndexedMap, which this WASM build cannot construct.
 */
export class ShapeIndex {
  readonly keys: TopoDS_Shape[] = [];
  private buckets = new Map<number, number[]>();

  constructor(private readonly oc: OC) {}

  static of(oc: OC, shape: TopoDS_Shape, type: string, arena: Arena): ShapeIndex {
    const index = new ShapeIndex(oc);
    const ex = arena.own(new oc.TopExp_Explorer(shape, type as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    for (; ex.More(); ex.Next()) {
      const s = ex.Current();
      if (index.indexOf(s) < 0) index.push(s);
      else s.delete();
    }
    return index;
  }

  private hash(s: TopoDS_Shape): number {
    return this.oc.ReplicadShapeHasher.HashCode(s, HASH_BOUND);
  }

  private push(s: TopoDS_Shape): void {
    const h = this.hash(s);
    this.keys.push(s);
    const bucket = this.buckets.get(h);
    if (bucket) bucket.push(this.keys.length - 1);
    else this.buckets.set(h, [this.keys.length - 1]);
  }

  /** 0-based index, or -1 when absent. */
  indexOf(s: TopoDS_Shape): number {
    for (const i of this.buckets.get(this.hash(s)) ?? []) if (this.keys[i]!.IsSame(s)) return i;
    return -1;
  }

  get size(): number {
    return this.keys.length;
  }

  hashAt(i: number): number {
    return this.hash(this.keys[i]!);
  }

  dispose(): void {
    for (const k of this.keys) k.delete();
    this.keys.length = 0;
    this.buckets.clear();
  }
}
