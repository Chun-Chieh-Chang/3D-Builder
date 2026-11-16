import { t } from '@3db/i18n';
import type { TopoDS_Shape } from 'libcascade/single/init';
import { ShapeIndex, type Arena, type OC } from './occt';
import { KernelError } from './types';

/** Close the inner loops of the selected end faces, then follow the wall on the other side of each loop. */
export function cavityShell(oc: OC, shape: TopoDS_Shape, openings: readonly number[], arena: Arena): TopoDS_Shape {
  const faces = ShapeIndex.of(oc, shape, 'TopAbs_FACE', arena);
  const edges = ShapeIndex.of(oc, shape, 'TopAbs_EDGE', arena);
  try {
    const ends = new Set(openings);
    if (!ends.size) throw new KernelError(t('cavity.pick'));
    const faceEdges = faces.keys.map((face) => {
      const boundary = ShapeIndex.of(oc, face, 'TopAbs_EDGE', arena);
      try {
        return boundary.keys.map((edge) => edges.indexOf(edge));
      } finally {
        boundary.dispose();
      }
    });
    const neighbors = edges.keys.map(() => [] as number[]);
    faceEdges.forEach((boundary, i) => boundary.forEach((edge) => neighbors[edge]!.push(i)));

    const rims = new Set<number>();
    const seeds = new Set<number>();
    const builder = arena.own(new oc.BRep_Builder());
    const caps: TopoDS_Shape[] = [];
    for (const end of ends) {
      const selected = faces.keys[end];
      if (!selected) throw new KernelError(t('cavity.pick'));
      const face = arena.own(oc.TopoDS.Face(arena.own(selected.Oriented(oc.TopAbs_Orientation.TopAbs_FORWARD))));
      const surface = arena.own(new oc.BRepAdaptor_Surface(face, true));
      if (String(surface.GetType()) !== 'GeomAbs_Plane') throw new KernelError(t('cavity.pick'));
      const outer = arena.own(oc.BRepTools.OuterWire(face));
      const wires = ShapeIndex.of(oc, face, 'TopAbs_WIRE', arena);
      try {
        if (wires.size < 2) throw new KernelError(t('cavity.pick'));
        for (const loop of wires.keys) {
          if (loop.IsSame(outer)) continue;
          // Retain the end face's exact plane and the wire's existing p-curves on that plane.
          const cap = arena.own(face.EmptyCopied());
          builder.Add(cap, arena.own(loop.Reversed()));
          if (!arena.own(new oc.BRepCheck_Analyzer(cap, true, false, false)).IsValid()) throw new KernelError(t('cavity.invalid'));
          caps.push(arena.own(cap.Oriented(selected.Orientation())));
          const rim = ShapeIndex.of(oc, loop, 'TopAbs_EDGE', arena);
          try {
            for (const edge of rim.keys) {
              const index = edges.indexOf(edge);
              const adjacent = neighbors[index]!;
              if (rims.has(index) || adjacent.length !== 2) throw new KernelError(t('cavity.invalid'));
              rims.add(index);
              seeds.add(adjacent[0] === end ? adjacent[1]! : adjacent[0]!);
            }
          } finally {
            rim.dispose();
          }
        }
      } finally {
        wires.dispose();
      }
    }

    // The exterior is reachable if a missing cap lets this traversal reach the back of a selected end.
    const first = seeds.values().next().value;
    if (first === undefined) throw new KernelError(t('cavity.pick'));
    const walls = new Set<number>([first]);
    for (const wall of walls) {
      if (ends.has(wall)) throw new KernelError(t('cavity.open'));
      for (const edge of faceEdges[wall]!) {
        if (!rims.has(edge)) for (const adjacent of neighbors[edge]!) walls.add(adjacent);
      }
    }
    if ([...seeds].some((seed) => !walls.has(seed))) throw new KernelError(t('cavity.invalid'));
    const shell = arena.own(new oc.TopoDS_Shell());
    builder.MakeShell(shell);
    for (const wall of walls) builder.Add(shell, arena.own(faces.keys[wall]!.Reversed()));
    for (const cap of caps) builder.Add(shell, cap);
    const check = arena.own(new oc.BRepCheck_Shell(shell));
    if (check.Orientation() !== oc.BRepCheck_Status.BRepCheck_NoError) throw new KernelError(t('cavity.invalid'));
    shell.Closed(true);
    return shell;
  } finally {
    faces.dispose();
    edges.dispose();
  }
}
