# ADR 0262: drawing dimension placement and content (hatch avoidance, surface clustering, side-on Ø, blind-hole detection, centre axes and leader accuracy)

Status: Accepted (2026-11-20). Phase 3 of the drawing-rules work (`docs/drawing-improvement-plan.md`, `docs/design/drawing-rules-cns.md`); follows [ADR 0260](0260-drawing-standard-profile.md) (Phase 1, drafting standard profile) and [ADR 0261](0261-drawing-view-layout.md) (Phase 2, measured view layout).

## Context

Measuring the automatic drawings produced by `drawing_create` on the four golden parts (`diamond-pin`, `locating-plate`, `sds-plus-bit`, `v-block`) and the real part `R1-8032 Rev. 08` against Phase 3 rules `3-1` to `3-11` (`D1`, `D3`, `D5`, `D6`, `D7`, `D9`, `D10`, `C1`, `C2`, `C4`, `L1`, `L2`) revealed ten dimension placement and content defects:

1. **Extension lines crossing hatched section areas (rule D1 / 3-1)**: `contourAttach()` clamped extension lines only against `visible` polylines, ignoring `cut` polygons, and `merit()` scored section views equal to regular views for edge-on planes (`R1-8032`: 14 crossings, `sds-plus-bit`: 10).
2. **Ordinate text self-clutter and duplicate values (rules D3, D5 / 3-2, 3-3)**: `ordinate()` ended extension stubs at `row + outward * 1` and placed text at `row + outward * 1.5` (`0.5` mm gap), which failed `clutterOf(..., CLEARANCE = -0.6)` and inflated clutter counts (`R1-8032`: 38/5, `sds-plus-bit`: 39/1). Duplicate coordinate refs could also be emitted at identical coordinates.
3. **Leader arrows landing in empty space or broken angles kept (rule D6 / 3-4)**:
   - `circle()` drew 2-arrow diameter lines even when the far side of a split cylinder was cut away (`R1-8032`: 21 arrows off geometry, `sds-plus-bit`: 2).
   - `arrowHitsView()` returned `true` when `tips.length === 0`, causing `steerLeaders()` to accept broken angles where `circleCentre()` returned `null` (`drawing.dimNotTrueShape`) so `tidy()` later deleted 11 torus fillet dimensions.
4. **Dimensions detached from detail views (rule D7 / 3-5)**: `offloadMicroDetails()` clustered radii using circle centre instead of actual arc attachment points and allowed cluster radii to exceed the detail boundary (`R1-8032`: 3 detached dims).
5. **Split-patch `n×` overcounting and full cylinders dimensioned as `R` (rules C1, C2 / 3-6, 3-7)**:
   - Circumferentially split cylinders (e.g. a turned bore cut by slots) and split fillet torus rings were treated as separate partial faces, inflating `n×` counts (`R1-8032`: 21 mismatches, `sds-plus-bit`: 3) and emitting `R` instead of `Ø` (`R1-8032`: 16, `sds-plus-bit`: 4).
   - `dimensionCoverage()` populated `surfacesSized` only from `diameter`/`radius` dims, ignoring side-on linear `Ø` dimensions (`aSide: 1, bSide: -1`), leaving 19 split-cylinder patches reported as uncovered.
6. **False "through" callout on blind holes ending in cones/fillets (rule D9 / 3-8)**: `holeInfo()` did not treat a narrowing cone or torus cap (all other circular edges `<= radius`) as a closed hole end (`R1-8032`: 1 false through hole).
7. **Missing longitudinal axes on sections and duplicate concentric crosses (rules L1, L2 / 3-9)**:
   - Auto-created sections had `centreMarks` omitted (defaulting off), side-on split cylinders and cones emitted no `'axis'` features, and coaxial axes were drawn separately instead of merged (`R1-8032`: 1 missing axis, `sds-plus-bit`: 1).
   - Concentric whole circles drew stacked centre crosses instead of one cross sized to the largest circle.
