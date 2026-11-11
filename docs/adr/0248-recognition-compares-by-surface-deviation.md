# ADR 0248 — Recognition compares a rebuild by surface deviation, not by a boolean

## Context

Feature recognition accepts a rebuild only when it is the same solid as the import: volume, area and the volume between the two, each within `RECOGNIZE_TOLERANCE = 1e-6` (relative). Since C1 the volume between them came from one `BOPAlgo_CellsBuilder` intersection of the two solids (`Kernel.differenceVolumes`).

C2.8–C2.10 (rounds on freeform faces, read as rolling balls without being taken off) made recognition rebuild solids that are near-equal to the import with B-spline faces on both sides: an imported round, and the exact rolling-ball round that rebuilt it. On such pairs the boolean:

- **trapped** (`RuntimeError: memory access out of bounds`, fuzz seed 26, on a fresh 286 MiB heap);
- **ran for minutes** (seed 10: still inside the boolean after 400 s);
- **could not see a 2e-6 mm difference**: it answered exactly 0 for an OCCT round against an exact round of the same edge, whose boundaries are up to 1.99e-6 mm apart (seed 2), in 8.4 s;
- kept about 120 MiB of heap per rebuilt case (AGENTS §3.5).

The user decided to remove the dependence on the boolean rather than avoid the pairs (2026-11-11).

## Decision

The volume between the rebuild and the import is measured as each boundary's distance to the other, integrated over it, the larger of the two ways (`Kernel.surfaceDeviation`, `packages/kernel/src/surfaceDeviation.ts`):

  V(A △ B) ≈ ∫∂A d(p, ∂B) dA  (to first order in the distance)

- **Points.** Every face of A is sampled in its own parameters. Each triangle of the face's triangulation is read in (u, v), cut into k² pieces (k from 1 to 8, at least about 100 points a face), and a point is taken at each piece's middle. The point is on the exact surface. Its weight is |Su × Sv| times the piece's (u, v) area, the surface's own area element, not the mesh's.
- **Distance.** B's triangulation only chooses candidates. A bounding-volume tree finds every triangle within the nearest one's distance plus twice the mesh deflection. Per candidate face, Newton (Gauss–Newton on |S(u, v) − p|²) runs on the exact surface from the (u, v) of the nearest point of its nearest triangle. The foot counts when a `BRepClass_FaceClassifier` puts it inside the face (IN or ON). Otherwise the distance is to the face's edge curves (one projector per edge, reused) and their ends.
- **Both ways.** A face one solid has and the other lacks is seen only from the solid that has it: a 0.5 mm hole is 75.4 mm³ from the holed plate and 9e-14 from the plain one, because the hole's 0.2 mm² of top falls between the plain top's points. The comparison uses the larger way.
- `differenceVolumes` is removed; nothing else used it.

## Measurements

| Case | Known answer | Measured |
|---|---|---|
| Same solid, through STEP | 0 | 9.3e-14 mm³ |
| Box 40×30×12 moved 1e-3 / 1e-5 / 1e-7 | 2·b·c·δ | to 1e-12 / 1.6e-10 / 6.6e-9 relative; the last is arithmetic, about 1e-14 mm per distance at 40 mm from the origin |
| Cylinder r 5 grown by δ | from A 2πrh·δ, from B 2π(r+δ)h·δ | exact to 1e-9 |
| Half the top lowered by δ | 600·δ | to 1e-3; with a 5 mm mesh, where the untrimmed upper plane is a candidate over the lowered half, the classifier is what keeps it δ |
| Hole d 0.5 against none | ≥ 2.36 mm³ (the hole) | 75.4 one way, 9e-14 the other |
| OCCT vs exact round, seed 2 | boolean: 0 in 8.4 s | 2.44e-5 mm³ (1.5e-9 relative) in 0.8 s |
| Seeds 26 and 10 | boolean: trap / > 400 s | 0.9–1.5 s, no trap |

The first-order formula overestimates large differences: 75.4 against the hole's 2.36. The decision is only whether the result is ≥ 1e-6, so this errs toward refusing.

The (u, v) triangulation of a face with a curved boundary is an inscribed polygon. The sampled area is short by strips of about the mesh deflection (1e-4 of the area on a cylinder's end discs), which moves the integral by that fraction of itself, not by a fraction of the volume. A difference lying only inside such a strip and on no face of its own would be missed; a feature has faces, and every face is sampled.

**Heap.** On a fresh heap, 200 rounds in both directions on an exact/OCCT round pair took 128 → 318.6 MiB (flat for the first 80: the headroom of §3.5). That is about 0.48 MiB per one-way call. The STEP round-trip control grew +56 MiB in 60. Meshing alone was +25.6 MiB in 800; making the edge projectors was 0. The rest is in the per-point native calls (§3.5 class, ADR 0126's high-water restart). The boolean kept about 120 MiB per rebuilt case.

## Consequences

- Recognition fuzz of rounds on freeform faces, seeds 1–100 (`tests/phase8/recognize-rolling-ball-fuzz*.test.ts`), runs with no trap and no timeout. Every case is rebuilt as the same solid or refused whole.
- A rebuild the boolean wrongly called different now passes when it is the same to 1e-6. Seed 19, an OCCT round rebuilt as an exact round, is 1e-9 apart.
- Mutation controls: weights of 1, no classifier (caught only with the coarse mesh case) and no slack each turn `packages/kernel/test/surface-deviation.test.ts` red.
- `ReconstructReport.difference` keeps its meaning: the volume between the two, relative to the import's volume.
