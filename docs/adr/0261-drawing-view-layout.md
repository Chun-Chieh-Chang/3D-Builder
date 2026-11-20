# ADR 0261: measured view layout for automatic drawings (clearance, detail placement, turned-part main view, multi-page sheet consistency and layout self-check)

Status: Accepted (2026-11-20). Phase 2 of the drawing-rules work (`docs/drawing-improvement-plan.md`, `docs/design/drawing-rules-cns.md`); follows [ADR 0260](0260-drawing-standard-profile.md) (Phase 1, drafting standard profile).

## Context

Measuring the automatic drawings produced by `drawing_create` on the four golden parts (`diamond-pin`, `locating-plate`, `sds-plus-bit`, `v-block`) and the real part `R1-8032 Rev. 08` revealed seven view-layout defects against `docs/design/drawing-rules-cns.md` (rules P1–P4, V1–V8):

1. **Views overlapped each other's dimensions (rule V1 / 2-1)**: `VIEW_GAP = 25` mm was a fixed gap between view outlines, ignoring how far dimension rows and captions reached. `spreadViews` only nudged views when the text-clutter count dropped, leaving `diamond-pin` at `-0.06` mm clearance, `R1-8032` page 1 at `-0.72` mm, `sds-plus-bit` page 2 at `-19.05` mm, and `R1-8032` page 2 at `-42.00` mm.
2. **Sheet fill and overflow (rules P1–P2 / 2-2)**: after sliding views or captions, `R1-8032` page 2 exceeded the drawable area (`1.161` of height), and path-dependent slides on a smaller trial sheet carried over when stepping up to a larger sheet.
3. **Detail views far from or blocked from their parent, empty, or at non-standard scales (rules P4, V4, V6 / 2-3, 2-4, 2-5)**: detail views were placed in the largest empty rectangles on page 2 regardless of where the parent view stood (`5` of `6` details on `R1-8032` had another view between them and their parent), used non-standard scales (`15:1`, `8:1`, `4:1`), and included empty detail circles (`inkRatio = 0`).
4. **Multi-page inconsistencies (rules P3, V7 / 2-6)**: page 1 and page 2 could pick different sheet sizes (`A1` vs `A3`); section `A-A` was copied to page 2 so the letter `A` appeared twice; the main view redrawn on page 2 as the parent of sections and details had the same caption as page 1.
5. **Missing scale in captions (rule V5 / 2-7)**: views drawn at a scale different from the sheet's (such as the shaded isometric view or a section at another scale) did not state their scale in their default caption.
6. **Turned parts picked an end view as the main view (rule V2 / 2-8)**: `rankMainViews` scored views solely by visible line length, true circles, edge-on planes and hidden-line ratio; on `R1-8032` (where `65.3%` of the surface area is coaxial surfaces of revolution around the Y axis), the end view `bottom` beat the side view `right` (`0.801` vs `0.715`).
7. **No layout self-check in `drawing_inspect` (rule 2-9)**: `drawing_inspect` reported dimension coverage and text clutter, but not view clearances, fill ratios, detail placement/content, scale conformance, multi-page consistency or turned-part main-view orientation.

## Decisions (user, 2026-11-19 & 2026-11-20)

1. **Pure layout measurement (`layoutMetrics`, `@3db/drawing`)**:
   - Measures each page directly from the built scene items and placed views: per-view `box`, `drawn` box (union of the view, its dimensions and its caption) and four-side `reach`; pairwise `clearances` and `minClearance`; `fillW`, `fillH` and `viewAreaFill`; per-detail `distance` to its parent's drawn box, `parentDiagonal`, `diameter`, `maxDistance = max(parentDiagonal, 2 * diameter)`, `blocked` (whether any other non-detail view's `box` crosses the line between the detail's centre and its parent's centre), `ink`, `perimeter` and `inkRatio`; and `nonStandardScales` against `STANDARD_SCALES` (ISO 5455).
2. **View clearance (`minViewClearance = 2 * dimTextHeight`, `clearViews` / `slideApart`)**:
   - `clearViews` slides projected and section views along their `slideAxis` (`DrawingView.slide`) by the exact deficit plus `0.5` mm until every pair has `gap >= 2 * textHeight` (`7` mm for `3.5` mm text).
   - `fitWithRoom` refits the sheet after `clearViews`, and `tidyFitted` refits if `tidy` pushes content past the drawable area (`fillW > 1` or `fillH > 1`). Editing operations (`drawing_text_size`, `drawing_complete`) pass `'keep'` so existing sheet size and scale are never altered during user edits.
   - When `create()` steps through candidate sheets, each sheet is laid out fresh on that sheet size so slides from a smaller sheet do not carry over.
3. **Constrained-direction fill (`FILL_RANGE = [0.60, 0.95]`, rule 2-2)**:
   - Because slender parts cannot simultaneously fill 60–85% of both width and height, fill is measured along the constrained direction `max(fillW, fillH)`. On a single-page drawing or the page that determines the drawing's sheet size, `max(fillW, fillH)` must fall in `[0.60, 0.95]`, and every page must stay within the drawable area (`<= 1.00`).
4. **Detail views (`DETAIL_SCALES`, `MIN_DETAIL_INK = 0.25`, `nearestFreeSpot`, `dropEmptyDetails`)**:
   - `DETAIL_SCALES` is restricted to ISO 5455 standard scales: `20:1`, `10:1`, `5:1`, `2:1`, `1:1`.
   - Measured on a plate with rounded corners, a corner-fillet detail has `inkRatio ≈ 0.39` and a single line across a circle `0.32`, whereas an empty detail has `0`; `MIN_DETAIL_INK` is set to `0.25`. Details below `0.25` are removed by `dropEmptyDetails`, their dimensions returned to their source view, and remaining details re-lettered `C, D, E...` without gaps.
   - `nearestFreeSpot` searches a 2 mm summed-area grid for the nearest free footprint to the parent's drawn box with an unobstructed line of sight to the parent's `box` (penalizing blocked spots and ignoring unplaced sibling details). `placeDetails` tries margins `30, 20, 10, 0` mm around the detail circle and accepts the first unobstructed spot whose box distance is within `maxDistance`.
