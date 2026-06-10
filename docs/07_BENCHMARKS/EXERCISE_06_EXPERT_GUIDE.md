# Modeling Script Guide: SolidWorks Exercise 6 (Video: 6XyeGEqHrjI)

## Feature Decomposition

### 1. Main Base (Extrude)
- **Sketch Plane**: Top Plane (XZ)
- **Geometry**: Center Rectangle (90mm x 64mm)
- **Constraints**: 
    - Center coincident with Origin.
    - Width = 90mm, Height = 64mm.
- **Feature**: Extrude Boss
    - Depth: 33mm
    - Direction: Blind (Up)

### 2. Top Center Slot (Cut-Extrude)
- **Sketch Plane**: Top Face of Base
- **Geometry**: Center Rectangle (90mm x 16mm)
- **Constraints**:
    - Center coincident with Origin (projected).
    - Width = 90mm, Height = 16mm.
- **Feature**: Extrude Cut
    - Depth: 25mm

### 3. Center Through Hole (Cut-Extrude)
- **Sketch Plane**: Bottom Face of Top Slot (or Top Face)
- **Geometry**: Center Rectangle (26mm x 14mm)
- **Constraints**:
    - Center coincident with Origin.
    - Width = 26mm, Height = 14mm.
- **Feature**: Extrude Cut
    - Condition: Through All

### 4. Side Step Cutouts (Mirror/Pattern or Manual)
- **Sketch Plane**: Side Faces (YZ) or Front Face (XY)
- *Note*: Common Exercise 6 has 12x10mm cuts on corners. I will verify if these are required based on the visual. The search mentioned "阶梯状切除".
- **Proposed Steps**: 
    - Sketch 12x10 rectangle on Front Face corners.
    - Extrude Cut Through All.

## Technical Blocker Audit
- **Center Rectangle**: The `RectangleTool.ts` implementation needs to be verified for "Center Mode".
- **Through All**: Backend supports `ThroughAll`? I'll check `geometry_service.py`.
- **Top Face Selection**: Frontend selection system for non-standard planes needs to be robust.

## Simulation Goal
Create `tests/regression/e2e_video_ex6_sim.py` to verify volume and geometry connectivity.
