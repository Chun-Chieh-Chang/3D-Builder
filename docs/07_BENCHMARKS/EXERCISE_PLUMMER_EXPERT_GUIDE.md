# Modeling Script Guide: Plummer Block Assembly - Base Part (Video: mOU5bb50pgs)

## Feature Decomposition (Part 1: Casting Body / Base)

### 1. Base Plate (Extrude)
- **Sketch Plane**: Top Plane
- **Geometry**: Center Rectangle (166mm x 46mm)
- **Constraints**: 
    - Center coincident with Origin.
    - Width = 166mm, Height = 46mm.
- **Feature**: Extrude Boss/Base
    - Depth: 12mm

### 2. Central Housing (Extrude)
- **Sketch Plane**: Front Plane (or Middle Plane)
- **Geometry**: Composite profile (U-Shape)
    - Outer Arc: R38, Center at Origin (Z=38mm from base).
    - Vertical lines extending down to the base top face.
- **Constraints**:
    - Arc center constrained vertically to the origin.
    - Bottom lines Coincident with the top face of the Base Plate.
    - Tangent constraints between vertical lines and the outer arc.
- **Feature**: Extrude Boss/Base
    - Condition: Mid Plane
    - Depth: 46mm (Matches base width)

### 3. Inner Bearing Bore (Cut-Extrude)
- **Sketch Plane**: Front Plane
- **Geometry**: Semicircle (Arc/Circle)
- **Constraints**:
    - Concentric with the Outer Arc (R38).
    - Radius: R19 (Diameter 38mm).
- **Feature**: Extrude Cut
    - Condition: Through All - Both

### 4. Mounting Slots (Cut-Extrude)
- **Sketch Plane**: Top Face of Base Plate
- **Geometry**: Two Slot Profiles (or Rectangles with rounded ends)
- **Constraints**:
    - Centers horizontally aligned with origin.
    - Distance between slot centers: 128mm.
    - Slot dimensions: ~10.5mm width.
- **Feature**: Extrude Cut
    - Condition: Through All

## Constraint Implementation Focus
- **Mid Plane Extrusion**: Using symmetric bounding logic across the sketch plane.
- **Concentric Arcs**: The R38 outer housing and R19 inner bore must share a locked center node.
- **Tangency**: Ensuring the straight walls of the housing smoothly transition into the R38 arc.

## Simulation Goal
Create `tests/regression/e2e_video_plummer_sim.py` to verify the generation of the base plate, central housing, inner bore, and mounting slots.
