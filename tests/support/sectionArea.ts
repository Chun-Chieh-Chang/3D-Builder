/** Helpers for reading a drawing's section back (Phase 5 and the 4b acceptance). */
export const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

/** The area of the regions bounded by the outlines of a cut: the outlines come edge by edge, so they are joined end to end into loops and measured (shoelace). */
export function areaOf(outlines: number[][]): number {
  const pieces = outlines.map((o) => [...o]);
  let area = 0;
  while (pieces.length > 0) {
    const loop = pieces.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i]!;
        const end = [loop[loop.length - 2]!, loop[loop.length - 1]!];
        const joinsAtStart = near(p[0]!, end[0]!, 1e-6) && near(p[1]!, end[1]!, 1e-6);
        const joinsAtEnd = near(p[p.length - 2]!, end[0]!, 1e-6) && near(p[p.length - 1]!, end[1]!, 1e-6);
        if (!joinsAtStart && !joinsAtEnd) continue;
        const q = joinsAtStart ? p : p.slice().reverse().flatMap((_, k, a) => (k % 2 === 0 ? [a[k + 1]!, a[k]!] : []));
        loop.push(...q.slice(2));
        pieces.splice(i, 1);
        grew = true;
        break;
      }
    }
    let s = 0;
    for (let i = 0; i + 3 < loop.length; i += 2) s += loop[i]! * loop[i + 3]! - loop[i + 2]! * loop[i + 1]!;
    area += Math.abs(s) / 2;
  }
  return area;
}

