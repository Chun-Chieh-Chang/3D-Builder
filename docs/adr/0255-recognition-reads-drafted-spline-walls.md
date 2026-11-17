# ADR 0255: Recognition reads drafted spline walls, and rounds whose support is one

## Context

ADR 0251 let the kernel draft an extrusion whose outline has splines. Recognition could not read such a part back. A drafted spline wall is a ruled B-spline with no simple surface, and it blocked every extrusion direction. A round along it was not recognized either, because a freeform face was never offered as a round's support.

The user chose on 2026-11-14 to make the general capability first, verified on generated parts: drafted spline walls on the main extrusion, and rounds whose support is a spline wall. part-3's drafted walls take another path (Delete Face, which does not return on part-3, design doc §6l) and are not part of this ADR.

## Decision

### Reading a drafted wall (kernel)

- `faceDraftedAlong(shape, face, d, tol)` reads a face as a wall drafted along `d`. The face must be a B-spline surface ruled one way, with both rails flat on planes square to `d` at different heights. Every point of the surface (9 × 9 samples) must be where the exact draft of its first rail puts it, to within `tol`. It returns the lean, signed as a plane's in recognition, and the deviation measured.
- The rails are taken at the surface's own bounds, not the face's. On a wall trimmed by what it meets (a plate, a round along its foot), the isos at the face's bounds are blends of the two rails some way up the wall (measured: 1.14 mm up, 4.2e-4 off any cubic).
- A section through a drafted wall reads its curve exactly at any height (`draftedSectionCurve`).
  - The curve on a plane is the nearer rail, offset in the plane by k·h (`Geom_OffsetCurve`).
  - Only the stretch between the section piece's two ends is approximated: the whole rail runs on past the wall's corners into its extensions, where the curvature jumps.
  - Each end of the stretch within 1e-7 of the range from a knot of the rail is put on that knot. A corner lands within ~1e-9 of the knot where the curve turns into its extension, and a sliver past it brought the jump into the stretch.
  - On a rail's own plane (the bottom of the layer, where the sketch goes) the curve is rebuilt exactly: each span of the rail between its knots as a cubic Hermite span, then every knot it does not need removed to 1e-9. A wall this program drafted carries the drawn curve there, raised in degree. Rebuilt so, it is the drawn Catmull-Rom curve again, within 1e-12, degree 3 with a few poles.
  - Elsewhere: C2 interpolation through points of the stretch, else C0 approximation. Each is measured, not trusted: the approximations' reported errors are off both ways (3.8e-6 reported, 5.3e-10 measured; 1.1e-6 reported, 7.3e-3 measured).
- `wallCurveBetween(shape, frame, a, b, mid, midTol)` gives a wall's exact curve on a plane between two corners.

### The drafted wall itself (kernel, ADR 0251's construction changed)

The far rail of a curve wall was approximated to 1e-9 at degree 14. That approximation chased the curvature jump where the profile curve turns into its extension at a corner. It crowded ~20 knots there, halving down to 0 (multiplicity 13 each). Two things failed on such walls:
- OCCT's fillet along the wall's foot built on 17 of 39 random parts.
- No stretch of a section across that join could be approximated again.

The far curve is now approximated C1, degree at most 5, to 1e-8, taken when within 1e-7. The knots it does not need are left in: removing them moves its parameter, which skews the rulings and put the corners 1e-5 off. Results:
- The foot round builds on 37 of 39 parts.
- The wall is within ~1e-8 of the exact draft.
- Its corners are where they were (section ends within 1e-9 of the exact curve).

Fallbacks: degree 14 to 1e-9 when within 1e-6, then C0 to 1e-8 in 400 segments. At 1e-9 in 200 segments C0 came out ~0.06 off.

### Recognition (`analyze.ts`)

