# ADR 0252 — Structured CAD control and headless acceptance

Date: 2026-11-13

## Context

ADR 0237 already supplies a deterministic command session, rollback, software rendering and manufacturing exports. The new protocol must share that session, including ADR 0238 live-app approval of transactions, rather than introduce another geometry engine.

## Decision

- `packages/mcp` (`@3db/cad-protocol`) owns strict numeric feature schemas and translation to native commands. `apps/mcp` remains the server host. `packages/cli` provides the `3d-builder` executable using the same bundled session.
- Four tools are exposed: `cad_execute_feature`, `cad_get_viewport_screenshot`, `cad_inspect_geometry`, `cad_export_manufacturing`.
- A primitive is a native fixed profile plus an extrusion, not a detached kernel solid. Subsequent changes therefore retain feature history and dependency references.
- Rejected transactions do not enter history. Responses distinguish attempted features from `current`, the retained document's actual metrics and image. No-body/image failures are explicit; no fake image is returned.
- Explicit repair policy bounds attempts to 8 and permits only decreasing numeric fillet radius or equal-distance chamfer distance. Every requested value and outcome is retained in `attempts`. Command validation and live-app refusals are not retried. Exhaustion reports rejection. External multimodal agents can use the image and metrics to submit a different construction; this server does not itself run an LLM or claim automatic visual defect recognition.
- Numeric dimensions are positive finite mm, at most 100000; pattern counts are integers from 2 to 200. Unsupported fields are rejected. Native expression-based commands remain available through `apply_commands`.
- Inspection includes reference bodies, exact mass integration, bounds and concave cylindrical wall axes/rim centers. These are measured holes, not a claim that every hole is a mounting feature. The adapter does not invent a universal maximum fillet radius from edge length.
- Mesh tolerance is an absolute mm chordal tolerance for STL/3MF, at least 0.0001 mm as an explicit agent tessellation budget. Smaller values are refused, not clamped. STEP uses BRep and is unaffected. Existing finer OCCT tessellation may be reused.
- CLI scripts use existing declarative `commands` and optional `variables`. Explicit CLI output rejects script-level `outputs` to avoid ambiguous destinations. No GUI, browser or arbitrary code evaluation is needed.

## Reference patterns

[SolidCraft](https://github.com/tangency-labs/solidcraft) exposes CAD automation through MCP alongside desktop/web use. [FreeCAD MCP](https://github.com/neka-nat/freecad-mcp) separates its CAD addon and MCP server. This change follows the shared-core/transport-adapter pattern; it does not import either project's source or expose arbitrary Python execution.

## Evidence and limits

Tests exercise the seven requested operation categories, explicit correction and undo, retained snapshots, real PNGs, real CLI child processes, analytic flange and involute gear volumes (0.05%) and bounds (0.01 mm), STL edge incidence/orientation and STEP BRep validity. A seeded 100-case primitive test measures real volume and logs actual WASM heap with a positive-baseline assertion. Heap growth is not claimed to be zero (AGENTS §3.5).

STEP import through the same kernel does not certify interoperability with independent CAD readers. The STL incidence test is for the benchmark solid, not a general proof of arbitrary mesh self-intersection absence. General construction replacement and aesthetic judgment remain responsibilities of the external agent.
