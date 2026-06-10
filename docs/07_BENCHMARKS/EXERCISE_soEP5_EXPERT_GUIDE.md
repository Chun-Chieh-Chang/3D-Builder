# Modeling Script Guide: SolidWorks Exercise 5 (CADable) - Video: soEP5_cBqMI

## Feature Decomposition

### 1. Base Plate (Extrude)
- **Sketch Plane**: Top Plane (XZ)
- **Geometry**: Center Rectangle (100mm x 80mm)
- **Constraints**: 
    - Center coincident with Origin.
    - Width = 100mm, Height = 80mm.
- **Feature**: Extrude Boss
    - Depth: 20mm

### 2. Corner Fillets (3D Feature Adaptation)
*Note: The original video uses a 2D Sketch Fillet, but to maintain robustness in our current TNS 2.0 kernel, we adapt this to a 3D feature which yields the exact same B-Rep.*
- **Feature**: Fillet
    - Radius: 15mm
    - Target: The 4 vertical edges of the base plate.

### 3. Symmetrical Slots (Cut-Extrude)
- **Sketch Plane**: Top Face of Base
- **Geometry**: Two Slots (or Rectangles with rounded ends)
- **Constraints**:
    - Distance from outer edges: 16mm.
    - Symmetric across the Origin (using MIRROR constraint/feature).
- **Feature**: Extrude Cut
    - Condition: Through All

### 4. Side Boss Feature (Extrude)
- **Sketch Plane**: Top Face of Base
- **Geometry**: Corner Rectangle
- **Constraints**:
    - Coincident (Collinear equivalent) with the outer side edges of the base.
    - Fully Defined by locking to the existing geometry boundaries.
- **Feature**: Extrude Boss
    - Depth: Specific height above base (e.g., 20mm+).

### 5. Symmetrical Holes (Cut-Extrude)
- **Sketch Plane**: Top Face of the new Side Boss (or Base)
- **Geometry**: Two Circles
- **Constraints**:
    - Diameter: 24mm.
    - Concentric with the rounded edges or positioned symmetrically.
- **Feature**: Extrude Cut
    - Condition: Through All

## Constraint Implementation Focus
- **Symmetry & Mirroring**: Ensuring that constraints can mirror geometric relations across the origin or axis.
- **Coincident/Collinear**: Tying new sketch geometry (Side Boss) to the existing 3D boundaries.
- **Concentric**: Aligning the center of the 24mm hole with the geometry of the slots or side profiles.

## Simulation Goal
Create `tests/regression/e2e_video_soEP5_sim.py` to verify the geometric validity, specifically focusing on how symmetric cuts and 3D fillets stack together.