- A free wall is a straight one (lean 0, as before) or a drafted one (`faceDraftedAlong` to 1e-6, lean ≤ `MAX_DRAFT`). It counts toward the layer's uniform lean.
- `extrapolate` carries a drafted layer's spline pieces to its bottom.
  - The bottom curve is read off the wall there (`wallCurveBetween`), through the stretch near the near section's own middle. A lerp of the two sections' middles is not on the wall: they are at different places along it, 0.33 mm apart on a wavy spline.
  - Its ends, and its neighbours' with them, are put on the nearest body vertex on the bottom plane, no farther than the step. A corner between a plane and a curved drafted wall does not move on a straight line: 5e-4 mm off for a 3° draft 10 mm high.
- A drafted layer's two sections are placed inside the band no kept face reaches into. A round left in the body at its foot was cut at a quarter of the height and could not be read.
- A drafted layer split into pieces (`mixedLayer`) passes each piece's topology for the corners.
- Cap heights are grouped to 1e-7 after rounding and `+ 0`. `(-1.5e-33).toFixed(7)` is `"-0.0000000"`, another key than `"0.0000000"`. Two caps at one height made a layer of no height, whose section was cut through a plate's top. This was latent before this ADR; a drafted hole beside free rounds brought it out.
- A free round's supports may be freeform faces. A spline wall rounded along two edges is tangent to both rounds, so it was among the round candidates itself and taking those out of the supports left both rounds with none. A face found to be a round is still no support: a round that took one is asked again without them.

A section piece's ends are matched to a drafted wall's curve to 1e-7, as to a straight one's. With the walls as above the corners are within ~1e-9 of the exact walls. With the old heavy walls they were 9.4e-7 off, and a looser match was needed; it was taken out with them, as no part needs it now (its mutation survived).

## Measurements

| Case | Measured |
|---|---|
| `faceDraftedAlong` on walls drafted 1.5°, −3°, 8°, −0.5°, before and after STEP | lean to 1e-9 rad of the angle; deviation < 1e-7; plane walls and caps, straight spline walls, a ruled loft whose lean varies, other directions: null |
| Section of a drafted wall at four heights | one NURBS piece, each point on the wall to 1e-7 |
| Walls fuzz, 120 seeds through STEP (narrowing and widening, plate or not, 30% holes) | 115 made, 115 rebuilt, draft to 1e-9° |
| Rounds fuzz, 100 seeds (foot round, half with a top round, 37% holes) | 92 made, 92 rebuilt, radii within 1e-3·r |
| Foot round on the ADR 0251 boss, 39 random parts | 17 built (degree-14 far rail), 37 (degree 5, 1e-8) |
| OCCT round at the foot, the same part nudged | a spline point moved 1e-9 or 1e-7, or the angle 0.1°: builds or fails |
| Heap, 6 recognitions in a fresh heap | +422.7 MiB, `liveShapes` unchanged; straight control +56.4 MiB |
| Real parts (35, `scratch/ff/audit-0255.jsonl`) | 30 rebuilt, unchanged, 0 regressions; part-3 refused with 16 freeform faces left (30 before); part-3 and part-4 (both refused) slower, 3.4 s → 17.1 s and 14.8 s, rolling-ball calls 25 → 231 and 66 → 174 |

The kernel's exact rolling ball has not been seen to take on these walls (outcome `invalid`), so OCCT's round is kept: a ball only to 2e-5 to 1e-3 of its radius (C2). The rounds are therefore checked as solids (the comparison, ADR 0248) and their radii to 1e-3·r.

Mutations (`scratch/ff/mutate-drafted-recognition.mjs`): see DEV_LOG.

## Consequences

- ADR 0251's walls change: within ~1e-8 of the exact draft instead of ~1e-9, inside its 1e-7 test bound and the user's 1e-4. Its tests compare a two-region extrusion solid by solid, as the integral over the compound as a whole is off 1.07e-4 from its solids'.
- The heap growth per recognition is the section's OCCT Boolean with B-spline walls (the same with `sectionEdges`), the §3.5 kind, bounded by ADR 0126.
- Offering freeform faces as round supports makes refused parts with many freeform faces slower (above); offering only those read as walls would cut it, not done here.
- Recognizing part-3's drafted walls, which are not on the main extrusion, still needs a path without Delete Face (design doc §6l, §6m).
