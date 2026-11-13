# ADR 0251: Drafted extrusion of outlines with splines

## Context

A drafted extrusion went through `BRepOffsetAPI_DraftAngle`, which drafts planes and cylinders only. An outline with a spline or an ellipse made side faces of B-spline surfaces, and the draft failed. The C5 probe (design doc §6l) found that 4 of part-3's 6 freeform regions are a 1.5° drafted extrusion of a spline outline, so recognition cannot rebuild them until the kernel can make one.

The user chose on 2026-11-13 to make the kernel capability first, and accepted spline walls within 1e-4 mm of the exact draft, with plane and arc walls exact.

`BRepOffsetAPI_MakeDraft` was tried first, on the whole wire and then edge by edge. It traps inside `BRepFill_TrimShellCorner::Perform`, located by mapping the wasm byte offset to its function (`scratch/ff/wasm-map.mjs`). It trapped on joined curves, on re-approximated curves, with C0 joins, with smooth extensions and on a single line. It was dropped.

## Decision

`sweep` keeps `DraftAngle` when every side face is a plane or a cylinder (`sidesDraftable`), so outlines of lines and arcs are made as before. Otherwise `draftWires` builds each wall itself:

- **Line**: a plane through the edge, leaning `tan α` away from the material.
- **Arc or circle**: a cone about the circle's axis, with semi-angle `±α`.
- **Any other curve**: a ruled surface between the curve and its offset (`Geom_OffsetCurve` by `h·tan α`, moved up by `h`), approximated to 1e-9 (`GeomConvert_ApproxCurve`, refused if its error is over 1e-7). The offset of a curve along the draft direction is the exact drafted wall, so the wall is exact up to that approximation.
- Walls meeting at a corner are extended past it: a line along itself, an arc along its circle, a curve by its end tangents. Tangent joins are not extended.
- The walls and the start and end planes are split into cells by `BOPAlgo_MakerVolume`. The cells whose start face lies inside the profile are kept and fused.
- The faces keep the names of the plain extrusion (`profileEdge` of their source, `cap:start`, `cap:end`).

A draft that closes the outline before the far end is refused with `feature.draftCloses`, which says how far each side moves in. This is checked before any Boolean:
- For an arc, the cone apex is below the height.
- For a curve, its tightest bend toward the draft (400 samples of curvature) is within the inset.
- For an outline narrowing or a hole widening, the profile offset by the inset vanishes (`closes`).

A draft that is no angle (`±90°` or beyond, NaN, ±∞) is refused in `sweep` with `feature.draftInvalid`. Before, `draft ? … : …` read NaN and 0 alike as no draft.

## Measurements

| Case | Measured |
|---|---|
| Spline wall against the exact draft (each wall against its own source edge) | ≤ 8.4e-10 mm; plane walls < 1e-9 |
| Concave L with a hole, by splines against by lines (DraftAngle) | Volumes equal within 1e-12 relative |
| Collinear-spline box | Closed form |
| Closing: round hole r 2 at −12° refused, −10° made; arc r 1 at 6° refused, 5° made; square hole 3 mm at −9° refused, −8° made; 6 mm outline at 17° refused, 16° made | As stated |
| Fuzz, 120 seeds (`extrude-draft-spline-fuzz.test.ts`) | 105 made, 0 invalid, 0 crashes; 13 refused as closing, each justified by a hole radius or bend within the inset; 2 refused by the kernel |
| Heap, 40 drafts in a fresh heap | +254.4 MiB, `liveShapes` unchanged; straight control +0.0 |
| `BOPAlgo_MakerVolume` alone, 400 calls | B-spline walls 128 → 458.9 MiB; the same cells of planes 128 → 153.6 MiB |

Mutations (`scratch/ff/mutate-draft.mjs`), 10 of 10 red:
- every side drafted by DraftAngle
- a line wall, an arc wall or a curve wall leaning the wrong way
- an arc closing at its apex not refused
- a curve bending tighter than the inset not refused
- a closing hole not refused
- tangent joins extended as corners
- every cell kept
- a draft that is no angle let through

## Consequences

- The heap growth is OCCT's Boolean with B-spline operands (AGENTS §3.5), bounded by the worker's restart at 512 MiB (ADR 0126). It is printed, not asserted flat.
- Recognizing a drafted spline extrusion in an imported part (part-3's B regions) is the next step and is not in this ADR.
