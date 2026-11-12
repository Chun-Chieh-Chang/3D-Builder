# ADR 0250: Recognition reads spline faces as the simple surfaces they are

## Context

Feature recognition rebuilds an imported solid from planes, cylinders, cones, spheres and tori. A face that a file stores as a B-spline (or as a surface of revolution or extrusion) has none of those, so recognition treated it as freeform even when it is, to within the file's own precision, one of them.

The real assembly's part-4 (R1-9035, 295 faces) has 38 such faces. Measured with the new reader (design doc §6j):
- 20 are a torus or a cylinder to within 3.3e-7 mm: the exporting system wrote them as splines.
- 6 more are a cylinder or a torus within their own joint gap in the file (1.8e-5 to 2.1e-4 mm against gaps of 1.7e-4 to 6e-4, ADR 0249).
- part-3 (227 faces): 8 of 55 within 1e-6, 12 within their gaps.

A body converted face by face to B-splines (`Kernel.toBSpline`, exact for these surfaces) showed what else breaks once the faces are read as simple ones:
- Its sections are spline curves, not lines and arcs, so the sketch cannot be built ("the section has an unsupported curve").
- OCCT's usual volume of the spline body is 1.97e-6 off the truth for a disc of radius 15 (1.0e-8 integrated with eps 1e-10), so a correct rebuild failed the 1e-6 check on the original's figure.
- In a file whose faces meet only to a tolerance, the section's pieces, each read as its own simple curve, miss each other at the corners by that tolerance.

C4's probe (design doc §6j) also found that on a part with a round of no simple surface, every round is left in the body and its sharp edge read off where it is. For an analytic round, `analyticSharpOf` gives that edge in closed form only between two planes, or between a plane and a cylinder about its normal. A round on a drafted support (a torus between a plane and a cone) had none, so the part was refused with "no sharp edge for the round".

The user chose on 2026-11-12 to do these general capabilities first, ahead of the rest of part-4.

## Decision

### `Kernel.analyticFace(shape, face, tol)`

- OCCT proposes a surface (`GeomConvert_SurfToAnaSurf.ConvertToAnalytical(tol)`).
- The face's own surface is then evaluated at 13 × 13 points over its parameter range and measured against the proposed surface's equation. The measured deviation is reported, and a proposal farther than `tol` is refused.
- That refusal is a guard that has not been seen to fire. Over 732 questions (part-3, part-4, E13 and the moved discs, tolerances 1e-7 to 1e-2) OCCT proposed 308 surfaces, all within `tol` by this measurement. Its mutation (the comparison removed) therefore leaves every test green; it is kept because it is cheap and OCCT documents no bound on its gap.
- The axis, sizes and side (`convex`, a plane's outward normal) come from the same code as `topology` (`analyticGeometry`, split out of `faceInfo`), so a face read this way is described exactly as a face that has the surface.
- A plane's `origin` is the face's centre projected onto the plane. Before, it was the centre itself, which for a face only near a plane lies off it. Measuring against that point rejected 4 of the 308 (part-3 planes at 1.08 × tol) that OCCT's own plane fits. For a face that has a plane the two points are the same, to rounding.
- Null for a face that already has a simple surface, or that is none within `tol`. A tolerance that is not a positive finite length throws; it is not corrected.

### In recognition (`analyze.ts`)

- Before anything else, each face with no simple surface that is not nominated as a rolling-ball round is asked `analyticFace` with `max(ANALYTIC_FACE_TOLERANCE = 1e-6, τ_f)`, τ_f being the face's joint gap in the file (ADR 0249). Faces that answer are described as that surface in the topology recognition reads. The shape is not changed. Shapes made on the way (after Delete Face, the pieces of a composite) are read the same way.
- Sections, only when some face was read so:
  - A spline section piece that is a line, an arc or a full circle within twice the largest tolerance given is read as that. It is checked at 9 points per span, in order along it and going one way round. A degree-1 spline of two poles (a flat wall read exactly) is a line.
  - The loop chaining tolerance is raised to twice that tolerance.
  - Each corner between two lines or arcs that miss each other is moved to where their own curves cross, when that is within twice the tolerance of both ends.
- An analytic round with no closed-form sharp edge gets it from `Kernel.sharpEdge` (where its supports' surfaces meet), as a round of no simple surface does. Chamfers are unchanged.

### In the rebuild check (`reconstruct.ts`)

- When faces were read as simple surfaces, both volumes are integrated with eps 1e-10, so the check compares the bodies and not OCCT's integration rule.
- **Reading a face so is only a proposal, as a rolling-ball nomination is (ADR 0249).** An attempt refused with faces read so is asked once more with every face as the file has it, which is the behaviour before this ADR. If that is refused too, the first reason is reported. The set of parts accepted contains the set accepted before.
- Only an attempt that read some face so is asked again. An attempt that read none would repeat the same computation, and refusals are the slow cases: rolling-ball fuzz seed 46 takes 264 s at the previous HEAD against its 300 s limit.

## Measurements

| Case | Measured |
|---|---|
| Box, plate with a hole, plate with two holes and a boss, all faces B-splines | Rebuilt; volume within 1e-7 of closed form; refused with the reader switched off |
| Disc of B-spline faces | Rebuilt as one revolve; volume 1.0e-8 off πr²h |
| Disc whose surface weights are raised by δ (a sloppy file, the side 10·δ off its own edges), δ = 1e-6, 1e-5 | Rebuilt within the file's gaps, `fileTolerance` reported |
| Disc whose surface and edge weights are raised by δ (a consistent body that is no cylinder) | Never read as a cylinder at 1e-6; refused |
| `analyticFace` 20 000 calls, fresh heap | +0.0 MiB; control (`EvalD1`, same count of evaluations) +190.6 MiB |
| Fuzz, 120 random plates (60 exact, 30 sloppy, 30 off) | All exact and sloppy rebuilt; 21 of 30 off refused, 9 the same solid to 1e-6 |
| Fuzz, 100 tapered bosses on a spline boss (drafted round beside a free round) | 100 of 100 rebuilt, both radii to 1e-6 |
| Same part, sharp edge asked only for rounds of no simple surface (as before) | Refused, "no sharp edge for the round" |

Mutations (`scratch/ff/mutate-c41.mjs`), each red: no substitution; no fine volume; section spline pieces not read as lines and arcs; corners not healed; analytic round edges only in closed form. The deviation guard survives, as above.
| Real assembly | part-4 freeform faces 5 → 3; part-3 38 → 30; part-1 and part-2 unchanged |

## Consequences

- Two existing expectations change, both because parts that were refused are now rebuilt:
  - `feature-recognition.test.ts` "freeform faces" used a box converted to B-splines; it now uses a half-turned spline profile.
  - In `recognize-rolling-ball.test.ts`, an elliptical corner with e = 0 (a true round drawn as a spline) now comes back as a round of radius 2 on a sharp-cornered extrusion, not as one extrusion of the outline.
- part-4 is still refused, by three faces (f11 and the two slanted walls f173 and f174, design doc §6i), and behind those by its body stage (§6j). Those are outside this ADR.
- A face read within its file gap is rebuilt on the exact surface; the comparison past the allowance (ADR 0249) is what accepts it.
