# 3D-Builder Benchmark SOP: Exercise 10 - Base with Inclined Octagonal Hub

This document defines the step-by-step CAD modeling procedure for "Exercise 10", featuring a rectangular base and an inclined octagonal hub. Optimized for automation robot simulation.

---

## 🎯 Part Description
**Name**: Base with Inclined Octagonal Hub
**Core Dimensions**:
- **Base Plate**: 56mm (L) x 32mm (W) x 8mm (H).
- **Inclination**: Hub axis is at **45°** relative to the Top Plane.
- **Hub Profile**: Octagon (8 sides), circumscribed diameter of **1.5 units** (Scale to **15mm** for mm-based modeling).
- **Hole**: Through-hole in the center of the hub.

---

## 🛠️ Modeling SOP (Robot Actionable)

### Step 1: Base Plate
- **UI Interaction**: Select `Top Plane` ➔ `S-Key` ➔ `Center Rectangle`.
- **Sketch Logic**:
    - Center at Origin (0,0).
    - Dimensions: **56mm** x **32mm**.
- **Feature**: `Extruded Boss/Base` ➔ Depth: **8mm**.

### Step 2: Reference Construction (Inclined Axis)
- **UI Interaction**: Select `Front Plane` ➔ `S-Key` ➔ `Line`.
- **Sketch Logic**:
    - Start point: Midpoint of the base top edge or Origin offset by height: (0, 8).
    - Draw a construction line at **45°** from the horizontal.
    - Dimension length to **20mm** (defines hub center position).
- **Feature**: Exit Sketch.

### Step 3: Reference Plane
- **UI Interaction**: `Reference Geometry` ➔ `Plane`.
- **References**:
    - **1st Ref**: Select the 45° line from Step 2.
    - **2nd Ref**: Select the endpoint of that line.
- **Constraint**: `Normal to Line`.

### Step 4: Octagonal Hub
- **UI Interaction**: Select the new `Reference Plane` ➔ `S-Key` ➔ `Polygon` (8 sides).
- **Workaround (Coordinate-based Octagon)**:
    - If the Polygon tool is unavailable, use these local coordinates (scaled for 15mm diameter):
      - $R = 7.5$
      - $V1: (6.93, 2.87)$
      - $V2: (2.87, 6.93)$
      - $V3: (-2.87, 6.93)$
      - $V4: (-6.93, 2.87)$
      - $V5: (-6.93, -2.87)$
      - $V6: (-2.87, -6.93)$
      - $V7: (2.87, -6.93)$
      - $V8: (6.93, -2.87)$
- **Feature**: `Extruded Boss/Base` ➔ Direction: `Toward Base` ➔ End Condition: **Up to Surface** (Select Top face of Base).

### Step 5: Center Hole
- **UI Interaction**: Select Hub top face ➔ `S-Key` ➔ `Circle`.
- **Sketch Logic**: Center on Hub, Diameter **Ø10mm** (or proportional to hub size).
- **Feature**: `Extruded Cut` ➔ Condition: **Through All**.

---

## 🚀 Validation Benchmarks
- **Intersector Logic**: Ensure the Octagon extrudes correctly into the base without "flying" or missing the surface.
- **Angle Verification**: The face of the hub must be exactly 45° from the base.
- **Manifold Check**: The final part should be a single solid body.
