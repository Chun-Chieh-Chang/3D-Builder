# 3D-Builder Release Gates Specification

> **Status**: Draft v1.0
> **Owner**: 3D-Builder Productization / QA
> **Applies to**: Criteria for transitioning between project phases
> **Related Plan**: \docs/productization/PRODUCTIZATION_PLAN.md\

---

## 1. Purpose

This document defines the mandatory "Release Gates" (acceptance criteria) that must be satisfied before the project can be declared to have moved from one phase to the next. This ensures structural integrity and functional reliability.

---

## 2. Phase 0: Internal Stabilization (Current)

The goal of Phase 0 is to unify the data model and ensure the core geometry engine is predictable.

### 2.1 Criteria for Completion
- [x] **Native Format**: \.3dbpart\ JSON schema is formally specified and used by the writer.
- [x] **Unified Sketch Model**: All legacy \sketchPoints\ are removed; UI and Kernel use the graph-based (\Nodes\, \Edges\, \Constraints\) model.
- [x] **API Contract**: \docs/spec/geometry-api.md\ is defined and implemented by both Frontend and Backend.
- [x] **Code Health**: \
px tsc --noEmit\ passes with zero errors.
- [x] **Governance**: All PDCA checks (\
pm run pdca:check\) pass.

---

## 3. Phase 1: Alpha

The goal of Phase 1 is a Minimum Viable Product (MVP) that can create, edit, and export simple parts.

### 3.1 Criteria for Completion
- [ ] **Geometry Stability**: Regression tests exist for Box, Extrude, and Revolve.
- [ ] **Functional Completeness**: User can create a closed sketch, extrude it, and add a fillet.
- [ ] **Persistence Roundtrip**: A saved \.3dbpart\ can be opened and rebuilt with identical results.
- [ ] **Exchange Reliability**: Exported STEP files open correctly in standard CAD viewers (e.g., FreeCAD).
- [ ] **UI Polish**: All buttons and menus follow the brand color master palette.

---

## 4. Phase 2: Private Beta

The goal of Phase 2 is usability and handling complex topologies.

### 4.1 Criteria for Completion
- [ ] **Topological Naming**: Persistent IDs for faces and edges are stable across rebuilds.
- [ ] **Constraint Solving**: Precise solver handles over-defined states and reports residuals.
- [ ] **Error Boundaries**: Frontend gracefully handles backend crashes or rebuild timeouts.
- [ ] **Feature History**: Rollback bar and feature reordering are functional and safe.

---

## 5. SOLIDWORKS 驗證標準對齊 (Verification Standard Alignment)

> All phase acceptance criteria below must conform to the validation levels (L1–L4) defined in [`docs/spec/SOLIDWORKS_VERIFICATION_STANDARD.md`](docs/spec/SOLIDWORKS_VERIFICATION_STANDARD.md).
> Feature-level verification tables are in [`docs/spec/SOLIDWORKS_VERIFICATION_STANDARD_FEATURES*.md`](docs/spec/SOLIDWORKS_VERIFICATION_STANDARD_FEATURES.md).

### 5.1 Mandatory Release Gate Items (All Phases)

Before any phase transition, the following gates are mandatory:

| Gate ID | Name | Command | Acceptance |
|---------|------|---------|------------|
| RG-01 | TypeScript Type Safety | `npx tsc --noEmit` | Zero errors |
| RG-02 | PDCA Document Consistency | `npm run pdca:check` | All checks pass |
| RG-03 | Unit Test Coverage | `npm run test:unit` | Coverage >= Phase requirement |
| RG-04 | Golden Test | `npm run test:golden` | All applicable golden tests pass |
| RG-05 | Event-Chain Audit | Manual + automated | Full trace for all L4 features |
| RG-06 | Feature Verification SOP | Per [FEATURES.md](docs/spec/SOLIDWORKS_VERIFICATION_STANDARD_FEATURES.md) | All L3+ rows pass |

### 5.2 Phase 2 Feature Verification Checklist

Each Phase 2 feature must pass the verification table defined in the corresponding section of `SOLIDWORKS_VERIFICATION_STANDARD_FEATURES.md`:

- **2D Sketch Engine** → Section 3.5 (驗證等級 L3–L4)
- **Geometric Constraints** → Section 3.5 (L4)
- **Base Features (Extrude/Revolve)** → Section 3.6 (L4)
- **Boolean Operations** → Section 3.6 (L4)
- **File I/O (STEP/IGES)** → Section 3.12 (L3)

### 5.3 Golden Part Requirements

- Each L4-verified feature must have a `golden/` directory with `solidworks_step.step`, `golden_part.3dbpart`, `golden_spec.json`, and `golden_report.md`.
- Tolerance thresholds defined in [SOLIDWORKS_VERIFICATION_STANDARD_FEATURES_3.md](docs/spec/SOLIDWORKS_VERIFICATION_STANDARD_FEATURES_3.md):
  - Volume: ±1 PPM
  - Surface area: ±10 PPM
  - Center of gravity: ±0.001 mm
  - Topology count: 100% match
  - Moments of inertia: ±100 PPM
