# Modeling Script Guide: SolidWorks Beginner Tutorial (Video: cWWP_-QRdkg)

## Video Context
This video is "SolidWorks - Tutorial for Beginners in 13 MINUTES! [ 2024 ]" by The Skills Factory. Instead of a single exercise, it covers foundational tools. The first 3D modeling demonstration focuses on transitioning from a 2D constrained sketch to an Extruded Boss/Base, followed by basic face selection and cutting.

## Feature Decomposition (First 3D Model)

### 1. Base Profile (Sketch & Extrude)
- **Sketch Plane**: Top Plane
- **Geometry**: Center Rectangle or Custom Polygon (We will use a fully dimensioned Center Rectangle as the fundamental first 3D solid).
- **Constraints**: 
    - Center Coincident with Origin.
    - `DISTANCE` constraints: Width = 120mm, Height = 80mm.
- **Feature**: Extrude Boss/Base
    - Depth: 30mm

### 2. Secondary Sketch (Face Selection & Arc/Circle)
- **Sketch Plane**: Top Face of the extruded base.
- **Geometry**: Circle
- **Constraints**:
    - Center Coincident with Origin (Concentric to base).
    - `DISTANCE` constraint: Diameter = 40mm (Radius = 20mm).
- **Feature**: Extrude Cut
    - Condition: Through All (or Blind 30mm)

### 3. Revolve Feature (Demonstration of Revolved Boss/Base)
- **Sketch Plane**: Front Plane (intersecting the center)
- **Geometry**: Vertical Centerline (Axis of Revolution) and a half-profile (e.g., a simple rectangle 20x40 offset from the axis).
- **Constraints**: 
    - Vertical constraint on the axis.
    - Distance from axis to inner edge = 20mm.
- **Feature**: Revolve Boss/Base
    - Angle: 360 degrees.

## Constraint Implementation Focus
- **Smart Dimensioning (`DISTANCE`)**: Ensuring the constraint solver handles point-to-point and edge length constraints efficiently.
- **Coincident**: Locking the circle center to the origin.
- **Revolve Axis**: Tying a revolve feature to a specific construction line.

## Simulation Goal
Create `tests/regression/e2e_video_cWWP_sim.py` to verify the generation of the base extrusion, the circular cut, and the independent revolved feature.
