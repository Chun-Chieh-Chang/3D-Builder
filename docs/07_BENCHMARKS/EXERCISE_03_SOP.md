# 3D-Builder Benchmark SOP: Exercise 03 - U-Bracket with Hub & Rib

This document defines the step-by-step CAD modeling procedure for the standard "Exercise 3" part, optimized for automation robot simulation.

---

## 🎯 Part Description
**Name**: U-Bracket with Hub and Rib
**Core Dimensions**:
- **Base (U-Shape)**: 100mm (L) x 60mm (W). Side wall height 30mm. Base thickness 15mm.
- **Vertical Hub**: Ø40mm, Height 50mm from base top.
- **Main Hole**: Ø20mm, Through All.
- **Rib**: 10mm thickness.

---

## 🛠️ Modeling SOP (Robot Actionable)

### Step 1: Base Plate (U-Shape Profile)
- **UI Interaction**: Select `Front Plane` ➔ `S-Key` ➔ `Line` / `Rectangle`.
- **Sketch Logic**:
    - Draw outer rectangle: 100mm x 30mm.
    - Draw inner rectangle (cutout): 70mm x 15mm (aligned to top edge center).
    - Use `Smart Dimension` to ensure 15mm wall thickness on sides and bottom.
- **Feature**: `Extruded Boss/Base` ➔ Direction: `Mid Plane` ➔ Depth: `60mm`.

### Step 2: Vertical Hub
- **UI Interaction**: Rotate to inner top face (Y=15) ➔ `Heads-up Toolbar: Normal To` ➔ `S-Key` ➔ `Circle`.
- **Sketch Logic**:
    - Place circle at Origin (0,0).
    - Dimension diameter to `40mm`.
- **Feature**: `Extruded Boss/Base` ➔ Depth: `50mm` (Blind).

### Step 3: Hub Center Hole
- **UI Interaction**: Select Hub top face (Y=65) ➔ `S-Key` ➔ `Circle`.
- **Sketch Logic**:
    - Place circle at Origin (0,0).
    - Dimension diameter to `20mm`.
- **Feature**: `Extruded Cut` ➔ Condition: `Through All`.

### Step 4: Support Rib
- **UI Interaction**: Select `Front Plane` (Mid-plane of the width) ➔ `S-Key` ➔ `Line`.
- **Sketch Logic**:
    - Draw a line connecting the Hub outer edge (X=20, Y=65) to the Base inner corner (X=35, Y=15).
- **Feature**: `Rib` ➔ Thickness: `10mm` ➔ `Both Sides`.
- **Workaround (Extrude Method)**:
    - If `Rib` feature is unavailable: Sketch a closed triangle (20,15) ➔ (20,65) ➔ (35,15).
    - `Extruded Boss/Base` ➔ `Mid Plane` ➔ Depth: `10mm`.

### Step 5: Fillets
- **UI Interaction**: Select outer bottom edges and inner base corners.
- **Feature**: `Fillet` ➔ Radius: `5mm`.

---

## 🚀 Validation Benchmarks
- **Volume Check**: Ensure the boolean union of Hub, Base, and Rib is manifold.
- **Topology Check**: The Rib must merge correctly with both the Hub and the Base without gaps.
