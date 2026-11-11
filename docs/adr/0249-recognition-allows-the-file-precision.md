# ADR 0249: Recognition allows each face its file's own precision

## Context

Feature recognition accepts a rebuild only when it is the same solid as the import, to `RECOGNIZE_TOLERANCE = 1e-6` (relative): volume, area, and the volume between the two (ADR 0248, by surface deviation).

Some imported files do not meet that themselves. In the real part part-4 (R1-9035, 295 faces, 4109.47 mm³), nine faces look like rounds but are true rounds only to about 1e-4 mm:
- Their cross-sections are exact arcs, with radii in whole thousandths of an inch.
- Their boundary iso-lines lie 4.6e-5 to 7.1e-4 mm off their supports.
- The file's edges there carry tolerances of 1.1e-4 to 8.8e-4. The B-rep holds together only through those tolerances.
- Moving the nine onto exact rolling balls changes the volume by 4.31e-3 mm³, which is 1.05e-6 of the part.

Any valid native solid, whose faces meet within 1e-7, differs from this file by about 1e-6. That is a conflict between the acceptance standard and the file's precision, not something an algorithm can remove (design doc §6g).

The user ruled on 2026-11-11 (design doc §6h):
- The acceptance threshold follows the original file's precision.
- A file joined at working precision is still held to 1e-6.
- A face whose joints in the file are imprecise may differ by up to its own joint error.
- The report says so for each part.

## Decision

### How far apart a file's faces are: `Kernel.fileTolerance`

- **Per edge (the joint gap):** the largest distance, at 9 points along the edge, among its 3D curve and its image on each of its faces (the pcurve carried onto that face's surface by `BRepAdaptor_Curve(edge, face)`). Gaps up to `FILE_TOLERANCE_FLOOR = 1e-7` count as 0, so evaluation noise is kept out: exact rounds join to 6.9e-9.
- **Per face (τ_f):** the largest gap of its edges. The file does not say which of two faces is off, so both get the gap.
- **Not `BRep_Tool.Tolerance`:** that is a bound set when the file was read, not a measured error.
- **Totals:** `volume = Σ τ_f · area_f` and `area = Σ 2 · gap_e · length_e` (a gap on each side of the edge).

### The comparison past the allowance

`Kernel.surfaceDeviation(a, b, tolerance, allow?)` takes an allowance per face of A and of B. For each sample point it adds `max(0, d − τ)` to `excess`:
- τ is the larger of the allowance of the A face the point is on and that of the nearest B face.
- Allowances must match the face counts and be finite and ≥ 0; anything else throws.

In `reconstruct`:
- The import's τ_f is passed both ways: as A's from the import, and as B's toward the import.
- `difference` is the larger excess, over the volume, and must be ≤ 1e-6.
- The volume error may be up to `1e-6 + Σ τ_f·area_f / V`.
- The area error may be up to `1e-6 + Σ 2·gap_e·L_e / A`.
- The report's `fileTolerance` gives the number of faces off, the largest τ, and the two allowances, so a part accepted under its file's precision says so.

Each point is allowed only its own face's error. A real error elsewhere (a missing hole) is not let through by an imprecise face somewhere else: the excess over the hole's wall is still its volume less τ over its wall.

### Nominating rounds on freeform faces (C2.8)

The supports of a candidate are the pair, among all its tangent non-candidate neighbours, whose rolling ball deviates least. The earlier rule required exactly two tangent neighbours. part-4's rounds also run tangent into a round at their ends, so they had three.

A face is nominated when the ball deviates by no more than the largest of:
- `ROLLING_BALL_TOLERANCE` (1e-5);
- `NOMINATE_BALL_RELATIVE = 1e-3` of the radius;
- twice the face's τ_f.

The relative term is there because three of part-4's faces (f136, f163, f164) join their supports to 3e-6 but cross them at a slight angle, 1e-4 to 2e-4 off a ball (2.8e-4 to 5.6e-4 of r).

**A nomination is only a proposal.** `reconstructImported` runs recognition, rebuild and comparison once with the rounds. If that is refused (a `RecognizeError`, not a budget or a trap) and some face was nominated (`FreeRoundsOption.nominated`), it runs them again without free rounds, as before C2.8. If the second run is also refused, the first run's reason is reported, because it says more (part-4: 5 faces left rather than 14).

The first version had no retry, and a control turned it up. A box whose corner is an exact elliptical quarter (a rational quadratic, semi-axes 2 and 2 + e) was:
- recognized before ADR 0249 for e = 2e-4 and 1e-3, as one extrusion of its exact outline;
- refused with the wider nomination, with "no edge for the round on the rebuilt model".

With the retry all of e = 0, 2e-4, 1e-3, 3e-3 and 2e-2 are recognized. That includes e = 0, a true round drawn as a spline, which was refused even before ADR 0249: a round at the corner of an extrusion is part of its outline, so no edge is left to round. With the retry, the set of parts accepted contains the set accepted before.

OCCT's own round of the spline boss's edge (r 0.5, 0.8, 1.2) was refused before (off the ball by more than 1e-5). It is now rebuilt as an exact round, and the comparison accepts it: 2e-9 to 6e-9 of the volume before any allowance is taken off. The comparison accepts it, not the nomination and not the allowance.

## Measurements

| Case | Measured |
|---|---|
| Box through STEP | 0 faces off |
| Box with the top `PLANE` moved δ = 2e-5, 2e-4, 1e-3 off its edges | Top and four sides τ = δ (1e-3 relative), bottom 0; Σ τ·area and Σ 2·gap·L as computed by hand |
| That box against the exact one | Raw 40·30·δ both ways (1.7e-5 of the volume at 2e-4); past the allowance, 0 |
| That box against an exact box with a 0.25 mm hole | Excess ≥ the hole's volume less δ over its wall |
| Exact round (fuzz sample 41) through STEP | Largest gap 6.9e-9: 0 faces off |
| OCCT's own round of the same edges | Largest gap 9.8e-6 (sample 7: 6.8e-6): its pcurves approximate |

Mutations (`packages/kernel/test/file-tolerance.test.ts`), each turned red:
- no allowance;
- the B side's allowance ignored;
- an infinite allowance;
- no floor.

## Consequences

- A file exported from this program with OCCT's rounds gets about 1e-5 of allowance around those rounds, because that is how far OCCT's own faces are apart there.
- part-4 is still refused, by five faces that are no rounds (design doc §6i):
  - two cylinders exported as splines;
  - a spline wall along y;
  - two walls along a slanted direction that no plane of the body faces.
  These are C4's scope.
- Whether part-4's rounds then pass the comparison is not yet shown on the part.