5. **Multi-page sheet and view consistency (rule 2-6)**:
   - When section `A-A` has `>= 2` micro-radii offloaded to page 2, `A-A` and its dimensions are moved to page 2 (not copied), so every section and detail letter appears once across the entire drawing.
   - Subsequent pages start their sheet search from page 1's sheet size (at least `A3` when details are present) and pick the smallest sheet with `layoutFaults === 0`; if page 2 needs a larger sheet than page 1, page 1 is re-laid out on that largest sheet so all pages share the same `SheetSize`.
   - The base view redrawn on page 2 as the parent of sections and details is named with `drawing.view.reference` (`{name}（參考，同第 1 頁）` / `{name} (reference, as on page 1)`).
6. **View caption scale (rule 2-7)**:
   - `viewCaptionItem` appends ` (<SCALE>)` whenever a view's scale differs from `sheetScale`, the user has not set custom `caption.text`, and the template does not already include `<SCALE>`.
7. **Turned-part main view (`REVOLVED_PART_SHARE = 0.5`, `revolutionAxis`, `rankMainViews`, rule 2-8)**:
   - Measured across the five reference parts, coaxial surfaces of revolution (cylinders, cones and tori sharing the same 3D axis line within `1e-4` direction cosine and `1e-2` mm axis offset) account for `54.7%` (`sds-plus-bit`), `61.4%` (`diamond-pin`) and `65.3%` (`R1-8032`) of total surface area on turned parts, versus `1.5%` (`v-block`) and `2.5%` (`locating-plate`) on prismatic parts.
   - `revolutionAxis` returns the dominant coaxial axis when its area share is `>= 0.5`. When an axis is present, `rankMainViews` ranks side-on views (where the view direction is perpendicular to the revolution axis) ahead of end-on views.
8. **Self-check reporting (`checks.layout` & `drawing_inspect.layout`, rule 2-9)**:
   - `DrawingSession.checks` and `drawing_inspect` return `layout: DrawingLayoutInspection`, containing per-page `PageLayoutInspection` (`fillW`, `fillH`, `maxFill`, `minClearance`, `needClearance`, `details`, `nonStandardScales`, `captionClutter`, per-rule booleans and `pass`), `multiPage` (`sameSheet`, `uniqueLetters`, `referenceMarked`, `pass`), `mainView` (`revolved`, `axis`, `direction`, `sideOn`, `pass`), and overall `layout.pass`.

## Measured Results on the 5 Benchmark Parts (2026-11-20)

| Part / Page | Coaxial Rev Share | Main View | Sheet & Scale | Max Fill (`0.60–0.95` dominant) | Min Clearance (`≥ 7` mm) | Details (`blocked=0`, `dist ≤ max`, `ink ≥ 0.25`) | `layout.pass` |
|---|---|---|---|---|---|---|---|
| `diamond-pin` p1 | `61.4%` (turned) | `right` (side-on) | A3 2:1 | `0.727` | `8.00` mm | — | `true` |
| `locating-plate` p1 | `2.5%` (prismatic) | `top` | A3 1:1 | `0.798` | `9.66` mm | — | `true` |
| `v-block` p1 | `1.5%` (prismatic) | `right` | A4 1:1 | `0.823` | `7.53` mm | — | `true` |
| `sds-plus-bit` p1 | `54.7%` (turned) | `front` (side-on) | A2 1:1 | `0.831` | `14.53` mm | — | `true` |
| `sds-plus-bit` p2 | `54.7%` (turned) | `front` (ref) | A2 1:2 | `0.675` | `7.46` mm | — | `true` |
| `R1-8032` p1 | `65.3%` (turned) | `right` (side-on) | A0 20:1 | `0.608` | `198.23` mm | — | `true` |
| `R1-8032` p2 | `65.3%` (turned) | `right` (ref) | A0 2:1 | `0.549` (subordinate) | `7.545` mm | 5 details (`12.4–38.6` / `56–81.2` mm, `ink 0.81–8.95`) | `true` |

## Consequences

- Every benchmark part passes rules `2-1` through `2-9` with `overallLayoutPass: true` and `0` caption clutter.
- Turned parts (`R1-8032`, `diamond-pin`, `sds-plus-bit`) automatically select a longitudinal side view as their main view without changing the main view of prismatic parts (`locating-plate`, `v-block`).
- Remaining dimension-level clutter (such as closely spaced ordinate numbers, extension lines crossing section hatching, or `n×` feature counting on `R1-8032`) belongs to Phase 3 (dimension placement and content) and Phase 4 (quality gate).

## Tests

- `tests/phase5/drawing-layout-metrics.test.ts` (12 tests, 7 mutations)
- `tests/phase5/drawing-detail-placement.test.ts` (6 tests, 6 mutations)
- `tests/phase5/drawing-caption-scale.test.ts` (6 tests, 3 mutations)
- `tests/phase5/auto-drawing-plan.test.ts` (8 tests, including `revolutionAxis` and `rankMainViews` turned-part tests; 3 mutations all red)
- `apps/mcp/test/drawing-details.test.ts` (5 tests, including `drawing_inspect.layout` verification; 5 mutations all red)
- `apps/mcp/test/drawing-clearance.test.ts` (4 tests across the 3 fast golden parts asserting `minClearance`, `captionClutter` and `inspect.layout.pass`)
