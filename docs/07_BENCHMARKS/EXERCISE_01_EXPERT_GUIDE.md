# Modeling Script Guide: SolidWorks Exercise 1 (Video: FqK9rs50upg)

## Feature Decomposition

### 1. Base Plate (Extrude)
- **Sketch Plane**: Top Plane (XZ)
- **Geometry**: Center Rectangle (80mm x 50mm)
- **Constraints**: 
    - Center coincident with Origin.
    - Width = 80mm, Height = 50mm.
- **Feature**: Extrude Boss
    - Depth: 18mm

### 2. Vertical Wall (Extrude)
- **Sketch Plane**: Top Face of Base
- **Geometry**: Rectangle (80mm x 12mm)
- **Constraints**:
    - Aligned with the back edge of the base.
    - Width = 80mm, Depth = 12mm.
- **Feature**: Extrude Boss
    - Depth: 38mm (Total height from top of base)

### 3. Corner Slant Cut (Cut-Extrude)
- **Sketch Plane**: Front Face of the Vertical Wall
- **Geometry**: Triangle (3 Lines)
- **Constraints**:
    - Top vertex: 10mm from the top edge.
    - Side vertex: 12mm from the side edge.
    - Hypotenuse: 45° angle with the vertical edge.
- **Feature**: Extrude Cut
    - Condition: Through All

## Constraint Implementation Focus
- **Angular Constraint**: Verify `ConstraintSolver.ts` for `ANGLE` support.
- **Distance Constraint**: Use `DISTANCE` with edge references or node-to-node.
- **Through All**: Ensure the cut depth exceeds the 12mm thickness of the wall.

## Simulation Goal
Create `tests/regression/e2e_video_ex1_sim.py` to verify the geometric validity and volume of the resulting part.
