# ADR 0263: drawing quality gate (draft vs release status, PRELIMINARY stamp, general tolerance and 3D model authority checks)

Status: Accepted (2026-11-20). Phase 4 of the drawing-rules work (`docs/drawing-improvement-plan.md`, `docs/design/drawing-rules-cns.md`); follows [ADR 0260](0260-drawing-standard-profile.md) (Phase 1), [ADR 0261](0261-drawing-view-layout.md) (Phase 2) and [ADR 0262](0262-drawing-dimension-placement-and-content.md) (Phase 3).

## Context

Prior to Phase 4, `drawing_inspect` and `drawing_create` reported raw metrics (`clutter`, `overlaps`, `outside`, `failed`, `coverage`, `layout`), while `drawing_export` wrote PDF/DXF/SVG unconditionally with no indication of whether the drawing passed all specification rules (`Q1`, `Q2`, `C5`, `C7`, `Q3`). In particular:

1. A drawing with `coverage.complete === true` could still contain text clutter, view clearance violations, or a blank `generalTolerance` field (`Q2`, `C5`).
2. Incomplete drawings lacking both a `"依 3D 模型"` / `"per 3D model"` authority note and a filled `generalTolerance` field could be exported without warning (`C7`).
3. Draft drawings were visually indistinguishable from formally released drawings (`Q1`).

## Decisions

1. **Pure quality gate evaluator (`packages/drawing/src/qualityGate.ts`)**:
   - Exported `evaluateQualityGate(input): QualityGateReport`, `hasModelAuthorityNote(doc)`, and `stampPreliminary(scene)` from `@3db/drawing`.
   - Evaluates 16 deterministic rules covering layout (`V1`, `P1_P2`, `V4`, `V6`, `P4`, `P3_V7`, `V5`, `V2`), readability & integrity (`D5`, `D2`, `P6`, `P1`, `C4`), tolerances & model authority (`C5`, `C7`), and drafting standard consistency (`Q3`).
   - `status` is `'release'` (`pass: true`) **if and only if** `failed.length === 0`; otherwise `status` is `'draft'` (`pass: false`). Per `Q2`, `coverage.complete === true` alone never yields `'release'`.
   - **Rule `C5`**: `title.generalTolerance` must be non-blank on every page; the tool never auto-fills a tolerance value.
   - **Rule `C7`**: either `coverage.complete === true`, or both `hasModelAuthorityNote(doc)` (`依 3D 模型` / `per 3D model` / `ASME Y14.41` / `ISO 16792`) and non-blank `generalTolerance` are present.
2. **Draft `PRELIMINARY` stamp (`stampPreliminary`)**:
   - Appends a red diagonal `PRELIMINARY` `SceneText` (`color: '#CC3333'`, `angle: 30`, `anchor: 'center'`) to any exported page whose drawing has `status === 'draft'`. Because PDF, SVG, DXF and PNG all render `SceneText` with `angle` and `color`, the watermark is identical across all formats.
3. **MCP integration (`apps/mcp/src/drawingSession.ts`, `apps/mcp/src/drawingTools.ts`)**:
   - `Checks.quality` and `drawing_inspect.quality` expose the full `QualityGateReport` (`status`, `pass`, `rules`, `failed`).
   - `drawing_export` accepts optional `release?: boolean`:
     - When `release: true` and `!quality.pass`, throws `AgentError` listing every failed rule and writes **no** file.
     - When `release` is omitted/false and `!quality.pass`, exports stamped `PRELIMINARY` and returns `{ status: 'draft', preliminary: true, failed }`.
     - When `quality.pass === true`, exports cleanly without `PRELIMINARY` and returns `{ status: 'release', preliminary: false, failed: [] }`.

## Verification & Mutation Tests

- `tests/phase5/drawing-quality-gate.test.ts` (5 tests): verifies clean release pass, `Q2` complete-but-cluttered rejection, individual violation blocking across all 16 rules (`4-1`), `C5`/`C7` matrix with `"依 3D 模型"` note, and `stampPreliminary` in SVG/DXF.
- `apps/mcp/test/drawing-quality-gate.test.ts` (1 end-to-end test): verifies `drawing_create` → `drawing_inspect` → `drawing_export` (`release: true` refused with no file written when `generalTolerance` is blank; draft SVG/DXF stamped `PRELIMINARY`; setting `generalTolerance` via `drawing_apply` transitions to `release` and exports cleanly without `PRELIMINARY`).
- **4/4 Mutation tests turned red (`4-2`)**:
  1. `qualityGate.ts`: force `pass = true` → failed.
  2. `qualityGate.ts`: bypass `C5` (`generalTolerance` check) → failed.
  3. `qualityGate.ts`: bypass `C7` (`completenessOrModelAuthority`) → failed.
  4. `drawingSession.ts`: skip `stampPreliminary(rawScene)` → failed.

## Amendment (2026-11-23): C7 Controlled Geometric Attachment Verification

When a drawing omits 2D dimensions for complex/small-angle geometry and instead cites a controlled geometric attachment (e.g. `受控幾何附件 R1-10226-GEO-01 版次 01` or `Controlled geometric attachment <DOC> Rev <REV>`) rather than a generic `"依 3D 模型"` note, `C7` now verifies the attachment end-to-end across five mandatory invariants (`packages/drawing/src/qualityGate.ts`, `apps/mcp/src/controlledAttachment.ts`, `apps/mcp/src/drawingSession.ts`):

1. **Citation & revision match**: drawing note cites a single `{ document, revision }` matching `manifest.json`.
2. **Source model match**: every model view's `source` basename matches `manifest.json`'s `source`.
3. **Cryptographic integrity**: `manifest.json` has equal valid 64-hex `original_step_sha256` and `regenerated_step_sha256`, matching the loaded `.3dbx` part's STEP blob SHA-256, and every file in `members_sha256` (including `drawing-face-index.json`, single safe path segment) exists and matches its SHA-256 on disk.
4. **Face reference & STEP citation coverage**: every missing `slants`/`rounds`/`ways` face ref maps via `drawing-face-index.json` to a positive integer `step_face`, and `#<step_face>` is explicitly cited in a drawing note.
5. **General tolerance (`C5`)**: `title.generalTolerance` must still be non-blank on every page.

- **Real-part verification (`R1-10226`)**: opening `out/approved-20261122/r110226-auto-fixed/R1-10226-geometry-definition.3dbd` alongside `R1-10226-GEO-01/` passes **16/16 quality gate rules** (`status: 'release'`, `failed: []`), and `drawing_export({ release: true })` succeeds without `PRELIMINARY`.
- **Mutation tests (5/5 turned red)**: disabling revision check, source model check, `integrityOk` check, `#STEP_ID` drawing citation check, and `members_sha256` file hash check each fail the test suite.