8. **Sliver faces dimensioned (rule C4 / 3-10)**: micro-sliver faces (`area < 0.01 mm²`) were included in `viewFeatures()` (`R1-8032`: 2).
9. **Post-`clearViews` caption overlap regression**: moving views in `clearViews()` at the end of `tidy()` could shift a reference view caption onto a neighbouring view or dimension.

## Decisions

1. **Feature extraction & surface clustering (`packages/model/src/drawing.ts`, `packages/regen/src/drawingDimensions.ts`)**:
   - Added optional `surface?: string` to `ViewFeature` `'circle'` and `'torus'` variants so patches cut from one coaxial cylinder or fillet ring share one feature identity.
   - Exported `MIN_DIMENSION_FACE_AREA = 0.01` (`C4`) and filtered faces with `!(f.area >= MIN_DIMENSION_FACE_AREA)` in `viewFeatures()`.
   - Clustered coaxial cylinders with overlapping axial `[tMin, tMax]` intervals (`splitCylinderSurface`) so circumferentially split cylinders are marked `full: true` with shared `surface` (`C1`, `C2`), while axially disjoint coaxial bosses remain distinct features.
   - Clustered split torus fillet rings by Euclidean centre (`<= 1e-2` mm), parallel axis (`|dot| >= 1 - 1e-4`), `convex`, `minor`, and `major` (`torusSurface`, `C1`).
   - Emitted `'axis'` features for side-on split cylinders and coaxial cones (`L1`).
   - Updated `holeInfo()` (`D9`) so a concave cylinder end meeting a narrowing cone or torus (all other circular edges `<= g.radius`) is marked `closed` (blind, not `through`).
2. **Centre marks & continuous coaxial axes (`packages/drawing/src/annotation.ts`)**:
   - Deduplicated concentric whole-circle centre crosses using Euclidean centre clustering (`<= 1e-2` mm), sizing the single cross to the largest circle at that centre (`L2`).
   - Merged coaxial `'axis'` features along the same line into a single continuous axis line spanning `[tMin, tMax]` (`L1`).
   - Kept `showsCentre = (v) => v.centreMarks ?? v.kind !== 'section'` for backwards compatibility with existing manual sections, while `makeSection()` in `apps/mcp/src/drawingSession.ts` sets `centreMarks: true` (`L1`).
3. **Dimension planning, side-on `Ø` and coverage (`packages/drawing/src/autoDrawing.ts`, `packages/drawing/src/autoDimension.ts`)**:
   - Deduplicated round counts and coverage by `roundSurface(f)` (`f.surface ?? f.ref.name`, `C1`).
   - Recognized side-on linear `Ø` dimensions (`a.name === b.name && aSide !== bSide`) in `readDimension()` and populated `surfacesSized` in `dimensionCoverage()` from `sized`.
   - Split round sizing in `planDrawingDimensions()` into three passes: (1) visible end-on circles & torus fillets, (2) hidden end-on circles seen side-on as `'axis'` in another view (sections first) placed as side-on linear `Ø` (`aSide: 1, bSide: -1, prefix: 'Ø'`, `C2`, `D6`), (3) remaining rounds.
   - Lowered `merit()` for edge-on planes in section views (`1.2` vs `2`) to avoid dragging extension lines across hatching (`D1`), and deduplicated ordinate refs at identical coordinates (`D3`).
4. **Hatch clearance, ordinate spacing & split-circle leaders (`packages/drawing/src/dimension.ts`)**:
   - Added `clearCut()` in `contourAttach()` to clamp extension-line start points outside `viewLines.cut` polygon intersections on the outward side (`D1`).
   - Increased ordinate text offset from `row + outward * 1.5` to `row + outward * 2` (`1.0` mm clear of extension stub, eliminating false self-clutter under `CLEARANCE = -0.6`, `D3`, `D5`).
   - Checked `farOnGeom` against `viewLines.visible` + `viewLines.tangent` in `circle()` before drawing a 2-arrow diameter line, falling back to a single-arrow leader when the far side is cut away (`D6`).
