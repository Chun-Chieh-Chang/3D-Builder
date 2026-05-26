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
