import type { Id } from '@3db/model';
import type { Kernel, ShapeId, Topology } from '@3db/kernel';
import type { ElementNames } from '@3db/naming';

/**
 * A body plus its persistent names: the state that flows forward through the history (C7). Its `id` is the id of the
 * feature that made it; a body a boss merged into keeps the id it had, and the pieces a cut leaves are `<cut>#2`, `#3`.
 */
export interface BodyState {
  id: Id;
  shape: ShapeId;
  topology: Topology;
  names: ElementNames;
  /** Feature that produced this state. */
  by: Id;
}

/** Where one body's elements lie in the numbering of a view of all the bodies. */
export interface BodyPart {
  id: Id;
  face0: number;
  faces: number;
  edge0: number;
  edges: number;
  vertex0: number;
  vertices: number;
}

/**
 * All the bodies seen as one (C7): their faces, edges and vertices numbered one after the other, in the order of the
 * bodies, with the names they have. This is what picking, the assembly, mass and export see; with one body it is that
 * body. `shape` is a compound of the bodies when there are several.
 */
export interface BodyView extends BodyState {
  parts: BodyPart[];
}

type Kind = 'face' | 'edge' | 'vertex';

/** The bodies of the model at one point of the history, in order. */
export class Bodies {
  private composed: BodyView | null | undefined;
  /** The compound of a view of several bodies, which the view owns. */
  private compound: ShapeId | null = null;

  constructor(
    readonly list: readonly BodyState[],
    private readonly kernel: Kernel,
  ) {}

  /** The bodies seen as one; null when there are none. */
  get view(): BodyView | null {
    if (this.composed !== undefined) return this.composed;
    const list = this.list;
    if (list.length === 0) return (this.composed = null);
    const parts: BodyPart[] = [];
    let face0 = 0;
    let edge0 = 0;
    let vertex0 = 0;
    for (const b of list) {
      parts.push({ id: b.id, face0, faces: b.topology.faces.length, edge0, edges: b.topology.edges.length, vertex0, vertices: b.topology.vertices.length });
      face0 += b.topology.faces.length;
      edge0 += b.topology.edges.length;
      vertex0 += b.topology.vertices.length;
    }
    if (list.length === 1) return (this.composed = { ...list[0]!, parts });
    this.compound = this.kernel.join(list.map((b) => b.shape));
    const topology: Topology = { faces: [], edges: [], vertices: [] };
    const names: ElementNames = { faces: [], edges: [], vertices: [] };
    list.forEach((b, i) => {
      const p = parts[i]!;
      topology.faces.push(...b.topology.faces);
      topology.edges.push(...b.topology.edges.map((e) => ({ ...e, faces: e.faces.map((f) => f + p.face0), vertices: e.vertices.map((v) => v + p.vertex0) })));
      topology.vertices.push(...b.topology.vertices.map((v) => ({ ...v, faces: v.faces.map((f) => f + p.face0) })));
      names.faces.push(...b.names.faces);
      names.edges.push(...b.names.edges);
      names.vertices.push(...b.names.vertices);
    });
    return (this.composed = { id: list.map((b) => b.id).join('+'), shape: this.compound, topology, names, by: list[list.length - 1]!.by, parts });
  }

  /** Which body an element of the view belongs to, and its number in that body. */
  locate(kind: Kind, index: number): { body: BodyState; local: number } {
    const view = this.view!;
    const key = kind === 'face' ? 'face0' : kind === 'edge' ? 'edge0' : 'vertex0';
    const count = kind === 'face' ? 'faces' : kind === 'edge' ? 'edges' : 'vertices';
    const i = view.parts.findIndex((p) => index >= p[key] && index < p[key] + p[count]);
    if (i < 0) throw new Error(`${kind} ${index} is in no body`);
    return { body: this.list[i]!, local: index - view.parts[i]![key] };
  }

  /** The numbers of a body's elements in the view. */
  part(body: BodyState): BodyPart {
    return this.view!.parts[this.list.indexOf(body)]!;
  }

  /** Lets go of the view's compound (not of the bodies, which the rebuild owns); false when it has none. */
  release(): void {
    if (this.compound !== null) this.kernel.release(this.compound);
    this.compound = null;
    this.composed = undefined;
  }

  /** The compound the view made, for the rebuild to keep as part of its result (it is then not released with the view). */
  keep(): ShapeId | null {
    const c = this.compound;
    this.compound = null;
    return c;
  }
}