5. **Leader steering, detail clustering & caption refresh (`apps/mcp/src/drawingSession.ts`)**:
   - Hardened `arrowHitsView()` to return `false` whenever `!outcome || 'error' in outcome || tips.length === 0`, and updated `steerLeaders()` (24 coarse + 72 5° fine angles) to snap missed arrows onto geometry without degrading hitting arrows (`D6`).
   - Updated `offloadMicroDetails()` to compute actual arc attachment points and cap cluster radius at `<= 3.5` mm with pulled-in dimensions inside `maxR - 0.2` (`D7`).
   - Improved `hiddenFeatures()` for circles to require a polyline segment (endpoints + midpoint on radius) rather than a single vertex hit.
   - Allowed Page 0 sheet selection to step up to `A0` when `maxFill > FILL_RANGE[1]`, prioritized clearing `captionClutter` in `placeCaptions()`, and re-ran `placeCaptions()` after `clearViews()` at the end of `tidy()`.

## Measured Results on the 5 Benchmark Parts (2026-11-20)

| Part | `3-1` Ext/Hatch | `3-2` Ord | `3-3` Clutter/Cross | `3-4` ArrowOff | `3-5` OutView | `3-6` n× | `3-7` CylAsR | `3-8` Thru | `3-9` Axis/Cross | `3-10` Sliver | `rounds` Cov | `layout.pass` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `locating-plate` | `0` | `0` | `0 / 0` | `0` | `0` | `0` | `0` | `0` | `0 / 0` | `0` | `100%` | `true` |
| `v-block` | `0` | `0` | `0 / 0` | `0` | `0` | `0` | `0` | `0` | `0 / 0` | `0` | `100%` | `true` |
| `diamond-pin` | `0` | `0` | `0 / 0` | `1` (relieved flat 0.50 mm) | `0` | `0` | `0` | `0` | `0 / 0` | `0` | `100%` | `true` |
| `sds-plus-bit` (before → after) | `10 → 0` | `0 → 0` | `39/1 → 7/2` | `2 → 0` | `0 → 0` | `3 → 0` | `4 → 0` | `0 → 0` | `1/0 → 0/0` | `0 → 0` | `16/16` | `true` |
| `R1-8032` (before → after) | `14 → 0` | `0 → 0` | `38/5 → 10/2` | `21 → 3` | `3 → 0` | `21 → 0` | `16 → 0` | `1 → 0` | `1/0 → 0/0` | `2 → 0` | `102/102` (was `83/102`) | `true` |

## Verification & Mutation Tests

- Added `tests/phase5/drawing-dimension-content.test.ts` (11 unit tests covering `C1`, `C2`, `C4`, `D1`, `D3`, `D9`, `L1`, `L2`).
- Verified **7/7 mutations turned red** when breaking each rule independently:
  1. `autoDrawing.ts` ignoring `f.surface` → 2 failed.
  2. `annotation.ts` sizing concentric centre cross to smallest (`<` vs `>`) → 1 failed.
  3. `annotation.ts` disabling coaxial axis merge → 1 failed.
  4. `drawingDimensions.ts` setting `MIN_DIMENSION_FACE_AREA = 0` → 1 failed.
  5. `dimension.ts` disabling `clearCut` → 1 failed.
  6. `dimension.ts` reverting ordinate text offset `2 → 1.5` → 1 failed.
  7. `drawingDimensions.ts` disabling narrowing-cone blind-hole check → 1 failed.

## Remaining Limitations (Deferred to Phase 4 / Follow-up)

- `R1-8032` still has 3 partial torus fillet leaders (`R0.122`, `R0.254`) whose 3D arc sits on a clipped/occluded side of the view (`3-4 = 3`) and `10 / 2` residual dense-view text clutter/crossings (`sds-plus-bit`: `7 / 2`).
- Slanted faces (`coverage.slants`) are not yet auto-dimensioned (unchanged from Phase 2 baseline).
- Phase 4 (ADR 0263) will add the formal quality gate (`Q1`, `Q2`, `C5`, `C7`) in `drawing_inspect` / `drawing_export`.
