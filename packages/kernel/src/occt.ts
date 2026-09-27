import { createInstance, type OpenCascadeInstance, type TopoDS_Shape } from 'libcascade/single/init';

export type OC = OpenCascadeInstance;

export interface LoadOptions {
  /** URL of the libcascade single-threaded WASM (browser builds pass the bundler URL; Node resolves it itself). */
  wasmUrl?: string;
}

export async function loadOcct(options: LoadOptions = {}): Promise<OC> {
  const quiet = () => {};
  return createInstance({
    print: quiet,
    printErr: quiet,
    ...(options.wasmUrl ? { locateFile: () => options.wasmUrl! } : {}),
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

/**
 * Indexed set of sub-shapes (TopExp::MapShapes into TopTools_IndexedMapOfShape): first-occurrence
 * explorer order, identity by TShape + location with orientation ignored.
 */
export class ShapeIndex {
  readonly keys: TopoDS_Shape[] = [];

  private constructor(private readonly map: InstanceType<OC['NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher']>) {}

  static of(oc: OC, shape: TopoDS_Shape, type: string, arena: Arena): ShapeIndex {
    const map = arena.own(new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher());
    oc.TopExp.MapShapes(shape, type as never, map);
    const index = new ShapeIndex(map);
    for (let i = 1; i <= map.Extent(); i++) index.keys.push(map.FindKey(i));
    return index;
  }

  /** 0-based index, or -1 when absent. */
  indexOf(s: TopoDS_Shape): number {
    return this.map.FindIndex(s) - 1;
  }

  get size(): number {
    return this.keys.length;
  }

  dispose(): void {
    for (const k of this.keys) k.delete();
    this.keys.length = 0;
  }
}
