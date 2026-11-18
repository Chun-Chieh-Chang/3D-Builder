# ADR 0258: `analyticFace` reads ruled strips between coaxial arcs as their cone or cylinder

## Context

`Kernel.analyticFace` (C4) reads a face stored as a B-spline as the plane, cylinder, cone, sphere or torus it is, to within `tol`. OCCT's `GeomConvert_SurfToAnaSurf` proposes the surface; `analyticFace` measures it over the face. Design doc freeform-generalization §6r found faces this misses:

- **3D_MT17203 f274, f276, f278, f281.** Ruled B-splines between two circle arcs on one axis (r 77.4192 and 78.5846 at the surface's ends, 7° wide, 49.85°). OCCT returns null at the file's own gap (τ 1.4e-4).
- **E13-999-421 f71, f73, f74, f75.** Ruled B-splines between coaxial arcs (r 4.25 → 3.675 over 37.75 along x, 5° wide). OCCT returns null up to 1e-4, and a **cylinder on a tilted axis** at 1e-3.

§6r took these for exact cone strips that OCCT misses for being narrow. Measured while doing this ADR (probes `c13g`–`c13o`, `scratch/ff`, not tracked), that is not what they are.

- **OCCT reads every exact strip.** A rational B-spline made from the definition of a cone or cylinder strip is read at 1e-6 down to 1° wide (`c13i`: 160 of 160 cones, 32 of 32 cylinders).
- **What it misses is fanned strips.** In both files the second arc spans more than the first about the same middle. E13 f71: ±2.975° against ±2.473° (the weights differ between the two rows of poles). The rulings join points at the same parameter, so they are skew to the axis and pass inside the cone. OCCT misses a strip by how far its rulings fan, not by how far the face is from a cone (`c13l`: widenings of 1.05–1.2 missed at deviations of 0.002–0.9·tol). It misses every fanned cylinder (`c13j`).
- **E13's strips are cones only to 3.78e-5.** That is the sag of the surface's straight end rulings from the design cone. The file's own gap for these faces is 3.0e-7, and recognition asks `max(1e-6, τ)`, so refusing them there is right. §6r's "E13 drops from 7 to 3 free faces" cannot happen without asking a looser tolerance than the file's. That is not done (AGENTS.md §3.3).
- **MT17203's strips are cones to 1.50e-5.** That is within their τ of 1.4e-4.

There is a second defect: on a narrow strip OCCT can propose a surface that fits the face but not its edges.

- E13 f71 at 1e-3: a cylinder on an axis tilted 0.87°, 4.8e-4 from the face.
- A fanned 2.7° strip of a cylinder of radius 70.72 (fuzz seed 89): a cylinder of radius 70.667, axis 0.053 mm off, 1.7e-5 from the face.

A 2.7° arc fixes its radius only to about tol / (span²/8), so the surface alone cannot tell these apart. The face's boundary can: its rails are exact circles on one axis.

## Decision

### The reading (`coaxialStrip.ts`, `Kernel.coaxialArcStrip`)

A face is read from its rails when its surface is a B-spline ruled one way: degree 1 with two rows of poles that way, and not both ways.

- **Rails.** The two iso-curves at the surface's own bounds of the ruled direction, 25 points each.
- **Fit.** A circle is fitted to each rail by least squares: Kåsa's algebraic fit, in the rail's plane about the centroid, scaled by the rail's span. It is not the circle through three of the points, which rests on three points' last digits. A Gauss–Newton refinement was measured and dropped: it left the same residual on 1°–7° arcs with noise of 1e-7 to 5e-6 (`c13n`), and the mutation that removed it changed no test.
- **Gates.** Every gate is a length against the caller's `tol`, and each refusal has a reason the tests count.
  - Each rail flat; on its circle; and bowed by more than `tol` (`'straight'`): a rail within `tol` of a line has no radius to speak of.
  - The shared axis is square to both planes (normals averaged) and passes through the middle of the two centres.
  - Each rail at one height along that axis (`'planes-not-parallel'`), and at one distance from it (`'not-coaxial'`), to within `tol`.
  - The planes apart by more than `tol` (`'one-plane'`): closer, the strip is within `tol` of a plane.
- **What is gated.** It is what the surface shows of each rail, not the distance between the centres. On a narrow arc a centre is poorly fixed along the arc's middle radius. E13's 9-digit poles put its two fitted centres 3.6e-7 apart across the axis, while each rail is a circle to 2.5e-12. A centre moved that way moves the arc by about span²/8 of the move. The first version gated the centres' distance and refused E13 at 3e-7 for that alone.
- **Cylinder or cone.** The cylinder of the mean radius is read when it is within `tol` of the face. Otherwise the cone through both rails is read, when it is.
  - A cone whose radii differ by less than about 2·tol is that cylinder at this tolerance, on the right axis. A cone strip whose radii differ by more is never read as a cylinder.
  - The cone's axis points the way the radius grows from its apex, as OCCT's `gp_Cone` with a positive semi-angle.
- **Deviation.** Measured over the face by the same 13 × 13 check as OCCT's proposal (`surfaceOff`, moved out of `analyticFace` unchanged).

### Precedence

The rails' reading is tried first. When it holds, it is returned and OCCT is not asked. When it does not, OCCT's proposal is measured as before.

- The rails are the face's own boundary, so their axis and radii agree with the neighbouring faces. OCCT's proposal only has to fit the face.
- On an exact strip both agree to rounding, so nothing that read before reads differently in kind.
- Asking OCCT only when needed also saves its conversion on these faces.

## Verification

- **Real faces** (`analytic-face-strip.test.ts`, skipped without `REAL_STEP_DIR`).
  - **MT17203:** f274, f276, f278, f281 read as cones of 49.849484° at their τ (1.4e-4), deviation 1.50e-5. OCCT alone returns null there. The face's own edges lie on the cone within τ. The angle matches probe `c13f`'s 49.8496° within 5e-5° plus 2·deviation/height.
  - **E13:** f71, f73, f74, f75 are refused at `max(1e-6, τ)`. The premise is asserted from the design and the end rulings: sag 3.78e-5, more than 10·tol.
  - **E13 at 1e-4:** read as the design cone (0.872650°, axis x, apex at x 239.47 within 1e-3). The deviation equals the sag within 2%.
  - **E13 at 1e-3:** OCCT proposes a cylinder; the cone is read.
- **Guard:** E13 f71 made from its definition (fanned the same way). OCCT proposes a cylinder at 1e-3. It is null at 1e-6 and 1e-5, and the cone (deviation 3.78e-5) at 1e-4, 1e-3 and 2e-3.
- **Precedence:** fuzz seed 89. OCCT proposes radius 70.667; the rails' 70.720 is read, axis within 1e-8.
- **Fuzz** (`analytic-face-strip-fuzz.test.ts`, a file of its own): 160 seeded strips. Arc span 1°–10°; half-angle 0°–60° either way, half of the cones shallow (0.05°–5°); radius 1–100; anywhere in space; degree 2 or 3 along the arcs; 0–2 inner knots; either direction ruled.
  - **Reads:** 60 exact cones, 20 exact cylinders, 60 fanned cones, 20 fanned cylinders. Each is read with its type, side, axis, radii or half-angle and apex, checked against the definition.
  - **Fanned strips:** the deviation is the end rulings' sag, computed by the test from the definition. It lies between 0.9 and 1.0 of it.
  - **OCCT alone misses** 4 of the cones and 19 of the cylinders.
  - **Near misses:** 15 each of the second rail moved off the axis, out of parallel, turned about the axis (a hyperboloid's strip), or both rails elliptic. Each is moved by at least 100·tol against the strip's own axis, by the test's own measure.
    - Refused: offset 12, tilt 12, twist 15, ellipse 15.
    - The other 3 offsets and 3 tilts are read by OCCT as a cone on a tilted axis, within tol by the test's own 41 × 41 measure. A narrow strip moved off its axis can be one.
  - **Guard:** 328 checks that a cone strip is a cone at every tolerance below its own bow and radius change.
  - Every count is asserted non-zero.
- **Mutations** (`scratch/ff/c13-mutate.mjs`; each asserts that its match is unique).
  - Removing the fallback: 6 of 22 tests red (MT17203, the fuzz, both E13 tests, the guard, the precedence test).
  - OCCT first, the rails only when OCCT has nothing: the same 6 red.
  - The cylinder always: 8 red.
  - No coaxial gate: the unit refusal test red. The fuzz's near misses are also caught by the face measure.
- **Heap** (`analytic-face-strip-heap.test.ts`, fresh heap, `wasmMemory` with `> 0` asserted). 20 000 calls on a fanned strip read by the rails, plus 20 000 on a twisted strip the rails refuse (so OCCT's converter runs too): +0.0 MiB. The `EvalD1` control: +1648.1 MiB. `liveShapes` is equal before and after.
- **Real-part audit** (35 targets): 30 rebuilt before and after, no regression.
  - MT17203: free faces 84 → 80.
  - E13: 7 → 5. Its four strips stay refused at its gap. Two 0.15 mm² thread run-out slivers with a large gap (τ 5.4e-3 and 6.7e-3) now read as cones within it (deviation 3.3e-3 and 4.4e-3, on axes unrelated to the part): within the contract, weak evidence, no outcome changed.
  - The one time flag (the fixture, a budget error both ways) is the machine: the clean base measured 47.8 s and 96.4 s an hour apart. `analyticFace` costs 1.81 s on the base and 2.12 s here on that part. Details in DEV_LOG 2026-11-18.

## Consequences

- A face read this way has the axis and radii of its edges. Recognition sees a cone where it saw a freeform face (MT17203 −4) or a cylinder of another radius.
- Every B-spline face ruled one way pays for two 25-point fits and up to two 13 × 13 measures before OCCT is asked.
- Not done:
  - A strip reaching the apex (one rail a point) is not read: its rails are not two arcs.
  - A strip whose rails are arcs on one axis but whose surface is a hyperboloid's (twisted) is refused, as it should be. Nothing reads hyperboloids.
  - E13's remaining refusals are its tapered thread (§6r) and these four strips at the file's gap.
