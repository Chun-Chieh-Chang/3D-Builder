# 3D-Builder Benchmark SOP: Exercise 05 - Stepped Base with Hub

## 🎯 Part Description
A stepped support base featuring a large horizontal platform and a vertical riser. The riser includes a cylindrical hub with a through-hole, mirrored across the central symmetry plane. A relief slot is cut into the bottom of the base.

**Key Dimensions**:
- Base: 145mm x 72mm
- Total Height: 90mm
- Base Thickness: 25mm
- Hub: Ø24mm, 20mm Length
- Hub Hole: Ø12mm, Through All
- Bottom Slot: 70mm x 5mm

## 🛠️ Modeling SOP (Robot Actionable)

### Step 1: Base Profile (Sketch 1)
- **Plane**: Right Plane (YZ)
- **Action**: Sketch a stepped "L" profile.
- **Coordinates/Geometry**:
  - Line 1 (Bottom): (0, 0) to (145, 0)
  - Line 2 (Right Edge): (145, 0) to (145, 25)
  - Line 3 (Step): (145, 25) to (72, 25)
  - Line 4 (Riser Back): (72, 25) to (72, 90)
  - Line 5 (Top): (72, 90) to (0, 90)
  - Line 6 (Front Face): (0, 90) to (0, 0)
- **Constraints**: 
  - All lines Horizontal or Vertical.
  - Dimensions: Length=145mm, Total Height=90mm, Base Thickness=25mm, Riser Width=72mm.

### Step 2: Main Body (Extrude 1)
- **Feature**: Extrude Boss/Base
- **Parameters**: 
  - Direction: Mid Plane
  - Depth: 72mm
- **Result**: A symmetric stepped block with a 72mm x 72mm square riser section.

### Step 3: Bottom Relief Slot (Cut 1)
- **Plane**: Front face of the base (the 72mm x 25mm face at Z=0).
- **Sketch**: Center Rectangle.
- **Dimensions**: 70mm Width, 5mm Height.
- **Constraints**: Centered horizontally on the bottom edge of the face.
- **Feature**: Extruded Cut -> Through All (Z-direction).

### Step 4: Cylindrical Hub (Extrude 2)
- **Plane**: Side face of the riser (the face at X=36).
- **Sketch**: Circle.
- **Diameter**: 24mm.
- **Position**: 
  - Vertical: 45mm from the bottom edge of the part.
  - Horizontal: 36mm from the vertical edge of the riser (centers the hub on the 72mm width).
- **Feature**: Extrude Boss -> 20mm (Blind, outward).

### Step 5: Hub Hole (Cut 2)
- **Plane**: Circular face of Extrude 2.
- **Sketch**: Circle.
- **Diameter**: 12mm.
- **Constraint**: Concentric with the Hub (Ø24).
- **Feature**: Extruded Cut -> Through All.

### Step 6: Symmetry Mirror (Mirror 1)
- **Mirror Plane**: Right Plane (the original sketch plane).
- **Features to Mirror**: Extrude 2 (Hub) and Cut 2 (Hole).
- **Result**: Identical hub features on both sides of the riser.

## 🚀 Validation Benchmarks
1. **Mass Properties**: Verify volume (approx. 245,000 mm³ depending on exact geometry).
2. **Interference**: Ensure the bottom slot does not intersect the hub.
3. **Symmetry**: Check that the model is perfectly symmetric about the Right Plane.
