# Task Plan: Sprint DRAW-1 (Backend HLR Engine & DXF Export)

## Goal
Implement the backend Hidden Line Removal (HLR) engine using OpenCASCADE to project 3D models into 2D vector data, serving as the foundation for the Engineering Drawings module, and provide Industrial standard DXF export.

## Phases

### Phase 1: Research & Kernel Audit
- [x] Read `backend/app/services/geometry_service.py` to identify the optimal location for HLR logic.
- [x] Read `backend/app/routers/geometry.py` to plan the API endpoint.
- [x] Determine PythonOCC `HLRBRep` API usage (HLRAlgo_Projector, HLRBRep_Algo, HLRBRep_HLRToShape).
- Status: `complete`

### Phase 2: Implementation of HLR Logic in `geometry_service.py`
- [x] Add `extract_hlr_edges(shape, view_dir)` function (Exists as `project_2d`).
- [x] Configure `HLRAlgo_Projector` with standard isometric, top, front, and right vectors.
- [x] Extract visible (`VCompound`) and hidden (`HCompound`) edges.
- [x] Convert OpenCASCADE edges into 2D coordinate arrays (JSON serializable).
- [x] NEW: Add DXF parsing to export `project_2d` visible/hidden lines into an AutoCAD compatible `.dxf` format natively.
- Status: `complete`

### Phase 3: Exposing the API & Frontend Hooks
- [x] Verify `POST /api/v1/geometry/project` endpoint in `geometry.py`.
- [x] Add DXF button and state to `src/ui/Modals/ExportModal.tsx`.
- Status: `complete`

### Phase 4: Verification
- [x] Write a unit test `backend/test_hlr.py` to test the API locally.
- [x] Validate the frontend UI successfully renders the DXF option in the export panel.
- Status: `complete`
