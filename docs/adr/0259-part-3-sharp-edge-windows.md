# ADR 0259: part-3 windows are recognized as sharp-edge cuts; the r 0.127 edge chamfers are reported, not rebuilt

Status: Accepted (2026-11-18). Slice 1 is in `3694c3fe`, slice 2 in `a2452205`, slice 3 in `9df3b686`, slice 4a in `104ab473`; slice 4b is below (not committed when written; the fuzz bar is the user's choice of 2026-11-19).

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

## Slice 2 as built (2026-11-18)

- `revolvedWindow` now takes a second kind of wall: a B-spline surface ruled one way whose two rails each lie on a plane of their own, in any direction (part-3's A walls). The window is one loft cut between the rails, each closed by its chord, each sketched on its own plane (`SectionsRecord`, an extra of a composite; `Reconstructor.lofted`).
- `Kernel.ruledRails` reads the rails at the surface's own bounds, fits a plane to each (least squares over 64 points, `fitPlane`) and moves its poles onto it, and measures the wall against the ruled surface between the moved rails at the same parameters (9 × 9 points inside the face). The rails are not cut and keep their knots: the parameter pairs the rulings (DEV_LOG 2026-11-16).
- The limit: that deviation within a sixth of the file's own precision at the wall (`Kernel.fileTolerance`, at least 1e-7 mm). Measured on a cup whose rail is bent off its plane: without the limit, a bend of 1e-2 mm (the wall 8.98e-4 mm off, 600 times the file's precision) was rebuilt with volume error 2.68e-8. The comparison of whole solids does not see a wall that far off; this limit is the only check on it.
- `Kernel.flatFace` (`GeomLib_IsPlanarSurface`): a B-spline face that is flat counts as one of the window's planes. A loft between two chords on one plane makes one; slice 1's drafted path takes them too.
- Each section is made counter-clockwise on its own plane. Turning both rails together, as first written, did nothing: a second rail run backwards rebuilt the same solid (the loft lines the sections up itself). Removed.
- Tests: `recognize-loft-window.test.ts` (planes 28° and −15° apart, parallel planes, and the bent rail: refused at 1e-5 and 1e-3 mm, the unbent control rebuilt); mutations: the loft path off turns the three cases red, the limit off turns the bent case red. Fuzz 100 (two files): 100 rebuilt, 0 refused, 0 traps, both ways of turning (+47, −53); heap 128 → 661 MiB over 50 cases in each file (about 10.7 MiB each, AGENTS §3.5, not claimed flat).
- Not shown yet: whether part-3's A wall passes the limit. §6o-A measured a loft 3.91e-5 mm off f97 with τ about 2.3e-4 mm, so τ/6 is about 3.8e-5: the margin is small or negative, and the deviation here is measured another way (point for point at the same parameters). Slice 4 measures it on the file.

## Slice 3 as built (2026-11-18)

- Measured first (`c17a`–`c17c`): part-3's lid (y 17.526 to 19.05) is a cross. Its arms along ±z are about |x| < 9 wide (ending in the cone's arc over the B windows), its arms along ±x |z| < 5.715 (ending at the A walls), and its four inner corners are concave cylinders r 3.81 (f133–f136) whose axes are along y but off the revolve axis. The "notch" is the revolve's disc less this cross. The B window's side plane f79 is one wall of the notch, the A region's plane f92 the other.
- The user chose the section difference (option 1), then, after the measurement that follows, a correction: the difference of whole sections runs along the windows' free walls where a notch meets a window, and those change with the height, so it would be no prism. The outline is the chain, in the body's section, of the edges on walls that hold the axis direction (lines and arcs, exactly); its two end lines are carried on past twice the body's reach and joined round the outside the shorter way.
- `revolvedWindow`: the axis is the one the surfaces of revolution with the most area turn about. The walls of cuts along it are planes that hold its direction and cylinders along it but off it (not the window's own faces). The window's faces are now the wall, flat B-spline faces, and the planes meeting the wall that lean. It is tried whenever a body has free faces, not only when no extrude direction was found: a cut along the axis gives the body planes facing across it.
- `axialCuts`: walls joined by edges are one cut. It is sectioned at the middle of the height all its walls share (below that some may stand alone: a notch run on down a wall shows only the planes' stubs, its corner falling in the hollow), and the section's edges count only when they lie on a wall of the group and inside the box of that wall's vertices (two notches may share one plane). It is extruded over the group's span, 1 mm on past an end unless a floor of the cut is there (a plane square to the axis meeting the group, its centre inside the outline).
- The base half-plane must keep 2° clear of the angles each cut face covers round the axis (its vertices, edge middles and centre; the circle less its widest gap). It used to keep 30° from face centres and edge middles; a notch plane runs on near a default direction, so its centre said nothing about where it reaches.
- Tests: `recognize-lid-notch.test.ts` (3 cases; all refused before: the off-axis cylinders gave no revolve axis and the notch planes sent the body down the extrude path); mutations: no axial cuts and no floors (always 1 mm past) each turn all three red. Slices 1–2 still pass. Fuzz 100 (two files): 87 parts made, all 87 rebuilt, 0 refused, 0 traps; 13 the generator could not make (its draft closed the outline); heap 128 → 2288 MiB over 50 cases in each file (about 43 MiB each, AGENTS §3.5, not claimed flat).
- Not covered by the synthetic part: a notch sharing a plane with a window (f79 in part-3). f79 holds the y direction (normal (0.996, 0, 0.087)) and does not meet the B wall f80 itself (the r 19.05 round f81 lies between), so these rules count it as a notch wall: its group (with f135 and f92) then spans the window's height as well as the lid's, and the cut made from it reaches down beside the window. Whether that cut is right on part-3 is for slice 4 to measure on the file.

## Decision 3 (user, 2026-11-18, night): the option, its bound and its scope (d3b)

- Name: zh-TW 「略過小圓角（不重建，差異列於報告）」, en "Skip small rounds (not rebuilt; the difference is reported)". Off by default, chosen per run, in the way `recognize.approximate` works.
- Bound: the largest distance between the rebuilt and the original surfaces must be at most the largest radius of the rounds skipped (part-3: 0.127 mm). Reason: taking off a round of radius r moves the surface by about r at most. The volume difference is measured and written in the report, with no bound.
- Scope: any part. A round is skipped only when nothing else rebuilds it and its radius is within the bound; the 35-part audit measures which parts this lets through.
- Measured before the decision (c18a/c18b, estimates marked): part-3 has about 44 small round faces, about 149 mm of spine, holding about 0.5 mm³ (0.012% of 4420.8 mm³; estimated from face areas, not measured by rebuild).

## Slice 4 plan (user, 2026-11-18, night)

Measured on part-3 first (c18a–c18d): the window path stops at its first check (part-3 has 12 free walls, not 1); the A window's upper face f98/f130 is an r 3.048 rolling ball between the lid top and the A wall (circle centres 3.04800 from the lid, 3.0478–3.0480 from the wall; the 7.0e-3 `rollingBall` gives comes from its two ends, which run past the wall's surface); and the rounds cannot be deleted first (of 73 round faces only the r 1.270 class deletes: the rest trap, run past 600 s, or are refused as "the faces around cannot be extended"). So the window path must work with the rounds left in the body, which it does not (it returns before the round step). The user chose sub-slices: 4a several windows (synthetic, no rounds); 4b the window path with rounds left in the body; 4c the "Skip small rounds" option; 4d part-3 end to end.

## Slice 4a as built (2026-11-18)

- `revolvedWindow` takes any number of free walls, each its own window (drafted or ruled, as in slices 1 and 2); the window faces are gathered per wall (at most three per wall); the base half-plane must keep 2° clear of every wall and axial cut. When no half-plane along a default direction is clear (part-3's layout: windows at ±x and ±z), the clearest of every degree round the axis is taken.
- Known limit, not fixed: the volume check can refuse an identical window part. Fuzz seed 57 (four drafted windows) is refused on volume 6.7e-6 with area 4.5e-11 and the volume between them 1.9e-12. Integrating to 1e-10 put seed 57 at 2.6e-8, but over the whole fuzz it refused 15 parts (volume 1.7e-6 to 1.4e-4, the volume between them at most 7.5e-12), so it was taken back (AGENTS 2026-11-07: a tighter `eps` is worse on spline walls). A refusal is the safe side; a volume integral good to 1e-6 on such walls is a separate piece of work.
- Tests: `recognize-multi-window.test.ts` (4 cases, all refused before); mutations: only the default half-planes (2 of 3 cases red), only the first wall (all red). Slices 1–3 pass. Fuzz 100 (two files): 79 parts made, 78 rebuilt, 1 refused (seed 57, above), 0 traps; 21 the generator could not make (its draft closed the outline); heap 128 → 3056 / 3313 MiB over 50 cases in each file (AGENTS §3.5, not claimed flat). phase8 recognition 15 files pass; real-part audit 69/84 as before.

## Slice 4b as built (2026-11-18)

- With rounds, `recognize` reads the windows after the rounds: the rounds stay in the body (they are never deleted when some have no simple surface, C2.8) and come back as blend records, fillets on the rebuilt windows' edges. `revolvedWindow` takes the round faces (free rounds, and every blend left in the body) as faces to pass over: not window walls, not axial walls, not in the revolve axis's way.
- The deferral is taken only when a cheap layout check (`revolvedWindow` up to the half-plane, no section or tool made) passes with the rounds and the analytic blend candidates set aside; when the deferred path fails on the way, the refusal is the free faces, as before. Measured on the real parts: without the check, four refused parts gave another reason (a sharp edge not found) and part-4 took 20.2 s, not 8.0; with it, the same reasons and part-4 9.5 s (the check's own cost).
- One round that OCCT made as several faces on the same two supports is one fillet record (a round along a loft wall, split where the wall's spline is: fitted r 0.29999998 and 0.29999979, so the radius keys differed). Two records made the first fillet take the whole edge on the rebuilt body and the second find none. Merged only for the same two support faces, the same convexity, and radii within `ROLLING_BALL_TOLERANCE`.
- Tests: `recognize-window-rounds.test.ts` (3 cases, all refused on HEAD); mutations: no rounds passed to the window path (all red), split halves not merged (the loft case red). A first version also kept the base half-plane clear of the rounds on the windows; its mutation survived (a rim round reaches no further round the axis than its wall), so it was taken out (AGENTS 2026-11-18 4).
- Known limits (measured, not fixed):
  - OCCT's own fillet on random window rims fails or is invalid in most cases (c19f: 16 of 40 made at drafts up to 1° and radii 0.2–0.5; 3 of 40 at drafts to 2.7° and radii to 0.8; three ran 5–9 minutes), so the fuzz rounds drafted windows only and counts the rest as not made.
  - On a loft wall tilted −15° OCCT's round is 9.9e-4 off a rolling ball, past the nomination limit (max(1e-5, 1e-3·r) = 3e-4 at r 0.3), so such a window is refused. Part-3's r 3.048 lid round is past it too (7.0e-3 at its ends, limit 3.05e-3).
  - Heap: with the rounds left in, recognition costs about four times as much (fuzz seed 85 of the first run, four windows: 138 MiB sharp, 562 MiB rounded, stopped by the 512 MiB job budget). The fuzz counts a budget stop as a refusal, on its own line.
  - Rebuilt with the rounds, many parts are refused on the way: the fillet's edge not found on the rebuilt body, or a fillet that fails there. All refusals; none accepted wrongly.
- Fuzz 100 (`recognize-window-rounds-fuzz-1..25.test.ts`, four seeds a file, each file a fresh heap): a seed whose part OCCT will not make takes its next attempt, at most five (the user's choice, 2026-11-19). 83 parts made, 17 seeds not made in five attempts; **31 rebuilt (37%)**, 37 refused, 15 stopped by the job's 512 MiB budget; 0 traps, 0 accepted wrongly; heap at most 2808 MiB in a file (files of ten reached 4 GiB and trapped). Refusals: about 20 with rounds not nominated, so taken for free faces; about 10 with a rebuilt fillet that cannot be made.
- The fuzz bar (user, 2026-11-19): each file has at least one part made that went through recognition (rebuilt or refused); every case must be rebuilt as the same solid, refused, or stopped by the budget, and a trap or other error fails it. The first bar, "at least one rebuilt in each file", failed in 6 files of 25: it measured the product's rate (37%), not whether the fuzz ran. The rate is recorded here, not a bar; raising it is work for later (the largest class first: rounds not nominated).

## Not decided

Whether the chamfers later get a rebuild path (a new construction, not an OCCT fillet).

## Decision 2 (user, 2026-11-18, later): the partial result is an opt-in mode

The product promise is "applied only when the rebuilt body is identical to the original" (`plan.md` §1, §4; message `recognize.hint`). A window cut without the r 0.127 edge chamfers is not identical. The user chose to **make it an explicit opt-in mode, off by default**, in the way the existing "spline outline by arcs" option works (`recognize.approximate`).

- Default (mode off): unchanged. Part-3 is still refused, with the existing message.
- Mode on: the result is applied only if the measured difference stays within a stated bound. The completion message lists the faces that were not reproduced and the measured distance or volume difference. Nothing is hidden in the report.
- The mode is chosen by the user for each run. It is not saved as a default and not turned on by any other setting.

Open (to decide before slice 1 code): the name and wording of the option in both languages (`lint:i18n`), the bound and how it is measured (volume, surface distance, or both), and whether the mode may also be used for other parts. The product has no test yet for "mode off still refuses part-3"; add it in slice 1 with the failing test.
