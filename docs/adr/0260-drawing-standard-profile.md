# ADR 0260: a drawing is drawn to a standard (CNS 3 by default, ISO on request), and every value of a standard is in one profile

Status: Accepted (2026-11-19). Phase 1 of the drawing-rules work (`out/agent/自動出圖改善計畫.md`, not in the repository); phases 2–4 (view layout, dimension placement and content, a quality gate) get ADRs of their own.

## Context

Reviewing the auto-drawing of the real part R1-8032 (2026-11-19) against drafting standards and Taiwanese teaching material found that the program drew every sheet to one set of ISO values, written as constants in several places: the line widths (`LINE_STYLES`, outlines 0.5 and everything else 0.25 mm on every sheet size), the frame (`sheetMetrics`, 20 mm on the left), the dimension line width (`DIM_STYLE_DEFAULT`). The parts and their customers are in Taiwan, where drawings are made to CNS 3, which differs:

- three line widths (thick, medium, thin; the thick about 1.5 times the medium, the medium about twice the thin), chosen by sheet size: 0.7 / 0.5 / 0.25 mm on A1, 0.5 / 0.35 / 0.18 mm on A4;
- hidden lines drawn medium, not thin;
- centre lines as a dash of about 20 mm, a gap of about 1 mm and a dot;
- the frame 25 mm from the left edge (for binding), 15 mm elsewhere on A0 to A2 and 10 mm on A3 and A4.

Source: Tamkang University, 機械畫 ch. 1 (CNS teaching material). The CNS 3 text itself has not been read; the values are to be checked against it.

## Decision (user, 2026-11-19)

1. A sheet has a drafting standard, `sheet.standard`: `'CNS'` or `'ISO'` (drawing schema v39). It is one standard for the whole drawing: setting it on one page sets it on every page.
2. **A new drawing is made to CNS 3.** The system default is written once, `DEFAULT_DRAWING_STANDARD` in `@3db/model`; `createEmptyDrawing`, the web app (through its option), the MCP `drawing_create` and its description all read it.
3. **A sheet that names no standard is ISO** (`LEGACY_DRAWING_STANDARD`): every drawing saved before v39 opens exactly as it looked.
4. The default for new drawings can be changed in 「選項」 (`SystemOptions.drawingStandard`), whose first value is `DEFAULT_DRAWING_STANDARD`.
5. Single source of truth: every value a standard decides is in `DRAWING_PROFILES` (`@3db/model`): the line group per sheet size, the frame line width, the frame margins per sheet size, the hidden and centre dashes, the DXF centre linetype. `lineGroupOf`, `frameMarginsOf`, `profileOf` read it; `LINE_STYLES` (ISO) and `lineStylesFor` (any sheet) in `@3db/drawing` are built from it; `sheetMetrics` takes its frame from it; `baseDimStyle` gives a CNS sheet's dimensions its thin width.
6. Every output follows the sheet's standard: the scene carries the sheet's line styles (`Scene.lines`, absent for ISO), and the SVG, the PDF, the DXF (layer lineweights, and a `CENTER_CNS` linetype only when a CNS sheet uses it) and the PNG preview read them (`sceneLines`).

## Consequences

- An ISO scene is the same object as before: no `lines`, no `dimStyle` unless the drawing has its own. Measured: the four golden parts drawn by `drawing_create` as ISO and exported to SVG, DXF and PDF give **14 of 14 files byte-identical** to the commit before this change (`db051b9a`); two runs at that commit were identical to each other first, and the same kit run as CNS differs on all 14, so the comparison can see a change.
- New drawings look different: wider outlines on A0–A1, a medium hidden line, CNS centre dashes, the frame 5 mm further right. Tests that worked out sheet positions by hand from ISO's frame take `createEmptyDrawing('ISO')`; their numbers did not change.
- `standardOf` is the only reading of the field; a reader of `sheet.standard` directly would treat an old sheet as having none.
- The CNS values for A0, A2 and A3 are not given by the teaching material: A0 takes A1's group and A2–A3 take A4's (the narrower one) until the CNS 3 text is read.
- Not changed in this phase: the cutting-plane line (CNS draws it thick at its ends), text heights (both standards keep 3.5 mm dimension text), the title block. These belong to the later phases.

## Verification (2026-11-19)

- `npm run check`: typecheck, the four lints and the unit suite pass (496 files, 6270 tests, 0 failed, 30 skipped).
- `npm run verify:ui`: 278 of 280 rows. `manual-drawing-linked` failed because it measures the centring against an ISO A3 area; it now sets `standard: 'ISO'` on its new drawing and passes. `manual-browser-projects` failed intermittently: it fails about 1 run in 4 on the commit before this change as well (see DEV_LOG), so it is not caused by this ADR; it is not fixed here.

## Tests

`tests/phase5/drawing-standard.test.ts` (44): the widths of each standard on each size read back from the SVG, the PDF's content stream and the DXF's layers; the dashes; the frame, computed and drawn; an unnamed sheet's scene equal to an explicit ISO's and to the old `LINE_STYLES`; the default in one place (`createEmptyDrawing`, the web options); one standard per drawing; an unknown standard refused by the command and by the reader; the v38 upgrade. Mutations (each turned the file red): hidden lines thin on CNS (10 red), CNS frame at 20 mm (6), the SVG, PDF or DXF ignoring the scene's styles (8, 3, 5), an unnamed sheet taken as the default instead of ISO (2), the reader accepting any standard (1).
