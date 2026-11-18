# ADR 0259: part-3 windows are recognized as sharp-edge cuts; the r 0.127 edge chamfers are reported, not rebuilt

Status: Proposed (2026-11-18). No product code has changed yet.

## Context

Part-3 (`組合圖(R1-10226+R1-10134).STEP`) is rejected by recognition. Design doc §6o–§6u holds the measurements. The ones that decide this ADR:

- Taking the windows' walls off with `Kernel.deleteFaces` does not work (the neighbours cannot be extended; 70.8 s then a throw, §6p).
- An OCCT fillet of r 0.127 cannot be built on the sharp-edge window body. On the real window (`c14o`) no single rim edge builds, at r 0.127, 0.05 or 0.02. With only the plane half-space cut the edges build; with the spline-wall tool cut the edges at the spline wall fail.
- The wall itself can be rebuilt: a drafted extrusion of the wall's own rail (1.5°) is within 1.13e-6 mm of f80 inside the face, and the rebuilt wall and the r 19.05 round (wall-tool union half-space, then fillet) meet the original's seams inside τ on all four B windows (f80, f72, f106, f115): f150 0.043 τ, f152 0.901 τ, round|f154 0.930 τ (`c14s`, `c14t`, `c14u`). The void is a union, not an intersection.

## Decision (user, 2026-11-18)

Recognize a window as a sharp-edge cut: the base, minus the drafted wall tool, minus the half-space, with the r 19.05 round. The r 0.127 edge chamfers (f149, f150, f152, f154, f156, f158, f160 and the mirrors) are **not rebuilt**. The recognition report lists them as not reproduced.

Acceptance, changed from §6s: the face count differs from the original by the number of listed chamfer faces, and no more; the volume difference is measured and written in the report (the estimate of 0.1 mm³ per window or less is an estimate, not a measurement).

## Slices (each: failing test first, then code)

1. B window on a synthetic revolved cup: composite recognition accepts a cut whose wall is a drafted spline; the chamfers are listed.
2. A window (f97, f129): the composite path accepts a loft cut (today only an extrusion, `extrudeBase`); the wall deviation limit is τ/6 of the file, not a fixed value.
3. The lid notch (f158, f160 area), which no probe has modelled yet.
4. Part-3 end to end, and the 35-part audit (30 rebuild, 0 regress).

## Risks, as measured

- The seam at f152 is 0.901 τ and at round|f154 0.930 τ. The margin is about 10% and 7%.
- `wallError` does not cover the face border; near the f152 border the original f80 is about 8e-4 away from the exact draft.
- B-spline booleans grow the Emscripten heap (AGENTS §3.5); the product limit is the worker restart (ADR 0126).
- Dozens of faces of part-3 have nothing to do with the windows (§6p). Slice 4 may show more missing pieces.

## Slice 1 as built (2026-11-18)

- `recognize` tries `revolvedWindow` before it refuses a body for a face with no simple surface. It takes one window: a wall with no simple surface along one of the default directions square to the revolve axis, and at most two planes that lean with it. The base is the revolve of the half-plane section farthest round the axis from the window. The window is a cut: the curve the wall is drawn from, closed by the chord between its ends, extruded up and down from its plane as far as the wall reaches (1 mm past), drafted as the wall is.
- `Kernel.wallRail` gives that curve: the drafted wall's first rail (`draftedWallOf`), or a straight wall's curve (`extrudedCurveOf`). The rail runs on past the drawn ends (ADR 0251 extends the spline) and is approximated again (seed 1: 386 poles, degree 5), so it is cut back at the planes that close the wall's ends and its unneeded knots are taken out to 1e-9 (19 to 35 poles). Without that, offsetting it again in the rebuild failed ("the draft closes the outline").
- A first version read the rail from sections of the wall: 105 to 402 poles, 200 to 500 MiB of heap per recognition, the 512 MiB budget hit, and OCCT traps once the heap had grown in the fuzz file. Not kept.
- The tool narrows along the direction where `lean < 0` (measured on three seeds).
- Tests: `recognize-revolved-window.test.ts` (4 cases, all refused before), fuzz 100 (83 parts made, all 83 rebuilt, 0 refused, 0 traps; 17 parts the generator could not make), a heap file (40 drafted recognitions +1391.9 MiB, straight control +190.6 MiB, `liveShapes` unchanged). The window itself makes no Boolean; the growth is OCCT's with B-spline operands in the rebuild and its comparison (AGENTS §3.5), bounded by ADR 0126.

## Not decided

Whether the chamfers later get a rebuild path (a new construction, not an OCCT fillet).

## Decision 2 (user, 2026-11-18, later): the partial result is an opt-in mode

The product promise is "applied only when the rebuilt body is identical to the original" (`plan.md` §1, §4; message `recognize.hint`). A window cut without the r 0.127 edge chamfers is not identical. The user chose to **make it an explicit opt-in mode, off by default**, in the way the existing "spline outline by arcs" option works (`recognize.approximate`).

- Default (mode off): unchanged. Part-3 is still refused, with the existing message.
- Mode on: the result is applied only if the measured difference stays within a stated bound. The completion message lists the faces that were not reproduced and the measured distance or volume difference. Nothing is hidden in the report.
- The mode is chosen by the user for each run. It is not saved as a default and not turned on by any other setting.

Open (to decide before slice 1 code): the name and wording of the option in both languages (`lint:i18n`), the bound and how it is measured (volume, surface distance, or both), and whether the mode may also be used for other parts. The product has no test yet for "mode off still refuses part-3"; add it in slice 1 with the failing test.
